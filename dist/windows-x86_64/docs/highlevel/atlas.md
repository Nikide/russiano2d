# Атласы из JSON — `$.atlas`

Спрайтовый лист обычно не сетка: художник режет картинки как удобно и отдаёт
вместе с ними JSON — где какой кадр и как называются анимации. `$.atlas`
читает этот JSON и делает из него спрайты.

```js
$.ready(() => {
    const hero = $.atlas.load('hero', 'art/hero.json');
    const idle = hero.tagSprites('idle');          // массив id спрайтов тега

    $('#hero').at(200, 300)
        .frames(idle)                              // кадры тега становятся листом узла
        .animate({ from: 0, to: idle.length - 1, speed: 8, loop: true })
        .appendTo($.world);
});
```

`$.anim.clip(имя, { frames })` из шапки модуля — **не** рабочий вызов: клип
плеера (`$.anim.clip`, [animplayer.md](animplayer.md)) состоит из `duration`,
`loop`, `speed` и `tracks`, а дорожка `sprite` берёт кадры из `node.frames`
узла, то есть после `.frames(idle)`. Для клипа старого формата
(`$.anim.define`) дорожка — `{ anim: { from, to } }`.

---

## 1. Загрузка

| Вызов | Что делает |
|---|---|
| `$.atlas.load(name, { path, data, mipmaps, allowRotated })` | загрузка с опциями (см. ниже) |
| `$.atlas.verify(data, opts)` | проверка данных без загрузки: `{ ok, errors, warnings }` |
| `$.atlas.errors()` | кольцо структурированных ошибок (работает и без движка) |
| `$.atlas.manifest(name)` | import-манифест загруженного атласа или `null` |

| `$.atlas.load('hero', 'art/hero.json')` | читает JSON через `$.fs.readJSON`, грузит картинку из данных, режет кадры |
| `$.atlas.load('hero', { data: json, src: 'art/sheet.png' })` | данные уже в памяти (ответ сети, тест); `src` перебивает путь к картинке |
| `$.atlas.get('hero')` | загруженный атлас или `null` |
| `$.atlas.names()` | имена загруженных атласов |
| `$.atlas.unload('hero')` | забыть атлас (спрайты живут в движке) |
| `$.atlas.parse(data)` | разобрать данные без загрузки — для отладки |
| `$.atlas.imagePath(json, data)` | путь к картинке по данным |

Путь к картинке берётся из `meta.image` (Aseprite) или `image`, считается от
каталога JSON. Если поля нет — рядом с JSON подставляется `.png`.

## 2. Форматы

Формат определяется по содержимому, а не по расширению.

| Формат | Как узнать | Особенности |
|---|---|---|
| **Aseprite** (Export Sprite Sheet → JSON) | `frames` — объект, есть `meta` | кадры с `duration`, теги `meta.frameTags` |
| **TexturePacker / LibGDX** | `frames` — массив с `filename` | кадры вида `frame: {x,y,w,h}` |
| **свой простой** | `frames` — объект «имя → `{x,y,w,h}`» | годится для ручных списков; теги можно задать полем `tags` |

Поддержаны обе формы прямоугольника: `{w, h}` и `{width, height}`, а также
кадр без обёртки `frame` (плоский).

## 3. Объект атласа

| Метод | Возвращает |
|---|---|
| `frame(name)` | id спрайта кадра (`-1`, если кадра нет) |
| `frames()` | имена кадров в порядке атласа |
| `info(name)` | `{ name, x, y, w, h, duration }` или `null` |
| `tag(name)` | имена кадров тега; пустой массив, если тега нет |
| `tagSprites(name)` | массив id спрайтов — готовый вход `$.anim.clip` |
| `tagInterval(name)` | длительность кадра тега в мс (`0` — брать из клипа) |
| `tags()` | имена тегов |
| `slice(name, frame?)` | слайс Aseprite: `{frame, x, y, w, h, pivotX, pivotY, pivotLx, pivotLy}` |
| `sliceNames()` | имена слайсов |
| `sliceCount(name)` | сколько ключей (по кадрам) у слайса |
| `size()` | `[ширина, высота]` картинки атласа |
| `image`, `texture`, `format`, `meta` | поля загруженного атласа |

Тег `direction: 'reverse'` из Aseprite разворачивает список кадров, поэтому
`tag('walk')` идёт в правильном порядке.

### 3.0. Страницы, padding/extrusion и мипмапы

Атлас может состоять из нескольких PNG (страниц). Кадр несёт `page` (индекс или
имя), а `meta.pages` описывает страницы:

```json
{
  "meta": {
    "image": "body.png",
    "size": { "w": 512, "h": 512 },
    "pages": [{ "name": "body", "image": "body.png" },
              { "name": "props", "image": "props.png" }],
    "padding": 2,
    "extrusion": 1
  },
  "frames": {
    "body_0": { "frame": { "x": 0, "y": 0, "w": 32, "h": 32 }, "page": "body" },
    "prop_0": { "frame": { "x": 0, "y": 0, "w": 16, "h": 16 }, "page": "props" }
  }
}
```

| Метод | Результат |
|---|---|
| `sheet.page(name)` | индекс страницы кадра или `-1` |
| `sheet.pages()` | `[{ index, name, image, mipmaps, frames }]` |
| `sheet.images` | пути страниц в порядке индексов |
| `sheet.verify(opts)` | то же, что `$.atlas.verify(data, opts)` для своих данных |

Пути страниц разрешаются **относительно JSON атласа** (`$.atlas.resolveAssetPath`),
а не рабочего каталога. Отсутствующая страница — не пустой спрайт, а отказ
загрузки с кодом `atlas_page_missing` (§3.4).

**Power-of-two.** Не обязательна для современных GPU, поэтому `verify()`
сообщает `atlas_page_not_pot` предупреждением: размер страницы — вопрос политики
упаковщика и стриминга, а не корректности кадров.

**Мипмапы и протечка.** `mipmaps: true` включает уровни, но только когда
упаковка объявила запас: `meta.padding >= 1` **и** `meta.extrusion >= 1`.
Без запаса грубые уровни усредняют соседние кадры, и кадр «протекает» на
соседа; в этом случае страница грузится без мипмапов (флаг виден в
`pages()[i].mipmaps`), а `verify()` сообщает `atlas_no_padding`. На нулевом
уровне край держит полутексельный отступ, который ставит движок при создании
спрайта.

### 3.1. Слайсы и пивоты Aseprite

Aseprite хранит **слайсы** (`meta.slices`): у каждого ключа прямоугольник и
**пивот**. Это ровно то, что нужно для рамок, точек крепления и вращения частей.

```js
const hero = $.atlas.load('hero', 'art/hero.json');

hero.sliceNames();                     // ['head', 'hand', 'body']
const hand = hero.slice('hand', 2);    // ключ слайса для кадра 2
// { frame, x, y, w, h, pivotX, pivotY, pivotLx, pivotLy }
```

`pivotX`/`pivotY` — как в JSON (**абсолютные**, в координатах спрайта);
`pivotLx`/`pivotLy` — локальные, от левого верхнего угла слайса. Для поворота
нужен именно локальный: `$.mesh.fromSlice` делает пивот **началом координат
части**, поэтому `$.mesh.draw` крутит часть вокруг сустава, а не вокруг угла
картинки (см. [mesh.md](mesh.md) §2.1).

Без `pivot` в ключе пивот считается центром слайса.

Ключи слайса нумеруются **кадрами листа** (число), а не именами: `slice(name,
frame)` берёт последний ключ с `frame <=` указанного. Без аргумента — первый.

## 3.2. Правка в SDK

Атлас в формате «Aseprite JSON с `frames`-объектом» правит Sprite Studio
(SDK, [../SDK.md](../SDK.md) §5): кадры, пивоты (слайсы с именем кадра),
длительности, теги-анимации (`meta.frameTags`, поле `loop` рантайм
игнорирует) и `meta.custom`. Файл пишется в каноническом виде — по строке на
кадр, тег и слайс. Движок следит за `*.atlas.json`
([script.md](script.md)), поэтому сохранение в Studio перезапускает игру.

### 3.3. Import-манифест

Авторские данные и результаты импорта разделены: `meta.import` описывает, ЧЕМ и
ИЗ ЧЕГО собран атлас, и не влияет на кадры.

```json
{
  "meta": {
    "import": {
      "version": 1,
      "importer": "r2d-atlas/1.4",
      "contentHash": "sha256:…",
      "settings": { "padding": 2, "extrude": 1 },
      "dependencies": ["raw/hero.ase", "raw/props.ase"]
    }
  }
}
```

`sheet.manifest` (и `$.atlas.manifest(name)`) отдаёт `{ version, importer,
contentHash, settings, dependencies }` или `null`. Повторный разбор одних и тех
же данных детерминирован (`$.atlas.parse(data)` дважды даёт одинаковый
результат): кэш можно удалить, а настройки — проверить (`verify` с
`manifestVersion`/`importer`).

### 3.4. Проверка и ошибки

`$.atlas.verify(data, opts)` ничего не грузит и возвращает
`{ ok, errors, warnings, frames, pages, format, rotated, manifest }`:

| Код | Тип | Что значит |
|---|---|---|
| `atlas_no_frames` | ошибка | в данных нет кадров |
| `atlas_rotated_frame` | ошибка | кадр повёрнут в атласе (см. §4) |
| `atlas_frame_out_of_page` | ошибка | кадр выходит за `meta.size` |
| `atlas_frames_overlap` | ошибка | два кадра пересекаются |
| `atlas_tag_frame_missing` | ошибка | тег ссылается на несуществующий кадр |
| `atlas_frame_page_missing` | ошибка | у кадра нет объявленной страницы |
| `atlas_page_no_image` | ошибка | у страницы не указан файл |
| `atlas_manifest_version` | ошибка | версия манифеста новее поддерживаемой |
| `atlas_no_padding` / `atlas_padding_small` | предупреждение | кадры вплотную: возможна протечка |
| `atlas_no_durations` | предупреждение | ни у одного кадра нет длительности |
| `atlas_page_not_pot` | предупреждение | страница не степень двойки (PoT-политика упаковщика) |
| `atlas_manifest_no_hash` / `atlas_importer_mismatch` | предупреждение | манифест неполный/чужой |

Ошибки загрузки (а не только проверки) идут двумя путями: строка в журнал,
`$.atlas.errors()` (кольцо записей `{ code, message, where, assetPath, … }`,
работает и в qjs-тестах) и запись в `$.debug.reportError` с `code`,
`subsystem: 'atlas'` и путями — её видит `$.debug.errors()`.

```js
const r = $.atlas.verify(data);
if (!r.ok) for (const e of r.errors) $.log(e.code + ': ' + e.message);
```

## 4. Ограничения

* **повёрнутые кадры отклоняют атлас целиком**: если в JSON есть `rotated: true`,
  `$.atlas.load` возвращает `null` и пишет `atlas_rotated_frame` со списком
  кадров — молча пропускать часть production-клипа нельзя. Явное
  `allowRotated: true` берёт регионы как есть (для необязательных ассетов);
* **trimmed-кадры** импортируются по своему прямоугольнику. Пивот из
  **слайсов** (`meta.slices`) теперь переносится — см. §3.1; если пивот задан
  только у trimmed-кадра и слайсов нет, ставьте его сами (`.pivot(0.5, 1)`);
* **`$.atlas` не кэширует JSON на диск**: повторный `load` тем же именем
  возвращает уже собранный атлас, а `reload` для атласов нет — вызовите
  `unload` и `load` заново;
* **многолистовые атласы** собираются через `meta.pages` (§3.0); поворот кадра
  внутри страницы — см. выше;
* **мипмапы включаются только при `padding >= 1` и `extrusion >= 1`**: иначе
  страница грузится без уровней (иначе кадры протекают друг в друга);
* **костей (`bones`) в Aseprite JSON нет**: они есть только в `.ase`, а JSON
  несёт кадры, теги и слайсы. Скелет задаётся через `$.mesh.skeleton` руками, а
  слайсы дают привязку частей и пивоты;
* выгрузка спрайтов и картинки — через `$.resource.free()` и
  `engine.freeTexture()` ([resource.md](resource.md)).

## 5. Проверка

```bash
# разбор трёх форматов, теги, обратное направление, путь к картинке, слайсы,
# страницы, import-манифест, verifyAtlas
build/_deps/quickjs-build/qjs tests/js/atlas_test.mjs

# движок: страницы, мипмапы/padding, отсутствующая страница, поворот
python3 tests/agent/highlevel_atlas_test.py
```

## Кэш сборок и выгрузка

`$.atlas.unload(name)` теперь «забыть сборку, но оставить её в кэше»: повторная
загрузка того же имени переиспользует уже собранные спрайты, а не создаёт новые
(раньше 100 циклов `unload → load` давали +200 спрайтов в рендерере).
`$.atlas.unload(name, { drop: true })` выбрасывает и саму сборку,
`$.atlas.builds()` перечисляет сохранённые имена.

Диагностика данных: `atlas_frame_invalid` и `atlas_duplicate_frame` — ошибки,
`atlas_duplicate_tag` — предупреждение; `sheet.invalidFrames()` перечисляет
кадры, которые не удалось прочитать.

## Проверено вызовом на живом движке (task-30)

Ниже — имена, которых не было в этой странице. Каждая строка — результат вызова
на живом движке (фикстура `within`, агентский `eval`), а не вывод из названия.

| Имя | Факт с движка |
|---|---|
| `$.atlas.clearErrors()` | очищает список ошибок атласа; возвращает число очищенных (`0`) |
