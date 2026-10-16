# `$.processing` — политики обработки узлов (§44)

Политика говорит, ЧТО узлу считать: обновление, фиксированный шаг, анимацию,
таймеры, физику. Это не «спящий узел» с магией, а явный набор из пяти полей —
узлу можно оставить анимацию, но выключить физику.

```js
$.processing.define('sleeping', { update: false, fixed: false, physics: false });
$.processing.set('.enemy', 'sleeping');
if ($.processing.allow('#enemy', 'physics')) { /* ... */ }
```

## Полный перечень имён

Проверено на живом движке (1.2.0): значения ниже — реальные ответы, а не
пересказ исходника.

| Имя | Сигнатура | Проверено запуском |
|---|---|---|
| `$.processing.fields()` | `→ string[]` | ровно `['update', 'fixed', 'animation', 'timers', 'physics']` (копия, менять её безопасно) |
| `$.processing.inactive()` | `→ object` | `{ update: false, fixed: false, animation: true, timers: false, physics: false }` — анимация остаётся включённой |
| `$.processing.presets()` | `→ string[]` | имена объявленных политик; без `define` — `[]` |
| `$.processing.spec(value)` | `→ object` | имя/объект → полный набор из пяти полей; неизвестное имя даёт умолчания «всё true» |
| `$.processing.get(what)` | `→ object` | эффективная политика узла (селектор/узел/обёртка); для несуществующего узла — умолчания, все поля `true` |
| `$.processing.define(name, spec)` | `→ $.processing` | объявляет именованную политику; пустое имя/мусор игнорируются (возврат — сам `$.processing`) |
| `$.processing.set(what, spec)` | `→ number` | задаёт политику узлам, возвращает число затронутых узлов |
| `$.processing.allow(what, kind)` | `→ bool` | разрешена ли обработка вида `kind` (одно из пяти полей) для узла |
| `$.processing.scope(scope, spec)` | `→ scope` | вешает политику на область владения (§5): взятые областью узлы наследуют её, пока не задали свою |
| `$.processing.stats()` | `→ object` | счётчики политик (сколько узлов с неумолчальной обработкой) |
