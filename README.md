# Russiano2D (Руссиано 2D)

<p align="center">
  <img src="docs/images/russiano2d-mascot.png" width="760"
       alt="Девушка с вкусной порцией Руссиано">
</p>

<p align="center">
  <a href="https://r2d.nikiniki.ru/"><b>Сайт движка</b></a> ·
  <a href="https://r2d.nikiniki.ru/doc/"><b>Документация</b></a> ·
  <a href="https://gitverse.ru/Nikide/russiano2d/releases"><b>GitVerse · релизы</b></a> ·
  <a href="https://github.com/Nikide/russiano2d"><b>GitHub</b></a>
</p>

Кроссплатформенный **2D-движок и редактор проекта**: платформеры, визуальные
новеллы и другие 2D-игры. Ядро на C11 (SDL3 + SDL_GPU, Box2D v3, QuickJS-ng,
SDL3_mixer, RmlUi), игровые инструменты используют отдельные native adapters,
а игровая логика пишется на JavaScript. Вся работа с движком идёт
через одну точку входа — `$` в стиле jQuery; низкоуровневого `engine.*` в игре
нет.

Игра — это **код и данные**, а не проект в визуальном редакторе: уровень,
логика и интерфейс описываются текстом, поэтому их удобно читать, diff'ить,
генерировать и проверять автоматически, в том числе ИИ-агентом.

Редактор, CLI и runtime поставляются одним бинарником `r2d`. Проект остаётся
обычной папкой с JavaScript-кодом и открытыми данными; сборка движка и
проектные тесты выполняются только через Xmake.

## Собрать и запустить

Каноническая и единственная сборка — **Xmake**.

```bash
# macOS arm64; для других платформ см. docs/BUILD.md
xmake f -p macosx -a arm64 -m release -o build-xmake/macos-arm64
xmake build -y

./build-xmake/macos-arm64/macosx/arm64/release/r2d                  # Project Manager / Editor
./build-xmake/macos-arm64/macosx/arm64/release/r2d edit game        # открыть проект
./build-xmake/macos-arm64/macosx/arm64/release/r2d --game game     # запустить игру
```

Xmake собирает единственный executable `r2d`: он открывает Editor, запускает
игры и выполняет проектные CLI-команды. Игры остаются обычными JavaScript-
проектами на публичном `$` API и запускаются напрямую через `r2d --game`.

В репозитории `game/` — платформер (рабочий пример). В **релизных пакетах**
игра по умолчанию пока задаётся отдельным legacy-проектом `game_vn/`; новый
Editor-authored платформер и романтическая ВН находятся в `demos/` и не
подменяют релизную игру.

Зависимости для локальной сборки: `xmake`, `mingw-w64` (Windows), `m4` для autotools-зависимостей; `zig` нужен только для
opt-in Linux-кросс-сборки (`R2D_BUILD_LINUX=1`).
Docker и VM не используются.

## Скачать

Готовые пакеты для macOS (arm64/x86_64) и Windows x86_64 доступны в
[GitVerse Releases](https://gitverse.ru/Nikide/russiano2d/releases) и
[GitHub Releases](https://github.com/Nikide/russiano2d/releases).
На Linux движок собирается из исходников — см. [инструкцию сборки](docs/BUILD.md).

## Документация

| Документ | О чём |
|---|---|
| [docs/BUILD.md](docs/BUILD.md) | сборка `r2d`, Editor и запуск/упаковка игр |
| [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) | философия и константы проекта |
| [docs/HIGH_LEVEL_API.md](docs/HIGH_LEVEL_API.md) | справочник `$` API |
| [docs/tutorial-platformer.md](docs/tutorial-platformer.md) | первый платформер шаг за шагом |
| [docs/EDITOR.md](docs/EDITOR.md) | Project Manager, Editor и встроенные студии |
| [docs/EDITOR_GUIDE.md](docs/EDITOR_GUIDE.md) | практическая работа в Editor со скриншотами платформера и ВН |
| [docs/VN_MAKER.md](docs/VN_MAKER.md) | Visual Novel Maker |
| [docs/FEATURE_FREEZE.md](docs/FEATURE_FREEZE.md) | feature freeze и правила новых engine-возможностей |
