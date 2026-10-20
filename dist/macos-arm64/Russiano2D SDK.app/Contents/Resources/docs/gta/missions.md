# Mission hooks — `lib/missions.js`

Миссии — **данные + hooks** поверх уже существующих подсистем, без C-фреймворка:
зон/чекпоинтов (`$.triggers.zone`), событий (`$.signal.on/emit`), таймеров
(собственный `update(dt)` на игровом времени), состояния (`$.save.set/get`).

## 1. Создание и определение

```js
import { createMissions, deliveryMission, checkpointMission } from './lib/missions.js';

const missions = createMissions($, {
    player: '#player',          // detect зон
    saveKey: 'gta.missions',    // $.save-ключ
    autoLoad: false,            // явная загрузка: loadFromStore()
});

missions.define(deliveryMission({
    id: 'pizza', title: 'Доставка пиццы',
    pickup:  { x: 250, y: 300, w: 80, h: 80 },
    dropoff: { x: 700, y: 300, w: 80, h: 80 },
    cargo: 'pizza',             // имя флага (по умолчанию 'cargo')
    timeLimit: 90,              // секунд, 0 — без лимита
    onStart: (ctx) => {},
    onStage: (ctx, stageId) => {},
    onComplete: (ctx) => {},
    onFail: (ctx, reason) => {},
}));
missions.accept('pizza');
$.update((dt) => missions.update(dt));
```

Общее описание:

```js
{
  id, title, timeLimit: 0, repeatable: false, autoAccept: false,
  stages: [ { id, kind:'zone'|'deliver'|'event'|'counter'|'timer', … } ],
  onStart, onStage, onComplete, onFail          // функции — только в коде
}
```

## 2. Этапы

| kind | Поля | Что считается |
|---|---|---|
| `zone` | `zone:{x,y,w,h}`, `detect`, `requires`, `set`, `clear` | вход игрока в зону |
| `deliver` | то же | вход в зону с проверкой `requires` (это же использует deliveryMission) |
| `event` | `signal` (или `event`), `match` (строка/функция) | `$.signal.emit(name, payload)` |
| `counter` | `counter:'kills'`, `count:2` | `missions.counter('kills', 1)` |
| `timer` | `after: секунды` | истечение `after` игровых секунд (этап завершается) |

Зоны создаются на старте этапа и **удаляются** при переходе/завершении — утечки
`<trigger>`-узлов нет. `requires` — обязательные флаги в `state.data`
(например, `cargo`); `set`/`clear` меняют их на переходе. Порядок этапов
фиксирован: перескочить чекпоинт нельзя (проверка «текущий ли это этап»).

## 3. `deliveryMission` и `checkpointMission`

- `deliveryMission({id,title,pickup,dropoff,cargo,timeLimit,…})` — два этапа:
  pickup ставит флаг груза, dropoff требует его и очищает.
- `checkpointMission({id,points:[{x,y,radius|w,h}],timeLimit,…})` — этапы-зоны
  **по порядку**; последний завершает миссию.

## 4. Hooks и события

- hooks в определении: `onStart(ctx)`, `onStage(ctx, stageId, event)`,
  `onComplete(ctx)`, `onFail(ctx, reason)`, плюс `stage.onEnter(ctx,event)`.
- `ctx = {id,title,stage,stageIndex,stages,data,counters,elapsed,remaining,mission,state}`.
- глобальные сигналы: `mission:started`, `mission:stage`, `mission:complete`,
  `mission:failed` (payload `{id,title?,stage?,reason?,state?}`); они же
  продублированы в `$.emit`.
- локальные слушатели: `missions.on('complete', fn)` (`start|stage|complete|fail`).

HUD/звук/награды — подписчики, а не часть библиотеки. Награду миссии игра
выдаёт сама в `onComplete` (движок не знает кошелька/инвентаря —
см. `$.quest`, если нужна книга заданий).

## 5. Состояние и сохранение

| Вызов | Результат |
|---|---|
| `status(id)` | `locked` / `available` / `active` / `done` / `failed` |
| `state(id)` | `{status,stage,elapsed,remaining,data,counters}` |
| `active()` | id активных миссий |
| `accept(id)` / `abort(id,reason)` | взять/провалить |
| `update(dt)` | таймеры + автоэтапы; dt секунды |
| `counter(name, delta)` | +N к счётчикам активных counter-этапов, вернуть накопленное |
| `flag(name, value)` / `hasFlag` / `data(name)` | флаги данных активных миссий |
| `save()` / `load(snapshot)` | снимок `{version:1, missions:{id:{status,stage,elapsed,remaining,data,counters}}}` |
| `saveToStore()` / `loadFromStore()` | через `$.save` (ключ `saveKey`) |
| `reset()` | все миссии снова `available` (или `autoAccept`) |
| `on/off` | локальные hooks |
| `dispose()` | снять подписки и зоны |

`autoLoad` по умолчанию **false**: сцена сама решает, когда грузить сохранение.
После `load()` активная миссия восстанавливает этап, данные и пересоздаёт зону
текущего этапа. Неизвестные сохранённые id запоминаются и восстанавливаются,
когда определение появится позже.

## 6. Ограничения

- нет собственного UI-журнала: `state()`/сигналы дают данные, вёрстка — RmlUi
  силами игры;
- миссии не сериализуются в коде: определение (функции hooks) снова
  регистрируется сценой, сохраняется только прогресс;
- нет «сюжетного графа» и ветвлений: для этого есть `$.quest`/`$.story`;
- таймеры идут только через `update(dt)`: сцена обязана его звать (у движка нет
  глобального mission-тика).

## 7. Проверка

`tests/agent/re2d_gta_missions_test.py`: pickup→dropoff по триггерам, сигналы и
hooks, timeLimit→failed, порядок чекпоинтов, event/counter-этапы, `save/load`
и `loadFromStore` через `$.save`, уборка зон, детерминизм при `--fixed-dt`.
