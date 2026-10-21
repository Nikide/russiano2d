# Матрица пакетов сниппетов

Сгенерировано `python3 scripts/snippet_matrix.py` из §12 [ТЗ](SNIPPET_SYSTEM_PROJECT.md),
каталога `snippets/` и `api.schema.json`. Руками не править.

Реализовано: **500 из 500**. Строк с пробелом (API или механика вне §12): **0**.

Колонка API: для реализованного пакета — фактические `requires`; для
запланированного — опорные пространства `$` по префиксу ID (предварительно,
уточняется при реализации пакета).

Полные строки §11.1 в [matrix.json](../snippets/matrix.json): версия, сценарий, source,
examples/package tests, runtime/lifecycle contract, совместимость/миграции и проверки.
Runtime smoke, manifest/API/resource validation и детерминизм проходят для всех 500;
9210 boundary cases проверяют все 1278 полей через native validator. Семантические
assertions разделов и жанров дополняют эти общие проверки, а не заменяют их.


## A. Базовые сущности и управление — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 001 | `actor.base` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.hide`, `$.fn.removeClass`, `$.fn.show` | — |
| 002 | `player.base` | ✅ | `$.camera.follow`, `$.camera.unfollow`, `$.fn.addClass`, `$.fn.controls`, `$.fn.removeClass`, `$.fn.speed` | — |
| 003 | `npc.base` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.removeClass`, `$.fn.team` | — |
| 004 | `enemy.base` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.health`, `$.fn.removeClass`, `$.fn.team` | — |
| 005 | `survival.oxygen` | ✅ | `$.fn.damage`, `$.fn.data`, `$.fn.max`, `$.fn.min`, `$.fn.overlaps`, `$.fn.some`, `$.updateFor` | — |
| 006 | `projectile.base` | ✅ | `$.fn.add`, `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.has`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.remove`, `$.selection.each`, `$.selection.get`, `$.updateFor` | — |
| 007 | `physics.ball` | ✅ | `$.fn.addClass`, `$.fn.at`, `$.fn.attr`, `$.fn.body`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.velocity`, `$.off`, `$.on`, `$.selection.each`, `$.selection.get`, `$.updateFor` | — |
| 008 | `pinball.flipper` | ✅ | `$.fn.angle`, `$.fn.emit`, `$.fn.overlaps`, `$.fn.velocity`, `$.input.down`, `$.selection.each`, `$.updateFor` | — |
| 009 | `trigger.base` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.triggers` | — |
| 010 | `interactable.base` | ✅ | `$.emit`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.input.pressed`, `$.selection.get`, `$.updateFor` | — |
| 011 | `actor.faction` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.removeClass` | — |
| 012 | `actor.identity` | ✅ | `$.fn.data` | — |
| 013 | `actor.spawn-profile` | ✅ | `$.fn.angle`, `$.fn.at`, `$.fn.size` | — |
| 014 | `actor.visual-profile` | ✅ | `$.fn.sprite` | — |
| 015 | `racing.positions` | ✅ | `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.map`, `$.fn.min`, `$.fn.slice`, `$.store.set`, `$.updateFor` | — |
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
| 026 | `racing.lap-counter` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.min`, `$.fn.overlaps`, `$.fn.slice`, `$.time.now`, `$.updateFor` | — |
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
| 040 | `movement.vehicle-seat` | ✅ | `$.fn.active`, `$.fn.at`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.height`, `$.fn.hide`, `$.fn.pos`, `$.fn.show`, `$.fn.velocity`, `$.input.pressed`, `$.input.vec`, `$.selection.get`, `$.updateFor` | — |

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
| 079 | `health.revive` | ✅ | `$.fn.alive`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.hp`, `$.fn.min`, `$.input.down`, `$.selection.get`, `$.updateFor` | — |
| 080 | `health.damage-number` | ✅ | `$.fn.alpha`, `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.height`, `$.fn.max`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.updateFor`, `$.world` | — |

## E. Поведение врагов — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 081 | `ai.idle` | ✅ | `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.flip`, `$.selection.get`, `$.updateFor` | — |
| 082 | `ai.waypoint-patrol` | ✅ | `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.moveTowards`, `$.fn.onWall`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 083 | `ai.chase` | ✅ | `$.fn.distanceTo`, `$.fn.moveTowards`, `$.selection.get`, `$.updateFor` | — |
| 084 | `ai.melee-attack` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.moveTowards`, `$.selection.get`, `$.updateFor` | — |
| 085 | `ai.ranged-attack` | ✅ | `$.fn.alive`, `$.fn.appendTo`, `$.fn.at`, `$.fn.damage`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.fn.velocity`, `$.selection.get`, `$.updateFor`, `$.world` | — |
| 086 | `ai.flee` | ✅ | `$.fn.pos`, `$.fn.velocity`, `$.selection.get`, `$.updateFor` | — |
| 087 | `ai.guard-post` | ✅ | `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.selection.get`, `$.updateFor` | — |
| 088 | `ai.follow-target` | ✅ | `$.fn.distanceTo`, `$.fn.moveTowards`, `$.selection.get`, `$.updateFor` | — |
| 089 | `ai.line-of-sight` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.flip`, `$.fn.pos`, `$.selection.get`, `$.updateFor`, `$.world.lineOfSight` | — |
| 090 | `ai.hearing` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.off`, `$.on` | — |
| 091 | `ai.investigate` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.velocity`, `$.updateFor` | — |
| 092 | `ai.search` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.updateFor` | — |
| 093 | `ai.cover` | ✅ | `$.fn.data`, `$.fn.distanceTo`, `$.fn.height`, `$.fn.max`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.fn.width`, `$.selection.each`, `$.selection.get`, `$.updateFor` | — |
| 094 | `ai.flank` | ✅ | `$.fn.emit`, `$.fn.flip`, `$.fn.moveTowards`, `$.fn.pos`, `$.selection.get`, `$.updateFor` | — |
| 095 | `ai.formation` | ✅ | `$.fn.flip`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.selection.get`, `$.updateFor` | — |
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
| 107 | `npc.companion-follow` | ✅ | `$.camera.isOnScreen`, `$.fn.at`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.selection.get`, `$.updateFor` | — |
| 108 | `npc.companion-command` | ✅ | `$.fn.alive`, `$.fn.damage`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.velocity`, `$.input.pressed`, `$.selection.each`, `$.updateFor` | — |
| 109 | `npc.companion-revive` | ✅ | `$.fn.alive`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.hp`, `$.fn.moveTowards`, `$.selection.get`, `$.updateFor` | — |
| 110 | `npc.party-member` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.slice`, `$.selection.get` | — |
| 111 | `npc.party-formation` | ✅ | `$.fn.attr`, `$.fn.data`, `$.fn.flip`, `$.fn.moveTowards`, `$.fn.pos`, `$.fn.slice`, `$.fn.velocity`, `$.selection.get`, `$.updateFor` | — |
| 112 | `npc.squad-leader` | ✅ | `$.fn.addClass`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.pos`, `$.selection.each`, `$.updateFor` | — |
| 113 | `npc.squad-order` | ✅ | `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.velocity`, `$.selection.get`, `$.updateFor` | — |
| 114 | `npc.civilian-panic` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.hasClass`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.removeClass`, `$.fn.velocity`, `$.off`, `$.on`, `$.selection.each`, `$.updateFor` | — |
| 115 | `npc.civilian-rescue` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.moveTowards`, `$.fn.overlaps`, `$.fn.remove`, `$.fn.some`, `$.selection.get`, `$.updateFor` | — |
| 116 | `npc.vendor` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.input.pressed`, `$.updateFor` | — |
| 117 | `npc.quest-giver` | ✅ | `$.fn.distanceTo`, `$.fn.emit`, `$.input.pressed`, `$.quest.accept`, `$.quest.status`, `$.quest.turnIn`, `$.updateFor` | — |
| 118 | `npc.dialogue-anchor` | ✅ | `$.dialog.has`, `$.dialog.isOpen`, `$.dialog.play`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.has`, `$.input.pressed`, `$.updateFor` | — |
| 119 | `npc.escort` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.hp`, `$.fn.moveTowards`, `$.fn.overlaps`, `$.fn.some`, `$.fn.velocity`, `$.selection.get`, `$.updateFor` | — |
| 120 | `npc.recruit` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.slice`, `$.input.pressed`, `$.updateFor` | — |

## G. Взаимодействие и объекты мира — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 121 | `interact.press-action` | ✅ | `$.fn.distanceTo`, `$.fn.emit`, `$.input.pressed`, `$.selection.each`, `$.updateFor` | — |
| 122 | `interact.hold-action` | ✅ | `$.emit`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.min`, `$.input.down`, `$.selection.get`, `$.updateFor` | — |
| 123 | `interact.context-prompt` | ✅ | `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.height`, `$.fn.hide`, `$.fn.pos`, `$.fn.remove`, `$.fn.show`, `$.fn.text`, `$.selection.each`, `$.updateFor`, `$.world` | — |
| 124 | `interact.pickup` | ✅ | `$.audio.play`, `$.fn.overlaps`, `$.fn.remove`, `$.fn.trigger`, `$.selection.get`, `$.updateFor` | — |
| 125 | `interact.door` | ✅ | `$.fn.addClass`, `$.fn.alpha`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.fn.sensor`, `$.input.pressed`, `$.updateFor` | — |
| 126 | `interact.lock` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.selection.get`, `$.updateFor` | — |
| 127 | `interact.switch` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.input.pressed`, `$.updateFor` | — |
| 128 | `interact.pressure-plate` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.overlaps`, `$.selection.each`, `$.selection.get`, `$.updateFor` | — |
| 129 | `interact.lever` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.attr`, `$.fn.color`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.flip`, `$.fn.off`, `$.fn.on`, `$.input.pressed`, `$.updateFor` | — |
| 130 | `interact.chest` | ✅ | `$.emit`, `$.fn.add`, `$.fn.addClass`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.input.pressed`, `$.items.has`, `$.updateFor` | — |
| 131 | `interact.breakable` | ✅ | `$.emit`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.flash`, `$.fn.health`, `$.fn.hp`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove` | — |
| 132 | `interact.pushable` | ✅ | `$.fn.at`, `$.fn.emit`, `$.fn.height`, `$.fn.pos`, `$.fn.velocity`, `$.fn.width`, `$.selection.get`, `$.updateFor`, `$.world.castShape` | — |
| 133 | `interact.movable-crate` | ✅ | `$.fn.addClass`, `$.fn.at`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.flip`, `$.fn.gravity`, `$.fn.height`, `$.fn.pos`, `$.fn.velocity`, `$.input.pressed`, `$.selection.get`, `$.updateFor` | — |
| 134 | `interact.moving-platform` | ✅ | `$.fn.addClass`, `$.fn.at`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.pos`, `$.updateFor` | — |
| 135 | `interact.elevator` | ✅ | `$.fn.addClass`, `$.fn.at`, `$.fn.emit`, `$.fn.filter`, `$.fn.height`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.width`, `$.input.pressed`, `$.selection.get`, `$.updateFor` | — |
| 136 | `interact.teleporter` | ✅ | `$.fn.at`, `$.fn.data`, `$.fn.emit`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.velocity`, `$.selection.get`, `$.time.now`, `$.updateFor` | — |
| 137 | `interact.portal` | ✅ | `$.fn.emit`, `$.fn.overlaps`, `$.scene.load`, `$.selection.get`, `$.store`, `$.store.set`, `$.updateFor` | — |
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
| 169 | `cards.deck-hand` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.random.int` | — |
| 170 | `turn.initiative-queue` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.slice`, `$.fn.some`, `$.off`, `$.on`, `$.store.set` | — |
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
| 182 | `sports.goal` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.overlaps`, `$.fn.some`, `$.selection.get`, `$.store`, `$.store.get`, `$.store.set`, `$.updateFor` | — |
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

## K. Задания, цели и миссии — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 201 | `quest.definition` | ✅ | `$.fn.filter`, `$.fn.map`, `$.fn.slice`, `$.quest.accept`, `$.quest.define`, `$.quest.status` | — |
| 202 | `quest.start-condition` | ✅ | `$.emit`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.quest`, `$.quest.accept`, `$.quest.status`, `$.selection.get`, `$.story.flags`, `$.updateFor` | — |
| 203 | `quest.objective-visit` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.overlaps`, `$.quest.isReady`, `$.quest.progress`, `$.quest.status`, `$.selection.get`, `$.updateFor` | — |
| 204 | `quest.objective-collect` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.quest.isReady`, `$.quest.progress`, `$.quest.status` | — |
| 205 | `quest.objective-defeat` | ✅ | `$.emit`, `$.fn.add`, `$.fn.emit`, `$.fn.has`, `$.quest.isReady`, `$.quest.progress`, `$.quest.status`, `$.selection.each`, `$.selection.get`, `$.updateFor` | — |
| 206 | `quest.objective-interact` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.input.pressed`, `$.quest.isReady`, `$.quest.progress`, `$.quest.status`, `$.updateFor` | — |
| 207 | `quest.objective-deliver` | ✅ | `$.emit`, `$.fn.count`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.remove`, `$.input.pressed`, `$.quest.isReady`, `$.quest.progress`, `$.quest.status`, `$.updateFor` | — |
| 208 | `quest.objective-survive` | ✅ | `$.emit`, `$.fn.alive`, `$.fn.emit`, `$.fn.max`, `$.quest.isReady`, `$.quest.progress`, `$.quest.status`, `$.selection.get`, `$.updateFor` | — |
| 209 | `quest.objective-escort` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.quest.isReady`, `$.quest.progress`, `$.quest.status` | — |
| 210 | `quest.objective-branch` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.quest`, `$.quest.isReady`, `$.quest.progress`, `$.quest.status`, `$.story.flags`, `$.story.set` | — |
| 211 | `quest.sequence` | ✅ | `$.emit`, `$.fn.emit`, `$.quest.accept`, `$.quest.status`, `$.quest.turnIn`, `$.updateFor` | — |
| 212 | `ui.stage-select` | ✅ | `$.fn.filter`, `$.fn.hide`, `$.fn.html`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.off`, `$.on`, `$.save`, `$.save.get`, `$.scene.load`, `$.selection.get`, `$.ui.markup` | — |
| 213 | `quest.optional-objective` | ✅ | `$.emit`, `$.fn.emit`, `$.quest.def`, `$.quest.progress`, `$.quest.status`, `$.updateFor` | — |
| 214 | `quest.timer` | ✅ | `$.emit`, `$.fn.data`, `$.fn.emit`, `$.fn.max`, `$.quest.cancel`, `$.quest.status`, `$.updateFor` | — |
| 215 | `quest.failure-condition` | ✅ | `$.emit`, `$.fn.alive`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.quest`, `$.quest.cancel`, `$.quest.status`, `$.selection.get`, `$.story.flags`, `$.updateFor` | — |
| 216 | `quest.reward-table` | ✅ | `$.fn.add`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.quest.def`, `$.quest.progress`, `$.selection.get`, `$.updateFor` | — |
| 217 | `quest.world-marker` | ✅ | `$.camera.isOnScreen`, `$.camera.viewport`, `$.fn.angle`, `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.height`, `$.fn.hide`, `$.fn.max`, `$.fn.min`, `$.fn.pos`, `$.fn.remove`, `$.fn.show`, `$.fn.size`, `$.quest.status`, `$.updateFor`, `$.world` | — |
| 218 | `quest.journal` | ✅ | `$.emit`, `$.fn.emit`, `$.input.pressed`, `$.quest.definitions`, `$.quest.line`, `$.quest.status`, `$.store.set`, `$.updateFor` | — |
| 219 | `mission.wave-objective` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.quest.isReady`, `$.quest.progress`, `$.quest.status`, `$.updateFor` | — |
| 220 | `mission.extraction` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.min`, `$.fn.overlaps`, `$.quest.status`, `$.selection.get`, `$.updateFor` | — |

## L. Диалоги и повествование — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 221 | `dialogue.tree` | ✅ | `$.dialog.define`, `$.dialog.play`, `$.emit`, `$.fn.emit`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.some`, `$.off`, `$.on` | — |
| 222 | `dialogue.choice` | ✅ | `$.dialog.definition`, `$.dialog.off`, `$.dialog.on`, `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.some`, `$.off`, `$.on`, `$.story.set` | — |
| 223 | `dialogue.condition` | ✅ | `$.dialog.flag`, `$.fn.count`, `$.fn.data`, `$.quest`, `$.selection.get`, `$.story.flags`, `$.updateFor` | — |
| 224 | `dialogue.action` | ✅ | `$.dialog.definition`, `$.dialog.off`, `$.dialog.on`, `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.story.set` | — |
| 225 | `dialogue.portrait` | ✅ | `$.dialog.off`, `$.dialog.on`, `$.fn.attr`, `$.ui.markup` | — |
| 226 | `dialogue.typewriter` | ✅ | `$.audio.play`, `$.dialog.isOpen`, `$.dialog.isTyping`, `$.dialog.speed`, `$.dialog.text`, `$.fn.speed`, `$.fn.text`, `$.updateFor` | — |
| 227 | `dialogue.skip` | ✅ | `$.dialog.choices`, `$.dialog.isOpen`, `$.dialog.next`, `$.input.down`, `$.input.pressed`, `$.updateFor` | — |
| 228 | `grid.pathfinding` | ✅ | `$.fn.add`, `$.fn.at`, `$.fn.data`, `$.fn.emit`, `$.fn.has`, `$.fn.moveTowards`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.slice`, `$.nav.grid`, `$.nav.pathOn`, `$.updateFor` | — |
| 229 | `dialogue.auto-advance` | ✅ | `$.dialog.choices`, `$.dialog.isOpen`, `$.dialog.next`, `$.dialog.off`, `$.dialog.on`, `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.input.pressed`, `$.updateFor` | — |
| 230 | `dialogue.conversation-lock` | ✅ | `$.dialog.isOpen`, `$.fn.active`, `$.fn.controls`, `$.fn.data`, `$.fn.emit`, `$.fn.velocity`, `$.selection.get`, `$.updateFor` | — |
| 231 | `story.flag` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.story.set` | — |
| 232 | `story.counter` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.quest`, `$.story.flags`, `$.story.set` | — |
| 233 | `story.scene-transition` | ✅ | `$.fn.attr`, `$.off`, `$.on`, `$.scene.load`, `$.story.play`, `$.ui.markup`, `$.updateFor` | — |
| 234 | `story.cutscene` | ✅ | `$.cutscene.define`, `$.cutscene.play`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.slice`, `$.off`, `$.on` | — |
| 235 | `story.choice-history` | ✅ | `$.dialog.definition`, `$.dialog.node`, `$.dialog.off`, `$.dialog.on`, `$.fn.off`, `$.fn.on`, `$.fn.slice`, `$.save.get`, `$.save.set`, `$.selection.get` | — |
| 236 | `story.relationship-route` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.quest`, `$.story.flags`, `$.story.set` | — |
| 237 | `story.chapter` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.some`, `$.off`, `$.on`, `$.quest`, `$.save.set`, `$.story.flags`, `$.story.set`, `$.updateFor` | — |
| 238 | `story.ending` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.find`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.slice`, `$.off`, `$.on`, `$.quest`, `$.story.flags`, `$.story.set` | — |
| 239 | `story.vn-background` | ✅ | `$.fn.alpha`, `$.fn.appendTo`, `$.fn.at`, `$.fn.fadeTo`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.fn.size`, `$.fn.sprite`, `$.off`, `$.on`, `$.world` | — |
| 240 | `story.vn-character` | ✅ | `$.emit`, `$.fn.at`, `$.fn.data`, `$.fn.emit`, `$.fn.fadeTo`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.show`, `$.fn.sprite`, `$.off`, `$.on` | — |

## M. Головоломки и логические механики — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 241 | `puzzle.state-machine` | ✅ | `$.fn.addClass`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.find`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.removeClass`, `$.off`, `$.on` | — |
| 242 | `puzzle.sequence-lock` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.emit`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on` | — |
| 243 | `puzzle.keypad` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.slice`, `$.input.pressed`, `$.selection.get`, `$.updateFor` | — |
| 244 | `puzzle.switch-combination` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.updateFor` | — |
| 245 | `puzzle.light-mirrors` | ✅ | `$.emit`, `$.fn.angle`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.height`, `$.fn.max`, `$.fn.min`, `$.fn.pos`, `$.fn.width`, `$.selection.each`, `$.selection.get`, `$.updateFor` | — |
| 246 | `puzzle.pressure-sequence` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.emit`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on` | — |
| 247 | `puzzle.sokoban` | ✅ | `$.emit`, `$.fn.at`, `$.fn.attr`, `$.fn.emit`, `$.fn.every`, `$.fn.find`, `$.fn.pos`, `$.input.pressed`, `$.selection.get`, `$.updateFor` | — |
| 248 | `puzzle.matching` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.every`, `$.fn.find`, `$.fn.hasClass`, `$.fn.height`, `$.fn.map`, `$.fn.pos`, `$.fn.removeClass`, `$.fn.width`, `$.input.mousePressed`, `$.input.mouseWorld`, `$.updateFor` | — |
| 249 | `puzzle.sliding-tiles` | ✅ | `$.emit`, `$.fn.at`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.every`, `$.fn.find`, `$.fn.has`, `$.fn.map`, `$.input.mousePressed`, `$.input.mouseWorld`, `$.updateFor` | — |
| 250 | `puzzle.rotating-discs` | ✅ | `$.emit`, `$.fn.angle`, `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.every`, `$.fn.find`, `$.fn.height`, `$.fn.map`, `$.fn.max`, `$.fn.width`, `$.input.mousePressed`, `$.input.mouseWorld`, `$.updateFor` | — |
| 251 | `puzzle.wiring` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on` | — |
| 252 | `puzzle.logic-gates` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.some`, `$.updateFor` | — |
| 253 | `puzzle.memory` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.emit`, `$.fn.flash`, `$.fn.max`, `$.input.mousePressed`, `$.input.mouseWorld`, `$.random.int`, `$.updateFor` | — |
| 254 | `puzzle.timing` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.input.pressed`, `$.updateFor` | — |
| 255 | `puzzle.hidden-object` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.find`, `$.fn.flash`, `$.fn.hasClass`, `$.fn.height`, `$.fn.map`, `$.fn.pos`, `$.fn.width`, `$.input.mousePressed`, `$.input.mouseWorld`, `$.updateFor` | — |
| 256 | `puzzle.maze-switch` | ✅ | `$.fn.alpha`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.sensor`, `$.updateFor` | — |
| 257 | `puzzle.physics-balance` | ✅ | `$.emit`, `$.fn.angle`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.min`, `$.updateFor` | — |
| 258 | `puzzle.color-code` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.overlaps`, `$.fn.reduce`, `$.fn.slice`, `$.updateFor` | — |
| 259 | `puzzle.riddle` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.map`, `$.fn.off`, `$.fn.on` | — |
| 260 | `puzzle.reset` | ✅ | `$.emit`, `$.fn.angle`, `$.fn.at`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.removeClass`, `$.fn.velocity`, `$.input.pressed`, `$.off`, `$.on`, `$.updateFor` | — |

## N. Уровень, мир и окружение — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 261 | `world.scene-entry` | ✅ | `$.emit`, `$.fn.at`, `$.fn.emit`, `$.fn.pos`, `$.fn.remove`, `$.fn.velocity`, `$.selection.get`, `$.store`, `$.store.get`, `$.store.remove`, `$.updateFor` | — |
| 262 | `world.scene-exit` | ✅ | `$.fn.emit`, `$.fn.overlaps`, `$.quest`, `$.scene.load`, `$.selection.get`, `$.store.set`, `$.story.flags`, `$.updateFor` | — |
| 263 | `world.spawn-points` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.emit`, `$.fn.find`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.fn.some`, `$.off`, `$.on`, `$.prefab.has`, `$.prefab.instantiate`, `$.world`, `$.world.query` | — |
| 264 | `world.checkpoint-chain` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.overlaps`, `$.fn.slice`, `$.save.get`, `$.save.set`, `$.selection.get`, `$.updateFor` | — |
| 265 | `world.tilemap-layer` | ✅ | `$.fn.appendTo`, `$.fn.at`, `$.fn.data`, `$.fn.emit`, `$.fn.layer`, `$.fn.pos`, `$.fn.remove`, `$.fs.readJSON`, `$.selection.get`, `$.tilemap.create`, `$.world` | — |
| 266 | `world.tilemap-collision` | ✅ | `$.fn.collisionMerge`, `$.fn.collisionResult`, `$.fn.collisions`, `$.fn.data`, `$.fn.emit`, `$.fn.map`, `$.updateFor` | — |
| 267 | `world.breakable-tiles` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.has`, `$.fn.height`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.setTile`, `$.fn.tileAt`, `$.fn.width`, `$.off`, `$.on`, `$.updateFor` | — |
| 268 | `world.parallax-layer` | ✅ | `$.fn.layer`, `$.fn.parallax`, `$.fn.sprite`, `$.layers.parallax` | — |
| 269 | `world.light-zone` | ✅ | `$.fn.color`, `$.fn.intensity`, `$.fn.radius`, `$.updateFor` | — |
| 270 | `world.audio-zone` | ✅ | `$.audio.music`, `$.audio.musicStop`, `$.audio.removeZone`, `$.audio.zone`, `$.emit`, `$.fn.attr`, `$.fn.emit`, `$.fn.height`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.width`, `$.fn.zone`, `$.selection.get`, `$.updateFor` | — |
| 271 | `world.weather` | ✅ | `$.camera.viewport`, `$.fn.alpha`, `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.random.range`, `$.store.set`, `$.updateFor`, `$.world` | — |
| 272 | `world.day-night` | ✅ | `$.emit`, `$.fn.color`, `$.fn.emit`, `$.fn.map`, `$.fn.slice`, `$.store.set`, `$.time.now`, `$.updateFor`, `$.world.color` | — |
| 273 | `world.gravity-zone` | ✅ | `$.fn.add`, `$.fn.emit`, `$.fn.gravity`, `$.fn.has`, `$.fn.overlaps`, `$.fn.velocity`, `$.selection.each`, `$.selection.get`, `$.updateFor` | — |
| 274 | `world.time-scale-zone` | ✅ | `$.fn.overlaps`, `$.fn.scale`, `$.selection.get`, `$.time.scale`, `$.updateFor` | — |
| 275 | `tower.placement` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.data`, `$.fn.emit`, `$.fn.has`, `$.fn.hasClass`, `$.fn.some`, `$.input.mousePressed`, `$.input.mouseWorld`, `$.input.pressed`, `$.prefab.has`, `$.prefab.instantiate`, `$.selection.get`, `$.updateFor`, `$.world`, `$.world.query` | — |
| 276 | `world.one-way-platform` | ✅ | `$.fn.addClass`, `$.fn.oneWay`, `$.fn.removeClass` | — |
| 277 | `world.moving-hazard` | ✅ | `$.fn.angle`, `$.fn.at`, `$.fn.damage`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.overlaps`, `$.fn.pos`, `$.selection.each`, `$.updateFor` | — |
| 278 | `world.secret-area` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.emit`, `$.fn.fadeTo`, `$.fn.overlaps`, `$.save`, `$.save.get`, `$.save.set`, `$.selection.get`, `$.updateFor` | — |
| 279 | `world.streamed-room` | ✅ | `$.emit`, `$.fn.active`, `$.fn.attr`, `$.fn.emit`, `$.fn.height`, `$.fn.pos`, `$.fn.width`, `$.selection.get`, `$.updateFor` | — |
| 280 | `world.level-exit` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.overlaps`, `$.save`, `$.save.get`, `$.save.set`, `$.scene.load`, `$.selection.get`, `$.time.now`, `$.updateFor` | — |

## O. Камера и экранное представление — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 281 | `camera.follow` | ✅ | `$.camera.follow` | — |
| 282 | `traffic.signal` | ✅ | `$.fn.color`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.filter`, `$.fn.velocity`, `$.selection.each`, `$.updateFor` | — |
| 283 | `run.route-generator` | ✅ | `$.emit`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.random.pick`, `$.random.seed`, `$.save`, `$.save.get`, `$.save.set`, `$.scene.load`, `$.selection.get` | — |
| 284 | `camera.smoothing` | ✅ | `$.camera.at`, `$.camera.follow`, `$.camera.isOnScreen`, `$.camera.unfollow`, `$.fn.at`, `$.fn.pos`, `$.selection.get`, `$.updateFor` | — |
| 285 | `camera.bounds` | ✅ | `$.camera.limits` | — |
| 286 | `camera.room-lock` | ✅ | `$.camera.follow`, `$.camera.limits`, `$.camera.panTo`, `$.camera.unfollow`, `$.emit`, `$.fn.attr`, `$.fn.emit`, `$.fn.height`, `$.fn.overlaps`, `$.fn.pos`, `$.fn.width`, `$.selection.get`, `$.updateFor` | — |
| 287 | `camera.screen-shake` | ✅ | `$.camera.shake`, `$.fn.hp`, `$.fn.shake`, `$.updateFor` | — |
| 288 | `camera.trauma` | ✅ | `$.camera.shake`, `$.fn.max`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.shake`, `$.off`, `$.on`, `$.selection.get`, `$.store.get`, `$.updateFor` | — |
| 289 | `camera.zoom` | ✅ | `$.camera.zoom`, `$.camera.zoomTo` | — |
| 290 | `camera.split-screen` | ✅ | `$.camera.at`, `$.camera.split`, `$.camera.viewAt`, `$.emit`, `$.fn.at`, `$.fn.emit`, `$.fn.pos`, `$.updateFor` | — |
| 291 | `camera.transition` | ✅ | `$.camera.follow`, `$.camera.panTo`, `$.camera.unfollow`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.off`, `$.on`, `$.time.wait` | — |
| 292 | `camera.death-focus` | ✅ | `$.camera.panTo`, `$.camera.unfollow`, `$.camera.zoomTo`, `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.scale`, `$.time.scale`, `$.time.wait` | — |
| 293 | `camera.cutscene-rail` | ✅ | `$.camera.at`, `$.camera.follow`, `$.camera.unfollow`, `$.emit`, `$.fn.at`, `$.fn.emit`, `$.fn.every`, `$.fn.filter`, `$.fn.map`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.updateFor` | — |
| 294 | `camera.look-at-target` | ✅ | `$.camera.follow`, `$.camera.panTo`, `$.camera.unfollow`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.off`, `$.on`, `$.time.wait` | — |
| 295 | `camera.parallax-focus` | ✅ | `$.fn.filter`, `$.fn.map`, `$.fn.parallax`, `$.layers.parallax` | — |
| 296 | `render.tint-profile` | ✅ | `$.fn.color`, `$.fn.filter`, `$.fn.map`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.slice`, `$.off`, `$.on`, `$.updateFor`, `$.world.color`, `$.world.getBackground` | — |
| 297 | `render.fade` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.max`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.fn.style`, `$.off`, `$.on`, `$.ui.markup`, `$.updateFor` | — |
| 298 | `ui.world-map` | ✅ | `$.fn.add`, `$.fn.height`, `$.fn.hide`, `$.fn.html`, `$.fn.map`, `$.fn.max`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.show`, `$.fn.width`, `$.input.pressed`, `$.off`, `$.on`, `$.save`, `$.save.get`, `$.save.set`, `$.selection.get`, `$.ui.markup`, `$.updateFor` | — |
| 299 | `render.vignette` | ✅ | `$.fn.show`, `$.ui.markup` | — |
| 300 | `render.accessibility-filter` | ✅ | `$.emit`, `$.fn.color`, `$.fn.emit`, `$.store`, `$.store.set`, `$.world.color` | — |

## P. Анимация и визуальные состояния — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 301 | `animation.idle-run` | ✅ | `$.fn.animate`, `$.fn.data`, `$.fn.flip`, `$.fn.velocity`, `$.updateFor` | — |
| 302 | `animation.jump-fall` | ✅ | `$.fn.animate`, `$.fn.data`, `$.fn.onFloor`, `$.fn.velocity`, `$.updateFor` | — |
| 303 | `animation.attack` | ✅ | `$.fn.animate`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.updateFor` | — |
| 304 | `animation.damage` | ✅ | `$.fn.animate`, `$.fn.data`, `$.fn.off`, `$.fn.on`, `$.updateFor` | — |
| 305 | `animation.death` | ✅ | `$.fn.animate`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.updateFor` | — |
| 306 | `animation.direction-4` | ✅ | `$.fn.animate`, `$.fn.data`, `$.fn.velocity`, `$.updateFor` | — |
| 307 | `animation.direction-8` | ✅ | `$.fn.animate`, `$.fn.data`, `$.fn.filter`, `$.fn.map`, `$.fn.velocity`, `$.updateFor` | — |
| 308 | `animation.weapon-overlay` | ✅ | `$.fn.appendTo`, `$.fn.at`, `$.fn.localAt`, `$.fn.lookAt`, `$.fn.pos`, `$.fn.remove`, `$.fn.sprite`, `$.input.mouseWorld`, `$.updateFor` | — |
| 309 | `animation.blend-profile` | ✅ | `$.anim.crossfade`, `$.anim.has`, `$.anim.target`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.has`, `$.fn.map`, `$.updateFor` | — |
| 310 | `animation.cancel-rules` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on` | — |
| 311 | `animation.event-hooks` | ✅ | `$.fn.emit`, `$.fn.frame`, `$.updateFor` | — |
| 312 | `animation.loop-profile` | ✅ | `$.fn.animate`, `$.fn.data`, `$.fn.frame`, `$.fn.stopAnim`, `$.updateFor` | — |
| 313 | `animation.speed-scale` | ✅ | `$.fn.animate`, `$.fn.data`, `$.fn.max`, `$.fn.min`, `$.fn.velocity`, `$.updateFor` | — |
| 314 | `animation.hit-pause` | ✅ | `$.fn.off`, `$.fn.on`, `$.selection.get`, `$.store.get`, `$.time.hitStop` | — |
| 315 | `animation.afterimage` | ✅ | `$.fn.alpha`, `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.fadeTo`, `$.fn.height`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.fn.sprite`, `$.fn.width`, `$.selection.get`, `$.updateFor`, `$.world` | — |
| 316 | `animation.flash-overlay` | ✅ | `$.fn.filter`, `$.fn.flash`, `$.fn.map`, `$.fn.off`, `$.fn.on` | — |
| 317 | `animation.emote` | ✅ | `$.fn.appendTo`, `$.fn.at`, `$.fn.height`, `$.fn.hide`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.fn.show`, `$.fn.text`, `$.ui.hasIcon`, `$.ui.icon`, `$.updateFor`, `$.world` | — |
| 318 | `animation.spawn` | ✅ | `$.fn.active`, `$.fn.alpha`, `$.fn.animate`, `$.fn.data`, `$.fn.emit`, `$.fn.fadeTo` | — |
| 319 | `animation.respawn` | ✅ | `$.fn.alpha`, `$.fn.appendTo`, `$.fn.at`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.particles.preset`, `$.time.wait`, `$.updateFor`, `$.world` | — |
| 320 | `animation.atlas-binding` | ✅ | `$.atlas.get`, `$.atlas.load`, `$.fn.animate`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.frames`, `$.fn.map`, `$.selection.get`, `$.updateFor` | — |

## Q. Звук и обратная связь — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 321 | `audio.one-shot` | ✅ | `$.audio.play`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on` | — |
| 322 | `audio.loop` | ✅ | `$.audio.play`, `$.fn.off`, `$.fn.on`, `$.fn.stop`, `$.off`, `$.on` | — |
| 323 | `rhythm.lanes` | ✅ | `$.audio.play`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.find`, `$.fn.map`, `$.input.pressed`, `$.time.now`, `$.updateFor` | — |
| 324 | `audio.music-transition` | ✅ | `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.sound.crossfade` | — |
| 325 | `audio.ambience` | ✅ | `$.audio.play`, `$.fn.stop`, `$.random`, `$.random.pick`, `$.random.range`, `$.updateFor` | — |
| 326 | `audio.footsteps` | ✅ | `$.audio.playAt`, `$.fn.emit`, `$.fn.filter`, `$.fn.find`, `$.fn.hasClass`, `$.fn.height`, `$.fn.map`, `$.fn.onFloor`, `$.fn.pos`, `$.fn.some`, `$.fn.velocity`, `$.updateFor`, `$.world.query` | — |
| 327 | `audio.weapon` | ✅ | `$.audio.playAt`, `$.fn.off`, `$.fn.on`, `$.fn.pos` | — |
| 328 | `audio.damage` | ✅ | `$.audio.playAt`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.time.now` | — |
| 329 | `audio.ui` | ✅ | `$.audio.play`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on` | — |
| 330 | `audio.dialogue` | ✅ | `$.audio.play`, `$.dialog`, `$.dialog.define`, `$.dialog.play`, `$.fn.off`, `$.fn.on` | — |
| 331 | `audio.distance-profile` | ✅ | `$.audio.play`, `$.fn.distanceTo`, `$.fn.max`, `$.fn.min`, `$.fn.stop`, `$.fn.volume`, `$.selection.get`, `$.updateFor` | — |
| 332 | `audio.ducking` | ✅ | `$.audio.musicVolume`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.updateFor` | — |
| 333 | `fishing.cast` | ✅ | `$.emit`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.max`, `$.input.pressed`, `$.random.range`, `$.random.weighted`, `$.updateFor` | — |
| 334 | `farming.crop` | ✅ | `$.emit`, `$.fn.add`, `$.fn.addClass`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.has`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.input.pressed`, `$.items.has`, `$.updateFor` | — |
| 335 | `feedback.particles` | ✅ | `$.fn.appendTo`, `$.fn.at`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.particles.preset`, `$.time.wait`, `$.world` | — |
| 336 | `feedback.screen-pulse` | ✅ | `$.fn.max`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.fn.style`, `$.off`, `$.on`, `$.ui.markup`, `$.updateFor` | — |
| 337 | `feedback.controller-rumble` | ✅ | `$.fn.filter`, `$.fn.map`, `$.fn.max`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.input.rumble`, `$.input.rumbleSupported`, `$.off`, `$.on`, `$.selection.get`, `$.store.get` | — |
| 338 | `feedback.combo-popup` | ✅ | `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.data`, `$.fn.emit`, `$.fn.height`, `$.fn.hide`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.fn.show`, `$.fn.text`, `$.updateFor`, `$.world` | — |
| 339 | `feedback.quest-toast` | ✅ | `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.fn.style`, `$.fn.text`, `$.off`, `$.on`, `$.quest.def`, `$.ui.markup`, `$.updateFor` | — |
| 340 | `feedback.error-prompt` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.fn.style`, `$.fn.text`, `$.off`, `$.on`, `$.ui.markup`, `$.updateFor` | — |

## R. RmlUi-интерфейс и HUD — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 341 | `ui.health-bar` | ✅ | `$.fn.hp`, `$.fn.max`, `$.fn.min`, `$.fn.show`, `$.fn.style`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 342 | `ui.stamina-bar` | ✅ | `$.fn.data`, `$.fn.max`, `$.fn.min`, `$.fn.show`, `$.fn.style`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 343 | `ui.shield-bar` | ✅ | `$.fn.data`, `$.fn.max`, `$.fn.min`, `$.fn.show`, `$.fn.style`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 344 | `ui.weapon-panel` | ✅ | `$.fn.data`, `$.fn.show`, `$.fn.text`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor`, `$.weapons.of` | — |
| 345 | `ui.quickbar` | ✅ | `$.fn.count`, `$.fn.data`, `$.fn.html`, `$.fn.map`, `$.fn.show`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 346 | `ui.inventory-screen` | ✅ | `$.emit`, `$.fn.data`, `$.fn.emit`, `$.fn.hide`, `$.fn.html`, `$.fn.map`, `$.fn.on`, `$.fn.show`, `$.input.pressed`, `$.items.get`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 347 | `ui.equipment-screen` | ✅ | `$.fn.data`, `$.fn.hide`, `$.fn.html`, `$.fn.map`, `$.fn.show`, `$.fn.text`, `$.input.pressed`, `$.items.get`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 348 | `ui.party-panel` | ✅ | `$.fn.data`, `$.fn.hp`, `$.fn.html`, `$.fn.map`, `$.fn.show`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 349 | `ui.quest-tracker` | ✅ | `$.fn.find`, `$.fn.show`, `$.fn.text`, `$.quest.definitions`, `$.quest.line`, `$.quest.status`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 350 | `ui.quest-journal` | ✅ | `$.fn.filter`, `$.fn.hide`, `$.fn.html`, `$.fn.map`, `$.fn.on`, `$.fn.show`, `$.input.pressed`, `$.quest.definitions`, `$.quest.line`, `$.quest.status`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 351 | `ui.dialogue-box` | ✅ | `$.dialog.isOpen`, `$.dialog.off`, `$.dialog.on`, `$.dialog.text`, `$.fn.hide`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.fn.text`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 352 | `ui.choice-list` | ✅ | `$.dialog.choices`, `$.dialog.choose`, `$.dialog.isOpen`, `$.dialog.isTyping`, `$.emit`, `$.fn.emit`, `$.fn.hide`, `$.fn.html`, `$.fn.map`, `$.fn.on`, `$.fn.show`, `$.selection.get`, `$.store.get`, `$.ui.markup`, `$.updateFor` | — |
| 353 | `ui.interaction-prompt` | ✅ | `$.fn.hide`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.fn.text`, `$.off`, `$.on`, `$.selection.get`, `$.store.get`, `$.ui.markup` | — |
| 354 | `replay.ghost` | ✅ | `$.fn.alpha`, `$.fn.appendTo`, `$.fn.at`, `$.fn.color`, `$.fn.emit`, `$.fn.height`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.fn.slice`, `$.fn.width`, `$.off`, `$.on`, `$.save`, `$.save.get`, `$.save.set`, `$.selection.get`, `$.updateFor`, `$.world` | — |
| 355 | `ui.minimap-markers` | ✅ | `$.camera.minimap`, `$.fn.filter`, `$.fn.map` | — |
| 356 | `ui.pause-menu` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.hide`, `$.fn.on`, `$.fn.pause`, `$.fn.show`, `$.input.pressed`, `$.scene.load`, `$.selection.get`, `$.store.get`, `$.time.pause`, `$.time.resume`, `$.ui.markup`, `$.updateFor` | — |
| 357 | `ui.settings-menu` | ✅ | `$.audio.masterVolume`, `$.fn.hide`, `$.fn.off`, `$.fn.on`, `$.fn.scale`, `$.fn.show`, `$.fn.value`, `$.off`, `$.on`, `$.selection.get`, `$.store.get`, `$.store.set`, `$.ui.markup`, `$.ui.scale`, `$.window.toggleFullscreen` | — |
| 358 | `ui.confirm-dialog` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.hide`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.fn.text`, `$.off`, `$.on`, `$.selection.get`, `$.store.get`, `$.ui.markup` | — |
| 359 | `ui.loading-overlay` | ✅ | `$.fn.hide`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.loading`, `$.loading.hide`, `$.loading.show`, `$.loading.title`, `$.off`, `$.on` | — |
| 360 | `ui.result-screen` | ✅ | `$.fn.hide`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.fn.text`, `$.off`, `$.on`, `$.scene.load`, `$.selection.get`, `$.store.get`, `$.ui.markup` | — |

## S. Сохранения, настройки и доступность — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 361 | `save.profile` | ✅ | `$.emit`, `$.fn.emit`, `$.save.profile`, `$.selection.get` | — |
| 362 | `save.slot` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.save.autosave`, `$.save.slot`, `$.save.stopAutosave`, `$.time.now` | — |
| 363 | `colony.task-board` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.moveTowards`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.off`, `$.on`, `$.selection.each`, `$.updateFor` | — |
| 364 | `save.inventory` | ✅ | `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.save.get`, `$.save.set`, `$.selection.get` | — |
| 365 | `save.quest-state` | ✅ | `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.quest`, `$.quest.load`, `$.quest.save`, `$.save.get`, `$.save.set`, `$.selection.get` | — |
| 366 | `save.story-state` | ✅ | `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.save.get`, `$.save.set`, `$.selection.get`, `$.story.flags`, `$.story.set` | — |
| 367 | `save.world-state` | ✅ | `$.fn.alpha`, `$.fn.at`, `$.fn.attr`, `$.fn.data`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.fn.sensor`, `$.off`, `$.on`, `$.save.get`, `$.save.set`, `$.selection.each`, `$.selection.get` | — |
| 368 | `save.migration` | ✅ | `$.fn.filter`, `$.fn.map`, `$.save.schema` | — |
| 369 | `settings.controls` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.input.bind`, `$.input.bindings`, `$.input.loadBindings`, `$.input.markDefaults`, `$.input.rebind`, `$.input.saveBindings`, `$.off`, `$.on` | — |
| 370 | `settings.audio` | ✅ | `$.audio.masterVolume`, `$.audio.musicVolume`, `$.audio.sfxVolume`, `$.fn.max`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.selection.get`, `$.store.get`, `$.store.set` | — |
| 371 | `settings.video` | ✅ | `$.fn.off`, `$.fn.on`, `$.fn.scale`, `$.fn.size`, `$.off`, `$.on`, `$.selection.get`, `$.store.get`, `$.store.set`, `$.ui.scale`, `$.window`, `$.window.fullscreen`, `$.window.size`, `$.window.vsync` | — |
| 372 | `settings.gameplay` | ✅ | `$.dialog.speed`, `$.fn.damageFilter`, `$.fn.off`, `$.fn.on`, `$.fn.speed`, `$.off`, `$.on`, `$.selection.get`, `$.store.get`, `$.store.set` | — |
| 373 | `accessibility.text-scale` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.scale`, `$.selection.get`, `$.store`, `$.store.get`, `$.store.set`, `$.ui.scale` | — |
| 374 | `accessibility.high-contrast` | ✅ | `$.emit`, `$.fn.data`, `$.fn.emit`, `$.fn.outline`, `$.selection.each`, `$.selection.get`, `$.store`, `$.store.get`, `$.updateFor` | — |
| 375 | `accessibility.color-cues` | ✅ | `$.fn.add`, `$.fn.appendTo`, `$.fn.at`, `$.fn.filter`, `$.fn.has`, `$.fn.height`, `$.fn.map`, `$.fn.pos`, `$.fn.remove`, `$.selection.each`, `$.selection.get`, `$.updateFor`, `$.world` | — |
| 376 | `accessibility.hold-alternative` | ✅ | `$.fn.add`, `$.fn.has`, `$.input.rawPressed`, `$.input.synthDown`, `$.input.synthRelease`, `$.selection.get`, `$.store.get`, `$.updateFor` | — |
| 377 | `accessibility.reduce-motion` | ✅ | `$.emit`, `$.fn.emit`, `$.selection.get`, `$.store`, `$.store.get`, `$.store.set` | — |
| 378 | `accessibility.subtitle` | ✅ | `$.dialog`, `$.dialog.off`, `$.dialog.on`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.fn.text`, `$.off`, `$.on`, `$.ui.markup`, `$.updateFor` | — |
| 379 | `localization.string-table` | ✅ | `$.emit`, `$.fn.add`, `$.fn.emit`, `$.fs.readJSON`, `$.i18n.add`, `$.i18n.lang`, `$.selection.get`, `$.store`, `$.store.get` | — |
| 380 | `localization.number-time` | ✅ | `$.fn.max`, `$.fn.off`, `$.fn.on`, `$.i18n.number`, `$.off`, `$.on` | — |

## T. Сессии и многопользовательский проект — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 381 | `net.session-bootstrap` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net`, `$.net.host`, `$.net.join`, `$.net.online`, `$.net.syncRate`, `$.net.topology`, `$.off`, `$.on` | — |
| 382 | `net.host-session` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net`, `$.net.host`, `$.net.off`, `$.net.on`, `$.net.online`, `$.off`, `$.on` | — |
| 383 | `net.client-session` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net`, `$.net.join`, `$.net.leave`, `$.net.off`, `$.net.on`, `$.net.online`, `$.off`, `$.on`, `$.updateFor` | — |
| 384 | `net.room-create` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.net.disconnect`, `$.net.off`, `$.net.on`, `$.net.room.create`, `$.net.room.peers`, `$.net.send`, `$.off`, `$.on` | — |
| 385 | `net.room-join` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net.off`, `$.net.on`, `$.net.room.join`, `$.off`, `$.on` | — |
| 386 | `net.room-leave` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net.entities`, `$.net.leave`, `$.net.room.leave`, `$.net.unreplicate`, `$.off`, `$.on`, `$.scene.load` | — |
| 387 | `net.lobby` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net.broadcast`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.send`, `$.store.set` | — |
| 388 | `net.ready-check` | ✅ | `$.emit`, `$.fn.add`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net.broadcast`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.playerCount`, `$.net.send`, `$.off`, `$.on` | — |
| 389 | `net.player-identity` | ✅ | `$.fn.attr`, `$.fn.color`, `$.fn.data`, `$.fn.off`, `$.fn.on`, `$.net.broadcast`, `$.net.off`, `$.net.on`, `$.save.profile`, `$.selection.get` | — |
| 390 | `net.player-spawn` | ✅ | `$.emit`, `$.fn.appendTo`, `$.fn.at`, `$.fn.emit`, `$.fn.has`, `$.fn.net`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.fn.size`, `$.net.broadcast`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.unreplicate`, `$.prefab.has`, `$.prefab.instantiate`, `$.world` | — |
| 391 | `net.player-owner` | ✅ | `$.fn.attr`, `$.fn.net`, `$.net.unreplicate` | — |
| 392 | `net.authority-profile` | ✅ | `$.fn.attr`, `$.fn.data`, `$.fn.net`, `$.net.isAuthority`, `$.net.unreplicate` | — |
| 393 | `net.host-migration` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.net`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.online`, `$.net.peers`, `$.updateFor` | — |
| 394 | `net.disconnect-screen` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.hide`, `$.fn.off`, `$.fn.on`, `$.fn.show`, `$.fn.text`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.scene.load`, `$.ui.markup` | — |
| 395 | `net.reconnect` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net`, `$.net.join`, `$.net.off`, `$.net.on`, `$.net.online`, `$.off`, `$.on`, `$.updateFor` | — |
| 396 | `net.invite-code` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.off`, `$.on`, `$.random.int`, `$.store`, `$.store.set` | — |
| 397 | `net.matchmaking-filter` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.off`, `$.fn.on`, `$.net.off`, `$.net.on`, `$.store`, `$.store.set` | — |
| 398 | `net.session-settings` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.send`, `$.store`, `$.store.set` | — |
| 399 | `net.coop-local` | ✅ | `$.emit`, `$.fn.appendTo`, `$.fn.at`, `$.fn.body`, `$.fn.controls`, `$.fn.emit`, `$.fn.health`, `$.fn.remove`, `$.fn.size`, `$.input.pressed`, `$.updateFor`, `$.world` | — |
| 400 | `net.network-debug-hud` | ✅ | `$.fn.hide`, `$.fn.map`, `$.fn.show`, `$.fn.text`, `$.input.pressed`, `$.net.describe`, `$.net.peers`, `$.ui.markup`, `$.updateFor` | — |

## U. Синхронизация и сетевой gameplay — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 401 | `net.replicate-transform` | ✅ | `$.fn.attr`, `$.fn.net`, `$.net.unreplicate` | — |
| 402 | `net.replicate-health` | ✅ | `$.fn.attr`, `$.fn.damageFilter`, `$.fn.net`, `$.net.isAuthority`, `$.net.online`, `$.net.unreplicate` | — |
| 403 | `net.replicate-animation` | ✅ | `$.fn.attr`, `$.fn.data`, `$.fn.flip`, `$.fn.off`, `$.fn.on`, `$.net.broadcast`, `$.net.off`, `$.net.on`, `$.net.online`, `$.updateFor` | — |
| 404 | `net.replicate-inventory` | ✅ | `$.fn.add`, `$.fn.attr`, `$.fn.data`, `$.fn.emit`, `$.fn.has`, `$.fn.off`, `$.fn.on`, `$.fn.remove`, `$.items.has`, `$.net.broadcast`, `$.net.isAuthority`, `$.net.off`, `$.net.on` | — |
| 405 | `net.input-command` | ✅ | `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.velocity`, `$.input.down`, `$.net.input`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.online`, `$.updateFor` | — |
| 406 | `net.server-action` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net.broadcast`, `$.net.handle`, `$.net.rpc`, `$.net.send`, `$.net.unhandle`, `$.off`, `$.on`, `$.selection.get` | — |
| 407 | `net.damage-command` | ✅ | `$.fn.damage`, `$.fn.distanceTo`, `$.fn.min`, `$.fn.off`, `$.fn.on`, `$.net.handle`, `$.net.isAuthority`, `$.net.rpc`, `$.net.send`, `$.net.unhandle`, `$.off`, `$.on` | — |
| 408 | `net.projectile-authority` | ✅ | `$.fn.appendTo`, `$.fn.at`, `$.fn.damage`, `$.fn.find`, `$.fn.flip`, `$.fn.hp`, `$.fn.net`, `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.fn.remove`, `$.fn.size`, `$.net.handle`, `$.net.isAuthority`, `$.net.online`, `$.net.rpc`, `$.net.unhandle`, `$.net.unreplicate`, `$.selection.get`, `$.updateFor`, `$.world`, `$.world.query` | — |
| 409 | `net.interpolation-profile` | ✅ | `$.net.interpolationDelay`, `$.net.syncRate` | — |
| 410 | `net.prediction-profile` | ✅ | `$.fn.at`, `$.net.isAuthority`, `$.net.online`, `$.net.predict`, `$.net.prediction`, `$.updateFor` | — |
| 411 | `net.reconciliation` | ✅ | `$.fn.off`, `$.fn.on`, `$.fn.pos`, `$.net.acknowledge`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.send` | — |
| 412 | `net.rpc-action` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.filter`, `$.fn.map`, `$.fn.off`, `$.fn.on`, `$.net.broadcast`, `$.net.handle`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.rpc`, `$.net.send`, `$.net.unhandle`, `$.off`, `$.on` | — |
| 413 | `net.team-assignment` | ✅ | `$.emit`, `$.fn.addClass`, `$.fn.data`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.team`, `$.net.broadcast`, `$.net.isAuthority`, `$.net.off`, `$.net.on` | — |
| 414 | `net.scoreboard` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net.broadcast`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.online`, `$.off`, `$.on`, `$.store`, `$.store.set` | — |
| 415 | `net.round-state` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.net.broadcast`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.online`, `$.store.set`, `$.updateFor` | — |
| 416 | `net.vote-map` | ✅ | `$.emit`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.fn.reduce`, `$.net.broadcast`, `$.net.handle`, `$.net.isAuthority`, `$.net.online`, `$.net.rpc`, `$.net.unhandle`, `$.off`, `$.on`, `$.updateFor` | — |
| 417 | `net.spectator` | ✅ | `$.camera.follow`, `$.emit`, `$.fn.attr`, `$.fn.emit`, `$.input.pressed`, `$.updateFor` | — |
| 418 | `net.shared-object` | ✅ | `$.emit`, `$.fn.attr`, `$.fn.data`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.off`, `$.fn.on`, `$.input.pressed`, `$.net.broadcast`, `$.net.handle`, `$.net.isAuthority`, `$.net.off`, `$.net.on`, `$.net.online`, `$.net.rpc`, `$.net.unhandle`, `$.updateFor` | — |
| 419 | `net.coop-revive` | ✅ | `$.emit`, `$.fn.alive`, `$.fn.distanceTo`, `$.fn.emit`, `$.fn.hp`, `$.fn.off`, `$.fn.on`, `$.net.broadcast`, `$.net.handle`, `$.net.isAuthority`, `$.net.online`, `$.net.rpc`, `$.net.unhandle`, `$.off`, `$.on` | — |
| 420 | `net.lag-safe-feedback` | ✅ | `$.fn.flash`, `$.fn.off`, `$.fn.on`, `$.net.off`, `$.net.on` | — |

## V. Пакеты платформера, приключения и исследования — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 421 | `kit.platformer-core` | ✅ | состав kit | — |
| 422 | `kit.platformer-combat` | ✅ | состав kit | — |
| 423 | `kit.platformer-collectathon` | ✅ | состав kit | — |
| 424 | `kit.platformer-checkpoint` | ✅ | состав kit | — |
| 425 | `kit.metroidvania-gates` | ✅ | состав kit | — |
| 426 | `kit.metroidvania-map` | ✅ | состав kit | — |
| 427 | `kit.adventure-interaction` | ✅ | состав kit | — |
| 428 | `kit.adventure-inventory` | ✅ | состав kit | — |
| 429 | `kit.puzzle-platformer` | ✅ | состав kit | — |
| 430 | `kit.precision-platformer` | ✅ | состав kit | — |
| 431 | `kit.parkour` | ✅ | состав kit | — |
| 432 | `kit.underwater` | ✅ | состав kit | — |
| 433 | `kit.gravity-platformer` | ✅ | состав kit | — |
| 434 | `kit.vehicle-platformer` | ✅ | состав kit | — |
| 435 | `kit.boss-platformer` | ✅ | состав kit | — |
| 436 | `kit.platformer-coop` | ✅ | состав kit | — |
| 437 | `kit.exploration-journal` | ✅ | состав kit | — |
| 438 | `kit.secret-hunt` | ✅ | состав kit | — |
| 439 | `kit.level-challenge` | ✅ | состав kit | — |
| 440 | `kit.stage-select` | ✅ | состав kit | — |

## W. Пакеты shooter, action и roguelike — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 441 | `kit.top-down-shooter` | ✅ | состав kit | — |
| 442 | `kit.twin-stick-arena` | ✅ | состав kit | — |
| 443 | `kit.bullet-heaven` | ✅ | состав kit | — |
| 444 | `kit.arena-survival` | ✅ | состав kit | — |
| 445 | `kit.stealth` | ✅ | состав kit | — |
| 446 | `kit.infiltration` | ✅ | состав kit | — |
| 447 | `kit.cover-shooter` | ✅ | состав kit | — |
| 448 | `kit.shooter-loadout` | ✅ | состав kit | — |
| 449 | `kit.boss-rush` | ✅ | состав kit | — |
| 450 | `kit.roguelike-run` | ✅ | состав kit | — |
| 451 | `kit.roguelite-meta` | ✅ | состав kit | — |
| 452 | `kit.deckbuilder-battle` | ✅ | состав kit | — |
| 453 | `kit.action-combo` | ✅ | состав kit | — |
| 454 | `kit.fighting-game` | ✅ | состав kit | — |
| 455 | `kit.beat-em-up` | ✅ | состав kit | — |
| 456 | `kit.tower-defense` | ✅ | состав kit | — |
| 457 | `kit.lane-defense` | ✅ | состав kit | — |
| 458 | `kit.bomb-arena` | ✅ | состав kit | — |
| 459 | `kit.survival-combat` | ✅ | состав kit | — |
| 460 | `kit.horde-defense` | ✅ | состав kit | — |

## X. Пакеты RPG, тактики, симуляции и спорта — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 461 | `kit.jrpg-party` | ✅ | состав kit | — |
| 462 | `kit.jrpg-turn-battle` | ✅ | состав kit | — |
| 463 | `kit.tactical-grid` | ✅ | состав kit | — |
| 464 | `kit.tactical-squad` | ✅ | состав kit | — |
| 465 | `kit.crpg-dialogue` | ✅ | состав kit | — |
| 466 | `kit.dungeon-crawl` | ✅ | состав kit | — |
| 467 | `kit.life-sim` | ✅ | состав kit | — |
| 468 | `kit.farming` | ✅ | состав kit | — |
| 469 | `kit.fishing` | ✅ | состав kit | — |
| 470 | `kit.crafting-survival` | ✅ | состав kit | — |
| 471 | `kit.colony-management` | ✅ | состав kit | — |
| 472 | `kit.business-sim` | ✅ | состав kit | — |
| 473 | `kit.traffic-management` | ✅ | состав kit | — |
| 474 | `kit.racing-time-trial` | ✅ | состав kit | — |
| 475 | `kit.racing-combat` | ✅ | состав kit | — |
| 476 | `kit.sports-match` | ✅ | состав kit | — |
| 477 | `kit.platform-sports` | ✅ | состав kit | — |
| 478 | `kit.rhythm` | ✅ | состав kit | — |
| 479 | `kit.music-arcade` | ✅ | состав kit | — |
| 480 | `kit.pinball` | ✅ | состав kit | — |

## Y. Narrative, обучение, полный проект и QA — 20/20

| № | ID | Статус | API | Пробел |
|---|---|---|---|---|
| 481 | `kit.visual-novel` | ✅ | состав kit | — |
| 482 | `kit.romance-routes` | ✅ | состав kit | — |
| 483 | `kit.mystery-investigation` | ✅ | состав kit | — |
| 484 | `kit.episodic-story` | ✅ | состав kit | — |
| 485 | `kit.horror` | ✅ | состав kit | — |
| 486 | `kit.escape-room` | ✅ | состав kit | — |
| 487 | `kit.tutorial` | ✅ | состав kit | — |
| 488 | `kit.daily-challenge` | ✅ | состав kit | — |
| 489 | `kit.achievement-set` | ✅ | состав kit | — |
| 490 | `kit.replay-ghost` | ✅ | состав kit | — |
| 491 | `kit.local-coop` | ✅ | состав kit | — |
| 492 | `kit.authoritative-coop` | ✅ | состав kit | — |
| 493 | `kit.arena-multiplayer` | ✅ | состав kit | — |
| 494 | `kit.multiplayer-survival` | ✅ | состав kit | — |
| 495 | `kit.project-platformer` | ✅ | состав kit | — |
| 496 | `kit.project-top-down-action` | ✅ | состав kit | — |
| 497 | `kit.project-vn-romance` | ✅ | состав kit | — |
| 498 | `kit.project-jrpg` | ✅ | состав kit | — |
| 499 | `kit.project-coop-adventure` | ✅ | состав kit | — |
| 500 | `kit.project-witch` | ✅ | состав kit | — |
