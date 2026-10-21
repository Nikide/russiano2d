# Сборка и запуск

## Единственный бинарник

Проект собирает один пользовательский executable — `r2d`. Он запускает игры,
открывает Project Manager/Editor и предоставляет CLI-команды, которые
используют те же native операции, что и интерфейс редактора. Отдельные SDK,
runtime и Editor приложения не собираются и не входят в релиз.

```bash
# macOS arm64; для других платформ выберите соответствующие -p/-a
xmake f -p macosx -a arm64 -m release -o build-xmake/macos-arm64
xmake build -y -j 8 r2d

export R2D_BINARY=build-xmake/macos-arm64/macosx/arm64/release/r2d
"$R2D_BINARY"                         # Project Manager / Editor
"$R2D_BINARY" edit path/to/project    # открыть проект
"$R2D_BINARY" --game path/to/project # запустить игру
"$R2D_BINARY" commands               # список CLI-команд
```

На Linux:

```bash
xmake f -p linux -a x86_64 -m release -o build-xmake/linux-x86_64
xmake build -y -j 8 r2d
```

Параметры релизной упаковки и целевых платформ описаны в
[RELEASING.md](RELEASING.md). CMake-конфигурации проекта удалены; зависимости,
которые используют собственную систему сборки, управляются рецептами Xmake.

Локальный релиз дополнительно запускает документальные, упаковочные и runtime
гейты из `tools/release_tests.sh`. Для ручного прогона набора задайте
`R2D_BINARY` на актуальную сборку `r2d`; сам release runner передаёт туда
собранный macOS arm64 бинарник автоматически.

## Запуск игры без редактора

Игровой проект остаётся обычным Code-first JavaScript проектом. Его можно
запускать напрямую движком, без открытия Editor:

```bash
"$R2D_BINARY" --game games/my-game
```

Для headless-автоматизации доступен agent protocol:

```bash
"$R2D_BINARY" --game games/my-game --agent --headless --fixed-dt 0.0166666667
```

Сборка самостоятельного игрового executable:

```bash
"$R2D_BINARY" build --project games/my-game --entry main.js --out mygame
./mygame
```

Скрипты используют публичный `$` API и QuickJS; Editor не требуется при
запуске или распространении игры. Для игрового API см.
[HIGH_LEVEL_API.md](HIGH_LEVEL_API.md), для автоматизации —
[AGENT_API.md](AGENT_API.md).

## Версия и релизный пакет

Единый источник версии — корневой `VERSION`. Пакет содержит `r2d`, Editor,
шаблоны проектов, публичную документацию и необходимые runtime-данные. SDK
интерфейс и второй executable в поставку не входят.
