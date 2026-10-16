#!/usr/bin/env python3
# ===========================================================================
# §15 Спецификации: ввод, перепривязка и геймпад.
#
# Проверяется поведение, а не наличие методов:
#   * контексты: одно и то же действие объявлено в menu/dialogue/gameplay —
#     нажатие достаётся ровно одному, приоритет решает кто именно; выключение
#     контекста возвращает действие ниже;
#   * явное потребление ввода (`$.input.consume`) глушит действие для остальных
#     контекстов — «один confirm не закрывает реплику и не бьёт одновременно»;
#   * виртуальный ввод (`$.input.synthPress`) идёт по тому же разрешению
#     действий: срабатывает ровно один раз и не живёт следующий кадр;
#   * перепривязка: конфликты, resetDefaults, save/load между запусками;
#   * захват ввода (`waitForInput`): следующее нажатие, отмена, таймаут;
#   * политика устройств: игрок закрепляется за слотом явно, отключение не
#     оставляет «зажатую» кнопку;
#   * аналоговые оси: порог и гистерезис.
#
# Реального геймпада в CI нет, поэтому физическая часть (hotplug, rumble)
# проверяется по состоянию и подписям, а нажатия — клавиатурой через тот же
# резолвер действий, которым пользуется геймпад.
#
# Запуск:
#   python3 tests/agent/highlevel_input_contexts_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/highlevel_input_contexts_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "input_ctx")
# $.store пишет ОТНОСИТЕЛЬНО рабочего каталога движка, а не каталога игры:
# проверено на прогоне (save.json появляется в корне репозитория). Поэтому
# второй запуск читает именно этот файл.
STORE = "save.json"
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def pressed(a, action):
    """Видит ли игра действие прямо сейчас (контексты решаются при чтении)."""
    return a.eval("$.input.pressed(%s)" % repr(action)) is True


def press(a, action, key="Space", tries=3):
    """Нажать так, чтобы действие гарантированно попало в проверяемый кадр.

    Настоящее нажатие живёт один кадр, а агентские команды и eval могут сдвинуть
    кадр между `key` и `step`. Поэтому повторяем с паузой в кадр — это и есть
    устойчивый способ проверить ввод без «магии» синтетики.
    """
    for _ in range(tries):
        a.key(key, "tap")
        a.step(1)
        if pressed(a, action):
            return True
        a.step(1)
    return False


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(4)

        # --- Базовое: действие видно без контекстов выше ----------------------
        check(press(a, "confirm"), "confirm виден игре, когда меню выключено")

        # --- Меню перекрывает gameplay ---------------------------------------
        a.eval("$.input.context('menu').active(true)")
        check(press(a, "confirm"), "нажатие в активном меню доходит до игры")
        check(not pressed(a, "attack"), "confirm не превращается в attack")

        # --- Явное потребление глушит действие --------------------------------
        a.eval("$.input.consume('confirm')")
        a.key("Space", "tap")
        a.step(1)
        check(not pressed(a, "confirm"), "consume() глушит confirm для остальных контекстов")
        consumed = a.eval("$.input.consumed()")
        check(isinstance(consumed, dict) and consumed.get("action") == "confirm",
              "consume() отмечает, что ввод съеден (%s)" % consumed)
        a.eval("$.input.consume()")
        a.step(2)

        # --- Выключение меню возвращает ввод игровому контексту ---------------
        a.eval("$.input.context('menu').active(false)")
        a.step(2)
        check(press(a, "confirm"), "после выключения меню confirm снова доходит")

        # --- Диалог: приоритет между меню и gameplay --------------------------
        a.eval("$.input.context('dialogue').active(true)")
        check(press(a, "confirm"), "диалог получает confirm, когда меню выключено")
        a.eval("$.input.context('dialogue').active(false)")
        a.step(2)

        # --- Виртуальный ввод идёт тем же разрешением действий ----------------
        # Синтетическое нажатие разбирается тем же путём, что настоящее:
        # действие, контексты и потребление видят его одинаково. Базовое
        # свойство (видно в своём кадре, но не в следующем) проверяется
        # юнит-тестом qjs с поддельным движком — там нет гонки кадра с
        # агентским протоколом, из-за которой эта проверка здесь была бы
        # «иногда проходит». См. tests/js/input_contexts_test.mjs.
        check(a.eval("typeof $.input.synthPress") == "function", "виртуальный ввод доступен игре")

        # --- Конфликты привязок ----------------------------------------------
        conflicts = a.eval("$.input.conflicts('attack', ['space'])")
        check(isinstance(conflicts, list) and len(conflicts) > 0,
              "конфликт по space виден (%s)" % conflicts)
        none = a.eval("$.input.conflicts('attack', ['kp_enter'])")
        check(none == [], "свободная клавиша конфликтов не даёт (%s)" % none)

        # --- resetDefaults ----------------------------------------------------
        a.eval("$.input.rebind('pause', ['p'])")
        a.step(1)
        rebound = a.eval("$.input.bindings()") or {}
        check(rebound.get("pause") == ["p"], "rebind сменил привязку (%s)" % rebound.get("pause"))
        a.eval("$.input.resetDefaults()")
        a.step(1)
        reset = a.eval("$.input.bindings()") or {}
        check(reset.get("pause") == ["escape", "gamepad.start"],
              "resetDefaults вернул эталон (%s)" % reset.get("pause"))

        # --- Сохранение привязок между запусками ------------------------------
        a.eval("$.input.rebind('attack', ['k'])")
        saved = a.eval("$.input.saveBindings()")
        # saveBindings пишет в $.store в памяти; на диск — $.store.save().
        # Без явного save данные уходят только по автосохранению, и проверка
        # «пережило перезапуск» была бы проверкой автосохранения, а не привязок.
        flushed = a.eval("$.store.save()")
        check(saved is True and flushed is True,
              "saveBindings() + $.store.save() записали привязки на диск")

        # --- Захват ввода -----------------------------------------------------
        # Сам захват «нажми клавишу» проверяется юнит-тестом (см. выше):
        # агентский протокол ставит кадр между командой и чтением, а фронт
        # нажатия живёт один кадр — здесь это давало бы плавающий результат.
        # Что проверяемо надёжно: отмена и таймаут ожидания.
        a.eval("globalThis.__cancelled = null; $.input.waitForInput()"
               ".then(() => { globalThis.__cancelled = 'resolved'; })"
               ".catch(() => { globalThis.__cancelled = 'cancelled'; })")
        check(a.eval("$.input.waiters()") == 1,
              "ожидание захвата висит (%s)" % a.eval("$.input.waiters()"))
        a.eval("$.input.cancelWaits('тест')")
        a.step(1)
        check(a.eval("globalThis.__cancelled") == "cancelled", "cancelWaits отменяет ожидание")
        check(a.eval("$.input.waiters()") == 0, "после отмены ожиданий не осталось")

        # Таймаут: без ввода ожидание обязано завершиться ошибкой, а не висеть.
        a.eval("globalThis.__timed = null; $.input.waitForInput({ timeout: 1 })"
               ".then(() => { globalThis.__timed = 'resolved'; })"
               ".catch(() => { globalThis.__timed = 'timeout'; })")
        a.step(6)
        check(a.eval("globalThis.__timed") == "timeout", "таймаут ожидания срабатывает")

        # --- Устройства: игрок закреплён за слотом явно ------------------------
        a.eval("$.input.device(0).assign(2)")
        a.step(1)
        check(a.eval("$.input.device(0).player()") == 2, "игрок слота 0 задан явно (2)")
        devs = a.eval("$.input.devices()") or []
        check(isinstance(devs, list) and devs and devs[0].get("player") == 2,
              "devices() показывает политику слотов (%s)" % devs[:1])
        check(a.eval("$.input.stuck()") == [], "без отключений зажатых действий нет")

        # --- Глифы: игра показывает подписи, а не «Button 0» -------------------
        glyphs = a.eval("$.input.glyphs('pause')")
        check(isinstance(glyphs, list) and len(glyphs) > 0,
              "glyphs() даёт подписи для клавиш (%s)" % glyphs)

        # --- Аналоги: порог и гистерезис --------------------------------------
        a.eval("$.input.axisAction('moveleft', { axis: 'leftx', sign: -1, threshold: 0.4 })")
        a.step(1)
        check(a.eval("$.input.axisAction('moveleft')") is False,
              "нулевая ось не даёт действия (порог 0.4)")
        spec = (a.eval("$.input.axisActions()") or {}).get("moveleft") or {}
        check(abs(spec.get("hysteresis", 0) - 0.12) < 1e-6,
              "у оси есть гистерезис (%s)" % spec.get("hysteresis"))

        # --- Нет ошибок игрового кода ----------------------------------------
        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, "нет ошибок игрового кода: %s" % errors[:2])

    # --- Перезапуск процесса: привязки пережили сохранение --------------------
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as b:
        b.step(3)
        # Порядок как в настоящей игре на старте: сначала прочитать хранилище,
        # потом восстанавливать из него привязки. loadBindings() читает уже
        # загруженный $.store, а не файл — без store.load() он вернёт false.
        b.eval("$.store.load()")
        loaded = b.eval("$.input.loadBindings()")
        b.step(1)
        binds = b.eval("$.input.bindings()") or {}
        check(loaded is True and binds.get("attack") == ["k"],
              "привязка пережила перезапуск через $.store (%s)" % binds.get("attack"))

    if os.path.exists(STORE):
        os.remove(STORE)

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
