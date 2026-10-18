#!/usr/bin/env python3
# ===========================================================================
# P0.5: generic damage/hitscan/projectile/AoE из demos/re2d_gta_sandbox/lib/combat.js
#
# Проверяется на живом движке в изолированной маленькой сцене:
#   * hitscan попадает в ближайшую допустимую цель ОДИН раз за выстрел;
#   * стена останавливает выстрел, цель за стеной не получает урона;
#   * mask/wallMask фильтруют цели и препятствия;
#   * payload содержит source, subject, type, point, radius, applied/hpAfter;
#   * узел получает событие 'damaged', глобально приходит $.emit('damage');
#   * при hp <= 0 приходят 'death' на узле и $.emit('death');
#   * AoE — bodiesIn + дистанция/линейный спад, каждая цель один раз;
#   * снаряд — узел <bullet>, пошаговый запрос, стена/цель/время жизни/дальность;
#   * промах (miss) не задевает никого и не присылает 'damage'.
#
# Сцена-фикстура создаётся в build/ (runtime JS демо, пересборка не нужна);
# lib-модули импортируются из demos/re2d_gta_sandbox/lib.
#
# Запуск: python3 tests/agent/re2d_gta_combat_test.py
# ===========================================================================

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FIXTURE = os.path.join("build", "_gta_test_combat")
FAILURES = []

L_TARGET = 0x2
L_WALL = 0x1
L_SOURCE = 0x4

FIXTURE_MAIN = """import { createCombat } from '../../demos/re2d_gta_sandbox/lib/combat.js';

$.ready(() => {
    globalThis.__gta = { createCombat };

    // JSON-снимки: узлы в результатах заменяем id/nid, иначе QuickJS сериализует
    // всё дерево свойств Node и тест получает не то, что проверяет.
    globalThis.__payload = (p) => p ? ({
        amount: p.amount, type: p.type,
        source: p.source ? (p.source.id || null) : null, sourceNid: p.sourceNid,
        subject: p.subject ? (p.subject.id || null) : null, subjectNid: p.subjectNid,
        point: p.point, impulse: p.impulse, radius: p.radius,
        applied: p.applied, hpBefore: p.hpBefore, hpAfter: p.hpAfter,
        dead: p.dead, reason: p.reason === undefined ? null : p.reason,
    }) : null;
    globalThis.__hit = (r) => ({
        hit: r.hit, reason: r.reason === undefined ? null : r.reason,
        wall: r.wall ? { id: r.wall.node ? (r.wall.node.id || null) : null,
                        nid: r.wall.node ? r.wall.node.nid : null,
                        point: r.wall.point } : null,
        hits: r.hits.map((h) => ({
            id: h.node.id || null, nid: h.node.nid,
            point: h.point, distance: h.distance, fraction: h.fraction,
            payload: __payload(h.payload),
        })),
    });
    globalThis.__aoe = (r) => ({
        hit: r.hit, point: r.point, radius: r.radius, reason: r.reason === undefined ? null : r.reason,
        hits: r.hits.map((h) => ({
            id: h.node.id || null, nid: h.node.nid,
            distance: h.distance, factor: h.factor, payload: __payload(h.payload),
        })),
    });
});
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def make_fixture():
    shutil.rmtree(FIXTURE, ignore_errors=True)
    os.makedirs(FIXTURE, exist_ok=True)
    with open(os.path.join(FIXTURE, "main.js"), "w", encoding="utf-8") as f:
        f.write(FIXTURE_MAIN)


def run(a, code):
    """eval с JSON-результатом."""
    return json.loads(a.eval("JSON.stringify((() => { %s })())" % code))


def setup(a):
    a.eval("""(() => {
        $.world.gravity(0, 0);
        return 'ok';
    })()""")
    run(a, """
        $('<player>', {id: 'hero'}).at(100, 200).health(100)
            .layerBits(0x4).mask(0xffff).gravity(false).appendTo($.world);
        globalThis.__combat = __gta.createCombat($);
        globalThis.__damage = [];
        globalThis.__nodeDamaged = 0;
        globalThis.__nodeDeath = 0;
        globalThis.__globalDeath = 0;
        $.on('damage', (e) => __damage.push(e.data));
        $.on('death', () => { __globalDeath++; });
        return {ok: true};
    """)


def spawn_target(a, nid, x, y, hp=100, layer=L_TARGET):
    return run(a, """
        $('<enemy>', {id: '%s'}).at(%s, %s).health(%s)
            .layerBits(%s).mask(0xffff).gravity(false).appendTo($.world);
        return {ok: true};
    """ % (nid, x, y, hp, layer))


def spawn_wall(a, nid, x, y, w=24, h=24):
    return run(a, """
        $('<wall>', {id: '%s'}).at(%s, %s).size(%s, %s)
            .layerBits(0x1).mask(0xffff).appendTo($.world);
        return {ok: true};
    """ % (nid, x, y, w, h))


def hit(a, **kw):
    names = {"from_": "from", "to_": "to"}
    args = ", ".join("%s: %s" % (names.get(k, k), json.dumps(v)) for k, v in kw.items())
    return run(a, "return __hit(__combat.hitscan({%s}));" % args)


def main():
    make_fixture()
    try:
        with Agent(game=FIXTURE, seed=7, fixed_dt=1.0 / 60.0) as a:
            setup(a)

            # --- A. Попадание, payload, события, стена -----------------------
            spawn_target(a, "near", 300, 200)
            spawn_wall(a, "wall", 420, 200)
            spawn_target(a, "far", 520, 200)
            r = hit(a, from_={"x": 100, "y": 200}, to={"x": 700, "y": 200},
                    amount=20, type="bullet", source="#hero",
                    mask=L_TARGET, wallMask=L_WALL)
            check(r["hit"] and len(r["hits"]) == 1, "hitscan попадает ровно в одну цель (%d)" % len(r["hits"]))
            first = r["hits"][0]
            check(first["id"] == "near", "первая цель на луче — near (%s)" % first["id"])
            check(abs(first["point"]["x"] - 286) <= 2,
                  "точка попадания на границе коробки цели (x≈286, есть %s)" % first["point"]["x"])
            p = first["payload"]
            check(p["source"] == "hero" and p["sourceNid"] == a.eval("$('#hero').nid()"),
                  "payload.source/sourceNid — стрелок")
            check(p["subjectNid"] == a.eval("$('#near').nid()"), "payload.subject — цель")
            check(p["type"] == "bullet" and p["amount"] == 20 and p["radius"] == 0,
                  "payload type/amount/radius")
            check(p["applied"] == 20 and p["hpBefore"] == 100 and p["hpAfter"] == 80 and p["dead"] is False,
                  "payload applied/hpBefore/hpAfter/dead (%s/%s/%s)" % (p["applied"], p["hpBefore"], p["hpAfter"]))
            check(a.eval("$('#near').hp()") == 80, "здоровье цели уменьшилось через $(node).damage")
            check(a.eval("__damage.length") == 1, "глобальное событие damage ровно одно")
            check(a.eval("__nodeDamaged") == 0, "у not-yet-подписанного узла счётчика нет (0)")

            # подписка на узел: 'damaged' и 'death'
            run(a, """
                $('#near').on('damaged', () => { __nodeDamaged++; });
                $('#near').on('death', () => { __nodeDeath++; });
                return {ok: true};
            """)
            r = hit(a, from_={"x": 100, "y": 200}, to={"x": 700, "y": 200},
                    amount=200, type="bullet", source="#hero",
                    mask=L_TARGET, wallMask=L_WALL)
            p = r["hits"][0]["payload"]
            check(r["hit"] and p["dead"] is True and p["hpAfter"] == 0,
                  "смертельный урон: dead/hpAfter=0")
            check(p["applied"] == 80, "applied не больше оставшегося HP (%s)" % p["applied"])
            check(a.eval("__nodeDamaged") == 1 and a.eval("__nodeDeath") == 1,
                  "узел получил 'damaged' и 'death' по разу")
            check(a.eval("__globalDeath") == 1, "глобальное 'death' (через node.emit) пришло один раз")
            check(a.eval("__damage.length") == 2, "глобальное 'damage' на второе попадание")

            # убираем near — теперь стену видно, far за стеной не задет
            run(a, "$('#near').remove(); return {ok:true};")
            far_hp = a.eval("$('#far').hp()")
            r = hit(a, from_={"x": 100, "y": 200}, to={"x": 700, "y": 200},
                    amount=20, mask=L_TARGET, wallMask=L_WALL)
            check(r["hit"] is False, "стена останавливает выстрел: попадания нет")
            check(r["wall"] is not None and r["wall"]["id"] == "wall",
                  "в wall вернулся узел стены (%s)" % (r["wall"] and r["wall"]["id"]))
            check(a.eval("$('#far').hp()") == far_hp, "цель за стеной не получила урона")
            check(a.eval("__damage.length") == 2, "за стеной событий damage не добавилось")

            # --- B. Промах ---------------------------------------------------
            r = hit(a, from_={"x": 100, "y": 300}, to={"x": 600, "y": 300},
                    mask=L_TARGET, wallMask=L_WALL)
            check(r["hit"] is False and r["wall"] is None and r["reason"] == "miss",
                  "промах: hit=false, wall=null, reason=miss")

            # --- C. Один хит на цель, порядок, pierce -----------------------
            spawn_target(a, "c1", 300, 400)
            spawn_target(a, "c2", 500, 400)
            r = hit(a, from_={"x": 100, "y": 400}, to={"x": 700, "y": 400},
                    amount=10, mask=L_TARGET, wallMask=0)
            check(len(r["hits"]) == 1 and r["hits"][0]["id"] == "c1",
                  "без pierce — только ближайшая цель (c1)")
            hp_c2 = a.eval("$('#c2').hp()")
            r = hit(a, from_={"x": 100, "y": 400}, to={"x": 700, "y": 400},
                    amount=10, mask=L_TARGET, wallMask=0, pierce=True, maxHits=5)
            check([h["id"] for h in r["hits"]] == ["c1", "c2"],
                  "pierce: порядок попаданий c1→c2 (%s)" % [h["id"] for h in r["hits"]])
            check(len(set(h["id"] for h in r["hits"])) == 2, "каждая цель в pierce — один раз")
            check(a.eval("$('#c2').hp()") == hp_c2 - 10, "c2 получила ровно один урон за выстрел")

            # --- D. Маска: цель на другом слое не видна ----------------------
            spawn_target(a, "other", 300, 500, layer=0x8)
            r = hit(a, from_={"x": 100, "y": 500}, to={"x": 600, "y": 500},
                    amount=10, mask=L_TARGET, wallMask=L_WALL)
            check(r["hit"] is False, "цель вне mask не попадает в hitscan")

            # --- E. Импульс --------------------------------------------------
            spawn_target(a, "imp", 300, 600)
            run(a, "$('#imp').velocity(0, 0); return {ok:true};")
            hit(a, from_={"x": 100, "y": 600}, to={"x": 700, "y": 600},
                amount=5, impulse={"x": 500, "y": 0}, mask=L_TARGET, wallMask=0)
            check(a.eval("$('#imp').velocity().x") > 100,
                  "impulse из payload применился к телу")
            check(a.eval("__damage[__damage.length - 1].impulse.x") == 500,
                  "payload.impulse — объект {x,y}")

            # --- E2. Синоним `damage:` (как в сценах demo) --------------------
            spawn_target(a, "alias", 300, 650)
            r = hit(a, from_={"x": 100, "y": 650}, to={"x": 700, "y": 650},
                    damage=9, mask=L_TARGET, wallMask=0)
            check(r["hit"] and r["hits"][0]["payload"]["amount"] == 9
                  and r["hits"][0]["payload"]["applied"] == 9,
                  "поле `damage:` принимается синонимом amount")
            check(a.eval("$('#alias').hp()") == 91, "`damage:` реально снял 9 HP")

            # --- F. AoE ------------------------------------------------------
            run(a, "$('#imp').remove(); $('#alias').remove(); return {ok:true};")
            spawn_target(a, "a1", 300, 700)
            spawn_target(a, "a2", 340, 700)
            spawn_target(a, "a3", 520, 700)
            r = run(a, """
                return __aoe(__combat.aoe({ point: {x: 300, y: 700}, radius: 100, amount: 40,
                                      type: 'explosion', falloff: 'linear',
                                      source: '#hero', mask: 0x2 }));
            """)
            names = [h["id"] for h in r["hits"]]
            check(names == ["a1", "a2"], "AoE: только цели в радиусе, порядок по дистанции (%s)" % names)
            check(r["hits"][0]["payload"]["applied"] == 40,
                  "AoE: в центре полный урон (%s)" % r["hits"][0]["payload"]["applied"])
            check(r["hits"][1]["payload"]["applied"] < 40,
                  "AoE: дальше — меньше урона (%s)" % r["hits"][1]["payload"]["applied"])
            check(r["hits"][0]["payload"]["radius"] == 100
                  and r["hits"][0]["payload"]["type"] == "explosion",
                  "AoE payload radius/type")
            check(a.eval("$('#a3').hp()") == 100, "AoE не задевает цель за радиусом")
            check(a.eval("$('#a1').hp()") == 60, "AoE: каждая цель один раз")

            # --- G. Снаряд ---------------------------------------------------
            spawn_target(a, "p1", 500, 800)
            spawn_wall(a, "pwall", 400, 800)
            r = run(a, """
                const shot = __combat.projectile({ from: {x: 200, y: 800}, dir: {x: 1, y: 0},
                    speed: 600, amount: 15, type: 'bullet', source: '#hero',
                    mask: 0x2, wallMask: 0x1, lifetime: 2000 });
                let f = 0;
                while (shot.alive() && f < 120) { __combat.update(1/60); f++; }
                return { reason: shot.reason, alive: shot.alive(),
                         wall: shot.wall && shot.wall.node && shot.wall.node.id,
                         targetHp: $('#p1').hp(), x: shot.node.get(0) && shot.node.get(0).x };
            """)
            check(r["reason"] == "wall" and r["alive"] is False,
                  "снаряд умирает о стену (reason=%s)" % r["reason"])
            check(r["wall"] == "pwall", "снаряд запомнил стену (%s)" % r["wall"])
            check(r["targetHp"] == 100, "цель за стеной не задета снарядом")

            run(a, "$('#pwall').remove(); return {ok:true};")
            r = run(a, """
                const shot = __combat.projectile({ from: {x: 200, y: 800}, dir: {x: 1, y: 0},
                    speed: 600, amount: 15, type: 'bullet', source: '#hero',
                    mask: 0x2, wallMask: 0x1, lifetime: 2000 });
                let f = 0;
                while (shot.alive() && f < 120) { __combat.update(1/60); f++; }
                return { reason: shot.reason, hit: shot.hit && shot.hit.node.id,
                         targetHp: $('#p1').hp(), projectiles: __combat.projectiles().length,
                         nodeRemoved: shot.node.get(0).removed };
            """)
            check(r["reason"] == "hit" and r["hit"] == "p1", "снаряд попадает в цель (%s)" % r["hit"])
            check(r["targetHp"] == 85, "снаряд нанёс 15 урона (%s)" % r["targetHp"])
            check(r["projectiles"] == 0 and r["nodeRemoved"] is True,
                  "снаряд убран из списка и удалён из мира")

            r = run(a, """
                const shot = __combat.projectile({ from: {x: 200, y: 900}, dir: {x: 1, y: 0},
                    speed: 600, amount: 15, mask: 0x2, wallMask: 0, lifetime: 100 });
                let f = 0;
                while (shot.alive() && f < 60) { __combat.update(1/60); f++; }
                return { reason: shot.reason, alive: shot.alive(), removed: shot.node.get(0).removed };
            """)
            check(r["reason"] == "lifetime" and r["alive"] is False and r["removed"] is True,
                  "истёк lifetime — снаряд безопасно удалён (%s)" % r["reason"])

            r = run(a, """
                const shot = __combat.projectile({ from: {x: 200, y: 950}, dir: {x: 1, y: 0},
                    speed: 600, amount: 15, mask: 0x2, wallMask: 0, maxDistance: 50 });
                let f = 0;
                while (shot.alive() && f < 60) { __combat.update(1/60); f++; }
                return { reason: shot.reason, alive: shot.alive() };
            """)
            check(r["reason"] == "range" and r["alive"] is False,
                  "предел дальности удаляет снаряд (%s)" % r["reason"])
    finally:
        shutil.rmtree(FIXTURE, ignore_errors=True)

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")
    sys.exit(0)


if __name__ == "__main__":
    main()
