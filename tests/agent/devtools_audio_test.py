#!/usr/bin/env python3
# ===========================================================================
# DevTools §29: вкладки AUDIO и INPUT — панель показывает те же факты, что API.
#
# AUDIO: голоса ($.sound.busy), каналы ($.sound.channel), шины ($.audio.buses),
# mute/solo/громкость — включая кнопки панели. INPUT: действия и привязки,
# что нажато сейчас, конфликты привязок ($.input.conflicts), ожидания,
# устройства и залипшие клавиши.
#
# Запуск после сборки:
#   python3 tests/agent/devtools_audio_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ui(a, doc, element_id):
    raw = a.eval("engine.ui.getText(%s,%r)" % (doc, element_id)) or ""
    return (raw.replace("&quot;", '"').replace("&lt;", "<")
               .replace("&gt;", ">").replace("&amp;", "&"))


def safe(text):
    return text.replace("<", "\u2039").replace(">", "\u203a")


def click(a, doc, element_id):
    r = a.eval("engine.ui.rect(%s,%r)" % (doc, element_id))
    a.mouse_move(x=r["x"] + r["w"] / 2, y=r["y"] + r["h"] / 2)
    a.step(3)
    a.mouse(button=1, action="click")
    a.step(3)


def main():
    with Agent(game=GAME, seed=17, fixed_dt=1.0 / 60.0) as a:
        a.step(5)
        check(a.eval("$.devtools.openRuntime()") is True, "панель F1 открылась документом RmlUi")
        doc = a.eval("$.devtools.runtimePanel().doc")

        # --- §29 AUDIO ---------------------------------------------------------
        click(a, doc, "rt-tab-audio")
        check(a.eval("$.devtools.tabName()") == "audio", "клик открыл вкладку AUDIO")
        a.eval("$.audio.bus('sfx-test', { volume: 0.8 })")
        a.step(5)
        au = a.eval("$.devtools.audio()")
        busy = a.eval("$.sound.busy()")
        check(au["busy"]["total"] == busy["total"] and au["busy"]["active"] == busy["active"],
              "голоса = $.sound.busy() (%s из %s)" % (busy["active"], busy["total"]))
        check(len(au["channels"]) == busy["total"],
              "каналы перечислены все (%s)" % len(au["channels"]))
        check(all(c["playing"] is False for c in au["channels"]),
              "свободные каналы честно показаны свободными")
        check(abs(au["master"] - a.eval("$.audio.getMasterVolume()")) < 1e-9,
              "мастер-громкость = $.audio.getMasterVolume()")
        check(abs(au["sfx"] - a.eval("$.audio.sfxVolume()")) < 1e-9,
              "sfx-громкость = $.audio.sfxVolume()")
        names = [b["name"] for b in au["buses"]]
        check("sfx-test" in names, "шина sfx-test видна (buses(): %s)" % names)
        bus = [b for b in au["buses"] if b["name"] == "sfx-test"][0]
        check(abs(bus["volume"] - 0.8) < 1e-6, "громкость шины 0.8 из $.audio.buses()")
        check(safe(au["text"]["info"]) == ui(a, doc, "rt-audio-info")
              and safe(au["text"]["buses"]) == ui(a, doc, "rt-audio-buses")
              and safe(au["text"]["channels"]) == ui(a, doc, "rt-audio-channels"),
              "все блоки AUDIO в панели = данным audio()")

        # mute шины через API и кнопку панели
        check(a.eval("$.devtools.audioBus('mute', 'sfx-test', true)") is True,
              "DevTools умеет глушить шину")
        a.step(3)
        check(a.eval("$.audio.mute('sfx-test')") is True, "движок подтвердил mute шины")
        check("mute да" in ui(a, doc, "rt-audio-buses"), "mute виден в панели")
        a.eval("$.devtools.audioBus('mute', 'sfx-test', false)")
        a.step(3)
        check(a.eval("$.audio.mute('sfx-test')") is False, "mute снят")
        a.eval("engine.ui.setValue(%s,'rt-audio-bus','sfx-test')" % doc)
        click(a, doc, "rt-audio-bussolo")
        check(a.eval("$.audio.solo('sfx-test')") is True, "кнопка Solo включила solo шины")
        a.eval("$.devtools.audioBus('solo', 'sfx-test', false)")

        # mute всего звука кнопкой
        before = a.eval("$.sound.mute()")
        click(a, doc, "rt-audio-mute")
        check(a.eval("$.sound.mute()") != before, "кнопка Mute переключила общий mute звука")
        click(a, doc, "rt-audio-mute")
        check(a.eval("$.sound.mute()") == before, "повторный клик вернул состояние")

        # стоп канала: свободный канал честно не «останавливается»
        a.eval("engine.ui.setValue(%s,'rt-audio-ch','0')" % doc)
        check(a.eval("$.devtools.audioStop(0)") is False,
              "стоп свободного канала — честное false, а не выдуманный успех")
        check(a.eval("$.devtools.audioStop(999)") is False, "несуществующий канал отклонён")

        # --- §29 INPUT ---------------------------------------------------------
        click(a, doc, "rt-tab-input")
        check(a.eval("$.devtools.tabName()") == "input", "клик открыл вкладку INPUT")
        a.eval("$.input.bind('jump', ['Space']); $.input.bind('fire', ['Space']);"
               " $.input.bind('left', ['A'])")
        a.step(5)
        inp = a.eval("$.devtools.input()")
        check(len(inp["actions"]) == 3 and "jump" in inp["actions"],
              "действия перечислены (%s)" % inp["actions"])
        check(len(inp["conflicts"]) == 2 and
              {c["action"] for c in inp["conflicts"]} == {"jump", "fire"},
              "конфликт Space между jump и fire найден через $.input.conflicts")
        check(inp["waiters"] == [] and inp["stuck"] == [],
              "ожиданий и залипших клавиш нет — панель так и говорит")
        check(len(inp["devices"]) == a.eval("$.input.padSlots()"),
              "устройства перечислены по слотам (%s)" % len(inp["devices"]))
        check(safe(inp["text"]["info"]) == ui(a, doc, "rt-input-info")
              and safe(inp["text"]["actions"]) == ui(a, doc, "rt-input-actions")
              and safe(inp["text"]["issues"]) == ui(a, doc, "rt-input-issues"),
              "все блоки INPUT в панели = данным input()")
        check("конфликты привязок: 2" in ui(a, doc, "rt-input-issues"),
              "конфликты видны в панели")

        # Нажатая клавиша: панель показывает фронт/удержание.
        a.key("A", "down")
        a.step(3)
        inp = a.eval("$.devtools.input()")
        check(a.eval("$.input.describe('left')")["down"] is True, "клавиша A удерживается")
        check("нажато: да" in inp["text"]["actions"], "удержание видно в панели")
        a.key("A", "up")
        a.step(3)
        check("нажато: нет" in a.eval("$.devtools.input()")["text"]["actions"],
              "после отпускания панель снова показывает «нет»")

        a.eval("$.input.unbind('jump'); $.input.unbind('fire'); $.input.unbind('left')")
        a.eval("$.devtools.closeRuntime()")
        a.step(3)
        check(a.eval("$('#hero').pos().x") == 100, "игра продолжает работать")

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
