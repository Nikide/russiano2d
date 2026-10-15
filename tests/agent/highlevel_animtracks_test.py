#!/usr/bin/env python3
# ===========================================================================
# Агентский тест §41 (multi-target animation, property/audio tracks),
# §10 (маркеры и gameplay-окна) и §6 (домены часов).
#
# Гоняет фикстуру tests/fixtures/animtracks и проверяет приёмку §41:
#   * один клип управляет кадром героя, оружием, sensor'ом, emitter'ом и SFX;
#   * другой — несколькими персонажами, camera cue, RmlUi value и музыкой;
#   * завершение каждой части продолжает flow ровно один раз;
#   * seek предпросмотра урона не наносит;
#   * сериализованный JSON играет без ручных frame-callback;
#   * presentation-часы идут на паузе, simulation — нет;
#   * старый формат дорожек продолжает работать.
#
# Требует, чтобы api.js поставил подсистему (src/highlevel/animplayer.js).
#
# Запуск (после сборки):
#   python3 tools/run_tests.py highlevel_animtracks_test
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "animtracks")
DOC = "$.ui.doc('tests/fixtures/animtracks/ui/hud.rml')"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def state(a):
    return a.state().get("animtracks") or {}


def main():
    with Agent(game=GAME, seed=13) as a:
        st = state(a)

        # --- Реестр и схема треков -------------------------------------------
        check(a.eval("$.anim.clips().includes('attack')") is True,
              "клип attack объявлен в реестре плеера")
        check(a.eval("$.anim.clips().includes('json-part')") is True,
              "JSON-клип загружен через $.anim.load")
        check(a.eval("$.anim.clipGet('attack').tracks.length") == 7,
              "в attack семь property-дорожек")
        check(a.eval("$.anim.clipGet('attack').cues.length") == 3,
              "в attack три cue-дорожки (audio + два method)")
        check(a.eval("$.anim.clipGet('attack').events.length") == 3,
              "в attack три маркера (окно open/close и damage)")
        check(a.eval("$.anim.clipGet('attack').tracks[3].binding") == "visible",
              "дорожка видимости оружия — binding visible")
        check(a.eval("$.anim.clipGet('attack').tracks[4].binding") == "shape.enabled",
              "attack sensor управляется binding'ом shape.enabled")
        check(a.eval("$.anim.clipGet('attack').tracks[3].mode") == "change",
              "дискретная дорожка обновляется по изменению")
        check(a.eval("$.anim.clipGet('attack').cues[0].audio.resource") is not None,
              "audio cue хранит resource")
        check(a.eval("$.anim.bindings().includes('audio.gain')") is True
              and a.eval("$.anim.bindings().includes('ui.value')") is True,
              "реестр binding'ов содержит минимум §41")

        # --- Binding'и разрешены до play --------------------------------------
        binds = a.eval("JSON.stringify($.anim.player('hero').bindings())")
        import json
        binds = json.loads(binds)
        check(len(binds) == 7, f"все семь дорожек attack разрешены (получено {len(binds)})")
        targets = sorted({b["target"] for b in binds})
        check(targets == ["#flash", "#hero", "#sensor", "#smoke", "#weapon"],
              f"цели дорожек — корень и дети героя ({targets})")
        check(all(b["resolved"] for b in binds), "все binding'и имеют handle")

        # --- Seek предпросмотра: урон не наносится ---------------------------
        before_hits = st.get("hits", 0)
        a.eval("$.anim.player('hero').seek(500, { fire: true }); 'ok'")
        st = state(a)
        check(st.get("hits", 0) == before_hits,
              "seek предпросмотра не нанёс урон (damage-маркер молчит)")
        check(st.get("boom", 0) >= 1,
              "обычная cue доигрывается при seek с fire: true")
        a.eval("$.anim.player('hero').restore(0); 'ok'")
        check(a.eval("$.anim.player('hero').total()") == 0,
              "restore возвращает часы в начало")
        area_index = a.eval("$('#sensor').areas()[0].index")
        check(isinstance(area_index, int) and area_index >= 0,
              f"attack-область имеет native-индекс ({area_index})")
        check(a.eval("$.anim.clipGet('attack').tracks[4].props.shape") == area_index,
              "дорожка shape.enabled целится именно в эту форму")
        check(a.eval("$.anim.player('hero').value('shape.enabled@sensor')") is False,
              "per-shape дорожка держит область выключенной в начале клипа")

        # --- Один клип: герой + оружие + sensor + emitter + свет + SFX -------
        a.step(10)   # ~167 мс: пересечение 150 мс
        frame = a.eval("$('#hero').get(0).frame_index")
        check(isinstance(frame, int) and 0 <= frame <= 1,
              f"кадр героя идёт по дорожке sprite ({frame})")
        angle = a.eval("$('#weapon').rotation()")
        check(angle > 0.4, f"оружие поворачивается дорожкой ({angle:.2f})")
        wx = a.eval("$('#weapon').pos().x")
        check(wx > 3, f"оружие сдвигается дорожкой position ({wx:.1f})")
        check(a.eval("$('#smoke').emitting()") is True,
              "emitter включился дорожкой emitting")
        intensity = a.eval("$('#flash').get(0).intensity")
        check(intensity > 0.5, f"вспышка света горит (intensity={intensity:.2f})")
        check(a.eval("$.anim.player('hero').value('shape.enabled@sensor')") is True,
              "per-shape дорожка включила attack-область по маркеру 150 мс")
        check(a.eval("$.anim.player('hero').window('attack')") is True,
              "маркер открыл gameplay-окно attack")
        st = state(a)
        check(st.get("boom", 0) >= 1, "method-дорожка позвала game.boom")
        check(st.get("cameraCue", 0) >= 1, "camera cue через method-дорожку сработал")

        # --- Дискретное состояние и окно дальше по клипу ----------------------
        a.step(12)   # ~367 мс: сенсор включён, окно ещё открыто
        check(a.eval("$('#smoke').emitting()") is True, "эмиттер продолжает работать")
        a.step(8)    # ~500 мс: окно закрыто, сенсор выключен, оружие скрыто
        check(a.eval("$.anim.player('hero').window('attack')") is False,
              "маркер закрыл gameplay-окно")
        check(a.eval("$('#weapon').get(0).visible") is False,
              "оружие скрыто дискретной дорожкой visible")
        check(a.eval("$.anim.player('hero').value('shape.enabled@sensor')") is False,
              "per-shape дорожка снова выключила область после окна атаки")

        # --- Завершение первой части продолжает flow --------------------------
        a.step(10)   # > 600 мс: attack завершён
        st = state(a)
        check(st.get("part1") == 1, f"finished attack пришёл ровно один раз ({st.get('part1')})")
        check(a.eval("$.anim.player('squad').clip()") == "squad",
              "flow продолжился вторым клипом")

        # --- Второй клип: несколько персонажей, UI, музыка, камера ------------
        a.step(12)   # ~200 мс squad
        ax = a.eval("$('#unit-a').pos().x")
        bx = a.eval("$('#unit-b').pos().x")
        check(ax > 10, f"первый персонаж идёт своим target'ом ({ax:.1f})")
        check(bx < -10, f"второй персонаж идёт своим target'ом ({bx:.1f})")
        lives = a.eval(f"parseFloat({DOC}.value('lives'))")
        check(lives < 3, f"RmlUi-элемент получает значение дорожки ui.value ({lives})")
        check(a.eval(f"{DOC}.rect('fade')") is not None,
              "RmlUi-документ загружен, ui.style пишет в его элемент")
        ui_binds = a.eval("JSON.stringify($.anim.player('squad').bindings().filter(b => b.binding.indexOf('ui.') === 0))")
        import json as _json
        ui_binds = _json.loads(ui_binds)
        check(len(ui_binds) == 2 and all(b["resolved"] for b in ui_binds),
              "обе ui-дорожки привязаны к документу RmlUi")
        st = state(a)
        check(st.get("cameraCue", 0) >= 2, "camera cue второго клипа сработал")

        a.step(40)   # > 800 мс squad
        st = state(a)
        check(st.get("part2") == 1, f"finished squad пришёл ровно один раз ({st.get('part2')})")
        check(a.eval("$.anim.player('json').clip()") == "json-part",
              "flow продолжился JSON-клипом")

        # --- JSON-клип: события и method без ручных callback'ов ---------------
        a.step(20)   # > 300 мс json-part
        st = state(a)
        check(st.get("jsonHit") == 1, "маркер JSON-клипа сработал ровно один раз")
        check(st.get("part3") == 1, "finished JSON-клипа пришёл ровно один раз")
        check(st.get("parts") == 3, f"цепочка прошла три части ровно по разу ({st.get('parts')})")
        check(a.eval("$.anim.player('json').playing()") is False,
              "JSON-клип завершился сам")

        # --- Часы §6: presentation идёт на паузе, simulation стоит ------------
        a.eval("$.time.pause(); 'ok'")
        fx_before = a.eval("$.anim.player('fx').total()")
        sim_before = a.eval("$.anim.player('legacy').total()")
        a.step(6)
        fx_after = a.eval("$.anim.player('fx').total()")
        sim_after = a.eval("$.anim.player('legacy').total()")
        check(fx_after > fx_before, "presentation-часы идут на паузе")
        check(abs(sim_after - sim_before) < 1e-6, "simulation-часы на паузе стоят")
        a.eval("$.time.resume(); 'ok'")
        a.step(2)
        check(a.eval("$.anim.player('legacy').total()") > sim_after,
              "после resume simulation-часы продолжают")

        # --- Старый формат дорожек продолжает работать ------------------------
        power = a.eval("$.anim.player('legacy').value('power', -1)")
        check(0 <= power <= 100, f"value-дорожка старого формата читается ({power:.0f})")
        check(abs(a.eval("$('#legacy-hero').attr('power')") - power) < 1e-6,
              "attr: true пишет значение в node.attrs")
        lframe = a.eval("$('#legacy-hero').get(0).frame_index")
        check(isinstance(lframe, int) and 0 <= lframe <= 3,
              f"кадры спрайта старого формата листаются ({lframe})")
        st = state(a)
        check(st.get("legacySteps", 0) >= 1, "событие старого клипа повторяется на проходе")

        # --- Ошибки не роняют кадр --------------------------------------------
        a.eval("$.anim.play('нет-такого'); $.anim.blend('нет-такого', 'attack', 0.5); 'ok'")
        a.eval("$.anim.load('{ это не json'); 'ok'")
        a.step(2)
        check(a.ping().get("pong") is True,
              "неизвестный клип и битый JSON не останавливают движок")

        # --- Остановка ---------------------------------------------------------
        a.eval("$.anim.stopAll(); 'ok'")
        check(a.eval("$.anim.player('hero').playing()") is False,
              "$.anim.stopAll() остановил плееры")
        check(a.eval("$.anim.playing()") is False,
              "плеер по умолчанию остановлен")
        check(a.ping().get("pong") is True, "движок жив после очистки")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
