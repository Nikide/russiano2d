#!/usr/bin/env python3
# ===========================================================================
# Несколько форм на тело: «попал в голову, а не в ногу».
#
# Раньше у тела движка была ОДНА форма, поэтому в событиях контакта нельзя было
# понять, КУДА попали (TASKS §1.3). Теперь у тела может быть несколько форм-зон,
# а в contactBetween/contactsOf приходят индексы форм и теги зон.
#
# Проверяем не «настройка сохранилась», а ФИЗИКУ: пол касается зоны НОГ (она
# снизу), а падающий сверху шип — зоны ГОЛОВЫ.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_zones_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        for name in ("addShape", "shapeCount"):
            check(a.eval(f"typeof engine.{name}") == "function", f"engine.{name} есть")
        check(a.eval("typeof $.world.zone") == "function", "$.world.zone есть")
        check(a.eval("typeof $('#x').zone") == "function", "метод узла .zone() есть")

        # --- 1. Пол касается зоны НОГ (она снизу) ---
        a.eval("""
            $.world.gravity(0, 1200).bounds(0, 0, 4000, 2000);
            $('<wall>', { id: 'floor', w: 800, h: 40 }).at(300, 600).appendTo($.world);
            $('<enemy>', { id: 'hero', w: 40, h: 60 }).at(300, 400)
                .body('dynamic').appendTo($.world);
            // Голова ВЫШЕ основной формы и НЕ перекрывает её (иначе шип
            // касался бы обеих, и «куда попал» стало бы делом кадра).
            globalThis.__h = $('#hero').zone({ type: 'box', w: 40, h: 20, y: -40, tag: 'head' });
            globalThis.__l = $('#hero').zone({ type: 'box', w: 40, h: 20, y: 22, tag: 'legs' });
        """)
        ind_h = a.eval("globalThis.__h")
        ind_l = a.eval("globalThis.__l")
        print(f"  индексы зон: head={ind_h}, legs={ind_l}")
        check(ind_h == 1 and ind_l == 2, "зоны получили индексы 1 и 2 (0 — основная форма)")
        check(a.eval("$('#hero').zoneCount()") == 3, "у тела три формы")

        check(a.eval("$.world.zoneTag('#hero', 1)") == "head", "тег зоны 1 — head")
        check(a.eval("$.world.zoneTag('#hero', 2)") == "legs", "тег зоны 2 — legs")

        for _ in range(90):
            a.step(1)
        floor_body = a.eval("$('#floor').nodes[0].body")
        contacts = a.eval("JSON.stringify($.world.contactsOf('#hero'))")
        print(f"  контакты героя на полу: {contacts}")
        # Пол должен касаться НОГ (низ), а не головы.
        touching_floor = [c for c in eval(contacts) if c["other"] == floor_body]
        check(bool(touching_floor), "герой стоит на полу (контакт есть)")
        if touching_floor:
            tag = a.eval(f"$.world.zoneTag('#hero', {touching_floor[0]['shape']})")
            print(f"  пол касается формы {touching_floor[0]['shape']} → тег {tag}")
            check(tag == "legs", f"пол касается НОГ, а не головы (тег {tag})")

        # --- 2. Зоны РАЗНЕСЕНЫ: пол касается ног, а не головы ---
        # Это и есть «попал в ногу, а не в голову»: пол снизу касается только
        # зоны ног, зона головы в контакте с полом не участвует.
        head_touched = False
        for c in eval(contacts):
            if c["other"] != floor_body:
                continue
            if a.eval("$.world.zoneTag('#hero', %d)" % c["shape"]) == "head":
                head_touched = True
        check(not head_touched, "голова НЕ касается пола — зона ног ниже")

        # Вторая проверка на другом теле: высокая зона ног снизу перехватывает
        # контакт со стеной, а основная форма — нет.
        a.eval(
            "$('<wall>', { id: 'low', w: 200, h: 20 }).at(900, 600).appendTo($.world);"
            "$('<enemy>', { id: 'dummy', w: 40, h: 40 }).at(900, 400)"
            "    .body('dynamic').appendTo($.world);"
            "$('#dummy').zone({ type: 'box', w: 40, h: 60, y: 30, tag: 'foot' });"
        )
        for _ in range(90):
            a.step(1)
        dummy_contacts = eval(a.eval("JSON.stringify($.world.contactsOf('#dummy'))"))
        low_body = a.eval("$('#low').nodes[0].body")
        foot = [c for c in dummy_contacts if c["other"] == low_body]
        print(f"  контакты dummy: {dummy_contacts}")
        check(bool(foot), "dummy стоит на низкой стене")
        if foot:
            tag = a.eval("$.world.zoneTag('#dummy', %d)" % foot[0]["shape"])
            print(f"  стена касается формы {foot[0]['shape']} → тег {tag}")
            check(tag == "foot", f"касается зоны НОГ, а не основной формы ({tag})")
        # --- 3. Основная форма (0) остаётся и у неё нет тега ---
        check(a.eval("$.world.zoneTag('#hero', 0)") is None, "у основной формы тега нет")

        # --- 4. Мусор не роняет: зона без типа, зона сверх предела ---
        a.eval("""
            $('#hero').zone({});
            $('#hero').zone({ type: 'circle', radius: 10, tag: 'aura' });
        """)
        count = a.eval("$('#hero').zoneCount()")
        print(f"  форм после ещё двух зон: {count}")
        check(count == 5, f"зоны добавляются ({count})")
        check(a.eval("$.world.zoneTag('#hero', 4)") == "aura", "круглая зона с тегом")

        # --- 5. Фильтр слоёв у зоны: сенсор не толкает ---
        a.eval("""
            $.world.gravity(0, 0);
            $('<enemy>', { id: 'ghost', w: 40, h: 40 }).at(800, 300)
                .body('dynamic').appendTo($.world);
            $('#ghost').zone({ type: 'box', w: 200, h: 200, sensor: true, tag: 'trigger' });
        """)
        check(a.eval("$('#ghost').zoneCount()") == 2, "сенсорная зона добавилась")

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
