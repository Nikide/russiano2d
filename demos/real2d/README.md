# real2d — демо Real2D v4

Витрина Real2D v4: голова персонажа собирается **из отдельных семантических
RGBA-компонентов** (лицо, глаза, нос, рот, волосы) для произвольного угла yaw.
Готовых полнофигурных ракурсов нет: контейнер несёт базовую геометрию и
коэффициенты, а кадр считает нативный модуль [src/real2d4.c](../../src/real2d4.c).

```bash
./build/russiano2d --game demos/real2d
./build/russiano2d --game demos/real2d --seconds 5 --stats
./build/russiano2d --game demos/real2d --screenshot /tmp/real2d.png --seconds 3
python3 tests/agent/real2d_test.py            # доказательный прогон стадии A
```

| Управление | Что делает |
|---|---|
| `←` `→` | угол yaw вручную |
| `пробел` | автоповорот |
| `R` | перечитать контейнер с диска (после bake) |
| кнопки RmlUi | фронт, ±45°, профиль, затылок, автоповорот, перечитать |
| `Esc` | выход |

## Что работает на стадии A

* полный круг yaw, `pitch = 0`: 12 геометрических anchors, серия Фурье `K=3`,
  PCA-манифолд ранга 6 (`q(θ)=μ+B·a(θ)`);
* инверсно-барицентрическая растеризация реальных texels шита с правилом
  top-left, билинейной выборкой и linear-premultiplied композицией;
* гейты видимости кольцами (сумма весов = 1 внутри кольца), маска окклюзии
  деталей лица по силуэту, порядок слоёв по псевдоглубине;
* provenance: у каждого непустого пикселя есть цепочка patch → треугольник → UV;
* доказательный тест: петля yaw, шов на 0/2π, не-анкорные углы, мутации
  источника, `fill rule`, полный круг 24 шагами.

Чего в стадии A **нет** и что нельзя выдавать за неё: `pitch` (вход только 0),
полнотелого персонажа, GPU-бэкенда. Переходы между appearance-вариантами —
короткий свап (лицо 1.5°): длинный dissolve давал «двойное лицо», и в узком
окне вокруг границы наложение всё ещё заметно. Настоящее решение — общий chart
с согласованной топологией (спека §6), это следующая стадия. Замер: 13.5 мс на
кадр 512×512 (растеризация через общий пул потоков движка) — цель спеки ≤1 мс
ещё не достигнута, разбивка по фазам в `$.real2d.info().ms`.

## Как это собрано

```text
assets/head_components_candidate_v1.png   исходный шит (проверен verify_head_sheet.py)
        │
tools/author_head.py      патчи, cage, mesh, UV, bindings, гейты, 12 anchors
        ▼
authoring/head.authoring.json
        │
tools/bake_real2d.py      PCA + Fourier K=3 → контейнер
        ▼
assets/head_real2d_v4.r2d4 (+ .bake.json)   ZIP store-only, CRC32, детерминирован
        │
src/real2d4.c             load → evaluate → cage warp → raster → композит → текстура
        ▼
демо: <real2d> + RmlUi-документ real2d.rml
```

Цикл правки авторинга: `python3 demos/real2d/tools/author_head.py &&
python3 demos/real2d/tools/bake_real2d.py`, затем `R` в демо — контейнер
перечитывается без пересборки движка.

| Файл | Зачем |
|---|---|
| [main.js](main.js) | сцена демо, кнопки и агентские хуки `real2dDemo.*` |
| [real2d.rml](real2d.rml) / [real2d.rcss](real2d.rcss) | интерфейс (RmlUi, закон UI) |
| [verify_head_sheet.py](verify_head_sheet.py) | проверка исходного шита и rect'ов |
| [tools/author_head.py](tools/author_head.py) | авторинг: патчи, cage, гейты, anchors |
| [tools/bake_real2d.py](tools/bake_real2d.py) | bake: манифолд и контейнер `.r2d4` |
| [REAL2D_V4_SPEC.md](REAL2D_V4_SPEC.md) | инженерная спецификация v4 |
| [STAGE_A_PLAN.md](STAGE_A_PLAN.md) | план стадии, решения и оставшиеся пробелы |

Документация API — [docs/highlevel/real2d.md](../../docs/highlevel/real2d.md).

## Пакет исходных материалов (от автора спецификации)

Порядок работы:

1. `REAL2D_V4_SPEC.md`: формулы, формат, Baker, runtime и acceptance tests.
2. `SPRITESHEET_PROMPT.md`: промпт генерации и задание coding-agent.
3. `assets/head_components_candidate_v1.png`: фактически сгенерированный исходный component sheet для head-only стадии A.

PNG создан встроенным image_gen 10.10.2026. Проверено чтение: 1254×1254, RGBA, alpha 0..255, 919379 полностью прозрачных pixels. Визуально присутствуют 16 отдельных компонентов. Это не compiled atlas и не доказательство renderer. Размер не кратен четырём, поэтому нельзя без проверки задавать целочисленные cell rects через width/4. У head/eye/nose вариантов возможны мелкие артефакты краёв; segmentation и художественный review обязательны. Не удалять детали автоматической обработкой без проверки.

НЕ ГОТОВО и требуется агенту/авторингу: точные rects и UV, cage/triangles, anatomical IDs, geometry anchors, left-facing appearance review, topology/occlusion masks, full-body assets, pitch data, .r2d4 Baker и runtime. Не выдавать отсутствие этих данных за успешный v4 bake.

Генерация применяется только к исходным художественным ассетам. Финальные 37.5°/58.2° и другие тестовые изображения MUST вычисляться обычным кодом из texels, формул и metadata.

> Состояние на 2026-10-10: часть пунктов «НЕ ГОТОВО» закрыта кодом этого
> каталога — rects и UV получены из фактических пикселей
> ([verify_head_sheet.py](verify_head_sheet.py)), cage/triangles/bindings и
> 12 geometry anchors построены ([tools/author_head.py](tools/author_head.py)),
> контейнер `.r2d4` и runtime реализованы. Остаются: left-facing appearance
> review (сейчас зеркало объявленных симметричных патчей), occlusion-маски
> переходов, full-body assets и pitch-данные.
