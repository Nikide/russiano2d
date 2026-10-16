# Сборка и публикация

Актуализировано 2026-10-09. Общий упаковщик — `tools/release.py`: движок,
нативный `r2d-sdk`, JS/RmlUi оболочка SDK, шаблоны, реестр, лицензии и текущие docs.

## Локальный выпуск

```sh
./build_and_push.sh "Описание изменений"
```

Скрипт проверяет новый тег, поднимает patch version до сборки, собирает пять
платформ через `tools/autobuild.py`, обновляет документы пакетов из docs/,
пересобирает документацию и главную сайта, WebGPU demos при наличии toolchain,
коммитит текущее дерево, создаёт `vX.Y.Z` и отправляет ветку/тег в три хоста:
GitHub (`github`), hub.mos.ru (`origin`), GitVerse (`gitverse`). Повторяющиеся
push URL отправляются один раз. Ошибка одного хоста не блокирует другие и сайт;
итоговый ненулевой код сообщает о частичной публикации. История не переписывается.

Локальная сборка использует macOS toolchain для arm64/x86_64 и Docker для
Linux x86_64/aarch64 и Windows x86_64. Сборочная ошибка по умолчанию отменяет
коммит/публикацию и возвращает версию. `ALLOW_PARTIAL=1` разрешает частичный
набор, `PLATFORMS` задаёт явный список. `REMOTES` переопределяет три направления,
`SITE=0` отключает сайт, `BUMP=0`/`TAG=0` отключают bump/tag.

## Одна версия на проект

Версия живёт **только** в `CMakeLists.txt` (`project(... VERSION x.y.z)`).
Оттуда её читает `tools/release.py` (`read_version`) — для имени архива, `VERSION`
внутри пакета, README/AGENTS и git-тега `vX.Y.Z`; оттуда же `tools/autobuild.py`
и `tools/ci_package.py` (оба вызывают `release.py`), и `build_and_push.sh`
(`--bump`). Нативный бэкенд печатает её же: `r2d-sdk version` берёт
`PROJECT_VERSION` определением из `sdk/native/CMakeLists.txt` (не строкой в
`sdk.h`), а JS-оболочка SDK показывает ответ бэкенда, а не свою константу.
Проверки: CI-шаг «Validate version tag» (`GITHUB_REF_NAME == 'v' + read_version()`),
`r2d-sdk version` в `build_test.py`, `VERSION` в `sdk_package_test.py`.

## Воспроизводимость упаковки

Один и тот же commit даёт один и тот же архив: `tools/release.py` пишет
`tar.gz`/`zip` сам — время всех записей фиксировано, порядок отсортирован,
`uid`/`gid` обнулены, права 0755 только у исполняемых файлов. Поэтому повторная
упаковка того же дерева **не меняет содержимое** (ни SHA256 архива, ни
`SHA256SUMS.txt`), а не только список файлов. `--with-demos` — единственное, что
добавляет каталог `demos/` (по умолчанию его в пакете нет).
Проверка — `tests/agent/sdk_package_test.py`: упаковывает дважды и сравнивает
SHA256 архивов и обе контрольные суммы.

## GitHub CI и Releases

`.github/workflows/build.yml` запускается по новому version tag или вручную.
Пять независимых Release jobs на нативных GitHub runners: macOS arm64/x86_64,
Linux x86_64/aarch64, Windows x86_64. Каждый собирает engine и SDK, выполняет
native/JS тесты **в обеих конфигурациях** (`ci_verify.py --re2d on` для `build-ci`
и `--re2d off` для `build-2d-ci`), проверяет web-экспорт отдельным шагом (без
emsdk шаг печатает причину пропуска и не падает) и упаковывает архив. Linux
дополнительно проверяет SDK GUI, standalone-сборку и пакет под Xvfb.
После успешных пяти jobs release job публикует пять архивов и SHA256SUMS.txt
в GitHub Release этого тега. Неуспешный build не выдаётся за полный релиз.
Вручную запущенный workflow сохраняет artifacts без создания релиза.

## Сайт и документы

Исходники сайта отслеживаются в Git; секреты `site/.env.deploy`, состояние
выгрузки, generated docs/download/play остаются локальными. `site/build-site.sh`
читает текущие docs/ заново, удаляет старые generated pages, обновляет llms.txt,
llms-full.txt, sitemap, links/version и архивы. `deploy-fast.sh` после успешной
загрузки удаляет с сервера снятые doc pages, ранее учтённые в deployment manifest.
Удаление ограничено doc/, остальные удалённые локальные файлы не затрагиваются.

## Проверка результата

Проверить `build_and_push.log`, три remote branch/tag и GitHub Actions run.
Проверить пять assets в Release и опубликованный сайт, а не только локальный
workflow. macOS append signing и поддержка других платформ проверяются отдельно:
локальный запуск игры сам по себе не подтверждает пригодную для распространения подпись.

Содержимое пакета и воспроизводимость проверяются автоматически:

```sh
R2D_BINARY=build/russiano2d python3 tests/agent/sdk_package_test.py   # пакет, SHA256SUMS, VERSION, повторная упаковка
python3 tools/ci_verify.py --build-dir build --re2d on                # обе конфигурации
python3 tools/ci_verify.py --build-dir build-2d --re2d off
python3 tools/ci_verify.py --build-dir build --web                    # web-экспорт или честный skip без emsdk
```

Состав архива и таблица платформ — [BUILD.md](BUILD.md), раздел «Дистрибутив».
