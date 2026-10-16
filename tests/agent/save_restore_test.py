#!/usr/bin/env python3
# ===========================================================================
# Приёмка §10/§14/§26: restore «живого» состояния, протокол слота и диска,
# статистика и детерминизм.
#
# Гоняет фикстуру tests/fixtures/save_restore: герой в прыжке, летящая пуля,
# враг с cooldown и фазовый противник. Проверяются ЧИСЛА: скорости и hp после
# restore, счётчики подписок/таймеров/фабрик до и после, значения статистики,
# события и hash двух прогонов.
#
# Запуск после сборки:
#   python3 tests/agent/save_restore_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "save_restore")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def watch(a):
    return a.eval("SR.watch()")


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        check(a.eval("!!(globalThis.SR && SR.ready)") is True, "фикстура restore готова")

        # --- §14: restore «во время действия» ---------------------------------
        check(a.eval("SR.build()") == 4, "мир собран: герой, пуля, два врага")
        subs_before = a.eval("$.signal.count()")
        check(a.eval("SR.save(1)") is True, "слот 1 записан")
        before = watch(a)
        check(before["hero_v"][1] == -320, f"герой в прыжке: vy={before['hero_v'][1]}")
        check(before["shot_v"][0] == 300, f"пуля в полёте: vx={before['shot_v'][0]}")

        a.eval("SR.breakState()")
        broken = watch(a)
        check(broken["hero_v"] == [0, 0] and broken["walker_cd"] == 9,
              "состояние сбито: скорости нули, cooldown 9")

        check(a.eval("SR.restore(1)") is True, "load(1) восстановил слот")
        after = watch(a)
        check(after["hero_hp"] == 100, "hp героя восстановлен фабрикой")
        check(after["hero_v"] == [40, -320], f"скорость прыжка восстановлена по nid: {after['hero_v']}")
        check(after["hero_jump"] == 1 and after["hero_phase"] == "jump",
              "логический статус героя (прыжок) восстановлен")
        check(after["shot_v"] == [300, -60], f"летящая пуля продолжает полёт: {after['shot_v']}")
        check(abs(after["shot_ttl"] - 1.5) < 1e-6, "ttl снаряда восстановлен")
        check(abs(after["walker_cd"] - 0.4) < 1e-6, "cooldown врага восстановлен")
        check(after["walker_phase"] == "windup", "фаза врага восстановлена")
        check(after["boss_cd"] == 1.2 and after["boss_phase"] == "phase2",
              "фазовый противник вернулся в свою фазу")
        check(after["nodes"] == before["nodes"], "число узлов совпало со снимком")

        # --- §14: подписки и таймеры ставятся ОДИН раз ------------------------
        check(after["subs"] - subs_before == 3,
              f"подписки: +{after['subs'] - subs_before} на 3 «проведённых» узла")
        check(after["live_timers"] == 3, f"живых таймеров: {after['live_timers']}")
        check(a.eval("SR.ping('hero')") == 1, "подписка героя сработала ровно один раз")
        check(after["behavior_loads"] - before["behavior_loads"] == 4,
              f"фабрики вызваны по разу на узел: {after['behavior_loads'] - before['behavior_loads']}")

        check(a.eval("SR.restore(1)") is True, "повторный restore")
        again = watch(a)
        check(again["subs"] == after["subs"],
              f"повторный restore не удваивает подписки: {again['subs']} == {after['subs']}")
        check(again["live_timers"] == after["live_timers"],
              f"и не удваивает таймеры: {again['live_timers']} == {after['live_timers']}")

        # --- §14: death/retry не считает статистику дважды --------------------
        a.eval("SR.save(4)")
        check(a.eval("SR.die()") == 1, "смерть увеличила статистику прохождения до 1")
        check(a.eval("SR.restore(4)") is True, "retry: загрузка слота до смерти")
        check(a.eval("$.save.counter('deaths')") == 0,
              "статистика прохождения вернулась к значению слота, а не удвоилась")
        check(a.eval("SR.C.deaths") == 1, "событие смерти в сессии посчитано один раз")
        check(a.eval("SR.die()") == 1, "вторая смерть даёт 1, а не 2")

        # --- §26: два прогона одного сценария совпадают -----------------------
        a.eval("SR.save(5)")
        a.eval("SR.restore(5)")
        run1 = a.eval("SR.scenario()")
        a.eval("SR.restore(5)")
        run2 = a.eval("SR.scenario()")
        check(run1 == run2, f"события и hash двух прогонов совпали: {run1['hash']}")
        print(f"  --   сценарий: {run1['events']} hash {run1['hash']}")

        # Косметика (presentation-поток RNG) не меняет генерацию и урон.
        a.eval("SR.restore(5)")
        clean = a.eval("SR.scenario()")
        a.eval("SR.restore(5)")
        a.eval("SR.cosmetic()")
        a.eval("SR.cosmetic()")
        cosmetic = a.eval("SR.scenario()")
        check(cosmetic["gen"] == clean["gen"], "косметика не изменила генерацию")
        check(cosmetic["dmg"] == clean["dmg"], "косметика не изменила урон")
        check(cosmetic["hash"] == clean["hash"], "и hash сценария тот же")

        # --- §26: RNG продолжает последовательность с нужной точки ------------
        a.eval("SR.build()")
        state = a.eval("SR.rngState()")
        first = a.eval("SR.genNumbers()")
        a.eval("SR.rngRestore(%s)" % json.dumps(state))
        second = a.eval("SR.genNumbers()")
        check(first == second, f"restore RNG продолжил последовательность: {first} == {second}")
        before_dmg = a.eval("SR.damage()")
        a.eval("SR.rngRestore(%s)" % json.dumps(state))
        check(a.eval("SR.damage()") == before_dmg, "и урон тоже воспроизводится")

        # --- §14: диск — backup, битый слот, версия из будущего ----------------
        slot2 = a.eval("$.save.path(2)")
        check(a.eval("SR.save(2)") is True, "слот 2 записан")
        check(a.eval("SR.save(2)") is True, "слот 2 перезаписан — появился backup")
        check(a.eval("SR.exists('%s.bak')" % slot2) is True, "backup последней версии лежит рядом")
        check(a.eval("SR.stats().temp_writes") >= 2, "записи идут через временный файл")

        a.eval("SR.writeText('%s', '{ сломано')" % slot2)
        check(a.eval("SR.restore(2)") is True, "битый основной файл: слот взят из backup")
        check(a.eval("SR.stats().recovered") >= 1, "восстановление посчитано")
        check(a.eval("SR.readText('%s').indexOf('сломано') > 0" % slot2) is True,
              "load взял backup, основной файл остался битым (лечим явно)")
        check(a.eval("SR.recover(2)") is True, "recover вылечил слот из backup")
        check(a.eval("SR.readText('%s').indexOf('r2d.save') > 0" % slot2) is True,
              "после recover основной файл снова валиден")

        future = a.eval("$.save.path('future')")
        a.eval("SR.writeText('%s', JSON.stringify({format:'r2d.save', version: 99, namespaces:{}}))" % future)
        check(a.eval("SR.restore('future')") is False, "слот версии из будущего отклонён")
        check("новее" in (a.eval("$.save.stats().last_error") or ""),
              "причина отказа понятна: " + str(a.eval("$.save.stats().last_error")))
        check(a.eval("SR.restore(2)") is True, "после отказа последний корректный слот цел")
        check(a.eval("SR.restore('нет-такого')") is False, "несуществующий слот — false, без исключения")

        # --- §14: недостающий ассет не отменяет восстановление ----------------
        a.eval("SR.writeBrokenAsset(3)")
        got = a.eval("SR.restore(3)")
        check(got is True, "слот с недостающим ассетом всё равно восстанавливается")
        check(a.eval("$('#hero').length") == 1, "узлы сцены на месте")
        check(a.eval("$.save.stats().restores") >= 4, "stats() считает восстановления")

        # --- §26: заголовок, actions, state hash, divergence -------------------
        a.eval("SR.replayIdentity({ version: '0.1.31-test', build: 'fixture' })")
        a.eval("SR.replayActions(['left', 'right'])")
        a.eval("SR.replayWatchHash(5)")
        # Записываем прогон ИЗ ЗАГРУЖЕННОГО слота: nid узлов приходят из
        # снимка, поэтому состояние сравнимо между прогонами (в новом процессе
        # nid тоже начинаются с одних и тех же значений).
        a.eval("SR.build(); SR.save('replay_base')")
        a.eval("SR.restore('replay_base')")
        a.eval("SR.replayRecord()")
        a.hold(["Right"])
        a.step(22)
        a.release_all()
        a.eval("SR.replayStop()")

        header = a.eval("SR.replayHeader()")
        check(header.get("schema") == "r2d.replay", "схема записи в заголовке")
        check(header.get("version") == 2, "версия записи в заголовке")
        check(header.get("engine", {}).get("version") == "0.1.31-test",
              "ID движка/сборки в заголовке")
        check(header.get("input", {}).get("actions") == ["left", "right"],
              "разрешённые actions в заголовке")
        check(header.get("input", {}).get("mapping") == "fixture/v1", "версия input mapping")
        check(header.get("streams") is not None, "снимок RNG (seed/streams) в заголовке")
        check(abs(header.get("dt", 0) - 1.0 / 60.0) < 1e-6, "fixed step в заголовке")
        check(header.get("checkpoints", {}).get("count", 0) >= 4,
              f"checkpoints state hash: {header.get('checkpoints')}")
        print(f"  --   header: schema={header.get('schema')} v{header.get('version')} "
              f"checkpoints={header.get('checkpoints')}")

        text = a.eval("SR.replayText()")
        parsed = json.loads(text)
        acts = []
        for f in parsed["frames"][:6]:
            if f[1]:
                payload = json.loads(f[1])
                if isinstance(payload, dict) and payload.get("a"):
                    acts.append(payload["a"])
        check(any("right" in one for one in acts),
              f"ввод записан на уровне actions: {acts[:3]}")
        check(len(parsed.get("checks", [])) >= 4, "в тексте записи есть checkpoints")

        # Чистое воспроизведение: состояние сходится на каждом checkpoint.
        a.eval("SR.replayLoad(%s)" % json.dumps(text))
        a.eval("SR.restore('replay_base')")
        a.eval("SR.replayPlay()")
        a.step(22)
        a.eval("SR.replayStop()")
        check(a.eval("SR.replayDivergence()") is None, "чистый прогон: расхождений нет")

        # Внесённое расхождение: первый расходящийся tick и поля/IDs в отчёте.
        a.eval("SR.replayLoad(%s)" % json.dumps(text))
        a.eval("SR.restore('replay_base')")
        a.eval("SR.mismatchAfter = 7; SR.replayPlay()")
        a.step(22)
        a.eval("SR.replayStop()")
        div = a.eval("SR.replayDivergence()")
        check(div is not None, "расхождение найдено и разобрано")
        if div:
            check(div.get("tick") == 10,
                  f"первый расходящийся tick назван: {div.get('tick')} (ожидался 10)")
            fields = [f.get("field") for f in div.get("fields", [])]
            check(any(str(f).endswith(".x") for f in fields),
                  "в отчёте расходящееся поле позиции: " + ",".join(str(f) for f in fields[:4]))
            check(len(div.get("ids", [])) >= 1, "в отчёте ID узла: " + str(div.get("ids")))
            check(div.get("versions", {}).get("replay") == 2, "версия записи в отчёте")
            check(div.get("versions", {}).get("engine", {}).get("build") == "fixture",
                  "ID сборки в отчёте")
            print(f"  --   divergence: tick={div.get('tick')} fields={fields[:3]} "
                  f"ids={div.get('ids')} replay=v{div.get('versions', {}).get('replay')}")

        check(a.ping().get("pong") is True, "движок жив после всех сценариев")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
