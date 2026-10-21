// ===========================================================================
// Проверка: высокоуровневое API ставится БЕЗ движка.
//
// Это регрессия на настоящую ошибку: подсистемы обращались к engine прямо при
// установке, и в модульном тесте (где engine нет) падал ВЕСЬ bootstrap — в игре
// это выглядело как «$ не определён». Теперь движок берётся через engineOf(),
// который отдаёт безопасную заглушку.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/api_no_engine_test.mjs
// ===========================================================================

import { test, eq, truthy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';
import { engineOf } from '../../src/highlevel/core.js';

test('createApi работает без движка', () => {
    const $ = createApi();
    truthy($, 'API создан');
    truthy(typeof $.ready === 'function', '$.ready есть');
    truthy(Object.keys($).length > 100, `подсистем много: ${Object.keys($).length}`);
});

test('новые подсистемы на месте', () => {
    const $ = createApi();
    for (const name of ['proc', 'raid', 'weapons', 'combat', 'items', 'story']) {
        truthy($[name], `$.${name} установлена`);
    }
});

// Заглушка движка в харнессе не имеет нативных RE2D-биндингов
// (`engine.re2d.view`), поэтому это ещё и проверка сборки без RE2D
// (R2D_ENABLE_RE2D=OFF, см. xmake.lua): 3D-семейство не ставится,
// обычный 2D работает, а $.re2dEnabled честно говорит «нет».
test('без RE2D-биндингов 3D-семейство не ставится', () => {
    const $ = createApi();
    eq($.re2dEnabled, false, '$.re2dEnabled=false без нативных биндингов');
    for (const name of ['cels', 're2d', 'rotsprite', 'real2d', 'mesh', 're2dWorld']) {
        eq($[name], undefined, `$.${name} не установлена`);
    }
    truthy(typeof $.kinds.has === 'function' && $.kinds.has('re2d'),
           'вид re2d остаётся данными даже без модуля');
});

test('engineOf без движка не бросает', () => {
    const env = engineOf();
    truthy(env, 'заглушка есть');
    // Заглушка живёт между вызовами: подсистема может дополнить её своими
    // полями (например, window), поэтому проверяем ЧТЕНИЕ, а не состав.
    eq(env.seed === undefined ? 12345 : env.seed, 12345, 'зерно по умолчанию');
    eq(typeof env.time, 'number', 'time — число');
    eq(typeof env.frame, 'number', 'frame — число');
    eq(engineOf(), env, 'заглушка одна на всех');
});

test('подсистемы читают движок без исключений', () => {
    const $ = createApi();
    // Каждая из этих строк раньше падала с «engine is not defined».
    truthy($.window.state(), '$.window.state()');
    truthy($.isAgent() === true || $.isAgent() === false, '$.isAgent()');
    truthy(typeof $.random.next() === 'number', '$.random.next()');
    // Снимок агента читает поля физики: без движка он неполон, и это
    // ожидаемо — важно, что вызов не роняет установку API.
    truthy(typeof $.agent.active === 'boolean', '$.agent.active читается');
});

test('чистые подсистемы работают без движка', () => {
    const $ = createApi();
    truthy($.proc.define({ id: 'h', w: 8, h: 12, seed: 1 }), '$.proc.define');
    truthy($.proc.opaque('h') > 0, '$.proc рисует пиксели');
    eq($.proc.render('h').w, 8, 'размер холста');
    truthy($.raid.create({ seed: 3, width: 200 }).generate(), '$.raid.create');
    truthy($.weapons.define({ id: 'gun', ammo: 5 }), '$.weapons.define');
    eq($.weapons.create('gun').magazine, 5, 'ствол создан');
});

finish();
