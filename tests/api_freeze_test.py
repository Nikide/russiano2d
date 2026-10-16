#!/usr/bin/env python3
# ===========================================================================
# §63 плана дополировки: заморозка публичного API — проверяется машинно.
#
# «Объявить заморозку» словами бессмысленно: через неделю никто не скажет,
# случайно ли переименовали namespace или это было решением. Поэтому заморозка
# здесь — это снимок публичной поверхности (имена `$.`-неймспейсов и их методов
# плюс биндинги `engine.*`), который лежит в репозитории и сверяется с живым
# движком.
#
#   * поверхность совпала     → заморозка держится;
#   * появилось/пропало имя   → провал с точным списком различий;
#   * изменение намеренное    → обновить снимок осознанно:
#         python3 tests/api_freeze_test.py --write
#     и в том же коммите объяснить в CHANGELOG, почему это не ломает игры
#     (переименование, смена сигнатуры, семантики или схемы — только по §63).
#
# Запуск:
#   python3 tests/api_freeze_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
from agent_client import Agent   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(ROOT, "tests", "api_freeze_baseline.txt")
GAME = os.path.join("tests", "fixtures", "hello")

#: Снимок поверхности: имена неймспейсов `$.` с их методами и биндинги engine.*.
#: Функции верхнего уровня тоже попадают — они часть публичного API.
SNAPSHOT = """(() => {
    const names = [];
    const isNs = (v) => v && typeof v === 'object' && !Array.isArray(v);
    for (const key of Object.keys($).sort()) {
        names.push('$.' + key);
        const value = $[key];
        if (isNs(value)) {
            for (const sub of Object.keys(value).sort()) {
                const kind = typeof value[sub];
                if (kind === 'function' || isNs(value[sub])) names.push('$.' + key + '.' + sub);
            }
        }
    }
    if (typeof engine === 'object' && engine) {
        for (const key of Object.keys(engine).sort()) {
            if (typeof engine[key] === 'function') names.push('engine.' + key);
        }
    }
    return names.sort();
})()"""


def main():
    write = "--write" in sys.argv[1:]
    with Agent(game=GAME, seed=1, headless=True) as a:
        a.step(3)
        surface = a.eval(SNAPSHOT)
    if not isinstance(surface, list) or not surface:
        print("  FAIL снимок публичного API не получен: %r" % (surface,))
        return 1
    lines = [str(name) for name in surface]

    if write:
        with open(BASELINE, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
        print("  записан снимок публичного API: %d имён → %s" % (len(lines), BASELINE))
        return 0

    if not os.path.exists(BASELINE):
        print("  FAIL нет снимка %s — создайте осознанно: --write" % BASELINE)
        return 1
    with open(BASELINE, encoding="utf-8") as handle:
        expected = [line.strip() for line in handle if line.strip()]

    added = sorted(set(lines) - set(expected))
    removed = sorted(set(expected) - set(lines))
    print("§63 заморозка API: в снимке %d имён, в движке %d" % (len(expected), len(lines)))

    failures = []
    if added:
        failures.append("появились без обновления снимка: %s" % ", ".join(added[:12]))
    if removed:
        failures.append("пропали (ломающее изменение!): %s" % ", ".join(removed[:12]))

    print("  ok   поверхность совпадает со снимком" if not failures else "  FAIL " + "; ".join(failures))
    if failures:
        print("\nПРОВАЛЕНО: 1")
        print("  - если изменение намеренное (§63: переименование/сигнатура/семантика/"
              "схема — только с обоснованием), обновите снимок: --write, и объясните в CHANGELOG")
        return 1
    print("\nВсе проверки пройдены (заморозка держится)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
