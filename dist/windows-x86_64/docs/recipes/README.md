# Рецепты Russiano2D

Короткие рабочие рецепты на текущем `$` API. Каждый блок проверяется
`tools/sdk_recipes_check.py` через `r2d lint`.

## player

```js
const player = $('<sprite>').at(120, 120).size(48, 64).appendTo($.world);
$.camera.follow(player);
$.update((dt) => {
    const v = $.input.vec('wasd');
    player.move(v.x * 220 * dt, v.y * 220 * dt);
});
```

## enemy

```js
const enemy = $('<sprite>').at(300, 120).size(48, 64).health(100).appendTo($.world);
enemy.on('damage', (e) => enemy.flash('#ff4040', 0.1));
enemy.on('death', () => enemy.remove());
```

## weapon

```js
$.update(() => {
    if (!$.input.pressed('mouseleft')) return;
    $.sound.play('assets/shot.wav');
    const hit = $('#player').rayTo($.input.mouseWorld(), { mask: ['enemy'] });
    if (hit && hit.node) hit.node.damage(25);
});
```

## projectile

```js
function shoot(from, to) {
    const bullet = $('<sprite>').at(from.x, from.y).size(8, 8).appendTo($.world);
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    let left = 1.2;
    $.update((dt) => {
        bullet.move(dx / len * 900 * dt, dy / len * 900 * dt);
        left -= dt;
        if (left <= 0) bullet.remove();
    });
}
```

## door

```js
const world = $.re2dWorld.load('level.re2dworld');
const door = world.mover({ type: 'door', portal: 0, from: 0, to: 1, speed: 2 });
$.update(() => { if ($('#player').distanceTo(200, 200) < 80) door.open(); });
```

## pickup

```js
const coin = $('<sprite>').at(240, 160).size(24, 24).appendTo($.world);
$.update(() => {
    if (!coin.visible()) return;
    if ($('#player').distanceTo(coin.pos()) < 32) {
        coin.hide();
        $.sound.play('assets/coin.wav');
    }
});
```

## trigger

```js
const world = $.re2dWorld.load('level.re2dworld');
world.trigger({ id: 'gate.use', target: 'gate', x: 200, y: 100, radius: 40, bottom: 0, top: 64 });
world.onTrigger((event) => $.emit('gate.open', event.data));
```

## checkpoint

```js
const world = $.re2dWorld.load('level.re2dworld');
$.on('checkpoint', () => $.store.set('checkpoint', { x: $('#player').x, y: $('#player').y }));
$.update(() => {
    if (!$.input.pressed('f5')) return;
    const save = world.saveState();
    $.store.set('world.save', save);
});
```

## camera

```js
$.camera.follow('#hero', { smooth: 0.15, deadzone: [40, 24], lookahead: 64 });
$.on('hero.gone', () => $.camera.unfollow());
```

## dialogue

```js
$.dialog.define('guard', {
    start: 'hello',
    nodes: { hello: { text: 'Проход закрыт.', next: null } },
});
$.dialog.play('guard');
$.dialog.on('end', () => $.store.set('talking', false));
```

## inventory

```js
const bag = $.store.get('inventory') || [];
$.store.set('inventory', bag);
function pick(id) { if (!bag.includes(id)) bag.push(id); $.store.set('inventory', bag); }
pick('keycard');
```

## save

```js
const state = { health: $('#player').health(), scene: $.scene.current() };
$.store.set('save.slot1', state);
const loaded = $.store.get('save.slot1');
if (loaded) $('#player').health(loaded.health);
```

## platformer

```js
$.world.gravity(0, 1200);
const player = $('<sprite>').at(80, 80).size(32, 48).appendTo($.world);
$.update((dt) => {
    const v = $.input.vec('wasd');
    player.velocity(v.x * 200, player.velocity().y);
    if ($.input.pressed('space') && player.onFloor()) player.velocity(player.velocity().x, -520);
});
```

## top-down shooter

```js
const player = $('<sprite>').at(100, 100).size(40, 40).appendTo($.world);
$.update((dt) => {
    const v = $.input.vec('wasd');
    player.move(v.x * 180 * dt, v.y * 180 * dt);
    player.angleTo($.input.mouseWorld());
});
```

## UI

```js
const ui = $.ui.doc('ui/hud.rml').show();
$.update(() => {
    ui.text('hp', String($('#player').health()));
    ui.text('ammo', String($.store.get('ammo') || 0));
});
```

## audio

```js
const music = $.sound.play('assets/music.ogg', { loop: true, volume: 0.4 });
$.on('combat.start', () => $.sound.volume(music, 0.15));
$.on('combat.end', () => $.sound.volume(music, 0.4));
```

## tilemap

```js
const map = $.tilemap.fromASCII([
    '####',
    '#..#',
    '####',
], { '#': 1, '.': 0 }, { tileset: 'assets/tiles.png', tileSize: 32 });
$('#level').tilemap(map);
```

## particles

```js
const world = $.re2dWorld.load('level.re2dworld');
world.particles.burst({
    x: 200, y: 120, h: 32, count: 48, life: 0.8, size: 10,
    color: '#ffb040', blend: 'additive', mode: 'billboard', seed: 1,
});
```
