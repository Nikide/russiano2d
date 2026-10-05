# Russiano2D 0.1.0 — Windows x86_64: инструкция для ИИ-агента

Ты получил готовый движок и игру. Тобой можно управлять программно: движок
читает JSON-команды со stdin и отвечает JSON-строками в stdout. Кадры идут
только по команде, поэтому прогон воспроизводим до кадра.

## Что в папке

| Файл | Что это |
|---|---|
| `russiano2d.exe` | движок; он же запускает игру и собирает её в один файл |
| `game/` | готовая игра: меню + уровень-платформер |
| `assets/` | текстуры, шрифты, иконки |
| `README.md` | та же инструкция для человека — как начать первый проект |

## Режим агента

```bash
.\russiano2d.exe --agent --headless --fixed-dt 0.0166666667 --scene platformer
```

* `--agent` — кадры двигаются командой `step`, протокол на stdin/stdout;
* `--headless` — окно скрыто, но рендер и скриншоты работают;
* `--fixed-dt 0.0166666667` — детерминированный шаг (60 Гц);
* `--seed N` — зерно `$.random`;
* `--scene <имя>` — открыть сцену сразу, минуя меню;
* `--frames N` — выйти ровно после N кадров.

Первым приходит `{"event":"ready",...}`.

| Команда | Параметры | Ответ |
|---|---|---|
| `ping` | — | `{"ok":true,"pong":true,"frame":N,"time":T}` |
| `state` | — | кадр, время, окно, камера, мир, узлы, интерфейс, самотесты |
| `eval` | `code` — строка JS | `{"ok":true,"result":…}` либо `{"ok":false,"error":"…"}` |
| `step` | `frames`, `dt` | `{"ok":true,"frames":N,"frame":N2,"time":T}` |
| `screenshot` | `path` | `{"ok":true,"path":…,"width":W,"height":H}` |
| `key` | `key` (имя SDL), `action`: `"down"`,`"up"`,`"tap"` | `{"ok":true,"key":"Space","action":"tap"}` |
| `keys` | `hold` — массив имён, **заменяет** набор | `{"ok":true,"hold":["A","Space"]}` |
| `mouse` | `button` 1/2/3, `action`: `"down"`,`"up"`,`"click"` | `{"ok":true}` |
| `mouseMove` | `dx`,`dy` или `x`,`y` | `{"ok":true,"x":…,"y":…}` |
| `wheel` | `amount` | `{"ok":true}` |
| `text` | `text` | ввод текста как с клавиатуры |
| `reload` | — | перезапуск скриптов |
| `frames` | — | `{"ok":true,"frame":N,"time":T}` |
| `quit` | — | `{"ok":true}` и выход |

## Пример: пройти вправо и снять кадр

```bash
printf '%s\n' \
  '{"cmd":"state"}' \
  '{"cmd":"step","frames":40}' \
  '{"cmd":"eval","code":"$.scene.current()"}' \
  '{"cmd":"keys","hold":["D"]}' \
  '{"cmd":"step","frames":30}' \
  '{"cmd":"keys","hold":[]}' \
  '{"cmd":"screenshot","path":"shot.png"}' \
  '{"cmd":"quit"}' \
| .\russiano2d.exe --agent --headless --scene platformer --fixed-dt 0.0166666667
```

Проверенный ответ (сокращённо):

```json
{"event":"ready","version":"0.1.0","agent":true,"headless":true,"fixed_dt":0.01666666754}
{"ok":true,"state":{"frame":1,"time":0.02,"fps":60,"window":{"title":"…","w":1280,"h":720},"world":{"bodies":0},"entities":[]}}
{"ok":true,"frames":40,"frame":41,"time":0.68}
{"ok":true,"result":"platformer"}
{"ok":true,"hold":["D"]}
{"ok":true,"frames":30,"frame":71,"time":1.18}
{"ok":true,"hold":[]}
{"ok":true,"path":"shot.png","width":1280,"height":720}
{"ok":true}
```

## Пример на Python

```python
import json, subprocess

proc = subprocess.Popen(
    [".\russiano2d.exe", "--agent", "--headless", "--scene", "platformer",
     "--fixed-dt", "0.0166666667"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    text=True, bufsize=1)

def call(**cmd):
    proc.stdin.write(json.dumps(cmd) + "\n")
    proc.stdin.flush()
    while True:
        line = proc.stdout.readline()
        if not line:
            raise SystemExit("движок закрылся")
        event = json.loads(line)
        if "event" not in event:      # первый ответ — ready, его пропускаем
            return event

call(cmd="step", frames=60)
state = call(cmd="state")["state"]
print("сцена:", state.get("scene"), "| тел:", state["world"]["bodies"])
print("HUD:", call(cmd="eval", code="$('#hud-hp').text()").get("result"))
call(cmd="quit")
```

## Что можно спросить у игры через `eval`

Проверенные выражения:

| Выражение | Что вернёт |
|---|---|
| `$.scene.current()` | имя текущей сцены, например `"platformer"` |
| `$.nodes().length` | сколько узлов сейчас в мире |
| `$('#hud-hp').text()` | текст элемента интерфейса |
| `$.debug.counters()` | счётчики кадра: спрайты, draw calls, тела |
| `state.world.bodies` | число физических тел (из `state`, не из `eval`) |

`state` полностью описывает мир: кадр, время, FPS, окно, камера, гравитация и
границы мира, список узлов и элементов UI, результаты встроенных самотестов
игры (`state.tests`).

## Своя игра

Положи рядом каталог `mygame/` с `project.json` и `main.js` (см. `README.md`)
и запусти:

```bash
.\russiano2d.exe --game mygame --agent --headless
```

Полный справочник протокола:
<https://hub.mos.ru/dem4ev48/russiano2d/-/blob/main/docs/AGENT_API.md>


---

# Приложение: вся документация движка

Ниже — полные тексты справочников, чтобы не искать их в интернете.

* Архитектура и философия API `$` — `docs/ARCHITECTURE.md`
* Russiano2D — высокоуровневое API `$` — `docs/HIGH_LEVEL_API.md`
* russiano2d — справочник по JavaScript API — `docs/API.md`
* russiano2d — агентский интерфейс (низкий уровень) — `docs/AGENT_API.md`
* Сборка игры в один файл — `docs/BUILD.md`
* Моя первая игра: платформер с маскотом — `docs/tutorial-first-game.md`
* Туториал: первая игра на `$` — `docs/tutorial-platformer.md`
* Туториал: меню, пауза и смена сцен — `docs/tutorial-menus.md`
* Russiano2D — демо-проект — `docs/demos.md`
* Russiano2D — аудит высокоуровневого API `$` и пробелы относительно Godot 4.x (2D) — `docs/GAP_ANALYSIS.md`
* Выпуск релиза — `docs/RELEASING.md`
* Раннер GitLab для hub.mos.ru — `docs/RUNNER.md`
* Контракт модуля подсистемы `$` — `docs/highlevel/_CONTRACT.md`
* `$.anim` — анимация клипами и машина состояний — `docs/highlevel/anim.md`
* Аудио-шины и эффекты — `$.audio` — `docs/highlevel/audiobus.md`
* HTTP-запросы — `$.http` — `docs/highlevel/http.md`
* Локализация и ввод — `$.i18n`, `$.tr` и дополнения `$.input` — `docs/highlevel/i18n.md`
* `$.layers` — канвас-слои, параллакс и затемнение — `docs/highlevel/layers.md`
* `$.nav` — навигация и поиск пути — `docs/highlevel/nav.md`
* Частицы — `$('<particles>')` и `$.particles` — `docs/highlevel/particles.md`
* Пул объектов — `$.pool` — `docs/highlevel/pool.md`
* `$.prefab` — prefab, наследование сцен и сериализация узлов — `docs/highlevel/prefab.md`
* `$.blend` и `$.viewport` — смешивание и render target — `docs/highlevel/render.md`
* TileMap — тайловые карты `$('<tilemap>')` — `docs/highlevel/tilemap.md`
* Зоны-триггеры — `$.triggers` и тег `<trigger>` — `docs/highlevel/triggers.md`
* `$.tween` — Tween-объекты в стиле Godot 4 — `docs/highlevel/tween.md`
* UI-контролы — `$.ui` и теги `<ui.*>` — `docs/highlevel/widgets.md`


---

## Архитектура и философия API `$`

<sub>источник: `docs/ARCHITECTURE.md`</sub>

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
  $('.goblin').each(e => {
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


---

## Russiano2D — высокоуровневое API `$`

<sub>источник: `docs/HIGH_LEVEL_API.md`</sub>

# Russiano2D — высокоуровневое API `$`

Полный справочник по игровому API движка. Всё, что нужно игре, живёт на одном
объекте `$`: он доступен **глобально**, импортировать ничего не нужно.

```js
// game/main.js — целиком
$.ready(() => {
    $.world.gravity(0, 1200).color('#101820').bounds(0, 0, 4000, 1200);

    $('<player>', { id: 'hero' })
        .at(100, 300).size(32, 48).health(100).speed(250)
        .controls('wasd')
        .on('death', () => $.scene.load('gameOver'))
        .appendTo($.world);

    $.camera.follow('#hero').zoom(1.5);
});

$.update(dt => {
    $('.goblin').each(e => { if (e.distanceTo('#hero') < 200) e.moveTowards('#hero', 120); });
});
```

Низкоуровневый объект `engine` (текстуры, тела, батчинг, RmlUi, BSP, свет)
никуда не исчез — см. [API.md](API.md). `$` построен поверх него, и оба доступны
одновременно.

---

## 1. Философия

* **`$` — единственная точка входа.** Один объект, одно пространство имён.
* **Всё возвращает обёртку** (`wrapper`) — поэтому работают цепочки.
* **Создание — как в HTML:** `$('<player>', { id: 'hero', hp: 100 })`.
* **Поиск — как в CSS:** `$('#hero')`, `$('.enemy')`, `$('enemy:alive')`.
* **Неявная итерация:** `$('.enemy').damage(10)` бьёт всех найденных.
* **Никаких `new`, `extends`, `this`** в игровом коде. `$.fn` — если нужно
  добавить свой метод.
* **Асинхронность — через `Promise`:** `.moveTo(...)` возвращает `Promise`,
  который разрешается по завершении анимации.

---

## 2. Жизненный цикл

| Хук | Когда вызывается |
|---|---|
| `$.ready(fn)` | один раз, на первом кадре (после `$` создан) |
| `$.update(fn)` | каждый кадр; `fn(dt, $)` |
| `$.render(fn)` | каждый кадр перед отрисовкой мира |
| `$.exit(fn)` | при завершении движка |

```js
$.ready(() => { /* построить мир */ });
$.update(dt => { /* логика */ });
$.render(() => { /* поверх сцены, до интерфейса */ });
$.exit(() => { $.store.save(); });
```

Порядок одного кадра внутри `$`:
`$world.sync` (свежие трансформы из физики) → смена сцены → время (твины,
таймеры, камера, события ввода) → `$.ready` → `update` сцены → `$.update` →
спрайт-анимации → встроенное управление → наведение интерфейса →
`render` сцены → `$.render` → отрисовка.

---

## 3. Создание узлов

```js
$('<player>', { id: 'hero' })        // атрибуты — вторым аргументом
$('<enemy>', { class: 'goblin boss' })
$('<ui.button>', { id: 'play', text: 'Играть' })
```

Атрибуты применяются по имени свойства. Знакомые имена (`id`, `x`, `y`, `w`,
`h`, `hp`, `speed`, `sprite`, `color`, `alpha`, `visible`, `layer`, `team`,
`body`, `text`, `size`, `value`, `max`, `radius`, `intensity`, `gravity`,
`controls`, `collision`, `hoverColor`, `textColor`, `fillColor`) попадают в
поля узла и действуют сразу. Всё остальное складывается в `attrs` и доступно
через `.attr('ключ')` — то есть свой атрибут всегда можно завести, не трогая
движок.

### Теги

| Тег | Тело | Назначение |
|---|---|---|
| `<player>` | динамическое | игрок: 28×40, 100 HP, скорость 250, класс `player` |
| `<enemy>` | динамическое | враг: 28×40, 30 HP, скорость 90, `team` 2 |
| `<npc>` | динамическое | нейтральный персонаж |
| `<pickup>` | нет | подбираемый предмет |
| `<bullet>` | динамическое | снаряд (гравитация выключена) |
| `<sprite>` | нет | картинка |
| `<rect>` | нет | прямоугольник (белый спрайт 1×1) |
| `<circle>` | нет | круг (рисуется треугольниками) |
| `<text>` | нет | текст в мировых координатах |
| `<light>` | нет | мягкое свечение радиусом `radius` |
| `<wall>` | статическое | препятствие |
| `<tilemap>` | нет | карта из тайлов: слои, автотайл, коллизии (раздел 30) |
| `<particles>` | нет | CPU-частицы: эмиттер, рампы, пресеты (раздел 30) |
| `<layer>` | нет | канвас-слой: порядок, параллакс, затемнение (раздел 30) |
| `<trigger>` | нет | зона, событие `enter` / `leave` |
| `<area>` | нет | невидимая зона без отрисовки |
| `<ui.panel>`, `<ui.label>`, `<ui.button>`, `<ui.bar>`, `<ui.image>` | нет | базовые элементы интерфейса в координатах окна |
| `<ui.row>`, `<ui.col>`, `<ui.grid>` | нет | контейнеры раскладки (раздел 30) |
| `<ui.scroll>`, `<ui.list>`, `<ui.checkbox>`, `<ui.slider>`, `<ui.input>`, `<ui.dialog>` | нет | контролы с вводом и фокусом (раздел 30) |

Теги `ui.panel`, `ui.label`, `ui.button`, `ui.bar`, `ui.image` живут в
координатах окна: камера на них не влияет, в `$.world.count()` они не входят.

---

## 4. Селекторы

| Селектор | Что находит |
|---|---|
| `'#hero'` | по `id` |
| `'.enemy'` | по классу |
| `'enemy'` | по тегу |
| `'*'` | все узлы |
| `'#hero, .boss'` | объединение |
| `'#hero .weapon'` | потомок |
| `'#hero > .weapon'` | прямой потомок |
| `'enemy.goblin'` | тег + класс |
| `'[hp<20]'`, `'[team=1]'`, `'[speed>=100]'` | условие на свойство |
| `':alive'` / `':dead'` | по здоровью |
| `':visible'` / `':hidden'` | по видимости |
| `':onScreen'` / `':offScreen'` | в кадре камеры |
| `':first'`, `':last'`, `':eq(n)'`, `':even'`, `':odd'` | по позиции в реестре |
| `':has(.item)'`, `':parent'`, `':empty'` | по детям |
| `':paused'` | когда время на паузе |
| `':picked'` | под курсором |

Свои фильтры:

```js
$.selectors.register(':boss', node => node.attrs.rank === 'boss');
$(':boss').hp(1000);
```

---

## 5. Обёртка (коллекция)

Всё, что возвращает `$`, — коллекция узлов с общими методами.

```js
$('.enemy').length          // сколько нашлось (свойство)
$('.enemy').get(0)          // узел-объект
$('.enemy').toArray()       // массив узлов
$('.enemy').each((i, e) => { })      // e — обёртка одного узла
$('.enemy').map(e => e.hp())         // массив значений
$('.enemy').filter(e => e.hp() < 10)
$('.enemy').filter('.goblin')        // фильтр селектором
$('.enemy').not('.boss')
$('.enemy').first() / .last() / .eq(2) / .slice(1, 3)
$('.enemy').add('.boss')             // объединить
$('.enemy').is('.goblin')            // bool: все подходят
$('.enemy').has('.weapon')           // bool: есть такой потомок
$('.enemy').every(e => e.alive())    // bool
$('.enemy').some(e => e.hp() < 5)    // bool
$('.enemy').reduce((sum, e) => sum + e.hp(), 0)
$('.enemy').index()                  // позиция первого узла в реестре мира
```

**Массовые операции работают всегда:** `$('.enemy').damage(10)`, `.stopAll()`,
`.at(0, 0)` (телепорт всей толпы), `.remove()`.

---

## 6. Трансформ и геометрия

```js
.at(x, y)                  // задать позицию (и переместить тело)
.move(dx, dy)              // сдвинуть
.moveTo(x, y, ms, ease?)   // плавно переехать → Promise (без ms — мгновенно)
.moveTo('#hero', speed)    // двигаться к цели со скоростью, px/с
.moveTowards('#hero', 120) // то же, но явным методом
.pos()                     // → { x, y }
.size(w, h) / .size(w)     // размер
.width(w) / .height(h)     // по одной стороне
.rotate(deg)               // довернуть (градусы)
.angle(rad)                // задать угол в радианах
.rotation()                // → радианы
.scale(1.5) / .scale(sx, sy)
.lookAt('#hero')           // повернуться к цели
.flip(true, false)         // отразить по осям
.layer(2) .depth(z)        // порядок отрисовки
.distanceTo('#enemy')      // → число
.directionTo('#enemy')     // → { x, y } единичный вектор
.angleTo('#enemy')         // → радианы
.rayTo('#enemy')           // → { hit, point, normal, distance } | null
.toGlobal({x,y}) .toLocal({x,y})   // мировые ↔ экранные
```

## 7. Визуал

```js
.sprite('demos/assets/art/hero.png')      // путь к картинке (расширение обязательно)
.sprite({ src: 'sheet.png', cols: 8, rows: 4, cw: 176, ch: 176 })
.frames({ src: 'sheet.png', cols: 8, rows: 4, cw: 176, ch: 176 })
.frame(3)                                 // показать конкретный кадр
.animate({ from: 0, to: 5, speed: 12, loop: true })
.stopAnim() .playing(false)
.color('#ff0000') .alpha(0.5) .opacity(0.5)
.visible(false) .show() .hide()
.fadeIn(200) .fadeOut(300)                // → Promise
.region(x, y, w, h)                        // вырезать область из текстуры узла
.outline(2, '#000')                       // рамка вокруг спрайта (по хитбоксу)
.shadow({ x: 4, y: 4, color: 'rgba(0,0,0,0.4)' })   // смещённая копия под спрайтом
.fontSize(24)                             // кегль текста у <text> и <ui.label>
.radius(200) .intensity(1)                // свет: радиус и яркость у <light>
```

Цвет принимает `'#f00'`, `'#ff0000'`, `'#ff0000cc'`, `'red'`, `'rgba(255,0,0,0.5)'`,
`[255, 0, 0, 128]` или число от `$.color(...)`.

`.blend('alpha' | 'add' | 'multiply' | 'none')` задаёт режим смешивания узла,
`$.blend(name)` — режим по умолчанию для всего кадра. Пользовательские шейдеры
движок не поддерживает (конвейеры фиксированные): `.shader()` безопасен, но
пишет предупреждение в журнал.

## 8. Физика

```js
.body('dynamic' | 'static' | 'kinematic')   // создать/сменить тело
.velocity(vx, vy) .velocity()               // задать / прочитать, px/с
.applyImpulse(ix, iy) .applyForce(fx, fy)
.gravity(false)                             // выключить гравитацию узла
.collision(w, h) .collisionCircle(r)        // хитбокс (и пересоздать тело)
.shape('box' | 'circle' | 'capsule' | 'polygon')   // форма тела
.oneWay(true)                               // односторонняя платформа
.sensor(true)                               // зона: ловит, но не толкает
.contacts(true | false)                     // события контакта
.joint('#other', { type: 'revolute' })      // сустав, → id
.onFloor() .onWall()                        // → bool (луч вниз/вбок)
.jump(640)                                  // импульс вверх с гашением падения
.moveAndSlide(vx, vy)                       // синоним .velocity() — скольжение делает Box2D
.stopAll() .pause() .wake()
.overlaps('.wall')                          // → bool по пересечению прямоугольников
.overlaps('.wall', (hit, self) => { })      // колбэк каждый кадр (hit | null)
.inside('#zone')                            // → bool
```

**Формы.** `box` — прямоугольник по хитбоксу (по умолчанию); `circle` —
настоящий круг (`.collisionCircle(r)` включает его сам); `capsule` — капсула,
не цепляется за стыки тайлов; `polygon` — силуэт до 8 точек
(`.shape('polygon', [x0,y0,x1,y1,…])`, локальные пиксели). Смена формы
пересоздаёт тело; скорость при этом сохраняется.

**Односторонние платформы.** `.oneWay(true)` — тело проходит сквозь снизу и
встаёт сверху. Второй аргумент задаёт направление лицевой стороны
(`.oneWay(true, -Math.PI / 2)` — вверх по умолчанию).

**Суставы.** `.joint(цель, opts)` возвращает id; `opts` — как в
[API.md](API.md#enginecreatejointopts--engineestroyjointid), плюс сокращения:
`a`/`b` — точки крепления в мировых пикселях. Для `revolute` и `weld` вторая
точка по умолчанию совпадает с первой (крепление в одну точку), для
`distance` — берутся центры тел. Уничтожение: `$.world.destroyJoint(id)`,
состояние: `$.world.jointAlive(id)`, `$.world.jointCount()`.

### События контакта

Динамическим телам события включены сразу; `.contacts(true)` включает их и
остальным (например, стене, которая хочет знать, что в неё врезались).

```js
$('#hero').on('collide', e => {          // начали касаться
    $.log(`столкнулся с ${e.data.other ? e.data.other.tag : '?'}, скорость ${e.data.speed}`);
});
$('#hero').on('separate', e => { });     // перестали касаться
$('#hero').on('hit', e => {              // удар быстрее порога Box2D
    $.camera.shake(Math.min(6, e.data.speed / 40), 120);
});
```

В `e.data`: `kind` (`'begin'`/`'end'`/`'hit'`), `self`, `other` (обёртки или
`null`, если узла уже нет), точка контакта `x`/`y`, нормаль `nx`/`ny` и
`speed` (скорость сближения, для `hit`). Сырой список за кадр —
`$.world.contacts()`.

Встроенное управление: `.controls('wasd')`, `.controls('arrows')`,
`.controls({ axis: 'both', jump: 'space' })` — двигает узел или его тело,
прыжок по `space`/`w`/`↑` только когда узел на земле.

## 9. Здоровье

```js
.health(100)        // задать максимум и текущее
.hp() / .hp(50)     // прочитать / задать
.maxHp(120)
.damage(10) .heal(5) .kill() .respawn(x, y)
.alive()            // → bool
.team(2)            // своя команда
.invulnerable(500)  // неуязвимость на 500 мс
```

При изменении здоровья мир сам рассылает события `hit`, `heal`, `death`,
`respawn`, `show`/`hide`.

## 10. События

```js
$('#hero').on('hit', e => { /* e.self, e.data, e.stop() */ });
$('#hero').off('hit');            // снять все
$('#hero').off('hit', handler);   // снять конкретный
$('#hero').emit('custom:foo', { });  // локальное событие
$.on('kill', e => { });              // глобальное
$.on('entity:enemy:death', e => { }); // по тегу и событию
$.emit('score:+', { points: 10 });    // своё глобальное событие
```

Встроенные события узла: `hit`, `heal`, `death`, `respawn`, `remove`, `show`,
`hide`, `enter`/`leave` (для `<trigger>`), `jump`, `fire`, `arrived`, `animEnd`,
`click`, `mouseenter`, `mouseleave`, `mousedown`, `mouseup`.

Объект события: `{ self, target, source, name, data, dt, frame, stop() }`.

## 11. Твины и эффекты

```js
await $('#hero').moveTo(400, 200, 600);         // Promise
$('#hero').tween({ alpha: 0, y: 100 }, 300, 'easeOutBack');
$('#hero').rotateTo(90, 400).scaleTo(2, 200).fadeTo(0, 300);
$('#hero').shake(6, 250);                       // тряска картинки
$('#hero').flash('#ff0000', 120);               // вспышка цвета
await $('#hero').bounce(20, 300);
await $('#hero').delay(200);
$('#hero').pauseTweens().resumeTweens().clearTweens();
await $.sequence([() => step1(), 300, () => step2()]);
```

Плавности: `linear`, `ease`, `easeIn`, `easeOut`, `easeInOut`, `easeInCubic`,
`easeOutCubic`, `easeInOutCubic`, `easeInQuad`, `easeOutQuad`, `easeInQuart`,
`easeOutQuart`, `easeInBack`, `easeOutBack`, `easeInOutBack`,
`easeOutElastic`, `easeInElastic`, `easeOutBounce`, `easeInBounce`,
`easeInSine`, `easeOutSine`, `step`.

## 12. Звук на узле

```js
$('#hero').sound('jump.wav').playSound();   // привязать и проиграть
.sound('hit.wav', { max: 500 })
```

## 13. Иерархия

```js
$('<weapon>').appendTo('#hero');       // стать ребёнком узла
$('#hero').append($('<weapon>'));      // добавить ребёнка
$('#hero').prepend(child)
$('#hero').children('.weapon')         // обёртка детей
$('#hero').find('.grip')               // поиск среди потомков
$('#hero').closest('player')           // ближайший подходящий предок
$('#hero').siblings()                  // соседи
$('#hero').parent()
$('#hero').detach()                    // отсоединить, оставив живым
$('#hero').remove()                    // уничтожить узел и его детей
```

`.appendTo($.world)` — «в мир» (родителя нет, узел и так в реестре мира).

## 14. Данные, классы, теги

```js
.data('hp', 100) .data('hp') .data({ a: 1 })   // своё хранилище
.attr('speed', 120) .attr('speed') .attr({ })  // свойства
.addClass('boss') .removeClass('boss') .toggleClass('boss') .hasClass('boss')
.tag('friendly') .addTag('x') .removeTag('x')
.text('Привет') .value(0.5) .max(1)            // для текста и полос
```

---

## 15. `$.world` — мир

```js
$.world.gravity(0, 1200)          // ускорение свободного падения, px/с²
$.world.bounds(0, 0, 4000, 1200)  // границы: ставит четыре стены (класс world-bound)
$.world.clearBounds()
$.world.color('#101820')          // цвет очистки кадра
$.world.background('bg.png', { parallax: 0.2 })
$.world.pause() .resume() .isPaused()   // «мир без гравитации» — для космоса и аркад сверху
$.world.freeze() .thaw()                // остановить все тела, не трогая гравитацию
$.world.timeScale(0.5)
$.world.spawn('<enemy>', 100, 200)          // → обёртка
$.world.all()                               // все узлы (обёртка)
$.world.count(sel?)                         // узлов в мире (без интерфейса и границ)
$.world.query(x, y, r?)                     // узлы в точке или радиусе
$.world.bodyAt(x, y)                        // узлы тел в точке
$.world.bodiesIn(x, y, w, h)                // узлы тел в прямоугольнике
$.world.raycast({x,y}, {x,y})               // → { hit, point, normal, distance, body, self } | null
$.world.raycastAll(from, to)                // → [{ node, t, point, self }, …]
$.world.lineOfSight(from, to)               // → bool
$.world.sort('layer' | 'y' | 'z')           // порядок отрисовки
$.world.sortWith((a, b) => a.y - b.y)       // свой порядок
```

Лучи и запросы принимают точку, узел-объект, обёртку или селектор:
`$.world.raycast($('#hero'), '#enemy')`. В результате `raycast` есть и `node`
(узел-владелец тела), и `self` — та же обёртка для удобства.

> **`$.world.pause()` — это не пауза игры.** Он выключает гравитацию мира (тела
> продолжают лететь по инерции); пауза игры — `$.time.pause()`, полная остановка
> тел — `$.world.freeze()`. Гравитация и масштаб времени — глобальные: при смене
> сцены `$` возвращает их сам, но если сцена выключала гравитацию, полагаться на
> это в своём `exit()` не нужно — состояние уже сброшено.

## 16. `$.camera` — камера

```js
$.camera.follow('#hero', { smooth: 0.15, offset: [0, -50], zoom: 1.5 })
$.camera.unfollow() .followed()
$.camera.zoom(1.5) .zoomTo(2, 300)
$.camera.panTo(x, y, 500)
$.camera.shake(6, 300)
$.camera.limits(0, 0, 4000, 1200) .limits(null)
$.camera.deadzone(200, 120)
$.camera.at(x, y) .pos()
$.camera.worldToScreen(p) .screenToWorld(p)
$.camera.isOnScreen('#hero') .viewport()
```

## 17. `$.input` — ввод

```js
$.input.down('space') .pressed('space') .released('space')
$.input.axis('a', 'd')                 // -1..1
$.input.vec('wasd' | 'arrows' | 'both')// { x, y } с учётом геймпада
$.input.mouse() .mouseDelta() .mouseWorld()
$.input.mouseDown('left') .mousePressed('left')
$.input.wheel()                        // { x: 0, y: wheel }
$.input.padAxis('leftx') .padDown('a')
$.input.gamepad(0).button('a') .axis('leftx') .connected()
$.input.bind('jump', ['space', 'w', 'gamepad.a'])
$.input.unbind('jump') .bindings()
$.input.down('jump')                   // имён действий тоже работает
$.input.on('key', e => { })            // e.key, e.pressed, e.shift/ctrl/alt
$.input.on('mouse', e => { }) .on('wheel', e => { }) .on('gamepadOn', e => { })
$.input.off()
$.input.text()                         // символы, набранные за этот кадр
```

`$.input.text()` отдаёт готовый UTF-8 с учётом раскладки и IME — из него
построен контрол `<ui.input>` (см. [widgets.md](highlevel/widgets.md)). Скан-коды
для текстовых полей не годятся: они не знают ни раскладки, ни compose.
В агентском режиме текст набирается командой `text` (см. [AGENT_API.md](AGENT_API.md)).

Имена клавиш человеческие: `'space'`, `'w'`, `'left'`, `'escape'`, `'f1'`,
`'enter'` (=Return), `'leftshift'`. Регистр не важен.

## 18. `$.sound` — звук

```js
$.sound.play('hit.wav', { volume: 0.7, loop: false })
$.sound.playAt('boom.wav', x, y, { max: 700 })     // позиционно
$.sound.playAt('boom.wav', '#hero')                // от узла
$.sound.music('theme.ogg', { loop: true, volume: 0.5 })
$.sound.crossfade('boss.ogg', 1000) .stopMusic(500)
$.sound.volume(0.8) .mute(true) .sfxVolume(0.5) .musicVolume(0.5)
$.sound.stopAll() .playing(ch) .activeChannels() .duration('x.ogg') .preload(['a.ogg'])
```

Расширение можно не писать: движок сам ищет `.wav`, `.ogg`, `.mp3`, `.flac`.

## 19. `$.scene` — сцены

```js
$.scene.add('menu', { enter($) {}, exit() {}, update(dt, $) {}, render($) {} });
$.scene.add('level1', $ => { /* построить мир */ });   // сцена-функция
$.scene.load('level1', { transition: 'fade', ms: 300 });
$.scene.restart();
$.scene.push('pause') .pop() .stack();
$.scene.current()          // имя или null
$.scene.names() .has('x') .remove('x');
$.scene.transition('fade', 300) .busy();
```

Смена сцены **отложена на начало следующего кадра** — поэтому её можно
вызывать прямо из обработчика клика. При смене мир очищается (узлы, тела,
твины, таймеры), кроме узлов с классом `scene-persistent` и интерфейса при
`{ keepUI: true }`.

## 20. `$.ui` — интерфейс

```js
$('<ui.bar>', { id: 'hp', value: 100, max: 100 }).at(120, 30).appendTo($.ui);
$.ui.bar('#hp', 50, 100);
$.ui.label('#score', 'Очки: 120');
$('<ui.button>', { id: 'play', text: 'Играть' }).at(640, 400);
$('#play').on('click', () => $.scene.load('level1'));
```

Документы RmlUi (для сложной вёрстки и стилей):

```js
const menu = $.ui.doc('ui/menu.rml').show();
menu.text('score', '120').cls('panel', 'hidden', true).style('bar', 'width', '50%');
menu.on('btn-play', 'click', () => $.scene.load('level1'));   // вешается один раз
menu.hide() .visible() .unload();
$.ui.icon('directions_run')    // иконка Material Design (2235 штук встроены)
$.ui.hasIcon('home') .iconNames() .iconCount() .fps()
```

`on()` подписывает **конкретный** элемент документа. Для нескольких кнопок
вызывайте его для каждой (можно цепочкой) — одного обработчика «на весь
документ» с ветвлением по id не бывает:

```js
menu.on('btn-play', 'click', play)
    .on('btn-settings', 'click', settings)
    .on('btn-quit', 'click', quit);
```

## 20.1. `$.window` — окно

Окно игры целиком: имя, размер, режим, курсор и события. Значения по
умолчанию берутся из `project.json` рядом с точкой входа (см. `docs/BUILD.md`),
флаги `--title/--width/--height` их перекрывают, а из игры всё меняется на ходу.

```js
$.window.title('Моя игра');        // заголовок окна и подпись в доке
$.window.title();                  // → 'Моя игра'

$.window.size();                   // { w, h } в точках
$.window.pixels();                 // { w, h } в пикселях (Retina: вдвое больше)
$.window.resize(1600, 900);        // высоту можно не указывать — сохраним пропорции

$.window.fullscreen(true);         // во весь экран
$.window.fullscreen();             // → true
$.window.toggleFullscreen();

$.window.cursor('hidden');         // спрятать курсор (для прицела)
$.window.cursor('crosshair');      // 'normal' | 'hidden' | 'crosshair' | 'hand' | 'text' | 'wait'
$.window.cursor();                 // → 'hidden'

$.window.vsync(false);             // больше кадров, но возможен разрыв
$.window.resizable(false);         // запретить менять размер мышью

$.window.minimize(); $.window.maximize(); $.window.restore();
$.window.show(); $.window.hide(); $.window.focus();
$.window.visible(); $.window.focused();

$.window.position();               // { x, y } на экране
$.window.move(100, 80);
$.window.center();
```

События: `resize`, `focus`, `blur`, `show`, `hide`, `fullscreen`. Движок
опрашивает состояние окна раз в кадр, поэтому событие приходит с точностью до
кадра — для интерфейса этого достаточно.

```js
$.window.on('resize', ({ w, h }) => {
    $('#menu').size(w * 0.6, h * 0.5);      // переложить интерфейс
});

$.window.on('blur', () => $.time.pause());   // ушли в другое окно — пауза
$.window.on('focus', () => $.time.resume());
```

Полное состояние окна — `$.window.state()`, оно же лежит в снимке агента
(`state.window`: имя, размер, режим, курсор, фокус), поэтому автотест может
проверить и имя окна, и реакцию на разворот.

## 21. `$.time` — время

```js
$.time.delta()      // секунды с прошлого кадра (с учётом паузы и scale)
$.time.rawDelta()   // без масштабирования
$.time.now()        // игровое время в секундах
$.time.realNow()    // время с запуска движка
$.time.fps() .frame()
$.time.scale(0.5) .pause() .resume() .toggle() .isPaused()
await $.time.wait(500)
const id = $.time.after(200, fn) / $.time.every(1000, fn)
$.time.cancel(id) .cancelAll()
```

## 22. `$.store` и `$.fs` — сохранения и файлы

```js
$.store.set('highscore', 1200).get('highscore', 0)
$.store.has('x') .remove('x') .clear() .keys() .all() .setAll({ … })
$.store.file('save2.json').save() .load()
$.store.autoSave(30000) .stopAutoSave()

$.fs.readText('data/level.json')      // строка или null
$.fs.readJSON('data/level.json', {})  // объект или значение по умолчанию
$.fs.write('out.txt', 'текст') .writeJSON('out.json', obj)
$.fs.exists('x') .list('data') .remove('x') .basePath()
```

Пути — от корня запуска; абсолютные принимаются как есть.

## 23. `$.gfx` — графика и отладочный слой

```js
$.gfx.color('#101820')          // цвет очистки
$.gfx.size() { w, h }
$.gfx.rgba(255, 0, 0, 128)
$.gfx.color4('#ff0000', 0.5)
$.gfx.culling(false)            // рисовать всё, даже за экраном
$.gfx.stats()                   // { sprites, triangles, texts, nodes }
$.gfx.text('Привет', 100, 640, { size: 20, color: '#fff', align: 'center' })
$.gfx.measureText('Привет', 20) // → [ширина, высота]
$.gfx.textureSize('art/hero.png')// → [ширина, высота] картинки
$.gfx.draw.line(x1, y1, x2, y2, color, width)
$.gfx.draw.rect(x, y, w, h, color)
$.gfx.draw.circle(x, y, r, color)
$.gfx.draw.ring(x, y, r, color, width)
$.gfx.draw.text('hi', x, y, color, size)
$.gfx.draw.arrow(x1, y1, x2, y2, color)
$.gfx.draw.clear()
```

Всё из `$.gfx.draw` и `$.gfx.text` рисуется **поверх сцены**, в координатах окна,
и попадает на скриншот агента.

## 24. `$.debug` и `$.console`

```js
$.debug.on() .off() .toggle() .isOn()      // оверлей движка (F1)
$.debug.stats()                            // { fps, frame_ms, sprites, nodes, bodies, … }
$.debug.draw.line('#hero', '#exit', 'yellow')   // принимает селекторы и узлы
$.debug.draw.rect('#zone', '#door', 'red')
$.debug.watch('hp', () => $('#hero').hp())
$.debug.unwatch('hp') .watches()
$.debug.profiler.start('ai') .end('ai') .report() .reset()

$.console.register('spawn', (args) => $('<enemy>').at(args[0], args[1]), 'spawn x y')
$.console.run('spawn 100 200') .list() .help('spawn') .toggle()
```

## 25. `$.agent` и `$.test` — доступ для программы

```js
$.agent.active      // true в режиме --agent
$.agent.headless .seed .frame() .time()
$.agent.node('#hero')      // краткое описание узла
$.agent.nodes('.enemy')    // список описаний
$.agent.snapshot()         // полный снимок мира (уходит агенту в ответе на state)
$.agent.expose('score', () => Global.score)   // своё поле в снимке
$.agent.describe()         // строка для лога

$.test.check($('.enemy').length === 5, 'врагов пятеро')
$.test.equal($('#hero').hp(), 100, 'здоровье целое')
$.test.near(x, 100, 0.5, 'игрок у отметки')
$.test.truthy(...) .falsy(...)
$.test.reset() .results() .report()
```

Снимок содержит `frame`, `time`, `fps`, `scene`, `window`, `camera`, `world`,
`entities` (массив узлов с позицией, здоровьем, видимостью), `ui`, `player` и
всё, что добавлено через `.expose()`.

## 26. Расширение

```js
$.fn.flashAndDie = function () {
    return this.flash('#fff', 100).fadeOut(200).remove();
};
$('.enemy').flashAndDie();
```

Внутри `$.fn`-метода `this` — обёртка; чтобы применить что-то к каждому узлу,
используйте `this.each((i, e) => { … })`.

## 27. Прочее в `$`

```js
$.color('#f00')        // упакованный цвет
$.alpha(color, 0.5)    // сменить альфу
$.vec(1, 0)            // { x, y }
$.random               // ГПСЧ с зерном из --seed: .next() .range(a,b) .int(a,b) .pick(list) .chance(p)
$.find(sel) .count(sel)
$.log('текст')         // в журнал движка
$.quit()
$.isAgent()            // true в режиме агента
$.fn .selectors .ctx   // внутренности для расширений
```

---

## 28. Ограничения (честно)

| Чего нет | Почему / что делать |
|---|---|
| Своих шейдеров на узел | Конвейер движка общий. `.shader()` пишет предупреждение |
| Пользовательских шейдеров | Конвейеры фиксированные; `.shader()` пишет предупреждение. Режимы смешивания (`add`, `multiply`, `none`) при этом есть |
| DSP-эффектов кроме `lowpass`/`echo` | В SDL_mixer 3.2 нет готовых эффектов, движок обрабатывает сэмплы сам; реверба нет |
| Изменения `pitch` звука | SDL_mixer не умеет; `{ pitch }` игнорируется с предупреждением |
| Виброотклика | `$.input.rumble()` пока не подключён к SDL_RumbleGamepad |
| Произвольных (не AABB) браш-форм | `<circle>` рисуется кругом, но хитбокс прямоугольный |
| Коллизий внутри `<tilemap>` по габариту агента | Сетка тайлов помечает тайлы, а не объём: для тела нужен `agentRadius` у `$.nav` |
| Частиц как тел физики | `<particles>` не участвуют в `raycast`/`query` |
| Соединений тел (joints) | В `physics.c` их нет: только отдельные тела Box2D |
| `.width()` как геттер | Используйте `.size()` |

Ошибки в игровом коде не роняют движок: они уходят в журнал вместе со стеком
(`$: ошибка в $.update: …`) и в отладочный оверлей.

---

## 29. Полный пример

```js
// game/main.js — платформер на 60 строк
const MASCOT = { src: 'demos/assets/art/mascot/russiano_mascot_sheet.png',
                 cols: 8, rows: 4, cw: 176, ch: 176 };

$.ready(() => {
    $.world.gravity(0, 1600).color('#0d1117').bounds(-200, -400, 4000, 1600);

    $('<player>', { id: 'hero' })
        .at(200, 400).size(48, 64)
        .frames(MASCOT).animate({ from: 0, to: 7, speed: 10 })
        .health(100).controls('both').collision(40, 60)
        .appendTo($.world);

    for (let i = 0; i < 6; i++) {
        $('<sprite>', { class: 'coin' })
            .at(400 + i * 120, 300).size(24, 24).color('#ffd54a')
            .on('pickup', e => { e.self.remove(); $.sound.play('pickup.ogg'); })
            .appendTo($.world);
    }

    $('<wall>').at(0, 620).size(4000, 40).color('#2a3240').appendTo($.world);
    $('<ui.bar>', { id: 'hp', value: 100, max: 100 }).at(120, 28).appendTo($.ui);

    $.camera.follow('#hero', { smooth: 0.2 }).limits(-200, -400, 4000, 1600);
});

$.update(() => {
    $.ui.bar('#hp', $('#hero').hp(), 100);
    $('.coin').each(c => {
        if (c.distanceTo('#hero') < 40) c.emit('pickup');
    });
    if ($('#hero').hp() <= 0) $.scene.restart();
});
```

---

## 30. Подсистемы после аудита API

Эти подсистемы добавлены по итогам сверки с Godot 4.x (2D) — разбор пробелов
и приоритетов в [GAP_ANALYSIS.md](GAP_ANALYSIS.md). Каждая живёт в своём файле
`src/highlevel/<имя>.js`, ставится из `api.js` и обновляется в кадре своей
`tick`-функцией.

| Подсистема | Пространство имён | Теги | Подробно |
|---|---|---|---|
| Анимация клипами и машина состояний | `$.anim` | — | [anim.md](highlevel/anim.md) |
| TileMap: слои, автотайл, террейны, Y-sort | `$.tilemap` | `<tilemap>` | [tilemap.md](highlevel/tilemap.md) |
| CPU-частицы | `$.particles` | `<particles>` | [particles.md](highlevel/particles.md) |
| Навигация: A*, агент, navmesh | `$.nav` | — | [nav.md](highlevel/nav.md) |
| Prefab и сериализация сцен | `$.prefab` | — | [prefab.md](highlevel/prefab.md) |
| Аудио-шины и эффекты | `$.audio` | — | [audiobus.md](highlevel/audiobus.md) |
| Канвас-слои, параллакс, fade | `$.layers` | `<layer>` | [layers.md](highlevel/layers.md) |
| UI-контролы: контейнеры, ввод, якоря, темы | `$.ui` (дополнение) | `<ui.row>` и др. | [widgets.md](highlevel/widgets.md) |
| Tween в стиле Godot | `$.tween` | — | [tween.md](highlevel/tween.md) |
| Зоны `enter`/`leave` | `$.triggers` | `<trigger>` | [triggers.md](highlevel/triggers.md) |
| Локализация | `$.i18n`, `$.tr` | — | [i18n.md](highlevel/i18n.md) |
| Пул объектов | `$.pool` | — | [pool.md](highlevel/pool.md) |
| HTTP-запросы | `$.http` | — | [http.md](highlevel/http.md) |
| Blend-режимы и подвьюпорты | `$.blend`, `$.gfx.blend`, `$.viewport` | — | [render.md](highlevel/render.md) |

Физика в этой таблице не отдельной подсистемой, а частью ядра: формы тел,
односторонние платформы, события контакта и суставы описаны в разделе 8 выше
и в [API.md](API.md).

Короткий пример, где заняты сразу несколько:

```js
$.ready(() => {
    $.anim.define('hit', {
        duration: 160, loop: 'once',
        tracks: [{ prop: 'scale_x', keys: [{ t: 0, v: 1 }, { t: 1, v: 1.5, ease: 'quadOut' }] }],
    });

    $.tilemap.fromASCII(['###......', '###..###.'], { '#': 1, '.': 0 },
                        { src: 'tiles.png', tile: 32, solid: true })
        .at(0, 0).appendTo($.world);

    const boom = $('<particles>', { amount: 24, lifetime: 500, speed: [60, 180] })
        .at(200, 200).appendTo($.world);

    const grid = $.nav.grid({ x: 0, y: 0, w: 1280, h: 720, cell: 32, agentRadius: 16 });
    grid.buildFromWalls({ tags: ['wall'], agentRadius: 16 });

    $('#hero').navigateTo('#goal', { speed: 240, onArrive: () => boom.burst(24) });
    $('#hero').playClip('hit');
});
```

Ключевые правила:

* **`agentRadius` у навигационной сетки** — запас на габарит агента. Без него
  путь идёт вплотную к стене, и тело в неё упирается: сетка описывает точки, а
  не объём.
* **Коллизии TileMap** пересобираются по позиции узла на момент `.rebuild()`:
  подвинули карту — вызовите `.rebuild()`.
* **`<particles>` и `<tilemap>` рисуются модулями** через реестр
  `registerNodeRenderer` и общий батч `$.gfx.push`, поэтому лишних draw call'ов
  не появляется.
* **Аудио-шины** пересчитывают громкость живых каналов через новые
  `engine.audio.setChannelVolume/setChannelEffect` (см. [API.md](API.md)).
* **Blend-режимы** работают на уровне узла (`.blend('add')`) и кадра
  (`$.blend('add')`); движок сам режет батч на участки с одинаковым режимом,
  так что порядок отрисовки не меняется.
* **Текст в `<ui.input>`** приходит через `$.input.text()`
  (`engine.textInput()`), в агентском режиме — командой `text`.

Дальше: [AGENT_API.md](AGENT_API.md) — как этим управлять программой,
[RECIPES](tutorial-platformer.md) и [API.md](API.md) — низкий уровень.


---

## russiano2d — справочник по JavaScript API

<sub>источник: `docs/API.md`</sub>

# russiano2d — справочник по JavaScript API

Полное описание объекта `globalThis.engine`, который движок публикует для игрового
кода. Все биндинги зарегистрированы в [`src/script.c`](../src/script.c) (функция
`r2d__make_engine`), свойства кадра обновляются в `r2d__refresh_engine_props`.

Игровой код — это ES-модули (QuickJS-ng, ES2023+). Точка входа по умолчанию —
[`game/main.js`](../game/main.js); движок вызывает у неё `onUpdate(dt)` и `onRender()`.

- [1. Точка входа и контракт кадра](#1-точка-входа-и-контракт-кадра)
- [2. Свойства кадра](#2-свойства-кадра)
- [3. Константы](#3-константы)
- [4. Базовые функции](#4-базовые-функции)
- [5. Ввод](#5-ввод)
- [6. Ресурсы и спрайты](#6-ресурсы-и-спрайты)
- [7. Отрисовка и батчинг](#7-отрисовка-и-батчинг)
- [8. Физика](#8-физика)
- [9. Игровой GUI (RmlUi)](#9-игровой-gui-rmlui)
- [10. Звук и музыка](#10-звук-и-музыка)
- [11. Система координат и DPI](#11-система-координат-и-dpi)
- [12. Полигоны видимости (2D-свет и тени)](#12-полигоны-видимости-2d-свет-и-тени)
- [13. 2D BSP-дерево](#13-2d-bsp-дерево)
- [14. Ограничения и лимиты](#14-ограничения-и-лимиты)
- [15. Ошибки и отладка](#15-ошибки-и-отладка)

---

## 1. Точка входа и контракт кадра

### 1.1. Экспорт из ES-модуля

Файл, указанный как точка входа (по умолчанию `game/main.js`), выполняется как
ES-модуль. Движок забирает из объекта модуля две необязательные функции:

```js
// game/main.js
export function onUpdate(dt) {
    // игровая логика; dt — секунды с прошлого кадра
}

export function onRender() {
    // наполнение батча и/или вызовы drawSprite/drawRect
}
```

`onUpdate(dt)` вызывается один раз за кадр **после** шагов физики, поэтому
`engine.getTransforms()` внутри `onUpdate` уже содержит свежие позиции.
`onRender()` вызывается сразу после `onUpdate`, перед началом кадра рендера
(см. [`src/main.c`](../src/main.c)). Обе функции могут отсутствовать — движок
просто ничего не вызовет.

### 1.2. Альтернатива: `engine.setUpdate` / `engine.setRender`

Если удобнее не использовать экспорт, можно зарегистрировать обработчики явно:

```js
// game/main.js
engine.setUpdate((dt) => {
    // ...
});

engine.setRender(() => {
    // ...
});
```

Обе формы равнозначны; если модуль и экспортирует `onUpdate`, и вызывает
`engine.setUpdate()`, победит экспорт (он разбирается после выполнения модуля).

### 1.3. Порядок одного кадра

| Шаг | Что происходит | Где в коде |
|---|---|---|
| 1 | События SDL, снимок ввода, тайминги (`dt`, `time`, `fps`) | `r2d_app_begin_frame` |
| 2 | Фиксированные шаги Box2D (`1/60`, до 5 подшагов) | `r2d_physics_step` |
| 3 | `onUpdate(dt)` | `r2d_script_call_update` |
| 4 | `onRender()` — наполнение батча | `r2d_script_call_render` |
| 5 | Заливка батча в GPU, render pass, RmlUi поверх сцены | `src/main.c` |

Физика считается **до** `onUpdate`, поэтому позиции тел в `getTransforms()`
актуальны на момент логики. Значения `engine.dt` и аргумент `dt` — одно и то же
число, но `dt` берётся из `engine.dt` до вызова, поэтому надёжнее использовать
аргумент.

### 1.4. Горячая перезагрузка

Любое сохранение `.js`-файла в каталоге точки входа (проверка раз в ~0.35 с)
пересоздаёт QuickJS-контекст и заново выполняет `game/main.js`. Окно, GPU-ресурсы
и физический мир при этом **сохраняются**: после перезагрузки мир остаётся таким,
каким был. Текстуры и спрайты тоже переживают перезагрузку (они живут в C),
поэтому повторный `loadTexture` вернёт тот же id.

Полный счётчик перезагрузок доступен как `engine.reloads`. Клавиша `F5` (в сборке
с ImGui) вызывает перезагрузку вручную.

> **Важно.** Между перезагрузками нельзя сохранять ссылки на JS-объекты или
> `Float32Array` из прошлого рантайма — старый контекст уничтожается целиком.
> Сохранять нужно только числовые id (тел, спрайтов, документов UI) и создавать
> JS-объекты заново в `onEnter`/при загрузке модуля.

### 1.5. Командная строка

Опции разбираются в `r2d__print_usage` ([`src/main.c`](../src/main.c)):

| Опция | Действие |
|---|---|
| `--game <каталог>` | Какую игру запускать; точка входа — `<каталог>/main.js` (по умолчанию `game`) |
| `--scene <имя>` | Сразу открыть указанную сцену; значение попадает в `engine.startScene` |
| `--screenshot <файл>` | Сохранить кадр из swapchain в PNG и продолжить работу |
| `--screenshot-at <сек>` | На какой секунде снимать кадр (по умолчанию `2.0`) |
| `--overlay` | Показать отладочный оверлей сразу; иначе он скрыт до `F1` |
| `--stats` | Печатать раз в секунду статистику кадра (FPS, спрайты, тела, звук) |
| `--seconds N` | Выйти автоматически через N секунд — для дымовых тестов |
| `--no-hot-reload` | Не следить за изменениями `.js` |
| `--help`, `-h` | Справка |

Базовый каталог (от него отсчитываются пути к ассетам) выбирается так:
переменная окружения `R2D_GAME_DIR` → текущий каталог, если в нём есть
`game/main.js` → каталог исполняемого файла.

```bash
./build/russiano2d --stats --seconds 4
./build/russiano2d --game demos --scene shooter25d --screenshot /tmp/s.png --seconds 5
```

---

## 2. Свойства кадра

Эти свойства перезаписываются движком перед каждым `onUpdate` — читать их можно
только для чтения. Присваивание не имеет эффекта.

| Свойство | Тип | Значение |
|---|---|---|
| `engine.time` | `number` | Секунды с момента старта приложения |
| `engine.dt` | `number` | Длительность текущего кадра, секунды (ограничена сверху `0.25`) |
| `engine.fps` | `number` | Сглаженный FPS (`fps = fps*0.9 + inst*0.1`) |
| `engine.frame` | `number` | Номер кадра, счёт с 0 |
| `engine.width` | `number` | Ширина окна в логических точках (`app.width`) — система координат сцены |
| `engine.height` | `number` | Высота окна в логических точках (`app.height`) — система координат сцены |
| `engine.mouseX` | `number` | Курсор по X в логических точках окна |
| `engine.mouseY` | `number` | Курсор по Y в логических точках окна |
| `engine.wheel` | `number` | Накопленный за кадр `ev.wheel.y` (сбрасывается каждый кадр) |
| `engine.reloads` | `number` | Сколько раз скрипты перезагружались с запуска |

```js
export function onUpdate(dt) {
    if (engine.keyPressed(engine.scancode('Space'))) {
        engine.log('кадр', engine.frame, 'время', engine.time.toFixed(2));
    }
}
```

> Координаты сцены задаются в **логических точках** окна (`app.width` ×
> `app.height`, по умолчанию 1280×720, задаются в `r2d_app_init`). Хелперы
> `engine.width`/`engine.height` возвращают тот же **логический** размер —
> именно в этих координатах работают спрайты, треугольники и вся сцена.
> Физический размер буфера кадра (на HiDPI-экранах он больше) доступен
> отдельно как `engine.pixel_width`/`engine.pixel_height`; он нужен только
> для операций над самим изображением, например для снимка кадра.
> Подробнее — в разделе [11](#11-система-координат-и-dpi).

### `engine.startScene`

Свойство, а не функция: имя сцены, переданное флагом `--scene` при запуске
(см. [1.5](#15-командная-строка)), либо `null`, если флаг не задавали. Движок
выставляет его **до** выполнения модуля точки входа, поэтому читать можно прямо
в top-level коде — именно так делает [`demos/main.js`](../demos/main.js):

```js
// demos/main.js
scenes.switchTo(engine.startScene || 'launcher');
```

> Значение не меняется в течение сессии и переживает hot reload: рантайм
> пересоздаётся, но `--scene` остаётся тем же. Это удобно для дымовых
> прогонов — один и тот же бинарник открывает нужную сцену без правки кода.

---

## 3. Константы

| Константа | Значение | Смысл |
|---|---|---|
| `engine.STATIC` | `0` | Статичное тело: не двигается, не реагирует на силы |
| `engine.KINEMATIC` | `1` | Кинематическое тело: двигается скриптом, но не силами |
| `engine.DYNAMIC` | `2` | Динамическое тело: полная симуляция Box2D |
| `engine.WHITE` | `-1` | Белый цвет: `rgba(255,255,255,255)`, упакован как `0xFFFFFFFF` |

```js
const id = engine.createBody({ x: 100, y: 100, halfW: 16, halfH: 16, type: engine.DYNAMIC });
```

`engine.WHITE` — это знаковое 32-битное представление `0xFFFFFFFF`. При записи в
`Uint32Array` или при передаче в `drawSprite`/`drawRect` оно трактуется как
непрозрачный белый.

---

## 4. Базовые функции

### `engine.log(...args)`

Печатает аргументы в stdout через движок, с префиксом `[js]` и `[r2d]`.
Аргументы приводятся к строке и соединяются пробелом.

| Параметр | Тип | Описание |
|---|---|---|
| `...args` | `any` | Что угодно; каждый аргумент приводится к строке |

**Возвращает:** `undefined`.

```js
engine.log('игрок на', engine.mouseX.toFixed(0), 'px');
// [r2d] [js] игрок на 640 px
```

### `engine.rgba(r, g, b, a)`

Упаковывает цвет в 32-битное целое (little-endian RGBA: младший байт — красный).
Формат совпадает с `R2D_RGBA` из [`src/r2d.h`](../src/r2d.h).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `r` | `number` | `255` | Красный, 0–255 |
| `g` | `number` | `255` | Зелёный, 0–255 |
| `b` | `number` | `255` | Синий, 0–255 |
| `a` | `number` | `255` | Альфа, 0–255 |

**Возвращает:** `number` — знаковое 32-битное число. При записи в `Uint32Array`
превращается в корректное беззнаковое `0xRRGGBBAA`-по-байтам значение.

```js
const red = engine.rgba(255, 0, 0, 255);   // → -16776961 (0xFFFF0000)
engine.drawRect(0, 0, 100, 100, red);
```

### `engine.quit()`

Запрашивает завершение приложения. Фактический выход произойдёт в конце
текущего кадра (`app.quit_requested = true`).

**Возвращает:** `undefined`.

```js
engine.ui.on(doc, 'btn-quit', 'click', () => engine.quit());
```

### `engine.scancode(name)`

Переводит человекочитаемое имя клавиши в `SDL_Scancode` через
`SDL_GetScancodeFromName`. Используйте это вместо «магических» чисел.

| Параметр | Тип | Описание |
|---|---|---|
| `name` | `string` | Имя клавиши так, как его понимает SDL |

**Возвращает:** `number` — код скана, либо `0` (`SDL_SCANCODE_UNKNOWN`), если имя
не распознано.

```js
const jump = engine.scancode('Space');
const left = engine.scancode('Left');
```

---

## 5. Ввод

Все функции ввода используют **физические** коды клавиш (`SDL_Scancode`), а не
символы раскладки. Поэтому `engine.scancode('W')` на русской раскладке всё равно
соответствует физической клавише W.

Состояние мыши — в логических точках, клавиши геймпада — в перечислении SDL.

### `engine.keyDown(scancode)`

`true`, пока клавиша удерживается.

```js
if (engine.keyDown(engine.scancode('D'))) { /* идти вправо весь кадр */ }
```

### `engine.keyPressed(scancode)`

`true` только в том кадре, когда клавиша была нажата (фронт). Подходит для
прыжка, переключения паузы, подтверждения в меню.

```js
if (engine.keyPressed(engine.scancode('Space'))) { /* прыжок */ }
```

### `engine.keyReleased(scancode)`

`true` только в кадре отпускания клавиши.

### `engine.mouseDown(button)`

`true`, пока кнопка мыши удерживается.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `button` | `number` | `1` | Номер кнопки SDL: `1` — ЛКМ, `2` — СКМ, `3` — ПКМ, дальше `4`/`5` — боковые |

### `engine.mousePressed(button)`

`true` в кадре нажатия кнопки мыши. Параметр `button` — тот же, по умолчанию `1`.

```js
if (engine.mousePressed(1)) {
    engine.log('клик в', engine.mouseX, engine.mouseY);
}
```

### `engine.padDown(button)`

`true`, пока удерживается кнопка геймпада. `button` — индекс `SDL_GamepadButton`
(`0` — A/юг, `1` — B/восток, `2` — X/запад, `3` — Y/север и т. д.). Геймпад
открывается автоматически при подключении (движок берёт первый).

### `engine.padAxis(axis)`

Значение оси геймпада. `axis` — индекс `SDL_GamepadAxis` (`0` — левый стик X,
`1` — левый стик Y, триггеры обычно `4`/`5`).

**Возвращает:** `number`: стики в диапазоне примерно `[-1, 1]`, триггеры `[0, 1]`.

```js
const ax = engine.padAxis(0);        // левый стик по X
const move = Math.abs(ax) > 0.2 ? ax * 300 : 0;
```

> Геймпад опрашивается только если он подключён; без геймпада `padDown` вернёт
> `false`, а `padAxis` — `0`.

### Таблица имён клавиш

Имена проверены через `SDL_GetScancodeFromName` (SDL3). Полный список — в
`SDL_scancode.h`; ниже самые ходовые. Имя не распознано → `scancode()` вернёт `0`.

| Имя для `engine.scancode(...)` | Клавиша |
|---|---|
| `"A"` … `"Z"` | Буквенные клавиши (по физическому расположению) |
| `"0"` … `"9"` | Цифровой ряд |
| `"Space"` | Пробел |
| `"Return"` | Enter (главный). Имя `"Enter"` **не** работает |
| `"Escape"` | Esc |
| `"Tab"`, `"Backspace"` | Tab, Backspace |
| `"Left"`, `"Right"`, `"Up"`, `"Down"` | Стрелки |
| `"Left Shift"`, `"Right Shift"` | Shift (пробел в имени обязателен) |
| `"Left Ctrl"`, `"Right Ctrl"` | Ctrl (именно `Ctrl`, не `Control`) |
| `"Left Alt"`, `"Right Alt"` | Alt |
| `"Left GUI"`, `"Right GUI"` | Cmd / Win |
| `"F1"` … `"F24"` | Функциональные клавиши |
| `"Insert"`, `"Delete"`, `"Home"`, `"End"`, `"PageUp"`, `"PageDown"` | Навигация |
| `"CapsLock"`, `"Numlock"`, `"PrintScreen"`, `"Pause"` | Служебные |
| `"Keypad 0"` … `"Keypad 9"`, `"Keypad ."`, `"Keypad Enter"`, `"Keypad +"`, `"Keypad -"` | Цифровой блок |
| `"-"`, `"="`, `","`, `"."`, `"/"`, `";"`, `"'"`, `"["`, `"]"`, `"\\"`, обратный апостроф | Пунктуация задаётся самим символом (не словом) |
| `"Mute"`, `"VolumeUp"`, `"VolumeDown"` | Мультимедиа |

```js
const keys = {
    jump: engine.scancode('Space'),
    left: [engine.scancode('A'), engine.scancode('Left')],
    back: engine.scancode('Escape'),
};
```

---

## 6. Ресурсы и спрайты

Пути к файлам (`loadTexture`, `ui.load`) разрешаются относительно `base_path`
движка: переменная окружения `R2D_GAME_DIR` → текущий каталог, если в нём есть
`game/main.js` → каталог исполняемого файла (см. `r2d__pick_base_path` в
[`src/app.c`](../src/app.c)). То есть `'assets/atlas.png'` — это путь от корня
проекта.

### `engine.loadTexture(path)`

Загружает изображение (PNG и другие форматы, которые понимает SDL_image) в
GPU-текстуру.

| Параметр | Тип | Описание |
|---|---|---|
| `path` | `string` | Путь к файлу относительно `base_path` |

**Возвращает:** `number` — id текстуры (`>= 0`) или `-1` при ошибке.

Повторный вызов с тем же путём возвращает тот же id — кэширование внутри
рендера. Текстуры переживают перезагрузку скриптов.

```js
const tex = engine.loadTexture('assets/atlas.png');
if (tex < 0) engine.log('атлас не найден');
```

### `engine.textureSize(texture)`

| Параметр | Тип | Описание |
|---|---|---|
| `texture` | `number` | id текстуры |

**Возвращает:** `number[]` — `[width, height]` в пикселях; `[0, 0]` для
несуществующего id.

```js
const [w, h] = engine.textureSize(tex);
```

### `engine.createSprite(texture, sx, sy, sw, sh)`

Регистрирует прямоугольник внутри текстуры (кадр атласа). UV-координаты
считаются один раз из размеров текстуры, поэтому при отрисовке достаточно id.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `texture` | `number` | — | id текстуры |
| `sx`, `sy` | `number` | `0` | Левый верхний угол кадра внутри текстуры |
| `sw`, `sh` | `number` | `0` | Размер кадра; если `<= 0`, берётся размер всей текстуры |

**Возвращает:** `number` — id спрайта (`>= 0`) или `-1` (неверная текстура,
нет памяти).

```js
const TILE = 32;
const slice = (i) => engine.createSprite(tex, i * TILE, 0, TILE, TILE);
const player = slice(0);
const brick  = slice(1);
```

---

## 7. Отрисовка и батчинг

Кадр отрисовки начинается с очистки внутреннего набора команд
(`r2d_render_begin_frame`), затем `onRender` может либо добавлять отдельные
элементы через `drawSprite`/`drawRect`, либо залить всё одним вызовом
`submitSprites`. Смешивать оба способа можно.

Все команды попадают в один батч и раскладываются в вершинный/индексный буферы
за один заход; количество draw call'ов равно числу смен текстуры в кадре.

### `engine.drawSprite(sprite, x, y, w, h, angle, color)`

Рисует спрайт с центром в точке `(x, y)`.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `sprite` | `number` | — | id спрайта |
| `x`, `y` | `number` | `0` | Центр спрайта, пиксели сцены |
| `w`, `h` | `number` | `0` | Размер; если `<= 0`, берётся исходный размер спрайта |
| `angle` | `number` | `0` | Поворот в радианах, по часовой стрелке (ось Y вниз) |
| `color` | `number` | `engine.WHITE` | Тонирование/альфа, упакованный RGBA |

**Возвращает:** `undefined`. Неверный id спрайта молча игнорируется.

```js
engine.drawSprite(playerSprite, 320, 200, 28, 40, 0, engine.WHITE);
```

### `engine.drawRect(x, y, w, h, color)`

Рисует залитый прямоугольник через внутреннюю текстуру 1×1. Удобно для фона,
отладочных рамок и простых фигур.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `x`, `y` | `number` | `0` | Левый верхний угол |
| `w`, `h` | `number` | `0` | Размеры |
| `color` | `number` | `engine.WHITE` | Упакованный RGBA |

**Возвращает:** `undefined`.

```js
engine.drawRect(0, 0, 1280, 720, engine.rgba(20, 24, 34, 255));   // фон
```

### `engine.setClearColor(r, g, b, a)`

Задаёт цвет очистки кадра (фон, если сцена ничего не нарисовала).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `r`, `g`, `b` | `number` | `0.09`, `0.10`, `0.13` | Компоненты 0.0–1.0 |
| `a` | `number` | `1.0` | Альфа 0.0–1.0 |

Обратите внимание: компоненты здесь — **float 0..1**, в отличие от `engine.rgba`,
где 0–255. Значения по умолчанию — тёмно-синий фон.

```js
engine.setClearColor(0.06, 0.08, 0.11, 1.0);
```

### `engine.submitSprites(transforms, colors, count, blend?)`

Главный путь отрисовки: одним вызовом отдаёт в C массив спрайтов на весь кадр.

| Параметр | Тип | Описание |
|---|---|---|
| `transforms` | `Float32Array` | Плоский массив троек-шестёрок, stride **6** |
| `colors` | `Uint32Array \| null` | Цвета по одному на спрайт; можно `null` |
| `count` | `number` (необязательно) | Сколько спрайтов рисовать |
| `blend` | `string` (необязательно) | Режим смешивания: `'alpha'` (по умолчанию), `'add'`, `'multiply'`, `'none'` |

**Возвращает:** `number` — сколько команд реально добавлено (может быть меньше
`count`, если спрайты невалидны).

Режим смешивания действует на весь вызов: один батч рисуется одним конвейером.
Если в кадре нужны разные режимы, разбейте спрайты на несколько вызовов —
именно так делает высокоуровневый `$.gfx` (см.
[HIGH_LEVEL_API.md](HIGH_LEVEL_API.md), раздел 7). Без четвёртого аргумента
поведение прежнее — обычное альфа-смешивание.

```js
engine.submitSprites(xf, col, n);              // альфа
engine.submitSprites(glow_xf, glow_col, gn, 'add');   // свечение складывается
```

#### Формат `transforms` (stride 6)

Массив — это последовательность записей по 6 чисел с плавающей точкой:

| Смещение | Поле | Смысл |
|---|---|---|
| `i*6 + 0` | `sprite` | id спрайта (целое, хранится как float) |
| `i*6 + 1` | `x` | центр по X, пиксели сцены |
| `i*6 + 2` | `y` | центр по Y, пиксели сцены |
| `i*6 + 3` | `w` | ширина |
| `i*6 + 4` | `h` | высота |
| `i*6 + 5` | `angle` | поворот в радианах |

```js
const MAX = 1000;
const xf  = new Float32Array(MAX * 6);   // sprite, x, y, w, h, angle
const col = new Uint32Array(MAX);        // упакованный RGBA

let n = 0;
function push(sprite, x, y, w, h, angle, color) {
    const o = n * 6;
    xf[o + 0] = sprite;
    xf[o + 1] = x;
    xf[o + 2] = y;
    xf[o + 3] = w;
    xf[o + 4] = h;
    xf[o + 5] = angle;
    col[n] = color;          // Uint32Array сам приведёт signed → unsigned
    n++;
}

// ... наполнение ...

engine.submitSprites(xf, col, n);
```

#### Формат `colors` (stride 1)

`Uint32Array` длиной не меньше `count`. Каждый элемент — упакованный RGBA, где
**младший байт — красный** (little-endian):

```
биты 0..7   — R
биты 8..15  — G
биты 16..23 — B
биты 24..31 — A
```

Именно такой формат возвращает `engine.rgba(r, g, b, a)` и константа
`engine.WHITE` (`0xFFFFFFFF`). Если `colors` не передан или равен `null`, все
спрайты рисуются белым. Если массив короче `count`, лишние спрайты не рисуются
вообще (см. правила вычисления `count` ниже).

#### Правила вычисления `count`

1. Базовое число спрайтов = `transforms.length / 6`.
2. Если передан третий аргумент `count` и он `>= 0` и меньше базового, берётся он.
3. Если `colors` короче получившегося `count`, `count` урезается до длины
   `colors` (чтобы не выйти за границу массива).

#### Почему это быстро

* **Один переход границы C ↔ JS на весь кадр.** Вызов JS-функции из C стоит
  дорого; при отрисовке «по спрайту» на 1000 объектов это 1000 переходов плюс
  1000 проверок аргументов. Здесь переход один.
* **Нет маршалинга объектов.** C не разбирает JS-объекты и строки: он получает
  указатель на буфер `Float32Array` через `JS_GetTypedArrayBuffer` и читает
  числа напрямую. Никаких аллокаций под каждый спрайт.
* **Данные уже в нужном виде.** JS пишет в типизированный массив, C читает его
  как `const float *` — формат совпадает байт в байт, копирования нет.
* **Батчинг по текстуре.** C раскладывает команды в один вершинный/индексный
  буфер и рисует по одному draw call'у на смену текстуры. На демо-уровне это
  порядка одной-двух тысяч спрайтов на пару draw call'ов.

Типичный каркас: массивы создаются **один раз** в `onEnter`, а в `onRender`
только заполняются и очищаются через счётчик `n`.

> Если передать в `colors` не `Uint32Array`, а массив другого типа, C всё равно
> прочитает его как 32-битные целые — это даст мусорные цвета. Используйте
> именно `Uint32Array` (и `Float32Array` для трансформов). Оба аргумента должны
> быть типизированными массивами — обычный `Array` вызовет исключение.

### `engine.submitTriangles(vertices, count)`

Рисует произвольные треугольники с цветом **на каждой вершине**. Это дополнение
к `submitSprites`: пакет спрайтов умеет только повёрнутые прямоугольники, а
произвольная фигура — полигон видимости, веер, заливка — нет. Треугольники
позволяют нарисовать любую такую фигуру и получить плавный градиент без
текстуры (цвет интерполируется между вершинами).

| Параметр | Тип | Описание |
|---|---|---|
| `vertices` | `Float32Array` | Плоский массив вершин, stride **6** |
| `count` | `number` (необязательно) | Число **вершин**; обязано быть кратно 3 |

**Возвращает:** `number` — сколько вершин реально принято, всегда кратно 3
(лишний хвост отброшен). `0`, если рантайм недоступен или массив короче одного
треугольника. Если аргумент не `Float32Array` — выбрасывается `TypeError`.

#### Формат `vertices` (stride 6)

| Смещение | Поле | Смысл |
|---|---|---|
| `i*6 + 0` | `x` | координата по X, пиксели **логического** экрана |
| `i*6 + 1` | `y` | координата по Y |
| `i*6 + 2` | `r` | красный, 0..255 (значения насыщаются) |
| `i*6 + 3` | `g` | зелёный, 0..255 |
| `i*6 + 4` | `b` | синий, 0..255 |
| `i*6 + 5` | `a` | альфа, 0..255 |

Каждые три вершины — один треугольник: `(0, 1, 2)`, `(3, 4, 5)`, … Координаты
заданы в той же системе, что у спрайтов, — в **логических точках** окна
(`engine.width` × `engine.height`, см. [11](#11-система-координат-и-dpi)), а не в
пикселях framebuffer. Цвет — на вершину, между вершинами интерполируется.

#### Правила вычисления `count`

1. Базовое число вершин = `vertices.length / 6`.
2. Если передан `count` и он меньше базового, берётся он.
3. `count` округляется вниз до кратного 3: неполный треугольник отбрасывается.
4. Если `count` не передан, берётся весь массив (с тем же округлением).

```js
// Веер из центра: (центр, v[i], v[i+1]) — годится для полигона видимости.
const tri = new Float32Array(64 * 3 * 6);
let v = 0;
function put(x, y, r, g, b, a) {
    const o = v * 6;
    tri[o + 0] = x; tri[o + 1] = y;
    tri[o + 2] = r; tri[o + 3] = g; tri[o + 4] = b; tri[o + 5] = a;
    v++;
}

// ... наполнение ...
engine.submitTriangles(tri, v);   // → число принятых вершин
```

#### Порядок и смешивание

* Треугольники уходят одним draw call с белой текстурой и обычным
  альфа-смешиванием — как спрайты.
* Они рисуются **поверх спрайтов того же кадра**, поэтому вызывать их нужно
  **после** `engine.submitSprites()`, когда батч спрайтов уже отдан.
* Смешивать с `drawSprite`/`drawRect`/`submitSprites` можно свободно: всё
  попадает в общий кадр отрисовки.

---

## 8. Физика

Мир Box2D целиком живёт в C. JS не считает коллизии: он создаёт тела по
числовому id и раз в кадр читает готовые трансформы.

### Масштаб: 32 пикселя = 1 метр

Координаты, размеры, скорости и гравитация задаются в **пикселях** и
**пикселях в секунду**. Внутри Box2D всё переводится в метры делением на
`R2D_PX_PER_M = 32` (см. [`src/physics.h`](../src/physics.h) и
[`src/physics.c`](../src/physics.c)). Углы и угловые скорости — без перевода:
радианы и радианы в секунду. Масса — килограммы.

Ось `y` направлена **вниз**, как на экране, поэтому «вниз» — это
положительная гравитация `+y`. При старте мир получает гравитацию
`(0, 2000)` px/s² (см. [`src/main.c`](../src/main.c)).

### `engine.createBody(opts)`

Создаёт тело. По умолчанию — прямоугольник, но форму можно выбрать.

| Поле `opts` | Тип | По умолчанию | Описание |
|---|---|---|---|
| `x`, `y` | `number` | `0` | Центр тела, пиксели |
| `halfW`, `halfH` | `number` | `16`, `16` | Полуразмеры (половина ширины/высоты); `<= 0` → `16` |
| `angle` | `number` | `0` | Начальный поворот, радианы |
| `type` | `number` | `engine.STATIC` | `STATIC` / `KINEMATIC` / `DYNAMIC` |
| `density` | `number` | `1.0` | Плотность, кг/м² |
| `friction` | `number` | `0.3` | Трение |
| `restitution` | `number` | `0.0` | Упругость (0 — не отскакивает) |
| `fixedRotation` | `bool` | `false` | Запретить вращение (удобно игроку) |
| `shape` | `string` | `'box'` | `'box'` / `'circle'` / `'capsule'` / `'polygon'` |
| `radius` | `number` | `halfW` | Радиус круга и капсулы |
| `points` | `number[]` | — | Полигон: `[x0,y0,x1,y1,…]` в локальных пикселях, до 8 точек |
| `polyRadius` | `number` | `0` | Скругление полигона |
| `oneWay` | `bool` | `false` | Односторонняя платформа |
| `oneWayAngle` | `number` | `-π/2` | Куда смотрит лицевая сторона, радианы |
| `sensor` | `bool` | `false` | Зона: ловит контакты, но не отталкивает |
| `contacts` | `bool` | `false` | Присылать события контакта для этого тела |

**Возвращает:** `number` — id тела (`>= 0`) или `-1` при ошибке/лимите.

```js
const player = engine.createBody({
    x: 80, y: 400,
    halfW: 14, halfH: 20,
    type: engine.DYNAMIC,
    density: 1.0, friction: 0.02, restitution: 0.0,
    fixedRotation: true,
});

// Круг: катится честно, без «квадратных» углов.
const ball = engine.createBody({ x: 200, y: 100, shape: 'circle', radius: 12,
                                 type: engine.DYNAMIC, contacts: true });

// Капсула: не цепляется за стыки тайлов.
const hero = engine.createBody({ x: 100, y: 100, shape: 'capsule',
                                 halfH: 20, radius: 10, type: engine.DYNAMIC,
                                 fixedRotation: true });

// Полигон: силуэт произвольной формы (до 8 точек, локальные пиксели).
const rock = engine.createBody({ x: 300, y: 100, shape: 'polygon',
                                 points: [-20, -10, 20, -10, 25, 15, -25, 15],
                                 type: engine.DYNAMIC });

// Односторонняя платформа: сквозь неё проходят снизу.
const platform = engine.createBody({ x: 400, y: 300, halfW: 100, halfH: 8,
                                     type: engine.STATIC, oneWay: true });
```

> Коробка 32×32 px при плотности 1 весит примерно 1 кг. Тело-«игрок» 28×40 px
> весит около 1.1 кг. Импульсы и скорости подбирайте с учётом этого.

**Односторонние платформы.** `oneWay` работает через pre-solve-колбэк Box2D:
контакт разрешается, только если тело приближается с лицевой стороны
(по умолчанию — сверху, `oneWayAngle = -π/2`). Нормаль хранится в системе
тела, поэтому повёрнутая платформа работает правильно. Касательные контакты у
самой кромки отсекаются порогом 0.1 — иначе игрок цеплялся бы за угол,
пролетая снизу.

### `engine.contacts()`

События контакта за прошедший шаг физики. Собираются один раз в
`r2d_physics_step`, живут до следующего шага.

**Возвращает:** `object[]`, каждый элемент:

| Поле | Тип | Описание |
|---|---|---|
| `kind` | `string` | `'begin'` (начали касаться), `'end'` (перестали), `'hit'` (удар) |
| `a`, `b` | `number` | id тел; `-1`, если тело уже удалено |
| `nx`, `ny` | `number` | Нормаль от A к B |
| `x`, `y` | `number` | Точка контакта, пиксели |
| `speed` | `number` | Скорость сближения (только `'hit'`, иначе 0) |

```js
for (const c of engine.contacts()) {
    if (c.kind === 'begin') engine.log(`тело ${c.a} коснулось ${c.b} со скоростью ${c.speed}`);
}
```

События приходят только для форм, созданных с `contacts: true`. Высокоуровневое
API включает этот флаг динамическим телам автоматически и раздаёт события
узлам — см. [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md).

### `engine.createJoint(opts)` / `engine.destroyJoint(id)`

Сустав между двумя телами.

| Поле `opts` | Тип | По умолчанию | Описание |
|---|---|---|---|
| `type` | `string` | `'revolute'` | `'revolute'` (шарнир), `'distance'` (стержень), `'weld'` (сварка) |
| `a`, `b` | `number` | — | id тел |
| `ax`, `ay` | `number` | `0` | Точка крепления на теле A, мировые пиксели |
| `bx`, `by` | `number` | `0` | Точка крепления на теле B |
| `collide` | `bool` | `false` | Могут ли соединённые тела сталкиваться |
| `length` | `number` | по факту | Длина для `distance`, пиксели |
| `limit` | `bool` | `false` | Включить ограничение |
| `lower`, `upper` | `number` | `0` | Границы: угол (рад) для шарнира, длина (пиксели) для стержня |
| `motor` | `bool` | `false` | Включить мотор |
| `motorSpeed` | `number` | `0` | Скорость мотора |
| `maxTorque` | `number` | `0` | Максимальный момент (или сила для стержня) |

**Возвращает:** `number` — id сустава (`>= 0`) или `-1`.

Дополнительно: `engine.jointAlive(id)`, `engine.jointCount()`. При удалении
тела связанные с ним суставы уничтожаются Box2D — `jointAlive` вернёт `false`.

```js
const hinge = engine.createJoint({ type: 'revolute', a: anchor, b: door,
                                   ax: 100, ay: 200, bx: 100, by: 200,
                                   limit: true, lower: 0, upper: Math.PI / 2 });
engine.destroyJoint(hinge);
```

### `engine.destroyBody(id)`

Удаляет тело. Безопасно вызывать с несуществующим id (ничего не произойдёт).
Слот id может быть переиспользован следующим `createBody`, поэтому после
удаления не обращайтесь к телу по старому id.

```js
engine.destroyBody(coin.body);
```

### `engine.bodyAlive(id)`

**Возвращает:** `boolean` — существует ли тело и валиден ли его id.

### `engine.getTransforms()`

**Возвращает:** `Float32Array` или `null` (если физика недоступна).

Это **zero-copy** представление памяти C: типизированный массив создан
`JS_NewArrayBuffer` поверх `physics->transforms`, общий размер —
`R2D_MAX_BODIES * 3` чисел (8192 × 3). Индексация:

```
x     = transforms[id * 3 + 0]
y     = transforms[id * 3 + 1]
angle = transforms[id * 3 + 2]   // радианы
```

```js
const t = engine.getTransforms();
const x = t[body * 3], y = t[body * 3 + 1], a = t[body * 3 + 2];
```

Особенности:

* **Это живой массив.** Данные обновляются C-кодом каждый шаг физики; читать их
  нужно после шага (в `onUpdate`/`onRender`), а не кэшировать значения.
* **Копировать не нужно.** Массив не занимает JS-памяти под данные — он смотрит
  прямо в структуру `R2DPhysics`. Копия (`slice`, `new Float32Array(t)`) только
  замедлит и «заморозит» данные.
* **Нельзя сохранять ссылку между перезагрузками скриптов.** После hot reload
  (или `F5`) рантайм QuickJS уничтожается, а вместе с ним — `ArrayBuffer`. Сразу
  после перезагрузки получите массив заново: `this.transforms = engine.getTransforms()`.
* Позиции удалённых тел в массиве «замирают» — перед использованием проверяйте
  `engine.bodyAlive(id)`.
* Индекс `id` привязан к телу; порядок в массиве не совпадает с порядком
  создания после переиспользования слотов.

### `engine.setVelocity(id, vx, vy)`

Задаёт линейную скорость, пиксели/с.

```js
engine.setVelocity(player, 300, 0);   // вправо
engine.setVelocity(player, 0, -640);  // прыжок вверх (Y вниз!)
```

### `engine.getVelocity(id)`

**Возвращает:** `number[]` — `[vx, vy]` в пикселях/с; `[0, 0]` для мёртвого тела.

```js
const [vx, vy] = engine.getVelocity(player);
```

### `engine.setAngularVelocity(id, w)` / `engine.getAngularVelocity(id)`

Угловая скорость в радианах/с. У тела с `fixedRotation: true` вращение
игнорируется.

### `engine.setPosition(id, x, y, angle)`

Телепортирует тело и мгновенно обновляет его запись в массиве трансформов
(та же функция, что используется при респауне).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` | `number` | — | id тела |
| `x`, `y` | `number` | `0` | Новый центр, пиксели |
| `angle` | `number` | `0` | Новый поворот, радианы |

```js
engine.setPosition(player, spawnX, spawnY, 0);
engine.setVelocity(player, 0, 0);
```

### `engine.applyImpulse(id, ix, iy)`

Прикладывает линейный импульс к центру масс. Единицы — кг·(пиксель/с): C делит
значение на 32, чтобы получить импульс Box2D.

```js
engine.applyImpulse(crate, 0, -200);   // подбросить ящик
```

### `engine.setGravity(gx, gy)` / `engine.getGravity()`

Гравитация мира в пикселях/с².

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `gx` | `number` | `0` | Горизонтальная составляющая |
| `gy` | `number` | `-9.81` | Вертикальная; «вниз» — положительное значение |

> Значение по умолчанию `gy = -9.81` — это почти ноль в пиксельных единицах.
> Всегда передавайте оба аргумента явно. Начальная гравитация движка —
> `(0, 2000)`.

`engine.getGravity()` возвращает `number[]` — `[gx, gy]`.

```js
engine.setGravity(0, 1200);            // «лунная» гравитация, px/s²
const [gx, gy] = engine.getGravity();
```

### `engine.setAwake(id, awake)`

Будит (`true`) или усыпляет (`false`) тело. Спящее тело не считается физикой,
пока его не разбудит столкновение.

### `engine.bodyMass(id)`

**Возвращает:** `number` — масса в кг (`0` для невалидного id).

### `engine.bodyCount()`

**Возвращает:** `number` — сколько тел сейчас живо.

### Ограничения физики

* Максимум `R2D_MAX_BODIES = 8192` тел одновременно; при переполнении
  `createBody` вернёт `-1` и запишет ошибку в лог.
* Массив `getTransforms()` всегда длиной `8192 * 3`, независимо от числа тел.
* Шаг физики фиксированный: `1/60` с, до 5 подшагов на кадр. Долгий кадр не
  «взрывает» симуляцию: лишнее время отбрасывается.

---

## 9. Игровой GUI (RmlUi)

RmlUi рисует HTML/CSS-подобные документы (`.rml` + `.rcss`) поверх сцены, в тот
же GPU-проход. Разметка — это XML с элементами `div`, `span`, `p`, `h1`,
`button` и т. п.

### `engine.ui.load(path)`

Загружает документ. Созданный документ **скрыт** по умолчанию — после загрузки
нужно вызвать `engine.ui.show(doc)`.

| Параметр | Тип | Описание |
|---|---|---|
| `path` | `string` | Путь к `.rml` относительно `base_path` |

**Возвращает:** `number` — id документа (`>= 0`) или `-1`. Повторная загрузка
того же пути возвращает тот же id (кэш по пути), так что загружать документ один
раз в `onEnter` безопасно.

Максимум 64 документа одновременно.

```js
const menu = engine.ui.load('ui/menu.rml');
if (menu >= 0) engine.ui.show(menu);
```

### `engine.ui.show(doc)` / `engine.ui.hide(doc)`

Показывает/скрывает документ. Скрытый документ не рисуется и не получает ввод.

### `engine.ui.unload(doc)`

Выгружает документ, освобождая слот. Обращения к выгруженному id игнорируются.
Обычно достаточно `hide`; полноценно удалять документ нужно только если он больше
не понадобится.

### `engine.ui.visible(doc)`

**Возвращает:** `boolean` — виден ли документ. Удобно для реализации паузы и
переключения HUD.

### `engine.ui.setText(doc, elementId, text)`

Заменяет внутреннее содержимое элемента (`SetInnerRML`).

| Параметр | Тип | Описание |
|---|---|---|
| `doc` | `number` | id документа |
| `elementId` | `string` | Значение атрибута `id` элемента |
| `text` | `string` | Новый текст; парсится как RML-разметка |

Элемент ищется по `id`; если его нет — в лог уйдёт предупреждение, вызов
безопасен.

```js
engine.ui.setText(hud, 'score', String(score));
```

> Поскольку текст интерпретируется как разметка, при выводе пользовательских
> данных экранируйте `<`, `>` и `&` (например, заменяя их на `&lt;`, `&gt;`,
> `&amp;`), иначе можно случайно сломать вёрстку или вставить тег.

### `engine.ui.setClass(doc, elementId, className, add)`

Добавляет (`add = true`, по умолчанию) или снимает (`add = false`) CSS-класс у
элемента. Удобно переключать состояния «скрыт/виден», «выбрано» и т. п.

```js
engine.ui.setClass(hud, 'pause-panel', 'hidden', true);
```

### `engine.ui.setProperty(doc, elementId, property, value)`

Задаёт инлайновое CSS-свойство элементу.

```js
engine.ui.setProperty(hud, 'bar', 'width', '50%');
engine.ui.setProperty(hud, 'panel', 'background-color', 'rgba(0,0,0,0.6)');
```

### `engine.ui.on(doc, elementId, event, callback)`

Вешает обработчик события RmlUi на элемент.

| Параметр | Тип | Описание |
|---|---|---|
| `doc` | `number` | id документа |
| `elementId` | `string` | `id` элемента |
| `event` | `string` | Имя события RmlUi: `"click"`, `"mousedown"`, `"mouseover"`, `"mouseout"`, … |
| `callback` | `function` | Вызывается как `callback(elementId, eventName)` |

**Возвращает:** `number` — id обработчика (`>= 0`) или `-1`, если элемент не
найден. Тип callback обязателен — иначе будет выброшено исключение.

Всего можно зарегистрировать до **256** обработчиков за жизнь рантайма. Внутри
RmlUi владеет слушателем и удаляет его вместе с элементом.

```js
engine.ui.on(doc, 'btn-play', 'click', () => ctx.goto('platformer'));
engine.ui.on(doc, 'btn-quit', 'click', () => engine.quit());
```

> **Не вешайте обработчики повторно при повторном входе в сцену.** `load()`
> кэширует документ, а слушатели остаются на элементах. Если вешать их каждый
> `onEnter`, один клик вызовет обработчик несколько раз, а счётчик 256 будет
> расти. Храните флаг (`this.listenersBound`) — пример в
> [`game/scenes/menu.js`](../game/scenes/menu.js).

### Шрифты

При старте движок загружает **все** `.ttf`/`.otf` из `assets/fonts`
(см. `r2d_gui_create` в [`src/gui.cpp`](../src/gui.cpp)). В RCSS имя семейства
берётся из самого шрифта:

```css
body {
    font-family: LatoLatin;
    font-size: 18px;
}
```

Без хотя бы одного шрифта в `assets/fonts` текст не отрисуется (в лог уйдёт
предупреждение).

### Иконки Material Design

**2235** иконок Material Design вкомпилированы в исполняемый файл вместе со
шрифтом и таблицей имён — внешних файлов не нужно, работает и в релизной сборке
без ассетов. Генератор — [`tools/r2d_embed_icons.c`](../tools/r2d_embed_icons.c),
сборка — [`cmake/Icons.cmake`](../cmake/Icons.cmake); из C доступны функции из
[`src/icons.h`](../src/icons.h).

| Функция | Возвращает | Описание |
|---|---|---|
| `engine.ui.icon(name)` | `string` | Символ иконки или `""`, если такого имени нет |
| `engine.ui.iconCode(name)` | `number` | Кодпоинт иконки (`0`, если имени нет) |
| `engine.ui.hasIcon(name)` | `boolean` | Есть ли такое имя |
| `engine.ui.iconCount()` | `number` | Сколько иконок всего — `2235` |
| `engine.ui.iconNames()` | `string[]` | Все имена, отсортированы по алфавиту |

Иконки занимают область Private Use Area (U+E000..U+F8FF), поэтому подставляются
в любой текст интерфейса и рисуются как глифы запасного шрифта. В RmlUi он
регистрируется как fallback face, в ImGui — через `MergeMode`, так что отдельный
элемент под иконку заводить не нужно.

```js
// Пример из demos/launcher.js: иконка вклеивается прямо в разметку кнопки.
const icon = engine.ui.icon('directions_run');
engine.ui.setHtml(doc, 'btn', icon + '<span>Играть</span>');

if (engine.ui.hasIcon('volume_up')) {
    engine.ui.setText(doc, 'vol', engine.ui.icon('volume_up'));
}
```

Имена — официальные из Material Design Icons (`home`, `settings`, `volume_up`,
`directions_run`, …). Полный список отдаёт `iconNames()`; сами иконки и лицензия
(Apache-2.0) перечислены в [`demos/assets/CREDITS.md`](../demos/assets/CREDITS.md).

### Подключение стилей и файловая система

Стили подключаются ссылкой внутри `<head>` документа:

```xml
<link type="text/rcss" href="menu.rcss"/>
```

Путь — относительно `.rml`-файла. Обратите внимание на тип: для стилей это
именно `text/rcss` (или `text/css`), а `text/template` зарезервирован под
подключаемые RML-шаблоны — с ним CSS попытается разобраться как RML и
документ останется без оформления.

Файловый интерфейс RmlUi ищет документ сначала в `<base_path>/game/`, затем в
`<base_path>/` (см. `BasePathFileInterface` в
[`src/gui.cpp`](../src/gui.cpp)), поэтому из JS можно писать и
`engine.ui.load('ui/menu.rml')`, и `engine.ui.load('game/ui/menu.rml')`.

---

## 10. Звук и музыка

Звуковой слой построен на SDL3_mixer ([`src/audio.h`](../src/audio.h),
[`src/audio.c`](../src/audio.c)): он даёт декодеры OGG/WAV/MP3, пул каналов,
петли, затухания и отдельную дорожку для музыки. Всё доступно как
`engine.audio.*` (регистрация — в `r2d__make_engine`, блок «Звук и музыка»).

Пути, как и у текстур, отсчитываются от базового каталога запуска, поэтому звук
демо выглядит так: `'demos/assets/audio/sfx/shoot_01.ogg'`.

### Функции

| Функция | Возвращает | Описание |
|---|---|---|
| `engine.audio.load(path)` | `number` | Загружает звук; id `>= 0` или `-1` |
| `engine.audio.play(id, volume?, pan?, loop?)` | `number` | Играет эффект; номер канала `0..15` или `-1` |
| `engine.audio.stop(channel, fadeMs?)` | `undefined` | Останавливает канал; по умолчанию `fadeMs = 0` |
| `engine.audio.stopAll(fadeMs?)` | `undefined` | Останавливает все каналы эффектов |
| `engine.audio.playing(channel)` | `boolean` | Играет ли сейчас этот канал |
| `engine.audio.activeChannels()` | `number` | Сколько каналов эффектов занято |
| `engine.audio.music(id, loop?, volume?, fadeMs?)` | `undefined` | Запускает музыку |
| `engine.audio.stopMusic(fadeMs?)` | `undefined` | Останавливает музыку |
| `engine.audio.pauseMusic(paused?)` | `undefined` | Пауза (`true`, по умолчанию) или продолжение (`false`) |
| `engine.audio.musicPlaying()` | `boolean` | Играет ли музыкальная дорожка |
| `engine.audio.setMasterVolume(v)` | `undefined` | Общая громкость микшера, 0..1 |
| `engine.audio.getMasterVolume()` | `number` | Текущая общая громкость |
| `engine.audio.setSfxVolume(v)` | `undefined` | Множитель громкости эффектов, 0..1 |
| `engine.audio.setMusicVolume(v)` | `undefined` | Множитель громкости музыки, 0..1 (стартовое `0.7`) |
| `engine.audio.duration(id)` | `number` | Длительность в секундах или `-1`, если неизвестна |
| `engine.audio.count()` | `number` | Сколько уникальных звуков загружено |

### Каналы звука: громкость, панорама, эффекты

Эти вызовы добавлены для высокоуровневых аудио-шин (`$.audio` в
[HIGH_LEVEL_API.md](HIGH_LEVEL_API.md)): громкость шины должна менять уже
играющие звуки, а не только следующие за ней.

| Функция | Возвращает | Описание |
|---|---|---|
| `engine.audio.setChannelVolume(channel, v)` | `undefined` | Громкость играющего канала, 0..1 (умножается на `sfxVolume`) |
| `engine.audio.channelVolume(channel)` | `number` | Громкость, заданная игре для канала |
| `engine.audio.setChannelPan(channel, pan)` | `undefined` | Панорама канала: `-1`…`+1` |
| `engine.audio.channelPan(channel)` | `number` | Текущая панорама канала |
| `engine.audio.setChannelEffect(channel, kind, p1?, p2?)` | `boolean` | Эффект канала: `'none'`, `'lowpass'`, `'echo'` |
| `engine.audio.channelEffect(channel)` | `string` | Имя активного эффекта канала |
| `engine.audio.effectCount()` | `number` | Сколько встроенных эффектов |
| `engine.audio.effectName(i)` | `string` | Имя эффекта по индексу |

**Эффекты.** SDL_mixer 3.2 не содержит готовых DSP-эффектов, поэтому движок
обрабатывает сэмплы сам через `MIX_SetTrackRawCallback`:

| `kind` | `p1` | `p2` | Что делает |
|---|---|---|---|
| `'lowpass'` | частота среза, Гц (по умолчанию 800) | — | однополюсный фильтр низких частот (приглушение) |
| `'echo'` | задержка, мс (по умолчанию 180) | доля повтора 0..0.9 (по умолчанию 0.35) | эхо с обратной связью |

Реверба, хоруса и компрессора нет — это ограничение текущей реализации, а не
настройка. Обработка идёт в аудиопотоке: буфер задержки выделяется один раз
при инициализации, поэтому переключение эффекта на лету безопасно.

### Параметры

**`play(id, volume = 1.0, pan = 0.0, loop = false)`**

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` | `number` | — | id, полученный из `load` |
| `volume` | `number` | `1.0` | 0..1, зажимается |
| `pan` | `number` | `0.0` | `-1` — слева, `0` — центр, `+1` — справа |
| `loop` | `boolean` | `false` | `true` — зациклить эффект |

**`music(id, loop = true, volume = 1.0, fadeMs = 0)`**

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` | `number` | — | id, полученный из `load` |
| `loop` | `boolean` | `true` | Зацикливать музыку |
| `volume` | `number` | `1.0` | 0..1, зажимается |
| `fadeMs` | `number` | `0` | Плавное появление (fade-in), миллисекунды |

`stop`, `stopAll` и `stopMusic` тоже принимают необязательное затухание
`fadeMs` в миллисекундах.

### Громкость

Значения `volume` перемножаются с общими множителями (см. `r2d_audio_*`):

* эффекты: `volume × sfxVolume`, после чего вся смесь идёт через `masterVolume`;
* музыка: `volume × musicVolume`, затем тоже `masterVolume`.

`setMasterVolume` меняет усиление микшера (`MIX_SetMixerGain`), `setSfxVolume`
и `setMusicVolume` — множители дорожек. `setSfxVolume` применяется и к уже
играющим каналам, поэтому громкость шины слышна сразу. Из геттеров в JS
доступен только `getMasterVolume()`: текущие множители эффектов и музыки
движок наружу не отдаёт.

### Примеры

```js
const shoot = engine.audio.load('demos/assets/audio/sfx/shoot_01.ogg');
const music = engine.audio.load('demos/assets/audio/music/action.ogg');

// Выстрел: чуть тише и со сдвигом вправо от центра.
const ch = engine.audio.play(shoot, 0.8, 0.3, false);
if (ch >= 0 && engine.audio.playing(ch)) engine.audio.stop(ch, 150);

// Фоновая музыка с плавным входом.
engine.audio.music(music, true, 0.8, 500);
engine.audio.pauseMusic(true);     // пауза
engine.audio.pauseMusic(false);    // продолжить
engine.audio.stopMusic(600);       // плавно убрать

// Громкость и диагностика.
engine.audio.setMasterVolume(0.5);
engine.audio.setSfxVolume(0.9);
engine.audio.setMusicVolume(0.7);
engine.log('звуков загружено:', engine.audio.count(),
           'играет каналов:', engine.audio.activeChannels(),
           'длительность:', engine.audio.duration(music), 'с');
```

### Важные детали

* **Каналов эффектов ровно 16** (`R2D_AUDIO_CHANNELS`). Если все заняты,
  движок вытесняет нулевой канал — лучше потерять старый звук, чем новый.
* **До 128 уникальных звуков** (`R2D_AUDIO_MAX_SOUNDS`); при переполнении
  `load` вернёт `-1` и запишет ошибку в лог.
* **Повторный `load()` с тем же путём возвращает тот же id.** Звуки живут в C и
  переживают hot reload, поэтому кэшировать нужно именно id (так и делает
  `AudioBank` в демо).
* **Музыка — отдельная дорожка**: своя остановка, пауза, затухание и громкость;
  она не занимает канал эффектов и не панорамируется (играет по центру).
* **Короткие эффекты декодируются при первом проигрывании** (`predecode = false`),
  поэтому первый `play` может слегка задержаться; дальше звук берётся из кэша.
* **Сборка без звука.** С `-DR2D_ENABLE_AUDIO=OFF` вместо
  [`src/audio.c`](../src/audio.c) компилируется
  [`src/audio_stub.c`](../src/audio_stub.c): все вызовы становятся no-op,
  `load` всегда возвращает `-1`, а при старте в лог уйдёт предупреждение.

---

## 11. Система координат и DPI

* Начало координат — **левый верхний угол** окна.
* Ось `y` направлена **вниз**, как на экране. Прыжок вверх — отрицательная
  скорость по `y`.
* Все координаты, размеры и скорости — в **пикселях** (кроме углов: радианы).
* Координаты сцены заданы в **логических точках** окна: на Retina/HiDPI окно
  1280×720 остаётся «1280×720 точек», физический буфер кадра при этом больше
  (например, 2560×1440 пикселей). Движок передаёт размер в точках в
  `r2d_render_begin_frame`, поэтому проекция и все команды отрисовки живут в
  логических точках.

Разделение размеров в [`src/app.h`](../src/app.h):

| Поле | Где используется |
|---|---|
| `app.width`, `app.height` | Логический размер окна в точках; система координат сцены |
| `app.pixel_width`, `app.pixel_height` | Реальный размер буфера кадра (Retina/HiDPI) |

`engine.width`/`engine.height` отдают **логический** размер окна
(`app.width`/`app.height`) — ровно ту систему, в которой заданы координаты
сцены и курсор мыши. Пересчёт в физические пиксели делает рендер, поэтому на
Retina `1280x720` в JS остаётся `1280x720`, хотя буфер кадра там 2560x1440.
Игровому коду про DPI знать не нужно: `engine.drawRect(0, 0, engine.width,
engine.height, ...)` заливает экран целиком на любом мониторе.

Курсор мыши (`engine.mouseX`/`engine.mouseY`) приходит в логических точках — в
той же системе, что и координаты сцены (см. комментарий в
[`src/app.c`](../src/app.c)).

---

## 12. Полигоны видимости (2D-свет и тени)

`engine.light.*` считает **полигон видимости** из точки среди
отрезков-препятствий: множество точек, до которых от наблюдателя доходит
прямая, не пересекающая ни одной стены. Из него собирается 2D-свет: полигон
заливается веером треугольников (`engine.submitTriangles`), а всё, что в него не
попало, остаётся в тени. Тени получаются из самой геометрии — отдельной карты
теней не нужно.

Реализация — C-обёртка [`src/light.h`](../src/light.h) /
[`src/light.cpp`](../src/light.cpp) над header-only библиотекой
trylock/visibility (MIT). Библиотека
тянется через `FetchContent` с пином коммита
`71eb5c00692713abd870113f3efc943322486d8e` (объявление —
[`cmake/Dependencies.cmake`](../cmake/Dependencies.cmake), оформление —
[`cmake/Light.cmake`](../cmake/Light.cmake)). Её заголовки подключены как SYSTEM,
чтобы строгие предупреждения движка не разбирали чужой C++14-код. Из движка
наружу торчит только C-API: ни классов, ни исключений.

### `engine.light.visibility(segments, x, y)`

| Параметр | Тип | Описание |
|---|---|---|
| `segments` | `Float32Array` | Отрезки-препятствия, stride **4**: `x1, y1, x2, y2` |
| `x`, `y` | `number` | Позиция наблюдателя/источника, пиксели сцены |

**Возвращает:** `Float32Array` — вершины полигона `[x, y, x, y, …]` **по часовой
стрелке**, либо `null`, если полигон не поместился в буфер (или получился
вырожденным). Наблюдатель без препятствий тоже даёт полигон — ограничивающую
рамку вокруг точки. Если передано меньше трёх аргументов или первый аргумент не
`Float32Array`, выбрасывается `TypeError`.

Особенности:

* **Пересекающиеся отрезки можно отдавать как есть.** Библиотека такого не
  умеет и на пересечениях ведёт себя неопределённо, поэтому обёртка сама режет
  их в точках пересечения. Это стоит O(n²), так что в больших сценах склеивайте
  коллинеарные грани в длинные отрезки — в демо `light` грани тайлов
  объединяются в прогоны именно по этой причине.
* **Замкнутость и пересечения — забота обёртки.** Библиотеке нужен замкнутый
  полигон из непересекающихся отрезков; обёртка добавляет ограничивающую рамку
  вокруг наблюдателя и разрезает пересечения, так что от JS этого не требуется.
* **Полигон всегда звёздчатый относительно наблюдателя**, поэтому триангулируется
  простым веером: `(центр, v[i], v[i+1])`, где последняя вершина замыкается на
  первую (`(i+1) % n`). Список вершин не дублирует первую точку в конце.
* **Выделение памяти — на каждый вызов.** Если нужен собственный буфер под
  треугольники, оцените его размер заранее через `maxPoints()`.

```js
const segments = new Float32Array([
    300,  80, 300, 400,   // вертикальная стена
    300, 400, 700, 400,   // наклонная
    700, 400, 700,  80,
]);

const poly = engine.light.visibility(segments, engine.mouseX, engine.mouseY);
if (poly) {
    const n = poly.length / 2;                 // число вершин полигона
    const tri = new Float32Array(n * 3 * 6);   // веер: центр + 2 вершины
    const ox = engine.mouseX, oy = engine.mouseY;
    let v = 0;
    const put = (x, y, a) => {
        tri.set([x, y, 255, 220, 160, a], v * 6);
        v++;
    };
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        put(ox, oy, 200);                      // центр ярче
        put(poly[i * 2], poly[i * 2 + 1], 0);  // периметр прозрачнее
        put(poly[j * 2], poly[j * 2 + 1], 0);
    }
    engine.submitTriangles(tri, v);            // поверх спрайтов, один draw call
}
```

### `engine.light.maxPoints(segmentCount)`

**Возвращает:** `number` — верхнюю оценку того, сколько вершин может понадобиться
полигону для такого числа отрезков. Оценка растёт примерно как `8n² + 24`
(в коде `m = 2n² + 4` подотрезков, `4m + 8` вершин): для `n = 50` это `20024`.
Функция нужна только для предварительной оценки буфера — сам `visibility()`
память выделяет сам, а при нехватке возвращает `null`. Реальный полигон обычно на
порядки меньше верхней оценки. Для `segmentCount <= 0` возвращает `16` — этого
хватает ограничивающей рамке.

```js
const maxVerts = engine.light.maxPoints(segments.length / 4);
const tri = new Float32Array(maxVerts * 3 * 6);   // с запасом на веер
```

---

## 13. 2D BSP-дерево

`engine.bsp.*` — собственное 2D BSP-дерево движка
([`src/bsp.h`](../src/bsp.h), [`src/bsp.c`](../src/bsp.c)). Оно решает одну
задачу: дать корректный порядок отрисовки «от дальних к ближним» для **целых
отрезков** на произвольной геометрии. Пакетная отрисовка не имеет z-буфера:
порядок в пакете и есть порядок отрисовки.

Зачем это нужно и когда нет. Сеточному рейкастеру (`shooter25d`) BSP не нужен —
там глубина решается на каждую колонку экрана, и дерево только мешало бы. Но как
только геометрия перестаёт быть регулярной сеткой — наклонные стены, комнаты
произвольной формы, — расстояние до отрезка не задаёт порядок, и нужен обход
дерева. Дерево строится один раз по статичной геометрии, а обход из точки
наблюдателя даёт порядок за O(n) без сортировки и без мерцания на пересечениях.

### `engine.bsp.build(segments)`

Строит дерево по плоскому массиву отрезков.

| Параметр | Тип | Описание |
|---|---|---|
| `segments` | `Float32Array` | Отрезки, stride **5**: `x1, y1, x2, y2, метка` |

**Возвращает:** `boolean` — `true`, если дерево построено; `false` при пустом
входе, нехватке памяти или недоступном рантайме. Если дерево уже было, оно
заменяется новым.

`метка` — произвольное число, которое дерево вернёт вместе с отрезком
(`segment()`); это способ связать нарезанные куски с исходной геометрией (в демо
`bsp` метка — индекс стены).

Построение: разделитель выбирается из выборки по минимуму разрезаний, а
пересекаемые отрезки режутся. Поэтому `count()` может быть **больше**, чем число
отрезков на входе: дерево хранит уже нарезанные куски.

### `engine.bsp.clear()`

Освобождает дерево и его буферы. `undefined` и безопасен даже без построенного
дерева. Вызывайте в `onExit` сцены, которой дерево больше не нужно: дерево живёт
в рантайме, а не в сцене.

### `engine.bsp.count()` / `engine.bsp.nodes()` / `engine.bsp.depth()`

| Функция | Возвращает |
|---|---|
| `engine.bsp.count()` | `number` — отрезков в дереве, **с учётом порождённых разрезанием** |
| `engine.bsp.nodes()` | `number` — узлов дерева |
| `engine.bsp.depth()` | `number` — глубину дерева |

Без построенного дерева все три возвращают `0`.

### `engine.bsp.segment(i)`

| Параметр | Тип | Описание |
|---|---|---|
| `i` | `number` | Индекс отрезка (обычно из `order()`) |

**Возвращает:** `number[]` — `[x1, y1, x2, y2, метка, разрезан?]`, где последний
элемент — `boolean` (`true`, если отрезок порождён разрезанием при построении),
либо `null` для несуществующего индекса. Удобно, чтобы подсветить разрезы.

```js
const seg = engine.bsp.segment(order[i]);
if (seg) {
    const [x1, y1, x2, y2, user, split] = seg;
    // ... нарисовать отрезок; split = true — кусок, порождённый разрезанием
}
```

### `engine.bsp.order(x, y, farToNear)`

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `x`, `y` | `number` | `0` | Позиция наблюдателя |
| `farToNear` | `boolean` | `true` | `true` — порядок отрисовки «от дальних к ближним»; `false` — обратный |

**Возвращает:** `number[]` — индексы отрезков в порядке отрисовки, либо `null`,
если дерево не построено. Длина массива равна `count()`.

```js
// onEnter: engine.bsp.build(flatSegments) — один раз.
// onRender: порядок пересчитывается под текущую позицию наблюдателя.
const order = engine.bsp.order(camera.x, camera.y, true) || [];
for (const i of order) {
    const seg = engine.bsp.segment(i);
    // ... нарисовать дальние первыми
}
```

### Вставка точек (спрайтов) не реализована

Вставки точек в дерево, как в Doom, в движке **нет**: промежуточная версия
падала, и её убрали, чтобы не держать в движке нерабочий путь (см. комментарий в
[`src/bsp.h`](../src/bsp.h)). Спрайты сортируйте по расстоянию до наблюдателя —
в сценах, где BSP нужен ради отрезков, этого достаточно. Так сделано в демо
`bsp`: стены идут в порядке из дерева, а персонажи — поверх них, по расстоянию.

---

## 14. Ограничения и лимиты

| Что | Лимит | Константа / где |
|---|---|---|
| Одновременных физических тел | 8192 | `R2D_MAX_BODIES` в [`src/r2d.h`](../src/r2d.h) |
| Загруженных текстур | 256 | `R2D_MAX_TEXTURES` |
| Каналов звуковых эффектов | 16 | `R2D_AUDIO_CHANNELS` в [`src/audio.h`](../src/audio.h) |
| Загруженных звуков | 128 | `R2D_AUDIO_MAX_SOUNDS` в [`src/audio.h`](../src/audio.h) |
| Дорожек музыки | 1 | `music_track` в [`src/audio.h`](../src/audio.h) |
| Встроенных иконок Material Design | 2235 | `r2d_icon_total()`, [`src/icons.h`](../src/icons.h) |
| Спрайтов | растёт динамически | `R2D_INITIAL_SPRITES = 1024` — стартовая ёмкость |
| Вершин в `submitTriangles` | растёт динамически (по размеру `Float32Array`) | батчер `r2d_batch_triangles` в [`src/render.c`](../src/render.c) |
| Отрезков-препятствий для `light.visibility` | ограничено памятью; пересечения разрезаются за O(n²) | `r2d_visibility_polygon` в [`src/light.cpp`](../src/light.cpp) |
| Вершин полигона видимости | верхняя оценка ~`8n² + 24`; при `n = 50` — 20024 | `r2d_visibility_max_points` в [`src/light.cpp`](../src/light.cpp) |
| Отрезков в BSP-дереве | растёт динамически; разрезание увеличивает `count()` | `R2DBsp` в [`src/bsp.h`](../src/bsp.h) |
| Документов RmlUi | 64 | `kMaxDocuments` в [`src/gui.cpp`](../src/gui.cpp) |
| Обработчиков `ui.on` | 256 | `callbacks[256]` в [`src/script.h`](../src/script.h) |
| Подписчиков на события SDL | 8 | `event_listeners[8]` в [`src/app.h`](../src/app.h) |
| Память JS-рантайма | 256 МБ | `JS_SetMemoryLimit` |
| Размер стека JS | 2 МБ | `JS_SetMaxStackSize` |
| Максимальный `dt` кадра | 0.25 с | ограничение в `r2d_app_begin_frame` |
| Шаг физики | 1/60 с, до 5 подшагов | `R2D_FIXED_DT`, `R2D_MAX_SUBSTEPS` |

---

## 15. Ошибки и отладка

* Ошибка в JS (исключение, `throw`) не роняет движок: движок перехватывает её,
  печатает в stderr с префиксом `[r2d][error] JS:` и стек вызова, а кадр
  продолжает рисоваться. Текст последней ошибки виден в отладочном оверлее.
* Если скрипт не загрузился, окно всё равно откроется (сцена будет пустой), а
  причина окажется в консоли.
* `engine.log(...)` пишет в **stdout**, ошибки — в **stderr**, чтобы диагностика
  не смешивалась.

Горячие клавиши движка (см. [`src/main.c`](../src/main.c)):

| Клавиша | Действие |
|---|---|
| `F1` | Показать/скрыть отладочный оверлей (ImGui) |
| `F5` | Перезапустить скрипты вручную |
| `Cmd+Esc` / `Ctrl+Esc` | Выход из приложения |

> Отладочный оверлей по умолчанию **скрыт**, чтобы не закрывать демо, и
> включается по `F1`. Показать его сразу при старте можно флагом `--overlay`
> (см. [1.5](#15-командная-строка)); `--stats` дополнительно печатает статистику
> кадра в stdout раз в секунду.

> Движок **не** перехватывает игровые клавиши: `Esc` целиком принадлежит игре.
> В демо он возвращает с уровня в меню, а из меню завершает работу через
> `engine.quit()`. Это обычный ввод, который сцена читает через
> `engine.keyPressed(engine.scancode('Escape'))`.

---

## 16. Дополнения: мир, файлы, текст, агент

Этот раздел описывает вызовы, добавленные вместе с высокоуровневым API `$`
(см. [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md)). Игре они доступны и напрямую —
`$` построен поверх них.

### `engine.raycast(x1, y1, x2, y2)`

Ближайшее препятствие на отрезке. Считает Box2D (`b2World_CastRayClosest`),
поэтому попадания точные и для повёрнутых тел.

**Возвращает:** `object | null`. Поля объекта: `hit` (`true`), `x`, `y` —
точка попадания в пикселях, `nx`, `ny` — нормаль поверхности, `body` — id тела
(или `-1`), `fraction` — доля пройденного отрезка `0..1`.

```js
const hit = engine.raycast(100, 300, 500, 300);
if (hit) engine.log('стена на', hit.x, hit.y, 'тело', hit.body);
```

> Луч, начинающийся **внутри** тела, это тело не находит: Box2D игнорирует
> начальное перекрытие. Поэтому «стою ли на земле» проверяется лучом из центра
> узла вниз (`$('#hero').onFloor()`), а не из-под ног.

### `engine.queryPoint(x, y)` и `engine.queryBox(x, y, w, h)`

Тела, чьи формы накрывают точку или попадают в прямоугольник с центром `(x, y)`.

**Возвращает:** `Int32Array` идентификаторов тел (не больше `R2D_MAX_QUERY` = 256).

```js
const ids = engine.queryBox(400, 300, 120, 120);
for (let i = 0; i < ids.length; i++) engine.log('тело', ids[i]);
```

### `engine.keysPressed()` и `engine.keysReleased()`

Скан-коды клавиш, нажатых (отпущенных) **в этом кадре**, одним массивом.
Нужны, чтобы подписываться на ввод без перебора 512 клавиш из JS.

**Возвращает:** `Int32Array`.

### `engine.keyName(scancode)`

Человекочитаемое имя клавиши (`'Space'`, `'A'`) — обратная операция к
`engine.scancode()`.

### `engine.mouseDelta()`

**Возвращает:** `number[]` — `[dx, dy]` в пикселях за текущий кадр.

### `engine.textInput()`

Текст, введённый с клавиатуры **за текущий кадр**: UTF-8, уже с учётом
раскладки, `Shift` и IME. Копится из событий `SDL_EVENT_TEXT_INPUT`, поэтому
это единственный корректный способ сделать текстовое поле — скан-коды про
раскладку ничего не знают.

**Возвращает:** `string` (пустая строка, если ввода не было).

```js
const typed = engine.textInput();
if (typed) name += typed;
```

В высокоуровневом API то же самое доступно как `$.input.text()`,
а контрол `<ui.input>` использует это сам (см.
[widgets.md](highlevel/widgets.md)).

Агентский режим умеет набирать текст командой `text` — см.
[AGENT_API.md](AGENT_API.md), раздел 3.5.

### `engine.drawText(text, x, y, size, color, align)`

Рисует строку **поверх сцены** (в логических точках окна). Реализовано через
ImGui background draw list, поэтому текст попадает и на скриншот агента.
Позиция — левый верхний угол для `align = 'left'`.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `text` | `string` | — | Строка (кириллица поддерживается) |
| `x`, `y` | `number` | `0` | Точка привязки |
| `size` | `number` | `18` | Кегль в пикселях |
| `color` | `number` | белый | Упакованный RGBA (`engine.rgba(...)`) |
| `align` | `string` | `'left'` | `'left'`, `'center'`, `'right'` |

Текст рисуется раз в кадр: очередь очищается после отрисовки, сохранять
вызовы «на потом» нельзя.

### `engine.measureText(text, size)`

**Возвращает:** `number[]` — `[ширина, высота]` строки в пикселях. До первого
кадра ImGui отдаёт оценку (ширина считается из среднего глифа), после — точный
размер.

### `engine.setOverlay(on)`

Показать (`true`) или скрыть (`false`) отладочный оверлей — тот же, что
переключается по `F1`.

### `engine.fs` — файлы

Пути разрешаются от каталога запуска; **абсолютные пути принимаются как есть**.

| Функция | Возвращает | Описание |
|---|---|---|
| `engine.fs.readText(path)` | `string` или `undefined` | Содержимое файла; `undefined`, если файла нет |
| `engine.fs.write(path, text)` | `boolean` | Записать файл (каталоги создаются) |
| `engine.fs.exists(path)` | `boolean` | Есть ли файл |
| `engine.fs.remove(path)` | `boolean` | Удалить файл |
| `engine.fs.list(dir)` | `string[]` | Имена файлов в каталоге (без подкаталогов) |

### `engine.setExit(fn)` и `engine.setSnapshot(fn)`

* `setExit(fn)` — функция, которую движок вызовет при завершении (в том числе в
  агентском режиме). Игра сохраняет в ней прогресс.
* `setSnapshot(fn)` — функция, возвращающая описывающий игру объект; именно он
  уходит агенту в ответ на команду `state`. Высокоуровневое API вызывает её
  автоматически (`$.agent.install()`), игра может добавить свои поля через
  `$.agent.expose(имя, функция)`.

```js
engine.setExit(() => engine.fs.write('save.json', JSON.stringify(progress)));
engine.setSnapshot(() => ({ score, level, enemies: 3 }));
```

### Свойства запуска

Появляются в `engine` при старте:

| Свойство | Тип | Значение |
|---|---|---|
| `engine.agent` | `bool` | `true`, если движок запущен с `--agent` |
| `engine.headless` | `bool` | `true`, если окно скрыто (`--headless`) |
| `engine.seed` | `number` | Зерно из `--seed` (для `$.random`) |
| `engine.fixedDt` | `number` | Шаг времени из `--fixed-dt` (0 — реальное время) |
| `engine.basePath` | `string` | Каталог запуска (от него считаются пути к ассетам) |
| `engine.mouseDX`, `engine.mouseDY` | `number` | Смещение мыши за кадр |

### Командная строка (дополнение к 1.5)

| Опция | Действие |
|---|---|
| `--agent` | Режим агента: JSON-команды со stdin, ответы в stdout (см. [AGENT_API.md](AGENT_API.md)) |
| `--headless` | Скрытое окно: рендер и скриншоты работают, на экране ничего нет |
| `--fixed-dt <сек>` | Детерминированный шаг времени |
| `--seed <N>` | Зерно случайных чисел |
| `--frames <N>` | Выйти ровно после N кадров |

> В агентском режиме весь журнал движка переключается в **stderr** (даже то,
> что печатают RmlUi и ImGui), чтобы stdout оставался чистым потоком JSON.


---

## russiano2d — агентский интерфейс (низкий уровень)

<sub>источник: `docs/AGENT_API.md`</sub>

# russiano2d — агентский интерфейс (низкий уровень)

Движок можно запустить в **режиме агента**: тогда им управляет не человек, а
программа (ИИ-агент, CI, скрипт). Окно скрыто, время детерминировано, а весь
обмен идёт **по одной JSON-строке на запрос и одну на ответ** через stdin/stdout.

Низкий уровень — это то, что умеет C-ядро. Высокоуровневые хелперы для игрового
кода (`$.agent`, проверки, снимки мира в терминах игры) описаны в
[HIGH_LEVEL_API.md](HIGH_LEVEL_API.md), а готовый клиент и раннер тестов лежат в
`tools/agent_client.py` и `tools/run_tests.py`.

---

## 1. Запуск

```bash
./build/russiano2d --agent --game demos --scene platformer
./build/russiano2d --agent --headless --fixed-dt 0.0166666667 --seconds 30
```

| Флаг | Смысл |
|---|---|
| `--agent` | Режим агента: цикл кадров управляется командами, stdin/stdout — протокол |
| `--headless` | Окно создаётся скрытым (`SDL_WINDOW_HIDDEN`). Скриншоты работают |
| `--fixed-dt <сек>` | Детерминированный шаг: `dt` постоянный, время не зависит от реального |
| `--seed <N>` | Начальное зерно для `$.random` (доступно как `engine.seed`) |
| `--frames <N>` | Выйти ровно после N кадров (удобно для дымовых прогонов без команд) |
| `--scene <имя>` | Открыть сцену сразу, минуя меню |
| `--game <каталог>` | Каталог игры (точка входа `<каталог>/main.js`) |
| `--stats` | Печатать статистику кадра раз в секунду (в stderr) |

Обычный режим (`--seconds`, `--screenshot`, `--overlay`) работает как раньше;
`--agent` можно совмещать с `--stats` и `--seconds`.

### Что означают флаги для детерминизма

* `--fixed-dt` заменяет реальный `dt` на константу: `engine.dt` всегда равен
  ей, `engine.time` растёт ровно на неё за кадр Формула «кадр N = время N·dt»
  держится при любой загрузке машины.
* `--headless` убирает зависимость от дисплея и от фокуса окна.
* `--seed` + `$.random` дают воспроизводимую последовательность случайных чисел.
* Физика Box2D и так шагает фиксированным шагом `1/60`.

Рекомендуемый набор для тестов:
`--agent --headless --fixed-dt 0.0166666667 --no-hot-reload`.

---

## 2. Транспорт и формат

* Запрос — **одна строка** JSON-объекта, заканчивается `\n`.
* Ответ — **одна строка** JSON-объекта, заканчивается `\n`.
* Весь прочий вывод движка (логи, предупреждения, `console.log`) идёт в
  **stderr** — stdout чист и пригоден для парсинга.
* При старте, до первого ответа, печатается `{"event":"ready", ...}`.
* Обязательное поле запроса — `cmd` (строка). Поле `id` необязательно и
  возвращается в ответе как есть — удобно для сопоставления.
* Ошибка никогда не завершает движок: ответ `{"ok":false,"error":"..."}`.
* Закрытие stdin завершает процесс (как `quit`).

Пример обмена:

```
→ {"cmd":"ping","id":1}
← {"ok":true,"pong":true,"frame":0,"time":0.0,"id":1}
→ {"cmd":"step","frames":60}
← {"ok":true,"frames":60,"frame":60}
→ {"cmd":"eval","code":"$.world.count()"}
← {"ok":true,"result":3}
```

### Режим ожидания

В режиме агента кадры **не идут сами**. Пока не выполнена команда, которая
шагает время (`step`), движок ждёт следующую строку на stdin. Поэтому один и
тот же сценарий воспроизводится побитово. Команда `--realtime` не
предусмотрена: если нужно живое время, запускайте без `--agent`.

---

## 3. Команды

### 3.1. Базовые

| `cmd` | Параметры | Ответ |
|---|---|---|
| `ping` | — | `{"ok":true,"pong":true,"frame":N,"time":T}` |
| `frames` | — | `{"ok":true,"frame":N,"time":T}` |
| `quit` | — | `{"ok":true}` и выход |
| `reload` | — | `{"ok":true,"reloads":N}` — перезапустить скрипты (hot reload вручную) |

### 3.2. Время и шаги

| `cmd` | Параметры | Ответ |
|---|---|---|
| `step` | `frames` (int, по умолчанию `1`), `dt` (number, необязательно) | `{"ok":true,"frames":N,"frame":N2}` |

`step` прогоняет ровно `frames` кадров: каждый — это `begin_frame` →
физика → `onUpdate` → `onRender` → GPU. Кадры рисуются по-настоящему, поэтому
после `step` доступен корректный скриншот.

Максимум за одну команду — 100000 кадров (защита от вечного цикла).

### 3.3. Состояние

| `cmd` | Параметры | Ответ |
|---|---|---|
| `state` | — | `{"ok":true,"state":{...},"frame":N,"time":T}` |

Поле `state` формируется игровым кодом: если высокоуровневое API загружено,
`$.agent` регистрирует провайдер снимка, и в `state` попадают мир, игрок,
камера, счётчики сцены — всё, что игра считает нужным показать агенту
(см. `$.agent.snapshot()` в [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md)).

Если провайдер не зарегистрирован (игра на «голом» `engine.*`), движок отдаёт
встроенный минимум:

```json
{ "frame": 120, "time": 2.0, "fps": 60.0, "bodies": 14, "sprites": 68,
  "draws": 2, "reloads": 0, "scene": "platformer", "game": null }
```

### 3.4. Вычисление кода

| `cmd` | Параметры | Ответ |
|---|---|---|
| `eval` | `code` (строка) | `{"ok":true,"result":<JSON>}` либо `{"ok":false,"error":"..."}` |

`code` выполняется **в том же JS-контексте, что и игра**: доступны `engine`,
`$`, `Global`, переменные модулей (через `$.eval`/`$.get`), физика, UI.

Значение приводится к JSON через `JSON.stringify`:
* числа, строки, булевы, `null` — как есть;
* объекты и массивы — рекурсивно;
* `undefined`-результат отдаётся как `null`;
* циклические структуры → ошибка `преобразование результата в JSON не удалось`.

Примеры:

```json
{"cmd":"eval","code":"engine.frame"}
{"cmd":"eval","code":"$('#hero').pos()"}
{"cmd":"eval","code":"$('.enemy').length"}
{"cmd":"eval","code":"$.world.raycast(0,0,500,500)"}
{"cmd":"eval","code":"$.time.pause()"}
```

Код может быть многострочным: используйте `\n` внутри JSON-строки.

### 3.5. Виртуальный ввод

Виртуальный ввод не требует ни окна, ни человека. Состояние ввода действует
на последующие кадры, пока его не отпустят.

| `cmd` | Параметры | Ответ |
|---|---|---|
| `key` | `key` (имя SDL, напр. `"Space"`, `"A"`, `"Escape"`), `action`: `"down"`, `"up"`, `"tap"` (по умолчанию `tap`) | `{"ok":true,"key":"Space","action":"tap"}` |
| `keys` | `hold` — массив имён; **заменяет** весь удерживаемый набор (`[]` — отпустить всё) | `{"ok":true,"hold":["A","Space"]}` |
| `mouse` | `button`: `1` ЛКМ, `2` СКМ, `3` ПКМ; `action`: `"down"`, `"up"`, `"click"` | `{"ok":true}` |
| `mouseMove` | `dx`, `dy` (относительное) либо `x`, `y` (абсолютное, в логических точках) | `{"ok":true,"x":..,"y":..}` |
| `wheel` | `amount` (number) | `{"ok":true}` |
| `text` | `text` (строка, UTF-8) — символы, которые игрок «набрал» в этом кадре | `{"ok":true,"text":"..."}` |

`text` нужен для `<ui.input>` и любых текстовых полей: SDL присылает ввод
событием `SDL_EVENT_TEXT_INPUT`, синтезировать его снаружи нельзя, поэтому
агент дописывает символы прямо в буфер кадра. Игра читает их через
`engine.textInput()` или `$.input.text()`.

```
{"cmd":"text","text":"привет"}
{"cmd":"step","frames":1}
```

`tap` — нажатие ровно на один кадр (на следующий `step`), то есть `keyPressed`
в JS сработает один раз.

Имена клавиш — как в `engine.scancode()` (см. [API.md](API.md), раздел 5):
`"A"`…`"Z"`, `"Space"`, `"Return"`, `"Escape"`, `"Left"`, `"F1"`, `"Left Shift"`…
Неизвестное имя → `{"ok":false,"error":"неизвестная клавиша: X"}`.

Типовой прогон «пройти вправо и прыгнуть»:

```
{"cmd":"keys","hold":["D"]}
{"cmd":"step","frames":60}
{"cmd":"key","key":"Space","action":"tap"}
{"cmd":"step","frames":30}
{"cmd":"keys","hold":[]}
```

### 3.6. Скриншоты

| `cmd` | Параметры | Ответ |
|---|---|---|
| `screenshot` | `path` (строка; относительный путь — от каталога запуска) | `{"ok":true,"path":"...","width":W,"height":H}` |

Команда рисует **один дополнительный кадр**, читает его из swapchain и только
потом отвечает — файл к моменту ответа уже на диске. Формат — PNG.

---

## 4. Клиент на Python

`tools/agent_client.py` — обёртка без внешних зависимостей (только стандартная
библиотека). Класс `Agent` — контекстный менеджер: закрытие соединения
завершает движок.

```python
import os, sys
sys.path.insert(0, "tools")
from agent_client import Agent, ROOT

with Agent(game="demos", scene="platformer", seed=7) as a:
    a.step(30)
    st = a.state()
    x0 = st["player"]["x"]

    a.keys(["D"])                 # удерживать «вправо»
    a.step(60)
    a.keys([])
    assert a.state()["player"]["x"] > x0

    a.key("Space", "tap")         # прыжок
    a.step(20)

    print(a.eval("$.world.count()"))
    a.screenshot(os.path.join(ROOT, "build", "shot.png"))
```

Метод `cmd(name, **params)` — общий: `a.cmd("step", frames=10)`.

### Раннер тестов

```bash
python3 tools/run_tests.py                 # все tests/agent/*_test.py
python3 tools/run_tests.py platformer_test # только указанные (позиционные)
python3 tools/run_tests.py --list          # показать список
python3 tools/run_tests.py --fast          # быстрый набор
R2D_BINARY=build-release/russiano2d python3 tools/run_tests.py
R2D_TEST_TIMEOUT=120 python3 tools/run_tests.py
```

Раннер различает три исхода:

* `ok`   — тест вернул 0 **и** напечатал хотя бы одну проверку `  ok  …`;
* `fail` — ненулевой код или строка `  FAIL …`;
* `skip` — код 0, но проверок не было (нет ассета, нет дисплея и т. п.).
  «Пропуск» — это **не** «зелено».

Лог каждого теста — `build/test_<имя>.log`.

---

## 5. Как это устроено внутри

| Часть | Файл |
|---|---|
| Разбор/сборка JSON, буфер строк | `src/json.c/.h` |
| Протокол, команды, виртуальный ввод | `src/agent.c/.h` |
| Разбор флагов, цикл кадров, скриншот по запросу | `src/main.c` |
| `eval`/`state` в JS-контексте, `engine.setSnapshot` | `src/script.c` |
| Виртуальный ввод в приложении | `src/app.c` |
| Рейкаст и запросы Box2D для `eval` | `src/physics.c` |

---

## 6. Что уже есть в репозитории

| Файл | Что проверяет |
|---|---|
| `tools/agent_client.py` | клиент протокола: `Agent(...)`, `cmd/eval/step/state/key/keys/mouse/screenshot` |
| `tools/run_tests.py` | раннер: гоняет `tests/agent/*_test.py`, различает `ok` / `fail` / `skip` |
| `tests/agent/agent_protocol_test.py` | сам протокол: шаги, детерминизм, `eval`, виртуальный ввод, скриншот, перезапуск |
| `tests/agent/highlevel_api_test.py` | высокоуровневое API `$` на фикстуре `tests/fixtures/hello` |
| `tests/agent/game_test.py` | игра по умолчанию: меню → уровень, ходьба, прыжок, монеты, пауза |
| `tests/agent/demos_test.py` | все демо: сцена открывается, рисуется и не пишет ошибок |
| `tests/agent/build_test.py` | сборка игры в один файл: запуск без проекта, шифрование, защита от подмены |
| `tests/agent/highlevel_*_test.py` | подсистемы `$` по отдельности: `anim`, `tilemap`, `tilemap_ysort`, `particles`, `nav`, `navmesh`, `prefab`, `audiobus`, `layers`, `widgets`, `widgets_anchor`, `tween`, `triggers`, `i18n`, `pool`, `physics`, `http`, `render` |
| `tests/agent/highlevel_guide_test.py` | страж документации: достаёт листинг из `docs/tutorial-first-game.md` и запускает его |
| `tests/js/*_test.mjs` | юнит-тесты логики модулей под `qjs` — без движка и без сборки (18 наборов) |
| `tests/fixtures/*` | маленькие игры для тестов (`hello`, `bare`, `spawn`, `dynimport`, по одной на подсистему) |

```bash
python3 tools/run_tests.py --fast          # быстрый набор (~12 с)
python3 tools/run_tests.py                 # все тесты
python3 tools/run_tests.py demos_test      # только выбранный
python3 tests/agent/demos_test.py light    # тест можно запускать и напрямую

# Логика подсистем без движка: сборка не нужна, секунды
build/_deps/quickjs-build/qjs tests/js/nav_test.mjs
```

## 7. Что игра может рассказать о себе

Низкий уровень отдаёт то, что знает C. Чтобы агент понимал игру, она сама
описывает себя — через высокоуровневое API:

```js
// Поле в снимке состояния: приходит в ответе на {"cmd":"state"}.
$.agent.expose('score', () => score);
$.agent.expose('wave', () => currentWave);

// Полный снимок строится автоматически: кадр, время, сцена, камера, мир,
// список узлов (позиция, здоровье, видимость), игрок, элементы интерфейса.
// Его же видно в ответе на state — поля frame/time дублируются на верхнем
// уровне ответа, поэтому простые проверки не требуют разбора вложенности.

// Самопроверка игры: результаты попадают в снимок (поле tests) и в журнал.
$.test.check($('.enemy').length === 5, 'врагов пятеро');
$.test.equal($('#hero').hp(), 100, 'здоровье целое');
$.test.near(x, 100, 0.5, 'игрок у отметки');
```

Проверки `$.test` печатают строки `  ok  ` / `  FAIL ` в журнал движка
(в агентском режиме это stderr) и складываются в `state.tests`, поэтому их
видно и человеку, и программе.

## 8. Если что-то не работает

| Симптом | Причина и лечение |
|---|---|
| `движок закрыл stdout, ожидание ready` | процесс упал: смотрите stderr, обычно это ошибка загрузки точки входа |
| Ответы приходят, но с мусором перед JSON | кто-то печатает в stdout в обход движка — в агентском режиме stdout должен быть чистым |
| `step` отвечает мгновенно, состояние не меняется | игра могла вызвать `$.time.pause()` или `--realtime` не задан (в агентском режиме кадры идут только по `step`) |
| Скриншот чёрный | кадр не отрисован: проверьте, что прошёл хотя бы один `step`, и что игра рисует что-то в кадре |
| `error: неизвестная клавиша` | имя клавиши не понимает SDL: см. таблицу в [API.md](API.md#5-ввод) |


---

## Сборка игры в один файл

<sub>источник: `docs/BUILD.md`</sub>

# Сборка игры в один файл

Движок умеет собирать проект в **самостоятельный исполняемый файл**: папка с
`main.js` и ассетами больше не нужна рядом с игрой. Сборка встроена в сам
движок — отдельного инструмента нет.

```bash
# Движок лежит там же, где собирался
./build/russiano2d build --project . --entry game/main.js --out mygame

# Запуск: папки проекта рядом нет, всё внутри
./mygame
```

> **macOS: переподпишите собранный файл.** Сборка дописывает груз в копию
> бинарника, и подпись исходного движка перестаёт совпадать:
>
> ```bash
> codesign --force --sign - ./mygame
> ```
>
> Без этого система может отказаться запускать файл («повреждён» или
> «killed: 9»). Сообщение сборки `переподписать не удалось` — это ожидаемое
> поведение, а не ошибка: подпись делается вручную отдельной командой.

Проверить сборку без запуска окна можно в агентском режиме:

```bash
./mygame --agent --headless --fixed-dt 0.0166666667
```

Движок ответит JSON-строками на команды со stdin — так собранную игру
проверяют тесты (см. [AGENT_API.md](AGENT_API.md)).

## Что попадает внутрь

| Слой | Как | Где искать источник |
|---|---|---|
| Скрипты | компилируются в байткод QuickJS по графу `import` от точки входа | `--entry`, по умолчанию `main.js` |
| Ассеты | каталоги `assets/` и каталог точки входа (`game/`) | `--add <путь>` добавляет ещё |
| — | расшифровываются в память при старте | читаются через виртуальную файловую систему |

Известное ограничение: файлы, скрипты которые незаметны для движка (данные
уровней, таблицы, тексты), автоматически не подбираются — их добавляют флагом
`--add`. Перебираются все файлы, кроме `.js` (они и так в байткоде) и служебных
каталогов (`build`, `.git`).

## Своё имя окна и размер

Имя окна, стартовый размер и версию игра описывает сама — файлом
`project.json` рядом с точкой входа (там же, где `main.js`):

```json
{
  "title":   "Моя игра",
  "version": "1.0.0",
  "width":   1600,
  "height":  900
}
```

Все поля необязательны. Этот файл попадает в груз вместе с остальным проектом,
поэтому **собранная игра берёт имя окна оттуда** — движок пересобирать не нужно.

Старшинство при запуске:

| Источник | Когда применяется |
|---|---|
| `--title "…"`, `--width`, `--height` | всегда старше остальных (быстрая проверка) |
| `project.json` проекта | обычный случай |
| значения движка | если ничего не задано: `Russiano2D <версия>`, 1280×720 |

Тот же манифест читается и из груза собранной игры, и с диска при `--game`.

Уже во время игры окно меняется из скриптов — `$.window` (см. `docs/HIGH_LEVEL_API.md`):

```js
$.window.title('Уровень 2');
$.window.fullscreen(true);
$.window.cursor('hidden');
$.window.on('resize', ({ w, h }) => relayout(w, h));
```

## Режимы сборки

**`--append` (по умолчанию).** Билдер копирует движок и приписывает к копии
контейнер с грузом и футер из 128 байт. Компилятор не нужен, работает быстро.
Минус: на macOS дописанные байты ломают подпись, поэтому билдер сам
переподписывает файл ад-хок подписью (`codesign --force --sign -`). Если
переподписать не удалось, команда печатается — выполните её вручную, иначе
система откажется запускать файл.

**`--relink <папка>`.** Билдер генерирует C-файл с грузом, который затем
вкомпилируется в движок:

```bash
./build/russiano2d build --project . --entry game/main.js --relink build-payload
cmake -S . -B build-payload -DR2D_PAYLOAD_FILE=build-payload/r2d_payload_data.c
cmake --build build-payload -j
./build-payload/russiano2d
```

Нужен компилятор и несколько минут, зато получается обычный бинарник: его можно
подписать настоящей подписью разработчика и распространять в сторе.

## Шифрование: что оно даёт и чего не даёт

Груз шифруется **ChaCha20-Poly1305** (RFC 8439). Реализация своя, без внешних
зависимостей; корректность подтверждается тест-векторами стандарта
(`r2d_crypto_selftest`, `tests/agent/build_test.py`). Выбран ChaCha20, а не
AES-256-GCM, потому что он проще в корректной реализации (нет таблиц AES и
GHASH), быстр на ARM и сразу даёт аутентификацию.

**Главное, что нужно понимать: это обфускация, а не защита.** Ключ обязан
лежать в исполняемом файле, поэтому настойчивый исследователь его достанет —
ломают не шифр, а ищут ключ. AES-256 против этого не помогает: математика шифра
не является слабым местом. Что реально сделано:

1. **Шифруется байткод, а не исходники.** Даже после расшифровки читать нечего:
   в байткоде нет ни исходного текста, ни отладочных данных
   (`JS_WRITE_OBJ_STRIP_SOURCE | JS_WRITE_OBJ_STRIP_DEBUG`).
2. **Ключ не лежит в файле целиком.** В футере хранится блок, из которого ключ
   получается вместе с постоянной солью внутри движка: нужно найти и понять оба.
3. **Ключ уникален для каждой сборки** и берётся из системного источника
   случайных чисел (`/dev/urandom`, `BCryptGenRandom`).
4. **Подмена обнаруживается.** Тег Poly1305 считается по грузу; изменение хотя
   бы одного байта приводит к отказу загрузки со словами «файл повреждён или
   подменён», а не к тихой поломке.
5. **Расшифрованное стирается из памяти** при завершении и освобождается
   `r2d_secure_zero`.

Итог: стоимость копирования растёт с «перетащил папку» до «нужен отладчик и
время». Защиты от целенаправленного взлома это не даёт и дать не может —
единственная настоящая защита игровой логики это сервер.

### Включить и выключить

| Платформа | По умолчанию |
|---|---|
| Linux, Windows | **шифрование включено** |
| macOS | **выключено** |
| любая | перебивается флагом |

```bash
russiano2d build --project . --entry mygame/main.js --out mygame           # по умолчанию
russiano2d build ... --encrypt                                            # включить принудительно
russiano2d build ... --no-encrypt                                         # выключить принудительно
```

**Почему на macOS иначе.** Собранный файл на macOS всё равно переподписывают
(`codesign --force --sign - имя`), иначе система откажется его запускать, а
любая правка уже слинкованного бинарника подпись сбрасывает. Поэтому на маке
шифрование по умолчанию выключено, чтобы не делать лишний шаг; когда нужен
именно зашифрованный груз — просто добавь `--encrypt`.

Флаг `--no-encrypt` оставляет только байткод. Смысл в нём есть: размер меньше
(нет накладных расходов шифра и тега) и нет иллюзии защиты.

## Раскладка собранного файла

```
[ байты движка ][ контейнер ][ футер 128 байт ]
```

Футер: магия `R2DF`, версия, смещение и размер контейнера, 12-байтный
одноразовый номер, 16-байтный тег, 32-байтный замаскированный ключ, флаг
шифрования и дубль магии в конце — чтобы обрезанный файл не приняли за
собранную игру.

Контейнер: магия `R2DP`, версия, точка входа, число файлов и сами файлы
(путь, размер, данные). Скрипты лежат байткодом, остальное — как есть.

## Проверка собранной игры

```bash
./mygame --agent --headless --fixed-dt 0.0166666667   # тот же агентский протокол
```

Собранная игра отвечает на все команды протокола (см. `docs/AGENT_API.md`),
поэтому её проверяет тот же раннер: `python3 tools/run_tests.py --fast`.

Автотест сборки: `tests/agent/build_test.py` — собирает игру, проверяет, что
исходников в файле не осталось, что подмена байта ломает запуск и что собранная
игра отвечает на агентские команды.

Тест самого шифра: `./build/tests/r2d_crypto_test` — три вектора RFC 8439 и
круговой прогон на 301 длине под AddressSanitizer и UBSan. Собирается вместе с
движком (`-DR2D_BUILD_TESTS=ON`, по умолчанию включено).

## Частые вопросы

**`не удалось прочитать модуль ...`** — модуль не попал в груз. Билдер собирает
статический граф `import` от точки входа, а затем **дополнительно компилирует все
`.js` каталога точки входа** — именно поэтому динамический
`import('./сцена/index.js')` в собранной игре работает. Не попадут только модули
из других каталогов: их добавляют флагом `--add`, помня, что имя модуля в грузе
должно совпасть с тем, что запрашивает код.

**`no function filename for import()`** — движок собирался со срезанной
отладочной информацией в байткоде. Не срезайте её: без имени модуля QuickJS не
может разрешить динамический импорт. Исходный текст при этом всё равно вырезан
(`JS_WRITE_OBJ_STRIP_SOURCE`).

**`груз: тег не сошёлся`** — файл изменён после сборки (в том числе дописан
вирусом или отредактирован hex-редактором). Соберите заново.

**На macOS игра не запускается после сборки** — не прошла переподпись:
`codesign --force --sign - mygame`.

**Игра запускается, но ассеты «не найдены»** — путь в коде и путь в грузе не
совпали. Движок сверяет по хвосту пути, но если ассет лежит в каталоге, который
билдер не обходил, добавьте его: `--add <каталог>`.


---

## Моя первая игра: платформер с маскотом

<sub>источник: `docs/tutorial-first-game.md`</sub>

# Моя первая игра: платформер с маскотом

За 15 минут — от пустой папки до играбельного уровня, а затем до меню, смены
сцен и сборки в один исполняемый файл. Героиня — зелёноволосая маскот
Russiano2D. Всё построено на одном объекте `$`: без классов и вызовов
`engine.*`.

**Шаг 0** даёт результат за минуту, **шаги 1–12** собирают уровень,
**шаги 13–15** — меню, сцены и сборку. В конце — листинг целиком.

Справочник — [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md); глубже про меню и сцены —
[tutorial-menus.md](tutorial-menus.md); сборка — [BUILD.md](BUILD.md); живой
пример — [`demos/platformer/index.js`](../demos/platformer/index.js).

![Платформер](screenshots/platformer.png)

**План:** 0 hello world · 1 каталог · 2 мир · 3 маскот · 4 ввод · 5 анимация ·
6 платформы · 7 монеты · 8 HUD · 9 камера · 10 смерть и финиш · 11 звук ·
12 сохранение · 13 меню и кнопки · 14 сцены · 15 сборка.

---

## Шаг 0. Hello world: игра за минуту

Создайте `mygame/main.js` и запустите — больше ничего не нужно:

```js
// mygame/main.js — самая маленькая запускаемая игра
$.ready(() => {
    $.world.color('#101820');
    $('<rect>', { id: 'box' }).at(100, 100).size(64, 64)
        .color('#4fd166').appendTo($.world);
    let x = 100, dir = 1;
    $.update(dt => {
        x += dir * 160 * dt;                  // 160 px/с
        if (x > 500) dir = -1;
        if (x < 100) dir = 1;
        $('#box').at(x, 100);
    });
});
```

Запуск: `./build/russiano2d --game mygame`; точка входа — `<каталог>/main.js`,
пути к ассетам — от корня запуска. Камера по умолчанию стоит в `(0, 0)` —
центре окна, поэтому, например, `(5000, 0)` уже за кадром.

**На экране:** тёмный фон, зелёный квадрат едет вправо и обратно.

## Шаг 1. Каталог и запуск

```
mygame/
  project.json     имя окна и стартовый размер
  main.js          вся игра
```

Запуск: `./build/russiano2d --game mygame`; точка входа — `<каталог>/main.js`.
Манифест рядом с ней необязателен:

```json
{ "title": "Моя первая игра", "width": 1280, "height": 720 }
```

Ассеты уже лежат в репозитории движка. **Пути считаются от корня запуска**,
поэтому пишутся целиком: `demos/assets/art/mascot/...` (в сборке — `--add`, шаг 15).

**На экране:** пустое окно с заголовком «Моя первая игра».

## Шаг 2. Мир и гравитация

```js
// mygame/main.js
let coins = [], animState = '';
let score = 0, collected = 0, lives = 3, won = false;
const W = 1920, DEATH_Y = 420, SPAWN = { x: 0, y: 150 };
$.ready(() => {
    $.world.gravity(0, 2000).color('#5fcde4');   // «вниз» — положительное Y
});
```

`$.ready` вызывается один раз, на первом кадре: `$` уже готов. `$.update(fn)`
выполняется каждый кадр, `fn(dt, $)`.

**На экране:** однотонный голубой фон — мир пока пуст.

## Шаг 3. Маскот: лист кадров

Лист маскота — 8×4 кадров по 176×176; номер кадра `строка * 8 + столбец`.
Строки — состояния: 0 покой, 1 ходьба, 2 прыжок и полёт.

```js
const MASCOT = {
    src: 'demos/assets/art/mascot/russiano_mascot_sheet.png',
    cols: 8, rows: 4, cw: 176, ch: 176,
};
const ANIM = {
    idle: { from: 0,  to: 3,  speed: 5,  loop: true },   // ряд 0
    walk: { from: 8,  to: 13, speed: 13, loop: true },   // ряд 1
    air:  { from: 21, to: 23, speed: 9,  loop: true },   // ряд 2
};
function buildHero() {
    return $('<player>', { id: 'hero' })
        .at(SPAWN.x, SPAWN.y)
        .size(48, 64)          // как рисуется
        .collision(28, 56)     // хитбокс: тело пересоздаётся под него
        .health(100)
        .frames(MASCOT)        // задать лист
        .animate(ANIM.idle)    // и запустить анимацию
        .appendTo($.world);
}
// в $.ready: buildHero();
```

`.frames({ src, cols, rows, cw, ch })` запоминает кадры, `.frame(n)` показывает
один, `.animate({ from, to, speed, loop })` листает диапазон.

**На экране:** маскот стоит на земле, кадры покоя сменяются — она «дышит».

## Шаг 4. Ввод и управление

Проще всего отдать управление движку — добавьте в цепочку `buildHero()`:

```js
        .controls({ axis: 'both', jump: 'space' })
```

Движок сам читает WASD и стрелки, двигает тело и прыгает по Space/W/↑, только
когда узел на земле. Свой контроллер пишется тоже коротко:

```js
$.update(dt => {
    const v = $.input.vec('both');                 // { x, y }, -1..1
    $('#hero').velocity(v.x * 250, $('#hero').velocity().y);
    if ($.input.pressed('space') && $('#hero').onFloor()) $('#hero').jump(640);
});
```

`$.input.down('a')` — клавиша удерживается, `.pressed('space')` — нажата в этом
кадре. Имена человеческие: `'space'`, `'a'`, `'left'`, `'escape'`.

**На экране:** маскот ходит влево-вправо и прыгает; падает обратно на землю.

## Шаг 5. Анимация по состояниям

Держите состояние в переменной и меняйте клип листа только при переключении:

```js
$.update(() => {
    const hero = $('#hero');
    const v = hero.velocity();
    const state = !hero.onFloor() ? 'air' : (Math.abs(v.x) > 20 ? 'walk' : 'idle');
    if (state !== animState) {
        animState = state;
        hero.animate(ANIM[state]);       // покой / ходьба / полёт
    }
    hero.flip(v.x < -10, false);         // смотрит туда, куда бежит
});
```

`.velocity()` без аргументов читает `{ x, y }`, `.onFloor()` — луч вниз,
`.flip(true, false)` отражает картинку по X.

**На экране:** на ходу включается ходьба, в прыжке — кадры полёта, маскот
разворачивается по направлению движения.

## Шаг 6. Платформы: `<wall>` и `<tilemap>`

`<wall>` — статичный прямоугольник. Соберём землю с ямой и четыре платформы:

```js
const PLATFORMS = [
    [360, 200, 720, 40],  [1560, 200, 720, 40],   // земля: две половины, между ними яма
    [420, 100, 180, 24],  [960, 100, 220, 24],
    [1320, 100, 180, 24], [1680, 100, 200, 24],
];
function buildLevel() {
    for (const [x, y, w, h] of PLATFORMS) {
        $('<wall>').at(x, y).size(w, h).color('#2a3240').appendTo($.world);
    }
}
// в $.ready: buildLevel();
```

`.at(x, y)` — центр узла, `.size(w, h)` — размер. Если платформ много, уровень
удобнее рисовать текстом: `<tilemap>` — один узел на весь уровень.

```js
const LEVEL = [
    '................',
    '.......###......',
    '................',
    '####........####',
    '####........####',
];
$.tilemap.fromASCII(LEVEL, { '#': 1, '.': 0 }, {
    src: 'demos/assets/tiles/platformer_tileset_16x16.png',
    tile: 16,          // размер клетки в мире = клетке тайлсета
    cols: 16,          // сколько тайлов в строке текстуры
    solid: true,       // тайлы 1 непроходимы, id 0 — пусто
}).at(400, 200);       // x/y — центр карты
```

После создания карту правят `.setTile()`, `.tileSize()`, `.autotile()`,
`.rebuild()`.

**На экране:** земля и парящие платформы; маскот стоит на них, а в яму падает.

## Шаг 7. Монеты и событие подбора

Монета — обычный узел. Подбор оформим событием `pickup`: подписка и проверка
расстояния не знают друг о друге.

```js
const COINS = [[200, 130], [420, 40], [560, 130], [960, 40],
               [1200, 130], [1320, 40], [1680, 40], [1820, 130]];
function buildCoins() {
    coins = COINS.map(([x, y]) => $('<sprite>', { class: 'coin' })
        .at(x, y).size(22, 22).color('#ffd54a')
        .on('pickup', e => {
            e.self.data('taken', true).hide();   // монета исчезает
            collected++;
            score += 10;
            $.sound.play(SFX.pickup, { volume: 0.8 });
        })
        .appendTo($.world));
}
// в $.ready: buildCoins();
$.update(() => {
    for (const c of coins) {
        if (c.data('taken')) continue;
        if (c.distanceTo('#hero') < 32) c.emit('pickup');
    }
});
```

`e.self` — обёртка узла-источника, `.data(key, value)` — хранилище на узле,
`.distanceTo('#hero')` — расстояние в px. Монеты прячутся, а не удаляются.

**На экране:** маскот касается монет, они пропадают со звуком.

## Шаг 8. Счёт и HUD

Узлы `<ui.*>` рисуются в координатах окна: камера на них не влияет, в мир они
не попадают. `x`/`y` — центр узла, у `ui.label` текст идёт от него вправо,
а `align: 'center'` центрирует.

```js
function buildHud() {
    const s = $.window.size();          // { w, h } текущего окна
    $('<ui.bar>', { id: 'hp', value: 100, max: 100 })
        .at(140, 34).size(220, 16).appendTo($.ui);
    $('<ui.label>', { id: 'score', text: 'Очки: 0', size: 20, color: '#ffd54a' })
        .at(24, 72).appendTo($.ui);
    $('<ui.label>', { id: 'coins', text: 'Монеты: 0/8', size: 20 })
        .at(24, 100).appendTo($.ui);
    $('<ui.label>', { id: 'hint', text: 'A/D или ←/→ — идти · Space — прыжок',
                       size: 16, color: '#8fa3bf' })
        .at(24, s.h - 30).appendTo($.ui);
}
// в $.ready: buildHud();
function refreshHud() {
    $.ui.bar('#hp', $('#hero').hp(), 100);
    $.ui.label('#score', 'Очки: ' + score);
    $.ui.label('#coins', 'Монеты: ' + collected + '/' + coins.length);
}
// в $.update: refreshHud();
```

`$.ui.bar(sel, value, max)` и `$.ui.label(sel, text)` массово правят найденные
узлы. Размер шрифта — поле `size` у `ui.label` (не метод `.size()`).

**На экране:** слева сверху полоса здоровья, очки и счётчик монет.

## Шаг 9. Камера

```js
$.camera.follow('#hero', { smooth: 0.2, offset: [0, -60], zoom: 1.5 })
    .limits(-100, -250, W + 200, 800);   // в $.ready, после buildHero()
```

`.limits(...)` не даёт камере уехать за уровень, `smooth` — мягкость слежения,
`offset` — сдвиг кадра, `zoom` — масштаб. Камеру не двигайте руками: тряску
даёт `$.camera.shake(8, 250)`.

**На экране:** кадр едет за маскотом и упирается в края уровня.

## Шаг 10. Смерть, респавн и финиш

Яма — это смерть. Монеты спрятаны, а не удалены, поэтому рестарт уровня — это
вернуть их и обнулить счётчики.

```js
function restartLevel() {
    lives = 3; score = 0; collected = 0; won = false;
    for (const c of coins) c.data('taken', false).show();
}
function fallDown() {
    if (won) return;
    $.sound.play(SFX.hurt, { volume: 0.8 });
    $.camera.shake(8, 250);
    lives--;
    if (lives <= 0) restartLevel();
    $('#hero').respawn(SPAWN.x, SPAWN.y);   // на старт и с полным здоровьем
}
$.update(() => {
    if ($('#hero').pos().y > DEATH_Y) fallDown();
    if (!won && collected === coins.length) {
        won = true;
        score += 100;
        $.store.set('best', Math.max($.store.get('best', 0), score));
        $.store.save();
    }
});
```

`.respawn(x, y)` телепортирует узел и восстанавливает здоровье, `.pos()` —
позиция, `.hp()` — текущее здоровье. О гибели от врагов расскажет событие:
`$('#hero').on('death', () => $.log('маскот погиб'))`.

**На экране:** падение в яму возвращает маскота на старт; когда собраны все
монеты — уровень пройден (в шаге 14 это отдельная сцена).

## Шаг 11. Звук

Расширение можно не писать: движок сам ищет `.wav`, `.ogg`, `.mp3`, `.flac`.

```js
const SFX = {
    jump:   'demos/assets/audio/sfx/jump_01.ogg',
    pickup: 'demos/assets/audio/sfx/pickup_01.ogg',
    hurt:   'demos/assets/audio/sfx/hurt_01.ogg',
};
// в $.ready:
$('#hero').on('jump', () => $.sound.play(SFX.jump, { volume: 0.7 }));
$.sound.volume(0.8);
$.sound.music('demos/assets/audio/music/action.ogg', { loop: true, volume: 0.4 });
```

Событие `jump` движок шлёт сам при прыжке. Для звука от объекта есть
`$.sound.playAt('boom.ogg', '#hero', { max: 700 })` — панорама и затухание
считаются от камеры.

**На экране:** играет музыка, прыжок и подбор монеты звучат.

## Шаг 12. Сохранение прогресса

```js
$.store.file('save.json').load();   // прочитать прошлое сохранение
$.store.set('best', score);         // записать рекорд
$.store.save();                     // сохранить прямо сейчас
$.store.get('best', 0);             // прочитать (0 — если записи нет)
$.store.autoSave(30000);            // писать раз в 30 с, если что-то менялось
```

Путь считается от корня запуска. Для своих файлов рядом есть `$.fs`:
`$.fs.readJSON('data/levels.json', {})`, `$.fs.write('log.txt', 'текст')`.

`autoSave` заводит таймер, а смена сцены их очищает: вызывайте его в `enter`
сцены уровня (шаг 14), а не в `$.ready`. Последний шанс — `$.exit(() => $.store.save())`.

**На экране:** после перезапуска в HUD виден прошлый рекорд.

## Шаг 13. Меню: заголовок и кнопки

Интерфейс можно делать двумя способами:

| Путь | Когда выбирать |
|---|---|
| Узлы `<ui.panel>`, `<ui.label>`, `<ui.button>` | Экран целиком на `$`: работает без файлов, виден агенту и попадает на скриншот |
| RmlUi-документ `$.ui.doc('...rml')` | Сложная вёрстка со стилями: меню, настройки, инвентарь |

**Путь А — узлы.** Меню без единого файла разметки:

```js
function buildMenu() {
    const s = $.window.size();
    $('<ui.panel>', { x: s.w / 2, y: s.h / 2, w: s.w, h: s.h, color: '#0b1220ee' })
        .appendTo($.ui);
    $('<ui.label>', { id: 'title', text: 'МАСКОТ И МОНЕТЫ', size: 48,
                      color: '#7fd1ff', align: 'center' })
        .at(s.w / 2, s.h * 0.3).appendTo($.ui);
    $('<ui.button>', { id: 'btn-play', text: 'Играть', x: s.w / 2, y: s.h * 0.5 })
        .appendTo($.ui).on('click', () => $.scene.load('level'));
    $('<ui.button>', { id: 'btn-quit', text: 'Выход', x: s.w / 2, y: s.h * 0.5 + 70 })
        .appendTo($.ui).on('click', () => $.quit());
}
```

**Путь Б — RmlUi.** Создайте `mygame/ui/menu.rml` (стили — прямо в файле):

```xml
<rml>
<head>
    <title>Меню</title>
    <style>
        body { font-family: Noto Sans; font-size: 20px; color: #eef2f8;
               background-color: rgba(11, 18, 32, 238); width: 100%; height: 100%; }
        #menu { display: block; width: 520px; margin-left: auto; margin-right: auto;
                margin-top: 130px; text-align: center; }
        h1 { font-size: 46px; color: #7fd1ff; margin-bottom: 30px; }
        button { display: block; width: 320px; margin-left: auto; margin-right: auto;
                 margin-top: 12px; margin-bottom: 12px; padding: 14px; font-size: 20px;
                 color: #0d1220; background-color: #7fd1ff; border-width: 0px;
                 border-radius: 8px; text-align: center; }
        button:hover { background-color: #a9e0ff; }
    </style>
</head>
<body>
    <div id="menu">
        <h1>МАСКОТ И МОНЕТЫ</h1>
        <button id="btn-play">Играть</button>
        <button id="btn-quit">Выход</button>
    </div>
</body>
</rml>
```

```js
this.doc = $.ui.doc('mygame/ui/menu.rml')      // метод называется doc(), не load()
    .on('btn-play', 'click', () => $.scene.load('level'))
    .on('btn-quit', 'click', () => $.quit())
    .show();
// в exit сцены: if (this.doc) this.doc.hide();
```

Путь к документу — от корня проекта, поэтому `mygame/ui/menu.rml`, а не
`ui/menu.rml`. Слушатели RmlUi не снимаются при смене сцены, поэтому
`$.ui.doc()` кэширует документ и повторную подписку пропускает.

**Кнопки.** `hover`/нажатие у `ui.button` рисует движок; `click` приходит и от
мыши, и с клавиатуры: `Tab`/`Shift+Tab` — фокус, `Enter`/`Space` — нажать.
Программно: `$.ui.focus('#btn-play')` и `$.ui.focusedId()`.

**На экране:** затемнённый экран, заголовок и две кнопки; «Играть» ведёт на
уровень, «Выход» закрывает игру.

## Шаг 14. Сцены: меню → уровень → победа

```js
$.scene.add('level', {
    enter($)  { /* построить мир */ },
    exit()    { /* убрать за собой */ },
    update(dt, $) { /* логика кадра */ },
    render($) { /* необязательно: своя отрисовка */ },
});
$.scene.add('intro', ($) => { /* сцена-функция: это её enter */ });
```

```js
$.scene.load('level');                            // с переходом-fade (300 мс по умолчанию)
$.scene.load('level', { transition: 'none' });    // мгновенно
$.scene.load('level', { transition: 'fade', ms: 500 });
$.scene.transition('fade', 250);                  // сменить переход по умолчанию
$.scene.restart();                                // перезапустить текущую
$.scene.current() / .names() / .busy()            // что сейчас, что есть, идёт ли переход
```

Смена сцены **отложена на начало следующего кадра**, поэтому её можно вызывать
прямо из обработчика клика. При смене мир очищается (узлы, тела, твины,
таймеры), сцена получает `exit()`.

Стек — для паузы и оверлеев:

```js
$.scene.push('pause');   // запомнить текущую и открыть паузу
$.scene.pop();           // вернуться к запомненной
$.scene.stack();         // ['level']
$.scene.add('pause', {
    enter($) { $.time.pause(); /* показать оверлей */ },
    exit()   { $.time.resume(); },
    update(dt, $) { if ($.input.pressed('escape')) $.scene.pop(); },
});
// из уровня: if ($.input.pressed('escape')) $.scene.push('pause');
```

`push`/`pop` — обычные `load`, поэтому мир под паузой тоже очищается, и после
возврата уровень начинается заново. Если мир нужно сохранить — делайте паузу
оверлеем: `$.time.pause()` плюс скрытые узлы `<ui.*>`.

`$.update(fn)` — **глобальный** и работает во всех сценах сразу: логику уровня
перенесите в `update(dt, $)` сцены `level`, иначе она тикает и в меню. Цикл
`menu → level → win → menu` из трёх сцен:

```js
// menu: кнопка/Enter
$.scene.load('level');
// level: собрали все монеты
score += 100;
$.store.set('best', Math.max($.store.get('best', 0), score));
$.store.save();
$.scene.load('win');
// win: кнопка «В меню»/Enter
$.scene.load('menu');
```

**На экране:** «Играть» → fade → уровень; победа → fade → экран победы;
«В меню» → fade → меню.

## Шаг 15. Сборка в один файл

Сборка встроена в движок. Команда выполняется **из корня движка** — там, где
лежит `build/russiano2d`:

```bash
# 1. Собрать. --project — корень проекта (отсюда считаются пути в грузе),
#    --entry — точка входа относительно корня, --out — имя файла.
./build/russiano2d build --project . --entry mygame/main.js --out mascot-game
# 2. macOS: переподписать (см. ниже)
codesign --force --sign - ./mascot-game
# 3. Запустить: папки проекта рядом нет, всё внутри
./mascot-game
```

Наш код ссылается на ассеты демо (`demos/assets/...`). Автоматически в груз
попадают только каталог `assets/` и каталог точки входа (`mygame/`), поэтому
демо-ассеты добавляем явно, иначе после сборки они «не найдутся»:

```bash
./build/russiano2d build --project . --entry mygame/main.js --out mascot-game \
    --add demos/assets
```

`--out` — это имя **файла**, и оно не должно совпадать с именем папки проекта
(`mygame`): иначе сборка скажет `не удалось записать mygame`. Назовите файл
иначе (здесь `mascot-game`) или саму папку проекта — иначе.

Посмотреть, что попадёт в груз, ничего не записывая:

```bash
./build/russiano2d build --project . --entry mygame/main.js --out mascot-game --list
```

**Что внутри.** Файл — движок плюс контейнер `R2DP` и футер `R2DF`: скрипты —
байткод QuickJS по графу `import`, ассеты — как есть, груз зашифрован
ChaCha20-Poly1305 (обфускация, не защита; `--no-encrypt` выключает).
`project.json` попадает в груз всегда — оттуда собранная игра берёт имя окна.

**macOS: переподпишите собранный файл.** Сборка дописывает груз в копию
бинарника, и подпись исходного движка перестаёт совпадать:

```bash
codesign --force --sign - ./mascot-game
```

Без этого система может отказаться запускать файл («повреждён» или `killed: 9`).
Сообщение сборки про неудачную переподпись — ожидаемое: подпись делается вручную.

**Проверка без окна** — тот же агентский протокол, что у обычного запуска:

```bash
./mascot-game --agent --headless --fixed-dt 0.0166666667
```

**Если команда не сработала:**

* `нет файла ...` — `--entry` указан неверно или относительно не того корня.
  Путь всегда от `--project`.
* `нашлось несколько main.js — укажите --entry` — уберите неоднозначность.
* `неизвестная опция` — сверьтесь с `./build/russiano2d build --help`.
* `не удалось записать mygame` — `--out` совпал с папкой проекта; выберите
  другое имя файла.
* Режим `--relink <папка>` генерирует C-файл с грузом, который затем
  вкомпилируется в движок через cmake: нужен компилятор и несколько минут,
  зато получается обычный бинарник для подписи настоящим сертификатом.

**На экране:** при запуске `./mascot-game` (папки проекта рядом нет) игра стартует
с меню и работает так же, как при `--game mygame`.

## Полный листинг `mygame/main.js`

Меню, уровень, монеты, HUD, победа и сохранение — один файл, копируется
целиком. Замените только путь к маскоту, если положите его в свой проект.

```js
// mygame/main.js — игра целиком. Запуск: ./build/russiano2d --game mygame
// Сборка: ./build/russiano2d build --project . --entry mygame/main.js --out mascot-game --add demos/assets
// На macOS: codesign --force --sign - ./mascot-game; запуск сборки: ./mascot-game
const W = 1920, DEATH_Y = 420, SPAWN = { x: 0, y: 150 };
const MUSIC_MENU = 'demos/assets/audio/music/menu.ogg';
const MUSIC_LEVEL = 'demos/assets/audio/music/action.ogg';
const MASCOT = { src: 'demos/assets/art/mascot/russiano_mascot_sheet.png',
                 cols: 8, rows: 4, cw: 176, ch: 176 };
const ANIM = {
    idle: { from: 0,  to: 3,  speed: 5,  loop: true },
    walk: { from: 8,  to: 13, speed: 13, loop: true },
    air:  { from: 21, to: 23, speed: 9,  loop: true },
};
const SFX = {
    jump:   'demos/assets/audio/sfx/jump_01.ogg',
    pickup: 'demos/assets/audio/sfx/pickup_01.ogg',
    hurt:   'demos/assets/audio/sfx/hurt_01.ogg',
};
const PLATFORMS = [
    [360, 200, 720, 40], [1560, 200, 720, 40],
    [420, 100, 180, 24], [960, 100, 220, 24],
    [1320, 100, 180, 24], [1680, 100, 200, 24],
];
const COINS = [[200, 130], [420, 40], [560, 130], [960, 40],
               [1200, 130], [1320, 40], [1680, 40], [1820, 130]];
let coins = [], animState = '';
let score = 0, collected = 0, lives = 3, won = false;
function buildLevel() {
    for (const [x, y, w, h] of PLATFORMS) {
        $('<wall>').at(x, y).size(w, h).color('#2a3240').appendTo($.world);
    }
}
function buildHero() {
    return $('<player>', { id: 'hero' })
        .at(SPAWN.x, SPAWN.y).size(48, 64).collision(28, 56).health(100)
        .controls({ axis: 'both', jump: 'space' })
        .frames(MASCOT).animate(ANIM.idle)
        .on('jump', () => $.sound.play(SFX.jump, { volume: 0.7 }))
        .appendTo($.world);
}
function buildCoins() {
    coins = COINS.map(([x, y]) => $('<sprite>', { class: 'coin' })
        .at(x, y).size(22, 22).color('#ffd54a')
        .on('pickup', e => {
            e.self.data('taken', true).hide();
            collected++;
            score += 10;
            $.sound.play(SFX.pickup, { volume: 0.8 });
        })
        .appendTo($.world));
}
function buildHud() {
    const s = $.window.size();
    $('<ui.bar>', { id: 'hp', value: 100, max: 100 })
        .at(140, 34).size(220, 16).appendTo($.ui);
    $('<ui.label>', { id: 'score', text: 'Очки: 0', size: 20, color: '#ffd54a' })
        .at(24, 72).appendTo($.ui);
    $('<ui.label>', { id: 'coins', text: 'Монеты: 0/8', size: 20 })
        .at(24, 100).appendTo($.ui);
    $('<ui.label>', { id: 'hint', text: 'A/D или ←/→ — идти · Space — прыжок',
                       size: 16, color: '#8fa3bf' })
        .at(24, s.h - 30).appendTo($.ui);
}
function refreshHud() {
    $.ui.bar('#hp', $('#hero').hp(), 100);
    $.ui.label('#score', 'Очки: ' + score);
    $.ui.label('#coins', 'Монеты: ' + collected + '/' + coins.length);
}
function restartLevel() {
    lives = 3; score = 0; collected = 0; won = false;
    for (const c of coins) c.data('taken', false).show();
}
function fallDown() {
    if (won) return;
    $.sound.play(SFX.hurt, { volume: 0.8 });
    $.camera.shake(8, 250);
    lives--;
    if (lives <= 0) restartLevel();
    $('#hero').respawn(SPAWN.x, SPAWN.y);
}
function buildMenu() {
    const s = $.window.size();
    $('<ui.panel>', { x: s.w / 2, y: s.h / 2, w: s.w, h: s.h, color: '#0b1220ee' })
        .appendTo($.ui);
    $('<ui.label>', { id: 'title', text: 'МАСКОТ И МОНЕТЫ', size: 48,
                      color: '#7fd1ff', align: 'center' })
        .at(s.w / 2, s.h * 0.3).appendTo($.ui);
    $('<ui.button>', { id: 'btn-play', text: 'Играть', x: s.w / 2, y: s.h * 0.5 })
        .appendTo($.ui).on('click', () => $.scene.load('level'));
    $('<ui.button>', { id: 'btn-quit', text: 'Выход', x: s.w / 2, y: s.h * 0.5 + 70 })
        .appendTo($.ui).on('click', () => $.quit());
}
$.ready(() => {
    $.sound.volume(0.8);
    $.store.file('save.json').load();
    $.scene.transition('fade', 250);
    $.scene.add('menu', {
        enter($) {
            buildMenu();
            $.sound.music(MUSIC_MENU, { loop: true, volume: 0.4 });
        },
        exit() { $.sound.stopMusic(300); },
        update(dt, $) {
            if ($.input.pressed('enter') || $.input.pressed('space')) $.scene.load('level');
            if ($.input.pressed('escape')) $.quit();
        },
    });
    $.scene.add('level', {
        enter($) {
            score = 0; collected = 0; lives = 3; won = false; animState = '';
            $.store.autoSave(30000);
            $.world.gravity(0, 2000).color('#5fcde4');
            buildLevel();
            buildCoins();
            buildHero();
            buildHud();
            $.camera.follow('#hero', { smooth: 0.2, offset: [0, -60], zoom: 1.5 })
                .limits(-100, -250, W + 200, 800);
            $.sound.music(MUSIC_LEVEL, { loop: true, volume: 0.4 });
        },
        exit() { $.sound.stopMusic(300); },
        update(dt, $) {
            const h = $('#hero'), v = h.velocity();
            const state = !h.onFloor() ? 'air' : (Math.abs(v.x) > 20 ? 'walk' : 'idle');
            if (state !== animState) { animState = state; h.animate(ANIM[state]); }
            h.flip(v.x < -10, false);
            for (const c of coins) {
                if (c.data('taken')) continue;
                if (c.distanceTo('#hero') < 32) c.emit('pickup');
            }
            refreshHud();
            if (h.pos().y > DEATH_Y) fallDown();
            if (!won && collected === coins.length) {
                won = true;
                score += 100;
                $.store.set('best', Math.max($.store.get('best', 0), score));
                $.store.save();
                $.scene.load('win');
            }
        },
    });
    $.scene.add('win', {
        enter($) {
            const s = $.window.size();
            $('<ui.panel>', { x: s.w / 2, y: s.h / 2, w: s.w, h: s.h, color: '#0b1220ee' })
                .appendTo($.ui);
            $('<ui.label>', { id: 'win-title', text: 'Уровень пройден!', size: 44,
                              color: '#ffd54a', align: 'center' })
                .at(s.w / 2, s.h * 0.35).appendTo($.ui);
            $('<ui.label>', { id: 'win-score',
                              text: 'Очки: ' + score + ' · Рекорд: ' + $.store.get('best', 0),
                              size: 22, align: 'center' })
                .at(s.w / 2, s.h * 0.46).appendTo($.ui);
            $('<ui.button>', { id: 'win-menu', text: 'В меню', x: s.w / 2, y: s.h * 0.6 })
                .appendTo($.ui).on('click', () => $.scene.load('menu'));
        },
        update(dt, $) {
            if ($.input.pressed('enter') || $.input.pressed('space') ||
                $.input.pressed('escape')) $.scene.load('menu');
        },
    });
    $.scene.load('menu', { transition: 'none' });
});
$.exit(() => $.store.save());
```

## Частые вопросы

**Пустое окно, ничего не происходит.** Сцена не загружена или загружена не та:
`$.scene.load('menu', { transition: 'none' })` должен идти после всех
`$.scene.add(...)`, а имя — совпадать. Если сцена «неизвестна», в журнале будет
`$: неизвестная сцена "..."`. Ещё вариант: узлы созданы, но не добавлены —
у мировых узлов нужен `.appendTo($.world)`, у интерфейса `.appendTo($.ui)`.

**Ассеты не найдены.** Путь в коде должен совпадать с путём от корня запуска:
`demos/assets/art/mascot/russiano_mascot_sheet.png`, не `art/...` и не
`assets/...`. Проверить можно из игры: `$.fs.exists('demos/assets/...')` и
`$.gfx.textureSize('demos/assets/...')` (вернёт `[w, h]`). После сборки — та же
ошибка: забудьте `--add demos/assets`, и ассетов в грузе не будет.

**Кнопка не реагирует.** Кнопка должна быть добавлена в интерфейс
(`.appendTo($.ui)`), быть видимой и не перекрытой другим `ui.panel` (рисуются в
порядке создания — фон создавайте первым). У RmlUi-меню — `.show()` у документа
и `.on('btn-play', 'click', ...)`. Проверить фокус: `$.ui.focusedId()`, поставить
`$.ui.focus('#btn-play')`; `Tab` и `Enter` работают и без мыши.

**Сцена не переключается.** Переход отложен и идёт ~300 мс: `$.scene.load()`
только ставит запрос, реальная замена — в начале следующего кадра. Смотрите
`$.scene.current()` и `$.scene.busy()`. Имя должно быть зарегистрировано
`$.scene.add()` **до** `load()`.

**После сборки не запускается.** На macOS переподпишите:
`codesign --force --sign - ./mascot-game`; сообщение сборки про переподпись —
ожидаемое. `груз: тег не сошёлся` означает, что файл изменили после сборки —
соберите заново. `не удалось прочитать модуль ...` — модуль не попал в груз:
динамический `import()` из другого каталога добавляют через `--add`.

**Где смотреть ошибки.** Ошибки игрового кода уходят в журнал движка (терминал,
откуда запущена игра) со стеком; своё сообщение пишет `$.log('текст')`.
Оверлей с FPS и статистикой — клавиша `F1`, флаг `--overlay` или
`$.debug.on()`; свои значения выводят `$.debug.watch('hp', () => $('#hero').hp())`.
В консоль движка можно добавить команду: `$.console.register('win', () => ...)`.
В агентском режиме хвост ошибок отдаёт `stderr_tail` (см. [AGENT_API.md](AGENT_API.md)).

## Что дальше

* [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md) — всё, что умеет `$`: селекторы,
  физика, события, твины, сцены, интерфейс, окно и время; [API.md](API.md) —
  низкий уровень: батчинг, тела, BSP, свет, RmlUi.
* [tutorial-menus.md](tutorial-menus.md) — меню, пауза и переходы подробнее;
  [tutorial-platformer.md](tutorial-platformer.md) — платформер с врагами и
  проверкой агентом; [BUILD.md](BUILD.md) — сборка, шифрование, `--relink`.
* [AGENT_API.md](AGENT_API.md) — прогон игры программой; [demos.md](demos.md) —
  демо-проект и живые примеры.
* Подсистемы `$` — [docs/highlevel](highlevel/): [anim](highlevel/anim.md), [tilemap](highlevel/tilemap.md),
  [particles](highlevel/particles.md), [nav](highlevel/nav.md), [prefab](highlevel/prefab.md), [audio](highlevel/audiobus.md),
  [layers](highlevel/layers.md), [widgets](highlevel/widgets.md), [tween](highlevel/tween.md), [pool](highlevel/pool.md),
  [triggers](highlevel/triggers.md), [i18n](highlevel/i18n.md).


---

## Туториал: первая игра на `$`

<sub>источник: `docs/tutorial-platformer.md`</sub>

# Туториал: первая игра на `$`

От пустого каталога до играбельного платформера. За основу взята рабочая игра
из [`game/`](../game) — здесь мы разберём её по частям и объясним решения.

Справочник по всем вызовам — [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md).

- [Что получится](#что-получится)
- [Шаг 1. Каталог игры](#шаг-1-каталог-игры)
- [Шаг 2. Первый экран](#шаг-2-первый-экран)
- [Шаг 3. Игрок](#шаг-3-игрок)
- [Шаг 4. Уровень из ASCII](#шаг-4-уровень-из-ascii)
- [Шаг 5. Враги и монеты](#шаг-5-враги-и-монеты)
- [Шаг 6. HUD на узлах интерфейса](#шаг-6-hud-на-узлах-интерфейса)
- [Шаг 7. Сцены: меню и уровень](#шаг-7-сцены-меню-и-уровень)
- [Шаг 8. Сохранения](#шаг-8-сохранения)
- [Как это проверять без рук](#как-это-проверять-без-рук)

---

## Что получится

Платформер: персонаж ходит и прыгает, собирает монеты, враги патрулируют и
бьют при касании, есть HUD, пауза, победа и возврат в меню. Всё это — на одном
объекте `$`, без классов и без вызовов `engine.*`.

---

## Шаг 1. Каталог игры

```
mygame/
  main.js          точка входа
  scenes/
    menu.js
    level.js
```

Запуск: `./build/russiano2d --game mygame`, точка входа — `<каталог>/main.js`.
Пути к ассетам считаются от корня запуска (там, где лежат `game/` и `assets/`),
поэтому свой файл пишется как `mygame/assets/hero.png`.

## Шаг 2. Первый экран

```js
// mygame/main.js
$.ready(($) => {
    $.gfx.color('#141824');           // фон кадра
    $.world.gravity(0, 1800);         // «вниз» — положительное Y

    $('<player>', { id: 'hero' })
        .at(200, 300)
        .appendTo($.world);

    $.camera.follow('#hero');
});
```

`$.ready` вызывается один раз, на первом кадре: `$` уже готов, мир пуст.
Больше ничего писать не нужно — движок сам вызывает `onUpdate`/`onRender`, а `$`
внутри них обновляет твины, камеру, анимации и отрисовывает мир.

## Шаг 3. Игрок

```js
$('<player>', { id: 'hero' })
    .at(200, 300)
    .size(26, 30)              // размер и хитбокс
    .health(100)
    .controls('both')          // WASD и стрелки; прыжок по Space/W/↑
    .collision(26, 30)         // тело пересоздаётся под этот прямоугольник
    .attr({ jumpForce: 700 })
    .sprite({ src: 'assets/atlas.png', cols: 4, rows: 1, cw: 32, ch: 32 })
    .frame(0)
    .appendTo($.world)
    .on('hit', e => $.camera.shake(5, 200))
    .on('death', () => console.log('игрок погиб'));
```

Что здесь важно:

* `.controls('both')` — встроенное управление: движок читает ввод через
  `$.input.vec('both')`, сам ставит скорость телу и прыгает по Space
  (только если `onFloor()` истинно).
* `.sprite({...})` с объектом — это **лист**: задаёт и текущий кадр, и набор
  кадров для `.frame(n)` и `.animate(...)`.
* Каждый вызов возвращает обёртку, поэтому цепочка не прерывается.

Если нужен свой контроллер — не вызывайте `.controls()` и работайте с
`$.input` напрямую:

```js
$.update(dt => {
    const v = $.input.vec('wasd');
    $('#hero').velocity(v.x * 240, $('#hero').velocity().y);
    if ($.input.pressed('space') && $('#hero').onFloor()) $('#hero').jump(700);
});
```

## Шаг 4. Уровень из ASCII

Уровень удобно держать текстом: одна клетка — тайл 32×32.

```js
const TILE = 32;
const LEVEL = [
    '..........o.....',
    '.......####.....',
    '..P.............',
    '#####.....####..',
];

$.ready(($) => {
    $.world.bounds(-64, -64, LEVEL[0].length * TILE + 128, LEVEL.length * TILE + 128);

    LEVEL.forEach((row, ty) => {
        for (let tx = 0; tx < row.length; tx++) {
            const x = tx * TILE + TILE / 2;
            const y = ty * TILE + TILE / 2;
            const cell = row[tx];

            if (cell === '#') {
                $('<wall>').at(x, y).size(TILE, TILE).appendTo($.world);
            } else if (cell === 'o') {
                $('<sprite>', { class: 'coin' }).at(x, y).size(18, 18).appendTo($.world);
            } else if (cell === 'P') {
                $('<player>', { id: 'hero' }).at(x, y).controls('both').appendTo($.world);
            }
        }
    });
});
```

`$.world.bounds(...)` ставит четыре статические стены по краям — из мира нельзя
выпасть. Служебные стены носят класс `world-bound` и не попадают в
`$.world.count()`.

## Шаг 5. Враги и монеты

Враг — обычный узел с телом. Патруль пишется тремя строками:

```js
$('<enemy>', { class: 'walker' }).at(x, y).health(30)
    .on('death', e => e.self.fadeOut(200).remove())
    .appendTo($.world).attr('dir', 1);

$.update(() => {
    $('.walker').each((i, e) => {
        if (e.onWall()) e.attr('dir', -e.attr('dir'));   // развернуться у стены
        e.velocity(e.attr('dir') * 45, e.velocity().y);
    });
});
```

Монеты подбираются по расстоянию; событие узла избавляет от лишнего кода:

```js
$('.coin').on('pickup', e => { $.sound.play('pickup.ogg'); e.self.remove(); score++; });

$.update(() => {
    $('.coin').each((i, c) => { if (c.distanceTo('#hero') < 30) c.emit('pickup'); });
});
```

## Шаг 6. HUD на узлах интерфейса

Узлы `ui.*` рисуются в координатах окна: камера на них не влияет, в мир они не
попадают и видны агенту в снимке состояния.

```js
$('<ui.bar>', { id: 'hp', value: 100, max: 100 }).at(120, 30).appendTo($.ui);
$('<ui.label>', { id: 'score', text: 'Очки: 0', size: 18, color: '#ffd54a' })
    .at(30, 60).appendTo($.ui);

$.update(() => {
    $.ui.bar('#hp', $('#hero').hp(), 100);
    $.ui.label('#score', 'Очки: ' + score);
});
```

Для сложной вёрстки есть документы RmlUi:

```js
const menu = $.ui.doc('ui/menu.rml').show();
menu.text('score', '120').on('btn-play', 'click', () => $.scene.load('level'));
```

## Шаг 7. Сцены: меню и уровень

Сцена — объект с `enter/exit/update/render` или просто функция-построитель.

```js
// mygame/scenes/menu.js
export default function installMenu($) {
    $.scene.add('menu', {
        enter($) {
            this.doc = $.ui.doc('ui/menu.rml').show()
                .on('btn-play', 'click', () => $.scene.load('level'));
        },
        exit() { if (this.doc) this.doc.hide(); },
        update(dt, $) { if ($.input.pressed('escape')) $.quit(); },
    });
}

// mygame/main.js
import installMenu from './scenes/menu.js';
$.ready(($) => {
    installMenu($);
    $.scene.add('level', $ => { /* построить уровень */ });
    $.scene.load('menu', { transition: 'none' });
});
```

Смена сцены **отложена на начало следующего кадра** — её можно вызывать прямо
из обработчика клика. Мир при смене очищается: узлы, тела, твины и таймеры
исчезают, и игра начинается «с нуля».

## Шаг 8. Сохранения

```js
$.store.file('save.json').load();
$.store.set('best', score);
$.store.save();                    // путь считается от корня запуска
$.store.autoSave(30000);           // и раз в 30 секунд, если что-то менялось
```

Кроме этого `$.fs` умеет читать и писать любые файлы:
`$.fs.readJSON('data/levels.json')`, `$.fs.write('log.txt', text)`.

## Как это проверять без рук

Игру можно гонять агентом: движок принимает JSON-команды и отдаёт состояние.

```bash
./build/russiano2d --agent --headless --fixed-dt 0.0166666667 --game mygame
```

```python
import sys; sys.path.insert(0, "tools")
from agent_client import Agent

with Agent(game="mygame", seed=7) as a:
    a.step(30)
    print(a.eval("$('#hero').pos()"))
    a.keys(["D"]); a.step(60); a.keys([])
    a.key("Space", "tap"); a.step(10)
    a.screenshot("build/shot.png")
    print(a.stderr_tail(10))        # ошибки игрового кода видны здесь
```

Игра со своей стороны может рассказывать о себе агенту:

```js
$.agent.expose('score', () => score);        // поле появится в снимке состояния
$.test.check($('.coin').length === 5, 'монет пять');
```

Подробности — [AGENT_API.md](AGENT_API.md).

## Что дальше

* [tutorial-menus.md](tutorial-menus.md) — меню, пауза и переходы между сценами.
* [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md) — всё, что умеет `$`.
* [API.md](API.md) — низкий уровень: батчинг, тела, BSP, свет, RmlUi.


---

## Туториал: меню, пауза и смена сцен

<sub>источник: `docs/tutorial-menus.md`</sub>

# Туториал: меню, пауза и смена сцен

Как устроены экраны в Russiano2D: менеджер сцен в `$`, отложенные переходы,
интерфейс на RmlUi и на узлах `<ui.*>`, пауза и сохранения.

Справочник по вызовам — [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md), разделы
[`$.scene`](HIGH_LEVEL_API.md#19-scene--сцены) и [`$.ui`](HIGH_LEVEL_API.md#20-ui--интерфейс).

- [Зачем сцены](#зачем-сцены)
- [Как устроена сцена](#как-устроена-сцена)
- [Переключение и переходы](#переключение-и-переходы)
- [Стек сцен: пауза и оверлеи](#стек-сцен-пауза-и-оверлеи)
- [Два пути интерфейса](#два-пути-интерфейса)
- [Меню на RmlUi](#меню-на-rmlui)
- [HUD на узлах](#hud-на-узлах)
- [Пауза](#пауза)
- [Что живёт дольше сцены](#что-живёт-дольше-сцены)
- [Сохранения между запусками](#сохранения-между-запусками)

---

## Зачем сцены

Сцена — это экран игры: меню, уровень, пауза, экран проигрыша. При переходе
между сценами нужно не забыть убрать за предыдущей: узлы, тела, твины, таймеры,
документы интерфейса, музыку. `$` делает это сам — при смене сцены мир
очищается целиком, а сцена получает вызов `exit()`, где можно доделать своё.

## Как устроена сцена

```js
$.scene.add('level', {
    enter($)  { /* построить мир */ },
    exit()    { /* убрать за собой */ },
    update(dt, $) { /* логика кадра */ },
    render($) { /* необязательно: своя отрисовка */ },
});
```

Вместо объекта можно дать функцию — тогда она выполняется как `enter`:

```js
$.scene.add('level', ($) => { $('<player>').at(100, 200).appendTo($.world); });
```

Внутри методов `this` — сама сцена, поэтому состояние удобно хранить полями
(`this.score`, `this.doc`).

## Переключение и переходы

```js
$.scene.load('level');                              // с затемнением по умолчанию
$.scene.load('level', { transition: 'none' });      // мгновенно
$.scene.load('level', { ms: 500 });                 // длительность перехода
$.scene.restart();                                  // перезапустить текущую
```

Переход **отложен**: `load()` только ставит запрос, а замена происходит в
начале следующего кадра. Поэтому менять сцену можно прямо из обработчика клика
или из `update`, не разрушая объект посреди его работы.

```js
$.scene.current()      // 'level' или null
$.scene.names()        // список зарегистрированных сцен
$.scene.busy()         // идёт ли переход прямо сейчас
```

## Стек сцен: пауза и оверлеи

```js
$.scene.push('pause');   // запомнить текущую и открыть паузу
$.scene.pop();           // вернуться к запомненной
$.scene.stack();         // список отложенных сцен
```

`push`/`pop` — это обычные `load`, поэтому мир всё равно очищается. Если нужно
сохранить мир уровня «под» паузой, делайте паузу не сценой, а оверлеем:
узлами `<ui.*>` и `$.time.pause()` (см. ниже).

## Два пути интерфейса

| Путь | Когда выбирать |
|---|---|
| Узлы `<ui.panel>`, `<ui.label>`, `<ui.button>`, `<ui.bar>`, `<ui.image>` | Игровой HUD, простые экраны. Работают без файлов, видны агенту, попадают на скриншот |
| Документы RmlUi (`$.ui.doc('ui/menu.rml')`) | Статичная вёрстка со стилями: меню, настройки, инвентарь |

Оба пути можно смешивать: HUD на узлах, меню — на RmlUi.

## Меню на RmlUi

Документ лежит в `game/ui/menu.rml` со стилями `menu.rcss`:

```xml
<rml>
<head><link type="text/rcss" href="menu.rcss"/></head>
<body>
    <div id="menu">
        <h1>RUSSIANO2D</h1>
        <button id="btn-play">Играть</button>
        <button id="btn-quit">Выход</button>
    </div>
</body>
</rml>
```

```js
export default function installMenu($) {
    $.scene.add('menu', {
        enter($) {
            // $.ui.doc() кэширует обёртку по пути, а .on() вешает слушатель
            // один раз — иначе после возврата в меню клик сработал бы дважды.
            this.doc = $.ui.doc('ui/menu.rml')
                .on('btn-play', 'click', () => $.scene.load('level'))
                .on('btn-quit', 'click', () => $.quit())
                .show();
        },
        exit() { if (this.doc) this.doc.hide(); },
        update(dt, $) {
            // Меню обязано работать и с клавиатуры: мышью пользуются не все.
            if ($.input.pressed('enter')) $.scene.load('level');
            if ($.input.pressed('escape')) $.quit();
        },
    });
}
```

Полезные методы документа:

```js
doc.text('score', '120');                 // заменить содержимое элемента
doc.cls('panel', 'hidden', true);         // добавить/снять CSS-класс
doc.style('bar', 'width', '50%');         // инлайновое свойство
doc.visible() / .hide() / .unload();
$.ui.icon('directions_run')               // 2235 иконок Material Design встроены
```

> Слушатели живут внутри RmlUi и не снимаются вместе со сценой, поэтому
> вешать их повторно при каждом входе нельзя — для этого `$.ui.doc()` отдаёт
> один и тот же объект, а `.on()` срабатывает только в первый раз.

## HUD на узлах

```js
$('<ui.bar>',  { id: 'hp',  value: 100, max: 100 }).at(120, 30).appendTo($.ui);
$('<ui.label>', { id: 'score', text: 'Очки: 0' }).at(30, 60).appendTo($.ui);

$.update(() => {
    $.ui.bar('#hp', $('#hero').hp(), 100);
    $.ui.label('#score', 'Очки: ' + this.score);
});
```

Узлы интерфейса — обычные узлы: у них есть селекторы, события и стили
(`.color`, `.alpha`, `.size`). События работают без разметки:

```js
$('<ui.button>', { id: 'retry', text: 'Ещё раз' }).at(640, 400).appendTo($.ui)
    .on('click', () => $.scene.restart());
```

## Пауза

Пауза — это остановка игрового времени, а не смена сцены: мир остаётся на
экране, твины и таймеры замирают.

```js
if ($.input.pressed('escape')) {
    if ($.time.isPaused()) {
        $.time.resume();
        $('#overlay').hide(); $('#overlay-text').hide();
    } else {
        $.time.pause();
        $('#overlay').show();
        $('#overlay-text').show().text('Пауза');
    }
}
```

`$.time.pause()` влияет на `$.time.delta()`, твины, `$.time.wait/every` и
обновление камеры. Вспышки и тряска идут по реальному времени — они должны
догореть даже на паузе.

## Что живёт дольше сцены

При смене сцены `$` уничтожает все узлы, кроме:

* узлов интерфейса, если сцена загружена с `{ keepUI: true }`;
* узлов с классом `scene-persistent`.

```js
$('<ui.panel>', { id: 'fps' }).appendTo($.ui).addClass('scene-persistent');
```

Текстуры, спрайты, звуки и документы RmlUi живут в движке и переживают смену
сцены — загружать их повторно не нужно (повторный `loadTexture` вернёт тот же id).

## Сохранения между запусками

```js
$.store.file('save.json').load();      // при старте
$.store.set('best', 1200);
$.store.save();                        // когда удобно — например, на выходе
$.store.autoSave(30000);               // или пусть сохраняет сам

$.exit(() => $.store.save());          // последний шанс записать прогресс
```

`$.exit(fn)` вызывается движком при завершении — в том числе когда игру
останавливает агент.

---

Дальше: [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md) — полный справочник,
[AGENT_API.md](AGENT_API.md) — как проверить меню и переходы без рук.


---

## Russiano2D — демо-проект

<sub>источник: `docs/demos.md`</sub>

# Russiano2D — демо-проект

`demos/` — отдельная игра на движке: семь сцен-демо, каждая показывает свою
часть движка. Запускается тем же бинарником, что и `game/`, и выбирается
флагом `--game`.

![Меню демо](screenshots/launcher.png)

## Запуск

```bash
./build/russiano2d --game demos                      # меню выбора
./build/russiano2d --game demos --scene platformer   # сразу конкретная сцена
./build/russiano2d --game demos --scene shooter25d \
    --screenshot /tmp/s.png --screenshot-at 3 --seconds 5
```

Точка входа — `<каталог>/main.js`, то есть [`demos/main.js`](../demos/main.js).
`--scene <имя>` движок кладёт в `engine.startScene`, и точка входа открывает
эту сцену минуя меню:

```js
// demos/main.js
const start = engine.startScene || 'launcher';
$.scene.load($.scene.has(start) ? start : 'launcher', { transition: 'none' });
```

## Как устроено демо

Каждое демо — модуль с одним экспортом: функцией `install($)`, которая
регистрирует свою сцену. Общего кода нет: всё, что раньше лежало в
`demos/lib/` (кэш ассетов, пакет отрисовки, менеджер сцен, звук, привязки
клавиш), теперь умеет само высокоуровневое API `$`.

```js
// demos/platformer/index.js
export default function install($) {
    $.scene.add('platformer', {
        enter($) { /* построить уровень */ },
        exit() { /* убрать за собой */ },
        update(dt, $) { /* логика кадра */ },
        render($) { /* необязательно: своя отрисовка */ },
    });
}
```

Три демо (`bsp`, `light`, `shooter25d`) сознательно остаются «низкоуровневыми»:
их суть — рейкастинг, BSP-дерево и полигоны видимости, то есть прямые вызовы
`engine.bsp.*`, `engine.light.visibility()` и `engine.submitTriangles()`.
Обвязка (сцена, HUD, ввод, камера) в них всё равно написана на `$`, а математика
вызывается из неё.

Добавить своё демо: положить `demos/имя/index.js` с `install($)` и дописать
строку в список `MODULES` в `demos/main.js` — кнопка в меню появится сама
(подпись и иконка берутся из таблицы `TITLES` в `demos/launcher.js`).

## Сцены

| Сцена | Что показывает | Ключевые вызовы |
|---|---|---|
| `platformer` | Box2D, листы анимации, монеты, враги, параллакс, HUD, пауза | `.controls`, `.frames`, `.animate`, `.on('death')`, `<ui.*>` |
| `shooter25d` | настоящий рейкастинг (DDA-обход сетки), билборды врагов, оружие от первого лица | `engine.raycast`, `$.gfx`, `$.camera` |
| `gallery` | все анимационные листы персонажей с управлением воспроизведением | `.frames`, `.animate`, `.playing`, `$.input` |
| `arena` | волны врагов, стрельба, здоровье, экран проигрыша | `$.world.raycast`, `$('<bullet>')`, `$.scene.restart` |
| `physics` | песочница Box2D: ящики, взрывы, гравитация, контуры тел | `.body('dynamic')`, `.applyImpulse`, `$.world.query` |
| `bsp` | порядок отрисовки без z-буфера на наклонных стенах, пошаговый обход дерева | `engine.bsp.build/order` |
| `light` | 2D-свет через полигоны видимости: источники, тени, градиент по цвету вершин | `engine.light.visibility`, `engine.submitTriangles` |

## Управление

| Клавиша | Действие |
|---|---|
| `A` / `D` или `←` / `→` | идти |
| `Space` / `W` / `↑` | прыжок |
| мышь | прицел, стрельба, перетаскивание объектов |
| `Esc` | выход из демо в меню, из меню — выход |
| `F1` | показать/скрыть отладочный оверлей движка |
| `F5` | перезапустить скрипты вручную |

## Ассеты

Графика, звук и шрифты лежат в `demos/assets/`; полный список с лицензиями —
[`demos/assets/CREDITS.md`](../demos/assets/CREDITS.md). Маскот движка
(`art/mascot/russiano_mascot_sheet_a.png`, 8×4 кадра по 176×176) используется
как игрок в демо-платформере.

## Проверка без рук

Все демо можно открыть агентом — это то же, что делает
`tests/agent/demos_test.py`:

```bash
python3 tests/agent/demos_test.py              # все сцены
python3 tests/agent/demos_test.py light        # только выбранные
```

Тест открывает каждую сцену, шагает кадры, проверяет журнал на ошибки
и сохраняет скриншот в `build/test_demo_<имя>.png`.


---

## Russiano2D — аудит высокоуровневого API `$` и пробелы относительно Godot 4.x (2D)

<sub>источник: `docs/GAP_ANALYSIS.md`</sub>

# Russiano2D — аудит высокоуровневого API `$` и пробелы относительно Godot 4.x (2D)

Дата: 2026-10-05. Ориентир: игровой API Godot 4.x, только 2D-часть
(`Node2D`, `CanvasItem`, `AnimationPlayer`, `TileMapLayer`, `CPUParticles2D`,
`NavigationRegion2D`, `AudioStreamPlayer2D`, `Control` и сопутствующее).

Документ отвечает на три вопроса:

1. что **уже есть** в `$` и низкоуровневом `engine`;
2. чего **не хватает** нормальному 2D-движку;
3. что из этого **реализуется** в рамках текущей работы (и в каком порядке).

Реализованное по итогам документа сразу описывается в
[HIGH_LEVEL_API.md](HIGH_LEVEL_API.md) и в `docs/highlevel/*.md`.

---

## 1. Как устроен API сегодня

| Слой | Файл | Роль |
|---|---|---|
| Ядро `$` | `src/highlevel/core.js` | узел, обёртка, селекторы, теги, цвет |
| Сборка | `src/highlevel/api.js` | `createApi()`, цепочные методы узла, кадровый цикл |
| Подсистемы | `world/camera/time/input/sound/scene/ui/store/debug/window/render/tween/agent.js` | пространства имён `$.xxx` |
| Низкий уровень | `src/script.c` → `engine.*` | текстуры, батчинг, Box2D, RmlUi, BSP, свет, файлы |
| Ядро C | `src/render.c`, `src/physics.c`, `src/audio.c`, `src/light.cpp`, `src/bsp.c` | SDL_GPU, Box2D, SDL3_mixer, видимость, BSP |

Ключевые свойства текущего API, которые важно сохранить:

* **HTML/CSS-подобный DSL**: создание `$('<player>', {...})`, поиск `$('#hero')`,
  неявная итерация по коллекции, цепочки, `Promise` для анимаций.
* **Пакетный кадр**: игра не вызывает отрисовку на спрайт, `$.gfx` собирает
  массивы и отдаёт их одним `engine.submitSprites`.
* **Физика целиком в C**: JS работает с телами по числовому id.
* **Всё возвращает обёртку** — `$.fn` открыт для расширения игры.

Ниже «есть» означает «работает и документировано», «частично» — работает с
оговорками, «нет» — отсутствует.

---

## 2. Сводная таблица пробелов

Приоритет: **P1** — без этого движок нельзя назвать полноценным 2D-движком,
**P2** — сильно ожидаемо в жанре, **P3** — нишевое.

| Область Godot 2D | Аналог в Godot | Состояние в `$` | Чего не хватает | Приор. |
|---|---|---|---|---|
| Трансформ, иерархия | `Node2D` | есть | `z_as_relative`, наследование `visible`/`modulate` родителем | P2 |
| Спрайты | `Sprite2D`, `AnimatedSprite2D` | есть | `region` есть; нет `NinePatchRect`, атласа-импорта | P2 |
| **Анимация** | `AnimationPlayer`, `AnimationTree`, `AnimationMixer` | **есть** ([anim.md](highlevel/anim.md)) | клипы, дорожки свойств, `one-shot`/`loop`/`ping-pong`, события в кадрах, машина состояний и переходы | **P1** |
| **Тайлы** | `TileMapLayer`, `TileSet`, террейны | **есть** ([tilemap.md](highlevel/tilemap.md)) | сетка, слои, тайлсет из текстуры, автотайл по битовой маске, коллизии, `y-sort` внутри слоя | **P1** |
| **Частицы** | `CPUParticles2D`, `GPUParticles2D` | **есть** ([particles.md](highlevel/particles.md)) | эмиттер, `one-shot`/`burst`, гравитация, разброс, кривые цвета/размера, `local`/`global` | **P1** |
| **Навигация** | `NavigationRegion2D`, `NavigationAgent2D`, `AStarGrid2D` | **есть** ([nav.md](highlevel/nav.md)) | сетка/полигон, A*, сглаживание пути, обход препятствий | **P1** |
| **Сцены и prefab** | `PackedScene`, наследование сцен, `.tres` | **есть** ([prefab.md](highlevel/prefab.md)) | `$.scene` — это машина смены сцен, а не сериализация узлов; нет инстанцирования из данных, сохранения сцены, наследования | **P1** |
| **Аудио** | `AudioStreamPlayer2D`, шины `AudioServer`, эффекты | **есть** ([audiobus.md](highlevel/audiobus.md)) | мастер/`sfx`/`music` + панорама есть; нет шин, эффектов (reverb/echo/фильтр), приоритетов голосов, позиционного затухания | **P1** |
| **Слои и parallax** | `CanvasLayer`, `ParallaxBackground`, `CanvasModulate` | **есть** ([layers.md](highlevel/layers.md)) | один фон с `parallax` есть; нет дополнительных канвас-слоёв, `CanvasModulate`, `z_index`-групп | **P1** |
| **Шейдеры** | `canvas_item` шейдер, `ShaderMaterial`, `ShaderParam` | **частично** (`.shader()` — заглушка; blend-режимы `alpha`/`add`/`multiply`/`none` есть) | пользовательских шейдеров нет: конвейеры фиксированные | P2 |
| **UI-контролы** | `Control`: контейнеры, `ScrollContainer`, `LineEdit`, `CheckBox`, `OptionButton`, `Slider`, фокус | **есть** ([widgets.md](highlevel/widgets.md)) | есть `panel/label/button/bar/image`; нет контейнеров, скролла, фокуса, ввода текста, чекбоксов, слайдеров, диалогов | **P1** |
| Физика: формы | `CollisionShape2D` | **есть** | прямоугольник, настоящий круг, капсула, полигон, `one-way` | — |
| Физика: соединения | `PinJoint2D`, `DampedSpringJoint2D`, `GrooveJoint2D` | **есть** | `revolute`, `distance`, `weld` (+ лимиты и мотор) | — |
| Физика: области | `Area2D` | **есть** | зоны `<trigger>` (`enter`/`leave`), сенсоры и события контакта `collide`/`separate`/`hit` | — |
| Физика: фильтры | collision layers/masks | частично | `layerBits`/`mask` есть у тел; нет именованных слоёв и матрицы | P3 |
| Запросы | `RayCast2D`, `ShapeCast2D` | частично | луч и точечный/боксовый запрос есть; нет фигурного свипа | P2 |
| Свет | `PointLight2D`, тени | есть | полигоны видимости, `<light>` | — |
| Порядок отрисовки | `YSort`, `z_index` | есть | `layer`, `depth`, `$.world.sort('y')`, BSP | — |
| Таймеры | `Timer`, `SceneTreeTimer` | есть | `$.time.after/every`, твины | — |
| Сигналы, группы | `signal`, группы | есть | `on/emit`, классы, теги, селекторы | — |
| Твины | `Tween` | **есть** | Promise-API + `Tween` в стиле Godot: `property/chain/loops/trans × ease` | — |
| Ввод | `InputMap`, действия, ребинд | **есть** | `deadzone`, `rebind`, `saveBindings`/`loadBindings`, `actions`/`describe` | — |
| Кривые/интерполяция | `Curve`, `Gradient` | нет | нужны для частиц и анимации | P2 |
| Локализация | `TranslationServer` | **есть** | `$.i18n` + `$.tr()`, плюрализация, автоподстановка в узлы | — |
| Сеть | `MultiplayerAPI` | нет | вне текущей области | P3 |
| Скелет/IK | `Skeleton2D` | нет | вне текущей области | P3 |
| Отладка | удалённое дерево сцены | частично | `$.debug`, оверлей ImGui, агентский снапшот, `$.debug.counters()` | P2 |

---

## 3. Подробно по P1-областям

### 3.1. Анимация и состояния — нет

Есть только покадровая анимация спрайт-листов (`.frames()`, `.frame()`,
`.animate()`) и твины свойств (`.tween()`, `.tweenTo()`, `$.sequence()`).
Этого не хватает для: появления/смерти, атаки, дверей, UI-переходов.

Нужно: `AnimationPlayer`-аналог с клипами (несколько дорожек, у каждой своя
цель и кривая), режимы `once`/`loop`/`ping-pong`, скорость, события в
процентах клипа, машина состояний с переходами по условию и событиями
`entered`/`exited`.

### 3.2. TileMap — нет

Тег `tilemap` уже объявлен в `core.js` (`TAGS.tilemap`), но рендера нет.
Нужно: размер тайла, тайлсет из текстуры (в том числе сеткой), несколько
слоёв, автотайл по 4/8-битной маске соседей, статические тела для
непроходимых тайлов, `y-sort` внутри слоя, запись/чтение карты как данных.

### 3.3. Частицы — нет

Нужно: CPU-эмиттер на существующем батче `$.gfx`, время жизни, скорость и
разброс, гравитация, вращение, кривые размера/цвета/прозрачности, `one-shot`
и `burst`, `local`/`global` режимы, лимит частиц.

### 3.4. Навигация и поиск пути — нет

Есть только `$.world.raycast`. Нужно: A* по сетке (в том числе построенной по
препятствиям), сглаживание пути, `NavigationAgent`-аналог с движением к цели,
перестроение при изменении мира.

### 3.5. Prefab и сериализация сцен — частично

`$.scene.load/push/pop/transition` управляет сменой сцен, но не умеет
сериализовать дерево узлов. Нужно: сохранение узла/поддерева в данные
(JSON-совместимые), инстанцирование из данных, наследование prefab с
переопределением свойств, сохранение/загрузка сцены целиком через `$.store`.

### 3.6. Аудио: шины и эффекты — частично

Есть мастер-громкость, `sfx`/`music`, панорама, петли, затухания. Нет
именованных шин (например `master → music → ui`), эффектов на шине и
маршрутизации звука в шину. Часть реализуется в JS поверх существующих
`volume/pan`, эффекты требуют C (`MIX_SetTrackEffects`).

### 3.7. Слои, parallax, шейдеры — частично

Есть один фон с коэффициентом `parallax`. Нет дополнительных канвас-слоёв
(UI поверх мира, оверлеи, мини-карта), `CanvasModulate` и режимов смешивания.
Полноценные пользовательские GPU-шейдеры упираются в один общий пайплайн
`render.c`; в отчёте они остаются честно помеченными как незакрытые, а
слои/parallax/затемнение реализуются.

### 3.8. UI-контролы — частично

Есть `ui.panel/label/button/bar/image` в координатах окна и RmlUi-документы
через `$.ui`. Нет контейнеров (колонка/строка/сетка), скролла, фокуса и
навигации с клавиатуры, `checkbox`/`slider`/`input`/`dialog`.

---

## 4. Что сделано в этой итерации

| № | Подсистема | Файлы | Документация |
|---|---|---|---|
| 1 | Анимация и состояния | `src/highlevel/anim.js` | [anim.md](highlevel/anim.md) |
| 2 | TileMap | `src/highlevel/tilemap.js` | [tilemap.md](highlevel/tilemap.md) |
| 3 | Частицы | `src/highlevel/particles.js` | [particles.md](highlevel/particles.md) |
| 4 | Навигация и A* | `src/highlevel/nav.js` | [nav.md](highlevel/nav.md) |
| 5 | Prefab и сериализация | `src/highlevel/prefab.js` | [prefab.md](highlevel/prefab.md) |
| 6 | Аудио-шины и эффекты | `src/highlevel/audiobus.js`, `src/audio.c/h`, `src/script.c` | [audiobus.md](highlevel/audiobus.md) |
| 7 | Слои, parallax, затемнение | `src/highlevel/layers.js` | [layers.md](highlevel/layers.md) |
| 8 | UI-контролы | `src/highlevel/widgets.js` | [widgets.md](highlevel/widgets.md) |

Точки расширения, добавленные в существующие файлы (единственный писатель —
интегратор, чтобы модули не конфликтовали):

* `src/highlevel/render.js` — реестр `registerNodeRenderer(tag, fn)`,
  `registerUINodeRenderer` и публичный батч `$.gfx.push.*` для новых тегов;
* `src/highlevel/api.js` — импорт и установка восьми модулей, вызов
  tick-функций в кадровом цикле;
* `src/highlevel/input.js` — `$.input.text()` поверх нового `engine.textInput()`;
* `src/app.c/h`, `src/agent.c`, `src/script.c` — текстовый ввод
  (`SDL_EVENT_TEXT_INPUT` → `engine.textInput()`, агентская команда `text`);
* `src/audio.c/h`, `src/audio_stub.c`, `src/script.c` — громкость и панорама
  живого канала, DSP-эффекты `lowpass`/`echo` через `MIX_SetTrackRawCallback`;
* `src/script.c` — биндинги `engine.audio.setChannelVolume`, `setChannelPan`,
  `setChannelEffect` и `engine.textInput`.

### Что изменилось по сравнению с исходным планом

* Пользовательские GPU-шейдеры не реализованы: конвейер `render.c` один, а
  честная поддержка требует SPIR-V-компиляции в рантайме. `.shader()` и
  `.shader()` по-прежнему заглушка с предупреждением; вместо пользовательских
  шейдеров появились слои, параллакс, полноэкранный `modulate`/`fade` и
  blend-режимы (`$.blend`, `.blend`).
* `agentRadius` у навигационной сетки добавлен как обязательная страховка:
  без запаса на габарит агента A* ведёт путь вплотную к стене и тело
  застревает (это выявил интеграционный тест).

## 5. Вторая итерация: починка врущего и добивание P1

Первая итерация закрыла восемь крупных дыр, но проверка показала места, где
документация обещала больше, чем было в коде, и оставшиеся P2-пробелы.

### Починено (документация врала)

| Что было заявлено | Что было на самом деле | Как исправлено |
|---|---|---|
| `<trigger>` шлёт `enter`/`leave` | Тег был обычным узлом, `trigger()` — алиасом `emit` | Подсистема [triggers.md](highlevel/triggers.md): зоны с диффом пересечений |
| `.overlaps(sel, cb)` | Подписка на событие `'tick'`, которое никто не шлёт | `watchOverlap` из `triggers.js`, покадровый наблюдатель |
| `<circle>` — круг | Тело было `b2MakeBox` | Настоящая форма `circle` (`b2CreateCircleShape`) |

Найден и закрыт ещё один баг: пересоздание тела (`.size()`, `.collision()`,
`.appendTo()`) теряло скорость — цепочка `.velocity(...).appendTo(...)`
обнуляла разгон.

### Добавлено во второй итерации

| Что | Где | Документация |
|---|---|---|
| Формы тел: круг, капсула, полигон; one-way; события `collide`/`separate`/`hit`; суставы `revolute`/`distance`/`weld` | `src/physics.c/h`, `src/script.c` | [API.md](API.md), раздел 8 |
| `Tween` в стиле Godot: `property`, `chain`, `loops`, `trans × ease`, `finished` | `src/highlevel/tween.js` | [tween.md](highlevel/tween.md) |
| Зоны `enter`/`leave` | `src/highlevel/triggers.js` | [triggers.md](highlevel/triggers.md) |
| Локализация `$.i18n` + `$.tr()` | `src/highlevel/i18n.js` | [i18n.md](highlevel/i18n.md) |
| Пул объектов и счётчики отладки | `src/highlevel/pool.js`, `debug.js` | [pool.md](highlevel/pool.md) |
| Ввод: deadzone, ребинд с сохранением | `src/highlevel/input.js` | [i18n.md](highlevel/i18n.md) (раздел про ввод) |
| UI: якоря, проценты, пресеты, темы | `src/highlevel/widgets.js` | [widgets.md](highlevel/widgets.md) |
| TileMap: Y-sort с сущностями и террейны | `src/highlevel/tilemap.js` | [tilemap.md](highlevel/tilemap.md) |
| Релизная обвязка: CI на Windows и Linux, changelog, release-скрипт, двойной хостинг | `.gitlab-ci.yml`, `tools/release.py` | [RELEASING.md](RELEASING.md) |
| Мини-гайд «Моя первая игра» | `docs/tutorial-first-game.md` | — |

## 6. Третья итерация: тяжёлые куски и сервисы

| Что | Где | Документация |
|---|---|---|
| Blend-режимы (`alpha`/`add`/`multiply`/`none`) — узел и кадр | `src/render.c`, `src/highlevel/render.js`, `viewport.js` | [render.md](highlevel/render.md) |
| HTTP-запросы из игры: `$.http.get/post/json/download` | `src/http.c`, `src/highlevel/http.js` | [http.md](highlevel/http.md) |
| Навигационный меш (прямоугольная декомпозиция + воронка) | `src/highlevel/nav.js` | [nav.md](highlevel/nav.md), §4 |
| Тест-страж гайда: листинг из документа запускается в движке | `tests/agent/highlevel_guide_test.py` | — |

Render target (рисование в offscreen-текстуру) остаётся заглушкой: `render pass`
открывается в `main.c`, и честная поддержка требует отдельного прохода и списка
целей. В [render.md](highlevel/render.md) описано, что именно перестроить —
API при вызове бросает понятную ошибку, а не рисует неправильно.

## 7. Что остаётся в бэклоге

Пользовательские GPU-шейдеры (нужна компиляция SPIR-V в рантайме),
`NinePatchRect`, сетевая игра (HTTP уже есть, но это не мультиплеер),
скелет/IK, кривые и градиенты как отдельные ресурсы, render target для
мини-карт и порталов. Они не входят в текущие итерации и перечислены здесь, чтобы не
потерять.


---

## Выпуск релиза

<sub>источник: `docs/RELEASING.md`</sub>

# Выпуск релиза

Как выпускать Russiano2D: что проверить, как собрать, упаковать, подписать
контрольными суммами и опубликовать сразу в **двух** местах.

Два хоста — две роли:

Проект живёт на одном хосте:

| Хост | Remote | Доступ | Роль |
|---|---|---|---|
| **hub.mos.ru** | `origin` | **публичный** | единственный хост: исходники, GitLab CI/CD, релизы и артефакты |

* ссылки в README, ссылки в документации и бейджи ведут только на hub.mos.ru;
* релиз выпускается там же: GitLab Release + архивы Linux и Windows + SHA256SUMS;
* резервная копия — это клоны и бэкапы самого hub.mos.ru, а не второй хостинг;
* весь CI — один GitLab-пайплайн, `.gitlab-ci.yml`.

---

## 0. Блокеры публичного релиза

Пока не закрыты эти пункты, публичный релиз выпускать нельзя.

### 0.1. Лицензия выбрана (закрыто)

В корне лежит `LICENSE` — авторская лицензия: использовать, менять,
распространять и продавать свободно, без отчислений; если выпустишь игру на
движке — скажи спасибо автору (необязательно). Уведомления зависимостей
сохраняются отдельно, в `THIRD_PARTY_NOTICES.md`.

`tools/release.py` в настоящем (не `--dry-run`) режиме требует наличия
`LICENSE` — теперь файл есть, блокер снят. Карта вариантов осталась в
разделе 3 как справка: если владелец решит сменить лицензию на стандартную
(MIT, Apache-2.0 и т. п.), порядок действий там же.

### 0.2. Права на демо-ассеты не подтверждены

`demos/assets/art/**` собраны `tools/make_demo_assets.py` из исходников,
лежащих **вне** репозитория (`R2D_SOURCE_ART`), а происхождение
`assets/audio/**` в репозитории не зафиксировано. До релиза владелец должен
подтвердить права либо исключить эти файлы из поставки. Подробнее —
`THIRD_PARTY_NOTICES.md`, раздел «Ассеты».

### 0.3. Путь до репозитория уточнён (закрыто)

Проект живёт по адресу <https://hub.mos.ru/dem4ev48/russiano2d>, remote настроен:

```bash
git remote -v
# origin  git@hub.mos.ru:dem4ev48/russiano2d.git
```

---

## 1. Версия

Версия живёт в одном месте — `project(... VERSION x.y.z ...)` в
`CMakeLists.txt`. Скрипт релиза читает и меняет именно её.

Схема — семантическое версионирование:

| Что изменилось | Какую цифру поднимать |
|---|---|
| ломающее изменение API | `MAJOR` (0.x — пока не обещаем стабильность) |
| новая возможность | `MINOR` |
| исправление | `PATCH` |

Одновременно дополнить `CHANGELOG.md`: записи из `[Unreleased]` переезжают в
раздел новой версии с датой.

---

## 2. Сборка и тесты

### 2.1. Debug — для проверок локально

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j
```

### 2.2. Release — для поставки

```bash
cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release
cmake --build build-release -j
```

Для сборки скриптов внутрь бинарника (байткод QuickJS):

```bash
cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release \
      -DR2D_EMBED_SCRIPTS=ON -DR2D_EMBED_DIR=demos
```

Полезные переключатели: `R2D_ENABLE_IMGUI`, `R2D_ENABLE_RMLUI`,
`R2D_ENABLE_AUDIO`, `R2D_ENABLE_HOTRELOAD`, `R2D_SANITIZE`.

### 2.3. Что прогоняется

| Набор | Чем | Нужен GPU |
|---|---|---|
| C-тесты JSON и ChaCha20-Poly1305 | `build/tests/r2d_json_test`, `build/tests/r2d_crypto_test` | нет |
| Юнит-тесты логики `$` | `qjs tests/js/*_test.mjs` (см. `docs/AGENT_API.md`) | нет |
| Агентские тесты движка | `python3 tools/run_tests.py` (`--fast` — быстрый набор) | **да** |
| Сборка игры в один файл | `tests/agent/build_test.py` | **да** |

Полный прогон:

```bash
python3 tools/run_tests.py
```

Быстрый (около минуты) и понятный локально:

```bash
python3 tools/run_tests.py --fast
```

Важно: раннер различает `ok`, `fail` и `skip`: пропуск (нет дисплея, нет
ассета) **не считается успехом**. Если релизная проверка дала `skip`, это
надо объяснить, а не «зачесть».

---

## 3. Выбор лицензии (справка)

Лицензия уже выбрана и лежит в `LICENSE` — авторская, максимально
либеральная. Этот раздел оставлен на случай, если владелец захочет перейти
на стандартную лицензию. Важное
обстоятельство: движок **статически линкует** MIT/Apache/zlib-зависимости
(см. `THIRD_PARTY_NOTICES.md`), ни одна из них не требует открывать код
проекта.

| Кандидат | Плюсы | Минусы |
|---|---|---|
| **MIT** | максимально коротко и привычно для игровых движков; совместима со всеми зависимостями; легко читается | нет явного патентного гранта; нет условия делиться улучшениями |
| **Apache-2.0** | явный патентный грант и защита от патентных исков; хорошо для корпоративного использования | длиннее и «юридичнее»; требует сохранять NOTICE; несовместима с GPLv2 |
| **BSD-2/3-Clause** | почти как MIT, вариант с запретом использовать имя проекта в рекламе | патентный вопрос тоже не покрыт |
| **zlib** | как у SDL; очень либеральна, коротка | мало кто читает её как «бренд»; патентного гранта нет |
| **MPL-2.0** | файловый копилефт: правки самих файлов открываются, остальное можно закрывать | сложнее для пользователей; не «просто игру возьми» |
| **GPL-2.0/3.0** | гарантирует открытость производных | несовместима с проприетарными играми на движке; закрывает коммерческие форки |
| **Проприетарная / «все права защищены»** | полный контроль | публичный репозиторий становится почти бесполезен для сообщества; часть зависимостей всё равно требует уведомлений |
| **Двойная (например, MIT + коммерческая)** | открытость для сообщества и платный вариант для компаний | нужен CLA и юридическая работа; пугает часть контрибьюторов |

Что учесть при выборе:

* zlib/MIT/Apache-2.0/BSD — «отпускают» код, но требуют сохранить уведомления
  зависимостей (они уже собраны в `THIRD_PARTY_NOTICES.md`).
* Если хочется, чтобы улучшения движка возвращались в общий код — MPL-2.0 или
  GPL, но это ограничит использование в проприетарных играх.
* Шрифты (SIL OFL) и ассеты — отдельные лицензии, лицензия кода их не
  заменяет.

После выбора:

1. положить полный текст в `LICENSE` в корне;
2. добавить строку о лицензии в `README.md` (правит владелец);
3. добавить `LICENSE` в поставку — `tools/release.py` копирует его
   автоматически, если файл есть.

---

## 4. Упаковка

```bash
python3 tools/release.py --dry-run          # план, ничего не меняется
python3 tools/release.py --version 0.2.0    # реальный выпуск
```

Скрипт:

1. поднимает версию в `CMakeLists.txt` (если задан `--version`);
2. собирает Release в `build-release/`;
3. гоняет C-тесты и qjs-тесты;
4. раскладывает `dist/<os>-<arch>/`: бинарник, `assets/`, `game/`,
   `README.md`, `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md`, `LICENSE` (если есть);
5. пишет `SHA256SUMS.txt` внутри пакета и сводный `dist/SHA256SUMS.txt`
   по архивам;
6. делает архивы `.tar.gz` (Linux/macOS) или `.zip` (Windows);
7. ставит аннотированный тег `vX.Y.Z`.

Полезные ключи:

| Ключ | Смысл |
|---|---|
| `--dry-run`, `-n` | печатает план, не пишет и не собирает |
| `--yes` | не спрашивать подтверждение (для скриптов) |
| `--platform linux-x86_64,windows-x86_64` | какие платформы упаковать |
| `--build-dir DIR` | каталог сборки (по умолчанию `build-release`) |
| `--out DIR` | каталог артефактов (по умолчанию `dist`) |
| `--with-demos` | положить в пакет ещё и `demos/` |
| `--force` | пересобрать непустой `dist/<os>-<arch>/` |
| `--skip-build` / `--skip-tests` / `--skip-tag` | осознанно пропустить шаг |

Проверка контрольных сумм перед публикацией:

```bash
cd dist && shasum -a 256 -c SHA256SUMS.txt
```

**Push и теги скрипт не делает.** Их публикует человек (раздел 6) — чтобы
случайный запуск не отправил недоделанный релиз в оба хоста.

---

## 5. CI/CD

### 5.1. Что где стоит

| | hub.mos.ru (GitLab) |
|---|---|
| Файл | `.gitlab-ci.yml` |
| Роль | **единственный** пайплайн проекта |
| Стадии | `lint → build → test → package → release` |
| Платформы | Linux (gcc и clang) + Windows (MSVC) |
| Артефакты | бинарники + архивы `dist/` + SHA256SUMS |

Пайплайн гоняет такой набор:

* `lint` / `tools-check`: `python3 -m compileall tools tests`, сухой прогон
  `tools/release.py --dry-run`, проверка, что dry-run не изменил рабочее
  дерево, разбор YAML и `git check-attr`;
* `build`: конфигурация + сборка **Debug** (платформы из матрицы);
* `test`: `r2d_json_test`, `r2d_crypto_test` и все `qjs tests/js/*_test.mjs`;
* `package`: `tools/release.py --package-only` собирает `dist/<os>-<arch>/`,
  архив и `SHA256SUMS.txt`;
* `release`: только по тегу `v*` — GitLab Release со ссылками на архивы
  обеих платформ.

Артефакты (что реально скачивается):

| Файл | Откуда | Размер (ориентир) |
|---|---|---|
| `russiano2d` / `russiano2d.exe` | build-job | ~6 МБ |
| `russiano2d-linux-x86_64.tar.gz` | package-job | ~10 МБ |
| `russiano2d-windows-x86_64.zip` | package-job | ~10 МБ |
| `SHA256SUMS.txt` | package-job | байты |

### 5.2. Windows-тулчейн: почему MSVC

Выбран **MSVC** (Visual Studio 2022 Build Tools) + **Ninja**, а не
MSYS2/MinGW:

* SDL_GPU на Windows работает через DirectX 12 и требует Windows SDK
  (`d3d12.h`, `dxgi.h`) — MSVC получает его вместе с Build Tools;
* glslang и SPIRV-Cross (собираются из исходников, чтобы компилировать
  шейдеры) официально тестируются под MSVC; MinGW у них периодически
  спотыкается;
* Ninja даёт одноконфигурационную сборку, и пути к артефактам совпадают с
  Linux: `build/russiano2d.exe`, `build/tests/*.exe`,
  `build/_deps/quickjs-build/qjs.exe`.

### 5.3. Как настроить раннер на hub.mos.ru

**Сейчас раннера нет**: защита hub.mos.ru отдаёт `403` (HTML-страница WAF) на
запросы с наших машин, поэтому регистрация не проходит, а бинарник раннера
скачивается как страница ошибки. Пайплайн готов и проходит линтер GitLab, но
запускать его некому — до появления доступа **релизы выпускаются локально**
(`python3 tools/release.py --version x.y.z`), затем тег уходит в `origin`.

Разбор ситуации и варианты обхода — в [RUNNER.md](RUNNER.md), раздел «Статус».
Пошаговая инструкция для Linux-VPS (на будущее) — там же, ниже.

Linux (docker-executor) — проще всего:

```bash
gitlab-runner register \
  --url https://hub.mos.ru/ \
  --registration-token <ТОКЕН_ПРОЕКТА> \
  --executor docker \
  --docker-image ubuntu:24.04 \
  --tag-list docker \
  --description "russiano2d linux"
```

Windows (shell-executor) настраивается **вручную**, и это нормально:

1. Установить GitLab Runner на Windows-машину/ВМ.
2. Установить **Visual Studio 2022 Build Tools** с workload
   «Desktop development with C++» (MSVC + Windows SDK).
3. Убедиться, что в `PATH` есть `git`, `cmake` (≥ 3.24), `ninja`, `python3`.
4. Зарегистрировать раннер с тегами `windows` и `msvc`:

```powershell
gitlab-runner register `
  --url https://hub.mos.ru/ `
  --registration-token <ТОКЕН_ПРОЕКТА> `
  --executor shell `
  --tag-list "windows,msvc" `
  --description "russiano2d windows msvc"
```

5. Проверить сетевой доступ к репозиториям зависимостей: CMake FetchContent
   тянет оттуда SDL3, SDL3_image, SDL3_mixer, QuickJS-ng, Box2D, RmlUi,
   Dear ImGui, glslang и SPIRV-Cross. За прокси задать `HTTP_PROXY` /
   `HTTPS_PROXY` в переменных проекта.

`build_windows`, `test_windows` и `package_windows` используют эти теги.
Пока раннера нет, job'ы висят в `pending`. Чтобы временно их отключить,
задать в настройках проекта переменную `R2D_WINDOWS_CI=false` — правила
`rules` в `.gitlab-ci.yml` это учитывают.

Если у инстанса вообще нет раннеров, пайплайн не стартует: тогда сборки
делаются локально по разделу 4, а GitLab Release выпускается вручную, когда
раннер появится.

### 5.4. Кэш зависимостей

FetchContent — самое долгое в сборке. Оба CI кэшируют `build*/_deps`
(ключ — хеш `CMakeLists.txt`, `cmake/Dependencies.cmake`,
`cmake/Shaders.cmake`). Без кэша первый конфиг занимает десятки минут.
Кэш не «залипает»: при смене пина зависимостей ключ меняется.

### 5.5. Чего в CI не бывает и почему

* **Агентские тесты** (`tests/agent/*_test.py`) не запускаются нигде в CI.
  Они поднимают движок с `--headless`, но движок всё равно создаёт
  SDL_GPU-устройство (Vulkan / Metal / DirectX 12). На раннере GPU-драйвера
  нет — прогон либо падает, либо уходит в `skip`. Это локальный шаг:
  `python3 tools/run_tests.py`.
* **Сборка игры в один файл** (`./russiano2d build ...`) не проверяется в CI:
  она шифрует груз и на macOS переподписывает бинарник (`codesign`).
  Локально: `tests/agent/build_test.py`.
* **GPU-скриншоты и рендер-проверки** — та же причина. Проверяются глазами
  и локальными агентскими тестами.

Честная формулировка для релизных заметок: CI подтверждает, что движок
**собирается и проходит тесты без окна** на Linux и Windows; всё, что
касается GPU и окна, проверено локально на машине разработчика.

### 5.6. Как выпускается релиз через CI

1. Убедиться, что закрыты блокеры раздела 0 и обновлён `CHANGELOG.md`.
2. Поднять версию и поставить тег локально:

   ```bash
   python3 tools/release.py --version 0.2.0
   ```

3. Отправить всё на hub.mos.ru (раздел 6). По тегу `v0.2.0` запустится
   `release`-job и создаст GitLab Release со ссылками на архивы Linux и
   Windows и `SHA256SUMS.txt`.

---

## 6. Публикация

Remote один:

```bash
git remote -v
# origin  git@hub.mos.ru:dem4ev48/russiano2d.git
```

Отправка ветки и тега:

```bash
git push origin main          # основная ветка
git push origin --all         # все ветки
git push origin --tags        # теги
git push origin v0.2.0        # конкретный тег
```

`--mirror` для публикации не используйте: он удаляет на сервере всё, чего нет
локально. Для полной копии есть `git clone --mirror` в отдельный каталог —
резервная копия делается им, а не вторым хостингом: две площадки неизбежно
расходятся, и тогда непонятно, какая из них настоящая.

---

## 7. Расхождение историй

Симптом: `git push origin main` отклонён (`non-fast-forward`), потому что на
зеркале есть коммиты, которых нет локально (например, при инициализации
репозитория через веб-интерфейс GitLab).

Что делать — по порядку:

1. Посмотреть, что именно разошлось:

   ```bash
   git fetch mos
   git log --oneline --left-right --graph main...mos/main
   ```

2. Если на зеркале осмысленная история (README, `.gitignore`) — слить, не
   перезаписывая:

   ```bash
   git merge --allow-unrelated-histories mos/main
   # разрулить конфликты, закоммитить
   git push origin main
   ```

3. Если история на зеркале — мусор от неудачной инициализации и владелец
   согласен её заменить:

   ```bash
   git push --force-with-lease origin main
   ```

   `--force-with-lease` безопаснее `--force`: push пройдёт, только если
   зеркало не изменилось с последнего `fetch`.

4. Никогда не делать `git push --force` «на всякий случай» в `origin`:
   перезапись публичной истории ломает форки и PR. Принудительный push —
   только после явного решения владельца.

Тег, указывающий на уже удалённый коммит, после перезаписи истории лучше
пересоздать осознанно:

```bash
git push --delete mos v0.2.0   # если тег успел уехать
git tag -d v0.2.0
python3 tools/release.py --version 0.2.0 --skip-build --skip-tests
```

---

## 8. Чек-лист релиза

- [x] Лицензия выбрана, `LICENSE` лежит в корне, упомянута в `README.md`
- [ ] Права на демо-арт и звук подтверждены (или файлы исключены)
- [x] Путь до репозитория уточнён: <https://hub.mos.ru/dem4ev48/russiano2d>
- [ ] `CHANGELOG.md` обновлён, `[Unreleased]` разобран
- [ ] Версия поднята в `CMakeLists.txt` (`tools/release.py --version ...`)
- [ ] Локально: `python3 tools/run_tests.py` — без `fail`; `skip` объяснены
- [ ] Локально: собраны Release-бинарники (при необходимости — игры в один файл)
- [ ] `python3 tools/release.py --version x.y.z` — собран `dist/`
- [ ] `dist/*/SHA256SUMS.txt` проверен (`shasum -a 256 -c`)
- [ ] `THIRD_PARTY_NOTICES.md` актуален; тексты лицензий в поставке
- [ ] Тег `vX.Y.Z` поставлен и отправлен на hub.mos.ru
- [ ] CI на hub.mos.ru зелёный; GitLab Release создан, архивы приложены
- [ ] Локальный mirror-бэкап обновлён (`git clone --mirror` или бэкап инстанса)


---

## Раннер GitLab для hub.mos.ru

<sub>источник: `docs/RUNNER.md`</sub>

# Раннер GitLab для hub.mos.ru

> **Статус: раннера нет.** Защита hub.mos.ru отдаёт `403` на запросы с наших
> машин, поэтому раннер не регистрируется, а его бинарник скачивается как
> HTML-страница ошибки. Пайплайн готов, но запускать его некому — движок и
> релизы собираются локально, `python3 tools/release.py --version x.y.z`.
> Подробности и варианты обхода — в разделе «Статус» ниже.

Как поднять сборочный раннер на Linux-VPS. Задания конвейера выполняются в
контейнерах (`image: ubuntu:24.04`), поэтому нужен именно **docker-executor** —
shell-executor их не запустит.

## Статус: почему CI не работает

Поднять раннер не удалось — и не из-за конфигурации. Защита hub.mos.ru (WAF)
отдаёт `403 Forbidden` на любой запрос с наших машин. Разница видна по ответу:

| Запрос | Откуда | Ответ |
|---|---|---|
| `POST /api/v4/runners` | обычная рабочая машина | `403`, `content-type: application/json`, тело `{"message":"403 Forbidden"}` — **это отвечает GitLab** |
| тот же запрос | VPS (Россия, Москва, AS208427) | `403`, **HTML**: `<h1>Forbidden</h1><pre>Request ID: 2026-10-05-32-53-3F2468181E30BDE:95.182.122.198</pre>` — **это отвечает WAF** |

GitLab всегда отвечает JSON. HTML-страница с `Request ID` и IP в конце — подпись
защиты. Тем же ответом WAF подменила и бинарник раннера при скачивании: `curl`
без флага `-f` сохранил эту страницу в `/usr/local/bin/gitlab-runner`, а bash
потом пытался её исполнить («Syntax error: redirection unexpected»).

Скорее всего дело в том, что IP относится к дата-центровому диапазону
(`hosting: true`) — антиботы фильтруют такие сети почти всегда, независимо
от страны.

Что можно сделать, если CI нужен:

* написать в поддержку hub.mos.ru (кнопка «Написать в поддержку») и попросить
  разрешить трафик с этого IP, приложив `Request ID` из ответа;
* пустить раннер через прокси с разрешённого адреса
  (`systemctl edit gitlab-runner` → `Environment="HTTPS_PROXY=..."`);
* поднять раннер на машине, которая не в дата-центре: с домашнего интернета
  API отвечает нормально (проверено — приходит JSON, а не HTML).

Инструкция ниже остаётся рабочей — она понадобится, когда доступ появится.

## 0. Что должно быть

* Linux **x86_64** — проверить: `uname -m` (должно быть `x86_64`);
* **4 ГБ RAM и ~20 ГБ диска**: сборка тянет SDL3, QuickJS-ng, Box2D, RmlUi,
  Dear ImGui, glslang и SPIRV-Cross из исходников;
* root или `sudo`;
* интернет: раннер общается с hub.mos.ru, а контейнер — с репозиториями
  зависимостей.

## 1. Установка

```bash
uname -m    # ждём x86_64

sudo curl -L --output /usr/local/bin/gitlab-runner \
  https://hub.mos.ru/gitlab/runner/-/package_files/1185/download
sudo chmod +x /usr/local/bin/gitlab-runner
gitlab-runner --version

sudo useradd --comment 'GitLab Runner' --create-home gitlab-runner --shell /bin/bash
sudo gitlab-runner install --user=gitlab-runner --working-directory=/home/gitlab-runner
sudo gitlab-runner start
```

Проверить, что скачался настоящий бинарник, а не страница:

```bash
file /usr/local/bin/gitlab-runner
# Mach-O быть не должно: на VPS ожидаем ELF 64-bit ... x86-64
```

Если `uname -m` вернул `aarch64`, файл по ссылке выше не запустится — нужен
`gitlab-runner-linux-arm64`.

## 2. Docker

```bash
sudo apt-get update
sudo apt-get install -y docker.io
sudo usermod -aG docker gitlab-runner
sudo systemctl restart gitlab-runner

# Раннер должен видеть демон:
sudo -u gitlab-runner docker info | head -3
```

## 3. Регистрация

Токен берётся в **Settings → CI/CD → Runners → New project runner**.
Тег указывается ровно **`docker`** — его требуют все Linux-задания конвейера
(включая `lint`). «Run untagged jobs» включать не нужно.

```bash
sudo gitlab-runner register \
  --url https://hub.mos.ru/ \
  --registration-token <ТОКЕН_ИЗ_UI> \
  --executor docker \
  --docker-image ubuntu:24.04 \
  --tag-list docker \
  --description "vps-linux docker" \
  --non-interactive

sudo gitlab-runner verify
```

Если в UI показан токен вида `glrt-…`, это новый порядок регистрации:
используйте `--token glrt-…` вместо `--registration-token`.

**Токен — секрет.** Он даёт право регистрировать раннеры, которые получают
исходники проекта. Не публикуйте его; после настройки сбросьте:
Settings → CI/CD → Runners → ⋮ → Reset registration token.

## 4. Что ещё настроить в проекте

Windows-заданиям (`build_windows`, `test_windows`, `package_windows`) нужна
отдельная машина с тегом `windows,msvc`. Пока её нет, добавьте переменную,
иначе они будут вечно висеть в `pending`:

**Settings → CI/CD → Variables → `R2D_WINDOWS_CI` = `false`**

## 5. Проверка

```bash
systemctl status gitlab-runner --no-pager     # служба запущена
sudo gitlab-runner verify                     # раннер виден серверу
sudo journalctl -u gitlab-runner -n 50        # если что-то не так
```

Дальше достаточно запушить в `main` — конвейер подхватится сам. Готовые файлы
(`dist/`) собирает стадия `package`, релиз выпускается тегом `v*`.

## 6. Если не работает

| Симптом | Причина и что делать |
|---|---|
| Задания `pending`, раннер есть | Тег не совпал: у раннера должен быть `docker`. Проверить: `sudo gitlab-runner list` |
| `Cannot connect to the Docker daemon` | `sudo usermod -aG docker gitlab-runner && sudo systemctl restart gitlab-runner` |
| `fork/exec ... exec format error` | Скачан бинарник под другую архитектуру — сверьте `uname -m` и `file /usr/local/bin/gitlab-runner` |
| Сборка падает по памяти | Нужно ≥4 ГБ RAM; снизить параллелизм: в `.gitlab-ci.yml` у job'ов стоит `-j 2` |
| `No space left on device` | Нужно ~20 ГБ; чистить: `docker system prune -af` |
| Конвейер не создаётся вовсе | Конфиг не проходит линтер: CI/CD → Editor → Lint |


---

## Контракт модуля подсистемы `$`

<sub>источник: `docs/highlevel/_CONTRACT.md`</sub>

# Контракт модуля подсистемы `$`

Документ для разработчиков (в том числе ИИ-агентов), которые добавляют
подсистему в высокоуровневое API. Задача и общий план — в
[GAP_ANALYSIS.md](../GAP_ANALYSIS.md).

## 1. Один модуль — один файл

Подсистема живёт в **одном новом файле** `src/highlevel/<имя>.js` и экспортирует:

```js
export function install<Имя>($) { /* создать $.xxx, TAGS, методы узлов */ }
export function tick<Имя>(dt) { /* необязательно: шаг кадра */ }
```

Модуль уже импортирован и вызван в `src/highlevel/api.js` — **править `api.js`
не нужно и нельзя**: это интеграционная точка, у неё один писатель.

### Что категорически запрещено

* менять любые существующие файлы, кроме своего `src/highlevel/<имя>.js`;
* запускать `cmake`, сборку движка и Python-тесты — это делает интегратор
  (сборка встраивает все модули сразу, параллельные сборки ломают друг друга);
* переопределять уже существующие методы узла и пространства имён (см. §5);
* обращаться к `engine.*` на верхнем уровне модуля (только внутри функций) —
  иначе модуль нельзя протестировать вне движка.

## 2. Что доступно модулю

Импортом из ядра (только чтение, файлы не менять):

```js
import { ctx, Node, Wrapper, TAGS, wrap, wrapOne, query, def, defGet,
         packColor, withAlpha, nodeBounds, boundsOverlap, makeRandom,
         resolveSprite, sheetFrames } from './core.js';
import { registerNodeRenderer, registerUINodeRenderer } from './render.js';
import { cameraTransform } from './camera.js';
```

Ключевые объекты:

* `ctx.world / ctx.camera / ctx.input / ctx.time / ctx.sound / ctx.scene /
  ctx.ui / ctx.gfx / ctx.nodes / ctx.byId / ctx.byBody / ctx.log`;
* `TAGS[tag] = { ...defaults }` — объявление нового тега `<tag>`; `Node`
  читает `TAGS` в конструкторе, поэтому тег надо зарегистрировать в `install`.
* `def(name, fn)` / `defGet(name, fn, default)` — метод обёртки (цепочка) и
  геттер. Имя обязано быть уникальным.
* `engine` — глобальный низкоуровневый объект (`engine.whiteSprite`,
  `engine.width/height`, `engine.dt`, `engine.rgba`, `engine.createBody`,
  `engine.submitSprites`, `engine.raycast`, …).

## 3. Отрисовка нового тега

Ядро не знает про новые теги. Модуль рисует их сам:

```js
import { registerNodeRenderer } from './render.js';

registerNodeRenderer('tilemap', (node, t, cam) => {
    // t = { x, y, w, h } — прямоугольник узла на экране (центр x/y)
    // cam = { x, y, zoom, shake_x, shake_y, w, h }
    $.gfx.push.sprite(engine.whiteSprite, t.x, t.y, 32, 32, 0, packColor('#fff'));
});
```

`$.gfx.push` — общий батч кадра, лишних draw call'ов не создаёт:

| Вызов | Назначение |
|---|---|
| `$.gfx.push.sprite(sprite, x, y, w, h, angle, color)` | спрайт/прямоугольник, `x/y` — центр |
| `$.gfx.push.triangle(x1,y1,x2,y2,x3,y3,color)` | треугольник |
| `$.gfx.push.line(x1,y1,x2,y2,width,color)` | отрезок |
| `$.gfx.push.circle(cx,cy,r,color,segments)` | диск |
| `$.gfx.push.stats()` | `{ sprites, triangles }` в текущем кадре |

Отрисовщик вызывается **до** отсечения по камере: если у тега большой
собственный габарит, отсекайте себя сами (так делает `<tilemap>`).

Для тегов интерфейса — `registerUINodeRenderer(tag, (node, packedColor) => …)`.

## 4. Юнит-тесты без движка (обязательно)

Логика (математика, раскладка, парсинг, поиск пути) обязана быть проверяемой
без движка. Для этого:

```js
// tests/js/<имя>_test.mjs
import { test, eq, near, truthy, finish } from './_harness.mjs';
import { astar, buildGrid } from '../../src/highlevel/nav.js';

test('A* находит путь в обход стены', () => {
    eq(astar(...).length, 5);
});
finish();
```

Запуск (быстро, без сборки):

```bash
build/_deps/quickjs-build/qjs tests/js/<имя>_test.mjs
```

`tests/js/_harness.mjs` подставляет мок `engine` (прокси: неизвестный метод —
no-op) и даёт `test/eq/near/truthy/falsy/joined/finish`. Поэтому модуль должен
импортироваться без обращений к `engine` на верхнем уровне, а чистые функции —
экспортироваться наружу.

## 5. Пространства имён и имена методов

Уже занятые имена методов обёртки (переопределять **нельзя**):

```
add addClass addTag alpha angle animate append appendTo applyForce applyImpulse
at attr blend body bounce clearTweens collidesWith collision collisionCircle
color controls damage data delay depth detach each emit every fadeIn fadeOut
fadeTo filter first flash flip fontSize frame frames gravity has heal health
height hide hp html intensity invulnerable is jump kill last layer layerBits
lookAt map mask max maxHp move moveAndSlide moveTo moveTowards mute not off on
opacity outline overlaps pause pauseTweens playSound playing prepend prependTo
radius reduce region remove removeClass removeTag respawn resumeTweens rotate
rotateTo scale scaleTo sequence shader shaderParam shadow shake show size slice
some sound sprite stopAll stopAnim tag team text toggleClass trigger tween
tweenTo value velocity visible volume wake width
```

Геттеры: `alive angleTo children closest directionTo distanceTo find globalPos
hasClass inside isVisible onFloor onWall parent pos rayTo rotation siblings
toGlobal toLocal`.

Правила:

* пространство имён — своё: `$.anim`, `$.tilemap`, `$.particles`, `$.nav`,
  `$.prefab`, `$.audio`, `$.layers`, `$.ui` (дополнять, не заменять);
* новый метод узла называйте так, чтобы он не мог столкнуться: например
  `playClip`, `setTile`, `burst`, `navigateTo`, `toData`, `inLayer`;
* перед добавлением `def()` сверьтесь со списком выше.

## 6. Документация — обязательна

На подсистему: `docs/highlevel/<имя>.md` — назначение, все публичные функции
с сигнатурами, примеры, ограничения. Стиль и язык — как в
[HIGH_LEVEL_API.md](../HIGH_LEVEL_API.md): русский, таблицы, короткие примеры.

Раздел для главного справочника не правьте: интегратор сам вмержит ссылку и
сводку в `HIGH_LEVEL_API.md`.

## 7. Интеграционный тест движка

Полноценная проверка — Python-тест через агентский интерфейс, по образцу
`tests/agent/highlevel_api_test.py` (клиент — `tools/agent_client.py`):

* фикстура-игра: `tests/fixtures/<имя>/main.js` + `project.json`;
* тест: `tests/agent/highlevel_<имя>_test.py`, в нём `check(условие, описание)`
  и вывод «Все проверки пройдены»;
* запускать его будет интегратор после сборки — писать надо так, чтобы он
  проходил с первого раза: проверяйте то, что действительно реализовано.

## 8. Стиль кода

* комментарии и текст ошибок — по-русски, объясняйте «почему», а не «что»;
* отступ 4 пробела, точки с запятой, `const`/`let`, без `var`;
* длинные функции дробите: чистые помощники экспортируйте наружу (их тестирует
  qjs-харнесс);
* сообщение об ошибке должно подсказывать, что делать: `'$.tilemap: нужен
  src — путь к текстуре тайлсета'`.


---

## `$.anim` — анимация клипами и машина состояний

<sub>источник: `docs/highlevel/anim.md`</sub>

# `$.anim` — анимация клипами и машина состояний

Подсистема добавляет к `$` именованные анимационные **клипы** (аналог
`AnimationPlayer` в Godot 4) и **машину состояний** (аналог `AnimationTree`).
Она закрывает то, чего не хватало твинам: появление/смерть, атаку, двери,
UI-переходы, переключение анимаций по условию и по событию.

```js
$.ready(() => {
    $.anim.define('hit', {
        duration: 180,
        loop: 'once',
        tracks: [
            { prop: 'scale_x', keys: [{ t: 0, v: 1 }, { t: 1, v: 1.6, ease: 'quadOut' }] },
            { prop: 'scale_y', keys: [{ t: 0, v: 1 }, { t: 1, v: 1.6, ease: 'quadOut' }] },
        ],
        events: [{ at: 0.6, name: 'impact', data: { power: 10 } }],
    });

    const hero = $('<player>', { id: 'hero' }).at(100, 200).appendTo($.world);
    hero.playClip('hit');
    hero.on('key', (e) => { if (e.data.name === 'impact') $.sound.play('hit'); });
});
```

Чем клип отличается от твина:

| | Твин (`tween.js`) | Клип (`anim.js`) |
|---|---|---|
| Что это | одноразовый переход `A → B` за время | timeline с ключами и режимом |
| Длительность | задаётся в вызове | часть объявления клипа |
| Повтор | нет | `once` / `loop` / `pingpong` |
| События | нет | `events: [{ at, name }]` в процентах |
| Состояния | нет | `.stateMachine()` |
| Возврат | Promise | цепочка `$` |

Клипы и твины не конфликтуют, если трогают разные свойства: узел может
одновременно ехать `.moveTo()` и «дышать» клипом по `alpha`.

---

## `$.anim`

### `$.anim.define(name, spec)`

Объявляет (или переобъявляет) клип с именем `name`. Возвращает `$`.

`spec`:

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `duration` | число, мс | — (обязательно, `> 0`) | длина клипа |
| `loop` | `'once' \| 'loop' \| 'pingpong'` | `'once'` | режим воспроизведения |
| `speed` | число | `1` | множитель скорости по умолчанию |
| `tracks` | массив | `[]` | дорожки свойств |
| `events` | массив | `[]` | события в процентах клипа |

Некорректный `duration` или `loop` бросает исключение (`$.anim.define: у
клипа "..." нужен duration > 0 (мс)`) — лучше упасть при загрузке, чем
молча показывать неживую анимацию.

### Дорожки (`tracks`)

Три вида дорожек, различаются по полям объекта:

**1. Свойство узла — `{ prop, keys }`:**

```js
{ prop: 'alpha', keys: [{ t: 0, v: 1 }, { t: 0.5, v: 0.3 }, { t: 1, v: 1 }] }
{ prop: 'x',     keys: [{ t: 0, v: 0 }, { t: 1, v: 120, ease: 'quadOut' }] }
```

* `t` — момент в долях клипа `0..1` (сортируется автоматически, значения
  вне диапазона зажимаются);
* `v` — значение;
* `ease` — необязательная плавность на участке.

Доступные `prop` (пишутся напрямую, без физики):

`x`, `y`, `angle`, `scale_x`, `scale_y`, `alpha`, `width`, `height`,
`radius`, `intensity`. Синонимы: `rotation` → `angle`, `scaleX`/`scaleY`,
`opacity` → `alpha`, `w`/`h`. Любое другое имя пишется в `node.attrs`.

`angle` — в радианах (как `node.angle`), `scale_x`/`scale_y` — множители,
`alpha` — `0..1`. Это ровно те поля, что читает отрисовка, поэтому клип
виден на экране без единого дополнительного слоя.

**2. Произвольное свойство — `{ fn }`:**

```js
{ fn: (node, k) => { node.attrs.glow = k * 2; } }
```

`k` — прогресс клипа `0..1` (для `pingpong` он ходит вперёд-назад). Третий
аргумент — `{ clip, u, time, name }`.

**3. Кадры спрайт-листа — `{ anim }`:**

```js
// узел уже получил кадры через .frames({ src, cols, rows, cw, ch })
{ anim: true }                                  // весь лист
{ anim: { from: 2, to: 5 } }                    // диапазон кадров
```

Кадр выбирается по прогрессу клипа: `index = from + floor(phase * span)`.
Скорость смены кадров задаётся `duration` клипа, а не отдельным счётчиком.

### Плавности (`ease`)

Те же кривые, что у твинов (`tween.js`), плюс короткие псевдонимы:
`linear`, `quadIn`, `quadOut`, `quadInOut`, `cubicIn`, `cubicOut`,
`cubicInOut`, `quartIn/Out/InOut`, `sineIn/Out/InOut`, `backIn/Out/InOut`,
`elasticIn/Out`, `bounceIn/Out`, `in`, `out`, `inOut`, `step` и длинные
имена (`easeInQuad`, `easeOutBounce`, …).

Плавность берётся у **ключа-назначения** (правого), а если её там нет — у
начального. Поэтому работают обе привычные записи:

```js
[{ t: 0, v: 0 }, { t: 1, v: 100, ease: 'quadOut' }]   // ease «на приезде»
[{ t: 0, v: 0, ease: 'quadIn' }, { t: 1, v: 100 }]    // ease «на выезде»
```

Если `ease` не указан вовсе — участок линейный.

### События (`events`)

```js
events: [
    { at: 0.0, name: 'start' },
    { at: 0.5, name: 'impact', data: { power: 10 } },
]
```

`at` — доля клипа `0..1`. В момент события узел получает два события:

* `'key'` с данными `{ name, data, at, clip, clipName }`;
* событие с собственным именем (`'impact'`) и теми же данными.

Событие `at: 0` срабатывает сразу в `playClip()`. Для `loop` события
повторяются каждый цикл; для `pingpong` — раз за прямой проход.

### `$.anim.get(name)`

Нормализованный клип (`{ name, duration, loop, speed, tracks, events }`) или
`null`.

### `$.anim.has(name)`

`true`, если клип объявлен.

### `$.anim.list()`

Массив имён всех клипов.

### `$.anim.remove(name)`

Удаляет клип, возвращает `true`, если он был.

### `$.anim.clear()`

Удаляет все клипы. Возвращает `$`.

---

## Методы узла

### `.playClip(name, opts)`

Запускает клип. Нулевой кадр применяется сразу, ещё до первого `tickAnim`.

`opts`:

| Поле | Тип | Смысл |
|---|---|---|
| `speed` | число | множитель скорости (переопределяет `spec.speed`) |
| `loop` | строка | режим (переопределяет `spec.loop`) |
| `onEnd` | функция | вызов при завершении клипа `once`; аргумент — узел |
| `restart` | bool | `true` — перезапустить даже тот же клип |

Повторный `.playClip()` того же клипа **не** сбрасывает время: игровой код
может звать его каждый кадр без «дёрганья». Нужен сброс — `{ restart: true }`.

```js
$('#hero').playClip('run', { speed: 1.5, loop: 'loop' });
$('#hero').playClip('die', { onEnd: (node) => node.remove() });
```

Если клип не объявлен, вызов пишет подсказку в журнал и ничего не делает.

### `.stopClip()`

Останавливает клип и забывает его. Свойства узла остаются в последнем
состоянии (сброса нет — это осознанно: анимация не «телепортирует» узел).

### `.pauseClip()` / `.resumeClip()`

Ставит время клипа на паузу и снимает её. `isPlayingClip()` на паузе
остаётся `true`: клип не завершён, он ждёт.

### `.isPlayingClip()`

`true`, пока клип активен (в том числе на паузе). `false` после `once`-конца
или `.stopClip()`.

### `.clipTime()`

Текущее время внутри клипа в **миллисекундах**: `phase * duration`. Для
`loop`/`pingpong` это время внутри цикла, а не суммарное.

### `.clipProgress()`

Прогресс `0..1` (`phase`). На `once`-конце равен `1`.

### `.clipSpeed(value)`

Без аргумента — текущая скорость. С аргументом — задаёт скорость и
возвращает цепочку.

---

## Машина состояний

### `.stateMachine(spec)`

```js
$('#hero').stateMachine({
    initial: 'idle',
    states: {
        idle: { clip: 'idle-anim', loop: 'loop' },
        run:  { clip: 'run-anim',  loop: 'loop', speed: 1.2 },
        die:  { clip: 'die-anim',  loop: 'once', next: 'idle' },
    },
    transitions: [
        { from: 'idle', to: 'run',  when: (n) => Math.abs(n.velocity_cache.x) > 1 },
        { from: 'run',  to: 'idle', when: (n) => Math.abs(n.velocity_cache.x) <= 1 },
        { from: 'idle', to: 'die',  on: 'damaged' },
    ],
});
```

`spec`:

| Поле | Смысл |
|---|---|
| `initial` | имя стартового состояния (если его нет — берётся первое из `states`) |
| `states` | `{ имя: { clip, loop, speed, next } }` |
| `transitions` | массив правил перехода |

Состояние без `clip` — легальная заглушка: оно активно, ждёт перехода.

Переход `{ from, to, when, on }`:

* `from` — имя состояния или `'*'` (любое);
* `to` — имя состояния;
* `when(node)` — условие, проверяется каждый кадр;
* `on` — триггер:
  * `on: 'event'` (или отсутствует) — переход «условный», срабатывает по `when`;
  * `on: '<имя>'` — переход по событию узла с этим именем
    (`node.emit('damaged')`);
  * `on: 'signal'` + `signal: '<имя>'` — то же самое явной парой.

Событийные переходы имеют приоритет над условными в одном кадре. Первое
подходящее правило выигрывает.

`next` у состояния — «доиграл клип и дальше»: когда `once`-клип
завершается, машина сама переходит в `next`.

Событийные переходы подписываются на узел один раз при объявлении, поэтому
`.stateMachine()` не плодит обработчиков при повторных вызовах.

### `.toState(name)`

Принудительный переход (например, из игрового кода по «смерти»).

### `.state()` / `.stateTime()` / `.states()`

* `.state()` — имя текущего состояния или `null`;
* `.stateTime()` — время в состоянии в **секундах** (как `dt` в цикле);
* `.states()` — массив имён состояний.

---

## События

| Событие | Когда | `e.data` |
|---|---|---|
| `clipEnd` | `once`-клип доиграл | `{ clip, name, node }` |
| `key` | событие внутри клипа | `{ name, data, at, clip, clipName }` |
| `<имя события>` | то же, что `key`, но под своим именем | то же |
| `stateEnter` | вход в состояние (включая `initial`) | `{ state, prev, node }` |
| `stateExit` | выход из состояния | `{ state, next, node }` |

```js
$('#door').on('stateEnter', (e) => {
    if (e.data.state === 'open') $.sound.play('door');
});
$('#door').on('clipEnd', (e) => $.log('клип', e.data.name, 'закончился'));
```

---

## Чистые функции (для тестов и инструментов)

Экспортируются из `src/highlevel/anim.js` и не требуют движка:

| Функция | Что делает |
|---|---|
| `normalizeKeys(keys)` | проверяет ключи, зажимает `t`, сортирует |
| `sampleKeys(keys, t)` | значение дорожки на прогрессе `t` (с учётом `ease`) |
| `chooseEase(ease)` | функция плавности по имени/функции (понимает `quadIn` и т. п.) |
| `clipPhase(u, loop)` | фаза `0..1` из «единиц длительности» `u` |
| `eventsBetween(events, fromU, toU)` | события, попавшие в интервал (с повторами) |
| `evalClip(clip, timeMs)` | `{ u, phase, done, values }` на момент времени |
| `normalizeClip(name, spec)` | проверка и нормализация объявления |
| `animEases()` | список всех имён плавностей |

Проверка без сборки движка:

```bash
build/_deps/quickjs-build/qjs tests/js/anim_test.mjs
```

---

## Ограничения и особенности

* Клипы **не трогают физику**: `x`/`y` пишутся в поля узла напрямую, тела
  Box2D не переносятся. Для движения тела используйте твины/скорость.
* Скорость клипа может быть отрицательной — время пойдёт назад; события при
  этом не срабатывают (интервал считается только вперёд).
* Событие `at: 1` в `once`-клипе успевает сработать до фиксации конца.
* Пауза клипа не останавливает машину состояний: `.stateTime()` и проверки
  `when` продолжают идти.
* `.playClip()` на узле с машиной состояний меняет клип до ближайшего
  перехода — сама машина остаётся активной.
* Имя `$.anim` и методы `.playClip()`, `.stateMachine()` и т. п. не
  пересекаются с именами ядра (`animate`, `pause`, `sequence`, …).


---

## Аудио-шины и эффекты — `$.audio`

<sub>источник: `docs/highlevel/audiobus.md`</sub>

# Аудио-шины и эффекты — `$.audio`

`$.audio` дополняет существующий `$.sound` (не заменяет его) и повторяет
идею `AudioServer`/`AudioBusLayout` + `AudioEffect` из Godot 4: звук
маршрутизируется в именованную **шину**, у шины есть громкость, mute, solo,
родитель и эффект. Дерево по умолчанию: `master → sfx`, `master → music` —
любая шина, у которой не указан `parent`, вешается на `master`.

Физически движок не знает про шины: у него есть громкость, панорама и эффект
на **канале**. Слой шин живёт в JS поверх `engine.audio.*`:

* при запуске звука его канал сразу получает громкость шины;
* при смене громкости/mute/solo шины громкость **всех её живых каналов
  пересчитывается немедленно** (через `engine.audio.setChannelVolume`);
* эффект шины накладывается на каналы её живых звуков
  (`engine.audio.setChannelEffect`).

```js
$.ready(() => {
    $.audio.bus('music', { volume: 0.6 });
    $.audio.bus('ui', { parent: 'music', volume: 0.5 });

    // Шина 'music' — обычный маршрут для звуков через $.audio; отдельная
    // музыкальная дорожка движка ($.sound.music) живёт вне дерева шин.
    $.audio.play('assets/audio/music/action.ogg', { bus: 'music', loop: true, volume: 0.7 });

    // Обычный звук в шине ui: слышен с громкостью 0.5 × 0.6.
    const click = $.audio.play('assets/audio/sfx/pickup_01.ogg', { bus: 'ui' });

    // Позиционный звук — панорама и затухание от слушателя (по умолчанию камера).
    $.audio.playAt('assets/audio/sfx/hurt_01.ogg', 640, 300, { bus: 'sfx' });

    click.stop(150);                 // плавно погасить
    $.audio.mute('music', true);     // мгновенно заглушить всю ветку music
    $.audio.fadeBus('ui', 0, 800);   // плавно увести шину в тишину
});
```

---

## 1. Шины

| Метод | Назначение |
|---|---|
| `$.audio.bus(name, opts?)` | создать или получить шину; возвращает живой объект шины |
| `$.audio.buses()` | массив шин со состоянием (копии) |
| `$.audio.remove(name)` | удалить шину, детей переподчинить её родителю |
| `$.audio.clear()` | снять все шины, остановить их звуки, вернуть слушателя камере |

`opts` (все поля необязательны, при повторном вызове обновляют шину):

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `volume` | 0..1 | `1` | собственная громкость шины |
| `muted` | bool | `false` | заглушить шину и её потомков |
| `solo` | bool | `false` | оставить слышимыми только solo-ветку |
| `parent` | имя / `'master'` | `'master'` | родитель в дереве; цикл отклоняется |
| `effect` | `'none'\|'lowpass'\|'echo'` | `'none'` | эффект шины |
| `effectParams` | объект | `{}` | параметры эффекта (см. §3) |

`master` — не отдельная шина, а корень дерева и общая громкость движка.
`$.audio.bus('master')` вернёт `null` с подсказкой в журнале: мастер задаётся
через `$.audio.masterVolume()` / `$.audio.volume(0..1)`.

Создавать `sfx` заранее не нужно: `$.audio.play(...)` без `bus` сам заводит
шину `sfx` и маршрутизирует звук в неё. Шина, названная в `bus`/`playAt`,
тоже создаётся автоматически, если её ещё нет.

---

## 2. Громкость, mute, solo

| Метод | Что делает |
|---|---|
| `$.audio.volume(name)` | эффективная собственная громкость шины |
| `$.audio.volume(name, v)` | задать собственную громкость шины (0..1) |
| `$.audio.volume(v)` | задать общую громкость (прокси к `$.sound.volume`) |
| `$.audio.mute(name)` / `$.audio.mute(name, bool)` | прочитать / задать mute |
| `$.audio.solo(name)` / `$.audio.solo(name, bool)` | прочитать / задать solo |
| `$.audio.gain(name)` | эффективная громкость с учётом родителей, mute и solo |
| `$.audio.masterVolume(v?)`, `$.audio.sfxVolume(v?)`, `$.audio.musicVolume(v?)` | прокси к `$.sound` без дублирования логики |

Эффективная громкость = произведение собственных громкостей по цепочке
родителей. Общая громкость (`master`) применяется движком ко всему миксу и в
громкость канала не входит, иначе она умножалась бы дважды.

**Mute** шины обнуляет её саму и всех потомков, но не трогает соседей.

**Solo** (если хотя бы одна шина помечена solo) оставляет слышимыми только:
саму solo-шину, её **потомков** (дочерние шины продолжают звучать) и её
**предков** (чтобы путь к мастеру не обрывался). Все остальные шины получают
эффективную громкость `0`. Так, при `music.solo = true` и дереве
`master → music → ui`, `master → ambient`: `ui` слышен, `ambient` — нет.

---

## 3. Эффекты

| Метод | Назначение |
|---|---|
| `$.audio.effect(name, kind, params?)` | задать эффект шины; без `kind` — прочитать текущий |
| `$.audio.effects()` | список доступных имён из `engine.audio.effectCount()/effectName()` |
| `handle.effect(kind, params?)` | личный эффект конкретного звука (перебивает шинный) |

Эффект шины применяется к каналам уже играющих звуков шины. Если у конкретного
handle вызван `.effect(...)`, смена эффекта шины его больше не задевает.

| `kind` | `params` | Смысл |
|---|---|---|
| `'none'` | — | без эффекта |
| `'lowpass'` | `{ freq }` или `{ cutoff }`, Гц (по умолчанию `1200`) | срез высоких частот: «глухой» звук за стеной, под водой |
| `'echo'` | `{ delay }` мс (по умолчанию `250`), `{ feedback }` 0..0.9 (по умолчанию `0.35`) | эхо; доля повтора обрезается до 0.9 |

```js
$.audio.bus('underwater', { parent: 'sfx' });
$.audio.effect('underwater', 'lowpass', { freq: 700 });
$.audio.effect('cave', 'echo', { delay: 320, feedback: 0.5 });
console.log($.audio.effects());   // ['none', 'lowpass', 'echo']
```

**Честные ограничения эффектов:**

* SDL_mixer 3.2 даёт ровно три эффекта — `none`, `lowpass`, `echo`. **Реверба
  нет**; «пещерный» реверб эмулируется только эхом с большой задержкой и
  повтором, это не полноценный reverb;
* эффект живёт на канале, а не на шине: звуки, запущенные напрямую через
  `$.sound.play` (мимо `$.audio`), эффекта шины не получат;
* смена эффекта не перезапускает звук — слышно на уже играющих каналах;
* `lowpass`/`echo` могут быть недоступны в конкретной сборке микшера: тогда
  `engine.audio.setChannelEffect` вернёт `false`, `$.audio` молча продолжит
  работу.

---

## 4. Запуск звуков и handle

| Метод | Назначение |
|---|---|
| `$.audio.play(pathOrId, opts)` | обёртка над `$.sound.play` с маршрутизацией в шину |
| `$.audio.playAt(pathOrId, x, y, opts)` | позиционный звук от слушателя/камеры |
| `$.audio.listener(x, y)` / `$.audio.listener()` | задать / прочитать слушателя (по умолчанию — камера) |
| `$.audio.handles()` | массив активных handle'ов |
| `$.audio.stopBus(name, fadeMs)` | остановить звуки шины и её потомков |
| `$.audio.stopAll(fadeMs)` | остановить всё (прокси к `$.sound.stopAll`) |

`opts`: `{ bus, volume, pan, loop, at: [x,y], falloff }`.

* `bus` — имя шины (по умолчанию `sfx`);
* `volume` — 0..1, умножается на эффективную громкость шины;
* `pan` — -1..1, перебивается расчётом при `at`;
* `loop` — зацикливать ли звук;
* `at` — `[x, y]` (или `{x,y}`) в мировых координатах: включает позиционный
  расчёт, как у `playAt`;
* `falloff` — число (радиус слышимости, px) или `{ max }` (по умолчанию `700`).

`$.audio.play(...)` возвращает **handle**:

```js
const h = $.audio.play('assets/audio/sfx/hurt_01.ogg', { bus: 'sfx', volume: 0.8 });

h.channel;          // номер канала движка или -1, если звук не поднялся
h.bus;              // имя шины
h.path;             // путь/ид звука
h.stop(fadeMs);     // остановить (fadeMs > 0 — плавно)
h.volume();         // текущая личная громкость
h.volume(0.3);      // задать; канал пересчитается сразу
h.pan(); h.pan(p);  // панорама
h.effect(kind, params?);   // личный эффект поверх шинного
h.playing();        // играет ли канал сейчас
```

Handle'ы автоматически чистятся: после `h.stop(...)`, а также когда движок сам
освободил канал (звук доиграл), запись исчезает из `$.audio.handles()` в
ближайшем `tickAudiobus`. Поэтому долгоживущая игра не накапливает «мёртвые»
handle'ы.

### Позиционное звучание

`playAt` (и `play` с `opts.at`) считает панораму и затухание относительно
слушателя:

* расстояние `dist` от слушателя до источника;
* `gain = 1 - dist / max` (0 за границей слышимости);
* `pan = clamp(dx / (max/2), -1, 1)` — источник справа звучит в правом ухе.

```js
$.audio.listener($('#hero').pos().x, $('#hero').pos().y);   // ручной слушатель
$.audio.playAt('boom.ogg', 900, 200, { bus: 'sfx', falloff: { max: 900 } });
```

Без вызова `$.audio.listener(...)` слушателем считается центр камеры, то есть
поведение совпадает с `$.sound.playAt`.

---

## 5. Затухания (fade)

| Метод | Назначение |
|---|---|
| `$.audio.fadeBus(name, value, ms)` | плавно перевести громкость шины к `value` за `ms` |
| `$.audio.fadeHandle(handle, value, ms)` | плавно перевести личную громкость звука |

Затухания ведутся существующим движком твинов (`tweenProps`) и применяются в
`tickAudiobus(dt)` — кадр не блокируется. `ms = 0` применяет значение сразу.
Повторный fade по той же цели заменяет предыдущий, чтобы два затухания не
спорили за одну громкость.

---

## 6. Деградация без звука

Если движок собран с `R2D_ENABLE_AUDIO=OFF` (или звуковое устройство
недоступно), `engine.audio.play` вернёт `-1`. Тогда:

* `$.audio.play` / `playAt` не бросают исключение, а возвращают handle с
  `channel === -1`;
* `h.playing()` возвращает `false`, `h.stop(...)` ничего не делает;
* шины, громкость, mute, solo и эффекты продолжают работать как чистая логика
  (их состояние видно через `$.audio.buses()` и `$.audio.gain(name)`).

---

## 7. Чистые функции

Экспортируются из `src/highlevel/audiobus.js` и тестируются qjs без движка:

```js
import { effectiveGain, panAndGain } from '../../src/highlevel/audiobus.js';

effectiveGain(buses, 'ui');      // громкость с родителями, mute и solo
panAndGain(listener, source, { max: 700 });  // { pan, gain, dist }
```

`buses` — `Map` или словарь `{ имя: { volume, muted, solo, parent } }`.

---

## 8. Ограничения

* Нет реверба и фильтров, кроме `lowpass`/`echo`: это всё, что даёт SDL_mixer
  3.2 (см. §3).
* Нет поканального «отправления» в несколько шин: один звук живёт в одной шине.
* Эффект и громкость применяются к каналу, поэтому уже доигранные или
  остановленные каналы пересчитывать нечего; «мёртвые» handle'ы вычищаются.
* Микрофон/захват, задержки на шине и sidechain-сжатие не поддерживаются.
* `$.sound` продолжает работать как раньше; звуки, запущенные им напрямую, не
  маршрутизируются в шины и не видны в `$.audio.handles()`.
* Музыкальная дорожка движка (`$.sound.music`) — отдельный трек микшера, она
  не входит в дерево шин; для неё есть только `$.audio.musicVolume(v)`.


---

## HTTP-запросы — `$.http`

<sub>источник: `docs/highlevel/http.md`</sub>

# HTTP-запросы — `$.http`

`$.http` ходит в сеть так, чтобы не останавливать кадр: запрос ставится в
очередь, движок продвигает его по частям, а `Promise` разрешается в кадровом
`tickHttp()`. Игре не нужны ни колбэки, ни ручной опрос — только `.then()` или
`await`.

```js
$.ready(() => {
    $.http.get('http://localhost:8080/score')
        .then((res) => $.store.set('score', res.json().score))
        .catch((e) => $.log(e.message));
});

// то же самое, но по-современному
const level = await $.http.json('http://localhost:8080/level/1');
```

Подсистема не ходит в интернет сама по себе: всё, что делает игра, делает через
`$.http`. Если сети нет или сборка без HTTP, запрос **отклоняется** понятной
ошибкой — зависших `Promise` не бывает.

---

## 1. Быстрый старт

```js
// GET
const res = await $.http.get('http://localhost:8080/ping');
res.status;      // 200
res.ok;          // true
res.body;        // '{"pong":true}'
res.json();      // { pong: true }
res.headers;     // { 'content-type': 'application/json', ... }
res.timeMs;      // сколько занял запрос

// POST: объект уходит как JSON, Content-Type подставляется сам
await $.http.post('http://localhost:8080/save', { hp: 42, name: 'герой' });

// PUT / DELETE
await $.http.put('http://localhost:8080/item/1', { hp: 10 });
await $.http.delete('http://localhost:8080/item/1');

// JSON и текст — сразу тело
const data = await $.http.json('http://localhost:8080/level/1');
const html = await $.http.text('http://localhost:8080/page');

// скачать в файл рядом с игрой (нужен $.fs из модуля store)
await $.http.download('http://localhost:8080/pack.json', 'downloads/pack.json');
```

---

## 2. Методы

| Метод | Возвращает | Назначение |
|---|---|---|
| `$.http.get(url, opts?)` | `Promise<ответ>` | GET-запрос |
| `$.http.post(url, body?, opts?)` | `Promise<ответ>` | POST; `body` — строка или объект (→ JSON) |
| `$.http.put(url, body?, opts?)` | `Promise<ответ>` | PUT |
| `$.http.delete(url, opts?)` | `Promise<ответ>` | DELETE (алиас `$.http.del`) |
| `$.http.request(opts)` | `Promise<ответ>` | произвольный запрос; `opts.url` обязателен |
| `$.http.json(url, opts?)` | `Promise<any>` | запрос и `JSON.parse` тела |
| `$.http.text(url, opts?)` | `Promise<string>` | запрос и тело строкой |
| `$.http.download(url, path)` | `Promise<{path,bytes,status,response}>` | GET и запись тела в файл |
| `$.http.pending()` | `number` | сколько запросов ещё не завершено |
| `$.http.backend()` | `строка` | `'curl' \| 'socket' \| 'mock' \| 'none'` |
| `$.http.available()` | `bool` | есть ли чем выполнять запросы |
| `$.http._setBackend(fn)` | `$.http` | подмена бэкенда для тестов и офлайна |

`url` может быть и первым аргументом, и полем `opts`: `$.http.json({ url, method })`.

`download()` пишет тело **как текст** (UTF-8): так сохраняются JSON, тексты,
разметка и таблицы. Двоичные файлы (PNG, OGG, архивы) этим путём не скачать —
движок отдаёт тело строкой, и байты вне UTF-8 заменяются. Для картинок и
звука держите их в грузе или рядом с игрой.

---

## 3. `opts`

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `url` | строка | — | адрес; обязателен |
| `method` | строка | `'GET'` | `GET`, `POST`, `PUT`, `DELETE`, `PATCH`… |
| `headers` | объект/массив | — | `{ 'X-A': '1' }` или `['X-A', '1']` |
| `body` | строка/объект | — | строка как есть; объект → JSON |
| `json` | любое | — | сериализуется в тело, ставит `Content-Type: application/json` |
| `query` | объект | — | добавляется к URL: `{ q: 'да' }` → `?q=%D0%B4%D0%B0` |
| `timeout` | мс | `15000` | таймаут запроса; по истечении — `reject` |

```js
await $.http.post('http://localhost:8080/login',
    { user: 'кот' },
    { headers: { 'X-Game': 'demo' }, timeout: 3000, query: { v: 2 } });
```

---

## 4. Ответ

Все методы запроса разрешаются одним и тем же объектом:

| Поле/метод | Тип | Смысл |
|---|---|---|
| `status` | `number` | HTTP-код; `0`, если запрос не дошёл |
| `ok` | `bool` | `true` для 2xx |
| `body` | `string` | тело ответа как есть |
| `headers` | `object` | заголовки, имена в нижнем регистре |
| `error` | `string \| null` | текст ошибки транспорта, если была |
| `timeMs` | `number` | время запроса в миллисекундах |
| `url` | `string` | фактический URL (с query) |
| `text()` | `string` | тело строкой |
| `json()` | `any` | `JSON.parse(body)`; бросает на невалидном JSON |

HTTP-статус 4xx/5xx **не** отклоняет `Promise`: это состоявшийся запрос, и
игра сама решает, смотреть `res.ok` или нет. `reject` случается только при
транспортной ошибке (нет соединения, таймаут, невалидный URL, нет бэкенда) —
либо у `$.http.json()`, если тело не разобралось.

---

## 5. Ошибки и деградация

Текст ошибки всегда начинается с `$.http: ` и объясняет причину по-русски:

| Ситуация | Что в `reject` |
|---|---|
| нет соединения | `$.http: не удалось подключиться к серверу: …` |
| таймаут | `$.http: таймаут запроса` |
| невалидный URL | `$.http: невалидный URL: нужен http:// или https://` |
| HTTPS без libcurl | `$.http: https недоступен: движок собран без libcurl…` |
| HTTP выключен при сборке | `$.http: нет доступного HTTP-бэкенда — движок собран без HTTP` |
| тело не JSON | `$.http: ответ не является JSON: …` |

`Promise` завершается **всегда**: даже если бэкенда нет вовсе, запрос
отклоняется сразу на месте. Ошибка не роняет кадр — её достаточно поймать:

```js
$.http.get(url).catch((e) => $.log(e.message));
```

Сборка без libcurl оставляет аварийный сокетный бэкенд: он умеет только
`http://`, а на `https://` честно отвечает ошибкой.

---

## 6. Подмена бэкенда (тесты и офлайн)

`$.http._setBackend(fn)` заменяет настоящую сеть функцией
`fn(request) → результат | null`. `null` означает «запрос ещё в работе», и
`tickHttp()` вызовет `fn` снова — так проверяется очередь `Promise` без сети:

```js
$.http._setBackend(() => ({ status: 200, body: '{"n":5}', headers: '' }));
$.http.get('http://local.test/').then((r) => r.json().n);   // 5
$.http._setBackend(null);   // вернуть настоящий движок
```

`$.http.backend()` в этом режиме возвращает `'mock'`, `$.http.available()` —
`true`.

---

## 7. Как это устроено

```
$.http (src/highlevel/http.js)  ──►  engine.http.* (src/http.c)
        Promise-очередь                  неблокирующий клиент
        tickHttp(dt) каждый кадр          ├─ libcurl (curl_multi): http + https
                                          └─ встроенный сокет: только http
```

Низкоуровневый контракт — в `src/http.h`:

| Функция | Смысл |
|---|---|
| `r2d_http_init()` / `r2d_http_shutdown()` | поднять/остановить бэкенд |
| `r2d_http_request(method, url, body, names, values, count, timeout_ms)` | поставить запрос, вернуть `id` |
| `r2d_http_poll(id, out)` | забрать готовый результат (иначе `false`) |
| `r2d_http_cancel(id)` | отменить и освободить запись |
| `r2d_http_update()` | продвинуть все запросы; вызывается раз в кадр |
| `r2d_http_active()` / `r2d_http_available()` / `r2d_http_backend()` | состояние |
| `r2d_http_free(&result)` | освободить строки результата |

В JS видны `engine.http.request/poll/cancel/active/backend/available`.

---

## 8. Ограничения

* одновременно может висеть не больше 64 запросов; освобождение — `poll`/`cancel`;
* сокетный бэкенд (без libcurl) не умеет TLS, прокси и сжатие — только `http://`;
* редиректы ограничены пятью переходами;
* `download()` пишет файл через `$.fs` (модуль `store`) и перезаписывает его;
* `body` в ответе — строка; для бинарных данных игра сама решает, что с ней делать;
* модуль обязан инициализироваться без движка, поэтому `engine` трогается только
  внутри функций — это проверяет `tests/js/http_test.mjs`.


---

## Локализация и ввод — `$.i18n`, `$.tr` и дополнения `$.input`

<sub>источник: `docs/highlevel/i18n.md`</sub>

# Локализация и ввод — `$.i18n`, `$.tr` и дополнения `$.input`

Подсистема `i18n.js` даёт словари, перевод строк с подстановкой параметров,
плюрализацию и автоподстановку текста в узлы. Вторая часть документа —
новые методы `input.js`: мёртвая зона осей и сохранение привязок.

```js
$.ready(() => {
    $.i18n.add('ru', { 'menu.play': 'Играть' });
    $.i18n.add('en', { 'menu.play': 'Play' });
    $.i18n.lang('ru');
    $.i18n.auto(true);

    $('<ui.label>', { tr: 'menu.play' }).at(400, 60).appendTo($.ui);
    $.tr('menu.play');                 // → 'Играть'
});
```

---

## 1. Словари и языки — `$.i18n`

| Метод | Назначение |
|---|---|
| `$.i18n.add(lang, dict)` | добавить/дополнить словарь языка; повторный `add` сливает ключи |
| `$.i18n.load(lang, urlOrPath)` | загрузить словарь из JSON-файла |
| `$.i18n.load(path)` | то же, код языка берётся из имени файла (`i18n/en.json` → `en`) |
| `$.i18n.lang([code])` | без аргумента — текущий язык, с аргументом — переключить |
| `$.i18n.fallback([code])` | запасной язык (по умолчанию `ru`) |
| `$.i18n.langs()` | коды всех загруженных языков, по алфавиту |
| `$.i18n.has(key)` | есть ли перевод ключа (текущий язык → запасной → любой загруженный) |

Словарь — объект `{ 'ключ': 'текст' }`. Значение может быть массивом форм для
плюрализации (см. §3). `$.i18n.load` читает файл через `$.fs.readJSON`;
вместо пути можно передать готовый объект словаря (удобно в тестах).

```js
$.i18n.load('en', 'i18n/en.json');
$.i18n.load('i18n/ru.json');           // язык угадан по имени файла
$.i18n.lang('en');
$.i18n.langs();                        // → ['en', 'ru']
```

## 2. Перевод строк — `$.tr`

`$.tr(key, params?, fallback?)` возвращает перевод, подставляя `{name}` из
`params`. Если ключа нет — возвращает `fallback`, а без него сам `key`, и
**один раз** пишет предупреждение в лог (повторные вызовы не спамят).

```js
$.i18n.add('ru', { 'hud.score': 'Очки: {score}', 'hud.time': 'Время: {t} с' });
$.tr('hud.score', { score: 120 });     // → 'Очки: 120'
$.tr('нет.такого');                    // → 'нет.такого' + предупреждение
$.tr('нет.такого', {}, '—');           // → '—'
```

Неизвестный параметр в шаблоне остаётся как есть (`'{name}'`), чтобы опечатка
была видна, а не превращалась в `undefined`.

## 3. Плюрализация — `$.i18n.plural`

Значение ключа-массива трактуется как формы. `$.i18n.plural(key, count)`
выбирает форму по числу и подставляет `{n}`.

```js
$.i18n.add('ru', {
    'item': ['{n} штука', '{n} штуки', '{n} штук'],
});
$.i18n.plural('item', 1);    // → '1 штука'
$.i18n.plural('item', 3);    // → '3 штуки'
$.i18n.plural('item', 11);   // → '11 штук'
$.i18n.plural('item', 21);   // → '21 штука'
```

Правила упрощены, но крайние случаи учтены:

| Язык | Формы |
|---|---|
| `ru` (и `uk`, `be`) | 1, 21, 101 → форма 1; 2–4, 22–24 → форма 2; 0, 5–20, 11–14 → форма 3 |
| `en` | 1 → форма 1; всё остальное → форма 2 |
| прочие | 1 → форма 1; иначе форма 2 |

Если форм меньше, чем вернул индекс, берётся последняя. `.plural()` можно
спросить и как `$.tr.plural(key, count)`.

## 4. Автоподстановка в узлы — `$.i18n.auto`

`$.i18n.auto(true)` включает перевод узлов с атрибутом `tr`. Текст
обновляется при появлении узла и при каждой смене языка или словаря —
этим занимается `tickI18n()`, который `api.js` вызывает каждый кадр.

```js
$.i18n.auto(true);
$('<ui.label>', { tr: 'menu.play' }).appendTo($.ui);   // текст станет переводом

// Число рядом с ключом даёт плюральную форму:
$('<ui.label>', { tr: { key: 'item', n: 3 } });
```

Если на узле с `tr` вызвать `.text('…')` вручную, при следующей смене языка
автоподстановка перезапишет текст — убирайте `tr` там, где нужен свой текст.

## 5. Сохранение выбранного языка

Язык хранится в `$.store` под ключом `i18n.lang` и восстанавливается при
старте (`installI18n` читает store раньше первого кадра).

```js
$.i18n.lang('en');                 // $.store.set('i18n.lang', 'en')
$.store.save();                    // запись на диск — когда удобно игре
```

`$.i18n.lang()` сам `save()` не вызывает: моментом записи распоряжается игра
(или `$.store.autoSave`).

## 6. Чистые функции (для тестов без движка)

| Функция | Что делает |
|---|---|
| `format(text, params)` | подстановка `{name}`, неизвестные скобки без изменений |
| `pluralIndex(count, lang)` | индекс формы: 0/1/2 |
| `lookup(dicts, key)` | значение ключа из словаря или массива словарей |

```js
import { format, pluralIndex, lookup } from '../../src/highlevel/i18n.js';
format('{a}+{b}', { a: 1, b: 2 });   // '1+2'
pluralIndex(11, 'ru');               // 2
lookup([{}, { a: 2 }], 'a');         // 2
```

---

# Дополнения `$.input`

## 7. Мёртвая зона осей — `$.input.deadzone`

`$.input.deadzone(value)` задаёт мёртвую зону (0..1, по умолчанию `0.2`),
`$.input.deadzone()` — читает её. Значение применяется в `axis()` и к
аналоговому стику в `vec()`, чтобы стик не «дрожал», а клавиатурные оси
работали как раньше.

```js
$.input.deadzone(0.3);
$.input.deadzone();        // → 0.3
$.input.vec('wasd');       // вклад стика меньше 0.3 считается нулевым
```

Некорректное значение (не число, отрицательное) не применяется — в лог
уходит предупреждение. Аргумент больше 1 ограничивается единицей.

## 8. Привязки: сохранение, загрузка, перенастройка

| Метод | Назначение |
|---|---|
| `$.input.saveBindings()` | записать `bindings()` в `$.store` под ключом `input.bindings` |
| `$.input.loadBindings()` | восстановить привязки из `$.store` |
| `$.input.rebind(action, keys)` | `bind()` с проверками: пустой список/нестроковый ключ — предупреждение |
| `$.input.actions()` | имена всех объявленных действий |
| `$.input.describe(action)` | `{ action, keys, down, pressed }` — для отладки и меню |

`loadBindings()` восстанавливает только непустые массивы строк: испорченная
запись (`'space'` вместо `['space']`, числа, пустой массив) пропускается с
предупреждением, соседние привязки загружаются нормально.

```js
$.input.bind('jump', ['space']);
$.input.saveBindings();
$.store.save();

// позже, в новой сессии:
$.input.loadBindings();
$.input.describe('jump');  // → { action: 'jump', keys: ['space'], down: false, pressed: false }
```

## 9. Ограничения

* `$.i18n.load` читает файлы через `$.fs` (`engine.fs`), сети нет — только
  локальные пути;
* автоматический выбор языка по системе не делается: по умолчанию `ru`,
  затем язык из `$.store`;
* плюральные правила — упрощённые (две формы для `en`, три для `ru`); для
  экзотических языков задайте формы под нужное число вручную;
* `$.input.rebind` для необъявленного действия создаёт его, но пишет
  предупреждение: чаще всего это опечатка.


---

## `$.layers` — канвас-слои, параллакс и затемнение

<sub>источник: `docs/highlevel/layers.md`</sub>

# `$.layers` — канвас-слои, параллакс и затемнение

Подсистема добавляет к `$` **канвас-слои** (аналог `CanvasLayer` в Godot 4),
**параллакс** (аналог `ParallaxBackground`/`ParallaxLayer`) и
**полноэкранный оттенок/затемнение** (аналог `CanvasModulate` + переход
между сценами).

```js
$.ready(() => {
    // Дальний план: слой с параллаксом — его дети наследуют коэффициент.
    const bg = $.layers.create({ name: 'bg', order: -10, parallax: 0.5 });
    $('<sprite>', { id: 'mountains', sprite: 'mountains.png' }).at(0, 300).appendTo(bg);

    // Обычный мир — без слоя.
    $('<player>', { id: 'hero' }).at(200, 300).appendTo($.world);

    // Слой поверх мира.
    const hud = $.layers.create({ name: 'hud', order: 20 });
    $('<label>', { text: 'HP' }).at(40, 24).appendTo(hud);

    // Ночной оттенок и переход в чёрное.
    $.layers.modulate('#0a1430', 0.35);
    $.layers.fadeOut(400).then(() => $.scene.load('level2'));
});
```

Слой — это **обычный узел** `<layer>`, поэтому его видят селекторы, твины и
агентский снимок. Порядок отрисовки берётся из существующего поля
`node.layer` (`render.js` сортирует по `layer`, затем по `depth`): при
добавлении ребёнка в слой подсистема проставляет ему порядок слоя, а при
смене порядка обновляет всё поддерево. `render.js` при этом не правится.

---

## Тег `<layer>`

```js
$('<layer>', { name: 'bg', order: -10, parallax: 0.5, visible: true, modulate: '#0a1430' });
```

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `name` | строка | `layer<uid>` | имя в реестре `$.layers` |
| `order` | число | `1` | порядок слоя (поле `node.layer`); больше — выше |
| `parallax` | число | — | коэффициент параллакса: `0` — приколот к экрану, `1` — как мир |
| `visible` | bool | `true` | видимость; `false` прячет и всех потомков |
| `modulate` | цвет | — | полноэкранный оттенок слоя (`#rgb`, `#rrggbbaa`, число) |

**Контейнер не трансформирует детей.** В движке нет наследования трансформа
родителя: `x/y/scale/angle` узла-слоя на детей не действуют, координаты
детей — мировые. Слой группирует только порядок и видимость (и параллакс
через раздачу коэффициента).

Порядок **внутри** слоя задаётся `.depth()` детей (`.layer(n)` ребёнка
подсистема каждый кадр переписывает на порядок слоя — это её служебное
поле).

---

## `$.layers`

### `$.layers.create(opts)` → обёртка слоя

Создаёт `<layer>` с полями из `opts` (см. таблицу выше) и возвращает обёртку
узла: `.appendTo(layer)` кладёт детей в слой.

### `$.layers.get(name)` → обёртка

Обёртка слоя по имени; пустая обёртка (`length === 0`), если слоя нет.

### `$.layers.has(name)` → bool

Есть ли слой с таким именем.

### `$.layers.list()` → массив имён

Имена слоёв **в порядке отрисовки**, снизу вверх.

### `$.layers.order(...)`

| Вызов | Результат |
|---|---|
| `order()` | массив `{ name, order }` снизу вверх |
| `order(name)` | число — порядок слоя (или `null`) |
| `order(name, n)` | задать порядок слоя, вернуть `$.layers` |
| `order(n)` | задать порядок верхнего слоя |

Смена порядка тут же переписывает `node.layer` у всех потомков слоя.
Прямой `.layer(n)` на узле-слое из ядра тоже считается сменой порядка слоя.

### `$.layers.current()` → string \| null

Имя верхнего (последнего по порядку) слоя.

### `$.layers.of(nodeOrSelector)` → string \| null

Имя слоя, которому принадлежит узел (сам слой тоже считается). Для узла вне
слоёв — `null`.

### `$.layers.show(name)` / `hide(name)` / `toggle(name)` → bool

Видимость слоя. `hide` гасит и всех потомков; `show` возвращает видимость
всем потомкам. `toggle` переключает по текущему состоянию. Возвращают
`true`, если слой найден.

> Видимость наследуется «сверху вниз»: скрытый слой каждый кадр прячет
> позже добавленных детей. Индивидуально скрытый ребёнок остаётся скрытым,
> пока слой видим, но `show(layer)` покажет всех — своих флагов подсистема
> не помнит.

### `$.layers.remove(name)` → bool

Удаляет слой вместе с детьми (как `Node.destroy()`).

### `$.layers.clear()` → `$.layers`

Удаляет все пользовательские слои. Служебный слой глобального оттенка
(`@overlay`) остаётся.

### `$.layers.bringToFront(nameOrNode)` / `sendToBack(nameOrNode)` → string \| null

Поднимает/опускает слой выше/ниже всех остальных. Принимает имя слоя, узел,
обёртку или селектор; для обычного узла берётся его слой. Возвращает имя слоя
или `null`.

### `$.layers.parallax(nodeOrSelector, factor)` → `$.layers` \| число

| Вызов | Результат |
|---|---|
| `parallax(node, factor)` | задать коэффициент, вернуть `$.layers` |
| `parallax(node)` | прочитать коэффициент (число или `null`) |
| `parallax(node, null)` | снять параллакс |

Механика: узел каждый кадр получает
`x = anchor_x + cam.x * (1 - f)` (аналогично `y`). Якорь фиксируется в момент
назначения; если игру узел сдвинула сама (телепорт, `.moveTo()`), якорь
перезакрепляется от новой позиции — параллакс не «съедает» игровое движение.

Если `nodeOrSelector` — слой, коэффициент раздаётся и потомкам (вложенные
слои рулят собой сами).

**Узлы с физическим телом не двигаются:** позицией управляет Box2D.
Подсистема пропускает их и один раз пишет предупреждение в журнал.

### `$.layers.modulate(color, alpha)` → `$.layers` \| `{ color, alpha }`

Общий полноэкранный оттенок поверх мира. Без аргументов — чтение. `null` —
выключить. Если `alpha` не задана, берётся альфа самого цвета.

### `$.layers.fade(color, alpha)` → `$.layers`

Мгновенно задаёт полноэкранное затемнение. Без аргументов — чтение
`{ color, alpha }`.

### `$.layers.fadeTo(color, alpha, ms)` → Promise

Плавно меняет затемнение за `ms` мс игрового времени (`$.time`), кадр не
блокируется. Promise разрешается по завершении (а также если начат новый
переход). Старый незавершённый переход отпускается, а не зависает.

### `$.layers.fadeOut(ms)` → Promise

`fadeTo('#000000', 1, ms)`; по умолчанию 400 мс.

### Метод узла `.parallax(f)`

`$('#star').parallax(0.5)` — то же, что `$.layers.parallax($('#star'), 0.5)`.
Без аргумента — чтение; `null` — снять.

---

## Чистые функции

Экспортируются для юнит-тестов (`tests/js/layers_test.mjs`):

```js
import { parallaxOffset, layerSortKey } from './src/highlevel/layers.js';

parallaxOffset(anchor, camValue, factor); // anchor + camValue * (1 - factor)
layerSortKey(layer, depth);               // layer * 1e6 + depth; принимает и узел
```

`layerSortKey` повторяет порядок `render.js` «слой важнее глубины» и годится
для `|depth| < 500000`.

---

## Ограничения (честно)

| Чего нет | Почему |
|---|---|
| **Пользовательских шейдеров** | конвейер движка один; `.shader()` в ядре — заглушка с предупреждением |
| **Умножения в `modulate`** | сам `modulate` — это **альфа-наложение**, а не умножение: тёмные цвета затемняют, светлые высветляют, `alpha` — сила. Настоящие режимы смешивания (`add`, `multiply`, `none`) задаются отдельно — `.blend(name)` на узле и `$.blend(name)` на кадр, см. [render.md](render.md) |
| **Рендера слоя в текстуру** | слой не рисуется в render target, поэтому `modulate` накрывает всё, что нарисовано **до** слоя, а не только его детей |
| **Наследования трансформа** | узел-контейнер не смещает детей: их координаты остаются мировыми |
| **Точной маски `modulate`** | полноэкранный спрайт в общем батче; подгоняйте порядок слоя или используйте `$.layers.modulate()` для всего кадра |
| **Затемнения интерфейса** | `<$ui.*>` рисуется отдельным проходом после мира, поэтому `fade`/`modulate` его не накрывают |
| **Параллакса на телах** | позицией тела управляет Box2D — узел пропускается с предупреждением |
| **Служебной глубины у `<layer>`** | узел-слой держит `depth = 1000000`, чтобы его `modulate` рисовался после детей; не задавайте `depth` слою вручную |

Вложенные слои: внутренний слой — самостоятельный контейнер, он сохраняет
свой порядок и не наследует порядок внешнего (как `CanvasLayer` внутри
`CanvasLayer`).

---

## Пример: параллакс-фон из трёх планов

```js
$.ready(() => {
    const far = $.layers.create({ name: 'far', order: -30, parallax: 0.2 });
    const mid = $.layers.create({ name: 'mid', order: -20, parallax: 0.5 });
    const near = $.layers.create({ name: 'near', order: -10, parallax: 0.8 });

    $('<sprite>', { sprite: 'sky.png' }).at(400, 300).scale(3).appendTo(far);
    $('<sprite>', { sprite: 'hills.png' }).at(400, 380).scale(2).appendTo(mid);
    $('<sprite>', { sprite: 'trees.png' }).at(400, 440).scale(1.5).appendTo(near);

    $('<player>', { id: 'hero' }).at(200, 300).controls('wasd').appendTo($.world);
    $.camera.follow('#hero', { smooth: 0.2 });
});
```

Слой `near` с `parallax: 0.8` едет почти как мир, `far` с `0.2` — заметно
медленнее, а `parallax: 0` приколол бы план к экрану (удобно для градиента
неба независимо от камеры).


---

## `$.nav` — навигация и поиск пути

<sub>источник: `docs/highlevel/nav.md`</sub>

# `$.nav` — навигация и поиск пути

Подсистема поиска пути: прямоугольная сетка препятствий, A* (8 направлений),
сглаживание маршрута и агент, который идёт к цели по кадрам. Аналог
`AStarGrid2D` + `NavigationRegion2D`/`NavigationAgent2D` из Godot 4.

Путь можно строить двумя способами:

* **клеточная сетка** (`$.nav.grid`) — препятствия задаются клетками, A* по
  клеткам, сглаживание «видимостью»;
* **навигационный меш** (`$.nav.mesh`) — свободное пространство режется на
  **прямоугольники** (не треугольники!), соседи связываются порталами, путь
  идёт по графу прямоугольников и натягивается воронкой. Прямоугольников
  меньше, чем клеток, а путь получается глаже — навмеш лучше подходит для
  больших арен со сложной геометрией.

Ядро (A*, сглаживание, декомпозиция, порталы, воронка) — чистая математика
над массивами и экспортируется наружу; всё остальное — обвязка над
`$.world`/физикой.

```js
$.ready(() => {
    $.nav.clear();
    const grid = $.nav.grid({ x: 0, y: 0, w: 2048, h: 1024, cell: 32, diagonal: true });

    // Стены уже в мире — превращаем их в препятствия сетки.
    grid.buildFromWalls({ tags: ['wall'], inset: 2 });

    $('#guard').navigateTo('#hero', { speed: 180, grid, repathEvery: 300 });
});
```

---

## 1. Сетка

### `$.nav.grid(opts) → grid`

Создаёт сетку. `x`/`y` — **левый верхний угол** в мировых пикселях, `w`/`h` —
размеры. Возвращает объект сетки либо `null`, если размеры не заданы.

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `x`, `y` | число | `0` | Левый верхний угол сетки в мире |
| `w`, `h` | число | — | Размер области в пикселях (обязательны) |
| `cell` | число | `32` | Сторона клетки |
| `diagonal` | bool | `true` | Разрешить шаги по диагонали |
| `heuristic` | `'manhattan'`\|`'euclidean'`\|`'octile'` | `'manhattan'` | Эвристика A* |
| `weights` | массив/число/функция | — | Добавочная стоимость клетки (0 — непроходимо) |

Первая созданная сетка становится сеткой **по умолчанию** для `$.nav.path`
без `opts.grid`. Переключить — `$.nav.use(grid)`.

При `diagonal: true` берите `heuristic: 'octile'` (или `'euclidean'`):
манхэттенская оценка на диагоналях завышена и путь перестаёт быть
оптимальным.

### Методы сетки

| Метод | Что делает |
|---|---|
| `.blockAt(worldX, worldY)` | Закрыть клетку под мировой точкой |
| `.freeAt(worldX, worldY)` | Открыть клетку под мировой точкой |
| `.setBlocked(cx, cy, bool)` | Закрыть/открыть клетку по индексам |
| `.isBlocked(cx, cy)` | Стена ли клетка (за границей сетки — всегда стена) |
| `.worldToCell(wx, wy)` | Мир → `{ cx, cy }` |
| `.cellCenter(cx, cy)` | Центр клетки в мировых координатах |
| `.inBounds(cx, cy)` | Внутри ли сетки |
| `.nearestFreeCell(cx, cy, maxRadius)` | Ближайшая свободная клетка или `null` |
| `.buildFromWalls({ tags, inset })` | Собрать препятствия из узлов мира |
| `.rebuild()` | Повторить последнюю сборку |
| `.clear()` | Снять все препятствия |
| `.lineOfSight(from, to)` | Прямая видимость по этой сетке |
| `.path(from, to, opts)` | Путь в мировых точках |

### `buildFromWalls({ tags, inset })`

Собирает препятствия двумя способами сразу:

1. узлы по селекторам `tags` (по умолчанию `['wall']`) — включая узлы **без
   физического тела**, по их габаритам (`nodeBounds`);
2. все **статические/кинематические тела**, попавшие в габарит сетки
   (`$.world.bodiesIn`) — поэтому препятствием становится и стена без тега
   `<wall>`.

`inset` (пиксели) сжимает габарит каждого препятствия с каждой стороны —
удобно заложить радиус агента. Если препятствие тоньше `2*inset`, стеной
остаётся хотя бы его центральная клетка.

```js
grid.buildFromWalls({ tags: ['wall', '.obstacle'], inset: 4 });
```

`buildFromWalls` и `rebuild()` сбрасывают ручные пометки, поставленные
`setBlocked`/`blockAt` **до** вызова. Ставьте их после пересборки.

### `$.nav.clear()`

Убирает все сетки (и сетку по умолчанию). Уже созданные игрой ссылки на
объекты сетки продолжают работать — просто они больше не находятся в реестре.

---

## 2. Поиск пути

### `$.nav.path(from, to, opts) → [ {x, y}, … ] | null`

Путь по сетке по умолчанию (или `opts.grid`) в мировых координатах.
Первая точка — ровно `from`, последняя — ровно `to`. Если путь не найден —
`null`.

| `opts` | По умолчанию | Смысл |
|---|---|---|
| `grid` | сетка по умолчанию | По какой сетке искать |
| `smooth` | `true` | Убрать лишние изломы |
| `allowPartial` | `false` | Дойти до ближайшей достижимой клетки, если цель недостижима |
| `maxIterations` | `cols*rows` | Предохранитель от долгого поиска |
| `startSearch` | `8` | Радиус поиска свободной клетки, если старт оказался в стене |

`from`/`to` принимают `{ x, y }`, узел, id/строку-селектор или обёртку.

```js
const p = $.nav.path('#guard', { x: 900, y: 400 }, { smooth: true });
```

### `$.nav.pathOn(grid, from, to, opts)`

То же, но сетка задаётся первым аргументом. Без сглаживания и с явным лимитом:

```js
$.nav.pathOn(grid, a, b, { smooth: false, maxIterations: 2000, allowPartial: true });
```

### `$.nav.lineOfSight(from, to, grid) → bool`

Прямая видимость по клеткам, без физики. Стартовая клетка не считается (агент
может стоять вплотную к стене), конечная — считается. Отрезок, проходящий
ровно через угол между двумя стенами, видимости не даёт.

```js
if ($.nav.lineOfSight('#guard', '#hero', grid)) $('#guard').lookAt('#hero');
```

`grid` можно не передавать — возьмётся сетка по умолчанию.

### Чистые функции (экспортируются из `nav.js`)

Их гоняет qjs-тест без движка — см. `tests/js/nav_test.mjs`.

```js
import { astar, smoothPath, lineOfSight, makeGrid, heuristicValue } from './nav.js';
```

* **`astar(spec, start, goal)`** — `spec = { cols, rows, blocked, cell,
  diagonal, heuristic, weights }`; `blocked` — массив/Uint8Array длины
  `cols*rows` или функция `(cx, cy) ⇒ bool`; `weights` — массив/число/функция
  стоимости. `start`/`goal` — **клетки** `{ cx, cy }`/`[cx, cy]`. Возвращает
  массив клеток или `null`. При `spec.partial` (то же, что `allowPartial`)
  отдаёт путь до ближайшей достижимой клетки.
* **`smoothPath(points, blockedFn)`** — `blockedFn(x1, y1, x2, y2) ⇒ bool`
  (истина = отрезок перекрыт). Возвращает новый массив точек.
* **`heuristicValue(name, dx, dy)`** — значение эвристики в клетках.

---

## 3. Агент

### `.navigateTo(target, opts) → wrapper`

Ставит узел на маршрут к цели. `target` — узел, обёртка, id/селектор или
`{ x, y }`; цель пере-разрешается при каждом пересчёте. Возвращает ту же
обёртку, поэтому метод цепной.

| `opts` | По умолчанию | Смысл |
|---|---|---|
| `speed` | `100` | Скорость, пиксели/с |
| `grid` | сетка по умолчанию | По какой сетке идти |
| `mesh` | навмеш по умолчанию | Идти по навмешу (приоритетнее `grid`); см. §4 |
| `stopDistance` | `6` | На каком расстоянии считать, что цель достигнута |
| `smooth` | `true` | Сглаживать маршрут |
| `repathEvery` | `500` | Период проверки цели, мс; `0` — не пересчитывать |
| `allowPartial` | `false` | Идти до ближайшей достижимой точки при недостижимой цели |
| `repathTolerance` | `4` | На сколько пикселей должна сдвинуться цель для пересчёта |
| `waypointRadius` | `max(4, cell/4)` | Радиус «точка пройдена» |
| `avoid` | — | `true`, селектор или обёртка — узлы для мягкого расталкивания |
| `avoidRadius` | `48` | Радиус расталкивания |
| `maxIterations` | — | Лимит итераций A* |
| `radius` | `agentRadius` источника | Габарит агента для поиска пути в пикселях |
| `onArrive`, `onBlocked` | — | Колбэки, получают событие (как `node.on`) |

Методы управления:

| Метод | Что делает |
|---|---|
| `.stopNav()` | Остановить агента и обнулить скорость тела |
| `.repath()` | Пересчитать путь прямо сейчас |
| `.navPath()` | Текущий маршрут `[ {x, y}, … ]` или `[]` |
| `.navTarget()` | Цель `{ x, y }` или `null` |
| `.isNavigating()` | Идёт ли агент к цели (bool) |

События узла: `arrive` (цель достигнута) и `blocked` (путь не найден или
цель стала недостижимой). У события в `data` есть `target`, а у `arrive` —
ещё и `path`.

Пока агент идёт, его узел **не** трогайте через `.moveTo`/`.moveTowards` —
они перебивают скорость. Двигайте цель, а не агента; при сдвиге цели маршрут
пересчитается сам (`repathEvery`).

### Движение

`tickNav(dt)` вызывается движком раз в кадр (подключён в `api.js`):

* у узла есть тело — агенту задаётся скорость (`engine.setVelocity`), тело
  ведёт физика;
* тела нет — узел смещается на `speed * dt` за кадр.

При достижении узел останавливается и получает событие `arrive`. Если путь
построить нельзя — событие `blocked`, навигация завершается. Один узел ведёт
не более одного маршрута: повторный `navigateTo` заменяет старый.

```js
$('#guard')
    .on('arrive',  () => $.log('дошёл'))
    .on('blocked', () => $.log('не могу пройти'))
    .navigateTo('#hero', { speed: 160, grid, repathEvery: 250, avoid: '.guard' });
```

---

## 4. Навигационный меш (`$.nav.mesh`)

Честно о терминах: это **прямоугольная декомпозиция**, а не триангуляция
(ни Делоне, ни «эрце»-триангуляция из Recast). Свободные клетки режутся
жадным проходом на непересекающиеся **прямоугольники**; соседние
прямоугольники с общей стороной связываются **порталами** (общий отрезок);
путь ищется по графу прямоугольников, а затем натягивается **воронкой**
(funnel / string pulling).

Что это значит на практике:

| | Прямоугольная декомпозиция | Триангуляция Делоне |
|---|---|---|
| Примитивы | прямоугольники (оси координат) | треугольники любой формы |
| Число примитивов | больше (диагонали — «ступеньки») | меньше, форма ближе к геометрии |
| Сложность построения | O(клеток), детерминировано | сложнее, есть вырожденные случаи |
| Вырожденные полигоны | невозможны | возможны, нужны эпсилоны |
| Путь | сглаживается воронкой | сглаживается воронкой |

Практический итог: навмеш на прямоугольниках описывает **диагональные и
скруглённые** коридоры ступеньками, поэтому граф больше, чем при
триангуляции. Зато построение простое и предсказуемое, прямоугольники
выпуклые (прямая внутри одного прямоугольника всегда свободна), а воронка
убирает ступеньки из итогового маршрута. Для 2D-игр этого достаточно; если
нужны «настоящие» полигоны — это уже другая подсистема.

### `$.nav.mesh(opts) → mesh | null`

Создаёт пустой навмеш. `x`/`y` — левый верхний угол, `w`/`h` — размеры в
пикселях, `cell` — сторона клетки (по умолчанию `32`), `agentRadius` — запас
на габарит агента. Прямоугольной декомпозиции снаружи не видно — она
строится **лениво**, при первом обращении, а не в конструкторе.

Навмеш сам по себе не становится источником пути для агента: вызовите
`$.nav.useMesh(mesh)` либо передавайте `{ mesh }` в `.navigateTo`/`$.nav.meshPath`.

### Методы навмеша

| Метод | Что делает |
|---|---|
| `.buildFromWalls({ tags, agentRadius, inset })` | Собрать препятствия из узлов мира |
| `.rebuild()` | Повторить последнюю сборку |
| `.clear()` | Снять все препятствия и сбросить декомпозицию |
| `.inflate(radius)` | Задать запас на габарит агента в пикселях |
| `.setBlocked(cx, cy, bool)`, `.blockAt(x,y)`, `.freeAt(x,y)` | Ручные препятствия |
| `.isBlocked(cx, cy)`, `.worldToCell(x,y)`, `.inBounds(cx,cy)` | Как у сетки |
| `.rects()` | Прямоугольники декомпозиции в мировых координатах |
| `.portals()` | Порталы (общие отрезки) в мировых координатах |
| `.rectAt(x, y)` | Прямоугольник под точкой или `null` |
| `.contains(x, y)` | Проходима ли точка (лежит ли в прямоугольнике) |
| `.lineOfSight(from, to)` | Прямая видимость по «сырым» препятствиям |
| `.path(from, to, opts)` | Путь по этому навмешу в мировых точках |

`rects()` отдаёт `{ index, cx, cy, cw, ch, x0, y0, x1, y1, x, y, w, h }`:
`cx/cy/cw/ch` — в клетках, `x0..y1` — мировые границы, `x/y` — центр, `w/h` —
размер. `portals()` — `{ index, a, b, x0, y0, x1, y1 }`, где `a`/`b` — индексы
прямоугольников. Массивы — копии, но объекты внутри общие с кэшем: не
изменяйте их.

### `buildFromWalls({ tags, agentRadius })`

Работает как у сетки, но с той же граблей-предохранителем: **обязательно
задавайте `agentRadius`**. Декомпозиция режется по маске, раздутой на радиус
тела; без запаса путь проходит вплотную к стене и тело упирается. При смене
радиуса декомпозиция пересобирается (под каждый радиус — свой кэш).

```js
const mesh = $.nav.mesh({ x: 0, y: 0, w: 1600, h: 900, cell: 32, agentRadius: 20 });
mesh.buildFromWalls({ tags: ['wall', '.obstacle'], agentRadius: 20 });
$.nav.useMesh(mesh);
```

`buildFromWalls`/`rebuild()` сбрасывают ручные пометки, поставленные до
вызова; ставьте их после пересборки.

### `$.nav.meshPath(from, to, opts) → [ {x, y}, … ] | null`

Путь по навмешу по умолчанию (или `opts.mesh`). Первая точка — ровно `from`,
последняя — ровно `to`, если цель достижима и точки не в стене; точка в стене
притягивается к ближайшему прямоугольнику. `opts.smooth === false` отключает
воронку (возвращается ломаная через середины порталов), `opts.allowPartial` —
путь до ближайшего достижимого прямоугольника, `opts.radius` — габарит для
этого вызова (по умолчанию `mesh.agentRadius`).

```js
$.nav.meshPath('#guard', { x: 900, y: 400 }, { smooth: true });
$.nav.meshPathOn(mesh, a, b, { radius: 24, allowPartial: true });
```

### `$.nav.useMesh(mesh)`, `$.nav.meshes()`

`useMesh` назначает навмеш по умолчанию для агента и `$.nav.meshPath`.
Приоритет в `.navigateTo`: явный `opts.mesh` → явный `opts.grid` → навмеш по
умолчанию → сетка по умолчанию. Поэтому старые игры на `$.nav.grid`
продолжают работать без изменений, даже если в игре появился навмеш.
`meshes()` возвращает копию реестра; `$.nav.clear()` чистит и сетки, и
навмеши.

### Чистые функции навмеша (экспортируются из `nav.js`)

Их гоняет qjs-тест без движка — см. `tests/js/navmesh_test.mjs`.

```js
import { decomposeRects, buildPortalGraph, funnel, makeMesh, pathOnMesh } from './nav.js';
```

* **`decomposeRects(blocked, cols, rows) → [ {cx, cy, w, h}, … ]`** — жадная
  декомпозиция свободных клеток на прямоугольники (в клетках). `blocked` —
  массив/Uint8Array или функция `(cx, cy) ⇒ bool`; за границей — стена.
* **`buildPortalGraph(rects) → { portals, adjacency }`** — граф соседства:
  `portals[i] = { index, a, b, x0, y0, x1, y1 }` (в единицах `rects`),
  `adjacency[i] = [{ index, portal }, …]`.
* **`funnel(points, portals) → [ {x, y}, … ]`** — натягивание пути через
  упорядоченные порталы `{ x0, y0, x1, y1 }`; один линейный проход.

---

## 5. Полный пример

```js
$.ready(() => {
    $.world.gravity(0, 1200).color('#101820').bounds(0, 0, 1600, 900);

    // Сетка по всей арене, препятствия — из стен, с запасом под радиус тела.
    $.nav.clear();
    const grid = $.nav.grid({ x: 0, y: 0, w: 1600, h: 900, cell: 32,
                              diagonal: true, heuristic: 'octile' });
    grid.buildFromWalls({ tags: ['wall'], inset: 6 });

    $('#npc').navigateTo({ x: 1400, y: 700 }, {
        speed: 200, grid, repathEvery: 400, allowPartial: true,
        onArrive: (e) => $.emit('npcCameHome', {}),
        onBlocked: (e) => $.log('путь закрыт: ' + e.data.reason),
    });
});

// Стена появилась — пересобрать препятствия один раз, а не каждый кадр.
function addWall(x, y) {
    $('<wall>').at(x, y).size(64, 64).appendTo($.world);
    $.nav.grids()[0].rebuild();
}
```

---

## 6. Производительность и ограничения

* Путь **не** пересчитывается каждый кадр: `repathEvery` плюс проверка, что
  цель действительно сдвинулась. A* кэширует клеточный маршрут по
  `start|goal|версия препятствий`; навмеш кэширует и путь, и декомпозицию.
* Массив препятствий — плоский `Uint8Array`; любое изменение поднимает
  `grid.version`/`mesh.version` и делает старый кэш недействительным.
* Сетка — не навмеш: клетка либо проходима, либо нет, «выпуклых» регионов и
  порталов у неё нет. Навмеш — прямоугольная декомпозиция (не триангуляция),
  см. §4; он строится по вызову (лениво, при первом обращении), а не в кадре,
  и даёт более гладкий путь при меньшем числе узлов графа.
* `avoid` — простое расталкивание по соседям, а не полноценный локальный
  обход; для плотных толп стройте маршрут с `weights` (дорогие клетки) или
  разносите агентов.
* Внешние границы сетки/навмеша для A* — стена: цель за пределами области
  недостижима.
* `weights` поддерживаются только клеточной сеткой; у навмеша стоимость шага —
  расстояние между центрами прямоугольников.
* После смены `weights` вызовите `grid.rebuild()` (или меняйте их до первого
  поиска): кэш различает только версию препятствий.


---

## Частицы — `$('<particles>')` и `$.particles`

<sub>источник: `docs/highlevel/particles.md`</sub>

# Частицы — `$('<particles>')` и `$.particles`

Подсистема CPU-частиц — аналог `CPUParticles2D` из Godot 4. Эмиттер живёт
целиком в JS: сам хранит пул частиц, считает их движение и рисует их через
общий батч `$.gfx.push.sprite`. Движку про частицы знать не нужно, отдельных
draw call'ов они не создают.

```js
$.ready(() => {
    $('<particles>', {
        amount: 32, lifetime: [400, 900], speed: [20, 70],
        direction: -90, spread: 26, gravity: [0, -45],
        size: [12, 22], end_size: 2,
        color_ramp: [
            { t: 0, color: '#fff6c2' },
            { t: 0.4, color: '#ff9b1e' },
            { t: 1, color: '#c81900' },
        ],
        alpha_ramp: [{ t: 0, alpha: 1 }, { t: 1, alpha: 0 }],
        seed: 7,
    }).at(400, 300).appendTo($.world);
});
```

---

## 1. Создание

| Способ | Назначение |
|---|---|
| `$('<particles>', { … })` | обычное создание узла |
| `$.particles.create({ … })` | то же самое, явно читается намерение |
| `$('<particles>', $.particles.preset('fire'))` | заготовка параметров |

Узел необязательно прикреплять к `$.world`: в `ctx.nodes` он попадает сразу,
и отрисовка/симуляция работают. Но `.appendTo($.world)` делает намерение
понятнее и участвует в очистке сцены.

---

## 2. Параметры эмиттера

Все поля передаются в `opts` при создании и обновляются методом `.params()`
(частично, поверх текущих значений). Диапазон записывается как `[min, max]`,
одиночное число трактуется как `[v, v]`.

| Параметр | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `emitting` | bool | `true` | идёт ли эмиссия (живые частицы остаются) |
| `amount` | число | `32` | сколько частиц держит непрерывная эмиссия |
| `max_particles` | число | `max(amount·4, 256)` | жёсткий потолок пула (≤ 16384) |
| `rate` | число | `amount / среднее lifetime` | частиц в секунду |
| `interval` | число (мс) | — | пауза между частицами; альтернатива `rate` |
| `lifetime` | число / `[min,max]` (мс) | `1000` | время жизни |
| `speed` | число / `[min,max]` | `100` | начальная скорость, px/с |
| `direction` | градусы | `0` | 0 — вправо (+X), 90 — вниз |
| `spread` | градусы | `0` | полный угол разброса вокруг `direction` |
| `gravity` | число / `[x,y]` / `{x,y}` | `0` | ускорение, px/с²; число — вниз по Y |
| `angle` | число / `[min,max]` (град.) | `0` | начальный поворот частицы |
| `angular_velocity` | число / `[min,max]` (град./с) | `0` | скорость вращения |
| `size` | число / `[min,max]` | `8` | стартовый размер (мировые единицы) |
| `end_size` | число / `[min,max]` | = `size` | размер к концу жизни |
| `size_ramp` | `[{ t, size }]` | — | кривая размера (сильнее, чем `end_size`) |
| `color` | цвет | `#ffffff` | базовый цвет |
| `end_color` | цвет | = `color` | цвет к концу жизни |
| `color_ramp` | `[{ t, color }]` | — | кривая цвета; перекрывает `color`/`end_color` |
| `alpha_ramp` | `[{ t, alpha }]` | константа `1` | кривая прозрачности |
| `damping` | число | `0` | экспоненциальное торможение, 1/с |
| `texture` / `src` | путь / id / `[x,y,w,h]` | `engine.whiteSprite` | спрайт частицы |
| `local` | bool | `true` | частицы движутся вместе с узлом |
| `global` | bool | `false` | `true` — мировые координаты (алиас `local: false`) |
| `one_shot` | bool | `false` | один залп из `amount` при старте |
| `burst` | число / массив | — | дополнительный залп(ы) при старте |
| `emit_zone` | строка / объект | `'point'` | `'point' \| 'rect' \| 'circle'` |
| `emit_zone_w` / `_h` / `_radius` | число | `0` | размеры зоны (или `{ w, h, radius }`) |
| `seed` | целое | `uid` узла | зерно генератора |
| `layer` / `depth` | число | `0` | обычные поля сортировки узла |
| `blend` | строка | — | **игнорируется** с предупреждением один раз |

Формы записи зоны эмиссии равнозначны:

```js
$('<particles>', { emit_zone: 'circle', emit_zone_radius: 40 });
$('<particles>', { emit_zone: { shape: 'rect', w: 120, h: 20 } });
```

---

## 3. Методы узла

Все методы цепочные (кроме геттеров) и работают на обёртке.

| Метод | Что делает |
|---|---|
| `.start()` | включить эмиссию |
| `.stop()` | выключить эмиссию; живые частицы доживают свой срок |
| `.restart()` | очистить пул, перезапустить генератор, выдать стартовый залп снова |
| `.reset()` | очистить пул и накопитель, залп снова; состояние эмиссии сохраняется |
| `.burst(n)` | немедленный залп из `n` частиц (ограничен `max_particles`) |
| `.emitting()` / `.emitting(bool)` | геттер/сеттер эмиссии |
| `.isEmitting()` | булев геттер |
| `.count()` | сколько частиц живо (сумма по обёртке) |
| `.clear()` | убрать все частицы, эмиссию не трогая |
| `.params(spec)` | частично обновить параметры; живые частицы не меняются |
| `.params()` | снимок текущих нормализованных параметров |
| `.particleAt(i)` | частица номер `i` (объект) или `null` |

```js
const fx = $('<particles>', { amount: 40, seed: 1 }).at(400, 300).appendTo($.world);
fx.stop().clear().burst(20);      // разовый взрыв без дальнейшей эмиссии
fx.start().params({ speed: [80, 200], amount: 12 });
fx.count();                        // 20
fx.particleAt(0);                  // { x, y, vx, vy, age, life, size, … }
```

---

## 4. Рампы (кривые)

Рампа — массив стопов, отсортированных по `t ∈ [0, 1]`:

* `color_ramp`: `[{ t, color }]` — цвет интерполируется по каналам RGBA;
* `alpha_ramp`: `[{ t, alpha }]` — прозрачность;
* `size_ramp`: `[{ t, size }]` — размер (перекрывает `size`/`end_size`).

`t` — доля прожитой жизни: 0 при рождении, 1 в момент исчезновения. Если
`color_ramp` не задан, строится прямая из `color` в `end_color`; если не задан
`alpha_ramp`, прозрачность постоянна.

```js
color_ramp: [{ t: 0, color: '#fff3b0' }, { t: 0.35, color: '#ff9a2e' }, { t: 1, color: '#7a1f00' }],
alpha_ramp: [{ t: 0, alpha: 1 }, { t: 0.7, alpha: 0.6 }, { t: 1, alpha: 0 }],
```

---

## 5. Режимы `local` и `global`

* **`local` (по умолчанию).** Смещения частиц хранятся относительно узла и
  поворачиваются вместе с ним при отрисовке. Двинули эмиттер — облако поехало
  следом. Гравитация при этом действует в локальной системе узла.
* **`global`.** Частицы рождаются в мировых координатах и больше не зависят от
  узла: можно «привязать» эмиттер к движущемуся объекту, а искры останутся в
  мире.

```js
$('<particles>', { global: true, one_shot: true, amount: 30 }); // салют в мире
```

---

## 6. Пресеты

```js
$.particles.presets();
// ['explosion', 'smoke', 'sparks', 'fire', 'rain', 'dust']

$.particles.preset('fire', { amount: 8, id: 'torch' });
// копия параметров пресета, перекрытая spec
```

| Пресет | Для чего |
|---|---|
| `explosion` | разовый взрыв: тёплые искры наружу, с затуханием |
| `smoke` | поднимающийся дым с ростом размера |
| `sparks` | мелкие искры вверх под гравитацией |
| `fire` | язык пламени: жёлтый → оранжевый → красный |
| `rain` | широкий прямоугольный эмиттер, капли вниз |
| `dust` | медленная пыль вокруг точки |

`preset()` возвращает **копию**: правки возвращённого объекта не портят
встроенный пресет; неизвестное имя даёт предупреждение и пустой (или переданный)
spec.

---

## 7. Детерминизм и производительность

* При заданном `seed` последовательность частиц полностью детерминирована
  (генератор — `makeRandom` из ядра). Два эмиттера с одним seed и одним `dt`
  эволюционируют одинаково.
* Пул частиц фиксирован `max_particles`; объекты частиц переиспользуются через
  внутренний список свободных — в установившемся режиме кадр не аллоцирует.
* Один эмиттер рисует не больше 4096 спрайтов за кадр, чтобы не занять общий
  батч (16384). Частицы вне экрана отсекаются.
* `max_particles` по умолчанию ограничен; для «тяжёлых» эффектов задавайте его
  явно и держите `amount` разумным.

---

## 8. Чистые функции (для тестов и инструментов)

Экспортируются из `src/highlevel/particles.js` и не требуют движка (кроме
цвета — `engine.rgba` из мока):

| Функция | Назначение |
|---|---|
| `installParticles($)` | подключить подсистему (зовёт `api.js`) |
| `tickParticles(dt)` | кадровый шаг всех эмиттеров (зовёт `api.js`) |
| `buildParams(spec)` | сырые опции → нормализованные параметры |
| `buildRamp(stops, kind)` | стопы → числовая рампа (`'color'` / `'value'`) |
| `sampleRamp(stops, t)` | значение рампы в точке `t` |
| `spawnParticle(params, rng)` | новая частица |
| `stepParticle(p, dt, params)` | шаг частицы (меняет `p`, ставит `p.dead`) |

---

## 9. Ограничения

* Один общий проход отрисовки: **режимы смешивания** (`blend`) не
  поддерживаются — параметр игнорируется с предупреждением один раз.
* Частицы — не физические тела: они не сталкиваются с миром и не участвуют в
  `$.world.query`/лучах.
* Симуляция идёт с `dt` игрового цикла и не встаёт отдельно на паузу
  `$.time.pause()` (шаг получает уже посчитанный `dt`).
* `.color()` на узле подхватывается на лету, но произвольные правки через
  `.attr()` после создания не перестраивают параметры — используйте
  `.params({ … })`.
* Текстура резолвится один раз при первом тике эмиттера.


---

## Пул объектов — `$.pool`

<sub>источник: `docs/highlevel/pool.md`</sub>

# Пул объектов — `$.pool`

Пул переиспользует узлы: пуля, частица-объект или враг создаются один раз, а
дальше по кругу выдаются и возвращаются. Это убирает мусор от частых
`$('<bullet>')` и, что важнее, не плодит тела Box2D: освобождённый узел теряет
тело и уходит из мира, но сам объект остаётся в памяти.

```js
$.ready(() => {
    $.pool.create({
        name: 'bullets',
        tag: 'bullet',
        max: 64,
        speed: 600,
        color: '#ffd34d',
        onRelease: (node) => { node.attrs.hit = false; },
    });

    // выстрел
    $.pool.spawn('bullets', { x: 100, y: 200 })
        .velocity(1, 0)
        .on('collision', (e) => e.self.release());
});
```

---

## 1. Жизненный цикл узла

| Состояние | Что с узлом |
|---|---|
| создан (`create`/`initial`) | лежит в списке свободных, невидим, в `ctx.nodes` его нет |
| выдан (`spawn`) | попадает в `ctx.nodes`, `visible = true`, получает тело |
| возвращён (`release`) | тело уничтожено, `visible = false`, убран из `ctx.nodes` и селекторов |
| уничтожен (`clear`) | `node.destroy()` — узел нельзя выдать снова |

Пока узел свободен, его не видит отрисовка, не находит `$('#id')` и не считает
`$.world.count()`. На следующем `spawn` узел возвращается к состоянию шаблона
(координаты, цвет, размер, классы), поверх накладываются `opts`.

---

## 2. Создание пула

```js
const bullets = $.pool.create({
    name: 'bullets',     // обязательно: имя для spawn/get
    tag: 'bullet',       // тег узла, по умолчанию 'rect'
    max: 64,             // жёсткий потолок роста, по умолчанию 128
    initial: 16,         // предсоздать узлы заранее (алиас prewarm)
    parent: $.world,     // необязательный родитель; $.world = корень мира
    speed: 600,          // все прочие поля — атрибуты узла (шаблон)
    onAcquire: (node, opts) => {},
    onRelease: (node) => {},
});
```

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `name` | строка | — | имя пула; без него `create()` вернёт `null` |
| `tag` | строка | `'rect'` | тег создаваемых узлов; должен существовать в `TAGS` |
| `max` | целое | `128` | потолок числа созданных узлов (не выданных) |
| `initial` / `prewarm` | целое | `0` | сколько узлов создать сразу, обрезается по `max` |
| `parent` | узел/`$.world` | мир | куда прикреплять выданные узлы |
| `onAcquire` | функция | — | `(node, opts)` после выдачи узла |
| `onRelease` | функция | — | `(node)` перед возвратом, узел ещё в мире |
| остальные поля | — | — | атрибуты узла: `w`, `h`, `color`, `speed`, `class`… |

`create()` возвращает **дескриптор пула** (см. ниже). Повторный `create()` с
тем же `name` не перезаписывает пул, а возвращает существующий и пишет
предупреждение в журнал.

---

## 3. Пространство имён `$.pool`

| Функция | Назначение |
|---|---|
| `$.pool.create(spec)` | зарегистрировать пул; вернуть дескриптор или `null` |
| `$.pool.get(name)` | дескриптор пула или `null` |
| `$.pool.has(name)` | есть ли такой пул |
| `$.pool.spawn(name, opts)` | выдать узел: обёртка `$` (пустая, если места нет) |
| `$.pool.release(node)` | вернуть узел или обёртку; `false`, если узел не из пула |
| `$.pool.releaseAll(name?)` | вернуть всех; без имени — по всем пулам; число возвратов |
| `$.pool.stats()` | сводка по всем пулам (см. §5) |
| `$.pool.clear(name?)` | уничтожить пул(ы) вместе с узлами; без имени — все |

`spawn` возвращает обычную обёртку, поэтому работают цепочки:

```js
$.pool.spawn('bullets', { x, y }).color('#ff0').velocity(vx, vy);
```

Если `max` исчерпан, `spawn` не создаёт узел и возвращает **пустую обёртку** —
цепочка не падает, а `stats().skipped` растёт. Освободите узел, чтобы место
появилось снова.

---

## 4. Дескриптор пула и метод узла

```js
const p = $.pool.get('bullets');
p.spawn({ x: 0, y: 0 });   // то же, что $.pool.spawn('bullets', …)
p.release(node);
p.releaseAll();
p.clear();                 // уничтожить узлы, пул остаётся зарегистрированным
p.nodes();                 // обёртка со всеми выданными узлами
p.stats();

p.created;  // всего создано узлов
p.active;   // выдано сейчас
p.free;     // свободно
p.max;      // потолок
p.spawned;  // успешных выдач за всё время
p.released; // возвратов в пул
p.skipped;  // spawn не нашёл места (лимит max)
```

У выданной обёртки есть метод `.release()` — вернуть узел в свой пул:

```js
$('#bullet').on('collision', (e) => e.self.release());
```

Вызов на узле, который не выдавал `$.pool.spawn()`, пишет подсказку в журнал и
ничего не делает.

---

## 5. Статистика

`$.pool.stats()` возвращает общую сводку и разбивку по именам:

```js
{
    pools: 2, created: 80, active: 12, free: 68,
    spawned: 340, released: 328, skipped: 0,
    names: ['bullets', 'sparks'],
    by_name: {
        bullets: { name, tag, max, created, active, free, spawned, released, skipped },
        sparks:  { … },
    },
}
```

Те же поля (кроме `by_name`) отдаёт `p.stats()` для одного пула.

---

## 6. Счётчики подсистем в `$.debug`

`$.pool.tickPool()` обновляет снимок счётчиков на каждом кадре; читают его
через `$.debug`:

```js
$.debug.counters();
// { nodes, world_nodes, ui_nodes, bodies, particles, tweens, zones,
//   pools, pool_created, pool_active, pool_free }

$.debug.stats().counters;   // тот же объект внутри общей сводки кадра
```

| Поле | Что считает |
|---|---|
| `nodes` | все узлы в `ctx.nodes` |
| `world_nodes` | игровые узлы без интерфейса и стен `bounds()` |
| `ui_nodes` | узлы интерфейса |
| `bodies` | узлы с живым телом Box2D |
| `particles` | живые частицы всех `<particles>` |
| `tweens` | активные твины |
| `zones` | узлы `<trigger>` и `<area>` |
| `pools`, `pool_created`, `pool_active`, `pool_free` | состояние пулов |

`counters()` считает значения заново при каждом вызове, поэтому верен даже до
первого кадра.

---

## 7. Ограничения и правила

* Пул — общий на процесс: смена сцены узлы пула не уничтожает. Чистите явно
  (`$.pool.clear()`), если пул больше не нужен.
* `onAcquire`/`onRelease` получают **сырой узел** (не обёртку) — так в кадре не
  создаётся лишних объектов. Для цепочек оберните его: `$(node).at(x, y)`.
* Подписки и иерархия (`on`, `parent`) применяются один раз при создании узла;
  `opts` при повторной выдаче их не переподписывают. Для разовых обработчиков
  используйте `onAcquire`.
* Между выдачами состояние узла сбрасывается к шаблону, поэтому всё, что должно
  переживать `release`, храните в `node.attrs` внутри `onRelease`/`onAcquire`
  или во внешнем объекте.
* Узел, уничтоженный игрой через `.remove()`, в пул не возвращается —
  следующий `spawn` создаст вместо него новый (если есть место по `max`).
* Пул не заменяет `$.particles`: частицы эмиттера живут своим внутренним пулом
  и в `$.pool` не нуждаются.

---

## 8. Тесты

```bash
build/_deps/quickjs-build/qjs tests/js/pool_test.mjs
```

Юнит-тест проверяет переиспользование объекта узла, сброс состояния между
выдачами, лимит роста и предсоздание, `release`/`releaseAll`/`clear`, работу
с телами Box2D, обработчики `onAcquire`/`onRelease` и счётчики `$.debug`.

Интеграционный прогон в движке — `tests/agent/highlevel_pool_test.py`
(фикстура `tests/fixtures/pool/`); его запускает интегратор после сборки.



---

## `$.prefab` — prefab, наследование сцен и сериализация узлов

<sub>источник: `docs/highlevel/prefab.md`</sub>

# `$.prefab` — prefab, наследование сцен и сериализация узлов

Подсистема сохраняет любой узел со всем поддеревом в обычные
JSON-совместимые данные и создаёт по ним новые узлы. Это аналог
`PackedScene`/`instantiate()` и inherited scene из Godot 4, закрывающий
пробел GAP_ANALYSIS §3.5: `$.scene` умеет менять сцены, но не описывать
дерево узлов.

```js
$.ready(() => {
    // Прототип: враг с ребёнком-полоской здоровья.
    const proto = $('<enemy>', { class: 'goblin' })
        .at(0, 0).size(28, 40).appendTo($.world);
    $('<ui.bar>').at(0, -26).size(28, 4).appendTo(proto);

    // Сохранили под именем и убрали прототип.
    $.prefab.register('goblin', $.prefab.save(proto));
    proto.remove();

    // Наследник: те же узлы, но другие свойства и свой шлем.
    $.prefab.register('goblin-boss', {
        extend: 'goblin',
        overrides: { hp: 300, size: [48, 64], speed: 60 },
        add: [{ tag: 'rect', class: 'helmet', w: 40, h: 12, y: -36 }],
    });

    // Инстанцируем пачку.
    $.prefab.instantiate('goblin', { count: 5, x: 400, y: 200, parent: $.world })
        .addClass('wave-1');
    $.prefab.instantiate('goblin-boss', { id: 'boss', x: 700, y: 200, parent: $.world });
});
```

Три правила, из которых растёт весь модуль:

1. **Только данные.** В результат `save()` не попадают ни функции, ни ссылки
   на живые объекты: `sanitize()` выбрасывает функции, разрывает циклы,
   превращает `Set`/`Map` в массивы и объекты.
2. **Описания, а не id.** Числовой id тела Box2D и спрайта после загрузки
   будет другим, поэтому `body` хранится строкой (`'dynamic'`/`'static'`/
   `'kinematic'`/`false`), а `sprite` — путём или спецификацией листа.
3. **Идемпотентность.** `save → load → save` даёт побайтово одинаковый JSON:
   `nodeToData()` всегда пишет один и тот же набор полей в одном порядке.

---

## `$.prefab`

### Сохранение и загрузка

| Метод | Возвращает | Смысл |
|---|---|---|
| `$.prefab.save(nodeOrSelector)` | объект или массив | узел со всем поддеревом → данные |
| `$.prefab.load(data, parent?)` | обёртка | данные → новые узлы |
| `$.prefab.clone(nodeOrSelector)` | обёртка | глубокая копия поддерева **рядом** с оригиналом |

`nodeOrSelector` — узел, обёртка или CSS-селектор. `parent` — узел, обёртка,
селектор; по умолчанию мир. `save()` от одного узла возвращает объект, от
нескольких (или от массива) — массив; `load()`/`instantiate()` принимают и то
и другое.

```js
const g = $.prefab.instantiate('goblin', { x: 400, y: 200 });
const data = g.toData();                 // снимок уже живого узла
$.prefab.load(data, $('#cave'));         // копия внутрь другого узла
$.prefab.clone('#boss');                 // копия рядом с '#boss'
```

### Именованные prefab

| Метод | Смысл |
|---|---|
| `$.prefab.register(name, spec)` | зарегистрировать данные или функцию `(opts) => data` |
| `$.prefab.instantiate(nameOrData, opts)` | создать узлы по имени или данным |
| `$.prefab.get(name)` | разрешённые данные (с учётом `extend`) или `null` |
| `$.prefab.has(name)` / `list()` / `remove(name)` / `clear()` | реестр |

`opts` у `instantiate`:

| Поле | Смысл |
|---|---|
| `x`, `y` | позиция первого корня |
| `parent` | родитель (по умолчанию мир) |
| `id` | id первого корня; если занят — получит суффикс |
| `class` | классы первого корня (дополняются) |
| `overrides` | переопределения свойств (см. ниже) |
| `count` | сколько копий создать (по умолчанию `1`) |

```js
$.prefab.instantiate('goblin', { count: 10, x: 100, y: 0, class: 'wave' });
// → обёртка из 10 корней, у каждого свой uid, id уникальны
```

### Наследование (`extend`)

Ребёнок наследует дерево родителя и переопределяет свойства — это
inherited scene:

```js
$.prefab.register('base', data);
$.prefab.register('child', {
    extend: 'base',
    overrides: { hp: 50, size: [40, 60] },   // свойства корня
    add: [{ tag: 'rect', class: 'cape' }],   // новые дети корня
});
```

`overrides` — короткие формы и обычные поля:

| Ключ | Что делает |
|---|---|
| `size: [w, h]` | задаёт `w`/`h` |
| `pos: [x, y]` | задаёт `x`/`y` |
| `class: 'a b'` | **дополняет** классы |
| `tags: [...]` | **дополняет** теги |
| `hp`, `maxHp`, `color`, `alpha`, `speed`, … | переопределяют поле или `attrs` |

Поля, которых нет в формате данных (например `speed`), попадают в `attrs` и
применяются через обычный `$.attr()`. `extend` разрешается рекурсивно; цикл
не роняет игру — в журнал уходит предупреждение, а `instantiate` вернёт
пустую обёртку.

> Переопределения действуют на **корень** prefab. Чтобы настроить конкретного
> ребёнка, добавьте его через `add` или правьте данные вручную.

### Файлы и сцены

| Метод | Смысл |
|---|---|
| `$.prefab.saveTo(name, nodeOrSelector)` | сохранить узел в `$.store` (`prefab:<name>`) и на диск |
| `$.prefab.loadFrom(name, opts)` | взять prefab из `$.store` (или `prefabs/<name>.json`) |
| `$.prefab.saveScene(name)` | сохранить весь мир (`scene:<name>`) |
| `$.prefab.loadScene(name, opts)` | восстановить мир; `opts: { clear: true }` — сначала очистить |
| `$.prefab.toJSON(data)` / `$.prefab.fromJSON(text)` | строка JSON и обратно |

```js
$.store.file('build/level1.json');       // куда писать
$.prefab.saveTo('hero', '#hero');
$.prefab.loadFrom('hero', { x: 800, y: 200 });

$.prefab.saveScene('level1');
$('.junk').remove();
$.prefab.loadScene('level1', { clear: true });   // мир как был
```

`saveScene()` пишет корневые узлы (у кого нет родителя) вместе с поддеревом;
UI-узлы и `world-bound` тоже попадают в сцену — это буквально весь мир.

### Методы узла

| Метод | Возвращает | Смысл |
|---|---|---|
| `.toData()` | объект/массив | данные узла (у одного — объект, у многих — массив) |
| `.clone()` | обёртка | копия поддерева рядом с оригиналом |
| `.prefabClone()` | обёртка | то же; псевдоним на случай, если имя `clone` займут |
| `.savePrefab(name)` | `this` | `register(name, save(this))` |
| `.prefab()` | строка или `null` | имя prefab, из которого создан узел |

```js
$('#hero').savePrefab('hero');
$('#hero').prefab();        // 'hero'
$('#hero').clone();         // копия с уникальным id
```

---

## Формат данных

`save()` возвращает объект с фиксированным набором ключей:

| Поле | Тип | Смысл |
|---|---|---|
| `tag` | строка | тег узла |
| `id` | строка или `null` | id |
| `class` | строка | классы через пробел |
| `tags` | массив | дополнительные теги (`.addTag()`) |
| `data` | объект | `data_store` (`.data()`) |
| `x`, `y`, `w`, `h`, `angle`, `scaleX`, `scaleY` | число | геометрия |
| `alpha`, `visible`, `layer`, `depth` | число/булево | порядок и прозрачность |
| `color`, `hoverColor`, `textColor`, `fillColor` | `'#rrggbbaa'` или `null` | цвета |
| `text`, `fontSize`, `value`, `max`, `radius`, `intensity`, `r` | число/строка | текст и параметры тегов |
| `team`, `hp`, `maxHp` | число | здоровье и команда |
| `body` | `'dynamic' \| 'static' \| 'kinematic' \| false \| null` | тело: тип, «выключено», «как в теге» |
| `gravity`, `hitbox`, `collisionMask` | булево/массив/число | физика |
| `sprite` | строка, `{src,cols,rows,cw,ch}`, массив или `null` | картинка |
| `frame` | число | кадр листа |
| `attrs` | объект | прочие атрибуты (`.attr()`) |
| `children` | массив | дети, рекурсивно |

Числовой id тела и спрайта **не** сохраняется. Тело восстанавливается по
`body` + `attrs` (плотность, трение, `fixedRotation`), спрайт — по
`sprite`. Путь спрайта модуль запоминает в момент вызова
`.sprite('путь.png')` (хук на `Node.prototype.setSprite`), поэтому
`save → load → save` не теряет картинку.

---

## Чистые функции (для тестов и инструментов)

Экспортируются из `src/highlevel/prefab.js` и не требуют движка:

| Функция | Что делает |
|---|---|
| `nodeToData(node)` | узел → данные (без функций и живых ссылок) |
| `applyData(data, parent)` | данные → узел с детьми |
| `dataToSpec(value)` | глубокая JSON-безопасная копия данных |
| `sanitize(value, seen?)` | приводит значение к JSON-совместимому виду |
| `applyOverrides(data, overrides)` | применяет `overrides` к данным |
| `mergeSpec(base, child)` | наследование: база + `overrides` + `add` |
| `uniquifyIds(data, used?)` | делает уникальными id всего поддерева |
| `resolveParent(parent)` | узел/обёртка/селектор/мир → Node или `null` |
| `prefabOf(node)` | имя prefab узла или `null` |

Проверка без сборки движка:

```bash
build/_deps/quickjs-build/qjs tests/js/prefab_test.mjs
```

---

## Ограничения и особенности

* **`save()` пишет только данные.** Функции в `attrs`/`data` молча
  выбрасываются: обработчики событий (`.on()`), `script`-функции и замыкания
  в prefab не переносятся — подпишитесь заново после `instantiate()`.
* **`extend` переопределяет только корень.** Дерево наследуется целиком,
  точечных переопределений конкретных детей (как `%Node` в Godot) нет — для
  этого есть `add` и `overrides`.
* **`clone`/`.clone()`** не занято ядром (`_CONTRACT.md` §5), но рядом всегда
  есть псевдоним `.prefabClone()`: если имя `clone` когда-нибудь займут,
  используйте его.
* **id не дублируются.** Если при `instantiate`/`load`/`clone` id уже занят
  живым узлом, копия получает суффикс (`hero` → `hero2`), а оригинал остаётся
  доступен по своему id. `opts.id` — это пожелание, а не гарантия точного id.
* **Тела Box2D пересоздаются** при загрузке: физическое состояние (скорость,
  угловая скорость, сон) не сохраняется, только позиция, угол и параметры.
  Транзитные визуальные поля (`tint`, `shake_timer`) в данные не входят.
* **`loadScene({ clear: true })`** убирает узлы, но не трогает таймеры, твины
  и настройки мира — этим занимается `$.scene`. Если нужен полный сброс,
  очищайте мир через смену сцены.
* **`loadFrom`/`loadScene`** ищут данные в памяти `$.store`, затем делают
  `$.store.load()` (читает `save.json`), затем пробуют
  `prefabs/<name>.json` / `scenes/<name>.json`. Держите `$.store.file(...)`
  настроенным заранее, чтобы не спутать prefab с игровым сохранением.
* **Спрайт, созданный только `resolveSprite` числа** (например `.frame(n)`),
  сохранить нельзя: источника у готового id нет. Задавайте картинку через
  `.sprite('путь')`, `.frames({src, ...})` или `attrs.src`.
* Имя `$.prefab` и методы `.toData()`, `.clone()`, `.savePrefab()`,
  `.prefab()` не пересекаются с именами ядра.


---

## `$.blend` и `$.viewport` — смешивание и render target

<sub>источник: `docs/highlevel/render.md`</sub>

# `$.blend` и `$.viewport` — смешивание и render target

Подсистема закрывает две задачи из аудита API:

* **режимы смешивания** спрайтов и треугольников — `alpha`, `add`, `multiply`,
  `none` (аналог `CanvasItem.blend_mode` в Godot);
* **render target / подвьюпорт** — рисование в offscreen-текстуру (мини-карта,
  портал, превью). В этой сборке он **не поддержан осознанно**: вместо
  сломанной картинки `$.viewport.*` возвращает понятную ошибку, а ниже
  расписано, что именно нужно перестроить.

```js
$.ready(() => {
    // Режим по умолчанию для всего, у чего не задан node.blend_mode.
    $.blend('alpha');

    $('<player>', { id: 'hero' }).at(200, 300).blend('alpha').appendTo($.world);
    $('<rect>', { id: 'glow' }).at(400, 300).size(120, 120)
        .color('#ff8844aa').blend('add').appendTo($.world);
    $('<rect>', { id: 'shadow' }).at(600, 300).size(120, 120)
        .color('#556677').blend('multiply').appendTo($.world);
    $('<rect>', { id: 'mask' }).at(600, 450).size(120, 60)
        .color('#ffffff').blend('none').appendTo($.world);
});
```

---

## 1. Режимы смешивания

| Режим | Формула | Смысл |
|---|---|---|
| `alpha` | `src * src.a + dst * (1 - src.a)` | обычная прозрачность, **по умолчанию** |
| `add` | `src + dst` | свет, вспышки, огонь, лучи |
| `multiply` | `src * dst` | затемнение, цветные линзы |
| `none` | `src` | запись поверх без смешивания: маска, трафарет |

Порядок режимов зафиксирован в трёх местах и **обязан совпадать**: `R2DBlendMode`
в `src/render.h`, массив конвейеров `R2DRenderer.pipelines` в `src/render.c` и
`BLEND_NAMES` в `src/highlevel/render.js` (`alpha=0, add=1, multiply=2, none=3`).
Индекс режима — это индекс конвейера.

### Как выбирается режим

Приоритет ровно один — как у `.blend()` на узле:

1. `node.blend_mode`, если он задан (`.blend('add')` на узле, `{ blend: 'add' }`
   в декларации тега, поле `blend_mode` в снимке);
2. иначе — режим по умолчанию из `$.blend(name)` / `$.gfx.blend(name)`.

Отрисовщики подсистем (`$.gfx.push.sprite(..., blend)`) могут передать режим
явно или положиться на общий.

### `$.blend(name)`

```js
$.blend();          // → 'alpha' — текущий режим по умолчанию
$.blend('add');     // → 'add'   — поставить режим
$.blend('screen');  // → прежний — неизвестное имя, предупреждение в лог
```

Без аргумента — геттер. С аргументом — сеттер и **тонкая обёртка** над
`$.gfx.blend(name)`: вся валидация и хранение значения живут в `render.js`,
здесь дублирования нет. Неизвестное имя не меняет текущий режим и один раз
пишет предупреждение со списком доступных.

`node.blend_mode` выставляется методом узла `.blend(mode)` в `api.js`;
неизвестное имя там откатывается в `alpha`.

---

## 2. Сторона C: конвейеры и пакеты

В `r2d_render_init()` создаётся **по конвейеру на каждый режим** —
`SDL_GPUGraphicsPipeline *pipelines[R2D_BLEND_COUNT]`. Отличаются они только
`blend_state` цветового таргета; вершинный вход, шейдеры, растеризация и
формат цели у всех общие.

| Режим | `enable_blend` | Цвет (src / dst / op) | Альфа (src / dst / op) |
|---|---|---|---|
| `alpha` | `true` | `SRC_ALPHA` / `ONE_MINUS_SRC_ALPHA` / `ADD` | `ONE` / `ONE_MINUS_SRC_ALPHA` / `ADD` |
| `add` | `true` | `ONE` / `ONE` / `ADD` | `ONE` / `ONE` / `ADD` |
| `multiply` | `true` | `DST_COLOR` / `ZERO` / `ADD` | `DST_ALPHA` / `ZERO` / `ADD` |
| `none` | `false` | — | — |

Значения для `alpha` в точности прежние, поэтому старые игры рисуются ровно
как раньше.

### `engine.submitSprites(transforms, colors, count?, blend?)`

Необязательный **четвёртый** аргумент — строка режима. Он относится ко **всему
пакету**: батч рисуется одним конвейером, поэтому `render.js` сам режет кадр на
непрерывные участки с одинаковым режимом и делает несколько `submitSprites`.
Порядок спрайтов при этом не меняется — режим переключается только там, где
он реально сменился.

Без четвёртого аргумента поведение прежнее (`alpha`). Неизвестная строка один
раз ругается в лог и трактуется как `alpha`.

### `engine.submitTriangles(vertices, count?, blend?)`

Треугольники тоже принимают третьим аргументом имя режима. Каждый вызов
запоминается отдельным диапазоном (структура `R2DTriBatch`): при выводе
треугольники идут после спрайтов, каждый диапазон со своим конвейером.

> Высокоуровневый батч (`$.gfx.push.triangle` и внутренний вызов в `render.js`)
> пока отдаёт треугольники без режима — значит, в `alpha`. Возможность на
> стороне C готова: достаточно прокинуть имя режима третьим аргументом
> `engine.submitTriangles` в `render.js` (файл интегратора).

### Отрисовка

`r2d_render_draw()` идёт по командам и объединяет соседние в один draw call,
пока не сменится **текстура или режим смешивания**. При смене режима
привязывается соответствующий конвейер (и заново — вершинный/индексный
буферы). Треугольники рисуются последними тем же способом.

Реализация биндингов — в `src/render.c`; `script.c` не правится:
`r2d_render_register_js()` вызывается последним при сборке `engine` и
переопределяет `submitSprites`/`submitTriangles`, добавляя аргумент режима.

---

## 3. `$.viewport` — render target

Пространство имён существует, но в этой сборке **не поддержано**:

| Метод | Поведение |
|---|---|
| `$.viewport.supported` | `false` |
| `$.viewport.create(w, h)` | бросает `Error`: «render target не поддержан в этой сборке…» |
| `$.viewport.get(id)` | `null` |
| `$.viewport.remove(id)` | `false` |
| `$.viewport.list()` | `[]` |
| `$.viewport.draw(id, x, y, w, h, alpha)` | бросает `Error` с тем же текстом |

То же и на низком уровне: `engine.viewport.supported === false`, а
`create/destroy/size/begin/end/draw/capture` бросают `TypeError` с понятным
текстом; `engine.viewport.count()` честно возвращает `0`.

```js
try {
    const id = $.viewport.create(256, 256);
} catch (error) {
    $.log(error.message);   // что случилось и куда смотреть
}
```

---

## 4. Почему render target не сделан и что перестроить

Причина архитектурная, а не «не успели»: сейчас **render pass открывает
`main.c`**, и `r2d_render_draw(renderer, pass)` получает его уже открытым.

```
main.c:
    r2d_render_upload(renderer, cmd)              // copy pass — заливка VB/IB
    target.texture = swapchain
    pass = SDL_BeginGPURenderPass(cmd, &target, 1, NULL)
        r2d_render_draw(renderer, pass)           // спрайты и треугольники
        r2d_debug_ui_draw(debug, cmd, pass)
    SDL_EndGPURenderPass(pass)
```

Отсюда три ограничения: (1) вложить новый render pass в уже открытый нельзя;
(2) смена цели — это не смена viewport, а новый `SDL_BeginGPURenderPass` с
другой текстурой; (3) команды `viewport.begin()/end()` приходят из JS во время
сборки кадра, когда буфер команд и проход уже заняты.

Чтобы сделать честно, нужно (следующим шагом, с правкой `main.c` — это
интеграционная точка, не файл подсистемы):

1. **Offscreen-текстуры.** Добавить в `R2DRenderer` пул текстур с
   `SDL_GPU_TEXTUREUSAGE_COLOR_TARGET | SDL_GPU_TEXTUREUSAGE_SAMPLER` (сейчас
   `r2d__create_texture` умеет только `SAMPLER`). Формат — как у swapchain,
   тогда существующие конвейеры переиспользуются; иначе понадобятся отдельные
   конвейеры на формат.
2. **Список команд вместо прямых вызовов.** `viewport.begin(id)` /
   `end()` / `draw(...)` из JS должны не открывать проход сразу, а записывать
   команды в массив рендерера: `{ target, clear, диапазон батча }`. Тогда
   `submitSprites`/`submitTriangles` получают ещё и «текущую цель», и
   `r2d_render_draw` режет батч не только по текстуре/режиму, но и по цели.
3. **Пред-проход до swapchain.** Новый вызов уровня `main.c`
   (`r2d_render_draw_targets(renderer, cmd)`), который **до** основного
   `SDL_BeginGPURenderPass` проходит по списку целей: для каждой —
   `SDL_BeginGPURenderPass` по offscreen-текстуре, заливка нужного диапазона
   батча, `SDL_EndGPURenderPass`. Порядок: сначала все offscreen-проходы,
   потом основной (порталы могут ссылаться друг на друга — нужен порядок
   зависимостей).
4. **Регистрация результата как спрайта.** `$.viewport.draw(id, x, y, w, h, alpha)`
   рисует текстуру буфера обычным спрайтом: завести `R2DTexture`/`R2DSprite`
   поверх offscreen-текстуры (sampler-биндинг) и добавить команду в батч.
5. **`capture(id)`.** Чтение пикселей — это `SDL_DownloadFromGPUTexture` +
   transfer-буфер + fence после отправки кадра. Синхронно в том же кадре не
   выйдет, поэтому контракт должен быть «снимок прошлого кадра» либо
   `await`-хелпер; это отдельное решение по API.
6. **Согласовать с `r2d_gui_render`/ImGui.** Они открывают собственные проходы
   после основного; offscreen-проходы обязаны идти до них.

Когда это будет сделано, `$.viewport` из подсистемы станет тонкой обёрткой над
`engine.viewport` (проверка `supported === true` уже стоит в `viewport.js`) —
менять её интерфейс не придётся.

---

## 5. Ограничения

* Режим смешивания — свойство **пакета**, а не отдельного спрайта: JS группирует
  подряд идущие спрайты, из-за чего смена режима добавляет draw call. Для
  «шахматного» чередования режимов пакетов будет много — группируйте сами.
* `none` пишет цвет без смешивания, включая альфу: прозрачные пиксели
  источника затирают назначение. Это осознанное определение режима.
* Треугольники, как и раньше, рисуются **после** спрайтов кадра (свет поверх
  сцены), поэтому их режим не влияет на порядок относительно спрайтов.
* Render target не поддержан — см. §3–4.

---

## 6. Тесты

| Что | Файл | Запуск |
|---|---|---|
| Нормализация режимов, приоритет `node.blend_mode`, нарезка на участки, ошибка render target | `tests/js/viewport_test.mjs` | `build/_deps/quickjs-build/qjs tests/js/viewport_test.mjs` |
| Кадр со всеми четырьмя режимами рисуется, `$.viewport` объясняет отказ | `tests/agent/highlevel_render_test.py`, фикстура `tests/fixtures/render/` | `python3 tests/agent/highlevel_render_test.py` (после сборки) |

---

## 7. Файлы

| Файл | Что там |
|---|---|
| `src/render.h` | `R2DBlendMode`, `pipelines[]`, поля `blend` у команд и диапазонов треугольников |
| `src/render.c` | конвейеры по режимам, `blend_state`, переключение в `r2d_render_draw`, биндинги `submitSprites`/`submitTriangles`, заглушка `engine.viewport` |
| `src/highlevel/viewport.js` | `$.blend`, `$.viewport`, чистые хелперы `normalizeBlend`/`nodeBlendMode`/`resolveBlend`/`blendRuns` |
| `tests/fixtures/render/` | фикстура агентского теста |


---

## TileMap — тайловые карты `$('<tilemap>')`

<sub>источник: `docs/highlevel/tilemap.md`</sub>

# TileMap — тайловые карты `$('<tilemap>')`

Подсистема `$.tilemap` — аналог `TileMapLayer` + `TileSet` из Godot 4: карта
хранит тайлы нескольких слоёв, рисует только видимую часть и заводит
статические тела под непроходимые тайлы.

Всё живёт на уже знакомом теге `<tilemap>`:

```js
$.ready(() => {
    $.tilemap.fromASCII([
        '#########',
        '#.......#',
        '#..###..#',
        '#.......#',
        '#########',
    ], { '#': 1, '.': 0 }, { src: 'assets/tiles.png', tile: 32, solid: true })
      .at(0, 0);

    $.camera.follow('#hero');
});
```

Модуль сам считает видимый диапазон тайлов по камере, поэтому карта 200×200
рисует столько спрайтов, сколько помещается на экран, а не 40 000 за кадр.

---

## 1. Система координат

* `x`/`y` узла — **центр карты**, как у любого другого узла;
* тайл `(0, 0)` — **левый верхний угол** карты;
* тайл `id 0` и любой `id < 0` — пусто, такой тайл не рисуется;
* масштаб узла (`.scale()`) растягивает карту вместе с тайлами.

Габарит узла `.w`/`.h` модуль выставляет сам: это объединение размеров слоёв
(`число тайлов × размер тайла`).

---

## 2. Создание

| Способ | Назначение |
|---|---|
| `$('<tilemap>', { … })` | обычное создание узла |
| `$.tilemap.create({ … })` | то же самое, но явно читается намерение |
| `$.tilemap.fromASCII(rows, legend, opts)` | данные из массива строк |

### Поля `opts`

| Поле | Тип | По умолчанию | Значение |
|---|---|---|---|
| `src` | строка | — | путь к текстуре тайлсета |
| `tile` | число | `32` | размер тайла в пикселях |
| `cols` | число | ширина текстуры / `tile` | сколько тайлов в строке текстуры |
| `rows` | число | высота текстуры / `tile` | сколько строк тайлов в текстуре |
| `data` | массив | `[]` | данные карты (см. ниже) |
| `solid` | `true` \| числа \| функция | `false` | какие тайлы непроходимы |
| `layers` | массив | — | несколько слоёв сразу (см. §5) |
| `legend` | объект | — | символ → id для строковых данных |
| `mapW` / `mapH` | число | — | размер карты в тайлах для плоского массива |

### Форматы `data`

```js
data: [1, 1, 0, 1, 1, 0],            // плоский массив (нужен mapW или mapH)
data: ['##..', '.##.', '..##'],      // массив строк (ASCII)
data: [[1, 1], [0, 1]],              // массив строк-массивов
data: new Int32Array([1, 1, 0, 1]),  // типизированный массив
```

В строковом виде символ `'0'…'9'` читается как число, остальные — как `0`,
если для них не задана `legend`:

```js
$.tilemap.fromASCII(['###', '#.#'], { '#': 1, '.': 0 });
```

### Пример со всеми полями

```js
$('<tilemap>', {
    id: 'level',
    src: 'assets/tiles.png',
    tile: 32,
    cols: 8,                 // 8 тайлов в строке текстуры
    data: ['1111', '1001', '1111'],
    solid: [1, 2],           // непроходимы тайлы 1 и 2
}).at(600, 400).appendTo($.world);
```

---

## 3. Методы узла

Все методы возвращают обёртку и работают цепочкой (кроме геттеров).

| Метод | Что делает |
|---|---|
| `.setTile(x, y, id [, layer])` | поставить тайл; меняет и «форму» при автотайле |
| `.tileAt(x, y [, layer])` | id тайла (0 вне карты) |
| `.fill(id [, layer])` | заполнить слой одним тайлом |
| `.clearTiles([layer])` | очистить слой; **без аргумента — все слои и их тела** |
| `.tileSize(n)` | размер тайла слоя (пересчитывает габарит и коллизии) |
| `.autotile({ … })` | подобрать визуальные тайлы по соседям |
| `.ysort(on)` | режим Y-sort: тайлы рисуются полосами и чередуются с сущностями |
| `.collisions(on)` | включить/выключить непроходимость всех слоёв |
| `.rebuild()` | пересобрать автотайл, габарит и тела коллизий |
| `.tilesData([layer])` | плоская копия данных слоя |
| `.tilesList([layer])` | список непустых тайлов `{ x, y, id, layer }` |
| `.terrainData([name])` | сохраняемые наборы террейнов (`{}` без аргумента) |
| `.tileLayer(index)` | выбрать активный слой карты |

```js
$('#level').setTile(3, 2, 1).fill(1).clearTiles();
const id = $('#level').tileAt(3, 2);
const all = $('#level').tilesList();          // [{ x, y, id, layer }, …]
```

> **Внимание.** Имена `.layer()` и `.data()` уже заняты ядром `$` (порядок
> отрисовки и хранилище значений на узле), поэтому активный слой карты
> выбирается методом `.tileLayer(index)`, а данные читаются через
> `.tilesData()` / `.tilesList()`. Все методы слоёв принимают номер слоя и
> явным аргументом.

---

## 4. Автотайл

`.autotile()` считает битовую маску соседей вокруг каждого тайла и подставляет
визуальный тайл из тайлсета. Исходная «форма» запоминается, поэтому повторный
вызов идемпотентен, а `.clearTiles()`/`.fill()` продолжают работать.

```js
$('#level').autotile({ mode: 'bit16', solid: [1] });
$('#level').autotile({ mode: 'blob47', solid: (x, y, id) => id === 1, border: true });
$('#level').autotile({ mode: 'terrain', terrain: 'grass' });   // см. §11
```

| Опция | Значение |
|---|---|
| `mode` | `'bit16'` (4 направления), `'blob47'` (8 направлений) или `'terrain'` |
| `terrain` | имя/описание набора террейнов вместо обычной раскладки (см. §10) |
| `solid` | функция `(x, y, id) → bool`, массив id или «любой непустой» |
| `border` | `true` — за границей карты всё сплошное (стены по краю) |
| `base` | id первого тайла набора, по умолчанию `1` |
| `layerIndex` | слой (по умолчанию активный) |

Нумерация битов (она же порядок тайлов в наборе):

* `bit16`: `N=1, E=2, S=4, W=8` → визуальный тайл `base + mask` (16 тайлов);
* `blob47`: `N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128` → тайл
  `base + $.tilemap.blob47Index(mask)` (47 форм).

Диагональ влияет на форму только тогда, когда есть оба смежных ортогональных
соседа (внутренний угол) — так 256 масок сворачиваются ровно в 47 форм.
Раскладка доступна как `$.tilemap.BLOB47_LAYOUT` (массив из 47 ключей).

Чистые функции (проверяются qjs-тестом и пригодны для своих инструментов):

```js
$.tilemap.autotileMask(isSolid, tx, ty, { mode, border, cols, rows });
$.tilemap.autotileTile(mask, { mode, base });
$.tilemap.blob47Index(mask);       // 0..46
$.tilemap.BLOB47_LAYOUT;           // 47 форм
```

---

## 5. Слои

Массив слоёв в `opts` создаёт их сразу. Слои рисуются снизу вверх по `depth`
(меньше — раньше), у каждого свои данные, тайлсет, размер тайла и
непроходимость.

```js
$('<tilemap>', {
    id: 'level',
    layers: [
        { data: ground, src: 'assets/ground.png', tile: 32, solid: true,  depth: 0 },
        { data: deco,   src: 'assets/deco.png',   tile: 32, solid: false, depth: 10 },
    ],
}).at(0, 0);
```

| Метод | Значение |
|---|---|
| `.tileLayer(1)` | сделать слой 1 активным |
| `.setTile(x, y, id, 1)` | правка конкретного слоя без смены активного |
| `$.tilemap.layer('#level', 1)` | то же из пространства имён |

---

## 6. Коллизии

При `solid: true` (или массиве/функции id) непроходимые тайлы становятся
статическими телами Box2D. Соседние тайлы в строке склеиваются в одну
горизонтальную полосу — на длинную платформу уходит одно тело, а не десятки.

Тела создаются и пересоздаются в `tickTilemap(dt)` — один раз за кадр, а
правки данных (`.setTile()` и т.п.) только помечают карту «грязной». Тела
снимаются при `.clearTiles()`, `.collisions(false)` и `.remove()`.

```js
$('#level').collisions(false);   // выключить физику тайлов
$('#level').collisions([1, 2]);  // непроходимы только id 1 и 2
$('#level').rebuild();           // пересобрать тела сейчас
```

Каждое тело регистрируется в `ctx.byBody`, поэтому `$.world.raycast()` и
`$.world.bodyAt()` возвращают узел карты — по ним работает `.onFloor()`.

Полосы можно посмотреть без движка:

```js
$.tilemap.runsOf('#level', 0);   // [{ tx, ty, len }, …]
$.tilemap.solidRuns(cols, rows, (x, y) => bool);   // чистая функция
```

---

## 7. Координаты и помощники

| Функция | Результат |
|---|---|
| `$.tilemap.pixelToTile(tm, x, y)` | `{ tx, ty }` — тайл под мировой точкой |
| `$.tilemap.tileToPixel(tm, tx, ty)` | `{ x, y }` — центр тайла в мире |
| `$.tilemap.tileIndexAt(tm, tx, ty)` | плоский индекс или `-1` |
| `$.tilemap.geometry(tm)` | `{ x, y, tile, cols, rows }` |
| `$.tilemap.layer(tm [, index])` | активный слой (или переключить) |

Первым аргументом принимается узел, обёртка, селектор (`'#level'`) или готовая
геометрия — поэтому функции остаются чистыми и тестируются без движка.

```js
const p = $.tilemap.tileToPixel('#level', 4, 3);
const t = $.tilemap.pixelToTile('#level', mouse.x, mouse.y);
if ($('#level').tileAt(t.tx, t.ty) === 1) { /* клик по стене */ }
```

---

## 8. Полный пример

```js
$.ready(() => {
    $.world.gravity(0, 1400).color('#0d1117').bounds(0, 0, 2400, 1200);

    $.tilemap.fromASCII([
        '####################',
        '#..................#',
        '#....####..........#',
        '#..................#',
        '####################',
    ], { '#': 1, '.': 0 }, {
        id: 'level',
        src: 'assets/tiles.png',
        tile: 32,
        cols: 8,
        solid: true,
    }).at(600, 400);

    $('#level').autotile({ mode: 'bit16', solid: [1] });

    $('<player>', { id: 'hero' }).at(600, 500).size(28, 40)
        .controls('wasd').appendTo($.world);
    $.camera.follow('#hero');

    // Ломаем тайл, по которому стреляет игрок.
    $.update(() => {
        if ($.input.pressed('mouse.left')) {
            const m = $.input.mouseWorld();
            const t = $.tilemap.pixelToTile('#level', m.x, m.y);
            if ($('#level').tileAt(t.tx, t.ty) === 1) {
                $('#level').setTile(t.tx, t.ty, 0).rebuild();
            }
        }
    });
});
```

---

## 9. Ограничения

* Непроходимость пересчитывается по **текущим** координатам узла: после
  `.at()`/`.move()` карты вызовите `.rebuild()`, чтобы тела переехали.
* Отрицательный масштаб (`.flip()`) карте не поддержан — тайлы всё равно
  рисуются в прямом порядке.
* Автотайл пишет визуальные id в те же данные; исходная форма хранится
  отдельно и восстанавливается повторным `.autotile()`. Если после этого
  править тайлы вручную, правьте и «форму» — проще вызвать `.setTile()` до
  `.autotile()`.
* Тайлсет должен быть ровной сеткой: начало координат `(0, 0)`, тайлы
  `tile × tile`, слева направо и сверху вниз; id 1 — первый тайл.
* Y-sort включается на карте отдельно (`.ysort(true)`) и по умолчанию
  выключен, поэтому старые игры рисуются как раньше.
* Функцию-`solid` у террейна нельзя сохранить в JSON — `.terrainData()`
  вернёт для неё `null`; храните массив id, если набор нужно сериализовать.

---

## 10. Y-sort: тайлы между сущностями

По умолчанию карта — один узел, и в глобальной сортировке она занимает одну
позицию по Y: игрок не может встать «между» тайлами. Режим `.ysort(true)`
убирает общий прямоугольник карты из отрисовки и заставляет её отдавать свои
тайлы по одному, вместе с мировой Y.

```js
$.world.sort('y');                       // мир сортируется по Y
$('#level').ysort(true);                 // карта участвует в этом порядке

// Общий рендер чередует полосы сам, если интегратор добавил хуки (см. ниже).
// Ручной вариант, если рисуете сущности своим проходом:
for (const e of entities) {
    $.tilemap.flushTilesUpTo('#level', null, e.y);   // cam — текущая
    $.gfx.push.sprite(e.sprite, e.screenX, e.screenY, e.w, e.h, 0, e.color);
}
$.tilemap.flushTiles();                  // остаток тайлов
```

| Функция | Результат |
|---|---|
| `$.tilemap.ysort(tm, on)` | включить/выключить режим; вернуть новое значение |
| `$.tilemap.visibleTiles(tm, cam [, opts])` | видимые тайлы по возрастанию Y: `{ tx, ty, id, li, layer, x, y, w, h }` |
| `$.tilemap.flushTilesUpTo(tm, cam, worldY)` | дорисовать тайлы с `y <= worldY`; вернуть число спрайтов |
| `$.tilemap.flushTiles(cam)` | дорисовать остаток всех карт Y-sort (конец кадра) |
| `$.tilemap.ysortReset(tm)` | сбросить курсор полос (тесты, ручное управление кадром) |

Правило простое: **перед** спрайтом сущности вызовите `flushTilesUpTo` с её Y —
все тайлы не ниже неё окажутся под ней; тайлы выше дорисуются позже, когда
очередь дойдёт до них. В конце кадра `flushTiles(cam)` добивает остаток.

Стоимость: список видимых тайлов собирается один раз за кадр
(`O(видимых тайлов)`), дальше вызовы только двигают курсор — суммарно не
больше одного спрайта на тайл за кадр. Отсечение по камере сохраняется: вне
экрана тайлы не собираются и не рисуются.

### Подключение к общему рендеру (что нужно от интегратора)

`render.js` и `world.js` модуль не правит. Чтобы чередование работало
автоматически, не вызывая `flushTilesUpTo` руками, интегратору достаточно
двух строк в `render.js` (`_render`, цикл по `sortedNodes()`):

```js
for (const node of list) {
    // 1) догнать тайловые полосы до Y текущего узла
    if (ctx.gfx._ysortFlush) ctx.gfx._ysortFlush(cam, node.y);
    drawWorldNode(node, cam);
}
// 2) после всех узлов — остаток тайлов
if (ctx.gfx._ysortFlushEnd) ctx.gfx._ysortFlushEnd(cam);
```

Хуки `ctx.gfx._ysortFlush` / `_ysortFlushEnd` модуль ставит сам (если
`$.gfx`/`ctx.gfx` уже создан). Пока их никто не зовёт, карта в режиме Y-sort
честно рисует себя сама (тайлы по Y), а чередование с сущностями доступно
только через ручной `flushTilesUpTo`.

---

## 11. Террейны

Террейн — это набор тайлов с правилами связности, как terrain sets в Godot:
какие тайлы считаются «своими» для соседей (маска) и какой визуальный тайл
брать под каждую маску (таблица переходов). Маска считается тем же
bit16/blob47, что и у автотайла, поэтому террейны — надстройка, а не второй
алгоритм.

```js
// Набор можно задать в данных карты…
$('<tilemap>', {
    id: 'level', src: 'assets/terrain.png', tile: 32, cols: 8,
    terrains: {
        grass: {
            mode: 'blob47',
            base: 1,                      // тайл по умолчанию: base + номер формы
            transitions: { 0: 33, 255: 40 },   // «маска → тайл» поверх раскладки
            solid: [1],                   // что считается «своим» для соседей
            border: false,
        },
    },
    data: [...],
}).at(0, 0);

$('#level').autotile({ mode: 'terrain', terrain: 'grass' });
```

| Функция | Результат |
|---|---|
| `$.tilemap.terrain(tm, spec)` | задать набор (или `$.tilemap.terrain(tm, 'grass')` — получить) |
| `$.tilemap.terrain(tm [, name])` | без имени — список имён наборов карты |
| `$.tilemap.loadTerrains(tm, data)` | загрузить наборы из сохранённых данных; вернуть число |
| `$.tilemap.terrainKey(mask, mode)` | ключ таблицы переходов: маска для bit16, форма для blob47 |
| `$.tilemap.terrainTile(mask, set)` | тайл по маске: явный переход или `base + номер формы` |
| `$.tilemap.normalizeTerrain(spec)` | привести описание к единому виду (не мутирует вход) |
| `.terrainData([name])` | сохраняемая копия набора(ов) — годится для `JSON.stringify` |

Ключ таблицы переходов: для `bit16` — сама маска `0..15`, для `blob47` —
канонический ключ формы (`terrainKey(0, 'blob47') === 0`,
`terrainKey(255, 'blob47') === 255`). Если ключа нет, тайл берётся из общей
раскладки: `base + $.tilemap.blob47Index(mask)`.

Террейн перерисовывает только те непустые тайлы, что попадают в набор по
`solid`: чужие тайлы остаются такими, какими их поставили (в отличие от
обычного автотайла, который раскрашивает все непустые).

Сохранение и загрузка:

```js
const saved = $('#level').terrainData();     // { grass: { mode, base, transitions, … } }
localStorage.setItem('terrains', JSON.stringify(saved));

$.tilemap.create({ id: 'level2', src: 'assets/terrain.png', tile: 32, cols: 8 });
$.tilemap.loadTerrains('#level2', JSON.parse(localStorage.getItem('terrains')));
$('#level2').autotile({ mode: 'terrain', terrain: 'grass' });
```

Обычный `$.world.raycast()` и физика работают как раньше: террейн меняет
только визуальные id, «форма» тайлов лежит в исходных данных слоя
(`layer.source`), поэтому `.setTile()`/`.rebuild()`/`.clearTiles()` не ломаются.



---

## Зоны-триггеры — `$.triggers` и тег `<trigger>`

<sub>источник: `docs/highlevel/triggers.md`</sub>

# Зоны-триггеры — `$.triggers` и тег `<trigger>`

Подсистема `triggers.js` делает `<trigger>` тем, чем он и был задокументирован:
**зоной, которая шлёт `enter` / `leave`**, когда в неё входит и выходит узел.
Заодно она закрывает второй реальный баг — `.overlaps(sel, cb)`, который
подписывался на событие `'tick'`, а его никто не рассылал.

```js
$.ready(() => {
    // Зона-дверь: вошёл игрок — открываем, вышел — закрываем.
    $('<trigger>', { id: 'door' }).at(300, 300).size(80, 80).appendTo($.world);

    $('#door').on('enter', (e) => {
        if (e.data.other.get(0).tag === 'player') $.sound.play('door-open');
    });
    $('#door').on('leave', () => $.sound.play('door-close'));

    // .overlaps(sel, cb) теперь действительно вызывается каждый кадр.
    $('#hero').overlaps('.lava', (hit) => hit && hit.damage(10 * engine.dt));
});
```

---

## 1. Что именно починено

| Было | Стало |
|---|---|
| `<trigger>` — обычный узел, `enter`/`leave` не приходили | любая зона шлёт `enter`/`leave` при пересечении |
| `.overlaps(sel, cb)` подписывался на `'tick'` и не срабатывал | подписка идёт в реестр `watchOverlap`, `cb` зовётся каждый кадр |
| `.overlaps(sel)` (вариант `bool`) работал | работает без изменений |

Событие `'tick'` в API не рассылается нигде: трогать подписку было нечем,
поэтому `.overlaps(sel, cb)` молчал. Теперь интегратор подключает в `api.js`
экспортированный `watchOverlap`, и колбэк получает найденную цель или `null`.

---

## 2. Зона: кто это и что она ловит

Зоной считается узел, у которого выполнено хотя бы одно условие:

| Признак | Пример |
|---|---|
| тег `trigger` | `$('<trigger>').at(300, 300)` |
| класс `trigger` | `$('<area>', { class: 'trigger' })` |
| `attrs.trigger === true` | `$('<rect>', { trigger: true })` |

Зона следит за **пересечением своего прямоугольника** с прямоугольниками
других узлов (та же проверка, что `boundsOverlap` в ядре; касание краем
входом не считается).

### Кого зона считает вошедшим

| Ситуация | Цели зоны |
|---|---|
| `attrs.detect` не задан | узлы с физическим телом (`node.body >= 0`) |
| `attrs.detect` задан | только узлы, совпавшие с ним — **даже без тела** |

`attrs.detect` принимает:

| Тип | Пример | Смысл |
|---|---|---|
| селектор | `{ detect: '.enemy' }` | по классу, тегу, id, псевдоклассу |
| тег | `{ detect: 'player' }` | то же, короче |
| массив | `{ detect: ['enemy', '.boss'] }` | любое из совпадений |
| функция | `{ detect: (n) => n.attrs.team === 2 }` | произвольное условие |
| обёртка/узел | `{ detect: $('#hero') }` | ровно этот узел |

Из целей **всегда исключены**: сама зона, другие зоны (иначе триггеры
срабатывали бы друг на друга) и узлы интерфейса (`attrs.ui`).

---

## 3. Семантика `enter` / `leave`

* при первом кадре пересечения зона шлёт **одно** событие `enter`;
* пока пересечение не прервалось, `enter` **не повторяется** — сколько бы
  кадров цель ни стояла в зоне;
* когда цель вышла (или пересечение исчезло), приходит **одно** `leave`;
* повторный вход — снова `enter`; выход и вход независимы.

| Событие | Когда | `event.data` |
|---|---|---|
| `enter` | цель впервые пересекла зону | `{ other, self }` — обёртки цели и зоны |
| `leave` | цель перестала пересекать зону | `{ other, self }` |

```js
$('#door').on('enter', (e) => {
    const who = e.data.other;        // обёртка вошедшего узла
    const zone = e.data.self;        // обёртка самой зоны (== e.self)
    $.log(`вошёл ${who.get(0).tag} в зону ${zone.get(0).id}`);
});
```

События рассылаются и глобально через `Node.emit`, поэтому работают
`$.on('entity:enter', …)` и любые общие подписки.

### Исчезнувшая цель — это выход

Если цель удалили (`.remove()` / `destroy()`), пока она была в зоне, зона
**всё равно шлёт `leave`** — иначе обработчики навсегда остались бы в
состоянии «внутри». В `e.data.other` при этом лежит уже удалённый узел:
`e.data.other.get(0).removed === true`.

### Невидимая зона не работает

`visible: false` выключает зону: новых `enter` нет, а прошлые пересечения
закрываются событиями `leave`. Чтобы зона была **невидимой, но рабочей**,
задайте `color: '#00ff0000'` или `alpha: 0` (отрисовка пропускает такие
узлы, а логика продолжает работать).

---

## 4. Публичное API

### `$.triggers`

| Метод | Назначение |
|---|---|
| `$.triggers.zone(opts)` | создать зону, вернуть обёртку |
| `$.triggers.list()` | все зоны мира — массив обёрток |
| `$.triggers.clear()` | удалить **все** зоны мира |
| `$.triggers.inside(zone, node)` | пересекается ли узел с зоной сейчас (bool) |
| `$.triggers.count(zone)` | сколько живых целей сейчас в зоне |

`zone`, `node` в `inside`/`count` принимают узел, обёртку или селектор
(`'#door'`, `'.lava'`). `count` учитывает `attrs.detect` зоны, поэтому для
detect-зоны считаются только её цели.

### `$.triggers.zone(opts)`

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `x`, `y` | number | `0` | центр зоны, как у остальных узлов |
| `w`, `h` | number | `100` | размеры |
| `detect` | селектор/массив/функция | — | кого ловить; без него — тела |
| `id`, `class` | string | — | id/класс узла-зоны |
| `tag` | string | `'trigger'` | тег узла (`'area'` — если нужен свой вид) |
| `color`, `alpha` | цвет/число | цвет из тега | вид зоны; `alpha: 0` — невидимая рабочая |
| `visible` | bool | `true` | `false` — зона выключена |
| `parent` | узел/обёртка | `$.world` | куда добавить |
| `onEnter` | `(other, self) => {}` | — | обёртки цели и зоны |
| `onLeave` | `(other, self) => {}` | — | то же при выходе |

```js
$.triggers.zone({
    id: 'shop',
    x: 200, y: 500, w: 80, h: 80,
    detect: '.customer',
    color: '#ffcc0033',
    onEnter: (who) => who.addClass('at-shop'),
    onLeave: (who) => who.removeClass('at-shop'),
});
```

### Чистые функции (экспортируются, проверяются qjs)

| Функция | Что делает |
|---|---|
| `zoneContains(zone, node)` | `true`, если прямоугольники пересекаются (учитывает `hitbox`, `scale_x/scale_y`) |
| `diffOverlaps(prevSet, nextSet)` | `{ entered, left }` — кто вошёл и кто вышел |

`zoneContains` понимает и узел, и простой дескриптор `{ x, y, w, h }`,
поэтому её удобно проверять без движка:

```js
zoneContains({ x: 0, y: 0, w: 100, h: 100 }, { x: 45, y: 0, w: 10, h: 10 }); // true
zoneContains({ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 10, h: 10 }); // false (касание)
diffOverlaps(new Set([a, b]), new Set([b, c]));  // { entered: [c], left: [a] }
```

### `watchOverlap(node, others, cb)`

Реестр покадровых наблюдателей пересечения. Возвращает функцию отписки.

```js
const off = watchOverlap($('#hero').get(0), query('.lava'), (hit, self) => {
    if (hit) hit.damage(1);
});
// позже: off();
```

Поведение `cb`:

| Аргумент | Значение |
|---|---|
| `hit` | обёртка первой живой цели, пересекающейся с `node`, или `null` |
| `self` | обёртка самого наблюдающего узла |

`cb` вызывается **каждый кадр** (а не только на изменение). Удалённые
(«потерянные») цели пропускаются и дают `null` — исключения не летят; если
удалён сам наблюдающий узел, наблюдатель снимается автоматически. Ошибка
внутри `cb` ловится и пишется в журнал, кадр не падает.

Именно сюда подключается `.overlaps(sel, cb)`: `sel` разбирается в массив
узлов через `query(sel)` один раз при подписке.

---

## 5. Примеры

### Дверь открывается только для игрока

```js
$('<trigger>', { id: 'door', detect: 'player' }).at(300, 300).size(80, 80).appendTo($.world);

$('#door').on('enter', () => $('#door').attr('open', true));
$('#door').on('leave', () => $('#door').attr('open', false));
```

### Урон в лаве раз в кадр

```js
$('#hero').overlaps('.lava', (hit) => {
    if (hit) $('#hero').damage(30 * engine.dt);
});
```

### Ловушка на исчезнувшую цель

```js
$.store.set('kills', 0);
$('<trigger>', { id: 'pit', detect: 'enemy' }).at(600, 500).size(60, 60)
    .appendTo($.world)
    .on('enter', (e) => { e.data.other.kill(); $.store.set('kills', $.store.get('kills') + 1); })
    // Убитый узел исчезает — и это закрывает пересечение событием leave.
    .on('leave', (e) => $.log('из ямы ушёл ' + (e.data.other.get(0).id || 'безымянный')));
```

### Временная зона, созданная из кода

```js
const blast = $.triggers.zone({
    x: 400, y: 300, w: 160, h: 160, detect: 'enemy',
    onEnter: (who) => who.damage(50),
});
$.time.wait(200).then(() => $.triggers.clear());   // убрать все зоны разом
```

---

## 6. Ограничения и решения

* **Прямоугольники, а не тела.** Пересечение считается по габаритам узла
  (`w`/`h`, `hitbox`, масштаб), без обращения к Box2D. Это предсказуемо,
  тестируется без движка и совпадает с `.overlaps`, `$.world.query`.
* **O(зон × целей).** Список узлов собирается один раз за кадр; каждая зона
  фильтрует его по своему `detect`. Для игр на тысячи зон это может стать
  горячим местом — уменьшайте число зон или разносите их по сценам.
* **`clear()` удаляет все зоны мира**, а не только созданные через
  `$.triggers.zone()` — `list()` и `clear()` тогда симметричны.
* **Порядок кадра.** `tickTriggers` вызывается после `ctx.world.sync`,
  поэтому зоны видят свежие позиции тел; события приходят с точностью до кадра.
* **`visible: false` выключает зону целиком.** Невидимая рабочая зона — это
  `alpha: 0` при `visible: true`.
* **Интерфейс не участвует.** Узлы с `attrs.ui` не бывают ни зонами, ни
  целями: они живут в экранных координатах.

---

## 7. Юнит- и интеграционные тесты

| Файл | Что проверяет |
|---|---|
| `tests/js/triggers_test.mjs` | чистые функции и жизненный цикл enter/leave без движка |
| `tests/agent/highlevel_triggers_test.py` | `<trigger>`, `detect`, `$.triggers.*`, `.overlaps` в живом движке |
| `tests/fixtures/triggers/` | игра-фикстура для интеграционного теста |

```bash
build/_deps/quickjs-build/qjs tests/js/triggers_test.mjs
python3 tests/agent/highlevel_triggers_test.py     # после сборки движка
```


---

## `$.tween` — Tween-объекты в стиле Godot 4

<sub>источник: `docs/highlevel/tween.md`</sub>

# `$.tween` — Tween-объекты в стиле Godot 4

Подсистема добавляет к `$` **Tween-объект** — сценарий анимации: свойства,
шаги, цепочки, циклы, скорость, пауза и события. Это аналог
`create_tween()` / `tween_property()` / `chain()` из Godot 4.

```js
$.ready(() => {
    $('<rect>', { id: 'hero' }).at(0, 200).size(32, 32).appendTo($.world);

    const t = $.tween($('#hero'));
    t.property('x', 400, 0.6).trans('quad').ease('out');
    t.property('alpha', 0.2, 0.6);          // параллельно первому свойству
    t.chain().property('y', 120, 0.4);      // следующий шаг
    t.loops(2).on('finished', () => $.log('готово'));
    t.finished().then(() => $.log('Promise тоже пришёл'));
});
```

Старый Promise-API (`.tween()`, `.tweenTo()`, `.moveTo()`, `.fadeTo()`,
`.scaleTo()`, `.rotateTo()`, `$.sequence`, `$.wait`, `shake/flash`) работает
как раньше и никуда не делся — это отдельный, независимый движок.

---

## Создание

| Вызов | Назначение |
|---|---|
| `$.tween(target?)` | создать Tween. `target` — узел, обёртка `$('#id')`, CSS-селектор или обычный объект |
| `$.tweenOf(object)` | то же, но явно для произвольного объекта (в т.ч. `Node`) |
| `$.tweens()` | массив живых (не убитых и не завершённых) Tween'ов |
| `$.tween.active()` | число живых Tween'ов |
| `$.tween.transition(trans, ease)` | та же чистая функция `transitionFunction` |

Если цель не найдена (нет узла по селектору), Tween создаётся, но `property()`
ничего не запишет — сначала проверьте селектор.

## Свойства и модификаторы

| Метод Tween | Возвращает | Смысл |
|---|---|---|
| `property(prop, to, seconds)` | PropertyTweener | анимировать свойство от текущего значения к `to` |
| `interval(seconds)` | IntervalTweener | пауза внутри сценария |
| `callback(fn)` | CallbackTweener | вызвать `fn()` в нужный момент |
| `method(fn, from, to, seconds)` | MethodTweener | звать `fn(value, t)`, где `value` интерполируется, `t` — прогресс с плавностью |
| `chain()` | Tween | начать новый шаг (следующий твинер — после завершения текущего) |
| `parallel()` | Tween | вернуться к «всё параллельно»; отменяет пустой шаг после `chain()` |
| `loops(n)` | Tween / число | число проходов; `n < 0` — бесконечно |
| `speed(scale)` | Tween / число | множитель скорости |
| `time()` | секунды | сколько времени сценария прожито (с учётом `speed`) |
| `progress()` | `0..1` | прогресс текущего прохода |
| `trans(name)` / `ease(kind)` | Tween | переход/плавность по умолчанию для последующих твинеров |
| `pause()` / `play()` | Tween | пауза и продолжение самого Tween'а |
| `stop()` | Tween | остановить, но оставить живым: `play()` продолжит с того же места |
| `kill()` | Tween | убить безвозвратно |
| `isRunning()` / `isValid()` / `isPaused()` | `bool` | состояние |
| `bind(node)` | Tween | убить Tween вместе с узлом |
| `ignoreTimeScale(flag)` | Tween | идти по реальному кадру, игнорируя паузу и `$.time.scale()` |
| `on('finished'\|'loop'\|'step', fn)` / `off(...)` | Tween | подписка на события |
| `finished()` | `Promise` | разрешается по завершении |

Модификаторы твинера (цепочкой на нём самом):

| Метод | Смысл |
|---|---|
| `.from(value)` | явное начальное значение |
| `.fromCurrent()` | начать от текущего значения (по умолчанию) |
| `.asRelative()` | `to` — приращение к начальному значению |
| `.delay(seconds)` | задержка перед стартом (алиас `.delaySeconds`) |
| `.trans(name)` / `.ease(kind)` | плавность только этого твинера |
| `.interpolator(fn(from, to, t) => value)` | своя интерполяция; `t` — уже с плавностью |

```js
const t = $.tween(node);
t.property('x', '+120', 0.4).asRelative().trans('back').ease('out');
t.property('scale', 1.4, 0.2).delay(0.4);
t.chain().interval(0.1).callback(() => $.log('пауза кончилась'));
t.method((v) => bar.value = v, 0, 1, 0.5).trans('sine').ease('in_out');
```

## Свойства цели

* **Узел** — те же имена, что понимает движок: `x`, `y`, `alpha`/`opacity`,
  `angle`/`rotation`, `scale`, `scaleX`, `scaleY`, `w`/`width`, `h`/`height`,
  `value`, а также любой числовой атрибут (`node.attrs[...]`).
* **Обычный объект** — любое числовое поле. Поддерживается вложенный путь
  `'a.b.c'`; недостающие промежуточные объекты создаются при записи.

## Порядок шагов

Твинеры, добавленные подряд, идут **параллельно** и образуют один шаг.
`chain()` начинает новый шаг, который стартует после завершения предыдущего
(с учётом `.delay()` всех его твинеров). `loops(n)` повторяет весь сценарий
целиком.

```js
const t = $.tween(node);
t.property('x', 100, 1.0);
t.property('y', 100, 1.0);      // идёт одновременно с x
t.chain().property('alpha', 0, 0.5);   // начнётся после x и y
```

## Переходы и плавности

Две независимые оси, как в Godot:

* `trans`: `linear`, `sine`, `quad`, `cubic`, `quart`, `quint`, `expo`,
  `circ`, `elastic`, `back`, `bounce`, `spring`;
* `ease`: `in`, `out`, `in_out`, `out_in` (короткие `inOut` / `outIn`).

```js
import { transitionFunction } from './src/highlevel/tween.js';
const f = transitionFunction('quad', 'out');   // чистая функция t → [0..1]
```

Границы жёсткие: `f(0) === 0`, `f(1) === 1`. Внутри `elastic`, `back` и
`spring` перелетают цель — это их смысл. Неизвестное имя перехода или
плавности не роняет игру: пишется строка в журнал и берётся `linear`/`in_out`.

## События и `finished()`

```js
const t = $.tween(node);
t.property('x', 100, 1);
t.loops(3);
t.on('step', (e) => $.log('шаг', e.step, 'проход', e.loop));
t.on('loop', (e) => $.log('проход', e.loop));
t.on('finished', () => $.log('всё'));
await t.finished();
```

* `step` — шаг завершён (поле `step` — индекс шага, `loop` — номер прохода);
* `loop` — проход завершён и начинается следующий (в конце последнего прохода
  `loop` уже не приходит);
* `finished` — сценарий закончился целиком; при `loops(-1)` не приходит никогда.

## Время, пауза и kill

* Tween живёт в игровом времени: `$.time.pause()` останавливает его,
  `$.time.scale()` ускоряет/замедляет. `ignoreTimeScale(true)` переключает
  Tween на реальный кадр — тогда на него не действуют ни пауза, ни масштаб.
* Свойство с `seconds <= 0` в первом шаге применяется сразу, без кадра.
* `kill()` делает Tween недействительным: `finished()` **не** разрешается, а
  `on('finished')` не вызывается (как в Godot). `stop()` — мягкая остановка,
  после неё `play()` продолжает с того же места.
* `bind(node)` убивает Tween, когда узел удалён (`removed`) или убит
  (`max_hp > 0` и `cur_hp <= 0`).

## Отличия от старого Promise-API

| | старый API | `$.tween` |
|---|---|---|
| Единица | один переход | сценарий из шагов |
| Результат | `Promise` | объект с `finished()` и событиями |
| Параллельность | только через `Promise.all` | по умолчанию |
| Циклы | вручную | `loops(n)` |
| Пауза | `.pauseTweens()` на узле | `t.pause()` + общая `$.time.pause()` |
| Плавность | `easeInOutQuad` и т. п. (`EASES`) | `trans` × `ease` (`transitionFunction`) |
| Задержка | `await $.wait(ms)` | `.delay(seconds)` |

Старые имена плавностей (`easeFunction`, `easeNames`, `EASES`) сохранены без
изменений — на них стоят демо и `$.anim`.

## Ограничения

* `trans`/`ease`, заданные на Tween, влияют только на **последующие**
  твинеры; для уже добавленного используйте модификатор на нём самом.
* Мгновенный твинер (`seconds = 0`) первого шага записывает значение сразу,
  поэтому `.delay()` на нём влияет только на момент завершения шага, но не на
  момент записи значения.
* `bind()` реагирует на `removed` и на смерть по здоровью (`max_hp > 0`); у
  узлов без здоровья (`max_hp === 0`) смерть по `cur_hp` не отслеживается.
* `loops(-1)` со сценарием из одних мгновенных шагов прокручивает один проход
  за кадр — иначе кадр завис бы в бесконечном цикле.


---

## UI-контролы — `$.ui` и теги `<ui.*>`

<sub>источник: `docs/highlevel/widgets.md`</sub>

# UI-контролы — `$.ui` и теги `<ui.*>`

Подсистема `widgets.js` дополняет `$.ui` (файл `ui.js`) набором контролов —
аналог `Control`/`Container`/`LineEdit`/`CheckBox`/`Slider`/`ScrollContainer`/
`AcceptDialog` из Godot 4. Всё живёт на обычных узлах интерфейса:

```js
$.ready(() => {
    const menu = $('<ui.col>', { id: 'menu', gap: 10, padding: 16 })
        .at(400, 120).size(320, 260).appendTo($.ui);

    $('<ui.label>', { text: 'Настройки' }).size(220, 28).appendTo(menu);
    $('<ui.checkbox>', { id: 'sound', text: 'Звук' }).size(240, 28).appendTo(menu);
    $('<ui.slider>',   { id: 'vol', min: 0, max: 100, step: 5, value: 70 })
        .size(240, 28).appendTo(menu);
    $('<ui.input>',    { id: 'name', maxLength: 16, placeholder: 'Имя' })
        .size(240, 32).appendTo(menu);

    $('#vol').on('change', (e) => $.sound.volume(e.data.value / 100));
});
```

Все контролы — узлы в координатах окна (`attrs.ui = true`), камера на них не
влияет, и в `$.world.count()` они не попадают. `x`/`y` узла — **центр**, как у
`<ui.button>`.

Поверх абсолютных пикселей модуль даёт **якоря** (узел сам подстраивается под
разрешение окна — §3) и **темы** (общие цвета состояний, размер шрифта и
отступы — §4). Оба механизма включаются явно: узел без якоря и темы ведёт себя
как раньше.

---

## 1. Теги и параметры

| Тег | Назначение | Параметры |
|---|---|---|
| `<ui.row>` | ряд, дети слева направо | `gap`, `padding`, `align`, `color`, `border` |
| `<ui.col>` | колонка, дети сверху вниз | те же |
| `<ui.grid>` | сетка с переносом | те же + `columns` (по умолчанию 2) |
| `<ui.scroll>` | прокручиваемая область | `gap`, `padding`, `align`, `scroll` |
| `<ui.checkbox>` | флажок | `checked`, `text`, `color`, `hoverColor`, `fillColor`, `textColor` |
| `<ui.slider>` | ползунок | `min`, `max`, `step`, `value`, `fillColor`, `color` |
| `<ui.input>` | текстовое поле | `text`/`value`, `maxLength`, `placeholder`, `textColor` |
| `<ui.list>` | вертикальный список | `items`, `index`, `itemHeight`, `fillColor` |
| `<ui.dialog>` | модальное окно | `title`, `text`, `buttons`, `closeOnAction` |

**Параметры раскладки**

| Параметр | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `gap` | number | 8 | расстояние между детьми |
| `padding` | number | 8 | отступ от края контейнера |
| `align` | `'start'`\|`'center'`\|`'end'`\|`'stretch'` | `'start'` | выравнивание по поперечной оси |
| `columns` | number | 2 | число колонок `<ui.grid>` |
| `tabIndex` | number | 0 | порядок обхода Tab (меньше — раньше) |
| `anchorLeft`/`anchorTop`/`anchorRight`/`anchorBottom` | number 0..1 | — | якоря в атрибутах (см. §3) |
| `offsetLeft`/`offsetTop`/`offsetRight`/`offsetBottom` | number | 0 | отступы якоря в пикселях |
| `disabled` | bool | `false` | контрол не берёт ввод и рисуется неактивным |

`<ui.row>`/`<ui.col>`/`<ui.grid>` без `.size()` сами обнимают содержимое
(авторазмер); `<ui.scroll>` наоборот задаёт окно просмотра и прокручивает
содержимое.

Строку `<ui.input>` задавайте через `.value('…')` (метод) или атрибут `text`:
`Node.set('value')` в ядре приводит значение к числу, поэтому строка в
`$('<ui.input>', { value: 'Имя' })` не сохранится — используйте
`$('<ui.input>').value('Имя')` или `{ text: 'Имя' }`.

---

## 2. События

| Событие | Кто шлёт | `event.data` |
|---|---|---|
| `change` | checkbox, slider, input | `{ value }` (у флажка ещё `checked`) |
| `submit` | input по Enter | `{ value }` |
| `select` | list | `{ index, item, value }` |
| `confirm` | dialog | `{ index, text, action }` |
| `cancel` | dialog (кнопка «Отмена», Esc) | `{ index, text, action }` |
| `focus` / `blur` | любой контрол | `{}` |

Плюс общие для всех узлов `$('<ui.*>').on('click'/'mouseenter'/'mouseleave', …)`
и глобальные подписки `$.on('entity:change', …)`.

```js
$('#sound').on('change', (e) => $.store.set('sound', e.data.checked));
$('#vol').on('change', (e) => $.store.set('vol', e.data.value));
$('#name').on('submit', (e) => $.store.set('name', e.data.value));
```

---

## 3. Якоря и относительные размеры

По умолчанию узел стоит в абсолютных пикселях (`.at()`/`.size()`) — на другом
разрешении раскладка разъезжается. Якорь описывает край прямоугольника как
долю родителя плюс пиксельный отступ (модель Godot `Control`):

```
edge = parent.origin + anchor * parent.size + offset
```

`anchorLeft/Top/Right/Bottom` — доли 0..1, `offsetLeft/Top/Right/Bottom` —
отступы. Родитель — узел-`parent_node`; у узла верхнего уровня — окно
(`$.window.size()`). Пока ни один якорь не задан, узел живёт в абсолютных
пикселях, как раньше.

```js
$.ready(() => {
    // Верхняя панель во всю ширину, высотой 48.
    $('<ui.panel>', { id: 'hud', anchorLeft: 0, anchorRight: 1, anchorTop: 0, anchorBottom: 0,
                      offsetTop: 0, offsetBottom: 48 }).appendTo($.ui);

    // Кнопка у правого нижнего угла, 120×40.
    $('<ui.button>', { id: 'ok', text: 'OK' }).size(120, 40)
        .anchorPreset('bottom-right').appendTo($.ui);

    // Полупрозрачная подложка на половину окна.
    $('<ui.panel>', { id: 'half' }).sizePercent('50%', '25%').appendTo($.ui);
});
```

### Пресеты `.anchorPreset(name)`

| Пресет | Якоря (l, t, r, b) | Смысл |
|---|---|---|
| `top-left` / `top-right` / `bottom-left` / `bottom-right` | 0/1 по краям | узел прижат к углу, размер сохраняется |
| `center` | 0.5, 0.5, 0.5, 0.5 | по центру, размер сохраняется |
| `full-rect` (он же `full`) | 0, 0, 1, 1 | на весь родитель |
| `top-wide` / `bottom-wide` | 0,0,1,0 / 0,1,1,1 | во всю ширину сверху/снизу |
| `left-tall` / `right-tall` | 0,0,0,1 / 1,0,1,1 | во всю высоту слева/справа |
| `hcenter` / `vcenter` | 0.5,0,0.5,0 / 0,0.5,0,0.5 | центрирование по одной оси |

Полный список — `$.ui.anchorPresets()`.

### Методы якорей

| Метод | Назначение |
|---|---|
| `.anchor(spec, offsets?)` | якоря строкой (`'left top'`, `'center'`, `'full-rect'`), объектом или числом; `offsets` дополняют отступы, сохраняющие текущий размер (незаданные стороны не схлопываются) |
| `.anchorPreset(name, offsets?)` | готовый пресет из таблицы |
| `.offset(spec)` | точечная правка отступов (число, массив `[l,t,r,b]`, `{left,…}` или `{x,y,w,h}`); значения сторон абсолютные, поэтому сдвиг узла задавайте обеими сторонами оси |
| `.rect(x, y, w, h)` | прямоугольник **от родителя** (в отличие от `.at()`, который считает от окна) |
| `.sizePercent(w, h)` | размер в долях родителя: `'50%'`, `50` или `0.5`; левый верх — из текущего якоря |
| `.anchors()` | текущие якоря `{ left, top, right, bottom }` |
| `.anchorRect()` | посчитанный прямоугольник в координатах родителя `{ x, y, w, h }` |
| `$.ui.anchorPresets()` | список имён пресетов |

Пересчёт идёт в `tickWidgets(dt)`: при изменении размера окна (`$.window.on('resize', …)`
и опрос `$.window.size()`) и при смене спецификации якоря. Якорные узлы **не
участвуют** в автоматической раскладке контейнера — их прямоугольник целиком
считает якорь. Если якорный узел сам является контейнером, его дети
пересобираются при resize.

---

## 4. Темы

Тема — общий набор значений для контролов: цвета состояний, размер шрифта,
отступы, промежутки и правила для отдельных тегов. Значения, которых в теме
нет, остаются такими, как задал узел, поэтому тема ничего не «затирает».

```js
$.ui.theme('dark', {
    extends: 'default',                 // наследование (по умолчанию 'default')
    size: 18, padding: 10, gap: 8,
    colors: {
        normal: '#22304aee', hover: '#2e405f', pressed: '#1a2436', disabled: '#3a4250',
        text: '#ffffff', textDisabled: '#8fa0bb',
        fill: '#4fa3ff', border: '#00000066', accent: '#4fa3ff', focus: '#4fa3ff',
    },
    tags: { 'ui.button': { color: '#2b3a55' } },
});

$('<ui.col>', { id: 'menu' }).theme('dark').appendTo($.ui);   // дети наследуют тему
$('#hint').style({ textColor: '#ffd166', size: 16 });          // точечная правка
```

Короткие ключи — синонимы полей `colors`: `color`, `hoverColor`, `pressedColor`,
`disabledColor`, `textColor`, `textDisabled`, `fillColor`, `borderColor`,
`accentColor`, `focusColor`. Имена состояний (`normal`, `hover`, `pressed`,
`disabled`) тоже можно писать на верхнем уровне темы.

### Наследование и приоритет

1. `.style({…})` на узле — всегда сильнее;
2. `tags['<тег>']` темы узла (например, для `ui.slider`);
3. тема узла (`.theme(name)`) или ближайшего родителя с темой;
4. тема по умолчанию (`$.ui.theme({…})`) — применяется ко всем контролам;
5. значения, заданные на узле напрямую (`.color()`, `.size()`).

`extends` собирает тему цепочкой от `'default'` до указанной; переопределяются
только заданные поля. Применение идёт в `tickWidgets` и при смене темы/стиля,
поэтому прямые `.color()`/`.size()`, вызванные после этого, сохраняются.

### Состояния

| Состояние | Когда | Ключи темы |
|---|---|---|
| `normal` | обычный вид | `normal`/`color`, `text`/`textColor`, `fill`/`fillColor` |
| `hover` | курсор над контролом | `hover`/`hoverColor` |
| `pressed` | кнопка мыши нажата | `pressed`/`pressedColor` |
| `disabled` | `disabled: true` / `.disabled(true)` | `disabled`/`disabledColor`, `textDisabled` |

Акцент (`accent`/`focus`) используется для обводки фокуса и флажка.

### Метод и функция темы

| Метод | Назначение |
|---|---|
| `$.ui.theme(spec)` | задать тему по умолчанию для всех контролов |
| `$.ui.theme(name, spec)` | задать/дополнить именованную тему (сливается со старой) |
| `$.ui.theme(name)` / `$.ui.theme()` | прочитать разобранную тему (с наследованием) |
| `$.ui.themeOf(nodeOrSelector)` | имя действующей темы узла или `null` |
| `$.ui.styleOf(nodeOrSelector)` | размер/отступы/цвета и `states` — для тестов и агента |
| `.theme([name])` | задать/прочитать тему узла, наследуется детьми |
| `.style({…})` | точечные правки поверх темы; без аргумента — чтение |
| `.disabled([bool])` | блокировка: контрол пропускается фокусом и рисуется неактивным |

---

## 5. Публичный API

### `$.ui`

| Метод | Назначение |
|---|---|
| `$.ui.focus(nodeOrSelector)` | поставить фокус на контрол |
| `$.ui.focused()` | обёртка узла в фокусе или `null` |
| `$.ui.focusedId()` | id узла в фокусе или `null` (удобно тестам и агенту) |
| `$.ui.focusNext()` / `$.ui.focusPrev()` | следующий/предыдущий контрол |
| `$.ui.blur([nodeOrSelector])` | снять фокус |
| `$.ui.dialog(opts)` | создать и показать модальный диалог |
| `$.ui.theme(name, spec)` | темы: цвета, размер шрифта, отступы, состояния (см. §4) |
| `$.ui.themeOf(nodeOrSelector)` | имя действующей темы узла |
| `$.ui.styleOf(nodeOrSelector)` | размер/отступы/цвета и `states` узла |
| `$.ui.anchorPresets()` | имена пресетов якорей (см. §3) |

`$.ui.dialog(opts)`: `{ id, title, text, buttons, w, h, onConfirm, onCancel }`.
`buttons` — массив строк или объектов `{ text, action }`; действие `'cancel'`
(или подпись «Отмена»/«Cancel») шлёт `cancel`, остальные — `confirm`.

```js
$.ui.dialog({
    title: 'Выход',
    text: 'Вернуться в меню?',
    buttons: ['Отмена', 'Да'],
    onConfirm: () => $.scene.load('menu'),
});
```

### Методы узла

| Метод | Тег | Назначение |
|---|---|---|
| `.checked([bool])` | checkbox | чтение/запись отметки (шлёт `change`) |
| `.items([array])` | list | элементы списка |
| `.selectedIndex([n])` | list | выбранный индекс (шлёт `select`) |
| `.selectedItem()` | list | значение выбранного элемента |
| `.sliderValue([n])` | slider | значение с приведением к `min`/`max`/`step` |
| `.min(n)` / `.step(n)` | slider | границы и шаг |
| `.maxLength(n)` | input | ограничение длины строки |
| `.placeholder(s)` | input | подсказка пустого поля |
| `.inputValue([s])` | input | строка поля (синоним `.text()`) |
| `.align(s)` / `.gap(n)` / `.padding(n)` | контейнеры | параметры раскладки |
| `.focus()` / `.blur()` | любой | фокус |
| `.openDialog()` / `.closeDialog()` | dialog | показать/скрыть |
| `.anchor(spec, offsets?)` / `.anchorPreset(name)` | любой | якоря и пресеты (§3) |
| `.rect(x,y,w,h)` / `.sizePercent(w,h)` / `.offset(spec)` | любой | прямоугольник от родителя, доли, отступы |
| `.anchors()` / `.anchorRect()` | любой | якоря и посчитанный прямоугольник |
| `.theme([name])` / `.style({…})` | любой | тема узла и точечные правки (§4) |
| `.disabled([bool])` | любой | блокировка контрола |

`value` и `max` — уже существующие методы ядра (`.value(n)`, `.max(n)`), они не
переопределяются.

---

## 6. Фокус и клавиатура

* фокус ставится кликом по контролу или программно;
* `Tab`/`Shift+Tab` обходят контролы в порядке создания, а при заданном
  `tabIndex` — по нему (меньше раньше; при равенстве — порядок создания);
* `<ui.input>`: ввод из `$.input.text()`, `Backspace`/`Delete`, `←`/`→`,
  `Home`/`End`, `Enter` — `submit`, `Esc` — снять фокус, курсор мигает;
* `<ui.slider>`: `←`/`↓`/`→`/`↑` — на шаг, `Home`/`End` — в границы;
* `<ui.checkbox>`: `Space`/`Enter` переключают;
* `<ui.list>`: `↑`/`↓` двигают выбор, `Home`/`End` — в начало/конец;
* `<ui.scroll>`: `↑`/`↓`, `PageUp`/`PageDown`, `Home`;
* `<ui.dialog>`: `←`/`→`/`Tab` — по кнопкам, `Enter`/`Space` — нажать, `Esc` —
  отмена. Пока диалог открыт, остальные контролы ввод не получают.

Ввод за кадр (`engine.textInput()`) отдаётся движком один раз, поэтому его
забирает только поле в фокусе — остальные `<ui.input>` его не видят.

---

## 7. Прокрутка

`<ui.scroll>` умеет:

* колесо мыши над контейнером;
* перетаскивание содержимого мышью;
* перетаскивание полосы прокрутки (появляется при переполнении);
* `scroll` всегда ограничен: `scroll ∈ [0, contentHeight − height]`.

Дети, целиком вышедшие за окно просмотра, не рисуются (проверка `_clip` в
отрисовщиках). Частично видимые дети рисуются целиком: `$.gfx.push` не умеет
сциссор (обрезку по прямоугольнику), поэтому точной обрезки текста и спрайтов
по краю нет.

---

## 8. Раскладка и производительность

Пересчёт раскладки идёт в `tickWidgets(dt)` и только для «грязных»
контейнеров: подпись включает детей, их размеры и параметры контейнера
(`gap`, `padding`, `align`, `columns`, `scroll`). Если ничего не менялось,
дерево за кадр не обходится.

Чистые функции раскладки экспортируются и покрыты qjs-тестом:

| Функция | Назначение |
|---|---|
| `layoutRow(box, items, opts)` | прямоугольники детей ряда |
| `layoutCol(box, items, opts)` | прямоугольники детей колонки |
| `layoutGrid(box, items, opts)` | прямоугольники детей сетки |
| `hitTestRect(rect, x, y)` | попадание точки в прямоугольник |
| `pointInNode(node, x, y)` | попадание точки в узел (координаты — центр) |
| `parseAnchor(spec)` / `anchorPreset(name, w, h)` | разбор якорей и пресеты |
| `defaultAnchorOffsets(anchors, w, h)` / `parseOffsets(spec)` | отступы якоря |
| `computeAnchorRect(anchors, offsets, parent)` | прямоугольник якоря в родителе |
| `percentValue(v)` / `isAnchored(node)` | доля из `'50%'`/`50`/`0.5`; есть ли якорь |
| `mergeTheme(base, spec)` / `resolveTheme(name)` | слияние и разбор тем с `extends` |

`box`/`items` — прямоугольники левым верхним углом, `opts` —
`{ gap, padding, align, columns }`.

Порядок в кадре: `applyAnchors()` → `layoutTree()` (раскладка контейнеров) →
`applyThemes()`. Якорные узлы раскладка не трогает, а пересчёт якорей идёт по
`ctx.nodes` в порядке создания (родитель раньше детей).

---

## 9. Ограничения

* нет сциссора: содержимое `<ui.scroll>` обрезается только «да/нет» по центру
  узла, а не попиксельно;
* `<ui.grid>` выравнивает по поперечной оси внутри ячейки, но не центрирует
  элементы по вертикали строки;
* строку `<ui.input>` нельзя задать атрибутом `value` в конструкторе (ядро
  приводит `value` к числу) — используйте `.value('…')` или `{ text: '…' }`;
* один общий список фокуса: фокус нельзя «запереть» в поддереве, кроме случая
  модального `<ui.dialog>`; заблокированные (`.disabled(true)`) контролы в
  список фокуса не попадают;
* отрисовка идёт в порядке создания узлов, поэтому контейнер создавайте до
  детей (иначе фон контейнера перекроет их), а диалог при показе поднимается
  в конец списка сам;
* стили задаются полями узла (`color`/`hoverColor`/`fillColor`/`textColor`,
  `border`, `size`) или темой (§4); шрифт — системный, размер задаётся `.size()`;
* якорный узел считается от прямоугольника родителя, но родитель-контейнер
  пересобирает свою раскладку в том же кадре до детей: если контейнер меняет
  размер, якорный ребёнок догонит его на следующем кадре;
* у якорного ребёнка `<ui.scroll>` нет области обрезки `_clip` — он рисуется
  без «да/нет»-отсечения по окну просмотра;
* `.theme(null)`/`.style()` не возвращают узлу значения из `TAGS`: снятая тема
  оставляет последние применённые цвета до следующей смены темы/стиля.

---

## 10. Тесты

```bash
build/_deps/quickjs-build/qjs tests/js/widgets_test.mjs
build/_deps/quickjs-build/qjs tests/js/widgets_anchor_test.mjs
```

Первый тест проверяет раскладку row/col/grid, перенос по строкам, хит-тест,
шаг ползунка, обрезку по `maxLength`, порядок фокуса Tab, клики по флажку и
списку, модальность диалога и ограничение прокрутки. Второй — разбор якорей и
пресетов, расчёт прямоугольников при разных размерах окна, реакцию на resize,
процентные размеры, `.rect()` от родителя, атрибуты `anchorLeft/offsetTop`,
темы с наследованием `extends` и от родителя, per-tag правила, `.style()`,
`disabled` и совместимость узлов без якорей и тем.

Интеграционный прогон в движке — `tests/agent/highlevel_widgets_test.py`
(фикстура `tests/fixtures/widgets/`) и `tests/agent/highlevel_widgets_anchor_test.py`
(фикстура `tests/fixtures/widgets_anchor/`); их запускает интегратор после сборки.
