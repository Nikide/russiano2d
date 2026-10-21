# Горение

Горение с тиком урона; поджигает урон fire, тушит вода или событие status poison:clear.

Поля:

- `tickDamage` (number) — Урон за тик (на стек)
- `interval` (int) — Интервал тиков
- `duration` (int) — Длительность
- `maxStacks` (int) — Максимум стеков
- `water` (string) — Тушит (селектор)

Состав / зависимости: `health.base`
