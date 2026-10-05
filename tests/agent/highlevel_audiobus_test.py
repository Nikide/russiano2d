#!/usr/bin/env python3
# ===========================================================================
# Тест аудио-шин и эффектов $.audio.
#
# Гоняет фикстуру tests/fixtures/audiobus и проверяет то, что делает
# JS-слой поверх C: дерево шин, effective gain с родителями/mute/solo,
# эффекты, запуск звука и жизненный цикл handle'ов, позиционное звучание
# и затухания. Звуковое устройство может быть недоступно — тест к нему не
# привязан: канал допустимо равен -1, важна логика шин.
#
# Запуск:
#   python3 tests/agent/highlevel_audiobus_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "audiobus")
SFX = "assets/audio/sfx/pickup_01.ogg"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- Пространство имён -------------------------------------------------
        check(a.eval("typeof $.audio") == "object", "$.audio доступно")
        check(a.eval("typeof $.sound.play") == "function", "$.sound не заменён")
        check(a.eval("typeof $.audio.bus") == "function", "$.audio.bus доступен")

        # --- Дерево шин --------------------------------------------------------
        names = a.eval("$.audio.buses().map(b => b.name).sort()")
        check(names == ["ambient", "music", "ui"], f"шины созданы: {names}")
        check(a.eval("$.audio.volume('music')") == 0.5, "громкость music = 0.5")
        check(a.eval("$.audio.volume('ui')") == 0.5, "громкость ui = 0.5")

        # --- Эффективная громкость по цепочке родителей ------------------------
        check(abs(a.eval("$.audio.gain('music')") - 0.5) < 1e-6, "gain(music) = 0.5")
        check(abs(a.eval("$.audio.gain('ui')") - 0.25) < 1e-6, "gain(ui) = 0.5 × 0.5")
        a.eval("$.audio.volume('music', 1)")
        check(abs(a.eval("$.audio.gain('ui')") - 0.5) < 1e-6, "после music=1 gain(ui) = 0.5")
        a.eval("$.audio.volume('music', 0.5)")

        # --- mute --------------------------------------------------------------
        a.eval("$.audio.mute('music', true)")
        check(a.eval("$.audio.gain('ui')") == 0, "mute родителя глушит ui")
        check(a.eval("$.audio.mute('music')") is True, "состояние mute читается")
        a.eval("$.audio.mute('music', false)")
        check(abs(a.eval("$.audio.gain('ui')") - 0.25) < 1e-6, "снятие mute возвращает громкость")

        # --- solo --------------------------------------------------------------
        a.eval("$.audio.solo('music', true)")
        check(a.eval("$.audio.gain('ambient')") == 0, "solo глушит постороннюю шину")
        check(abs(a.eval("$.audio.gain('ui')") - 0.25) < 1e-6, "потомок solo-шины слышен")
        check(abs(a.eval("$.audio.gain('music')") - 0.5) < 1e-6, "solo-шина слышна")
        a.eval("$.audio.solo('music', false)")
        check(abs(a.eval("$.audio.gain('ambient')") - 0.25) < 1e-6, "снятие solo возвращает ambient")

        # --- Эффекты -----------------------------------------------------------
        effects = a.eval("$.audio.effects()")
        check(isinstance(effects, list) and "lowpass" in effects and "echo" in effects,
              f"$.audio.effects() перечисляет движковые эффекты: {effects}")
        check(a.eval("$.audio.effect('ambient')") == "lowpass", "эффект шины читается")
        a.eval("$.audio.effect('ambient', 'echo', { delay: 300, feedback: 0.5 })")
        check(a.eval("$.audio.effect('ambient')") == "echo", "эффект шины меняется")
        a.eval("$.audio.effect('ambient', 'lowpass', { freq: 900 })")

        # --- Запуск звука и handle ---------------------------------------------
        a.eval(f"globalThis.__h = $.audio.play('{SFX}', {{ bus: 'ui', volume: 0.8 }})")
        check(a.eval("typeof __h") == "object", "play возвращает handle")
        check(a.eval("typeof __h.channel") == "number", "handle.channel — число (или -1)")
        check(a.eval("__h.bus") == "ui", "handle помнит шину")
        check(a.eval("typeof __h.playing()") == "boolean", "handle.playing() отвечает булевым")
        check(a.eval("$.audio.handles().length") >= 1, "handle виден в $.audio.handles()")
        a.eval("__h.stop()")
        check(a.eval("$.audio.handles().length") == 0, "stop убирает handle без утечки")

        # Каналы у handle'ов, запущенных в шину, пересчитываются на лету.
        a.eval(f"globalThis.__h = $.audio.play('{SFX}', {{ bus: 'ui', volume: 1 }})")
        before = a.eval("$.audio.handles().length")
        a.eval("$.audio.volume('ui', 0)")
        a.eval("$.audio.volume('ui', 0.5)")
        check(before == 1 and a.eval("$.audio.handles().length") == 1,
              "смена громкости шины не теряет живой звук")
        a.eval("__h.stop()")

        # --- Позиционное звучание ---------------------------------------------
        a.eval("$.audio.listener(0, 0)")
        check(a.eval("$.audio.listener().x") == 0, "слушатель задаётся вручную")
        a.eval(f"globalThis.__p = $.audio.playAt('{SFX}', 350, 0, "
               "{ volume: 1, falloff: { max: 700 } })")
        check(abs(a.eval("__p.pan()") - 1) < 1e-6, "источник справа даёт pan = 1")
        check(abs(a.eval("__p.volume()") - 0.5) < 1e-6, "на середине радиуса громкость 0.5")
        a.eval("__p.stop()")

        a.eval(f"globalThis.__f = $.audio.playAt('{SFX}', 0, 900, "
               "{ volume: 1, falloff: { max: 700 } })")
        check(a.eval("__f.volume()") == 0, "за границей слышимости громкость 0")
        a.eval("__f.stop()")

        # --- Затухания ---------------------------------------------------------
        a.eval("$.audio.bus('fade', { volume: 1 })")
        a.eval("$.audio.fadeBus('fade', 0, 200)")
        a.step(4)
        mid = a.eval("$.audio.volume('fade')")
        check(0 < mid < 1, f"fadeBus плавно уменьшает громкость (mid={mid:.3f})")
        a.step(30)
        check(a.eval("$.audio.volume('fade')") == 0, "fadeBus доводит шину до нуля")
        a.eval("$.audio.remove('fade')")

        # --- Прокси к $.sound --------------------------------------------------
        a.eval("$.audio.masterVolume(0.4)")
        check(abs(a.eval("$.audio.masterVolume()") - 0.4) < 0.01, "masterVolume проксируется")
        a.eval("$.audio.masterVolume(1)")
        a.eval("$.audio.sfxVolume(0.3)")
        check(abs(a.eval("$.audio.sfxVolume()") - 0.3) < 1e-6, "sfxVolume читается обратно")
        a.eval("$.audio.sfxVolume(1)")

        # --- Остановка всего ---------------------------------------------------
        a.eval(f"$.audio.play('{SFX}', {{ bus: 'ui' }})")
        a.eval(f"$.audio.play('{SFX}', {{ bus: 'music' }})")
        a.eval("$.audio.stopBus('ui', 0)")
        left = a.eval("$.audio.handles().length")
        check(left <= 1, f"stopBus останавливает звуки шины (осталось {left})")
        a.eval("$.audio.stopAll(0)")
        check(a.eval("$.audio.handles().length") == 0, "stopAll очищает список handle'ов")

        # --- Шина удаляется, дети переподчиняются ------------------------------
        a.eval("$.audio.bus('group', { volume: 0.5 })")
        a.eval("$.audio.bus('child', { volume: 0.5, parent: 'group' })")
        check(abs(a.eval("$.audio.gain('child')") - 0.25) < 1e-6, "gain(child) = 0.25")
        a.eval("$.audio.remove('group')")
        check(abs(a.eval("$.audio.gain('child')") - 0.5) < 1e-6, "child ушёл к master")
        a.eval("$.audio.clear()")
        check(a.eval("$.audio.buses().length") == 0, "clear снимает все шины")

        # --- Движок жив и ошибок нет -------------------------------------------
        a.step(2)
        check(a.eval("engine.frame") > 0, "кадры идут после операций с шинами")
        check(a.ping().get("pong") is True, "движок отвечает")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
