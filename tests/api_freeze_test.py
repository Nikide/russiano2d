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

#: Снимок поверхности: имена неймспейсов `$.` с их методами, ПУБЛИЧНЫЕ КОНСТАНТЫ
#: со значениями (`$.alive.PULSE_MAX = 200`) и биндинги engine.*. Функции
#: верхнего уровня тоже попадают — они часть публичного API.
#:
#: Почему значения: игра читает эти числа/строки/массивы напрямую
#: (`$.alive.BREAK_STRESS`, `$.kinds.TwoD`, `$.tilemap.BLOB47_LAYOUT`), поэтому
#: изменение значения — такое же изменение API, как переименование метода, и
#: должно быть видно в диффе снимка. Раньше константы не попадали в снимок
#: вовсе: `typeof` не функция и не объект — и они не защищались ни заморозкой,
#: ни гейтом документации.
#:
#: Чего в снимке НЕТ (и почему): значения, которые зависят не от кода, а от
#: запуска — флаги (`$.agent.active/headless/seed`, `$.debug.overlay`),
#: возможности бэкенда (`$.viewport.supported`) и состояние мира
#: (`$.ctx.*`: реестр узлов, таймеры, анимации, поля сил, режим аудио). Их имена
#: перечисляются как раньше, но значения не сравниваются: иначе заморозка
#: падала бы на другом бэкенде или после одного кадра игры.
VOLATILE_VALUES = ("$.agent.", "$.debug.overlay", "$.ctx.", "$.viewport.supported",
                   "$.отладка.overlay")

SNAPSHOT = """(() => {
    const names = [];
    const isNs = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const volatile_values = %s;
    const value_is_volatile = (name) => volatile_values.some((prefix) => name.startsWith(prefix));
    const describe = (name, value) => {
        let text;
        try { text = JSON.stringify(value); } catch (e) { text = '<не сериализуется>'; }
        if (text === undefined) text = '<undefined>';
        if (text.length > 300) text = '<данных ' + text.length + ' символов>';
        names.push(name + ' = ' + text);
    };
    for (const key of Object.keys($).sort()) {
        names.push('$.' + key);
        const value = $[key];
        if (isNs(value)) {
            for (const sub of Object.keys(value).sort()) {
                const kind = typeof value[sub];
                const name = '$.' + key + '.' + sub;
                if (kind === 'function' || isNs(value[sub])) { names.push(name); continue; }
                if (value_is_volatile(name)) continue;
                if (kind === 'number' || kind === 'string' || kind === 'boolean') describe(name, value[sub]);
                else if (Array.isArray(value[sub])) describe(name, value[sub]);
            }
        }
    }
    if (typeof engine === 'object' && engine) {
        for (const key of Object.keys(engine).sort()) {
            if (typeof engine[key] === 'function') names.push('engine.' + key);
        }
    }
    return names.sort();
})()""" % (list(VOLATILE_VALUES),)


def split_name(line):
    """Имя из строки снимка: у констант за `=` идёт значение."""
    return line.split(" = ", 1)[0]


def value_of(line):
    parts = line.split(" = ", 1)
    return parts[1] if len(parts) > 1 else None


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

    expected_names = {split_name(line): value_of(line) for line in expected}
    actual_names = {split_name(line): value_of(line) for line in lines}
    added = sorted(set(actual_names) - set(expected_names))
    removed = sorted(set(expected_names) - set(actual_names))
    changed = sorted(name for name in set(expected_names) & set(actual_names)
                     if expected_names[name] != actual_names[name])
    constants = sum(1 for value in actual_names.values() if value is not None)
    print("§63 заморозка API: в снимке %d имён (из них констант со значениями %d), "
          "в движке %d" % (len(expected_names), constants, len(actual_names)))

    def with_values(names):
        return ", ".join("%s = %s" % (name, actual_names.get(name, expected_names.get(name)))
                         for name in names[:8])

    failures = []
    if added:
        failures.append("появились без обновления снимка: %s" % ", ".join(added[:12]))
    if removed:
        failures.append("пропали (ломающее изменение!): %s" % ", ".join(removed[:12]))
    if changed:
        failures.append("изменились ЗНАЧЕНИЯ публичных констант (%d): %s"
                        % (len(changed), with_values(changed)))

    print("  ok   поверхность совпадает со снимком" if not failures else "  FAIL " + "; ".join(failures))
    if failures:
        print("\nПРОВАЛЕНО: 1")
        print("  - если изменение намеренное (§63: переименование/сигнатура/семантика/"
              "схема/значение константы — только с обоснованием), обновите снимок: "
              "--write, и объясните в CHANGELOG")
        return 1
    print("\nВсе проверки пройдены (заморозка держится)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
