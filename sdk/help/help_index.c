// ===========================================================================
// r2d-help: индекс (формат файла), токенизатор, BM25 и слияние с эмбеддингами.
//
// Формат файла (little-endian), версия HELP_INDEX_FORMAT:
//   magic[8] "R2DHELP1", u32 format, u32 count, u32 dim, u64 sources_hash,
//   str model_id; затем count записей:
//   u8 kind, str name, str module, str signature, str location, str doc,
//   str text, u64 text_hash, f32 scale, i8 vec[dim] (если dim > 0).
//   str — u32 длина + байты без нуля.
// Порядок записей фиксирован (порядок сбора), поэтому при равных оценках
// результат одинаков на всех платформах.
// ===========================================================================
#include "help.h"

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

const char *help_kind_name(int kind)
{
    switch (kind) {
    case HELP_KIND_METHOD: return "method";
    case HELP_KIND_NS:     return "function";
    case HELP_KIND_DOC:    return "doc";
    default:               return "unknown";
    }
}

uint64_t help_fnv1a(const void *data, size_t size, uint64_t seed)
{
    const uint8_t *p = (const uint8_t *)data;
    uint64_t h = seed ? seed : 1469598103934665603ull;
    for (size_t i = 0; i < size; ++i) {
        h ^= p[i];
        h *= 1099511628211ull;
    }
    return h;
}

static char *dup_str(const char *s)
{
    if (!s) s = "";
    const size_t n = strlen(s);
    char *r = (char *)malloc(n + 1);
    if (r) memcpy(r, s, n + 1);
    return r;
}

void help_index_init(HelpIndex *ix)
{
    memset(ix, 0, sizeof *ix);
}

static void entry_free(HelpEntry *e)
{
    free(e->name); free(e->module); free(e->signature);
    free(e->location); free(e->doc); free(e->text); free(e->vec);
}

void help_index_free(HelpIndex *ix)
{
    for (int i = 0; i < ix->count; ++i) entry_free(&ix->items[i]);
    free(ix->items);
    help_index_init(ix);
}

HelpEntry *help_index_add(HelpIndex *ix, int kind, const char *name, const char *module,
                          const char *signature, const char *location, const char *doc,
                          const char *text)
{
    if (ix->count == ix->cap) {
        const int cap = ix->cap ? ix->cap * 2 : 256;
        HelpEntry *items = (HelpEntry *)realloc(ix->items, (size_t)cap * sizeof *items);
        if (!items) return NULL;
        ix->items = items;
        ix->cap = cap;
    }
    HelpEntry *e = &ix->items[ix->count++];
    memset(e, 0, sizeof *e);
    e->kind = kind;
    e->name = dup_str(name);
    e->module = dup_str(module);
    e->signature = dup_str(signature);
    e->location = dup_str(location);
    e->doc = dup_str(doc);
    e->text = dup_str(text);
    e->text_hash = help_fnv1a(e->text, strlen(e->text), 0);
    return e;
}

void help_quantize(const float *v, int dim, int8_t *out, float *scale)
{
    float m = 0.0f;
    for (int i = 0; i < dim; ++i) {
        const float a = fabsf(v[i]);
        if (a > m) m = a;
    }
    const float s = m > 0.0f ? m / 127.0f : 1.0f;
    for (int i = 0; i < dim; ++i) {
        long q = lroundf(v[i] / s);
        if (q > 127) q = 127;
        if (q < -127) q = -127;
        out[i] = (int8_t)q;
    }
    *scale = s;
}

// ---------------------------------------------------------------------------
// Файл индекса
// ---------------------------------------------------------------------------
static bool put_u32(FILE *f, uint32_t v)
{
    uint8_t b[4] = { (uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24) };
    return fwrite(b, 1, 4, f) == 4;
}

static bool put_u64(FILE *f, uint64_t v)
{
    return put_u32(f, (uint32_t)v) && put_u32(f, (uint32_t)(v >> 32));
}

static bool put_f32(FILE *f, float v)
{
    uint32_t u;
    memcpy(&u, &v, 4);
    return put_u32(f, u);
}

static bool put_str(FILE *f, const char *s)
{
    const uint32_t n = (uint32_t)strlen(s ? s : "");
    return put_u32(f, n) && (n == 0 || fwrite(s, 1, n, f) == n);
}

bool help_index_save(const HelpIndex *ix, const char *path)
{
    // Атомарно: пишем во временный файл и переименовываем, чтобы прерванная
    // сборка не оставила полуиндекс (так же пишет PNG/JSON бэкенд SDK).
    char tmp[2048];
    snprintf(tmp, sizeof tmp, "%s.tmp", path);
    FILE *f = fopen(tmp, "wb");
    if (!f) return false;
    bool ok = fwrite(HELP_INDEX_MAGIC, 1, 8, f) == 8 &&
              put_u32(f, HELP_INDEX_FORMAT) &&
              put_u32(f, (uint32_t)ix->count) &&
              put_u32(f, (uint32_t)ix->dim) &&
              put_u64(f, ix->sources_hash) &&
              put_str(f, ix->model_id);
    for (int i = 0; ok && i < ix->count; ++i) {
        const HelpEntry *e = &ix->items[i];
        const uint8_t kind = (uint8_t)e->kind;
        ok = fwrite(&kind, 1, 1, f) == 1 &&
             put_str(f, e->name) && put_str(f, e->module) && put_str(f, e->signature) &&
             put_str(f, e->location) && put_str(f, e->doc) && put_str(f, e->text) &&
             put_u64(f, e->text_hash) && put_f32(f, e->vec ? e->vec_scale : 0.0f);
        if (ok && ix->dim > 0) {
            static const int8_t zero[4096];
            const void *src = e->vec ? (const void *)e->vec : (const void *)zero;
            ok = ix->dim <= 4096 && fwrite(src, 1, (size_t)ix->dim, f) == (size_t)ix->dim;
        }
    }
    ok = (fclose(f) == 0) && ok;
    if (!ok) { remove(tmp); return false; }
    remove(path);
    if (rename(tmp, path) != 0) { remove(tmp); return false; }
    return true;
}

typedef struct Reader {
    const uint8_t *p;
    size_t left;
    bool ok;
} Reader;

static uint32_t get_u32(Reader *r)
{
    if (!r->ok || r->left < 4) { r->ok = false; return 0; }
    const uint32_t v = (uint32_t)r->p[0] | ((uint32_t)r->p[1] << 8) |
                       ((uint32_t)r->p[2] << 16) | ((uint32_t)r->p[3] << 24);
    r->p += 4; r->left -= 4;
    return v;
}

static uint64_t get_u64(Reader *r)
{
    const uint64_t lo = get_u32(r);
    const uint64_t hi = get_u32(r);
    return lo | (hi << 32);
}

static float get_f32(Reader *r)
{
    const uint32_t u = get_u32(r);
    float v;
    memcpy(&v, &u, 4);
    return v;
}

static char *get_str(Reader *r)
{
    const uint32_t n = get_u32(r);
    if (!r->ok || r->left < n) { r->ok = false; return NULL; }
    char *s = (char *)malloc((size_t)n + 1);
    if (!s) { r->ok = false; return NULL; }
    memcpy(s, r->p, n);
    s[n] = '\0';
    r->p += n; r->left -= n;
    return s;
}

bool help_index_load(HelpIndex *ix, const char *path)
{
    help_index_init(ix);
    size_t size = 0;
    char *data = sdk_read_file(path, &size);
    if (!data) return false;
    Reader r = { (const uint8_t *)data, size, true };
    if (size < 8 || memcmp(data, HELP_INDEX_MAGIC, 8) != 0) { free(data); return false; }
    r.p += 8; r.left -= 8;
    const uint32_t format = get_u32(&r);
    const uint32_t count = get_u32(&r);
    const uint32_t dim = get_u32(&r);
    ix->sources_hash = get_u64(&r);
    char *model = get_str(&r);
    if (!r.ok || format != HELP_INDEX_FORMAT || dim > 4096) { free(model); free(data); return false; }
    snprintf(ix->model_id, sizeof ix->model_id, "%s", model);
    free(model);
    ix->dim = (int)dim;
    for (uint32_t i = 0; r.ok && i < count; ++i) {
        if (r.left < 1) { r.ok = false; break; }
        const int kind = r.p[0];
        r.p += 1; r.left -= 1;
        char *name = get_str(&r), *module = get_str(&r), *sig = get_str(&r);
        char *loc = get_str(&r), *doc = get_str(&r), *text = get_str(&r);
        const uint64_t th = get_u64(&r);
        const float scale = get_f32(&r);
        HelpEntry *e = NULL;
        if (r.ok) e = help_index_add(ix, kind, name, module, sig, loc, doc, text);
        free(name); free(module); free(sig); free(loc); free(doc); free(text);
        if (!e) { r.ok = false; break; }
        e->text_hash = th;
        if (dim > 0) {
            if (r.left < dim) { r.ok = false; break; }
            if (scale > 0.0f) {
                e->vec = (int8_t *)malloc(dim);
                if (!e->vec) { r.ok = false; break; }
                memcpy(e->vec, r.p, dim);
                e->vec_scale = scale;
            }
            r.p += dim; r.left -= dim;
        }
    }
    free(data);
    if (!r.ok) { help_index_free(ix); return false; }
    return true;
}

// ---------------------------------------------------------------------------
// Токенизатор
// ---------------------------------------------------------------------------
// Основа слова — первые STEM_CP кодовых точек: «навигация/навигации/навигацию»
// и «navigation/navigate» дают общую основу. Грубо, но без словарей и
// одинаково для русского и английского; смысловую близость добирают эмбеддинги.
#define STEM_CP 6
#define MAX_TOK 96

static const char *const STOP[] = {
    "и", "в", "во", "на", "по", "с", "со", "к", "ко", "о", "об", "от", "до", "из",
    "за", "для", "как", "что", "это", "так", "же", "ли", "не", "но", "а", "или",
    "мне", "я", "мы", "его", "её", "их", "чтобы", "надо", "нужно", "можно", "как-то",
    "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are", "be",
    "how", "do", "i", "it", "with", "by", "can", "what", "this", "that",
    NULL,
};

static bool is_stop(const char *t, size_t n)
{
    for (int i = 0; STOP[i]; ++i) {
        if (strlen(STOP[i]) == n && memcmp(STOP[i], t, n) == 0) return true;
    }
    return false;
}

// Декодирует одну кодовую точку UTF-8; возвращает длину (≥1).
static int utf8_next(const unsigned char *s, uint32_t *cp)
{
    if (s[0] < 0x80) { *cp = s[0]; return 1; }
    if ((s[0] & 0xE0) == 0xC0 && (s[1] & 0xC0) == 0x80) {
        *cp = ((uint32_t)(s[0] & 0x1F) << 6) | (s[1] & 0x3F);
        return 2;
    }
    if ((s[0] & 0xF0) == 0xE0 && (s[1] & 0xC0) == 0x80 && (s[2] & 0xC0) == 0x80) {
        *cp = ((uint32_t)(s[0] & 0x0F) << 12) | ((uint32_t)(s[1] & 0x3F) << 6) | (s[2] & 0x3F);
        return 3;
    }
    if ((s[0] & 0xF8) == 0xF0 && (s[1] & 0xC0) == 0x80 && (s[2] & 0xC0) == 0x80 &&
        (s[3] & 0xC0) == 0x80) {
        *cp = ((uint32_t)(s[0] & 0x07) << 18) | ((uint32_t)(s[1] & 0x3F) << 12) |
              ((uint32_t)(s[2] & 0x3F) << 6) | (s[3] & 0x3F);
        return 4;
    }
    *cp = 0xFFFD;
    return 1;
}

static int utf8_put(uint32_t cp, char *out)
{
    if (cp < 0x80) { out[0] = (char)cp; return 1; }
    if (cp < 0x800) {
        out[0] = (char)(0xC0 | (cp >> 6));
        out[1] = (char)(0x80 | (cp & 0x3F));
        return 2;
    }
    if (cp < 0x10000) {
        out[0] = (char)(0xE0 | (cp >> 12));
        out[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
        out[2] = (char)(0x80 | (cp & 0x3F));
        return 3;
    }
    out[0] = (char)(0xF0 | (cp >> 18));
    out[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
    out[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[3] = (char)(0x80 | (cp & 0x3F));
    return 4;
}

static bool is_word_cp(uint32_t cp)
{
    if (cp < 0x80) return (cp >= '0' && cp <= '9') || (cp >= 'a' && cp <= 'z') ||
                          (cp >= 'A' && cp <= 'Z') || cp == '_';
    return (cp >= 0x0400 && cp <= 0x04FF) || (cp >= 0x00C0 && cp <= 0x024F);
}

static uint32_t lower_cp(uint32_t cp)
{
    if (cp >= 'A' && cp <= 'Z') return cp + 32;
    if (cp >= 0x0410 && cp <= 0x042F) return cp + 32;   // А-Я
    if (cp == 0x0401 || cp == 0x0451) return 0x0435;   // Ё/ё → е
    return cp;
}

static bool is_upper_ascii(uint32_t cp) { return cp >= 'A' && cp <= 'Z'; }

// Нормализует и отдаёт один токен (с основой для длинных слов).
static void emit(const uint32_t *cps, int n, HelpTokenFn fn, void *user, bool stem)
{
    if (n <= 0) return;
    char buf[MAX_TOK * 4 + 1];
    int len = 0;
    const int lim = (stem && n > STEM_CP) ? STEM_CP : n;
    for (int i = 0; i < lim && i < MAX_TOK; ++i) len += utf8_put(lower_cp(cps[i]), buf + len);
    buf[len] = '\0';
    if (is_stop(buf, (size_t)len)) return;
    if (n == 1 && cps[0] < 0x80 && !(cps[0] >= '0' && cps[0] <= '9')) return;  // одиночные буквы
    fn(buf, (size_t)len, user);
}

void help_tokenize(const char *text, HelpTokenFn fn, void *user)
{
    const unsigned char *s = (const unsigned char *)text;
    uint32_t word[MAX_TOK];
    while (*s) {
        uint32_t cp;
        int k = utf8_next(s, &cp);
        if (!is_word_cp(cp)) { s += k; continue; }
        int n = 0;
        bool camel = false, under = false;
        while (*s) {
            k = utf8_next(s, &cp);
            if (!is_word_cp(cp)) break;
            if (n > 0 && is_upper_ascii(cp) && !is_upper_ascii(word[n - 1])) camel = true;
            if (cp == '_') under = true;
            if (n < MAX_TOK) word[n++] = cp;
            s += k;
        }
        if (camel || under) {
            // Идентификатор: целиком (точное совпадение имени API) и по частям.
            emit(word, n, fn, user, false);
            int start = 0;
            for (int i = 1; i <= n; ++i) {
                const bool cut = i == n || word[i] == '_' ||
                                 (is_upper_ascii(word[i]) && !is_upper_ascii(word[i - 1]));
                if (!cut) continue;
                int a = start, b = i;
                while (a < b && word[a] == '_') ++a;
                emit(word + a, b - a, fn, user, true);
                start = i;
            }
        } else {
            emit(word, n, fn, user, true);
        }
    }
}

// ---------------------------------------------------------------------------
// Поиск: BM25 по всем записям + косинус по векторам, слияние рангов (RRF)
// ---------------------------------------------------------------------------
#define MAX_QTERMS 32

typedef struct QTerms {
    char     term[MAX_QTERMS][MAX_TOK * 4 + 1];
    uint64_t hash[MAX_QTERMS];
    int      n;
} QTerms;

static void add_qterm(const char *tok, size_t len, void *user)
{
    QTerms *q = (QTerms *)user;
    const uint64_t h = help_fnv1a(tok, len, 0);
    for (int i = 0; i < q->n; ++i) if (q->hash[i] == h) return;
    if (q->n >= MAX_QTERMS) return;
    memcpy(q->term[q->n], tok, len);
    q->term[q->n][len] = '\0';
    q->hash[q->n++] = h;
}

typedef struct DocCount {
    const QTerms *q;
    int tf[MAX_QTERMS];
    int len;
} DocCount;

static void count_tok(const char *tok, size_t len, void *user)
{
    DocCount *d = (DocCount *)user;
    d->len++;
    const uint64_t h = help_fnv1a(tok, len, 0);
    for (int i = 0; i < d->q->n; ++i) if (d->q->hash[i] == h) { d->tf[i]++; break; }
}

// «.navigateTo» / «$.nav.find» → «navigateto» / «find»: последнее звено имени.
static void bare_name(const char *name, char *out, size_t cap)
{
    const char *p = strrchr(name, '.');
    p = p ? p + 1 : name;
    size_t n = 0;
    while (*p && *p != '(' && n + 1 < cap) out[n++] = (char)lower_cp((unsigned char)*p++);
    out[n] = '\0';
}

// Полное имя в нижнем регистре без «$.» и ведущей точки: «nav.find».
static void dotted_name(const char *name, char *out, size_t cap)
{
    if (name[0] == '$' && name[1] == '.') name += 2;
    else if (name[0] == '.') name += 1;
    size_t n = 0;
    while (*name && *name != '(' && n + 1 < cap) out[n++] = (char)lower_cp((unsigned char)*name++);
    out[n] = '\0';
}

typedef struct Scored {
    int    idx;
    double v;
} Scored;

static int cmp_scored(const void *a, const void *b)
{
    const Scored *x = (const Scored *)a, *y = (const Scored *)b;
    if (x->v > y->v) return -1;
    if (x->v < y->v) return 1;
    return x->idx - y->idx;   // детерминированно при равенстве
}

static int cmp_hits(const void *a, const void *b)
{
    const HelpHit *x = (const HelpHit *)a, *y = (const HelpHit *)b;
    if (x->score > y->score) return -1;
    if (x->score < y->score) return 1;
    return x->entry - y->entry;
}

// Слова запроса как есть (без основы) — для сравнения с именами API.
typedef struct RawWords {
    char w[MAX_QTERMS][128];
    int  n;
} RawWords;

static void raw_words(const char *q, RawWords *rw)
{
    rw->n = 0;
    const unsigned char *s = (const unsigned char *)q;
    while (*s && rw->n < MAX_QTERMS) {
        while (*s && !(isalnum(*s) || *s == '_' || *s == '.' || *s == '$')) ++s;
        size_t n = 0;
        while (*s && (isalnum(*s) || *s == '_' || *s == '.' || *s == '$')) {
            if (n + 1 < sizeof rw->w[0]) rw->w[rw->n][n++] = (char)lower_cp(*s);
            ++s;
        }
        if (n == 0) { if (*s) ++s; continue; }
        rw->w[rw->n][n] = '\0';
        // «$.nav.find(…)» → «nav.find»; «.navigateTo» → «navigateto»
        char *w = rw->w[rw->n];
        char *start = w;
        if (start[0] == '$' && start[1] == '.') start += 2;
        while (*start == '.') ++start;
        size_t len = strlen(start);
        while (len > 0 && start[len - 1] == '.') start[--len] = '\0';
        memmove(w, start, len + 1);
        if (len > 0) rw->n++;
    }
}

int help_search(const HelpIndex *ix, const char *query, const float *qvec,
                HelpHit *out, int max_out)
{
    if (ix->count == 0 || max_out <= 0) return 0;
    QTerms q;
    memset(&q, 0, sizeof q);
    help_tokenize(query, add_qterm, &q);

    const int N = ix->count;
    double *bm = (double *)calloc((size_t)N, sizeof *bm);
    double *cs = (double *)malloc((size_t)N * sizeof *cs);
    int *df = (int *)calloc(MAX_QTERMS, sizeof *df);
    int (*tf)[MAX_QTERMS] = (int (*)[MAX_QTERMS])calloc((size_t)N, sizeof *tf);
    int *dl = (int *)calloc((size_t)N, sizeof *dl);
    Scored *order = (Scored *)malloc((size_t)N * sizeof *order);
    HelpHit *hits = (HelpHit *)malloc((size_t)N * sizeof *hits);
    if (!bm || !cs || !df || !tf || !dl || !order || !hits) {
        free(bm); free(cs); free(df); free(tf); free(dl); free(order); free(hits);
        return 0;
    }

    // BM25 (k1 = 1.2, b = 0.75). Имя и сигнатура входят в текст записи.
    double avg = 0.0;
    for (int i = 0; i < N; ++i) {
        DocCount d;
        memset(&d, 0, sizeof d);
        d.q = &q;
        help_tokenize(ix->items[i].text, count_tok, &d);
        dl[i] = d.len;
        avg += d.len;
        for (int t = 0; t < q.n; ++t) {
            tf[i][t] = d.tf[t];
            if (d.tf[t] > 0) df[t]++;
        }
    }
    avg = N > 0 ? avg / N : 1.0;
    if (avg <= 0.0) avg = 1.0;
    for (int i = 0; i < N; ++i) {
        double s = 0.0;
        for (int t = 0; t < q.n; ++t) {
            if (tf[i][t] == 0) continue;
            const double idf = log(1.0 + (N - df[t] + 0.5) / (df[t] + 0.5));
            const double f = tf[i][t];
            s += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * dl[i] / avg));
        }
        bm[i] = s;
    }

    // Косинус: векторы нормированы до квантования, поэтому скалярное
    // произведение ≈ косинусу. Запись без вектора в смысловой ранг не входит.
    const bool use_vec = qvec && ix->dim > 0;
    for (int i = 0; i < N; ++i) {
        cs[i] = -2.0;
        const HelpEntry *e = &ix->items[i];
        if (!use_vec || !e->vec) continue;
        double dot = 0.0;
        for (int k = 0; k < ix->dim; ++k) dot += (double)qvec[k] * (double)e->vec[k];
        cs[i] = dot * e->vec_scale;
    }

    // Ранги по каждому сигналу.
    double *rrf = (double *)calloc((size_t)N, sizeof *rrf);
    if (!rrf) { free(bm); free(cs); free(df); free(tf); free(dl); free(order); free(hits); return 0; }
    const double K = 60.0;
    for (int i = 0; i < N; ++i) { order[i].idx = i; order[i].v = bm[i]; }
    qsort(order, (size_t)N, sizeof *order, cmp_scored);
    for (int r = 0; r < N; ++r) if (order[r].v > 0.0) rrf[order[r].idx] += 1.0 / (K + r + 1);
    if (use_vec) {
        for (int i = 0; i < N; ++i) { order[i].idx = i; order[i].v = cs[i]; }
        qsort(order, (size_t)N, sizeof *order, cmp_scored);
        for (int r = 0; r < N; ++r) if (order[r].v > -2.0) rrf[order[r].idx] += 1.0 / (K + r + 1);
    }

    // Точное имя API в запросе («navigateTo», «$.nav.find») поднимает запись
    // наверх: агент часто спрашивает про уже известное имя.
    RawWords rw;
    raw_words(query, &rw);
    for (int i = 0; i < N; ++i) {
        const HelpEntry *e = &ix->items[i];
        if (e->kind == HELP_KIND_DOC) continue;
        char bare[128], dotted[192];
        bare_name(e->name, bare, sizeof bare);
        dotted_name(e->name, dotted, sizeof dotted);
        for (int w = 0; w < rw.n; ++w) {
            if (strcmp(rw.w[w], dotted) == 0) { rrf[i] += 1.0; break; }
            if (bare[0] && strcmp(rw.w[w], bare) == 0) { rrf[i] += 0.5; break; }
        }
    }

    int n = 0;
    for (int i = 0; i < N; ++i) {
        if (rrf[i] <= 0.0) continue;
        hits[n].entry = i;
        // Округление: крошечные расхождения float между платформами не
        // переставляют результаты с равной по смыслу оценкой.
        hits[n].score = floor(rrf[i] * 1e6 + 0.5) / 1e6;
        hits[n].bm25 = floor(bm[i] * 1e4 + 0.5) / 1e4;
        hits[n].cosine = cs[i] > -2.0 ? floor(cs[i] * 1e4 + 0.5) / 1e4 : -2.0;
        n++;
    }
    qsort(hits, (size_t)n, sizeof *hits, cmp_hits);
    if (n > max_out) n = max_out;
    memcpy(out, hits, (size_t)n * sizeof *out);

    free(bm); free(cs); free(df); free(tf); free(dl); free(order); free(hits); free(rrf);
    return n;
}
