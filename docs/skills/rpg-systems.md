# Навык: RPG-системы

Характеристики, инвентарь, задания, бой — из кирпичиков. Для целой игры начни с `kit.project-jrpg` или с `kit.crpg-dialogue` + `kit.adventure-*`.

## 1. Основные блоки

| Блок | Кирпичики |
|---|---|
| Характеристики | `stats.base`, `stats.derived` (из базовых считаются производные: урон, защита) |
| Здоровье и состояния | `health.base`, `health.armor`, `health.resistance`, эффекты `health.poison`, `health.burning`, `health.freeze`, `health.slow`, `health.regeneration` |
| Способности | `ability.base`, `ability.cooldown`, `ability.resource-cost`, `ability.targeting`, `ability.area-effect`, `ability.summon`, `ability.charge` |
| Пошаговый бой | `kit.jrpg-turn-battle` (+ `turn.initiative-queue`), группа — `kit.jrpg-party` |
| Инвентарь | `inventory.grid`, `item.consumable`, `item.durability`, `item.quest-bound`, `item.drop` |
| Экипировка | `equipment.slots`, `equipment.loadout` |
| Крафт | `crafting.recipe`, `crafting.station`, `crafting.upgrade`, `crafting.repair` |
| Задания | `quest.definition`, `quest.objective-*` (collect, defeat, visit, survive…), `quest.sequence`, `quest.timer`, `quest.journal` |
| NPC | `npc.personality`, `npc.relationship`, `npc.party-member`, `npc.home-routine`, `npc.daily-needs` |
| Диалоги | `dialogue.tree`, `dialogue.choice`, `dialogue.condition`, `dialogue.action` (см. навык `story-dialogue`) |
| Мир | `kit.dungeon-crawl`, `world.streamed-room`, `economy.shop` |

## 2. Порядок сборки

1. Герой со статами и здоровьем → один враг → бой работает (даже на одной арене).
2. Предметы: подобрать, использовать, надеть.
3. Один NPC с диалогом, который выдаёт задание.
4. Задание: выполнить → награда (`economy.reward`, `progression.xp`) → UI журнала.
5. Второй район/комната, сохранение (`save.slot`).

## 3. Баланс характеристик

* Все цифры — формулами от базовых (`stats.derived`), а не руками в каждом месте.
* Рост по уровням плавный: следующий уровень требует ~1.3–1.5× опыта предыдущего.
* Лечение и расходники дешевле урона, который они компенсируют, иначе игра сводится к «закупись и дави».
* Проверка в `playtest`: пройти типичный бой, вывести `eval` потерь здоровья; цель — выиграть с 20–40% запасом, не вхолостую и не на грани.

## 4. Пошаговый бой: контракт ясности

Игрок всегда видит: чей ход, что можно сделать, чем закончилось действие (число урона, эффект). Без этого бой читается как случайный.
UI боя: `ui.party-panel`, `ui.choice-list`, `health.damage-number`.
