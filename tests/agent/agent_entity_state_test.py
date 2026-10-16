#!/usr/bin/env python3
# ===========================================================================
# BASHNYA H7 (task-59): объявляемое наблюдаемое состояние сущности.
#
# Что проверяется на живом движке:
#   * `$.fn.expose` — семантика: копия без аргумента, слияние объектом,
#     чтение/запись одного ключа, снятие ключа, лимиты (≤32 ключа, строки
#     ≤64 символов, вложенное → null);
#   * снимок агента: поля `exposed`, `state`, `state_time` появляются ТОЛЬКО по
#     запросу в `state.entities.fields` — по умолчанию снимок не растёт;
#   * состояние машины анимации видно снаружи (`fields:["state"]`) — это
#     закрывает исходный пример H7 с `attrs.clip` без нового API;
#   * ЗАМЕР размера: `fields:["id"]` против `fields:["id","exposed"]` на 200
#     узлах (урок A8: снимок уже раздувался до 168 КБ, повторять нельзя).
#
# Запуск: python3 tests/agent/agent_entity_state_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

BINARY = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "russiano2d"))
NODES = 200

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def note(message):
    print("  --   " + message)


SPAWN = """
(() => {
    for (let i = 0; i < %d; ++i) {
        const n = $('<rect>', { id: 'e' + i }).size(4, 4).appendTo($.world);
        n.expose({ team: i %% 3, alert: i, nested: { x: 1 }, long: 'z'.repeat(80) });
    }
    const m = $('<rect>', { id: 'fsm' }).size(4, 4).appendTo($.world);
    m.stateMachine({ initial: 'walk', states: { walk: {}, run: {} } });
    return $.world.count();
})()
""" % NODES


def snapshot_size(a, **entities):
    """Размер ответа `state` (без служебного `id`, который снимает клиент).

    Методика одинаковая для всех трёх замеров, поэтому разница честная."""
    raw = a.cmd("state", entities=entities)
    return len(json.dumps(raw, ensure_ascii=False)), raw


def main():
    if not os.path.exists(BINARY):
        print("  FAIL движок не собран: %s" % BINARY)
        return 1

    with Agent(binary=BINARY, game=os.path.join(ROOT, "game"), seed=7) as a:
        check(a.eval("typeof $.fn.expose") == "function", "$.fn.expose объявлен")
        count = a.eval(SPAWN)
        note("узлов создано: %s (из них 1 с машиной анимации)" % count)

        # --- 1. Семантика expose ------------------------------------------
        check(a.eval("$('#e7').expose('team')") == 1,
              "чтение ключа: $('#e7').expose('team') = %s" % a.eval("$('#e7').expose('team')"))
        a.eval("$('#e7').expose('alert', 9)")
        check(a.eval("$('#e7').expose('alert')") == 9, "запись ключа: alert = 9")
        a.eval("$('#e7').expose({ extra: 'да' })")
        check(a.eval("$('#e7').expose('extra')") == "да", "слияние объектом не теряет прежние ключи")
        check(a.eval("$('#e7').expose('team')") == 1, "…и прежний ключ жив")
        a.eval("$('#e7').expose('alert', undefined)")
        check(a.eval("$('#e7').expose('alert')") is None, "снятие ключа: alert исчез")

        # Копия: правка результата не меняет состояние узла.
        check(a.eval("(() => { const c = $('#e7').expose(); c.team = 999;"
                     " return $('#e7').expose('team'); })()") == 1,
              "expose() отдаёт копию, а не сам мешок")

        # Лимиты.
        check(a.eval("(() => { const o = {}; for (let i = 0; i < 40; ++i) o['k' + i] = i;"
                     " $('#e8').expose(o); return Object.keys($('#e8').expose()).length; })()") <= 32,
              "ключей не больше 32")
        check(a.eval("$('#e8').expose('long').length") == 64,
              "длинная строка обрезана до 64 символов")
        check(a.eval("$('#e8').expose('nested')") is None,
              "вложенный объект отдан как null (не выдумываем структуру)")

        # --- 2. Снимок: по умолчанию полей нет ----------------------------
        default_size, default_snap = snapshot_size(a, limit=NODES)
        first = default_snap["state"]["entities"][0]
        check("exposed" not in first and "state" not in first and "state_time" not in first,
              "по умолчанию в снимке нет exposed/state/state_time (поля: %s)"
              % ",".join(sorted(first.keys())))

        id_size, id_snap = snapshot_size(a, limit=NODES, fields=["id"])
        ex_size, ex_snap = snapshot_size(a, limit=NODES, fields=["id", "exposed"])
        st_size, st_snap = snapshot_size(a, limit=NODES, fields=["id", "state", "state_time"])

        # --- 3. Снимок: по запросу поля есть ------------------------------
        hero = [e for e in ex_snap["state"]["entities"] if e.get("id") == "e7"][0]
        check("exposed" in hero, "fields:[id,exposed] → поле exposed есть")
        check(hero["exposed"].get("team") == 1 and hero["exposed"].get("extra") == "да",
              "в снимке видно объявленное: %s" % json.dumps(hero["exposed"], ensure_ascii=False))
        check(hero["exposed"].get("nested", "нет") is None,
              "вложенное в снимке — null")
        check(len(hero["exposed"].get("long", "")) == 64, "строка в снимке обрезана")

        fsm = [e for e in st_snap["state"]["entities"] if e.get("id") == "fsm"]
        if not fsm:
            # Узел с машиной создан последним: в замер по limit он не попал.
            # Спрашиваем его отдельно — по селектору, как это делает игра.
            _size, fsm_snap = snapshot_size(a, sel="#fsm",
                                            fields=["id", "state", "state_time"])
            fsm = fsm_snap["state"]["entities"]
        fsm = fsm[0] if fsm else {}
        check(fsm.get("state") == "walk",
              "состояние машины анимации видно снаружи: state=%s" % fsm.get("state"))
        check(isinstance(fsm.get("state_time"), (int, float)),
              "state_time — число: %s" % fsm.get("state_time"))

        # --- 4. Замер размера ---------------------------------------------
        note("размер снимка на %d узлах: по умолчанию %d Б, fields=[id] %d Б, "
             "fields=[id,exposed] %d Б, fields=[id,state,state_time] %d Б"
             % (NODES, default_size, id_size, ex_size, st_size))
        per_node = (ex_size - id_size) / max(1, len(ex_snap["state"]["entities"]))
        note("цена поля exposed на узел: %.0f Б (в тесте каждый узел объявил "
             "строку в 64 символа + 3 числа — это верхняя граница, а не норма)" % per_node)
        check(ex_size > id_size,
              "поле exposed реально доехало: +%d Б на %d узлов" % (ex_size - id_size, NODES))
        check(100 <= per_node <= 200,
              "цена соответствует объявленному (%.0f Б на узел при строке 64 Б: "
              "лимиты ≤32 ключа × ≤64 символа держат потолок)" % per_node)

        # Главная проверка «снимок не раздувается»: добавляем состояние ВСЕМ
        # узлам и смотрим на снимок ПО УМОЛЧАНИЮ — он обязан не измениться,
        # потому что поле отдаётся только по запросу.
        before_default = default_size
        a.eval("(() => { for (let i = 0; i < 200; ++i) { const n = $('#e' + i);"
               " if (n.length) n.expose({ extra1: i, extra2: i * 2, extra3: 'x'.repeat(64) }); }"
               " return true; })()")
        after_default, _snap = snapshot_size(a, limit=NODES)
        check(after_default == before_default,
              "по умолчанию снимок не вырос от объявленного состояния: %d Б → %d Б"
              % (before_default, after_default))
        grown, _snap2 = snapshot_size(a, limit=NODES, fields=["id", "exposed"])
        check(grown > ex_size,
              "а по запросу поля — вырос: %d Б → %d Б (значит дело именно в fields)"
              % (ex_size, grown))

        # --- 5. Регресс highlevel_timeline_test: несколько UI-узлов ----------
        # `ui_nodes.map(nodeBrief)` передаёт вторым аргументом ИНДЕКС, и на
        # втором UI-узле снимок падал с «TypeError: not a function» (у числа
        # нет .has). Проверяем снимок с ТРЕМЯ ui-узлами.
        a.eval("(() => { for (let i = 0; i < 3; ++i) {"
               " const u = $('<ui.bar>', { id: 'ub' + i }); u.expose({ slot: i }); }"
               " return true; })()")
        try:
            ui_snap = a.cmd("state")
            ui_ok, ui_err = True, ""
        except Exception as exc:                      # AgentError от движка
            ui_snap, ui_ok, ui_err = None, False, str(exc)[:140]
        check(ui_ok, "снимок не падает при нескольких UI-узлах (%s)" % (ui_err or "ok"))
        if ui_ok:
            # Аварийный минимум движка (когда JS снимка упал) НЕ содержит
            # entities/ui — поэтому проверяем, что снимок настоящий.
            ents = ui_snap["state"].get("entities")
            check(isinstance(ents, list) and len(ents) >= NODES,
                  "снимок настоящий, а не аварийный минимум: сущностей %s"
                  % (len(ents) if isinstance(ents, list) else "нет"))
            ui_list = ui_snap["state"].get("ui") or []
            check(len(ui_list) >= 3, "в снимке %d UI-узлов" % len(ui_list))
            _sz, ui_exposed = snapshot_size(a, fields=["id", "exposed"])
            mine = [e for e in (ui_exposed["state"].get("ui") or [])
                    if str(e.get("id", "")).startswith("ub")]
            check(bool(mine) and "exposed" in mine[0],
                  "поля по запросу доезжают и до UI-узлов: %s"
                  % (json.dumps(mine[:1], ensure_ascii=False)[:120] if mine else "нет"))

        # --- 6. Сломанный снимок обязан быть СЛЫШЕН -------------------------
        # Аварийный минимум без пометки — та же «тишина вместо ошибки»: клиент
        # видит правдоподобный неполный ответ и не знает об этом.
        a.eval("globalThis.__real_snapshot = $.agent.snapshot;"
               " $.agent.snapshot = () => { throw new Error('тест: сломанный снимок'); };")
        broken = a.cmd("state")
        bstate = broken.get("state") or {}
        berr = bstate.get("error") or {}
        check(berr.get("code") == "R2D_AGENT_SNAPSHOT_FAILED",
              "сломанный снимок помечен кодом в ответе: %s"
              % json.dumps(berr, ensure_ascii=False)[:140])
        check("тест: сломанный снимок" in str(berr.get("message", "")),
              "в ответе есть текст исключения")
        check("entities" not in bstate,
              "аварийный ответ не выдаёт себя за полные данные (entities нет)")
        check("R2D_AGENT_SNAPSHOT_FAILED" in a.eval(
                  "JSON.stringify($.debug.errors ? $.debug.errors() : [])"),
              "ошибка попала в машинную диагностику $.debug.errors()")
        a.eval("$.agent.snapshot = globalThis.__real_snapshot;")
        restored = a.cmd("state")
        check(isinstance(restored["state"].get("entities"), list),
              "после починки снимок снова настоящий (сущностей %s)"
              % len(restored["state"].get("entities") or []))
        log = a.stderr_text()
        check("R2D_AGENT_SNAPSHOT_FAILED" in log or "снимок состояния не удался" in log,
              "и в журнале есть строка об отказе снимка")

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
