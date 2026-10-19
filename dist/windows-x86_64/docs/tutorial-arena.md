# Туториал: pattern arena — фазы, пул, пауза, смерть и рестарт

Как собрать арену с боссом из готовых подсистем `$`: явные фазы, отменяемая
фаза без «отложенных выстрелов», пул врагов и снарядов, пауза по игровым часам,
смерть ровно один раз и рестарт без утечек. Полный пример —
[`demos/arena`](../demos/arena/README.md), автоматическая приёмка —
`python3 tools/run_tests.py arena_test` (62 проверки).

Справочники: [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md),
[state.md](highlevel/state.md), [pool.md](highlevel/pool.md),
[flow.md](highlevel/flow.md), [triggers.md](highlevel/triggers.md) (§44),
[scene.md](highlevel/scene.md) (§5), [time.md](highlevel/time.md).

---

## 1. Фазы как открытые данные, а не «boss engine»

Спецификация §12 запрещает встраивать универсальный boss framework. Поэтому
фазы — таблица, а правила переходов — три явных источника: HP, таймер и маркер.

```js
const PHASES = [
    { id: 'prepare', hpMax: 101, duration: 900, spawns: 2, shots: 0 },
    { id: 'volley',  hpMax: 75,  duration: 1400, interval: 320, shots: 1 },
    { id: 'summon',  hpMax: 50,  duration: 1600, interval: 500, spawns: 3 },
    { id: 'burst',   hpMax: 25,  duration: 1400, interval: 200, spawns: 1, shots: 3 },
];

function phaseByHp(hp) {                 // HP-правило
    let index = 0;
    for (let i = 0; i < PHASES.length; i++) if (hp <= PHASES[i].hpMax) index = i;
    return index;
}
```

Машина фаз — существующая `$.state`: состояния = фазы, события = `next`,
`interrupt`, `killed`, а цель `next` вычисляется функцией (данные решают, куда
идти):

```js
machine = $.state.create({
    name: 'arena-boss', initial: 'idle', data: state,
    states: {
        idle:    { enter: () => { state.phase = 'idle'; }, on: { start: 'prepare', killed: 'dead' } },
        prepare: phaseState('prepare'),
        volley:  phaseState('volley'),
        summon:  phaseState('summon'),
        burst:   phaseState('burst'),
        dead:    { enter: () => onDeath(), on: { restart: 'prepare' } },
    },
});

const phaseState = (id) => ({
    enter: () => startPhase(id),                 // scoped-таймеры фазы
    exit:  () => stopPhase(false),
    on: {
        next: () => (state.hp <= 0 ? 'dead' : pickPhase()),
        interrupt: { target: 'idle', action: () => cancelPhase('interrupt') },
        killed: 'dead',
    },
});
```

`pickPhase()` двигает фазу минимум на шаг вперёд и не меньше, чем требует HP:
таймер обязан менять картину, иначе арена «залипает» на первой фазе.

## 2. Отменяемая фаза: область владения вместо списка таймеров

Действия фазы (очередь выстрелов, спавн волны, таймаут) ставятся в **область
владения фазы**. Закрытие области снимает всё разом — это и есть гарантия «нет
отложенных выстрелов»:

```js
function startPhase(id) {
    stopPhase(true, 'смена фазы');
    phaseScope = $.scene.scope('arena:phase:' + (++serial));
    phaseScope.after(0, () => act(phase));
    phaseScope.every(phase.interval, () => act(phase));
    phaseScope.after(phase.duration, () => $.state.send('#boss', 'next'));
}

function stopPhase(cancelled, reason) {
    const scope = phaseScope; phaseScope = null;
    if (!scope) return false;
    if (cancelled) state.phaseCancels++;
    scope.close({ immediate: true, reason });     // все таймеры/потоки фазы сняты
    return true;
}
```

Прерывание — переход FSM в `idle`; `exit` фазы закрывает область. В примере
после отмены за 90 кадров не появляется ни одного нового снаряда и спавна
(проверяется числом). Уже выпущенные снаряды не телепортируются: они доживают
и возвращаются в пул по выходу за экран.

## 3. Пул: сотни спавнов без роста узлов

```js
$.pool.create({ name: 'arena-minions', tag: 'enemy', max: 48, initial: 0, w: 18, h: 18, hp: 10 });
$.pool.create({ name: 'arena-shots',   tag: 'bullet', max: 64, initial: 0, w: 8, h: 8, gravity: false });

const m = $.pool.spawn('arena-minions', { x, y });   // пусто, если пул исчерпан
if (m.length) m.velocity(vx, vy);
...
el.release();                                        // вернуть в пул
```

Пул выключает тело вернувшегося узла и убирает его из `ctx.nodes`, поэтому
`$.scene.counts().nodes` не растёт: в примере три раунда по 60 спавнов дают
`created = 48`, `spawned = 163`, `skipped = 3`, а узлы держатся на `база + 48`.
Перед рестартом полезно `$.pool.releaseAll()` — освободить всё, что осталось.

## 4. Пауза: `$.time` плюс §44

Фазы и снаряды тикают **игровым** временем (`$.time.delta()`), поэтому
`$.time.pause()` останавливает и таймеры фазы, и движение снарядов. Дополнительно
§44-политика выключает обработку узлов, чтобы они не «просыпались» в обход паузы:

```js
function setPaused(on) {
    state.paused = on;
    if (on) $.time.pause(); else $.time.resume();
    for (const sel of ['#player', '#boss']) {
        $(sel).processing(on ? { update: false, timers: false, physics: false } : null);
    }
}
```

Проверка идёт числами: на паузе `$.flow.now()` и позиция снаряда не меняются,
фаза и счётчик выстрелов стоят, число таймеров не уменьшается; после `resume`
время идёт, снаряд продолжает движение, `processing('update')` снова `true`.

## 5. Смерть ровно один раз и рестарт без утечек

```js
function hitPlayer(amount) {
    if (state.playerDead) return false;          // смерть ровно один раз
    state.hpPlayer -= amount;
    if (state.hpPlayer <= 0) $.state.send('#boss', 'killed');
    return true;
}
```

Переход `killed → dead` есть только из живых фаз, поэтому повторный удар в
состоянии `dead` не находит перехода и счётчик не растёт. В `dead.enter`
закрывается область фазы и освобождаются снаряды.

Рестарт — явное правило «начать заново»: арена живёт в области владения (§5),
поэтому `$.scene.load('arena', { scope: true })` заменяет мир целиком, а
подписки/таймеры сцены закрываются вместе с ней:

```js
function restart() { setPaused(false); return $.scene.load('arena', { transition: 'none', scope: true }); }
```

Числа из приёмки: до рестарта и после — одинаковые
`{nodes:15, bodies:10, subs:1, waits:0, timers:2, tasks:0, flows:0, scopes:2}`,
`$.state.list().length == 1`, а `$.signal.emit('arena:hit')` после рестарта
вызывает ровно одну подписку.

## 6. Чего не хватает сегодня

| Чего нет | Обход в примере | Пункт |
|---|---|---|
| TTL/auto-release у пула | ручной `release()` по выходу за экран | §21/§47 |
| Отменяемый переход и остаток таймера у FSM | закрытие scope + `idle`; проверка по факту | §12 |
| Информация о «съеденном» паузой времени | проверка по возобновлению | §6 |
| Смена `max` у существующего пула | фиксированный потолок при `create` | §21 |
| Готовые окна §9 для снарядов из пула | в примере урон боссу — явный вызов | §9 |

Ограничения и трактовки продублированы рядом с API в
[README примера](../demos/arena/README.md).
