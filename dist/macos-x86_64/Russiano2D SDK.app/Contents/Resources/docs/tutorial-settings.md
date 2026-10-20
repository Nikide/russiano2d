# Туториал: эталонное меню настроек

Можно ли на Russiano2D сделать полноценное меню настроек — с вкладками,
ползунками, переназначением клавиш, переключением языка на лету и сохранением
между запусками? **Да**, и это не «почти»: рабочий образец лежит в
[`demos/settings`](../demos/settings/), а здесь разобрано, как он собран и
сколько стоит.

```bash
./build/russiano2d --game demos --scene settings
```

Образец намеренно не новая подсистема движка, а **игра, которая пользуется
существующими**: `$.ui.doc` (RmlUi), `$.window`, `$.sound`, `$.input`, `$.i18n`,
`$.store`, `$.time`. Всё, что понадобилось, — 170 строк разметки, 190 строк
стилей и 757 строк JS.

---

## 1. Что умеет образец

| Вкладка | Строки | Что делает |
|---|---|---|
| **Графика** | 5 | режим окна, разрешение из `$.window.displayModes()`, масштаб интерфейса, SMAA, показ FPS |
| **Звук** | 5 | мастер, эффекты, музыка, тишина, кнопка проверки |
| **Управление** | 6 | четыре действия с захватом клавиши, геймпад, сброс к эталону |
| **Язык** | 3 | ru/en на лету, сброс всех настроек |

Управление: `↑↓` (и стик/d-pad) — кольцо выбора, `←→` — значение,
`Enter`/`A` — изменить, `Esc`/`B` — назад, `Tab` — следующая вкладка, мышь —
наведение и клик (первый клик выбирает строку, повторный — действует).

---

## 2. Экран — это документ RmlUi

Закон интерфейса ([UI_RMLUI_LAW.md](UI_RMLUI_LAW.md)): меню, экраны и диалоги
делаются **документами** `.rml` + `.rcss`, а не узлами `<ui.*>`. Поэтому меню —
это `demos/settings/settings.rml`:

```html
<div id="tabs">
    <button id="tab-graphics" class="tab">Графика</button>
    <button id="tab-sound" class="tab">Звук</button>
    <button id="tab-controls" class="tab">Управление</button>
    <button id="tab-lang" class="tab">Язык</button>
</div>

<div id="page-graphics" class="page on">
    <div class="row" id="row-g-scale">
        <span class="label" id="lbl-g-scale">Масштаб интерфейса</span>
        <span class="bar"><span class="fill" id="fill-g-scale"></span></span>
        <span class="val" id="val-g-scale">1.00×</span>
    </div>
    …
</div>
```

Разметка **статическая**: строки видно глазами и можно скопировать как образец,
а JS только связывает их с настройками по id (`row-g-scale` → `gfx.scale`).
Стили адаптивные — размеры в `vh`, как в меню-лаунчере: сцена всегда 16:9,
поэтому одинаковая картинка и в 1280×720, и в 1920×1080.

Подключение и показ:

```js
const DOC = 'demos/settings/settings.rml';
const doc = $.ui.doc(DOC);     // документ кэшируется по пути
doc.show();                    // показать
doc.text('val-g-scale', '1.25×');   // записать текст элемента
doc.cls('row-g-scale', 'sel', true); // класс — кольцо выбора
doc.style('fill-g-scale', 'width', '60%');
doc.on('row-g-scale', 'click', () => { … });
```

Стоимость: первое открытие (загрузка документа + применение всех настроек) —
**10.5 мс**, а повторные `hide()`/`show()` уже загруженного документа — **23 мкс**.

---

## 3. Настройки: своя таблица + `$.store`

Типизированного `$.settings` в движке нет — и не нужно: настройки это обычные
значения в `$.store`, а «схема» описывается одним объектом defaults.

```js
const SETTINGS_FILE = 'settings.json';

function defaults() {
    return {
        'gfx.fullscreen': 'windowed', 'gfx.modeIndex': -1,
        'gfx.scale': 1, 'gfx.smaa': 'off', 'gfx.fps': true,
        'snd.master': 0.8, 'snd.sfx': 0.8, 'snd.music': 0.6, 'snd.mute': false,
        'ctl.gamepad': true, 'lang.code': 'ru',
    };
}

$.store.file(SETTINGS_FILE);
$.store.load(SETTINGS_FILE);        // ← без этого файл читался бы, но не применялся

function readAll() {
    const def = defaults();
    const out = {};
    for (const key of Object.keys(def)) out[key] = $.store.get('settings.' + key, def[key]);
    return out;
}
```

**Ловушка, на которую я наступил:** `$.store.file(path)` только выбирает файл.
Если не позвать `$.store.load()`, значения будут прекрасно писаться на диск и
так же прекрасно игнорироваться при следующем запуске: «настройки не переживают
перезапуск» выглядит как мистика, а лечится одной строкой.

Запись — отложенная, чтобы удержание `→` не писало файл 20 раз в секунду:

```js
let saveTimer = 0;
function saveSoon() {
    if (saveTimer) $.time.cancel(saveTimer);
    saveTimer = $.time.after(250, () => {      // в QuickJS НЕТ setTimeout
        saveTimer = 0;
        $.store.file(SETTINGS_FILE).save();
    });
}
```

Файл на все 15 значений — **718 Б**, запись занимает **0.36 мс**. Формат —
обычный JSON, который можно править руками:

```json
{ "version": 1, "saved_frame": 96,
  "data": { "settings.gfx.scale": 1.25, "settings.lang.code": "en", "settings.gfx.smaa": "medium" } }
```

---

## 4. Применение на лету

Каждая настройка применяется к своей подсистеме сразу, а не «при следующем
запуске»:

```js
function apply(key, value) {
    if (key === 'gfx.fullscreen') {
        if (value === 'windowed') $.window.fullscreen(false);
        else if (value === 'desktop') $.window.fullscreen(true);
        else {
            const mode = state.modes[state.values['gfx.modeIndex']];
            $.window.fullscreen({ mode: 'exclusive', width: mode.width,
                                  height: mode.height, refresh: mode.refresh });
        }
    } else if (key === 'gfx.scale')      $.ui.scale(value);
    else if (key === 'gfx.smaa')         value === 'off' ? $.gfx.smaa(false)
                                                         : $.gfx.smaa({ on: true, preset: value });
    else if (key === 'snd.master')       $.sound.volume(value);
    else if (key === 'snd.sfx')          $.sound.sfxVolume(value);
    else if (key === 'snd.music')        $.sound.musicVolume(value);
    else if (key === 'snd.mute')         $.sound.mute(value);
    else if (key === 'lang.code')        { $.i18n.lang(value); retranslate(); }
    else if (key.startsWith('bind.'))    $.input.bind(key.slice(5), value);
}
```

Замер времени применения (микросекунды, живая сборка):

| Настройка | Время | Почему столько |
|---|---|---|
| Полный экран (`desktop`) | **1759 мкс** | перестроение окна и swapchain — самая дорогая настройка |
| Смена языка | **283 мкс** | перерисовка всех подписей меню |
| Разрешение (`exclusive`, режим из списка) | 50 мкс | один вызов в C |
| Сглаживание SMAA | 30 мкс | обновление состояния пост-обработки |
| Эффекты / показ FPS | 5–7 мкс | вызов подсистемы |
| Общая громкость, музыка, тишина, геймпад | 1–4 мкс | чистая установка значения |
| Переназначение клавиши | **0.3 мкс** | запись в таблицу привязок |
| Сброс всех настроек | **605 мкс** | 15 значений + запись файла |

**Находка про режимы окна (task-41):** сразу после смены режима окну нужно
4–6 кадров, чтобы устояться, иначе ввод в этот момент теряется. Меню поэтому не
проверяет «эхо» настройки в том же кадре: кольцо выбора живёт по своему
состоянию, а не по прочитанному обратно режиму.

### SMAA включается флагом, а не пресетом

```js
$.gfx.smaa({ preset: 'high' });    // задаёт ТОЛЬКО качество поиска: on остаётся false
$.gfx.smaa({ on: true, preset: 'high' });   // включить и выбрать качество
$.gfx.smaa(false);                 // выключить
$.gfx.smaa();                      // прочитать: { available, on, preset, steps, pixel_art, active, reason }
```

Если SMAA «включён, но не действует» (пост выключен, пиксель-арт, веб), в
`reason` написана причина — в меню это можно показывать игроку честно.

---

## 5. Захват клавиши: хелпер уже есть

Отдельный `$.input.capture()` **не нужен** — в движке есть `waitForInput`:

```js
function capture(action, rowId) {
    $.input.waitForInput({ timeout: 5000, ignore: ['escape'] }).then((key) => {
        if (!key) return;                                   // таймаут
        const conflicts = $.input.conflicts(action, [key]); // кто ещё занял клавишу
        $.input.bind(action, [key]);
        if (conflicts.length) show('клавиша занята ещё у ' + conflicts.length + ' действий');
    });
}
```

Что важно знать:

* пока идёт захват, меню **не должно** реагировать на навигацию — иначе нажатая
  клавиша одновременно переназначится и переключит строку; поэтому в `update`
  первым делом проверяется `state.capturing`;
* `$.input.cancelWaits()` снимает ожидание (например, при закрытии меню);
* `$.input.glyphs(action)` даёт подписи для UI (`['SPACE', 'W', 'UP']`) — их и
  показывает строка настройки;
* `$.input.markDefaults()` фиксирует эталон, `$.input.resetDefaults()` возвращает
  к нему — это и есть кнопка «сбросить управление».

---

## 6. Кольцо выбора и ввод тремя способами

Кольцо (`row.sel`) ведёт JS: один и тот же код обслуживает клавиатуру, геймпад и
мышь. Контекст ввода отделяет меню от игры:

```js
$.input.context('settings', {
    active: false, priority: 40,
    binds: {
        menu_up:      ['up', 'w', 'gamepad.dpup'],
        menu_down:    ['down', 's', 'gamepad.dpdown'],
        menu_left:    ['left', 'a', 'gamepad.dpleft'],
        menu_right:   ['right', 'd', 'gamepad.dpright'],
        menu_confirm: ['enter', 'space', 'gamepad.a'],
        menu_back:    ['escape', 'gamepad.b'],
        menu_tab:     ['tab'],
    },
});
$.input.context('settings').active(true);   // меню открыто
```

Дальше `update` читает действия и двигает кольцо:

```js
if ($.input.pressed('menu_down')) { select(state.sel + 1); $.input.consume('menu_down'); }
if ($.input.pressed('menu_right')) { change(current(), +1); $.input.consume('menu_right'); }
```

**Ограничение, о котором надо знать.** `$.ui.gamepadNavigation(true)` превращает
геймпад в синтетические клавиши для слоя `$`-виджетов (`$.screen`, `$.dialog`,
`<ui.*>`), но **документы RmlUi этим путём не ходят** — им нужен мост
«геймпад → SDL-событие» на стороне C, которого пока нет
([input.md §15](highlevel/input.md)). В образце поэтому d-pad и кнопки идут
через привязки контекста выше (они app-level, работают сразу), а аналоговый стик
читается вручную:

```js
const pad = $.input.gamepad(0);
if (pad.connected() && pad.axis(1) > 0.6) select(state.sel + 1);   // стик вниз
```

То есть меню с геймпадом делается, но держите в голове: это код игры, а не
готовая навигация RmlUi. Когда в движке появится мост — эти 40 строк заменятся
одним вызовом.

Мышь работает сама: `doc.on(rowId, 'click', …)`, причём клик по **невыбранной**
строке только выбирает её, а по выбранной — действует. Так случайный клик не
прыгает по значению.

---

## 7. Язык на лету

Словари регистрируются через `$.i18n.add`, а `$.tr` отдаёт строку. После смены
языка достаточно перерисовать подписи — документ и сцена не перезагружаются:

```js
$.i18n.add('ru', { 'settings.g.scale': 'Масштаб интерфейса' });
$.i18n.add('en', { 'settings.g.scale': 'UI scale' });

function retranslate() {
    const d = $.ui.doc(DOC);
    d.text('title', $.tr('settings.title', {}, 'Настройки'));
    for (const item of state.root) d.text('lbl-' + item.id, label(item.key));
}
```

Замер: переключение языка ru → en вместе с перерисовкой всех подписей — **283 мкс**;
в тесте проверяется, что `doc.content('lbl-s-master')` меняется с
«Общая громкость» на «Master volume» **в том же кадре**, и что выбранный язык
переживает перезапуск.

---

## 8. Сколько это стоит в кадре

Профилировщик движка, зона «интерфейс (RmlUi)», 120 кадров:

| Состояние | Зона «интерфейс (RmlUi)» | JS-логика | Кадр целиком |
|---|---|---|---|
| Меню открыто | **0.080 мс** | 0.252 мс | 16.67 мс (фиксированный шаг) |
| Меню закрыто | **0.023 мс** | 0.224 мс | 16.67 мс |

Меню стоит **≈ 0.06 мс на кадр** — 0.35 % бюджета 60 FPS. Закрытое меню почти
бесплатно, потому что документ просто скрыт; при желании его можно выгрузить
(`$.ui.doc(DOC).unload()`), но тогда следующее открытие снова будет ~10 мс.

---

## 9. Чего у нас нет (и как это обойти)

| Чего нет | Честный обход в образце |
|---|---|
| типизированного `$.settings` со схемой и валидацией | таблица `defaults()` + `$.store`: ключи, значения по умолчанию и сброс — в одном месте |
| `$.input.capture()` | `$.input.waitForInput()` — уже в движке, умеет таймаут и отмену |
| навигации RmlUi-документов геймпадом из коробки | привязки контекста (`gamepad.dpup` → действие меню) + чтение стика вручную; ждём мост «геймпад → SDL» в C |
| стека экранов для **документов** (`$.screen` строит экраны из `<ui.*>`, а закон UI требует RmlUi) | состояние + `doc.show()`/`hide()`: стек из одного-двух документов пишется в игре, как здесь |
| `setTimeout` в QuickJS | `$.time.after(ms, fn)`, отмена — `$.time.cancel(id)` |
| слайдера-перетаскивания в RmlUi-документе | ползунок нарисован полосой (`.bar`/`.fill`), значение меняется `←→`; для drag нужен свой обработчик мыши |
| режимов дисплея в headless/вебе | `$.window.displayModes()` может вернуть пустой список — меню показывает «—» и не падает |

---

## 10. Проверка

```bash
python3 tests/agent/settings_menu_test.py
```

Тест проверяет открытие экрана, изменение каждой настройки (числа до/после в
`$.ui.scaleValue()`, `$.sound.volume()`, `$.gfx.smaa()`, `$.window.fullscreen()`,
`$.i18n.lang()`), сохранение через **перезапуск движка**, сброс к дефолтам,
навигацию клавиатурой и геймпадом, мышь, захват клавиши и время применения.
Аналоговый стик проверяется только на живом геймпаде — в headless его нет, и это
написано в тесте, а не замолчано.

Готовый пример для копирования — [`demos/settings`](../demos/settings/).
