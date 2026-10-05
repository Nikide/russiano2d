// ===========================================================================
// Разбор контейнера груза (src/payload.c) — тест без окна.
//
// Закрывает две регрессии, найденные аудитом:
//   * битый контейнер освобождал буфер вызывающего внутри parse, а вызывающий
//     освобождал его повторно — двойное освобождение кучи;
//   * проверка offset+size в футере переполнялась и пропускала OOB-чтение.
//
// Собирается с AddressSanitizer/UBSan, как и остальные C-тесты, поэтому
// двойное освобождение видно сразу.
// ===========================================================================
#include "payload.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <string.h>

// Журнал движка (R2D_LOG в payload.c) смотрит на этот флаг; в движке его
// заводит app.c, тесту он нужен для линковки.
bool r2d_log_stderr = false;

static int failures = 0;

static void check(bool ok, const char *what)
{
    printf("  %s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) failures++;
}

static void put_u32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v & 0xff);
    p[1] = (uint8_t)((v >> 8) & 0xff);
    p[2] = (uint8_t)((v >> 16) & 0xff);
    p[3] = (uint8_t)((v >> 24) & 0xff);
}

static size_t write_header(uint8_t *p, const char *entry, uint32_t count)
{
    size_t n = 0;
    const size_t entry_len = strlen(entry);
    put_u32(p + n, R2D_PAYLOAD_MAGIC);   n += 4;
    put_u32(p + n, R2D_PAYLOAD_VERSION); n += 4;
    put_u32(p + n, (uint32_t)entry_len); n += 4;
    memcpy(p + n, entry, entry_len);     n += entry_len;
    put_u32(p + n, count);               n += 4;
    return n;
}

// Битый контейнер: parse обязан вернуть NULL и НЕ трогать буфер вызывающего.
// Со старым кодом SDL_free(buf) здесь давал двойное освобождение (ASan).
static void test_bad_record_keeps_ownership(void)
{
    const char *entry = "main.js";
    const size_t size = 4 + 4 + 4 + strlen(entry) + 4 + 4;
    uint8_t *buf = (uint8_t *)SDL_malloc(size);
    size_t n = write_header(buf, entry, 1);
    put_u32(buf + n, 0);   // path_len == 0 — недопустимо
    n += 4;

    char err[128] = {0};
    R2dPayload *p = r2d_payload_parse(buf, n, err, sizeof err);
    check(p == NULL, "битая запись: parse вернул NULL");
    check(err[0] != '\0', "битая запись: есть текст ошибки");
    SDL_free(buf);   // при двойном освобождении ASan упадёт здесь
}

// Обрезанная запись: буфер вообще может быть не из кучи — parse не вправе его
// освобождать.
static void test_truncated_record_does_not_free(void)
{
    const char *entry = "main.js";
    uint8_t buf[128];
    size_t n = write_header(buf, entry, 1);
    put_u32(buf + n, 5);          // path_len = 5
    n += 4;
    memcpy(buf + n, "a.txt", 5);
    n += 5;                       // data_len отсутствует — запись обрезана

    char err[128] = {0};
    R2dPayload *p = r2d_payload_parse(buf, n, err, sizeof err);
    check(p == NULL, "обрезанная запись: parse вернул NULL");
}

static void test_valid_container(void)
{
    const char *entry = "main.js";
    const char *path = "assets/a.txt";
    const char *data = "hi";
    const size_t size = 4 + 4 + 4 + strlen(entry) + 4 + 4 + strlen(path) + 4 + strlen(data);
    uint8_t *buf = (uint8_t *)SDL_malloc(size);
    size_t n = write_header(buf, entry, 1);
    put_u32(buf + n, (uint32_t)strlen(path)); n += 4;
    memcpy(buf + n, path, strlen(path));      n += strlen(path);
    put_u32(buf + n, (uint32_t)strlen(data)); n += 4;
    memcpy(buf + n, data, strlen(data));      n += strlen(data);

    char err[128] = {0};
    R2dPayload *p = r2d_payload_parse(buf, n, err, sizeof err);
    check(p != NULL, "нормальный контейнер разобран");
    if (!p) { SDL_free(buf); return; }

    check(SDL_strcmp(p->entry, entry) == 0, "точка входа прочитана");
    check(p->file_count == 1, "один файл");
    check(r2d_payload_find(p, "assets/a.txt") != NULL, "файл найден по пути");
    check(r2d_payload_find(p, "") == NULL, "пустой путь не матчит первый файл");
    check(r2d_payload_find(p, "assets/нет.txt") == NULL, "чужой путь не найден");

    const R2dPayloadFile *f = r2d_payload_find(p, "assets/a.txt");
    check(f && f->size == strlen(data) && memcmp(f->data, data, f->size) == 0,
          "данные файла указывают внутрь контейнера");

    r2d_payload_free(p);   // освобождает и буфер
}

// Обрезанный заголовок: магия есть, дальше обрыв.
static void test_truncated_header(void)
{
    uint8_t buf[8];
    put_u32(buf, R2D_PAYLOAD_MAGIC);
    put_u32(buf + 4, R2D_PAYLOAD_VERSION);
    char err[128] = {0};
    R2dPayload *p = r2d_payload_parse(buf, sizeof buf, err, sizeof err);
    check(p == NULL, "обрезанный заголовок: parse вернул NULL");
}

int main(void)
{
    printf("Разбор груза:\n");
    test_bad_record_keeps_ownership();
    test_truncated_record_does_not_free();
    test_valid_container();
    test_truncated_header();

    if (failures) {
        printf("ПРОВАЛЕНО: %d\n", failures);
        return 1;
    }
    printf("Все проверки пройдены\n");
    return 0;
}
