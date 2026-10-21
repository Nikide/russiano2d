// ===========================================================================
// `r2d snippet` — система сниппетов (docs/SNIPPETS.md,
// docs/SNIPPET_SYSTEM_PROJECT.md §5, §10, §14, §15).
//
// Один backend для Editor (панель «Кирпичики»), CLI и агента:
//   catalog   — встроенные (snippets/ рядом с r2d) и проектные (<проект>/snippets/) пакеты;
//   validate  — manifest пакета (format "r2d-snippet/1");
//   check     — editor.snippets в project.json (то же делает r2d validate);
//   add/set/remove — правка editor.snippets атомарной записью project.json;
//   generate  — детерминированный обычный JS в generated/snippets/.
//
// Runtime manifest не читает: результат — обычные JS-модули и вызовы $ API.
// Коды SNIP*: диапазоны из §15.3. Диагностика — только факты.
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SNIP_FORMAT "r2d-snippet/1"
#define SNIP_HEADER "// r2d-snippets: generated"

// ---------------------------------------------------------------------------
// Мелочи
// ---------------------------------------------------------------------------
static bool snip_id_ok(const char *s)
{
    // a-z0-9_- сегменты через точку: movement.top-down, weapon.base (ID раздела 12 ТЗ)
    if (!s || !s[0] || s[0] == '.') return false;
    char prev = '.';
    for (const char *p = s; *p; ++p) {
        const char c = *p;
        const bool word = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
        if (c == '.') { if (prev == '.' || prev == '-') return false; }
        else if (!word) return false;
        prev = c;
    }
    return prev != '.';
}

static bool snip_key_ok(const char *s)
{
    // id полей и экземпляров: латиница, цифры, _ - : .
    if (!s || !s[0]) return false;
    for (const char *p = s; *p; ++p) {
        const char c = *p;
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '_' || c == '-' || c == ':' || c == '.')) return false;
    }
    return true;
}

static bool semver_ok(const char *s)
{
    int parts = 0;
    const char *p = s;
    if (!p || !*p) return false;
    while (*p) {
        if (*p < '0' || *p > '9') return false;
        while (*p >= '0' && *p <= '9') p++;
        parts++;
        if (*p == '.') { p++; if (!*p) return false; }
        else if (*p == '-' || *p == '+') break;   // пре-релиз/сборка не разбираем
        else if (*p) return false;
    }
    return parts == 3;
}

static bool rel_path_ok(const char *p)
{
    return p && sdk_deps_path_ok(p);
}

static const char *jstr(const R2dJson *o, const char *k)
{
    const R2dJson *v = r2d_json_get(o, k);
    return v && v->type == R2D_JSON_STR ? v->string : NULL;
}

// Подпись: строка или {"ru": "…"} (русская, иначе первая).
static const char *loc_text(const R2dJson *v)
{
    if (!v) return NULL;
    if (v->type == R2D_JSON_STR) return v->string;
    if (v->type == R2D_JSON_OBJ) {
        const char *ru = jstr(v, "ru");
        if (ru) return ru;
        for (int i = 0; i < v->count; ++i)
            if (v->items[i]->type == R2D_JSON_STR) return v->items[i]->string;
    }
    return NULL;
}

static void put_loc(R2dSb *sb, const char *key, const char *value)
{
    char k[128];
    snprintf(k, sizeof k, "%s", key);
    sdk_put_kv_str(sb, k, value ? value : "");
}

static void fmt_loc(char *out, size_t cap, const char *pkg, const char *field)
{
    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_putc(&sb, '{');
    bool any = false;
    if (pkg) { sdk_put_kv_str(&sb, "package", pkg); any = true; }
    if (field) { if (any) r2d_sb_putc(&sb, ','); sdk_put_kv_str(&sb, "field", field); }
    r2d_sb_putc(&sb, '}');
    snprintf(out, cap, "%s", sb.data ? sb.data : "{}");
    r2d_sb_free(&sb);
}

static void diag(SdkReport *rep, SdkSeverity sev, const char *code, const char *asset,
                 const char *pkg, const char *field, const char *fmt, ...)
{
    char loc[1024];
    fmt_loc(loc, sizeof loc, pkg, field);
    va_list ap;
    va_start(ap, fmt);
    sdk_diagv(rep, sev, code, asset ? asset : "", loc, NULL, fmt, ap);
    va_end(ap);
}

static char *hex64(uint64_t h, char out[17])
{
    snprintf(out, 17, "%016llx", (unsigned long long)h);
    return out;
}

// ---------------------------------------------------------------------------
// Пакеты и каталог
// ---------------------------------------------------------------------------
typedef struct SnipPkg {
    char  id[96];
    char  version[32];
    char  kind[16];          // behavior | kit
    char  scope[12];         // builtin | project
    char  dir[1200];         // абсолютный или как найден
    char  manifest_path[1400];
    char  hash[17];          // FNV-1a 64 файла manifest
    bool  valid;
    bool  shadows;           // проектный пакет закрывает встроенный с тем же id
    R2dJson *m;
} SnipPkg;

typedef struct SnipCatalog {
    SnipPkg *items;
    int count, cap;
    char builtin_root[1200];
    char project_root[1200];
} SnipCatalog;

static const char *const k_field_types[] = {
    "number", "int", "bool", "string", "enum", "color", "vec2", "asset", "entity", "list", NULL
};
static const char *const k_asset_kinds[] = { "image", "audio", "animation", "data", "rml", NULL };

static bool in_list(const char *const *list, const char *s)
{
    for (int i = 0; s && list[i]; ++i) if (!strcmp(list[i], s)) return true;
    return false;
}

static const R2dJson *pkg_field(const SnipPkg *p, const char *id)
{
    const R2dJson *fields = r2d_json_get(p->m, "fields");
    for (int i = 0; i < r2d_json_size(fields); ++i) {
        const R2dJson *f = r2d_json_at(fields, i);
        const char *fid = jstr(f, "id");
        if (fid && !strcmp(fid, id)) return f;
    }
    return NULL;
}

// Проверка значения поля: общая для default в manifest и значений экземпляра.
// Возвращает false и пишет причину в why.
static bool value_ok(const R2dJson *f, const R2dJson *v, char *why, size_t cap)
{
    const char *type = jstr(f, "type");
    if (!type) { snprintf(why, cap, "у поля нет type"); return false; }
    if (!strcmp(type, "number") || !strcmp(type, "int")) {
        if (!v || v->type != R2D_JSON_NUM) { snprintf(why, cap, "ожидалось число"); return false; }
        if (!strcmp(type, "int") && v->number != floor(v->number)) { snprintf(why, cap, "ожидалось целое"); return false; }
        const R2dJson *mn = r2d_json_get(f, "min"), *mx = r2d_json_get(f, "max");
        if (mn && mn->type == R2D_JSON_NUM && v->number < mn->number) { snprintf(why, cap, "меньше min %g", mn->number); return false; }
        if (mx && mx->type == R2D_JSON_NUM && v->number > mx->number) { snprintf(why, cap, "больше max %g", mx->number); return false; }
        return true;
    }
    if (!strcmp(type, "bool")) {
        if (!v || v->type != R2D_JSON_BOOL) { snprintf(why, cap, "ожидалось true/false"); return false; }
        return true;
    }
    if (!strcmp(type, "string") || !strcmp(type, "asset") || !strcmp(type, "entity")) {
        if (!v || v->type != R2D_JSON_STR) { snprintf(why, cap, "ожидалась строка"); return false; }
        return true;
    }
    if (!strcmp(type, "enum")) {
        if (!v || v->type != R2D_JSON_STR) { snprintf(why, cap, "ожидалась строка из options"); return false; }
        const R2dJson *opts = r2d_json_get(f, "options");
        for (int i = 0; i < r2d_json_size(opts); ++i) {
            const R2dJson *o = r2d_json_at(opts, i);
            const char *ov = o && o->type == R2D_JSON_STR ? o->string : jstr(o, "value");
            if (ov && !strcmp(ov, v->string)) return true;
        }
        snprintf(why, cap, "«%s» нет в options", v->string);
        return false;
    }
    if (!strcmp(type, "color")) {
        if (!v || v->type != R2D_JSON_STR || v->string[0] != '#') { snprintf(why, cap, "ожидался цвет #rrggbb"); return false; }
        const size_t n = strlen(v->string);
        if (n != 7 && n != 9) { snprintf(why, cap, "ожидался цвет #rrggbb или #rrggbbaa"); return false; }
        for (size_t i = 1; i < n; ++i) {
            const char c = v->string[i];
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
                snprintf(why, cap, "неверный цвет"); return false;
            }
        }
        return true;
    }
    if (!strcmp(type, "vec2")) {
        if (!v || v->type != R2D_JSON_ARR || v->count != 2 ||
            v->items[0]->type != R2D_JSON_NUM || v->items[1]->type != R2D_JSON_NUM) {
            snprintf(why, cap, "ожидался [x, y]"); return false;
        }
        return true;
    }
    if (!strcmp(type, "list")) {
        if (!v || v->type != R2D_JSON_ARR) { snprintf(why, cap, "ожидался массив"); return false; }
        for (int i = 0; i < v->count; ++i)
            if (v->items[i]->type != R2D_JSON_STR) { snprintf(why, cap, "элементы списка — строки"); return false; }
        return true;
    }
    snprintf(why, cap, "неизвестный тип «%s»", type);
    return false;
}

static const char *asset_kind_of(const char *path)
{
    const char *dot = strrchr(path, '.');
    if (!dot) return "";
    char ext[16];
    snprintf(ext, sizeof ext, "%s", dot + 1);
    for (char *p = ext; *p; ++p) if (*p >= 'A' && *p <= 'Z') *p = (char)(*p - 'A' + 'a');
    if (sdk_ends_with(path, ".atlas.json") || sdk_ends_with(path, ".anim.json")) return "animation";
    if (!strcmp(ext, "png") || !strcmp(ext, "jpg") || !strcmp(ext, "jpeg") || !strcmp(ext, "bmp") ||
        !strcmp(ext, "webp") || !strcmp(ext, "gif") || !strcmp(ext, "qoi")) return "image";
    if (!strcmp(ext, "wav") || !strcmp(ext, "ogg") || !strcmp(ext, "mp3") || !strcmp(ext, "flac")) return "audio";
    if (!strcmp(ext, "rml")) return "rml";
    if (!strcmp(ext, "json") || !strcmp(ext, "csv") || !strcmp(ext, "txt")) return "data";
    return "";
}

// Проверка manifest пакета. dir — каталог пакета (имя каталога = id).
static void validate_manifest(SnipPkg *p, SdkReport *rep, bool check_dirname)
{
    const char *mp = p->manifest_path;
    const R2dJson *m = p->m;
    const int errors0 = rep->errors;
    if (!m || m->type != R2D_JSON_OBJ) {
        diag(rep, SDK_ERROR, "SNIP001", mp, NULL, NULL, "manifest должен быть JSON-объектом");
        p->valid = false;
        return;
    }
    const char *format = jstr(m, "format");
    if (!format || strcmp(format, SNIP_FORMAT))
        diag(rep, SDK_ERROR, "SNIP002", mp, NULL, "format", "format: ожидалось \"%s\"", SNIP_FORMAT);
    const char *id = jstr(m, "id");
    if (!snip_id_ok(id)) diag(rep, SDK_ERROR, "SNIP003", mp, NULL, "id", "id: сегменты a-z0-9_- через точку");
    snprintf(p->id, sizeof p->id, "%s", id ? id : "");
    const char *ver = jstr(m, "version");
    if (!semver_ok(ver)) diag(rep, SDK_ERROR, "SNIP004", mp, p->id, "version", "version: ожидался semver x.y.z");
    snprintf(p->version, sizeof p->version, "%s", ver ? ver : "");
    if (!loc_text(r2d_json_get(m, "title")))
        diag(rep, SDK_ERROR, "SNIP005", mp, p->id, "title", "title: нужна подпись (строка или {\"ru\": …})");
    if (!jstr(m, "category"))
        diag(rep, SDK_ERROR, "SNIP005", mp, p->id, "category", "category: нужна строка");
    const char *kind = jstr(m, "kind");
    if (!kind || (strcmp(kind, "behavior") && strcmp(kind, "kit")))
        diag(rep, SDK_ERROR, "SNIP006", mp, p->id, "kind", "kind: behavior | kit");
    snprintf(p->kind, sizeof p->kind, "%s", kind ? kind : "");
    if (check_dirname && id && strcmp(sdk_basename(p->dir), id))
        diag(rep, SDK_ERROR, "SNIP011", mp, p->id, "id", "каталог пакета «%s» не совпадает с id «%s»",
             sdk_basename(p->dir), id);

    // Источник поведения: обычный JS-файл пакета. Kit — только состав.
    const char *src = jstr(m, "source");
    if (kind && !strcmp(kind, "behavior")) {
        if (!rel_path_ok(src)) {
            diag(rep, SDK_ERROR, "SNIP007", mp, p->id, "source", "source: нужен относительный путь внутри пакета");
        } else {
            char full[2048];
            sdk_join(p->dir, src, full, sizeof full);
            char *text = sdk_read_file(full, NULL);
            if (!text) {
                diag(rep, SDK_ERROR, "SNIP007", mp, p->id, "source", "source «%s» не найден", src);
            } else {
                if (!strstr(text, "export default"))
                    diag(rep, SDK_ERROR, "SNIP007", mp, p->id, "source", "%s: нужен export default function (node, config, $)", src);
                if (strstr(text, "engine."))
                    diag(rep, SDK_ERROR, "SNIP101", mp, p->id, "source", "%s: пакет обращается к engine.* — разрешён только $ API", src);
                if (strstr(text, "from '.") || strstr(text, "from \".") || strstr(text, "import('"))
                    diag(rep, SDK_ERROR, "SNIP102", mp, p->id, "source", "%s: пакет — один файл без относительных import", src);
                free(text);
            }
        }
    } else if (src) {
        diag(rep, SDK_ERROR, "SNIP007", mp, p->id, "source", "kit не имеет source: его поведение — состав зависимостей");
    }

    // targets / slots
    const R2dJson *targets = r2d_json_get(m, "targets");
    if (targets && targets->type != R2D_JSON_ARR)
        diag(rep, SDK_ERROR, "SNIP060", mp, p->id, "targets", "targets: массив строк (node)");
    for (int i = 0; i < r2d_json_size(targets); ++i) {
        const R2dJson *t = r2d_json_at(targets, i);
        if (!t || t->type != R2D_JSON_STR || (strcmp(t->string, "node") && strcmp(t->string, "project")))
            diag(rep, SDK_ERROR, "SNIP060", mp, p->id, "targets", "targets: node | project");
    }
    const R2dJson *slots = r2d_json_get(m, "slots");
    for (int i = 0; i < r2d_json_size(slots); ++i) {
        const R2dJson *s = r2d_json_at(slots, i);
        if (!snip_key_ok(jstr(s, "id")))
            diag(rep, SDK_ERROR, "SNIP063", mp, p->id, "slots", "slots[%d]: нужен id", i);
        const R2dJson *cap = r2d_json_get(s, "capacity");
        if (cap && (cap->type != R2D_JSON_NUM || cap->number < 1 || cap->number != floor(cap->number)))
            diag(rep, SDK_ERROR, "SNIP063", mp, p->id, "slots", "slots[%d].capacity: целое ≥ 1", i);
    }

    // Зависимости: id пакетов (проверка существования — на уровне каталога).
    const R2dJson *deps = r2d_json_get(m, "dependencies");
    if (deps && deps->type != R2D_JSON_ARR)
        diag(rep, SDK_ERROR, "SNIP080", mp, p->id, "dependencies", "dependencies: массив");
    for (int i = 0; i < r2d_json_size(deps); ++i) {
        const R2dJson *d = r2d_json_at(deps, i);
        const char *did = d && d->type == R2D_JSON_STR ? d->string : jstr(d, "id");
        if (!snip_id_ok(did))
            diag(rep, SDK_ERROR, "SNIP080", mp, p->id, "dependencies", "dependencies[%d]: нужен id пакета", i);
        else if (id && !strcmp(did, id))
            diag(rep, SDK_ERROR, "SNIP081", mp, p->id, "dependencies", "пакет зависит сам от себя");
    }
    if (kind && !strcmp(kind, "kit") && r2d_json_size(deps) == 0)
        diag(rep, SDK_ERROR, "SNIP080", mp, p->id, "dependencies", "kit без состава — пустая заглушка");

    // Требования к $ API: формат; разрешение по api.schema.json — resolve_api().
    const R2dJson *req = r2d_json_get(m, "requires");
    for (int i = 0; i < r2d_json_size(req); ++i) {
        const R2dJson *r = r2d_json_at(req, i);
        const char *api = r && r->type == R2D_JSON_STR ? r->string : jstr(r, "api");
        if (!api || strncmp(api, "$.", 2))
            diag(rep, SDK_ERROR, "SNIP100", mp, p->id, "requires", "requires[%d]: ожидался путь $ API ($.input, $.fn.velocity)", i);
    }

    // Поля Inspector.
    const R2dJson *fields = r2d_json_get(m, "fields");
    if (fields && fields->type != R2D_JSON_ARR)
        diag(rep, SDK_ERROR, "SNIP020", mp, p->id, "fields", "fields: массив");
    for (int i = 0; i < r2d_json_size(fields); ++i) {
        const R2dJson *f = r2d_json_at(fields, i);
        const char *fid = jstr(f, "id");
        if (!snip_key_ok(fid)) { diag(rep, SDK_ERROR, "SNIP020", mp, p->id, "fields", "fields[%d]: нужен id", i); continue; }
        // Свойства экземпляра в r2d snippet set — не поля Inspector.
        if (!strcmp(fid, "slot") || !strcmp(fid, "disabled") || !strcmp(fid, "links"))
            diag(rep, SDK_ERROR, "SNIP020", mp, p->id, fid, "id поля «%s» зарезервирован свойством экземпляра", fid);
        for (int k = 0; k < i; ++k) {
            const char *other = jstr(r2d_json_at(fields, k), "id");
            if (other && !strcmp(other, fid)) diag(rep, SDK_ERROR, "SNIP020", mp, p->id, fid, "повтор id поля «%s»", fid);
        }
        const char *type = jstr(f, "type");
        if (!in_list(k_field_types, type)) {
            diag(rep, SDK_ERROR, "SNIP021", mp, p->id, fid, "%s: тип «%s» не из %s", fid, type ? type : "?",
                 "number|int|bool|string|enum|color|vec2|asset|entity|list");
            continue;
        }
        const R2dJson *mn = r2d_json_get(f, "min"), *mx = r2d_json_get(f, "max");
        if (mn && mx && mn->type == R2D_JSON_NUM && mx->type == R2D_JSON_NUM && mn->number > mx->number)
            diag(rep, SDK_ERROR, "SNIP023", mp, p->id, fid, "%s: min больше max", fid);
        if (!strcmp(type, "enum") && r2d_json_size(r2d_json_get(f, "options")) == 0)
            diag(rep, SDK_ERROR, "SNIP024", mp, p->id, fid, "%s: enum без options", fid);
        if (!strcmp(type, "asset") && !in_list(k_asset_kinds, jstr(f, "assetKind")))
            diag(rep, SDK_ERROR, "SNIP021", mp, p->id, fid, "%s: assetKind image|audio|animation|data|rml", fid);
        const R2dJson *def = r2d_json_get(f, "default");
        char why[160];
        if (def && def->type != R2D_JSON_NULL && !value_ok(f, def, why, sizeof why))
            diag(rep, SDK_ERROR, "SNIP022", mp, p->id, fid, "%s: default — %s", fid, why);
        const R2dJson *vis = r2d_json_get(f, "visibleIf");
        if (vis) {
            const char *dep = jstr(vis, "field");
            if (!dep || !pkg_field(p, dep))
                diag(rep, SDK_ERROR, "SNIP020", mp, p->id, fid, "%s: visibleIf.field ссылается на неизвестное поле", fid);
        }
    }

    // Примеры и тесты пакета: файлы обязаны существовать; тест — values по схеме.
    static const char *const lists[] = { "examples", "tests" };
    for (int l = 0; l < 2; ++l) {
        const R2dJson *arr = r2d_json_get(m, lists[l]);
        for (int i = 0; i < r2d_json_size(arr); ++i) {
            const R2dJson *e = r2d_json_at(arr, i);
            if (!e || e->type != R2D_JSON_STR || !rel_path_ok(e->string)) {
                diag(rep, SDK_ERROR, "SNIP010", mp, p->id, lists[l], "%s[%d]: относительный путь", lists[l], i);
                continue;
            }
            char full[2048];
            sdk_join(p->dir, e->string, full, sizeof full);
            if (!sdk_file_exists(full)) {
                diag(rep, SDK_ERROR, "SNIP010", mp, p->id, lists[l], "%s «%s» не найден", lists[l], e->string);
                continue;
            }
            if (l == 1) {
                SdkReport tr;
                sdk_report_init(&tr);
                R2dJson *t = sdk_load_json(full, &tr);
                const R2dJson *values = r2d_json_get(t, "values");
                if (!t || (values && values->type != R2D_JSON_OBJ)) {
                    diag(rep, SDK_ERROR, "SNIP180", full, p->id, NULL, "тест пакета: ожидался {\"values\": {…}}");
                } else {
                    // Тест пакета: values проходят схему; "invalid": true — хотя бы одно не проходит.
                    const bool expect_invalid = r2d_json_bool(r2d_json_get(t, "invalid"), false);
                    int bad = 0;
                    char why[160] = "";
                    for (int k = 0; k < r2d_json_size(values); ++k) {
                        const R2dJson *f = pkg_field(p, values->keys[k]);
                        if (!f) { diag(rep, SDK_ERROR, "SNIP180", full, p->id, values->keys[k], "тест: неизвестное поле «%s»", values->keys[k]); continue; }
                        if (!value_ok(f, values->items[k], why, sizeof why)) {
                            bad++;
                            if (!expect_invalid)
                                diag(rep, SDK_ERROR, "SNIP180", full, p->id, values->keys[k], "тест: %s — %s", values->keys[k], why);
                        }
                    }
                    if (expect_invalid && !bad)
                        diag(rep, SDK_ERROR, "SNIP180", full, p->id, NULL, "тест invalid: все значения прошли схему");
                }
                r2d_json_free(t);
                sdk_report_free(&tr);
            }
        }
    }
    p->valid = rep->errors == errors0;
}

// Разрешение requires по api.schema.json. Без схемы — одна ошибка SNIP100.
static void resolve_api(const SnipPkg *p, const R2dJson *schema, SdkReport *rep)
{
    const R2dJson *req = r2d_json_get(p->m, "requires");
    if (!r2d_json_size(req)) return;
    const R2dJson *names = r2d_json_get(schema, "names");
    for (int i = 0; i < r2d_json_size(req); ++i) {
        const R2dJson *r = r2d_json_at(req, i);
        const char *api = r && r->type == R2D_JSON_STR ? r->string : jstr(r, "api");
        if (!api) continue;
        bool found = false;
        for (int k = 0; k < r2d_json_size(names) && !found; ++k)
            found = !strcmp(r2d_json_str(r2d_json_get(r2d_json_at(names, k), "path"), ""), api);
        if (!found)
            diag(rep, SDK_ERROR, "SNIP100", p->manifest_path, p->id, "requires",
                 "%s нет в api.schema.json — пакет требует отсутствующий $ API", api);
    }
}

static bool schema_has(const R2dJson *names, const char *path)
{
    for (int k = 0; k < r2d_json_size(names); ++k)
        if (!strcmp(r2d_json_str(r2d_json_get(r2d_json_at(names, k), "path"), ""), path)) return true;
    return false;
}

// Исходник вызывает $.x.y, которого нет в requires: манифест неполон (SNIP103).
// Путь укорачивается до самого длинного имени из схемы ($.camera.follow(…).x → $.camera.follow).
static void check_source_api(const SnipPkg *p, const R2dJson *schema, SdkReport *rep)
{
    const char *src = jstr(p->m, "source");
    if (!src || strcmp(p->kind, "behavior")) return;
    char full[2048];
    sdk_join(p->dir, src, full, sizeof full);
    char *text = sdk_read_file(full, NULL);
    if (!text) return;
    const R2dJson *names = r2d_json_get(schema, "names");
    const R2dJson *req = r2d_json_get(p->m, "requires");
    char seen[64][128];
    int nseen = 0;
    for (const char *q = text; (q = strstr(q, "$.")) != NULL; q += 2) {
        char path[128];
        size_t n = 0;
        path[n++] = '$';
        const char *c = q + 1;
        while (*c && n + 1 < sizeof path && (*c == '.' || *c == '_' || (*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z') || (*c >= '0' && *c <= '9')))
            path[n++] = *c++;
        path[n] = 0;
        while (n > 2 && path[n - 1] == '.') path[--n] = 0;
        // Полный путь отсутствует, а его родитель — пространство $: такого метода нет.
        if (!schema_has(names, path)) {
            char parent[128];
            snprintf(parent, sizeof parent, "%s", path);
            char *dot = strrchr(parent, '.');
            if (dot && dot != parent + 1) {
                *dot = 0;
                bool dupx = false;
                for (int i = 0; i < nseen && !dupx; ++i) dupx = !strcmp(seen[i], path);
                if (schema_has(names, parent) && !dupx) {
                    if (nseen < 64) snprintf(seen[nseen++], 128, "%s", path);
                    diag(rep, SDK_ERROR, "SNIP104", p->manifest_path, p->id, "source",
                         "%s вызывает %s — такого имени нет в api.schema.json", src, path);
                }
            }
        }
        while (!schema_has(names, path)) {
            char *dot = strrchr(path, '.');
            if (!dot || dot == path + 1) { path[0] = 0; break; }
            *dot = 0;
        }
        if (!path[0] || !strcmp(path, "$")) continue;
        bool declared = false, dup = false;
        for (int i = 0; i < r2d_json_size(req) && !declared; ++i) {
            const R2dJson *r = r2d_json_at(req, i);
            const char *api = r && r->type == R2D_JSON_STR ? r->string : jstr(r, "api");
            declared = api && !strcmp(api, path);
        }
        for (int i = 0; i < nseen && !dup; ++i) dup = !strcmp(seen[i], path);
        if (declared || dup) continue;
        if (nseen < 64) snprintf(seen[nseen++], 128, "%s", path);
        diag(rep, SDK_WARNING, "SNIP103", p->manifest_path, p->id, "requires",
             "%s вызывает %s, но не объявляет его в requires", src, path);
    }
    free(text);
}

static bool load_pkg(const char *dir, const char *scope, SnipPkg *p, SdkReport *rep)
{
    memset(p, 0, sizeof *p);
    snprintf(p->dir, sizeof p->dir, "%s", dir);
    snprintf(p->scope, sizeof p->scope, "%s", scope);
    sdk_join(dir, "snippet.json", p->manifest_path, sizeof p->manifest_path);
    size_t size = 0;
    char *text = sdk_read_file(p->manifest_path, &size);
    if (!text) return false;
    hex64(sdk_deps_hash64(text, size), p->hash);
    char err[160];
    p->m = r2d_json_parse(text, err, sizeof err);
    free(text);
    if (!p->m) {
        diag(rep, SDK_ERROR, "SNIP001", p->manifest_path, NULL, NULL, "manifest не разобран: %s", err);
        snprintf(p->id, sizeof p->id, "%s", sdk_basename(dir));
        return true;
    }
    validate_manifest(p, rep, true);
    if (!p->id[0]) snprintf(p->id, sizeof p->id, "%s", sdk_basename(dir));
    return true;
}

typedef struct { char (*names)[256]; int count, cap; } NameList;

static SDL_EnumerationResult names_cb(void *user, const char *dir, const char *name)
{
    (void)dir;
    NameList *l = (NameList *)user;
    if (name[0] == '.' || l->count >= l->cap) return SDL_ENUM_CONTINUE;
    snprintf(l->names[l->count++], 256, "%s", name);
    return SDL_ENUM_CONTINUE;
}

static int cmp_name(const void *a, const void *b) { return strcmp((const char *)a, (const char *)b); }

static void catalog_push(SnipCatalog *c, const SnipPkg *p)
{
    if (c->count == c->cap) {
        c->cap = c->cap ? c->cap * 2 : 64;
        c->items = (SnipPkg *)realloc(c->items, sizeof(SnipPkg) * (size_t)c->cap);
    }
    c->items[c->count++] = *p;
}

static void scan_root(SnipCatalog *c, const char *root, const char *scope, SdkReport *rep)
{
    if (!root[0] || !sdk_is_dir(root)) return;
    NameList l = { (char (*)[256])calloc(4096, 256), 0, 4096 };
    SDL_EnumerateDirectory(root, names_cb, &l);
    qsort(l.names, (size_t)l.count, 256, cmp_name);   // детерминированный порядок
    for (int i = 0; i < l.count; ++i) {
        char dir[1200];
        snprintf(dir, sizeof dir, "%s/%s", root, l.names[i]);
        if (!sdk_is_dir(dir)) continue;
        SnipPkg p;
        if (!load_pkg(dir, scope, &p, rep)) continue;   // каталог без snippet.json — не пакет
        catalog_push(c, &p);
    }
    free(l.names);
}

// Встроенная библиотека: --catalog, затем snippets/ в cwd и выше каталога r2d.
static bool builtin_root(const char *explicit_dir, char *out, size_t cap)
{
    if (explicit_dir && explicit_dir[0]) { snprintf(out, cap, "%s", explicit_dir); return sdk_is_dir(out); }
    static const char *const rel[] = {
        "snippets", "../snippets", "../../snippets", "../../../snippets",
        "../../../../snippets", "../../../../../snippets",
    };
    char cand[2048];
    for (size_t i = 0; i < sizeof rel / sizeof rel[0]; ++i) {
        sdk_join(sdk_exe_dir(), rel[i], cand, sizeof cand);
        if (sdk_is_dir(cand)) { snprintf(out, cap, "%s", cand); return true; }
    }
    if (sdk_is_dir("snippets") && sdk_file_exists("api.schema.json")) { snprintf(out, cap, "snippets"); return true; }
    out[0] = 0;
    return false;
}

static void catalog_free(SnipCatalog *c)
{
    for (int i = 0; i < c->count; ++i) r2d_json_free(c->items[i].m);
    free(c->items);
    memset(c, 0, sizeof *c);
}

// Проектный пакет с тем же id побеждает встроенный — явно: shadows + SNIP009.
static void catalog_load(SnipCatalog *c, const char *catalog_dir, const char *project_dir, SdkReport *rep)
{
    memset(c, 0, sizeof *c);
    if (!builtin_root(catalog_dir, c->builtin_root, sizeof c->builtin_root) && catalog_dir && catalog_dir[0])
        diag(rep, SDK_ERROR, "SNIP140", catalog_dir, NULL, NULL, "каталог пакетов «%s» не найден", catalog_dir);
    scan_root(c, c->builtin_root, "builtin", rep);
    if (project_dir && project_dir[0]) {
        snprintf(c->project_root, sizeof c->project_root, "%s/snippets", project_dir);
        const int first = c->count;
        scan_root(c, c->project_root, "project", rep);
        for (int i = first; i < c->count; ++i)
            for (int k = 0; k < first; ++k)
                if (c->items[k].valid && !strcmp(c->items[k].id, c->items[i].id)) {
                    c->items[i].shadows = true;
                    c->items[k].valid = false;   // закрыт проектным
                    diag(rep, SDK_WARNING, "SNIP009", c->items[i].manifest_path, c->items[i].id, NULL,
                         "проектный пакет %s закрывает встроенный (%s)", c->items[i].id, c->items[k].version);
                }
    }
    // Повтор id внутри одного источника — ошибка.
    for (int i = 0; i < c->count; ++i)
        for (int k = 0; k < i; ++k)
            if (!strcmp(c->items[i].scope, c->items[k].scope) && !strcmp(c->items[i].id, c->items[k].id))
                diag(rep, SDK_ERROR, "SNIP008", c->items[i].manifest_path, c->items[i].id, NULL,
                     "повтор id пакета «%s» (%s)", c->items[i].id, c->items[k].manifest_path);
}

static const SnipPkg *catalog_find(const SnipCatalog *c, const char *id)
{
    const SnipPkg *hit = NULL;
    for (int i = 0; id && i < c->count; ++i) {
        if (strcmp(c->items[i].id, id)) continue;
        if (c->items[i].shadows || !hit) hit = &c->items[i];   // проектный побеждает
    }
    return hit;
}

static bool pkg_targets(const SnipPkg *p, const char *t)
{
    const R2dJson *targets = r2d_json_get(p->m, "targets");
    if (!r2d_json_size(targets)) return !strcmp(t, "node");
    for (int i = 0; i < r2d_json_size(targets); ++i)
        if (!strcmp(r2d_json_str(r2d_json_at(targets, i), ""), t)) return true;
    return false;
}

// Зависимости каталога: существование и отсутствие циклов (DFS с цветами).
static int dep_visit(const SnipCatalog *c, int idx, char *color, SdkReport *rep)
{
    if (color[idx] == 2) return 0;
    if (color[idx] == 1) {
        diag(rep, SDK_ERROR, "SNIP081", c->items[idx].manifest_path, c->items[idx].id, "dependencies",
             "цикл зависимостей через %s", c->items[idx].id);
        return 1;
    }
    color[idx] = 1;
    const R2dJson *deps = r2d_json_get(c->items[idx].m, "dependencies");
    int bad = 0;
    for (int i = 0; i < r2d_json_size(deps) && !bad; ++i) {
        const R2dJson *d = r2d_json_at(deps, i);
        const char *did = d && d->type == R2D_JSON_STR ? d->string : jstr(d, "id");
        const SnipPkg *dp = catalog_find(c, did);
        if (!dp) {
            diag(rep, SDK_ERROR, "SNIP080", c->items[idx].manifest_path, c->items[idx].id, "dependencies",
                 "зависимость %s отсутствует в каталоге", did ? did : "?");
            continue;
        }
        // Пакет уровня проекта не может требовать пакет «только на узел» на том же owner.
        if (pkg_targets(&c->items[idx], "project") && !pkg_targets(dp, "project") && !strcmp(c->items[idx].kind, "behavior"))
            diag(rep, SDK_ERROR, "SNIP083", c->items[idx].manifest_path, c->items[idx].id, "dependencies",
                 "%s ставится на project, а зависимость %s — только на узел", c->items[idx].id, dp->id);
        bad = dep_visit(c, (int)(dp - c->items), color, rep);
    }
    color[idx] = 2;
    return bad;
}

// Состав набора на одном owner: behavior-участники (не «только проект») и их слоты.
static void kit_collect(const SnipCatalog *c, const SnipPkg *p, const SnipPkg **out, int *n, int cap, int depth)
{
    if (depth > 16) return;
    const R2dJson *deps = r2d_json_get(p->m, "dependencies");
    for (int i = 0; i < r2d_json_size(deps); ++i) {
        const R2dJson *d = r2d_json_at(deps, i);
        const SnipPkg *dp = catalog_find(c, d && d->type == R2D_JSON_STR ? d->string : jstr(d, "id"));
        if (!dp) continue;
        bool seen = false;
        for (int k = 0; k < *n; ++k) seen |= out[k] == dp;
        if (seen) continue;
        if (!strcmp(dp->kind, "kit")) { kit_collect(c, dp, out, n, cap, depth + 1); continue; }
        if (pkg_targets(dp, "project") && !pkg_targets(dp, "node")) continue;
        if (*n < cap) out[(*n)++] = dp;
        kit_collect(c, dp, out, n, cap, depth + 1);
    }
}

static void kit_slots(const SnipCatalog *c, const SnipPkg *kit, SdkReport *rep)
{
    const SnipPkg *list[256];
    int n = 0;
    kit_collect(c, kit, list, &n, 256, 0);
    for (int i = 0; i < n; ++i) {
        const R2dJson *slots = r2d_json_get(list[i]->m, "slots");
        if (!r2d_json_size(slots)) continue;
        const char *sid = jstr(r2d_json_at(slots, 0), "id");
        const int cap = r2d_json_int(r2d_json_get(r2d_json_at(slots, 0), "capacity"), 1);
        int used = 0;
        for (int k = 0; k <= i; ++k) {
            const R2dJson *s2 = r2d_json_get(list[k]->m, "slots");
            if (r2d_json_size(s2) && !strcmp(jstr(r2d_json_at(s2, 0), "id") ? jstr(r2d_json_at(s2, 0), "id") : "", sid ? sid : "")) used++;
        }
        if (sid && used > cap)
            diag(rep, SDK_ERROR, "SNIP084", kit->manifest_path, kit->id, "dependencies",
                 "в наборе %s слот «%s» занят больше %d раз (%s)", kit->id, sid, cap, list[i]->id);
    }
}

static void catalog_check(const SnipCatalog *c, const R2dJson *schema, SdkReport *rep)
{
    char *color = (char *)calloc((size_t)c->count + 1, 1);
    for (int i = 0; i < c->count; ++i) {
        if (!c->items[i].m) continue;
        dep_visit(c, i, color, rep);
        if (schema) { resolve_api(&c->items[i], schema, rep); check_source_api(&c->items[i], schema, rep); }
        if (!strcmp(c->items[i].kind, "kit")) kit_slots(c, &c->items[i], rep);
    }
    free(color);
}

static R2dJson *load_schema(const char *explicit_path, const char *dir, SdkReport *rep)
{
    char path[2048];
    if (!sdk_schema_resolve(explicit_path, dir, path, sizeof path)) {
        diag(rep, SDK_ERROR, "SNIP100", path, NULL, NULL, "api.schema.json не найдена — requires не проверить");
        return NULL;
    }
    return sdk_load_json(path, rep);
}

static void put_pkg_json(R2dSb *sb, const SnipPkg *p, bool full)
{
    r2d_sb_putc(sb, '{');
    sdk_put_kv_str(sb, "id", p->id); r2d_sb_putc(sb, ',');
    sdk_put_kv_str(sb, "version", p->version); r2d_sb_putc(sb, ',');
    sdk_put_kv_str(sb, "kind", p->kind); r2d_sb_putc(sb, ',');
    sdk_put_kv_str(sb, "scope", p->scope); r2d_sb_putc(sb, ',');
    put_loc(sb, "title", loc_text(r2d_json_get(p->m, "title"))); r2d_sb_putc(sb, ',');
    put_loc(sb, "description", loc_text(r2d_json_get(p->m, "description"))); r2d_sb_putc(sb, ',');
    put_loc(sb, "category", jstr(p->m, "category")); r2d_sb_putc(sb, ',');
    sdk_put_kv_str(sb, "manifest_hash", p->hash); r2d_sb_putc(sb, ',');
    sdk_put_kv_str(sb, "path", p->manifest_path);
    r2d_sb_printf(sb, ",\"valid\":%s,\"shadows\":%s", p->valid ? "true" : "false", p->shadows ? "true" : "false");
    static const char *const keys[] = { "targets", "slots", "dependencies", "requires", "tags" };
    for (size_t i = 0; i < sizeof keys / sizeof keys[0]; ++i) {
        const R2dJson *v = r2d_json_get(p->m, keys[i]);
        r2d_sb_printf(sb, ",\"%s\":", keys[i]);
        if (v) sdk_json_put_compact(sb, v); else r2d_sb_puts(sb, "[]");
    }
    if (full) {
        const R2dJson *f = r2d_json_get(p->m, "fields");
        r2d_sb_puts(sb, ",\"fields\":");
        if (f) sdk_json_put_compact(sb, f); else r2d_sb_puts(sb, "[]");
    }
    r2d_sb_putc(sb, '}');
}

// Регистронезависимый для ASCII поиск подстроки; кириллица — побайтно
// (Editor приводит запрос и текст к нижнему регистру сам).
static bool contains_ci(const char *hay, const char *needle)
{
    if (!needle || !needle[0]) return true;
    if (!hay) return false;
    const size_t n = strlen(needle);
    for (const char *p = hay; *p; ++p) {
        size_t i = 0;
        for (; i < n && p[i]; ++i) {
            char a = p[i], b = needle[i];
            if (a >= 'A' && a <= 'Z') a = (char)(a - 'A' + 'a');
            if (b >= 'A' && b <= 'Z') b = (char)(b - 'A' + 'a');
            if (a != b) break;
        }
        if (i == n) return true;
    }
    return false;
}

static bool pkg_matches(const SnipPkg *p, const char *q)
{
    if (!q || !q[0]) return true;
    if (contains_ci(p->id, q) || contains_ci(loc_text(r2d_json_get(p->m, "title")), q) ||
        contains_ci(loc_text(r2d_json_get(p->m, "description")), q) || contains_ci(jstr(p->m, "category"), q))
        return true;
    const R2dJson *tags = r2d_json_get(p->m, "tags");
    for (int i = 0; i < r2d_json_size(tags); ++i)
        if (contains_ci(r2d_json_str(r2d_json_at(tags, i), ""), q)) return true;
    return false;
}

// ---------------------------------------------------------------------------
// editor.snippets
// ---------------------------------------------------------------------------
static bool graph_has_entity(const R2dJson *root, const char *key)
{
    const R2dJson *g = r2d_json_get(r2d_json_get(root, "editor"), "graph");
    static const char *const lists[] = { "entities", "areas" };
    for (int l = 0; l < 2; ++l) {
        const R2dJson *arr = r2d_json_get(g, lists[l]);
        for (int i = 0; i < r2d_json_size(arr); ++i)
            if (!strcmp(r2d_json_str(r2d_json_get(r2d_json_at(arr, i), "key"), ""), key)) return true;
    }
    return false;
}

static const R2dJson *graph_entity(const R2dJson *root, const char *key)
{
    const R2dJson *arr = r2d_json_get(r2d_json_get(r2d_json_get(root, "editor"), "graph"), "entities");
    for (int i = 0; i < r2d_json_size(arr); ++i)
        if (!strcmp(r2d_json_str(r2d_json_get(r2d_json_at(arr, i), "key"), ""), key)) return r2d_json_at(arr, i);
    return NULL;
}

static bool g_skip_section;   // запись project.json не блокируется незаполненной конфигурацией

static void check_values(const R2dJson *inst, const SnipPkg *p, const char *mp, const char *dir,
                         const char *iid, SdkReport *rep)
{
    const R2dJson *values = r2d_json_get(inst, "values");
    if (values && values->type != R2D_JSON_OBJ) {
        diag(rep, SDK_ERROR, "SNIP025", mp, p->id, "values", "%s.values: ожидался объект", iid);
        return;
    }
    for (int i = 0; i < r2d_json_size(values); ++i)
        if (!pkg_field(p, values->keys[i]))
            diag(rep, SDK_WARNING, "SNIP028", mp, p->id, values->keys[i],
                 "%s: поля «%s» нет в %s@%s (значение сохраняется)", iid, values->keys[i], p->id, p->version);
    const R2dJson *fields = r2d_json_get(p->m, "fields");
    for (int i = 0; i < r2d_json_size(fields); ++i) {
        const R2dJson *f = r2d_json_at(fields, i);
        const char *fid = jstr(f, "id");
        if (!fid) continue;
        const R2dJson *v = r2d_json_get(values, fid);
        if (!v || v->type == R2D_JSON_NULL) {
            const R2dJson *def = r2d_json_get(f, "default");
            if (r2d_json_bool(r2d_json_get(f, "required"), false) && (!def || def->type == R2D_JSON_NULL))
                diag(rep, SDK_ERROR, "SNIP027", mp, p->id, fid, "%s: обязательное поле «%s» не заполнено", iid, fid);
            continue;
        }
        char why[160];
        if (!value_ok(f, v, why, sizeof why)) {
            const char *type = jstr(f, "type");
            const char *code = (!strcmp(type, "enum") && v->type == R2D_JSON_STR) ? "SNIP029" :
                               (v->type == R2D_JSON_NUM && (!strcmp(type, "number") || !strcmp(type, "int"))) ? "SNIP026" : "SNIP025";
            diag(rep, SDK_ERROR, code, mp, p->id, fid, "%s.%s: %s", iid, fid, why);
            continue;
        }
        const char *type = jstr(f, "type");
        if (!strcmp(type, "asset")) {
            if (!rel_path_ok(v->string)) {
                diag(rep, SDK_ERROR, "SNIP040", mp, p->id, fid, "%s.%s: путь «%s» вне проекта", iid, fid, v->string);
                continue;
            }
            char full[2048];
            sdk_join(dir, v->string, full, sizeof full);
            if (!sdk_file_exists(full)) {
                diag(rep, SDK_ERROR, "SNIP041", mp, p->id, fid, "%s.%s: ресурс «%s» не найден", iid, fid, v->string);
                continue;
            }
            const char *want = jstr(f, "assetKind");
            const char *got = asset_kind_of(v->string);
            if (want && strcmp(want, got) && !(!strcmp(want, "animation") && !strcmp(got, "image")))
                diag(rep, SDK_ERROR, "SNIP042", mp, p->id, fid, "%s.%s: «%s» — %s, ожидался %s", iid, fid,
                     v->string, got[0] ? got : "неизвестный тип", want);
        }
    }
}

static const R2dJson *find_instance(const R2dJson *instances, const char *id)
{
    for (int i = 0; i < r2d_json_size(instances); ++i)
        if (!strcmp(r2d_json_str(r2d_json_get(r2d_json_at(instances, i), "id"), ""), id)) return r2d_json_at(instances, i);
    return NULL;
}

// Проверка секции; каталог передаётся снаружи (или грузится).
static void check_section(const R2dJson *root, const char *mp, const char *dir, const SnipCatalog *cat, SdkReport *rep)
{
    const R2dJson *sn = r2d_json_get(r2d_json_get(root, "editor"), "snippets");
    if (!sn) return;
    if (sn->type != R2D_JSON_OBJ) { diag(rep, SDK_ERROR, "SNIP140", mp, NULL, "editor.snippets", "editor.snippets: ожидался объект"); return; }
    if (r2d_json_num(r2d_json_get(sn, "format"), 0) != 1)
        diag(rep, SDK_ERROR, "SNIP140", mp, NULL, "editor.snippets.format", "editor.snippets.format: поддерживается 1");
    const R2dJson *gen = r2d_json_get(sn, "generation");
    const char *out = jstr(gen, "output");
    if (out && (!rel_path_ok(out)))
        diag(rep, SDK_ERROR, "SNIP120", mp, NULL, "editor.snippets.generation.output", "output: относительный путь внутри проекта");
    const char *own = jstr(gen, "ownership");
    if (own && strcmp(own, "generator") && strcmp(own, "code"))
        diag(rep, SDK_ERROR, "SNIP120", mp, NULL, "editor.snippets.generation.ownership", "ownership: generator | code");

    const R2dJson *lock = r2d_json_get(sn, "catalog_lock");
    const R2dJson *instances = r2d_json_get(sn, "instances");
    if (instances && instances->type != R2D_JSON_ARR)
        diag(rep, SDK_ERROR, "SNIP144", mp, NULL, "editor.snippets.instances", "instances: массив");
    for (int i = 0; i < r2d_json_size(instances); ++i) {
        const R2dJson *inst = r2d_json_at(instances, i);
        const char *iid = jstr(inst, "id");
        if (!snip_key_ok(iid)) { diag(rep, SDK_ERROR, "SNIP144", mp, NULL, "instances", "instances[%d]: нужен id", i); continue; }
        for (int k = 0; k < i; ++k)
            if (!strcmp(r2d_json_str(r2d_json_get(r2d_json_at(instances, k), "id"), ""), iid))
                diag(rep, SDK_ERROR, "SNIP144", mp, NULL, iid, "повтор id экземпляра «%s»", iid);
        const char *pid = jstr(inst, "package");
        const SnipPkg *p = catalog_find(cat, pid);
        if (!p) { diag(rep, SDK_ERROR, "SNIP141", mp, pid, iid, "%s: пакета %s нет в каталоге", iid, pid ? pid : "?"); continue; }
        if (!p->valid) diag(rep, SDK_ERROR, "SNIP141", mp, pid, iid, "%s: пакет %s не прошёл проверку manifest", iid, pid);
        const char *ver = jstr(inst, "version");
        if (!ver || strcmp(ver, p->version))
            diag(rep, SDK_ERROR, "SNIP142", mp, pid, iid, "%s: версия %s, в каталоге %s@%s (r2d snippet update)", iid,
                 ver ? ver : "?", pid, p->version);
        const R2dJson *l = r2d_json_get(lock, pid);
        if (!l) diag(rep, SDK_ERROR, "SNIP142", mp, pid, "catalog_lock", "%s нет в catalog_lock", pid);
        else if (strcmp(r2d_json_str(r2d_json_get(l, "manifest_hash"), ""), p->hash))
            diag(rep, SDK_WARNING, "SNIP143", mp, pid, "catalog_lock", "manifest %s изменился после фиксации (r2d snippet update)", pid);
        const char *owner = jstr(inst, "owner");
        const R2dJson *targets = r2d_json_get(p->m, "targets");
        bool node_target = r2d_json_size(targets) == 0;
        for (int k = 0; k < r2d_json_size(targets); ++k)
            if (!strcmp(r2d_json_str(r2d_json_at(targets, k), ""), "node")) node_target = true;
        if (!owner) diag(rep, SDK_ERROR, "SNIP060", mp, pid, iid, "%s: нет owner", iid);
        else if (strcmp(owner, "project") && !graph_has_entity(root, owner))
            diag(rep, SDK_ERROR, "SNIP060", mp, pid, iid, "%s: owner «%s» не найден в editor.graph", iid, owner);
        else if (!strcmp(owner, "project") && node_target && r2d_json_size(targets) > 0) {
            bool proj = false;
            for (int k = 0; k < r2d_json_size(targets); ++k)
                if (!strcmp(r2d_json_str(r2d_json_at(targets, k), ""), "project")) proj = true;
            if (!proj) diag(rep, SDK_ERROR, "SNIP061", mp, pid, iid, "%s: пакет %s ставится на узел, не на project", iid, pid);
        } else if (strcmp(owner, "project")) {
            const R2dJson *e = graph_entity(root, owner);
            if (e && strcmp(r2d_json_str(r2d_json_get(e, "type"), ""), "object"))
                diag(rep, SDK_ERROR, "SNIP061", mp, pid, iid, "%s: owner «%s» не объект", iid, owner);
            else if (e && !jstr(e, "public_id"))
                diag(rep, SDK_ERROR, "SNIP061", mp, pid, iid, "%s: у «%s» нет id — генератор не найдёт узел", iid, owner);
        }
        // Слот: из экземпляра или первый слот пакета. Ёмкость на одного owner.
        const char *slot = jstr(inst, "slot");
        const R2dJson *slots = r2d_json_get(p->m, "slots");
        if (slot) {
            int capacity = -1;
            for (int k = 0; k < r2d_json_size(slots); ++k)
                if (!strcmp(r2d_json_str(r2d_json_get(r2d_json_at(slots, k), "id"), ""), slot))
                    capacity = r2d_json_int(r2d_json_get(r2d_json_at(slots, k), "capacity"), 1);
            if (capacity < 0) diag(rep, SDK_ERROR, "SNIP063", mp, pid, iid, "%s: у %s нет слота «%s»", iid, pid, slot);
            else if (owner) {
                int used = 0;
                for (int k = 0; k <= i; ++k) {
                    const R2dJson *o = r2d_json_at(instances, k);
                    if (!strcmp(r2d_json_str(r2d_json_get(o, "owner"), ""), owner) &&
                        !strcmp(r2d_json_str(r2d_json_get(o, "slot"), ""), slot)) used++;
                }
                if (used > capacity)
                    diag(rep, SDK_ERROR, "SNIP062", mp, pid, iid, "%s: слот «%s» у %s занят (ёмкость %d)", iid, slot, owner, capacity);
            }
        }
        // Зависимости пакета должны стоять на том же owner.
        const R2dJson *deps = r2d_json_get(p->m, "dependencies");
        if (!strcmp(p->kind, "behavior"))
            for (int k = 0; k < r2d_json_size(deps); ++k) {
                const R2dJson *d = r2d_json_at(deps, k);
                const char *did = d && d->type == R2D_JSON_STR ? d->string : jstr(d, "id");
                bool has = false;
                for (int j = 0; j < r2d_json_size(instances) && !has; ++j) {
                    const R2dJson *o = r2d_json_at(instances, j);
                    has = !strcmp(r2d_json_str(r2d_json_get(o, "package"), ""), did ? did : "") &&
                          !strcmp(r2d_json_str(r2d_json_get(o, "owner"), ""), owner ? owner : "");
                }
                if (!has) diag(rep, SDK_ERROR, "SNIP082", mp, pid, iid, "%s: нужен %s на том же owner", iid, did ? did : "?");
            }
        // Ссылки на другие экземпляры/сущности.
        const R2dJson *links = r2d_json_get(inst, "links");
        for (int k = 0; k < r2d_json_size(links); ++k) {
            const char *to = r2d_json_str(links->items[k], NULL);
            if (!to || (!find_instance(instances, to) && !graph_has_entity(root, to)))
                diag(rep, SDK_ERROR, "SNIP064", mp, pid, links->keys[k], "%s.links.%s: «%s» не найден", iid, links->keys[k], to ? to : "?");
        }
        if (!g_skip_section) check_values(inst, p, mp, dir, iid, rep);
    }
    const R2dJson *sets = r2d_json_get(sn, "sets");
    for (int i = 0; i < r2d_json_size(sets); ++i) {
        const R2dJson *s = r2d_json_at(sets, i);
        const R2dJson *members = r2d_json_get(s, "members");
        for (int k = 0; k < r2d_json_size(members); ++k) {
            const char *mid = r2d_json_str(r2d_json_at(members, k), "");
            if (!find_instance(instances, mid))
                diag(rep, SDK_ERROR, "SNIP145", mp, NULL, jstr(s, "id"), "набор %s: экземпляра «%s» нет",
                     r2d_json_str(r2d_json_get(s, "id"), "?"), mid);
        }
    }
}

void sdk_snippets_validate_section(const R2dJson *root, const char *manifest_path, const char *dir, SdkReport *rep)
{
    SdkReport cat_rep;
    sdk_report_init(&cat_rep);
    SnipCatalog cat;
    catalog_load(&cat, NULL, dir, &cat_rep);   // ошибки каталога — в snippet catalog, не в проекте
    check_section(root, manifest_path, dir, &cat, rep);
    catalog_free(&cat);
    sdk_report_free(&cat_rep);
}

// ---------------------------------------------------------------------------
// Генерация
// ---------------------------------------------------------------------------
typedef struct GenFile {
    char  rel[512];        // путь относительно проекта
    char *text;            // новый текст
    char  status[12];      // create | update | same | conflict | delete
} GenFile;

typedef struct GenPlan {
    GenFile files[512];
    int count;
} GenPlan;

static void js_ident(const char *id, char *out, size_t cap)
{
    size_t n = 0;
    // movement.top-down → movement_top_down; «_» в id остаётся — уникальность держит каталог.
    for (const char *p = id; *p && n + 1 < cap; ++p) out[n++] = (*p == '.' || *p == '-' || *p == ':') ? '_' : *p;
    out[n] = 0;
}

// Заголовок с хешем тела: ручная правка обнаруживается без хранения копии.
static char *wrap_generated(const char *body, const char *note)
{
    char h[17];
    hex64(sdk_deps_hash64(body, strlen(body)), h);
    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_printf(&sb, "%s %s\n// %s\n// Не править вручную: Editor («Кирпичики») или r2d snippet. Ручная правка\n"
                       "// будет обнаружена (SNIP120) и не перезапишется молча.\n", SNIP_HEADER, h, note);
    r2d_sb_puts(&sb, body);
    return r2d_sb_take(&sb);
}

// Файл сгенерирован нами и не правлен вручную?
static int generated_state(const char *text)
{
    // 0 — не наш, 1 — наш и цел, 2 — наш, но изменён
    const size_t hl = strlen(SNIP_HEADER);
    if (strncmp(text, SNIP_HEADER " ", hl + 1)) return 0;
    char h[17];
    memcpy(h, text + hl + 1, 16);
    h[16] = 0;
    const char *body = text;
    for (int line = 0; line < 4 && body; ++line) { body = strchr(body, '\n'); if (body) body++; }
    if (!body) return 2;
    char real[17];
    hex64(sdk_deps_hash64(body, strlen(body)), real);
    return strcmp(h, real) ? 2 : 1;
}

static void plan_add(GenPlan *g, const char *rel, char *text)
{
    if (g->count >= (int)(sizeof g->files / sizeof g->files[0])) { free(text); return; }
    GenFile *f = &g->files[g->count++];
    snprintf(f->rel, sizeof f->rel, "%s", rel);
    f->text = text;
}

static void put_value(R2dSb *sb, const R2dJson *v)
{
    // Компактный JSON — валидный JS-литерал.
    sdk_json_put_compact(sb, v);
}

static int cmp_instance_order(const void *a, const void *b)
{
    // Порядок задаётся списком instances; здесь не используется (стабильная сортировка не нужна).
    (void)a; (void)b;
    return 0;
}

static bool build_plan(const R2dJson *root, const char *dir, const SnipCatalog *cat, GenPlan *g, SdkReport *rep,
                       char *out_rel, size_t out_cap)
{
    (void)cmp_instance_order;
    const R2dJson *sn = r2d_json_get(r2d_json_get(root, "editor"), "snippets");
    const R2dJson *gen = r2d_json_get(sn, "generation");
    snprintf(out_rel, out_cap, "%s", r2d_json_str(r2d_json_get(gen, "output"), "generated/snippets"));
    const R2dJson *instances = r2d_json_get(sn, "instances");

    // Пакеты-источники: каждому — свой vendored файл packages/<id>.js.
    const SnipPkg *used[512];
    int nused = 0;
    for (int i = 0; i < r2d_json_size(instances); ++i) {
        const R2dJson *inst = r2d_json_at(instances, i);
        if (r2d_json_bool(r2d_json_get(inst, "disabled"), false)) continue;
        const SnipPkg *p = catalog_find(cat, jstr(inst, "package"));
        if (!p || strcmp(p->kind, "behavior")) continue;
        bool seen = false;
        for (int k = 0; k < nused; ++k) seen |= used[k] == p;
        if (!seen && nused < 512) used[nused++] = p;
    }
    // Детерминированно: по id пакета.
    for (int i = 1; i < nused; ++i)
        for (int k = i; k > 0 && strcmp(used[k - 1]->id, used[k]->id) > 0; --k) {
            const SnipPkg *t = used[k]; used[k] = used[k - 1]; used[k - 1] = t;
        }
    for (int i = 0; i < nused; ++i) {
        const SnipPkg *p = used[i];
        char src[2048];
        sdk_join(p->dir, jstr(p->m, "source"), src, sizeof src);
        char *body = sdk_read_file(src, NULL);
        if (!body) { diag(rep, SDK_ERROR, "SNIP121", src, p->id, "source", "не прочитан source %s", p->id); continue; }
        char note[256], rel[640];
        snprintf(note, sizeof note, "%s@%s (%s), источник: %s", p->id, p->version, p->scope, jstr(p->m, "source"));
        snprintf(rel, sizeof rel, "%s/packages/%s.js", out_rel, p->id);
        plan_add(g, rel, wrap_generated(body, note));
        free(body);
    }

    // index.js: импорты, помощник привязки к узлу и по блоку на экземпляр.
    R2dSb sb;
    r2d_sb_init(&sb);
    for (int i = 0; i < nused; ++i) {
        char ident[128];
        js_ident(used[i]->id, ident, sizeof ident);
        r2d_sb_printf(&sb, "import %s from './packages/%s.js';\n", ident, used[i]->id);
    }
    r2d_sb_puts(&sb,
        "\n// Привязка поведения к узлу по стабильному id: ставится, когда узел\n"
        "// появился (сцена, respawn), и снимается disposer'ом, когда узел исчез.\n"
        "function bind(selector, attach) {\n"
        "    let bound = null;\n"
        "    let dispose = null;\n"
        "    $.update(() => {\n"
        "        const node = $(selector);\n"
        "        const raw = node.length ? node.get(0) : null;\n"
        "        if (raw === bound) return;\n"
        "        if (dispose) dispose();\n"
        "        dispose = null;\n"
        "        bound = raw;\n"
        "        if (raw) dispose = attach(node) || null;\n"
        "    });\n"
        "}\n"
        "\n// Владелец «project»: служебный скрытый узел-якорь (переживает смену сцены),\n"
        "// чтобы покадровые подписки проекта принадлежали узлу и снимались disposer'ом.\n"
        "function projectNode() {\n"
        "    const found = $('#__snippets');\n"
        "    return found.length ? found : $('<snippets>', { id: '__snippets', persistent: true }).size(0, 0).hide().appendTo($.world);\n"
        "}\n");
    // Объекты, созданные в Editor: editor.graph, origin "graph", поле spawn.
    // Обычное создание узла через $ — второго графа сцены нет.
    {
        const R2dJson *ents = r2d_json_get(r2d_json_get(r2d_json_get(root, "editor"), "graph"), "entities");
        int made = 0;
        for (int i = 0; i < r2d_json_size(ents); ++i) {
            const R2dJson *e = r2d_json_at(ents, i);
            const R2dJson *sp = r2d_json_get(e, "spawn");
            if (strcmp(r2d_json_str(r2d_json_get(e, "origin"), ""), "graph") || !sp || !jstr(e, "public_id")) continue;
            if (!made++) r2d_sb_puts(&sb, "\n// Объекты, созданные в Editor (editor.graph, origin: graph)\n$.ready(() => {\n");
            char tag[160];
            snprintf(tag, sizeof tag, "<%s>", r2d_json_str(r2d_json_get(e, "tag"), "node"));
            r2d_sb_puts(&sb, "    $(");
            r2d_sb_put_json_string(&sb, tag);
            r2d_sb_puts(&sb, ", { id: ");
            r2d_sb_put_json_string(&sb, jstr(e, "public_id"));
            r2d_sb_puts(&sb, " })");
            r2d_sb_printf(&sb, ".at(%g, %g).size(%g, %g)", r2d_json_num(r2d_json_get(sp, "x"), 0), r2d_json_num(r2d_json_get(sp, "y"), 0),
                          r2d_json_num(r2d_json_get(sp, "w"), 32), r2d_json_num(r2d_json_get(sp, "h"), 32));
            const char *body = jstr(sp, "body");
            if (body && strcmp(body, "none")) { r2d_sb_puts(&sb, ".body("); r2d_sb_put_json_string(&sb, body); r2d_sb_putc(&sb, ')'); }
            r2d_sb_puts(&sb, ".appendTo($.world);\n");
        }
        if (made) r2d_sb_puts(&sb, "});\n");
    }
    int blocks = 0;
    for (int i = 0; i < r2d_json_size(instances); ++i) {
        const R2dJson *inst = r2d_json_at(instances, i);
        const char *iid = jstr(inst, "id");
        const SnipPkg *p = catalog_find(cat, jstr(inst, "package"));
        if (!p || strcmp(p->kind, "behavior")) continue;
        if (r2d_json_bool(r2d_json_get(inst, "disabled"), false)) {
            r2d_sb_printf(&sb, "\n// %s — отключён (disabled)\n", iid);
            continue;
        }
        const char *owner = jstr(inst, "owner");
        const R2dJson *e = owner ? graph_entity(root, owner) : NULL;
        const char *pub = jstr(e, "public_id");
        char ident[128];
        js_ident(p->id, ident, sizeof ident);
        R2dSb cfg;
        r2d_sb_init(&cfg);
        r2d_sb_puts(&cfg, "{");
        const R2dJson *fields = r2d_json_get(p->m, "fields");
        const R2dJson *values = r2d_json_get(inst, "values");
        int nf = 0;
        for (int k = 0; k < r2d_json_size(fields); ++k) {
            const R2dJson *f = r2d_json_at(fields, k);
            const char *fid = jstr(f, "id");
            const R2dJson *v = r2d_json_get(values, fid);
            if (!v || v->type == R2D_JSON_NULL) v = r2d_json_get(f, "default");
            if (!v) continue;
            r2d_sb_puts(&cfg, nf++ ? ",\n    " : "\n    ");
            r2d_sb_put_json_string(&cfg, fid);
            r2d_sb_puts(&cfg, ": ");
            put_value(&cfg, v);
        }
        const R2dJson *links = r2d_json_get(inst, "links");
        for (int k = 0; k < r2d_json_size(links); ++k) {
            r2d_sb_puts(&cfg, nf++ ? ",\n    " : "\n    ");
            r2d_sb_put_json_string(&cfg, links->keys[k]);
            r2d_sb_puts(&cfg, ": ");
            put_value(&cfg, links->items[k]);
        }
        r2d_sb_puts(&cfg, nf ? "\n}" : "}");
        r2d_sb_printf(&sb, "\n// %s — %s@%s → %s\n", iid, p->id, p->version, owner ? owner : "?");
        if (owner && !strcmp(owner, "project")) {
            r2d_sb_printf(&sb, "$.ready(() => %s(projectNode(), ", ident);
            r2d_sb_puts(&sb, cfg.data);
            r2d_sb_puts(&sb, ", $));\n");
        } else if (pub) {
            r2d_sb_puts(&sb, "bind(");
            char sel[200];
            snprintf(sel, sizeof sel, "#%s", pub);
            r2d_sb_put_json_string(&sb, sel);
            r2d_sb_printf(&sb, ", (node) => %s(node, ", ident);
            r2d_sb_puts(&sb, cfg.data);
            r2d_sb_puts(&sb, ", $));\n");
        } else {
            diag(rep, SDK_ERROR, "SNIP061", "", p->id, iid, "%s: у owner нет id — блок не сгенерирован", iid);
        }
        r2d_sb_free(&cfg);
        blocks++;
    }
    if (!blocks && !strstr(sb.data ? sb.data : "", "origin: graph")) r2d_sb_puts(&sb, "\n// Подключённых сниппетов нет.\n");
    char rel[640];
    snprintf(rel, sizeof rel, "%s/index.js", out_rel);
    // index.js — первым в списке файлов.
    char *text = wrap_generated(sb.data ? sb.data : "", "editor.snippets → обычный JS");
    r2d_sb_free(&sb);
    if (g->count < (int)(sizeof g->files / sizeof g->files[0])) {
        memmove(&g->files[1], &g->files[0], sizeof(GenFile) * (size_t)g->count);
        g->count++;
        snprintf(g->files[0].rel, sizeof g->files[0].rel, "%s", rel);
        g->files[0].text = text;
    } else free(text);
    (void)dir;
    return true;
}

typedef struct { char (*names)[256]; int count, cap; } FileList;

static SDL_EnumerationResult files_cb(void *user, const char *dir, const char *name)
{
    (void)dir;
    FileList *l = (FileList *)user;
    if (l->count < l->cap && sdk_ends_with(name, ".js")) snprintf(l->names[l->count++], 256, "%s", name);
    return SDL_ENUM_CONTINUE;
}

// Строка подключения generated entry в точке входа проекта.
static void entry_link(const R2dJson *root, const char *out_rel, char *entry_rel, size_t ecap, char *line, size_t lcap)
{
    const char *entry = r2d_json_str(r2d_json_get(r2d_json_get(root, "runtime"), "entry"), "main.js");
    snprintf(entry_rel, ecap, "%s", entry);
    int depth = 0;
    for (const char *p = entry; *p; ++p) depth += *p == '/';
    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_puts(&sb, "import '");
    if (!depth) r2d_sb_puts(&sb, "./");
    for (int i = 0; i < depth; ++i) r2d_sb_puts(&sb, "../");
    r2d_sb_printf(&sb, "%s/index.js'; // r2d:snippets — подключение сгенерированных сниппетов (Editor)", out_rel);
    snprintf(line, lcap, "%s", sb.data);
    r2d_sb_free(&sb);
}

static int cmd_generate(const SdkArgs *a, const char *dir)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const bool write = sdk_arg_flag(a, "--write");
    const bool check = sdk_arg_flag(a, "--check");
    const bool overwrite = sdk_arg_flag(a, "--overwrite");
    const bool print = sdk_arg_flag(a, "--print");
    char manifest[2048];
    sdk_join(dir, "project.json", manifest, sizeof manifest);
    R2dJson *root = sdk_load_json(manifest, &rep);
    SnipCatalog cat;
    memset(&cat, 0, sizeof cat);
    GenPlan *g = (GenPlan *)calloc(1, sizeof *g);
    char out_rel[512] = "generated/snippets", entry_rel[512] = "", link[700] = "";
    bool written = false, code_owned = false, stale = false, link_missing = false;

    if (root) {
        const R2dJson *sn = r2d_json_get(r2d_json_get(root, "editor"), "snippets");
        if ((int)r2d_json_num(r2d_json_get(root, "schema_version"), 0) != 2)
            diag(&rep, SDK_ERROR, "SNIP140", manifest, NULL, NULL, "сниппеты живут в project.json schema 2 (r2d migrate-project)");
        else if (!sn)
            diag(&rep, SDK_ERROR, "SNIP140", manifest, NULL, "editor.snippets", "в project.json нет editor.snippets (r2d snippet add)");
        else {
            catalog_load(&cat, sdk_arg_value(a, "--catalog"), dir, &rep);
            check_section(root, manifest, dir, &cat, &rep);
            code_owned = !strcmp(r2d_json_str(r2d_json_get(r2d_json_get(sn, "generation"), "ownership"), "generator"), "code");
            if (code_owned) {
                diag(&rep, SDK_INFO, "SNIP122", manifest, NULL, "editor.snippets.generation.ownership",
                     "область передана в code-authored: генератор её не пишет");
                // Показываем владельца каждого файла области: все — ручной JS.
                snprintf(out_rel, sizeof out_rel, "%s", r2d_json_str(r2d_json_get(r2d_json_get(sn, "generation"), "output"), "generated/snippets"));
                char base[2048];
                snprintf(base, sizeof base, "%s/%s", dir, out_rel);
                static const char *const subs[] = { "", "/packages" };
                for (int k = 0; k < 2; ++k) {
                    char d2[2100];
                    snprintf(d2, sizeof d2, "%s%s", base, subs[k]);
                    FileList fl = { (char (*)[256])calloc(1024, 256), 0, 1024 };
                    if (sdk_is_dir(d2)) SDL_EnumerateDirectory(d2, files_cb, &fl);
                    qsort(fl.names, (size_t)fl.count, 256, cmp_name);
                    for (int i = 0; i < fl.count; ++i) {
                        char rel[640];
                        snprintf(rel, sizeof rel, "%s%s/%s", out_rel, subs[k], fl.names[i]);
                        plan_add(g, rel, NULL);
                        snprintf(g->files[g->count - 1].status, 12, "code");
                    }
                    free(fl.names);
                }
            }
        }
    }
    if (root && rep.errors == 0 && !code_owned) {
        build_plan(root, dir, &cat, g, &rep, out_rel, sizeof out_rel);
        // Статусы файлов и лишние файлы packages/ (удалённые пакеты).
        for (int i = 0; i < g->count; ++i) {
            GenFile *f = &g->files[i];
            char full[2048];
            sdk_join(dir, f->rel, full, sizeof full);
            char *old = sdk_read_file(full, NULL);
            if (!old) snprintf(f->status, sizeof f->status, "create");
            else if (!strcmp(old, f->text)) snprintf(f->status, sizeof f->status, "same");
            else if (generated_state(old) != 1) snprintf(f->status, sizeof f->status, "conflict");
            else snprintf(f->status, sizeof f->status, "update");
            free(old);
        }
        char pk[2048];
        snprintf(pk, sizeof pk, "%s/%s/packages", dir, out_rel);
        FileList fl = { (char (*)[256])calloc(1024, 256), 0, 1024 };
        if (sdk_is_dir(pk)) SDL_EnumerateDirectory(pk, files_cb, &fl);
        qsort(fl.names, (size_t)fl.count, 256, cmp_name);
        for (int i = 0; i < fl.count; ++i) {
            char rel[640];
            snprintf(rel, sizeof rel, "%s/packages/%s", out_rel, fl.names[i]);
            bool planned = false;
            for (int k = 0; k < g->count && !planned; ++k) planned = !strcmp(g->files[k].rel, rel);
            if (planned) continue;
            char full[2048];
            sdk_join(dir, rel, full, sizeof full);
            char *old = sdk_read_file(full, NULL);
            plan_add(g, rel, NULL);
            snprintf(g->files[g->count - 1].status, 12, "%s", old && generated_state(old) == 1 ? "delete" : "conflict");
            free(old);
        }
        free(fl.names);
        for (int i = 0; i < g->count; ++i) {
            if (strcmp(g->files[i].status, "same")) stale = true;
            if (!strcmp(g->files[i].status, "conflict") && !overwrite)
                diag(&rep, write ? SDK_ERROR : SDK_WARNING, "SNIP120", g->files[i].rel, NULL, NULL,
                     "%s изменён вручную: применить (--overwrite), сохранить как пакет проекта или передать в code-authored",
                     g->files[i].rel);
        }
        // Подключение generated entry в точке входа.
        entry_link(root, out_rel, entry_rel, sizeof entry_rel, link, sizeof link);
        char efull[2048];
        sdk_join(dir, entry_rel, efull, sizeof efull);
        char *etext = sdk_read_file(efull, NULL);
        if (!etext) diag(&rep, SDK_ERROR, "SNIP124", efull, NULL, NULL, "точка входа %s не найдена", entry_rel);
        else {
            char needle[700];
            snprintf(needle, sizeof needle, "%s", link);
            char *cut = strstr(needle, ";");
            if (cut) cut[1] = 0;   // сравниваем сам import, без комментария
            link_missing = strstr(etext, needle) == NULL;
            if (link_missing) stale = true;
        }

        if (check && stale)
            diag(&rep, SDK_ERROR, "SNIP123", manifest, NULL, NULL, "generated/snippets устарел: r2d snippet generate --write");
        if (write && rep.errors == 0) {
            // Транзакция: всё во временные файлы, затем переименования; при сбое — откат.
            int done = 0;
            bool fail = false;
            for (int i = 0; i < g->count && !fail; ++i) {
                GenFile *f = &g->files[i];
                if (!strcmp(f->status, "same")) continue;
                char full[2048], tmp[2100];
                sdk_join(dir, f->rel, full, sizeof full);
                if (!f->text) continue;
                char parent[2048];
                sdk_dirname(full, parent, sizeof parent);
                SDL_CreateDirectory(parent);
                snprintf(tmp, sizeof tmp, "%s.r2d-tmp", full);
                if (!sdk_write_file(tmp, f->text, strlen(f->text))) fail = true;
                else done = i + 1;
            }
            if (fail) {
                for (int i = 0; i < done; ++i) {
                    char full[2048], tmp[2100];
                    sdk_join(dir, g->files[i].rel, full, sizeof full);
                    snprintf(tmp, sizeof tmp, "%s.r2d-tmp", full);
                    SDL_RemovePath(tmp);
                }
                diag(&rep, SDK_ERROR, "SNIP121", dir, NULL, NULL, "запись generated не удалась — изменений нет");
            } else {
                for (int i = 0; i < g->count; ++i) {
                    GenFile *f = &g->files[i];
                    char full[2048], tmp[2100];
                    sdk_join(dir, f->rel, full, sizeof full);
                    if (!strcmp(f->status, "delete")) { SDL_RemovePath(full); continue; }
                    if (!strcmp(f->status, "same") || !f->text) continue;
                    snprintf(tmp, sizeof tmp, "%s.r2d-tmp", full);
                    if (!strcmp(f->status, "conflict")) {
                        // Ручную версию не теряем: рядом .r2d-user.
                        char keep[2100];
                        snprintf(keep, sizeof keep, "%s.r2d-user", full);
                        SDL_RenamePath(full, keep);
                    }
                    SDL_RenamePath(tmp, full);
                }
                if (link_missing && etext) {
                    R2dSb e;
                    r2d_sb_init(&e);
                    // Подключение — первой строкой после шапки-комментария.
                    const char *p = etext;
                    while (!strncmp(p, "//", 2)) { const char *nl = strchr(p, '\n'); if (!nl) break; p = nl + 1; }
                    r2d_sb_printf(&e, "%.*s%s\n", (int)(p - etext), etext, link);
                    r2d_sb_puts(&e, p);
                    char tmp[2100];
                    snprintf(tmp, sizeof tmp, "%s.r2d-tmp", efull);
                    if (sdk_write_file(tmp, e.data, e.len)) SDL_RenamePath(tmp, efull);
                    r2d_sb_free(&e);
                    // Точка входа изменилась — индекс editor.graph обновляется сразу (иначе R2D206).
                    sdk_project_index_write(dir, &rep);
                }
                written = true;
            }
        }
        free(etext);
    }

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"written\":%s,\"stale\":%s,\"code_authored\":%s,", rep.errors == 0 ? "true" : "false",
                  written ? "true" : "false", stale ? "true" : "false", code_owned ? "true" : "false");
    sdk_put_kv_str(&out, "output", out_rel);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "entry", entry_rel);
    r2d_sb_printf(&out, ",\"entry_link\":{\"present\":%s,", link_missing ? "false" : "true");
    sdk_put_kv_str(&out, "line", link);
    r2d_sb_puts(&out, "},\"files\":[");
    for (int i = 0; i < g->count; ++i) {
        if (i) r2d_sb_putc(&out, ',');
        r2d_sb_putc(&out, '{');
        sdk_put_kv_str(&out, "path", g->files[i].rel);
        r2d_sb_putc(&out, ',');
        sdk_put_kv_str(&out, "status", g->files[i].status);
        r2d_sb_putc(&out, ',');
        sdk_put_kv_str(&out, "owner", code_owned ? "code" : "generator");
        if (print && g->files[i].text) { r2d_sb_putc(&out, ','); sdk_put_kv_str(&out, "text", g->files[i].text); }
        r2d_sb_putc(&out, '}');
    }
    r2d_sb_puts(&out, "],");
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    const int rc = rep.errors == 0 ? 0 : 1;
    for (int i = 0; i < g->count; ++i) free(g->files[i].text);
    free(g);
    r2d_sb_free(&out);
    catalog_free(&cat);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}

// ---------------------------------------------------------------------------
// Правка editor.snippets: add / set / remove
// ---------------------------------------------------------------------------
static R2dJson *jnew(const char *text)
{
    char err[64];
    return r2d_json_parse(text, err, sizeof err);
}

static R2dJson *jobj_find(R2dJson *o, const char *key)
{
    for (int i = 0; o && o->type == R2D_JSON_OBJ && i < o->count; ++i)
        if (!strcmp(o->keys[i], key)) return o->items[i];
    return NULL;
}

static void jobj_put(R2dJson *o, const char *key, R2dJson *val)
{
    for (int i = 0; i < o->count; ++i)
        if (!strcmp(o->keys[i], key)) { r2d_json_free(o->items[i]); o->items[i] = val; return; }
    o->keys = (char **)realloc(o->keys, sizeof(char *) * (size_t)(o->count + 1));
    o->items = (R2dJson **)realloc(o->items, sizeof(R2dJson *) * (size_t)(o->count + 1));
    o->keys[o->count] = strdup(key);
    o->items[o->count++] = val;
}

static void jobj_drop(R2dJson *o, const char *key)
{
    for (int i = 0; o && i < o->count; ++i) {
        if (strcmp(o->keys[i], key)) continue;
        free(o->keys[i]);
        r2d_json_free(o->items[i]);
        memmove(&o->keys[i], &o->keys[i + 1], sizeof(char *) * (size_t)(o->count - i - 1));
        memmove(&o->items[i], &o->items[i + 1], sizeof(R2dJson *) * (size_t)(o->count - i - 1));
        o->count--;
        return;
    }
}

static void jarr_push(R2dJson *a, R2dJson *v)
{
    a->items = (R2dJson **)realloc(a->items, sizeof(R2dJson *) * (size_t)(a->count + 1));
    a->items[a->count++] = v;
}

static R2dJson *jensure(R2dJson *o, const char *key, const char *init)
{
    R2dJson *v = jobj_find(o, key);
    if (!v) { v = jnew(init); jobj_put(o, key, v); }
    return v;
}

static R2dJson *section_of(R2dJson *root)
{
    R2dJson *ed = jensure(root, "editor", "{}");
    R2dJson *sn = jobj_find(ed, "snippets");
    if (!sn) {
        sn = jnew("{\"format\": 1, \"catalog_lock\": {}, \"instances\": [], \"sets\": [], "
                  "\"generation\": {\"output\": \"generated/snippets\", \"entry\": \"generated/snippets/index.js\"}}");
        jobj_put(ed, "snippets", sn);
    }
    return sn;
}

static void lock_pkg(R2dJson *sn, const SnipPkg *p)
{
    R2dJson *lock = jensure(sn, "catalog_lock", "{}");
    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_puts(&sb, "{");
    sdk_put_kv_str(&sb, "version", p->version);
    r2d_sb_putc(&sb, ',');
    sdk_put_kv_str(&sb, "manifest_hash", p->hash);
    r2d_sb_putc(&sb, ',');
    sdk_put_kv_str(&sb, "source", p->scope);
    r2d_sb_puts(&sb, "}");
    jobj_put(lock, p->id, jnew(sb.data));
    r2d_sb_free(&sb);
}

static int instance_index(const R2dJson *instances, const char *id)
{
    for (int i = 0; i < r2d_json_size(instances); ++i)
        if (!strcmp(r2d_json_str(r2d_json_get(r2d_json_at(instances, i), "id"), ""), id)) return i;
    return -1;
}

// Добавляет экземпляр пакета (kit раскрывается в состав + набор). Возвращает id.
static void add_instance(R2dJson *sn, const SnipCatalog *cat, const SnipPkg *p, const char *owner,
                         const char *id_override, const char *slot, R2dSb *added, SdkReport *rep, int depth)
{
    if (depth > 16) { diag(rep, SDK_ERROR, "SNIP081", p->manifest_path, p->id, NULL, "слишком глубокая вложенность kit"); return; }
    R2dJson *instances = jensure(sn, "instances", "[]");
    const char *short_owner = strchr(owner, ':') ? strchr(owner, ':') + 1 : owner;
    char iid[300];
    if (id_override) snprintf(iid, sizeof iid, "%s", id_override);
    else snprintf(iid, sizeof iid, "snippet:%s:%s", short_owner, p->id);
    lock_pkg(sn, p);
    if (!strcmp(p->kind, "kit")) {
        // Состав kit: каждая зависимость — свой экземпляр; сам kit — набор.
        R2dSb members;
        r2d_sb_init(&members);
        const R2dJson *deps = r2d_json_get(p->m, "dependencies");
        for (int i = 0; i < r2d_json_size(deps); ++i) {
            const R2dJson *d = r2d_json_at(deps, i);
            const char *did = d && d->type == R2D_JSON_STR ? d->string : jstr(d, "id");
            const SnipPkg *dp = catalog_find(cat, did);
            if (!dp) { diag(rep, SDK_ERROR, "SNIP080", p->manifest_path, p->id, NULL, "зависимость %s отсутствует", did ? did : "?"); continue; }
            // Участник «только для проекта» встаёт на project, остальные — на owner набора.
            const char *mowner = (pkg_targets(dp, "project") && !pkg_targets(dp, "node")) ? "project" : owner;
            const char *mshort = strchr(mowner, ':') ? strchr(mowner, ':') + 1 : mowner;
            add_instance(sn, cat, dp, mowner, NULL, NULL, added, rep, depth + 1);
            if (!strcmp(dp->kind, "kit")) continue;   // вложенный набор — свой set
            char mid[300];
            snprintf(mid, sizeof mid, "snippet:%s:%s", mshort, dp->id);
            if (members.len) r2d_sb_putc(&members, ',');
            r2d_sb_put_json_string(&members, mid);
        }
        R2dJson *sets = jensure(sn, "sets", "[]");
        char sid[300];
        snprintf(sid, sizeof sid, "set:%s:%s", short_owner, p->id);
        bool exists = false;
        for (int i = 0; i < sets->count; ++i) exists |= !strcmp(r2d_json_str(r2d_json_get(sets->items[i], "id"), ""), sid);
        if (!exists) {
            R2dSb s;
            r2d_sb_init(&s);
            r2d_sb_puts(&s, "{");
            sdk_put_kv_str(&s, "id", sid); r2d_sb_putc(&s, ',');
            sdk_put_kv_str(&s, "package", p->id); r2d_sb_putc(&s, ',');
            sdk_put_kv_str(&s, "version", p->version); r2d_sb_putc(&s, ',');
            sdk_put_kv_str(&s, "owner", owner);
            r2d_sb_printf(&s, ",\"members\":[%s]}", members.data ? members.data : "");
            jarr_push(sets, jnew(s.data));
            r2d_sb_free(&s);
        }
        r2d_sb_free(&members);
        return;
    }
    if (instance_index(instances, iid) >= 0) {
        if (depth == 0) diag(rep, SDK_ERROR, "SNIP144", "", p->id, iid, "экземпляр «%s» уже есть", iid);
        return;   // зависимость уже подключена — не дублируем
    }
    // Сначала зависимости behavior — на тот же owner.
    const R2dJson *deps = r2d_json_get(p->m, "dependencies");
    for (int i = 0; i < r2d_json_size(deps); ++i) {
        const R2dJson *d = r2d_json_at(deps, i);
        const char *did = d && d->type == R2D_JSON_STR ? d->string : jstr(d, "id");
        const SnipPkg *dp = catalog_find(cat, did);
        if (dp) add_instance(sn, cat, dp, owner, NULL, NULL, added, rep, depth + 1);
    }
    const R2dJson *slots = r2d_json_get(p->m, "slots");
    if (!slot && r2d_json_size(slots) > 0) slot = jstr(r2d_json_at(slots, 0), "id");
    R2dSb s;
    r2d_sb_init(&s);
    r2d_sb_puts(&s, "{");
    sdk_put_kv_str(&s, "id", iid); r2d_sb_putc(&s, ',');
    sdk_put_kv_str(&s, "package", p->id); r2d_sb_putc(&s, ',');
    sdk_put_kv_str(&s, "version", p->version); r2d_sb_putc(&s, ',');
    sdk_put_kv_str(&s, "owner", owner);
    if (slot) { r2d_sb_putc(&s, ','); sdk_put_kv_str(&s, "slot", slot); }
    r2d_sb_puts(&s, ",\"values\":{}}");
    // Порядок влияет на инициализацию: зависимости уже стоят раньше.
    jarr_push(instances, jnew(s.data));
    r2d_sb_free(&s);
    if (added->len) r2d_sb_putc(added, ',');
    r2d_sb_put_json_string(added, iid);
}

static int finish_edit(SdkReport *rep, const char *dir, R2dJson *root, bool dry, const char *extra)
{
    bool written = false;
    if (rep->errors == 0 && !dry) {
        g_skip_section = true;   // незаполненная конфигурация сохраняется; генерация её не пропустит
        written = sdk_project_manifest_write(dir, root, rep);
        g_skip_section = false;
    }
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"written\":%s,", rep->errors == 0 ? "true" : "false", written ? "true" : "false");
    if (extra) r2d_sb_puts(&out, extra);
    sdk_report_put_counts(rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    r2d_sb_free(&out);
    return rep->errors == 0 ? 0 : 1;
}

static R2dJson *load_v2(const char *dir, SdkReport *rep)
{
    char manifest[2048];
    sdk_join(dir, "project.json", manifest, sizeof manifest);
    R2dJson *root = sdk_load_json(manifest, rep);
    if (root && (root->type != R2D_JSON_OBJ || (int)r2d_json_num(r2d_json_get(root, "schema_version"), 0) != 2)) {
        diag(rep, SDK_ERROR, "SNIP140", manifest, NULL, NULL, "сниппеты живут в project.json schema 2 (r2d migrate-project)");
        r2d_json_free(root);
        return NULL;
    }
    return root;
}

static int cmd_add(const SdkArgs *a, const char *dir)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *pkg = sdk_arg_positional(a, 2);
    const char *owner = sdk_arg_value(a, "--owner");
    if (!pkg || !owner) return sdk_fail(&rep, "SDK_USAGE", "Использование: r2d snippet add <проект> <пакет> --owner object:<id>|project [--id ID] [--slot S]");
    R2dJson *root = load_v2(dir, &rep);
    SnipCatalog cat;
    catalog_load(&cat, sdk_arg_value(a, "--catalog"), dir, &rep);
    R2dSb added;
    r2d_sb_init(&added);
    if (root) {
        const SnipPkg *p = catalog_find(&cat, pkg);
        if (!p) diag(&rep, SDK_ERROR, "SNIP141", "", pkg, NULL, "пакета %s нет в каталоге", pkg);
        else if (!p->valid) diag(&rep, SDK_ERROR, "SNIP141", p->manifest_path, pkg, NULL, "пакет %s не прошёл проверку manifest", pkg);
        else if (strcmp(owner, "project") && !graph_has_entity(root, owner))
            diag(&rep, SDK_ERROR, "SNIP060", "", pkg, NULL, "owner «%s» не найден в editor.graph (r2d project-index --write)", owner);
        else {
            // Сохранение только ошибок правки: ошибки каталога к ней не относятся.
            SdkReport edit;
            sdk_report_init(&edit);
            add_instance(section_of(root), &cat, p, owner, sdk_arg_value(a, "--id"), sdk_arg_value(a, "--slot"), &added, &edit, 0);
            // Слоты и связи нового состава проверяются сразу; прежние ошибки секции правку не блокируют.
            SdkReport after;
            sdk_report_init(&after);
            char manifest[2048];
            sdk_join(dir, "project.json", manifest, sizeof manifest);
            g_skip_section = true;
            check_section(root, manifest, dir, &cat, &after);
            g_skip_section = false;
            const char *s = after.items.data ? after.items.data : "";
            for (const char *hit = s; (hit = strstr(hit, "\"code\":\"SNIP062\"")) != NULL; hit++) {
                // Сообщение о занятом слоте — по новому экземпляру.
                const char *m = strstr(hit, "\"message\":\"");
                if (m && added.data && strstr(added.data, "snippet:")) {
                    diag(&edit, SDK_ERROR, "SNIP062", manifest, p->id, NULL, "слот занят: уберите прежнее поведение этого слота у %s", owner);
                    break;
                }
            }
            sdk_report_free(&after);
            sdk_report_free(&rep);
            rep = edit;
        }
    }
    R2dSb extra;
    r2d_sb_init(&extra);
    r2d_sb_printf(&extra, "\"added\":[%s],", added.data ? added.data : "");
    int rc = root ? finish_edit(&rep, dir, root, sdk_arg_flag(a, "--dry-run"), extra.data)
                  : finish_edit(&rep, dir, NULL, true, extra.data);
    r2d_sb_free(&extra);
    r2d_sb_free(&added);
    catalog_free(&cat);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}

// set <проект> <экземпляр> поле=JSON … | disabled=true | slot="…" | links.<имя>="…"
static int cmd_set(const SdkArgs *a, const char *dir)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *iid = sdk_arg_positional(a, 2);
    if (!iid || !sdk_arg_positional(a, 3))
        return sdk_fail(&rep, "SDK_USAGE", "Использование: r2d snippet set <проект> <экземпляр> поле=JSON …");
    R2dJson *root = load_v2(dir, &rep);
    int applied = 0;
    if (root) {
        R2dJson *sn = section_of(root);
        R2dJson *instances = jensure(sn, "instances", "[]");
        const int idx = instance_index(instances, iid);
        if (idx < 0) diag(&rep, SDK_ERROR, "SNIP144", "", NULL, iid, "экземпляра «%s» нет", iid);
        for (int i = 3; idx >= 0 && sdk_arg_positional(a, i); ++i) {
            const char *pair = sdk_arg_positional(a, i);
            const char *eq = strchr(pair, '=');
            char key[128];
            if (!eq || (size_t)(eq - pair) >= sizeof key) { diag(&rep, SDK_ERROR, "SDK_USAGE", "", NULL, NULL, "«%s»: ожидалось поле=JSON", pair); break; }
            memcpy(key, pair, (size_t)(eq - pair));
            key[eq - pair] = 0;
            R2dJson *inst = instances->items[idx];
            const bool unset = !eq[1] || !strcmp(eq + 1, "null");
            R2dJson *val = unset ? NULL : jnew(eq + 1);
            if (!unset && !val) { diag(&rep, SDK_ERROR, "SNIP025", "", NULL, key, "%s: значение не JSON", key); break; }
            if (!strcmp(key, "disabled") || !strcmp(key, "slot")) {
                if (unset) jobj_drop(inst, key); else jobj_put(inst, key, val);
            } else if (!strncmp(key, "links.", 6)) {
                R2dJson *links = jensure(inst, "links", "{}");
                if (unset) jobj_drop(links, key + 6); else jobj_put(links, key + 6, val);
            } else {
                R2dJson *values = jensure(inst, "values", "{}");
                if (unset) jobj_drop(values, key); else jobj_put(values, key, val);
            }
            applied++;
        }
        // Проверка значений именно этого экземпляра — сразу (Inspector показывает рядом с полем).
        if (rep.errors == 0 && idx >= 0) {
            SnipCatalog cat;
            SdkReport cr;
            sdk_report_init(&cr);
            catalog_load(&cat, sdk_arg_value(a, "--catalog"), dir, &cr);
            const SnipPkg *p = catalog_find(&cat, jstr(instances->items[idx], "package"));
            char manifest[2048];
            sdk_join(dir, "project.json", manifest, sizeof manifest);
            if (p) check_values(instances->items[idx], p, manifest, dir, iid, &rep);
            // Неверное значение не пишется; незаполненное обязательное — пишется (SNIP027 — предупреждение здесь).
            catalog_free(&cat);
            sdk_report_free(&cr);
        }
    }
    // SNIP027 при правке другого поля не блокирует запись: понижаем до warning.
    if (rep.errors) {
        R2dSb fixed;
        r2d_sb_init(&fixed);
        int e = 0;
        const char *s = rep.items.data ? rep.items.data : "";
        // Записи диагностики — компактные объекты; ищем SNIP027 с severity error.
        const char *pat = "\"code\":\"SNIP027\",\"severity\":\"error\"";
        const char *p = s;
        while (*p) {
            const char *hit = strstr(p, pat);
            if (!hit) { r2d_sb_puts(&fixed, p); break; }
            r2d_sb_printf(&fixed, "%.*s\"code\":\"SNIP027\",\"severity\":\"warning\"", (int)(hit - p), p);
            p = hit + strlen(pat);
            e++;
        }
        r2d_sb_free(&rep.items);
        rep.items = fixed;
        rep.errors -= e;
        rep.warnings += e;
    }
    char extra[64];
    snprintf(extra, sizeof extra, "\"applied\":%d,", applied);
    int rc = finish_edit(&rep, dir, root, !root || sdk_arg_flag(a, "--dry-run"), extra);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}

static int cmd_remove(const SdkArgs *a, const char *dir)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *iid = sdk_arg_positional(a, 2);
    if (!iid) return sdk_fail(&rep, "SDK_USAGE", "Использование: r2d snippet remove <проект> <экземпляр|набор>");
    R2dJson *root = load_v2(dir, &rep);
    R2dSb removed;
    r2d_sb_init(&removed);
    if (root) {
        R2dJson *sn = section_of(root);
        R2dJson *instances = jensure(sn, "instances", "[]");
        R2dJson *sets = jensure(sn, "sets", "[]");
        // Набор удаляется вместе со всеми участниками.
        char ids[256][300];
        int n = 0;
        for (int i = 0; i < sets->count; ++i) {
            if (strcmp(r2d_json_str(r2d_json_get(sets->items[i], "id"), ""), iid)) continue;
            const R2dJson *m = r2d_json_get(sets->items[i], "members");
            for (int k = 0; k < r2d_json_size(m) && n < 256; ++k) snprintf(ids[n++], 300, "%s", r2d_json_str(r2d_json_at(m, k), ""));
            r2d_json_free(sets->items[i]);
            memmove(&sets->items[i], &sets->items[i + 1], sizeof(R2dJson *) * (size_t)(sets->count - i - 1));
            sets->count--;
            break;
        }
        if (!n) snprintf(ids[n++], 300, "%s", iid);
        for (int k = 0; k < n; ++k) {
            const int idx = instance_index(instances, ids[k]);
            if (idx < 0) { if (k == 0 && n == 1) diag(&rep, SDK_ERROR, "SNIP144", "", NULL, iid, "экземпляра «%s» нет", iid); continue; }
            // Кто-то зависит от удаляемого на том же owner? Сообщаем, не удаляем молча.
            const R2dJson *victim = instances->items[idx];
            r2d_json_free(instances->items[idx]);
            (void)victim;
            memmove(&instances->items[idx], &instances->items[idx + 1], sizeof(R2dJson *) * (size_t)(instances->count - idx - 1));
            instances->count--;
            if (removed.len) r2d_sb_putc(&removed, ',');
            r2d_sb_put_json_string(&removed, ids[k]);
            // Участник удаляется и из других наборов.
            for (int s = 0; s < sets->count; ++s) {
                R2dJson *m = jobj_find(sets->items[s], "members");
                for (int j = 0; m && j < m->count; ++j)
                    if (!strcmp(r2d_json_str(m->items[j], ""), ids[k])) {
                        r2d_json_free(m->items[j]);
                        memmove(&m->items[j], &m->items[j + 1], sizeof(R2dJson *) * (size_t)(m->count - j - 1));
                        m->count--;
                        break;
                    }
            }
        }
        // catalog_lock — только используемые пакеты.
        R2dJson *lock = jensure(sn, "catalog_lock", "{}");
        for (int i = lock->count - 1; i >= 0; --i) {
            bool used = false;
            for (int k = 0; k < instances->count && !used; ++k)
                used = !strcmp(r2d_json_str(r2d_json_get(instances->items[k], "package"), ""), lock->keys[i]);
            for (int k = 0; k < sets->count && !used; ++k)
                used = !strcmp(r2d_json_str(r2d_json_get(sets->items[k], "package"), ""), lock->keys[i]);
            if (!used) jobj_drop(lock, lock->keys[i]);
        }
        // Оставшиеся экземпляры, которым нужна удалённая зависимость, — ошибка: удаление не применяется.
        SnipCatalog cat;
        SdkReport cr;
        sdk_report_init(&cr);
        catalog_load(&cat, sdk_arg_value(a, "--catalog"), dir, &cr);
        char manifest[2048];
        sdk_join(dir, "project.json", manifest, sizeof manifest);
        SdkReport after;
        sdk_report_init(&after);
        g_skip_section = true;
        check_section(root, manifest, dir, &cat, &after);
        g_skip_section = false;
        if (after.items.data && strstr(after.items.data, "SNIP082"))
            diag(&rep, SDK_ERROR, "SNIP082", manifest, NULL, iid, "от «%s» зависят другие экземпляры — сначала удалите их", iid);
        sdk_report_free(&after);
        catalog_free(&cat);
        sdk_report_free(&cr);
    }
    R2dSb extra;
    r2d_sb_init(&extra);
    r2d_sb_printf(&extra, "\"removed\":[%s],", removed.data ? removed.data : "");
    int rc = finish_edit(&rep, dir, root, !root || sdk_arg_flag(a, "--dry-run"), extra.data);
    r2d_sb_free(&extra);
    r2d_sb_free(&removed);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}

// update <проект> [<пакет>]: экземпляры и lock → текущая версия каталога.
// Поля, которых нет в новой схеме, перечисляются (значения сохраняются, SNIP028).
static int cmd_update(const SdkArgs *a, const char *dir)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *only = sdk_arg_positional(a, 2);
    R2dJson *root = load_v2(dir, &rep);
    SnipCatalog cat;
    catalog_load(&cat, sdk_arg_value(a, "--catalog"), dir, &rep);
    R2dSb changes;
    r2d_sb_init(&changes);
    if (root) {
        SdkReport edit;
        sdk_report_init(&edit);
        R2dJson *sn = section_of(root);
        R2dJson *instances = jensure(sn, "instances", "[]");
        for (int i = 0; i < instances->count; ++i) {
            R2dJson *inst = instances->items[i];
            const char *pid = jstr(inst, "package");
            if (only && strcmp(only, pid ? pid : "")) continue;
            const SnipPkg *p = catalog_find(&cat, pid);
            if (!p) { diag(&edit, SDK_ERROR, "SNIP141", "", pid, NULL, "пакета %s нет в каталоге: экземпляр остаётся pinned", pid ? pid : "?"); continue; }
            const char *ver = jstr(inst, "version");
            const R2dJson *l = r2d_json_get(r2d_json_get(sn, "catalog_lock"), p->id);
            const bool same = ver && !strcmp(ver, p->version) && l &&
                              !strcmp(r2d_json_str(r2d_json_get(l, "manifest_hash"), ""), p->hash);
            if (same) continue;
            if (changes.len) r2d_sb_putc(&changes, ',');
            r2d_sb_putc(&changes, '{');
            sdk_put_kv_str(&changes, "instance", jstr(inst, "id")); r2d_sb_putc(&changes, ',');
            sdk_put_kv_str(&changes, "from", ver ? ver : ""); r2d_sb_putc(&changes, ',');
            sdk_put_kv_str(&changes, "to", p->version);
            r2d_sb_puts(&changes, ",\"dropped_fields\":[");
            const R2dJson *values = r2d_json_get(inst, "values");
            int nd = 0;
            for (int k = 0; k < r2d_json_size(values); ++k)
                if (!pkg_field(p, values->keys[k])) { if (nd++) r2d_sb_putc(&changes, ','); r2d_sb_put_json_string(&changes, values->keys[k]); }
            r2d_sb_puts(&changes, "]}");
            R2dSb v;
            r2d_sb_init(&v);
            r2d_sb_put_json_string(&v, p->version);
            jobj_put(inst, "version", jnew(v.data));
            r2d_sb_free(&v);
            lock_pkg(sn, p);
        }
        sdk_report_free(&rep);
        rep = edit;
    }
    R2dSb extra;
    r2d_sb_init(&extra);
    r2d_sb_printf(&extra, "\"changes\":[%s],", changes.data ? changes.data : "");
    int rc = finish_edit(&rep, dir, root, !root || sdk_arg_flag(a, "--dry-run"), extra.data);
    r2d_sb_free(&extra);
    r2d_sb_free(&changes);
    catalog_free(&cat);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}

// entity <проект> --id hero [--tag hero] [--x --y --w --h] [--body dynamic|static|none] [--remove]
// Новая сущность из Editor: запись editor.graph с origin "graph" и spawn;
// создание узла пишет генератор (обычный $), индексатор её сохраняет.
static int cmd_entity(const SdkArgs *a, const char *dir)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *id = sdk_arg_value(a, "--id");
    if (!id || !snip_key_ok(id) || strchr(id, ':') || strchr(id, '.'))
        return sdk_fail(&rep, "SDK_USAGE", "Использование: r2d snippet entity <проект> --id <id: a-z0-9_-> [--tag T] [--x N --y N --w N --h N] [--body dynamic|static|none] [--remove]");
    R2dJson *root = load_v2(dir, &rep);
    char key[160];
    snprintf(key, sizeof key, "object:%s", id);
    if (root) {
        R2dJson *graph = jensure(jensure(root, "editor", "{}"), "graph", "{\"format\": 1, \"status\": \"current\", \"sources\": [], \"diagnostics\": [], \"areas\": [], \"entities\": [], \"edges\": [], \"views\": {}}");
        R2dJson *ents = jensure(graph, "entities", "[]");
        R2dJson *areas = jensure(graph, "areas", "[]");
        int found = -1;
        for (int i = 0; i < ents->count; ++i)
            if (!strcmp(r2d_json_str(r2d_json_get(ents->items[i], "key"), ""), key)) found = i;
        if (sdk_arg_flag(a, "--remove")) {
            if (found < 0) diag(&rep, SDK_ERROR, "SNIP060", "", NULL, key, "сущности %s нет", key);
            else if (strcmp(r2d_json_str(r2d_json_get(ents->items[found], "origin"), ""), "graph"))
                diag(&rep, SDK_ERROR, "SNIP065", "", NULL, key, "%s создана кодом — удалите её в JS", key);
            else {
                const R2dJson *sn = r2d_json_get(r2d_json_get(root, "editor"), "snippets");
                const R2dJson *inst = r2d_json_get(sn, "instances");
                for (int i = 0; i < r2d_json_size(inst); ++i)
                    if (!strcmp(r2d_json_str(r2d_json_get(r2d_json_at(inst, i), "owner"), ""), key))
                        diag(&rep, SDK_ERROR, "SNIP065", "", NULL, key, "на %s подключены сниппеты — сначала удалите их", key);
                if (!rep.errors) {
                    r2d_json_free(ents->items[found]);
                    memmove(&ents->items[found], &ents->items[found + 1], sizeof(R2dJson *) * (size_t)(ents->count - found - 1));
                    ents->count--;
                }
            }
        } else if (found >= 0) {
            diag(&rep, SDK_ERROR, "SNIP065", "", NULL, key, "сущность %s уже есть в графе", key);
        } else {
            // Область: первый world графа; без неё — world:main от Editor.
            const char *area = NULL;
            for (int i = 0; i < areas->count && !area; ++i)
                if (!strcmp(r2d_json_str(r2d_json_get(areas->items[i], "type"), ""), "world")) area = jstr(areas->items[i], "key");
            if (!area) {
                jarr_push(areas, jnew("{\"key\": \"world:main\", \"type\": \"world\", \"label\": \"World\", \"runtime_root\": \"$.world\", \"origin\": \"graph\"}"));
                area = "world:main";
            }
            const char *body = sdk_arg_value(a, "--body");
            if (body && strcmp(body, "dynamic") && strcmp(body, "static") && strcmp(body, "kinematic") && strcmp(body, "none")) {
                diag(&rep, SDK_ERROR, "SNIP025", "", NULL, "body", "body: dynamic | static | kinematic | none");
            } else {
                R2dSb e;
                r2d_sb_init(&e);
                r2d_sb_puts(&e, "{");
                sdk_put_kv_str(&e, "key", key); r2d_sb_putc(&e, ',');
                sdk_put_kv_str(&e, "area", area); r2d_sb_putc(&e, ',');
                sdk_put_kv_str(&e, "type", "object"); r2d_sb_putc(&e, ',');
                sdk_put_kv_str(&e, "origin", "graph"); r2d_sb_putc(&e, ',');
                sdk_put_kv_str(&e, "tag", sdk_arg_value(a, "--tag") ? sdk_arg_value(a, "--tag") : id); r2d_sb_putc(&e, ',');
                sdk_put_kv_str(&e, "public_id", id);
                const char *nums[4] = { sdk_arg_value(a, "--x"), sdk_arg_value(a, "--y"), sdk_arg_value(a, "--w"), sdk_arg_value(a, "--h") };
                r2d_sb_printf(&e, ",\"spawn\":{\"x\":%g,\"y\":%g,\"w\":%g,\"h\":%g,", nums[0] ? atof(nums[0]) : 0.0,
                              nums[1] ? atof(nums[1]) : 0.0, nums[2] ? atof(nums[2]) : 32.0, nums[3] ? atof(nums[3]) : 32.0);
                sdk_put_kv_str(&e, "body", body ? body : "dynamic");
                r2d_sb_puts(&e, "}}");
                jarr_push(ents, jnew(e.data));
                r2d_sb_free(&e);
            }
        }
    }
    R2dSb extra;
    r2d_sb_init(&extra);
    r2d_sb_puts(&extra, "\"entity\":");
    r2d_sb_put_json_string(&extra, key);
    r2d_sb_putc(&extra, ',');
    int rc = finish_edit(&rep, dir, root, !root || sdk_arg_flag(a, "--dry-run"), extra.data);
    r2d_sb_free(&extra);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}

// own <проект> code|generator: владелец области generated/snippets.
// code — генератор её больше не пишет, файлы остаются как есть (ручной JS);
// generator — вернуть генератору (следующий generate покажет diff/конфликты).
static int cmd_own(const SdkArgs *a, const char *dir)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *who = sdk_arg_positional(a, 2);
    if (!who || (strcmp(who, "code") && strcmp(who, "generator")))
        return sdk_fail(&rep, "SDK_USAGE", "Использование: r2d snippet own <проект> code|generator");
    R2dJson *root = load_v2(dir, &rep);
    if (root) {
        R2dJson *gen = jensure(section_of(root), "generation", "{\"output\": \"generated/snippets\", \"entry\": \"generated/snippets/index.js\"}");
        if (!strcmp(who, "generator")) jobj_drop(gen, "ownership");
        else jobj_put(gen, "ownership", jnew("\"code\""));
    }
    R2dSb extra;
    r2d_sb_init(&extra);
    r2d_sb_puts(&extra, "\"ownership\":");
    r2d_sb_put_json_string(&extra, who);
    r2d_sb_putc(&extra, ',');
    int rc = finish_edit(&rep, dir, root, !root || sdk_arg_flag(a, "--dry-run"), extra.data);
    r2d_sb_free(&extra);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}

// rollback <проект>: вернуть project.json из project.json.bak (последняя запись
// r2d). Текущая версия не теряется: меняется местами с .bak. Повтор — откат отката.
static int cmd_rollback(const SdkArgs *a, const char *dir)
{
    SdkReport rep;
    sdk_report_init(&rep);
    char cur[2048], bak[2100], tmp[2100];
    sdk_join(dir, "project.json", cur, sizeof cur);
    snprintf(bak, sizeof bak, "%s.bak", cur);
    snprintf(tmp, sizeof tmp, "%s.r2d-swap", cur);
    bool done = false;
    if (!sdk_file_exists(bak)) diag(&rep, SDK_ERROR, "SNIP130", bak, NULL, NULL, "нет project.json.bak — откатывать нечего");
    else {
        SdkReport check;
        sdk_report_init(&check);
        sdk_validate_file(bak, "project", &check);
        // Незаполненные значения сниппетов откат не блокируют — как и запись.
        if (check.errors && (!check.items.data || strstr(check.items.data, "\"R2D"))) {
            diag(&rep, SDK_ERROR, "SNIP130", bak, NULL, NULL, "project.json.bak не проходит проверку — откат отменён");
        } else if (!sdk_arg_flag(a, "--dry-run")) {
            done = SDL_RenamePath(cur, tmp) && SDL_RenamePath(bak, cur) && SDL_RenamePath(tmp, bak);
            if (!done) diag(&rep, SDK_ERROR, "SNIP131", cur, NULL, NULL, "не удалось поменять project.json и .bak местами");
        }
        sdk_report_free(&check);
    }
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"rolled_back\":%s,", rep.errors == 0 ? "true" : "false", done ? "true" : "false");
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    r2d_sb_free(&out);
    const int rc = rep.errors == 0 ? 0 : 1;
    sdk_report_free(&rep);
    return rc;
}

// new <проект> <id> [--kind behavior|kit] [--title …] [--category …] [--deps a,b]
// Автор пакета: каркас пакета проекта в <проект>/snippets/<id>/, тот же
// контракт и та же проверка, что у встроенных.
static int cmd_new(const SdkArgs *a, const char *dir)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *id = sdk_arg_positional(a, 2);
    const char *kind = sdk_arg_value(a, "--kind") ? sdk_arg_value(a, "--kind") : "behavior";
    if (!id) return sdk_fail(&rep, "SDK_USAGE", "Использование: r2d snippet new <проект> <id> [--kind behavior|kit] [--title …] [--category …] [--deps a,b]");
    char pdir[1400];
    snprintf(pdir, sizeof pdir, "%s/snippets/%s", dir, id);
    if (!snip_id_ok(id)) diag(&rep, SDK_ERROR, "SNIP003", "", id, "id", "id: сегменты a-z0-9_- через точку");
    else if (strcmp(kind, "behavior") && strcmp(kind, "kit")) diag(&rep, SDK_ERROR, "SNIP006", "", id, "kind", "kind: behavior | kit");
    else if (sdk_is_dir(pdir)) diag(&rep, SDK_ERROR, "SNIP008", pdir, id, NULL, "пакет %s уже есть в проекте", id);
    const char *deps = sdk_arg_value(a, "--deps");
    if (!rep.errors && !strcmp(kind, "kit") && (!deps || !deps[0]))
        diag(&rep, SDK_ERROR, "SNIP080", "", id, "dependencies", "kit без состава — укажите --deps a,b");
    bool written = false;
    if (!rep.errors) {
        char sub[1500];
        SDL_CreateDirectory(pdir);
        static const char *const dirs[] = { "src", "examples", "tests" };
        for (int i = 0; i < 3; ++i) { snprintf(sub, sizeof sub, "%s/%s", pdir, dirs[i]); if (strcmp(kind, "kit") || i) SDL_CreateDirectory(sub); }
        const char *title = sdk_arg_value(a, "--title") ? sdk_arg_value(a, "--title") : id;
        R2dSb m;
        r2d_sb_init(&m);
        r2d_sb_puts(&m, "{\n  \"format\": \"r2d-snippet/1\",\n  \"id\": ");
        r2d_sb_put_json_string(&m, id);
        r2d_sb_puts(&m, ",\n  \"version\": \"1.0.0\",\n  \"title\": {\"ru\": ");
        r2d_sb_put_json_string(&m, title);
        r2d_sb_puts(&m, "},\n  \"description\": {\"ru\": \"\"},\n  \"kind\": ");
        r2d_sb_put_json_string(&m, kind);
        r2d_sb_puts(&m, ",\n  \"category\": ");
        r2d_sb_put_json_string(&m, sdk_arg_value(a, "--category") ? sdk_arg_value(a, "--category") : "Пакеты проекта");
        r2d_sb_puts(&m, ",\n  \"targets\": [\"node\"],\n  \"slots\": [],\n");
        if (!strcmp(kind, "kit")) {
            r2d_sb_puts(&m, "  \"requires\": [],\n  \"dependencies\": [");
            char buf[1024];
            snprintf(buf, sizeof buf, "%s", deps);
            int n = 0;
            for (char *tok = strtok(buf, ","); tok; tok = strtok(NULL, ",")) {
                while (*tok == ' ') tok++;
                r2d_sb_puts(&m, n++ ? ", {\"id\": " : "{\"id\": ");
                r2d_sb_put_json_string(&m, tok);
                r2d_sb_putc(&m, '}');
            }
            r2d_sb_puts(&m, "],\n  \"fields\": [],\n");
        } else {
            r2d_sb_puts(&m, "  \"requires\": [{\"api\": \"$.updateFor\"}],\n  \"dependencies\": [],\n"
                            "  \"fields\": [\n    {\"id\": \"speed\", \"label\": \"Скорость\", \"type\": \"number\", \"default\": 100, \"min\": 0, \"max\": 1000}\n  ],\n"
                            "  \"source\": \"src/behavior.js\",\n");
            snprintf(sub, sizeof sub, "%s/src/behavior.js", pdir);
            static const char k_src[] =
                "// Поведение пакета проекта: обычная функция (docs/SNIPPETS.md).\n"
                "// node — обёртка узла, config — значения полей Inspector, $ — API движка.\n"
                "// Вернуть disposer: $.updateFor уже возвращает его.\n"
                "export default function behavior(node, config, $) {\n"
                "    return $.updateFor(node, (dt, self) => {\n"
                "        // self.velocity(config.speed, self.velocity().y);\n"
                "    });\n"
                "}\n";
            sdk_write_file(sub, k_src, sizeof k_src - 1);
        }
        r2d_sb_puts(&m, "  \"examples\": [\"examples/example.json\"],\n  \"tests\": [\"tests/values.test.json\"],\n  \"tags\": []\n}\n");
        snprintf(sub, sizeof sub, "%s/snippet.json", pdir);
        sdk_write_file(sub, m.data, m.len);
        snprintf(sub, sizeof sub, "%s/examples/example.json", pdir);
        sdk_write_file(sub, "{\"owner\": \"object:hero\", \"values\": {}}\n", 40);
        snprintf(sub, sizeof sub, "%s/tests/values.test.json", pdir);
        sdk_write_file(sub, "{\"values\": {}}\n", 15);
        snprintf(sub, sizeof sub, "%s/README.md", pdir);
        R2dSb rd;
        r2d_sb_init(&rd);
        r2d_sb_printf(&rd, "# %s\n\nПакет проекта. Описание, поля и поведение — в snippet.json и src/behavior.js.\n", title);
        sdk_write_file(sub, rd.data, rd.len);
        r2d_sb_free(&rd);
        r2d_sb_free(&m);
        SnipPkg p;
        if (load_pkg(pdir, "project", &p, &rep)) r2d_json_free(p.m);
        written = rep.errors == 0;
    }
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"written\":%s,", rep.errors == 0 ? "true" : "false", written ? "true" : "false");
    sdk_put_kv_str(&out, "path", pdir);
    r2d_sb_putc(&out, ',');
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    r2d_sb_free(&out);
    const int rc = rep.errors == 0 ? 0 : 1;
    sdk_report_free(&rep);
    return rc;
}

// ---------------------------------------------------------------------------
// catalog / validate / check
// ---------------------------------------------------------------------------
static int cmd_catalog(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *project = sdk_arg_value(a, "--project");
    const char *query = sdk_arg_value(a, "--query");
    const char *id = sdk_arg_value(a, "--id");
    SnipCatalog cat;
    catalog_load(&cat, sdk_arg_value(a, "--catalog"), project, &rep);
    R2dJson *schema = sdk_arg_flag(a, "--strict") ? load_schema(sdk_arg_value(a, "--schema"), project, &rep) : NULL;
    if (sdk_arg_flag(a, "--strict")) catalog_check(&cat, schema, &rep);
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", rep.errors == 0 ? "true" : "false");
    sdk_put_kv_str(&out, "builtin_root", cat.builtin_root);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "project_root", cat.project_root);
    r2d_sb_printf(&out, ",\"total\":%d,\"packages\":[", cat.count);
    int shown = 0;
    for (int i = 0; i < cat.count; ++i) {
        if (id && strcmp(cat.items[i].id, id)) continue;
        if (!pkg_matches(&cat.items[i], query)) continue;
        if (shown++) r2d_sb_putc(&out, ',');
        put_pkg_json(&out, &cat.items[i], id != NULL || sdk_arg_flag(a, "--fields"));
    }
    r2d_sb_printf(&out, "],\"shown\":%d,", shown);
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    const int rc = rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    r2d_json_free(schema);
    catalog_free(&cat);
    sdk_report_free(&rep);
    return rc;
}

static int cmd_validate_pkg(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *path = sdk_arg_positional(a, 1);
    if (!path) return sdk_fail(&rep, "SDK_USAGE", "Использование: r2d snippet validate <каталог пакета|snippet.json>");
    char dir[1200];
    if (sdk_ends_with(path, ".json")) sdk_dirname(path, dir, sizeof dir);
    else snprintf(dir, sizeof dir, "%s", path);
    SnipPkg p;
    if (!load_pkg(dir, "project", &p, &rep))
        diag(&rep, SDK_ERROR, "SNIP001", dir, NULL, NULL, "в «%s» нет snippet.json", dir);
    else {
        R2dJson *schema = load_schema(sdk_arg_value(a, "--schema"), NULL, &rep);
        if (schema) { resolve_api(&p, schema, &rep); check_source_api(&p, schema, &rep); }
        // Зависимости — по полному каталогу (встроенный + проект вокруг пакета, если есть).
        SnipCatalog cat;
        SdkReport cr;
        sdk_report_init(&cr);
        catalog_load(&cat, sdk_arg_value(a, "--catalog"), sdk_arg_value(a, "--project"), &cr);
        const R2dJson *deps = r2d_json_get(p.m, "dependencies");
        for (int i = 0; i < r2d_json_size(deps); ++i) {
            const R2dJson *d = r2d_json_at(deps, i);
            const char *did = d && d->type == R2D_JSON_STR ? d->string : jstr(d, "id");
            if (did && !catalog_find(&cat, did))
                diag(&rep, SDK_ERROR, "SNIP080", p.manifest_path, p.id, "dependencies", "зависимость %s отсутствует в каталоге", did);
        }
        catalog_free(&cat);
        sdk_report_free(&cr);
        r2d_json_free(schema);
    }
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"package\":", rep.errors == 0 ? "true" : "false");
    if (p.m) put_pkg_json(&out, &p, true); else r2d_sb_puts(&out, "null");
    r2d_sb_putc(&out, ',');
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    const int rc = rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    r2d_json_free(p.m);
    sdk_report_free(&rep);
    return rc;
}

static int cmd_check(const SdkArgs *a, const char *dir)
{
    SdkReport rep;
    sdk_report_init(&rep);
    R2dJson *root = load_v2(dir, &rep);
    R2dSb inst;
    r2d_sb_init(&inst);
    if (root) {
        char manifest[2048];
        sdk_join(dir, "project.json", manifest, sizeof manifest);
        SnipCatalog cat;
        catalog_load(&cat, sdk_arg_value(a, "--catalog"), dir, &rep);
        check_section(root, manifest, dir, &cat, &rep);
        catalog_free(&cat);
        const R2dJson *sn = r2d_json_get(r2d_json_get(root, "editor"), "snippets");
        if (sn) sdk_json_put_compact(&inst, sn);
    }
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"snippets\":%s,", rep.errors == 0 ? "true" : "false", inst.data ? inst.data : "null");
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    const int rc = rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    r2d_sb_free(&inst);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}

int sdk_cmd_snippet(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *sub = sdk_arg_positional(a, 0);
    const char *dir = sdk_arg_positional(a, 1);
    if (sub && !strcmp(sub, "catalog")) return cmd_catalog(a);
    if (sub && !strcmp(sub, "validate")) return cmd_validate_pkg(a);
    if (sub && dir) {
        if (!strcmp(sub, "check")) return cmd_check(a, dir);
        if (!strcmp(sub, "add")) return cmd_add(a, dir);
        if (!strcmp(sub, "set")) return cmd_set(a, dir);
        if (!strcmp(sub, "remove")) return cmd_remove(a, dir);
        if (!strcmp(sub, "update")) return cmd_update(a, dir);
        if (!strcmp(sub, "generate")) return cmd_generate(a, dir);
        if (!strcmp(sub, "entity")) return cmd_entity(a, dir);
        if (!strcmp(sub, "new")) return cmd_new(a, dir);
        if (!strcmp(sub, "own")) return cmd_own(a, dir);
        if (!strcmp(sub, "rollback")) return cmd_rollback(a, dir);
    }
    return sdk_fail(&rep, "SDK_USAGE",
                    "Использование: r2d snippet catalog [--project P] [--query Q] [--id ID] [--strict] | "
                    "validate <пакет> | check|generate [--write|--check|--overwrite|--print] <проект> | "
                    "add <проект> <пакет> --owner KEY | set <проект> <экземпляр> поле=JSON | "
                    "remove <проект> <экземпляр|набор> | update <проект> [пакет] | "
                    "entity <проект> --id ID [--tag T --x --y --w --h --body] [--remove] | new <проект> <id> [--kind] [--title] | "
                    "own <проект> code|generator | rollback <проект>");
}
