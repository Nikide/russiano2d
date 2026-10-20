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
| Inspector | проект (`project.json`; для v2 — точка входа и сцены, клик по сцене запускает игру с `--scene`), файл (язык, строки, состояние, проблемы) и навигация по тексту: `$.scene.add(…)`, `id: …` |
| Изображения | просмотр PNG/JPG с размером |
| VN Maker (`.scene`, `.story`) | студия Editor `editor/studios/narrative.js`, отдельные документ и история на вкладку (`ui/studios/narrative.rml`); Script/Source/Preview/Inspector, метки/сцены/персонажи/ассеты/темы/i18n. Save/Undo/Redo — Editor; Play — несохранённый буфер через `$.story`/`$.dialog` без автосохранения, Esc/конец/закрытие — назад; Validate Story — native проверка временного черновика в Problems. Подробности: [VN_MAKER.md](VN_MAKER.md) |
| Atlas (`.atlas.json`, PNG без атласа) | студия Editor `editor/studios/atlas.js`: режимы Sprite и Animation одной вкладки и одной истории. Sprite — выбор/рисование/перенос кадра мышью, пивот, сдвиг стрелками, сетка пикселей, зум к курсору, инспектор кадра; Animation — теги (диапазон, direction, loop, длительность), проигрывание путём игры (`$.atlas` → `.frames().animate()`), лента кадров, скорость, шаг. Нарезка — `r2d atlas-grid` во временный файл и одна правка с undo; проверка черновика — `r2d validate`; запись — канонический вывод `atlas_model.js`, нетронутый файл не переписывается |
| Tilemap (`.tilemap.json`) | студия Editor `editor/studios/tilemap.js` на рабочей области ассета (`editor/lib/asset_workspace.js` + `asset_document.js`, раскладка `ui/studios/asset.rml`), документ и история на вкладку. Настоящий `<tilemap>` во вьюпорте, вписывание, зум колесом, панорама СКМ; кисть/ластик/заливка/прямоугольник/пипетка (ПКМ — пипетка), мазок — одна команда Undo; палитра из PNG тайлсета, слои (добавить/порядок/удалить/размер), сетка, подсветка коллизии через runtime `solidAt`. Save — native `r2d validate` временного черновика, затем запись; отсутствующие необязательные поля не появляются. Террейны/анимации/autotile пока правятся JSON-полями документа |
| Particles (`.particles.json`) | студия Editor `editor/studios/particles.js` на рабочей области ассета: разделы Эмиссия/Движение/Вид/Зона (диапазоны «от–до», gravity x/y), пресеты `$.particles.preset` (имя сохраняется), живой `<particles>` с тем же opts, что в игре — тянуть мышью по окну, Перезапуск/Залп/Эмиссия/Повтор; снизу редактор рамп color/alpha/size: клик — точка, протяжка — одна команда Undo, градиент цвета интерполируется как в рантайме. Save — native validate черновика, затем запись |
| Collision (`.collision.json`) | студия Editor `editor/studios/collision.js`: инструменты Выбор и «+ прямоугольник/круг/капсула/полигон» (клик ставит фигуру в точку), перенос, ручки размера, вершины полигона мышью — одна протяжка = одна команда Undo; шаг сетки 8/16/без, зум к курсору, СКМ — панорама, «Вписать». Физика — настоящие `<wall>/<trigger>/<area>` через `applyShape` игры, «Бросить шар» в Box2D; гравитация мира возвращается при выходе. Save — native validate черновика |
| Parallax (`.layers.json`) | студия Editor `editor/studios/parallax.js`: настоящие слои `$.layers.create` со спрайтами; камера едет протяжкой по фону или автопрокруткой, слои отстают по parallax. Спрайт выбирается и тянется прямо в превью (экранная позиция — по `$.layers.offset` живого узла), протяжка — одна команда Undo; картинки проекта (`r2d assets`) — клик ставит спрайт в центр вида; ряд копий, порядок слоёв, общий оттенок `{color, alpha}`. Save — native validate черновика |
| Fonts (`.fonts.json`) | студия Editor `editor/studios/fonts.js`: образец — каждый стиль настоящим `<text>` через `$.font` (стили и шрифты превью под префиксом вкладки, глобальный `default` не трогается; наследование default → base → стиль как в K.resolve), клик по строке выбирает стиль, колесо — прокрутка; поля стиля, base/font — списком; переименование переписывает base у наследников одной командой; .ttf/.otf проекта (`r2d assets`) — в шрифты файла; цепочка, итог и ширина образца снизу. Save — native validate черновика |
| Audio (`.audio.json`) | студия Editor `editor/studios/audio.js`: микшер — полоса на шину с живой громкостью рантайма (`$.audio.gain`: родители, mute, solo), −/+ громкости, M/S, эффект; шины превью под префиксом вкладки. Переименование шины переписывает parent детей и bus звуков, удаление переподчиняет детей. Транспорт звуков — настоящий `$.audio.play` в шину файла; аудиофайлы проекта (`r2d assets`) — клик создаёт звук. Карта зон: протяжка — сдвиг, угол — размер, каждая — одна команда Undo. Save — native validate черновика |
| Input (`.input.json`) | студия Editor `editor/studios/input.js`: тестер — плитка на действие, подсветка по настоящему `$.input.down(действие)` после `$.input.bind` файла (прежние бинды и deadzone возвращаются при уходе с вкладки и закрытии); клавиши-чипы выбранного действия, добавление по имени или «Назначить нажатием», конфликты общих клавиш подсвечены; переименование сохраняет порядок; мёртвая зона — настройка документа. Save — native validate черновика |
| RmlUi (`.rml`, `.rcss`) | студия Editor `editor/studios/rmlui.js`, документ и общая история на вкладку для `.rml` и подключённых стилей (`ui/studios/rmlui.rml`): дерево элементов, настоящий RmlUi-предпросмотр из черновиков `.r2d-editor-rmlui-*` (ссылки на стили перенаправлены на черновики), выбор кликом по настоящей геометрии (`layoutRect`), инспектор id/class/текста/атрибутов, добавить/копия/выше/ниже/удалить, правка исходника и RCSS. Ошибки разметки блокируют Save; после записи каждый файл проверяет `r2d validate`. Одиночный `.rcss` открывается с документом каталога, который его подключает, иначе — с примером разметки, который не сохраняется |
| SpriteMesh (`.atlas.json`, PNG) | студия Editor `editor/studios/sprite_mesh.js`, отдельные документ, настройки и история на вкладку (`ui/studios/sprite_mesh.rml`); Shaded/Wireframe, ракурсы, лента кадров и теги анимаций. Apply — временный native bake; Save/Undo/Redo — Editor; Save + Bake — `r2d sprite-mesh-bake`, native диагностика — Problems |
| Re2DSprite (`.character.json`) | студия Editor `editor/studios/re2dsprite.js`, документ и история на вкладку (`ui/studios/re2dsprite.rml`): живой персонаж `$.re2dSprite.from` во вьюпорте (протяжка — yaw/pitch, ракурсы, вертушка, anime/pixel), клипы, таймлайн с перемоткой, слои, эмоции, варианты, экипировка по сокетам, видимость частей, кости и сокеты — без правки файла. Правятся описание (style, projection, defaults.motion/expression) и параметры экипировки (socket, pose, offset, rotation, scale); «Сделать умолчанием» пишет текущий клип и копию селекторов эмоции. Несохранённое описание проверяет сам рантайм: превью строится из временного черновика рядом с файлом, отказ рантайма блокирует Save с диагностикой |
| Hammer (`.re2dmap`) | студия Editor `editor/studios/hammer.js`, отдельные документ и сессия на вкладку, раскладка `editor/ui/studios/hammer.rml` (тулбар, палитра инструментов, TOP/3D/FRONT/SIDE, инспектор, дерево объектов, VisGroups); brushes и cells/walls/portals/stairs/slopes/lights — native `r2d world-edit`, общие Validate/Compile/Run Preview, 3D — настоящий runtime-кадр; диагностика — в Problems с переходом к объекту, dirty — на вкладке; material + tags грани откатываются одним шагом, preview помечается устаревшим после правок |

**Открыть как.** Файл открывается основной студией своего типа (`.atlas.json` —
Sprite, `.re2dmap` — Hammer, `.rml` — RmlUi). Палитра команд (`>`) для
активной вкладки предлагает «Открыть как: текст» и другие подходящие студии
(Animation, SpriteMesh); студии сами переходят друг к другу тем же
путём (`app.openTool` → `openWith`).

Горячие клавиши: `Cmd/Ctrl+P` — файл, `Cmd/Ctrl+Shift+P` — команды
(префикс `>`), `:` — строка, `Cmd/Ctrl+S`/`Shift+S` — сохранить/все,
`Cmd/Ctrl+W`, `Cmd/Ctrl+B` — боковая панель, `Cmd/Ctrl+J` — нижняя,
`F5`/`Shift+F5`, `Cmd/Ctrl+Shift+B` — сборка, `Esc` — закрыть палитру/поиск.
Клавиши кода работают только при фокусе на коде: поля ввода получают обычный
текст.

## 3. Чего пока нет (честно)

* модулей `sdk/tools/*.js` Editor больше не загружает: все студии — студии
  Editor с документом и историей на вкладку (`sdk/` остаётся референсом и
  источником общих моделей `sdk/lib`);
* RmlUi-предпросмотр не подсвечивает выбранный элемент поверх документа;
* у студий данных террейны/анимации Tilemap и `effectParams` шины Audio пока
  правятся JSON-полями;
* поиска по проекту (боковая «Search») нет — открывается Quick Open;
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
студий нет.


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

Студии подключаются в `editor/lib/studios.js`: каждой вкладке — свой
экземпляр `create(host)`; `host` даёт `backend` (`r2d <команда>`), `run/stop`,
`status`, `changed`, `openWith`, `typing`, `preview` и `root()` — корень
открытого проекта. Старые id студий SDK ведут к студиям Editor через алиасы.
Неактивная вкладка скрыта, `update(dt)` получает только активная, поэтому
клавиши студии не срабатывают из других вкладок; клавиши из `meta.ownKeys`
(Hammer: F5) Editor на её вкладке не перехватывает. Агенту доступна та же поверхность:
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

Все студии переписаны под `create(host)` с экземпляром на вкладку, последней —
RmlUi (`tests/agent/editor_rmlui_test.py`, 18 проверок). Re2D World объединён с Hammer.


## 6. Перенос VN Maker (2026-10-20)

Narrative входит в `editor/studios/index.js`; прежние `vn-maker` и
`vn-narrative` ведут к нему через алиасы. Старый SDK-мост в Editor больше
не участвует в открытии сцен. Каркас передаёт студии общий fullscreen-preview
и возвращает интерфейс по завершении runtime. `sdk/lib/vn_maker.js` остаётся
адаптером для потребителей старой оболочки; отдельной реализации студии нет.

Проверки переноса VN: `tests/agent/editor_narrative_test.py` — 49 сценариев;
`tests/agent/sdk_gui_entrypoints_test.py` и `editor_hammer_test.py` прошли.
Четыре qjs-набора (`vn_model`, `story`, `vn_narrative`, `vn_gaps`) — 50 тестов.
Xmake-сборка, 15 native story/dialog CLI-проверок, линт изменённых скриптов,
`r2d validate editor` и четыре стража документации прошли. Снимок вкладки:
`build/editor-narrative-tabs.png`; это проверка отрисованного RmlUi, не ручного
ввода с клавиатуры и не проверки других ОС.


## 7. Перенос SpriteMesh (2026-10-20)

`SpriteMesh` входит в native-реестр; `sprite-mesh-studio` — алиас `sprite-mesh`.
Контроллер один: прежняя оболочка SDK использует тонкий адаптер. Ввод и
анимация обновляются только у активной вкладки. Viewport переводится из
пикселей RmlUi в логические координаты окна; колесо работает внутри viewport.

Dirty обозначает правки настроек. Отсутствующий или устаревший производный
cache сам по себе не делает документ несохранённым. Apply создаёт временный
cache с отдельным именем на вкладку и удаляет его после чтения, в том числе
при ошибке или закрытии. Undo/Redo помечают показанный preview устаревшим;
пересобрать его можно командой палитры «SpriteMesh: Bake preview».

Save сначала проверяет native bake на временном файле. Неизменённый atlas с уже включённым SpriteMesh
сохраняет исходные байты; первое Save + Bake включает `re2d.spriteMesh`. Правки настроек записываются в `re2d.spriteMesh`;
ошибка публикации cache откатывает источник, сохраняя dirty. Изменённый извне
atlas не перезаписывается. PNG получает только baked cache: отдельного
формата настроек нет, при повторном открытии используются defaults.

Приёмка: `tests/agent/editor_sprite_mesh_test.py` — 36 проверок: независимые вкладки,
историю, сохранность исходников и cache при ошибках, ручной/покадровый pivot,
ракурс спереди, первое включение SpriteMesh, PNG и закрытие pending preview.
Xmake-сборка, native bake/cache test, 6 qjs-тестов SpriteMesh, полный
`sdk_studios_test.py`, lint, validate Editor и четыре стража документации прошли.
Снимок настоящего RmlUi:
`build/editor-sprite-mesh-tabs.png`. Другие ОС и ручной HiDPI-прогон не проверены.


## 8. Re2D World внутри Hammer (2026-10-20)

Карты с cells/walls открываются в обычной вкладке Hammer. Старое имя
`re2d-world-studio` — алиас Hammer; повторное открытие через алиас сохраняет
вкладку, её историю и preview. Отдельная студия World в Editor удалена из
реестра. Старый standalone-инструмент SDK оставлен для совместимости.

Дерево, Select/Move/Delete/Duplicate, инспектор и TOP/FRONT/SIDE работают с
cells, walls, portals, stairs, slopes и lights. Вертикальные spans клетки
показываются отдельно, под одним id. Поля rect/spans/openings редактируются
в инспекторе; раздел «Re2D World» добавляет объекты, редактирует полный JSON
выбранного объекта (включая произвольные поля), разделяет/объединяет стены.
Join требует одинаковых свойств стен, чтобы не потерять материал и теги.

Все правки проходят существующий native `world-edit` и одну историю карты:
например, Undo отменяет brush, следующий Undo — предшествующую правку cell.
Save/Validate/Compile, диагностика Problems и runtime preview общие. PNG
albedo/normal применяется кнопкой «Материал PNG (только preview)»; этот
эксперимент не записывает назначение материала в авторский файл. Debug/CPU/GPU
и свет используют тот же `$.re2dWorld`. Для клетки начальная камера находится
в первом span. Карты не преобразуются в brushes; cell-картам без `world` и
`regionSize` редактор не добавляет конверт и не меняет native defaults.

Проверка объединения: `tests/agent/editor_hammer_world_test.py` — 43 проверки
живого Editor; `tests/js/sdk_world_editor_elements_test.mjs` — 4 проверки
модели/выделения/видов; `tests/sdk/world_edit_test.c` — 15 native-тестов
с ASan/UBSan. Исходный `editor_hammer_test.py` — 43 проверки без ошибок.
`world_editor_test.py` и `sdk_world_studio_test.py` подтверждают совместимость
старого SDK; xmake-сборка, lint/validate Editor и четыре стража документации прошли. Снимок:
`build/editor-hammer-world.png`. Ручной прогон на других ОС не выполнен.

## project.json v2 в Editor

Editor читает индекс `project.json` v2 ([FORMATS.md](FORMATS.md)): при открытии
проекта открывается `entry`, Inspector показывает `scenes.list` (клик — запуск
с `--scene`), `roles` выбирает студию или текстовый редактор для файла. Команда
палитры «Проект: перевести project.json на v2» вызывает native
`r2d migrate-project --write` и затем `validate`. Приёмка:
`tests/agent/editor_project_v2_test.py` (9 проверок).
