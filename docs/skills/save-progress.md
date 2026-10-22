# Навык: сохранения, прогресс, экономика

## 1. Что хранить и чем

| Данные | Инструмент |
|---|---|
| Простые значения (рекорд, громкость, флаги) | `$.store.set('best', 120)`, `$.store.get('best', 0)`, `$.store.has/keys/remove`; файл — `$.store.file(...)`, автосохранение — `$.store.autoSave(...)` |
| Слоты игры (несколько сохранений) | кирпичики `save.slot`, `save.profile`; состояние мира/квестов/сюжета — `save.world-state`, `save.quest-state`, `save.story-state`, инвентарь — `save.inventory` |
| Старые сохранения после обновления игры | `save.migration` |
| Низкий уровень | `$.save.*` (`$.save.apply`, `$.save.autosave`, `$.save.behavior`…) — только если кирпичиков мало |

Правило: **сначала `snippet_find "сохранение"`**, `$.store` — для мелочей.

## 2. Прогресс игрока

| Механика | Кирпичик |
|---|---|
| Уровни и опыт | `progression.xp`, `progression.level` |
| Навыки, перки, дерево | `progression.skill-points`, `progression.skill-tree`, `progression.perk`, `progression.respec` |
| Открытия | `progression.unlock`, `progression.mastery` |
| Испытания и достижения | `progression.challenge`, `kit.achievement-set`, `kit.daily-challenge` |
| Набор снаряжения | `progression.loadout-preset`, `equipment.slots` |
| Мета-прогресс рогалика | `kit.roguelite-meta` |

## 3. Экономика

`economy.wallet` (валюта), `economy.price`, `economy.shop`, `economy.shop-stock`, `economy.trade`, `economy.reward`,
`economy.loot-table` (случайная добыча: `$.random.weighted`), `economy.income-expense`.
Правило баланса: **источник и сток должны уравновешиваться** — если игрок только получает деньги, магазин теряет смысл.

## 4. Когда сохранять

* После значимого события: контрольная точка, конец уровня, покупка — не каждый кадр.
* При выходе в меню/паузе.
* Версионируй формат (`version: 1` в данных): тогда `save.migration` сможет читать старое.
* Не клади в сохранение то, что восстанавливается кодом (позиции частиц, временные эффекты).

## 5. Проверка

`playtest`: выполнить действие, вызвать сохранение через `eval`, перезапустить сцену (`$.scene.restart`) и прочитать значение
обратно. Расхождение — сохранение не работает, даже если «ошибок нет».
