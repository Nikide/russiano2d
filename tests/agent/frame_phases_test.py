#!/usr/bin/env python3
# ===========================================================================
# §4.3 Спецификации: документированный контракт фаз кадра.
#
# Проверяется не «наличие порядка», а конкретные обязательства:
#   * код игры выполняется после синхронизации физики и рассылки контактов —
#     значит контакт этого кадра виден логике в том же кадре, а не в следующем;
#   * удаление узла внутри обработчика контакта безопасно, а удалённый узел не
#     получает кадровых вызовов (§4.3: «удалённый узел не продолжает получать
#     callbacks»);
#   * узлы получают `nid` — устойчивый логический ID (§4.2, §14), он же попадает
#     в события контакта (§13);
#   * журнал трассировки `$.trace` показывает фактическую цепочку событий и
#     ограничен по размеру (§28).
#
# Запуск:
#   python3 tests/agent/frame_phases_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/frame_phases_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "frame_phases")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(30)
        # Поля события §13 доступны и в обычном обработчике: проверяем на
        # последнем контакте, который записала фикстура.
        phases = a.eval("globalThis.__phases") or []
        nids = a.eval("globalThis.__nids") or {}
        # Журнал трассировки отдаётся агенту полем снимка (см. фикстуру):
        # читать его надо из state(), а не из globalThis.
        trace = a.state().get("trace_entries") or []

        # --- Фазы в документированном порядке --------------------------------
        joined = ",".join(phases)
        check(phases.count("ready") == 1, "ready выполнен ровно один раз")
        ready_at = phases.index("ready")
        upd_at = phases.index("game_update")
        check(ready_at < upd_at, "ready идёт до логики игры")

        # Порядок фаз 6→7: обновление сцены идёт ДО хуков $.update. Сравниваем
        # метки ОДНОГО кадра после входа в сцену (до входа мир ещё пуст).
        check("scene_update" in phases, "сцена обновляется (фаза 6)")
        if "scene_enter" in phases:
            after = phases.index("scene_enter")
            s_upd = next((i for i, p in enumerate(phases) if p == "scene_update" and i > after), None)
            f_upd = next((i for i, p in enumerate(phases) if p == "game_update" and i > after), None)
            check(s_upd is not None and f_upd is not None and s_upd < f_upd,
                  "обновление сцены раньше хуков $.update (scene=%s, frame=%s)" % (s_upd, f_upd))
        check(any(str(p).startswith("collide:") for p in phases),
              "сенсорный контакт пришёл обработчику узла")

        check(phases.count("game_update") >= 25, "код игры вызывается каждый кадр")

        # Событие несёт устойчивые ID участников (§13), а не «[object Object]».
        contact = next((p for p in phases if str(p).startswith("collide:")), "")
        check(contact.count("n") >= 2 and "[object" not in contact,
              "контакт сообщает source_id>target_id: %s" % contact)

        # --- Удаление в callback и «мёртвый» узел ----------------------------
        check("removed-in-callback" in phases, "узел удалён внутри обработчика контакта")
        check((a.eval("globalThis.__tempAlive") or 0) == 2,
              "удалённый узел не получает кадровых вызовов после удаления (было %s)"
              % a.eval("globalThis.__tempAlive"))
        check((a.eval("globalThis.__goneHits") or 0) == 0,
              "удалённый в callback узел не получил ни одного события")

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, "в кадре нет ошибок игрового кода: %s" % errors[:2])

        # --- Стабильные логические ID ----------------------------------------
        check(isinstance(nids.get("mover"), str) and nids["mover"].startswith("n"),
              "у узла есть nid вида 'n<число>' (%s)" % nids.get("mover"))
        check(nids.get("mover") != nids.get("platform"), "nid у разных узлов разные")
        check(a.eval("$('#mover').nid()") == nids.get("mover"), ".nid() возвращает тот же ID")
        check(a.eval("$('#nosuch').nid()") is None, ".nid() на пустой выборке — null")

        # nid переживает снимок узла (prefab data) — на нём строится save/restore.
        snapshot_nid = a.eval("$.prefab.save($('#mover')).nid")
        check(snapshot_nid == nids.get("mover"),
              "nid попадает в снимок узла (%s)" % snapshot_nid)

        # --- Журнал трассировки ----------------------------------------------
        check(a.eval("$.trace.on()") is True, "трассировка включена")
        trace = a.state().get("trace_entries") or []
        kinds = [str(t).split(":")[0] for t in trace]
        check(len(trace) > 0, "журнал трассировки непуст (%d записей)" % len(trace))
        check(any(k in ("collide", "hit", "separate") for k in kinds),
              "в журнале есть события контакта: %s" % kinds[:6])
        check(all(">" in str(t) for t in trace), "записи содержат source>target")
        check(isinstance(a.eval("$.trace.limit"), int) and a.eval("$.trace.limit") > 0,
              "у журнала есть ограничение размера (%s)" % a.eval("$.trace.limit"))
        check(a.eval("$.trace.dropped()") >= 0, "счётчик вытесненных записей доступен")

        # Кольцо не растёт бесконечно: список никогда не больше лимита.
        limit = a.eval("$.trace.limit")
        check(len(trace) <= limit, "журнал ограничен лимитом (%d <= %d)" % (len(trace), limit))

        # --- Выключенная трассировка не пишет --------------------------------
        a.eval("$.trace.clear(); $.trace.on(false)")
        a.step(4)
        check(len(a.eval("$.trace.list()") or []) == 0, "выключенный журнал не пишет события")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
