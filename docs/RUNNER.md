# Раннер GitLab для hub.mos.ru

Как поднять сборочный раннер на Linux-VPS. Задания конвейера выполняются в
контейнерах (`image: ubuntu:24.04`), поэтому нужен именно **docker-executor** —
shell-executor их не запустит.

## 0. Что должно быть

* Linux **x86_64** — проверить: `uname -m` (должно быть `x86_64`);
* **4 ГБ RAM и ~20 ГБ диска**: сборка тянет SDL3, QuickJS-ng, Box2D, RmlUi,
  Dear ImGui, glslang и SPIRV-Cross из исходников;
* root или `sudo`;
* интернет: раннер общается с hub.mos.ru, а контейнер — с репозиториями
  зависимостей.

## 1. Установка

```bash
uname -m    # ждём x86_64

sudo curl -L --output /usr/local/bin/gitlab-runner \
  https://hub.mos.ru/gitlab/runner/-/package_files/1185/download
sudo chmod +x /usr/local/bin/gitlab-runner
gitlab-runner --version

sudo useradd --comment 'GitLab Runner' --create-home gitlab-runner --shell /bin/bash
sudo gitlab-runner install --user=gitlab-runner --working-directory=/home/gitlab-runner
sudo gitlab-runner start
```

Проверить, что скачался настоящий бинарник, а не страница:

```bash
file /usr/local/bin/gitlab-runner
# Mach-O быть не должно: на VPS ожидаем ELF 64-bit ... x86-64
```

Если `uname -m` вернул `aarch64`, файл по ссылке выше не запустится — нужен
`gitlab-runner-linux-arm64`.

## 2. Docker

```bash
sudo apt-get update
sudo apt-get install -y docker.io
sudo usermod -aG docker gitlab-runner
sudo systemctl restart gitlab-runner

# Раннер должен видеть демон:
sudo -u gitlab-runner docker info | head -3
```

## 3. Регистрация

Токен берётся в **Settings → CI/CD → Runners → New project runner**.
Тег указывается ровно **`docker`** — его требуют все Linux-задания конвейера
(включая `lint`). «Run untagged jobs» включать не нужно.

```bash
sudo gitlab-runner register \
  --url https://hub.mos.ru/ \
  --registration-token <ТОКЕН_ИЗ_UI> \
  --executor docker \
  --docker-image ubuntu:24.04 \
  --tag-list docker \
  --description "vps-linux docker" \
  --non-interactive

sudo gitlab-runner verify
```

Если в UI показан токен вида `glrt-…`, это новый порядок регистрации:
используйте `--token glrt-…` вместо `--registration-token`.

**Токен — секрет.** Он даёт право регистрировать раннеры, которые получают
исходники проекта. Не публикуйте его; после настройки сбросьте:
Settings → CI/CD → Runners → ⋮ → Reset registration token.

## 4. Что ещё настроить в проекте

Windows-заданиям (`build_windows`, `test_windows`, `package_windows`) нужна
отдельная машина с тегом `windows,msvc`. Пока её нет, добавьте переменную,
иначе они будут вечно висеть в `pending`:

**Settings → CI/CD → Variables → `R2D_WINDOWS_CI` = `false`**

## 5. Проверка

```bash
systemctl status gitlab-runner --no-pager     # служба запущена
sudo gitlab-runner verify                     # раннер виден серверу
sudo journalctl -u gitlab-runner -n 50        # если что-то не так
```

Дальше достаточно запушить в `main` — конвейер подхватится сам. Готовые файлы
(`dist/`) собирает стадия `package`, релиз выпускается тегом `v*`.

## 6. Если не работает

| Симптом | Причина и что делать |
|---|---|
| Задания `pending`, раннер есть | Тег не совпал: у раннера должен быть `docker`. Проверить: `sudo gitlab-runner list` |
| `Cannot connect to the Docker daemon` | `sudo usermod -aG docker gitlab-runner && sudo systemctl restart gitlab-runner` |
| `fork/exec ... exec format error` | Скачан бинарник под другую архитектуру — сверьте `uname -m` и `file /usr/local/bin/gitlab-runner` |
| Сборка падает по памяти | Нужно ≥4 ГБ RAM; снизить параллелизм: в `.gitlab-ci.yml` у job'ов стоит `-j 2` |
| `No space left on device` | Нужно ~20 ГБ; чистить: `docker system prune -af` |
| Конвейер не создаётся вовсе | Конфиг не проходит линтер: CI/CD → Editor → Lint |
