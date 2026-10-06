# Демо «Платформер» — Box2D, анимация, HUD

Самое старое демо проекта и самый полный пример «игры целиком» на `$`:
уровень из тайлов, физика Box2D, спрайтовые анимации, монеты, враги,
параллакс-фон, HUD, пауза и экран проигрыша. Игрок — маскот движка
(`art/mascot/russiano_mascot_sheet_a.png`).

```bash
./build/russiano2d --game demos --scene platformer
```

| Управление | Что делает |
|---|---|
| `A` / `D` или `←` / `→` | идти |
| `Space` / `W` / `↑` | прыжок (второй прыжок в воздухе — двойной) |
| `P` | пауза |
| `R` | заново |
| `Esc` | в меню демо |

---

## 1. Что показывает

| Слой | Чем сделан | Где смотреть в `index.js` |
|---|---|---|
| уровень | тайлы `<tilemap>` + статические тела `<wall>` | `buildLevel()` |
| игрок | `$('<player>')` с `.controls('wasd')`, листы анимации | `createPlayer()` |
| враги | `<enemy>` с `.health()`, ходьба туда-сюда, смерть сверху | `createEnemy()` |
| монеты | `<pickup>` + счётчик и `.on('pickup')` | `createCoin()` |
| фон | три `<sprite class="parallax">` с разной скоростью | `parallax()` |
| HUD | `<ui.panel>`, `<ui.label>`, `<ui.bar>` | `buildHud()` |
| пауза и конец | `<ui.panel>` + `<ui.button>`, `$.time.pause()` | `buildPause()`, `buildGameOver()` |

## 2. Как это устроено

Демо — одна сцена `$.scene.add('platformer', { enter, exit, update })`.
Всё строится в `enter`: сначала уровень, потом игрок, потом интерфейс.
`update(dt)` — игровая логика кадра: смерть от падения, подбор монет, победа.

```js
// игрок: тот же тег, что и в туториале, — с управлением и анимациями
$('<player>', { id: 'hero' })
    .at(80, 400).size(28, 40)
    .health(100).speed(250)
    .controls('wasd')
    .frames('demos/assets/art/mascot/russiano_mascot_sheet_a.png')
    .on('death', () => $.scene.load('platformer'))
    .appendTo($.world);

// враг: ходит между двумя точками, умирает от прыжка сверху
$('<enemy>', { id: 'enemy-' + i })
    .at(x, y).health(30).speed(60)
    .frames('demos/assets/art/characters/enemy_02_catgirl_scout_8x9.png')
    .appendTo($.world);
```

## 3. Своё такое демо за десять минут

1. **Сцена.** `$.scene.add('my_level', { enter($){…}, update(dt, $){…} })` и
   `$.scene.load('my_level')` — этого уже достаточно, чтобы был уровень.
2. **Земля.** Либо `<wall>` прямоугольниками, либо `<tilemap>` из ASCII:
   `$.tilemap.fromASCII(rows, { '.': 1, '#': 2 })` — см. `docs/highlevel/tilemap.md`.
3. **Игрок.** `$('<player>', { id: 'hero' }).controls('wasd')` — управление,
   гравитация и столкновения уже включены. Анимации: `.frames(лист)` и
   `.animate({ from, to, speed, loop })`; как нарезан лист — в
   `docs/highlevel/anim.md`.
4. **Смерть и победа.** `.on('death', …)` (событие тела) и свой счётчик;
   экран — обычная сцена или `<ui.panel>` поверх.
5. **Проверка без рук.** Тест демо берёт `tests/agent/demos_test.py`
   (сцена открывается, мир строится, кадр рисуется, ошибок нет):

   ```bash
   python3 tests/agent/demos_test.py platformer
   ```

## 4. Ассеты

Тайлсеты и фон — CC0 (`demos/assets/tiles/`), листы персонажей — CC0 с
OpenGameArt, маскот — рисунок автора проекта. Полный список с лицензиями:
[`demos/assets/CREDITS.md`](../assets/CREDITS.md).

## 5. Похожие материалы

* [Туториал «Моя первая игра»](../../docs/tutorial-first-game.md) — тот же
  платформер, но по шагам и с объяснениями;
* [Туториал про меню и паузу](../../docs/tutorial-menus.md);
* [`docs/highlevel/tilemap.md`](../../docs/highlevel/tilemap.md).
