#!/usr/bin/env python3
# ===========================================================================
# Интеграционный тест логики и состояний: $.state, $.signal, $.flow.
#
# Гоняет фикстуру tests/fixtures/state и проверяет то, ради чего подсистемы и
# делались: машина состояний реально переключается (guard, action, ловушка '*',
# составные состояния, история), сигналы доставляются с приоритетами и не
# вклиниваются друг в друга, а потоки идут по игровому времени и отменяются
# целиком.
#
# ВАЖНО (требование к интеграции в api.js):
#   import { installState, tickState } from './state.js';
#   import { installSignal } from './signal.js';
#   import { installFlow, tickFlow } from './flow.js';
#   … installState($); installSignal($); installFlow($);
#   … в кадре: tickState(dt); tickFlow();
# tickFlow надо звать БЕЗ аргумента (или с dt — не важно): шаг он берёт из
# $.time.delta(), поэтому пауза и $.time.scale останавливают потоки. Если
# позвать tickFlowMs(dt * 1000), проверка паузы ниже не пройдёт — это не
# ошибка теста, а неверная интеграция.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_state_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "state")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- Подсистемы на месте ----------------------------------------------
        check(a.eval("typeof $.state.create") == "function", "$.state установлен")
        check(a.eval("typeof $.signal.on") == "function", "$.signal установлен")
        check(a.eval("typeof $.flow.series") == "function", "$.flow установлен")
        check(a.eval("typeof $.fn.fsm") == "function", "метод узла .fsm() объявлен")
        check(a.eval("$.state.list().length") >= 3, "в реестре три машины фикстуры")

        # --- Привязка к узлу ---------------------------------------------------
        check(a.eval("$('#hero').fsm()") == "idle", "стартовое состояние — idle")
        check(a.eval("$.state.current('#hero')") == "idle", "$.state.current видит узел")
        check(a.eval("$.state.byName('hero') === $.state.get('#hero')") is True,
              "$.state.get отдаёт ту же машину, что byName")

        # --- Переходы, guard и action -----------------------------------------
        check(a.eval("$.store.get('idleEnter')") == 1, "enter стартового состояния сработал")
        check(a.eval("$.state.send('#hero', 'move')") is False, "guard не пускает переход")
        check(a.eval("$.state.current('#hero')") == "idle", "состояние не изменилось")
        check(a.eval("$.store.get('moveAction')") == 0, "action при отказе не выполняется")
        check(a.eval("$.state.send('#hero', 'лететь')") is False,
              "неизвестное событие — false, а не исключение")

        a.eval("$.state.get('#hero').data.moving = true; true")
        check(a.eval("$.state.can('#hero', 'move')") is True, "can() видит пройденный guard")
        check(a.eval("$.state.send('#hero', 'move')") is True, "переход по событию состоялся")
        check(a.eval("$.store.get('runEnter')") == 1, "enter нового состояния вызван")
        check(a.eval("$.store.get('idleExit')") == 1, "exit старого состояния вызван")
        check(a.eval("$.store.get('moveAction')") == 1, "action выполнен до входа")

        # --- Ловушка '*' --------------------------------------------------------
        check(a.eval("$.state.send('#hero', 'чепуха')") is True, "ловушка * ловит любое событие")
        check(a.eval("$.state.current('#hero')") == "idle", "ловушка вернула в idle")

        # --- Составные состояния ------------------------------------------------
        check(a.eval("$.state.send('#hero', 'jump')") is True, "прыжок из idle")
        check(a.eval("$.state.current('#hero')") == "air.up",
              "вход в составное состояние идёт в initial")
        check(a.eval("$.state.is('#hero', 'air')") is True, "is видит родителя")
        check(a.eval("$.state.is('#hero', 'air.down')") is False, "сосед не активен")
        check(a.eval("$.store.get('airEnter')") == 1, "enter родителя вызван один раз")
        check(a.eval("$.store.get('hookAir')") == 1, "хук onEnter('air') сработал")

        check(a.eval("$.state.send('#hero', 'land')") is True, "land из air.up")
        check(a.eval("$.state.current('#hero')") == "air.down",
              "относительная цель land разрешилась в air.down")
        check(a.eval("$.store.get('downEnter')") == 1, "enter листа air.down")
        check(a.eval("$.store.get('airExit')") == 0,
              "родитель не выходил: air остался активным")

        check(a.eval("$.state.send('#hero', 'land')") is True, "land из air.down")
        check(a.eval("$.state.current('#hero')") == "idle", "вернулись в idle")
        check(a.eval("$.store.get('airExit')") == 1, "выход из air посчитан один раз")

        # --- История ------------------------------------------------------------
        check(a.eval("$.state.get('#hero').history().join(',')")
              == "idle,run,idle,air.up,air.down,idle", "история входов по порядку")
        check(a.eval("$.state.get('#hero').previous()") == "air.down",
              "previous — состояние до текущего")
        check(a.eval("$.state.get('#hero').back()") is True, "back() возвращает в previous")
        check(a.eval("$.state.current('#hero')") == "air.down", "back() действительно перешёл")
        check(a.eval("$.state.set('#hero', 'idle')") is True, "set() — принудительный переход")
        check(a.eval("$.store.get('transitions')") >= 7, "журнал переходов пополняется")

        # --- Кадровый шаг -------------------------------------------------------
        ticks = a.eval("$.store.get('ticks')")
        a.step(3)
        check(a.eval("$.store.get('ticks')") > ticks, "update активного состояния тикает в кадре")
        game_ticks = a.eval("$.store.get('gameTicks')")
        a.step(3)
        check(a.eval("$.store.get('gameTicks')") > game_ticks, "машина без узла тоже тикает")

        # --- Удаление узла отвязывает машину ------------------------------------
        # Внимание: сам объект машины через eval не отдаём — у неё circular
        # ссылки (машина ↔ узел), JSON.stringify на агенте на них падает.
        check(a.eval("!!$.state.get('#ghost')") is True, "машина привязана к узлу")
        a.eval("$('#ghost').remove(); true")
        a.step(2)
        check(a.eval("!!$.state.get('#ghost')") is False, "машина отвязалась от удалённого узла")
        check(a.eval("!!$.state.byName('ghost')") is True,
              "сама машина после отвязки жива")

        # --- Сигналы: приоритеты и once -----------------------------------------
        check(a.eval("$.signal.count('score:add')") == 3, "три подписки на score:add")
        a.eval("$.signal.emit('score:add', 5, 'kill'); true")
        check(a.eval("$.store.get('score')") == 5, "аргументы сигнала дошли до обработчика")
        check(a.eval("$.store.get('signalLog')") == "score:kill;once;low;",
              "порядок по приоритетам: 10 → 0 → -10")
        a.eval("$.signal.emit('score:add', 2, 'hit'); true")
        check(a.eval("$.store.get('signalLog')") == "score:kill;once;low;score:hit;low;",
              "once снялся после первого вызова")
        check(a.eval("$.store.get('score')") == 7, "очки накопились")
        check(a.eval("$.signal.count('score:add')") == 2, "счётчик подписчиков уменьшился")

        # --- Отложенная доставка ------------------------------------------------
        a.eval("$.store.set('signalLog', ''); $.signal.emit('outer'); true")
        check(a.eval("$.store.get('signalLog')") == "outer1;outer2;inner;",
              "emit внутри emit не вклинивается в текущую рассылку")

        # --- waitFor ------------------------------------------------------------
        a.eval("globalThis.__waited = null;"
               " $.signal.waitFor('door:open').then((what) => { globalThis.__waited = what; }); true")
        check(a.eval("$.signal.waiters('door:open')") == 1, "ожидание зарегистрировано")
        a.eval("$.signal.emit('door:open', 'ключ'); true")
        check(a.eval("globalThis.__waited") == "ключ", "waitFor получил аргументы сигнала")
        check(a.eval("$.signal.waiters('door:open')") == 0, "ожидание снято после сигнала")

        # --- off по id ----------------------------------------------------------
        a.eval("globalThis.__sigN = 0;"
               " globalThis.__sigId = $.signal.on('temp', () => { globalThis.__sigN++; }); true")
        a.eval("$.signal.emit('temp'); $.signal.off('temp', globalThis.__sigId);"
               " $.signal.emit('temp'); true")
        check(a.eval("globalThis.__sigN") == 1, "off по id снимает подписку")

        # --- Потоки: серия ------------------------------------------------------
        a.eval("flowRun.series(100); true")
        check(a.eval("$.store.get('flowLog')") == "a;", "первый шаг серии выполняется сразу")
        a.step(10)
        check(a.eval("$.store.get('flowLog')") == "a;b;", "шаги серии идут по порядку и по времени")
        check(a.eval("$.store.get('flowDone')") == 1, "серия завершилась и позвала then")

        # --- after --------------------------------------------------------------
        a.eval("flowRun.after(50); true")
        a.step(6)
        check(a.eval("$.store.get('afterFired')") == 1, "$.flow.after сработал")
        a.step(10)
        check(a.eval("$.store.get('afterFired')") == 1, "after срабатывает ровно один раз")

        # --- parallel -----------------------------------------------------------
        a.eval("flowRun.parallel(); true")
        a.step(14)
        check(a.eval("$.store.get('flowLog')") == "x;y;", "ветки parallel завершаются по времени")
        check(a.eval("$.store.get('parallelDone')") == 1,
              "parallel завершился после последней ветки")

        # --- repeat -------------------------------------------------------------
        a.eval("flowRun.repeat(3, 30); true")
        a.step(14)
        check(a.eval("$.store.get('flowLog')") == "r0;r1;r2;", "повторы идут по порядку")
        check(a.eval("$.store.get('repeatDone')") == 1, "repeat завершился")

        # --- cancelAll ----------------------------------------------------------
        a.eval("flowRun.pending(600); true")
        a.step(2)
        check(a.eval("$.store.get('flowLog')") == "start;", "долгий поток стартовал")
        a.eval("$.flow.cancelAll(); true")
        a.step(50)
        check(a.eval("$.store.get('flowLog')") == "start;", "cancelAll остановил поток")
        check(a.eval("$.store.get('flowDone')") == 0, "отменённый поток не завершился")
        check(a.eval("$.flow.active()") == 0, "после cancelAll активных потоков нет")

        # --- Пауза: потоки на игровом времени -----------------------------------
        a.eval("$.time.pause(); flowRun.pending(60); true")
        a.step(1)
        flow_now = a.eval("$.flow.now()")
        a.step(5)
        check(a.eval("$.flow.now()") == flow_now, "на паузе время потоков стоит")
        check(a.eval("$.flow.active()") >= 1, "поток ждёт, а не потерялся")
        a.eval("$.time.resume(); true")
        a.step(10)
        check(a.eval("$.store.get('flowDone')") == 1, "после снятия паузы поток дошёл до конца")

        check(a.ping().get("pong") is True, "движок жив после всех манипуляций")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
