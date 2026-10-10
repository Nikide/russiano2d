# Russiano2D 0.1.28 — macOS Intel

Готовый движок и всё, что нужно, чтобы начать на нём первый проект.

## Что в папке

| Файл | Что это |
|---|---|
| `russiano2d` | сам движок — твой инструмент |
| `game/` | игра по умолчанию: меню + уровень-платформер, живой пример кода |
| `r2d-sdk[.exe]`, `sdk/`, `sdk_tools.json` | SDK на R2D: шаблоны, студии, запуск и упаковка |
| `docs/` | текущие справочники SDK и API |
| `assets/` | текстуры, шрифты, иконки |
| `AGENTS.md` | то же самое, но для ИИ-агента: как управлять игрой программно |
| `CHANGELOG.md` | что менялось по версиям |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | лицензия движка и лицензии зависимостей |

## 1. Проверить, что движок работает

```bash
./russiano2d                      # игра по умолчанию
./russiano2d --scene platformer   # сразу уровень, минуя меню
./russiano2d --stats --seconds 5  # прогон без рук: печатает FPS и статистику кадра
```

**macOS:** если система откажется запускать файл — переподпиши его: `codesign --force --sign - russiano2d`

## 2. Свой первый проект

Рядом с движком создай каталог `mygame/` и два файла.

`mygame/project.json` — имя окна и его размер:

```json
{ "name": "Моя первая игра", "width": 960, "height": 540 }
```

`mygame/main.js` — сама игра. Весь код идёт через одну точку входа `$`:

```js
$.ready(() => {
    $.gfx.color('#101828');                       // фон кадра

    $('<player>', { id: 'hero' })                 // создать узел
        .at(200, 300).size(32, 32).color('#4ea1ff')
        .body('dynamic')                          // физическое тело
        .controls('arrows')                       // управление стрелками
        .appendTo($.world);

    $('<wall>').at(400, 420).size(400, 24).body('static').appendTo($.world);

    $.update(() => {                              // каждый кадр
        if ($('#hero').onFloor()) $('#hero').jump(600);
    });
});
```

## 3. Запустить свою игру

```bash
./russiano2d --game mygame
```

Пока игра запущена, правь `.js` — движок перезапускает скрипты на лету (F5).
Выключить: `--no-hot-reload`.

## 4. Собрать в один файл

```bash
./russiano2d build --project . --entry mygame/main.js --out mygame-release
```

На выходе — один исполняемый файл: скрипты и ассеты внутри, зашифрованы
(ChaCha20-Poly1305). Исходный код игры в нём не читается, рядом ничего класть
не нужно.

**macOS:** собранную игру тоже подпиши (`codesign --force --sign - mygame-release`). Груз по умолчанию не шифруется — включить: `--encrypt`.

## 5. Куда дальше

* **[tutorial-first-game.md](https://hub.mos.ru/dem4ev48/russiano2d/-/blob/main/docs/tutorial-first-game.md)**
  — «Моя первая игра»: hello world, меню с кнопками, смена сцен, сборка;
* [HIGH_LEVEL_API.md](https://hub.mos.ru/dem4ev48/russiano2d/-/blob/main/docs/HIGH_LEVEL_API.md)
  — полный справочник по `$`;
* [AGENT_API.md](https://hub.mos.ru/dem4ev48/russiano2d/-/blob/main/docs/AGENT_API.md)
  — протокол агента: управлять игрой программой;
* [docs/highlevel/](https://hub.mos.ru/dem4ev48/russiano2d/-/tree/main/docs/highlevel)
  — подсистемы по отдельности: анимация, TileMap, частицы, навигация, UI, твины,
  локализация, HTTP.

Репозиторий: <https://hub.mos.ru/dem4ev48/russiano2d>
Зеркало: <https://gitverse.ru/Nikide/russiano2d>

## SDK

Откройте SDK: `./russiano2d --game sdk`. Исходники создаваемых игр остаются обычными
файлами; CLI `r2d-sdk[.exe]` использует те же нативные операции, что GUI.
Для распространения собранной игры сохраните рядом её каталог `lib/`, если он есть.
