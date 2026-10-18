#!/usr/bin/env python3
# ===========================================================================
# P0.6: ownership + стабильные handles (demos/re2d_gta_sandbox/lib/ownership.js)
#
# Живой движок, изолированная сцена:
#   * mark/is/kind: temporary | persistent | mission, неизвестный вид — RangeError;
#   * handle: {id, get(), alive()}; после destroy — dead и get()===null;
#   * переиспользование: новый узел с тем же id не управляется старым handle,
#     nid у него другой; пул ($.pool) меняет uid при выдаче — старый handle мёртв;
#   * sweep удаляет ТОЛЬКО temporary, persistent/mission защищены, keep/inside
#     работают, stale-узлы вычищаются;
#   * resolve(nid) находит заново размеченный узел (save/prefab-сценарий);
#   * clear({destroy:true}) убирает temporary, оставляя persistent/mission.
#
# Запуск: python3 tests/agent/re2d_gta_ownership_test.py
# ===========================================================================

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FIXTURE = os.path.join("build", "_gta_test_ownership")
FAILURES = []

FIXTURE_MAIN = """import { createOwnership } from '../../demos/re2d_gta_sandbox/lib/ownership.js';

$.ready(() => {
    globalThis.__gta = { createOwnership };
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
    return json.loads(a.eval("JSON.stringify((() => { %s })())" % code))


NODES = """
    $('<sprite>', {id: 'p'}).at(0, 0).appendTo($.world);
    $('<sprite>', {id: 'm'}).at(10, 0).appendTo($.world);
    $('<sprite>', {id: 't1'}).at(20, 0).appendTo($.world);
    $('<sprite>', {id: 't2'}).at(500, 0).appendTo($.world);
    $('<sprite>', {id: 't3'}).at(30, 0).appendTo($.world);
    globalThis.__own = __gta.createOwnership($);
    __own.mark('#p', 'persistent');
    __own.mark('#m', 'mission');
    __own.mark('#t1');
    __own.mark('#t2');
    __own.mark('#t3');
    return {ok: true};
"""


def main():
    make_fixture()
    try:
        with Agent(game=FIXTURE, seed=7, fixed_dt=1.0 / 60.0) as a:
            run(a, NODES)

            # --- 1. Разметка --------------------------------------------------
            r = run(a, """
                return {
                    t1: __own.is('#t1'), temp: __own.is('#t1', 'temporary'),
                    t1persist: __own.is('#t1', 'persistent'),
                    p: __own.is('#p', 'persistent'), m: __own.is('#m', 'mission'),
                    kind: __own.kind('#p'), unknown: __own.is('#t1', 'nope') === false,
                    unmarked: __own.kind('#hero'),
                };
            """)
            check(r["t1"] is True and r["temp"] is True, "temporary размечен и виден через is")
            check(r["t1persist"] is False, "is(node,'persistent') для temporary — false")
            check(r["p"] is True and r["m"] is True, "persistent/mission размечены")
            check(r["kind"] == "persistent", "kind() возвращает вид владения")
            check(r["unmarked"] is None, "неразмеченный/несуществующий узел — kind null")
            check(r["unknown"] is True, "неизвестный вид в is() — false, без исключения")
            bad = run(a, """
                let error = null;
                try { __own.mark('#t1', 'boss'); } catch (e) { error = String(e); }
                return { error };
            """)
            check(bad["error"] is not None and "RangeError" in bad["error"],
                  "неизвестный вид владения — RangeError, а не молчание")

            # --- 2. Handle: destroy ------------------------------------------
            r = run(a, """
                const h = __own.handle('#t1');
                const before = { alive: h.alive(), get: !!h.get(), id: h.id,
                                 isNid: h.id === $('#t1').nid(), kind: h.kind() };
                $('#t1').remove();
                return { before, after: { alive: h.alive(), get: h.get() } };
            """)
            check(r["before"]["alive"] is True and r["before"]["get"] is True,
                  "handle живого узла: alive/get")
            check(r["before"]["isNid"] is True and r["before"]["kind"] == "temporary",
                  "handle.id — nid движка, kind() — temporary")
            check(r["after"]["alive"] is False and r["after"]["get"] is None,
                  "после destroy handle мёртв, get()===null")

            # --- 3. Переиспользование id новым узлом -------------------------
            r = run(a, """
                $('<sprite>', {id: 'recycle'}).at(40, 0).appendTo($.world);
                __own.mark('#recycle', 'persistent');
                const h = __own.handle('#recycle');
                const oldNid = h.id;
                $('#recycle').remove();
                $('<sprite>', {id: 'recycle'}).at(60, 0).appendTo($.world);
                __own.mark('#recycle', 'persistent');
                const fresh = __own.handle('#recycle');
                return {
                    staleAlive: h.alive(), staleGet: h.get(),
                    newAlive: fresh.alive(), sameNid: fresh.id === oldNid,
                    staleControls: h.get() !== null,
                };
            """)
            check(r["staleAlive"] is False and r["staleGet"] is None,
                  "старый handle не управляет новым узлом с тем же id")
            check(r["newAlive"] is True, "новый handle нового узла жив")
            check(r["sameNid"] is False, "nid нового узла отличается от старого")

            # --- 4. Пул: выдача меняет uid, старый handle мёртв --------------
            r = run(a, """
                $.pool.create({name: 'gtapool', tag: 'sprite', max: 2, initial: 1});
                const first = $.pool.spawn('gtapool');
                const node = first.get(0);
                const h = __own.handle(node);
                const uid1 = node.uid;
                $.pool.release(node);
                const second = $.pool.spawn('gtapool');
                const node2 = second.get(0);
                const result = { sameObject: node2 === node, uidChanged: node2.uid !== uid1,
                                 oldAlive: h.alive(), oldGet: h.get() === null,
                                 newAlive: __own.handle(node2).alive() };
                $.pool.releaseAll();
                $.pool.clear('gtapool');
                return result;
            """)
            check(r["sameObject"] is True and r["uidChanged"] is True,
                  "пул переиспользовал объект и выдал новый uid")
            check(r["oldAlive"] is False and r["oldGet"] is True,
                  "handle старой выдачи пула мёртв (uid/generation)")
            check(r["newAlive"] is True, "handle новой выдачи пула жив")

            # --- 5. sweep: только temporary, защита/miss ---------------------
            r = run(a, """
                $('<sprite>', {id: 's1'}).at(25, 0).appendTo($.world);
                __own.mark('#s1');
                const before = __own.stats();
                const swept = __own.sweep({ keep: '#t3',
                    inside: { x: 0, y: 0, w: 100, h: 100 } });
                return { before, swept,
                         left: { s1: __own.is('#s1'), t2: __own.is('#t2'),
                                 t3: __own.is('#t3'), p: __own.is('#p'),
                                 m: __own.is('#m') } };
            """)
            check(r["swept"]["destroyed"] == 1, "inside-область удалила только temporary s1 (%s)" % r["swept"])
            check(r["left"]["s1"] is False, "s1 (temporary внутри) удалён")
            check(r["left"]["t2"] is True and r["left"]["t3"] is True,
                  "t2 (вне inside) и t3 (keep) остались")
            check(r["left"]["p"] is True and r["left"]["m"] is True,
                  "persistent/mission не тронуты sweep-ом")

            r = run(a, """
                const swept = __own.sweep({ keep: '#t3' });
                return { swept, t2: __own.is('#t2'), p: __own.is('#p'), m: __own.is('#m') };
            """)
            check(r["t2"] is False and r["swept"]["destroyed"] == 1,
                  "sweep без inside удалил оставшийся temporary t2")
            check(r["p"] is True and r["m"] is True, "persistent/mission по-прежнему на месте")

            # --- 6. stale и resolve -----------------------------------------
            r = run(a, """
                const node = $('#t3').get(0);
                const nid = node.nid;
                $('#t3').remove();
                const swept = __own.sweep({});
                return { nid, swept, resolved: __own.resolve(nid),
                         stats: __own.stats() };
            """)
            check(r["swept"]["stale"] >= 1, "sweep вычищает stale-записи (%s)" % r["swept"]["stale"])
            check(r["resolved"] is None, "resolve удалённого nid — null")

            r = run(a, """
                $('<sprite>', {id: 'reborn'}).at(70, 0).appendTo($.world);
                __own.mark('#reborn', 'persistent');
                const nid = $('#reborn').nid();
                const h = __own.resolve(nid);
                return { nid, alive: h ? h.alive() : false, id: h ? h.id : null };
            """)
            check(r["alive"] is True and r["id"] == r["nid"],
                  "resolve(nid) находит заново размеченный узел (save/prefab-сценарий)")

            # --- 7. clear({destroy:true}) -----------------------------------
            r = run(a, """
                __own.mark('#reborn', 'temporary');
                const cleared = __own.clear({ destroy: true });
                return { cleared, p: __own.is('#p'), m: __own.is('#m'),
                         reborn: __own.is('#reborn'), stats: __own.stats() };
            """)
            check(r["reborn"] is False, "clear({destroy:true}) снял/удалил temporary")
            check(r["p"] is True and r["m"] is True,
                  "clear({destroy:true}) оставил persistent и mission")
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
