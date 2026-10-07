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
`installRaid` → `installCels` → `installProc` → `installAlive` → `installNet`
→ `installReplay`. Реактивные запросы (`installWatch`) ставятся рядом с
сигналами и состояниями, а DevTools (`installDevTools`) — после `installAgent`:
панель берёт данные из инспекции агента.

## 2. Кадровые хуки

`$.update(fn)` и `$.render(fn)` регистрируют обработчики кадра (не `ctx.update` —
именно эти). Порядок вызовов внутри кадра:

1. `$.update(dt)` — игровая логика (до начала кадра отрисовки);
2. `$.render()` — сборка батча.

Исключения в хуках не роняют движок: они попадают в журнал через `ctx.reportError`.

## 3. Совместимость

Повторный `createApi()` даёт **независимый** экземпляр: подсистемы свои, реестр
узлов общий (`ctx`), поэтому узлы видны обоим. Так делают тесты, которым нужен
чистый API.

## 4. Проверка

```bash
# API ставится и БЕЗ движка (регрессия на «$ не определён»)
build/_deps/quickjs-build/qjs tests/js/api_no_engine_test.mjs
```
