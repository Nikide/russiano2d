# Раннер GitLab для hub.mos.ru

> **Статус: раннера нет.** Защита hub.mos.ru отдаёт `403` на запросы с наших
> машин, поэтому раннер не регистрируется, а его бинарник скачивается как
> HTML-страница ошибки. Пайплайн готов, но запускать его некому — движок и
> релизы собираются локально, `python3 tools/release.py --version x.y.z`.
> Подробности и варианты обхода — в разделе «Статус» ниже.

Как поднять сборочный раннер на Linux-VPS. Задания конвейера выполняются в
контейнерах (`image: ubuntu:24.04`), поэтому нужен именно **docker-executor** —
shell-executor их не запустит.

## Статус: почему CI не работает

Поднять раннер не удалось — и не из-за конфигурации. Защита hub.mos.ru (WAF)
отдаёт `403 Forbidden` на любой запрос с наших машин. Разница видна по ответу:

| Запрос | Откуда | Ответ |
|---|---|---|
| `POST /api/v4/runners` | обычная рабочая машина | `403`, `content-type: application/json`, тело `{"message":"403 Forbidden"}` — **это отвечает GitLab** |
| тот же запрос | VPS (Россия, Москва, AS208427) | `403`, **HTML**: `<h1>Forbidden</h1><pre>Request ID: 2026-10-05-32-53-3F2468181E30BDE:95.182.122.198</pre>` — **это отвечает WAF** |

GitLab всегда отвечает JSON. HTML-страница с `Request ID` и IP в конце — подпись
защиты. Тем же ответом WAF подменила и бинарник раннера при скачивании: `curl`
без флага `-f` сохранил эту страницу в `/usr/local/bin/gitlab-runner`, а bash
потом пытался её исполнить («Syntax error: redirection unexpected»).

Скорее всего дело в том, что IP относится к дата-центровому диапазону
(`hosting: true`) — антиботы фильтруют такие сети почти всегда, независимо
от страны.

Что можно сделать, если CI нужен:

* написать в поддержку hub.mos.ru (кнопка «Написать в поддержку») и попросить
  разрешить трафик с этого IP, приложив `Request ID` из ответа;
* пустить раннер через прокси с разрешённого адреса
  (`systemctl edit gitlab-runner` → `Environment="HTTPS_PROXY=..."`);
* поднять раннер на машине, которая не в дата-центре: с домашнего интернета
  API отвечает нормально (проверено — приходит JSON, а не HTML).

Инструкция ниже остаётся рабочей — она понадобится, когда доступ появится.

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
