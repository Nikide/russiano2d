# Russiano2D {{VERSION}} — {{PLATFORM_TITLE }}

Готовый движок и всё, что нужно, чтобы начать на нём первый проект.

## Что в папке

| Файл | Что это |
|---|---|
| `{{BINARY}}` | всё в одном файле: движок, Editor, шаблоны проектов, документация, шрифты и иконки |
| `AGENTS.md` | короткая инструкция для ИИ-агента: как достать документацию из бинарника (`r2d docs`) и вести игру программно |
| `CHANGELOG.md` | что менялось по версиям |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | лицензия движка и лицензии зависимостей |

`r2d` открывает Project Manager без аргументов, `r2d edit <проект>` открывает
проект в Editor, а `r2d --game <проект>` запускает его напрямую. Все три
режима принадлежат одному executable.

## 1. Проверить, что движок работает

```bash
{{RUN}}                      # Project Manager: создать проект из шаблона или открыть свой
{{RUN}} templates            # какие шаблоны проектов есть
{{RUN}} new blank mygame     # создать проект mygame/ из шаблона blank
{{RUN}} --game mygame --stats --seconds 5   # прогон без рук: печатает FPS и статистику кадра
```

{{RUN_NOTE}}

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
{{RUN}} --game mygame
```

Пока игра запущена, правь `.js` — движок перезапускает скрипты на лету (F5).
Выключить: `--no-hot-reload`.

## 4. Собрать в один файл

```bash
{{RUN}} build --project . --entry mygame/main.js --out mygame-release
```

На выходе — один исполняемый файл: скрипты и ассеты внутри, зашифрованы
(ChaCha20-Poly1305). Исходный код игры в нём не читается, рядом ничего класть
не нужно.

{{BUILD_NOTE}}

## 5. Куда дальше

Документация вшита в сам `{{BINARY}}`: `{{RUN}} docs list`, `{{RUN}} docs show HIGH_LEVEL_API`,
`{{RUN}} docs search "слово"` — без интернета и без папки `docs/`.
То же самое на сайте:

* **[tutorial-first-game.md](https://gitverse.ru/Nikide/russiano2d/blob/main/docs/tutorial-first-game.md)**
  — «Моя первая игра»: hello world, меню с кнопками, смена сцен, сборка;
* [HIGH_LEVEL_API.md](https://gitverse.ru/Nikide/russiano2d/blob/main/docs/HIGH_LEVEL_API.md)
  — полный справочник по `$`;
* [AGENT_API.md](https://gitverse.ru/Nikide/russiano2d/blob/main/docs/AGENT_API.md)
  — протокол агента: управлять игрой программой;
* [docs/highlevel/](https://gitverse.ru/Nikide/russiano2d/tree/main/docs/highlevel)
  — подсистемы по отдельности: анимация, TileMap, частицы, навигация, UI, твины,
  локализация, HTTP.

Репозиторий: <https://gitverse.ru/Nikide/russiano2d>
Зеркало: <https://gitverse.ru/Nikide/russiano2d>

## Editor

Откройте Project Manager командой `{{RUN}}` или сразу существующий проект:
`{{RUN}} edit mygame`. Editor и native tools входят в тот же бинарник `r2d`;
команды проверки доступны как `{{RUN}} lint mygame` и `{{RUN}} validate mygame`.
Исходники игр остаются обычными файлами, а запуск игры без Editor —
`{{RUN}} --game mygame`.
Для распространения собранной игры сохраните рядом её каталог `lib/`, если он есть.
