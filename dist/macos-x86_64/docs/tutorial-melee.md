# Туториал: ближний бой, окна анимации и урон

Короткий разбор примера [demos/melee](../demos/melee/README.md) — §31-2
Спецификации производственной готовности. Итог: удар по окну анимации, одна
цель с несколькими hurtbox, отражение снаряда, физическая отдача и
presentation-фидбек. Всё — публичным `$`.

Запуск примера: `./build/russiano2d --game demos/melee`, проверка —
`python3 tests/agent/melee_test.py`.

## 1. Роли форм вместо компонентов

Тело узла — это движение (`movement collider`), а удар, уязвимое место и щит —
**области** того же узла (§40/§9). Роли не создают сущностей, они лишь называют
смысл формы:

```js
$('#hero').hitbox('blade', { w: 54, h: 26, x: 32 });   // чем бьём (sensor)
$('#hero').areaOn('blade', false);                     // вне окна выключен
$('#hero').hitbox('guard', { w: 16, h: 46, x: -16 });  // щит
$('#hero').hurtbox('body', { w: 26, h: 30 });           // куда бьют

$('<rect>', { id: 'grunt' }).at(460, 538).size(32, 44)
    .health(100).team(2).body('dynamic').collision(32, 44).appendTo($.world);
$('#grunt').hurtbox('torso', { w: 36, h: 30 });
$('#grunt').hurtbox('head', { w: 18, h: 18, y: -22 });  // ещё две формы
$('#grunt').hurtbox('legs', { w: 30, h: 18, y: 18 });
```

## 2. Окно анимации открывает удар, а не клип

Клип объявляет маркеры окна; игра реагирует на подписку `'window'`:

```js
$.anim.clip('slash', {
    duration: 420,
    tracks: [{ type: 'sprite', keys: [{ t: 0, v: 0 }, { t: 120, v: 1 }, { t: 300, v: 2 }, { t: 420, v: 0 }] }],
    events: [
        { at: 120, name: 'attack-open',  window: 'attack', windowPhase: 'open'  },
        { at: 300, name: 'attack-close', window: 'attack', windowPhase: 'close' },
    ],
});

const player = $.anim.player('hero').target('#hero');
player.on('window', (e) => {
    const open = e.window.open;
    $('#hero').areaOn('blade', open);
    if (open) state.attack = $.combat.attack({
        source: '#hero', owner: '#hero', team: 1,
        amount: 25, damageType: 'slash', window: 180,   // столько же, сколько окно
        rehit: 'once', impulse: { x: 320, y: -40 }, data: { zone: 'chest' },
    });
    else if (state.attack) { $.combat.endAttack(state.attack); state.attack = null; }
});

// В кадре: пока окно открыто, удар «щупает» hitbox.
$.update(() => {
    if (state.attack && player.window('attack')) {
        $.combat.strike(state.attack, $('#hero').areaOverlap('blade'));
    }
});
```

Почему не «бей, пока играет клип»: у клипа есть замах и восстановление, и урон в
них — баг геймплея. Окно даёт ровно 180 мс из 420 и проверяется тестом.

## 3. Несколько hurtbox — один удар

`strike()` дедуплицирует попадания по **владельцу цели**, а не по форме:

```js
const res = $.combat.strike(attack, $('#hero').areaOverlap('blade'));
// res.accepted === 1, даже если у цели три hurtbox
// res.results[0].reason === 'duplicate' — повторный удар той же атакой
```

Новая атака (новый `$.combat.attack()`) поражает ту же цель снова. Причины
отказа фактические: `inactive_window`, `immunity`, `team`, `duplicate`,
`destroyed_target`, `owner_dead`.

## 4. Отражение снаряда

```js
const shot = $.combat.attack({ source: '#shooter', owner: '#shooter', team: 3,
                               amount: 18, damageType: 'bullet', window: 6000 });

// Попадание в щит:
const reflected = $.combat.reflect(shot, { owner: '#hero', team: 1, multiplier: 1.5 });
// reflected.id !== shot.id — новая identity
// reflected.owner_id — nid героя, reflected.team — 1, shot.reflectedBy — id отражённой
```

Снаряд при этом — presentation-данные игры: цвет, направление и `team` в
атрибутах меняет сама игра, потому что «как выглядит отражённый снаряд» —
решение игры, а не движка.

## 5. Отдача не стирается управлением

Импульс из damage request идёт в тело и в канал внешней скорости (§8):

```js
$.combat.damageRequest({ amount: 20, source: '#hero', target: '#enemy',
                         impulse: { x: 320, y: -40 } });
```

`.controls()` каждый кадр задаёт горизонтальную скорость, поэтому без канала
внешней скорости отдача исчезла бы в следующем тике. С каналом тело честно
летит назад и **упирается в стену** — отдача остаётся физикой, а не сдвигом
спрайта сквозь препятствия.

## 6. Feedback — presentation, не урон

```js
$('.hurtable').each((i, enemy) => enemy.on('damage', (e) => {
    const res = e.data;
    if (!res.accepted) return;
    $.hitFx(res, res.death ? 'death' : 'crit');   // ответ §9 — уже адрес и точка
}));
```

`$.hitFx` получает **damage-ответ §9** напрямую: точка берётся из `x`/`y`
(позиция цели — факт, известный движку), а цель — из `targetNodeId` (`nid`), без
ссылки на узел и без циклического JSON. Собирать `{ x, y, self }` руками не
нужно. Эффект даёт hit-stop, тряску, вспышку и частицы; источник урона — сам
ответ, а не эффект: выключите фидбек (`$.store.set('feedback', false)`) — урон и
счётчик попаданий не изменятся.

Отражённая атака по форме не отличается от обычной: `$.combat.reflect()` сразу
создаёт журналы `hits`/`hit_targets`, поэтому её можно передавать в `strike()` и
`$.combat.attacks()` без ручной правки объекта.

## Проверка поведения

`tests/agent/melee_test.py` (40 проверок) запускает пример в агентском режиме и
проверяет именно поведение: урон вне окна, один удар при трёх hurtbox, вторая
атака, смена владельца при отражении, отдачу в стену, смерть ровно один раз и
независимость урона от presentation. Тест проходит и в конфигурации без RE2D
(`R2D_BINARY=build-2d/russiano2d`).
