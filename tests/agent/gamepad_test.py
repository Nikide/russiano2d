#!/usr/bin/env python3
# ===========================================================================
# Геймпады: аудит того, что уже работает, и дыр, которые закрыты (docs/TASKS §24).
#
# База в движке была и раньше — здесь она ПРОВЕРЯЕТСЯ ФАКТОМ на живом движке,
# а не пересказывается по коду:
#   * фронт vs удержание (`pressed()` — один кадр, `down()` — пока держат);
#   * мёртвая зона осей (`$.input.deadzone`), значение ровно на пороге;
#   * курки как оси 0..1, круглый стик не даёт «квадратных» углов в `vec()`;
#   * четыре слота независимы, четыре разных фронта;
#   * залипание кнопки при отключении: сброс слота снимает и удержание, и
#     фронт (`$.input.stuck()` пуст, `resetHeld`/агентский `pad { reset }`);
#   * агентская команда `pad` принимает имена SDL («a», «dpup», «leftTrigger»),
#     а `$.input.padState(slot)` отдаёт снимок состояния;
#   * `rumble` на неподключённом слоте — честный `false`, без падения;
#   * навигация интерфейса геймпадом (`$.ui.gamepadNavigation`): d-pad/стик
#     ведут фокус с автоповтором, `A` подтверждает, `B` отменяет — через те же
#     клавиши, что читают экраны и виджеты.
#
# Запуск (после сборки):
#   python3 tests/agent/gamepad_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "hello")

#: Номера кнопок SDL3 (SDL_GamepadButton): A=0, B=1, X=2, dpdown=12, dpright=14.
SDL_A, SDL_B, SDL_DPDOWN, SDL_DPRIGHT = 0, 1, 12, 14
#: Номера осей SDL3: leftX=0, leftY=1, leftTrigger=4.
SDL_LEFTX, SDL_LEFTY, SDL_LEFTTRIGGER = 0, 1, 4


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code, default=None):
    try:
        return a.eval(code)
    except AgentError as exc:
        print("  --   eval не выполнился: %s" % str(exc).splitlines()[0][:140])
        return default


def pad(a, **kw):
    return a.cmd("pad", **kw)


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(3)

        # --- 1. Что уже есть: слоты, адресация, фронт vs удержание ------------
        check(ev(a, "$.debug.limits().gamepads_max") == 4, "слотов геймпада — четыре")
        check(ev(a, "typeof $.input.gamepad") == "function", "$.input.gamepad(slot) есть")
        for method in ("down", "pressed", "axis", "connected", "rumble"):
            check(ev(a, "typeof $.input.gamepad(0).%s" % method) == "function",
                  "у слота есть .%s()" % method)

        pad(a, slot=0, button="a", down=True)
        a.step(1)
        check(ev(a, "$.input.gamepad(0).down('a')") is True,
              "инъекция кнопки по имени SDL: 'a' удерживается")
        check(ev(a, "$.input.gamepad(0).pressed('a')") is True,
              "в кадре нажатия pressed('a') — фронт")
        a.step(1)
        check(ev(a, "$.input.gamepad(0).down('a')") is True
              and ev(a, "$.input.gamepad(0).pressed('a')") is False,
              "на следующем кадре удержание есть, фронта нет")
        pad(a, slot=0, button="a", down=False)
        a.step(1)
        check(ev(a, "$.input.gamepad(0).down('a')") is False, "кнопка отпущена")

        # --- 2. Мёртвая зона осей ---------------------------------------------
        check(abs(ev(a, "$.input.deadzone()") - 0.2) < 1e-9,
              "мёртвая зона по умолчанию 0.2 (%s)" % ev(a, "$.input.deadzone()"))
        pad(a, slot=0, axis=SDL_LEFTX, value=0.1)
        a.step(1)
        check(ev(a, "$.input.padAxis(0)") > 0.09,
              "сырая ось видна как есть (%.3f)" % ev(a, "$.input.padAxis(0)"))
        check(ev(a, "$.input.vec('wasd').x") == 0,
              "в движении ось ниже мёртвой зоны не учитывается")
        pad(a, slot=0, axis=SDL_LEFTX, value=0.2)
        a.step(1)
        check(abs(ev(a, "$.input.vec('wasd').x") - 0.2) < 1e-6,
              "значение ровно на пороге проходит (%.4f)" % ev(a, "$.input.vec('wasd').x"))
        ev(a, "$.input.deadzone(0.5)")
        a.step(1)
        check(ev(a, "$.input.vec('wasd').x") == 0,
              "поднятая мёртвая зона (0.5) гасит ось 0.2")
        ev(a, "$.input.deadzone(0.2)")
        pad(a, slot=0, axis=SDL_LEFTX, value=0)

        # --- 3. Триггеры 0..1 и круглый стик ----------------------------------
        pad(a, slot=0, axis="leftTrigger", value=0.75)
        a.step(1)
        lt = ev(a, "$.input.gamepad(0).axis('leftTrigger')")
        check(0.74 < lt <= 1.0, "курок — ось 0..1, а не −1..1 (%.3f)" % lt)
        pad(a, slot=0, axis="leftTrigger", value=0)
        # Круглый стик: диагональ не должна давать длину √2 в vec().
        pad(a, slot=0, axis=SDL_LEFTX, value=1.0)
        pad(a, slot=0, axis=SDL_LEFTY, value=1.0)
        a.step(1)
        vec = ev(a, "$.input.vec('nowasd')") or {}
        length = (vec.get("x", 0) ** 2 + vec.get("y", 0) ** 2) ** 0.5
        check(abs(length - 1.0) < 1e-6,
              "диагональ стика нормируется до длины 1 (%.6f)" % length)
        pad(a, slot=0, axis=SDL_LEFTX, value=0)
        pad(a, slot=0, axis=SDL_LEFTY, value=0)

        # --- 4. Четыре слота независимы ---------------------------------------
        pad(a, slot=0, button="a", down=True)
        pad(a, slot=1, button="b", down=True)
        pad(a, slot=3, button="x", down=True)
        a.step(1)
        state = {
            "s0a": ev(a, "$.input.gamepad(0).down('a')"),
            "s1a": ev(a, "$.input.gamepad(1).down('a')"),
            "s1b": ev(a, "$.input.gamepad(1).down('b')"),
            "s3x": ev(a, "$.input.gamepad(3).down('x')"),
            "s2b": ev(a, "$.input.gamepad(2).down('b')"),
        }
        check(state["s0a"] and state["s1b"] and state["s3x"] and not state["s1a"]
              and not state["s2b"],
              "слоты независимы: %s" % state)
        # Одна и та же кнопка на двух падах — два своих фронта.
        pad(a, slot=0, button="a", down=False)
        pad(a, slot=1, button="b", down=False)
        a.step(1)
        pad(a, slot=0, button="y", down=True)
        pad(a, slot=1, button="y", down=True)
        a.step(1)
        check(ev(a, "$.input.gamepad(0).pressed('y')") is True
              and ev(a, "$.input.gamepad(1).pressed('y')") is True,
              "одинаковая кнопка на двух слотах даёт два независимых фронта")

        # --- 5. Залипание: сброс слота снимает и удержание, и фронт -----------
        # Сначала отпускаем всё, что нажали выше: проверка «залипших» должна
        # начинаться с чистого состояния.
        for slot in (0, 1, 2, 3):
            pad(a, slot=slot, reset=True)
        a.step(1)
        stuck_before = ev(a, "$.input.stuck()")
        held_before = ev(a, "$.input.device(0).held()")
        pad(a, slot=0, button="y", down=True)      # держим в момент «отключения»
        a.step(1)
        check(ev(a, "$.input.device(0).held()") == [3],
              "удержание видно слою устройств (%s)" % ev(a, "$.input.device(0).held()"))
        pad(a, slot=0, reset=True)                 # то же состояние, что при отключении
        pad(a, slot=1, reset=True)
        a.step(1)
        after = {
            "s0_y": ev(a, "$.input.gamepad(0).down('y')"),
            "s0_pressed": ev(a, "$.input.gamepad(0).pressed('y')"),
            "s1_y": ev(a, "$.input.gamepad(1).down('y')"),
            "held": ev(a, "$.input.device(0).held()"),
            "stuck": ev(a, "$.input.stuck()"),
        }
        check(after["s0_y"] is False and after["s0_pressed"] is False
              and after["s1_y"] is False,
              "после сброса кнопка не «залипла»: %s" % after)
        check(after["held"] == [] and after["stuck"] == [],
              "слой устройств чист: held=%s, stuck=%s" % (after["held"], after["stuck"]))
        check(stuck_before == [] and held_before is not None,
              "до сброса «залипших» кнопок тоже не было (stuck=%s)" % stuck_before)
        # Явный сброс удержаний игрой: существующий API.
        check(ev(a, "typeof $.input.resetHeld") == "function",
              "$.input.resetHeld(slot) — сброс удержаний (существующее имя)")
        pad(a, slot=0, button="a", down=True)
        a.step(1)
        ev(a, "$.input.resetHeld(0)")
        check(ev(a, "$.input.device(0).held()") == [],
              "resetHeld(0) чистит удержания слоя устройств")

        # --- 6. Снимок состояния и честная адресация --------------------------
        pad(a, slot=0, reset=True)
        pad(a, slot=0, button="dpup", down=True)
        a.step(1)
        st = ev(a, "$.input.padState(0)") or {}
        check(st.get("down") == ["dpup"] and st.get("pressed") == ["dpup"],
              "padState(0) называет кнопку по имени: %s" % st.get("down"))
        check(st.get("connected") is False and st.get("virtual") is True,
              "снимок честно различает «подключён» и «инъекция»: %s"
              % {k: st.get(k) for k in ("connected", "virtual")})
        check(len(st.get("axes") or {}) == 6 and st.get("held") == [11],
              "в снимке шесть осей и удержание по номеру: %s" % st.get("axes"))
        check(ev(a, "$.input.padState(0).slot") == 0, "padState знает свой слот")
        pad(a, slot=0, reset=True)
        a.step(1)

        # --- 7. Rumble на неподключённом слоте --------------------------------
        rumble = ev(a, "$.input.gamepad(0).rumble({ low: 0.5, high: 0.5 })")
        check(rumble is False, "rumble на неподключённом слоте — честный false (%s)" % rumble)
        check(ev(a, "$.input.gamepad(3).rumble({})") is False, "и на пустом четвёртом слоте")
        check(ev(a, "$.input.rumble()") is False, "$.input.rumble() без геймпада — false")
        check(ev(a, "typeof $.input.rumbleSupported") == "function"
              and ev(a, "$.input.rumbleSupported()") is False,
              "rumbleSupported() честно говорит, что вибрировать некому")

        # --- 8. Навигация интерфейса геймпадом --------------------------------
        ev(a, "$.store.set('uiClicks', 0);"
               "['nav1','nav2','nav3'].forEach((id, i) => {"
               "  $('<ui.button>', { id: id, text: 'K' + i }).at(200 + i * 160, 300)"
               "    .size(120, 44).appendTo($.ui)"
               "    .on('click', () => $.store.set('uiClicks', $.store.get('uiClicks') + 1));"
               "});"
               # Журнал того, что видит ИГРА в кадре: геймпад обязан
               # превращаться в те же клавиши, что и клавиатура. Слушатель
               # 'key' не годится — он смотрит только настоящие клавиши SDL.
               "$.store.set('keys', []);"
               "$.update(() => {"
               "  const seen = $.store.get('keys');"
               "  const add = (n) => { if ($.input.pressed(n)) seen.push(n); };"
               "  add('down'); add('up'); add('left'); add('right');"
               "  add('tab'); add('enter'); add('escape');"
               "  if ($.input.down('lshift')) seen.push('shift');"
               "  $.store.set('keys', seen);"
               "});"
               "'ok'")
        a.step(2)
        check(ev(a, "$.ui.gamepadNavigation()") is False,
              "по умолчанию навигация геймпадом выключена")
        ev(a, "$.ui.gamepadNavigation(true, { repeatDelay: 0.1, repeatRate: 0.1 })")
        check(ev(a, "$.ui.gamepadNavigation()") is True, "включается одним вызовом")
        check(ev(a, "$.ui.focusedId()") is None, "до ввода фокуса нет")

        pad(a, slot=0, button="dpdown", down=True)
        a.step(2)
        first = ev(a, "$.ui.focusedId()")
        pad(a, slot=0, button="dpdown", down=False)
        a.step(1)
        check(first is not None, "d-pad вниз ставит фокус на контрол (%s)" % first)
        pad(a, slot=0, button="dpdown", down=True)
        a.step(2)
        pad(a, slot=0, button="dpdown", down=False)
        a.step(1)
        check(ev(a, "$.ui.focusedId()") != first,
              "следующее нажатие ведёт фокус дальше (%s → %s)"
              % (first, ev(a, "$.ui.focusedId()")))
        check("tab" in (ev(a, "$.store.get('keys')") or []),
              "обход контролов ушёл клавишей Tab — тем же механизмом, что у "
              "клавиатуры: %s" % ev(a, "$.store.get('keys')"))

        # Автоповтор: держим вниз ~0.5 с (repeatDelay 0.1 + repeatRate 0.1).
        pad(a, slot=0, button="dpdown", down=True)
        a.step(30)
        pad(a, slot=0, button="dpdown", down=False)
        a.step(1)
        moved = (ev(a, "$.store.get('keys')") or []).count("tab")
        check(moved >= 4, "автоповтор даёт больше четырёх шагов за 30 кадров (%d)" % moved)

        # A = подтвердить: клик по кнопке в фокусе.
        ev(a, "$.ui.focus('#nav2'); $.store.set('uiClicks', 0)")
        pad(a, slot=0, button="a", down=True)
        a.step(2)
        pad(a, slot=0, button="a", down=False)
        check(ev(a, "$.store.get('uiClicks')") == 1,
              "A подтверждает: клик по кнопке в фокусе (%s)" % ev(a, "$.store.get('uiClicks')"))
        check("enter" in (ev(a, "$.store.get('keys')") or []),
              "подтверждение ушло клавишей Enter/Return: %s"
              % ev(a, "$.store.get('keys')"))

        # B = отмена. Наблюдаем по экрану: `tickScreen` читает Escape раньше
        # виджетов (те гасят его как «назад» — это тоже работа, но увидеть её
        # снаружи нельзя: `$.input.consume` скрывает нажатие от остальных).
        ev(a, "$.screen.define('gp_menu', { anchor: 'center', gap: 10, rows: ["
               "{ id: 'gp1', text: 'Раз' }, { id: 'gp2', text: 'Два' },"
               "{ id: 'gp3', text: 'Три' } ] });"
               "$.screen.open('gp_menu'); 'ok'")
        a.step(2)
        check(ev(a, "$.screen.isOpen()") is True, "экран открылся")
        screen_focus = ev(a, "$.screen.focused()")
        pad(a, slot=0, button="dpdown", down=True)
        a.step(2)
        pad(a, slot=0, button="dpdown", down=False)
        a.step(1)
        check(ev(a, "$.screen.focused()") != screen_focus,
              "на экране d-pad ведёт его собственный фокус (%s → %s)"
              % (screen_focus, ev(a, "$.screen.focused()")))
        pad(a, slot=0, button="b", down=True)
        a.step(2)
        pad(a, slot=0, button="b", down=False)
        a.step(1)
        check(ev(a, "$.screen.isOpen()") is False, "B закрывает экран (Escape дошёл)")

        # Обратный обход: вверх = Shift+Tab, фокус уходит назад.
        ev(a, "$.ui.focus('#nav2'); $.store.set('keys', [])")
        pad(a, slot=0, button="dpup", down=True)
        a.step(2)
        pad(a, slot=0, button="dpup", down=False)
        a.step(1)
        check(ev(a, "$.ui.focusedId()") == "nav1",
              "вверх ведёт фокус назад (%s)" % ev(a, "$.ui.focusedId()"))
        check("shift" in (ev(a, "$.store.get('keys')") or []),
              "обратный обход идёт с Shift, как Shift+Tab: %s"
              % ev(a, "$.store.get('keys')"))

        # Стик ведёт фокус так же, как d-pad.
        ev(a, "$.ui.focus('#nav1')")
        pad(a, slot=0, axis=SDL_LEFTY, value=0.9)
        a.step(2)
        stick_focus = ev(a, "$.ui.focusedId()")
        pad(a, slot=0, axis=SDL_LEFTY, value=0)
        a.step(1)
        check(stick_focus == "nav2",
              "левый стик двигает фокус так же, как d-pad (%s)" % stick_focus)

        # Выключенная навигация не вмешивается.
        ev(a, "$.ui.gamepadNavigation(false); $.ui.focus('#nav1')")
        pad(a, slot=0, button="dpright", down=True)
        a.step(4)
        pad(a, slot=0, button="dpright", down=False)
        a.step(1)
        check(ev(a, "$.ui.focusedId()") == "nav1",
              "с выключенной навигацией фокус не двигается (%s)" % ev(a, "$.ui.focusedId()"))

        check(a.ping().get("pong") is True, "движок отвечает после всех проверок")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
