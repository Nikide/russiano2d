#!/usr/bin/env python3
# ===========================================================================
# Пример §31-4 Спецификации: «Generated rooms» (demos/roguerooms).
#
# Проверяется законченный сценарий, а не наличие методов:
#   * два прогона с одним seed дают одинаковый hash комнаты и одинаковое число
#     платформ — при разном бюджете $.task тоже;
#   * validation до публикации: непригодный профиль отклоняется с причиной,
#     половина карты не публикуется (число тел до/после совпадает);
#   * бюджет: лимит шагов и лимит тиков ($.time.duration, §44) останавливают
#     генерацию с понятной причиной, меньший бюджет режется на больше кадров;
#   * checkpoint: `$.save` (разделы run/room, стабильные nid) возвращает ту же
#     комнату, позицию игрока, состояние узла и прогресс;
#   * restore во время генерации отменяет её и не публикует недоделанную карту
#     поверх текущей (в том числе задним числом).
#
# Запуск:
#   python3 tools/run_tests.py roguerooms_test
#   R2D_BINARY=build-2d/russiano2d python3 tools/run_tests.py roguerooms_test
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("demos", "roguerooms")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "roguerooms", "expected.json")
SAVE_DIR = "build/test_roguerooms"
FULL = {"budget": 1, "maxSteps": 8721, "maxTicks": 240, "maxAttempts": 3, "profile": "standard"}

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def errors_of(a):
    return [line.strip() for line in a.stderr_text().splitlines()
            if "$: ошибка" in line or "[error]" in line]


def wait_ready(a, iters=400, chunk=3):
    """Крутить кадры, пока задача генерации не завершится."""
    for _ in range(iters):
        if not a.eval("$.rooms.stats().generating"):
            return True
        a.step(chunk)
    return False


def start(a, seed, **opts):
    config = dict(FULL)
    config.update(opts)
    return a.eval("$.rooms.start(%d, %s)" % (seed, json.dumps(config)))


def room(a, seed, **opts):
    start(a, seed, **opts)
    ok = wait_ready(a)
    return ok, a.eval("$.rooms.stats()")


def main():
    with open(FIXTURE, encoding="utf-8") as fh:
        expected = json.load(fh)

    with Agent(game=GAME, seed=7) as a:
        a.step(10)
        check(a.eval("$.scene.current()") == "roguerooms", "сцена примера открылась")
        check(a.eval("$('#hero').length") == 1, "игрок создан")
        check(a.eval("typeof $.rooms.start") == "function"
              and a.eval("typeof $.rooms.restore") == "function"
              and a.eval("typeof $.rooms.checkpoint") == "function",
              "$.rooms доступен игре целиком")
        check(a.eval("$.rooms.dir('%s', { clear: true })" % SAVE_DIR) == SAVE_DIR,
              "каталог слотов примера изолирован (%s)" % SAVE_DIR)

        # --- Первая комната генерируется при входе в сцену ------------------
        ok = wait_ready(a)
        first = a.eval("$.rooms.stats()")
        check(ok and first["status"] == "published" and first["hash"],
              "комната сгенерирована при входе: %s" % first["hash"])
        check(first["cells"] == first["cols"] * first["rows"] == 2880,
              "комната %dx%d = %d клеток" % (first["cols"], first["rows"], first["cells"]))
        check(a.eval("$.random.hashCells($.rooms.cells()) === $.rooms.stats().hash") is True,
              "hash соответствует опубликованным клеткам")

        # --- Клавиши примера: R — следующая комната, C — checkpoint ---------
        a.tap("R")
        a.step(2)
        check(a.eval("$.rooms.stats().generating") is True
              and a.eval("$.rooms.stats().depth") == 1,
              "R запускает следующую комнату (глубина 1)")
        wait_ready(a)
        next_hash = a.eval("$.rooms.stats().hash")
        check(next_hash and next_hash != first["hash"],
              "новая комната отличается по hash (%s ≠ %s)" % (next_hash, first["hash"]))
        a.tap("C")
        a.step(2)
        check(a.eval("$.save.exists('room')") is True, "C пишет checkpoint в слот room")
        a.eval("$.save.remove('room')")

        # --- 1. Один seed — одна комната, разный бюджет — та же комната -----
        ok, r1 = room(a, 42)
        exp = expected["rooms"]["standard42"]
        check(ok and r1["status"] == "published" and r1["hash"] == exp["hash"]
              and r1["platforms"] == exp["platforms"],
              "seed 42: эталонный hash %s, платформ %d" % (r1["hash"], r1["platforms"]))
        check(r1["steps"] == exp["steps"] and r1["steps"] <= r1["maxSteps"],
              "шагов %d (эталон %d, потолок %d)" % (r1["steps"], exp["steps"], r1["maxSteps"]))

        ok, r2 = room(a, 42)
        check(r2["hash"] == r1["hash"] and r2["platforms"] == r1["platforms"]
              and r2["steps"] == r1["steps"],
              "повторный прогон того же seed: тот же hash, платформы и шаги")

        ok, small = room(a, 42, budget=1)
        ok, large = room(a, 42, budget=8)
        check(small["hash"] == large["hash"] == exp["hash"],
              "бюджет 1 и 8 мс/кадр — один и тот же hash %s" % small["hash"])
        check(small["frames"] > large["frames"],
              "меньший бюджет режется на больше кадров (%d > %d)"
              % (small["frames"], large["frames"]))
        check(small["maxStepsPerFrame"] < large["maxStepsPerFrame"],
              "меньший бюджет — меньше шагов на кадр (%d < %d)"
              % (small["maxStepsPerFrame"], large["maxStepsPerFrame"]))
        check(small["ticks"] <= small["maxTicks"] and large["ticks"] <= large["maxTicks"],
              "тиков не больше лимита (%d/%d и %d/%d)"
              % (small["ticks"], small["maxTicks"], large["ticks"], large["maxTicks"]))

        # --- 2. Второй профиль и retry с derived seed -----------------------
        ok, dense = room(a, 7, profile="dense")
        exp_dense = expected["rooms"]["dense7"]
        check(dense["hash"] == exp_dense["hash"] and dense["platforms"] == exp_dense["platforms"]
              and dense["hash"] != r1["hash"],
              "профиль dense: свой hash %s (%d платформ), отличный от standard"
              % (dense["hash"], dense["platforms"]))

        ok, retry = room(a, 7)
        exp_retry = expected["rooms"]["standard7"]
        check(retry["hash"] == exp_retry["hash"] and retry["platforms"] == exp_retry["platforms"],
              "seed 7: эталонный hash %s" % retry["hash"])
        check(retry["attempt"] == 2 and retry["attemptSeeds"] == [7]
              and retry["attemptLog"][0]["reasons"][0].startswith("спавн в опасной зоне"),
              "первая попытка отклонена (%s), retry с derived seed %d"
              % (retry["attemptLog"][0]["reasons"][0], retry["derivedSeed"]))
        check(a.eval("$.rooms.verify($.rooms.stats().derivedSeed, 'standard')") == retry["hash"],
              "hash воспроизводится из derived seed без генерации")

        # --- 3. Бюджет шагов: отказ с причиной, без публикации --------------
        hash_before = a.eval("$.rooms.stats().hash")
        walls_before = a.eval("$('.room-wall').length")
        nodes_before = a.eval("$.world.count()")
        ok, limited = room(a, 42, maxSteps=100)
        check(ok and limited["status"] == "rejected" and "шагов" in limited["reason"],
              "лимит шагов: отказ с причиной %r" % limited["reason"])
        check(limited["steps"] <= 101, "генерация остановлена на %d шаге" % limited["steps"])
        check(a.eval("$.rooms.stats().hash") == hash_before
              and a.eval("$('.room-wall').length") == walls_before,
              "лимит шагов не публикует комнату")

        # --- 4. Бюджет тиков (§44): отказ до работы -------------------------
        ok, no_ticks = room(a, 42, maxTicks=0)
        check(ok and no_ticks["status"] == "rejected" and "тиков" in no_ticks["reason"],
              "лимит тиков: отказ с причиной %r" % no_ticks["reason"])
        check(no_ticks["steps"] == 1, "отказ по тикам до работы (шагов %d)" % no_ticks["steps"])
        check(a.eval("$.rooms.stats().hash") == hash_before,
              "лимит тиков не публикует комнату")

        # --- 5. Невалидный профиль: 3 попытки и никакой публикации ----------
        ok, broken = room(a, 7, profile="broken")
        check(ok and broken["status"] == "rejected" and broken["reason"],
              "broken: отказ с причиной %r" % broken["reason"])
        check(broken["attempts"] == 3
              and broken["attemptSeeds"] == expected["broken"]["attemptSeeds"],
              "broken: 3 попытки с derived seed %s" % broken["attemptSeeds"])
        check(broken["hash"] == hash_before, "broken: текущая комната осталась прежней (%s)" % broken["hash"])
        check(a.eval("$.world.count()") == nodes_before
              and a.eval("$('.room-wall').length") == walls_before,
              "broken: половина карты не опубликована (тел %d, стен %d)"
              % (a.eval("$.world.count()"), a.eval("$('.room-wall').length")))

        # --- 6. Checkpoint середины пути ------------------------------------
        ok, room_a = room(a, 7, profile="dense")
        hash_a, platforms_a = room_a["hash"], room_a["platforms"]
        a.eval("$.save.setNodeState('#hero', { hp: 42, tag: 'mid' })")
        hero_pos = a.eval("$('#hero').pos()")
        hero_nid = a.eval("$('#hero').nid()")
        check(a.eval("$.rooms.checkpoint('mid')") is True, "checkpoint записан")
        check(a.eval("$.save.exists('mid')") is True, "слот checkpoint на месте")
        check(a.eval("$.save.read('mid').namespaces.run.data['rooms.hash']") == hash_a,
              "в слот уехал hash комнаты")

        ok, room_b = room(a, 42)
        check(room_b["hash"] != hash_a, "до restore в мире другая комната (%s ≠ %s)"
              % (room_b["hash"], hash_a))
        a.eval("$('#hero').at(64, 64); $.save.setNodeState('#hero', { hp: 1, tag: 'changed' });"
               " $.store.set('rooms.progress', 99)")
        check(a.eval("$.rooms.restore('mid')") is True, "restore середины пути прошёл")
        restored = a.eval("$.rooms.stats()")
        check(restored["hash"] == hash_a and restored["platforms"] == platforms_a,
              "restore вернул ту же комнату %s (%d платформ)" % (hash_a, platforms_a))
        check(a.eval("$('.room-wall').length") == platforms_a,
              "мир комнаты восстановлен целиком (%d стен)" % platforms_a)
        pos = a.eval("$('#hero').pos()")
        check(abs(pos["x"] - hero_pos["x"]) < 0.5 and abs(pos["y"] - hero_pos["y"]) < 0.5,
              "позиция игрока восстановлена (%.0f, %.0f)" % (pos["x"], pos["y"]))
        check(a.eval("$('#hero').nid()") == hero_nid, "nid игрока стабилен (%s)" % hero_nid)
        node_state = a.eval("$.save.getNodeState('#hero')")
        check(isinstance(node_state, dict) and node_state.get("m", {}).get("hp") == 42,
              "состояние узла по nid восстановлено: %r" % node_state)
        check(a.eval("$.store.get('rooms.progress')") == restored["depth"],
              "прогресс восстановлен (глубина %d)" % restored["depth"])

        # --- 7. Restore во время генерации ----------------------------------
        hash_now = a.eval("$.rooms.stats().hash")
        walls_now = a.eval("$('.room-wall').length")
        start(a, 555)
        check(a.eval("$.rooms.stats().generating") is True
              and a.eval("$.rooms.stats().hash") == hash_now,
              "во время генерации текущая комната не тронута")
        a.step(2)
        check(a.eval("$('.room-wall').length") == walls_now,
              "пока генерация идёт, половина карты не публикуется")
        abandoned_before = a.eval("$.rooms.stats().abandoned")
        check(a.eval("$.rooms.restore('mid')") is True, "restore поверх идущей генерации")
        check(a.eval("$.rooms.stats().generating") is False, "генерация отменена")
        check(a.eval("$.rooms.stats().abandoned") > abandoned_before,
              "отмена генерации посчитана (%d → %d)"
              % (abandoned_before, a.eval("$.rooms.stats().abandoned")))
        check(a.eval("$.rooms.stats().hash") == hash_now
              and a.eval("$('.room-wall').length") == walls_now,
              "после restore — прежняя комната, а не отменённая")
        a.step(20)
        check(a.eval("$.rooms.stats().hash") == hash_now
              and a.eval("$('.room-wall').length") == walls_now,
              "отменённая генерация не публикуется задним числом")

        # --- HUD и чистота журнала ------------------------------------------
        check("бюджет" in a.eval("$('#hud-budget').text()"),
              "HUD показывает бюджет генерации: %s" % a.eval("$('#hud-budget').text()")[:60])
        check(a.eval("$('#hud-room').text()").startswith("Комната"),
              "HUD показывает комнату и seed")
        errors = errors_of(a)
        check(not errors, "в примере нет ошибок игрового кода: %s" % errors[:2])

    print("\nВсе проверки пройдены" if not FAILURES else "\nПРОВАЛЕНО: %d" % len(FAILURES))
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
