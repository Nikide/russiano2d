# Re2DSprite JSON v1: модели, анимации и сокеты

Re2DSprite остаётся генератором обычного 2D-спрайта. Единственный PNG v2
хранит материалы и карты XYZ/ID/coverage; JSON задаёт части, преобразования,
псевдоскелет, клипы и крепления. Runtime не читает OBJ и не требует
готовых ракурсов. Native C проецирует поверхности; JS собирает небольшую
таблицу матриц частей, а не вызывает JS для каждого текселя.

## Сборка в игре

```js
const russi = $.re2dSprite.from('demos/rotsprite/russi.character.json', {id:'russi'})
    .at(600,360).size(512,512).re2dMotion('walk').re2dHotReload();
const item = $.re2dSprite.equip(russi, 'shotgun', {id:'held-item'}).re2dHotReload();
russi.re2dLayer('holdRifle'); // поза не включается equip автоматически
russi.re2dPose(35,8).re2dVariant('costume','police');
item.re2dDetach(); // теперь самостоятельная модель
item.remove();
```

Можно крепить любой объект к любому другому без таблицы equipment:

```js
const prop = $.re2dSprite.from('art/prop.character.json');
prop.re2dAttach(russi,'handRight',{
    grip:'trigger', rotation:[0,180,0], offset:[0,0,0], scale:[1,1,1]
});
```

## Описание модели

`version` MUST быть 1. `atlas` MUST ссылаться на строгий PNG v2. Все пути
(`atlas`, внешний `animations`, варианты и equipment.model) относительны
файлу описания; для переданного объекта — корню игры. `surface` — ссылка
для авторского инструмента, runtime её не компилирует.

`style`: anime (по умолчанию) либо pixel. `rig.bones` MUST содержать
1..64 уникальных имени. Родитель MUST идти раньше ребёнка. `pivot` —
координата шарнира в общей системе покоя, не смещение от родителя.
X направлен вправо, Y вниз, Z к зрителю при yaw=0. Углы в градусах.
Порядок вращения X, Y, Z (матрица Rz*Ry*Rx); преобразование ребёнка
композируется с преобразованием родителя вокруг общей bind-координаты.
`portraitPivot` переопределяет шарнир для режима головы.

`rig.parts`: уникальный `id` 1..254, существующая `bone`, необязательные
`bind:{scale,translation,rotation}` и `portraitBind` (три числа каждый).
`portrait:true` разрешает часть в режиме головы; остальные скрываются.
`oneSided:true` включает отсечение оборотной стороны поверхности.
`selector:eyes|mouth|brows` и `variant:0..3` выбирают детали лица;
любые другие ID являются обычными частями. Модель SHOULD перечислять все
ID, которые требуется показывать; неописанные ID скрыты. Примеры животных
и предметов используют другие ID и другую иерархию, без человеческих правил.

`rig.joints`: именованные `{name,bone,point}` для интерфейса/взаимодействий.
`rig.sockets`: `{name,bone,point,rotation?,portrait?}` — координата и ориентация
крепления в общей системе покоя. Максимум 128 joints и 128 sockets.
`rig.controls`: произвольные ключи `{bone,axis:'x'|'y'|'z'}`, управляемые
через `.re2dRig({key:angle})`. Угол control складывается с углом клипа.
`projection.bodyScale` (1) и `portraitScale` (2) — масштаб проекции (0,8].
`groups` задаёт списки ID для подмены, `variants[group][key]` — PNG доноров.
Донор MUST иметь совместимые ID и координаты соответствующей группы.
`emotions[name]` задаёт глаза/рот/брови, `defaults` — body, motion,
expression и rig. `equipment[name]` содержит model, socket, grip?, rotation?,
offset?, scale?; поле pose в демо описывает рекомендуемый клип удержания.

## Анимации

Отдельный `animations.json` либо объект в поле animations:

```json
{"version":1,"clips":{"walk":{"duration":1.2,"loop":true,"tracks":[
  {"target":"hipLeft","channel":"rotation.x","keys":[[0,22],[0.6,-22],[1.2,22]]}
]}}}
```

Каналы костей: rotation.x/y/z и translation.x/y/z. Ключи MUST строго
возрастать в диапазоне 0..duration, значения MUST быть конечными.
Числа интерполируются linear либо step. Для target=face допускаются
каналы eyes/mouth/brows, строковые состояния, только step. Максимум 64
клипа, 256 треков/клип, 1024 ключа/трек. Повтор канала запрещён.

`.re2dMotion(name,speed)` включает клип и сбрасывает его время; speed=0
останавливает его. `.re2dSeek(seconds)` задаёт время основного клипа.
`.re2dLayer(name,enabled=true,speed=1)` накладывает отдельный клип: последний
добавленный слой выигрывает совпадающие каналы. Повтор включения сохраняет
время; выключение удаляет слой. Однократные клипы удерживают последний ключ.
`.re2dBone(name,{rotation,translation})` задаёт абсолютные значения каналов
поверх клипов, затем добавляются controls. Моргание, речь и удержание
предметов в демо — именно JSON-слои. Старые phase/stride остаются только
для legacy PNG API; JSON-локомоция описана ключами.

## Крепления и владение

Оба узла MUST быть корневыми узлами сцены. Циклы и неизвестные сокеты
отклоняются до изменения крепления. Формула:
`parentSocket * offsetRotationScale * inverse(itemGrip) * itemPart`.
Без grip начало объекта совмещается с сокетом. Объект наследует поле
проекции, yaw/pitch и слой родителя; его собственный клип продолжает играть.
При повороте кости родителя предмет следует за сокетом. Сокет без
portrait:true скрывает предмет в режиме головы. Удаление родителя
отсоединяет детей; удаление ребёнка освобождает его ресурс. Перезагрузка
сохраняет граф креплений; удалить занятый сокет через hot reload нельзя.

`info()` дополнительно возвращает definition, animationTime, layers,
attachment, sockets с матрицами 3×4; joints по-прежнему в поле 128×128.
Матрицы sockets относятся к общей системе модели до camera yaw/pitch.

Сейчас глубина каждого прикреплённого спрайта выбирается целиком относительно
родителя. Общего Z-buffer между разными моделями нет: пересечение оружия
с кистями/телом может давать неверное перекрытие. Поза второй руки задана
в JSON, автоматического двухручного IK нет. Это демонстрация игровых
предметов; стрельба и механика оружия не реализованы.

## Авторская поверхность и PNG

`tools/compile_rotsprite.py` принимает surface JSON v1 с `patches`:

- samples: `[u,v,id,x,y,z]`, одна точка на ячейку материала 4×4;
- grid: rect и прямоугольная сетка контрольных XYZ-точек, билинейная поверхность;
- loft: rect и sections `[v,rx,frontDepth,backDepth,cx,cy,cz,angleOffset]`.

rect/UV MUST быть выровнены по 4, лежать в материальной области 1024×768
канонического PNG; клетки MUST NOT пересекаться. XYZ MUST помещаться в
X/Z [-32,31.75], Y [-64,63.5]. matrix? задаёт 3×4 affine для grid/loft.
color? заполняет разработческий материал без входного PNG. При `--segments`
правила `{id,axis,greaterThan,assign}` разделяют ID по координате (например,
бедро/голень). Строгий выход: 1024/2048/3072/4096 square RGBA.

```sh
python3 tools/compile_rotsprite.py art/object.surface.json --material art/material.png --output art/object.png --size 4096
python3 tools/build_rotsprite_assets.py demos/rotsprite/build.json
python3 tools/build_rotsprite_assets.py demos/rotsprite/weapons/build.json
```

Во второй команде данные геометрии маскота читаются из source/*.surface.json.
Новые предметы и животные SHOULD начинаться с templates/prop.* и animal.*,
а не копировать человеческий rig. Это технические цветные шаблоны.

Hot reload наблюдает runtime PNG, JSON описания/анимаций и доноры каждые
0.5 секунды. Изменив surface/material, автор MUST сначала пересобрать PNG.
Невалидное обновление сохраняет последний действующий ресурс и reloadError.

Проверки: r2d_rotsprite_test, tests/js/rotsprite_json_test.mjs,
tests/agent/rotsprite_json_test.py, tests/rotsprite/surface_test.py.

Полное руководство разработчика/художника: [RE2DSPRITE_GUIDE.md](RE2DSPRITE_GUIDE.md).

В актуальном маскоте также разделены плечи/предплечья: ID 7/11 → 20/21
после Y=4, sockets handLeft/handRight привязаны к forearmLeft/Right.
holdRifle — изготовка вперёд, оба хвата проверяются по матрицам сокетов.
Базовая модельная заготовка: assets/rotsprite/rotsprite_v2_model_template.png
и demos/rotsprite/templates/russi.character.json.

Выбор частей изображения для рук FPS: `.re2dVisibleParts(ids|null)`,
[контракт](highlevel/re2dsprite.md#видимые-части-модели). Кости и sockets сохраняются.

Математика, карта частей и формат SUB/BLD: [полный справочник](RE2DSPRITE_MATH.md).

## Проверка без движка

`build/r2d-sdk validate <файл>.character.json` проверяет описание теми же
правилами, что рантайм (`validateRotDefinition`, `validateRotAnimations`), плюс
PNG v2: размер, заголовок, карты, части без отсчётов, дыры и скачки XYZ.
Ответ — JSON со стабильными кодами `SDK_RE2D_*` ([SDK.md](SDK.md) §6).
