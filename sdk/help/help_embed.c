// ===========================================================================
// r2d-help: эмбеддинги через C API llama.cpp (llama.h).
//
// Только CPU и фиксированное число потоков: результат должен совпадать между
// запусками и платформами настолько, насколько позволяет float (оценки при
// поиске ещё и округляются). Модель — любая GGUF-модель эмбеддингов с
// пулингом; по умолчанию multilingual-e5-small (docs/HELP.md §4), у e5
// обязательные префиксы «query: » / «passage: ».
// ===========================================================================
#include "help.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef R2D_HELP_LLAMA
#include "llama.h"

struct HelpEmbedder {
    struct llama_model   *model;
    struct llama_context *ctx;
    const struct llama_vocab *vocab;
    int   dim;
    int   n_ctx;
    bool  e5_prefix;
};

// stdout занят ответом JSON; журнал llama.cpp не должен туда попадать.
static void quiet_log(enum ggml_log_level level, const char *text, void *user)
{
    (void)user;
    if (level == GGML_LOG_LEVEL_ERROR && getenv("R2D_HELP_DEBUG")) fputs(text, stderr);
}

bool help_embed_available(void) { return true; }

HelpEmbedder *help_embed_open(const char *model_path, int threads, char *err, size_t err_cap)
{
    llama_log_set(quiet_log, NULL);
    llama_backend_init();

    struct llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;   // только CPU: одинаковый результат на всех платформах
    struct llama_model *model = llama_model_load_from_file(model_path, mp);
    if (!model) {
        snprintf(err, err_cap, "модель не загружена: %s", model_path);
        return NULL;
    }

    struct llama_context_params cp = llama_context_default_params();
    cp.embeddings = true;
    cp.n_ctx = 512;
    cp.n_batch = 512;
    cp.n_ubatch = 512;
    cp.n_threads = threads > 0 ? threads : 1;
    cp.n_threads_batch = cp.n_threads;
    cp.pooling_type = LLAMA_POOLING_TYPE_UNSPECIFIED;   // из метаданных модели
    struct llama_context *ctx = llama_init_from_model(model, cp);
    if (!ctx) {
        llama_model_free(model);
        snprintf(err, err_cap, "контекст модели не создан");
        return NULL;
    }
    if (llama_pooling_type(ctx) == LLAMA_POOLING_TYPE_NONE) {
        llama_free(ctx);
        llama_model_free(model);
        snprintf(err, err_cap, "модель без пулинга: нужна модель эмбеддингов предложений");
        return NULL;
    }

    HelpEmbedder *e = (HelpEmbedder *)calloc(1, sizeof *e);
    if (!e) { llama_free(ctx); llama_model_free(model); return NULL; }
    e->model = model;
    e->ctx = ctx;
    e->vocab = llama_model_get_vocab(model);
    e->dim = llama_model_n_embd(model);
    e->n_ctx = (int)llama_n_ctx(ctx);

    // e5 обучена с префиксами; узнаём её по имени в метаданных.
    char name[256] = "";
    llama_model_meta_val_str(model, "general.name", name, sizeof name);
    for (char *p = name; *p; ++p) if (*p >= 'A' && *p <= 'Z') *p = (char)(*p + 32);
    e->e5_prefix = strstr(name, "e5") != NULL || getenv("R2D_HELP_E5_PREFIX") != NULL;
    return e;
}

void help_embed_close(HelpEmbedder *e)
{
    if (!e) return;
    llama_free(e->ctx);
    llama_model_free(e->model);
    free(e);
    llama_backend_free();
}

int help_embed_dim(const HelpEmbedder *e) { return e ? e->dim : 0; }

bool help_embed_text(HelpEmbedder *e, const char *text, bool is_query, float *out)
{
    if (!e) return false;
    const char *prefix = e->e5_prefix ? (is_query ? "query: " : "passage: ") : "";
    const size_t len = strlen(prefix) + strlen(text);
    char *buf = (char *)malloc(len + 1);
    if (!buf) return false;
    snprintf(buf, len + 1, "%s%s", prefix, text);

    const int cap = e->n_ctx;
    llama_token *toks = (llama_token *)malloc((size_t)cap * sizeof *toks);
    if (!toks) { free(buf); return false; }
    int n = llama_tokenize(e->vocab, buf, (int32_t)len, toks, cap, true, true);
    if (n < 0) {
        // Текст длиннее окна модели: берём начало (разделы docs и так
        // нарезаны так, чтобы это было редкостью).
        const int need = -n;
        llama_token *all = (llama_token *)malloc((size_t)need * sizeof *all);
        if (!all) { free(toks); free(buf); return false; }
        llama_tokenize(e->vocab, buf, (int32_t)len, all, need, true, true);
        n = cap;
        memcpy(toks, all, (size_t)(n - 1) * sizeof *toks);
        // Последний — служебный конец последовательности, если он был.
        toks[n - 1] = all[need - 1];
        free(all);
    }
    free(buf);
    if (n <= 0) { free(toks); return false; }

    struct llama_batch batch = llama_batch_init(n, 0, 1);
    for (int i = 0; i < n; ++i) {
        batch.token[i] = toks[i];
        batch.pos[i] = i;
        batch.n_seq_id[i] = 1;
        batch.seq_id[i][0] = 0;
        batch.logits[i] = 1;
    }
    batch.n_tokens = n;
    free(toks);

    llama_memory_clear(llama_get_memory(e->ctx), true);
    const int rc = llama_decode(e->ctx, batch);
    bool ok = rc == 0;
    if (ok) {
        const float *v = llama_get_embeddings_seq(e->ctx, 0);
        if (!v) ok = false;
        else {
            double norm = 0.0;
            for (int i = 0; i < e->dim; ++i) norm += (double)v[i] * v[i];
            norm = sqrt(norm);
            for (int i = 0; i < e->dim; ++i) out[i] = norm > 0.0 ? (float)(v[i] / norm) : 0.0f;
        }
    }
    llama_batch_free(batch);
    return ok;
}

#else  // без llama.cpp: только BM25

bool help_embed_available(void) { return false; }

HelpEmbedder *help_embed_open(const char *model_path, int threads, char *err, size_t err_cap)
{
    (void)model_path; (void)threads;
    snprintf(err, err_cap, "r2d-help собран без llama.cpp (R2D_HELP_LLAMA=OFF)");
    return NULL;
}

void help_embed_close(HelpEmbedder *e) { (void)e; }
int  help_embed_dim(const HelpEmbedder *e) { (void)e; return 0; }
bool help_embed_text(HelpEmbedder *e, const char *t, bool q, float *o)
{
    (void)e; (void)t; (void)q; (void)o;
    return false;
}

#endif

bool help_model_id(const char *model_path, char *out, size_t cap)
{
    FILE *f = fopen(model_path, "rb");
    if (!f) return false;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return false; }
    const long size = ftell(f);
    if (size <= 0) { fclose(f); return false; }
    const size_t chunk = 1u << 20;
    uint8_t *buf = (uint8_t *)malloc(chunk);
    if (!buf) { fclose(f); return false; }
    uint64_t h = 0;
    fseek(f, 0, SEEK_SET);
    size_t got = fread(buf, 1, chunk, f);
    h = help_fnv1a(buf, got, h);
    if ((size_t)size > chunk) {
        fseek(f, size - (long)chunk, SEEK_SET);
        got = fread(buf, 1, chunk, f);
        h = help_fnv1a(buf, got, h);
    }
    free(buf);
    fclose(f);
    snprintf(out, cap, "%s:%ld:%016llx", sdk_basename(model_path), size, (unsigned long long)h);
    return true;
}
