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
