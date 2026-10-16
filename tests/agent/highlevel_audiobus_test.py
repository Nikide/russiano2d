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

        # --- DSP-эффекты: список из движка и реверб-шина с посылом -------------
        # Раньше кроме lowpass и echo эффектов не было, а реверб был один на
        # весь микс. Теперь список знает фильтры, тремоло, bitcrush, кольцевую
        # модуляцию и реверб, а у шины может быть свой хвост с посылом.
        effects = a.eval("$.audio.effects()")
        check(isinstance(effects, list), "effects() отдаёт список")
        for name in ("lowpass", "highpass", "echo", "tremolo", "bitcrush", "ringmod", "reverb"):
            check(name in (effects or []), "в списке эффектов есть '%s'" % name)

        a.eval("$.audio.bus('fx', { volume: 0.5 }); 'ok'")
        a.eval("$.audio.effect('fx', 'highpass', { freq: 400 }); 'ok'")
        check(a.eval("$.audio.effect('fx')") == "highpass", "highpass доехал до движка")
        a.eval("$.audio.effect('fx', 'tremolo', { rate: 6, depth: 0.8 }); 'ok'")
        check(a.eval("$.audio.effect('fx')") == "tremolo", "tremolo доехал до движка")
        a.eval("$.audio.effect('fx', 'bitcrush', { bits: 4, downsample: 2 }); 'ok'")
        check(a.eval("$.audio.effect('fx')") == "bitcrush", "bitcrush доехал до движка")
        a.eval("$.audio.effect('fx', 'ringmod', { freq: 300, mix: 0.5 }); 'ok'")
        check(a.eval("$.audio.effect('fx')") == "ringmod", "ringmod доехал до движка")

        a.eval("$.audio.effect('fx', 'reverb', { send: 0.45, room: 0.7 }); 'ok'")
        check(a.eval("$.audio.effect('fx')") == "reverb", "реверб-шина включилась")

        # Полные параметры хвоста: send — посыл, room/damp/width — сам хвост.
        check(a.eval("engine.audio.setGroupReverb(0, 0.3, 0.6, 0.2, 0.9)") in (True, False),
              "setGroupReverb отвечает булевым")
        check(a.eval("engine.audio.setChannelReverb(0, 0.5, 0.6, 0.4, 0.8)") in (True, False),
              "setChannelReverb отвечает булевым")
        check(a.eval("engine.audio.channelEffect(0)") in ("none", "reverb", "lowpass", "echo"),
              "состояние канала читается обратно")

        a.eval("$.audio.effect('fx', 'none'); 'ok'")
        check(a.eval("$.audio.effect('fx')") == "none", "эффект шины выключается")

        # --- §48: изоляция шинных эффектов -------------------------------------
        # Сухой звук на шине БЕЗ эффекта не должен окрашиваться шиной с
        # ревербом: эффект живёт на группе микшера и на канал не дублируется.
        # Общую комнату микса выключаем явно — она по определению красит всё,
        # и её наличие видно в $.audio.routes().globalRoomWet.
        # ВАЖНО: акустика ($.audio.acoustics) применяет комнату КАЖДЫЙ кадр,
        # поэтому для шинной изоляции её надо выключить явно — иначе общая
        # комната окрасит и «сухую» шину (это факт, а не догадка: его видно
        # в $.audio.routes().warnings).
        a.eval("$.audio.acoustics(false); $.audio.room({ wet: 0 }); true")
        a.step(2)
        check(a.eval("$.audio.routes().globalRoomWet") is False,
              "общая комната микса выключена (для изоляции шин)")

        a.eval("$.audio.clear(); true")
        a.eval("$.audio.bus('ui', { volume: 0.8 });"
               "$.audio.bus('ambience', { volume: 1, effect: 'reverb', effectParams: { send: 0.5 } }); true")
        dry_ch = a.eval("$.audio.play('%s', { bus: 'ui', volume: 1, pan: -0.5 }).channel" % SFX)
        wet_ch = a.eval("$.audio.play('%s', { bus: 'ambience', volume: 1 }).channel" % SFX)
        a.step(2)
        check(dry_ch is not None and dry_ch >= 0 and wet_ch is not None and wet_ch >= 0,
              "оба звука получили каналы (dry=%s, wet=%s)" % (dry_ch, wet_ch))

        routes = a.eval("$.audio.routes()")
        by_name = {b["name"]: b for b in (routes or {}).get("buses", [])}
        check(by_name.get("ambience", {}).get("effect") == "reverb",
              "у ambience шины свой реверб")
        check(by_name.get("ui", {}).get("dry") is True, "ui — сухая шина")
        check(by_name.get("ui", {}).get("colored") is False,
              "§48: сухая шина не окрашена, пока ambience мокнет")
        check(by_name.get("ambience", {}).get("colored") is True, "ambience — окрашена")

        # Эффект шины НЕ продублирован на канале: иначе DSP применился бы дважды.
        check(a.eval("engine.audio.channelEffect(%d)" % dry_ch) == "none",
              "§48: у звука сухой шины нет канального эффекта")
        check(a.eval("engine.audio.channelEffect(%d)" % wet_ch) == "none",
              "§48: эффект шины не дублируется на канале (двойной обработки нет)")

        # Переключение шины на ходу: громкость и панорама источника не меняются,
        # состояние канального эффекта не тянет хвост прежней маршрутизации.
        before = a.eval("(() => { const h = $.audio.handles().find(x => x.channel === %d);"
                        " return [h.volume(), h.pan(), h.bus]; })()" % dry_ch)
        a.eval("(() => { const h = $.audio.handles().find(x => x.channel === %d);"
               " h.toBus('ambience'); })()" % dry_ch)
        a.step(2)
        after = a.eval("(() => { const h = $.audio.handles().find(x => x.channel === %d);"
                       " return [h.volume(), h.pan(), h.bus]; })()" % dry_ch)
        check(before[0] == after[0] and before[1] == after[1],
              "§48: смена шины не меняет громкость/панораму источника (%s → %s)" % (before, after))
        check(after[2] == "ambience", "§48: звук действительно переехал в новую шину")
        check(a.eval("engine.audio.channelEffect(%d)" % dry_ch) == "none",
              "§48: после переезда на канале остаётся 'none' (хвост не тянется)")

        # Освобождение шины: её звук уходит к родителю, чужие шины не тронуты.
        third_ch = a.eval("$.audio.play('%s', { bus: 'ui', volume: 1 }).channel" % SFX)
        a.step(1)
        a.eval("$.audio.remove('ambience'); true")
        a.step(2)
        moved = a.eval("(() => { const h = $.audio.handles().find(x => x.channel === %d);"
                       " return h ? h.bus : null; })()" % dry_ch)
        check(moved == "master", "§48: звук освобождённой шины ушёл к родителю (%s)" % moved)
        check(a.eval("(() => { const h = $.audio.handles().find(x => x.channel === %d);"
                     " return h ? [h.bus, h.playing()] : null; })()" % third_ch) == ["ui", True],
              "§48: звук чужой (ui) шины не пострадал и продолжает играть")
        names_after = a.eval("$.audio.buses().map(b => b.name).sort()")
        check("ambience" not in (names_after or []),
              "§48: освобождённая шина больше не в списке: %s" % names_after)
        check(a.eval("typeof engine.audio.destroyGroup") == "function"
              and a.eval("engine.audio.destroyGroup(-1)") is False,
              "§48: группа освобождается нативной командой")

        # dB и линейный gain — разные вещи, и это видно явно.
        check(abs(a.eval("$.audio.dbToLinear(-6)") - 0.501187) < 1e-4,
              "§48: -6 dB → 0.501 линейного gain")
        check(abs(a.eval("$.audio.linearToDb(0.5)") + 6.0206) < 1e-3,
              "§48: 0.5 → -6.02 dB")
        a.eval("$.audio.volume('ui', { db: -6 }); true")
        check(abs(a.eval("$.audio.volume('ui')") - 0.501187) < 1e-4,
              "§48: сеттер принимает { db } и хранит линейное значение")

        # --- Движок жив и ошибок нет -------------------------------------------
        a.step(2)
        check(a.eval("engine.frame") > 0, "кадры идут после операций с шинами")
        check(a.ping().get("pong") is True, "движок отвечает")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
