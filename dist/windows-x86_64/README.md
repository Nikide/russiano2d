# Russiano2D 0.1.22 — Windows x86_64

Готовый движок и всё, что нужно, чтобы начать на нём первый проект.

## Что в папке

| Файл | Что это |
|---|---|
| `russiano2d.exe` | сам движок — твой инструмент |
| `game/` | игра по умолчанию: меню + уровень-платформер, живой пример кода |
| `assets/` | текстуры, шрифты, иконки |
| `AGENTS.md` | то же самое, но для ИИ-агента: как управлять игрой программно |
| `CHANGELOG.md` | что менялось по версиям |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | лицензия движка и лицензии зависимостей |

## 1. Проверить, что движок работает

```bash
.\russiano2d.exe                      # игра по умолчанию
.\russiano2d.exe --scene platformer   # сразу уровень, минуя меню
.\russiano2d.exe --stats --seconds 5  # прогон без рук: печатает FPS и статистику кадра
```

**Windows:** запускать из PowerShell или cmd в этой папке: `.\russiano2d.exe`

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
.\russiano2d.exe --game mygame
```

Пока игра запущена, правь `.js` — движок перезапускает скрипты на лету (F5).
Выключить: `--no-hot-reload`.

## 4. Собрать в один файл

```bash
.\russiano2d.exe build --project . --entry mygame/main.js --out mygame-release
```

На выходе — один исполняемый файл: скрипты и ассеты внутри, зашифрованы
(ChaCha20-Poly1305). Исходный код игры в нём не читается, рядом ничего класть
не нужно.

**Windows:** собранная игра — такой же `.exe`, дописывать ничего не нужно. Груз шифруется по умолчанию.

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
