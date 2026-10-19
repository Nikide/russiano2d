# Сборка и публикация

Актуализировано 2026-10-19. Релиз собирается и публикуется **локально** на
Apple Silicon Mac командой `build_and_push`. GitHub Actions больше не создаёт
релизы и не публикует их.

## Модель

```text
build_and_push (интерактивно)
      |
      v
Xmake: macOS arm64 / macOS x86_64 / Linux x86_64 / Windows x86_64
      |        (Linux/Windows — Zig cross, без Docker)
      v
dist/<platform>/ + dist/*.tar.gz|*.zip + SHA256SUMS.txt
      |
      v
валидация пакетов -> Unity tests -> commit -> tag vX.Y.Z
      |
      +--> GitHub  (git + release assets)
      +--> GitVerse (git + release assets)
      +--> hub.mos (git + release assets)
      |
      v
сайт: только документация, скачивание — GitHub Releases
```

Один архив на платформу уходит во все три сервиса. Повторная сборка под
конкретный сервис запрещена: SHA256 должен доказывать идентичность.

## Команда

```bash
build_and_push                  # человек: вопросы + план + подтверждение
build_and_push --dry-run        # план и проверка инструментов, без релиза
build_and_push --message "..." --version 1.2.14 --yes   # автоматизация
```

Интерактивно команда спрашивает:

```text
Release message:
>

Release version [1.2.14]:
>
```

Версия по умолчанию — текущая +1 к patch. Можно ввести `1.3.0`, `2.0.0` или
`v1.3.0`; ведущая `v` не обязательна и нормализуется в тег `vX.Y.Z`.
Синтаксис `X.Y.Z` проверяется до любых тяжёлых действий.

Перед сборкой печатается план (message, current, release, targets, publish) и
задаётся `Continue? [Y/n]`.

## Инструменты

* Xmake — канонический build system проекта.
* Zig — кросс-компиляция Linux x86_64 и Windows x86_64 (`--toolchain=zigcc`).
* CMake — только внутри сторонних пакетов/переходного периода; второй
  релизной сборки Russiano2D из CMake нет.
* Docker не используется.

`tools/release_build.sh` собирает четыре платформы в `dist/<platform>/`:

```text
dist/
    macos-arm64/      {russiano2d, r2d-sdk, russiano2d-sdk}
    macos-x86_64/
    linux-x86_64/
    windows-x86_64/   {*.exe}
    russiano2d-vX.Y.Z-macos-arm64.tar.gz
    russiano2d-vX.Y.Z-macos-x86_64.tar.gz
    russiano2d-vX.Y.Z-linux-x86_64.tar.gz
    russiano2d-vX.Y.Z-windows-x86_64.zip
    SHA256SUMS.txt
```

Имена архивов сохраняют существующий контракт `release.archive_name()`.

В пакетах игра по умолчанию — демо VN `game_vn/` (внутри пакета это `game/`); платформер из корневого `game/` в релиз не попадает.

## Проверки перед тегом

`build_and_push` не создаёт тег, пока не выполнены ВСЕ шаги:

1. собраны все четыре платформы (провал любой — стоп, тег не создаётся);
2. `tools/release.py --package-only` собрал архивы в `dist/`;
3. `tools/ci_package_check.py` проверил каждый архив: открывается, `VERSION`,
   бинарники, `sdk/`, лицензии, отсутствие `.DS_Store`/`__pycache__`/сборочного
   мусора;
4. `SHA256SUMS.txt` сгенерирован по четырём архивам;
5. Unity tests прошли (`tools/release_tests.sh`: `xmake test`; в переходный
   период — нативный macOS CTest-набор CMake, тот же Unity).

Только после этого создаются commit и annotated tag `vX.Y.Z`.

Пример провала: Windows не собрался → тег не создаётся, версия возвращается.

## Push

Remote'ы проекта:

| Сервис | Git remote | Примечание |
|---|---|---|
| GitHub | `github` | https://github.com/Nikide/russiano2d |
| hub.mos | `origin` (основной) | GitLab, `dem4ev48/russiano2d` |
| GitVerse | `gitverse` | https://gitverse.ru/Nikide/russiano2d |

`tools/publish_refs.py` пушит ветку и тег независимо по каждому URL; провал
одного не скрывает остальные. В итоговом отчёте видно, какой remote принял refs.

## Релизы и ассеты

`tools/release_publish.py` публикует одни и те же файлы из `dist/`:

* **GitHub** — `gh release create/edit` + `gh release upload --clobber`
  (только архивы проекта и SHA256SUMS; вручную приложенные ассеты не удаляются);
* **GitVerse** — публичный API `https://api.gitverse.ru`,
  `Authorization: Bearer`, asset upload `multipart attachment`;
* **hub.mos** — GitLab API v4: release + project uploads + asset links.

Токены:

```text
GitHub     — gh auth (локальный keyring)
GitVerse   — GITVERSE_TOKEN или GITVERSE_API_KEY
hub.mos    — HUB_MOS_TOKEN или GITLAB_TOKEN
```

Локально токены удобно держать в `.env.release` (права 600, шаблон
`.env.*` в `.gitignore`): `build_and_push` сам его подхватывает. Файл
никогда не коммитится. Если токена нет, сервис получает статус
`skipped-no-token` и итоговый отчёт помечает релиз как PARTIAL — это не
маскируется под успех. Git-тег при этом уже отправлен (это тоже видно).

Повторный запуск безопасен: релиз не дублируется, CI-архивы перезаписываются
осознанно, посторонние ассеты не трогаются.

## Release notes

Один источник — `tools/release_notes.py` (запускается до сборки,
`dist/RELEASE_NOTES_<version>.md` + секция CHANGELOG). Этот же текст получают
GitHub, GitVerse и hub.mos. Интерактивное `Release message` становится
сообщением релизного коммита.

## Сайт

Сайт (`site/`, локальный, не в git) публикует только документацию, картинки,
CSS/JS и metadata. Релизные архивы сайт больше не хранит и не загружает:
`site/sync-downloads.sh` только чистит старые ссылки, кнопки скачивания ведут
на <https://github.com/Nikide/russiano2d/releases>. Ссылки не зависят от версии.

## CI

GitHub Actions — **только валидация**:

* `ci.yml`: Linux native build + Unity tests (RE2D on/off), Windows MinGW
  cross-build, MSVC diagnostic;
* `quality.yml`: docs/policy/hygiene (не блокирует релиз).

Релизных workflow нет. Тег, созданный локально, не запускает сборку пакетов в
CI; GitLab/GitVerse пайплайны тоже не создают релизы (только проверяют сборку).

## Статус миграции

Инструменты: `xmake 3.1.2`, `zig 0.17.0`, `glslang 16.6.0`,
`spirv-cross 1.4.363`. `xmake.lua` уже собирает **macOS arm64 и x86_64** из
чистого build-каталога: движок, `r2d-sdk` и `russiano2d-sdk`, с генерацией
JS/иконок/сплэша/шейдеров через `tools/xmake_generate.sh`.

**Windows x86_64 собирается локально** связкой Homebrew `mingw-w64` + CMake 3.31
(`xmake f -p mingw -a x86_64`): `russiano2d.exe`, `r2d-sdk.exe`,
`russiano2d-sdk.exe`; пакет `dist/russiano2d-v1.2.13-windows-x86_64.zip`
проходит `ci_package_check`. Zig для Windows не подходит: его `cc` не умеет
RC/`windows.h`.

**Linux x86_64 собирается локально**: Zig cc, статический X11-стек
(libtool принудительно static), изолированный от Homebrew CMake-поиск,
`SDL_X11_SHARED`. Пакет `dist/russiano2d-v1.2.13-linux-x86_64.tar.gz`
проходит `ci_package_check`; ELF имеет только libc/libm/pthread/dl и не
содержит `/opt/homebrew` путей. Unity-тесты: 179/179 на нативной macOS-сборке.
