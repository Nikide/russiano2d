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
