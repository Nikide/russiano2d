# Сборки Russiano2D

Готовые бинарники по платформам. В каждой папке лежит одно и то же:

| Файл | Что это |
|---|---|
| `russiano2d` (`russiano2d.exe`) | движок |
| `game/`, `assets/` | игра по умолчанию и её ресурсы |
| `README.md` | как подготовить движок к первому проекту |
| `AGENTS.md` | то же для ИИ-агента + вся документация движка внутри одного файла |
| `SHA256SUMS.txt` | контрольные суммы всех файлов папки |

| Платформа | Папка | Архив |
|---|---|---|
| macOS, Apple Silicon | [`macos-arm64/`](macos-arm64/) | `russiano2d-macos-arm64.tar.gz` |
| Linux, x86_64 | `linux-x86_64/` | `russiano2d-linux-x86_64.tar.gz` |
| Linux, aarch64 | `linux-aarch64/` | `russiano2d-linux-aarch64.tar.gz` |
| Windows, x86_64 | `windows-x86_64/` | `russiano2d-windows-x86_64.zip` |

Скачать напрямую (пример для macOS):

```bash
curl -fL -o russiano2d \
  https://hub.mos.ru/dem4ev48/russiano2d/-/raw/main/dist/macos-arm64/russiano2d
chmod +x russiano2d
```

Собрать самому: `python3 tools/autobuild.py --help`.

Проверить целостность после скачивания:

```bash
shasum -a 256 -c SHA256SUMS.txt     # macOS и Linux
certutil -hashfile russiano2d.exe SHA256   # Windows
```
