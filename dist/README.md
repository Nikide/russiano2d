# Сборки Russiano2D

Витрина релизов. Здесь лежит **macOS, собранный на рабочем Mac**: Windows и
Linux собирает CI (GitHub Actions, а также пайплайны GitVerse и Mos.Hub) и
выкладывает их в релизы соответствующих хостингов и в витрину — командой
`python3 tools/fetch_release_assets.py`, когда релиз готов.

В каждой папке лежит одно и то же:

| Файл | Что это |
|---|---|
| `russiano2d` (`russiano2d.exe`) | движок |
| `game/`, `assets/` | игра по умолчанию и её ресурсы |
| `README.md` | как подготовить движок к первому проекту |
| `AGENTS.md` | то же для ИИ-агента + вся документация движка внутри одного файла |
| `VERSION` | версия пакета (та же, что в `CMakeLists.txt`) |
| `SHA256SUMS.txt` | контрольные суммы всех файлов папки |

| Платформа | Папка | Архив | Кто собирает |
|---|---|---|---|
| macOS, Apple Silicon | [`macos-arm64/`](macos-arm64/) | `russiano2d-v<версия>-macos-arm64.tar.gz` | локальный Mac |
| macOS, Intel | [`macos-x86_64/`](macos-x86_64/) | `russiano2d-v<версия>-macos-x86_64.tar.gz` | локальный Mac (кросс-сборка, smoke через Rosetta) |
| Windows, x86_64 | появляется после релиза | `russiano2d-v<версия>-windows-x86_64.zip` | CI |
| Linux, x86_64 | появляется после релиза | `russiano2d-v<версия>-linux-x86_64.tar.gz` | CI |
| Linux, aarch64 | появляется после релиза | `russiano2d-v<версия>-linux-aarch64.tar.gz` | CI |

Имя архива собирается в одном месте — `release.archive_name()`
(`russiano2d-v<версия>-<платформа>.<ext>`), рядом лежит `SHA256SUMS.txt` по
всем архивам витрины.

Скачать напрямую (пример для macOS):

```bash
curl -fL -o russiano2d \
  https://hub.mos.ru/dem4ev48/russiano2d/-/raw/main/dist/macos-arm64/russiano2d
chmod +x russiano2d
```

Проверить целостность после скачивания:

```bash
shasum -a 256 -c SHA256SUMS.txt            # macOS и Linux
certutil -hashfile russiano2d.exe SHA256   # Windows
```
