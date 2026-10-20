# Сборка API — `createApi()`

Модуль собирает всё высокоуровневое API в один объект `$` и ставит подсистемы в
фиксированном порядке. Игра им не пользуется напрямую: `$` уже создан к моменту
запуска `main.js` (см. [bootstrap.md](bootstrap.md)).

```js
import { createApi, callExitHooks } from './api.js';
const $ = createApi();          // свой экземпляр API (тесты, вложенные миры)
```

---

## 1. Что здесь есть

| Имя | Смысл |
|---|---|
| `createApi()` | собрать новый экземпляр API со всеми подсистемами |
| `callExitHooks()` | вызвать хуки выхода (движок зовёт при завершении) |

Порядок установки важен: `installLayers` → `installCollisionLayers` →
`installBsp` → `installAtlas` → `installCurve` → `installTask` → `installScript`
→ `installStory` → `installQuest` → `installSoundBank` → `installSteps` →
`installBarks` → `installItems` → `installCombat` → `installWeapons` →
`installRaid` → `installCels` → `installProc` → `installKinds` →
`installRotSprite` → `installMesh` → `installReplay` → `installCutscene` →
`installAlive` → `installNet`; далее — `installWidgets`, `installTriggers`,
`installPool`, `installViewport`, `installHttp`, `installSdk`. Реактивные запросы
(`installWatch`) ставятся рядом с сигналами и состояниями, а DevTools
(`installDevTools`) — после `installAgent`:
панель берёт данные из инспекции агента.

## 2. Кадровые хуки

`$.update(fn)` и `$.render(fn)` регистрируют обработчики кадра (не `ctx.update` —
именно эти). Порядок вызовов внутри кадра:

1. `$.update(dt)` — игровая логика (до начала кадра отрисовки);
2. `$.render()` — сборка батча.

Исключения в хуках не роняют движок: они попадают в журнал через `ctx.reportError`.

## 2.1. Физика узла, добавленная при схеме C → `$`

Игре недоступен `engine.*`, поэтому то, что раньше брали из ядра, есть у узла:

| Метод | Смысл |
|---|---|
| `.angularVelocity()` / `.angularVelocity(w)` | угловая скорость тела, рад/с (без тела — 0) |
| `.mass()` | масса тела, кг (без тела — 0) |
| `.allowSleep(on)` | разрешить/запретить Box2D усыплять тело |
| `$.startScene` | имя сцены из `--scene` или `null` |

Проверка — `tests/agent/engine_hidden_test.py`.

## 2.2. Локальные трансформы и области (§39, §40)

Раздел трансформа `api.js` дополнительно:

* регистрирует кадровый проход §39 — `installTransformResolution()` →
  `engine.setResolveTransforms(resolveLocalTransforms)`. Сам кадровый цикл не
  меняется: проход зовёт `src/script.c` в конце кадра логики и перед отрисовкой,
  поэтому к началу следующего физического шага и к сборке кадра трансформы
  детей уже верны. Пока игра не включила локальный режим, проход выходит на
  первой строке — **это opt-in, старое поведение по умолчанию не меняется**;
* даёт методы узла `.transformSpace`, `.localAt`, `.localAngle`, `.localScale`,
  `.worldPoint`, `.localPoint`, `.worldTransform`; `.at/.angle/.scale/.flip`
  сохраняют мировую семантику (на локальном узле значение пересчитывается
  обратной композицией);
* `appendTo`/`append` получают политику `{ keep: 'world' | 'local' }` и
  отклоняют привязку к собственному потомку (цикл цепочки родителей);
* `dispatchContacts()` дописывает в событие `shapeA/shapeB`, `areaA/areaB`,
  `roleA/roleB`, `ownerA/ownerB`, `selfArea/otherArea`, `selfOwner/otherOwner` —
  сенсор и логический владелец приходят раздельно (§40);
* методы областей `.area`, `.areaOn`, `.areas`, `.areaOverlap` (у
  `.areaOverlap` фильтр односторонний — решает маска области; прежний
  двусторонний режим остался явным `{ both: true }`, см.
  [collision.md](collision.md) §5).

Подробности и ограничения — [core.md](core.md) §6–7 и
[HIGH_LEVEL_API.md](../HIGH_LEVEL_API.md) (§6 «Локальные трансформы», §8 «Области
узла»). Приёмка: `tests/js/transforms_test.mjs`,
`tests/agent/highlevel_transforms_test.py` (фикстура
`tests/fixtures/transforms`).

## 2.3. Встроенное управление (.controls)

`applyControls(dt)` — кадровый проход по срезу `controls` индекса реестра; он
сам двигает узел или его тело. Публичный вход — метод узла
[`.controls(схема)`](../HIGH_LEVEL_API.md#8-физика): строка `'wasd'`/`'arrows'`/
`'both'` или объект с полями `axis`, `jump`, `up`, `fire`, `coyote`,
`jumpBuffer`, `jumpCut`, `airJump`, `dropThrough`, `dropTime`, `jumpForce`.

Модуль экспортирует свою чистую логику — её проверяет
`tests/js/controls_test.mjs` без движка:

| Экспорт | Смысл |
|---|---|
| `controlsScheme(scheme)` | схема со умолчаниями (мс → секунды, клавиши, множитель обрезки) |
| `makeControlsState()` | состояние таймингов одного узла |
| `controlsTimingStep(state, s, dt, input)` | шаг: `{jump, air, cut, drop}` и обновлённое состояние |

Инварианты, которые они держат:

* окна `coyote`/`jumpBuffer` меряются игровым временем (суммой `dt`), не кадрами;
* прыжок только с земли, из coyote-форы или из запаса `airJump`; зажатая кнопка
  не даёт повторного прыжка при приземлении;
* `jumpCut` режет скорость только пока тело поднимается (`vy < 0`), и срабатывает
  в том числе на тап (нажатие и отпускание в одном кадре);
* спрыгивание (`S`/`↓`+`Space`) включается, только если узел стоит **сверху**
  односторонней платформы; флаг «игнорировать one-way» живёт в `src/physics.c`
  (`preSolve`) и снимается по игровому таймеру, когда узел прошёл платформу;
* управляемый игрок переносится кинематической платформой: к желаемой
  скорости прибавляется горизонтальная скорость опоры.

Физическую сторону — флаг `oneWayIgnore` и его учёт в `preSolve` — проверяют
`tests/agent/highlevel_controls_test.py` (агентский, фикстура
`tests/fixtures/controls_plat`) и `tests/agent/highlevel_physics_test.py`.

## 3. Совместимость

Повторный `createApi()` даёт **независимый** экземпляр: подсистемы свои, реестр
узлов общий (`ctx`), поэтому узлы видны обоим. Так делают тесты, которым нужен
чистый API.

## 4. Проверка

```bash
# API ставится и БЕЗ движка (регрессия на «$ не определён»)
build/_deps/quickjs-build/qjs tests/js/api_no_engine_test.mjs
```
# SpriteMesh для обычного Sprite

`$.fn.spriteMesh(config?)` подключает настройки и baked cache к выбранному
Sprite, возвращает текущие настройки без аргумента и отключает меш при `false`.
Кадр продолжает менять существующий `.frame()`/`.animate()` API; cache frame
выбирается по `frame_index`, runtime геометрию не перестраивает.

`$.spriteMesh.loadCache(path)` читает cache; `$.spriteMesh.draw(cache, frame,
texture, viewport, camera)` рисует кадр в SDK preview; `$.spriteMesh.project(...)`
вычисляет проекцию, а `$.spriteMesh.cacheInfo(cache)` возвращает счётчики и hashes.
