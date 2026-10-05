// ===========================================================================
// Тест разбора и сборки JSON (src/json.c).
//
// Зачем отдельный тест: этот код разбирает команды агента, то есть работает с
// вводом извне. Первая версия оценки длины строки переполняла кучу на
// escape-последовательностях, и движок падал с порчей памяти — без этой
// проверки причину было почти невозможно найти.
//
//   gcc -fsanitize=address -g -I src tests/json/json_test.c src/json.c -o /tmp/json_test
//   /tmp/json_test
//
// Сборка через CMake: цель r2d_json_test (см. tests/CMakeLists.txt).
// ===========================================================================
#include "json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *inputs[] = {
    "{}", "[]", "{\"cmd\":\"ping\"}", "{\"a\":\"\\n\"}", "{\"a\":\"\\u0041\"}",
    "{\"a\":\"\\uD83D\\uDE00\"}", "{\"a\":\"\\\\\"}", "{\"a\":\"\\\"\"}",
    "{\"a\":\"\"}", "\"\"", "\"\\\\\"", "\"\\n\\t\\r\\b\\f/\"",
    "{\"cmd\":\"eval\",\"code\":\"$('<rect>')\"}", "[1,2,[3,[4,[5]]]]",
    "{\"a\":null,\"b\":true,\"c\":false,\"d\":-1.5e10}",
    "{\"ключ\":\"значение\"}", "  {  }  ", "{\"a\":{\"b\":{\"c\":[1]}}}",
    "\"\\uD800\"", "\"\\uDFFF\"", "\"\\uD800\\uD800\"", "\"\\uffff\"",
    "{\"a\":\"\\u0000\"}", "\"\\", "\"", "{", "[", "{\"a\":}", ",", "nul",
    "{\"id\":1,\"cmd\":\"step\",\"frames\":60}",
};

int main(void)
{
    char err[256];
    for (size_t i = 0; i < sizeof inputs / sizeof inputs[0]; ++i) {
        R2dJson *v = r2d_json_parse(inputs[i], err, sizeof err);
        if (v) r2d_json_free(v);
    }

    // Случайные строки: проверяем, что парсер не выходит за буфер ни на чём.
    unsigned seed = 12345;
    char buf[128];
    for (int iter = 0; iter < 200000; ++iter) {
        seed = seed * 1103515245u + 12345u;
        const int len = (int)(seed % 40);
        for (int i = 0; i < len; ++i) {
            seed = seed * 1103515245u + 12345u;
            const char alphabet[] = "{}[]\",:\\u012abtnf\\ /";
            buf[i] = alphabet[seed % (sizeof alphabet - 1)];
        }
        buf[len] = '\0';
        R2dJson *v = r2d_json_parse(buf, err, sizeof err);
        if (v) r2d_json_free(v);
    }

    // Буфер строки: все операции записи.
    R2dSb sb;
    r2d_sb_init(&sb);
    for (int i = 0; i < 1000; ++i) {
        r2d_sb_put_json_string(&sb, "тест \"кавычки\" \\ и \n перевод");
        r2d_sb_put_json_number(&sb, 1.0 / (i + 1));
        r2d_sb_printf(&sb, "%d", i);
    }
    char *out = r2d_sb_take(&sb);
    printf("строка длиной %zu\n", strlen(out));
    free(out);
    r2d_sb_free(&sb);

    printf("  ok   JSON: разбор и сборка без ошибок\n");
    return 0;
}
