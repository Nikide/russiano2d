# Миграция публичных имён

Таблица переездов между минорами. Правило репозитория: старое имя остаётся
**работающим** на один минор, при первом вызове даёт одно дедуплицированное
предупреждение, а удаляется в следующем миноре отдельным коммитом с записью в
CHANGELOG. Тест на каждую строку — `tests/agent/fx_split_mapping_test.py`.

## 1.2.x → 1.3: `$.fx` → `$.sfx` + `$.vfx` (task-69, M0 для r2dvfx)

Правило: **что слышно → `$.sfx`, что видно → `$.vfx`**. `$.fx` остаётся
алиасом один минор: вызов работает, числа/кадр/звук те же, что у нового имени.

| Было (`$.fx` / `$.hits`) | Стало | Почему |
|---|---|---|
| `$.fx.flash`, `$.fx.flashLeft` | `$.vfx.flash`, `$.vfx.flashLeft` | визуальное |
| `$.fx.shockwave` | `$.vfx.shockwave` | визуальное |
| `$.fx.lightning` | `$.vfx.lightning` | визуальное |
| `$.fx.pulse` | `$.vfx.pulse` | визуальное |
| `$.fx.trail`, `$.fx.ribbon` | `$.vfx.trail`, `$.vfx.ribbon` | визуальное |
| `$.fx.pushRibbon` (не было публичным, стало) | `$.vfx.pushRibbon` | визуальное |
| `$.fx.attractor` | `$.vfx.attractor` | визуальное (влияет на частицы) |
| `$.fx.hitStop` | `$.vfx.hitStop` | тайминг кадра, но видимый эффект |
| `$.fx.clear`, `$.fx.stats` | `$.vfx.clear`, `$.vfx.stats` | визуальная подсистема |
| `$.fx.impact` | `$.vfx.impact` | картинка; звук — через `$.sfx` |
| `$.hits.play(info, { sound })` | `$.vfx.impact(...)` + `$.sfx.play(name)` | пресет один, зовётся из своего пространства |
| `$.hits.presets()` | `$.sfx.presets()` (тот же реестр) | звук удара |
| `$.sound.playBank(name, opts)` | `$.sfx.playBank(name, opts)` | звук, без визуальных имён |

Что **не** менялось: `$.hits` и `$.hitFx`, `$.sound`, `$.particles`, `$.camera`.
Имя `$.fx` — единственный алиас; третьего пространства (`$.effects` и т. п.) не
заводится.

### Предупреждение

Ключ дедупликации — **сырое имя**, например `$.fx.flash`. Первый вызов пишет
строку и запись `R2D_FX_DEPRECATED` в `$.debug.errors()` с полями
`data.raw` и `data.target`; повторные вызовы того же сырого имени молчат.
Сто вызовов `$.fx.flash` = одна запись; `$.fx.flash` и `$.fx.shockwave` = две.

### Пример

```js
// было
$.fx.flash('#fff3c4', { ms: 110, alpha: 0.55 });
$.fx.shockwave(x, y, { radius: 120 });
$.hits.play(info, { preset: 'crit', sound: 'hit.metal' });

// стало
$.vfx.flash('#fff3c4', { ms: 110, alpha: 0.55 });
$.vfx.shockwave(x, y, { radius: 120 });
$.vfx.play('crit', { at: info });
$.sfx.play('hit.metal');
```

### Удаление

В следующем миноре: `$.fx` удаляется целиком, вместе с `R2D_FX_DEPRECATED`;
`$.vfx`/`$.sfx` остаются. Публичный `$` API развивается вместе с движком;
`api.schema.json` и справка описывают текущую поверхность.

## 1.2.x → 1.3: `$.vfx` — новые имена (не переезд, а расширение)

`$.vfx.define/extend/get/list/remove/play/spawn/stats/primitives/budget/load/loadAll`
и хендл `{stop, seek, setRate, query}` — новые публичные имена (r2dvfx, M1–M3,
M5). `$.fx.*` их не получает: старый алиас держит ровно старую поверхность,
чтобы «два пути к одной возможности» не появилось.
