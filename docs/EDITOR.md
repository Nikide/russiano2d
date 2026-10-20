# Russiano2D Editor

Один бинарник `r2d`: игра, движок, инструменты и редактор. Editor — обычный
проект R2D (`editor/`): интерфейс на RmlUi, логика на публичном `$`, тяжёлые
операции — команды того же `r2d` через мост `$.sdk`. Сцен-редактора нет
(PHILOSOPHY §2): игра остаётся кодом и данными, Editor редактирует и
проверяет обычные файлы проекта.

## 1. Запуск

```bash
./build/r2d                       # Project Manager
./build/r2d edit games/my-game    # сразу открыть проект
./build/r2d --game games/my-game  # запустить игру без редактора
./build/r2d validate games/my-game
```

`src/main.c` разбирает первый аргумент:

| Вызов | Что происходит |
|---|---|
| без аргументов, `edit [проект] [опции]` | `--game <editor> --scene <абсолютный путь проекта>`; опции после проекта идут движку |
| `build --project <dir> …` | нативный билдер (`src/build.c`, [BUILD.md](BUILD.md)) |
| любой другой глагол (`validate`, `lint`, `world`, `assets`, `build <dir> --out`, …) | инструменты (`sdk/native`, список — `r2d commands`), один JSON в stdout |
| `--опции` | игра/движок, как раньше |

Каталог `editor/` ищется рядом с `r2d` и выше по дереву (в репозитории
`build/r2d` → `editor/`). Путь проекта приходит в редактор как `$.startScene`.

## 2. Что умеет (этап 1)

| Часть | Как сделано |
|---|---|
| Project Manager | недавние проекты (`editor/state.local.json`), открыть по пути, создать из шаблона (`r2d templates`, `r2d new`) |
| Дерево проекта | реальные файлы (`r2d assets`), папки сворачиваются, служебные `.r2d-*` не показываются |
| Вкладки | повторное открытие фокусирует вкладку; история назад/вперёд; закрытие несохранённой — со второго нажатия |
| Редактор кода | `editor/lib/code_model.js` + `code_view.js`: виртуальная отрисовка, подсветка JS/JSON/RML/RCSS, выделение мышью и Shift, двойной щелчок — слово, автоотступ, автозакрытие скобок, Tab/Shift+Tab блоком, undo/redo, буфер обмена, поиск в файле, переход к строке, `Cmd/Ctrl+/` — комментарий, `Cmd/Ctrl+D` — следующее вхождение |
| Problems | `r2d lint` при открытии и сохранении `.js`, `r2d validate` проекта; щелчок открывает файл на строке |
| Run/Stop | `r2d --game <проект>` (несохранённое сохраняется), вывод — в Output |
| Build | validate → `r2d build <проект> --out <проект>/dist/<имя>`; ошибки validate останавливают сборку |
| Inspector | проект (`project.json`), файл (язык, строки, состояние, проблемы) и навигация по тексту: `$.scene.add(…)`, `id: …` |
| Изображения | просмотр PNG/JPG с размером |
| VN Maker (`.scene`, `.story`) | вкладка-студия: `sdk/lib/vn_maker.js`, раскладка `editor/ui/vn_maker.rml` по макету — Script (+Dialogue/+Choice/+Jump/+Label/+Background), Preview, Inspector команды, метки/сцены/персонажи/ассеты/темы. Preview — кадр выбранной команды из настоящих ассетов проекта (последний `image`, портрет по эмоции из `speakers.json`, имя, реплика, варианты); Play — runtime `$.story` на весь кадр, Esc — назад; Validate Story — `r2d story validate` в Problems |
| Atlas (`.atlas.json`, PNG без атласа) | студия Editor `editor/studios/atlas.js`: режимы Sprite и Animation одной вкладки и одной истории. Sprite — выбор/рисование/перенос кадра мышью, пивот, сдвиг стрелками, сетка пикселей, зум к курсору, инспектор кадра; Animation — теги (диапазон, direction, loop, длительность), проигрывание путём игры (`$.atlas` → `.frames().animate()`), лента кадров, скорость, шаг. Нарезка — `r2d atlas-grid` во временный файл и одна правка с undo; проверка черновика — `r2d validate`; запись — канонический вывод `atlas_model.js`, нетронутый файл не переписывается |
| Студии данных | Tilemap (`.tilemap.json`), Particles, Collision, Parallax (`.layers.json`), Fonts, Audio, Input — общий хост `sdk/lib/studio_host.js` в исходной разметке; один документ на всех, поэтому открыта одна вкладка этой группы |
| RmlUi (`.rml`, `.rcss`), Re2D World (cells/walls карты) | студии SDK в исходной разметке; Re2D World — «Открыть как» для `.re2dmap` и кнопка Hammer для карт без brushes |
| SpriteMesh (`.atlas.json`) | вкладка-студия: `sdk/tools/sprite-mesh-studio.js`, раскладка `editor/ui/sprite_mesh.rml` — 3D-вид меша (Shaded/Wireframe, ракурсы, вращение мышью), лента кадров с миниатюрами из атласа, теги анимаций и транспорт, Mesh Settings, Save + Bake (`r2d sprite-mesh-bake`), статус cache |
| Re2DSprite (`.character.json`) | студия Editor `editor/studios/re2dsprite.js`: живой персонаж `$.re2dSprite.from` во вьюпорте (протяжка — yaw/pitch, ракурсы, вертушка, anime/pixel), клипы, таймлайн с перемоткой, слои, эмоции, варианты, экипировка по сокетам, видимость частей, кости и сокеты; правка `style`/`projection`/`defaults.motion` → запись `character.json` и `.re2dReload()` |
| Hammer (`.re2dmap`) | студия Editor `editor/studios/hammer.js`, отдельные документ и сессия на вкладку, раскладка `editor/ui/studios/hammer.rml` (тулбар, палитра инструментов, TOP/3D/FRONT/SIDE, инспектор, дерево объектов, VisGroups); правки — native `r2d world-edit`, Validate/Compile/Run Preview, 3D — настоящий runtime-кадр; диагностика — в Problems с переходом к объекту, dirty — на вкладке; material + tags грани откатываются одним шагом, preview помечается устаревшим после правок |

**Открыть как.** Файл открывается основной студией своего типа (`.atlas.json` —
Sprite, `.re2dmap` — Hammer, `.rml` — RmlUi). Палитра команд (`>`) для
активной вкладки предлагает «Открыть как: текст» и другие подходящие студии
(Animation, SpriteMesh, Re2D World); студии сами переходят друг к другу тем же
путём (`app.openTool` → `openWith`).

Горячие клавиши: `Cmd/Ctrl+P` — файл, `Cmd/Ctrl+Shift+P` — команды
(префикс `>`), `:` — строка, `Cmd/Ctrl+S`/`Shift+S` — сохранить/все,
`Cmd/Ctrl+W`, `Cmd/Ctrl+B` — боковая панель, `Cmd/Ctrl+J` — нижняя,
`F5`/`Shift+F5`, `Cmd/Ctrl+Shift+B` — сборка, `Esc` — закрыть палитру/поиск.
Клавиши кода работают только при фокусе на коде: поля ввода получают обычный
текст.

## 3. Чего пока нет (честно)

* макеты Editor есть у Hammer, VN Maker, SpriteMesh и Re2DSprite; остальные
  студии встроены в своей разметке SDK (своя палитра, кнопка «К SDK» скрыта);
* студии данных делят один документ: открыта одна вкладка этой группы;
  Sprite/Animation объединены в Atlas, где у каждой вкладки своя сессия;
* у старых студий SDK остаётся одна сессия на тип; Hammer и Atlas уже
  держат несколько файлов одновременно;
* поиска по проекту (боковая «Search») нет — открывается Quick Open;
* `project.json` v2 (индекс сцен/ролей) не введён;
* линт несохранённого буфера не делается: Problems отражают файл на диске;
* IME-композиция в коде не показывается (ввод — завершённый текст).

* Re2DSprite Studio не компилирует поверхности и не печёт PNG: авторский
  конвейер — `tools/compile_rotsprite.py` / `build_rotsprite_assets.py`.
  Команд `bake-re2d3`/`convert-re2d3`, на которые ссылается
  [RE2DSPRITE_GUIDE.md](RE2DSPRITE_GUIDE.md), в `r2d commands` сейчас нет;
* запись `character.json` переформатирует файл (`JSON.stringify`, 2 пробела).

## 4. Устройство

**Каркас студий** (`editor/lib/studio_kit.js`, реестр `editor/studios/index.js`).
Студия Editor — модуль с `meta` и `create(host)`; экземпляр на вкладку со
своим документом (`$.ui.markup`, разметка `editor/ui/studios/<id>.rml` +
общий `kit.rcss`), поэтому два атласа или две карты открыты одновременно.
Editor сам размещает документ, зовёт `update(dt)` только у активной вкладки,
направляет Cmd/Ctrl+S, Z, Shift+Z, Y в `save/undo/redo` студии (кроме набора
текста — `$.ui.typing()`), собирает `diagnostics()` в Problems и `commands()`
в палитру. Своих `$.update`, горячих клавиш сохранения и кнопок «назад» у
студий нет. Студии SDK, ещё не переписанные под каркас, подключены через
прежний мост `editor/lib/studios.js`.


`editor/main.js` → `createEditor($)` (`editor/app.js`). Чистые модули без
движка: `lib/code_model.js` (буфер, каретка, правки, undo), `lib/highlight.js`
(токенизатор), `lib/fuzzy.js` (нечёткий поиск).

Hammer использует общие `sdk/lib/world_editor/{session,commands,selection,viewport,model,extension_host}.js`; геометрия остаётся в native `r2d world-edit`. Старый `sdk/tools/world-editor.js` — только адаптер к тому же контроллеру. Временные файлы и runtime-узлы preview имеют отдельные имена на сессию. Save/Validate/Compile блокируют параллельные правки своей карты. Ошибка компиляции сохраняет последний корректный файл и runtime preview. Камера preview сохраняет перемещение между кадрами; ввод и позиция sprite учитывают масштаб окна.

Новое в `$` ради Editor:
`$.input.clipboard()/setClipboard()`, псевдонимы `cmd`/`rcmd` по платформе,
`doc.focus(id, on?)` (`engine.ui.focus`), `doc.place(rect)` и `doc.front()`
(`engine.ui.place/front`) — встраивание документа студии в центральную область.
RmlUi отдаёт `src="/abs/path.png"` файловому интерфейсу без ведущего слеша;
`src/gui.cpp` последним вариантом пробует путь с возвращённым `/`, поэтому
документы могут показывать картинки открытого проекта по абсолютному пути.

Студии подключаются в `editor/lib/studios.js`: Editor даёт модулю
`sdk/tools/*.js` тот же объект `app`, что давала оболочка SDK (`backend` →
`r2d <команда>`, `runProject` → Run Editor, `setStatus`, `closeTool`) и, если
нужно, свою раскладку через `app.layouts` с теми же id; `app.projectRoot` —
корень открытого проекта (VN Maker читает `story/…` относительно него). Неактивная вкладка
студии скрыта, а сама студия на паузе (`api.state.active = false`), поэтому её
клавиши не срабатывают из других вкладок; на её вкладке Editor не
перехватывает клавиши, которые студия обрабатывает сама (Cmd/Ctrl+S, Z, Y, F5). Агенту доступна та же поверхность:
`eval("$.editorApp.openFile('main.js')")`.


## 5. Проверка переноса Hammer (2026-10-20)

Сборка: `xmake f -y -p macosx -a arm64 -m release -o build-xmake/macos-arm64`,
`xmake build -y -j 8 r2d`. Бинарник проверок задаётся через `R2D_BINARY`.
`tests/agent/editor_hammer_test.py` — 43 проверки: две карты, параллельные native
операции, общий Undo/Redo, фокус поля, Face, настоящее создание brush мышью,
сохранение, ошибки/Problems, compile/freshness, сохранность последнего output
после ошибки, запуск проекта и освобождение preview при закрытии.
`tests/agent/world_editor_test.py` — 71 проверка совместимости старого SDK.
Линт изменённых скриптов, `r2d validate editor` и четыре стража документации
прошли без ошибок.
Визуальная проверка — снимок настоящего RmlUi из агентского прогона;
ручной интерактивный прогон, HiDPI и другие ОС пока не подтверждены.

Следующий перенос по согласованному порядку: VN Maker → SpriteMesh →
Re2DSprite → студии данных → RmlUi/Re2D World. Старый мост удаляется после
переноса его оставшихся потребителей.
