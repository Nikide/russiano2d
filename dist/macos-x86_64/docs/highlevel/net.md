# Multiplayer через `$.net`

Практическое руководство с Editor-сценарием, живым демо и схемами:
[MULTIPLAYER.md](../MULTIPLAYER.md).

`$.net` — высокоуровневое мультиплеерное API поверх встроенного [ENet](https://github.com/zpl-c/enet). ENet обрабатывает peer-соединения, доставку, фрагментацию и RTT. Игровой код работает с топологиями, сообщениями, комнатами и обычными `$`-сущностями; сокетных методов в игровом API нет.

По умолчанию рекомендуется авторитарный хост: он считает состояние мира, клиенты отправляют ввод и интерполируют удалённые сущности. Можно выбрать mesh, relay или свою схему.

## Поднять host и подключить игру

```js
// Сервер авторитарен по умолчанию.
$.net.host(7777, { maxPeers: 8 });
$('#crate').net({ id: 'crate:01', owner: 'host' });

$.net.on('connect', peer => console.log('подключился', peer.id));
$.net.on('input', (input, peerId) => applyPlayerInput(peerId, input));
```

Клиент подключается к адресу, созданному хостом:

```js
$.net.join('127.0.0.1', 7777);
$('#crate').net({ id: 'crate:01', owner: 'host' });
$.net.input({ left: true, jump: false });
```

Внутренний шаг сети вызывается движком автоматически до `scene.update` и `$.update`; отдельного метода опроса транспорта у игры нет. При одинаковом `id` серверный host автоматически отправляет трансформы и `hp`; клиент сглаживает их встроенной интерполяцией. Для объектов игроков назначайте устойчивый id и владельца: на клиенте `{ owner: 'local' }`, на host — `{ owner: 'client' }`. Рекомендуемый авторитарный путь — передавать ввод через `$.net.input()` и применять его на host; host проверяет ввод и сам меняет состояние мира.

```js
// Клиент: сразу применить свой ввод локально и отправить его host.
$.net.applyInput({ moveX: 1 }, state => player.at(state.x, state.y));

// Host: применить подтверждённое состояние и отправить ответ.
$.net.send('ack', { seq, state: playerState }, { peer: peerId, delivery: 'input' });
```

`$.net.predict(step)` создаёт очередь предсказания с откатом и повтором неподтверждённого ввода; `$.net.prediction().visual(dt, options)` сглаживает визуальную коррекцию, а `$.net.acknowledge(state, seq)` принимает подтверждённое состояние. Обычной репликации эти вызовы не нужны — интерполяция удалённых сетевых сущностей включена автоматически.

## Топологии

| Схема | Для чего | Запуск |
|---|---|---|
| `authoritative` | Host владеет логикой матча и реплицирует состояние | `$.net.host(port)` / `$.net.join(address, port)` |
| `mesh` | Узел одновременно слушает входящие peer-соединения и соединяется с другими | `$.net.start({ topology: 'mesh', listen: 7777, connect: [{ host, port }] })` |
| `relay` | Игровой host пересылает сообщения между подключёнными peers | `$.net.relay.enable({ listen: 7777 })` |
| `custom` | Схема владения и сообщений определяется игрой | `$.net.start({ topology: 'custom', listen, connect })` |

`start()` создаёт один ENet host с указанным listener и исходящими соединениями. Это позволяет узлу и принимать, и инициировать подключения. Для разных игровых режимов можно менять `topology()` и `authority()`.

## Сущности и синхронизация

```js
$('#guard').net({
    id: 'guard:east',
    owner: 'host',
    fields: ['x', 'y', 'angle', 'hp', 'visible'],
    interpolation: true,
});

$.net.syncRate(20);             // снимки в секунду
$.net.interpolationDelay(100);  // буфер интерполяции, мс
```

`.net(options)` добавляет сетевые настройки прямо к выборке узлов. `id` должен быть одинаковым у участников; при спавне выбирайте id из стабильного игрового ключа. По умолчанию реплицируются `x`, `y`, `angle` и `hp`. Существующие узлы получают состояние автоматически. Создание и удаление сущностей остаётся решением игры: используйте `rpc`/события, затем создавайте соответствующий узел и регистрируйте его через `.net()`.

`owner` задаёт направление состояния:

* `host` — состояние отправляет авторитарный host, клиенты принимают;
* `local` — этот процесс отправляет состояние объекта;
* `client` — host принимает состояние, принадлежащее клиенту;
* `remote` — объект только принимает состояние от другого узла.

Для peer mesh регистрируйте отправляемые объекты с `owner: 'local'`, а их удалённые копии — с `owner: 'remote'` и совпадающим id.

## Сообщения и RPC

```js
$.net.send('match:ready', { character: 'pilot' });
$.net.broadcast('round:start', { seed: 42 }, { delivery: 'reliable' });
$.net.on('match:ready', (data, peerId) => addPlayer(peerId, data));

$.net.handle('door:open', (data, peerId) => openDoor(peerId, data.id));
$.net.rpc('door:open', { id: 'north' }, { peer: hostPeerId });
```

Режимы доставки: `reliable` — важные события и RPC; `input` — ввод; `state` — частые изменяемые состояния, которые могут заменять устаревшие; `bulk` — крупные надёжные передачи. ENet использует отдельные каналы для этих потоков.

## Комнаты и relay

```js
// Host: создать комнату, доступную подключённым участникам.
$.net.host(7777);
$.net.room.create('arena', { id: 'arena-eu' });
$.net.on('room:join', (peerId, room) => spawnPlayer(peerId, room));

// Клиент:
$.net.room.join('game.example.org', 7777, 'arena', { id: 'arena-eu' });
$.net.on('room:joined', room => showLobby(room));

// Relay host пересылает игровые сообщения подключённым peers.
$.net.relay.enable({ listen: 7777 });
```

Комнаты — высокоуровневая группировка текущих соединений. ENet сам по себе не предоставляет поиск матчей, аккаунты, NAT traversal, шифрование, аутентификацию или размещённый relay-сервис. Для интернета эти сервисы и проверка прав игроков остаются частью игры/инфраструктуры.

## Диагностика и локальная симуляция

```js
$.net.status();       // доступность, host, peers, счётчики, ошибка
$.net.peers();        // peer id, RTT, время подключения
$.net.stats();        // трафик, снимки, ввод, потери симуляции
$.net.simulate({ loss: 4, delay: 80, jitter: 20, seed: 7 });
$.net.simulate({ loss: 0, delay: 0, jitter: 0 });
```

Симуляция потерь/задержки работает на уровне high-level сообщений и не блокирует кадр. `$.net.leave()` закрывает все соединения; `$.net.disconnect(peerId)` закрывает одно.

## Project Settings и Editor

В Project Settings кнопка **«Создать multiplayer.js»** доступна и для минимальных legacy-манифестов: она создаёт bootstrap с безопасными значениями по умолчанию, не меняя `project.json`. После перехода проекта на schema 2 там же можно задать топологию, порт, максимум peers и частоту репликации. Импортируйте модуль из `main.js` и вызывайте host/join из меню игры; рантайм не подключается к сети сам.

## API

| Метод | Назначение |
|---|---|
| `$.net.topology(value?)` | Прочитать или выбрать `authoritative`, `mesh`, `relay`, `custom`. |
| `$.net.authority(value?)`, `$.net.isAuthority()` | Режим владения и признак локального авторитета. |
| `$.net.start(options)` | Открыть listener и подключиться к одному или нескольким peers. |
| `$.net.host(port, options)`, `$.net.listen(port, options)` | Открыть host или входящий listener. |
| `$.net.connect(address, port, options)`, `$.net.join(address, port, options)` | Начать исходящее peer-подключение; `join` выбирает authoritative client. |
| `$.net.online()`, `$.net.available()`, `$.net.status()` | Состояние high-level сессии и доступность встроенного транспорта. |
| `$.net.port()`, `$.net.peers()`, `$.net.peer(id)`, `$.net.playerCount()`, `$.net.tick()` | Локальный порт, подключения, RTT, число peers и номер кадра сети. |
| `$.net.disconnect(peerId)`, `$.net.leave()` | Закрыть peer или всю сессию. |
| `$.net.send(type, data, options)`, `$.net.broadcast(type, data, options)` | Отправить сообщение одному peer или всем. `delivery`: `reliable`, `state`, `input`, `bulk`. |
| `$.net.rpc(name, data, options)`, `$.net.handle(name, fn)`, `$.net.unhandle(name)` | Вызвать зарегистрированное именованное действие по сети. |
| `$.net.input(data, options)`, `$.net.predict(step)`, `$.net.prediction()`, `$.net.applyInput(input, applyLocal)`, `$.net.acknowledge(state, seq)` | Ввод, локальное предсказание и серверное подтверждение. |
| `$.net.replicate(what, options)`, `$.net.unreplicate(what)`, `$.net.entities()` | Зарегистрировать или убрать сущности из автоматической репликации; короче — `.net(options)` на выборке. |
| `$.selection.net(options)` / `$.fn.net(options)` | Применить сетевые параметры к узлам выборки и вернуть выборку для цепочки. |
| `$.net.syncRate(hz)`, `$.net.interpolationDelay(ms)` | Настроить частоту снимков и буфер интерполяции. |
| `$.net.room.create(name, options)`, `$.net.room.join(address, port, name, options)`, `$.net.room.leave()`, `$.net.room.current()`, `$.net.room.peers()` | Создать/войти в комнату и прочитать её текущее состояние. |
| `$.net.relay.enable(options)`, `$.net.relay.disable()`, `$.net.relay.enabled()`, `$.net.relay.forward(type, data, except)`, `$.net.relay.broadcast(type, data)` | Включить игровую пересылку через текущий host или отправить relay-сообщение. |
| `$.net.simulate(options)`, `$.net.simulation()`, `$.net.delayed()` | Смоделировать потери/задержку и прочитать настройки очереди. |
| `$.net.stats()`, `$.net.describe()` | Счётчики сети и короткая строка статуса для UI. |
| `$.net.on(name, fn)`, `$.net.off(name, fn?)` | Подписаться или снять подписку на сетевые события. |
| `$.net.reset()` | Сбросить состояние сети для перезапуска игрового раунда. |
