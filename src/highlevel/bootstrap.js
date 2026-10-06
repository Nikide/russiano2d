// ===========================================================================
// Загрузчик высокоуровневого API.
//
// Движок выполняет этот модуль сразу после создания JS-контекста (до точки
// входа игры), поэтому $ существует уже в top-level коде main.js:
//
//   // game/main.js
//   $.ready(() => { ... });
//
// Повторный `import $ from 'r2d'` вернёт тот же самый объект: index.js просто
// отдаёт globalThis.$, а не создаёт второй экземпляр.
// ===========================================================================

import { createApi } from './api.js';

// Ошибку установки показываем как есть: раньше исключение внутри createApi()
// уносило контекст, и движок писал «bootstrap.js не выставил globalThis.$» —
// по такому сообщению причину не найти.
let $;
try {
    $ = createApi();
} catch (error) {
    try {
        const where = error && error.stack ? String(error.stack) : String(error);
        if (typeof engine !== 'undefined' && engine && typeof engine.log === 'function') {
            engine.log('$: установка высокоуровневого API упала — ' + where);
        }
    } catch (e) { /* журнала может не быть */ }
    throw error;
}

globalThis.$ = $;
globalThis.nk = $;      // короткий алиас: $.world === nk.world

export default $;
export { $ };
