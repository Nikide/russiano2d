# Матрица пакетов сниппетов

Сгенерировано `python3 scripts/snippet_matrix.py` из §12 [ТЗ](SNIPPET_SYSTEM_PROJECT.md),
каталога `snippets/` и `api.schema.json`. Руками не править.

Реализовано: **207 из 500**. Строк с пробелом API: **0**.

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
| 006 | `projectile.base` | ✅ | `$.fn.add`, `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.has`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.remove`, `$.selection.each`, `$.selection.get`, `$.updateFor` | — |
| 007 | `pickup.base` | ✅ | `$.emit`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.remove`, `$.updateFor` | — |
| 008 | `breakable.base` | ✅ | `$.fn.addClass`, `$.fn.alive`, `$.fn.emit`, `$.fn.fadeOut`, `$.fn.has`, `$.fn.health`, `$.fn.pos`, `$.fn.remove`, `$.prefab.has`, `$.prefab.instantiate`, `$.updateFor`, `$.world` | — |
| 009 | `trigger.base` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.triggers` | — |
| 010 | `interactable.base` | ✅ | `$.emit`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.input.pressed`, `$.updateFor` | — |
| 011 | `actor.faction` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.removeClass` | — |
| 012 | `actor.identity` | ✅ | `$.fn.data` | — |
| 013 | `actor.spawn-profile` | ✅ | `$.fn.angle`, `$.fn.at`, `$.fn.size` | — |
| 014 | `actor.visual-profile` | ✅ | `$.fn.sprite` | — |
| 015 | `actor.control-profile` | ✅ | `$.fn.controls` | — |
| 016 | `actor.player-slot` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.removeClass` | — |
| 017 | `actor.tags` | ✅ | `$.fn.addClass`, `$.fn.addTag`, `$.fn.removeClass`, `$.fn.removeTag` | — |
| 018 | `actor.attributes` | ✅ | `$.fn.data`, `$.fn.slice` | — |
| 019 | `actor.lifecycle` | ✅ | `$.fn.active`, `$.fn.emit`, `$.fn.hide`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.fn.show`, `$.off`, `$.on`, `$.updateFor` | — |
| 020 | `actor.prefab-variant` | ✅ | `$.fn.emit`, `$.fn.has`, `$.fn.pos`, `$.prefab.has`, `$.prefab.instantiate`, `$.world` | — |

## B. Движение и перемещение — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 021 | `movement.top-down` | ✅ | `$.fn.velocity`, `$.input.vec`, `$.updateFor` | — |
| 022 | `movement.platformer` | ✅ | `$.fn.jump`, `$.fn.onFloor`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor` | — |
| 023 | `movement.twin-stick` | ✅ | `$.fn.data`, `$.fn.lookAt`, `$.fn.velocity`, `$.input.mouseWorld`, `$.input.vec`, `$.updateFor` | — |
| 024 | `movement.analog` | ✅ | `$.fn.min`, `$.fn.velocity`, `$.input.padAxis`, `$.updateFor` | — |
| 025 | `movement.click-to-move` | ✅ | `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.input.mousePressed`, `$.input.mouseWorld`, `$.updateFor` | — |
| 026 | `movement.follow-path` | ✅ | `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 027 | `movement.dash` | ✅ | `$.fn.emit`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor` | — |
| 028 | `movement.dodge-roll` | ✅ | `$.fn.emit`, `$.fn.invulnerable`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor` | — |
| 029 | `movement.coyote-jump` | ✅ | `$.fn.jump`, `$.fn.onFloor`, `$.input.pressed`, `$.updateFor` | — |
| 030 | `movement.jump-buffer` | ✅ | `$.fn.jump`, `$.fn.onFloor`, `$.input.pressed`, `$.updateFor` | — |
| 031 | `movement.double-jump` | ✅ | `$.fn.jump`, `$.fn.onFloor`, `$.input.pressed`, `$.updateFor` | — |
| 032 | `movement.wall-slide` | ✅ | `$.fn.onFloor`, `$.fn.onWall`, `$.fn.velocity`, `$.updateFor` | — |
| 033 | `movement.wall-jump` | ✅ | `$.fn.emit`, `$.fn.flip`, `$.fn.onFloor`, `$.fn.onWall`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor` | — |
| 034 | `movement.climb` | ✅ | `$.fn.emit`, `$.fn.gravity`, `$.fn.overlaps`, `$.fn.some`, `$.fn.velocity`, `$.input.vec`, `$.updateFor` | — |
| 035 | `movement.swim` | ✅ | `$.fn.emit`, `$.fn.max`, `$.fn.overlaps`, `$.fn.some`, `$.fn.velocity`, `$.input.vec`, `$.updateFor` | — |
| 036 | `movement.crouch` | ✅ | `$.fn.emit`, `$.fn.height`, `$.fn.size`, `$.fn.velocity`, `$.fn.width`, `$.input.down`, `$.updateFor` | — |
| 037 | `movement.prone` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.height`, `$.fn.size`, `$.fn.velocity`, `$.fn.width`, `$.input.pressed`, `$.updateFor` | — |
| 038 | `movement.knockback` | ✅ | `$.fn.closest`, `$.fn.externalVelocity`, `$.fn.first`, `$.fn.hp`, `$.fn.pos`, `$.updateFor` | — |
| 039 | `movement.platform-ride` | ✅ | `$.fn.at`, `$.fn.height`, `$.fn.onFloor`, `$.fn.pos`, `$.fn.width`, `$.selection.each`, `$.selection.get`, `$.updateFor` | — |
| 040 | `movement.vehicle-seat` | ✅ | `$.fn.active`, `$.fn.at`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.height`, `$.fn.hide`, `$.fn.pos`, `$.fn.show`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor` | — |

## C. Оружие и атаки — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 041 | `weapon.base` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.input.down`, `$.input.pressed`, `$.sound.play`, `$.updateFor`, `$.weapons`, `$.weapons.define`, `$.weapons.give`, `$.weapons.has` | — |
| 042 | `weapon.melee` | ✅ | `$.fn.damage`, `$.fn.emit`, `$.fn.filter`, `$.fn.hp`, `$.fn.is`, `$.fn.pos`, `$.input.pressed`, `$.input.vec`, `$.selection.get`, `$.updateFor`, `$.world.query` | — |
| 043 | `weapon.hitscan` | ✅ | `$.fn.damage`, `$.fn.emit`, `$.fn.find`, `$.fn.hp`, `$.fn.is`, `$.fn.max`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.input.vec`, `$.selection.get`, `$.updateFor`, `$.weapons.falloff`, `$.world.raycastAll` | — |
| 044 | `weapon.projectile` | ✅ | `$.fn.appendTo`, `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.find`, `$.fn.hp`, `$.fn.is`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.fn.sprite`, `$.input.vec`, `$.selection.get`, `$.updateFor`, `$.world`, `$.world.query` | — |
| 045 | `weapon.spread` | ✅ | `$.fn.appendTo`, `$.fn.at`, `$.fn.damage`, `$.fn.find`, `$.fn.is`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.input.vec`, `$.selection.get`, `$.updateFor`, `$.world`, `$.world.query` | — |
| 046 | `weapon.auto` | ✅ | `$.fn.emit`, `$.input.down`, `$.input.pressed`, `$.updateFor`, `$.weapons.of` | — |
| 047 | `weapon.burst` | ✅ | `$.fn.emit`, `$.input.down`, `$.input.pressed`, `$.updateFor`, `$.weapons.of` | — |
| 048 | `weapon.charge` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.input.down`, `$.input.pressed`, `$.updateFor`, `$.weapons.of` | — |
| 049 | `weapon.beam` | ✅ | `$.fn.damage`, `$.fn.emit`, `$.fn.find`, `$.fn.is`, `$.fn.pos`, `$.input.down`, `$.input.vec`, `$.selection.get`, `$.updateFor`, `$.world.raycastAll` | — |
| 050 | `weapon.boomerang` | ✅ | `$.fn.add`, `$.fn.appendTo`, `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.has`, `$.fn.is`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.input.pressed`, `$.input.vec`, `$.selection.get`, `$.updateFor`, `$.world`, `$.world.query` | — |
| 051 | `weapon.grenade` | ✅ | `$.emit`, `$.fn.appendTo`, `$.fn.at`, `$.fn.body`, `$.fn.damage`, `$.fn.emit`, `$.fn.filter`, `$.fn.is`, `$.fn.max`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.updateFor`, `$.world`, `$.world.query` | — |
| 052 | `weapon.mine` | ✅ | `$.emit`, `$.fn.appendTo`, `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.filter`, `$.fn.is`, `$.fn.max`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.fn.some`, `$.input.pressed`, `$.selection.get`, `$.updateFor`, `$.world`, `$.world.query` | — |
| 053 | `weapon.shotgun` | ✅ | `$.fn.emit`, `$.fn.has`, `$.input.pressed`, `$.updateFor`, `$.weapons.define`, `$.weapons.give`, `$.weapons.has` | — |
| 054 | `weapon.sniper` | ✅ | `$.camera.zoom`, `$.camera.zoomTo`, `$.fn.damage`, `$.fn.emit`, `$.fn.filter`, `$.fn.is`, `$.fn.pos`, `$.fn.slice`, `$.input.down`, `$.input.pressed`, `$.input.vec`, `$.selection.get`, `$.updateFor`, `$.world.raycastAll` | — |
| 055 | `weapon.rocket` | ✅ | `$.emit`, `$.fn.angle`, `$.fn.appendTo`, `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.filter`, `$.fn.is`, `$.fn.max`, `$.fn.min`, `$.fn.pos`, `$.fn.reduce`, `$.fn.remove`, `$.fn.size`, `$.input.pressed`, `$.input.vec`, `$.updateFor`, `$.world`, `$.world.query` | — |
| 056 | `weapon.chain-lightning` | ✅ | `$.fn.add`, `$.fn.damage`, `$.fn.emit`, `$.fn.has`, `$.fn.pos`, `$.input.pressed`, `$.updateFor` | — |
| 057 | `weapon.area-denial` | ✅ | `$.fn.alpha`, `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.damage`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.input.pressed`, `$.input.vec`, `$.selection.each`, `$.selection.get`, `$.updateFor`, `$.world` | — |
| 058 | `weapon.weapon-switch` | ✅ | `$.fn.emit`, `$.fn.has`, `$.fn.max`, `$.input.pressed`, `$.input.wheel`, `$.updateFor`, `$.weapons`, `$.weapons.give`, `$.weapons.has`, `$.weapons.of` | — |
| 059 | `weapon.ammo` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.max`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.updateFor`, `$.weapons.of` | — |
| 060 | `weapon.reload` | ✅ | `$.fn.emit`, `$.input.pressed`, `$.updateFor`, `$.weapons.of` | — |

## D. Здоровье, защита и состояния — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 061 | `health.base` | ✅ | `$.fn.fadeOut`, `$.fn.health`, `$.fn.off`, `$.fn.on`, `$.fn.remove` | — |
| 062 | `health.damage-types` | ✅ | `$.fn.damageFilter`, `$.fn.data`, `$.fn.slice` | — |
| 063 | `health.armor` | ✅ | `$.fn.damageFilter`, `$.fn.max` | — |
| 064 | `health.resistance` | ✅ | `$.fn.damageFilter`, `$.fn.max`, `$.fn.min`, `$.fn.slice` | — |
| 065 | `health.shield` | ✅ | `$.fn.damageFilter`, `$.fn.data`, `$.fn.emit`, `$.fn.min`, `$.updateFor` | — |
| 066 | `health.regeneration` | ✅ | `$.fn.alive`, `$.fn.heal`, `$.fn.hp`, `$.updateFor` | — |
| 067 | `health.invulnerability` | ✅ | `$.fn.alive`, `$.fn.alpha`, `$.fn.hp`, `$.fn.invulnerable`, `$.updateFor` | — |
| 068 | `health.hit-flash` | ✅ | `$.fn.flash`, `$.fn.hp`, `$.updateFor` | — |
| 069 | `health.knockback-reaction` | ✅ | `$.fn.externalVelocity`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.pos` | — |
| 070 | `health.stagger` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.max`, `$.fn.off`, `$.fn.on`, `$.fn.velocity`, `$.updateFor` | — |
| 071 | `health.poison` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.data`, `$.fn.emit`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.updateFor` | — |
| 072 | `health.burning` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.data`, `$.fn.emit`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.overlaps`, `$.fn.some`, `$.updateFor` | — |
| 073 | `health.freeze` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.velocity`, `$.updateFor` | — |
| 074 | `health.slow` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.onFloor`, `$.fn.velocity`, `$.updateFor` | — |
| 075 | `health.bleed` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.data`, `$.fn.emit`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.updateFor` | — |
| 076 | `health.buff-debuff` | ✅ | `$.fn.data`, `$.fn.off`, `$.fn.on`, `$.fn.slice`, `$.updateFor` | — |
| 077 | `health.death` | ✅ | `$.emit`, `$.fn.alive`, `$.fn.alpha`, `$.fn.controls`, `$.fn.emit`, `$.fn.fadeOut`, `$.fn.flash`, `$.fn.remove`, `$.fn.velocity`, `$.updateFor` | — |
| 078 | `health.respawn` | ✅ | `$.fn.alive`, `$.fn.data`, `$.fn.emit`, `$.fn.respawn`, `$.updateFor` | — |
| 079 | `health.revive` | ✅ | `$.fn.alive`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.hp`, `$.fn.min`, `$.input.down`, `$.updateFor` | — |
| 080 | `health.damage-number` | ✅ | `$.fn.alpha`, `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.height`, `$.fn.max`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.updateFor`, `$.world` | — |

## E. Поведение врагов — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 081 | `ai.idle` | ✅ | `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.flip`, `$.updateFor` | — |
| 082 | `ai.waypoint-patrol` | ✅ | `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.moveTowards`, `$.fn.onWall`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 083 | `ai.chase` | ✅ | `$.fn.distanceTo`, `$.fn.moveTowards`, `$.updateFor` | — |
| 084 | `ai.melee-attack` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.moveTowards`, `$.updateFor` | — |
| 085 | `ai.ranged-attack` | ✅ | `$.fn.alive`, `$.fn.appendTo`, `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.fn.velocity`, `$.updateFor`, `$.world` | — |
| 086 | `ai.flee` | ✅ | `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 087 | `ai.guard-post` | ✅ | `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 088 | `ai.follow-target` | ✅ | `$.fn.distanceTo`, `$.fn.moveTowards`, `$.updateFor` | — |
| 089 | `ai.line-of-sight` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.flip`, `$.fn.pos`, `$.updateFor`, `$.world.lineOfSight` | — |
| 090 | `ai.hearing` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.off`, `$.on` | — |
| 091 | `ai.investigate` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 092 | `ai.search` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.updateFor` | — |
| 093 | `ai.cover` | ✅ | `$.fn.data`, `$.fn.distanceTo`, `$.fn.height`, `$.fn.max`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.fn.width`, `$.selection.each`, `$.updateFor` | — |
| 094 | `ai.flank` | ✅ | `$.fn.emit`, `$.fn.flip`, `$.fn.moveTowards`, `$.fn.pos`, `$.updateFor` | — |
| 095 | `ai.formation` | ✅ | `$.fn.flip`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 096 | `ai.boss-phases` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.hp`, `$.fn.map`, `$.fn.removeClass`, `$.updateFor` | — |
| 097 | `ai.boss-telegraph` | ✅ | `$.fn.alpha`, `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.damage`, `$.fn.emit`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.selection.get`, `$.updateFor`, `$.world`, `$.world.query` | — |
| 098 | `ai.spawner` | ✅ | `$.fn.emit`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.off`, `$.on`, `$.prefab.has`, `$.prefab.instantiate`, `$.updateFor`, `$.world` | — |
| 099 | `ai.wave-director` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.prefab.has`, `$.prefab.instantiate`, `$.updateFor`, `$.world` | — |
| 100 | `ai.leash` | ✅ | `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.updateFor` | — |

## F. NPC, союзники и группы — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 101 | `npc.schedule` | ✅ | `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.moveTowards`, `$.fn.pos`, `$.time.now`, `$.updateFor` | — |
| 102 | `npc.home-routine` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.time.now`, `$.updateFor` | — |
| 103 | `npc.daily-needs` | ✅ | `$.fn.data`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.max`, `$.fn.min`, `$.fn.moveTowards`, `$.fn.pos`, `$.updateFor` | — |
| 104 | `npc.personality` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.max`, `$.fn.min` | — |
| 105 | `npc.relationship` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.emit`, `$.fn.max`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.removeClass` | — |
| 106 | `npc.reputation` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.max`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on` | — |
| 107 | `npc.companion-follow` | ✅ | `$.camera.isOnScreen`, `$.fn.at`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 108 | `npc.companion-command` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.input.pressed`, `$.selection.each`, `$.updateFor` | — |
| 109 | `npc.companion-revive` | ✅ | `$.fn.alive`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.hp`, `$.fn.moveTowards`, `$.updateFor` | — |
| 110 | `npc.party-member` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.slice` | — |
| 111 | `npc.party-formation` | ✅ | `$.fn.attr`, `$.fn.data`, `$.fn.flip`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.slice`, `$.fn.velocity`, `$.updateFor` | — |
| 112 | `npc.squad-leader` | ✅ | `$.fn.addClass`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.pos`, `$.selection.each`, `$.updateFor` | — |
| 113 | `npc.squad-order` | ✅ | `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 114 | `npc.civilian-panic` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.hasClass`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.removeClass`, `$.fn.velocity`, `$.off`, `$.on`, `$.selection.each`, `$.updateFor` | — |
| 115 | `npc.civilian-rescue` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.overlaps`, `$.fn.remove`, `$.fn.some`, `$.updateFor` | — |
| 116 | `npc.vendor` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.input.pressed`, `$.updateFor` | — |
| 117 | `npc.quest-giver` | ✅ | `$.fn.distanceTo`, `$.fn.emit`, `$.input.pressed`, `$.quest.accept`, `$.quest.status`, `$.quest.turnIn`, `$.updateFor` | — |
| 118 | `npc.dialogue-anchor` | ✅ | `$.dialog.has`, `$.dialog.isOpen`, `$.dialog.play`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.has`, `$.input.pressed`, `$.updateFor` | — |
| 119 | `npc.escort` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.hp`, `$.fn.moveTowards`, `$.fn.overlaps`, `$.fn.some`, `$.fn.velocity`, `$.selection.get`, `$.updateFor` | — |
| 120 | `npc.recruit` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.slice`, `$.input.pressed`, `$.updateFor` | — |

## G. Взаимодействие и объекты мира — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 121 | `interact.press-action` | ✅ | `$.fn.distanceTo`, `$.fn.emit`, `$.input.pressed`, `$.selection.each`, `$.updateFor` | — |
| 122 | `interact.hold-action` | ✅ | `$.emit`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.min`, `$.input.down`, `$.updateFor` | — |
| 123 | `interact.context-prompt` | ✅ | `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.height`, `$.fn.hide`, `$.fn.pos`, `$.fn.remove`, `$.fn.show`, `$.fn.text`, `$.selection.each`, `$.updateFor`, `$.world` | — |
| 124 | `interact.pickup` | ✅ | `$.audio.play`, `$.fn.overlaps`, `$.fn.remove`, `$.fn.trigger`, `$.updateFor` | — |
| 125 | `interact.door` | ✅ | `$.fn.addClass`, `$.fn.alpha`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.fn.sensor`, `$.input.pressed`, `$.updateFor` | — |
| 126 | `interact.lock` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.updateFor` | — |
| 127 | `interact.switch` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.input.pressed`, `$.updateFor` | — |
| 128 | `interact.pressure-plate` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.overlaps`, `$.selection.each`, `$.updateFor` | — |
| 129 | `interact.lever` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.attr`, `$.fn.color`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.flip`, `$.fn.off`, `$.fn.on`, `$.input.pressed`, `$.updateFor` | — |
| 130 | `interact.chest` | ✅ | `$.emit`, `$.fn.add`, `$.fn.addClass`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.input.pressed`, `$.items.has`, `$.updateFor` | — |
| 131 | `interact.breakable` | ✅ | `$.emit`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.flash`, `$.fn.health`, `$.fn.hp`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove` | — |
| 132 | `interact.pushable` | ✅ | `$.fn.at`, `$.fn.emit`, `$.fn.height`, `$.fn.pos`, `$.fn.velocity`, `$.fn.width`, `$.updateFor`, `$.world.castShape` | — |
| 133 | `interact.movable-crate` | ✅ | `$.fn.addClass`, `$.fn.at`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.flip`, `$.fn.gravity`, `$.fn.height`, `$.fn.pos`, `$.fn.velocity`, `$.input.pressed`, `$.updateFor` | — |
| 134 | `interact.moving-platform` | ✅ | `$.fn.addClass`, `$.fn.at`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.pos`, `$.updateFor` | — |
| 135 | `interact.elevator` | ✅ | `$.fn.addClass`, `$.fn.at`, `$.fn.emit`, `$.fn.filter`, `$.fn.height`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.width`, `$.input.pressed`, `$.updateFor` | — |
| 136 | `interact.teleporter` | ✅ | `$.fn.at`, `$.fn.data`, `$.fn.emit`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.velocity`, `$.time.now`, `$.updateFor` | — |
| 137 | `interact.portal` | ✅ | `$.fn.emit`, `$.fn.overlaps`, `$.scene.load`, `$.store`, `$.store.set`, `$.updateFor` | — |
| 138 | `interact.checkpoint` | ✅ | `$.fn.addClass`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.hp`, `$.fn.overlaps`, `$.fn.pos`, `$.selection.get`, `$.store.set`, `$.updateFor` | — |
| 139 | `interact.save-point` | ✅ | `$.fn.addClass`, `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.input.pressed`, `$.save.slot`, `$.updateFor` | — |
| 140 | `interact.hazard` | ✅ | `$.fn.damage`, `$.fn.overlaps`, `$.selection.each`, `$.updateFor` | — |

## H. Подбор, инвентарь и экипировка — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 141 | `item.definition` | ✅ | `$.items`, `$.items.define` | — |
| 142 | `item.stack` | ✅ | `$.fn.filter`, `$.fn.map`, `$.fn.max`, `$.items.define`, `$.items.get`, `$.selection.get` | — |
| 143 | `inventory.grid` | ✅ | `$.fn.add`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.inv.create`, `$.items.has`, `$.off`, `$.on`, `$.selection.get` | — |
| 144 | `inventory.quickbar` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.slice`, `$.input.pressed`, `$.updateFor` | — |
| 145 | `inventory.weight` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.mass`, `$.fn.velocity`, `$.inv`, `$.updateFor` | — |
| 146 | `inventory.container` | ✅ | `$.emit`, `$.fn.add`, `$.fn.addClass`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.input.pressed`, `$.inv`, `$.inv.create`, `$.items.has`, `$.updateFor` | — |
| 147 | `inventory.transfer` | ✅ | `$.fn.add`, `$.fn.count`, `$.fn.data`, `$.fn.emit`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.inv` | — |
| 148 | `inventory.filter` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.inv`, `$.items.get`, `$.selection.get` | — |
| 149 | `inventory.sort` | ✅ | `$.fn.add`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.input.pressed`, `$.inv`, `$.items.get`, `$.selection.get`, `$.updateFor` | — |
| 150 | `equipment.slots` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.inv`, `$.items.get`, `$.selection.get` | — |
| 151 | `equipment.weapon-slot` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.inv`, `$.items.get`, `$.selection.get`, `$.weapons.give`, `$.weapons.has` | — |
| 152 | `equipment.armor` | ✅ | `$.fn.damageFilter`, `$.fn.data`, `$.fn.max`, `$.inv` | — |
| 153 | `equipment.attachments` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.inv`, `$.items.has`, `$.weapons.mod`, `$.weapons.of` | — |
| 154 | `equipment.loadout` | ✅ | `$.fn.add`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.inv`, `$.items.has` | — |
| 155 | `item.consumable` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.find`, `$.fn.has`, `$.fn.heal`, `$.fn.remove`, `$.input.pressed`, `$.inv`, `$.items.get`, `$.selection.get`, `$.updateFor` | — |
| 156 | `item.durability` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.find`, `$.fn.max`, `$.fn.off`, `$.fn.on`, `$.inv`, `$.items.get`, `$.selection.get` | — |
| 157 | `item.quest-bound` | ✅ | `$.fn.add`, `$.fn.count`, `$.fn.data`, `$.fn.emit`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.inv`, `$.updateFor` | — |
| 158 | `item.currency` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.selection.get` | — |
| 159 | `item.drop` | ✅ | `$.emit`, `$.fn.appendTo`, `$.fn.at`, `$.fn.data`, `$.fn.emit`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.random.chance`, `$.updateFor`, `$.world` | — |
| 160 | `item.loot-pickup` | ✅ | `$.fn.add`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.remove`, `$.input.pressed`, `$.inv`, `$.selection.each`, `$.updateFor` | — |

## I. Экономика, торговля и ремесло — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 161 | `economy.wallet` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.min`, `$.fn.off`, `$.fn.on` | — |
| 162 | `economy.price` | ✅ | `$.fn.filter`, `$.fn.map`, `$.items.define`, `$.items.get`, `$.items.ids`, `$.selection.get` | — |
| 163 | `economy.shop` | ✅ | `$.fn.add`, `$.fn.attr`, `$.fn.count`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.max`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.inv`, `$.items.get`, `$.selection.get` | — |
| 164 | `economy.shop-stock` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.updateFor` | — |
| 165 | `economy.trade` | ✅ | `$.fn.add`, `$.fn.count`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.reduce`, `$.fn.remove`, `$.inv`, `$.items.get`, `$.selection.get` | — |
| 166 | `economy.reputation-price` | ✅ | `$.fn.attr`, `$.fn.data`, `$.fn.max`, `$.fn.min`, `$.updateFor` | — |
| 167 | `economy.reward` | ✅ | `$.emit`, `$.fn.add`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.inv`, `$.items.has`, `$.off`, `$.on` | — |
| 168 | `economy.loot-table` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.random.int`, `$.random.seed`, `$.random.weighted` | — |
| 169 | `economy.weighted-drop` | ✅ | `$.emit`, `$.fn.appendTo`, `$.fn.at`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.random.int`, `$.random.seed`, `$.random.weighted`, `$.updateFor`, `$.world` | — |
| 170 | `economy.chest-loot` | ✅ | `$.fn.add`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.inv`, `$.items.has`, `$.random.int`, `$.random.seed`, `$.random.weighted` | — |
| 171 | `crafting.recipe` | ✅ | `$.fn.count`, `$.fn.data`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map` | — |
| 172 | `crafting.station` | ✅ | `$.emit`, `$.fn.add`, `$.fn.addClass`, `$.fn.count`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.find`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.input.pressed`, `$.inv`, `$.updateFor` | — |
| 173 | `crafting.queue` | ✅ | `$.fn.add`, `$.fn.count`, `$.fn.data`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.inv`, `$.updateFor` | — |
| 174 | `crafting.repair` | ✅ | `$.fn.count`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.fn.some`, `$.inv` | — |
| 175 | `crafting.upgrade` | ✅ | `$.fn.add`, `$.fn.count`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.find`, `$.fn.has`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.fn.some`, `$.inv` | — |
| 176 | `crafting.disassemble` | ✅ | `$.fn.add`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.inv` | — |
| 177 | `crafting.discover` | ✅ | `$.fn.add`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on` | — |
| 178 | `economy.income-expense` | ✅ | `$.fn.data`, `$.fn.off`, `$.fn.on`, `$.time.now` | — |
| 179 | `economy.auction` | ✅ | `$.emit`, `$.fn.add`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.inv`, `$.items.has`, `$.updateFor` | — |
| 180 | `economy.quest-payment` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on` | — |

## J. Характеристики, уровни и способности — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 181 | `stats.base` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map` | — |
| 182 | `stats.modifier` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map` | — |
| 183 | `stats.derived` | ✅ | `$.fn.data`, `$.fn.filter`, `$.fn.map`, `$.fn.maxHp`, `$.fn.off`, `$.fn.on`, `$.fn.speed` | — |
| 184 | `progression.xp` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on` | — |
| 185 | `progression.level` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.hp`, `$.fn.off`, `$.fn.on`, `$.fn.slice`, `$.selection.get` | — |
| 186 | `progression.skill-points` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on` | — |
| 187 | `progression.skill-tree` | ✅ | `$.fn.add`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.some` | — |
| 188 | `progression.perk` | ✅ | `$.fn.damageFilter`, `$.fn.data` | — |
| 189 | `ability.base` | ✅ | `$.fn.emit`, `$.fn.pos`, `$.input.pressed`, `$.updateFor` | — |
| 190 | `ability.cooldown` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.max`, `$.fn.off`, `$.fn.on`, `$.updateFor` | — |
| 191 | `ability.resource-cost` | ✅ | `$.fn.data`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.updateFor` | — |
| 192 | `ability.charge` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.updateFor` | — |
| 193 | `ability.targeting` | ✅ | `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.input.mouseWorld`, `$.selection.each` | — |
| 194 | `ability.area-effect` | ✅ | `$.fn.damage`, `$.fn.emit`, `$.fn.heal`, `$.fn.is`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.world.query` | — |
| 195 | `ability.summon` | ✅ | `$.fn.emit`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.prefab.has`, `$.prefab.instantiate`, `$.updateFor`, `$.world` | — |
| 196 | `progression.unlock` | ✅ | `$.emit`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.selection.get`, `$.store.get`, `$.store.set`, `$.updateFor` | — |
| 197 | `progression.mastery` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on` | — |
| 198 | `progression.challenge` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.time.now` | — |
| 199 | `progression.loadout-preset` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.fn.slice` | — |
| 200 | `progression.respec` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.reduce` | — |

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
| 287 | `camera.screen-shake` | ✅ | `$.camera.shake`, `$.fn.hp`, `$.fn.shake`, `$.updateFor` | — |
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
