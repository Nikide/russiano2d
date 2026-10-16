#!/usr/bin/env python3
# ===========================================================================
# §10 плана дополировки: идентичность сцены/комнаты при загрузке сейва.
#
# Что проверяется на реальном движке, через слот на диске:
#   * сейв, снятый в комнате beta, после перехода в alpha и `$.save.load()`
#     возвращает МИР beta (`#map_beta`, правка карты) — и вместе с ним
#     ИДЕНТИЧНОСТЬ: `$.scene.current() == 'room:beta'`, `$.room.current().id`
#     снова beta, `$.room.marker()` работает;
#   * комната НЕ пересобирается повторно: узел карты ровно один, второго мира
#     (второго `#map_beta`, второго набора инстансов) не появляется;
#   * снимок с именем незарегистрированной комнаты: мир из снимка применяется,
#     а расхождение НАЗВАНО кодом `R2D_SAVE_SCENE_MISMATCH` (в `$.debug.errors()`,
#     в `$.save.lastScene()` и в поле `scene` результата restore) — тихой
#     подмены «в снимке beta, а current() говорит alpha» не остаётся;
#   * сцена-не-комната возвращается по имени (`$.scene.adopt`) без запуска
#     builder'а: мир не пересобирается, но сцена снова живая (её `update` тикает).
#
# Фикстура — tests/fixtures/room_tx (две комнаты, описанные данными).
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_save_scene_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "room_tx")
SLOT_NAME = "scene"
SLOT = "build/test_saves/slot-scene.json"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def errors_with(a, code):
    return [e for e in (a.eval("$.debug.errors()") or []) if e.get("code") == code]


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        a.eval("$.save.dir('build/test_saves')")

        # --- сейв в комнате beta ---------------------------------------------
        res = a.eval("(r => ({ ok: r.ok, id: r.id }))($.room.enter('beta'))")
        a.step(2)
        check(res["ok"] is True and res["id"] == "beta", "комната beta собрана: %s" % res)
        check(a.eval("$.scene.current()") == "room:beta",
              "комната — текущая сцена: %s" % a.eval("$.scene.current()"))
        check(a.eval("$('#map_beta').toArray()[0].nid") is not None, "карта beta в мире")

        # Правка карты: по ней видно, что вернулся именно мир beta.
        a.eval("$('#map_beta').setTile(0, 0, 0)")
        a.step(1)
        check(a.eval("$.fixture.mapCell(0, 0)") == 0, "клетка (0,0) beta очищена")
        check(a.eval("$.save.save('%s')" % SLOT_NAME) is True, "слот с комнатой записан")
        snap = a.eval("$.save.snapshot()")
        check(snap.get("scene") == "room:beta",
              "снимок хранит ID комнаты: scene = %s" % snap.get("scene"))
        # Снимок мира beta с испорченным полем scene — для проверки расхождения.
        a.eval("""
        globalThis.__wrongScene = (() => {
            const p = $.save.snapshot();
            p.scene = 'room:нет-такой';
            return p;
        })()
        """)

        # --- уходим в другую комнату ------------------------------------------
        a.eval("$.room.enter('alpha')")
        a.step(2)
        check(a.eval("$.scene.current()") == "room:alpha" and a.eval("$.fixture.mapCell(0, 0)") == 1,
              "в alpha свой мир: %s" % a.eval("$.scene.current()"))
        check(a.eval("$('#map_beta').toArray().length") == 0, "карты beta в мире alpha нет")

        # --- load: мир beta И идентичность beta -------------------------------
        check(a.eval("$.save.load('%s')" % SLOT_NAME) is True, "слот с комнатой загружен")
        a.step(1)
        info = a.eval("$.save.lastScene()")
        check(info.get("saved") == "room:beta" and info.get("restored") is True,
              "сцена из снимка восстановлена: %s" % info)
        check(info.get("code") is None, "расхождения нет: code = %s" % info.get("code"))
        check(info.get("room") == "beta", "комната из снимка возвращена: %s" % info.get("room"))
        check(a.eval("$.scene.current()") == "room:beta",
              "*.scene.current() снова room:beta: %s" % a.eval("$.scene.current()"))
        check(a.eval("$.room.current().id") == "beta",
              "*.room.current() снова beta: %s" % a.eval("$.room.current().id"))
        check(a.eval("$('#map_beta').toArray().length") == 1
              and a.eval("$('#map_alpha').toArray().length") == 0,
              "в мире ровно одна карта beta и ни одной alpha (мир не пересобран)")
        check(a.eval("$.fixture.mapCell(0, 0)") == 0, "правка карты пережила load")
        marker = a.eval("$.room.marker('spawn')")
        check(marker.get("ok") is True and marker.get("room") == "beta",
              "*.room.marker работает в восстановленной комнате: %s" % marker)
        check(a.eval("$.scene.busy()") is False, "сцена не в переходе: имя и мир согласованы")

        # Идентичность не «съезжает» на следующем кадре (отложенных переходов нет).
        a.step(3)
        check(a.eval("$.scene.current()") == "room:beta"
              and a.eval("$('#map_beta').toArray().length") == 1,
              "через три кадра мир и сцена всё ещё beta")

        # --- расхождение: в снимке комната, которой в этом запуске нет ---------
        a.eval("$.room.enter('alpha')")
        a.step(2)
        bad = a.eval("""
        (() => {
            const r = $.save.restore(globalThis.__wrongScene);
            return {
                ok: r.ok, nodes: r.nodes,
                saved: r.scene && r.scene.saved, code: r.scene && r.scene.code,
                restored: r.scene && r.scene.restored,
                current: $.scene.current(), room: $.room.current() && $.room.current().id,
                beta: $('#map_beta').toArray().length, alpha: $('#map_alpha').toArray().length,
                last: $.save.lastScene() && $.save.lastScene().code,
            };
        })()
        """)
        check(bad["ok"] is True and bad["nodes"] > 0,
              "мир из снимка применён несмотря на неизвестную комнату: %s" % bad)
        check(bad["saved"] == "room:нет-такой" and bad["restored"] is False,
              "сцена не названа восстановленной: %s" % bad)
        check(bad["code"] == "R2D_SAVE_SCENE_MISMATCH" and bad["last"] == "R2D_SAVE_SCENE_MISMATCH",
              "расхождение названо кодом: %s" % bad["code"])
        check(bad["beta"] == 1 and bad["alpha"] == 0,
              "мир — из снимка (карта beta), а не прошлый alpha")
        check(bad["current"] == "room:alpha",
              "текущая сцена не подменена молча: %s" % bad["current"])
        found = errors_with(a, "R2D_SAVE_SCENE_MISMATCH")
        check(bool(found), "код виден в $.debug.errors(): %d записей" % len(found))
        check(any("нет-такой" in (e.get("message") or "") for e in found),
              "в диагностике названо имя из снимка: %s" % [e.get("message") for e in found])

        # --- сцена-не-комната: имя возвращается, builder не запускается --------
        a.eval("""
        (() => {
            $.store.set('menuBuilds', 0);
            $.store.set('menuTicks', 0);
            $.scene.add('menu-save', {
                enter() { $.store.set('menuBuilds', ($.store.get('menuBuilds', 0) || 0) + 1); },
                update() { $.store.set('menuTicks', ($.store.get('menuTicks', 0) || 0) + 1); },
            });
            globalThis.__menuScene = (() => {
                const p = $.save.snapshot();
                p.scene = 'menu-save';
                return p;
            })();
            return true;
        })()
        """)
        nodes_before = a.eval("$.debug.counters().nodes")
        menu = a.eval("""
        (() => {
            const r = $.save.restore(globalThis.__menuScene);
            return {
                ok: r.ok, restored: r.scene && r.scene.restored, code: r.scene && r.scene.code,
                current: $.scene.current(), builds: $.store.get('menuBuilds'),
                nodes: $.debug.counters().nodes,
            };
        })()
        """)
        check(menu["ok"] is True and menu["restored"] is True,
              "сцена-не-комната возвращена по имени: %s" % menu)
        check(menu["current"] == "menu-save" and menu["builds"] == 0,
              "builder сцены НЕ запускался (второго мира нет): %s" % menu)
        check(menu["nodes"] == nodes_before,
              "число узлов не выросло: %s → %s" % (nodes_before, menu["nodes"]))
        check(menu["code"] == "R2D_SAVE_SCENE_MISMATCH",
              "устаревшая комната в $.room названа кодом: %s" % menu["code"])
        a.step(3)
        check(a.eval("$.store.get('menuTicks')") > 0,
              "восстановленная сцена снова получает update: %s тиков" % a.eval("$.store.get('menuTicks')"))

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
