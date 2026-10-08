# Выпуск и проверка поставки

Сверка: 2026-10-08. Источник текущей схемы — [build_and_push.sh](../build_and_push.sh),
[tools/autobuild.py](../tools/autobuild.py), [tools/release.py](../tools/release.py)
и [.github/workflows/build.yml](../.github/workflows/build.yml).

## 1. Репозитории и CI

| Remote | Адрес | Текущая роль |
|---|---|---|
| `github` | `https://github.com/Nikide/russiano2d.git` | default remote скрипта публикации и GitHub Actions |
| `origin` | `git@hub.mos.ru:dem4ev48/russiano2d.git` | прежний основной fetch; push также на GitVerse |
| `gitverse` | `git@gitverse.ru:Nikide/russiano2d.git` | сохранённый отдельный remote |

`build_and_push.sh` по умолчанию использует `REMOTE=github`. Переопределение
remote — явное решение вызывающего; наличие двух push URL у `origin` не означает,
что текущий скрипт всегда публикует на оба старых хоста.

Единственный активный workflow находится в `.github/workflows/build.yml`:
version tags `vX.Y.Z`, Linux Debug build, native tests, все JS suites, SDK
core/CLI/expression/batch и native agent parity под Xvfb. SDK reports сохраняются
как CI artifacts. Windows/macOS/release jobs этим workflow не выполняются.
Удалённый результат CI в текущем аудите не подтверждён.

Старые GitLab/GitVerse конфигурации находятся в [ci-archive](ci-archive/README.md)
с `.disabled` суффиксами и не являются действующей схемой CI.

## 2. Проверка до выпуска

```bash
cmake --build build --parallel 4
python3 tools/run_tests.py
python3 tests/doc_claims_test.py
python3 tests/doc_coverage_test.py
python3 tests/duplicate_keys_test.py
python3 tests/repository_hygiene_test.py
```

Также запускать C test executables и `tests/js/*_test.mjs` через bundled qjs;
`ctest` пока не имеет зарегистрированных тестов. Визуальные изменения требуют
проверки настоящего runtime. `skip` — не подтверждение работоспособности.

Должны совпадать версия, бинарник, документация и состав пакета. Документы
старого готового бинарника не обновляются отдельно под новые исходники.
Проверка платформы macOS не заменяет Linux/Windows/Web smoke tests.

## 3. Подготовка и упаковка

Для просмотра плана без записи/публикации:

```bash
python3 tools/release.py --dry-run
python3 tools/autobuild.py --help
```

`release.py` поддерживает `--version`, `--platform`, `--build-dir`, `--out`,
`--with-demos`; `--package-only --binary PATH` упаковывает уже собранный бинарник.
`--force` заменяет существующий каталог пакета, `--yes` снимает интерактивный
вопрос. Эти ключи применяются только при намеренном выпуске.

Пакет содержит engine, game/assets, platform README, AGENTS.md из `docs/`,
CHANGELOG, LICENSE, THIRD_PARTY_NOTICES и SHA256SUMS. Рядом стоящий `lib/`
копируется; macOS-зависимости собираются packager в пакет.
Системные `.DS_Store`, Python caches и local state исключаются при копировании.

**SDK пока не входит в packager.** Текущий SDK запускается из checkout;
проверенная упаковка C CLI + оболочки RmlUi/JS + реестра и launch из распакованной
папки — отдельная задача [TASKS.md](TASKS.md) §5. Не объявлять готовые `dist/`
снимки 0.1.22 поставкой нового SDK.

## 4. Публикация

`build_and_push.sh` меняет версию, собирает платформы, обновляет package docs,
коммитит и пушит текущую ветку и новый annotated version tag. Сайт готовится
существующими локальными инструментами; загрузка идёт после подтверждённого push.
Это скрипт выпуска, а не команда для обычной проверки.

Существующие version tags не переписываются. Не использовать `git push --mirror`:
он может удалить remote refs. История и старые remotes сохраняются.
Секреты сайта находятся вне tracked файлов (`site/` игнорируется целиком).

## 5. Контроль готовых пакетов

`dist/` намеренно versioned: бинарники и release archives — продукт проекта.
Они не удаляются вместе с обычными build caches. `SHA256SUMS.txt` платформы
описывает файлы пакета; `dist/SHA256SUMS.txt` — release archives.

```bash
cd dist/macos-arm64
shasum -a 256 -c SHA256SUMS.txt
```

При очистке release archives необходимо обновить внутренний manifest и внешний
hash, сохранив payload бинарников и лицензионные файлы. Автоматическая сверка
архивов/каталогов — `tests/repository_hygiene_test.py`.

Изменения текущего аудита остаются локальными: выпуск, push и загрузка сайта
не выполнялись.
