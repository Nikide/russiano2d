# Стриминг населения — `lib/population.js`

Скриптовый streaming-сэмпл: держит около игрока (area of interest, AOI) заданное
число машин/пешеходов, спавнит в допустимых точках и выгружает далёких.
Это **не** `gTrafficManager` Carnage3D и не подсистема движка: обычный объект,
который сцена создаёт, тикает и выбрасывает. Никаких синглтонов.

## 1. Создание

```js
import { createPopulation } from './lib/population.js';

const crowd = createPopulation($, {
    targetCount: 12,
    spawnDistance: 900,       // спавним только в этом радиусе от AOI
    minSpawnDistance: 0,
    despawnDistance: 1400,    // дальше — выгружаем
    cooldown: 0.4,            // секунд между спавнами
    maxPerUpdate: 1,          // не больше N спавнов за update
    minSeparation: 24,        // не спавним ближе этого к живущим
    uniquePoints: true,       // одна точка = один живой объект
    seed: 7,                  // детерминизм
    name: 'pedestrians',
    graph,                    // roadgraph.js: точки спавна + surface tags
    world,                    // опционально: world.groundAt (feature-detect)
    h: 0,
    tags: ['sidewalk'],       // нужны ВСЕ теги
    excludeTags: ['no_spawn'],
    focus: () => player.pos(),        // точка/узел/функция/селектор
    filter: (point, {rng, focus}) => point.kind === 'ped' && rng() > 0.1,
    ownership,                // lib/ownership.js: DI, не обязателен
    spawn: (point, rng) => {
        const node = $('<npc>', { class: 'ped' }).at(point.x, point.y)
            .size(18, 36).appendTo($.world);
        return node;
    },
    despawn: (entry, reason) => {},   // свой код перед remove (опционально)
    protect: (node) => node.hasClass('mission'),  // доп. защита (опционально)
});

$.update((dt) => crowd.update(dt));    // тикает сцена, не движок
```

`spawn(point, rng)` **обязателен**: библиотека не знает, кого спавнить. Он
возвращает узел (обёртку/сырой узел) или `null` (тогда попытка считается
неудачной). `points` — массив `{x,y,kind?,tags?}` или функция, возвращающая
массив. Если не задан, передавайте `graph.spawnPoints(...)` сами.

## 2. Что происходит в `update(dt)`

1. `pruneDead()` — убирает записи об удалённых узлах/просроченных handle.
2. `despawnFar(focus)` — всё дальше `despawnDistance` удаляется, **кроме
   защищённого** (persistent/mission/`protect()`).
3. `cooldown -= dt`; если `count < target` и cooldown истёк — выбирается одна
   случайная точка из подходящих (`spawnDistance`, `minDistance`,
   `minSeparation`, `uniquePoints`, теги, `filter`) и вызывается `spawn`.
4. Возврат `{spawned, despawned, count, target, focus}`.

Порядок детерминирован: одинаковые seed, точки и порядок `update` дают
одинаковый набор позиций. `seed` создаёт изолированный поток
`$.random.stream('population:<name>:<n>', {seed, independent:true})`; без
`$.random` — свой mulberry32. Уникальный суффикс потока нужен, чтобы два пула с
одинаковым seed не делили последовательность.

## 3. Теги и `world.groundAt`

`tags` — обязательные теги (все), `excludeTags` — запрещённые (по умолчанию
`['no_spawn']`). Источники тегов: `point.tags` из данных + живые
`world.groundAt(x,y,{h})`, если он есть. Ошибка/неоднозначность (`RangeError`
без `h` на многоэтажной XY) не роняет кадр: теги считаются неизвестными,
объявленные остаются. Провайдер можно подменить через `tagsAt(x,y)` в опциях.

В обычной 2D-сцене без Re2D работают теги, объявленные в точках спавна
(дек-ларативные зоны), либо свой `filter`-предикат — см.
[roadgraph.md](roadgraph.md).

## 4. Ownership и защита

API внедряется через `opts.ownership` (интерфейс — в
[/tmp/GTA_ROADMAP_PLAN.md] и `lib/ownership.js`):

- при спавне `ownership.mark(node,'temporary')`;
- `ownership.is(node,'persistent'|'mission')` — не выгружать;
- безопасный handle `ownership.handle(node)` (если есть) проверяется на
  `alive()`; мёртвый объект вычищается без падения.

Без ownership защита работает через `protect(node)`/`population.protect(node,
kind)` и `opts.protect(node)`. Защищённые объекты считаются в `count()` и
никогда не удаляются `clear()`/`update()`. `population.track(node, kind)` —
включить в учёт существующий узел (например, припаркованную машину сцены).

## 5. API

| Вызов | Результат |
|---|---|
| `update(dt)` | `{spawned,despawned,count,target,focus}`; `dt` секунды |
| `count()` / `target()` | живые/цель |
| `setTarget(n)` / `setPoints(points)` / `points()` | управление на ходу |
| `focus()` | текущий AOI `{x,y}` или `null` |
| `protect(node,kind)` / `track(node,kind)` / `unprotect(node)` | защита/учёт |
| `spawnNow(point?)` | принудительный спавн; `{seq,id,kind,x,y}` или `null` |
| `clear()` | удалить незащищённых, вернуть число |
| `snapshot()` | `[{seq,id,kind,x,y,persistent,protectedKind,age,distance}]`, по `seq` |
| `entries()` | обёртки живых узлов |
| `stats()` | `{count,target,protected,spawned,despawned,skipped,failed,attempts,cooldown,candidates,seed,tags,hasOwnership,hasSurface}` |
| `dispose()` | `clear()` и отвязать данные |

## 6. Детерминизм и производительность

- `--fixed-dt` + фиксированный `seed` → одинаковый `snapshot()`; так проверяет
  `tests/agent/re2d_gta_traffic_test.py`.
- Кандидаты пересобираются только при `count < target`, не каждый кадр;
  `cooldown` и `maxPerUpdate` ограничивают частоту спавнов.
- Пул не «симулирует всех далеко»: выгрузка за `despawnDistance` — часть
  контракта. Замеры — через `$.debug.profile()`/`$.debug.profiler` (см.
  [polish.md](polish.md) §7).

## 7. Ограничения

- нет LOD/поведения: population только рождает/убирает; движение — ai.md;
- `filter`/`spawn` — код игры, а не данные: сериализуемого «населения» здесь нет;
- сохранения: пул не сериализуется; после загрузки сцены население создаётся
  заново (persistent-объекты, помеченные ownership, остаются на сцене);
- один `update` спавнит не больше `maxPerUpdate`; чтобы быстро набрать толпу,
  вызывайте `update` несколько раз или поднимите лимит.

## 8. Проверка

`tests/agent/re2d_gta_traffic_test.py` — counts/target/cooldown, spawn/
despawn/фильтры/ownership/seed, polish smoke и interop с **реальным**
`$.re2dWorld`: `world.groundAt` на дороге/тротуаре/двух этажах одной XY и
фильтр `no_spawn` (плюс RangeError без `h`).
