# Russiano2D SDK — AGENTS.md

> Главный архитектурный документ для человека и ИИ-агентов, разрабатывающих R2D SDK.
>
> Если предлагаемое изменение противоречит этому документу — не делать его молча.
> Сначала остановиться, описать противоречие и предложить решение, сохраняющее философию Russiano2D.

---

# 0. Что мы строим

Russiano2D SDK — официальный набор инструментов разработки для Russiano2D.

SDK помогает:

- создавать ассеты;
- редактировать ассеты;
- импортировать данные;
- конвертировать данные;
- компилировать данные;
- проверять данные;
- просматривать данные настоящим runtime R2D;
- запускать и отлаживать игру;
- собирать проект;
- работать с обычным 2D;
- работать с Re2DSprite;
- работать с Re2D World;
- автоматизировать всё это через CLI и агентов.

SDK **не заменяет архитектуру Russiano2D**.

Главная формула:

```text
GAME = CODE + DATA

SDK = R2D APPLICATION + TOOLS FOR CODE + DATA
```

По сути, сам SDK — приложение, сделанное на R2D, то есть «игра на R2D»,
назначение которой — помогать создавать другие игры на R2D.

SDK не владеет игрой.

Закрытие SDK не должно лишать разработчика возможности продолжить работу.

Исходники проекта должны оставаться обычными файлами, пригодными для:

- чтения человеком;
- git diff;
- git merge;
- генерации скриптами;
- генерации ИИ-агентами;
- CI;
- ручного редактирования.

---

# 1. КОНСТИТУЦИЯ SDK

Этот раздел имеет высший приоритет.

## 1.1 AI-FIRST ENGINE AND SDK

Движок и SDK проектируются для равноправной работы человека и ИИ-агента.
SDK MUST предоставлять агенту все возможности текущего агентского интерфейса
R2D и добавлять к ним операции SDK: работу с проектами и файлами, просмотр и
изменение ассетов, импорт, bake, валидацию, сборку, запуск, диагностику и
проверку результата.

Совместимость с движком включает текущие команды и режимы: запуск/headless,
детерминированный `fixed-dt` и seed, `ping`, `frames`, `step`, `state`, `query`,
`inspect`, `profile`, `eval`, `reload`, виртуальные клавиатуру/мышь/текстовый
ввод и screenshot. Высокоуровневые сведения о мире и игровые проверки должны
использовать `$.agent` и общую семантику `$`, а не отдельный SDK-селектор или
дубликат игрового состояния.

Агент должен иметь машинный интерфейс для тех же основных операций, которые
доступны человеку в GUI. Ответы должны быть структурированными и сообщать
фактическое состояние. Для долгих операций нужны наблюдаемые статусы, результат
и диагностика. Ключевые операции должны работать без GUI и поддерживать
детерминированный headless-режим там, где это возможно.

Расширять существующий агентский компонент/модуль SDK разрешается и ожидается.
Это программный компонент SDK, а не ECS-компонент. Не создавать второй,
параллельный агентский стек и не урезать возможности движка в SDK.

Протокол, клиент и tool-only backend для поставляемых SDK-инструментов должны
быть реализованы нативными C-бинарниками согласно §1.4. Агентская
интеграция не должна требовать Python, Node.js или другого внешнего runtime.

Текущий контракт движка описан в [docs/AGENT_API.md](docs/AGENT_API.md) и
высокоуровневом API `$.agent`. Перед проектированием SDK-агента сверить его
возможности с текущим протоколом и сохранить совместимую семантику. Приёмка
агентского слоя SDK включает проверку паритета по каждой команде и режиму из
этого контракта, а также тесты SDK-операций через агентский интерфейс.

## 1.2 Russiano2D остаётся Russiano2D

Нельзя менять архитектуру движка ради удобства SDK.

SDK должен адаптироваться к R2D.

R2D не должен превращаться в другой движок ради SDK.

---

## 1.3 НИКАКОГО ECS

Russiano2D не использует ECS по архитектурной философии.

Запрещено вводить:

```text
Entity
 ├── TransformComponent
 ├── SpriteComponent
 ├── PhysicsComponent
 └── ScriptComponent
```

Запрещено вводить:

```text
Add Component
Remove Component
Component Inspector
Entity Archetype
ECS World
```

если это фактически создаёт вторую архитектуру движка.

Существующая модель Russiano2D:

```js
$('<player>', { id: 'hero' })
    .at(100, 300)
    .size(32, 48)
    .health(100)
    .speed(250)
    .controls('wasd')
    .appendTo($.world);
```

Создание — как HTML.

Поиск — как CSS.

Работа — через wrapper/chaining API `$`.

Эту модель сохранять.

---

## 1.4 ПУБЛИЧНАЯ АРХИТЕКТУРА: C → `$`

Игра и SDK используют `$` как единственный публичный runtime API. Низкоуровневые
вызовы движка не являются вторым игровым API и не должны появляться в коде игры
или SDK.

В текущей реализации есть приватный мост: C регистрирует биндинги `engine.*` в
QuickJS, внутренние модули `$` получают ссылку через `native.js`, а
`bootstrap.js` удаляет `globalThis.engine` до запуска кода игры. Поэтому
публичный поток остаётся **C → `$`**, хотя внутренний путь некоторых операций
проходит через приватные QuickJS-модули. Не описывать и не расширять этот мост
как публичную архитектуру SDK.

Перенос горячих проходов на C ускоряет реализацию, но сам по себе не означает,
что все методы `$` уже реализованы в C или что произвольная игровая логика
должна переноситься в нативный код.

Правила:

- новый игровой и SDK-код использует документированный публичный API `$`;
- если возможность нужна и игре, и SDK, реализовать её как публичную
  возможность `$` в соответствии с философией и стилем R2D; SDK должен
  использовать тот же API, что и игра;
- если возможность нужна только для authoring/tooling, оставить её в API
  инструмента и не добавлять в runtime `$` без игровой необходимости;
- не вызывать `engine.*` напрямую и не делать приватные QuickJS-модули частью
  публичного API;
- покадровые массовые проходы по узлам можно реализовывать в C, если они
  сохраняют наблюдаемое поведение `$` и покрыты сравнением C/JS;
- произвольную пользовательскую игровую логику не переносить в C ради
  предполагаемой скорости;
- перед добавлением обёртки, прохода или подсистемы проверить, не реализованы ли
  они уже в `$` или нативном runtime.

Схема:

```text
GAME / SDK TOOLS → public `$` API → R2D runtime
                              └── hot bulk passes may run in C
```

---

## 1.5 САМ SDK — ПРИЛОЖЕНИЕ НА R2D

SDK должен работать как приложение Russiano2D, построенное на runtime R2D.
Его оболочка, окна, редакторы, DevTools и preview используют существующие
возможности движка и публичный `$`. Весь интерфейс SDK строится на RmlUi.

Не создавать для SDK отдельный игровой runtime, renderer, input stack или
параллельную UI-систему. Если операция нужна и SDK, и игре — предоставить её
через `$` согласно §1.4. Специфические операции инструментов (импорт,
конвертация, bake, сборка) могут оставаться tool-only, но их реализация должна
быть нативным исполняемым C-бинарником. SDK может запускать такой бинарник через
CLI или вызывать его backend; сам интерфейс и preview остаются приложением R2D.

В инструментах SDK запрещены Python, Node.js, Ruby, shell-скрипты и другие
интерпретируемые или отдельные языковые runtime. Не требовать их установки,
не поставлять их как зависимости SDK и не запускать их для выполнения задач
инструментов. Логика оболочки самого SDK остаётся частью приложения R2D и
использует `$`; это не разрешение реализовывать tool-only backend на QuickJS.

SDK не становится владельцем создаваемых игр: проекты и ассеты остаются
обычными файлами и должны работать в runtime без запущенного SDK.

---

## 1.6 ЗАКОН ОБЩЕГО SDK HANDOFF

Каждый агент и каждая сессия, работающие над SDK или этим документом, MUST
использовать общий `SDK_HANDOFF.md` в корне проекта.

- Перед началом работы прочитать `SDK_HANDOFF.md`, затем проверить его ключевые
  утверждения по текущему коду и документации. Handoff помогает продолжить
  работу, но не заменяет код как источник истины.
- Перед завершением сессии обновить handoff: что сделано, какие файлы затронуты,
  что проверено и что не проверялось, известные ограничения и один конкретный
  следующий шаг.
- Писать только подтверждённое текущее состояние; явно отделять реализованное,
  частичное, запланированное и непроверенное.
- Сохранять handoff коротким, пригодным для следующего агента и не превращать
  его в копию этого архитектурного документа.
- Если изменений не было, всё равно обновить дату/состояние сессии и оставить
  актуальный следующий шаг.

`SDK_HANDOFF.md` — общий журнал передачи работы между агентскими сессиями.
Его нельзя удалять или заменять личными handoff-файлами отдельных агентов.

---

# 2. НИКАКОГО UNITY

SDK не должен становиться клоном:

- Unity Editor;
- Godot Editor;
- Unreal Editor.

Особенно запрещено незаметно строить архитектуру:

```text
Scene
  ↓
Entity
  ↓
Components
  ↓
Inspector
```

Russiano2D — code-first/data-first движок.

---

# 3. НЕТ КАНОНИЧЕСКОГО VISUAL SCENE EDITOR

SDK может иметь визуальные специализированные редакторы.

Это НЕ означает появление универсального визуального редактора игры.

Разрешено:

```text
Sprite Editor
Animation Editor
Tilemap Editor
Particle Editor
RmlUi Editor
Re2DSprite Surface Editor
Re2DSprite Rig Editor
Re2D World/BSP Editor
```

Потому что каждый из них редактирует конкретный тип данных.

Не строить:

```text
"перетащи Player на сцену"
"добавь Enemy"
"назначь Script Component"
"собери всю игру мышкой"
```

Код игры остаётся кодом.

---

# 4. UI SDK — ТОЛЬКО RmlUi

Не вводить второй UI framework.

Основной UI SDK:

```text
RmlUi
.rml
.rcss
$.ui.doc(...)
```

**Dear ImGui запрещён в UI движка, SDK и игр**, включая отладочные оверлеи,
инспекторы и внутренние панели. Нельзя добавлять его как временный или
постоянный интерфейс.

В текущей кодовой базе уже есть Dear ImGui debug overlay. Это унаследованный
путь, который противоречит целевой архитектуре: его нужно удалить или заменить
на RmlUi. Не расширять его и не строить на нём новые функции. Аудит должен найти
все точки инициализации, обработки ввода, отрисовки, сборки и документации;
удаление считается завершённым, когда сборка и runtime больше не зависят от
ImGui, а отладочные панели доступны через RmlUi.

Нативная отрисовка допустима только как специализированное содержимое внутри
RmlUi custom-element, а не как самостоятельная UI-система.

Не создавать собственный параллельный retained/immediate GUI framework.

Если RmlUi чего-то не хватает — сначала определить, можно ли корректно расширить существующую интеграцию.

---

# 5. SDK ДОЛЖЕН DOGFOOD'ИТЬ R2D

Если runtime уже умеет показать что-либо, SDK не должен писать вторую реализацию.

Неправильно:

```text
SDK Sprite Renderer
SDK Re2D Renderer
SDK Particle Renderer
SDK World Renderer

отдельно от

Game Renderer
```

Правильно:

```text
                    R2D runtime
                    ↑         ↑
                  GAME       SDK
```

Пример:

```text
Re2DSprite Studio
       ↓
public Re2DSprite API
       ↓
actual Re2DSprite implementation
```

Preview должен максимально соответствовать реальному результату игры.

---

# 6. ПЕРЕД НАПИСАНИЕМ КОДА

Агент НЕ начинает работу с создания новых подсистем.

Сначала:

1. `git status`
2. `git diff`
3. изучить структуру репозитория;
4. найти существующую документацию;
5. найти существующие SDK/tooling эксперименты;
6. найти существующие asset formats;
7. найти существующий `$` API;
8. найти RmlUi integration;
9. найти Re2DSprite;
10. найти Re2D World/BSP;
11. найти build/package tooling;
12. найти hot reload;
13. найти agent protocol;
14. найти существующие тесты;
15. собрать проект;
16. запустить тесты.

Правило:

> EXISTING CODE WINS.

Не создавать вторую реализацию существующей возможности только потому, что её не заметили.

---

# 7. НЕ ВРАТЬ О СОСТОЯНИИ ПРОЕКТА

Документ описывает целевую архитектуру.

Это НЕ означает, что перечисленные здесь возможности уже реализованы.

Агент обязан различать:

```text
IMPLEMENTED
PARTIAL
STUB
PLANNED
NOT STARTED
```

Не писать документацию так, будто planned feature уже существует.

---

# 8. ОБЩАЯ АРХИТЕКТУРА SDK

Целевое дерево:

```text
R2D SDK
│
├── SDK Launcher / Manager (единая точка входа)
│
├── Project / Build Tools
│
├── Asset Browser
│
├── Classic 2D Tools
│   ├── Sprite Studio
│   ├── Sprite Animation Studio
│   ├── Tilemap Studio
│   ├── Particle Studio
│   ├── Collision / Physics Tools
│   ├── Parallax Tools
│   ├── Font / Text Tools
│   ├── Audio Tools
│   ├── Input Tools
│   └── RmlUi Studio
│
├── DevTools
│
└── Re2D Studio
    ├── Re2DSprite Studio
    │   ├── Surface
    │   ├── Material / Atlas
    │   ├── Rig
    │   ├── Animation
    │   ├── Expressions
    │   ├── Variants
    │   └── Sockets / Equipment
    │
    ├── Re2D Baker
    │   ├── GLTF
    │   ├── GLB
    │   ├── OBJ
    │   ├── FBX
    │   └── VRM
    │
    └── Re2D World Studio
        ├── BSP
        ├── Cells
        ├── Height Spans
        ├── Portals
        ├── PVS
        ├── Stairs / Slopes
        └── World Surfaces
```

---

# 9. ЕДИНЫЙ SDK LAUNCHER / MANAGER

В SDK должен быть один launcher для всех компонентов. Он является основной
точкой входа в SDK и одновременно лёгким manager; отдельные launcher'ы для
каждого инструмента не создавать. Единый список позволяет подключать и
обновлять инструменты без дублирования каталога в интерфейсе.

Не превращать launcher в IDE-монстра.

Основные функции:

```text
Projects
Engine Builds
SDK Tools
Templates
Build
Package
Run
Debug
Documentation
```

Launcher читает корневой `sdk_tools.json` и строит по нему список всех
запускаемых компонентов SDK. Название и описание показываются в каталоге,
`last_updated` — дата и время последнего обновления компонента. Launcher не
должен содержать отдельный зашитый список инструментов.

Формат записи:

```json
{
  "schema_version": 1,
  "tools": [
    {
      "id": "world-studio",
      "name": "Re2D World Studio",
      "description": "Редактор BSP, cells, height spans и portals.",
      "last_updated": "2026-10-08T17:00:00+03:00",
      "entry": "world-studio"
    }
  ]
}
```

`id` стабилен и используется для маршрутизации; `entry` указывает экран или
компонент приложения R2D, который нужно открыть. `last_updated` MUST быть
датой/временем ISO 8601 с часовым поясом. Для C backend-инструмента запись
может дополнительно содержать относительный путь к его нативному бинарнику.
Внешние интерпретаторы и скриптовые runtime запрещены (§1.5).

Приёмка launcher:

- каждый доступный SDK-компонент перечислен в `sdk_tools.json` ровно один раз;
- launcher загружает каталог из файла, показывает name, description и
  last_updated и открывает компонент по `entry`;
- добавление или обновление компонента не требует дублировать его описание в
  коде launcher;
- неверная версия схемы или некорректная запись показывается как структурная
  диагностика, а не приводит к молчаливому пропуску компонента.

Пример:

```text
┌──────────────────────────────────────────────────┐
│ Russiano2D SDK                                   │
├─────────────┬────────────────────────────────────┤
│ Projects    │ my-game                            │
│ Tools       │                                    │
│ Builds      │ Engine: current                    │
│ Templates   │ Target: Desktop                    │
│ Docs        │                                    │
│             │ [ Run ] [ Debug ] [ Build ]        │
│             │                                    │
│             │ Recent assets                      │
│             │ hero.character.json                │
│             │ world.re2dmap                      │
└─────────────┴────────────────────────────────────┘
```

Launcher/Manager не должен хранить скрытое каноническое представление игры.

---

# 10. ASSET BROWSER

Asset Browser показывает реальную файловую структуру проекта.

Пример:

```text
assets/
├── sprites/
├── animations/
├── tiles/
├── characters/
├── worlds/
├── particles/
├── audio/
└── ui/
```

Он должен понимать известные asset types.

Пример:

```text
hero.character.json
    → Open Re2DSprite Studio

menu.rml
    → Open RmlUi Studio

level.re2dmap
    → Open Re2D World Studio

hero.anim.json
    → Open Animation Studio
```

Не создавать opaque asset database без крайней необходимости.

---

# 11. CLASSIC 2D FIRST

Re2D не должен вытеснить обычный 2D.

Russiano2D остаётся полноценным обычным 2D engine.

SDK обязан иметь хорошие инструменты для него.

---

# 12. SPRITE STUDIO

Цель:

```text
hero.png
   ↓
crop
regions
pivot
origin
metadata
   ↓
sprite data
```

Функции:

- preview;
- crop;
- pivot;
- origin;
- regions;
- pixel grid;
- nearest preview;
- metadata;
- validation.

Не придумывать новый sprite format, если существующий формат уже решает задачу.

---

# 13. SPRITE ANIMATION STUDIO

Timeline для обычных sprite animations.

Пример:

```text
spritesheet.png

idle:
[0][1][2][3]

walk:
[4][5][6][7][8][9]
```

Нужны:

- frame selection;
- frame duration;
- loop;
- events, если runtime их поддерживает;
- preview;
- playback speed;
- validation.

---

# 14. TILEMAP STUDIO

Визуальный tilemap editor разрешён.

Он редактирует tilemap asset, а не всю игру.

Функции:

- tileset;
- layers;
- autotile;
- collision;
- metadata;
- painting;
- selection;
- fill;
- undo/redo;
- preview.

---

# 15. PARTICLE STUDIO

Редактор параметров существующей particle system.

Preview выполняется настоящей particle system R2D.

Не создавать отдельный SDK particle renderer.

---

# 16. COLLISION / PHYSICS TOOLS

Инструменты могут визуально создавать и проверять:

- rectangles;
- circles;
- polygons;
- sensors;
- one-way surfaces;
- collision metadata.

Не создавать новую physics engine.

Box2D остаётся физической системой R2D.

---

# 17. RmlUi STUDIO

RmlUi Studio редактирует:

```text
.rml
.rcss
```

Желательный layout:

```text
┌──────────────┬───────────────────┬──────────────┐
│ RML tree     │ Preview           │ Properties   │
│              │                   │              │
│ body         │                   │ id           │
│ ├ header     │      START        │ class        │
│ ├ menu       │                   │ attributes   │
│ └ footer     │                   │              │
├──────────────┴───────────────────┴──────────────┤
│ RCSS                                             │
└──────────────────────────────────────────────────┘
```

Но файлы остаются обычными `.rml` и `.rcss`.

---

# 18. DEVTOOLS

DevTools — inspector/debugger.

Не scene authoring environment.

Должны использовать существующую семантику `$`.

Пример:

```text
#hero

tag: player
position: 381, 290
health: 72
state: run
physics: body #17
```

Поиск:

```js
$('#hero')
$('.enemy:alive')
$('[hp<20]')
```

Человек, игра и агент должны по возможности видеть мир через одинаковые понятия.

---

# 19. Re2D STUDIO

Re2D Studio — специализированный набор инструментов для Re2D.

Он не превращает R2D в 3D engine.

Основная формула Re2D:

```text
SPATIAL DESCRIPTION
        ↓
     PROJECTION
        ↓
ORDINARY 2D REPRESENTATION
```

---

# 20. Re2DSprite STUDIO

Основные вкладки:

```text
Surface
Material
Atlas
Rig
Animation
Expressions
Variants
Sockets
Equipment
```

Preview выполняется существующим Re2DSprite runtime.

---

# 21. SURFACE STUDIO

Нужны debug modes:

```text
Final
Material
Part ID
X
Y
Z
Depth
Coverage
Owner
Occlusion
```

Нужны:

```text
Yaw    -180 ... +180
Pitch   -75 ...  +75
```

Пользователь должен быстро находить:

- holes;
- wrong XYZ;
- wrong ownership;
- seams;
- missing back surfaces;
- depth errors;
- coverage errors.

---

# 22. RIG STUDIO

Это НЕ ECS component editor.

Он редактирует конкретный Re2DSprite rig asset.

Пример:

```text
root
└── pelvis
    ├── torso
    │   ├── head
    │   ├── arm.L
    │   │   └── forearm.L
    │   └── arm.R
    ├── thigh.L
    └── thigh.R
```

Редактируются:

- bone hierarchy;
- pivots;
- bind transforms;
- part ownership;
- limits, если формат их поддерживает.

---

# 23. Re2D ANIMATION STUDIO

Timeline для существующего Re2DSprite animation format.

Пример:

```text
             0       .5       1.0
head.y     ──●────────●────────●──
arm.L.z    ──●────●────────────●──
leg.L.x    ──●────────●────────●──
```

Не создавать второй animation runtime.

---

# 24. EXPRESSION STUDIO

Пример:

```text
eyes
├── open
├── half
├── closed
└── happy

mouth
├── closed
├── open
├── smile
└── talk

brows
├── neutral
├── angry
├── sad
└── surprised
```

Preview должен использовать реальную expression/emotion систему Re2DSprite.

---

# 25. VARIANTS

Пример:

```text
Costume
├── default
├── police
├── school
└── military

Hair
├── long
├── short
└── ponytail
```

Не создавать параллельную систему variants.

Использовать существующую модель Re2DSprite.

---

# 26. SOCKET / EQUIPMENT STUDIO

Визуальное редактирование:

```text
hand.R
└── weapon

back
└── backpack

head
└── hat
```

Preview должен соответствовать существующим:

```text
re2dAttach
re2dDetach
equip
```

Редактор помогает выставлять grip/socket transforms.

Runtime API остаётся источником истины.

---

# 27. Re2D BAKER

Re2D Baker — одна из центральных частей SDK.

Проблема:

ручное создание сложной Re2D surface/atlas структуры слишком дорого и сложно для большинства пользователей.

Решение:

```text
3D AUTHORING ASSET
        ↓
    Re2D Baker
        ↓
NATIVE Re2D ASSET
```

---

# 28. ГЛАВНЫЙ ЗАКОН BAKER

3D разрешён на этапе authoring/import.

3D НЕ становится runtime архитектурой Russiano2D.

Правильно:

```text
GLB / GLTF / FBX / OBJ / VRM
              ↓
      temporary importer
              ↓
            BAKE
              ↓
       Re2D representation
              ↓
           runtime
```

Неправильно:

```text
GLB
 ↓
MeshRenderer
 ↓
runtime 3D model
```

Запрещено использовать Baker как повод добавить:

```text
MeshRenderer
MeshComponent
3D Scene Graph
general-purpose 3D physics
generic triangle world renderer
```

---

# 29. ПОДДЕРЖИВАЕМЫЕ IMPORT SOURCES

Целевые форматы:

```text
GLTF
GLB
OBJ
FBX
VRM
```

Реализация может добавлять их постепенно.

Не блокировать весь Baker ради поддержки всех форматов в первой версии.

Рекомендуемый первый формат:

```text
GLB / GLTF
```

VRM имеет высокий приоритет для Character workflow.

---

# 30. BAKER PRESETS

Целевые presets:

```text
Prop
Character
Weapon
Environment Piece
```

Начинать желательно с `Prop`.

Он требует меньше автоматического rig conversion.

---

# 31. PROP BAKE

Пример:

```text
crate.glb
    ↓
Re2D Baker
    ↓
crate.material.png
crate.surface.json
crate.character.json
    ↓
compile
    ↓
native Re2D asset
```

Типичные assets:

```text
chair
crate
barrel
lamp
weapon
tree
furniture
machine
```

---

# 32. SURFACE BAKE

Исходная mesh поверхность рассматривается только как источник данных.

Концептуально:

```text
M = vertices + triangles + UV + materials
```

преобразуется в поле:

```text
S(u,v) = {
    x,
    y,
    z,
    part,
    coverage,
    material
}
```

После bake runtime mesh больше не нужен.

---

# 33. UV MODES

Целевые режимы:

```text
Use Existing UV
Auto Unwrap
Re2D Optimized
```

## Existing UV

Использовать существующую UV-развёртку, когда она пригодна.

## Auto Unwrap

Автоматически создать техническую развёртку.

## Re2D Optimized

Распределить atlas budget с учётом:

- surface area;
- semantic importance;
- part importance;
- expected projection quality.

Не обещать идеальный auto unwrap без тестов.

---

# 34. COORDINATE FIT

Baker должен проверять, помещается ли asset в допустимый диапазон Re2D representation.

UI:

```text
RE2D Coordinate Fit

X   [...]   ✓
Y   [...]   ✓
Z   [...]   ✓

Scale: ...
Origin: Feet

[ Auto Fit ]
```

Для персонажей `Origin: Feet` должен быть удобным вариантом.

---

# 35. CHARACTER BAKE

Character conversion:

```text
source mesh
source skeleton
source skinning
source materials
source expressions
        ↓
      Baker
        ↓
Re2D surfaces
Re2D parts
Re2D rig
Re2D expressions
Re2D materials
```

Не сохранять исходный character runtime как обычный skinned 3D mesh.

---

# 36. SKIN WEIGHT CONVERSION

Если исходная модель использует blended skin weights, а текущий Re2DSprite использует ownership по part/bone, Baker должен выполнять явную конвертацию.

Базовая стратегия может использовать dominant bone:

```text
owner(sample) = bone with maximum weight
```

Но неоднозначные области должны попадать в diagnostics.

Пример:

```text
SKIN CONVERSION

Clean ownership       87.4%
Ambiguous             11.8%
Unassigned             0.8%

⚠ shoulder.L contains mixed ownership
```

Пользователь должен иметь возможность исправить Part ID вручную.

---

# 37. VRM — FIRST-CLASS CHARACTER IMPORT

VRM должен рассматриваться как важный формат персонажей.

Целевой workflow:

```text
VRoid
  ↓
VRM
  ↓
Re2D Baker
  ↓
Auto Re2D Character
  ↓
Surface / Rig correction
  ↓
Re2DSprite
```

Маппинг:

```text
VRM                       Re2D

Humanoid bones    ───→    Re2D Rig
Head / Neck       ───→    Re2D bones
Expressions       ───→    Expressions
Materials         ───→    Material atlas
Mesh surfaces     ───→    XYZ / coverage
Skin weights      ───→    Part ownership
Accessories       ───→    Parts / sockets
```

Автоматический результат считается стартовой точкой.

Не обещать perfect one-click conversion.

---

# 38. AUTO Re2D CHARACTER

Целевая функция:

```text
[ Auto Re2D Character ]
```

Она пытается автоматически определить:

```text
head
hair.*
torso

upperArm.L
forearm.L
hand.L

upperArm.R
forearm.R
hand.R

thigh.L
shin.L
foot.L

thigh.R
shin.R
foot.R

clothes.*
accessories.*
```

После auto conversion пользователь открывает Surface/Rig Studio и исправляет результат.

---

# 39. SOURCE vs Re2D COMPARISON

Baker должен уметь сравнивать временный исходный source preview и настоящий Re2D runtime preview.

Пример:

```text
SOURCE                 Re2D

0°                      0°
45°                    45°
90°                    90°
135°                  135°
180°                  180°
```

Также pitch samples:

```text
-45
-20
0
+20
+45
```

Важно:

правая сторона — настоящий Re2DSprite output.

Не отдельная approximation внутри Baker.

---

# 40. IMAGE DIFFERENCE

Допускается диагностическая метрика вида:

```text
difference(sourceProjection, re2dProjection)
```

Она нужна для поиска:

- missing surfaces;
- seams;
- gross projection errors;
- bad ownership;
- holes.

Она НЕ означает:

> Re2D обязан выглядеть идентично 3D renderer.

Re2D — собственная технология представления.

---

# 41. BAKE REPORT

Каждый bake должен уметь выдавать структурированный отчёт.

Пример:

```text
RE2D BAKE REPORT

Geometry
✓ coordinate ranges valid
✓ 14 parts
✓ coverage valid
✓ IDs valid

Surface
✓ front complete
⚠ underside missing samples
⚠ hair back low coverage

Rig
✓ 17 bones
⚠ shoulder.L ambiguous ownership

Projection
0°      ✓
45°     ✓
90°     ✓
135°    ⚠
180°    ✓

Atlas
73.2% usage
```

Diagnostics должны иметь стабильные machine-readable codes.

Например:

```json
{
  "severity": "warning",
  "code": "RE2D_BAKE_AMBIGUOUS_SKIN",
  "part": "shoulder.L"
}
```

---

# 42. BAKER CLI

GUI не должен быть единственным способом.

CLI и backend Baker поставляются как нативный C-бинарник. Их выполнение не
должно требовать Python, Node.js, shell-скрипта или другого внешнего runtime.

Целевой CLI:

```bash
r2d bake-re2d crate.glb \
    --type prop \
    --output assets/crate/
```

Character:

```bash
r2d bake-re2d russi.vrm \
    --type character \
    --preset vrm \
    --output assets/russi/
```

CLI должен иметь machine-readable output.

Например:

```json
{
  "success": true,
  "parts": 17,
  "warnings": 2,
  "errors": 0,
  "atlasUsage": 0.73
}
```

GUI и CLI должны использовать одну underlying implementation на C: GUI может
вызывать её через C API, а CLI — через тот же код из C-бинарника.

Не писать Baker дважды.

---

# 43. BATCH BAKER

Целевой workflow:

```text
source/props/

chair.glb
barrel.glb
crate.glb
lamp.glb
...
      ↓
Batch Bake
      ↓
187 OK
11 warnings
2 failed
```

После batch пользователь открывает только проблемные assets.

Поддерживать CI-friendly режим.

---

# 44. Re2D WORLD STUDIO

Re2D World Studio — специализированный редактор world/map data.

Он НЕ является универсальным Scene Editor.

Он работает с:

```text
2D BSP
height spans
cells
portals
PVS
walls
floors
ceilings
stairs
slopes
specialized world surfaces
```

### Визуальное направление

Редактор должен выглядеть и ощущаться как **прокаченный BSP/world editor,
вдохновлённый Valve Hammer Editor**, но не быть его чистой копией. Брать за
ориентир плотную рабочую компоновку Hammer и прямое редактирование геометрии;
создать собственный интерфейс, термины и workflows, основанные на модели мира
R2D.

Целевая рабочая поверхность должна объединять:

- несколько синхронизированных видов карты: план и необходимые ортографические
  разрезы/высотные виды;
- отдельный preview с фактической Re2D-проекцией и запуском в настоящем R2D
  runtime;
- инструменты стен, split/join, spans, portals, stairs и slopes;
- дерево данных именно world/map (cells, spans, portals, surfaces), панель
  свойств выбранных world-данных и браузер поверхностей/материалов;
- видимые compile/validation diagnostics с переходом к проблемной геометрии;
- быстрые команды редактирования, undo/redo, hotkeys и agent-accessible
  операции.

Прокаченность должна идти из R2D-специфики: высотных spans и room-over-room,
portal/PVS diagnostics, живой сверки с runtime, воспроизводимой компиляции и
управления агентом. Не копировать Hammer один-в-один, его графику, тексты,
брендинг или точную раскладку панелей. Это специализированный world/BSP editor,
не универсальный редактор игровых сцен и не ECS inspector.

---

# 45. Re2D WORLD PHILOSOPHY

Re2D World не является обычным 3D world renderer.

Формула:

```text
RE2D WORLD DATA
      ↓
2D BSP + HEIGHT
      ↓
VISIBILITY
      ↓
RE2D PROJECTION
      ↓
2D FRAME
      ↓
NORMAL R2D PIPELINE
```

BSP остаётся двумерным по карте.

Высота хранится отдельно через spans.

---

# 46. WORLD CELL

Концептуальная структура:

```text
Re2DCell
    polygon2D
    spans[]
    surfaces[]
    portals[]
    entities[]
```

`entities[]` здесь означает существующие R2D nodes/objects, а НЕ ECS entities.

---

# 47. HEIGHT SPAN

```text
VerticalSpan
    bottom
    top
    floorSurface
    ceilingSurface
```

Один XY-регион может иметь несколько spans.

Это необходимо для:

- room over room;
- bridges;
- tunnels;
- balconies;
- multiple floors.

---

# 48. PORTALS

Концептуально:

```text
Portal
    wallSegment
    cellA
    cellB
    verticalOpenings[]
```

Одна XY-граница может иметь разные openings на разных высотах.

---

# 49. WORLD STUDIO UI

Инструменты:

```text
Draw wall
Split
Join
Create span
Set floor height
Set ceiling height
Create portal
Create stairs
Create slope
Surface properties
Compile BSP
Validate
Preview
```

Но НЕ:

```text
Add Player Component
Add Enemy Component
Attach Script Component
```

Gameplay остаётся кодом.

---

# 50. WORLD COMPILER

Целевой pipeline:

```text
editable world source
        ↓
geometry validation
        ↓
2D BSP build
        ↓
height spans
        ↓
portal generation
        ↓
PVS
        ↓
collision data
        ↓
runtime world
```

Автор не редактирует BSP tree вручную.

Он редактирует понятное source representation.

---

# 51. TOOL / RUNTIME BOUNDARY

Очень важно разделять:

## Runtime capabilities

То, что необходимо игре:

```text
rendering
Re2DSprite projection
Re2D World
physics
animation
audio
UI
queries
runtime asset loading
```

## Tool-only capabilities

То, что нужно SDK:

```text
filesystem browsing
file dialogs
import
FBX/GLTF/VRM parsing
baking
build orchestration
project management
undo/redo
asset validation UI
source comparison
batch conversion
```

Не тащить tool-only dependencies в game runtime без необходимости.

---

# 52. PUBLIC API RULE

Если SDK требует возможность, которая полезна самой игре, сначала подумать:

> Это missing public R2D capability?

Если возможность нужна и игре, и SDK — да: спроектировать её в философии R2D
и добавить в публичный `$` API. SDK должен вызывать этот общий API, а не иметь
собственную runtime-реализацию или частный нативный обход.

Если возможность нужна только authoring tool, оставить её tool-only и не
загружать её зависимости в game runtime без необходимости.

Не создавать секретный второй runtime API только для SDK.

---

# 53. HOT RELOAD

Где возможно, SDK должен использовать существующий hot reload.

Типичный цикл:

```text
edit
 ↓
save
 ↓
runtime notices change
 ↓
reload
 ↓
preview
```

Не создавать отдельный reload mechanism, если существующий уже подходит.

---

# 54. UNDO / REDO

Каждый визуальный authoring tool должен проектироваться с command-based undo/redo.

Концептуально:

```text
Command
    apply()
    undo()
```

Но это внутренность SDK, не архитектура game entities.

Желательно:

```text
Ctrl+Z
Ctrl+Shift+Z / Ctrl+Y
```

Не писать изменения на диск на каждый mouse movement без необходимости.

---

# 55. AUTOSAVE

Autosave не должен разрушать исходный asset.

Предпочтительно:

```text
working state
    ↓
autosave/recovery
```

и отдельный явный:

```text
Save
```

После crash SDK должен по возможности предложить recovery.

---

# 56. VALIDATION

Все editors должны уметь валидировать данные.

Общая модель:

```text
INFO
WARNING
ERROR
FATAL
```

Diagnostics должны содержать:

```text
code
severity
asset
location
message
structured details
```

Пример:

```json
{
  "code": "RE2D_INVALID_PART_ID",
  "severity": "error",
  "asset": "russi",
  "sample": [132, 48],
  "partId": 255
}
```

Это важно и для человека, и для агента.

---

# 57. HUMAN AND AGENT ARE EQUAL CLIENTS

Если операция существует только как мышиная кнопка, спросить:

> Может ли её вызвать агент?

Желательно:

```text
GUI
 ↓
tool API
 ↑
CLI / agent
```

Например:

```text
Bake button
      ↓
Re2DBaker API
      ↑
r2d bake-re2d
```

Не нужно превращать каждое движение мыши в публичный API.

Но основные операции должны автоматизироваться. Расширять существующий
агентский компонент/модуль SDK разрешается; для этой работы не создавать
параллельный agent stack. GUI и агент должны вызывать одну реализацию
инструментальных операций.

---

# 58. FILE FORMATS

Предпочитать:

- JSON;
- `sdk_tools.json` — реестр компонентов единого SDK launcher;
- PNG;
- JS;
- RML;
- RCSS;
- существующие R2D formats.

Не создавать opaque binary authoring format без необходимости.

Compiled runtime formats могут быть binary, если это оправдано производительностью.

Но editable source должен оставаться доступным и проверяемым.

---

# 59. ПРЕДЛАГАЕМАЯ СТРУКТУРА РЕПОЗИТОРИЯ

Не применять механически.

Сначала проверить существующий repository layout.

Концептуально:

```text
sdk/
├── app/
│   ├── manager/
│   ├── asset_browser/
│   └── devtools/
│
├── tools/
│   ├── sprite/
│   ├── animation/
│   ├── tilemap/
│   ├── particles/
│   ├── physics/
│   ├── rmlui/
│   │
│   └── re2d/
│       ├── surface/
│       ├── rig/
│       ├── animation/
│       ├── expressions/
│       ├── equipment/
│       ├── baker/
│       └── world/
│
├── core/
│   ├── commands/
│   ├── diagnostics/
│   ├── filesystem/
│   ├── projects/
│   └── tool_api/
│
├── ui/
│   ├── rml/
│   └── rcss/
│
├── tests/
└── docs/
```

Но:

> EXISTING REPOSITORY STRUCTURE WINS.

Не делать массовый refactor ради красивого дерева.

---

# 60. ПОРЯДОК РАЗРАБОТКИ

Не пытаться написать весь SDK одним огромным коммитом.

## Phase 0 — Audit

Обязательно.

- inspect repository;
- build;
- tests;
- docs;
- APIs;
- formats;
- current Work/Claude changes;
- RmlUi;
- Re2DSprite;
- Re2D World;
- existing tooling.

Результат:

```text
SDK_AUDIT.md
```

с таблицей:

```text
Subsystem | State | Reusable | Missing | Risks
```

---

# 61. Phase 1 — SDK Shell

Минимальный SDK:

```text
RmlUi shell
Project selection
Asset Browser
Tool registry
Open asset
Run game
Build game
Documentation
Diagnostics panel
```

Никакого Scene Editor.

Acceptance:

- SDK запускается;
- открывает R2D project;
- показывает файлы;
- может запустить игру;
- может открыть хотя бы один специализированный tool;
- UI только RmlUi.

---

# 62. Phase 2 — Classic 2D Vertical Slice

Сделать один полностью рабочий classic 2D workflow.

Рекомендуется:

```text
PNG
 ↓
Sprite Studio
 ↓
animation
 ↓
save
 ↓
hot reload
 ↓
actual R2D preview/game
```

Acceptance:

- обычный 2D asset можно создать/изменить;
- данные читаются без SDK;
- git diff осмысленный;
- preview соответствует runtime.

---

# 63. Phase 3 — Re2DSprite Studio

Сначала:

```text
load
preview
yaw/pitch
debug views
surface inspection
validation
save
hot reload
```

Потом:

```text
rig
animation
expressions
variants
equipment
```

Acceptance:

- существующий Re2DSprite asset открывается;
- SDK не меняет его semantics;
- preview идёт через реальный runtime;
- invalid asset выдаёт diagnostics.

---

# 64. Phase 4 — Re2D Baker MVP

Начать с:

```text
GLB/GLTF
+
Prop
```

Pipeline:

```text
GLB
 ↓
parse
 ↓
normalize
 ↓
surface sampling
 ↓
material
XYZ
part
coverage
 ↓
Re2D source
 ↓
compile
 ↓
runtime preview
```

Acceptance:

- несколько реальных low-poly props проходят pipeline;
- source 3D не требуется runtime;
- полученный asset вращается Re2DSprite;
- diagnostics структурированы;
- CLI и GUI используют один baker.

---

# 65. Phase 5 — Character / VRM

Добавить:

```text
VRM import
humanoid mapping
skin ownership conversion
expressions
material conversion
Auto Re2D Character
```

Acceptance:

- реальный VRM импортируется;
- skeleton mapping видим пользователю;
- ambiguous skinning показывается;
- результат редактируется Re2DSprite tools;
- runtime не загружает VRM.

---

# 66. Phase 6 — Re2D World Studio

Не начинать, пока Re2D World runtime architecture нестабильна.

Добавить:

```text
2D map editing
walls
cells
height spans
portals
stairs
slopes
compile
validation
preview
```

Acceptance test ОБЯЗАТЕЛЬНО включает:

```text
two walkable spans
same XY
different heights
```

И проверяет room-over-room.

---

# 67. Phase 7 — Automation / Batch

Добавить:

```text
batch baker
headless validation
CI integration
machine-readable reports
agent operations
```

---

# 68. ТЕСТЫ

Каждая subsystem должна иметь тесты там, где это разумно.

Особенно:

```text
serialization roundtrip
validation
import
bake
coordinate conversion
rig mapping
world compile
BSP
height spans
portals
CLI
```

Golden image tests допустимы для projection/rendering, если они детерминированы.

---

# 69. PERFORMANCE

Не писать:

> "быстро"

без измерения.

Не писать:

> "поддерживает тысячи..."

без benchmark.

SDK может быть тяжелее runtime, но interactive tools должны оставаться отзывчивыми.

Любая performance claim должна подтверждаться измерением.

---

# 70. НЕ ОПТИМИЗИРОВАТЬ РАНЬШЕ ВРЕМЕНИ

Сначала:

```text
correct
testable
understandable
```

потом:

```text
fast
```

Не переписывать существующую архитектуру ради гипотетического ускорения.

---

# 71. COMPATIBILITY

Старые рабочие проекты нельзя ломать без необходимости.

Если меняется asset format:

- version it;
- migration;
- backwards compatibility, где разумно;
- понятная ошибка, где migration невозможна.

---

# 72. ERROR UX

Ошибка должна отвечать:

```text
WHAT
WHERE
WHY
HOW TO FIX
```

Плохо:

```text
Invalid asset
```

Хорошо:

```text
RE2D_INVALID_PART_ID

russi.png
sample (184, 52)

Part ID 255 cannot be used for an active Re2D surface.

Expected: 1..254
Found: 255
```

---

# 73. НЕ ПРЯТАТЬ СЛОЖНОСТЬ ЛОЖЬЮ

Если Baker не может корректно конвертировать asset автоматически:

не делать вид, что всё успешно.

Показать:

```text
warning
problem area
reason
manual correction path
```

Auto tools должны ускорять работу, а не скрывать ошибки.

---

# 74. НЕ ДЕЛАТЬ Re2D ОБЫЧНЫМ 3D

Особенно внимательно следить за терминологией.

Нельзя постепенно получить:

```text
3D mesh
3D materials
3D scene
3D physics
3D renderer
```

и назвать всё это Re2D.

Re2D использует пространственные данные ради синтеза 2D representation.

Финальный runtime pipeline должен сохранять эту идею.

---

# 75. НЕ ДЕЛАТЬ Re2D "2.5D"

В пользовательской терминологии проекта использовать:

```text
Re2D
Re2DSprite
Re2D World
```

Не пытаться объяснять архитектуру как обычный "2.5D engine", если это искажает модель проекта.

---

# 76. ЧТО ДЕЛАТЬ ПРИ СОМНЕНИИ

Перед созданием новой subsystem спросить:

1. Уже есть такая возможность?
2. Можно расширить существующую?
3. Это runtime или tooling?
4. Это действительно нужно игре?
5. Не вводит ли это ECS?
6. Не создаёт ли это второй UI framework?
7. Не создаёт ли это второй renderer?
8. Не превращает ли SDK в canonical Scene Editor?
9. Не превращает ли Re2D в обычный 3D engine?
10. Может ли результат оставаться обычным code/data asset?
11. Сможет ли этим воспользоваться агент?
12. Можно ли нормально протестировать результат?

Если ответ вызывает архитектурное сомнение — остановиться и описать его.

---

# 77. DEFINITION OF DONE ДЛЯ SDK FEATURE

Feature не считается законченной только потому, что появилась кнопка.

Нужно:

- working implementation;
- integration with existing R2D;
- save/load;
- validation;
- error handling;
- undo/redo, если это editor operation;
- tests;
- documentation;
- no architecture violation;
- machine-readable operation, где это полезно;
- no duplicate runtime;
- no false claims.

---

# 78. ПЕРВАЯ ЗАДАЧА АГЕНТА

НЕ НАЧИНАТЬ ПИСАТЬ SDK СРАЗУ.

Сначала выполнить:

```text
1. Inspect current repository.
2. Read architecture/philosophy docs.
3. Inspect current git status/diff.
4. Find existing tooling.
5. Find existing RmlUi integration.
6. Find current $ API.
7. Find Re2DSprite implementation and formats.
8. Find current Re2D World/BSP implementation.
9. Build project.
10. Run tests.
11. Identify reusable systems.
12. Produce SDK_AUDIT.md.
13. Propose minimal Phase 1 plan.
14. Only then modify code.
```

Если Claude, Codex, Work или другой агент уже оставил незавершённую реализацию:

**сначала понять её.**

Не переписывать автоматически.

---

# 79. КОРОТКАЯ ВЕРСИЯ ДЛЯ АГЕНТА

Если ты запомнил из этого файла только десять вещей, запомни эти:

```text
1. Russiano2D остаётся 2D engine.

2. Re2D ≠ generic 3D renderer.

3. НИКАКОГО ECS.

4. НИКАКОГО component model.

5. НИКАКОГО canonical visual Scene Editor.

6. Game = code + data.

7. SDK = tools for those data.

8. UI = RmlUi only.

9. Use the actual R2D runtime for previews.

10. Existing code wins. Inspect before implementing.
```

---

# 80. ФИНАЛЬНАЯ ФОРМУЛА

```text
                       HUMAN
                         │
                         │
                       SDK
                         │
           ┌─────────────┼─────────────┐
           │             │             │
       CLASSIC 2D       Re2D         BUILD
           │             │             │
           │      ┌──────┴──────┐      │
           │      │             │      │
           │ Re2DSprite     Re2D World │
           │      ↑             │      │
           │ Re2D Baker         │      │
           │      ↑             │      │
           │ 3D / VRM           │      │
           │ authoring only     │      │
           └─────────────┬─────────────┘
                         │
                   CODE + DATA
                         │
                    R2D RUNTIME
                         │
                       GAME
```

3D import is allowed.

3D runtime architecture is not implied.

Visual asset editors are allowed.

A visual editor owning the game is not.

Powerful tooling is allowed.

Changing the engine's philosophy for the tooling is not.

---

# 81. ГЛАВНЫЙ ПРИНЦИП

> **R2D SDK не собирает игру вместо программиста.**
>
> **Он создаёт, редактирует, конвертирует, компилирует, проверяет и отлаживает данные, которыми пользуется код игры.**

Если SDK придерживается этого правила — он является частью Russiano2D.

Если ради SDK приходится превращать Russiano2D в Unity —

мы делаем не тот SDK.
