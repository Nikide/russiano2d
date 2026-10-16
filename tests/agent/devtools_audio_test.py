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
from agent_client import Agent, ROOT   # noqa: E402

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
              and safe(au["text"]["buses"]) == ui(a, doc, "rt-audio-buses"),
              "блоки info и шин в панели = данным audio()")
        # Каналов 128, поэтому панель показывает ЗАНЯТЫЕ и итог «занято N из M»
        # (простыня по всем не влезает в буфер engine.ui.getText — 8192 байта).
        # Проверяем не «показано всё», а что показанное = данным API.
        busy_channels = [c for c in au["channels"] if c["playing"]]
        panel_channels = ui(a, doc, "rt-audio-channels")
        head = panel_channels.split("\n")[0]
        check(head.startswith("занято %d из %d" % (len(busy_channels), len(au["channels"]))),
              "итог блока каналов = данным ($.sound.busy() → %s, всего %s): %r"
              % (busy["active"], busy["total"], head))
        shown_rows = [r for r in panel_channels.split("\n")[1:] if r.strip()]
        check(len(shown_rows) == min(len(busy_channels), 8),
              "построчно показаны только занятые каналы (%d из %d)"
              % (len(shown_rows), len(busy_channels)))
        check(all("свободен" not in r for r in shown_rows),
              "свободные каналы в панель не попадают (панель читается целиком)")
        check(len(panel_channels) < 8192,
              "payload блока каналов влезает в буфер getText (%d символов)" % len(panel_channels))

        # --- Живые каналы: панель обязана показывать то же, что API ----------
        # Занимаем каналы реально звучащим файлом фикстуры: до этого проверялась
        # форма итога на пустом пуле, и построчные строки были пусты.
        hit = os.path.join(ROOT, "tests", "fixtures", "lifecycle", "assets", "hit.wav")
        # $.sound.play(путь, …) сам подгружает файл при первом обращении
        # (engine.audio.load внутри soundId), отдельного load() у $.sound нет.
        played = a.eval("""(function(){
            var ids = [];
            for (var i = 0; i < 3; ++i) {
                ids.push($.sound.play(%r, { volume: 0.5 + 0.1 * i, pan: -0.5 + 0.5 * i,
                                            pitch: 1 + 0.1 * i, priority: 10 + i, loop: true }));
            }
            return ids;
        })()""" % hit)
        a.step(6)
        busy_live = a.eval("$.sound.busy()")
        check(busy_live["active"] >= 3,
              "три звука реально заняли каналы (active=%s, всего %s)"
              % (busy_live["active"], busy_live["total"]))
        check(len([x for x in played if x is not None and x >= 0]) == 3,
              "play() вернул id каналов (%s)" % played)
        panel_ch = ui(a, doc, "rt-audio-channels")
        head = panel_ch.split("\n")[0]
        check(head.startswith("занято %d из %d" % (busy_live["active"], busy_live["total"])),
              "итог = $.sound.busy().active (%r)" % head)
        rows = [r for r in panel_ch.split("\n")[1:] if r.strip()]
        check(len(rows) == min(busy_live["active"], 8),
              "построчных строк ровно min(занятых, 8): %d" % len(rows))
        ch_api = [c for c in a.eval("$.devtools.audio()")["channels"] if c["playing"]]
        check(len(ch_api) >= 1, "audio().channels отдаёт занятые каналы (%d)" % len(ch_api))
        first = ch_api[0]
        check(("канал %d: играет" % first["index"]) in panel_ch,
              "строка первого занятого канала в панели (канал %d)" % first["index"])
        check(abs(first["volume"] - 0.5) < 0.05 or abs(first["volume"] - 0.6) < 0.05
              or abs(first["volume"] - 0.7) < 0.05,
              "громкость занятого канала из API = заданной (%.2f)" % first["volume"])

        # --- Граница компактности: занятых больше, чем строк ------------------
        a.eval("""(function(){
            for (var i = 0; i < 9; ++i) {
                $.sound.play(%r, { volume: 0.3, priority: 1, loop: true });
            }
        })()""" % hit)
        a.step(6)
        busy9 = a.eval("$.sound.busy()")
        panel9 = ui(a, doc, "rt-audio-channels")
        rows9 = [r for r in panel9.split("\n")[1:] if r.strip()]
        check(busy9["active"] >= 9, "занято 9+ каналов (active=%s)" % busy9["active"])
        check(rows9 and len(rows9) <= 8, "строк всё равно не больше 8 (%d)" % len(rows9))
        check(panel9.split("\n")[0].startswith("занято %d из %d" % (busy9["active"], busy9["total"])),
              "итог показывает реальное число занятых, а не число строк (%r)"
              % panel9.split("\n")[0])

        # --- 100+ занятых: блок обязан влезать в буфер getText ----------------
        a.eval("""(function(){
            for (var i = 0; i < 128; ++i) {
                $.sound.play(%r, { volume: 0.2, priority: 2, loop: true });
            }
        })()""" % hit)
        a.step(8)
        busy_many = a.eval("$.sound.busy()")
        panel_many = ui(a, doc, "rt-audio-channels")
        print("       занято %s из %s, блок каналов %d символов"
              % (busy_many["active"], busy_many["total"], len(panel_many)))
        check(busy_many["active"] >= 100,
              "занято 100+ каналов (active=%s)" % busy_many["active"])
        check(panel_many.split("\n")[0].startswith("занято %d из %d"
                                                   % (busy_many["active"], busy_many["total"])),
              "итог верен и при 100+ занятых (%r)" % panel_many.split("\n")[0])
        check(len(panel_many) < 8192,
              "блок влезает в буфер getText при 100+ занятых (%d символов)" % len(panel_many))
        check(len(panel_many.split("\n")) - 1 <= 8,
              "строк не больше 8 и при 100+ занятых")
        a.eval("$.sound.stopAll ? $.sound.stopAll() : null")
        a.step(4)

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
