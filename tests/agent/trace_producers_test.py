#!/usr/bin/env python3
# ===========================================================================
# §23 плана дополировки: журнал событий должен наполняться не только боем.
#
# $.trace (§13) уже собирал события боя и сцен. Для вкладки EVENTS нужны ещё
# три источника: звук, ввод и горячая перезагрузка. Здесь проверяется, что:
#   * при выключенной трассировке журнал пуст (opt-in сохраняется);
#   * $.sound.play/stop пишут записи вида audio с именем, каналом и действием;
#   * рёбра ввода (клавиша, кнопка мыши, колесо) пишут записи input с кодом;
#   * $.trace.on(false) снова перестаёт писать;
#   * кольцо не растёт бесконечно (limit), счётчик dropped честный.
#
# Запуск (после сборки движка):
#   python3 tests/agent/trace_producers_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "trace")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def kinds(a):
    return [e["kind"] for e in a.eval("$.trace.list()") or []]


def main():
    with Agent(game=GAME, seed=5) as a:
        a.step(3)

        # --- 1. По умолчанию трассировка выключена ---------------------------
        a.eval("$.sound.play('assets/hit.wav'); $.input.synthPress('space'); 'ok'")
        a.step(2)
        check(a.eval("$.trace.on()") is False, "трассировка по умолчанию выключена")
        check(len(a.eval("$.trace.list()") or []) == 0,
              "при выключенной трассировке журнал пуст (opt-in)")

        # --- 2. Звук пишется ------------------------------------------------
        a.eval("$.trace.on(true); $.sound.play('assets/hit.wav', { volume: 0.5 }); 'ok'")
        a.step(2)
        audio = [e for e in a.eval("$.trace.list()") if e["kind"] == "audio"]
        check(len(audio) >= 1, "звук попал в журнал (%d записей)" % len(audio))
        if audio:
            entry = audio[-1]
            check(entry["data"] and entry["data"].get("action") == "play",
                  "у записи звука действие play: %s" % (entry["data"],))
            check(entry["data"].get("name"), "у записи звука есть имя: %s" % entry["data"].get("name"))
            check(isinstance(entry["data"].get("channel"), int),
                  "у записи звука есть канал: %s" % entry["data"].get("channel"))
            check(entry["frame"] >= 0, "запись знает номер кадра: %s" % entry["frame"])

        # --- 3. Ввод пишется ------------------------------------------------
        before = len(a.eval("$.trace.list()"))
        a.eval("$.input.synthPress('space'); 'ok'")
        a.step(2)
        a.eval("$.input.synthRelease('space'); 'ok'")
        a.step(2)
        input_entries = [e for e in a.eval("$.trace.list()") if e["kind"] == "input"]
        check(len(input_entries) >= 1,
              "рёбра ввода попали в журнал (%d записей, было %d)"
              % (len(input_entries), before))
        codes = [e["data"].get("code") for e in input_entries if e["data"]]
        check(any(isinstance(c, int) for c in codes),
              "у записи ввода есть код клавиши: %s" % codes[:4])

        # --- 4. Выключение снова глушит журнал -------------------------------
        a.eval("$.trace.on(false); 'ok'")
        frozen = len(a.eval("$.trace.list()"))
        a.eval("$.sound.play('assets/hit.wav'); $.input.synthPress('space'); 'ok'")
        a.step(2)
        check(len(a.eval("$.trace.list()")) == frozen,
              "после выключения новых записей нет (%d)" % len(a.eval("$.trace.list()")))

        # --- 5. Кольцо ограничено, потери честные ----------------------------
        a.eval("$.trace.clear(); $.trace.on(true); 'ok'")
        a.eval("for (let i = 0; i < 400; i++) $.trace.note('test', null, { i }); 'ok'")
        listed = len(a.eval("$.trace.list()"))
        dropped = a.eval("$.trace.dropped()")
        limit = a.eval("$.trace.limit")
        check(listed == limit, "журнал не длиннее limit (%d из %d)" % (listed, limit))
        check(dropped == 400 - limit, "потери посчитаны честно: %d" % dropped)
        # Всего записей = в кольце + вытеснено: журнал не «теряет» счёт,
        # даже когда записи вытесняются переполнением.
        check(listed + dropped == 400,
              "в кольце + вытеснено = всем записанным (%d + %d)" % (listed, dropped))

        # --- 6. Чтение журнала: категории, filter/read, export ---------------
        # В кольце сейчас только note('test') — вид игры попадает в 'other'.
        snapshot = a.eval("$.trace.list()")
        listed_kinds = [e["kind"] for e in snapshot]
        check(a.eval("$.trace.filter({kind: 'test'}).length") == len(listed_kinds),
              "filter по точному виду возвращает весь журнал test")
        check(a.eval("$.trace.categories()") == ["other"],
              "categories(): присутствующие категории по алфавиту (%s)"
              % (a.eval("$.trace.categories()"),))
        check(a.eval("$.trace.filter({category: 'other'}).length") == len(listed_kinds),
              "filter по category=other видит записи игры")
        check(a.eval("$.trace.filter({category: 'combat'}).length") == 0,
              "filter по отсутствующей категории пуст")

        tail = a.eval("$.trace.filter({limit: 3})")
        check(len(tail) == 3, "limit — последние 3 записи (%d)" % len(tail))
        check(tail[-1]["n"] == snapshot[-1]["n"],
              "limit сохраняет порядок старый→новый (последняя запись — самая свежая)")
        last_n = snapshot[-1]["n"]
        check(a.eval("$.trace.filter({since: %d}).length" % last_n) == 0,
              "since=last n не отдаёт уже прочитанное")
        check(a.eval("$.trace.filter({since: %d}).length" % (last_n - 3)) == 3,
              "since отдаёт только записи после курсора")

        first_frame = snapshot[0]["frame"]
        framed = a.eval("$.trace.filter({from: %d, to: %d})" % (first_frame, first_frame))
        check(all(e["frame"] == first_frame for e in framed),
              "from/to — кадры включительно (%d записей кадра %d)" % (len(framed), first_frame))

        a.eval("$.trace.note('probe', $('<rect>', {id: 'trace_probe'}).get(0), {action: 'x'}); 'ok'")
        selected = a.eval("$.trace.filter({selector: '#trace_probe'})")
        check(len(selected) == 1 and selected[0]["kind"] == "probe",
              "selector резолвится через query(sel) → nid: %s" % (len(selected),))

        exported = a.eval("$.trace.export()")
        rows = json.loads(exported)
        check(isinstance(rows, list) and len(rows) == len(a.eval("$.trace.list()")),
              "export json — массив всех отфильтрованных записей (%d)" % len(rows))
        check(set(rows[0].keys()) == {"kind", "frame", "source", "target", "data"},
              "export json: ровно kind/frame/source/target/data")
        text_lines = a.eval("$.trace.export({format: 'text'})").split("\n")
        check(len(text_lines) == len(rows) and all(line.startswith("frame ") for line in text_lines),
              "export text — по строке 'frame …' на запись (%d)" % len(text_lines))

        check(a.eval("$.trace.read({limit: 5}).length") == 5,
              "read — то же чтение, что filter (limit 5)")
        check(a.eval("$.trace.filter({category: 'nope'}).length") == 0,
              "неизвестная категория — пусто, без исключения")

        a.eval("$.trace.clear(); 'ok'")
        check(a.eval("$.trace.filter({}).length") == 0, "clear(): filter пуст")
        check(a.eval("$.trace.read({}).length") == 0, "clear(): read пуст")
        check(a.eval("$.trace.categories()") == [], "clear(): categories пуст")
        check(a.eval("$.trace.export()") == "[]", "clear(): export json — []")

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
