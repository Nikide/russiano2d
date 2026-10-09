// Фикстура «игре виден только $»: что игровой код видит на верхнем уровне,
// в кадре и при попытке импортировать внутренние модули движка.
globalThis.__top = typeof engine;
globalThis.__frame = 'не было кадра';
globalThis.__native_import = 'ожидание';
globalThis.__r2d_import = 'ожидание';

import('r2d/native.js').then(
    () => { globalThis.__native_import = 'загружен'; },
    (e) => { globalThis.__native_import = 'отказ: ' + String(e && e.message); });
import('r2d').then(
    (m) => { globalThis.__r2d_import = m.default === $ ? 'тот же $' : 'другой объект'; },
    (e) => { globalThis.__r2d_import = 'отказ: ' + String(e && e.message); });

$.update(() => { globalThis.__frame = typeof engine; });
