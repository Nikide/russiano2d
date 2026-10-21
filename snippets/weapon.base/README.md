# Оружие

Ствол из $.weapons в руках объекта: темп, магазин, перезарядка; стреляет по клавише.

Поля:

- `weapon` (string) — ID ствола
- `damage` (number) — Урон
- `rpm` (number) — Темп
- `ammo` (int) — Магазин
- `reload` (number) — Перезарядка
- `spread` (number) — Разброс
- `pellets` (int) — Дробин
- `falloff` (number) — Дистанция полного урона
- `mode` (enum) — Режим
- `fireKey` (string) — Клавиша выстрела
- `reloadKey` (string) — Клавиша перезарядки
- `sound` (asset) — Звук выстрела
