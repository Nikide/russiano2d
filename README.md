# Russiano2D (Руссиано 2D)

<p align="center">
  <img src="docs/images/russiano2d-mascot.png" width="760"
       alt="Девушка с вкусной порцией Руссиано">
</p>

<p align="center">
  <a href="https://r2d.nikiniki.ru/"><b>Сайт движка</b></a> ·
  <a href="https://r2d.nikiniki.ru/doc/"><b>Документация</b></a> ·
  <a href="https://github.com/Nikide/russiano2d/releases"><b>Скачать релизы</b></a>
</p>

Лёгкий кроссплатформенный **2D-движок**: платформеры, визуальные новеллы и
другие 2D-игры. Ядро на C/C++ (SDL3 + SDL_GPU, Box2D v3, QuickJS-ng,
SDL3_mixer, RmlUi), игровая логика — JavaScript. Вся работа с движком идёт
через одну точку входа — `$` в стиле jQuery; низкоуровневого `engine.*` в игре
нет.

Игра — это **код и данные**, а не проект в визуальном редакторе: уровень,
логика и интерфейс описываются текстом, поэтому их удобно читать, diff'ить,
генерировать и проверять автоматически, в том числе ИИ-агентом.

Базовый движок **feature-complete** после FINAL ENGINE PASS: новые
engine-level возможности принимаются только по правилам
[docs/FEATURE_FREEZE.md](docs/FEATURE_FREEZE.md). Следующий этап — реальная
игра, а не бесконечное расширение движка.

## Собрать и запустить

Каноническая сборка — **Xmake** (CMake остаётся только внутри сторонних
пакетов и вспомогательных инструментов).

```bash
# macOS arm64; для других платформ см. docs/BUILD.md
xmake f -p macosx -a arm64 -m release -o build-xmake/macos-arm64
xmake build -y

./build-xmake/macos-arm64/macosx/arm64/release/russiano2d --game game
./build-xmake/macos-arm64/macosx/arm64/release/russiano2d --game sdk   # SDK
```

В репозитории `game/` — платформер (рабочий пример). В **релизных пакетах**
игра по умолчанию — демо визуальной новеллы «Руси-тян: Бака!» (`game_vn/`).

Зависимости для локальной сборки: `xmake`, `zig` (Linux/Windows cross),
`mingw-w64` (Windows), `CMake 3.31` и `m4` для autotools-зависимостей.
Docker и VM не используются.

## Релизы

Релизные пакеты для macOS (arm64/x86_64) и Windows x86_64 собираются и
публикуются **локально** одной командой:

```bash
build_and_push
```

Она спрашивает сообщение и версию, собирает пакеты в `dist/`, проверяет их,
гоняет Unity-тесты, ставит тег и публикует релизы на GitHub/GitVerse/hub.mos.
**Linux x86_64 в локальный релиз временно не входит**: Zig-кросс-сборка на
машине релиза зависает. Linux-пользователи собирают движок на своей ОС
(см. [docs/BUILD.md](docs/BUILD.md)); вернуть платформу в релиз можно
`R2D_BUILD_LINUX=1`. Сайт бинарники не раздаёт: кнопки скачивания ведут на
GitHub Releases.

Подробности — [docs/RELEASING.md](docs/RELEASING.md).

## Документация

| Документ | О чём |
|---|---|
| [docs/BUILD.md](docs/BUILD.md) | сборка движка, SDK и упаковка игр |
| [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) | философия и константы проекта |
| [docs/HIGH_LEVEL_API.md](docs/HIGH_LEVEL_API.md) | справочник `$` API |
| [docs/tutorial-platformer.md](docs/tutorial-platformer.md) | первый платформер шаг за шагом |
| [docs/SDK.md](docs/SDK.md) | SDK, инструменты и World Editor |
| [docs/VN_MAKER.md](docs/VN_MAKER.md) | Visual Novel Maker |
| [docs/FEATURE_FREEZE.md](docs/FEATURE_FREEZE.md) | feature freeze и правила новых engine-возможностей |
| [docs/RELEASING.md](docs/RELEASING.md) | локальный релизный процесс |
