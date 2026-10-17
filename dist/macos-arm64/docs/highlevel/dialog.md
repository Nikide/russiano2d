# Диалоги — `$.dialog`

Подсистема `dialog.js` — ветвящиеся диалоги и квестовые реплики: реплики NPC,
выборы игрока, условия на ветках, печатная машинка и панель с портретом,
именем и кнопками выбора. Диалог описывается данными, состояние ведёт модуль:

```js
$.ready(() => {
    $.dialog.define('guard', {
        start: 'hello',
        nodes: {
            hello: {
                speaker: 'Стражник', portrait: 'art/guard.png',
                text: 'Стой! Кто идёт?',
                choices: [
                    { text: 'Я свой', to: 'pass', if: 'has_pass' },
                    { text: 'Уйти', to: null, do: () => $.store.set('left', true) },
                ],
            },
            pass: { text: 'Проходи.', to: 'bye' },
            bye:  { text: 'Не задерживайся.', to: null },
        },
    });

    $.dialog.play('guard');
    $.dialog.on('end', (e) => $.store.set('talking', false));
});
```

---

## 1. Формат данных

`$.dialog.define(id, spec)`:

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `nodes` | объект | — (обязательно) | реплики: `id → описание` |
| `start` | string | `'start'`, иначе первый ключ `nodes` | с какой реплики начинать |
| `speaker` | string | — | имя говорящего для всех реплик |
| `portrait` | string | — | путь к портрету для всех реплик |
| `speed` | number | 40 | скорость печатной машинки (символов в секунду) |
| `style` | string | — | стиль `$.font` для текста диалога |

Описание реплики (`nodes[id]`):

| Поле | Тип | Смысл |
|---|---|---|
| `text` | string \| string[] \| функция | текст; массив — страницы (`next()` листает), функция вызывается при входе в реплику |
| `speaker` | string | имя говорящего (переводится, если это ключ `$.i18n`) |
| `portrait` | string | путь к портрету |
| `choices` | массив | варианты ответа (§2) |
| `to` | string \| null | куда идти после реплики; `null` — конец диалога |
| `next` | string | то же, что `to`, но слабее: используется, если `to` не задан |
| `if` / `when` | функция \| bool \| string | условие показа реплики; ложь — реплика пропускается, переход по её `to`/`next` |
| `do` / `onEnter` | функция | что выполнить при входе в реплику |
| `speed` | number | своя скорость печати этой реплики |
| `style` | string | свой стиль `$.font` |

Вариант ответа (`choices[i]`):

| Поле | Тип | Смысл |
|---|---|---|
| `text` | string | подпись кнопки (ключ `$.i18n` переводится) |
| `to` | string \| null | куда идти после выбора; `null` или отсутствие — конец диалога |
| `if` / `when` | функция \| bool \| string | условие видимости варианта |
| `do` | функция | что выполнить при выборе |
| `action` | string | метка для события `choice` |

## 2. Условия

`if` понимает три формы:

```js
if: () => $.store.get('level') > 3      // предикат: исключение = ложь + лог
if: true                                 // константа
if: 'has_pass'                           // флаг: $.dialog.flag('has_pass') → $.store.get('has_pass')
```

Строка-флаг ищется сначала среди `$.dialog.flag()`, затем в `$.store`. Условие
на реплике, если оно ложно, **не показывает** её: переход идёт по `to`/`next`
этой же реплики (цепочка пропусков ограничена 32 шагами — на случай цикла).

## 3. Функции `$.dialog`

| Функция | Назначение |
|---|---|
| `$.dialog.define(id, spec)` | объявить диалог |
| `$.dialog.has(id)` | есть ли диалог (`bool`) |
| `$.dialog.list()` | id объявленных диалогов по алфавиту |
| `$.dialog.remove(id)` | забыть диалог; открытый им диалог закрывается (reason `removed`); возвращает `$.dialog` |
| `$.dialog.play(id, nodeId?)` | начать диалог или конкретную реплику; `true`, если реплика открылась |
| `$.dialog.next()` | дальше: допечатать / следующая страница / `to`/`next` / конец |
| `$.dialog.choose(i)` | выбрать вариант по номеру **видимого** списка (с нуля) |
| `$.dialog.chooseByText(text)` | выбрать по подписи (точное совпадение, затем без учёта регистра) |
| `$.dialog.skip()` | допечатать текущую страницу целиком |
| `$.dialog.close()` | закрыть диалог (`end` с reason `manual`) |
| `$.dialog.isOpen()` / `$.dialog.isTyping()` | открыт ли диалог и печатается ли текст прямо сейчас |
| `$.dialog.node()` / `$.dialog.definition()` | id текущей реплики и открытого диалога; вне диалога — `null` |
| `$.dialog.page()` / `$.dialog.pageCount()` | номер страницы (с нуля) и их число; вне диалога — `-1` и `0` |
| `$.dialog.text()` | видимый (напечатанный) текст страницы |
| `$.dialog.fullText()` | полный текст страницы |
| `$.dialog.speaker()` / `$.dialog.portrait()` | имя говорящего и путь к портрету; портрета нет — `null` |
| `$.dialog.choices()` | `[{ index, text, to, action }]` — только видимые; `index` — позиция в исходном массиве |
| `$.dialog.choiceFocus()` / `$.dialog.focusChoice(step)` | подсвеченный вариант и его сдвиг по кругу; без видимых вариантов `focusChoice` возвращает `false` |
| `$.dialog.speed(v)` | скорость печатной машинки: геттер/сеттер |
| `$.dialog.vars(obj)` | параметры подстановки переводов: `{name}`, `{n}` |
| `$.dialog.flag(name, value)` | свой флаг для условий; без значения — снять, без аргументов — все флаги |
| `$.dialog.visibleChoices()` | видимые варианты «как есть» (с `do`); для тестов и агента |
| `$.dialog.panel()` | обёртка панели диалога или `null` |
| `$.dialog.on(name, fn)` / `$.dialog.off(name, fn)` | подписки на события; `off()` без имени снимает все подписки, с именем и без `fn` — все подписки события |
| `$.dialog.listenerCount(name)` | сколько подписчиков (для тестов) |

`play()` с одним аргументом: если имя совпало с объявленным диалогом — играем с
его `start`, иначе это id реплики последнего открытого диалога.

## 4. События

| Событие | Когда | `data` |
|---|---|---|
| `start` | `play()` открыл диалог | `{ definition, node }` |
| `line` | показана реплика или её новая страница | `{ id, text, fullText, page, pages, speaker, portrait, definition }` |
| `typed` | страница допечатана (сама или через `skip()`) | `{ id, text }` |
| `choice` | игрок выбрал вариант | `{ index, text, to, action }` |
| `end` | диалог закончился: `reason` = `'end'` (дошли до конца), `'missing'` (нет реплики), `'skipped'`, `'loop'`, `'manual'` (закрыли), `'restart'`, `'removed'` | `{ reason, definition, node }` |
| `close` | сразу после `end` | то же |

Состояние сбрасывается **до** событий, поэтому обработчик `end` может сразу
начать новый диалог.

## 5. Печатная машинка

* скорость — символов в секунду: у реплики `speed` → у диалога → `$.dialog.speed()`
  (по умолчанию 40);
* текст печатается в `tickDialog(dt)` — его вызывает кадровый цикл `api.js`;
* `skip()` допечатывает страницу, `next()` сначала допечатывает, а следующим
  вызовом идёт дальше (защита от «пролистывания» случайным Enter);
* подсчёт идёт по кодпойнтам, поэтому эмодзи и суррогатные пары не рвутся;
* когда печатать нечего (`text: ''`), событие `typed` приходит сразу.

## 6. Переводы (`$.i18n`)

Текст, имя говорящего и подписи вариантов переводится, **если строка совпала с
ключом словаря** (`$.i18n.has(str)`); иначе строка остаётся как есть:

```js
$.i18n.add('ru', { 'dlg.greet': 'Привет, {name}!' });
$.dialog.define('greet', { nodes: { start: { text: 'dlg.greet', to: null } } });

$.dialog.vars({ name: 'Игрок' });
$.dialog.play('greet');       // «Привет, Игрок!»
```

Подстановка `{name}` — штатная `i18n.tr(key, params)`, поэтому имена параметров
те же, что и в остальном API.

## 6.1. Смена языка при открытом диалоге (§16)

Диалог переводит текст в момент отрисовки, поэтому `$.i18n.lang('en')` во время
реплики перерисовывает её сама: подписка на `$.i18n.onChange` ставится в
`play()` и снимается в `finish()`, так что после закрытия подписок не остаётся
(`$.dialog.langBound()` → false). Печать при этом не перезапускается — игрок уже
прочитал строку. Вручную: `$.dialog.retranslate()`.

## 7. Как выглядит диалог

Модуль сам создаёт узлы интерфейса (на `play()`, уничтожает при закрытии):

| id узла | Тег | Назначение |
|---|---|---|
| `__dialog` | `ui.panel` | панель внизу окна по центру |
| `__dialog_portrait` | `ui.image` | портрет 96×96 слева (скрыт, если портрета нет) |
| `__dialog_speaker` | `ui.label` | имя говорящего |
| `__dialog_line0…3` | `ui.label` | до четырёх строк текста с переносом по словам |
| `__dialog_choice0…5` | `ui.button` | до шести кнопок выбора |

Панель растёт под число видимых вариантов; подсвеченный вариант рисуется
цветом `hoverColor`. Размеры берутся из окна, при смене размера панель
пересчитывается на следующем кадре.

## 8. Клавиатура и мышь

* `↑`/`↓` — подсветка варианта по кругу, `Enter`/`Space` — выбрать подсвеченный
  (а если вариантов нет — следующая реплика);
* `Escape` — закрыть диалог;
* клик мышью по кнопке выбора шлёт обычный `click` (его обрабатывает `ui.js`),
  `tickDialog` только переводит на неё подсветку;
* при `play()` снимается фокус `widgets.js` (`$.ui.blur()`), иначе Enter нажал
  бы и вариант диалога, и узел, оставшийся в фокусе.

## 9. Ограничения

* диалог **не сохраняется**: `save.js` о нём не знает — состояние разговора
  нужно восстанавливать игрой (`$.dialog.play(id, nodeId)` для возврата к реплике);
* текст рисуется максимум четырьмя строками без прокрутки; длинный текст лучше
  резать на страницы массивом;
* анимации портрета нет: спрайт грузится через `setSprite` один раз на реплику;
* функция в `text` вызывается в момент входа в реплику, а не каждый кадр;
* `choose(i)` нумерует **видимые** варианты; исходные индексы отдаёт
  `$.dialog.choices()[i].index`;
* диалог один на процесс: `play()` при открытом диалоге закрывает прежний
  (`end` с reason `'restart'`);
* по умолчанию ввод мира диалог не блокирует глобально — он берёт advisory-токен `$.input.lock('dialog')`, а gameplay-код сам решает, спрашивать ли `$.input.locked()`. `$.dialog.hardLock(true)` включает hard-token: `$.input.down/pressed/released` возвращают `false`, пока диалог открыт (UI читает raw-методы). World mode `cinematic` выставляется автоматически;
* печатную машинку двигает `tickDialog(dt)`: если его не подключить в
  `api.js`, текст просто не будет печататься по кадрам (всё остальное
  работает).

## 10. Проверка

```bash
build/_deps/quickjs-build/qjs tests/js/dialog_test.mjs
python3 tests/agent/highlevel_dialog_test.py    # интеграция, после сборки
```

Покрыто: чистое ветвление и условия (функция/bool/флаг), индексы выборов,
печатная машинка и `skip()`, страницы текста, ветки `to`/`next`/`null`,
`choose`/`chooseByText`, события `start/line/typed/choice/end/close`, перевод
ключей, портрет и имя, пропуск реплики с ложным условием, клавиатура и
раскладка панели.

## 11. VN: RML-вид, темы и narrative state

`$.dialog` остаётся единственной машиной реплик. Presentation вынесена в
`dialog_view.js` (RmlUi) и `dialog_theme.js` (default/custom RML+RCSS, стек тем,
hot reload); подробный контракт — `docs/VN_NARRATIVE.md`.

Новые публичные методы:

| Метод | Назначение |
|---|---|
| `$.dialog.speaker(id, spec)` / `speaker()` / `speakerId()` / `speakerName()` | реестр speaker'ов: внутренний id → отображаемое имя, портреты, voice, textBlip |
| `$.dialog.expression()` / `portrait()` / `portraitSlot()` | expression и слот портрета (`left/center/right/far-left/far-right`) |
| `$.dialog.themeDefine(name, {rml,rcss})` / `theme(name)` / `themePush(name)` / `template(path)` / `hotReload()` / `validateTheme(markup)` | темы и горячая перезагрузка; невалидный reload оставляет прошлый вид |
| `$.dialog.auto(on)` / `action(name)` / `inspect()` | auto-режим, `data-dialog-action` (next/skip/auto/backlog/save/load), снимок для DevTools |
| `$.dialog.backlog()` / `backlogOpen(on)` / `isRead(id)` / `markRead(id)` / `unreadCount()` | backlog и stable line id (`definition:node:page`) |
| `$.dialog.saveState()` / `restore(snapshot)` | сохранение/возврат narrative state |
| `$.dialog.show(text, {speaker,expression,portrait})` | совместимость для cutscene: одна реплика без `define` |

Реплика забирает `$.input.lock('dialog')`; токен освобождается на close/skip
stop/исключении и на смене сцены. `$.dialog.worldMode()` — `live|pause|cinematic`.

Проверка: `tests/js/vn_narrative_test.mjs` (13 проверок, RML-backend без окна).

Дополнительные имена VN-состояния (документированы здесь буквально для
api_docs_sync): `$.dialog.speakerId()`, `$.dialog.speakerName()`,
`$.dialog.speakerIds()`, `$.dialog.portraitSlot()`, `$.dialog.themes()` —
доступ к реестру speaker'ов и списку тем.

`$.dialog.action(name)` выполняет `data-dialog-action`
(`next/skip/auto/backlog/save/load`). `$.dialog.autoDelay(seconds)` — пауза
автолистания. `$.dialog.backlogOpen(on)` открывает/закрывает backlog,
`$.dialog.backlogClear()` очищает историю, `$.dialog.markRead(id)` отмечает
stable line id прочитанным.

`$.dialog.lockHeld()` и `$.dialog.releaseLock(reason)` — диагностика и
аварийное освобождение input-токена (обычно это делает `close()`).
`$.dialog.prefetch(assets)` не только объявляет ассеты сцены, но и реально
греет кэши: `$.sound.preload()` для voice/audio и
`$.resource.preloadTexture()` для портретов; итог — `$.dialog.prefetchInfo()`
(`requested/textures/sounds/failed`). `$.dialog.voice(on|undefined)`,
`voiceVolume(v)`, `voiceInfo()`, `$.dialog.stopVoice(reason)` управляют настоящим
проигрыванием `voice` через `$.sound` (предыдущая реплика глушится, close
останавливает канал). `$.dialog.localize(key, params)` и
`$.dialog.i18nStats()` используют dictionary lookup `$.i18n.lookup()`
(текущий язык → fallback → остальные), а не только проверку `has()`.

`$.dialog.inspect()` дополнен `inputHardLocked`, `choiceSlots`, `voice`,
`prefetch`, `i18n`; DevTools F2 получил вкладку **Narrative**, доступную без
выбранной сущности через `$.devtools.narrative()`. Число кнопок выбора задаёт
тема: `themeDefine(name, {rml, rcss, choiceSlots, choiceTemplate})`, где
`{index}`/`{n}` подставляются в шаблон (1..64 слотов).

`$.dialog.view()` возвращает RML-view, `$.dialog.viewLoaded()` —
загружен ли документ (для DevTools/агента). `$.dialog.view().choiceSlots`
показывает фактическое число слотов.

Проверка новых gap'ов: `tests/js/vn_gaps_test.mjs` (13 проверок),
`tests/agent/vn_bashnya_theme_test.py` (RmlUi-пиксели темы BASHNYA, voice,
prefetch, narrative inspector).
