#!/usr/bin/env python3
# ===========================================================================
# §8.2 плана дополировки: выгрузка обязана убирать не только узлы и тела, но и
# звук, свет, частицы, подписки и мёртвые JS-обёртки.
#
# lifecycle_numbers_test.py считает узлы/тела/подписки/таймеры/потоки. Здесь
# проверяется остальное из §8.2: аудио-голоса, источники света, эмиттеры
# частиц, зарегистрированные колбэки (ui_callbacks), текстуры (спрайты умерших
# узлов не должны держать атлас) и то, что обёртка над удалённым узлом больше
# ничего не находит.
#
# Фикстура — tests/fixtures/lifecycle: комната внутри области владения
# (scope: true), звук берём из её assets/hit.wav.
#
# Запуск (после сборки движка):
#   python3 tests/agent/unload_resources_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "lifecycle")

SNAPSHOT = """(() => {
    const c = $.debug.counters();
    const l = $.debug.limits();
    const s = $.sound.busy();
    const sc = $.scene.counts();
    return {
        particles: c.particles, tweens: c.tweens, zones: c.zones,
        ui_callbacks: l.ui_callbacks, textures: l.textures, sprites: l.sprites,
        voices: s.active, scenes: sc.scopes, timers: sc.timers, subs: sc.subs,
    };
})()"""

#: Внутри области: зацикленный звук, эмиттер частиц, источник света, твин.
INSIDE = """
$.sound.play('assets/hit.wav', { loop: true });
$.scene.scope().node($('<particles>', { id: 'room-fire', rate: 40, life: 20 })
    .at(120, 120).appendTo($.world));
$.scene.scope().node($('<light>', { id: 'room-lamp', radius: 120, intensity: 0.8 })
    .at(200, 120).blend('add').appendTo($.world));
'ok'
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def snapshot(a):
    return {k: v for k, v in (a.eval(SNAPSHOT) or {}).items() if isinstance(v, (int, float))}


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(4)
        base = snapshot(a)
        print("  база: %s" % json.dumps(base, ensure_ascii=False))

        # --- Внутри области создаём ресурсы всех видов ------------------------
        a.eval(INSIDE)
        a.step(4)
        full = snapshot(a)
        print("  в комнате: %s" % json.dumps(full, ensure_ascii=False))
        check(full["particles"] > base["particles"],
              "эмиттер частиц работает внутри области (%s → %s)"
              % (base["particles"], full["particles"]))
        check(full["voices"] > base["voices"],
              "звук звучит внутри области (%s → %s)" % (base["voices"], full["voices"]))

        # --- Выгрузка комнаты: scope закрывается ------------------------------
        a.eval("$.scene.scope().close('проверка §8.2'); 'ok'")
        a.step(30)   # частицы живут свой срок: даём догореть
        after = snapshot(a)
        print("  после выгрузки: %s" % json.dumps(after, ensure_ascii=False))

        for field in ("particles", "zones", "ui_callbacks", "textures", "sprites"):
            check(after[field] == base[field],
                  "§8.2 · %s: %s → %s (вернулось к базе)"
                  % (field, base[field], after[field]))
        check(after["voices"] <= base["voices"],
              "§8.2 · аудио-голоса: %s → %s (не осталось)" % (base["voices"], after["voices"]))
        check(after["scenes"] == base["scenes"],
              "§8.2 · области владения: %s → %s" % (base["scenes"], after["scenes"]))
        check(after["timers"] == base["timers"],
              "§8.2 · таймеры области: %s → %s" % (base["timers"], after["timers"]))
        check(after["subs"] == base["subs"],
              "§8.2 · подписки: %s → %s" % (base["subs"], after["subs"]))

        # --- Мёртвые обёртки --------------------------------------------------
        check(a.eval("$('#room-fire').length") == 0, "обёртка эмиттера ничего не находит")
        check(a.eval("$('#room-lamp').length") == 0, "обёртка источника света ничего не находит")
        check(a.eval("$.sound.busy().active") <= base["voices"],
              "звук области снят: активных голосов %s" % a.eval("$.sound.busy().active"))

        # --- Мир жив и снова собирается ---------------------------------------
        a.eval("$.scene.load('room', { transition: 'none', scope: true }); 'ok'")
        a.step(3)
        check(a.eval("$('#room-block-0').length") == 1, "комната собирается заново после выгрузки")
        check(a.eval("$.scene.counts().scopes") == base["scenes"],
              "область владения снова одна: %s" % a.eval("$.scene.counts().scopes"))

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
