// ===========================================================================
// r2d_pack — упаковщик игровых скриптов в байткод QuickJS.
//
// Зачем свой инструмент, если есть qjsc:
//   * qjsc компилирует ОДИН файл. Игра же — это набор ES-модулей, которые
//     импортируют друг друга (main.js -> lib/scene.js -> scenes/platformer.js).
//     Скомпилированный qjsc модуль всё равно пошёл бы читать импорты с диска,
//     то есть релизный бинарник не стал бы самодостаточным.
//   * Поэтому упаковщик работает как настоящий загрузчик модулей: компилирует
//     точку входа, рекурсивно обходит её импорты и складывает байткод каждого
//     модуля в таблицу «имя -> байткод». Рантайм ищет импорты в этой таблице
//     и на диск не обращается вообще.
//
// Используется тот же механизм, что и внутри qjsc: JS_WriteObject с флагом
// JS_WRITE_OBJ_BYTECODE.
//
// ВАЖНО: значения с тегом JS_TAG_MODULE нельзя ни дублировать через
// JS_DupValue, ни освобождать через JS_FreeValue — в QuickJS это приводит к
// abort() (см. free_value, case JS_TAG_MODULE). Поэтому байткод сериализуется
// сразу в загрузчике, а наружу отдаётся только указатель на JSModuleDef.
//
// Использование:
//   r2d_pack <output.c> <game_dir> <entry.js>
//
// Имена модулей в таблице — пути относительно каталога игры, с прямыми
// слэшами: "main.js", "lib/scene.js".
// ===========================================================================

#include <quickjs.h>

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "js_embed.h"
#include "module_path.h"

// Таблица встроенных модулей движка ($). Определения — в сгенерированном
// заголовке r2d_js_data.h (см. cmake/EmbedJs.cmake).
#include "r2d_js_data.h"

#define MAX_MODULES 128
#define MAX_NAME    512

typedef struct PackedModule {
    char           name[MAX_NAME];
    unsigned char *data;
    size_t         size;
} PackedModule;

typedef struct PackState {
    const char   *game_dir;
    PackedModule  modules[MAX_MODULES];
    int           count;
    bool          failed;
} PackState;

static char *read_whole_file(const char *path, size_t *out_size)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;

    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    const long size = ftell(f);
    if (size < 0) { fclose(f); return NULL; }
    rewind(f);

    char *buf = (char *)malloc((size_t)size + 1);
    if (!buf) { fclose(f); return NULL; }

    const size_t read = fread(buf, 1, (size_t)size, f);
    fclose(f);
    buf[read] = '\0';
    *out_size = read;
    return buf;
}

// "lib/scene.js" -> "lib_scene_js"
static void make_identifier(const char *name, char *out, size_t out_size)
{
    size_t j = 0;
    for (size_t i = 0; name[i] && j + 1 < out_size; ++i) {
        const char c = name[i];
        out[j++] = ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9')) ? c : '_';
    }
    out[j] = '\0';
}

static void report_exception(JSContext *ctx, const char *module)
{
    JSValue exc = JS_GetException(ctx);
    const char *text = JS_ToCString(ctx, exc);
    fprintf(stderr, "r2d_pack: ошибка в модуле %s:\n%s\n", module, text ? text : "?");
    if (text) JS_FreeCString(ctx, text);
    JS_FreeValue(ctx, exc);
}

// Канонизация имён: "./lib/scene.js" -> "lib/scene.js", "scenes/../lib/x.js"
// -> "lib/x.js". Та же функция, что и в рантайме, — см. src/module_path.h.
static char *pack_module_normalize(JSContext *ctx, const char *base_name,
                                   const char *name, void *opaque)
{
    (void)opaque;
    if (!name || !*name) return NULL;

    char norm[4096];
    r2d_module_path(base_name, name, norm, sizeof norm);
    return js_strdup(ctx, norm);
}

static int find_module(const PackState *st, const char *name)
{
    for (int i = 0; i < st->count; ++i) {
        if (strcmp(st->modules[i].name, name) == 0) return i;
    }
    return -1;
}

// Загрузчик модулей для этапа упаковки: читает файл, компилирует, сразу
// сериализует в байткод и передаёт указатель на модуль рантайму.
static JSModuleDef *pack_module_loader(JSContext *ctx, const char *module_name, void *opaque)
{
    PackState *st = (PackState *)opaque;

    if (st->failed) return NULL;

    // Высокоуровневое API ($) встроено в сам движок: в таблицу байткода его
    // класть не нужно (рантайм ищет такие модули раньше встроенных), но
    // скомпилировать надо — иначе упаковщик не найдёт его на диске.
    const R2dJsModule *builtin = r2d_js_module_find(module_name);
    if (builtin) {
        JSValue val = JS_Eval(ctx, builtin->source, strlen(builtin->source),
                              builtin->name, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
        if (JS_IsException(val)) {
            report_exception(ctx, module_name);
            st->failed = true;
            return NULL;
        }
        return (JSModuleDef *)JS_VALUE_GET_PTR(val);
    }

    if (st->count >= MAX_MODULES) {
        fprintf(stderr, "r2d_pack: слишком много модулей (лимит %d)\n", MAX_MODULES);
        st->failed = true;
        return NULL;
    }

    char full_path[4096];
    snprintf(full_path, sizeof full_path, "%s/%s", st->game_dir, module_name);

    size_t source_size = 0;
    char *source = read_whole_file(full_path, &source_size);
    if (!source) {
        fprintf(stderr, "r2d_pack: не удалось прочитать %s\n", full_path);
        st->failed = true;
        return NULL;
    }

    // Имя модуля — путь относительно каталога игры. Именно под этим именем
    // его будет искать загрузчик в рантайме.
    JSValue compiled = JS_Eval(ctx, source, source_size, module_name,
                               JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    free(source);

    if (JS_IsException(compiled)) {
        report_exception(ctx, module_name);
        st->failed = true;
        return NULL;
    }

    // Сериализуем немедленно: держать JS_TAG_MODULE дольше нельзя.
    size_t blob_size = 0;
    unsigned char *blob = JS_WriteObject(ctx, &blob_size, compiled,
                                         JS_WRITE_OBJ_BYTECODE |
                                         JS_WRITE_OBJ_STRIP_SOURCE);
    if (!blob) {
        report_exception(ctx, module_name);
        fprintf(stderr, "r2d_pack: не удалось сериализовать %s\n", module_name);
        st->failed = true;
        return NULL;
    }

    const int existing = find_module(st, module_name);
    if (existing < 0) {
        PackedModule *m = &st->modules[st->count++];
        snprintf(m->name, sizeof m->name, "%s", module_name);
        m->data = blob;
        m->size = blob_size;
        fprintf(stderr, "  %-28s %7zu байт байткода\n", module_name, blob_size);
    } else {
        // Модуль запросили повторно (ромбовидный граф импортов) — байткод уже
        // собран, второй экземпляр не нужен.
        free(blob);
    }

    // Владение ссылкой переходит рантайму; освобождать её нельзя.
    return (JSModuleDef *)JS_VALUE_GET_PTR(compiled);
}

int main(int argc, char **argv)
{
    if (argc != 4) {
        fprintf(stderr,
                "Использование: %s <output.c> <game_dir> <entry.js>\n"
                "  entry.js задаётся путём относительно game_dir (обычно main.js).\n"
                "  Остальные модули находятся автоматически по цепочке import.\n",
                argv[0]);
        return 2;
    }

    const char *out_path = argv[1];
    const char *game_dir = argv[2];
    const char *entry    = argv[3];

    PackState st;
    memset(&st, 0, sizeof st);
    st.game_dir = game_dir;

    JSRuntime *rt = JS_NewRuntime();
    if (!rt) {
        fprintf(stderr, "r2d_pack: не удалось создать JSRuntime\n");
        return 1;
    }
    JS_SetMaxStackSize(rt, 2u * 1024u * 1024u);

    JSContext *ctx = JS_NewContext(rt);
    if (!ctx) {
        fprintf(stderr, "r2d_pack: не удалось создать JSContext\n");
        JS_FreeRuntime(rt);
        return 1;
    }

    // Имена модулей канонизируются ровно так же, как это делает рантайм
    // (src/module_path.h) — иначе байткод записал бы одни имена зависимостей,
    // а движок искал бы другие.
    JS_SetModuleLoaderFunc(rt, pack_module_normalize, pack_module_loader, &st);

    // Точка входа тоже проходит через загрузчик: компиляция main.js потянет
    // за собой все его импорты, и в таблице окажется весь граф модулей.
    pack_module_loader(ctx, entry, &st);

    if (st.failed || st.count == 0) {
        fprintf(stderr, "r2d_pack: упаковка не удалась\n");
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return 1;
    }

    // --- Запись C-файла -----------------------------------------------------
    FILE *out = fopen(out_path, "wb");
    if (!out) {
        fprintf(stderr, "r2d_pack: не удалось открыть %s на запись\n", out_path);
        return 1;
    }

    fprintf(out,
            "// ===========================================================================\n"
            "// ВНИМАНИЕ: файл сгенерирован tools/r2d_pack.c. Не редактировать вручную.\n"
            "// Байткод игровых модулей QuickJS, встроенный в исполняемый файл.\n"
            "// ===========================================================================\n"
            "\n#include \"embed.h\"\n\n");

    for (int i = 0; i < st.count; ++i) {
        char ident[1024];
        make_identifier(st.modules[i].name, ident, sizeof ident);

        fprintf(out, "static const unsigned char r2d_mod_%s[] = {\n", ident);
        for (size_t b = 0; b < st.modules[i].size; ++b) {
            if (b % 16 == 0) fputs("\t", out);
            fprintf(out, "0x%02x,", st.modules[i].data[b]);
            if (b % 16 == 15 || b + 1 == st.modules[i].size) fputc('\n', out);
        }
        fputs("};\n\n", out);
    }

    fprintf(out, "const R2dEmbeddedModule r2d_embedded_modules[] = {\n");
    for (int i = 0; i < st.count; ++i) {
        char ident[1024];
        make_identifier(st.modules[i].name, ident, sizeof ident);
        fprintf(out, "    { \"%s\", r2d_mod_%s, (unsigned int)sizeof(r2d_mod_%s) },\n",
                st.modules[i].name, ident, ident);
    }
    fprintf(out, "};\n\n");
    fprintf(out, "const int r2d_embedded_module_count = %d;\n", st.count);

    fclose(out);

    for (int i = 0; i < st.count; ++i) free(st.modules[i].data);

    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);

    fprintf(stderr, "r2d_pack: записан %s (%d модулей)\n", out_path, st.count);
    return 0;
}
