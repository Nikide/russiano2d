#!/usr/bin/env python3
# ===========================================================================
# §10 плана дополировки: постоянное состояние анимации переживает сейв.
#
# Проверяется на реальном движке, через слот на диске:
#   * состояние плеера лежит в снимке ТАМ ЖЕ, где состояние остальных фабрик
#     узла — `nodes[nid].p['anim.player']`, ключ — стабильный nid (второй
#     системы сохранения не появляется);
#   * после `$.save.load()` плеер продолжает тот же клип с той же позиции:
#     клип, время, скорость, loop, слоты (кроссфейд — два слоя);
#   * открытое gameplay-окно удара (`attack`) остаётся открытым, а его
#     закрытие доигрывается своим ходом;
#   * одноразовый маркер удара, сработавший ДО сохранения, после загрузки не
#     срабатывает второй раз (иначе загрузка сейва наносила бы урон);
#   * плеер смотрит на ВОССТАНОВЛЕННЫЙ узел, а не на узел прошлого мира;
#   * в состоянии нет косметики: ни one-shot SFX, ни вспышек, ни тряски —
#     ключи ровно постоянные (§10 зафиксирован presentation-тестом);
#   * `save → load → save` не «плывёт».
#
# Фикстура — tests/fixtures/animplayer.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_save_anim_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "animplayer")
SLOT = "build/test_saves/slot-anim.json"
SLOT_NAME = "anim"

#: Поля снимка, которые законно меняются от сохранения к сохранению: это
#: метаданные момента, а не состояние мира.
VOLATILE = ("saved_at", "saved_frame", "time")

#: Ровно постоянное состояние плеера. Разовое (SFX/вспышки/тряска) сюда не
#: входит: оно не сохраняется вовсе, а не «сохраняется и игнорируется».
STATE_KEYS = ["clock", "clockExplicit", "loop", "paused", "slots", "speed", "time", "windows"]

PLAYER = "$.anim.player('saver')"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def same_payload(first, second):
    """Сравнить два сейва без полей момента (§10: данные не должны «плыть»)."""
    def strip(value):
        if isinstance(value, dict):
            return {k: strip(v) for k, v in value.items() if k not in VOLATILE}
        if isinstance(value, list):
            return [strip(v) for v in value]
        return value

    try:
        return strip(json.loads(first)) == strip(json.loads(second))
    except Exception:
        return False


def build_scene(a):
    """Клип с окном удара на своём узле: сохраняться будем в середине атаки."""
    a.eval("""
    (() => {
        $.save.dir('build/test_saves');
        $.anim.clip('save-attack', {
            duration: 600,
            loop: 'once',
            tracks: [
                { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 600, v: 0.5 }] },
                { type: 'value', name: 'phase', attr: true, keys: [{ t: 0, v: 0 }, { t: 600, v: 6 }] },
            ],
            events: [
                { at: 120, name: 'anim-open', window: 'hit', windowPhase: 'open' },
                { at: 380, name: 'anim-close', window: 'hit', windowPhase: 'close' },
                { at: 300, name: 'anim-damage', kind: 'damage', once: true, data: { power: 7 } },
            ],
        });
        $('<rect>', { id: 'saver' }).at(10, 10).size(20, 20).appendTo($.world);
        // Узел без плеера: у него состояния анимации быть не должно.
        $('<rect>', { id: 'noanim' }).at(40, 40).size(20, 20).appendTo($.world);
        $.store.set('animHits', 0);
        const p = $.anim.player('saver').target('#saver');
        p.on('anim-damage', () => $.store.set('animHits', ($.store.get('animHits', 0) || 0) + 1));
        p.play('save-attack');
        return true;
    })()
    """)


def main():
    with Agent(game=GAME, seed=11, fixed_dt=1.0 / 60.0) as a:
        a.step(5)
        build_scene(a)

        # --- середина атаки: окно удара открыто, урон уже прошёл --------------
        for _ in range(60):
            a.step(1)
            if (a.eval("%s.window('hit')" % PLAYER) is True
                    and a.eval("%s.time()" % PLAYER) > 300):
                break
        t_saved = a.eval("%s.time()" % PLAYER)
        check(300 < t_saved < 380, "атака остановлена в середине: t = %.1f мс" % t_saved)
        check(a.eval("%s.window('hit')" % PLAYER) is True, "окно удара открыто")
        check(a.eval("$.store.get('animHits')") == 1, "урон прошёл один раз ДО сохранения")

        # --- состояние плеера: ровно постоянные поля ---------------------------
        state = a.eval("%s.state()" % PLAYER)
        check(isinstance(state, dict) and sorted(state.keys()) == STATE_KEYS,
              "в состоянии плеера только постоянные поля: %s" % sorted(state.keys() or []))
        check(state["slots"][0]["clip"] == "save-attack" and len(state["slots"]) == 1,
              "в состоянии один слот с клипом атаки: %s" % state["slots"])
        check(state["windows"] == [{"name": "hit", "at": 120, "clip": "save-attack"}],
              "открытое окно удара в состоянии: %s" % state["windows"])
        check(state["slots"][0]["fired"] == ["save-attack:anim-damage@300"],
              "сработавший одноразовый маркер помечен: %s" % state["slots"][0]["fired"])

        mixer = a.eval("$.anim.player('mixer').state()")
        check(len(mixer["slots"]) == 2 and abs(mixer["slots"][0]["weight"] - 0.5) < 1e-9,
              "кроссфейд хранится двумя слоями: %s" % [s["slot"] for s in mixer["slots"]])

        check("anim.player" in a.eval("$.save.stats().behaviors"),
              "провайдер анимации зарегистрирован модулем: %s" % a.eval("$.save.stats().behaviors"))

        # --- слот: состояние анимации лежит в состоянии узла по nid -----------
        check(a.eval("$.save.save('%s')" % SLOT_NAME) is True, "слот с анимацией записан")
        nid = a.eval("$('#saver').toArray()[0].nid")
        payload = json.loads(a.eval("$.fs.readText('%s')" % SLOT))
        nodes = payload.get("namespaces", {}).get("room", {}).get("nodes", {})
        entry = (nodes.get(nid) or {}).get("p", {}).get("anim.player")
        check(entry is not None, "состояние анимации лежит в nodes['%s'].p['anim.player']" % nid)
        check((entry or {}).get("v") == 1, "версия состояния анимации в снимке: %s" % (entry or {}).get("v"))
        player_entry = ((entry or {}).get("players") or {}).get("saver") or {}
        check(player_entry.get("slots", [{}])[0].get("clip") == "save-attack",
              "клип в снимке: %s" % player_entry.get("slots"))
        check(player_entry.get("windows", [{}])[0].get("name") == "hit",
              "окно удара в снимке: %s" % player_entry.get("windows"))
        noanim_nid = a.eval("$('#noanim').toArray()[0].nid")
        check("anim.player" not in ((nodes.get(noanim_nid) or {}).get("p") or {}),
              "у узла без плееров состояния анимации нет")

        # --- ломаем: плеер остановлен, окно закрыто ---------------------------
        a.eval("%s.stop()" % PLAYER)
        a.step(3)
        check(a.eval("%s.playing()" % PLAYER) is False, "состояние сбито: плеер остановлен")
        check(a.eval("%s.window('hit')" % PLAYER) is False, "окно удара закрыто")

        # --- загрузка: клип, время, окно, маркер ------------------------------
        check(a.eval("$.save.load('%s')" % SLOT_NAME) is True, "слот с анимацией загружен")
        check(a.eval("%s.clip()" % PLAYER) == "save-attack", "после load играет тот же клип")
        t_after = a.eval("%s.time()" % PLAYER)
        check(abs(t_after - t_saved) < 1e-6,
              "время клипа совпало: %.3f → %.3f мс" % (t_saved, t_after))
        check(a.eval("%s.window('hit')" % PLAYER) is True, "окно удара снова открыто")
        check(a.eval("$.store.get('animHits')") == 1, "загрузка не нанесла урон повторно")
        check(a.eval("%s.target() === $('#saver').toArray()[0]" % PLAYER) is True,
              "плеер смотрит на восстановленный узел, а не на узел прошлого мира")
        check(a.eval("%s.state()['slots'][0]['fired']" % PLAYER) == ["save-attack:anim-damage@300"],
              "сработавший маркер восстановлен вместе с плеером")

        # --- атака доигрывается своим ходом -----------------------------------
        for _ in range(40):
            a.step(1)
            if a.eval("%s.window('hit')" % PLAYER) is False:
                break
        check(a.eval("%s.window('hit')" % PLAYER) is False,
              "после загрузки атака дошла до закрытия окна")
        check(a.eval("$.store.get('animHits')") == 1, "второго удара при доигрывании нет")

        # --- перемотка назад: одноразовый маркер уже сработал -----------------
        a.eval("%s.seek(200)" % PLAYER)
        check(a.eval("%s.time()" % PLAYER) == 200, "перемотка на 200 мс")
        a.step(12)                                  # 200 → ~400 мс, через маркер 300
        check(a.eval("%s.time()" % PLAYER) > 300, "часы прошли маркер удара заново")
        check(a.eval("$.store.get('animHits')") == 1,
              "повторный проход через одноразовый маркер урона не нанёс")

        # --- save → load → save не «плывёт» -----------------------------------
        first = a.eval("$.fs.readText('%s')" % SLOT)
        a.eval("$.save.load('%s')" % SLOT_NAME)
        a.eval("$.save.save('%s')" % SLOT_NAME)
        second = a.eval("$.fs.readText('%s')" % SLOT)
        check(same_payload(first, second),
              "save → load → save не «плывёт» (состояние анимации воспроизводится точно)")

        # --- откат restore: плеер возвращается к прежней цели и состоянию ------
        a.eval("%s.play('save-attack', { restart: true, time: 130 })" % PLAYER)
        a.step(2)
        rollback = a.eval("""
        (() => {
            const before = (() => {
                const p = $.anim.player('saver');
                return { clip: p.clip(), time: p.time(), window: p.window('hit'),
                         node: p.target() === $('#saver').toArray()[0] };
            })();
            // Битый nid: restore обязан отказать ДО commit (инварианты §14).
            const payload = $.save.snapshot();
            payload.namespaces.room.nodes.n999999 = { v: [0, 0] };
            const r = $.save.restore(payload);
            const p = $.anim.player('saver');
            return {
                ok: r.ok, stage: r.stage, before,
                clip: p.clip(), time: p.time(), window: p.window('hit'),
                node: p.target() === $('#saver').toArray()[0], playing: p.playing(),
            };
        })()
        """)
        check(rollback["ok"] is False and rollback["stage"] == "invariants",
              "restore с битым nid отклонён до commit: %s" % rollback)
        check(rollback["clip"] == rollback["before"]["clip"] and rollback["playing"] is True,
              "откат не остановил плеер: %s" % rollback["clip"])
        check(abs(rollback["time"] - rollback["before"]["time"]) < 1e-6,
              "откат вернул прежнее время: %s → %s" % (rollback["before"]["time"], rollback["time"]))
        check(rollback["node"] is True, "откат вернул плееру живой узел прежнего мира")
        check(rollback["window"] == rollback["before"]["window"],
              "состояние окна после отката прежнее: %s" % rollback["window"])

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
