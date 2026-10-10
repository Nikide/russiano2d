# Re2DSprite в новом Re2D World

Редакция 2026-10-10.

World хранит ссылки на существующие узлы `$` для отрисовки. Он не создаёт игровые сущности, классы Actor, отдельные компоненты или новый жизненный цикл. Создание, селекторы, атрибуты, события и удаление остаются существующим API узлов. Внутренние имена `actorAdd`/`actorRemove` и опубликованные поля `actors`, `actorCandidates`, `composedActors`, `actorMs` означают учёт спрайтов и их композицию; это имена текущего интерфейса диагностики, а не игровая архитектура.
Эта страница описывает **спрайт существующего узла `$`, включённый в кадр World** в `$.re2dWorld`, а не legacy kind billboard. PNG/JSON/rig/animation formats остаются существующими: [artist/developer guide](../RE2DSPRITE_GUIDE.md), [JSON](../RE2DSPRITE_JSON.md), [surface math](../RE2DSPRITE_MATH.md).

## От файлов до спрайта в кадре World

```js
const sprite=$.re2dSprite.from('art/hero.character.json',{id:'hero'})
  .re2dStyle('anime').at(350,120).depth(0).size(74,80)
  .angle(Math.PI).re2dMotion('walk',0).hide();
world.add(sprite);
```

Здесь `world` — уже загруженный новый handle. from создаёт отдельный sprite resource; paths внутри character JSON разрешаются относительно JSON, а source object — от game root. `.surface.json` и рисунок материала нужны автору/compiler, не world loader-у; runtime читает готовый PNG/character/animations. World не принимает GLB/OBJ character mesh напрямую.

`world.add(sprite)` включает существующий узел со спрайтом в список отрисовки World; повторное добавление того же узла не дублирует изображение. `world.remove(sprite)` исключает его из кадра, сохраняя игровой узел. Чтобы удалить узел, сначала исключите его из кадра World, затем вызовите обычный `sprite.remove()`. `world.dispose()` освобождает ресурсы рендера и ссылки на узлы. В текущем режиме `.hide()` подавляет отдельную обычную 2D-отрисовку, но сохраняет изображение в кадре World.

## Координаты и единицы

| Поле | Registered World | Обычный 2D draw |
| --- | --- | --- |
| at(x,y) | XY position на карте | положение изображения |
| depth(h) | абсолютная высота основания | порядок отрисовки |
| size(w,h) | world width/height; perspective масштабирует на экран | экранный размер с учётом обычной камеры |
| angle(rad) | направление тела в XY, 0 = +X | обычный поворот узла, subject to sprite-path support |
| re2dPose(yaw,pitch) | camera-relative pose world перезаписывает | explicit pose для обычного synthesized sprite |
| hide() | подавляет только отдельную 2D-отрисовку | скрывает ordinary sprite |

Native composition читает x/y/depth/w/h/scale_x/scale_y/angle. Размер умножается на abs scale; flip как отрицательный scale не является отдельным world mirroring API. Режимы ordinary node tint/alpha/blend/shader/clip нельзя автоматически переносить на нативное изображение спрайта. World material blend — настройка **world surfaces**, не узла со спрайтом.

Принадлежность видимости/освещения определяется по высоте центра изображения: depth + effectiveHeight/2. Это selection для visibility/candidate pass; anime shading также восстанавливает receiver position отдельных samples. Выбирайте размер/основание так, чтобы эта точка была в нужном free span; большой sprite не делится автоматически между этажами. Floor-inclusive/ceiling-exclusive boundaries одинаковы с world.spanAt. Изображение имеет sample depth для occlusion, но игровая hitbox не выводится из pixels.

## Поза от камеры

C читает положение root, его facing и camera. Относительный yaw определяется азимутом camera→sprite и `sprite.angle`. Pitch определяется высотой центра спрайта относительно глаз и XY-дистанцией. Затем native synthesis получает root pose; attachment subtree использует тот же camera-relative pose.

Игра меняет `sprite.angle` для поворота тела, выбирает re2dMotion/re2dLayer/re2dBone для animation. Не делайте каждый frame `re2dPose` ради world camera: это дублирует работу и explicit pose может немедленно синтезировать обычный sprite вне world budget. Angles re2dPose/camera — degrees; angle — radians; phase — radians.

High-level character animation/model orchestration сохраняется в существующем Re2DSprite wrapper. Это не означает, что JSON animation logic целиком перенесена в C. Native world traversal, camera-relative preparation, synthesis scheduling, surface/light pairing и composition не реализованы JS render loops.

## Свет и туман

Мир выбирает span для спрайта и соответствующие ambient/relevant lights. Динамический свет использует то же radius/height/portal/occluder data, что world surfaces. Fog совместим с world span fog. Upper lamp за solid floor не освещает lower receiver; через подходящее opening свет проходит.

```js
world.span(0).lighting({level:.12,color:'#ffffff'});
world.span(0).fog({density:.006,start:50,color:'#142a49'});
world.light({x:sprite.get(0).x-28,y:sprite.get(0).y,h:45,
  radius:200,intensity:3,color:'#ffbf70',shadow:true}).life(.12);
```

Flash expiry выполняется native update. Weapon и спрайт получают shared lighting/depth composition, стены/пол — native world shading. `world.lightAt` позволяет AI/gameplay получить deterministic approximation без framebuffer readback. Это не точная perceived brightness с normal/emissive/fog/postprocess.

World normal/emissive textures — свойства surface material. Re2DSprite atlas хранит свою форму/цвет и не превращается в такой material bank; интеграция не добавляет arbitrary PBR character renderer.

## Depth и покрытие

Anime Re2DSprite synthesis разрешает собственную глубину отсчётов и экспортирует resolved sample depth рядом с color. Pixel/v1 output не экспортирует эту карту и использует fallback image depth. World compositor переводит её в shared projected-depth convention. Wall, bridge/floor и спрайт samples сравниваются по этой depth. Поэтому нижний спрайт может скрываться перекрытием, а рука/оружие — world wall.

Это глубина сформированного 2D изображения, а не mesh scene. Alpha coverage при world composition использует порог 128; полноценная полупрозрачность спрайт pixels не заявляется. Center-sorted world glass/additive рисуется после opaque world/спрайты, сохраняя opaque depth/owner; при пересекающихся прозрачных planes есть sorting limits.

## Оружие и sockets

```js
const ak=$.re2dSprite.equip(sprite,'ak47').re2dStyle('anime').hide();
world.add(sprite); // parent includes native child mirror
```

Equipment key/socket/grip должны существовать в character/equipment JSON. Для собственной модели:

```js
const tool=$.re2dSprite.from('art/tool.character.json').hide();
tool.re2dAttach(sprite,'handRight',{grip:'grip'});
```

Не добавляйте каждый attached child как отдельный root ради composition. Существующие attach/detach/reload обновляют native child mirror; новые child configs идут через public wrapper. Attach depth ordering вокруг parent сохраняет совместимость, shared samples обеспечивают world occlusion. `.re2dDetach()` не превращает предмет автоматически в dropped-world root: задайте ему at/depth/size и world.add отдельно. Max nesting 32, frame candidates (roots + attachments) ≤4096.

Screen-space FPS hands/viewmodel — отдельный ordinary 2D presentation, не обязательно спрайт, включённый в кадр World. Для него применим re2dVisibleParts/equip из sprite reference, но он не получает world lighting/occlusion автоматически. Не смешивайте этот UI/viewmodel путь с attachment lower pig из acceptance lab.

## Синтез и производительность

```js
world.quality({poseBudget:1,poseStep:3}); // wrapper default
world.quality({poseBudget:0,poseStep:0}); // unlimited, unquantized
```

Budget ограничивает дорогие dirty pose syntheses за native world frame, включая attachments; round robin распределяет обновления. Deferred спрайт показывает предыдущую синтезированную картинку. Step квантирует camera-relative yaw/pitch. Animation clocks могут продолжать меняться, пока pose ожидает budget. Спрайт visibility определяет off-screen deferral, но это не доказательство полного occlusion rejection каждого спрятанного спрайт до synthesis.

`world.info().posesUpdated/posesDeferred/actorMs` показывают стоимость. One cold frame с initial anime poses заметно дороже cached static frame. Не используйте warm static A/B/C как обещание 50 постоянно анимируемых спрайтов при 60 FPS; [performance](../RE2D_WORLD_PERF.md) содержит обе категории измерений. Existing sprite resolution/supersampling задаётся синтезатором; world framebuffer resolution — отдельная настройка.

## Reload и проверка

Character `.re2dReload/.re2dHotReload` обновляют atlas/definition/animations и native attachments существующим путём; invalid replacement сохраняет прежний asset. World reload отдельно заменяет topology/static lighting, сохраняя спрайт roots. После новой карты игра проверяет position/span/support и relocates спрайт при необходимости; loader не выбирает spawn сам.

Acceptance example: `demos/re2d_world_renderer_lab/acceptance/main.js` — lower/upper pigs в одинаковом XY, upper red lamp, AK, flash и fog. Renderer integration проверяет sample occlusion, pose budget/fairness, attachments и CPU/GPU parity. Sources: [C runtime](../../src/re2d_world_runtime.c), [sprite wrapper](../../src/highlevel/rotsprite.js), [sample math v2](../../src/rotsprite_math.c), [sample depth v3](../../src/rotsprite3.c). Эти files авторитетнее исторических документов.
