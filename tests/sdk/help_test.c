// ===========================================================================
// Тест r2d-help без модели: токенизатор, файл индекса, BM25, сбор корпуса
// из настоящего репозитория (путь к корню — первый аргумент).
// ===========================================================================
#include "help.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

static void check(bool cond, const char *what)
{
    printf("  %s %s\n", cond ? "ok  " : "FAIL", what);
    if (!cond) failures++;
}

typedef struct Toks {
    char buf[2048];
} Toks;

static void collect_tok(const char *t, size_t n, void *user)
{
    Toks *k = (Toks *)user;
    strncat(k->buf, "|", sizeof k->buf - strlen(k->buf) - 1);
    strncat(k->buf, t, n < sizeof k->buf - strlen(k->buf) - 1 ? n : sizeof k->buf - strlen(k->buf) - 1);
}

static const char *toks(const char *text)
{
    static Toks k;
    k.buf[0] = '\0';
    help_tokenize(text, collect_tok, &k);
    return k.buf;
}

static int find_name(const HelpIndex *ix, const char *name)
{
    for (int i = 0; i < ix->count; ++i) if (strcmp(ix->items[i].name, name) == 0) return i;
    return -1;
}

int main(int argc, char **argv)
{
    // --- токенизатор ---------------------------------------------------------
    check(strstr(toks("navigateTo"), "|navigateto") != NULL, "идентификатор целиком");
    check(strstr(toks("navigateTo"), "|naviga") != NULL, "часть идентификатора с основой");
    check(strstr(toks("Навигация НАВИГАЦИИ"), "|навига|навига") != NULL, "кириллица: регистр и основа");
    check(strstr(toks("ёлка Ёж"), "|елка|еж") != NULL, "ё → е");
    check(strcmp(toks("как и в the of"), "") == 0, "стоп-слова отброшены");

    // --- индекс: запись и чтение ---------------------------------------------
    HelpIndex ix;
    help_index_init(&ix);
    help_index_add(&ix, HELP_KIND_METHOD, ".navigateTo", "nav", ".navigateTo(target, opts)",
                   "src/highlevel/nav.js:1", "docs/highlevel/nav.md",
                   ".navigateTo .navigateTo(target, opts)\nмодуль nav\nидти к цели по навигационной сетке");
    help_index_add(&ix, HELP_KIND_NS, "$.tween", "tween", "$.tween(target)", "src/highlevel/tween.js:1", "",
                   "$.tween\nмодуль tween\nплавно менять значения во времени");
    help_index_add(&ix, HELP_KIND_DOC, "Пауза", "docs/x.md", "", "docs/x.md:3", "docs/x.md",
                   "docs/x.md › Пауза\n$.time.pause() останавливает время игры");
    ix.dim = 4;
    ix.sources_hash = 0x1234;
    snprintf(ix.model_id, sizeof ix.model_id, "test:1");
    const float v0[4] = { 1, 0, 0, 0 }, v1[4] = { 0, 1, 0, 0 };
    for (int i = 0; i < 2; ++i) {
        ix.items[i].vec = (int8_t *)malloc(4);
        help_quantize(i == 0 ? v0 : v1, 4, ix.items[i].vec, &ix.items[i].vec_scale);
    }
    // Индекс пишем в каталог временных файлов, а не в текущий: тест
    // запускается и там, где рабочий каталог только для чтения (контейнер
    // с проектом, смонтированным :ro — так его зовёт tools/help_train/run.sh).
    char tmp[2048];
    const char *tmpdir = getenv("TMPDIR");
    if (!tmpdir || !*tmpdir) tmpdir = "/tmp";
    snprintf(tmp, sizeof tmp, "%s/r2d-help-test.idx", tmpdir);
    check(help_index_save(&ix, tmp), "индекс записан");
    HelpIndex back;
    const bool loaded = help_index_load(&back, tmp);
    check(loaded, "индекс прочитан");
    check(loaded && back.count == 3 && back.dim == 4 && back.sources_hash == 0x1234, "заголовок сохранён");
    check(loaded && strcmp(back.items[0].signature, ".navigateTo(target, opts)") == 0, "строки сохранены");
    check(loaded && back.items[0].vec && back.items[0].vec[0] == 127, "вектор сохранён");
    check(loaded && back.items[2].vec == NULL, "запись без вектора остаётся без вектора");
    remove(tmp);

    // --- поиск ----------------------------------------------------------------
    HelpHit hits[8];
    int n = help_search(&back, "как идти к цели навигацией", NULL, hits, 8);
    check(n > 0 && hits[0].entry == 0, "BM25: русский запрос находит метод");
    n = help_search(&back, "navigateTo", NULL, hits, 8);
    check(n > 0 && hits[0].entry == 0, "точное имя — первым");
    n = help_search(&back, "$.time.pause", NULL, hits, 8);
    check(n > 0 && hits[0].entry == 2, "имя из текста документации находится");
    const float q[4] = { 0, 1, 0, 0 };
    n = help_search(&back, "анимация", q, hits, 8);
    check(n > 0 && hits[0].entry == 1, "без слов совпадения решает вектор");
    int a = help_search(&back, "цель", q, hits, 8);
    HelpHit again[8];
    int b = help_search(&back, "цель", q, again, 8);
    check(a == b && memcmp(hits, again, (size_t)a * sizeof *hits) == 0, "поиск детерминирован");
    help_index_free(&back);
    help_index_free(&ix);

    // --- корпус из репозитория ----------------------------------------------------
    if (argc > 1) {
        HelpIndex rx;
        help_index_init(&rx);
        SdkReport rep;
        sdk_report_init(&rep);
        check(help_collect(argv[1], &rx, &rep), "корпус собран из репозитория");
        int api = 0, docs = 0;
        for (int i = 0; i < rx.count; ++i) {
            if (rx.items[i].kind == HELP_KIND_DOC) docs++;
            else api++;
        }
        printf("       записей: %d (API %d, разделов docs %d)\n", rx.count, api, docs);
        check(api > 300, "в реестре больше 300 имён API");
        check(docs > 500, "больше 500 разделов документации");
        check(find_name(&rx, ".navigateTo") >= 0, "метод узла .navigateTo найден");
        check(find_name(&rx, "$.nav.mesh") >= 0, "функция пространства имён $.nav.mesh найдена");
        const int m = find_name(&rx, "$.nav.mesh");
        check(m >= 0 && strstr(rx.items[m].text, "навмеш") != NULL, "комментарий /** */ попал в описание");
        check(m >= 0 && strcmp(rx.items[m].doc, "docs/highlevel/nav.md") == 0, "ссылка на страницу модуля");
        n = help_search(&rx, "navigateTo", NULL, hits, 8);
        check(n > 0 && strcmp(rx.items[hits[0].entry].name, ".navigateTo") == 0, "поиск по имени в реальном корпусе");
        const uint64_t h1 = help_sources_hash(argv[1]), h2 = help_sources_hash(argv[1]);
        check(h1 == h2 && h1 != 0, "отпечаток источников стабилен");
        check(rep.errors == 0, "без ошибок сбора");
        help_index_free(&rx);
        sdk_report_free(&rep);
    }

    printf(failures ? "\nПровалено: %d\n" : "\nВсе проверки пройдены\n", failures);
    return failures ? 1 : 0;
}
