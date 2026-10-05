// ===========================================================================
// Груз игры: скрипты и ассеты, приписанные к исполняемому файлу.
//
// Зачем: собранная игра должна запускаться одним файлом — без папки проекта
// рядом. Билдер (`russiano2d build`) упаковывает скрипты (уже в байткоде
// QuickJS) и ассеты в один контейнер, шифрует его ChaCha20-Poly1305 и
// приписывает к копии движка вместе с футером. Движок при старте ищет футер
// в собственном файле и, если находит, читает груз оттуда, а не с диска.
//
// Раскладка файла:
//
//   [ ... байты движка ... ][ контейнер ][ футер, 128 байт ]
//
// Футер: магия, смещение и размер контейнера, одноразовый номер, тег и
// замаскированный ключ. Ключ собирается в памяти из блока футера и
// постоянной соли движка — целиком в файле он не лежит.
// ===========================================================================
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define R2D_PAYLOAD_MAGIC    0x50324452u   // "R2DP" — начало контейнера
#define R2D_FOOTER_MAGIC     0x46324452u   // "R2DF" — футер и его дубль в конце
#define R2D_FOOTER_SIZE      128u
#define R2D_PAYLOAD_VERSION  1u

typedef struct R2dPayloadFile {
    char    *path;    // путь относительно корня проекта, напр. "demos/main.js"
    uint8_t *data;
    size_t   size;
} R2dPayloadFile;

typedef struct R2dPayload {
    R2dPayloadFile *files;
    int             file_count;
    char            entry[512];   // точка входа, напр. "demos/main.js"
    uint8_t        *buffer;       // расшифрованный контейнер (владеем)
    size_t          buffer_size;
    bool            encrypted;
} R2dPayload;

// Разбирает контейнер из памяти. При успехе buffer переходит во владение
// груза (r2d_payload_free его освободит); при ошибке (NULL) буфер остаётся
// вызывающему — освобождать его дважды нельзя.
R2dPayload *r2d_payload_parse(uint8_t *buffer, size_t size, char *err, size_t err_size);

void r2d_payload_free(R2dPayload *payload);

// Ищет файл: сначала точное совпадение пути, затем по имени файла без каталогов.
const R2dPayloadFile *r2d_payload_find(const R2dPayload *payload, const char *path);

// --- Движок -----------------------------------------------------------------

// Ищет груз в самом исполняемом файле и делает его активным. Возвращает false,
// если груза нет — тогда движок работает как обычно, с файлов на диске.
bool r2d_payload_attach_self(void);

void r2d_payload_shutdown(void);

// Активный груз или NULL.
const R2dPayload *r2d_payload_active(void);

// Имя точки входа из груза (пустая строка, если груза нет).
const char *r2d_payload_entry(void);

// Читает файл: сначала из груза, затем с диска (через base_path).
// Возвращает указатель и размер; для диска данные нужно освободить через
// r2d_vfs_free(). Для груза указатель смотрит в память груза и не освобождается.
uint8_t *r2d_vfs_read(const char *path, size_t *out_size);
void     r2d_vfs_free(uint8_t *data);

// Есть ли файл в грузе (без обращения к диску).
bool r2d_vfs_has(const char *path);

// Сколько файлов в грузе и путь каждого — для перечисления каталогов
// (шрифты, например, движок ищет обходом папки).
int         r2d_vfs_count(void);
const char *r2d_vfs_path_at(int index);

// --- Сборка игры (src/build.c) ----------------------------------------------

// Подкоманда `russiano2d build ...`: собирает проект в один исполняемый файл.
// Возвращает код выхода процесса.
int r2d_build_main(int argc, char **argv);

#ifdef __cplusplus
}
#endif
