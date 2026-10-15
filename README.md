# Russiano2D (Руссиано 2D)

<p align="center">
  <img src="docs/images/russiano2d-mascot.png" width="760"
       alt="Девушка с вкусной порцией Руссиано">
</p>

<p align="center">
  <a href="https://r2d.nikiniki.ru/"><b>Сайт движка</b></a> ·
  <a href="https://r2d.nikiniki.ru/doc/"><b>Документация на сайте</b></a> ·
  <a href="https://r2d.nikiniki.ru/#download"><b>Готовые сборки и SDK</b></a>
</p>

Лёгкий кроссплатформенный **2D-движок для платформеров**: ядро на C/C++
(SDL3 + SDL_GPU, Box2D v3, QuickJS-ng, SDL3_mixer, RmlUi), игровая логика —
JavaScript. Вся работа с движком идёт через одну точку входа — `$` в стиле
jQuery; низкоуровневого `engine.*` в игре нет.

Игра — это **код и данные**, а не проект в визуальном редакторе: уровень,
логика и интерфейс описываются текстом, поэтому их удобно читать, diff'ить,
генерировать и проверять автоматически, в том числе ИИ-агентом.

## Собрать и запустить

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build --target russiano2d -j 8
./build/russiano2d --game game          # игра по умолчанию: меню и платформер
```

Две конфигурации сборки:

| Сборка | Что внутри |
|---|---|
| по умолчанию | всё, включая необязательный слой 3D-авторинга спрайтов (RE2D / Real2D / RotSprite, Re2D World) |
| `-DR2D_ENABLE_RE2D=OFF` | **сборка 2D-платформера**: без 3D-авторинга, EXR-неба и его демо; `$.re2dEnabled` сообщает игре, что слой выключен |

Подробности — [docs/BUILD.md](docs/BUILD.md), философия и константы —
[docs/PHILOSOPHY.md](docs/PHILOSOPHY.md), справочник API —
[docs/HIGH_LEVEL_API.md](docs/HIGH_LEVEL_API.md), первый платформер шаг за
шагом — [docs/tutorial-platformer.md](docs/tutorial-platformer.md).
