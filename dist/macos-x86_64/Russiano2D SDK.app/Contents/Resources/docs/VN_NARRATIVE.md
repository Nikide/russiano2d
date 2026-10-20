# VN narrative architecture (P0/P1)

Авторский редактор `.scene`: [VN_MAKER.md](VN_MAKER.md).

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

## Dynamic choice slots / custom choice templates

Число кнопок выбора задаёт тема, а не жёсткий лимит 6:

```js
$.dialog.themeDefine('many', {
  rml: 'ui/dialog/bashnya.rml',
  rcss: 'ui/dialog/bashnya.rcss',
  choiceSlots: 10,
  choiceTemplate: '<button data-dialog-role="choice">' +
    '<span data-dialog-role="choice-text">{n}. </span></button>',
});
```

`{index}` (с нуля) и `{n}` (с единицы) подставляются в каждую копию шаблона;
авторские `id` из копий вырезаются, `prepareMarkup` назначает уникальные
`r2d-dlg-choice-N`. Без `choiceTemplate` клонируется первый авторский
`data-dialog-role="choice"`. `expandChoiceSlots()` — чистая функция для тестов.
Слоты 1..64; невалидное число отклоняется `themeDefine`.

## Voice, prefetch и i18n — реальные вызовы

Хуки не только эмитятся, но и исполняются:

```js
$.dialog.voice(true);          // по умолчанию true; false останавливает реплику
$.dialog.voiceVolume(0.8);
$.dialog.voiceInfo();          // { enabled, src, handle, playing, volume }
$.dialog.on('voice'|'voicePlay'|'voiceStop'|'prefetch'|'prefetched', fn);
```

`voice` из реплики (или speaker) реально играет через `$.sound.play()`,
предыдущая реплика останавливается, закрытие диалога глушит канал. `prefetch`
реально вызывает `$.sound.preload()` для аудио и `$.resource.preloadTexture()`
для портретов; результат виден в `$.dialog.prefetchInfo()`
(`requested/textures/sounds/failed`). Тексты и имена спикеров ищутся в словаре
через `$.i18n.lookup()` (текущий язык → fallback → остальные), а
`$.dialog.i18nStats()` показывает переведённые и отсутствующие dotted-ключи.
`$.dialog.localize(key, params)` — прямой lookup для UI.

Стандартная тема BASHNYA лежит в `ui/dialog/bashnya.rml` и
`ui/dialog/bashnya.rcss`: чёрная панель, тёмно-красная линия, крупный портрет,
8 слотов выбора, тонкая типографика без «RPG-прямоугольника».

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
const lock = $.input.lock('cutscene');                 // advisory
const hard = $.input.lock('dialog', 'dialog', { hard: true });
hard.release();
$.input.hardLocked();          // true, пока жив хотя бы один hard-token
$.input.rawPressed('escape');  // UI/диалог читает свои клавиши в обход гейта
```

Пока жив `{hard:true}` токен, `$.input.down/pressed/released` и
`mouseDown/mousePressed` возвращают `false` для gameplay; `rawDown/rawPressed/
rawReleased/rawMouse*` доступны UI-слою, который держит лок. `$.dialog.hardLock(true)`
заставляет диалог брать hard-token; по умолчанию лок остаётся advisory ради
обратной совместимости. `$.dialog.inspect().inputHardLocked` показывает режим.

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
`$.dialog.on('voice'|'voicePlay'|'voiceStop'|'textBlip'|'prefetch'|'prefetched', fn)`.

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
inputLocked/inputHardLocked/flags/unread/view/choiceSlots/voice/prefetch/i18n —
данные для DevTools и агента. DevTools F2 получил вкладку **Narrative**
(секции `identity|transform|gameplay|physics|presentation|narrative`);
`$.devtools.narrative()` отдаёт те же факты без выбранной сущности:
Scene/Step/Speaker/DisplayName/Expression/Theme/Typing/Choices/World mode/
Input lock/Flags/Voice/Prefetch/i18n.

## Ограничения

* RmlUi-пиксели темы BASHNYA проверяет agent-тест
  `tests/agent/vn_bashnya_theme_test.py` (скриншот, чёрная панель, красная
  линия, светлый текст); qjs-тест использует записывающий backend и проверяет
  разметку/роли/классы.
* `$.dialog.themeDefine` принимает inline markup или пути к файлам; для путей
  нужен `$.fs.readText` (в игре он есть). Agent-тест передаёт содержимое файлов
  строкой, чтобы проверять именно `ui/dialog/bashnya.*`, а не копию.
* Timeline-специфичные `dialogTheme` (цвета панели builtin-вида) сохранены для
  обратной совместимости; RML-темы их не используют.
* «Настоящий» voice/prefetch — вызовы `$.sound`/`$.resource`; если эти модули
  не установлены (чистый qjs), остаются события, а `prefetchInfo()` честно
  показывает `failed`.
* Hard-lock не перехватывает ввод на уровне SDL: это гейт `$.input`, поэтому
  код, читающий `engine.keyDown` напрямую, его обходит.
