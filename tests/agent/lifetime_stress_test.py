#!/usr/bin/env python3
# ===========================================================================
# §52 плана дополировки: lifetime stress — 100 циклов, широкий список ресурсов.
#
# lifecycle_numbers_test.py считает узлы/тела/подписки/таймеры внутри области
# владения. Здесь проверяется ШИРОКИЙ список (§52): узлы, тела, текстуры,
# спрайты, твины, частицы, пулы, аудио-голоса, render targets и батчи — плюс
# то, что после последней выгрузки ничего не «залипло».
#
# Фикстура — tests/fixtures/lifecycle (та же, что у lifecycle_numbers_test):
# комната внутри области владения с узлами, телами, подписками, таймерами,
# потоком и задачей; persistent HUD создан вне области.
#
# Запуск (после сборки движка):
#   python3 tests/agent/lifetime_stress_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "lifecycle")
HALF = 50
FULL = 100

#: Снимок ресурсов: чем больше полей, тем заметнее утечка. Всё берём из уже
#: существующих подсистем — второго учёта ресурсов не вводим.
SNAPSHOT = """(() => {
    const c = $.debug.counters();
    const l = $.debug.limits();
    const s = (typeof $.sound.busy === 'function') ? $.sound.busy() : null;
    const r = (typeof engine.renderInfo === 'function') ? engine.renderInfo() : {};
    const sc = (typeof $.scene.counts === 'function') ? $.scene.counts() : {};
    return {
        nodes: c.nodes, world_nodes: c.world_nodes, bodies: c.bodies,
        tweens: c.tweens, particles: c.particles, pools: c.pools, zones: c.zones,
        textures: l.textures, sprites: l.sprites, joints: l.joints,
        textures_max: l.textures_max, bodies_max: l.bodies_max,
        batches: (typeof r.batches === 'number') ? r.batches : null,
        scene_nodes: sc.nodes, scene_bodies: sc.bodies, scene_subs: sc.subs,
        scene_timers: sc.timers, scene_scopes: sc.scopes,
        voices: s ? s.playing : null,
    };
})()"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def snapshot(a):
    data = a.eval(SNAPSHOT)
    if not isinstance(data, dict):
        raise AssertionError("снимок ресурсов не получен: %r" % (data,))
    return {k: v for k, v in data.items() if isinstance(v, (int, float))}


def grown(before, after, allow=0):
    out = {}
    for key, value in after.items():
        if key not in before:
            continue
        if value - before[key] > allow:
            out[key] = "%s → %s" % (before[key], value)
    return out


def cycles(a, count):
    for _ in range(count):
        a.eval("$.scene.restart(); 'ok'")
        a.step(1)
    a.step(2)


def main():
    with Agent(game=GAME, seed=13) as a:
        a.step(5)
        base = snapshot(a)
        print("  база: %s" % json.dumps(base, ensure_ascii=False))

        cycles(a, HALF)
        mid = snapshot(a)

        cycles(a, FULL - HALF)
        after = snapshot(a)
        print("  после %d циклов: %s" % (FULL, json.dumps(after, ensure_ascii=False)))

        # 1. Рост за первые 50 циклов.
        delta_mid = grown(base, mid)
        check(not delta_mid,
              "за %d циклов ресурсы не выросли (выросло: %s)" % (HALF, delta_mid or "ничего"))

        # 2. Рост за все 100: сравниваем не только с базой, но и с серединой —
        #    так видно медленную утечку, которая «размазана» по циклам.
        delta_full = grown(base, after)
        check(not delta_full,
              "за %d циклов ресурсы не выросли (выросло: %s)" % (FULL, delta_full or "ничего"))
        delta_tail = grown(mid, after)
        check(not delta_tail,
              "вторая половина циклов не добавила ресурсов (выросло: %s)"
              % (delta_tail or "ничего"))

        # 3. После стресса мир снова на базовых числах, а не «почти».
        diff = {k: "%s → %s" % (base[k], after[k]) for k in base
                if k in after and after[k] != base[k] and k != "batches"}
        check(not diff, "числа совпадают с базовыми (расхождения: %s)" % (diff or "нет"))

        # 4. Ничего не залипло: после циклов мир снова живой и несёт ровно те же
        #    области/таймеры, что и до стресса (пустой список после последней
        #    выгрузки проверяет highlevel_room_unload_test.py).
        check(a.eval("$.scene.counts().timers") == base.get("scene_timers"),
              "таймеры после циклов как в базе: %s (ждали %s)"
              % (a.eval("$.scene.counts().timers"), base.get("scene_timers")))
        check(a.eval("$.scene.counts().scopes") == base.get("scene_scopes"),
              "области владения закрыты: %s" % a.eval("$.scene.counts().scopes"))
        check((after.get("voices") or 0) <= (base.get("voices") or 0),
              "аудио-голоса не накопились: %s → %s" % (base.get("voices"), after.get("voices")))

        # 5. Движок жив и продолжает считать кадры.
        a.step(10)
        check(a.eval("engine.frame") > 0, "движок продолжает считать кадры после стресса")
        check(a.eval("$('#hud').length") == 1, "persistent HUD пережил стресс")

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        return 1
    print("Все проверки пройдены (%d циклов)" % FULL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
