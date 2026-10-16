#!/usr/bin/env python3
# ===========================================================================
# C4 (отчёт BASHNYA 0.1.34). Предел звуковых каналов.
#
# Было 16 эффект-каналов на всю игру — для плотной сцены (шаги + удары + фон +
# реплики) это упиралось в предел. Стало 128; цена измерена, а не предположена
# (числа и методика — в комментарии к R2D_AUDIO_CHANNELS в src/audio.h):
# статическая память ≈ 109 байт на канал, RSS процесса на старте не отличается
# от 16 каналов, CPU платится только за ЗВУЧАЩИЕ голоса (4.5 % ядра при 16,
# 10.9 % при 64, 17.9 % при 128) и в кадр не попадает вовсе.
#
# Что проверяется здесь:
#   * предел виден честно: $.sound.channels() и $.sound.busy().total совпадают
#     с движком и не меньше 64;
#   * заполнение до НОВОГО предела: все каналы заняты, free = 0;
#   * вытеснение по priority и -1, когда вытеснять некого;
#   * освобождение канала возвращает его в пул (новый звук играет без вытеснения);
#   * 64 одновременных голоса не обрываются и не деградируют: числа — сколько
#     голосов реально играло, позиции растут, время кадра до/после;
#   * 100 циклов заполнения/остановки не растят ни голоса, ни handle'ы.
#
# Запуск (после сборки движка):
#   python3 tests/agent/audio_channels_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "audiobus")
SFX = "assets/audio/sfx/pickup_01.ogg"
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def frame_ms(a):
    """Время кадра, измеренное самим движком (зоны профиля)."""
    profile = a.profile()
    frame = profile.get("frame") or {}
    return frame.get("frame_ms")


def wait_busy(a, want_free, timeout=2.0):
    """Дождаться, пока движок освободит канал.

    Микшер SDL работает в реальном времени: `play()` возвращает канал сразу, а
    освобождение (`MIX_TrackPlaying` == false) видно после ближайшего
    аудиобуфера — кадры его не ускоряют. Поэтому ждём факт по wall-clock, а не
    «N кадров»: иначе проверка освобождения превращается в гонку.
    """
    import time
    deadline = time.perf_counter() + timeout
    busy = a.eval("$.sound.busy()")
    while time.perf_counter() < deadline:
        if busy["free"] >= want_free:
            return busy
        time.sleep(0.05)
        a.step(1)
        busy = a.eval("$.sound.busy()")
    return busy


def main():
    with Agent(game=GAME, seed=13) as a:
        a.step(3)
        a.eval("$.audio.clear(); $.sound.stopAll(0); 'ok'")
        a.step(2)

        # --- Предел виден честно ----------------------------------------------
        engine_total = a.eval("engine.audio.channelCount()")
        sound_total = a.eval("$.sound.channels()")
        busy = a.eval("$.sound.busy()")
        print("  --   предел: движок %s, $.sound.channels() %s, busy %s"
              % (engine_total, sound_total, busy))
        check(sound_total == engine_total == busy["total"],
              "предел каналов один и тот же у движка и у $: %s/%s/%s"
              % (engine_total, sound_total, busy["total"]))
        check(busy["total"] >= 64,
              "предел поднят с 16 минимум до 64: %s" % busy["total"])
        check(busy["active"] == 0 and busy["free"] == busy["total"],
              "на пустом миксе free = total: %s" % busy)

        # --- Заполнение до НОВОГО предела -------------------------------------
        filled = a.eval("""(() => {
            const chans = [];
            for (let i = 0; i < %d; i++) chans.push($.sound.play('%s', { loop: true, priority: 1 }));
            return { chans, unique: new Set(chans).size, busy: $.sound.busy() };
        })()""" % (engine_total, SFX))
        print("  --   заполнение: занято %s, свободно %s, каналов %s"
              % (filled["busy"]["active"], filled["busy"]["free"], filled["unique"]))
        check(all(c >= 0 for c in filled["chans"]), "каждый из %d звуков получил канал" % engine_total)
        check(filled["unique"] == engine_total,
              "каналы не повторяются: %s уникальных из %s" % (filled["unique"], engine_total))
        check(filled["busy"]["active"] == engine_total and filled["busy"]["free"] == 0,
              "пул занят целиком: %s" % filled["busy"])

        # --- Вытеснение по priority -------------------------------------------
        evict = a.eval("""(() => {
            const h = $.sound.play('%s', { loop: true, priority: 5 });
            return { channel: h, priority: h >= 0 ? $.sound.priorityOf(h) : -1 };
        })()""" % SFX)
        print("  --   priority 5 при полном пуле → канал %s (приоритет %s)"
              % (evict["channel"], evict["priority"]))
        check(evict["channel"] >= 0 and evict["priority"] == 5,
              "звук с более высоким priority вытеснил самый неважный")

        # Вытеснять некого: поднимаем ВСЕ каналы до приоритета 5 и просим
        # приоритет 1 — жертвы нет, значит честный отказ, а не тихая подмена.
        a.eval("""for (let i = 0; i < %d; i++) $.sound.play('%s', { loop: true, priority: 5 }); 'ok'"""
               % (engine_total, SFX))
        a.step(1)
        priorities = a.eval("""(() => {
            let lowest = 99;
            for (let c = 0; c < %d; c++) lowest = Math.min(lowest, $.sound.priorityOf(c));
            return lowest;
        })()""" % engine_total)
        print("  --   минимальный приоритет в пуле: %s" % priorities)
        refused = a.eval("""(() => {
            const h = $.sound.play('%s', { loop: true, priority: 1 });
            return { channel: h, active: $.sound.activeChannels(), free: $.sound.busy().free };
        })()""" % SFX)
        print("  --   priority 1 при полном пуле важных → канал %s" % refused["channel"])
        check(priorities == 5, "все каналы пула подняты до приоритета 5: минимум %s" % priorities)
        check(refused["channel"] == -1,
              "когда вытеснять некого, play() возвращает -1 (не «молча проглотил»)")
        check(refused["active"] == engine_total,
              "отказ ничего не сломал: занято по-прежнему %s" % engine_total)

        # --- Освобождение канала возвращает его в пул -------------------------
        freed_ch = a.eval("$.sound.play('%s', { loop: true, priority: 9 })" % SFX)
        a.eval("$.sound.stop(%d, 0)" % freed_ch)
        after_free = wait_busy(a, 1)
        still_playing = a.eval("$.sound.playing(%d)" % freed_ch) if freed_ch >= 0 else None
        print("  --   освобождён канал %s (играет после остановки: %s): %s"
              % (freed_ch, still_playing, after_free))
        check(freed_ch >= 0 and still_playing is False,
              "звук получил канал и остановлен (playing=%s)" % still_playing)
        check(after_free["free"] >= 1 and after_free["active"] <= engine_total - 1,
              "освобождённый канал вернулся в пул: %s" % after_free)
        reuse = a.eval("$.sound.play('%s', { loop: true, priority: 0 })" % SFX)
        print("  --   новый звук на освободившемся месте: канал %s" % reuse)
        check(reuse >= 0,
              "новый звук занял свободный канал БЕЗ вытеснения (приоритет 0 < 5): канал %s" % reuse)

        # --- 64 одновременных голоса: играют и не деградируют -----------------
        a.eval("$.sound.stopAll(0); 'ok'")
        wait_busy(a, engine_total)
        a.step(3)
        idle_ms = frame_ms(a)
        voices = a.eval("""(() => {
            const chans = [];
            for (let i = 0; i < 64; i++) chans.push($.sound.play('%s', { loop: true, priority: 2 }));
            return { count: chans.filter((c) => c >= 0).length, chans };
        })()""" % SFX)
        a.step(60)
        alive = a.eval("""(() => {
            let playing = 0, moving = 0;
            for (let c = 0; c < 64; c++) if ($.sound.playing(c)) playing++;
            return { playing, positions: [$.sound.position(0), $.sound.position(31), $.sound.position(63)] };
        })()""")
        loud_ms = frame_ms(a)
        print("  --   64 голоса: играло %s, время кадра %.2f мс (до: %.2f мс), позиции %s"
              % (alive["playing"], loud_ms, idle_ms, alive["positions"]))
        check(voices["count"] == 64, "все 64 звука получили канал")
        check(alive["playing"] == 64,
              "через секунду все 64 голоса всё ещё играют (микшер не обрывает): %s" % alive["playing"])
        check(all(p > 0 for p in alive["positions"]),
              "позиции голосов растут — микс действительно идёт: %s" % alive["positions"])
        check(loud_ms is not None and idle_ms is not None and loud_ms <= idle_ms + 5.0,
              "время кадра не деградирует: %.2f мс при 64 голосах против %.2f мс на пустом миксе"
              % (loud_ms, idle_ms))
        check(a.eval("$.sound.busy().total") == engine_total,
              "64 голоса не изменили предел пула: %s" % a.eval("$.sound.busy().total"))

        # --- 100 циклов: голоса и handle'ы не растут ---------------------------
        a.eval("$.sound.stopAll(0); 'ok'")
        wait_busy(a, engine_total)
        for _ in range(100):
            a.eval("""(() => {
                const h = $.sound.play('%s', { loop: true, priority: 3 });
                if (h >= 0) $.sound.stop(h, 0);
                return h;
            })()""" % SFX)
        a.step(3)
        cycle = a.eval("[$.sound.activeChannels(), $.sound.busy().free, $.audio.handles().length]")
        print("  --   после 100 циклов play/stop: active=%s free=%s handles=%s" % tuple(cycle))
        check(cycle[0] == 0 and cycle[1] == engine_total and cycle[2] == 0,
              "100 циклов не оставляют ни голосов, ни handle'ов: %s" % cycle)

        frames = a.eval("engine.frame")
        a.step(2)
        check(a.eval("engine.frame") > frames and a.ping().get("pong") is True, "движок отвечает")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
