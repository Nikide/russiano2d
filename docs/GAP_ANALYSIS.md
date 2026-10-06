# Russiano2D — аудит высокоуровневого API `$` и пробелы относительно Godot 4.x (2D)

Дата: 2026-10-05. Ориентир: игровой API Godot 4.x, только 2D-часть
(`Node2D`, `CanvasItem`, `AnimationPlayer`, `TileMapLayer`, `CPUParticles2D`,
`NavigationRegion2D`, `AudioStreamPlayer2D`, `Control` и сопутствующее).

Документ отвечает на три вопроса:

1. что **уже есть** в `$` и низкоуровневом `engine`;
2. чего **не хватает** нормальному 2D-движку;
3. что из этого **реализуется** в рамках текущей работы (и в каком порядке).

Реализованное по итогам документа сразу описывается в
[HIGH_LEVEL_API.md](HIGH_LEVEL_API.md) и в `docs/highlevel/*.md`.

---

## 1. Как устроен API сегодня

| Слой | Файл | Роль |
|---|---|---|
| Ядро `$` | `src/highlevel/core.js` | узел, обёртка, селекторы, теги, цвет |
| Сборка | `src/highlevel/api.js` | `createApi()`, цепочные методы узла, кадровый цикл |
| Подсистемы | `world/camera/time/input/sound/scene/ui/store/debug/window/render/tween/agent.js` | пространства имён `$.xxx` |
| Низкий уровень | `src/script.c` → `engine.*` | текстуры, батчинг, Box2D, RmlUi, BSP, свет, файлы |
| Ядро C | `src/render.c`, `src/physics.c`, `src/audio.c`, `src/light.cpp`, `src/bsp.c` | SDL_GPU, Box2D, SDL3_mixer, видимость, BSP |

Ключевые свойства текущего API, которые важно сохранить:

* **HTML/CSS-подобный DSL**: создание `$('<player>', {...})`, поиск `$('#hero')`,
  неявная итерация по коллекции, цепочки, `Promise` для анимаций.
* **Пакетный кадр**: игра не вызывает отрисовку на спрайт, `$.gfx` собирает
  массивы и отдаёт их одним `engine.submitSprites`.
* **Физика целиком в C**: JS работает с телами по числовому id.
* **Всё возвращает обёртку** — `$.fn` открыт для расширения игры.

Ниже «есть» означает «работает и документировано», «частично» — работает с
оговорками, «нет» — отсутствует.

---

## 2. Сводная таблица пробелов

Приоритет: **P1** — без этого движок нельзя назвать полноценным 2D-движком,
**P2** — сильно ожидаемо в жанре, **P3** — нишевое.

> Проверка от 2026-10-06: столбец «Чего не хватает» местами устарел — перечисленное
> для анимации, тайлмапа, частиц, навигации, префаба, шин звука, слоёв и UI уже
> реализовано и задокументировано в `docs/highlevel/`. Актуальный разбор полноты
> (сколько биндингов `engine.*` обёрнуто, что осталось за бортом, какие пункты этой
> таблицы всё ещё открыты) — в [HIGH_LEVEL_API_PERF.md](HIGH_LEVEL_API_PERF.md) §4.

| Область Godot 2D | Аналог в Godot | Состояние в `$` | Чего не хватает | Приор. |
|---|---|---|---|---|
| Трансформ, иерархия | `Node2D` | есть | `z_as_relative`, наследование `visible`/`modulate` родителем | P2 |
| Спрайты | `Sprite2D`, `AnimatedSprite2D` | есть | `region` есть; нет `NinePatchRect`, атласа-импорта | P2 |
| **Анимация** | `AnimationPlayer`, `AnimationTree`, `AnimationMixer` | **есть** ([anim.md](highlevel/anim.md)) | клипы, дорожки свойств, `one-shot`/`loop`/`ping-pong`, события в кадрах, машина состояний и переходы | **P1** |
| **Тайлы** | `TileMapLayer`, `TileSet`, террейны | **есть** ([tilemap.md](highlevel/tilemap.md)) | сетка, слои, тайлсет из текстуры, автотайл по битовой маске, коллизии, `y-sort` внутри слоя | **P1** |
| **Частицы** | `CPUParticles2D`, `GPUParticles2D` | **есть** ([particles.md](highlevel/particles.md)) | эмиттер, `one-shot`/`burst`, гравитация, разброс, кривые цвета/размера, `local`/`global` | **P1** |
| **Навигация** | `NavigationRegion2D`, `NavigationAgent2D`, `AStarGrid2D` | **есть** ([nav.md](highlevel/nav.md)) | сетка/полигон, A*, сглаживание пути, обход препятствий | **P1** |
| **Сцены и prefab** | `PackedScene`, наследование сцен, `.tres` | **есть** ([prefab.md](highlevel/prefab.md)) | `$.scene` — это машина смены сцен, а не сериализация узлов; нет инстанцирования из данных, сохранения сцены, наследования | **P1** |
| **Аудио** | `AudioStreamPlayer2D`, шины `AudioServer`, эффекты | **есть** ([audiobus.md](highlevel/audiobus.md)) | мастер/`sfx`/`music` + панорама есть; нет шин, эффектов (reverb/echo/фильтр), приоритетов голосов, позиционного затухания | **P1** |
| **Слои и parallax** | `CanvasLayer`, `ParallaxBackground`, `CanvasModulate` | **есть** ([layers.md](highlevel/layers.md)) | один фон с `parallax` есть; нет дополнительных канвас-слоёв, `CanvasModulate`, `z_index`-групп | **P1** |
| **Шейдеры** | `canvas_item` шейдер, `ShaderMaterial`, `ShaderParam` | **частично** (`.shader()` — заглушка; blend-режимы `alpha`/`add`/`multiply`/`none` есть) | пользовательских шейдеров нет: конвейеры фиксированные | P2 |
| **UI-контролы** | `Control`: контейнеры, `ScrollContainer`, `LineEdit`, `CheckBox`, `OptionButton`, `Slider`, фокус | **есть** ([widgets.md](highlevel/widgets.md)) | есть `panel/label/button/bar/image`; нет контейнеров, скролла, фокуса, ввода текста, чекбоксов, слайдеров, диалогов | **P1** |
| Физика: формы | `CollisionShape2D` | **есть** | прямоугольник, настоящий круг, капсула, полигон, `one-way` | — |
| Физика: соединения | `PinJoint2D`, `DampedSpringJoint2D`, `GrooveJoint2D` | **есть** | `revolute`, `distance`, `weld` (+ лимиты и мотор) | — |
| Физика: области | `Area2D` | **есть** | зоны `<trigger>` (`enter`/`leave`), сенсоры и события контакта `collide`/`separate`/`hit` | — |
| Физика: фильтры | collision layers/masks | частично | `layerBits`/`mask` есть у тел; нет именованных слоёв и матрицы | P3 |
| Запросы | `RayCast2D`, `ShapeCast2D` | частично | луч и точечный/боксовый запрос есть; нет фигурного свипа | P2 |
| Свет | `PointLight2D`, тени | есть | полигоны видимости, `<light>` | — |
| Порядок отрисовки | `YSort`, `z_index` | есть | `layer`, `depth`, `$.world.sort('y')`, BSP | — |
| Таймеры | `Timer`, `SceneTreeTimer` | есть | `$.time.after/every`, твины | — |
| Сигналы, группы | `signal`, группы | есть | `on/emit`, классы, теги, селекторы | — |
| Твины | `Tween` | **есть** | Promise-API + `Tween` в стиле Godot: `property/chain/loops/trans × ease` | — |
| Ввод | `InputMap`, действия, ребинд | **есть** | `deadzone`, `rebind`, `saveBindings`/`loadBindings`, `actions`/`describe` | — |
| Кривые/интерполяция | `Curve`, `Gradient` | нет | нужны для частиц и анимации | P2 |
| Локализация | `TranslationServer` | **есть** | `$.i18n` + `$.tr()`, плюрализация, автоподстановка в узлы | — |
| Сеть | `MultiplayerAPI` | нет | вне текущей области | P3 |
| Скелет/IK | `Skeleton2D` | нет | вне текущей области | P3 |
| Отладка | удалённое дерево сцены | частично | `$.debug`, оверлей ImGui, агентский снапшот, `$.debug.counters()` | P2 |

---

## 3. Подробно по P1-областям

### 3.1. Анимация и состояния — нет

Есть только покадровая анимация спрайт-листов (`.frames()`, `.frame()`,
`.animate()`) и твины свойств (`.tween()`, `.tweenTo()`, `$.sequence()`).
Этого не хватает для: появления/смерти, атаки, дверей, UI-переходов.

Нужно: `AnimationPlayer`-аналог с клипами (несколько дорожек, у каждой своя
цель и кривая), режимы `once`/`loop`/`ping-pong`, скорость, события в
процентах клипа, машина состояний с переходами по условию и событиями
`entered`/`exited`.

### 3.2. TileMap — нет

Тег `tilemap` уже объявлен в `core.js` (`TAGS.tilemap`), но рендера нет.
Нужно: размер тайла, тайлсет из текстуры (в том числе сеткой), несколько
слоёв, автотайл по 4/8-битной маске соседей, статические тела для
непроходимых тайлов, `y-sort` внутри слоя, запись/чтение карты как данных.

### 3.3. Частицы — нет

Нужно: CPU-эмиттер на существующем батче `$.gfx`, время жизни, скорость и
разброс, гравитация, вращение, кривые размера/цвета/прозрачности, `one-shot`
и `burst`, `local`/`global` режимы, лимит частиц.

### 3.4. Навигация и поиск пути — нет

Есть только `$.world.raycast`. Нужно: A* по сетке (в том числе построенной по
препятствиям), сглаживание пути, `NavigationAgent`-аналог с движением к цели,
перестроение при изменении мира.

### 3.5. Prefab и сериализация сцен — частично

`$.scene.load/push/pop/transition` управляет сменой сцен, но не умеет
сериализовать дерево узлов. Нужно: сохранение узла/поддерева в данные
(JSON-совместимые), инстанцирование из данных, наследование prefab с
переопределением свойств, сохранение/загрузка сцены целиком через `$.store`.

### 3.6. Аудио: шины и эффекты — частично

Есть мастер-громкость, `sfx`/`music`, панорама, петли, затухания. Нет
именованных шин (например `master → music → ui`), эффектов на шине и
маршрутизации звука в шину. Часть реализуется в JS поверх существующих
`volume/pan`, эффекты требуют C (`MIX_SetTrackEffects`).

### 3.7. Слои, parallax, шейдеры — частично

Есть один фон с коэффициентом `parallax`. Нет дополнительных канвас-слоёв
(UI поверх мира, оверлеи, мини-карта), `CanvasModulate` и режимов смешивания.
Полноценные пользовательские GPU-шейдеры упираются в один общий пайплайн
`render.c`; в отчёте они остаются честно помеченными как незакрытые, а
слои/parallax/затемнение реализуются.

### 3.8. UI-контролы — частично

Есть `ui.panel/label/button/bar/image` в координатах окна и RmlUi-документы
через `$.ui`. Нет контейнеров (колонка/строка/сетка), скролла, фокуса и
навигации с клавиатуры, `checkbox`/`slider`/`input`/`dialog`.

---

## 4. Что сделано в этой итерации

| № | Подсистема | Файлы | Документация |
|---|---|---|---|
| 1 | Анимация и состояния | `src/highlevel/anim.js` | [anim.md](highlevel/anim.md) |
| 2 | TileMap | `src/highlevel/tilemap.js` | [tilemap.md](highlevel/tilemap.md) |
| 3 | Частицы | `src/highlevel/particles.js` | [particles.md](highlevel/particles.md) |
| 4 | Навигация и A* | `src/highlevel/nav.js` | [nav.md](highlevel/nav.md) |
| 5 | Prefab и сериализация | `src/highlevel/prefab.js` | [prefab.md](highlevel/prefab.md) |
| 6 | Аудио-шины и эффекты | `src/highlevel/audiobus.js`, `src/audio.c/h`, `src/script.c` | [audiobus.md](highlevel/audiobus.md) |
| 7 | Слои, parallax, затемнение | `src/highlevel/layers.js` | [layers.md](highlevel/layers.md) |
| 8 | UI-контролы | `src/highlevel/widgets.js` | [widgets.md](highlevel/widgets.md) |

Точки расширения, добавленные в существующие файлы (единственный писатель —
интегратор, чтобы модули не конфликтовали):

* `src/highlevel/render.js` — реестр `registerNodeRenderer(tag, fn)`,
  `registerUINodeRenderer` и публичный батч `$.gfx.push.*` для новых тегов;
* `src/highlevel/api.js` — импорт и установка восьми модулей, вызов
  tick-функций в кадровом цикле;
* `src/highlevel/input.js` — `$.input.text()` поверх нового `engine.textInput()`;
* `src/app.c/h`, `src/agent.c`, `src/script.c` — текстовый ввод
  (`SDL_EVENT_TEXT_INPUT` → `engine.textInput()`, агентская команда `text`);
* `src/audio.c/h`, `src/audio_stub.c`, `src/script.c` — громкость и панорама
  живого канала, DSP-эффекты `lowpass`/`echo` через `MIX_SetTrackRawCallback`;
* `src/script.c` — биндинги `engine.audio.setChannelVolume`, `setChannelPan`,
  `setChannelEffect` и `engine.textInput`.

### Что изменилось по сравнению с исходным планом

* Пользовательские GPU-шейдеры не реализованы: конвейер `render.c` один, а
  честная поддержка требует SPIR-V-компиляции в рантайме. `.shader()` и
  `.shader()` по-прежнему заглушка с предупреждением; вместо пользовательских
  шейдеров появились слои, параллакс, полноэкранный `modulate`/`fade` и
  blend-режимы (`$.blend`, `.blend`).
* `agentRadius` у навигационной сетки добавлен как обязательная страховка:
  без запаса на габарит агента A* ведёт путь вплотную к стене и тело
  застревает (это выявил интеграционный тест).

## 5. Вторая итерация: починка врущего и добивание P1

Первая итерация закрыла восемь крупных дыр, но проверка показала места, где
документация обещала больше, чем было в коде, и оставшиеся P2-пробелы.

### Починено (документация врала)

| Что было заявлено | Что было на самом деле | Как исправлено |
|---|---|---|
| `<trigger>` шлёт `enter`/`leave` | Тег был обычным узлом, `trigger()` — алиасом `emit` | Подсистема [triggers.md](highlevel/triggers.md): зоны с диффом пересечений |
| `.overlaps(sel, cb)` | Подписка на событие `'tick'`, которое никто не шлёт | `watchOverlap` из `triggers.js`, покадровый наблюдатель |
| `<circle>` — круг | Тело было `b2MakeBox` | Настоящая форма `circle` (`b2CreateCircleShape`) |

Найден и закрыт ещё один баг: пересоздание тела (`.size()`, `.collision()`,
`.appendTo()`) теряло скорость — цепочка `.velocity(...).appendTo(...)`
обнуляла разгон.

### Добавлено во второй итерации

| Что | Где | Документация |
|---|---|---|
| Формы тел: круг, капсула, полигон; one-way; события `collide`/`separate`/`hit`; суставы `revolute`/`distance`/`weld` | `src/physics.c/h`, `src/script.c` | [API.md](API.md), раздел 8 |
| `Tween` в стиле Godot: `property`, `chain`, `loops`, `trans × ease`, `finished` | `src/highlevel/tween.js` | [tween.md](highlevel/tween.md) |
| Зоны `enter`/`leave` | `src/highlevel/triggers.js` | [triggers.md](highlevel/triggers.md) |
| Локализация `$.i18n` + `$.tr()` | `src/highlevel/i18n.js` | [i18n.md](highlevel/i18n.md) |
| Пул объектов и счётчики отладки | `src/highlevel/pool.js`, `debug.js` | [pool.md](highlevel/pool.md) |
| Ввод: deadzone, ребинд с сохранением | `src/highlevel/input.js` | [i18n.md](highlevel/i18n.md) (раздел про ввод) |
| UI: якоря, проценты, пресеты, темы | `src/highlevel/widgets.js` | [widgets.md](highlevel/widgets.md) |
| TileMap: Y-sort с сущностями и террейны | `src/highlevel/tilemap.js` | [tilemap.md](highlevel/tilemap.md) |
| Релизная обвязка: CI на Linux и Windows, changelog, release-скрипт, двойной хостинг | `.gitverse/workflows/release.yaml`, `tools/release.py` | [RELEASING.md](RELEASING.md) |
| Мини-гайд «Моя первая игра» | `docs/tutorial-first-game.md` | — |

## 6. Третья итерация: тяжёлые куски и сервисы

| Что | Где | Документация |
|---|---|---|
| Blend-режимы (`alpha`/`add`/`multiply`/`none`) — узел и кадр | `src/render.c`, `src/highlevel/render.js`, `viewport.js` | [render.md](highlevel/render.md) |
| HTTP-запросы из игры: `$.http.get/post/json/download` | `src/http.c`, `src/highlevel/http.js` | [http.md](highlevel/http.md) |
| Навигационный меш (прямоугольная декомпозиция + воронка) | `src/highlevel/nav.js` | [nav.md](highlevel/nav.md), §4 |
| Тест-страж гайда: листинг из документа запускается в движке | `tests/agent/highlevel_guide_test.py` | — |

Render target (рисование в offscreen-текстуру) остаётся заглушкой: `render pass`
открывается в `main.c`, и честная поддержка требует отдельного прохода и списка
целей. В [render.md](highlevel/render.md) описано, что именно перестроить —
API при вызове бросает понятную ошибку, а не рисует неправильно.

## 7. Что остаётся в бэклоге

Пользовательские GPU-шейдеры (нужна компиляция SPIR-V в рантайме),
`NinePatchRect`, сетевая игра (HTTP уже есть, но это не мультиплеер),
скелет/IK, кривые и градиенты как отдельные ресурсы, render target для
мини-карт и порталов. Они не входят в текущие итерации и перечислены здесь, чтобы не
потерять.

---

## 8. Решение по аудио (2026-10-05): расширяем штатный стек

Рассматривался перенос звука на [SoLoud](https://github.com/jarikomppa/soloud)
(zlib/libpng, C API, Freeverb, шины, приоритеты голосов, pitch, стриминг).
Спайк подтвердил, что он собирается и работает, но проверка пришпиленной
версии SDL_mixer показала: **то, за чем мы шли в SoLoud, уже есть в нашем
стеке** — просто не подключено.

| Возможность | Где в SDL_mixer 3.2.4 (`release-3.2.4`) | Состояние в движке |
|---|---|---|
| Pitch / скорость | `MIX_SetTrackFrequencyRatio` | не подключено, `$.sound.play({pitch})` пишет предупреждение |
| Шины с DSP | `MIX_CreateGroup`, `MIX_SetTrackGroup`, `MIX_SetGroupPostMixCallback` | шины эмулируются громкостью в `audiobus.js` |
| Позиционный звук | `MIX_SetTrack3DPosition` | панорама считается вручную |
| DSP на дорожке | `MIX_SetTrackRawCallback` | используется: `lowpass`/`echo` в `src/audio.c` |
| Стриминг музыки | `MIX_LoadAudioNoCopy(..., predecode=false)` | уже используется |

Поэтому решение: **не тащить SoLoud, а расширять штатный звук**. Из SoLoud
берём алгоритмы, а не движок — в первую очередь Freeverb (алгоритм Jezar,
public domain), который встаёт в `MIX_SetGroupPostMixCallback` как
реверб-шина. SoLoud остаётся планом B на случай, если понадобится граф шин с
send/return и свёртка с импульсными характеристиками.

Этапы:

1. **Pitch и реальные шины.** `MIX_SetTrackFrequencyRatio`,
   `MIX_CreateGroup`/`MIX_SetTrackGroup` вместо JS-эмуляции, `MIX_SetTrack3DPosition`.
   Файлы: `src/audio.{h,c}`, `src/script.c`, `src/highlevel/sound.js`,
   `src/highlevel/audiobus.js`. Публичный API `$.sound`/`$.audio` не меняется.
2. **Реверб.** Порт Freeverb в `src/audio_reverb.c` +
   `$.audio.effect('reverb', { room, damp, wet, width })`.
3. **Акустика помещений.** `$.audio.zone(name, { rect, height, material })`,
   `$.audio.listener(...)`, зонд лучами → RT60/параметры реверба, окклюзия
   через `$.world.lineOfSight` + lowpass, сглаживание на границах зон.
4. **По потребности.** Приоритеты и stealing голосов, `seek`, новые эффекты.

Правила поведения, которые не меняются: один публичный API (`$.sound`,
`$.audio`), возможности — свойство бэкенда (`$.audio.supports('reverb')`), а
не отдельное пространство имён вида `$.soloud.*`.

### Сделано (2026-10-05)

| Что | Где | Чем проверено |
|---|---|---|
| Pitch эффектов и музыки (`{ pitch }`, `$.sound.musicPitch`) | `src/audio.c`, `src/script.c`, `sound.js` | `tests/js/sound_test.mjs` |
| Настоящие шины: `MIX_CreateGroup` + пост-микс группы для эффекта шины | `src/audio.c`, `audiobus.js` | `tests/js/audiobus_test.mjs` |
| 3D-позиция канала (`MIX_SetTrack3DPosition`) как режим `$.audio.spatial('sdl')` | `src/audio.c`, `audiobus.js`, `sound.js` | `tests/js/audiobus_test.mjs` |
| Реверберация помещения (Freeverb, сухой сигнал не ослабляется) | `src/audio_reverb.{h,c}`, post-mix колбэк в `audio.c` | C-тест `tests/audio/reverb_test.c`: зал держит хвост там, где комната уже молчит |
| Комната и зоны: `$.audio.room/zone/removeZone/acoustics/occlusion/acousticsState` | `src/highlevel/acoustics.js` | `tests/js/acoustics_test.mjs` |
| Слушатель-узел/селектор, окклюзия за стеной, живое позиционирование `$.sound.playAt` | `audiobus.js`, `sound.js`, `acoustics.js` | `tests/js/sound_test.mjs`, `tests/js/audiobus_test.mjs` |

Отличия от плана, которые стоит помнить:

* реверберация висит на `MIX_SetPostMixCallback` (одна комната на микс), а не на
  `MIX_SetGroupPostMixCallback`: комната — свойство места, она слышна для всего
  сразу. Шины при этом **настоящие группы** (`MIX_CreateGroup`), и канальный
  эффект шины (`lowpass`/`echo`) идёт через пост-микс своей группы;
* `MIX_SetTrack3DPosition` подключён как **опциональный** режим
  (`$.audio.spatial('sdl')`): у SDL_mixer 3.2.4 слушатель всегда в `(0,0,0)` и
  его нельзя двигать, поэтому координаты даются относительно слушателя, а трек
  микшируется в моно. По умолчанию остаётся JS-панорама (`panAndGain`), потому
  что она дешевле и не теряет стерео;
* у групп SDL_mixer нет гейна и вложенности — `volume`/`mute`/`solo` и дерево шин
  по-прежнему считает JS, движку достаётся DSP;
* в GAP_ANALYSIS §2 строка «позиционного затухания нет» устарела — оно появилось
  ещё в `audiobus.js`.

## 9. VFX

План по визуальным эффектам (взрывы, выстрелы, чёрная дыра) — в
[VFX_PLAN.md](VFX_PLAN.md): что делается на текущем пайплайне, что требует
render target, а что — рантайм-шейдеров и сторонних библиотек.
