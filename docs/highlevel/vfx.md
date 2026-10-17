# `r2dvfx` — `$.vfx`: свои визуальные эффекты

Модуль `src/highlevel/vfx.js` (M0–M5 задачи `task-67`; разделение пространств —
`task-69`). Это **визуальная** половина бывшего `$.fx`: вспышки, волны, молнии,
ленты, поля сил, свет, hit-stop и экранные слои. Звук живёт отдельно в
[`$.sfx`](sfx.md) — правило простое: **что слышно → `sfx`, что видно → `vfx`**.

```
$.vfx.define('hit.spark', {...})     // декларативная спека
$.vfx.play('hit.spark', { at: [x, y] })
$.sfx.play('hit.metal')              // звук — из своего пространства
```

Никаких сторонних библиотек: всё рисуется тем же батчем, что и спрайты
(`$.gfx.push.*`), поэтому эффекты попадают в кадр сцены и не добавляют
draw call'ов. Effekseer не встраивается (`docs/internal/DEPENDENCY_DECISIONS.md`).

---

## 1. Публичные имена

| Вызов | Что делает |
|---|---|
| `$.vfx.define(name, spec)` | объявить эффект; спека проверяется и копируется |
| `$.vfx.extend(base, patch)` | собрать эффект из базы и надстройки, **не мутируя** базу |
| `$.vfx.get(name)` | глубокая копия спеки или `null` |
| `$.vfx.list()` | имена эффектов (отсортированы) |
| `$.vfx.remove(name)` | убрать эффект (`true`, если был) |
| `$.vfx.play(name\|spec, opts)` | проиграть; возвращает хендл |
| `$.vfx.spawn(node\|point, spec, opts?)` | разово, без регистрации |
| `$.vfx.stats()` | активные эффекты/частицы/эмиттеры/свет/degraded |
| `$.vfx.primitives()` | допустимые имена `use:` |
| `$.vfx.budget({particles, light})` | потолки бюджета (сеттер/геттер) |
| `$.vfx.load(path)` | объявить эффекты из JSON через `$.fs` |
| `$.vfx.loadAll(dir\|paths)` | каталог с манифестом `vfx.json` или массив путей |
| `$.vfx.trail/ribbon/pushRibbon/lightning/shockwave/pulse/flash/flashLeft/attractor/hitStop/impact/clear/stats` | те же примитивы, что были в `$.fx` |

Хендл `play`/`spawn`:

```js
const h = $.vfx.play('hit.spark', { at: [120, 80], rate: 1.2 });
h.query();     // { id, name, time, progress, duration, rate, active, seed,
               //   draws, hash, degraded, fired, layers, end_reason }
h.seek(0.1);   // перемотка вперёд не проигрывает пропущенные слои
h.setRate(0.5);
h.stop();
```

`play` берёт время из **игрового** `dt` (`$.time.delta()`): `$.time.pause()` и
hit-stop останавливают эффект вместе с миром. `spawn` — то же, но спека не
регистрируется. `opts`: `{ at, parent, follow, rate, seed, name }`.

Внутри движка тот же объект доступен как `$.ctx.vfx`; публичный контракт —
`$.vfx` (как и у остальных подсистем: `$.ctx.fx`, `$.ctx.particles`).

## 2. Спека

```js
{
    duration: 0.35,                 // секунды, > 0
    seed: 'hit.spark',              // строка/число; детерминизм (необязательно)
    budget: { particles: 120, light: 1 },   // резерв на эффект
    layers: [
        { at: 0.00, use: 'particles.burst', params: { preset: 'sparks', count: 24 } },
        { at: 0.00, use: 'fx.flash',        params: { color: '#fff3c4', ms: 90 } },
        { at: 0.00, use: 'fx.hitStop',      params: { ms: 40 } },
        { at: 0.02, use: 'fx.ribbon',       params: { from: [0, 0], to: [26, -18] } },
    ],
}
```

Правила, которые проверяются кодом:

* спека — **чистые данные**: функции внутри запрещены (`R2D_VFX_NOT_DATA`);
* `duration` — конечное число `> 0`; `layers` — массив; `at` — число `0…duration`;
  `params` — объект (`R2D_VFX_BAD_SPEC` с путём до поля);
* неизвестный `use` — ошибка `R2D_VFX_UNKNOWN_PRIMITIVE` **со списком
  допустимых**, а не тишина; неизвестное имя эффекта — `R2D_VFX_UNKNOWN_EFFECT`
  со списком известных;
* неизвестный `clip.<имя>` — `R2D_VFX_UNKNOWN_CLIP` со списком клипов;
  неизвестный `shader.<имя>` — запись `R2D_VFX_UNKNOWN_SHADER` и `degraded`
  (шейдер может появиться позже, кадр не падает);
* `extend` не мутирует базу: слои patch **добавляются** к слоям базы, `budget`
  сливается, остальные поля перекрываются; возвращается новая спека.

Без `seed` эффект тоже работает, но детерминизм по seed — единственный способ
получить одинаковый `hash`/кадр в двух прогонах. `query().hash` — хеш выборок
эффекта; при одинаковом seed и одинаковом числе кадров он совпадает.

## 3. Примитивы `use:`

`$.vfx.primitives()` возвращает полный список; координаты в `params` —
**относительно origin эффекта** (`from`, `to`, `points`, `at`).

| `use:` | Что делает | Ключевые `params` |
|---|---|---|
| `particles.burst` | разовый залп частиц в origin | `preset`, `count`, `speed`, `lifetime`, `max_particles`, `color` |
| `particles.preset` | непрерывный эмиттер на время эффекта | `preset`, `amount` |
| `fx.flash` | вспышка экрана | `color`, `ms`, `alpha`, `blend` |
| `fx.shake` | тряска камеры | `amp`, `ms` |
| `fx.hitStop` | заморозка/замедление игрового времени | `ms`, `scale` |
| `fx.shockwave` | расширяющееся кольцо | `radius`, `ms`, `width`, `color`, `ease` |
| `fx.lightning` | молния | `from`, `to`, `life`, `jitter`, `branches` |
| `fx.pulse` | вспышка-круг в точке | `radius`, `ms`, `color`, `alpha` |
| `fx.ribbon` | разовая лента | `points` или `from`+`to`, `width`, `ms`, `color` |
| `fx.trail` | лента за целью | `target`, `ms`, `width`, `color` |
| `fx.attractor` | поле сил для частиц | `radius`, `strength`, `swirl`, `life`, `visual` |
| `light.emitter` | узел `<light>` на время эффекта | `radius`, `intensity`, `color`, `falloff`, `flicker:{hz,depth}` |
| `sound.playBank` | звук из банка (через `$.sfx`) | `bank`, `pitchRange`, `volume` |
| `shader.<имя>` | пост-пресет `$.gfx.postPreset` или шейдер узла | параметры пресета/шейдера |
| `layers.fadeTo` | полноэкранное затемнение (`$.layers`) | `color`, `alpha`, `ms` |
| `clip.<имя>` | эффект по кадрам клипа `$.clip` | `scale`, `class` |

`fx.trail` без `target`/`follow` не молчит: `R2D_VFX_NEEDS_TARGET` и
`skipped++`. `sound.playBank` без банка даёт `R2D_SFX_UNKNOWN_BANK` из
[`$.sfx`](sfx.md) и `skipped++`.

## 4. Готовый набор (§D3)

`$.vfx.list()` содержит **22** встроенных эффекта из `docs/VFX_ROADMAP.md` D3:

| Группа | Имена |
|---|---|
| удары | `hit.spark`, `hit.metal`, `hit.soft`, `crit` |
| движение | `jump.dust`, `land.dust`, `dash.wind`, `footstep` |
| мир | `torch.flame`, `campfire`, `magic.circle` |
| боёвка | `explosion`, `shockwave`, `slash`, `parry` |
| сцена | `fade`, `flash.screen`, `quake`, `slowmo` |
| сигналы | `pickup`, `quest.done`, `warning` |

Встроенные спеки — обычные данные: их можно `get`, `extend` и переопределять
через `define` (последнее объявление побеждает).

## 5. Бюджет и `stats()`

`$.vfx.budget()` по умолчанию `{ particles: 512, light: 16 }`. Каждый эффект
резервирует `spec.budget` (если бюджет в спеке не задан — он оценивается по
слоям). При упоре в потолок эффект **деградирует**, а не исчезает:
`degraded`/`degraded_active`/`skipped` видны в `stats()`, частицы/свет режутся.
Замер: 100 одновременных эффектов с `budget.particles: 20` при потолке 200 —
`stats().particles == 200`, `degraded >= 90`.

`$.vfx.stats()` отдаёт базовые счётчики (`trails`, `bolts`, `waves`, `fields`,
`pulses`, `flashes`) плюс `effects`, `particles`, `emitters`, `lights`, `clips`,
`degraded`, `degraded_active`, `skipped`, `played`, `budget`, `primitives`.
`particles`/`lights` — **зарезервированный** бюджет активных эффектов (верхняя
граница того, что они могут занять), а `emitters`/`clips` — сколько узлов
реально заведено; поэтому `particles` не меньше живых частиц, но не врёт о
потолке.

## 6. Файлы, кадр, сцена

* `$.vfx.load(path)` читает JSON через `$.fs.readJSON` (модуль `store.js`);
  формат — `{ "имя": спека }` или `{ effects: { ... } }`.
* `$.vfx.loadAll(dir)` читает `<dir>/vfx.json` с `{ files: [...] }` — отдельного
  листинга каталогов в `$.fs` нет, поэтому манифест это контракт, а не догадка.
  Можно передать массив путей.
* `tickVfx` вызывается из `tickFx` (хук `onFxTick`), до `tickParticles`; время —
  игровое. Смена сцены зовёт `resetFx()` (scene.js), он же сбрасывает и
  состояние `$.vfx` (хук `onFxReset`): эффекты принадлежат сцене.
* `layers.fadeTo`/`shader.*` — экранные слои, они не «принадлежат» эффекту и
  сами не откатываются: восстанавливать состояние должен тот, кто его включил.

## 7. M4: чего нет (честно)

Предпросмотр в DevTools и экспорт спеки в JSON (милстоун **M4**) **не
сделан** в этой смене: API для него уже достаточен (`list`/`get`/`play`/
`seek`/`query`, спеки — чистые данные и сериализуются), но вкладки
«VFX» в DevTools нет. Это записано как не сделанное, а не как «работает».

## 8. Тесты

* `tests/agent/vfx_registry_test.py` — ≥20 эффектов, play/spawn/stop/seek/
  setRate/query, `stats`, `load/loadAll`, M5 `clip.<имя>` (кадры с двух листов);
* `tests/agent/vfx_validation_test.py` — опечатка в `use` со списком допустимых,
  битые поля, запрет функций, `extend` без мутации;
* `tests/agent/vfx_determinism_test.py` — seed → одинаковые значения и кадр,
  пауза, бюджет (100 эффектов), `budget()` сеттер/геттер;
* `tests/agent/fx_split_mapping_test.py` — старый `$.fx` = новый `$.vfx` и одно
  предупреждение на сырое имя; звук удара идёт через `$.sfx`.
