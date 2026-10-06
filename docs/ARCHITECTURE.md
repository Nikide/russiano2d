# Архитектура и философия API `$`

> Исходный проектный документ: каким задумывалось высокоуровневое API.
> Актуальный справочник — [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md).

jQuery-style API для 2D-движка (SDL3 + QJS-NG)

Ок, вот переделка. Никаких классов для пользователя. Только $. Всё chainable. Всё через селекторы. Создание через <тег> как в jQuery.
1. ФИЛОСОФИЯ
text

- $  — единственная точка входа
- Всё возвращает один и тот же wrapper → цепочки
- Создание через $('<player>', {...}) — как HTML
- Поиск через селекторы: $('#hero'), $('.enemy'), $('npc')
- События через .on() .off() .emit()
- Никаких new, extends, this — юзер пишет декларативно
- Неявная итерация: $('.enemy').damage(10) бьёт всех
- Всё асинхронное — Promise, если надо
- Матчинг по CSS-подобным селекторам

2. ГЛАВНЫЙ ОБЪЕКТ $
text

$('<player>')                  создать
$('<enemy>', { hp: 30 })       создать с атрибутами
$('#hero')                     найти по id
$('.enemy')                    по классу
$('player')                    по типу
$(':alive')                    по фильтру
$('#hero, .boss')              объединение
$(node)                        обернуть готовый
$([a, b, c])                   из массива
$(null) / $(undefined)         пустой набор (безопасно)

$.world                        мир
$.camera                       камера
$.input                        ввод
$.sound                        звук
$.gfx                          графика (overlay)
$.store                        сохранения
$.scene                        менеджер сцен
$.time                         время
$.debug                        отладка

$.ready(fn)                    при старте
$.update(fn)                   каждый кадр
$.render(fn)                   отрисовка
$.exit(fn)                     при выходе

$.emit(name, data)             глобальное событие
$.on(name, fn) $.off(name, fn)
$.selectors                    регистрация кастомных селекторов
$.fn                           прототип — расширение через $.fn.myMethod = ...

3. СОЗДАНИЕ СУЩНОСТЕЙ (HTML-like)
text

$('<player>')
$('<player>', { id: 'hero', hp: 100, speed: 200 })
$('<enemy>',   { class: 'goblin', sprite: 'orc.png' })
$('<sprite>',  { src: 'tree.png' })
$('<text>',    { text: 'Hello', size: 24 })
$('<rect>',    { w: 32, h: 32, color: '#ff0000' })
$('<circle>',  { r: 20, color: 'blue' })
$('<tilemap>', { src: 'level1.tmx', tile: 32 })
$('<light>',   { radius: 200, color: '#ffaa00' })
$('<particles>', { src: 'fire.json' })
$('<trigger>', { w: 100, h: 50 })
$('<area>')
$('<ui.button>', { text: 'Play' })
$('<ui.label>',  { text: 'HP' })
$('<ui.panel>')

Атрибуты в объекте = свойства, эмитятся в сеттеры.
Любой непонятный ключ → .attr(key, value)

4. СЕЛЕКТОРЫ (CSS-подобные)
text

'#id'                  по id
'.class'               по классу
'type'                 по типу (player, enemy, sprite, ...)
'*'                    все
':alive'               живые
':dead'                мёртвые
':visible' ':hidden'
':onScreen'            в камере
':offScreen'
':paused'
':picked'              по курсору
':first' ':last' ':even' ':odd' ':eq(n)'
':has(.item)'          есть дети
':parent'              есть дети
':empty'               без детей
'[hp<20]'              атрибут-условие
'[team=1]'
'[hp<20][speed>100]'   комбинировать
'player.enemy'         тип + класс
'#hero .weapon'        вложенность
'>'                    прямой потомок
' '                    любой потомок
','                    объединение

Кастомные:
text

$.selectors[':boss'] = n => n.data.rank === 'boss';
$(':boss').hp(1000);

5. ЦЕПОЧКИ (chainable, всё возвращает wrapper)
js

$('#hero')
  .at(100, 200)
  .size(32, 32)
  .sprite('hero.png')
  .speed(250)
  .health(100)
  .layer(2)
  .tag('friendly')
  .controls('wasd')
  .on('hit', e => e.shake(0.3))
  .appendTo($.world);

6. МЕТОДЫ ПО КАТЕГОРИЯМ
Позиция / трансформ
text

.at(x, y)                       → this
.at(vec2)
.move(dx, dy) / .move(v)
.moveTo(x, y, ms?)              с твином, если ms
.pos()                          → { x, y }
.globalPos()                    → { x, y } (мировые)
.rotate(deg) / .rotation()
.angle(rad)
.scale(s) / .scale(sx, sy)
.lookAt(target)                 'target' — селектор или point
.flip(x?, y?)
.depth(z)
.layer(n)

.distanceTo('#enemy')           → number
.directionTo('#enemy')          → { x, y }
.angleTo('#enemy')              → rad
.rayTo('#enemy')                → { hit, point, normal } | null
.toGlobal(local) → { x, y }
.toLocal(global) → { x, y }

Визуал
text

.sprite(path)
.region(x, y, w, h)             атлас
.frame(n)                       кадр в атласе
.frames({ w, h, cols })
.animate(name)                  запустить анимацию
.animate(name, { loop, speed })
.stopAnim()
.color('#ff0000')               modulate
.alpha(0.5)
.opacity(0.5)
.visible(true/false)
.hide() / .show()
.fadeIn(ms) / .fadeOut(ms)
.blend('add' | 'mul' | 'alpha')
.shader('water.glsl')
.shaderParam('wave', 0.5)
.outline(w, color)
.shadow({ x, y, color, blur })

Физика
text

.velocity(x, y) / .velocity(v)
.velocity()                     → { x, y }
.applyForce(x, y)
.applyImpulse(x, y)
.gravity(true/false)
.body('static' | 'dynamic' | 'kinematic')
.collision(w, h)                хитбокс
.collisionCircle(r)
.mask(bits)
.layerBits(bits)
.collidesWith('.wall')
.onFloor() → bool
.onWall() → bool
.moveAndSlide(dt)
.jump(force)

.overlaps('#enemy')             → bool
.overlaps('#enemy', cb)         подписка
.inside('#zone')

Здоровье / урон
text

.health(100)
.hp()                           → number (текущее)
.hp(n)                          сеттер (урон/лечение)
.maxHp(100)
.damage(10)                     нанести урон
.heal(10)
.kill()
.respawn(x, y)
.alive()                        → bool
.team(1)

События (jQuery-стиль)
text

.on('hit',       e => {})
.on('death',     e => {})
.on('spawn',     e => {})
.on('tick',      e => {})       каждый кадр
.on('enter',     e => {})       в камере
.on('leave',     e => {})
.on('collide',   e => {})
.on('click',     e => {})
.on('key',       e => {})
.on('animEnd',   e => {})
.on('custom:foo', e => {})

.off('hit')
.off('hit', handler)
.off()                          все

.trigger('hit', { dmg: 5 })     локально
.emit('hit', { dmg: 5 })        то же

e объект: {
  self     — wrapper, на кого сработало
  target   — wrapper
  source   — wrapper
  data     — то что передали
  stop()   — остановить распространение
  preventDefault()
  dt, frame
}

Твины / анимации
text

.moveTo(x, y, ms, ease?)        → Promise
.tween({ x, y, alpha }, ms, ease)
.tweenTo({ prop: value }, ms)
.rotateTo(deg, ms)
.scaleTo(s, ms)
.fadeTo(0, ms)
.shake(intensity, ms)
.flash(color, ms)
.bounce(h, ms)
.animate('walk')                спрайт-анимация
.animate('walk', { loop, speed, end })
.sequence([...])
.pauseTweens()
.resumeTweens()
.clearTweens()

Easing-строки:
'linear' 'ease' 'easeIn' 'easeOut' 'easeInOut'
'easeInCubic' 'easeOutCubic' 'easeInOutCubic'
'easeInBack'  'easeOutBack'
'easeOutElastic' 'easeOutBounce'

Звук (позиционный)
text

.sound('jump.wav')              привязать звук
.playSound()                    проиграть
.mute(b)
.volume(v)

Иерархия
text

.appendTo(parent)
.prependTo(parent)
.append(child)
.prepend(child)
.remove()                       удалить из мира
.detach()                       отсоединить, сохранить
.parent()
.children(sel?)
.find(sel)
.closest(sel)
.siblings(sel?)

Коллекция (jQuery)
text

.each((i, el) => {})
.map(el => el.hp())
.first() .last() .eq(i)
.slice(a, b)
.add(sel)
.not(sel)
.filter(sel | fn)
.is(sel) → bool
.has(sel) → bool
.length → number
.get(i) → Node
.toArray() → Node[]
.index()

.every(fn) → bool
.some(fn)  → bool
.reduce(fn, init)

Data / классы / теги
text

.data('key') / .data('key', val) / .data({})
.attr('key') / .attr('key', val)
.addClass('x') / .removeClass('x') / .toggleClass('x')
.hasClass('x')
.addTag('x') / .removeTag('x')
.tag('x')                       алиас addClass

Массовые операции
text

$('.enemy').damage(10)
$('.enemy').stopAll()
$('.enemy').at(0, 0)            телепорт всей толпы
$('.enemy').remove()

7. МИР / КАМЕРА / СЦЕНА
text

$.world
  .gravity(x, y)
  .bounds(x, y, w, h)
  .background(path)
  .color('#000')
  .pause() / .resume()
  .clear()
  .spawn('<player>', x, y) → wrapper
  .query(x, y, r?) → wrapper[]  все в точке/радиусе
  .raycast(from, to, opts) → hit|null
  .raycastAll(from, to)    → hit[]
  .timeScale(0.5)               slow-mo

$.camera
  .follow('#hero')
  .follow('#hero', { offset: [0, -50], smooth: 0.15 })
  .unfollow()
  .zoom(1.5) / .zoomTo(2, 300)
  .panTo(x, y, ms)
  .shake(intensity, ms)
  .limits(x, y, w, h)
  .deadzone(w, h)
  .screenToWorld(p) / .worldToScreen(p)
  .pos() / .at(x, y)

$.scene
  .load('mainMenu')
  .load('level1', { transition: 'fade', ms: 300 })
  .push('pauseMenu')
  .pop()
  .current() → name
  .preload(['level2', 'level3'])
  .transition('fade' | 'slide' | 'wipe' | 'dissolve', ms)

$.time
  .delta() → seconds
  .now() → seconds
  .fps() → int
  .scale(0.5)                    глобальный slow-mo
  .pause()
  .resume()
  .wait(ms) → Promise
  .after(ms, fn)
  .every(ms, fn) → id
  .cancel(id)

8. ВВОД (jQuery-стиль)
text

$.input
  .down('space') → bool
  .pressed('space') → bool (только в кадре нажатия)
  .released('space')
  .axis('left', 'right') → -1..1
  .vec('wasd') → { x, y } (готовый вектор)
  .mouse() → { x, y }
  .mouseDelta() → { x, y }
  .mouseDown('left') → bool
  .wheel() → { x, y }
  .gamepad(0).axis('leftX')
  .gamepad(0).button('a')
  .rumble(0, { weak: 0.5, strong: 0.5, ms: 200 })

  .on('key',       e => {})       e.key, e.pressed
  .on('mouse',     e => {})
  .on('wheel',     e => {})
  .on('gamepadOn', e => {})
  .on('gamepadOff',e => {})

  .bind('jump', ['space', 'w', 'gamepad.a'])
  .unbind('jump')
  .down('jump')                   работает и для action, и для key

На элементе:
  $('#hero').controls('wasd')     готовый WASD-контроль
  $('#hero').controls('arrows')
  $('#hero').controls({ up: 'w', jump: 'space' })

9. ЗВУК
text

$.sound
  .play('hit.wav')
  .play('hit.wav', { volume: 0.7, pitch: 1.2, loop: false })
  .playAt('hit.wav', x, y, { max: 500 })     позиционный
  .music('theme.ogg', { loop: true, volume: 0.5 })
  .crossfade('boss.ogg', 1000)
  .stopMusic(1000)
  .volume(0.8)                                master
  .mute(b)

На элементе:
  $('#hero').sound('jump.wav')
  $('#hero').playSound()

10. СОХРАНЕНИЯ / ФАЙЛЫ
text

$.store
  .set('highscore', 100)
  .get('highscore') → 100
  .has('key') → bool
  .remove('key')
  .clear()
  .save()                         на диск
  .load()
  .autoSave(ms)                   автосейв каждые ms

$.fs
  .readText(path) → string
  .readJSON(path) → obj
  .readBytes(path) → Uint8Array
  .write(path, data)
  .exists(path) → bool
  .list(dir) → string[]
  .load('level1.json')            любой ресурс
  .load(['a.png', 'b.png'])       массив

11. ОТЛАДКА / OVERLAY
text

$.debug
  .on() / .off()
  .stats()                        fps, drawcalls, nodes
  .draw.line(a, b, color)
  .draw.rect(x, y, w, h, color)
  .draw.circle(x, y, r, color)
  .draw.text('hi', x, y)
  .watch('hp', () => $('#hero').hp())
  .profiler.start('physics')
  .profiler.end('physics')
  .profiler.report()

$.console
  .register('spawn', args => $('<enemy>').at(...))
  .run('spawn orc 100 200')
  .toggle()

12. ХУКИ ИГРЫ
js

$.ready(() => {
  // старт — создать мир, спавнить
});

$.update(dt => {
  // логика
});

$.render(dt => {
  // ручная отрисовка (обычно не нужна — движок сам)
});

$.exit(() => {
  // сохранить прогресс
});

$.on('key:escape', () => $.scene.push('pause'));
$.on('entity:died', e => $.emit('score:+1'));

13. ПОЛНЫЙ ПРИМЕР (то, как это реально выглядит)
js

$.ready(() => {
  $.world.gravity(0, 980).bounds(0, 0, 4000, 1200);

  // уровень
  $('<tilemap>', { src: 'level1.tmx' })
    .layer('bg')
    .appendTo($.world);

  // игрок
  $('<player>', { id: 'hero', sprite: 'hero.png' })
    .at(100, 200)
    .size(32, 48)
    .health(100)
    .speed(250)
    .controls('wasd')
    .collision(32, 48)
    .body('dynamic')
    .on('hit', e => {
      $('#ui-hp').width(e.self.hp());
      $.camera.shake(0.2, 5);
      e.self.flash('#ff0000', 100);
    })
    .on('death', () => {
      $.sound.play('die.wav');
      $.scene.load('gameOver', { transition: 'fade', ms: 500 });
    })
    .appendTo($.world);

  // враги
  for (let i = 0; i < 5; i++) {
    $('<enemy>', { class: 'goblin', sprite: 'goblin.png' })
      .at(500 + i * 80, 300)
      .health(30)
      .speed(80)
      .collision(32, 32)
      .on('death', e => {
        $.sound.play('die.wav');
        $.emit('kill', e.self);
        e.self.fadeOut(200).remove();
      })
      .appendTo($.world);
  }

  // камера
  $.camera.follow('#hero').zoom(1.5).limits(0, 0, 4000, 1200);

  // UI
  $('<ui.label>', { id: 'ui-hp', text: 'HP' })
    .at(10, 10)
    .appendTo($.ui);

  // музыка
  $.sound.music('theme.ogg', { loop: true, volume: 0.4 });
});

// каждый кадр — ИИ врагов
$.update(dt => {
  $('.goblin').each((i, e) => {
    const dist = e.distanceTo('#hero');
    if (dist < 250) {
      e.moveTo('#hero', dt, { speed: 120 });
      if (dist < 40) e.damage(1);
    }
  });
});

// события
$.on('kill', entity => {
  $.emit('score:+', { points: 10 });
});

14. РАСШИРЕНИЕ ЧЕРЕЗ $.fn
js

// юзер может добавлять свои методы
$.fn.flashAndDie = function() {
  return this.flash('#fff', 100).delay(150).remove();
};

$('.enemy').flashAndDie();

15. ЧТО ГЕНЕРИТЬ ПЕРВЫМ

Скажи — распишу с C-кодом и QJS-биндингами:

    $ ядро — wrapper-объект, коллекция, chainable, селекторы. (engine/jquery.c)

    $.fn.at/move/scale/rotate/distance — трансформ-методы.

    $.fn.on/off/emit — EventEmitter под капотом.

    $.world + $.camera.

    $('<player>') — фабрики через теги (карта тегов → C-конструктор).

    $.fn.tween / moveTo / fadeTo — анимации через встроенный твинер.

    $.input / $.sound / $.store.

Порядок: 1 → 3 → 2 → 6 → 5 → 4 → 7.

Начинаем с $-ядра (wrapper + селекторы + цепочки)? Это 200-300 строк C-биндинга + 150 строк JS-обёртки.
