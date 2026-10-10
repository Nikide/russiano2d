# Russiano2D — демо-проект

`demos/` — отдельная игра на движке: несколько сцен-демо, каждая показывает свой
слой движка — платформер (Box2D и анимация), «Типичная ночь в Мытищинском лесу»
(свет, частицы, волны), новелла «Руси-тян» (`$.timeline` и интерфейс на RmlUi),
Re2DSprite (поворот головы из одной развёртки всего персонажа) и Re2D World
(2.5D от первого лица). Модулей демо шесть — `launcher`, `platformer`,
`shooter_witch`, `russi_vn`, `rotsprite` (сцена `re2dsprite`) и `re2d_world`;
остальные сцены из таблицы ниже открываются отдельными проектами
(`--game demos/<имя>`).
Запускается тем же бинарником, что и `game/`, и выбирается флагом `--game`.

## Запуск

```bash
./build/russiano2d --game demos                      # меню выбора
./build/russiano2d --game demos --scene platformer   # сразу конкретная сцена
./build/russiano2d --game demos --scene re2dsprite    # маскот из одной развёртки
./build/russiano2d --game demos --scene russi_vn \
    --screenshot /tmp/s.png --screenshot-at 3 --seconds 5
```

Точка входа — `<каталог>/main.js`, то есть [`demos/main.js`](../demos/main.js).
`--scene <имя>` движок кладёт в `$.startScene`, и точка входа открывает
эту сцену минуя меню:

```js
// demos/main.js
const start = $.startScene || 'launcher';
$.scene.load($.scene.has(start) ? start : 'launcher', { transition: 'none' });
```

## Как устроено демо

Каждое демо — модуль с одним экспортом: функцией `install($)`, которая
регистрирует свою сцену. Общего кода нет: всё, что раньше лежало в
`demos/lib/` (кэш ассетов, пакет отрисовки, менеджер сцен, звук, привязки
клавиш), теперь умеет само высокоуровневое API `$`.

```js
// demos/platformer/index.js
export default function install($) {
    $.scene.add('platformer', {
        enter($) { /* построить уровень */ },
        exit() { /* убрать за собой */ },
        update(dt, $) { /* логика кадра */ },
        render($) { /* необязательно: своя отрисовка */ },
    });
}
```

Низкоуровневые подсистемы (BSP-порядок, полигоны видимости, рейкастинг) никуда
не делись — их показывает «Типичная ночь в Мытищинском лесу»: свет считается
полигонами видимости (нативный движок, для игры — `$.gfx.light.polygon`),
геометрия уходит в общий батч. Отдельные демо под
них убраны, чтобы не дублировать то же самое на пустых прямоугольниках.

Добавить своё демо: положить `demos/имя/index.js` с `install($)` и дописать
строку в список `MODULES` в `demos/main.js` — кнопка в меню появится сама
(подпись и иконка берутся из таблицы `TITLES` в `demos/launcher.js`).

## Сцены

| Сцена | Что показывает | Ключевые вызовы |
|---|---|---|
| `re2d_world` | **Re2D: 2.5D от первого лица** над плоским миром — комната-коробка с текстурами, игрок (WASD + мышь), три добрых маскота Re2DSprite, которые замечают вас, поворачиваются, улыбаются и говорят. Описание — [README](../demos/re2d_world/README.md) | `$.camera.kind(Re2D)`, `$.re2d.room`, `.kind(Re2D)`, `.controls`, `$.re2dSprite.from`, `$.ui.doc` |
| `re2d_bsp_world` | **Re2D World: комнаты, этажи и АК** — XY BSP, вертикальные интервалы, оружие первого лица. Запуск отдельным проектом: `build/russiano2d --game demos/re2d_bsp_world`. [README](../demos/re2d_bsp_world/README.md) | `$.re2d.world`, `$.re2dSprite` |
| `re2d_world_renderer_lab` | **лаборатория рендерера World**: шесть камер с эталонными кадрами CPU/GPU, свет, тени, туман, порталы, прозрачность, декали; вложенная `acceptance`. Запуск: `build/russiano2d --game demos/re2d_world_renderer_lab` | `$.re2d.world`, `.light`, `.material`, `.sky` |
| `re2d_dust2` | **Dust II по маршрутам** — оригинальная карта из ячеек: A/B, спавны, двери, тоннели, рампы, клуб с музыкой (HRTF), NPC Re2DSprite, шаги и ветер. Запуск: `build/russiano2d --game demos/re2d_dust2 --seed 7`. [README](../demos/re2d_dust2/README.md) | `$.re2dWorldAudio(world)`, `.sky` (EXR), контроллер в стиле Quake |
| `re2dsprite` | **один атлас всего тела Руси-тян**: прототип головы, yaw −180..180°, pitch, nearest и привязка к пикселям. Стрелки — вращение, пробел — авто, Esc — меню. Базовый PNG и описание — [README](../demos/rotsprite/README.md) | `$.re2dSprite.create`, `.re2dPose`, `$.ui.doc` |
| `real2d` (отдельный проект) | **Real2D v4, стадия A**: голова из отдельных семантических компонентов — каждый угол yaw вычислен (12 anchors, Фурье K=3, растеризация реальных texels), RmlUi-HUD, автоповорот, перечитывание контейнера. Запуск: `build/russiano2d --game demos/real2d`. [README](../demos/real2d/README.md), план — [STAGE_A_PLAN.md](../demos/real2d/STAGE_A_PLAN.md) | `$.real2d.load/frame/info/provenance`, `<real2d>`, `.real2dPose` |
| `platformer` | Box2D, листы анимации, монеты, враги, параллакс, HUD, пауза | `.controls`, `.frames`, `.animate`, `.on('death')`, `<ui.*>` |
| `shooter_witch` | **ночной лес**: зомби-шутер в духе Vampire Survivors — авто-стрельба по ближайшему, волны, опыт, карты апгрейдов, фонари как единственный свет, тени от стволов, кровь и лужи | `<tilemap>` + `.autotile()`, `$.gfx.light.polygon`, `$.audio.zone/obstacles/damping`, `$.fx.*`, `$.gfx.postPreset` |
| `russi_vn` | **визуальная новелла «Руси-тян: Бака!»**: цундэрэ-маскот объясняет, чем JS лучше Python; интерфейс на RmlUi, пять локаций, тряска экрана, семь поз, озвучка реплик, три выбора и две концовки | `$.animatedTimelineScene2d`, `$.timeline.state`, `$.ui.doc`, `$.camera.shake`, `{ ending }` с флагом в `$.store` |

| Платформер | Типичная ночь в Мытищинском лесу | Руси-тян |
|---|---|---|
| ![Платформер](screenshots/platformer.png) | ![Типичная ночь в Мытищинском лесу](screenshots/shooter_witch.png) | ![Руси-тян](screenshots/russi_vn.png) |

Скриншоты обновляются одной командой: `python3 tools/make_screenshots.py`.

## Управление

| Клавиша | Действие |
|---|---|
| `A` / `D` или `←` / `→` | идти |
| `Space` / `W` / `↑` | прыжок |
| мышь | прицел, стрельба, перетаскивание объектов |
| `Esc` | выход из демо в меню, из меню — выход |
| `F1` | показать/скрыть отладочный оверлей движка |
| `F5` | перезапустить скрипты вручную |

## Ассеты

Графика, звук и шрифты лежат в `demos/assets/`; полный список с лицензиями —
[`demos/assets/CREDITS.md`](../demos/assets/CREDITS.md). Маскот движка
(`art/mascot/russiano_mascot_sheet_a.png`, 8×4 кадра по 176×176) используется
как игрок в демо-платформере.

## Проверка без рук

Все демо можно открыть агентом — это то же, что делает
`tests/agent/demos_test.py`:

```bash
python3 tests/agent/demos_test.py              # все сцены
python3 tests/agent/demos_test.py shooter_witch  # только выбранные
```

Тест открывает каждую сцену, шагает кадры, проверяет журнал на ошибки
и сохраняет скриншот в `build/test_demo_<имя>.png`.

## Туториал

Как собрать такое же демо с нуля — [TUTORIAL.md](TUTORIAL.md): модуль и
сцены, мир с автотайлом и светом, герой с 8 направлениями, волны, кровь,
карточки апгрейдов, HUD на якорях, меню со своей музыкой и профилирование.

Re2DSprite v2: [большой PNG, мимика, костюмы и псевдоскелет](RE2DSPRITE_V2.md),
[API `$`](highlevel/re2dsprite.md). Демо `re2dsprite` — переключение костюмов,
моргание, ходьба/бег на месте и перетаскивание кистей; старое имя сцены
`rotsprite` осталось псевдонимом ([`demos/rotsprite/index.js`](../demos/rotsprite/index.js)).
