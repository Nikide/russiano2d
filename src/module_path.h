// ===========================================================================
// Канонизация имён модулей.
//
// Имена модулей внутри движка — это пути ОТНОСИТЕЛЬНО каталога игры:
//   "main.js", "lib/scene.js", "scenes/platformer.js".
//
// Функция общая для двух мест:
//   * src/script.c        — рантайм, когда разрешает import;
//   * tools/r2d_pack.c   — упаковщик, когда сериализует модуль в байткод.
// Если правила разойдутся, байткод запишет одни имена зависимостей, а
// рантайм будет искать другие, и релизная сборка перестанет находить модули.
// Поэтому реализация ровно одна — здесь.
// ===========================================================================
#pragma once

#include <stddef.h>
#include <stdio.h>
#include <string.h>

// base_name — имя импортирующего модуля ("scenes/menu.js") или NULL.
// name      — то, что написано в import ("../lib/scene.js", "lib/x.js").
// Результат всегда кладётся в out (никогда не выходит за пределы каталога игры
// вверх: лишние ".." просто отбрасываются).
static inline void r2d_module_path(const char *base_name, const char *name,
                                    char *out, size_t out_size)
{
    char path[4096];

    const int is_relative = (name && name[0] == '.' &&
                             (name[1] == '/' || (name[1] == '.' && name[2] == '/')));

    if (is_relative && base_name && *base_name) {
        // Импорт относительно каталога импортирующего модуля.
        char dir[4096];
        size_t i = 0;
        for (; base_name[i] && i + 1 < sizeof dir; ++i) dir[i] = base_name[i];
        dir[i] = '\0';

        char *slash = strrchr(dir, '/');
        if (slash) *slash = '\0'; else dir[0] = '\0';

        if (dir[0]) snprintf(path, sizeof path, "%s/%s", dir, name);
        else        snprintf(path, sizeof path, "%s", name);
    } else if (name && name[0] == '/') {
        snprintf(path, sizeof path, "%s", name + 1);
    } else {
        snprintf(path, sizeof path, "%s", name ? name : "");
    }

    // Нормализация по сегментам: убираем ".", схлопываем "..", ставим ровно
    // один разделитель между сегментами. Посимвольный разбор здесь легко
    // ошибается на стыке ("scenes" + "../lib" давало "sceneslib").
    size_t out_len = 0;
    const char *p = path;

    while (*p) {
        const char *seg = p;
        while (*p && *p != '/') p++;
        const size_t seg_len = (size_t)(p - seg);
        if (*p == '/') p++;

        if (seg_len == 0) continue;                            // пустой сегмент
        if (seg_len == 1 && seg[0] == '.') continue;           // текущий каталог

        if (seg_len == 2 && seg[0] == '.' && seg[1] == '.') {  // подъём выше
            while (out_len > 0 && out[out_len - 1] != '/') out_len--;
            if (out_len > 0) out_len--;
            continue;
        }

        if (out_len > 0) out[out_len++] = '/';
        if (out_len + seg_len >= out_size) break;
        memcpy(out + out_len, seg, seg_len);
        out_len += seg_len;
    }

    out[out_len < out_size ? out_len : out_size - 1] = '\0';
}
