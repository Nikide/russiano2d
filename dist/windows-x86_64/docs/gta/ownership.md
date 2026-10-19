# GTA sandbox: владение и стабильные handles — `lib/ownership.js`

Минимальная игровая политика поверх жизненного цикла узлов `$`. Движок уже
даёт `node.nid` (логический ID, переживает save/prefab) и `node.uid` (номер
создания; пул выдаёт новый) — своих счётчиков библиотека не заводит.

```js
import { createOwnership } from './lib/ownership.js';

const ownership = createOwnership($);
ownership.mark('#car-3');              // temporary (по умолчанию)
ownership.mark('#quest-marker', 'mission');
ownership.mark('#hud', 'persistent');

const h = ownership.handle('#car-3');
h.alive();                             // true
ownership.is('#car-3', 'temporary');   // true
$('#car-3').remove();
h.alive();                             // false
h.get();                               // null
```

## API

| Вызов | Что делает |
|---|---|
| `mark(node, kind?)` | размечает узел: `temporary` (умолчание), `persistent`, `mission`; возвращает узел |
| `unmark(node)` | снимает разметку → `bool` |
| `is(node)` / `is(node, kind)` | размечен ли / совпадает ли вид |
| `kind(node)` | вид или `null` |
| `handle(node)` | `{id, nid, uid, get(), alive(), kind()}`; `id` — `nid` движка |
| `resolve(nid)` | handle по `nid` среди **заново размеченных** узлов |
| `sweep({keep, inside, destroy, kind})` | удаляет только `temporary`; `{scanned, destroyed, kept, protected, stale, remaining}` |
| `prune()`, `stats()`, `clear({destroy, all})` | отладка/уборка; список видов — `kinds()` |

`handle(node)` работает и для неразмеченного узла. Он хранит ссылку, `uid` и
`nid` на момент выдачи: после `destroy()` или выдачи из `$.pool` `alive()` =
`false`, `get()` = `null` — старый handle не может управлять новой целью даже
при совпадении `id`.

`sweep`:
* `keep` — узел/обёртка/handle/массив/функция/`'#id'`/`nid`; не удаляется;
* `inside` — предикат `(node)=>bool` или `{x,y,w,h}` (центр!) / `{x,y,radius}`;
* `destroy` — своё удаление (по умолчанию `$(node).remove()`);
* `kind` — какой вид убирать; по умолчанию `temporary`, `persistent` не
  удаляется никогда (`RangeError`), `mission` — только явным `kind:'mission'`.

## Сцена, save/load, пул

* Смена сцены/`$.reload`: разметка — JS-состояние, она **не сохраняется**;
  узлы после загрузки новые, старые handles мертвы. `resolve(nid)` помогает
  сопоставить загруженный (prefab/save) узел после повторного `mark()`.
* `sweep()`/`stats()` вычищают записи об уже удалённых узлах (`stale`).
* Пул: `$.pool.release(node)` не помечает узел `removed`, а новая выдача даёт
  новый `uid`. Пока узел лежит в пуле, формально он ещё «тот же» объект; после
  следующего `spawn()` старый handle мёртв. Это ограничение движка (публичного
  признака «вне мира» нет), а не гарантия, которую библиотека может дать.

## Границы

* Не второй менеджер сущностей: только разметка `Map` + проверка `uid`.
* Не удаляет `persistent`/`mission`, не трогает `visible`, не меняет `$.pool`.
* Не сериализуется в `$.save`; для ссылок в сохранении используйте `nid`.

Проверки: `python3 tests/agent/re2d_gta_ownership_test.py` (destroy, повторный
id, пул, sweep/keep/inside, защита persistent/mission, stale, resolve, clear).
