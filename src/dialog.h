// ===========================================================================
// Системные диалоги выбора папки и файлов (SDL3 SDL_ShowFileDialogWithProperties).
//
// SDL вызывает обратный вызов когда и где ему удобно (на некоторых платформах —
// из другого потока), поэтому результат кладётся в очередь под мьютексом, а
// скриптовый слой забирает его в безопасной фазе кадра (`$.fs.pickFolder` и
// др., src/highlevel/store.js). Так же устроен async-ввод-вывод (src/async.h).
// ===========================================================================
#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct SDL_Window SDL_Window;

typedef enum R2dDialogKind {
    R2D_DIALOG_FOLDER = 0,
    R2D_DIALOG_OPEN_FILE = 1,
    R2D_DIALOG_SAVE_FILE = 2,
} R2dDialogKind;

// Фильтр: name — подпись («Картинки»), pattern — расширения через «;» («png;jpg»),
// «*» — любые файлы.
typedef struct R2dDialogFilter {
    const char *name;
    const char *pattern;
} R2dDialogFilter;

// Открыть диалог. Возвращает id запроса (>0) или -1 с причиной в err.
// Строки копируются: после возврата их можно освободить.
int r2d_dialog_open(SDL_Window *window, R2dDialogKind kind, const char *title,
                    const char *location, const R2dDialogFilter *filters, int nfilters,
                    bool many, char *err, int err_size);

// Готовый результат. paths — массив из count путей (count=0 — отмена);
// error — непустая строка, если диалог не смог открыться.
typedef struct R2dDialogResult {
    int    id;
    int    count;
    char **paths;
    char   error[256];
} R2dDialogResult;

// Забрать один готовый результат; false — очередь пуста. Владение paths
// переходит вызывающему: освободить r2d_dialog_result_free.
bool r2d_dialog_poll(R2dDialogResult *out);
void r2d_dialog_result_free(R2dDialogResult *r);

// Сколько диалогов ещё открыто (без ответа).
int r2d_dialog_pending(void);

#ifdef __cplusplus
}
#endif
