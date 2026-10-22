# Навык: жанр → наборы кирпичиков

Наборы `kit.*` подключают сразу несколько кирпичиков (`snippet_apply`). Ищи по слову: `snippet_find "платформер"`.
Таблица ниже — быстрый выбор. «Проект: …» — самые крупные наборы, собирают игру почти целиком.

| Жанр | С чего начать | Добавить |
|---|---|---|
| Платформер | `kit.platformer-core` | `kit.platformer-checkpoint`, `kit.platformer-collectathon`, `kit.platformer-combat`, `kit.boss-platformer`; целиком — `kit.project-platformer` |
| Точный платформер / паркур | `kit.precision-platformer`, `kit.parkour` | `movement.dash`, `movement.wall-jump`, `world.moving-hazard` |
| Метроидвания | `kit.metroidvania-gates`, `kit.metroidvania-map` | `world.secret-area`, `ui.world-map` |
| Головоломки-платформер | `kit.puzzle-platformer` | `interact.movable-crate`, `interact.pressure-plate`, `puzzle.reset` |
| Top-down шутер | `kit.top-down-shooter` | `kit.shooter-loadout`; целиком — `kit.project-top-down-action` |
| Twin-stick арена / выживание | `kit.twin-stick-arena`, `kit.arena-survival` | `ai.wave-director`, `progression.xp` |
| Bullet heaven | `kit.bullet-heaven` | `progression.perk`, `ai.spawner` |
| Укрытия / тактический шутер | `kit.cover-shooter`, `kit.tactical-squad` | `ai.cover`, `ai.flank` |
| Beat 'em up / файтинг | `kit.beat-em-up`, `kit.fighting-game`, `kit.action-combo` | `animation.hit-pause`, `feedback.combo-popup` |
| Стелс / проникновение | `kit.stealth`, `kit.infiltration` | `ai.hearing`, `ai.investigate` |
| Хоррор | `kit.horror` | `world.light-zone`, `audio.ambience` |
| Оборона | `kit.tower-defense`, `kit.lane-defense`, `kit.horde-defense` | `ai.wave-director`, `economy.wallet` |
| JRPG | `kit.jrpg-turn-battle`, `kit.jrpg-party` | `kit.dungeon-crawl`; целиком — `kit.project-jrpg` |
| CRPG / приключение | `kit.crpg-dialogue`, `kit.adventure-interaction`, `kit.adventure-inventory` | `quest.*`, `story.flag` |
| Тактика на клетках | `kit.tactical-grid` | `grid.pathfinding`, `ability.targeting` |
| Карточный бой | `kit.deckbuilder-battle` | `turn.initiative-queue` |
| Рогалик | `kit.roguelike-run`, `kit.roguelite-meta` | `economy.loot-table`, `item.drop` |
| Выживание / крафт | `kit.survival-combat`, `kit.crafting-survival` | `crafting.recipe`, `item.durability` |
| Ферма / жизнь / бизнес | `kit.farming`, `kit.life-sim`, `kit.business-sim` | `world.day-night`, `economy.shop` |
| Гонки | `kit.racing-time-trial`, `kit.racing-combat` | `racing.lap-counter`, `kit.replay-ghost` |
| Ритм | `kit.rhythm`, `kit.music-arcade` | `feedback.combo-popup` |
| Визуальная новелла | `kit.visual-novel`, `kit.romance-routes`; целиком — `kit.project-vn-romance` | `story.*`, `save.story-state` |
| Эскейп-рум / детектив | `kit.escape-room`, `kit.mystery-investigation` | `puzzle.*` |
| Подводный / транспорт | `kit.underwater`, `kit.vehicle-platformer` | `movement.swim`, `movement.vehicle-seat` |
| Кооператив (локальный) | `kit.local-coop`, `kit.platformer-coop` | `camera.split-screen`, `health.revive` |
| Сеть | `kit.arena-multiplayer`, `kit.authoritative-coop` | `net.*` |

## Общее для любой игры

| Нужно | Кирпичик / набор |
|---|---|
| Выбор уровня, победа | `kit.stage-select`, `kit.level-challenge`, `ui.result-screen`, `world.level-exit` |
| Пауза и настройки | `ui.pause-menu`, `ui.settings-menu`, `settings.audio` |
| Сохранение | `save.slot`, `save.profile` |
| Обучение | `kit.tutorial` |
| Достижения / ежедневные задачи | `kit.achievement-set`, `kit.daily-challenge` |

Правило выбора: берёшь **самый крупный набор, который подходит**, и уже потом докручиваешь отдельными кирпичиками.
Набор, который ты не понял, не применяй: `snippet_find` покажет описание и поля.
