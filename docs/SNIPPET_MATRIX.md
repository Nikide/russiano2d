# Матрица пакетов сниппетов

Сгенерировано `python3 scripts/snippet_matrix.py` из §12 [ТЗ](SNIPPET_SYSTEM_PROJECT.md),
каталога `snippets/` и `api.schema.json`. Руками не править.

Реализовано: **108 из 500**. Строк с пробелом API: **0**.

Колонка API: для реализованного пакета — фактические `requires`; для
запланированного — опорные пространства `$` по префиксу ID (предварительно,
уточняется при реализации пакета).


## A. Базовые сущности и управление — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 001 | `actor.base` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.hide`, `$.fn.removeClass`, `$.fn.show` | — |
| 002 | `player.base` | ✅ | `$.camera.follow`, `$.camera.unfollow`, `$.fn.addClass`, `$.fn.controls`, `$.fn.removeClass`, `$.fn.speed` | — |
| 003 | `npc.base` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.removeClass`, `$.fn.team` | — |
| 004 | `enemy.base` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.health`, `$.fn.removeClass`, `$.fn.team` | — |
| 005 | `companion.base` | ✅ | `$.fn.addClass`, `$.fn.at`, `$.fn.distanceTo`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.removeClass`, `$.updateFor` | — |
| 006 | `projectile.base` | ✅ | `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.remove`, `$.selection.each`, `$.updateFor` | — |
| 007 | `pickup.base` | ✅ | `$.emit`, `$.fn.distanceTo`, `$.fn.remove`, `$.updateFor` | — |
| 008 | `breakable.base` | ✅ | `$.fn.addClass`, `$.fn.alive`, `$.fn.emit`, `$.fn.fadeOut`, `$.fn.health`, `$.fn.pos`, `$.fn.remove`, `$.prefab.has`, `$.prefab.instantiate`, `$.updateFor` | — |
| 009 | `trigger.base` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.off`, `$.fn.on` | — |
| 010 | `interactable.base` | ✅ | `$.emit`, `$.fn.data`, `$.fn.distanceTo`, `$.input.pressed`, `$.updateFor` | — |
| 011 | `actor.faction` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.removeClass` | — |
| 012 | `actor.identity` | ✅ | `$.fn.data` | — |
| 013 | `actor.spawn-profile` | ✅ | `$.fn.angle`, `$.fn.at`, `$.fn.size` | — |
| 014 | `actor.visual-profile` | ✅ | `$.fn.sprite` | — |
| 015 | `actor.control-profile` | ✅ | `$.fn.controls` | — |
| 016 | `actor.player-slot` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.removeClass` | — |
| 017 | `actor.tags` | ✅ | `$.fn.addClass`, `$.fn.addTag`, `$.fn.removeClass`, `$.fn.removeTag` | — |
| 018 | `actor.attributes` | ✅ | `$.fn.data` | — |
| 019 | `actor.lifecycle` | ✅ | `$.fn.active`, `$.fn.emit`, `$.fn.hide`, `$.fn.remove`, `$.fn.show`, `$.off`, `$.on`, `$.updateFor` | — |
| 020 | `actor.prefab-variant` | ✅ | `$.fn.emit`, `$.fn.pos`, `$.prefab.has`, `$.prefab.instantiate` | — |

## B. Движение и перемещение — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 021 | `movement.top-down` | ✅ | `$.fn.velocity`, `$.input.vec`, `$.updateFor` | — |
| 022 | `movement.platformer` | ✅ | `$.fn.jump`, `$.fn.onFloor`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor` | — |
| 023 | `movement.twin-stick` | ✅ | `$.fn.data`, `$.fn.lookAt`, `$.fn.velocity`, `$.input.mouseWorld`, `$.input.vec`, `$.updateFor` | — |
| 024 | `movement.analog` | ✅ | `$.fn.velocity`, `$.input.padAxis`, `$.updateFor` | — |
| 025 | `movement.click-to-move` | ✅ | `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.input.mousePressed`, `$.input.mouseWorld`, `$.updateFor` | — |
| 026 | `movement.follow-path` | ✅ | `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 027 | `movement.dash` | ✅ | `$.fn.emit`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor` | — |
| 028 | `movement.dodge-roll` | ✅ | `$.fn.emit`, `$.fn.invulnerable`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor` | — |
| 029 | `movement.coyote-jump` | ✅ | `$.fn.jump`, `$.fn.onFloor`, `$.input.pressed`, `$.updateFor` | — |
| 030 | `movement.jump-buffer` | ✅ | `$.fn.jump`, `$.fn.onFloor`, `$.input.pressed`, `$.updateFor` | — |
| 031 | `movement.double-jump` | ✅ | `$.fn.jump`, `$.fn.onFloor`, `$.input.pressed`, `$.updateFor` | — |
| 032 | `movement.wall-slide` | ✅ | `$.fn.onFloor`, `$.fn.onWall`, `$.fn.velocity`, `$.updateFor` | — |
| 033 | `movement.wall-jump` | ✅ | `$.fn.emit`, `$.fn.flip`, `$.fn.onFloor`, `$.fn.onWall`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor` | — |
| 034 | `movement.climb` | ✅ | `$.fn.emit`, `$.fn.gravity`, `$.fn.overlaps`, `$.fn.some`, `$.fn.velocity`, `$.input.vec`, `$.updateFor` | — |
| 035 | `movement.swim` | ✅ | `$.fn.emit`, `$.fn.overlaps`, `$.fn.some`, `$.fn.velocity`, `$.input.vec`, `$.updateFor` | — |
| 036 | `movement.crouch` | ✅ | `$.fn.emit`, `$.fn.height`, `$.fn.size`, `$.fn.velocity`, `$.fn.width`, `$.input.down`, `$.updateFor` | — |
| 037 | `movement.prone` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.height`, `$.fn.size`, `$.fn.velocity`, `$.fn.width`, `$.input.pressed`, `$.updateFor` | — |
| 038 | `movement.knockback` | ✅ | `$.fn.closest`, `$.fn.externalVelocity`, `$.fn.first`, `$.fn.hp`, `$.fn.pos`, `$.updateFor` | — |
| 039 | `movement.platform-ride` | ✅ | `$.fn.at`, `$.fn.height`, `$.fn.onFloor`, `$.fn.pos`, `$.fn.width`, `$.selection.each`, `$.updateFor` | — |
| 040 | `movement.vehicle-seat` | ✅ | `$.fn.active`, `$.fn.at`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.height`, `$.fn.hide`, `$.fn.pos`, `$.fn.show`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor` | — |

## C. Оружие и атаки — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 041 | `weapon.base` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.input.down`, `$.input.pressed`, `$.sound.play`, `$.updateFor`, `$.weapons.define`, `$.weapons.give`, `$.weapons.has` | — |
| 042 | `weapon.melee` | ✅ | `$.fn.damage`, `$.fn.emit`, `$.fn.hp`, `$.fn.is`, `$.fn.pos`, `$.input.pressed`, `$.input.vec`, `$.updateFor`, `$.world.query` | — |
| 043 | `weapon.hitscan` | ✅ | `$.fn.damage`, `$.fn.emit`, `$.fn.hp`, `$.fn.is`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.input.vec`, `$.updateFor`, `$.weapons.falloff`, `$.world.raycastAll` | — |
| 044 | `weapon.projectile` | ✅ | `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.hp`, `$.fn.is`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.fn.sprite`, `$.input.vec`, `$.updateFor`, `$.world.query` | — |
| 045 | `weapon.spread` | ✅ | `$.fn.at`, `$.fn.damage`, `$.fn.is`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.input.vec`, `$.updateFor`, `$.world.query` | — |
| 046 | `weapon.auto` | ✅ | `$.fn.emit`, `$.input.down`, `$.input.pressed`, `$.updateFor`, `$.weapons.of` | — |
| 047 | `weapon.burst` | ✅ | `$.fn.emit`, `$.input.down`, `$.input.pressed`, `$.updateFor`, `$.weapons.of` | — |
| 048 | `weapon.charge` | ✅ | `$.fn.data`, `$.fn.emit`, `$.input.down`, `$.input.pressed`, `$.updateFor`, `$.weapons.of` | — |
| 049 | `weapon.beam` | ✅ | `$.fn.damage`, `$.fn.emit`, `$.fn.is`, `$.fn.pos`, `$.input.down`, `$.input.vec`, `$.updateFor`, `$.world.raycastAll` | — |
| 050 | `weapon.boomerang` | ✅ | `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.is`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.input.pressed`, `$.input.vec`, `$.updateFor`, `$.world.query` | — |
| 051 | `weapon.grenade` | ✅ | `$.emit`, `$.fn.at`, `$.fn.body`, `$.fn.damage`, `$.fn.is`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor`, `$.world.query` | — |
| 052 | `weapon.mine` | ✅ | `$.emit`, `$.fn.at`, `$.fn.damage`, `$.fn.is`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.input.pressed`, `$.updateFor`, `$.world.query` | — |
| 053 | `weapon.shotgun` | ✅ | `$.fn.emit`, `$.input.pressed`, `$.updateFor`, `$.weapons.define`, `$.weapons.give`, `$.weapons.has` | — |
| 054 | `weapon.sniper` | ✅ | `$.camera.zoom`, `$.camera.zoomTo`, `$.fn.damage`, `$.fn.emit`, `$.fn.is`, `$.fn.pos`, `$.input.down`, `$.input.pressed`, `$.input.vec`, `$.updateFor`, `$.world.raycastAll` | — |
| 055 | `weapon.rocket` | ✅ | `$.emit`, `$.fn.angle`, `$.fn.at`, `$.fn.damage`, `$.fn.is`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.input.pressed`, `$.input.vec`, `$.updateFor`, `$.world.query` | — |
| 056 | `weapon.chain-lightning` | ✅ | `$.fn.damage`, `$.fn.emit`, `$.fn.pos`, `$.input.pressed`, `$.updateFor` | — |
| 057 | `weapon.area-denial` | ✅ | `$.fn.alpha`, `$.fn.at`, `$.fn.color`, `$.fn.damage`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.input.pressed`, `$.input.vec`, `$.selection.each`, `$.updateFor` | — |
| 058 | `weapon.weapon-switch` | ✅ | `$.fn.emit`, `$.input.pressed`, `$.input.wheel`, `$.updateFor`, `$.weapons.give`, `$.weapons.has`, `$.weapons.of` | — |
| 059 | `weapon.ammo` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.updateFor`, `$.weapons.of` | — |
| 060 | `weapon.reload` | ✅ | `$.fn.emit`, `$.input.pressed`, `$.updateFor`, `$.weapons.of` | — |

## D. Здоровье, защита и состояния — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 061 | `health.base` | ✅ | `$.fn.fadeOut`, `$.fn.health`, `$.fn.off`, `$.fn.on`, `$.fn.remove` | — |
| 062 | `health.damage-types` | ✅ | `$.fn.damageFilter`, `$.fn.data` | — |
| 063 | `health.armor` | ✅ | `$.fn.damageFilter` | — |
| 064 | `health.resistance` | ✅ | `$.fn.damageFilter` | — |
| 065 | `health.shield` | ✅ | `$.fn.damageFilter`, `$.fn.data`, `$.fn.emit`, `$.updateFor` | — |
| 066 | `health.regeneration` | ✅ | `$.fn.alive`, `$.fn.heal`, `$.fn.hp`, `$.updateFor` | — |
| 067 | `health.invulnerability` | ✅ | `$.fn.alive`, `$.fn.alpha`, `$.fn.hp`, `$.fn.invulnerable`, `$.updateFor` | — |
| 068 | `health.hit-flash` | ✅ | `$.fn.flash`, `$.fn.hp`, `$.updateFor` | — |
| 069 | `health.knockback-reaction` | ✅ | `$.fn.externalVelocity`, `$.fn.off`, `$.fn.on`, `$.fn.pos` | — |
| 070 | `health.stagger` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.velocity`, `$.updateFor` | — |
| 071 | `health.poison` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.updateFor` | — |
| 072 | `health.burning` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.overlaps`, `$.fn.some`, `$.updateFor` | — |
| 073 | `health.freeze` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.velocity`, `$.updateFor` | — |
| 074 | `health.slow` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.onFloor`, `$.fn.velocity`, `$.updateFor` | — |
| 075 | `health.bleed` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.updateFor` | — |
| 076 | `health.buff-debuff` | ✅ | `$.fn.data`, `$.fn.off`, `$.fn.on`, `$.updateFor` | — |
| 077 | `health.death` | ✅ | `$.emit`, `$.fn.alive`, `$.fn.alpha`, `$.fn.controls`, `$.fn.fadeOut`, `$.fn.flash`, `$.fn.remove`, `$.fn.velocity`, `$.updateFor` | — |
| 078 | `health.respawn` | ✅ | `$.fn.alive`, `$.fn.emit`, `$.fn.respawn`, `$.updateFor` | — |
| 079 | `health.revive` | ✅ | `$.fn.alive`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.hp`, `$.input.down`, `$.updateFor` | — |
| 080 | `health.damage-number` | ✅ | `$.fn.alpha`, `$.fn.at`, `$.fn.color`, `$.fn.height`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.updateFor` | — |

## E. Поведение врагов — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 081 | `ai.idle` | ✅ | `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.flip`, `$.updateFor` | — |
| 082 | `ai.waypoint-patrol` | ✅ | `$.fn.moveTowards`, `$.fn.onWall`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 083 | `ai.chase` | ✅ | `$.fn.distanceTo`, `$.fn.moveTowards`, `$.updateFor` | — |
| 084 | `ai.melee-attack` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.moveTowards`, `$.updateFor` | — |
| 085 | `ai.ranged-attack` | ✅ | `$.fn.alive`, `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.fn.velocity`, `$.updateFor` | — |
| 086 | `ai.flee` | ✅ | `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 087 | `ai.guard-post` | ✅ | `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 088 | `ai.follow-target` | ✅ | `$.fn.distanceTo`, `$.fn.moveTowards`, `$.updateFor` | — |
| 089 | `ai.line-of-sight` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.flip`, `$.fn.pos`, `$.updateFor`, `$.world.lineOfSight` | — |
| 090 | `ai.hearing` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.pos`, `$.off`, `$.on` | — |
| 091 | `ai.investigate` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 092 | `ai.search` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.updateFor` | — |
| 093 | `ai.cover` | ✅ | `$.fn.data`, `$.fn.distanceTo`, `$.fn.height`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.fn.width`, `$.selection.each`, `$.updateFor` | — |
| 094 | `ai.flank` | ✅ | `$.fn.emit`, `$.fn.flip`, `$.fn.moveTowards`, `$.fn.pos`, `$.updateFor` | — |
| 095 | `ai.formation` | ✅ | `$.fn.flip`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 096 | `ai.boss-phases` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.emit`, `$.fn.hp`, `$.fn.removeClass`, `$.updateFor` | — |
| 097 | `ai.boss-telegraph` | ✅ | `$.fn.alpha`, `$.fn.at`, `$.fn.color`, `$.fn.damage`, `$.fn.emit`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.updateFor`, `$.world.query` | — |
| 098 | `ai.spawner` | ✅ | `$.fn.emit`, `$.fn.pos`, `$.off`, `$.on`, `$.prefab.has`, `$.prefab.instantiate`, `$.updateFor` | — |
| 099 | `ai.wave-director` | ✅ | `$.emit`, `$.prefab.has`, `$.prefab.instantiate`, `$.updateFor` | — |
| 100 | `ai.leash` | ✅ | `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.updateFor` | — |

## F. NPC, союзники и группы — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 101 | `npc.schedule` | ⬜ | `$.fn`, `$.nav` | — |
| 102 | `npc.home-routine` | ⬜ | `$.fn`, `$.nav` | — |
| 103 | `npc.daily-needs` | ⬜ | `$.fn`, `$.nav` | — |
| 104 | `npc.personality` | ⬜ | `$.fn`, `$.nav` | — |
| 105 | `npc.relationship` | ⬜ | `$.fn`, `$.nav` | — |
| 106 | `npc.reputation` | ⬜ | `$.fn`, `$.nav` | — |
| 107 | `npc.companion-follow` | ⬜ | `$.fn`, `$.nav` | — |
| 108 | `npc.companion-command` | ⬜ | `$.fn`, `$.nav` | — |
| 109 | `npc.companion-revive` | ⬜ | `$.fn`, `$.nav` | — |
| 110 | `npc.party-member` | ⬜ | `$.fn`, `$.nav` | — |
| 111 | `npc.party-formation` | ⬜ | `$.fn`, `$.nav` | — |
| 112 | `npc.squad-leader` | ⬜ | `$.fn`, `$.nav` | — |
| 113 | `npc.squad-order` | ⬜ | `$.fn`, `$.nav` | — |
| 114 | `npc.civilian-panic` | ⬜ | `$.fn`, `$.nav` | — |
| 115 | `npc.civilian-rescue` | ⬜ | `$.fn`, `$.nav` | — |
| 116 | `npc.vendor` | ⬜ | `$.fn`, `$.nav` | — |
| 117 | `npc.quest-giver` | ⬜ | `$.fn`, `$.nav` | — |
| 118 | `npc.dialogue-anchor` | ⬜ | `$.fn`, `$.nav` | — |
| 119 | `npc.escort` | ⬜ | `$.fn`, `$.nav` | — |
| 120 | `npc.recruit` | ⬜ | `$.fn`, `$.nav` | — |

## G. Взаимодействие и объекты мира — 1/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 121 | `interact.press-action` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 122 | `interact.hold-action` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 123 | `interact.context-prompt` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 124 | `interact.pickup` | ✅ | `$.audio.play`, `$.fn.overlaps`, `$.fn.remove`, `$.fn.trigger`, `$.updateFor` | — |
| 125 | `interact.door` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 126 | `interact.lock` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 127 | `interact.switch` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 128 | `interact.pressure-plate` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 129 | `interact.lever` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 130 | `interact.chest` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 131 | `interact.breakable` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 132 | `interact.pushable` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 133 | `interact.movable-crate` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 134 | `interact.moving-platform` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 135 | `interact.elevator` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 136 | `interact.teleporter` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 137 | `interact.portal` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 138 | `interact.checkpoint` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 139 | `interact.save-point` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |
| 140 | `interact.hazard` | ⬜ | `$.fn`, `$.triggers`, `$.input` | — |

## H. Подбор, инвентарь и экипировка — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 141 | `item.definition` | ⬜ | `$.items` | — |
| 142 | `item.stack` | ⬜ | `$.items` | — |
| 143 | `inventory.grid` | ⬜ | `$.inv`, `$.items` | — |
| 144 | `inventory.quickbar` | ⬜ | `$.inv`, `$.items` | — |
| 145 | `inventory.weight` | ⬜ | `$.inv`, `$.items` | — |
| 146 | `inventory.container` | ⬜ | `$.inv`, `$.items` | — |
| 147 | `inventory.transfer` | ⬜ | `$.inv`, `$.items` | — |
| 148 | `inventory.filter` | ⬜ | `$.inv`, `$.items` | — |
| 149 | `inventory.sort` | ⬜ | `$.inv`, `$.items` | — |
| 150 | `equipment.slots` | ⬜ | `$.items`, `$.inv` | — |
| 151 | `equipment.weapon-slot` | ⬜ | `$.items`, `$.inv` | — |
| 152 | `equipment.armor` | ⬜ | `$.items`, `$.inv` | — |
| 153 | `equipment.attachments` | ⬜ | `$.items`, `$.inv` | — |
| 154 | `equipment.loadout` | ⬜ | `$.items`, `$.inv` | — |
| 155 | `item.consumable` | ⬜ | `$.items` | — |
| 156 | `item.durability` | ⬜ | `$.items` | — |
| 157 | `item.quest-bound` | ⬜ | `$.items` | — |
| 158 | `item.currency` | ⬜ | `$.items` | — |
| 159 | `item.drop` | ⬜ | `$.items` | — |
| 160 | `item.loot-pickup` | ⬜ | `$.items` | — |

## I. Экономика, торговля и ремесло — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 161 | `economy.wallet` | ⬜ | `$.items`, `$.store` | — |
| 162 | `economy.price` | ⬜ | `$.items`, `$.store` | — |
| 163 | `economy.shop` | ⬜ | `$.items`, `$.store` | — |
| 164 | `economy.shop-stock` | ⬜ | `$.items`, `$.store` | — |
| 165 | `economy.trade` | ⬜ | `$.items`, `$.store` | — |
| 166 | `economy.reputation-price` | ⬜ | `$.items`, `$.store` | — |
| 167 | `economy.reward` | ⬜ | `$.items`, `$.store` | — |
| 168 | `economy.loot-table` | ⬜ | `$.items`, `$.store` | — |
| 169 | `economy.weighted-drop` | ⬜ | `$.items`, `$.store` | — |
| 170 | `economy.chest-loot` | ⬜ | `$.items`, `$.store` | — |
| 171 | `crafting.recipe` | ⬜ | `$.items`, `$.inv` | — |
| 172 | `crafting.station` | ⬜ | `$.items`, `$.inv` | — |
| 173 | `crafting.queue` | ⬜ | `$.items`, `$.inv` | — |
| 174 | `crafting.repair` | ⬜ | `$.items`, `$.inv` | — |
| 175 | `crafting.upgrade` | ⬜ | `$.items`, `$.inv` | — |
| 176 | `crafting.disassemble` | ⬜ | `$.items`, `$.inv` | — |
| 177 | `crafting.discover` | ⬜ | `$.items`, `$.inv` | — |
| 178 | `economy.income-expense` | ⬜ | `$.items`, `$.store` | — |
| 179 | `economy.auction` | ⬜ | `$.items`, `$.store` | — |
| 180 | `economy.quest-payment` | ⬜ | `$.items`, `$.store` | — |

## J. Характеристики, уровни и способности — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 181 | `stats.base` | ⬜ | `$.fn`, `$.state` | — |
| 182 | `stats.modifier` | ⬜ | `$.fn`, `$.state` | — |
| 183 | `stats.derived` | ⬜ | `$.fn`, `$.state` | — |
| 184 | `progression.xp` | ⬜ | `$.state`, `$.store` | — |
| 185 | `progression.level` | ⬜ | `$.state`, `$.store` | — |
| 186 | `progression.skill-points` | ⬜ | `$.state`, `$.store` | — |
| 187 | `progression.skill-tree` | ⬜ | `$.state`, `$.store` | — |
| 188 | `progression.perk` | ⬜ | `$.state`, `$.store` | — |
| 189 | `ability.base` | ⬜ | `$.combat`, `$.time` | — |
| 190 | `ability.cooldown` | ⬜ | `$.combat`, `$.time` | — |
| 191 | `ability.resource-cost` | ⬜ | `$.combat`, `$.time` | — |
| 192 | `ability.charge` | ⬜ | `$.combat`, `$.time` | — |
| 193 | `ability.targeting` | ⬜ | `$.combat`, `$.time` | — |
| 194 | `ability.area-effect` | ⬜ | `$.combat`, `$.time` | — |
| 195 | `ability.summon` | ⬜ | `$.combat`, `$.time` | — |
| 196 | `progression.unlock` | ⬜ | `$.state`, `$.store` | — |
| 197 | `progression.mastery` | ⬜ | `$.state`, `$.store` | — |
| 198 | `progression.challenge` | ⬜ | `$.state`, `$.store` | — |
| 199 | `progression.loadout-preset` | ⬜ | `$.state`, `$.store` | — |
| 200 | `progression.respec` | ⬜ | `$.state`, `$.store` | — |

## K. Задания, цели и миссии — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 201 | `quest.definition` | ⬜ | `$.quest` | — |
| 202 | `quest.start-condition` | ⬜ | `$.quest` | — |
| 203 | `quest.objective-visit` | ⬜ | `$.quest` | — |
| 204 | `quest.objective-collect` | ⬜ | `$.quest` | — |
| 205 | `quest.objective-defeat` | ⬜ | `$.quest` | — |
| 206 | `quest.objective-interact` | ⬜ | `$.quest` | — |
| 207 | `quest.objective-deliver` | ⬜ | `$.quest` | — |
| 208 | `quest.objective-survive` | ⬜ | `$.quest` | — |
| 209 | `quest.objective-escort` | ⬜ | `$.quest` | — |
| 210 | `quest.objective-branch` | ⬜ | `$.quest` | — |
| 211 | `quest.sequence` | ⬜ | `$.quest` | — |
| 212 | `quest.parallel` | ⬜ | `$.quest` | — |
| 213 | `quest.optional-objective` | ⬜ | `$.quest` | — |
| 214 | `quest.timer` | ⬜ | `$.quest` | — |
| 215 | `quest.failure-condition` | ⬜ | `$.quest` | — |
| 216 | `quest.reward-table` | ⬜ | `$.quest` | — |
| 217 | `quest.world-marker` | ⬜ | `$.quest` | — |
| 218 | `quest.journal` | ⬜ | `$.quest` | — |
| 219 | `mission.wave-objective` | ⬜ | `$.quest` | — |
| 220 | `mission.extraction` | ⬜ | `$.quest` | — |

## L. Диалоги и повествование — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 221 | `dialogue.tree` | ⬜ | `$.dialog` | — |
| 222 | `dialogue.choice` | ⬜ | `$.dialog` | — |
| 223 | `dialogue.condition` | ⬜ | `$.dialog` | — |
| 224 | `dialogue.action` | ⬜ | `$.dialog` | — |
| 225 | `dialogue.portrait` | ⬜ | `$.dialog` | — |
| 226 | `dialogue.typewriter` | ⬜ | `$.dialog` | — |
| 227 | `dialogue.skip` | ⬜ | `$.dialog` | — |
| 228 | `dialogue.voice-line` | ⬜ | `$.dialog` | — |
| 229 | `dialogue.auto-advance` | ⬜ | `$.dialog` | — |
| 230 | `dialogue.conversation-lock` | ⬜ | `$.dialog` | — |
| 231 | `story.flag` | ⬜ | `$.story`, `$.dialog` | — |
| 232 | `story.counter` | ⬜ | `$.story`, `$.dialog` | — |
| 233 | `story.scene-transition` | ⬜ | `$.story`, `$.dialog` | — |
| 234 | `story.cutscene` | ⬜ | `$.story`, `$.dialog` | — |
| 235 | `story.choice-history` | ⬜ | `$.story`, `$.dialog` | — |
| 236 | `story.relationship-route` | ⬜ | `$.story`, `$.dialog` | — |
| 237 | `story.chapter` | ⬜ | `$.story`, `$.dialog` | — |
| 238 | `story.ending` | ⬜ | `$.story`, `$.dialog` | — |
| 239 | `story.vn-background` | ⬜ | `$.story`, `$.dialog` | — |
| 240 | `story.vn-character` | ⬜ | `$.story`, `$.dialog` | — |

## M. Головоломки и логические механики — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 241 | `puzzle.state-machine` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 242 | `puzzle.sequence-lock` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 243 | `puzzle.keypad` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 244 | `puzzle.switch-combination` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 245 | `puzzle.light-mirrors` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 246 | `puzzle.pressure-sequence` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 247 | `puzzle.sokoban` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 248 | `puzzle.matching` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 249 | `puzzle.sliding-tiles` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 250 | `puzzle.rotating-discs` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 251 | `puzzle.wiring` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 252 | `puzzle.logic-gates` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 253 | `puzzle.memory` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 254 | `puzzle.timing` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 255 | `puzzle.hidden-object` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 256 | `puzzle.maze-switch` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 257 | `puzzle.physics-balance` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 258 | `puzzle.color-code` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 259 | `puzzle.riddle` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |
| 260 | `puzzle.reset` | ⬜ | `$.fn`, `$.triggers`, `$.signal` | — |

## N. Уровень, мир и окружение — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 261 | `world.scene-entry` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 262 | `world.scene-exit` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 263 | `world.spawn-points` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 264 | `world.checkpoint-chain` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 265 | `world.tilemap-layer` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 266 | `world.tilemap-collision` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 267 | `world.breakable-tiles` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 268 | `world.parallax-layer` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 269 | `world.light-zone` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 270 | `world.audio-zone` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 271 | `world.weather` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 272 | `world.day-night` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 273 | `world.gravity-zone` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 274 | `world.time-scale-zone` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 275 | `world.camera-boundary` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 276 | `world.one-way-platform` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 277 | `world.moving-hazard` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 278 | `world.secret-area` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 279 | `world.streamed-room` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |
| 280 | `world.level-exit` | ⬜ | `$.world`, `$.tilemap`, `$.layers` | — |

## O. Камера и экранное представление — 4/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 281 | `camera.follow` | ✅ | `$.camera.follow` | — |
| 282 | `camera.deadzone` | ⬜ | `$.camera` | — |
| 283 | `camera.lookahead` | ⬜ | `$.camera` | — |
| 284 | `camera.smoothing` | ⬜ | `$.camera` | — |
| 285 | `camera.bounds` | ✅ | `$.camera.limits` | — |
| 286 | `camera.room-lock` | ⬜ | `$.camera` | — |
| 287 | `camera.screen-shake` | ✅ | `$.camera.shake`, `$.fn.hp`, `$.updateFor` | — |
| 288 | `camera.trauma` | ⬜ | `$.camera` | — |
| 289 | `camera.zoom` | ✅ | `$.camera.zoom`, `$.camera.zoomTo` | — |
| 290 | `camera.split-screen` | ⬜ | `$.camera` | — |
| 291 | `camera.transition` | ⬜ | `$.camera` | — |
| 292 | `camera.death-focus` | ⬜ | `$.camera` | — |
| 293 | `camera.cutscene-rail` | ⬜ | `$.camera` | — |
| 294 | `camera.look-at-target` | ⬜ | `$.camera` | — |
| 295 | `camera.parallax-focus` | ⬜ | `$.camera` | — |
| 296 | `render.tint-profile` | ⬜ | `$.gfx`, `$.fx` | — |
| 297 | `render.fade` | ⬜ | `$.gfx`, `$.fx` | — |
| 298 | `render.flash` | ⬜ | `$.gfx`, `$.fx` | — |
| 299 | `render.vignette` | ⬜ | `$.gfx`, `$.fx` | — |
| 300 | `render.accessibility-filter` | ⬜ | `$.gfx`, `$.fx` | — |

## P. Анимация и визуальные состояния — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 301 | `animation.idle-run` | ⬜ | `$.anim`, `$.tween` | — |
| 302 | `animation.jump-fall` | ⬜ | `$.anim`, `$.tween` | — |
| 303 | `animation.attack` | ⬜ | `$.anim`, `$.tween` | — |
| 304 | `animation.damage` | ⬜ | `$.anim`, `$.tween` | — |
| 305 | `animation.death` | ⬜ | `$.anim`, `$.tween` | — |
| 306 | `animation.direction-4` | ⬜ | `$.anim`, `$.tween` | — |
| 307 | `animation.direction-8` | ⬜ | `$.anim`, `$.tween` | — |
| 308 | `animation.weapon-overlay` | ⬜ | `$.anim`, `$.tween` | — |
| 309 | `animation.blend-profile` | ⬜ | `$.anim`, `$.tween` | — |
| 310 | `animation.cancel-rules` | ⬜ | `$.anim`, `$.tween` | — |
| 311 | `animation.event-hooks` | ⬜ | `$.anim`, `$.tween` | — |
| 312 | `animation.loop-profile` | ⬜ | `$.anim`, `$.tween` | — |
| 313 | `animation.speed-scale` | ⬜ | `$.anim`, `$.tween` | — |
| 314 | `animation.hit-pause` | ⬜ | `$.anim`, `$.tween` | — |
| 315 | `animation.afterimage` | ⬜ | `$.anim`, `$.tween` | — |
| 316 | `animation.flash-overlay` | ⬜ | `$.anim`, `$.tween` | — |
| 317 | `animation.emote` | ⬜ | `$.anim`, `$.tween` | — |
| 318 | `animation.spawn` | ⬜ | `$.anim`, `$.tween` | — |
| 319 | `animation.respawn` | ⬜ | `$.anim`, `$.tween` | — |
| 320 | `animation.atlas-binding` | ⬜ | `$.anim`, `$.tween` | — |

## Q. Звук и обратная связь — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 321 | `audio.one-shot` | ⬜ | `$.audio`, `$.sound` | — |
| 322 | `audio.loop` | ⬜ | `$.audio`, `$.sound` | — |
| 323 | `audio.music-zone` | ⬜ | `$.audio`, `$.sound` | — |
| 324 | `audio.music-transition` | ⬜ | `$.audio`, `$.sound` | — |
| 325 | `audio.ambience` | ⬜ | `$.audio`, `$.sound` | — |
| 326 | `audio.footsteps` | ⬜ | `$.audio`, `$.sound` | — |
| 327 | `audio.weapon` | ⬜ | `$.audio`, `$.sound` | — |
| 328 | `audio.damage` | ⬜ | `$.audio`, `$.sound` | — |
| 329 | `audio.ui` | ⬜ | `$.audio`, `$.sound` | — |
| 330 | `audio.dialogue` | ⬜ | `$.audio`, `$.sound` | — |
| 331 | `audio.distance-profile` | ⬜ | `$.audio`, `$.sound` | — |
| 332 | `audio.ducking` | ⬜ | `$.audio`, `$.sound` | — |
| 333 | `feedback.hit-stop` | ⬜ | `$.hitFx`, `$.fx`, `$.camera` | — |
| 334 | `feedback.camera-shake` | ⬜ | `$.hitFx`, `$.fx`, `$.camera` | — |
| 335 | `feedback.particles` | ⬜ | `$.hitFx`, `$.fx`, `$.camera` | — |
| 336 | `feedback.screen-pulse` | ⬜ | `$.hitFx`, `$.fx`, `$.camera` | — |
| 337 | `feedback.controller-rumble` | ⬜ | `$.hitFx`, `$.fx`, `$.camera` | — |
| 338 | `feedback.combo-popup` | ⬜ | `$.hitFx`, `$.fx`, `$.camera` | — |
| 339 | `feedback.quest-toast` | ⬜ | `$.hitFx`, `$.fx`, `$.camera` | — |
| 340 | `feedback.error-prompt` | ⬜ | `$.hitFx`, `$.fx`, `$.camera` | — |

## R. RmlUi-интерфейс и HUD — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 341 | `ui.health-bar` | ⬜ | `$.ui` | — |
| 342 | `ui.stamina-bar` | ⬜ | `$.ui` | — |
| 343 | `ui.shield-bar` | ⬜ | `$.ui` | — |
| 344 | `ui.weapon-panel` | ⬜ | `$.ui` | — |
| 345 | `ui.quickbar` | ⬜ | `$.ui` | — |
| 346 | `ui.inventory-screen` | ⬜ | `$.ui` | — |
| 347 | `ui.equipment-screen` | ⬜ | `$.ui` | — |
| 348 | `ui.party-panel` | ⬜ | `$.ui` | — |
| 349 | `ui.quest-tracker` | ⬜ | `$.ui` | — |
| 350 | `ui.quest-journal` | ⬜ | `$.ui` | — |
| 351 | `ui.dialogue-box` | ⬜ | `$.ui` | — |
| 352 | `ui.choice-list` | ⬜ | `$.ui` | — |
| 353 | `ui.interaction-prompt` | ⬜ | `$.ui` | — |
| 354 | `ui.objective-marker` | ⬜ | `$.ui` | — |
| 355 | `ui.minimap-markers` | ⬜ | `$.ui` | — |
| 356 | `ui.pause-menu` | ⬜ | `$.ui` | — |
| 357 | `ui.settings-menu` | ⬜ | `$.ui` | — |
| 358 | `ui.confirm-dialog` | ⬜ | `$.ui` | — |
| 359 | `ui.loading-overlay` | ⬜ | `$.ui` | — |
| 360 | `ui.result-screen` | ⬜ | `$.ui` | — |

## S. Сохранения, настройки и доступность — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 361 | `save.profile` | ⬜ | `$.save`, `$.store` | — |
| 362 | `save.slot` | ⬜ | `$.save`, `$.store` | — |
| 363 | `save.checkpoint` | ⬜ | `$.save`, `$.store` | — |
| 364 | `save.inventory` | ⬜ | `$.save`, `$.store` | — |
| 365 | `save.quest-state` | ⬜ | `$.save`, `$.store` | — |
| 366 | `save.story-state` | ⬜ | `$.save`, `$.store` | — |
| 367 | `save.world-state` | ⬜ | `$.save`, `$.store` | — |
| 368 | `save.migration` | ⬜ | `$.save`, `$.store` | — |
| 369 | `settings.controls` | ⬜ | `$.store`, `$.ui` | — |
| 370 | `settings.audio` | ⬜ | `$.store`, `$.ui` | — |
| 371 | `settings.video` | ⬜ | `$.store`, `$.ui` | — |
| 372 | `settings.gameplay` | ⬜ | `$.store`, `$.ui` | — |
| 373 | `accessibility.text-scale` | ⬜ | `$.ui`, `$.input` | — |
| 374 | `accessibility.high-contrast` | ⬜ | `$.ui`, `$.input` | — |
| 375 | `accessibility.color-cues` | ⬜ | `$.ui`, `$.input` | — |
| 376 | `accessibility.hold-alternative` | ⬜ | `$.ui`, `$.input` | — |
| 377 | `accessibility.reduce-motion` | ⬜ | `$.ui`, `$.input` | — |
| 378 | `accessibility.subtitle` | ⬜ | `$.ui`, `$.input` | — |
| 379 | `localization.string-table` | ⬜ | `$.i18n` | — |
| 380 | `localization.number-time` | ⬜ | `$.i18n` | — |

## T. Сессии и многопользовательский проект — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 381 | `net.session-bootstrap` | ⬜ | `$.net` | — |
| 382 | `net.host-session` | ⬜ | `$.net` | — |
| 383 | `net.client-session` | ⬜ | `$.net` | — |
| 384 | `net.room-create` | ⬜ | `$.net` | — |
| 385 | `net.room-join` | ⬜ | `$.net` | — |
| 386 | `net.room-leave` | ⬜ | `$.net` | — |
| 387 | `net.lobby` | ⬜ | `$.net` | — |
| 388 | `net.ready-check` | ⬜ | `$.net` | — |
| 389 | `net.player-identity` | ⬜ | `$.net` | — |
| 390 | `net.player-spawn` | ⬜ | `$.net` | — |
| 391 | `net.player-owner` | ⬜ | `$.net` | — |
| 392 | `net.authority-profile` | ⬜ | `$.net` | — |
| 393 | `net.host-migration` | ⬜ | `$.net` | — |
| 394 | `net.disconnect-screen` | ⬜ | `$.net` | — |
| 395 | `net.reconnect` | ⬜ | `$.net` | — |
| 396 | `net.invite-code` | ⬜ | `$.net` | — |
| 397 | `net.matchmaking-filter` | ⬜ | `$.net` | — |
| 398 | `net.session-settings` | ⬜ | `$.net` | — |
| 399 | `net.coop-local` | ⬜ | `$.net` | — |
| 400 | `net.network-debug-hud` | ⬜ | `$.net` | — |

## U. Синхронизация и сетевой gameplay — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 401 | `net.replicate-transform` | ⬜ | `$.net` | — |
| 402 | `net.replicate-health` | ⬜ | `$.net` | — |
| 403 | `net.replicate-animation` | ⬜ | `$.net` | — |
| 404 | `net.replicate-inventory` | ⬜ | `$.net` | — |
| 405 | `net.input-command` | ⬜ | `$.net` | — |
| 406 | `net.server-action` | ⬜ | `$.net` | — |
| 407 | `net.damage-command` | ⬜ | `$.net` | — |
| 408 | `net.projectile-authority` | ⬜ | `$.net` | — |
| 409 | `net.interpolation-profile` | ⬜ | `$.net` | — |
| 410 | `net.prediction-profile` | ⬜ | `$.net` | — |
| 411 | `net.reconciliation` | ⬜ | `$.net` | — |
| 412 | `net.rpc-action` | ⬜ | `$.net` | — |
| 413 | `net.team-assignment` | ⬜ | `$.net` | — |
| 414 | `net.scoreboard` | ⬜ | `$.net` | — |
| 415 | `net.round-state` | ⬜ | `$.net` | — |
| 416 | `net.vote-map` | ⬜ | `$.net` | — |
| 417 | `net.spectator` | ⬜ | `$.net` | — |
| 418 | `net.shared-object` | ⬜ | `$.net` | — |
| 419 | `net.coop-revive` | ⬜ | `$.net` | — |
| 420 | `net.lag-safe-feedback` | ⬜ | `$.net` | — |

## V. Пакеты платформера, приключения и исследования — 2/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 421 | `kit.platformer-core` | ✅ | состав kit | — |
| 422 | `kit.platformer-combat` | ✅ | состав kit | — |
| 423 | `kit.platformer-collectathon` | ⬜ | состав kit | — |
| 424 | `kit.platformer-checkpoint` | ⬜ | состав kit | — |
| 425 | `kit.metroidvania-gates` | ⬜ | состав kit | — |
| 426 | `kit.metroidvania-map` | ⬜ | состав kit | — |
| 427 | `kit.adventure-interaction` | ⬜ | состав kit | — |
| 428 | `kit.adventure-inventory` | ⬜ | состав kit | — |
| 429 | `kit.puzzle-platformer` | ⬜ | состав kit | — |
| 430 | `kit.precision-platformer` | ⬜ | состав kit | — |
| 431 | `kit.parkour` | ⬜ | состав kit | — |
| 432 | `kit.underwater` | ⬜ | состав kit | — |
| 433 | `kit.gravity-platformer` | ⬜ | состав kit | — |
| 434 | `kit.vehicle-platformer` | ⬜ | состав kit | — |
| 435 | `kit.boss-platformer` | ⬜ | состав kit | — |
| 436 | `kit.platformer-coop` | ⬜ | состав kit | — |
| 437 | `kit.exploration-journal` | ⬜ | состав kit | — |
| 438 | `kit.secret-hunt` | ⬜ | состав kit | — |
| 439 | `kit.level-challenge` | ⬜ | состав kit | — |
| 440 | `kit.stage-select` | ⬜ | состав kit | — |

## W. Пакеты shooter, action и roguelike — 1/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 441 | `kit.top-down-shooter` | ✅ | состав kit | — |
| 442 | `kit.twin-stick-arena` | ⬜ | состав kit | — |
| 443 | `kit.bullet-heaven` | ⬜ | состав kit | — |
| 444 | `kit.arena-survival` | ⬜ | состав kit | — |
| 445 | `kit.stealth` | ⬜ | состав kit | — |
| 446 | `kit.infiltration` | ⬜ | состав kit | — |
| 447 | `kit.cover-shooter` | ⬜ | состав kit | — |
| 448 | `kit.shooter-loadout` | ⬜ | состав kit | — |
| 449 | `kit.boss-rush` | ⬜ | состав kit | — |
| 450 | `kit.roguelike-run` | ⬜ | состав kit | — |
| 451 | `kit.roguelite-meta` | ⬜ | состав kit | — |
| 452 | `kit.deckbuilder-battle` | ⬜ | состав kit | — |
| 453 | `kit.action-combo` | ⬜ | состав kit | — |
| 454 | `kit.fighting-game` | ⬜ | состав kit | — |
| 455 | `kit.beat-em-up` | ⬜ | состав kit | — |
| 456 | `kit.tower-defense` | ⬜ | состав kit | — |
| 457 | `kit.lane-defense` | ⬜ | состав kit | — |
| 458 | `kit.bomb-arena` | ⬜ | состав kit | — |
| 459 | `kit.survival-combat` | ⬜ | состав kit | — |
| 460 | `kit.horde-defense` | ⬜ | состав kit | — |

## X. Пакеты RPG, тактики, симуляции и спорта — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 461 | `kit.jrpg-party` | ⬜ | состав kit | — |
| 462 | `kit.jrpg-turn-battle` | ⬜ | состав kit | — |
| 463 | `kit.tactical-grid` | ⬜ | состав kit | — |
| 464 | `kit.tactical-squad` | ⬜ | состав kit | — |
| 465 | `kit.crpg-dialogue` | ⬜ | состав kit | — |
| 466 | `kit.dungeon-crawl` | ⬜ | состав kit | — |
| 467 | `kit.life-sim` | ⬜ | состав kit | — |
| 468 | `kit.farming` | ⬜ | состав kit | — |
| 469 | `kit.fishing` | ⬜ | состав kit | — |
| 470 | `kit.crafting-survival` | ⬜ | состав kit | — |
| 471 | `kit.colony-management` | ⬜ | состав kit | — |
| 472 | `kit.business-sim` | ⬜ | состав kit | — |
| 473 | `kit.traffic-management` | ⬜ | состав kit | — |
| 474 | `kit.racing-time-trial` | ⬜ | состав kit | — |
| 475 | `kit.racing-combat` | ⬜ | состав kit | — |
| 476 | `kit.sports-match` | ⬜ | состав kit | — |
| 477 | `kit.platform-sports` | ⬜ | состав kit | — |
| 478 | `kit.rhythm` | ⬜ | состав kit | — |
| 479 | `kit.music-arcade` | ⬜ | состав kit | — |
| 480 | `kit.pinball` | ⬜ | состав kit | — |

## Y. Narrative, обучение, полный проект и QA — 0/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 481 | `kit.visual-novel` | ⬜ | состав kit | — |
| 482 | `kit.romance-routes` | ⬜ | состав kit | — |
| 483 | `kit.mystery-investigation` | ⬜ | состав kit | — |
| 484 | `kit.episodic-story` | ⬜ | состав kit | — |
| 485 | `kit.horror` | ⬜ | состав kit | — |
| 486 | `kit.escape-room` | ⬜ | состав kit | — |
| 487 | `kit.tutorial` | ⬜ | состав kit | — |
| 488 | `kit.daily-challenge` | ⬜ | состав kit | — |
| 489 | `kit.achievement-set` | ⬜ | состав kit | — |
| 490 | `kit.replay-ghost` | ⬜ | состав kit | — |
| 491 | `kit.local-coop` | ⬜ | состав kit | — |
| 492 | `kit.authoritative-coop` | ⬜ | состав kit | — |
| 493 | `kit.arena-multiplayer` | ⬜ | состав kit | — |
| 494 | `kit.multiplayer-survival` | ⬜ | состав kit | — |
| 495 | `kit.project-platformer` | ⬜ | состав kit | — |
| 496 | `kit.project-top-down-action` | ⬜ | состав kit | — |
| 497 | `kit.project-vn-romance` | ⬜ | состав kit | — |
| 498 | `kit.project-jrpg` | ⬜ | состав kit | — |
| 499 | `kit.project-coop-adventure` | ⬜ | состав kit | — |
| 500 | `kit.project-witch` | ⬜ | состав kit | — |
