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
         resolveSprite, sheetFrames,
         nodesByTag, nodesByClass, nodesWithFacet, facetCount, liveNodes,
         registrySummary, registryVersion, touchRegistry, countUiNodes } from './core.js';
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

### Кадровый шаг не должен сканировать реестр

Тик-функция обязана выходить на первой строке, если её узлов в мире нет:
полный обход `ctx.nodes` в каждой подсистеме — это ≈20 проходов за кадр
(`docs/HIGH_LEVEL_API_PERF.md` §3.3). Для этого в ядре есть **индекс реестра**
(§5, P2 того же отчёта): один проход по узлам на версию реестра, из которого
подсистема берёт готовый срез.

```js
import { nodesByTag, nodesWithFacet } from './core.js';

export function tickMine(dt) {
    // Готовый срез: на кадр нет ни прохода по ctx.nodes, ни предиката.
    const nodes = nodesWithFacet('clip');        // или nodesByTag('particles')
    if (nodes.length === 0) return;              // ни одного — выходим сразу
    for (let i = 0; i < nodes.length; i++) step(nodes[i], dt);
}
```

Что даёт индекс:

* `nodesByTag(tag)` — срез по тегу (`particles`, `tilemap`, `layer`…);
* `nodesByClass(name)` — срез по классу (на нём же стоит `query('.mob')`);
* `nodesWithFacet(name)` — срез по признаку: `ui`, `tr`, `controls`, `anim`,
  `clip`, `parallax`, `zones`, `body`; `facetCount(name)` — их число;
* `liveNodes()` — все узлы реестра, кроме помеченных на удаление;
* `query(sel)` — `#id` и структурные селекторы (`.mob`, `enemy.mob`) берутся
  из индекса целиком; сложные идут по якорю (ведущий тег/класс терма), а поля,
  которые меняются без изменения реестра (`:alive`, `[hp<5]`), по-прежнему
  считаются по узлам, а не по кэшу.

Срезы — **снимки**: во время обхода можно создавать и удалять узлы, массив от
этого не сломается (индекс при перестройке делает новые массивы). Держать срез
между кадрами нельзя — он устареет на первом же изменении реестра.

Если признака в списке нет — считайте его сами через `registrySummary(key,
compute)` (кэш на версию реестра) или заведите срез в ядре:

```js
// Предикат живёт в своём модуле; ядро лишь кэширует его результат
// до следующего изменения реестра (создание/удаление узлов, пул, классы,
// .attr('ui'|'trigger'), .controls(), якорь, коэффициент параллакса).
function countMyNodes(nodes) {
    let n = 0;
    for (let i = 0; i < nodes.length; i++) if (isMyNode(nodes[i])) n++;
    return n;
}

export function tickMine(dt) {
    if (registrySummary('my_nodes', countMyNodes) === 0) return;   // ни одного
    ...
}
```

Если признак узла меняется в обход `Node.set()` (прямая запись в `attrs` или
своё поле вроде `node.parallax_factor`) — после изменения зовите
`touchRegistry()`, иначе и срез, и сводка не заметят новый узел.
Для ui-узлов готовый предикат — `countUiNodes` (ключ `'ui_nodes'`).
`registryVersion()` нужен, если модуль держит собственный кэш на версию реестра
(так сделана сортировка в `render.js`).

Обход коллекции — `wrapper.each((i, el) => …)` (в `el` обёртка) и
`wrapper.eachNode((i, node) => …)` (в `node` сам узел, без аллокаций). Оба
объявлены в ядре (`core.js`, класс `Wrapper`), а не в `api.js`, поэтому
доступны и в юнит-тесте qjs, где `api.js` не поднимается.

Контейнеры узла ленивые: `node.listeners`, `node.data_store` и
`node.tags_extra` могут быть `null` (создаются при первой записи). Пишите через
`node.on(...)`, `node.addTag(...)` и `node.dataMap()`, а читайте с проверкой на
`null` — `node.classes` создаётся всегда.

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
add addClass addTag agentRadius agentSize align alive alpha anchor
anchorPreset anchorRect anchors angle angleTo animate append appendTo
applyForce applyImpulse at attr autotile blend blur body bounce bullet burst
checked children clear clearTiles clearTweens clip clipProgress clipRect
clipSpeed clipTime clone closeDialog closest collidesWith collision
collisionCircle collisions color cone contacts controls count damage data
delay depth depthRelative detach directionTo disabled distanceTo each
eachNode effectiveAlpha effectiveDepth effectivelyVisible emit emitting eq
every fadeIn fadeOut fadeTo fill filter find first fitsAt flash flicker flip
focus font fontSize frame frames fsm fsmSend gap get globalPos gravity has
hasClass heal health height hide hp html index inputValue inside intensity
invulnerable is isDepthRelative isEmitting isNavigating isPlayingClip
isVisible items joint jump kill last layer layerBits layerName lookAt map
mask maskBy max maxHp maxLength min move moveAndSlide moveTo moveTowards mute
navPath navTarget navigateTo not occluders off offset on onFloor onWall
oneWay opacity openDialog outline overlaps padding parallax params parent
particleAt pause pauseClip pauseTweens pivot pivotAt placeholder playClip
playSound playing pos prefab prefabClone prepend prependTo punch radius rayTo
rebuild rect reduce region release remove removeClass removeTag repath reset
respawn restart resumeClip resumeTweens rotate rotateTo rotation sample
savePrefab scale scaleTo selectedIndex selectedItem sensor sequence setTile
shader shaderParam shadow shadowSoft shadows shake shape show siblings size
sizePercent sleeping slice sliderValue some sound speed sprite start state
stateMachine stateTime states step stop stopAll stopAnim stopClip stopNav
style sweepTo tag team terrainData text textStyle theme tileAnimation tileAt
tileLayer tileSize tilesData tilesList tileset toArray toData toGlobal
toLocal toState toggleClass trigger tween tweenTo value velocity visible
volume wake width within ysort zone zoneCount
```

> Список снят с живого движка, а не перепечатан: **256 имён**, команда —
> `Object.getOwnPropertyNames(Object.getPrototypeOf($('<rect>'))).filter(n => n !== 'constructor')`
> в агентском режиме. Это объединение `def()`/`defGet()` из `src/highlevel/*.js`
> с методами класса `Wrapper` (`each`, `eachNode`, `eq`, `get`, `index`,
> `toArray`, `within`). Список устаревает вместе с кодом, поэтому перед
> добавлением своего метода сверяйтесь с ним, а не с памятью: прежняя версия
> этого списка отставала на 86 имён, и автор подсистемы мог занять уже занятое.

Геттеры: `alive angleTo children closest directionTo distanceTo find globalPos
hasClass inside isVisible onFloor onWall parent pos rayTo rotation siblings
toGlobal toLocal` (плюс `state`, `stateTime`, `states`, `size` и другие —
полный перечень выше).

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
