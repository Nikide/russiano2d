#!/usr/bin/env python3
# ===========================================================================
# A6 + A8 (отчёт BASHNYA 0.1.34). Снимок мира: правда о здоровье и урезание.
#
# A6 — узел БЕЗ компонента здоровья не должен выглядеть мёртвым. Таблица
# приёмки (снята внешней командой с живого движка):
#   $('<enemy>')                  → hp 30, max_hp 30, alive true   (без изменений)
#   $('<sprite>', {class:'walker'}) → здоровья нет: alive null, hp/max_hp нет
#   $('<rect>')                   → здоровья нет: alive null, hp/max_hp нет
#   $('<rect>').health(30)        → hp 30, max_hp 30, alive true   (без изменений)
# Проверяются все три поверхности: команда `query`, `inspect` и `state.entities`.
# Ловушка: у тега <enemy> здоровье есть ПО УМОЛЧАНИЮ, поэтому «узел без
# здоровья» берётся у другого тега с классом врага.
#
# A8 — урезание снимка параметром команды `state`:
#   {"cmd":"state","entities":{"limit":50,"sel":".enemy","fields":["id","x","y"]}}
# На одном и том же мире (~770 узлов) меряются ДВА числа: размер JSON (КБ) и
# время ответа (мс), полный снимок против урезанного. Полный снимок БЕЗ
# параметра обязан остаться доступным и полным.
#
# Запуск (после сборки движка):
#   python3 tests/agent/agent_state_trim_test.py
# ===========================================================================

import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

WORK = os.path.join(ROOT, "build", "agent_state_trim")
CROWD = 770
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def prepare():
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    with open(os.path.join(WORK, "project.json"), "w", encoding="utf-8") as handle:
        handle.write('{"title":"state trim","version":"0.0.1","width":1280,"height":720}')
    with open(os.path.join(WORK, "main.js"), "w", encoding="utf-8") as handle:
        handle.write("""// Фикстура A6/A8: четыре случая здоровья и масса узлов для замера снимка.
$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    // A6: у тега <enemy> здоровье по умолчанию, у остальных — нет.
    $('<enemy>', { id: 'enemy_default' }).at(100, 100).appendTo($.world);
    $('<sprite>', { id: 'walker_sprite', class: 'walker' }).at(150, 100).size(16, 16).appendTo($.world);
    $('<rect>', { id: 'plain_rect' }).at(200, 100).size(16, 16).appendTo($.world);
    $('<rect>', { id: 'healed_rect' }).at(250, 100).size(16, 16).health(30).appendTo($.world);

    // A8: мир, на котором видно цену полного снимка.
    for (let i = 0; i < %d; i++) {
        $('<rect>', { class: 'crowd', id: 'crowd_' + i })
            .at((i %% 100) * 8, 300 + Math.floor(i / 100) * 8).size(6, 6).appendTo($.world);
    }
});
""" % CROWD)


def compact_size(response):
    """Размер ответа в том виде, в каком он уходит по протоколу."""
    return len(json.dumps(response, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def timed_state(a, repeats=5, **params):
    """Ответ команды state и среднее/минимальное время round-trip, мс."""
    sizes = []
    times = []
    last = None
    for _ in range(repeats):
        start = time.perf_counter()
        last = a.cmd("state", **params)
        times.append((time.perf_counter() - start) * 1000.0)
        sizes.append(compact_size(last))
    return last, sum(sizes) / len(sizes), sum(times) / len(times), min(times)


def node_fields(a, command, sel):
    """Описание узла: у `query` это nodes[0], у `inspect` — поле node."""
    if command == "query":
        nodes = a.cmd("query", sel=sel).get("nodes") or []
        return nodes[0] if nodes else None
    return a.cmd("inspect", sel=sel).get("node")


def main():
    prepare()
    with Agent(game=WORK, seed=11) as a:
        a.step(5)

        # ------------------------------------------------------------------
        # A6: правда о здоровье на трёх поверхностях
        # ------------------------------------------------------------------
        cases = [
            ("#enemy_default", {"hp": 30, "max_hp": 30, "alive": True}, "узел тега <enemy> (здоровье по умолчанию)"),
            ("#walker_sprite", {"alive": None}, "спрайт с классом врага, но без .health()"),
            ("#plain_rect", {"alive": None}, "обычный <rect> без .health()"),
            ("#healed_rect", {"hp": 30, "max_hp": 30, "alive": True}, "<rect> с .health(30)"),
        ]
        for sel, expect, title in cases:
            for command in ("query", "inspect"):
                node = node_fields(a, command, sel)
                check(isinstance(node, dict), "%s: узел найден (%s)" % (title, command))
                if not isinstance(node, dict):
                    continue
                if "hp" in expect:
                    check(node.get("hp") == expect["hp"] and node.get("max_hp") == expect["max_hp"],
                          "%s: %s отдаёт hp=%s max_hp=%s" % (title, command, node.get("hp"), node.get("max_hp")))
                else:
                    check("hp" not in node and "max_hp" not in node,
                          "%s: %s НЕ выдумывает hp/max_hp: %s" % (title, command,
                                                                  {k: node[k] for k in ("hp", "max_hp") if k in node}))
                check(node.get("alive") is expect["alive"],
                      "%s: %s отдаёт alive=%s" % (title, command, node.get("alive")))
            print("  --   %-46s query/inspect: alive=%s" % (title, expect["alive"]))

        state = a.cmd("state")["state"]
        by_id = {n.get("id"): n for n in state.get("entities", []) if n.get("id")}
        for sel, expect, title in cases:
            node = by_id.get(sel.lstrip("#"))
            check(isinstance(node, dict), "%s: узел есть в state.entities" % title)
            if not isinstance(node, dict):
                continue
            check(node.get("alive") is expect["alive"],
                  "%s: state.entities отдаёт alive=%s" % (title, node.get("alive")))
            if "hp" in expect:
                check(node.get("hp") == expect["hp"], "%s: state hp=%s" % (title, node.get("hp")))
            else:
                check("hp" not in node and "max_hp" not in node,
                      "%s: state не выдумывает hp/max_hp" % title)

        # ------------------------------------------------------------------
        # A8: цена полного и урезанного снимка на одном и том же мире
        # ------------------------------------------------------------------
        total_entities = len(state.get("entities", []))
        print("  --   сущностей в мире: %d" % total_entities)
        check(total_entities >= CROWD, "мир действительно большой: %d сущностей" % total_entities)
        check("entities_meta" not in state, "полный снимок без параметра не помечен урезанием")

        full, full_size, full_ms, full_min = timed_state(a)
        trimmed, trim_size, trim_ms, trim_min = timed_state(
            a, entities={"limit": 50, "sel": ".crowd", "fields": ["id", "x", "y"]})

        print("  --   полный   снимок: %6.1f КБ, %.1f мс (мин %.1f)"
              % (full_size / 1024.0, full_ms, full_min))
        print("  --   урезанный снимок: %6.1f КБ, %.1f мс (мин %.1f)"
              % (trim_size / 1024.0, trim_ms, trim_min))

        check(len(full["state"]["entities"]) == total_entities,
              "полный снимок содержит все сущности: %d" % len(full["state"]["entities"]))
        listed = trimmed["state"]["entities"]
        check(len(listed) == 50, "урезанный снимок содержит ровно limit=50: %d" % len(listed))
        check(all(str(n.get("id", "")).startswith("crowd_") for n in listed),
              "sel='.crowd' отобрал только нужные узлы: %s" % sorted(n.get("id") for n in listed)[:3])
        check(all(set(n.keys()) == {"id", "x", "y"} for n in listed),
              "в урезанном списке только запрошенные поля: %s" % sorted(listed[0].keys()))
        check(trimmed["state"]["world"]["count"] == total_entities,
              "world.count остаётся числом ВСЕХ сущностей: %s" % trimmed["state"]["world"]["count"])
        meta = trimmed["state"].get("entities_meta") or {}
        check(meta.get("total") == total_entities and meta.get("shown") == 50
              and meta.get("sel") == ".crowd" and meta.get("limit") == 50
              and meta.get("fields") == ["id", "x", "y"],
              "снимок сообщает, что и как урезано: %s" % meta)

        check(trim_size < full_size / 4,
              "урезанный снимок меньше вчетверо и более: %.1f КБ против %.1f КБ"
              % (trim_size / 1024.0, full_size / 1024.0))
        check(trim_ms <= full_ms,
              "урезанный снимок отвечает не медленнее: %.1f мс против %.1f мс" % (trim_ms, full_ms))

        # Полный снимок без параметра остаётся доступным после урезанных.
        again = a.cmd("state")["state"]
        check(len(again["entities"]) == total_entities and "entities_meta" not in again,
              "после урезанного запроса полный снимок по-прежнему полный")

        # Параметры-обрезки не ломают снимок: пустой объект — как полный.
        empty = a.cmd("state", entities={})["state"]
        check(len(empty["entities"]) == total_entities, "entities:{} не режет список")

        frames = a.eval("engine.frame")
        a.step(2)
        check(a.eval("engine.frame") > frames and a.ping().get("pong") is True, "движок отвечает")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
