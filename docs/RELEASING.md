# Сборка и публикация

Актуализировано 2026-10-16. Общий упаковщик — `tools/release.py`: движок,
нативный `r2d-sdk`, JS/RmlUi оболочка SDK, шаблоны, реестр, лицензии и текущие docs.

## Кто что собирает

Ответственность разделена жёстко, и это не пожелание, а то, как устроены скрипты.

**GitHub Actions** (`.github/workflows/build.yml`):

* Linux x86_64 и Linux aarch64 — сборка, тесты, пакеты, суммы;
* Windows x86_64 — кросс-сборка MinGW на ubuntu-раннере (та же, что на Mos.Hub
  и GitVerse): MSVC 14.44.35207 падает внутренней ошибкой `CL.exe` в
  кодогенерации нашего проекта, проверены `/Zf`, `/Z7`, снятие `/MP` и `/O1` —
  не помогают. Windows-пакет приходит из раннера и проходит контракт упаковки;
  прогон тестов на Windows-бинарнике в CI невозможен (раннер Linux), поэтому
  шаги тестов для этой платформы отключены явно. Родная MSVC-сборка осталась
  необязательной задачей `windows-msvc-diagnostic`: она падает, пока тулчейн не
  починят, и это видно в CI. Когда MSVC заработает, платформу можно вернуть на
  `windows-2022` — артефакт при этом не меняется;
* один GitHub Release на тег `vX.Y.Z` — и только CI его создаёт;
* `SHA256SUMS.txt` по архивам, которые собрал CI.

**Mos.Hub** (`.gitlab-ci.yml`, GitLab CI, раннер с тегом `appsechub`):

* Linux x86_64 и Windows x86_64 (кросс-сборка MinGW) — сборка, тесты в обеих
  конфигурациях, пакеты;
* macOS **не собирается**: job `macos-artifacts` забирает архивы нужной версии
  из витрины `dist/` репозитория;
* Release GitLab по тегу `vX.Y.Z` со ссылками на архивы всех трёх платформ
  (`release:` + `assets: links:`), плюс релиз не создаётся, если tag ≠ версии проекта.

**GitVerse** (`.gitverse/workflows/build.yaml`, Actions-подобный формат):

* то же самое, но своим синтаксисом: `runs-on: ubuntu-latest`, артефакты через
  `actions/upload-artifact@v4`, релиз — экшеном `actions/create-release@v1`;
* один раз нужно положить секрет `GITVERSE_API_KEY` (права на создание релизов) —
  без него job релиза падает с понятной ошибкой, а не «тихо пропускает».

**Локальный рабочий Mac** — только macOS:

* сборка macOS arm64 и x86_64, тесты, пакеты, пакетный smoke;
* коммит, тег, публикация сайта;
* прикладывание macOS-архивов к уже созданному CI релизу.

Локальная машина **не** собирает Linux и Windows: это не второй CI-сервер.
`build_and_push.sh` отвергает не-macOS платформу в `PLATFORMS` и завершается
ошибкой, а не собирает её «на всякий случай» через Docker. `tools/autobuild.py`
по-прежнему умеет собирать чужие платформы в контейнере, но это инструмент
локальной проверки и паритета с CI, а не путь релиза.

Скрипты локального выпуска (`build_and_push.sh`, `push_and_deploy.sh`) и сайт
(`site/`) в git **не хранятся**: они лежат на рабочей машине и перечислены в
`.gitignore`. Публичные репозитории получают только движок, тесты, документацию
и витрину `dist/` — политику проверяет `tests/release_ownership_test.py`.

## Локальный выпуск

```sh
./push_and_deploy.sh "Описание изменений"     # доки → тесты → релиз → сайт
./build_and_push.sh "Описание изменений"      # если доки и тесты уже прогнаны
```

`build_and_push.sh` проверяет, что нового тега ещё нет ни локально, ни на
хостах, поднимает patch version **до** сборки, собирает macOS через
`tools/autobuild.py`, обновляет документы пакетов из `docs/`, пересобирает
документацию и главную сайта, коммитит дерево, ставит `vX.Y.Z` и отправляет
ветку/тег в три хоста: GitHub (`github`), hub.mos.ru (`origin`), GitVerse
(`gitverse`). Повторяющиеся push URL отправляются один раз; ошибка одного хоста
не блокирует остальные. История не переписывается.

`ALLOW_PARTIAL=1` разрешает частичный набор macOS-архивов. `SITE=0` отключает
сайт, `BUMP=0`/`TAG=0` — bump и тег, `KEEP_DIST=0` — binaries в коммит.

## Полный порядок выпуска

1. локально: macOS build + тесты + пакеты + `tests/macos_package_smoke_test.py`;
2. локально: коммит, push ветки и тега `vX.Y.Z`;
3. CI: static-гейты, затем сборка и тесты Windows/Linux в обеих конфигурациях
   (`R2D_ENABLE_RE2D=ON` и `=OFF`), SDK GUI regressions под Xvfb, упаковка;
4. CI: создаёт **ровно один** Release по тегу и выкладывает архивы Windows/Linux
   и `SHA256SUMS.txt`;
5. локально: `python3 tools/fetch_release_assets.py --yes` — скачивает
   Windows/Linux архивы CI в `dist/` (витрина должна содержать все платформы);
6. локально: `python3 tools/attach_macos_release.py` — прикладывает macOS-архивы
   к тому же релизу и пересчитывает `SHA256SUMS.txt` на все пять архивов;
7. локально: публикация сайта.

Шаги 5–6 не создают релиз: если релиза по тегу ещё нет, оба скрипта
останавливаются с понятным сообщением.

## Одна версия на проект

Версия живёт **только** в `CMakeLists.txt` (`project(... VERSION x.y.z)`).
Оттуда её читает `tools/release.py` (`read_version`) — для имени архива, `VERSION`
внутри пакета, README/AGENTS и git-тега `vX.Y.Z`; оттуда же `tools/autobuild.py`
и `tools/ci_package.py` (оба вызывают `release.py`), и `build_and_push.sh`
(`--bump`). Нативный бэкенд печатает её же: `r2d-sdk version` берёт
`PROJECT_VERSION` определением из `sdk/native/CMakeLists.txt` (не строкой в
`sdk.h`), а JS-оболочка SDK показывает ответ бэкенда, а не свою константу.
Проверки: CI-шаг «Version tag matches project version» (`GITHUB_REF_NAME ==
'v' + read_version()`, выполняется один раз в static-джобе),
`r2d-sdk version` в `build_test.py`, `VERSION` в `sdk_package_test.py`.

## Имена артефактов

Имя собирается в одном месте — `release.archive_name(platform, version)`:

| Платформа | Архив |
|---|---|
| `linux-x86_64`, `linux-aarch64` | `russiano2d-v<версия>-<платформа>.tar.gz` |
| `windows-x86_64` | `russiano2d-v<версия>-<платформа>.zip` |
| `macos-arm64`, `macos-x86_64` | `russiano2d-v<версия>-<платформа>.tar.gz` |

Плюс `SHA256SUMS.txt` — по одной строке на архив. `tools/ci_package.py`
падает, если собранный архив не совпал с контрактом, а
`release.prune_stale_archives()` убирает из каталога релиза архив той же
платформы со старым (безверсионным) именем.

## Воспроизводимость упаковки

Один и тот же commit даёт один и тот же архив: `tools/release.py` пишет
`tar.gz`/`zip` сам — время всех записей фиксировано, порядок отсортирован,
`uid`/`gid` обнулены, права 0755 только у исполняемых файлов. Тем же кодом
(`release.write_archive`) пересобирает архив и шаг обновления документов
пакета, поэтому «обновили docs — архивы пересобрались» не превращается в
другой SHA256. Проверки — `tests/agent/sdk_package_test.py` (упаковка дважды)
и `tests/package_docs_refresh_test.py` (повторное обновление документов даёт
байт-в-байт тот же архив и убирает архив со старым именем).

## GitHub CI и Releases

`.github/workflows/build.yml` запускается по тегу `vX.Y.Z` или вручную.

* `static` — доки, переносимость, контракт упаковки и проверка `tag == version`.
  Дешёвый гейт идёт первым: ревизия, где разошлась документация или имя
  артефакта, не тратит полтора часа на сборку.
* `build` — матрица `linux-x86_64`, `linux-aarch64`, `windows-x86_64`:
  обе конфигурации (`ci_verify.py --re2d on` для `build-ci` и `--re2d off` для
  `build-2d-ci`), web-экспорт отдельным шагом (без emsdk шаг печатает причину
  пропуска), на Linux — SDK GUI regressions под Xvfb и упаковка архива.
* `release` — только по тегу: проверяет, что имена архивов совпадают с
  контрактом, считает `SHA256SUMS.txt` по трём архивам (явным списком: раньше
  `sha256sum *` захватывал сам файл сумм) и создаёт **один** Release.
  Если релиз уже существует (повторный прогон), архивы перезаписываются, а
  манифест не затирается — иначе пропали бы строки macOS-архивов.
  Провал любого обязательного build/test job не даёт создать релиз.

macOS в матрице нет намеренно: сборка и тесты macOS выполняются локально на
целевой машине, а архив прикладывается к релизу шагом 6 из «Полного порядка».
До этого шага релиз неполный — так и написано в его описании.

Поддерживаемый хост macOS — Apple Silicon. Пакет `macos-x86_64` собирается
кросс-компиляцией на том же Mac и проверяется smoke-тестом через Rosetta;
если Rosetta недоступна, smoke сообщает пропуск архитектуры, а не «зелено».

## Пакетный smoke macOS

```sh
python3 tools/autobuild.py --platforms macos-arm64,macos-x86_64
python3 tests/macos_package_smoke_test.py
```

Проверяется именно пакет, а не дерево сборки: `VERSION` внутри архива,
`SHA256SUMS.txt` пакета, `russiano2d --version`, `r2d-sdk version` и headless
прогон 30 кадров. Собирать и тестировать `build/` недостаточно: релиз раздаётся
архивом.

## Сайт и документы

Исходники сайта отслеживаются в Git; секреты `site/.env.deploy`, состояние
выгрузки, generated docs/download/play остаются локальными. `site/build-site.sh`
читает текущие docs/ заново, удаляет старые generated pages, обновляет llms.txt,
llms-full.txt, sitemap, links/version и архивы. `deploy-fast.sh` после успешной
загрузки удаляет с сервера снятые doc pages, ранее учтённые в deployment manifest.
Удаление ограничено doc/, остальные удалённые локальные файлы не затрагиваются.

## Проверка результата

```sh
python3 tools/attach_macos_release.py --dry-run   # что будет приложено
gh release view vX.Y.Z --json assets --jq '.assets[].name'
```

В релизе должно быть пять архивов и `SHA256SUMS.txt` с пятью строками. Смотреть
на фактические assets, а не только на успешный локальный прогон. macOS append
signing и поддержка других платформ проверяются отдельно: локальный запуск игры
сам по себе не подтверждает пригодную для распространения подпись.

Содержимое пакета и воспроизводимость проверяются автоматически:

```sh
R2D_BINARY=build/russiano2d python3 tests/agent/sdk_package_test.py   # пакет, SHA256SUMS, VERSION, повторная упаковка
python3 tools/ci_verify.py --build-dir build --re2d on                # обе конфигурации
python3 tools/ci_verify.py --build-dir build-2d --re2d off
python3 tools/ci_verify.py --build-dir build --web                    # web-экспорт или честный skip без emsdk
python3 tests/portability_test.py                                     # M_PI/strtok_r/VLA
python3 tests/macos_package_smoke_test.py                             # пакет macOS как пакет
```

Состав архива и таблица платформ — [BUILD.md](BUILD.md), раздел «Дистрибутив».

## Mos.Hub (GitLab): пайплайн запускается только вручную

У раннеров Mos.Hub (K8s, пространство `appsechub-runners-prod`) **закрыт egress в
интернет**: `apt-get update` не достаёт `archive.ubuntu.com` (IPv6 — network
unreachable, IPv4 — timeout), а сборка тянет зависимости через CMake
`FetchContent` (SDL3, QuickJS-ng, Box2D, RmlUi, glslang, FreeType-тарболл с
`archive.ubuntu.com`). Поэтому на коммит любой job падал на первом шаге — не
из-за кода, а из-за сети раннера.

Сейчас в `.gitlab-ci.yml` стоит блок `workflow:` с правилами «только `web`,
`api`, `schedule`, `trigger`», то есть **на push, коммит и тег пайплайн не
запускается вовсе**. Файл при этом остался рабочим: джобы, стадии и релиз по
тегу на месте.

Чтобы вернуть автоматические запуски, нужно одно из двух:
1. **Открыть egress раннеру** — `archive.ubuntu.com`, `security.ubuntu.com`,
   `github.com`, `codeload.github.com` (тогда достаточно удалить блок
   `workflow:` и вернуть `apt-get`-шаги);
2. **Свой образ** — предустановленный тулчейн + прогретый кэш `FetchContent`
   (`FETCHCONTENT_BASE_DIR`) и `image:` из реестра Mos.Hub; тогда джобы работают
   без сети вообще.

Пока ни того, ни другого нет, сборка Linux/Windows на Mos.Hub не выполняется:
Windows-архивы делает GitHub Actions (MinGW-кросс-компиляция), Linux — там же,
macOS — на рабочем Mac и лежит в `dist/`.
