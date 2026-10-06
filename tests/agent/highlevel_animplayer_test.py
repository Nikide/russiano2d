#!/usr/bin/env python3
# ===========================================================================
# Тест анимационного плеера $.anim.player через агентский интерфейс.
#
# Гоняет фикстуру tests/fixtures/animplayer и проверяет: реестр клипов плеера,
# дорожки position/alpha/value/color/sprite, события ровно один раз, конец
# once-клипа, перемотку, паузу, скорость, микширование двух клипов и то, что
# $.anim из anim.js при этом не затёрта.
#
# Требует, чтобы api.js поставил подсистему (см. src/highlevel/animplayer.js):
#   import { installAnimPlayer, tickAnimPlayer } from './animplayer.js';
#   installAnimPlayer($);        // сразу после installAnim($)
#   tickAnimPlayer(dt);          // сразу после tickAnim(dt)
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_animplayer_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "animplayer")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        # --- Реестр клипов плеера --------------------------------------------
        check(a.eval("$.anim.clips().includes('walk')") is True,
              "клип плеера виден в $.anim.clips")
        check(a.eval("$.anim.clipGet('walk').duration") == 1000,
              "$.anim.clipGet отдаёт duration")
        check(a.eval("$.anim.clipGet('walk').tracks.length") == 2,
              "в клипе объявлены обе дорожки")
        check(a.eval("$.anim.clipGet('нет-такого')") is None,
              "неизвестный клип — null")
        check(a.eval("typeof $.anim.define") == "function",
              "$.anim.define из anim.js на месте")
        check(a.eval("$.anim.list().includes('walk')") is False,
              "реестр плеера не смешан с реестром anim.js")

        # --- Плеер по имени: цель, клип, часы --------------------------------
        check(a.eval("$.anim.players().includes('hero')") is True,
              "$.anim.players перечисляет созданные плееры")
        check(a.eval("$.anim.player('hero').playing()") is True,
              "плеер играет клип")
        check(a.eval("$.anim.player('hero').clip()") == "walk",
              "основной клип плеера — walk")
        check(a.eval("$.anim.player('hero').target().id") == "hero",
              "цель плеера разрешилась из селектора в узел")

        a.step(15)   # ~250 мс при фиксированном шаге 1/60
        x = a.eval("$('#hero').pos().x")
        check(5 < x < 60, f"дорожка position интерполируется (x={x:.1f})")
        alpha = a.eval("$('#hero').alpha()")
        check(0.5 < alpha < 1.0, f"дорожка alpha интерполируется (alpha={alpha:.2f})")
        clip_time = a.eval("$.anim.player('hero').time()")
        check(100 < clip_time < 400, f"time() — время внутри клипа, мс ({clip_time:.0f})")
        total = a.eval("$.anim.player('hero').total()")
        check(150 < total < 400, f"total() — часы плеера, мс ({total:.0f})")

        # --- Петля: клип не кончается, событие повторяется раз за проход ------
        a.step(50)   # суммарно ~65 кадров ≈ 1080 мс: начался второй проход
        check(a.eval("$.anim.player('hero').playing()") is True,
              "loop-клип не завершается")
        check(a.eval("$.anim.player('hero').time()") < 1000,
              "time() заворачивается внутри клипа")
        steps = a.eval("$.store.get('steps')")
        check(1 <= steps <= 2, f"событие клипа сработало раз за проход (steps={steps})")

        # --- Пауза и масштаб времени ($.time) действуют и на плеер ------------
        # Плеер тикал сырым dt: $.time.pause() останавливал твины, но не клипы.
        before_pause = a.eval("$.anim.player('hero').total()")
        a.eval("$.time.pause()")
        a.step(10)
        check(abs(a.eval("$.anim.player('hero').total()") - before_pause) < 1,
              "на паузе часы плеера стоят")
        a.eval("$.time.resume()")
        a.step(10)
        check(a.eval("$.anim.player('hero').total()") > before_pause,
              "после resume плеер идёт дальше")

        start = a.eval("$.anim.player('hero').total()")
        a.eval("$.time.scale(0.5)")
        a.step(20)
        half = a.eval("$.anim.player('hero').total()") - start
        start = a.eval("$.anim.player('hero').total()")
        a.eval("$.time.scale(1)")
        a.step(20)
        full = a.eval("$.anim.player('hero').total()") - start
        check(full > 0 and abs(half * 2 - full) < 40,
              "масштаб 0.5 замедляет плеер вдвое (%.0f мс против %.0f мс)" % (half, full))

        # --- Один проход: конец, finished, конечный кадр ----------------------
        check(a.eval("$.anim.player('door').playing()") is False,
              "once-клип завершился сам")
        check(a.eval("$.store.get('doorDone')") == 1,
              "finished пришло ровно один раз")
        check(a.eval("$.store.get('doorHalf')") == 1,
              "событие середины клипа дошло до подписчика")
        door_angle = a.eval("$('#door').rotation()")
        check(abs(door_angle - 1.5) < 0.05,
              f"последний кадр применён до остановки (angle={door_angle:.3f})")

        # --- Плеер по умолчанию и фасад $.anim.* ------------------------------
        check(a.eval("$.anim.playing()") is True, "$.anim.playing() видит игру")
        check(a.eval("$.anim.clipName()") == "energy",
              "$.anim.clipName() отдаёт текущий клип")
        power = a.eval("$.anim.value('power', -1)")
        check(0 <= power <= 100, f"value-дорожка читается из плеера (power={power:.0f})")
        attr_power = a.eval("$('#ghost').attr('power')")
        check(abs(attr_power - power) < 1e-6,
              "attr: true пишет значение ещё и в node.attrs")
        check(a.eval("$.anim.player('main').values().color.length") == 4,
              "дорожка цвета хранит RGBA-каналы")
        check(a.eval("$.store.get('lastEvent')") == "pulse",
              "событие клипа дошло до $.anim.on('event')")

        # --- Перемотка, скорость, пауза ---------------------------------------
        a.eval("$.anim.seek(500); 'ok'")
        seeked = a.eval("$.anim.time()")
        check(abs(seeked - 500) < 1, f"seek переводит время клипа ({seeked:.0f})")
        a.eval("$.anim.speed(2); 'ok'")
        check(a.eval("$.anim.speed()") == 2, "$.anim.speed(x) читается обратно")
        a.eval("$.anim.speed(1); 'ok'")

        a.eval("$.anim.pause(); 'ok'")
        paused = a.eval("$.anim.totalTime()")
        a.step(4)
        check(abs(a.eval("$.anim.totalTime()") - paused) < 1e-6,
              "pause замораживает часы плеера")
        a.eval("$.anim.resume(); 'ok'")
        a.step(2)
        check(a.eval("$.anim.totalTime()") > paused, "resume продолжает время")

        # --- Режим повтора на ходу --------------------------------------------
        check(a.eval("$.anim.player('hero').loop()") is None,
              "по умолчанию режим берётся из клипа")
        a.eval("$.anim.player('hero').loop('once'); 'ok'")
        check(a.eval("$.anim.player('hero').loop()") == "once",
              "loop переопределяется у играющего плеера")
        a.eval("$.anim.player('hero').play('walk', { restart: true }); 'ok'")
        check(a.eval("$.anim.player('hero').playing()") is True,
              "повторный play с restart снова играет клип")

        # --- Микширование двух клипов -----------------------------------------
        a.eval("$.anim.player('mixer').seek(0); 'ok'")
        mixed = a.eval("$.anim.player('mixer').value('alpha')")
        check(abs(mixed - 0.625) < 0.02,
              f"blend 0.5 смешивает alpha двух клипов (alpha={mixed:.3f})")
        check(a.eval("$.anim.player('mixer').clipNames().length") == 2,
              "в кроссфейде участвуют два клипа")
        a.eval("$.anim.player('mixer').blend('idle', 'walk', 0); 'ok'")
        low = a.eval("$.anim.player('mixer').value('alpha')")
        check(abs(low - 0.25) < 0.01, f"blend 0 — только первый клип (alpha={low:.3f})")
        a.eval("$.anim.player('mixer').blend('idle', 'walk', 1); 'ok'")
        high = a.eval("$.anim.player('mixer').value('alpha')")
        check(abs(high - 1) < 0.01, f"blend 1 — только второй клип (alpha={high:.3f})")
        check(abs(a.eval("$('#mixer').alpha()") - high) < 1e-6,
              "смешанное значение записано в узел")

        # --- Дорожка кадров спрайт-листа --------------------------------------
        check(a.eval("$('#fx').get(0).frames.length") == 4,
              "у узла-спрайта есть лист из четырёх кадров")
        frame = a.eval("$.anim.player('fx').value('sprite').frame")
        check(isinstance(frame, int) and 0 <= frame <= 3,
              f"кадр спрайта вычисляется по fps ({frame})")
        check(a.eval("$('#fx').get(0).frame_index") == frame,
              "кадр записан в node.frame_index")
        check(a.eval("$('#fx').get(0).sprite !== undefined") is True,
              "кадр листа подставлен в node.sprite")

        # --- Пустой клип ------------------------------------------------------
        check(a.eval("$.anim.player('quiet').playing()") is True,
              "пустой клип всё равно играет")
        check(a.eval("$.anim.player('quiet').time()") > 0,
              "у пустого клипа идёт время")

        # --- Детерминизм фиксированного шага ----------------------------------
        a.eval("$.anim.player('quiet').stop();"
               "$.anim.player('quiet').play('empty-clip', { restart: true }); 'ok'")
        a.step(60)
        quiet_total = a.eval("$.anim.player('quiet').total()")
        check(abs(quiet_total - 1000) < 40,
              f"60 кадров фиксированного шага — примерно 1000 мс ({quiet_total:.0f})")

        # --- Ошибки не роняют кадр --------------------------------------------
        a.eval("$.anim.play('нет-такого'); 'ok'")
        a.eval("$.anim.blend('нет-такого', 'walk', 0.5); 'ok'")
        a.step(2)
        check(a.ping().get("pong") is True,
              "неизвестный клип в play/blend не останавливает движок")

        # --- Остановка и очистка ----------------------------------------------
        a.eval("$.anim.stopAll(); 'ok'")
        check(a.eval("$.anim.player('hero').playing()") is False,
              "$.anim.stopAll() останавливает все плееры")
        check(a.eval("$.anim.playing()") is False,
              "плеер по умолчанию тоже остановлен")

        check(a.eval("$.anim.removeClip('walk')") is True,
              "$.anim.removeClip удаляет клип")
        a.eval("$.anim.clearClips(); 'ok'")
        check(a.eval("$.anim.clips().length") == 0,
              "$.anim.clearClips() очищает реестр плеера")
        a.eval("$.anim.clearPlayers(); 'ok'")
        check(a.eval("$.anim.players().length") == 0,
              "$.anim.clearPlayers() очищает список плееров")
        check(a.ping().get("pong") is True,
              "движок жив после очистки подсистемы")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
