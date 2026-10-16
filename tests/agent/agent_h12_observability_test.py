#!/usr/bin/env python3
# ===========================================================================
# BASHNYA H12 (task-59): что агентский режим отдаёт на самом деле.
#
# Три пункта отчёта H12 проверяются по факту, а не по обещанию:
#
#   1. КОРРЕЛЯЦИЯ ПРОТОКОЛА — BASHNYA написала «нет корреляции». Замер: id
#      повторяется и в успехе, и в ОШИБКЕ, нежданные сообщения помечены
#      `event`, и ни одной строки без `id`/`event` в протоколе нет. Тест
#      закрепляет это как гарантию, чтобы клиент мог сверять `id` и не путать
#      ответы при асинхронных событиях (дефект был в их r2d_agent.py).
#
#   2. АУДИО — «нет аудио». Замер: звук ИНИЦИАЛИЗИРУЕТСЯ и наблюдаем даже с
#      SDL_AUDIODRIVER=dummy (как в их харнессе): микшер считает, каналы
#      занимаются, захват микса даёт тишину ровно 0 и звук с peak ≈ 0.287.
#      То есть проверять звук в CI можно без аудиоустройства — рецепт в
#      docs/AGENT_API.md §7.1.
#
#   3. ИНТРОСПЕКЦИЯ — «нет интроспекции API»: было верно, `$.agent.has` и
#      команда `has` добавлены (список имён полным списком НЕ отдаём: 3000+
#      имён это ~60 КБ, а снимок уже один раз раздувался до 168 КБ).
#
# Запуск: python3 tests/agent/agent_h12_observability_test.py
# ===========================================================================

import json
import os
import struct
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import ROOT   # noqa: E402

BINARY = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "russiano2d"))
GAME = os.path.join(ROOT, "game")

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def note(message):
    print("  --   " + message)


class Raw:
    """Сырой протокол: клиент на Python для проверки ГАРАНТИЙ протокола."""

    def __init__(self, env_extra=None):
        env = dict(os.environ)
        env.setdefault("SDL_AUDIODRIVER", "dummy")     # как в харнессе BASHNYA
        if env_extra:
            env.update(env_extra)
        self.proc = subprocess.Popen(
            [BINARY, "--agent", "--headless", "--fixed-dt", "0.0166666667", "--game", GAME],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1, cwd=ROOT, env=env)
        self.lines = []
        self.wait_ready()

    def read_line(self, timeout=8.0):
        end = time.time() + timeout
        while time.time() < end:
            line = self.proc.stdout.readline()
            if not line:
                return None
            line = line.strip()
            if not line:
                continue
            self.lines.append(line)
            return line
        return None

    def wait_ready(self, timeout=15.0):
        end = time.time() + timeout
        while time.time() < end:
            line = self.read_line(timeout=max(0.1, end - time.time()))
            if line and '"event":"ready"' in line:
                return line
        return None

    def send(self, req, timeout=8.0):
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        end = time.time() + timeout
        while time.time() < end:
            line = self.read_line(timeout=max(0.1, end - time.time()))
            if line is None:
                return None
            if '"id"' in line or '"ok"' in line:
                return json.loads(line)
        return None

    def step(self, frames=1):
        for _ in range(frames):
            self.proc.stdin.write(json.dumps({"cmd": "step", "frames": 1}) + "\n")
            self.proc.stdin.flush()
            self.read_line(timeout=5)

    def eval(self, code, timeout=8.0):
        resp = self.send({"cmd": "eval", "code": code}, timeout)
        if resp is None or not resp.get("ok"):
            return None
        return resp.get("result")

    def close(self):
        try:
            self.proc.stdin.write(json.dumps({"cmd": "quit"}) + "\n")
            self.proc.stdin.flush()
            self.proc.wait(timeout=8)
        except Exception:
            self.proc.kill()
        return self.proc.stderr.read()


# ---------------------------------------------------------------------------
# 1. Корреляция протокола
# ---------------------------------------------------------------------------
def test_correlation():
    r = Raw()
    ready = [l for l in r.lines if '"event"' in l][0] if any('"event"' in l for l in r.lines) else None
    check(ready is not None and '"event":"ready"' in ready,
          "нежданное сообщение помечено event: %s" % (ready or "нет"))

    ok = r.send({"cmd": "ping", "id": 42})
    check(ok is not None and ok.get("id") == 42,
          "успех повторяет id=42 (получено %s)" % (ok or {}).get("id"))

    err = r.send({"cmd": "нет-такой-команды", "id": 7})
    check(err is not None and err.get("ok") is False and err.get("id") == 7,
          "ошибка тоже повторяет id=7 (получено %s)" % (err or {}).get("id"))

    # без id в запросе ответ не выдумывает чужой
    no_id = r.send({"cmd": "ping"})
    check(no_id is not None and no_id.get("ok") is True and "id" not in no_id,
          "без id в запросе ответ идёт без id")

    r.close()
    # Гарантия протокола: у нежданных сообщений есть `event`, у ответов —
    # `id`, если клиент его прислал. Единственная строка без корреляции в этом
    # прогоне — ответ на НАМЕРЕННО безid-запрос выше: движок не выдумывает id.
    uncorrelated = [l for l in r.lines if '"id"' not in l and '"event"' not in l]
    check(len(uncorrelated) == 1 and '"pong"' in uncorrelated[0],
          "строк без id/event ровно одна — ответ на запрос без id (%d из %d строк)"
          % (len(uncorrelated), len(r.lines)))
    for line in uncorrelated[:3]:
        note("без корреляции (ожидаемо): " + line[:120])


# ---------------------------------------------------------------------------
# 2. Аудио: инициализация и наблюдаемость без устройства
# ---------------------------------------------------------------------------
PEAK = ("JSON.stringify((()=>{const c=$.audio.captured();let pk=0,sum=0;const s=c.samples||[];"
        "for(const v of s){const a=Math.abs(v);if(a>pk)pk=a;sum+=a;}"
        "return {n:s.length,peak:pk,mean:sum/Math.max(1,s.length)};})())")


def capture_peak(r, frames=4096, steps=40):
    check(r.eval("$.audio.captureStart(%d)" % frames) is True,
          "захват микса запущен на %d кадров" % frames)
    r.step(steps)
    raw = r.eval(PEAK)
    return json.loads(raw) if raw else None


def test_audio():
    r = Raw({"SDL_AUDIODRIVER": "dummy"})
    stderr = None
    try:
        init = r.eval("$.sound.channels()")
        check(init == 128, "микшер инициализирован: каналов %s" % init)

        silence = capture_peak(r)
        check(silence is not None and silence["peak"] == 0.0,
              "в тишине микс ровно нулевой: peak=%s (n=%s)"
              % (silence and silence["peak"], silence and silence["n"]))

        busy_before = r.eval("$.sound.busy()")
        played = r.eval("$.sound.play('assets/audio/sfx/pickup_01.ogg')")
        check(isinstance(played, int) and played >= 0,
              "звук запущен из агенского режима (id=%s)" % played)
        busy_after = r.eval("$.sound.busy()")
        check(busy_before and busy_after and busy_after["active"] == busy_before["active"] + 1,
              "канал занялся: %s → %s" % (busy_before, busy_after))

        loud = capture_peak(r)
        check(loud is not None and loud["peak"] > 0.01,
              "звук слышен в миксе: peak=%s (порог 0.01)"
              % (loud and loud["peak"]))
        note("тишина peak=%s, звук peak=%s, mean=%s"
             % (silence and silence["peak"], loud and loud["peak"], loud and loud["mean"]))

        # captureClear() возвращает сам $.audio (цепочкой), поэтому проверяем
        # ФАКТ: после очистки буфер пуст.
        r.eval("$.audio.captureClear()")
        after = r.eval("JSON.stringify((()=>{const c=$.audio.captured();"
                       "return {n:(c.samples||[]).length,done:c.done};})())")
        check(after == '{"n":0,"done":false}',
              "захват очищен: буфер %s" % after)
    finally:
        stderr = r.close()
    init_lines = [l for l in (stderr or "").splitlines() if "аудио готово" in l]
    check(bool(init_lines), "журнал подтверждает инициализацию: %s"
          % (init_lines[-1].split("]")[-1].strip() if init_lines else "нет строки"))


# ---------------------------------------------------------------------------
# 3. Интроспекция: $.agent.has и команда has
# ---------------------------------------------------------------------------
def test_introspection():
    r = Raw()
    try:
        check(r.eval("$.agent.has('audio.captureStart')") is True,
              "$.agent.has: существующее имя → true")
        check(r.eval("$.agent.has('no.such.thing')") is False,
              "$.agent.has: несуществующее имя → false")
        got = r.eval("JSON.stringify($.agent.has(['sound.busy','audio.captureStart','nope']))")
        check(got == '{"sound.busy":true,"audio.captureStart":true,"nope":false}',
              "$.agent.has списком → %s" % got)
        check(r.eval("$.agent.has('sound.musicPlaying')") is True,
              "$.agent.has видит $.sound.musicPlaying (метод есть — в отличие от $.audio.musicPlaying)")

        resp = r.send({"cmd": "has", "names": ["$.audio.captureStart", "$.no.such.thing"]})
        check(resp is not None and resp.get("has") == {"$.audio.captureStart": True,
                                                       "$.no.such.thing": False},
              "команда has списком → %s" % (resp or {}).get("has"))
        resp = r.send({"cmd": "has", "name": "$.sound.busy"})
        check(resp is not None and resp.get("has") is True,
              "команда has одним именем → true")
        resp = r.send({"cmd": "has"})
        check(resp is not None and resp.get("ok") is False,
              "команда has без параметров → понятная ошибка")
        resp = r.send({"cmd": "has", "names": "строка"})
        check(resp is not None and resp.get("ok") is False,
              "команда has с не-массивом → понятная ошибка")
        # Полный список имён не отдаём: ответ на has не должен расти до десятков КБ.
        resp = r.send({"cmd": "has", "names": ["$.sound.busy"]})
        size = len(json.dumps(resp, ensure_ascii=False))
        check(size < 300, "ответ has не раздувается: %d Б на одно имя" % size)
    finally:
        r.close()


def main():
    if not os.path.exists(BINARY):
        print("  FAIL движок не собран: %s" % BINARY)
        return 1
    print("1. Корреляция протокола")
    test_correlation()
    print("2. Аудио без устройства")
    test_audio()
    print("3. Интроспекция API")
    test_introspection()

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
