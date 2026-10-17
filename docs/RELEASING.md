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
сайт, `BUMP=0`/`TAG=0` — bump и тег, `KEEP_DIST=0` — binaries в коммит,
`NOTES=0` — сборку заметок из коммитов (см. ниже).

### SDK artifacts в релизе

`build_and_push.sh` перед упаковкой прогоняет SDK-гейты (`api generate`,
`api check`, `lint game`, `validate game`, `doctor`, recipes), а
`tools/autobuild.py` после сборки macOS-движка перегенерирует
`api.schema.json`, `russiano2d.d.ts`, `docs/api/API_REFERENCE.md` **новым**
runtime — иначе schema/docs уехали бы с версией предыдущего бинарника.
Generated artifacts входят в корень пакета, `docs/api` и `docs/recipes` —
в каталог `docs/`. Сайт (`site/build-doc.py` + `tools/public_docs.py`)
публикует SDK-гайды, API reference и recipes отдельной группой `SDK`.

## Заметки релиза из коммитов

Релизную секцию CHANGELOG больше не пишут руками: её собирает
`tools/release_notes.py` из коммитов диапазона `предыдущий тег..HEAD`.

```sh
python3 tools/release_notes.py --dry-run          # компактные заметки, ничего не писать
python3 tools/release_notes.py                    # dist/RELEASE_NOTES_<версия>.md (компактно)
python3 tools/release_notes.py --write-changelog  # + подробная секция в CHANGELOG.md
python3 tools/release_notes.py --full --dry-run   # тела у всех групп (разбор полётов)
python3 tools/release_notes.py --from v0.1.35 --version 1.2.0 --date 2026-10-16
```

`build_and_push.sh` вызывает генератор сам — **после bump и до коммита** (шаг
«Релизные заметки»), поэтому релизный коммит уже содержит и секцию в
`CHANGELOG.md`, и файл `dist/RELEASE_NOTES_<версия>.md`. Путь печатается в логе;
`NOTES=0` отключает шаг, падение генератора останавливает выпуск.

Что делает генератор:

* берёт `git log <прошлый тег>..HEAD --no-merges` (тег вида `vX.Y.Z`, достижимый
  из HEAD; `--from` переопределяет, без тегов — вся история);
* раскладывает коммиты по группам правилом «первое совпадение» —
  `GROUP_RULES` в начале `tools/release_notes.py`: **Исправления → Добавлено →
  Удалено и изменено → Документация → Тесты и гейты → Сборка и версии →
  Прочее**. Каждый коммит попадает ровно в одну группу, порядок групп — порядок
  правил. Сопоставление идёт **сначала по теме коммита и только потом по телу**:
  в теле лежит фон («попутно исправлена устаревшая строка»), из-за которого
  коммит про целую новую подсистему уезжал в «Исправления», а «Версия: линия
  1.x» — в «Добавлено». Ключевое слово ищется с начала слова, поэтому «нов» не
  ловит «обновлять». Группа «Удалено и изменено» — для ломающих изменений
  замороженной поверхности (`$.net.host_` и подобных): их видно на странице
  релиза, а не в общем списке;
* ставит в шапку секции число коммитов: «N коммитов в релизе»;
* печатает **два формата** — и это разные вещи:
  * `dist/RELEASE_NOTES_<версия>.md` (витрина для страницы релиза) — **компактный**:
    группа, в ней одна строка на коммит — тема и короткий хеш, без тел;
  * секция в `CHANGELOG.md` — **подробный**: тела коммитов есть у групп
    «Исправления» и «Добавлено», у «Документации», «Тестов и гейтов», «Сборки и
    версий» и «Прочего» — только тема и хеш (в CHANGELOG за подробностями и
    приходят, но не за пересказом всего `git log`);
  * `--full` возвращает «как было» — тела у всех групп в обоих форматах (для
    разбора полётов, не для публикации).

Тело коммита в подробной форме — до 12 непустых строк, длинные строки
подрезаются (220 символов).

**Рукописный текст не теряется.** Разделы `## Не выпущено — …`, появившиеся после
прошлого тега, переезжают под «### Подробности (написано вручную)» внутрь секции
версии; у них опускается только уровень заголовка (`##` → `###`), текст остаётся
байт в байт. Разделы, которые были в CHANGELOG уже на прошлом теге, остаются на
месте: `--manual new|all|none` (по умолчанию `new`) управляет этим выбором.

Повторный прогон идемпотентен: машинная часть секции лежит между маркерами
`release-notes:begin` / `release-notes:end` и перезаписывается, всё вне маркеров
(в том числе «Подробности») не трогается. Если генератор сгруппировал неудачно —
правьте текст **вне маркеров** или меняйте `GROUP_RULES`; руками секцию не
дублируйте, следующий прогон перезапишет только машинную часть.

Секция версии защищена тестом `tests/release_notes_test.py` (временный
git-репозиторий): диапазон, группировка, «число буллетов == числу коммитов»,
сохранность рукописных разделов, `--dry-run` ничего не пишет, идемпотентность.

## Куда попадают заметки

`dist/RELEASE_NOTES_<версия>.md` лежит в релизном коммите и уезжает в тег, поэтому
доступен всем трём хостингам без артефактов:

* **GitHub** — `.github/workflows/build.yml`, job `release`: тело релиза
  собирается из этого файла (`gh release create --notes-file`) плюс приписка про
  macOS, который прикладывается отдельным шагом;
* **GitLab/Mos.Hub** — `.gitlab-ci.yml`, job `release`: декларативный
  `release:` не умеет читать описание из файла, поэтому полные заметки приложены
  ссылкой «Заметки релиза» (`/-/raw/<тег>/dist/RELEASE_NOTES_<версия>.md`);
* **GitVerse** — `.gitverse/workflows/build.yaml`, job `release`: шаг собирает
  `release-body.md` из файла заметок, релиз создаётся с `body_path`.

Если файла заметок в теге нет (например, выпуск делали в обход
`build_and_push.sh`), все три пайплайна не падают, а создают релиз с одной
припиской и пишут об этом в лог.

## Что попадает в поставку, а что остаётся в репозитории

В пакет (`dist/<платформа>/` и архив) едет только **публичная** документация.
Правило одно на три места — константа `INTERNAL_DOCS` в `tools/release.py`:
упаковка архива (`package_platform`), обновление каталогов `dist/`
(`tools/agents_doc.py`) и склейка приложения `AGENTS.md` (`agents_doc_files`).
Одно правило на все три точки — потому что иначе документ, исключённый из
архива, вернулся бы в поставку приложением к `AGENTS.md`.

**В поставку не входят** (это наш рабочий процесс, а не контракт для читателя):

| Документ | Почему внутренний |
|---|---|
| `docs/internal/**` (сейчас `docs/internal/NATIVE.md`) | справочник C-биндингов `engine.*` — уровень разработчика движка, не пользователя SDK |
| `docs/EXTERNAL_FEEDBACK.md` | транскрипт отчёта внешней команды BASHNYA (их пути и числа) и наши решения по нему |
| `docs/PRODUCTION_POLISH.md` | рабочее ТЗ и журнал приёмки с владельцами файлов и галочками |
| `docs/PRODUCTION_PLAN.md` | журнал порядка работ и фактического состояния пунктов |
| `docs/SDK_IMPLEMENTATION_GAPS.md` | наш бэклог SDK с условиями приёмки для нас (публичная часть возможностей — в `docs/SDK.md`) |
| `docs/SDK_VERIFICATION.md` | журнал прогона проверок на нашей машине, а не контракт |
| `docs/re2d/RE2D_DOCUMENT_ACCEPTANCE_AUDIT.md`, `RE2D_RENDERER_IMPLEMENTATION_PLAN.md`, `RE2D_WORLD_CPU_HISTORY.md`, `GZDOOM_REFERENCE_RULES.md`, `GZDOOM_VISUAL_OBSERVATIONS.md` | аудит приёмки документов, план реализации, история замеров и заметки по чужому движку; публичная часть `docs/re2d/` (форматы, миграция, поведение рендера) остаётся |
| `SDK_HANDOFF.md` (корень) | журнал работы над SDK: что делали, чем проверяли, что осталось |

**Остаётся публичным**: всё прочее в `docs/` (API и справочники, архитектура,
философия, гайды и туториалы, форматы, производительность, план развития,
спецификация `PRODUCTION_READINESS.md`), плюс `AGENTS.md`, `README.md`,
`CHANGELOG.md`, `THIRD_PARTY_NOTICES.md`, `LICENSE`.

Важно: **исходники движка (`src/**`) в пакет не входят** — `AGENTS.md` и
документы описывают поведение, а не реализацию; ссылки на файлы реализации в
публичных текстах даны как имена (`src/script.c`), а не как ссылки.

Проверяет `tests/package_docs_refresh_test.py`: пакет собирается во временном
каталоге, и тест требует, чтобы внутренних документов в нём не было ни в
`docs/`, ни внутри `AGENTS.md`, а публичные — все на месте.

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
   без сети вообще. Состав такого образа уже разобран, чтобы не собирать его
   заново с нуля (заготовка `docker/ci/Dockerfile` удалена как мёртвая — здесь
   то, что в ней было по делу):
   * **пакеты**: `build-essential cmake ninja-build pkg-config git python3
     libfreetype-dev patchelf libx11-dev libxext-dev libxrandr-dev
     libxcursor-dev libxi-dev libxfixes-dev libxss-dev libxtst-dev
     libxkbcommon-dev libwayland-dev libegl1-mesa-dev libgl1-mesa-dev
     libasound2-dev libpulse-dev libudev-dev libdbus-1-dev
     libcurl4-openssl-dev xvfb mesa-vulkan-drivers libgl1-mesa-dri` — это
     Linux-джоба; для MinGW-кросс-сборки добавляются `mingw-w64 xz-utils curl
     zip unzip ca-certificates glslang-tools spirv-cross` (последние два —
     хост-инструменты шейдеров, `cmake/Shaders.cmake` требует их именно для
     кросс-сборки);
   * **прогретый кэш**: `/opt/r2d-deps` как `FETCHCONTENT_BASE_DIR`. Пины брать
     не из головы, а из наших `cmake/*.cmake` — там 16 объявлений
     `FetchContent_Declare` (SDL3, SDL3_image, SDL3_mixer, SDL3_net, quickjs,
     box2d, RmlUi, visibility, stb, glslang, SPIRV-Cross, r2d_freetype,
     r2d_steam_audio, tracy, r2d_tinyexr, zstd). Прогрев делается штатным
     `cmake -DFETCHCONTENT_BASE_DIR=...` по мини-проекту с теми же
     объявлениями: важны не только скачанные исходники, но и ШТАМПЫ шагов
     загрузки в `<имя>-subbuild`, иначе CMake полезет в сеть повторно;
   * джобы запускаются с `-DFETCHCONTENT_BASE_DIR=/opt/r2d-deps
     -DFETCHCONTENT_UPDATES_DISCONNECTED=ON` (на CMake ≥ 3.30 ещё
     `-DFETCHCONTENT_FULLY_DISCONNECTED=ON`; в ubuntu:24.04 CMake 3.28, где
     второго флага нет);
   * FreeType лежит отдельным тарболлом с `archive.ubuntu.com`: Linux-джоба
     берёт его из `libfreetype-dev`, а Windows-джоба собирает статически под
     MinGW — значит тарболл нужен в образе (`/opt/r2d-cache/freetype.tar.xz`,
     SHA256 сверить с пином `URL_HASH` из `cmake/Dependencies.cmake`);
   * джобу `release` нельзя оставлять на `registry.gitlab.com/gitlab-org/release-cli`:
     этот образ тянется из интернета и без egress недоступен. Рабочая замена —
     создавать релиз из своего образа через API самого Mos.Hub
     (`curl "$CI_API_V4_URL/projects/$CI_PROJECT_ID/releases"` с
     `JOB-TOKEN: $CI_JOB_TOKEN`): сервер GitLab раннеру доступен даже без
     внешней сети, в отличие от реестра gitlab.com.

Пока ни того, ни другого нет, сборка Linux/Windows на Mos.Hub не выполняется:
Windows-архивы делает GitHub Actions (MinGW-кросс-компиляция), Linux — там же,
macOS — на рабочем Mac и лежит в `dist/`.
