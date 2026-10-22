#include "ai_embed.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(R2D_HAVE_AI)
#include <SDL3/SDL.h>
#include "llama.h"

#define AI_MAX_TOKENS 160

const unsigned char *r2d_ai_model_data(size_t *size);

static struct llama_model *g_model;
static struct llama_context *g_ctx;
static const struct llama_vocab *g_vocab;
static int g_dim;
static unsigned long long g_id;

static void ai_log_quiet(enum ggml_log_level level, const char *text, void *user)
{
    (void)level; (void)text; (void)user;
}

static unsigned long long fnv64(const unsigned char *p, size_t n)
{
    unsigned long long h = 1469598103934665603ULL;
    for (size_t i = 0; i < n; ++i) { h ^= p[i]; h *= 1099511628211ULL; }
    return h;
}

bool r2d_ai_available(void) { return true; }

unsigned long long r2d_ai_model_id(void)
{
    if (!g_id) {
        size_t n = 0;
        const unsigned char *d = r2d_ai_model_data(&n);
        g_id = fnv64(d, n) ^ (unsigned long long)n;
    }
    return g_id;
}

// Кэш-файл с моделью: <pref>/r2d-embed-<id>.gguf; пишется атомарно (tmp + rename).
static bool ai_extract(char *path, size_t cap, char *err, size_t ecap)
{
    size_t n = 0;
    const unsigned char *d = r2d_ai_model_data(&n);
    char *pref = SDL_GetPrefPath("Russiano2D", "r2d");
    if (!pref) { snprintf(err, ecap, "нет каталога кэша для модели"); return false; }
    snprintf(path, cap, "%sr2d-embed-%016llx.gguf", pref, r2d_ai_model_id());
    SDL_free(pref);
    SDL_PathInfo info;
    if (SDL_GetPathInfo(path, &info) && info.type == SDL_PATHTYPE_FILE && (size_t)info.size == n) return true;
    char tmp[1100];
    snprintf(tmp, sizeof tmp, "%s.tmp", path);
    FILE *f = fopen(tmp, "wb");
    if (!f) { snprintf(err, ecap, "не удалось записать модель в %s", tmp); return false; }
    const bool ok = fwrite(d, 1, n, f) == n;
    fclose(f);
    if (!ok || !SDL_RenamePath(tmp, path)) {
        remove(tmp);
        snprintf(err, ecap, "не удалось сохранить модель в кэш (%s)", path);
        return false;
    }
    return true;
}

bool r2d_ai_open(char *err, size_t cap)
{
    if (g_ctx) return true;
    char path[1024];
    if (!ai_extract(path, sizeof path, err, cap)) return false;
    llama_log_set(ai_log_quiet, NULL);
    llama_backend_init();
    struct llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = getenv("R2D_AI_CPU") ? 0 : 99;
    g_model = llama_model_load_from_file(path, mp);
    if (!g_model) { snprintf(err, cap, "llama.cpp не загрузил модель %s", path); return false; }
    g_vocab = llama_model_get_vocab(g_model);
    g_dim = llama_model_n_embd(g_model);
    if (g_dim != R2D_AI_DIM) {
        snprintf(err, cap, "размерность модели %d, ожидалась %d", g_dim, R2D_AI_DIM);
        llama_model_free(g_model); g_model = NULL;
        return false;
    }
    struct llama_context_params cp = llama_context_default_params();
    cp.n_ctx = 512; cp.n_batch = 512; cp.n_ubatch = 512; cp.n_seq_max = 1;
    cp.embeddings = true;
    cp.pooling_type = LLAMA_POOLING_TYPE_MEAN;
    g_ctx = llama_init_from_model(g_model, cp);
    if (!g_ctx) {
        snprintf(err, cap, "llama.cpp не создал контекст");
        llama_model_free(g_model); g_model = NULL;
        return false;
    }
    return true;
}

bool r2d_ai_embed(const char *text, float *out)
{
    if (!g_ctx || !text || !out) return false;
    llama_token toks[512];
    int n = llama_tokenize(g_vocab, text, (int32_t)strlen(text), toks, 512, true, false);
    if (n < 0) n = 512;           // очень длинный текст: берём начало
    if (n < 2) return false;
    if (n > AI_MAX_TOKENS) { toks[AI_MAX_TOKENS - 1] = toks[n - 1]; n = AI_MAX_TOKENS; }   // сохраняем [SEP]
    struct llama_batch b = llama_batch_init(n, 0, 1);
    for (int i = 0; i < n; ++i) {
        b.token[i] = toks[i]; b.pos[i] = i; b.n_seq_id[i] = 1; b.seq_id[i][0] = 0; b.logits[i] = 1;
    }
    b.n_tokens = n;
    const bool ok = llama_decode(g_ctx, b) == 0;
    llama_batch_free(b);
    if (!ok) return false;
    const float *e = llama_get_embeddings_seq(g_ctx, 0);
    if (!e) return false;
    double norm = 0;
    for (int i = 0; i < g_dim; ++i) norm += (double)e[i] * e[i];
    norm = norm > 0 ? 1.0 / sqrt(norm) : 0.0;
    for (int i = 0; i < g_dim; ++i) out[i] = (float)(e[i] * norm);
    return true;
}

void r2d_ai_close(void)
{
    if (g_ctx) llama_free(g_ctx);
    if (g_model) llama_model_free(g_model);
    g_ctx = NULL; g_model = NULL; g_vocab = NULL;
    llama_backend_free();   // иначе Metal падает на ассерте при exit()
}

#else   // без модели

bool r2d_ai_available(void) { return false; }
bool r2d_ai_open(char *err, size_t cap) { snprintf(err, cap, "в этой сборке нет встроенной модели эмбеддингов"); return false; }
bool r2d_ai_embed(const char *text, float *out) { (void)text; (void)out; return false; }
void r2d_ai_close(void) {}
unsigned long long r2d_ai_model_id(void) { return 0; }

#endif
