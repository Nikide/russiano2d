# Демо «Re2D World · тестовая комната, враги на билбордах, оружие»

Комната 1600×1200 собрана **SDK-исходником** `testroom.re2dmap` и
скомпилирована в `testroom.re2dworld`; игра грузит её новым
`$.re2dWorld.load(...)` (не legacy `$.re2d.room` и не `<wall>` руками).

Игрок ходит от первого лица (WASD + мышь), collision/высоты — запросы мира
(`world.support` / `world.blocked`). Оружие — HUD-кадры maid_fps_weapons
(пистолет, дробовик, АК): выстрел и перезарядка только визуал и звук,
**урона и боя нет**. Враги — пиксельный атлас 5 направлений × 8 состояний
(40 кадров): поворот к камере выбором колонки, ходьба строками 0..3.

```bash
./build/russiano2d --game demos --scene re2d_testroom
./build/russiano2d --game demos        # кнопка «Re2D · комната врагов»
```

| Управление | Что делает |
|---|---|
| `W` `A` `S` `D` | ходить (вперёд — куда смотрит камера) |
| мышь / стрелки | смотреть, `Esc` — в меню |
| `1` `2` `3` (или `C` — цикл) | пистолет / дробовик / АК |
| ЛКМ или `F` | выстрел (кадры 0→1→2→3→0, звук на кадре 1) |
| `R` | перезарядка (звук, кадры `animations.json`) |

## 1. Карта: SDK-исходник вместо ручной комнаты

```bash
build/r2d-sdk world-compile demos/re2d_testroom/testroom.re2dmap \
    --renderer --output demos/re2d_testroom/testroom.re2dworld
```

`testroom.re2dmap` — inspectable source (cells/spans/walls/lights), его
проверяет `r2d-sdk validate` (тип `re2d.world`). Компилятор — тот же native
bake, что читает `$.re2dWorld`: `stats.cells=1`, `walls=12`, `spans=1`,
4 динамических света, 0 ошибок. `testroom.re2dworld` закоммичен рядом, как и
прочие карты демо.

| Слой | Чем сделан |
|---|---|
| мир/карта | `$.re2dWorld.load('re2d_testroom/testroom.re2dworld').backend('gpu')` |
| геометрия | `testroom.re2dmap` (SDK) → `world-compile --renderer` |
| игрок | данные `view {x,y,h,yaw,pitch}`; движение `world.support/blocked`, глаза +48 |
| камера | `world.render(view, 1024, 576)`, fov 72, near 4; 16:9 как окно |
| враги | данные + кадры атласа; `ui.image` поверх мира, окклюзия `world.ray` |
| оружие | `ui.image` 128×4 кадров атласа, кадры/звуки из `animations.json` |
| HUD | обычные `ui`-узлы: заголовок, подсказка, прицел, статус |
| агент | `$.agent.expose('re2dTestroom', …)`: map/world/hero/enemies/weapon |

## 2. Честные ограничения

* **World рисует только Re2DSprite** (rigged character JSON), поэтому плоские
  кадры атласа идут JS-оверлеем: та же перспектива камеры, но **скрытие за
  стеной — целиком по `world.ray`, без попиксельного z-теста**. Если нужна
  попиксельная окклюзия — это отдельная фича нативного композитора.
* **Урон/бой не реализованы**: оружие стреляет визуально и звуком, врагам
  ничего не прилетает (`combat: false`). Строки листа 4..7 (прицел/выстрел/
  падение/труп) оставлены под следующий этап.
* Плоские цвета стен/пола — без material/albedo; albedo/normal/emissive —
  следующий шаг (`world.material` + `surface.material`).

## 3. Проверка без рук

```bash
python3 tests/agent/re2d_testroom_test.py
```

Тест проверяет: карта — `.re2dworld`, рядом `.re2dmap`, `world.info()` даёт
геометрию; W идёт вперёд (`y 1080 → 926.7`), внутренняя стена держит
(`y=620`), южная (`y=1183.5`), `A` — боком; 6 врагов патрулируют, лист
40 кадров, ходьба строками 0..3, колонка/зеркало = угол к камере; за стеной
`seen=false` и оверлей скрывает (`occluded≥1`); оружие 3 вида, выстрел со
звуком, перезарядка; арт виден (зелёные пиксели); ошибок нет.
