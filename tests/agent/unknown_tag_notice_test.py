#!/usr/bin/env python3
# ===========================================================================
# A7 (отчёт внешней команды, docs/EXTERNAL_FEEDBACK.md): «неизвестный тег» —
# одна строка на имя тега, а не строка на каждый узел.
#
# Было: `$('<walker>')` писал `$: неизвестный тег <walker> — создаю пустой узел`
# на КАЖДЫЙ узел. Уровень внешней команды (≈50 врагов и ≈70 ловушек) давал
# 106–125 строк шума за загрузку, и настоящие сообщения в журнале тонули.
#
# Проверяется на живом движке по журналу (stderr):
#   * три узла с одним тегом → ровно одна строка про это имя;
#   * второй, другой тег → ещё ровно одна строка (итого две);
#   * 50 врагов и 70 ловушек (как в отчёте) → три строки на три имени;
#   * узлы при этом создаются и работают: класс, тело, селектор;
#   * встроенный тег (<rect>) не пишет ничего;
#   * предупреждение не исчезает совсем: первое сообщение про имя остаётся.
#
# Запуск (после сборки):
#   python3 tests/agent/unknown_tag_notice_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "hello")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def tag_lines(a, name):
    """Сколько строк журнала про это имя тега (0 — ни одной)."""
    return sum(1 for line in a.stderr_text().splitlines()
               if ("неизвестный тег <%s>" % name) in line)


def all_tag_lines(a):
    return sum(1 for line in a.stderr_text().splitlines() if "неизвестный тег <" in line)


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(3)
        check(all_tag_lines(a) == 0, "на старте фикстуры шума про теги нет")

        # --- 1. Три узла одного неизвестного тега -----------------------------
        a.eval("for (let i = 0; i < 3; i++)"
               " $('<walker>', { id: 'w' + i, class: 'walker' })"
               "  .at(i * 40, 100).appendTo($.world); 'ok'")
        a.step(1)
        walker = tag_lines(a, "walker")
        print("  --   3 узла <walker>: строк в журнале — %d" % walker)
        check(walker == 1, "три узла одного тега дают ровно одну строку (%d)" % walker)

        # --- 2. Второй тег — вторая строка ------------------------------------
        a.eval("for (let i = 0; i < 2; i++)"
               " $('<gnome>', { id: 'g' + i, class: 'gnome' })"
               "  .at(i * 40, 200).appendTo($.world); 'ok'")
        a.step(1)
        gnome = tag_lines(a, "gnome")
        print("  --   2 узла <gnome>: строк — %d, всего про теги — %d"
              % (gnome, all_tag_lines(a)))
        check(gnome == 1, "другой тег даёт ровно одну свою строку (%d)" % gnome)
        check(walker == tag_lines(a, "walker") == 1,
              "повторные узлы <walker> новых строк не добавляют")
        check(all_tag_lines(a) == 2, "всего две строки на два имени (%d)" % all_tag_lines(a))

        # --- 3. Узлы созданы и работают ---------------------------------------
        check(a.eval("$('.walker').length") == 3, "узлы с незнакомым тегом создаются (3)")
        check(a.eval("$('#w0').pos().y") == 100, "у них есть позиция и селектор по id")
        a.eval("$('#w0').body('dynamic')")
        a.step(2)
        check(a.eval("$('#w0').get(0).body") >= 0, "тело создаётся и у незнакомого тега")

        # --- 4. Масштаб отчёта: 50 врагов и 70 ловушек ------------------------
        a.eval("for (let i = 0; i < 50; i++)"
               " $('<walker>', { class: 'wave' }).at(i * 8, 400).appendTo($.world);"
               " for (let i = 0; i < 70; i++)"
               " $('<trap>', { class: 'traps' }).at(i * 6, 500).appendTo($.world); 'ok'")
        a.step(1)
        wave = sum(1 for line in a.stderr_text().splitlines()
                   if "неизвестный тег <walker>" in line)
        trap = tag_lines(a, "trap")
        total = all_tag_lines(a)
        print("  --   +50 <walker> и +70 <trap>: walker=%d, trap=%d, всего=%d"
              % (wave, trap, total))
        check(a.eval("$('.wave').length") == 50, "50 узлов волны созданы")
        check(a.eval("$('.traps').length") == 70, "70 ловушек созданы")
        check(wave == 1 and trap == 1, "на каждое имя — одна строка (walker=%d, trap=%d)"
              % (wave, trap))
        check(total == 3, "всего три строки на три имени вместо 125 (%d)" % total)

        # --- 5. Встроенный тег молчит -----------------------------------------
        before = all_tag_lines(a)
        a.eval("for (let i = 0; i < 5; i++) $('<rect>').at(i, 0).appendTo($.world); 'ok'")
        a.step(1)
        check(all_tag_lines(a) == before, "встроенный тег не пишет ничего")

        # --- 6. Журнал после всей работы --------------------------------------
        sample = [l.strip() for l in a.stderr_text().splitlines()
                  if "неизвестный тег <" in l]
        for line in sample:
            print("  --   %s" % line)
        check(len(sample) == 3, "в журнале ровно три строки про теги (%d)" % len(sample))
        check(a.ping().get("pong") is True, "движок отвечает после проверок журнала")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
