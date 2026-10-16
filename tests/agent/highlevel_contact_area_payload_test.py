#!/usr/bin/env python3
# ===========================================================================
# §7 (payload контакта областей) через агентский интерфейс.
#
# Что проверяется ровно по ТЗ §7: «Contact payload стабильно содержит:
# areaA, areaB, roleA, roleB, ownerA, ownerB» (docs/PRODUCTION_POLISH.md).
# Поля строит dispatchContacts() в src/highlevel/api.js (~3131-3142).
#
# Существующие тесты читают только легаси-псевдонимы selfArea/selfOwner
# (tests/agent/highlevel_transforms_test.py), поэтому шесть документированных
# полей не проверял никто. Здесь они проверяются на РЕАЛЬНОМ collide, в
# обработчике, который читает e.data:
#   * все шесть полей присутствуют в событии;
#   * areaA/areaB — имена областей, объявленных area(...);
#   * roleA/roleB равны ролям, объявленным в момент area(...);
#   * ownerA/ownerB — РАЗРЕШЁННЫЕ узлы-владельцы (не хендлы): ownerB — это
#     узел #guard, объявленный в owner области sword, а не узел её формы.
#
# Фикстура tests/fixtures/area_payload: сталкиваются только две области, у
# hurtbox владелец не задан (сам узел), у sword владелец — другой узел.
#
# Запуск (движок уже собран в build/russiano2d):
#   python3 tests/agent/highlevel_contact_area_payload_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "area_payload")
FIELDS = ["areaA", "areaB", "roleA", "roleB", "ownerA", "ownerB"]
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(5)

        # --- что фикстура объявила при area(...) ------------------------------
        declared = a.eval("$.fixture.declared")
        check(declared.get("sword", {}).get("role") == "attack"
              and declared.get("hurtbox", {}).get("role") == "hurtbox",
              f"§7 роли объявлены в момент area(...): {declared}")
        check(declared.get("sword", {}).get("owner") == "#guard",
              f"§7 owner области sword объявлен как селектор: {declared.get('sword')}")

        # --- событие пришло и это именно collide ------------------------------
        check(a.eval("$.fixture.payloads().length") == 2,
              f"§7 collide дошёл до обоих участников: {a.eval('$.fixture.payloads().length')}")
        kinds = a.eval("$.fixture.payloads().map(p => p.kind)")
        check(kinds == ["begin", "begin"],
              f"§7 обработчик 'collide' получает фазу begin: {kinds}")

        payload = a.eval("$.fixture.payloads()[0]")
        who = payload["who"]
        missing = [f for f in FIELDS if f not in payload["keys"]]
        check(not missing,
              f"§7 e.data содержит все шесть полей ({who}): нет {missing}; "
              f"есть {[f for f in FIELDS if f in payload['keys']]}")

        # --- поля присутствуют и у второго участника тоже ---------------------
        other = a.eval("$.fixture.payloads()[1]")
        check(not [f for f in FIELDS if f not in other["keys"]],
              f"§7 второй участник видит те же шесть полей ({other['who']})")

        # --- areaA/areaB — имена объявленных областей -------------------------
        # Сторона A/B — порядок пары Box2D: раньше созданная форма (hurtbox)
        # получает меньший proxy-ключ и становится A. Соответствие A/B — не
        # контракт §7; контракт — что имя области и её роль/владелец едут вместе.
        check(payload["areaA"] == "hurtbox" and payload["areaB"] == "sword",
              f"§7 areaA/areaB — имена областей: {payload['areaA']}/{payload['areaB']}")

        # --- roleA/roleB равны ролям, объявленным при определении --------------
        declared_role = {"hurtbox": declared["hurtbox"]["role"],
                         "sword": declared["sword"]["role"]}
        check(payload["roleA"] == declared_role[payload["areaA"]]
              and payload["roleB"] == declared_role[payload["areaB"]],
              f"§7 roleA/roleB — роли из area(...): {payload['roleA']}/{payload['roleB']}")
        check(payload["roleA"] == "hurtbox" and payload["roleB"] == "attack",
              f"§7 роли не перепутаны: hurtbox={payload['roleA']}, attack={payload['roleB']}")
        # Роль в событии совпадает и с живым описанием области (один источник).
        check(payload["roleA"] == a.eval("$('#dummy').area('hurtbox').role")
              and payload["roleB"] == a.eval("$('#weapon').area('sword').role"),
              "§7 роль в событии совпадает с описанием области")

        # --- ownerA/ownerB — разрешённые узлы, а не формы ----------------------
        nids = {
            "dummy": a.eval("$('#dummy').nid()"),
            "weapon": a.eval("$('#weapon').nid()"),
            "guard": a.eval("$('#guard').nid()"),
        }
        check(payload["ownerA_nid_fn"] is True and payload["ownerB_nid_fn"] is True,
              "§7 ownerA/ownerB — объекты узлов (у обоих есть .nid())")
        # ownerA: у hurtbox owner не задан — владелец сам узел формы (#dummy).
        check(payload["ownerA"] == nids["dummy"],
              f"§7 без owner владелец — узел формы: ownerA={payload['ownerA']} (#dummy={nids['dummy']})")
        # ownerB: у sword owner: '#guard' — владелец ДРУГОЙ узел, не #weapon.
        check(payload["ownerB"] == nids["guard"],
              f"§7 ownerB — объявленный владелец #guard: ownerB={payload['ownerB']} "
              f"(#guard={nids['guard']}, узел формы #weapon={nids['weapon']})")
        check(payload["ownerB"] != nids["weapon"],
              "§7 владелец отделён от узла, на котором объявлена форма")

        # --- то же самое напрямую из e.data, сохранённого обработчиком ---------
        # globalThis.__last — сам объект e.data последнего collide (не копия).
        direct = a.eval("(() => { const d = globalThis.__last;"
                        "  return { has: ['areaA','areaB','roleA','roleB','ownerA','ownerB']"
                        "                 .filter(k => k in d),"
                        "           ownerB: d.ownerB.nid(), ownerA: d.ownerA.nid(),"
                        "           roleB: d.roleB, areaB: d.areaB }; })()")
        check(direct["has"] == FIELDS,
              f"§7 шесть полей читаются прямо из e.data: {direct['has']}")
        check(direct["ownerB"] == nids["guard"],
              f"§7 e.data.ownerB.nid() === $('#guard').nid(): "
              f"{direct['ownerB']} === {nids['guard']}")
        check(direct["roleB"] == "attack" and direct["areaB"] == "sword",
              f"§7 e.data несёт роль и имя области вместе: {direct['areaB']}/{direct['roleB']}")

        # --- легаси-псевдонимы не подменяют шесть полей -----------------------
        # У узла стороны A selfArea — это areaA, у узла стороны B — areaB.
        check(payload["selfArea"] == payload["areaA"] and payload["otherArea"] == payload["areaB"],
              f"§7 у {who} (сторона A) selfArea/otherArea = areaA/areaB: "
              f"{payload['selfArea']}/{payload['otherArea']}")
        check(other["selfArea"] == other["areaB"] and other["otherArea"] == other["areaA"],
              f"§7 у {other['who']} (сторона B) selfArea — это areaB: {other['selfArea']}")

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, f"§7 в кадре нет ошибок игрового кода: {errors[:2]}")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
