# Архив прежних CI-конфигураций

Активный CI: [GitHub Actions](../../.github/workflows/build.yml).
Конфигурации GitLab/GitVerse сохранены с `.disabled` расширениями вне рабочих
каталогов провайдеров. Они служат историей, не инструкцией текущего выпуска.

`build_and_push.sh` использует remote `github` по умолчанию и публикует ветку
плюс новый annotated tag `vX.Y.Z`. CI запускается только на version tags.
Workflow собирает Linux Debug и запускает native/JS/SDK tests, batch и native
agent parity под Xvfb. Windows/macOS/release jobs пока нет; удалённый запуск
должен быть проверен отдельно. Старые remotes остаются на месте.

Подробности — [RELEASING.md](../RELEASING.md).
