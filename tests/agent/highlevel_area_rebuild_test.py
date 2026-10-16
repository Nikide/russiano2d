#!/usr/bin/env python3
# ===========================================================================
# §7.2 (shape rebuild) через агентский интерфейс.
#
# ТЗ §7.2: «После изменения geometry: старая shape перестаёт участвовать;
# новая вступает в силу в документированной phase; ID/index policy не плавает
# неожиданно».
#
# Что здесь проверяется числами, а не «на глаз»:
#   * область объявлена с большой формой — areaOverlap(...) = 1 и приходит
#     событие контакта;
#   * та же область переопределена (то же ИМЯ) крошечной формой в центре тела —
#     areaOverlap(...) = 0, и цель, поставленная в ПРЕЖНИЙ след формы, не
#     получает ни одного контакта: старая форма действительно не участвует
#     (не осталось «ghost contact»);
#   * политика индекса — из реализации, а не «на глаз»: `areaDefine` при
#     изменении geometry зовёт engine.setShape (core.js:1212-1215), а он
#     документированно СОХРАНЯЕТ индекс и пересобирает форму
#     (script.c:1510-1514: «Индекс сохраняется, поэтому маршрутизация контактов
#     не меняется»; physics.c:799-836: «Индекс сохраняется в user data») —
#     поэтому индекс обязан остаться ТЕМ ЖЕ (не просто >= 1);
#   * идентичность области держит имя, а не handle (core.js:1026-1028),
#     роль/сенсорность/включённость переживают смену только геометрии
#     (core.js:1163-1166: «Повторный вызов с тем же именем меняет только
#     переданные поля»);
#   * возврат геометрии снова делает область участником — новая форма вступает
#     в силу.
#
# Фикстура tests/fixtures/area_rebuild (цель — динамическое тело без
# гравитации: сенсор не толкает, сцена детерминирована).
#
# Запуск:
#   python3 tests/agent/highlevel_area_rebuild_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "area_rebuild")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(5)

        # --- большая форма: участвует и накрывает цель ------------------------
        big = a.eval("$.fixture.area('reach')")
        check(big["w"] == 200 and big["h"] == 60 and big["x"] == 130,
              f"§7.2 область объявлена большой формой: {big['w']}×{big['h']} при x={big['x']}")
        check(isinstance(big["index"], int) and big["index"] >= 1,
              f"§7.2 у формы есть native-индекс (>= 1 — форма тела не в счёт): {big['index']}")
        check(a.eval("$.fixture.overlap('reach')") == 1,
              f"§7.2 большая форма накрывает цель: {a.eval('$.fixture.overlap(\"reach\")')}")
        check(a.eval("$.fixture.hits()") >= 1,
              f"§7.2 большая форма присылает контакт: hits={a.eval('$.fixture.hits()')}")
        events = a.eval("$.fixture.events()")
        check(all(e["areaA"] == "reach" for e in events),
              f"§7.2 контакт маршрутизирован на область reach: {events[:2]}")

        # --- то же имя, крошечная форма в центре тела -------------------------
        small = a.eval("$.fixture.redefine({ shape: 'box', w: 2, h: 2, x: 0 })")
        check(small["w"] == 2 and small["h"] == 2 and small["x"] == 0,
              f"§7.2 геометрия области изменена: {small['w']}×{small['h']} при x={small['x']}")
        check(a.eval("$.fixture.overlap('reach')") == 0,
              f"§7.2 старая (большая) форма перестала находить цель: "
              f"{a.eval('$.fixture.overlap(\"reach\")')}")

        # --- политика индекса: сохраняется (setShape), а не «пересоздаётся» ---
        check(small["index"] == big["index"],
              f"§7.2 индекс формы сохранён при смене geometry: {big['index']} → {small['index']}")

        # --- идентичность: имя/роль/флаги те же, дубликата области нет --------
        names = a.eval("$.fixture.areas().map(x => x.name)")
        check(names == ["reach"],
              f"§7.2 переопределение не создало вторую область: {names}")
        check(small["name"] == "reach" and small["role"] == big["role"] == "reach",
              f"§7.2 идентичность области — имя: name={small['name']}, role={small['role']}")
        check(small["sensor"] is True and small["enabled"] is True
              and small["layer"] == big["layer"] and small["mask"] == big["mask"],
              "§7.2 непереданные поля области не сброшены (сенсор/слой/маска живы)")

        # --- нет ghost contact: новая цель в СТАРОМ следе формы молчит ---------
        hits_small = a.eval("$.fixture.hits()")
        a.eval("$('#target').remove()")
        a.step(1)
        probe_nid = a.eval("$.fixture.spawnTarget('probe2', 530, 300)")
        a.step(20)
        check(isinstance(probe_nid, str) and a.eval("$('#probe2').length") == 1,
              f"§7.2 проба поставлена в прежний след формы: {probe_nid}")
        check(a.eval("$.fixture.hits()") == hits_small,
              f"§7.2 новая цель в старой геометрии не получает контактов: "
              f"{hits_small} → {a.eval('$.fixture.hits()')}")
        check(a.eval("$.fixture.overlap('reach')") == 0,
              "§7.2 запрос тоже никого не находит после пересборки")

        # --- возврат геометрии: новая форма вступает в силу -------------------
        back = a.eval("$.fixture.redefine({ shape: 'box', w: 200, h: 60, x: 130 })")
        a.step(3)
        check(a.eval("$.fixture.overlap('reach')") == 1,
              f"§7.2 возвращённая форма снова накрывает цель: "
              f"{a.eval('$.fixture.overlap(\"reach\")')}")
        check(back["index"] == big["index"],
              f"§7.2 индекс не плавает и после повторной пересборки: "
              f"{big['index']} → {small['index']} → {back['index']}")
        check(a.eval("$.fixture.hits()") > hits_small,
              f"§7.2 новая форма снова присылает контакт: "
              f"hits={a.eval('$.fixture.hits()')} (было {hits_small})")
        check(a.eval("$.fixture.areas().length") == 1,
              "§7.2 число областей узла не изменилось за все пересборки")

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, f"§7.2 в кадре нет ошибок игрового кода: {errors[:2]}")

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
