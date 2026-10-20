# GTA sandbox: персонаж как композиция — `lib/character.js`

Контроллер персонажа — замыкание над узлом `$`, а не класс и не наследник
машины/пешехода. Собирает существующие примитивы: `.velocity()`/`.at()`,
`$.input`, `node.angle`/`sprite_col`/`sprite_row`, события узла `damaged`,
необязательный `$.anim.player`. Здоровье, инвентарь, броня и оружие остаются
игрой/`$.combat` — контроллер только меняет состояние и движение.

```js
import { createCharacter } from './lib/character.js';

const hero = createCharacter($, {
    node: '#hero',
    speed: 130, runSpeed: 240, input: 'wasd', runKey: 'shift',
    sprite: { columns: 16, offset: Math.PI / 2, fps: 8,
              frames: { walk: [1, 2, 3, 4], run: [5, 6, 7, 8] } },
    rows: { idle: 0, walk: 0, run: 0, shoot: 1, hit: 2, dead: 3 },
    canControl: () => !cutscene.blocking(),
    onSeat: (info) => log(info ? 'в машине' : 'пешком'),
});
$.update((dt) => hero.update(dt));
hero.shoot({ angle: aim });                  // состояние shoot на shootMs
```

## Состояния

`idle | walk | run | shoot | hit | stunned | dead` (`STATES`). Переходы:
движение (`walk`/`run`) по вектору ввода; `shoot()` — короткое состояние с
таймером и поворотом; узел `damaged` (payload `lib/combat.js`) — `hit`, при
`payload.dead` — `dead`; `stun(ms)`, `die()`, `revive()`. В `shoot/hit/stunned`
движение заблокировано, но направление/кадр обновляются. Смена состояния шлёт
событие узла `state` `{state, previous}` и вызывает `onState`.

## API

| Вызов | Что делает |
|---|---|
| `update(dt)` | ввод, скорость/позиция, facing, кадр, таймеры |
| `state()`, `previousState()`, `states()` | состояние |
| `canControl()` | можно ли управлять (жив, не в машине, не stunned/hit, `spec.canControl`) |
| `setMove(x,y)` | ручной вектор (AI/тесты); работает при `readInput:false` |
| `setInputEnabled(on)` | общий выключатель управления (катсцена) |
| `setFacing(угол или точка)`, `face(x,y)`, `facing()` | направление |
| `shoot({angle|dir|target, ms})`, `hit(payload)`, `stun(ms)`, `die()`, `revive()` | состояния |
| `seat(info)` / `unseat(reason)` / `isSeated()` / `seatInfo()` | посадка (зовёт `lib/seats.js`) |
| `destroy()` | снять подписку на `damaged` и остановить |

`spec`: `speed`, `runSpeed`, `input`, `runKey`, `readInput: false` (ручной
режим), `rotate` (по умолчанию у узла с телом `false` — поворот тела повернул
бы коллайдер), `sprite` (колонки/строки/кадры), `clip`+`player` (имена
`$.anim.player`), `onState`, `onSeat`, `onDeath`, `damageState: false`
(не подписываться на `damaged`).

## Границы

* Нет инвентаря, брони, оружия и патронов — данные игры.
* Нет pathfinding/AI: `setMove`/`setFacing` — примитивы для `lib/ai.js`.
* `sprite_col`/`sprite_row` — единственная «анимация» по умолчанию; клипы
  `$.anim.player` подключаются именем, без переопределения анимационной системы.
* `canControl` — хук, а не машина состояний; посадкой владеет `lib/seats.js`.

Проверки: композиция с посадкой/`canControl`/`onSeat` —
`python3 tests/agent/re2d_gta_seats_test.py`.
