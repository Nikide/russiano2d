# Re2D World: руководство по новой игре

Редакция 2026-10-10. Новый мир создаётся через `$.re2dWorld`, персонаж — через `$.re2dSprite`. Здесь описан текущий native renderer; прежние room/kind и `$.re2d.world` находятся в [legacy reference](highlevel/re2d_legacy.md).

## Быстро посмотреть результат

Из корня checkout:

```sh
./build/russiano2d --game demos/re2d_world_renderer_lab/acceptance --seed 7
./build/russiano2d --game demos/re2d_dust2 --seed 7
```

Acceptance lab: 1–7 выбирают corridor/upper/bridge/fog/stairs/ramp/window; E — этаж, O — дверь, Space — вспышка, M — движение красной верхней лампы, F2 — debug, WASD/стрелки — движение/взгляд. Dust2: 1–7 — именованные камеры, O — doors, Space — прыжок, Shift — бег, мышь — взгляд, ЛКМ/F — вспышка, Esc — отпустить мышь, M — захват, Q — выход; G — CPU/GPU, R — reset, F2 — diagnostics. Управление конкретного демо задано его README/main.js.

## Минимальный main.js

Этот пример работает с существующим персонажем checkout; отдельную карту читать не нужно. Создайте проект с обычным `project.json` и этим `main.js`. В своей игре замените путь персонажа на локальный asset, скопировав его atlas, animations и equipment dependencies вместе с character JSON.

```js
const view = {x:60,y:120,h:48,yaw:0,pitch:0,fov:70,near:1};
$.ready(() => {
  $.world.gravity(0,0).color('#14202c');
  const description = {
    version:1,
    cells:[
      {x:0,y:0,w:240,h:240,spans:[
        {bottom:0,top:128,lighting:{level:.35}},
        {bottom:160,top:288,lighting:{level:.25}}
      ]},
      {x:240,y:0,w:240,h:240,spans:[
        {bottom:0,top:128,lighting:{level:.35}},
        {bottom:160,top:288,lighting:{level:.25}}
      ]}
    ],
    walls:[
      {from:[0,0],to:[480,0],bottom:0,top:288,color:'#bba078'},
      {from:[0,240],to:[480,240],bottom:0,top:288,color:'#bba078'},
      {from:[0,0],to:[0,240],bottom:0,top:288,color:'#bba078'},
      {from:[480,0],to:[480,240],bottom:0,top:288,color:'#bba078'},
      {from:[240,0],to:[240,80],bottom:0,top:288,color:'#aa8866'},
      {from:[240,160],to:[240,240],bottom:0,top:288,color:'#aa8866'}
    ],
    portals:[{cellA:0,cellB:1,from:[240,80],to:[240,160],
      openings:[{bottom:0,top:128},{bottom:160,top:288}]}]
  };
  const world = globalThis.docWorld = $.re2dWorld.fromJSON(JSON.stringify(description))
    .backend('gpu');
  world.lighting({mode:'classic',dynamic:true,shadows:true,distanceScale:.001});
  const source = 'demos/rotsprite/russi.character.json';
  const lower = globalThis.docLower = $.re2dSprite.from(source,{id:'doc-lower'})
    .re2dStyle('anime').at(330,120).depth(0).size(64,80).angle(Math.PI)
    .re2dMotion('idle',0).hide();
  const upper = globalThis.docUpper = $.re2dSprite.from(source,{id:'doc-upper'})
    .re2dStyle('anime').at(330,120).depth(160).size(64,80).angle(Math.PI)
    .re2dMotion('idle',0).hide();
  globalThis.docWeapon = $.re2dSprite.equip(lower,'ak47').re2dStyle('anime').hide();
  world.add(lower).add(upper);
  world.light({x:330,y:120,h:208,radius:180,intensity:1.2,color:'#ff3020',shadow:true});
  // Flush initial static synthesis deterministically for this small example.
  world.quality({poseBudget:0,poseStep:0});
});
let closed = false;
$.update(() => {
  if ($.input.pressed('o')) docWorld.portalClosed(0,closed=!closed);
  if ($.input.pressed('e')) view.h = view.h<128 ? 208 : 48;
  if ($.input.pressed('space')) docWorld.light({x:300,y:120,h:45,radius:200,
    intensity:3,color:'#ffbf70',shadow:true}).life(.12);
  if ($.input.pressed('escape')) $.quit();
});
$.render(() => docWorld.render(view,400,240));
```

Два спрайта находятся на одинаковых XY, но в разных free spans. Верхняя лампа не должна освещать нижнего через solid перекрытие; портал позволяет проход между соседними rooms отдельно на каждой высоте. E показывает другой этаж, O закрывает обе openings данного portal. Вспышка имеет native lifetime — игровой callback для удаления не нужен.

`.hide()` подавляет отдельную обычную 2D-отрисовку персонажа и оружия; в кадре World спрайт остаётся зарегистрирован. `.kind(Re2D)` и `$.camera.kind(Re2D)` для этого нового explicit world не нужны. UI делайте существующим RmlUi; world.render рисует готовое изображение, а HUD остаётся отдельным интерфейсом.

## Загрузить авторскую карту

Вместо description в JS храните `.re2dmap` с SDK rect/id/stairs/slopes; compile выдаёт `.re2dworld`:

```sh
build/r2d-sdk world-compile maps/room.re2dmap --renderer --output maps/room.re2dworld
```

```js
const world = $.re2dWorld.load('maps/room.re2dworld').backend('gpu');
```

Не передавайте сырой SDK `.re2dmap` loader-у: его cells имеют `rect`, а native runtime JSON — x/y/w/h. `fromJSON` нужен для native description или теста, а compiled load избегает повторного authoring build. [Форматы и compile](re2d/RE2D_WORLD_FORMAT.md) описывают различия и validation.

## Материалы и свет

Сначала настройте span ambient и проверьте читаемость без dynamic lights. Затем зарегистрируйте PNG material и присвойте canonical surface IDs:

```js
world.material('brick',{albedo:'art/brick.png',normal:'art/brick_n.png',blend:'opaque'});
world.surface(0).material('brick');
world.material('lamp-panel',{albedo:'art/panel.png',emissive:'art/panel_e.png',emissiveStrength:1.3});
world.span(0).lighting({level:.2,color:'#ffe2c5'});
world.span(0).fog({density:.004,start:60,color:'#142a49'});
```

Emissive — видимая яркость самого материала; она не создаёт свет в комнате. Для освещения добавьте world.light. Classic settings в `world.lighting` — полная конфигурация, span setters — частичная. Поэтому явно задавайте dynamic/shadows/distanceScale при каждом global lighting switch.

Свет выбирается по portal/radius/height в C; API не выдаёт игре списки для per-frame light pairing. World normal map влияет на освещение wall/plane, а не меняет её geometry. Персонаж использует совместимый native light/fog path; его PNG не нужно переписывать в world material.

## Движение и высота

World не содержит встроенный Player/Enemy controller. `support` проверяет точку и headroom, `blocked` — статическую форму, `ray` — отрезок; это не swept movement и не gravity solver. Для движения используйте небольшие подшаги и проверяйте опору под радиусом. Такой helper повторяет подход рабочего Dust2 demo:

```js
function moveWalker(world, walker, dx, dy) {
  const x=walker.x+dx, y=walker.y+dy;
  let support=world.support(x,y,walker.feet,walker.bodyHeight,walker.step);
  const distance=Math.hypot(dx,dy);
  if (distance && support) {
    for (const sign of [-1,1]) {
      const probe=world.support(x+sign*dx/distance*walker.radius,
        y+sign*dy/distance*walker.radius,walker.feet,walker.bodyHeight,walker.step);
      if (probe && probe.height>support.height) support=probe;
    }
  }
  if (!support || world.blocked(x,y,walker.radius,support.height,
      support.height+walker.bodyHeight)) return false;
  walker.x=x; walker.y=y; walker.feet=support.height;
  return true;
}
// walker = {x:60,y:120,feet:0,bodyHeight:64,step:9,radius:6};
// После успешного шага: sprite.at(walker.x,walker.y).depth(walker.feet),
// view.x=walker.x; view.y=walker.y; view.h=walker.feet+48.
```

Это ограниченный игровой helper, не гарантированный footprint/sweep solver: он не покрывает все углы, скачки и движущиеся платформы. Если используется Box2D body, physics update может переписать позицию/angle. Box2D не разделяет спрайты по spans автоматически; многоэтажную collision policy задаёт игра.

## Дверь, lift, reload

`world.portalClosed(id,true/false)` одной операцией меняет portal closure, collision, rays, visibility и light/shadow invalidation. Smooth fraction `door.open(.7)` из исходного плана не является текущим public API.

`world.span(id).heights(bottom,top)` меняет допустимый span без overlap/ownership конфликтов. Это не автоматическое движение стоящего на нём узла. Для flat lift игре нужно согласованно перемещать passengers. Static continuous slopes поддерживаются; сложные runtime edits slope/portal boundaries ограничены.

`reloadJSON(text)`/`reload(path)` и `watch(path)` сохраняют прежний world при invalid edit. После успеха проверьте новые index domains и перенастройте индексные surfaces/spans, если topology изменилась. Ссылки на узлы со спрайтами, handles динамического света и material bank сохраняются согласно [runtime lifecycle](re2d/RE2D_WORLD_RUNTIME.md#перезагрузка-и-жизненный-цикл).

## Отладка и типичные ошибки

| Симптом | Проверить |
| --- | --- |
| Персонаж нарисован ещё раз поверх карты | скрыт ли обычный draw через `sprite.hide()`/`weapon.hide()` |
| Спрайт не видно | world.add; positive size; midpoint height входит в free span; camera/frustum/portal visibility |
| Свет не действует | global dynamic enabled; radius/height; closed portal; shadow; per-span limit/slot priority |
| Emissive не освещает соседа | добавить отдельный world.light, emissive не emitter |
| За стеной всё видно | используется ли новый World, а не legacy room billboard renderer |
| Спрайт шагает сквозь этаж | depth задан правильно, controller использует support/headroom; Box2D не height authority |
| Поза догоняет с задержкой | posesDeferred, poseBudget, poseStep; unlimited increases synthesis cost |
| Правка compiled JSON не видна | baked tables authoritative; править source .re2dmap и compile |
| Surface settings после reload неверны | проверить canonical domain, старый numeric ID не semantic handle |

Debug: `world.debug.view('depth')`, `'owner'`, `'bsp'`, `'portals'`, `'dynamic-light-count'`, `'shadow-mask'`, `'normal'`, `'emissive'`, `'overdraw'`. Вернуть normal frame: `'final'`. `world.info()` — native counts/timings; не стройте JS render queue из debug snapshots.

## Что проверено и где продолжать

Локальная acceptance evidence: full lab 21 checks, renderer 55, Dust2 17, dedicated World Studio 19; ранее прошли native/JS verification и 6 goldens. Это результаты конкретных прогонов, не гарантия всех платформ. Детали и ограничения — [audit](re2d/RE2D_DOCUMENT_ACCEPTANCE_AUDIT.md), [implementation evidence](re2d/RE2D_RENDERER_IMPLEMENTATION_PLAN.md), [performance](RE2D_WORLD_PERF.md).

Далее: [полный API](highlevel/re2d.md), [Re2DSprite в мире](re2d/RE2DSPRITE_WORLD.md), [форматы](re2d/RE2D_WORLD_FORMAT.md), [миграция](re2d/RE2D_MIGRATION.md). GZDoom — reference поведения; его code/shaders/assets не являются implementation источником.

World positional audio: [`world.audio` / `$.re2dWorldAudio(world)`](re2d/WORLD_AUDIO.md). Sources share the native Re2D geometry and existing mixer; Steam Audio supplies HRTF PCM only.
