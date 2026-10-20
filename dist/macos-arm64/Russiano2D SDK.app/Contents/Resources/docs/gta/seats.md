# GTA sandbox: сиденья и вход/выход — `lib/seats.js`

Композиция над существующими узлами/вводом. Машина — абстрактный объект
`{ node, seats?, seatsData? }`; менеджер не знает физику `lib/vehicle.js` и не
редактирует её.

```js
import { createSeats } from './lib/seats.js';

const seats = createSeats($, {
    ejectOffset: 24,
    onEject: (info) => {},                // {vehicle, node, index, reason, x, y}
});
const vehicle = {
    node: $('#car').get(0),
    seatsData: [
        { x: 8,  y: 0,  side: 'front', door: 'left'  },   // водитель
        { x: -24, y: 0, side: 'rear',  door: 'left'  },
        { x: -24, y: 16, side: 'rear', door: 'right' },
    ],
};

seats.enter(vehicle, hero, { seat: 0 });        // или {side:'rear', door:'right'}
$.update((dt) => seats.update(dt));             // синк позиций пассажиров
$('#car').remove();                             // пассажиры будут высажены
```

## API

| Вызов | Что делает |
|---|---|
| `enter(vehicle, passenger, {seat/index, side, door, lock, onEnter})` | посадить; `{ok, reason?, vehicle, node, index, x, y}` |
| `exit(passenger, {reason, onExit})` / `exit(vehicle, passenger)` | высадить |
| `exitAll(vehicle, reason)` | высадить всех |
| `seatOf(passenger)` / `isSeated(passenger)` / `occupants(vehicle)` | занятость |
| `seats(vehicle)` / `freeSeats(vehicle)` | места и якоря |
| `update(dt)` | синхронизировать пассажиров с кузовом; страховка от destroy |
| `release(vehicle)` / `clear(reason)` / `count()` | снять guard/состояния |

`passenger` — узел или адаптер `{node, seat(info), unseat(reason)}`; адаптер
`lib/character.js` вызывается автоматически (он же даёт `canControl()=false`
на посадке). `side` — ряд (`front`/`rear`), `door` — сторона выхода
(`left`/`right`), `yaw` — дополнительный поворот якоря.

Системный ввод: на каждое занятое место берётся `$.input.lock('vehicle',
'seats')` — **advisory** токен (виден в `$.input.locks()/locked()`), он
отпускается при выходе. Жёсткий `{hard:true}` вариант включается опцией
`createSeats($, {hardLock:true})`: он гасит `$.input.down/pressed/released`
(и `vec()`), но тогда те же клавиши не прочитает ни машина, ни выход — поэтому
по умолчанию так не делается; персонаж и так не ходит из-за `canControl()`.

## Безопасное уничтожение

`Node.destroy()` в движке сначала уничтожает детей, **потом** шлёт `remove`,
события «до destroy» нет. Пассажир привязан к кузову через `.appendTo()`,
поэтому на время жизни машины менеджер ставит **экземплярную** обёртку
`node.destroy`, которая сначала высаживает всех, затем вызывает оригинал
(guard снимается в `release()`). Это поведение игрового JS; C не правится.
Событие `death` машины (`lib/combat.js`) тоже высаживает всех. В обоих случаях
`reason = 'vehicle_destroyed'`, пассажир возвращается в мир/прежнего родителя,
input lock отпускается, вызывается `onEject`.

Ограничения: guard — правка метода экземпляра (не переживает `$.prefab`
копирование узла как «чистого»), поэтому после `release`/`clear` его нет;
дверная анимация, проверка проёма двери и стрельба из машины — игра; глубина
пассажира не синхронизируется; физику машины менеджер не ведёт.

Проверки: `python3 tests/agent/re2d_gta_seats_test.py` (вход/выход/несколько
мест/выбор по side/door, lock и его снятие, синк на повёрнутом кузове, выход по
двери, death и `remove()` машины с пассажирами, guard/release/clear).
