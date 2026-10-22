#!/usr/bin/env python3
# ===========================================================================
# $.sfxgen на живом движке: описание → дескриптор → синтез (C) → WAV → воспроизведение.
#
# Проверяется: пресеты и дескрипторы, слова (ru/en), запись WAV с корректным заголовком, детерминизм файла,
# кэш по содержимому, ошибки с кодами, банк для $.sfx.play и воспроизведение через $.sound.
#
# Запуск (после сборки): python3 tools/run_tests.py highlevel_sfxgen_test
# ===========================================================================
import os
import struct
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def wav_info(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    channels, rate = struct.unpack("<HI", data[22:24] + data[24:28])
    bits = struct.unpack("<H", data[34:36])[0]
    size = struct.unpack("<I", data[40:44])[0]
    return {"channels": channels, "rate": rate, "bits": bits, "bytes": size, "total": len(data), "raw": data}


def main():
    tmp = tempfile.mkdtemp(prefix="r2d-sfxgen-")
    with Agent(game=os.path.join("tests", "fixtures", "bare"), seed=3) as a:
        check(a.eval("typeof $.sfxgen") == "object", "$.sfxgen установлен")
        a.eval("$.sfxgen.cacheDir(%s)" % repr(os.path.join(tmp, "cache")).replace("'", '"'))   # кэш — во временный каталог, не в фикстуру
        presets = a.eval("$.sfxgen.presets().join(',')")
        check(presets == "coin,laser,explosion,powerup,hurt,jump,blip,random", "пресеты: %s" % presets)

        d1 = a.eval("JSON.stringify($.sfxgen.preset('coin', { seed: 5 }))")
        d2 = a.eval("JSON.stringify($.sfxgen.preset('coin', { seed: 5 }))")
        d3 = a.eval("JSON.stringify($.sfxgen.preset('coin', { seed: 6 }))")
        check(d1 == d2 and d1 != d3, "дескриптор детерминирован по seed и меняется вместе с ним")

        d = a.eval("$.sfxgen.describe('короткий высокий прыжок', 2)")
        check(d and d["preset"] == "jump" and d["params"]["wave"] == "square", "слова ru → пресет jump: %r" % (d and d["preset"]))
        check(a.eval("$.sfxgen.describe('big explosion').preset") == "explosion", "слова en → explosion")
        check(a.eval("$.sfxgen.describe('что-то странное')") is None, "непонятное описание → null (не случайный звук)")
        check(a.eval("$.sfxgen.describe('высокий прыжок').params.freq") > a.eval("$.sfxgen.describe('низкий прыжок').params.freq"),
              "модификаторы высокий/низкий меняют высоту")

        wav = os.path.join(tmp, "coin.wav")
        r = a.eval("$.sfxgen.render({ preset: 'coin', seed: 5 }, %s)" % repr(wav).replace("'", '"'))
        info = wav_info(wav)
        check(info is not None and info["channels"] == 1 and info["rate"] == 44100 and info["bits"] == 16, "WAV: моно, 44100, 16 бит")
        check(info is not None and info["total"] == 44 + info["bytes"] and info["bytes"] == r["samples"] * 2, "WAV: размер сходится с числом сэмплов")
        check(0.1 < r["peak"] < 0.98 and r["clipped"] == 0 and r["seconds"] > 0.05, "статистика: пик %.2f, %.2f с, без среза" % (r["peak"], r["seconds"]))

        wav2 = os.path.join(tmp, "coin2.wav")
        a.eval("$.sfxgen.render({ preset: 'coin', seed: 5 }, %s)" % repr(wav2).replace("'", '"'))
        check(wav_info(wav2)["raw"] == info["raw"], "тот же дескриптор — побайтно тот же WAV")

        a.eval("$.sfxgen.render('coin'); $.sfxgen.render('coin', undefined); $.sfxgen.render('coin', null)")
        check(not os.path.exists("undefined") and not os.path.exists("null"), "render без пути ничего не пишет (нет файла «undefined»)")

        sine = a.eval("$.sfxgen.render({ wave: 'sine', freq: 0.5, sustain: 0.4, decay: 0.3 }).pitchHz")
        check(800 < sine < 970, "синус freq=0.5: основной тон ≈ 886 Гц (получено %s)" % sine)

        p1 = a.eval("$.sfxgen.make('coin')")
        p2 = a.eval("$.sfxgen.make('coin')")
        p3 = a.eval("$.sfxgen.make('jump')")
        check(p1 == p2 and p1 != p3 and a.eval("$.fs.exists(%s)" % repr(p1).replace("'", '"')), "make: файл в кэше по хешу, повтор — тот же путь")

        for bad, label in (("$.sfxgen.preset('nope')", "неизвестный пресет"), ("$.sfxgen.preset('coin', { freqq: 1 })", "неизвестное поле"),
                           ("$.sfxgen.render('???')", "непонятная строка"), ("$.sfxgen.render({ wave: 'tri' })", "неизвестная волна")):
            code = a.eval("(function(){ try { %s; return 'нет ошибки'; } catch (e) { return String(e.code || e.message); } })()" % bad)
            check(code.startswith("R2D_SFXGEN") or "wave" in code, "%s → ошибка (%s)" % (label, code[:60]))

        files = a.eval("$.sfxgen.bank('click', ['blip', { preset: 'blip', seed: 2 }]); $.sound.bankNames().indexOf('click') >= 0")
        check(files is True, "bank: банк 'click' объявлен в $.sound")
        ch = a.eval("typeof $.sfxgen.play('coin', { volume: 0.2 })")
        check(ch == "number", "play: вызов дошёл до $.sound.play")
        a.step(5)
        check(a.eval("$.debug.errors ? $.debug.errors().filter(function(e){ return /sfx/i.test(String(e.code||'')); }).length : 0") == 0,
              "в журнале ошибок нет R2D_SFX*")

    print("")
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
