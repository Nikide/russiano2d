# Сборка и публикация

Актуализировано 2026-10-19. Релиз собирается и публикуется **локально** на
Apple Silicon Mac командой `build_and_push`. GitHub Actions больше не создаёт
релизы и не публикует их.

## Модель

```text
build_and_push (интерактивно)
      |
      v
Xmake: macOS arm64 / macOS x86_64 / Windows x86_64
      |        (Linux x86_64 — вне локального релиза: сборка на целевой ОС)
      v
API schema / TypeScript / reference из нового бинарника
      |
      v
dist/<platform>/ + dist/*.tar.gz|*.zip + SHA256SUMS.txt
      |
      v
валидация пакетов -> Unity tests -> commit -> tag vX.Y.Z
      |
      +--> GitHub  (git + release assets)
      +--> GitVerse (git + release assets)
      |
      v
сайт: только документация, скачивание — GitHub Releases
```

Один архив на платформу уходит в оба сервиса. Повторная сборка под
конкретный сервис запрещена: SHA256 должен доказывать идентичность.

## Команда

```bash
build_and_push                  # человек: вопросы + план + подтверждение
build_and_push --dry-run        # план и проверка инструментов, без релиза
build_and_push --message "..." --version v1.e.0 --yes   # автоматизация
```

Интерактивно команда спрашивает:

```text
Release message:
>

Release version [1.2.14]:
>
```

Версия по умолчанию — текущая +1 к patch. Принимается обычный формат `X.Y.Z`,
а также новый формат `X.e.Z` (например, `v1.e.0`). Ведущая `v` необязательна
и нормализуется в тег с `v`. Формат проверяется до любых тяжёлых действий.

Перед сборкой печатается план (message, current, release, targets, publish) и
задаётся `Continue? [Y/n]`.

## Инструменты

* Xmake — канонический build system проекта.
* Zig — opt-in кросс-компиляция Linux x86_64 (`R2D_BUILD_LINUX=1`);
  локальная Zig-сборка Linux временно не входит в релиз (зависает на машине
  релиза — Linux собирается на целевой ОС).
* Проектные сборка и тестовые цели определены в Xmake; отдельной CMake-сборки проекта нет.
* Docker не используется.

`tools/release_build.sh` собирает три платформы в `dist/<platform>/`:

```text
dist/
    macos-arm64/      {r2d, editor/, templates/, docs/}
    macos-x86_64/     {r2d, editor/, templates/, docs/}
    windows-x86_64/   {r2d.exe, editor/, templates/, docs/}
    russiano2d-vX.Y.Z-macos-arm64.tar.gz
    russiano2d-vX.Y.Z-macos-x86_64.tar.gz
    russiano2d-vX.Y.Z-windows-x86_64.zip
    SHA256SUMS.txt
```

Linux x86_64 из локального релиза временно исключён (`R2D_BUILD_LINUX=1`
возвращает его в `release_build`). На Linux движок собирается штатно:
`xmake f -p linux -a x86_64 -m release -o build-linux && xmake build -y`.

Имена архивов сохраняют существующий контракт `release.archive_name()`.
После смены версии и сборки команда `scripts/api_docs_pipeline.py refresh`
обновляет `api.schema.json`, `russiano2d.d.ts` и `docs/api/API_REFERENCE.md`
из нового macOS arm64 бинарника. Это происходит **до упаковки**: версия
в сгенерированных файлах должна совпадать с версией runtime. При сбое
восстанавливаются исходные `VERSION`, `xmake.lua` и все три API-файла.
Каждый архив содержит единственный executable `r2d` в корне и ресурсы Editor,
шаблоны, публичную документацию и runtime данные. Этот бинарник открывает
Project Manager/Editor, запускает игру и выполняет CLI-команды.

В пакетах игра по умолчанию — демо VN `game_vn/` (внутри пакета это `game/`); платформер из корневого `game/` в релиз не попадает.

## Проверки перед тегом

`build_and_push` не создаёт тег, пока не выполнены ВСЕ шаги:

1. собраны все платформы релиза: macOS arm64/x86_64 и Windows x86_64
   (провал любой — стоп, тег не создаётся); Linux — сборка на целевой ОС;
2. `tools/release.py --package-only` собрал архивы в `dist/`;
3. `tools/ci_package_check.py` проверил каждый архив: открывается, `VERSION`,
   единственный `r2d` executable, Editor, шаблоны, лицензии, отсутствие `.DS_Store`/`__pycache__`/сборочного
   мусора;
4. `SHA256SUMS.txt` сгенерирован по трём архивам;
5. Пройдены native/JS Xmake tests и обязательные release gates из
   `tools/release_tests.sh`: синхронизация API-документации, проверки
   документации, portability, package ownership, архитектуры бинарников,
   чек-листы и hygiene;
6. Для локального macOS-релиза тот же набор проверяет собранный `r2d`:
   `commands --json`, `lint game --json`, `validate game --json`, строгий
   каталог сниппетов и актуальность матрицы.

Только после этого создаются commit и annotated tag `vX.Y.Z` или `vX.e.Z`.

Пример провала: Windows не собрался → тег не создаётся, версия возвращается.

## Push

Remote'ы проекта:

| Сервис | Git remote | Примечание |
|---|---|---|
| GitHub | `github` | https://github.com/Nikide/russiano2d |
| GitVerse | `gitverse` | https://gitverse.ru/Nikide/russiano2d |

`tools/publish_refs.py` пушит ветку и тег независимо по каждому URL; провал
одного не скрывает остальные. В итоговом отчёте видно, какой remote принял refs.
Публикация на hub.mos отключена; URL этого хоста блокируется даже при передаче
через пользовательский список remote.

## Релизы и ассеты

`tools/release_publish.py` публикует одни и те же файлы из `dist/`:

* **GitHub** — `gh release create/edit` + `gh release upload --clobber`
  (только архивы проекта и SHA256SUMS; вручную приложенные ассеты не удаляются);
* **GitVerse** — публичный API `https://api.gitverse.ru`,
  `Authorization: Bearer`, asset upload `multipart attachment`;

Токены:

```text
GitHub     — gh auth (локальный keyring)
GitVerse   — GITVERSE_TOKEN или GITVERSE_API_KEY
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
GitHub и GitVerse. Интерактивное `Release message` становится
сообщением релизного коммита.

## Сайт

Сайт (`site/`, локальный, не в git) публикует только документацию, картинки,
CSS/JS и metadata. Релизные архивы сайт больше не хранит и не загружает:
`site/sync-downloads.sh` только чистит старые ссылки, кнопки скачивания ведут
на <https://gitverse.ru/Nikide/russiano2d/releases>. Исходный код также доступен
на <https://github.com/Nikide/russiano2d>. Ссылки не зависят от версии.

## CI

GitHub Actions — **только валидация**:

* `ci.yml`: Linux Xmake build, Xmake tests, API docs и CLI smoke; Windows
  MinGW cross-build;
* `quality.yml`: docs/policy/hygiene; локальный release gate повторяет эти
  проверки, чтобы их статус не оставался только advisory.

Релизных workflow нет. Тег, созданный локально, не запускает сборку пакетов в
GitHub Actions. GitLab CI отключён, чтобы не запускать удалённые CMake jobs;
локальный `build_and_push` — единственный источник релизных пакетов для GitHub
и GitVerse.

## Сборка

`xmake.lua` собирает одну пользовательскую цель `r2d`. Корневой `VERSION`
подаётся и в бинарник, и в релизный пакет. Native тестовые цели объявлены в
`xmake/tests.lua` и запускаются командой `xmake test`. Полный список release
gates см. в `tools/release_tests.sh`; изменяя workflow качества, синхронно
обновляйте этот список и `tests/release_ownership_test.py`.

macOS/Windows/Linux сборочные конфигурации выбираются через Xmake. Внешние
зависимости могут вызывать собственные сборочные инструменты внутри рецептов
Xmake; конфигурация, компиляция и тестовые цели самого Russiano2D выполняются
через Xmake.
