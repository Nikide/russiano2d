# Текстовые стили — `$.font`

Подсистема `font.js` — именованные наборы параметров текста: размер, цвет,
выравнивание, межстрочный интервал. Один стиль описывается один раз и
применяется к любому числу узлов — правка в одном месте меняет весь HUD,
подписи меню и реплики диалогов:

```js
$.ready(() => {
    $.font.define('hud',   { size: 20, color: '#ffffff', align: 'left' });
    $.font.define('title', { base: 'hud', size: 40, color: '#ffd166' });

    $('<ui.label>', { id: 'score', text: 'Счёт: 0' }).at(120, 40).size(240, 30);
    $.font.apply('#score', 'hud');
    $('#score').textStyle('title');        // то же самое методом узла
});
```

Модуль — **только надстройка**: он не заменяет `$.gfx.text()`, `.fontSize()` и
`.text()`, а раскладывает готовый набор по уже существующим свойствам узла
(`size`, `color`/`text_color`, `attrs.align`, `attrs.lineHeight`), которые
читает отрисовка.

---

## 1. Поля стиля

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `size` | number | 20 | размер шрифта в пикселях |
| `color` | цвет | `'#ffffff'` | цвет текста (см. §2 — у контролов он уезжает в `text_color`) |
| `align` | `'left'`\|`'center'`\|`'right'` | `'left'` | выравнивание (`attrs.align`) |
| `lineHeight` | number | 1.25 | множитель межстрочного интервала (`attrs.lineHeight`) |
| `base` | string | — | имя родительского стиля (§4) |

Любые **другие** поля описания копируются в `attrs` узла как есть: `$.font` о
них ничего не знает, но их может читать другая подсистема
(`$.font.define('glow', { size: 20, letterSpacing: 3 })` → `attrs.letterSpacing`).

## 2. Куда попадает цвет

У контролов свойство `color` — это **фон**, а цвет подписи лежит в
`text_color`. `apply()` выбирает свойство сам, иначе стиль перекрашивал бы фон
кнопки:

| Теги | Свойство цвета |
|---|---|
| `ui.button`, `ui.bar`, `ui.checkbox`, `ui.slider`, `ui.input`, `ui.list`, `ui.dialog` | `text_color` |
| `text`, `ui.label`, `ui.panel`, остальные | `color` |

Чистая функция для проверки правила — `textColorTarget(tag)` → `'text'` | `'color'`.

## 3. Функции `$.font`

| Функция | Назначение |
|---|---|
| `$.font.define(name, spec)` | объявить стиль; `spec.base` — наследование |
| `$.font.get(name)` | разобранный стиль (копия) или `null`, если стиля нет |
| `$.font.has(name)` | есть ли такой стиль |
| `$.font.list()` | имена стилей по алфавиту |
| `$.font.remove(name)` | удалить стиль |
| `$.font.apply(target, name)` | применить стиль к узлу, обёртке `$(…)`, селектору или массиву |
| `$.font.of(target)` | имя стиля, последним применённого к узлу (или `null`) |
| `$.font.styleOf(target)` | что реально читает отрисовка: `{ font, size, align, lineHeight, color }` |
| `$.font.measure(text, name)` | ширина строки в пикселях этим стилем |
| `$.font.defaults()` | значения по умолчанию (копия) |
| `$.font.load(name, path, opts?)` | загрузить `.ttf`/`.otf` как семейство (без имени — имя файла). `opts`: `{ weight, style }` — лицо RmlUi (§6) |
| `$.font.uploaded()` | семейства, загруженные через `$.font.load` |
| `$.font.faces()` | явные лица RmlUi: `[{ family, weight, style, path }]` |
| `$.font.families()` | все семейства: атлас сцены + семейства явных лиц RmlUi |
| `$.font.default()` | семейство шрифта сцены по умолчанию |
| `$.font.atlas()` | `{ glyphs, atlas_w, atlas_h }` — состояние атласа глифов |
| `$.font.width(text, size, family?)` | ширина строки явным кеглем |

```js
$.font.apply('#score', 'hud');       // селектор
$.font.apply($('#score'), 'hud');    // обёртка
$.font.apply($('#score').get(0), 'hud');   // сам узел
$.font.apply($('ui.button'), 'hud');       // все кнопки
```

## 4. Метод узла `.textStyle()`

| Вызов | Что делает |
|---|---|
| `.textStyle('hud')` | применить объявленный стиль |
| `.textStyle({ size: 30, color: '#f00' })` | разовый набор без регистрации (имя не запоминается) |
| `.textStyle()` | имя действующего стиля или `null` |

## 5. Наследование

Цепочка: `default` (если объявлен) → `base` → сам стиль. Незаданные поля
наследуются, заданные — перекрывают:

```js
$.font.define('default', { size: 18, color: '#c8d4e8' });   // база для всех
$.font.define('hud', { align: 'left' });                     // size/color из default
$.font.define('title', { base: 'hud', size: 40 });           // + свой размер
$.font.get('title');   // { size: 40, color: '#c8d4e8', align: 'left', lineHeight: 1.25 }
```

Цикл в `base` (`a → b → a`) разбор не вешает: повторное имя просто
пропускается. Ссылка на несуществующую базу — предупреждение в лог один раз,
стиль продолжает работать без неё.

## 6. Лица RmlUi: weight и style

Интерфейс на RmlUi умеет настоящие шрифтовые лица. Файл регистрируется как
**именованное семейство с начертанием**, и дальше его выбирает RCSS:

```js
// обычный файл → семейство + нормальное лицо (400/normal)
$.font.load('title', 'assets/fonts/NotoSans-Bold.ttf');

// то же семейство, но явное лицо: жирное/курсивное
$.font.load('title', 'assets/fonts/NotoSans-Bold.ttf', { weight: 'bold' });
$.font.load('title', 'assets/fonts/NotoSans-Italic.ttf', { weight: 400, style: 'italic' });
```

```css
h1 { font-family: title; font-weight: bold; }
blockquote { font-family: title; font-weight: 400; font-style: italic; }
```

| Параметр | Значения | По умолчанию |
|---|---|---|
| `weight` | `'normal'`/`'regular'` (400), `'bold'` (700), целое 1..1000 | 400 |
| `style` | `'normal'`, `'italic'` | `'normal'` |

Неверное значение — строка в журнал и `false`; начертание не подменяется
молча. На низком уровне это `engine.ui.loadFontFace(path, family, weight,
style)` → `Rml::LoadFontFace(path, family, style, weight)`; метаданные явных
лиц отдаёт `engine.ui.fontFaces()`.

```js
$.font.load('title', 'assets/fonts/NotoSans-Regular.ttf', { weight: 'bold' });
$.font.faces();      // [{ family:'title', weight:700, style:'normal', path:'…' }]
$.font.families();   // ['Open Sans', …, 'title']
```

**Что это НЕ делает.** Кастомный рендерер текста сцены (`$.gfx.text`,
тег `<text>`) по-прежнему растеризует один атлас и не умеет bold/italic:
движок не «подделывает» жирность/наклон обводкой или матрицей. Поэтому:

* `$.font.load(name, path)` без `opts` сохраняет прежнее поведение — грузит
  файл в атлас сцены (для `<text>`/мирового текста) и дополнительно
  регистрирует нормальное лицо RmlUi;
* `$.font.load(name, path, { weight, style })` с не-400/normal грузит
  **только лицо RmlUi** для HTML-интерфейса и НЕ перезагружает атлас сцены
  чужим файлом — иначе обычный текст молча стал бы жирным;
* хотите жирный мирровой текст — нужен отдельный файл и отдельное семейство
  (`$.font.load('title-bold', '…-Bold.ttf')`), а не `weight` у того же имени.

Проверка: `tests/js/font_weight_test.mjs` (валидация и проводка без движка) и
`tests/agent/highlevel_text_test.py` (живое лицо, RCSS-документ, текст/rect).

## 7. Ограничения

* RmlUi-лица (§6) дают жирный/курсив/свой файл только HTML-интерфейсу; текстовый
  рендерер сцены (`$.gfx.text`, `<text>`) остаётся одноатласным, bold/italic
  там не подделываются;
* перенос строк стилем по-прежнему не задаётся;
* `apply()` пишет в `attrs.align` — у тега `<text>` это то же поле, что и у
  `<ui.label>`, поэтому стиль с `align` действует на оба;
* `align` вне `left/center/right` подменяется на `left` с предупреждением;
* неизвестный стиль: `get()` → `null`, `apply()` пишет в лог и **не меняет**
  узел; `measure()` берёт размер по умолчанию;
* `.textStyle()` — метод обёртки `$`, его имя уникально и не пересекается со
  списком §5 контракта (`fontSize` при этом остаётся отдельным методом);
* реестр стилей живёт в замыкании `installFont()`: повторная установка
  (перезагрузка игры) начинает с чистого списка;
* `$.font.measure()` без движка (qjs) возвращает 0 — тесты проверяют логику,
  а не метрики шрифта.

## 8. Проверка

```bash
build/_deps/quickjs-build/qjs tests/js/font_test.mjs
build/_deps/quickjs-build/qjs tests/js/font_weight_test.mjs
python3 tests/agent/highlevel_text_test.py     # после сборки движка
```

`font_test.mjs`: разбор и слияние стилей, наследование (`base`, неявный
`default`), циклы, выбор свойства для цвета, копия из `get()`, неизвестный
стиль, `.textStyle()`, `measure()`, `styleOf()`.

`font_weight_test.mjs`: weight/style (normal/bold/1..1000, italic), отказ на
мусоре, прежний контракт `load(name,path)`, лица RmlUi и `faces()/families()`,
поведение без GUI.
