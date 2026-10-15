#!/usr/bin/env python3
# ===========================================================================
# Приёмка §5 (владение и жизненный цикл сцен) и §13 (signals/cleanup) через
# агентский интерфейс, с числами.
#
# Фикстура tests/fixtures/lifecycle собирает комнату внутри области владения:
# узлы с телами, подписки, таймеры, поток и задача принадлежат области;
# persistent HUD создан вне области.
#
# Проверяется:
#   * 100 последовательных restart/load не растят живые узлы, тела, подписки и
#     таймеры (числа до/после печатаются);
#   * persistent HUD переживает все restart;
#   * закрытие области из callback безопасно (разрушение — в безопасной фазе);
#   * отменённая генерация старого loader не публикует мир после нового перехода;
#   * ожидание закрытой области завершается отменой, once остаётся once,
#     node events не пересылаются в $.signal.
#
# Запуск (после сборки):
#   python3 tools/run_tests.py lifecycle_numbers_test
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "lifecycle")
FIELDS = ("nodes", "bodies", "subs", "waits", "timers", "flows", "scopes")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def state(a):
    return a.state().get("lifecycle") or {}


def alive(a, selector):
    """Узел есть и не помечен removed (count() у Wrapper — про частицы)."""
    return a.eval(f"(() => {{ const n = $('{selector}').get(0); return !!n && !n.removed; }})()")


def main():
    with Agent(game=GAME, seed=17) as a:
        a.step(3)

        # --- Комната и её владелец ------------------------------------------
        check(a.eval("$.scene.current()") == "room",
              "стартовая комната стала текущей сценой")
        check(a.eval("$.scene.scopeOf($.scene._state.scope_name) !== null") is True,
              "у текущей сцены есть активная область владения")
        check(alive(a, "#hud") is True,
              "persistent HUD жив (создан вне области)")
        check(alive(a, "#room-block-0") is True,
              "узлы комнаты принадлежат области")
        check(a.eval("$('#room-block-0').get(0).body >= 0") is True,
              "узел комнаты имеет тело (его тоже надо убирать)")

        start = json.loads(a.eval("JSON.stringify($.scene.counts())"))
        print("  числа после старта:", json.dumps(start, ensure_ascii=False))
        check(start["nodes"] > 7, "мир комнаты собран (6 блоков + closer + HUD)")
        check(start["subs"] >= 1, "подписка области видна в счётчиках")
        check(start["timers"] >= 2, "таймеры области (after + every) на месте")
        check(start["tasks"] >= 1, "задача области в работе")

        # --- 100 restart: числа не растут ------------------------------------
        for _ in range(100):
            a.eval("$.scene.restart(); 'ok'")
            a.step(1)
        a.step(2)
        after = json.loads(a.eval("JSON.stringify($.scene.counts())"))
        print("  числа после 100 restart:", json.dumps(after, ensure_ascii=False))
        for field in FIELDS:
            check(start[field] == after[field],
                  f"restart · {field}: {start[field]} → {after[field]} (не выросло)")
        check(alive(a, "#hud") is True,
              "persistent HUD пережил 100 restart")
        check(alive(a, "#room-block-0") is True,
              "мир комнаты жив и после restart")
        check(state(a).get("rooms", 0) >= 101,
              f"enter комнаты вызывался на каждый restart ({state(a).get('rooms')})")

        # --- 100 load вместо restart: числа те же ----------------------------
        for _ in range(100):
            a.eval("$.scene.load('room', { transition: 'none', scope: true }); 'ok'")
            a.step(1)
        a.step(2)
        after_load = json.loads(a.eval("JSON.stringify($.scene.counts())"))
        print("  числа после 100 load:", json.dumps(after_load, ensure_ascii=False))
        for field in FIELDS:
            check(start[field] == after_load[field],
                  f"load · {field}: {start[field]} → {after_load[field]} (не выросло)")

        # --- Закрытие области из callback безопасно --------------------------
        before_close = json.loads(a.eval("JSON.stringify($.scene.counts())"))
        a.eval("$('#room-closer').emit('hit'); 'ok'")
        # В момент callback узлы ещё на месте: разрушение отложено.
        check(alive(a, "#room-block-0") is True,
              "во время callback область ещё ничего не разрушила (безопасная фаза)")
        a.step(2)
        after_close = json.loads(a.eval("JSON.stringify($.scene.counts())"))
        check(state(a).get("closesFromCallback") == 1,
              "область закрыта из обработчика события")
        check(after_close["nodes"] < before_close["nodes"],
              f"после безопасной фазы узлы убраны: {before_close['nodes']} → {after_close['nodes']}")
        check(alive(a, "#room-block-0") is False,
              "узлы комнаты удалены")
        check(alive(a, "#hud") is True,
              "persistent HUD пережил закрытие области")
        check(after_close["bodies"] < before_close["bodies"],
              f"тела области удалены: {before_close['bodies']} → {after_close['bodies']}")

        a.eval("$.scene.load('room', { transition: 'none', scope: true }); 'ok'")
        a.step(2)
        check(alive(a, "#room-block-0") is True,
              "комната снова собирается после закрытия")

        # --- Отменённая генерация старого loader -----------------------------
        a.eval("$.scene.loadAsync('room', { steps: [{ total: 1000000, budget: 1, "
               "work: (i) => { $.store.set('loaderWork', ($.store.get('loaderWork', 0) || 0) + 1); "
               "if (i === 999999) $.store.set('loaderDone', 1); } }] }); 'ok'")
        a.step(4)
        worked = a.eval("$.store.get('loaderWork', 0)")
        check(worked > 0, f"loader начал работу ({worked} шагов)")
        a.eval("$.scene.load('other', { transition: 'none' }); 'ok'")
        a.step(6)
        after_cancel = a.eval("$.store.get('loaderWork', 0)")
        check(a.eval("$.scene.current()") == "other",
              "новый переход опубликовал свою сцену")
        check(after_cancel - worked <= 1,
              f"отменённый loader остановлен ({worked} → {after_cancel})")
        check(a.eval("$.store.get('loaderDone', 0)") == 0,
              "старый loader не дошёл до публикации мира")
        check(alive(a, "#room-block-0") is False,
              "мир старого загрузчика не опубликован после перехода")
        check(a.eval("$.scene.counts().tasks") == 0,
              "задача отменённого loader снята с насоса")

        # --- §13: ожидание закрытого scope и once ----------------------------
        a.eval("$.scene.load('room', { transition: 'none', scope: true }); 'ok'")
        a.step(2)
        a.eval("$.store.set('waitResult', 'pending');"
               "$.signal.waitFor('lifecycle:never', { scope: $.scene.scopeOf($.scene._state.scope_name) })"
               ".then(() => $.store.set('waitResult', 'ok'), () => $.store.set('waitResult', 'cancelled'));"
               "'ok'")
        a.eval("$.scene.restart(); 'ok'")
        a.step(2)
        check(a.eval("$.store.get('waitResult')") == "cancelled",
              "ожидание закрытой области завершилось отменой")

        once_before = a.eval("$.store.get('onceCalls', 0)")
        a.eval("$.signal.once('lifecycle:once', () => {"
               "$.store.set('onceCalls', ($.store.get('onceCalls', 0) || 0) + 1);"
               "$.signal.emit('lifecycle:once'); }); 'ok'")
        a.eval("$.signal.emit('lifecycle:once'); 'ok'")
        once_after = a.eval("$.store.get('onceCalls', 0)")
        check(once_after - once_before == 1,
              f"once остаётся once при вложенном emit ({once_after - once_before})")

        # --- §13: node events не пересылаются в signals ----------------------
        a.eval("$.store.set('nodeBoom', 0);"
               "$.signal.on('lifecycle:boom', () => $.store.set('nodeBoom', 1));"
               "$('#hud').on('lifecycle:boom', () => $.store.set('nodeBoom', 2));"
               "$('#hud').emit('lifecycle:boom'); 'ok'")
        check(a.eval("$.store.get('nodeBoom')") == 2,
              "событие узла дошло до узла и не ушло в шину сигналов")

        # --- §13: production-событие несёт логические ID ----------------------
        a.eval("$.store.set('evSource', null);"
               "$.signal.on('lifecycle:event', (e) => $.store.set('evSource', e.source));"
               "(() => { const ev = $.signal.event('lifecycle:event', { n: 1 }, { source: '#hud' });"
               "$.signal.emitEvent(ev); })(); 'ok'")
        check(a.eval("$.store.get('evSource')") == "hud",
              "source production-события — логический id, не native handle")

        check(a.ping().get("pong") is True, "движок жив после всех сценариев")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
