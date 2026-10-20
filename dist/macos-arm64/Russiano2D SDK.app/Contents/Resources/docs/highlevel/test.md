# `$.test` — утверждения для агентских сценариев

Мини-фреймворк проверок внутри игры: те же строки `ok`/`FAIL`, что печатает
агентский прогон, но проверку пишет сама игра (в сценарии или в отладочной
ветке). Счётчики копятся до `$.test.reset()`.

```js
$.test.equal($('#hero').hp, 100, 'герой цел');
$.test.falsy($.store.has('dead'), 'герой не помечен мёртвым');
$.test.report();                 // печатает итог, true если всё зелено
```

## Полный перечень имён

| Имя | Сигнатура | Проверено запуском |
|---|---|---|
| `$.test.falsy(value, message)` | `→ bool` | `$.test.falsy(false, 'x')` → `true` (проверка прошла), `$.test.falsy(true, 'y')` → `false`; строка `ok`/`FAIL` уходит в журнал |
| `$.test.check(condition, message, detail)` | `→ bool` | основная проверка: считает `total`, при провале — `failed` и запись в `failures` |
| `$.test.equal(actual, expected, message)` | `→ bool` | сравнение через `JSON.stringify` (годится и для массивов/объектов) |
| `$.test.near(actual, expected, eps, message)` | `→ bool` | `|a − b| ≤ eps`, `eps` по умолчанию `0.001` |
| `$.test.truthy(value, message)` | `→ bool` | `!!value` |
| `$.test.reset()` | `→ $.test` | обнуляет счётчики (агент делает это перед каждым сценарием) |
| `$.test.results()` | `→ { total, failed, failures, details }` | снимок счётчиков копиями массивов |
| `$.test.report()` | `→ bool` | печатает итог, `true` — если провалов нет |

`$.test.falsy` — ровно отрицание `truthy`: значение приводится к bool
(`0`, `''`, `null`, `undefined` — falsy), исключений не бросает.
