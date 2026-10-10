# Re2DSprite — `$.re2dSprite`

Один PNG с развёрткой и картами поверхности → обычный 2D-спрайт.
[v3](../RE2DSPRITE_V3.md) — плотная поверхность с перспективой, светом и
`skin`-клипами (текущий формат, его грузят персонажи `russi3` в демо Dust2);
[v2](../RE2DSPRITE_V2.md) поддерживает голову, тело, мимику и простые суставы;
[v1](../RE2DSPRITE_V1.md) остаётся совместимым прототипом головы. Разбор
выбирается по `atlasInfo.version`: 2 или 3, другое значение — ошибка.

```js
$.re2dSprite.create('art/russi.png',{id:'russi'})
    .at(400,300).size(384,384).re2dStyle('anime').re2dRig({body:true})
    .re2dPose(25,0).re2dEmotion('happy').re2dMotion('walk').re2dHotReload();
$('#russi').re2dPart('costume','art/police.png');
```

| Вызов | Результат |
|---|---|
| `$.re2dSprite.create(path,opts?)` | создать узел `<rotsprite>` и сразу загрузить атлас `path`; при ошибке узел удаляется, исключение уходит наверх |
| `.re2dSpriteAtlas(path)` | атомарная замена всего PNG; новая поза по умолчанию |
| `.re2dStyle(style='anime')` | v2: anime / pixel, атомарно сохраняет подмены и позу |
| `.re2dPose(yaw,pitch=0)` | yaw в градусах, wrap ±180, pitch clamp ±75 |
| `.re2dExpression({eyes,mouth,brows})` | независимые детали лица v2; пропущенные поля имеют нейтральные значения |
| `.re2dEmotion(name)` | neutral/happy/angry/sad/surprised/sleepy |
| `.re2dRig({body,phase,stride,armLeft,armRight,headYaw})` | частичное обновление позы псевдоскелета v2 |
| `.re2dMotion(mode='idle',speed=1)` | idle/walk/run, процедурный цикл на месте |
| `.re2dPart(group,path)` | заменить группу из PNG v2: head/hair/tail/hat/torso/arms/legs/skirt/shoes/costume |
| `.re2dHotReload(enabled=true)` | наблюдать локальный исходник и PNG доноров |
| `.re2dReload()` | перечитать PNG и подмены, сохранив состояние |
| `$.re2dSprite.pose(target,yaw,pitch=0)` | аналог `.re2dPose()` |
| `$.re2dSprite.info(target)` | состояние или null |
| `$.re2dSprite.dispose(target)` | освободить ресурс, узел остаётся |

Все методы узла возвращают цепочку. Глаза: open/half/closed/happy;
рот: closed/open/smile/talk; брови: neutral/angry/sad/surprised.
`phase` — радианы; остальные углы — градусы. Руки вращаются вокруг плеч,
ноги вокруг бёдер и коленей. Незнакомые состояния и нечисловые/NaN/Infinity
отклоняются. Speed неотрицательный. Движение использует игровой dt.

Info: `{sprite,texture,revision,yaw,pitch,width,height,atlasWidth,version,
style,body,eyes,mouth,brows,surfaceSamples,joints?,path,rig,motion,parts,hotReload,
reloads,reloadError,milestone,disposed}`. Индексы глаз/рта/бровей — 0..3.
Joints — координаты канонического поля 128×128, не экранные, в обоих режимах v2.
Raster v1=64, v2 pixel=128, v2 anime=512 (1024 supersampling).
У v3 растр задаёт `projection.raster` в character.json (128..2048, по умолчанию
1024), детализацию — `projection.detail`, вид — `projection.eye/window/cull/motionLod`.
Legacy C anime entry points сохраняют 256; `_sized` поддерживает 256/512. По умолчанию pixel (у legacy `.create()`).
Повторная одинаковая поза/мимика не делает upload; 360° равен 0°.

Pixel: минимальный масштаб 1, целый; позиция округляется после камеры.
Nearest работает при глобальном linear. Anime: непрерывная позиция и размер,
сглаженные края и цвета, принудительный linear независимо от режима кадра. Для обычной 2D-отрисовки цвет, alpha, слой, камера, clip,
видимость наследуются обычным путём; registered World имеет отдельный контракт ниже. Angle/pivot, неравномерный scale/flip,
пользовательские шейдеры узла, outline/shadow пока не применяются.

Remove, смена сцены и hot reload освобождают ресурс; finalizer страхует
сборку мусора. Невалидная замена сохраняет старый ресурс. После dispose
можно вызвать `.re2dSpriteAtlas()` снова. Обновление частей и rig требует v2.
Мимика v1 допускает только нейтральные индексы.

Низкий уровень: `engine.rotSpriteLoad(path)`, `rotSpritePose(handle,yaw,pitch,
eyes?,mouth?,brows?)`, `rotSpriteRig(handle,body,phase,stride,armLeft,armRight,
headYaw)`, `rotSpritePart(handle,path,mask)`, `rotSpriteChanged(handle)`,
`rotSpriteStyle(handle,style)`, `rotSpriteFileStamp(path)`, `rotSpriteInfo(handle)`, `rotSpriteDispose(handle)`.
Игра использует `$`; masks и файловые stamp — детали обёртки.

Демо: `./build/russiano2d --game demos --scene re2dsprite`.
Тесты: `tests/js/rotsprite_test.mjs`, `r2d_rotsprite_test`,
`tests/agent/highlevel_rotsprite_test.py`.

Нативная смена стиля декодирует исходный PNG заново; для сохранения подмен
использовать `.re2dStyle()`, которая атомарно повторяет все доноры.

## Пользовательские модели JSON и сокеты

Описание и примеры: [RE2DSPRITE_JSON.md](../RE2DSPRITE_JSON.md).

| Вызов | Результат |
|---|---|
| `$.re2dSprite.from(source,opts?)` | JSON файл/объект → собственная модель |
| `$.re2dSprite.definition(target)` | копия описания |
| `$.re2dSprite.equip(parent,key,opts?)` | модель из equipment, прикреплённая к сокету |
| `.re2dVariant(group,key)` | донор из JSON |
| `.re2dBone(name,{rotation?,translation?})` | абсолютные ручные каналы кости |
| `.re2dSeek(seconds)` | время основного клипа |
| `.re2dLayer(name,enabled=true,speed=1)` | клип поверх основного |
| `.re2dAttach(parent,socket,{grip?,offset?,rotation?,scale?})` | совместить сокеты моделей |
| `.re2dDetach()` | отсоединить объект |

Пути внутри описания считаются от его каталога, в том числе когда сама модель
открыта по абсолютному пути (так её открывает SDK, `relativeAsset` сохраняет
ведущий `/`).
В JSON путь анимаций, произвольные ID/кости/сокеты/группы и named clips.
`.re2dMotion` принимает имя из JSON. `.re2dReload`/`.re2dHotReload` перечитывают
описание, анимации, PNG и доноры, сохраняют крепления.
Старый `.create(PNG)` сохраняет встроенный маскотный rig для совместимости.
Нативный bulk API: `engine.rotSpriteModelPose(handle,scale,rows,body?)`,
row = `[id,selector,variant,oneSided,visible,...12 affine]`.
`engine.rotSpritePart(handle,path,ids)` также принимает массив ID 1..254.

Полное руководство разработчика/художника: [RE2DSPRITE_GUIDE.md](../RE2DSPRITE_GUIDE.md).

### Видимые части модели

`.re2dVisibleParts(ids=null)` задаёт массив part IDs из `rig.parts`. `null`
восстанавливает все части, `[]` скрывает всё изображение. Требуется JSON-модель;
неизвестные IDs отклоняются. Кости, sockets и attachments продолжают работать.
Маска сохраняется при смене стиля и reload; удаление выбранного ID из новой
модели отклоняет reload с сохранением прежнего ресурса. Legacy alias:
`.rotVisibleParts`.

Например, руки FPS берутся из тех же частей Руси, без отдельной модели игрока:

```js
const hands = $.re2dSprite.from('demos/rotsprite/russi.character.json');
const ids = $.re2dSprite.definition(hands).rig.parts
    .filter(p => ['armLeft','armRight','forearmLeft','forearmRight'].includes(p.bone))
    .map(p => p.id);
hands.re2dVisibleParts(ids).re2dLayer('holdRifle').re2dPose(200,-12);
const ak = $.re2dSprite.equip(hands,'ak47');
```

Это фильтр синтеза изображения, не удаление костей и не игровая система оружия.

## В новом `$.re2dWorld`

```js
// world — загруженный $.re2dWorld; character asset должен существовать.
const hero=$.re2dSprite.from('art/hero.character.json')
  .re2dStyle('anime').at(350,120).depth(0).size(74,80).angle(Math.PI).hide();
const ak=$.re2dSprite.equip(hero,'ak47').re2dStyle('anime').hide();
world.add(hero);
```

Регистрация один раз включает root и native attachment mirror. World читает node position/height/size/facing и сам задаёт camera-relative pose. `.hide()` исключает ordinary draw, но не registered world composition. Для despawn world.remove(hero), затем обычное удаление узла. PNG/rig/animations formats не меняются.

Для узла со спрайтом, включённым в кадр World, depth — абсолютная высота основания, angle — направление в радианах. Рендер выбирает free span, применяет light/fog и сравнивает world depth с sample depth anime output. Pixel/v1 output не имеет этой exported sample map и использует fallback depth изображения. Node tint/alpha/flip/shader semantics обычного draw не гарантируются World. World surface normal/emissive materials не превращают atlas в PBR mesh.

Pose synthesis budget и camera quantization задаются world.quality, не legacy $.re2d.poseBudget. Animation orchestration остаётся existing sprite wrapper, expensive world synthesis/composition — C. Полный контракт: [Re2DSprite World](../re2d/RE2DSPRITE_WORLD.md), [World guide](../RE2D_WORLD_GUIDE.md), [migration](../re2d/RE2D_MIGRATION.md).

Низкий уровень v3: `engine.rotSpriteConfig(handle, raster, light24, detail, view)` —
разрешение синтеза (≤2048), 24 числа света и вид `{eye, window, cull, motionLod}`
(для v2 вызов отклоняется), и `engine.rotSpritePrepare(handle)` — подготовка
ресурсов синтеза. Обёртка зовёт их сама по `projection` из character.json; вручную
они нужны только при работе с `engine.*` напрямую ([internal/NATIVE.md](../internal/NATIVE.md)).

## v3

PNG формата [v3](../RE2DSPRITE_V3.md) загружается тем же `$.re2dSprite.from()/create()`; `re2dMotion(clip, speed=1)` + `re2dSeek(t)` играют скин-клипы (`skin:{frames,fps,bones,data}` в animations JSON).
`projection.raster/light/detail` в character.json управляют разрешением синтеза, светом и уровнем детализации; `eye` включает перспективу (оружие от первого лица), `window` — видимое окно, `cull` — отсечение отвернувшихся ячеек, `motionLod` — более грубый уровень в движении; `.color()` — освещение мира.
