# `native.js` — приватный вход в нативное ядро

Схема движка: **C → `$`**. Игровой код видит только `$`; объект `engine` с
нативными биндингами (`src/script.c`, `r2d__make_engine`) — внутренность,
которой пользуются модули `src/highlevel/*.js`. Добраться до него из игры без
пересборки движка нельзя.

## Как это устроено

| Шаг | Где | Что происходит |
|---|---|---|
| 1 | `src/script.c` | C создаёт `engine` и кладёт его в `globalThis` на время загрузки `$` |
| 2 | `src/highlevel/native.js` | первым модулем снимает ссылку: `export let engine = globalThis.engine` |
| 3 | `src/highlevel/*.js` | каждый модуль, которому нужен движок, импортирует `import { engine } from './native.js'` |
| 4 | `src/highlevel/bootstrap.js` | после `createApi()` делает `delete globalThis.engine` |
| 5 | загрузчик модулей (`r2d__module_normalize`) | `r2d/*` кроме `r2d/index.js` отдаёт только модулям `r2d/*`; игре — `ReferenceError` |

Игре доступен единственный импорт — `import $ from 'r2d'` (тот же объект, что
глобальный `$`).

## Нативные проходы кадра — `engine.nodes`

Узлы `$` остаются обычными JS-объектами, а покадровые проходы по ним идут в C
(`src/nodes.c`). C читает и пишет поля узла по заранее созданным атомам —
≈4 нс на чтение и ≈3 нс на запись против 1–2 мкс на узел в интерпретаторе.
Поэтому хранилище узлов не переезжало в SoA: замер показал, что это сэкономило
бы меньше 0,05 мс на 1000 узлов, а семантику полей пришлось бы менять во всём
`$` ([HIGH_LEVEL_API_PERF.md](../HIGH_LEVEL_API_PERF.md) §0.5).

| Проход | Было (JS) | C-функция | Кто зовёт |
|---|---|---|---|
| синк тел Box2D → `x/y/angle` | `world.sync` | `syncBodies(list)` | `world.js` |
| автособытия `hit/heal/death/respawn/show/hide` | `worldEvents` | `worldEvents(nodes, start, out)` | `world.js` |
| наведение мыши, `:picked`, `mouseenter/leave` | `tickWorldHover` | `hover(nodes, start, P)` | `api.js` |
| сбор и сортировка мира | `sortedNodes` | `collectWorld(nodes, out)`, `sortWorld(list, mode)` | `render.js` |
| отсечение и батч обычных узлов | `drawWorldNode` | `drawWorld(list, P, xf, col, blend, fx, clip, count, cb)` | `render.js` |
| индекс реестра: все, по тегу, по классу, срезы | `buildRegistryIndex` | `buildIndex(nodes)` | `core.js` |
| простые твины (`.tween/.moveTo/.fadeTo/…`) | `tickTweens` | `tweenAdd/tweenStep/tweenClear/tweenPause/tweenCount` | `tween.js` |
| таймеры тряски, вспышки, неуязвимости | `tickEffects` | `tickEffects(nodes, dt)` | `tween.js` |
| `<text>`: замер строки и глифы в батч | `syncTextBounds`, `_queueTextScaled` | внутри `drawWorld` | `render.js` |
| статичные слои `<tilemap>` | цикл `push.sprite` по клеткам | `drawTiles(data, frames, G, …)` | `tilemap.js` через `nativeTiles` |
| частицы эмиттера (рампы цвета, альфы, размера ≤ 16 стопов) | `renderParticles` | `drawParticles(parts, rc, ra, rs, G, …)` | `particles.js` через `nativeParticles` |
| HUD: `ui.label`, `ui.panel`; остальное — колбэк в `drawUINode` | цикл `drawUINode` | `drawUI(list, P, …, cb)` | `render.js` |
| очередь подписей HUD (после подложек) | массив `ui_text_pending` | `uiTextBegin/uiTextPush/uiTextFlush` | `render.js` |
| кандидаты тика виджетов: якоря, контейнеры, темы | `for…of ctx.nodes` | `filterNodes(nodes, mode, tags?)` | `widgets.js` |
| размер JS-кучи | — | `memory()` | `$.debug.memory()` |

Модули с большим числом своих спрайтов пишут в батч через `nativeTiles` /
`nativeParticles` из `render.js`: те сами подставляют буферы, обрезку и
счётчик, а при выключенных проходах или активном `view` возвращают `false` —
модуль рисует прежним путём.

C-код собирается без слияния `a*b+c` в FMA (`#pragma … fp contract(off)` в
`src/nodes.c`): QuickJS считает раздельно, и без прагмы твин или позиция на
экране расходились бы с JS-путём в последнем знаке.

Где JS-цикл звал обработчики посреди обхода, C-проход **возобновляемый**:
он останавливается на узле с событием, JS рассылает его и продолжает со
следующего — обработчик видит мир так же, как раньше. `drawWorld` рисует сам
только обычные узлы; текст, свет, круг, отрисовщики модулей
(`registerNodeRenderer` сообщает их C через `specialTags`), тень, контур,
nine-slice, шейдер, обрезку, тряску и узлы не 2D-вида он отдаёт в
`drawWorldNode` через колбэк — порядок кадра не меняется.

Сверка: `$.debug.nativePasses(false)` возвращает JS-проходы;
`tests/agent/native_passes_test.py` сравнивает кадр, статистику, наведение,
события мира и синк тела в обоих режимах — кадр совпадает до байта.

## Агентский eval

Команда `eval` агентского протокола ([AGENT_API.md](../AGENT_API.md)) — это
инструмент диагностики движка, а не игровой код. На время одного вызова
`r2d_script_eval` выставляет `globalThis.engine` и сразу его убирает: тест
может прочитать `engine.depthInfo()` или `engine.limits()`, но колбэк кадра,
зарегистрированный из `eval`, должен держать свою ссылку:

```js
// внутри eval: engine виден только сейчас
((E) => $.update(() => E.submitMesh(verts, n)))(engine);
```

## Что заменило прямые вызовы `engine.*` в играх

| Было | Стало |
|---|---|
| `engine.startScene` | `$.startScene` |
| `engine.whiteSprite` | `$.gfx.white` |
| `engine.width` / `engine.height` | `$.gfx.size()` → `{ w, h }` |
| `engine.time` | `$.time.realNow()` |
| `engine.setCursor(shape)` | `$.input.cursor(shape)` / `$.window.cursor(kind)` |
| `engine.drawSprite(...)` | `$.gfx.push.sprite(...)` |
| `engine.audio.load(path)` + `play(id)` | `$.sound.preload([path])` + `$.sound.play(path)` |
| `engine.setVelocity(body, …)` | `$(node).velocity(vx, vy)` |
| `engine.log(...)` | `$.log(...)` |

## Модульные тесты

`tests/js/_harness.mjs` кладёт мок в `globalThis.engine` **до** импорта
модулей — `native.js` снимает именно его. Подменить движок посреди теста:

```js
import { engine, setEngineForTests } from '../../src/highlevel/native.js';
const saved = engine;
setEngineForTests({ requestReload: () => true });
try { /* … */ } finally { setEngineForTests(saved); }
```

Проверки: `tests/js/small_modules_test.mjs` (bootstrap убирает глобальное
имя), `tests/agent/engine_hidden_test.py` (верхний уровень и кадр игры не
видят `engine`, `import('r2d/native.js')` отклонён, `import('r2d')` — тот же
`$`).
