// ===========================================================================
// r2d-help — CLI-помощник по `$` API (docs/HELP.md).
//
//   r2d-help <запрос…>                     то же, что search
//   r2d-help search <запрос…> [--top N] [--text]
//   r2d-help show <имя>                     полное описание: .navigateTo, $.nav.find
//   r2d-help index [--root dir] [--out f]   собрать/обновить индекс
//   r2d-help status                         индекс, модель, свежесть
//   r2d-help version
//
// Общие флаги: --index f, --model f.gguf, --root каталог, --threads N,
// --no-update (не пересобирать устаревший индекс).
// Ответ — один JSON-объект на stdout (--text — для человека). Коды выхода
// как у r2d-sdk: 0 — ok, 1 — выполнено с ошибками в данных, 2 — неверный вызов.
// ===========================================================================
#include "help.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DEFAULT_TOP 8
#define MAX_TOP     50

typedef struct Ctx {
    SdkArgs     args;
    SdkReport   rep;
    char        index_path[2048];
    char        model_path[2048];   // "" — модели нет
    char        root[2048];         // "" — исходников нет (поставленный пакет)
    int         threads;
    bool        text;
} Ctx;

typedef struct UpdateInfo {
    bool checked;      // была проверка свежести
    bool stale;
    bool updated;
    int  embedded;     // сколько записей посчитано моделью заново
    int  reused;       // сколько векторов взято из прошлого индекса
} UpdateInfo;

// ---------------------------------------------------------------------------
// Пути
// ---------------------------------------------------------------------------
static void exe_file(const char *name, char *out, size_t cap)
{
    sdk_join(sdk_exe_dir(), name, out, cap);
}

static bool find_root(const Ctx *c, char *out, size_t cap)
{
    const char *v = sdk_arg_value(&c->args, "--root");
    if (!v) v = getenv("R2D_HELP_ROOT");
    if (v) {
        if (!help_root_ok(v)) return false;
        snprintf(out, cap, "%s", v);
        return true;
    }
    // Вверх от текущего каталога: помощник запускают изнутри репозитория.
    char *cwd = SDL_GetCurrentDirectory();
    if (cwd) {
        char dir[2048];
        snprintf(dir, sizeof dir, "%s", cwd);
        SDL_free(cwd);
        for (int up = 0; up < 8; ++up) {
            size_t n = strlen(dir);
            while (n > 1 && (dir[n - 1] == '/' || dir[n - 1] == '\\')) dir[--n] = '\0';
            if (help_root_ok(dir)) { snprintf(out, cap, "%s", dir); return true; }
            char *slash = strrchr(dir, '/');
            if (!slash) slash = strrchr(dir, '\\');
            if (!slash || slash == dir) break;
            *slash = '\0';
        }
    }
    // Бинарник в build/ внутри репозитория.
    char p[2048];
    snprintf(p, sizeof p, "%s..", sdk_exe_dir());
    if (help_root_ok(p)) { snprintf(out, cap, "%s", p); return true; }
    return false;
}

static void resolve_paths(Ctx *c)
{
    const char *v = sdk_arg_value(&c->args, "--index");
    if (!v) v = getenv("R2D_HELP_INDEX");
    if (v) snprintf(c->index_path, sizeof c->index_path, "%s", v);
    else exe_file("r2d-help.idx", c->index_path, sizeof c->index_path);

    v = sdk_arg_value(&c->args, "--model");
    if (!v) v = getenv("R2D_HELP_MODEL");
    if (v) snprintf(c->model_path, sizeof c->model_path, "%s", v);
    else {
        exe_file("r2d-help.gguf", c->model_path, sizeof c->model_path);
        if (!sdk_file_exists(c->model_path)) c->model_path[0] = '\0';
    }

    if (!find_root(c, c->root, sizeof c->root)) c->root[0] = '\0';

    v = sdk_arg_value(&c->args, "--threads");
    c->threads = v ? atoi(v) : 0;
    c->text = sdk_arg_flag(&c->args, "--text");
}

static bool model_usable(const Ctx *c)
{
    return c->model_path[0] && help_embed_available() && sdk_file_exists(c->model_path);
}

// ---------------------------------------------------------------------------
// Сборка индекса: неизменённые тексты берут вектор из прошлого индекса
// ---------------------------------------------------------------------------
typedef struct VecMap {
    uint64_t *keys;
    int      *vals;
    int       cap;
} VecMap;

static void vmap_build(VecMap *m, const HelpIndex *old)
{
    m->cap = 1;
    while (m->cap < old->count * 2 + 16) m->cap <<= 1;
    m->keys = (uint64_t *)calloc((size_t)m->cap, sizeof *m->keys);
    m->vals = (int *)malloc((size_t)m->cap * sizeof *m->vals);
    if (!m->keys || !m->vals) { m->cap = 0; return; }
    for (int i = 0; i < old->count; ++i) {
        if (!old->items[i].vec) continue;
        const uint64_t k = old->items[i].text_hash | 1u;   // 0 — пустая ячейка
        int s = (int)(k & (uint64_t)(m->cap - 1));
        while (m->keys[s] && m->keys[s] != k) s = (s + 1) & (m->cap - 1);
        m->keys[s] = k;
        m->vals[s] = i;
    }
}

static int vmap_get(const VecMap *m, uint64_t hash)
{
    if (m->cap == 0) return -1;
    const uint64_t k = hash | 1u;
    int s = (int)(k & (uint64_t)(m->cap - 1));
    while (m->keys[s]) {
        if (m->keys[s] == k) return m->vals[s];
        s = (s + 1) & (m->cap - 1);
    }
    return -1;
}

static void vmap_free(VecMap *m)
{
    free(m->keys);
    free(m->vals);
    memset(m, 0, sizeof *m);
}

static bool build_index(Ctx *c, const HelpIndex *old, HelpIndex *out, UpdateInfo *info)
{
    help_index_init(out);
    if (!help_collect(c->root, out, &c->rep)) return false;
    out->sources_hash = help_sources_hash(c->root);

    if (!model_usable(c)) {
        if (c->model_path[0] && !help_embed_available()) {
            sdk_diag(&c->rep, SDK_INFO, "HELP_NO_LLAMA", NULL, NULL, NULL,
                     "собран без llama.cpp: индекс только для BM25");
        }
        return true;
    }

    char model_id[128];
    if (!help_model_id(c->model_path, model_id, sizeof model_id)) {
        sdk_diag(&c->rep, SDK_WARNING, "HELP_MODEL_READ", c->model_path, NULL, NULL, "файл модели не прочитан");
        return true;
    }
    char err[512] = "";
    // Сборка индекса — разовая работа: потоков столько, сколько дадут.
    const int threads = c->threads > 0 ? c->threads : SDL_GetNumLogicalCPUCores();
    HelpEmbedder *e = help_embed_open(c->model_path, threads, err, sizeof err);
    if (!e) {
        sdk_diag(&c->rep, SDK_WARNING, "HELP_MODEL_OPEN", c->model_path, NULL, NULL, "%s", err);
        return true;
    }
    const int dim = help_embed_dim(e);
    snprintf(out->model_id, sizeof out->model_id, "%s", model_id);
    out->dim = dim;

    VecMap map = {0};
    const bool same_model = old && old->dim == dim && strcmp(old->model_id, model_id) == 0;
    if (same_model) vmap_build(&map, old);

    float *v = (float *)malloc((size_t)dim * sizeof *v);
    int failed = 0;
    for (int i = 0; v && i < out->count; ++i) {
        HelpEntry *en = &out->items[i];
        en->vec = (int8_t *)malloc((size_t)dim);
        if (!en->vec) break;
        const int j = same_model ? vmap_get(&map, en->text_hash) : -1;
        if (j >= 0) {
            memcpy(en->vec, old->items[j].vec, (size_t)dim);
            en->vec_scale = old->items[j].vec_scale;
            info->reused++;
            continue;
        }
        if (!help_embed_text(e, en->text, false, v)) {
            free(en->vec);
            en->vec = NULL;
            failed++;
            continue;
        }
        help_quantize(v, dim, en->vec, &en->vec_scale);
        info->embedded++;
        if (info->embedded % 200 == 0) {
            fprintf(stderr, "r2d-help: эмбеддинги %d/%d\n", i + 1, out->count);
        }
    }
    free(v);
    vmap_free(&map);
    help_embed_close(e);
    if (failed > 0) {
        sdk_diag(&c->rep, SDK_WARNING, "HELP_EMBED_FAILED", NULL, NULL, NULL,
                 "%d записей без вектора: они ищутся только BM25", failed);
    }
    return true;
}

// Загружает индекс и, если есть исходники и они изменились, пересобирает его.
static bool load_fresh(Ctx *c, HelpIndex *ix, UpdateInfo *info, bool force)
{
    memset(info, 0, sizeof *info);
    const bool have = help_index_load(ix, c->index_path);
    if (!have && sdk_file_exists(c->index_path)) {
        sdk_diag(&c->rep, SDK_WARNING, "HELP_INDEX_FORMAT", c->index_path, NULL, NULL,
                 "индекс другого формата или повреждён — будет пересобран");
    }
    if (!c->root[0]) return have;   // поставленный пакет: индекс как есть
    if (!force && sdk_arg_flag(&c->args, "--no-update")) return have;

    info->checked = true;
    bool stale = !have || ix->sources_hash != help_sources_hash(c->root);
    if (!stale && model_usable(c)) {
        char id[128];
        if (help_model_id(c->model_path, id, sizeof id) && strcmp(id, ix->model_id) != 0) stale = true;
    }
    info->stale = stale;
    if (!stale && !force) return have;

    HelpIndex fresh;
    if (!build_index(c, have ? ix : NULL, &fresh, info)) {
        help_index_free(&fresh);
        return have;
    }
    help_index_free(ix);
    *ix = fresh;
    info->updated = true;
    if (!help_index_save(ix, c->index_path)) {
        sdk_diag(&c->rep, SDK_WARNING, "HELP_INDEX_WRITE", c->index_path, NULL, NULL,
                 "индекс не записан: используется собранный в памяти");
    }
    return true;
}

// ---------------------------------------------------------------------------
// Вывод
// ---------------------------------------------------------------------------
static void put_index_info(const Ctx *c, const HelpIndex *ix, const UpdateInfo *u, R2dSb *o)
{
    int api = 0, docs = 0, vec = 0;
    for (int i = 0; i < ix->count; ++i) {
        if (ix->items[i].kind == HELP_KIND_DOC) docs++; else api++;
        if (ix->items[i].vec) vec++;
    }
    r2d_sb_puts(o, "\"index\":{");
    sdk_put_kv_str(o, "path", c->index_path);
    r2d_sb_printf(o, ",\"entries\":%d,\"api\":%d,\"docs\":%d,\"dim\":%d,\"vectors\":%d,",
                  ix->count, api, docs, ix->dim, vec);
    sdk_put_kv_str(o, "model", ix->model_id[0] ? ix->model_id : NULL);
    r2d_sb_putc(o, ',');
    sdk_put_kv_str(o, "root", c->root[0] ? c->root : NULL);
    r2d_sb_printf(o, ",\"checked\":%s,\"stale\":%s,\"updated\":%s,\"embedded\":%d,\"reused\":%d}",
                  u->checked ? "true" : "false", u->stale ? "true" : "false",
                  u->updated ? "true" : "false", u->embedded, u->reused);
}

// Первые строки описания без заголовка записи, в одну строку.
static void snippet(const char *text, char *out, size_t cap)
{
    const char *p = strchr(text, '\n');
    p = p ? p + 1 : text;
    size_t n = 0;
    bool space = false;
    while (*p && n + 4 < cap) {
        const unsigned char ch = (unsigned char)*p++;
        if (ch == '\n' || ch == '\t' || ch == '\r' || ch == ' ') {
            if (!space && n > 0) { out[n++] = ' '; space = true; }
            continue;
        }
        space = false;
        out[n++] = (char)ch;
    }
    // Не резать UTF-8 посередине символа.
    while (n > 0 && ((unsigned char)out[n - 1] & 0xC0) == 0x80) {
        size_t k = n - 1;
        while (k > 0 && ((unsigned char)out[k] & 0xC0) == 0x80) --k;
        const unsigned char lead = (unsigned char)out[k];
        const size_t need = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1;
        if (n - k >= need) break;
        n = k;
    }
    out[n] = '\0';
}

static void put_entry(const HelpEntry *e, R2dSb *o, bool full)
{
    r2d_sb_putc(o, '{');
    sdk_put_kv_str(o, "kind", help_kind_name(e->kind));
    r2d_sb_putc(o, ',');
    sdk_put_kv_str(o, "name", e->name);
    r2d_sb_putc(o, ',');
    sdk_put_kv_str(o, "signature", e->signature[0] ? e->signature : NULL);
    r2d_sb_putc(o, ',');
    sdk_put_kv_str(o, "module", e->module);
    r2d_sb_putc(o, ',');
    sdk_put_kv_str(o, "location", e->location);
    r2d_sb_putc(o, ',');
    sdk_put_kv_str(o, "doc", e->doc[0] ? e->doc : NULL);
    r2d_sb_putc(o, ',');
    if (full) {
        sdk_put_kv_str(o, "text", e->text);
    } else {
        char sn[320];
        snippet(e->text, sn, sizeof sn);
        sdk_put_kv_str(o, "snippet", sn);
    }
}

static int finish(Ctx *c, R2dSb *o, bool ok)
{
    r2d_sb_putc(o, ',');
    sdk_report_put_counts(&c->rep, o);
    r2d_sb_putc(o, ',');
    sdk_report_put(&c->rep, o);
    r2d_sb_putc(o, '}');
    puts(o->data);
    r2d_sb_free(o);
    return ok ? (c->rep.errors > 0 ? 1 : 0) : 1;
}

// ---------------------------------------------------------------------------
// Команды
// ---------------------------------------------------------------------------
static bool is_command(const char *s)
{
    return strcmp(s, "search") == 0 || strcmp(s, "show") == 0 || strcmp(s, "index") == 0 ||
           strcmp(s, "status") == 0 || strcmp(s, "version") == 0 || strcmp(s, "help") == 0;
}

static int cmd_search(Ctx *c, int first_word)
{
    // Запрос — все позиционные слова (кавычки не обязательны).
    R2dSb q;
    r2d_sb_init(&q);
    for (int i = first_word;; ++i) {
        const char *w = sdk_arg_positional(&c->args, i);
        if (!w) break;
        if (q.len) r2d_sb_putc(&q, ' ');
        r2d_sb_puts(&q, w);
    }
    if (q.len == 0) {
        r2d_sb_free(&q);
        return sdk_fail(&c->rep, "HELP_USAGE", "нужен запрос: r2d-help \"как сделать патруль врага\"");
    }
    const char *topv = sdk_arg_value(&c->args, "--top");
    int top = topv ? atoi(topv) : DEFAULT_TOP;
    if (top < 1) top = 1;
    if (top > MAX_TOP) top = MAX_TOP;

    HelpIndex ix;
    UpdateInfo u;
    if (!load_fresh(c, &ix, &u, false) || ix.count == 0) {
        r2d_sb_free(&q);
        help_index_free(&ix);
        return sdk_fail(&c->rep, "HELP_INDEX_MISSING",
                        "нет индекса %s и нет исходников для сборки (--root <репозиторий> или --index)",
                        c->index_path);
    }

    // Вектор запроса: только той же моделью, что считала индекс.
    float *qvec = NULL;
    const char *mode = "bm25";
    if (ix.dim > 0 && model_usable(c)) {
        char id[128];
        if (help_model_id(c->model_path, id, sizeof id) && strcmp(id, ix.model_id) == 0) {
            char err[512];
            // Один поток: короткий запрос, а результат воспроизводим.
            HelpEmbedder *e = help_embed_open(c->model_path, c->threads > 0 ? c->threads : 1, err, sizeof err);
            if (e) {
                qvec = (float *)malloc((size_t)ix.dim * sizeof *qvec);
                if (qvec && help_embed_text(e, q.data, true, qvec)) mode = "hybrid";
                else { free(qvec); qvec = NULL; }
                help_embed_close(e);
            } else {
                sdk_diag(&c->rep, SDK_WARNING, "HELP_MODEL_OPEN", c->model_path, NULL, NULL, "%s", err);
            }
        } else {
            sdk_diag(&c->rep, SDK_WARNING, "HELP_MODEL_MISMATCH", c->model_path, NULL, NULL,
                     "индекс посчитан другой моделью (%s): поиск только BM25", ix.model_id);
        }
    } else if (ix.dim > 0) {
        sdk_diag(&c->rep, SDK_INFO, "HELP_MODEL_MISSING", NULL, NULL, NULL,
                 "модели нет рядом с r2d-help (r2d-help.gguf) или --model: поиск только BM25");
    }

    HelpHit hits[MAX_TOP];
    const int n = help_search(&ix, q.data, qvec, hits, top);
    free(qvec);

    if (c->text) {
        printf("%s · %s · %d записей\n\n", q.data, mode, ix.count);
        for (int i = 0; i < n; ++i) {
            const HelpEntry *e = &ix.items[hits[i].entry];
            char sn[240];
            snippet(e->text, sn, sizeof sn);
            printf("%2d. %s\n    %s\n", i + 1, e->signature[0] ? e->signature : e->name, e->location);
            if (sn[0]) printf("    %s\n", sn);
            if (e->doc[0] && e->kind != HELP_KIND_DOC) printf("    → %s\n", e->doc);
            printf("\n");
        }
        if (n == 0) printf("ничего не найдено\n");
        for (int i = 0; i < c->rep.count; ++i) (void)0;
        help_index_free(&ix);
        r2d_sb_free(&q);
        const int code = c->rep.errors > 0 ? 1 : 0;
        sdk_report_free(&c->rep);
        return code;
    }

    R2dSb o;
    r2d_sb_init(&o);
    r2d_sb_puts(&o, "{\"ok\":true,");
    sdk_put_kv_str(&o, "query", q.data);
    r2d_sb_putc(&o, ',');
    sdk_put_kv_str(&o, "mode", mode);
    r2d_sb_putc(&o, ',');
    put_index_info(c, &ix, &u, &o);
    r2d_sb_puts(&o, ",\"results\":[");
    for (int i = 0; i < n; ++i) {
        if (i) r2d_sb_putc(&o, ',');
        put_entry(&ix.items[hits[i].entry], &o, false);
        r2d_sb_printf(&o, ",\"rank\":%d,\"score\":%.6f,\"bm25\":%.4f", i + 1, hits[i].score, hits[i].bm25);
        if (hits[i].cosine > -2.0) r2d_sb_printf(&o, ",\"cosine\":%.4f", hits[i].cosine);
        r2d_sb_putc(&o, '}');
    }
    r2d_sb_putc(&o, ']');
    help_index_free(&ix);
    r2d_sb_free(&q);
    const int code = finish(c, &o, true);
    sdk_report_free(&c->rep);
    return code;
}

// «.navigateTo», «navigateTo», «$.nav.find», «nav.find» — одно и то же имя.
static bool name_matches(const char *entry, const char *want)
{
    const char *a = entry, *b = want;
    if (a[0] == '$' && a[1] == '.') a += 2;
    if (b[0] == '$' && b[1] == '.') b += 2;
    if (*a == '.') ++a;
    if (*b == '.') ++b;
    size_t nb = strlen(b);
    if (nb > 2 && strcmp(b + nb - 2, "()") == 0) nb -= 2;
    return strlen(a) == nb && SDL_strncasecmp(a, b, nb) == 0;
}

static int cmd_show(Ctx *c)
{
    const char *want = sdk_arg_positional(&c->args, 1);
    if (!want) return sdk_fail(&c->rep, "HELP_USAGE", "нужно имя: r2d-help show navigateTo");
    HelpIndex ix;
    UpdateInfo u;
    if (!load_fresh(c, &ix, &u, false) || ix.count == 0) {
        help_index_free(&ix);
        return sdk_fail(&c->rep, "HELP_INDEX_MISSING", "нет индекса %s", c->index_path);
    }
    // Само объявление и разделы документации, где имя встречается в тексте.
    const char *bare = strrchr(want, '.');
    bare = bare ? bare + 1 : want;
    int api = 0, docs = 0;
    R2dSb o;
    r2d_sb_init(&o);
    r2d_sb_puts(&o, "{\"ok\":true,");
    sdk_put_kv_str(&o, "name", want);
    r2d_sb_puts(&o, ",\"entries\":[");
    for (int i = 0; i < ix.count; ++i) {
        const HelpEntry *e = &ix.items[i];
        if (e->kind == HELP_KIND_DOC || !name_matches(e->name, want)) continue;
        if (api + docs) r2d_sb_putc(&o, ',');
        put_entry(e, &o, true);
        r2d_sb_putc(&o, '}');
        api++;
    }
    for (int i = 0; i < ix.count && docs < 6 && strlen(bare) >= 3; ++i) {
        const HelpEntry *e = &ix.items[i];
        if (e->kind != HELP_KIND_DOC || !strstr(e->text, bare)) continue;
        if (api + docs) r2d_sb_putc(&o, ',');
        put_entry(e, &o, true);
        r2d_sb_putc(&o, '}');
        docs++;
    }
    r2d_sb_putc(&o, ']');
    if (api == 0) {
        sdk_diag(&c->rep, SDK_INFO, "HELP_NOT_FOUND", want, NULL, NULL,
                 "в реестре API нет такого имени: попробуйте r2d-help search");
    }
    help_index_free(&ix);
    const int code = finish(c, &o, true);
    sdk_report_free(&c->rep);
    return code;
}

static int cmd_index(Ctx *c)
{
    if (!c->root[0]) {
        return sdk_fail(&c->rep, "HELP_ROOT", "нет исходников: укажите --root <репозиторий движка>");
    }
    const char *out = sdk_arg_value(&c->args, "--out");
    if (out) snprintf(c->index_path, sizeof c->index_path, "%s", out);
    HelpIndex ix;
    UpdateInfo u;
    const bool ok = load_fresh(c, &ix, &u, sdk_arg_flag(&c->args, "--force"));
    R2dSb o;
    r2d_sb_init(&o);
    r2d_sb_printf(&o, "{\"ok\":%s,", ok ? "true" : "false");
    put_index_info(c, &ix, &u, &o);
    help_index_free(&ix);
    const int code = finish(c, &o, ok);
    sdk_report_free(&c->rep);
    return code;
}

static int cmd_status(Ctx *c)
{
    HelpIndex ix;
    const bool have = help_index_load(&ix, c->index_path);
    UpdateInfo u;
    memset(&u, 0, sizeof u);
    if (have && c->root[0]) {
        u.checked = true;
        u.stale = ix.sources_hash != help_sources_hash(c->root);
    }
    R2dSb o;
    r2d_sb_init(&o);
    r2d_sb_printf(&o, "{\"ok\":true,\"version\":\"%s\",\"llama\":%s,", HELP_VERSION,
                  help_embed_available() ? "true" : "false");
    sdk_put_kv_str(&o, "model", c->model_path[0] ? c->model_path : NULL);
    r2d_sb_printf(&o, ",\"indexPresent\":%s,", have ? "true" : "false");
    put_index_info(c, &ix, &u, &o);
    help_index_free(&ix);
    const int code = finish(c, &o, true);
    sdk_report_free(&c->rep);
    return code;
}

static int usage(Ctx *c)
{
    return sdk_fail(&c->rep, "HELP_USAGE",
                    "r2d-help <запрос> | search <запрос> [--top N] [--text] | show <имя> | "
                    "index [--root dir] [--force] | status | version");
}

int main(int argc, char **argv)
{
    Ctx c;
    memset(&c, 0, sizeof c);
    sdk_report_init(&c.rep);
    c.args.argc = argc - 1;
    c.args.argv = (const char **)(argv + 1);
    resolve_paths(&c);

    const char *cmd = sdk_arg_positional(&c.args, 0);
    if (!cmd || strcmp(cmd, "help") == 0) return usage(&c);
    if (strcmp(cmd, "version") == 0) {
        printf("{\"ok\":true,\"name\":\"r2d-help\",\"version\":\"%s\",\"llama\":%s}\n", HELP_VERSION,
               help_embed_available() ? "true" : "false");
        sdk_report_free(&c.rep);
        return 0;
    }
    if (strcmp(cmd, "search") == 0) return cmd_search(&c, 1);
    if (strcmp(cmd, "show") == 0) return cmd_show(&c);
    if (strcmp(cmd, "index") == 0) return cmd_index(&c);
    if (strcmp(cmd, "status") == 0) return cmd_status(&c);
    if (!is_command(cmd)) return cmd_search(&c, 0);   // r2d-help как сделать патруль
    return usage(&c);
}
