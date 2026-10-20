// ===========================================================================
// Атомарная запись файла: временный файл рядом с целевым + fsync + rename.
//
// Зачем отдельный модуль: $.save/$.store пишут JSON, и обрыв процесса посреди
// записи не должен оставить полуфайл. Раньше в JS-слое был протокол
// «temp → проверка → backup → перезапись», но rename в биндингах не было,
// поэтому подмена целевого файла не была атомарной. Здесь ровно одна
// примитивная операция, которую можно проверить Unity-тестом без SDL и QuickJS.
//
// Путь уже разрешён вызывающим слоем (r2d_app_resolve_path); модуль не знает
// про project-relative paths и path traversal — это ответственность script.c.
// ===========================================================================
#ifndef R2D_FS_UTIL_H
#define R2D_FS_UTIL_H

#include <stdbool.h>
#include <stddef.h>

// Записать len байт из data в path атомарно: данные уходят во временный файл в
// ТОМ ЖЕ каталоге, сбрасываются на диск, затем rename заменяет path.
// true — файл заменён целиком; false — path не тронут, причина в error.
bool r2d_fs_write_atomic(const char *path, const void *data, size_t len,
                         char *error, size_t error_size);

// Переименовать from → to с заменой существующего to (атомарно на POSIX).
bool r2d_fs_rename_replace(const char *from, const char *to,
                           char *error, size_t error_size);

#endif
