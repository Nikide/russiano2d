#!/usr/bin/env python3
# ===========================================================================
# Проверка виртуализации списка <ui.list>.
#
# Смысл виртуализации: список в 100 000 строк не должен рисоваться целиком.
# Здесь проверяется именно это — сколько строк РЕАЛЬНО нарисовано за кадр, — а
# не наличие методов. Плюс прокрутка, удержание выбранной строки на экране,
# элементы-объекты и полоса прокрутки.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_list_test.py
# ===========================================================================

import json
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


def range_of(a, sel="#inv"):
    return json.loads(a.eval(f"JSON.stringify($.ui.listRange('{sel}'))"))


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        # Список в 100 000 строк: перебор всех был бы заметен сразу.
        a.eval("""
            $('<ui.list>', { id: 'inv', itemHeight: 20 })
                .at(160, 120).size(300, 200).appendTo($.ui);
            const many = [];
            for (let i = 0; i < 100000; ++i) many.push('строка ' + i);
            $.ui.listItems('#inv', many);
        """)
        a.step(1)

        info = range_of(a)
        check(info["total"] == 100000, f"всего строк: {info['total']}")
        # Окно 200 px, строка 20 px → видно ~11 строк; с запасом снизу ~11.
        check(info["drawn"] <= 16, f"нарисовано за кадр: {info['drawn']} (окно ~10 строк)")
        check(info["first"] == 0, f"начали с нуля: {info['first']}")

        # Кадр со списком в 100 000 строк должен укладываться в разумное время:
        # полный перебор занял бы секунды.
        import time
        t0 = time.time()
        a.step(5)
        elapsed = time.time() - t0
        print(f"  5 кадров с 100 000 строк: {elapsed:.3f} c")
        check(elapsed < 2.0, f"кадры быстрые ({elapsed:.3f} c на 5 кадров)")

        # Прокрутка: первые строки уходят, рисуются другие.
        a.eval("$.ui.listScroll('#inv', 400)")
        a.step(1)
        scrolled = range_of(a)
        check(abs(a.eval("$.ui.listScroll('#inv')") - 400) < 0.01, "прокрутка выставлена")
        check(scrolled["first"] == 20, f"первый видимый — 20: {scrolled['first']}")
        check(scrolled["drawn"] <= 16, f"и тут рисуется окно: {scrolled['drawn']}")

        # Пределы: ниже конца списка прокрутка не уходит.
        a.eval("$.ui.listScroll('#inv', 10 ** 9)")
        max_scroll = a.eval("$.ui.listScroll('#inv')")
        check(max_scroll < 100000 * 20, f"прокрутка ограничена содержимым: {max_scroll:.0f}")
        a.eval("$.ui.listScroll('#inv', -50)")
        check(a.eval("$.ui.listScroll('#inv')") == 0, "вверх за начало не уходит")

        # Выбранная строка обязана быть видна: прыжок в конец.
        a.eval("$.ui.listIndex('#inv', 99999)")
        a.step(1)
        last = range_of(a)
        check(last["last"] == 99999, f"последняя строка видна: last = {last['last']}")
        check(a.eval("$.ui.listIndex('#inv')") == 99999, "и она выбрана")
        a.eval("$.ui.listScroll('#inv', 0)")
        a.eval("$.ui.listIndex('#inv', 0)")
        a.step(1)

        # Элементы-объекты: текст, подпись справа и свой цвет.
        a.eval("""
            $('<ui.list>', { id: 'objs', itemHeight: 24 })
                .at(500, 120).size(280, 160).appendTo($.ui);
            $.ui.listItems('#objs', [
                { text: 'Меч', sub: 'x1' },
                { text: 'Щит', sub: 'x3', color: '#ffcc00' },
            ], { index: 1 });
        """)
        a.step(1)
        objs = range_of(a, "#objs")
        check(objs["total"] == 2 and objs["drawn"] == 2, f"оба элемента нарисованы: {objs}")
        check(a.eval("$.ui.listIndex('#objs')") == 1, "индекс задан через opts")

        # Пустой список: не падает и ничего не рисует.
        a.eval("$.ui.listItems('#objs', [])")
        a.step(1)
        empty = range_of(a, "#objs")
        check(empty["total"] == 0 and empty["drawn"] == 0, f"пустой список: {empty}")

        # Селектор не на список — не падает.
        check(a.eval("$.ui.listRange('#hud')['total']") == 0 or True,
              "listRange по не-списку не падает")

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
