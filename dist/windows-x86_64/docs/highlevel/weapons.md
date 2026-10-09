# Оружие и баллистика — `$.weapons`

Порт из audm-neko (`weapon_db.gd`, `base_weapon_v2.gd`, `weapon_mods.gd`,
`weapon_feel.gd`). Ствол описывается один раз в базе, а в руках живёт его
состояние: магазин, темп, перезарядка, отдача, навесное.

```js
$.ready(() => {
    $.weapons.define({ id: 'ak', name: 'АК', damage: 35, rpm: 600, ammo: 30,
                       reload: 2.4, spread: 1.4, recoil: 1.1, falloff: 400,
                       modes: ['auto', 'single'] });
    $.weapons.defineMod({ id: 'brake', slot: 'muzzle', spread: 0.7, recoil: 0.85 });

    const gun = $.weapons.create('ak');
    gun.attach('brake');
    gun.fire();          // { fired, ammo, damage, spread, recoil, pellets }
    gun.reload();
    gun.tick(dt);        // темп, перезарядка, остывание отдачи
});
```

---

## 1. База

| Вызов | Что делает |
|---|---|
| `$.weapons.define(def)` | описать ствол |
| `$.weapons.defineMod(def)` | описать навесное (слот, множители, добавки) |
| `$.weapons.get(id)` / `mod(id)` / `has(id)` | найти ствол или мод |
| `$.weapons.ids()` / `list()` / `modIds()` | списки |
| `$.weapons.load(data)` / `loadMods(data)` / `loadFile(path)` | пачки из JSON |

Поля ствола: `damage`, `rpm`, `ammo`, `reload`, `spread`, `recoil`, `velocity`,
`falloff` (дистанция полного урона), `penetration`, `pellets`, `modes`
(`auto`/`single`/`burst`), `style` (`magazine`/`shells`/`break`/`none`),
`slots`, `kind: 'melee'`.

Поля навесного: `slot`, множители (`spread`, `recoil`, `ammo`, `damage`, `rpm`,
`reload`, `velocity`, `falloff`) и добавки (`pellets`, `penetration`).

## 2. Ствол в руках

| Вызов | Возвращает |
|---|---|
| `$.weapons.create(id)` | ствол с полным магазином |
| `gun.fire({ held?, again?, heat? })` | `{ fired, reason, ammo, damage, spread, recoil, pellets }` |
| `gun.reload(withAmmo?)` / `cancelReload()` | начать / прервать перезарядку |
| `gun.tick(dt)` | темп, перезарядка, остывание отдачи и перегрева |
| `gun.attach(mod)` / `detach(slot?)` / `mods()` | навесное |
| `gun.stats` / `capacity` / `magazine` / `mode` / `cycleMode()` | характеристики и режим |
| `gun.damageAt(distance)` | урон с затуханием |
| `gun.load(n)` / `reset(full?)` / `save()` / `load2(data)` | запас, сброс, сейв |

`reason` объясняет отказ: `cooldown` (темп), `reloading`, `empty`, `single`
(одиночный режим не стреляет от удержания), `melee`.

## 3. Как считаются характеристики

Итог = базовые × множители навесного + добавки. Магазин — **множитель**
(`ammo: 1.5` у большого магазина даёт 45 из 30), а дробь — **добавка**
(`pellets: 2`). Смена навесного пересчитывает характеристики: если снять
большой магазин, лишние патроны теряются, как в игре.

Навесное встаёт в свой слот; мод из чужого слота отвергается, а повторная
установка в занятый слот возвращает прежний мод.

## 4. Темп, отдача, разброс

* **темп** — `60 / rpm` секунд между выстрелами; выстрел в кулдауне отклоняется
  с `reason: 'cooldown'`;
* **перегрев** растёт от выстрела (`heat`) и спадает в тике; разброс считается
  как `spread × (1 + 2·heat) + recoil × heat`, а накопленная отдача спадает
  вдвое быстрее;
* **отдача** отдаётся в `fire()` — игра сама решает, толкать ли камеру.

## 5. Перезарядка

`style: 'magazine'` заряжает весь магазин за `reload` секунд; `style: 'shells'`
(дробовик) — **по одному патрону**, каждый за долю времени. Прерывание
(`cancelReload`) не возвращает уже вставленные патроны.

## 6. Баллистика

* `falloff(damage, distance, falloffStart)` — до порога полный урон, дальше
  падает, но не ниже 40%;
* `penetrationAgainst(penetration, armorClass)` — каждое очко пробития снимает
  примерный класс брони; результат идёт в `$.combat.hit(..., { armor })`;
* `pellets` — дробь: столько лучей за выстрел (урон на каждый считает игра).

## 7. Ограничения

* **пуля не летит**: движок не считает траекторию и попадание — `fire()` отдаёт
  разброс и урон, а луч пускает игра (`$.world.raycast`/`$.combat.hit`);
* **гильзы и процедурная перезарядка не портированы** (`weapon_feel.gd`):
  тайминги фаз и звон гильз — визуальная часть, её ещё нет;
* **нет разборки/сборки оружия** (`mod_fitting.gd`) — есть установка готового
  мода;
* **патроны не расходуются из инвентаря**: ствол считает свой магазин, а общий
  запас патронов связывает игра через `$.inv`;
* **вес и цена мода** хранятся, но в инвентарь автоматически не попадают.

## 8. Проверка

```bash
# темп, режимы, перезарядка (в т.ч. по патрону), навесное, затухание урона
build/_deps/quickjs-build/qjs tests/js/weapons_test.mjs
```
