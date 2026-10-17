# VN narrative architecture (P0/P1)

Единый narrative runtime: **одна** машина реплик и один RML/RCSS presentation
слой. Story scenes, timeline, cutscene и обычные диалоги идут через `$.dialog`;
четвёртого UI-движка нет.

## Поток данных

```
story/*.scene  →  Narrative IR  →  $.story / $.cutscene / $.timeline
                                        ↓
                                    $.dialog (логика)
                                        ↓
                                    dialog_view (RML/RCSS)
```

* `dialog.js` — текст, speaker, expression, portrait, typewriter, pages,
  choices, skip/auto, backlog, read/unread, voice/textBlip, save/restore.
  Не знает мировых координат и камеры.
* `dialog_view.js` — только отображение состояния в RmlUi. К элементам
  обращается по `data-dialog-role`, а не по DOM id.
* `dialog_theme.js` — default RML/RCSS, named themes, стек тем, hot reload,
  валидация разметки.
* `story.js` — актёры, камера, кадры, ожидания. Реплики и выборы отдаёт в
  `$.dialog`; собственных текстовых панелей не создаёт.
* `timeline.js` и `cutscene.js` используют тот же `$.dialog`.

## Semantic RML roles

Обязательные: `root`, `text`, `choices`. Опциональные: `box`, `speaker`,
`portrait`, `portrait-image`, `continue-indicator`, `choice`, `choice-text`.
Runtime сам вставляет внутренние id (`r2d-dlg-*`), автор их не пишет.

```xml
<rml><head><title>VN</title></head><body>
<div data-dialog-role="root">
  <div data-dialog-role="portrait"><img data-dialog-role="portrait-image"/></div>
  <div data-dialog-role="box">
    <div data-dialog-role="speaker"></div>
    <div data-dialog-role="text"></div>
    <div data-dialog-role="continue-indicator">◆</div>
  </div>
  <div data-dialog-role="choices">
    <button data-dialog-role="choice"></button>
  </div>
</div>
</body></rml>
```

## Speaker registry / expressions / slots

```js
$.dialog.speaker('w', {
  name: '???',
  portraits: { neutral: 'art/w/neutral.png', smirk: 'art/w/smirk.png' },
  textBlip: 'sfx/blip.wav',
  voice: 'voice/w/01.ogg',
});
$.dialog.define('talk', { start: 'a', nodes: {
  a: { speaker: 'w', expression: 'smirk', slot: 'far-left', text: 'Привет.' },
}});
$.dialog.play('talk');
```

Слоты: `left`, `center`, `right`, `far-left`, `far-right`. View ставит
`.active-speaker` / `.inactive-speaker` на портрет и root-классы
`.typing/.ready/.has-speaker/.has-portrait/.has-choices/.auto/.skip/.backlog-open`.

## Темы, RCSS и кастомный шрифт

```js
$.dialog.themeDefine('bashnya', { rml: 'ui/dialog/bashnya.rml', rcss: 'ui/dialog/bashnya.rcss' });
$.dialog.theme('bashnya');
const token = $.dialog.themePush('memory'); // временная тема
token.release();
$.dialog.template('ui/dialog/other.rml');   // custom RML, default RCSS
```

Шрифт подключается **только RCSS**:

```css
@font-face { font-family:"Bashnya"; src:url("../../fonts/bashnya.ttf"); }
[data-dialog-role="text"] { font-family:"Bashnya"; font-size:26px; }
```

Поддержаны комбинации: default RML + default RCSS, default RML + custom RCSS,
custom RML + custom RCSS. CSS variables (`--dialog-text`, `--dialog-bg`, …)
объявлены в `DEFAULT_RCSS`.

Hot reload: `$.dialog.hotReload()` перечитывает текущую тему, сохраняет
narrative state, заново биндит роли и восстанавливает state. Если новый RML/RCSS
невалиден — остаётся последний валидный документ, диалог продолжается.

## Input lock, world mode, skip

```js
const lock = $.input.lock('cutscene');
lock.release();
$.input.locked('cutscene');   // advisory для gameplay-кода
```

Токен освобождается автоматически на смене сцены; `stop/skip/exception` в
story/dialog освобождают свой токен. `$.dialog.worldMode()` возвращает
`live|pause|cinematic`; во время реплики ставится `cinematic` (gameplay input
считается заблокированным, particles/animation/camera/audio живут).

Skip (`$.dialog.skip()`, `data-dialog-action="skip"`) пропускает только
презентацию: флаги, двери, квесты, инвентарь и story state не теряются.

## Save / resume, backlog, read/unread

```js
const snap = $.dialog.saveState();  // definition/node/page/speaker/theme/flags/read/backlog
$.dialog.restore(snap);
$.dialog.backlog();                 // [{ id, speaker, text, expression, unread }]
$.dialog.unreadCount();
$.dialog.isRead(stableLineId);
```

Stable line id = `definition:node:page`. Voice/textBlip/prefetch hooks:
`$.dialog.on('voice'|'textBlip'|'prefetch', fn)`.

## Story IR

`$.story.compile(textOrScript)` даёт массив `{op:'say'|'choice'|'commit'|'label'|'goto'|'branch'|'wait'|'bubble'|'end'}`.
Story проигрывает реплики через `$.dialog`, а `commit/set` остаются на стороне
story — gameplay state и presentation разделены.

## Native validation

```bash
r2d-sdk story validate story/            # labels/goto/speakers/expressions/assets/i18n/theme/loops
r2d-sdk dialog validate ui/dialog/vn.rml # semantic roles, tag balance, RCSS/font files
```

`story validate` ищет `speakers.json` (`story/speakers.json` или рядом с
каталогом), `i18n/*.json` и проверяет ссылки ассетов относительно каталога
(или `--assets-root`). Оба валидатора — нативный C и один backend для
CLI/GUI/agent.

## Inspector

`$.dialog.inspect()` возвращает open/definition/step/page/speaker/displayName/
expression/portrait/slot/theme/typing/text/choices/auto/backlogOpen/worldMode/
inputLocked/flags/unread/view — данные для DevTools и агента.

## Ограничения

* Полноценный RmlUi-рендер проверяется сборкой движка; qjs-тест использует
  записывающий backend и проверяет разметку/роли/классы.
* `$.dialog.themeDefine` принимает inline markup или пути к файлам; для путей
  нужен `$.fs.readText` (в игре он есть).
* Timeline-специфичные `dialogTheme` (цвета панели builtin-вида) сохранены для
  обратной совместимости; RML-темы их не используют.
