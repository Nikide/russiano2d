# Re2D boomer lab — нативные atlas world sprites (P0-A)

Этап P0-A boomer-shooter roadmap: враги больше не рисуются `ui.image`
оверлеем поверх кадра мира. Обычный `$`-узел регистрируется как flat
directional atlas sprite, и его рисует нативный композитор Re2D World.

```bash
./build/russiano2d --game demos --scene re2d_boomer_lab
python3 tests/agent/re2d_boomer_lab_test.py
```

Что показывает сцена:

| Слой | Чем сделано |
|---|---|
| мир | `$.re2dWorld.load('re2d_testroom/testroom.re2dworld').backend('gpu')` |
| враги | `world.sprite(node, {atlas, columns:5, rows:8, directions:5, mirror:true, cell, pivot:'feet'})` |
| направление | колонка атласа и зеркало выбираются в C по `angle` узла и позиции камеры |
| pivot | `feet`: точка опоры кадра стоит в `depth` узла |
| окклюзия | попиксельный depth test нативного композитора (стена перекрывает спрайт) |
| свет/туман | общий нативный world pass, без отдельного спрайтового рендера |

Проверка глубины вручную: `boomerLab.moveProbe(800,500)` переносит пробу за
внутреннюю стену — она исчезает, хотя мир и камера не менялись.

Ограничения: строка анимации задаётся игрой через `sprite_row`; отдельного
tint/alpha у этого режима нет (blend выбирается на регистрации). Публичный API —
[`world.sprite`](../../docs/highlevel/re2d.md#flat-directional-atlas-sprites).
