# Сниппеты («Кирпичики»)

Сниппет — пакет готового поведения: manifest с полями для Inspector и обычный
JS-файл. Editor подключает пакеты к объектам проекта, значения хранятся в
`project.json` (`editor.snippets`), а генератор пишет обычный JS в
`generated/snippets/`. Runtime manifest не читает и компонентной машины не имеет.
Полное ТЗ — [SNIPPET_SYSTEM_PROJECT.md](SNIPPET_SYSTEM_PROJECT.md).

## 1. Пакет

```
snippets/movement.platformer/
  snippet.json        # manifest, format "r2d-snippet/1"
  src/behavior.js     # export default function (node, config, $) → disposer
  examples/…  tests/…  README.md
```

Источники: встроенные — `snippets/` рядом с `r2d`; проектные —
`<проект>/snippets/`. Проектный пакет с тем же id закрывает встроенный явно
(`shadows: true`, `SNIP009`).

```json
{
  "format": "r2d-snippet/1",
  "id": "movement.platformer",
  "version": "1.0.0",
  "title": {"ru": "Движение платформера"},
  "kind": "behavior",
  "category": "Персонаж и движение",
  "targets": ["node"],
  "slots": [{"id": "movement", "capacity": 1}],
  "requires": [{"api": "$.updateFor"}, {"api": "$.fn.velocity"}],
  "dependencies": [],
  "fields": [{"id": "speed", "type": "number", "default": 220, "min": 0, "max": 900}],
  "source": "src/behavior.js",
  "examples": ["examples/example.json"],
  "tests": ["tests/values.test.json"]
}
```

* `kind`: `behavior` (есть `source`) или `kit` (без `source`, состав — `dependencies`;
  при подключении раскрывается в экземпляры и набор `sets`).
* Типы полей: `number`, `int`, `bool`, `string`, `enum` (`options`), `color`
  (`#rrggbb`), `vec2` (`[x, y]`), `asset` (`assetKind`: image, audio, animation,
  data, rml), `entity` (селектор/ID), `list` (строки). Общие ключи: `label`,
  `hint`, `default`, `required`, `group`, `visibleIf: {field, equals}`, `min`,
  `max`, `step`, `unit`.
* `requires` разрешается по `api.schema.json`: отсутствующий путь — `SNIP100`.
* Источник — один файл без относительных import и без `engine.*`
  (`SNIP102`, `SNIP101`). Покадровая логика — через `$.updateFor(node, fn)`:
  подписка снимается сама при удалении узла и возвращает disposer.

## 2. `editor.snippets` в project.json (schema 2)

```json
"snippets": {
  "format": 1,
  "catalog_lock": {"movement.top-down": {"version": "1.0.0", "manifest_hash": "…", "source": "builtin"}},
  "instances": [{"id": "snippet:hero:movement.top-down", "package": "movement.top-down",
                 "version": "1.0.0", "owner": "object:hero", "slot": "movement",
                 "values": {"speed": 240}, "links": {}}],
  "sets": [],
  "generation": {"output": "generated/snippets", "entry": "generated/snippets/index.js"}
}
```

`owner` — ключ сущности `editor.graph` (у объекта нужен `id`) или `project`.
`disabled: true` оставляет экземпляр в конфигурации, но не генерирует.
`generation.ownership: "code"` передаёт область в ручное владение: генератор её
больше не пишет (`SNIP122`).

## 3. Генерация

`generated/snippets/index.js` импортирует vendored копии пакетов
(`packages/<id>.js`) и привязывает поведение к узлу по стабильному id: при
появлении узла (сцена, respawn) вызывается функция пакета, при исчезновении —
её disposer. В точку входа (`runtime.entry`) добавляется одна строка
`import './generated/snippets/index.js'; // r2d:snippets`.

Одинаковый вход — побайтно одинаковый результат. Каждый файл несёт хеш тела в
первой строке: ручная правка обнаруживается (`SNIP120`) и молча не
перезаписывается; `--overwrite` применяет генерацию, сохраняя ручную версию
рядом как `*.r2d-user`. Запись транзакционна: сначала временные файлы, затем
переименования.

## 4. Команды

```bash
r2d snippet catalog [--project P] [--query прыж] [--id ID] [--fields] [--strict]
r2d snippet validate snippets/movement.platformer
r2d snippet check <проект>
r2d snippet add <проект> movement.top-down --owner object:hero [--slot S] [--dry-run]
r2d snippet set <проект> snippet:hero:movement.top-down speed=240 'links.target="object:boss"'
r2d snippet remove <проект> <экземпляр|набор>
r2d snippet update <проект> [пакет]
r2d snippet generate <проект> [--write|--check|--overwrite|--print]
```

Все команды отвечают одним JSON с `diagnostics`; Editor и агент вызывают те же
операции. `r2d validate` проверяет `editor.snippets` теми же правилами.

## 5. Коды

| Код | Что |
|---|---|
| `SNIP001`–`SNIP011` | manifest: разбор, format, id, version, title/category, kind, source, повтор id, тень проектного пакета, examples/tests, имя каталога |
| `SNIP020`–`SNIP029` | поля: id, тип, default, min/max, options, тип значения, диапазон, обязательное, неизвестное поле, значение не из options |
| `SNIP040`–`SNIP042` | ресурс вне проекта, не найден, не того вида |
| `SNIP060`–`SNIP064` | owner/target, ёмкость слота, неизвестный слот, неразрешённая ссылка |
| `SNIP080`–`SNIP082` | зависимость отсутствует, цикл, зависимость не стоит на том же owner |
| `SNIP100`–`SNIP102` | $ API нет в schema, `engine.*`, относительный import |
| `SNIP120`–`SNIP124` | ручная правка generated, сбой записи, code-authored, устаревший вывод, точка входа |
| `SNIP140`–`SNIP145` | формат секции/каталога, пакет не найден, версия/lock, изменённый manifest, id экземпляра, участник набора |
| `SNIP180` | тест пакета не прошёл |
