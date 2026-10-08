// ===========================================================================
// Перезапуск скриптов — $.script
//
// Движок следит за mtime файлов игры и просит перезапуск QuickJS. Раньше это
// происходило ПРЯМО В МОМЕНТ обнаружения: старый рантайм уничтожался посреди
// обработки события, и кадр оставался недоигранным. Теперь перезапуск
// запрашивается, а выполняется на ГРАНИЦЕ кадра (src/main.c), когда JS-вызовов
// в этом кадре больше не будет.
//
//   $.script.request('правлю интерфейс');   // перезапуск на границе кадра
//   $.script.pending();                     // ждёт ли
//   $.script.hotReload();                   // следит ли движок за файлами
//
// ВАЖНО: перезапуск уничтожает весь JS-heap — состояние игры, узлы мира и
// подписки. Сохраняйте то, что должно пережить перезагрузку, через $.save
// (см. save.md) или $.store + $.fs.
// ===========================================================================

import { engine } from './native.js';
import { ctx } from './core.js';

export function installScript($) {
    const script = {
        /** Попросить перезапуск скриптов (случится на границе кадра). */
        request(reason) {
            if (typeof engine.requestReload !== 'function') return false;
            return !!engine.requestReload(reason === undefined ? 'запрос игры' : String(reason));
        },

        /** Ждёт ли перезапуска. */
        pending() {
            return typeof engine.reloadPending === 'function' ? !!engine.reloadPending() : false;
        },

        /** Следит ли движок за изменениями файлов (`--no-hot-reload` выключает). */
        hotReload() {
            return typeof engine.hotReload === 'function' ? !!engine.hotReload() : false;
        },

        /** Сколько раз рантайм перезапускался за процесс. */
        count() {
            return typeof engine.reloads === 'number' ? engine.reloads : 0;
        },
    };

    $.script = script;
    ctx.script = script;
    return script;
}
