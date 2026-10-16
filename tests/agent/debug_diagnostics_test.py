#!/usr/bin/env python3
# ===========================================================================
# §28 Спецификации: отладочные представления и профилирование.
#
# Приёмка §28 проверяется поведением:
#   * по записанному hit ID видно источник, контакт, решение фильтра и
#     результат урона;
#   * `$.debug.anatomy()` отдаёт то, что нужно для отладки боя: тело, области с
#     ролями, опору, активные окна, политику обработки;
#   * отказ виден как решение фильтра с причиной, а не только как «нет урона»;
#   * профиль называет конфигурацию и остаётся машиночитаемым;
#   * GPU-время называется GPU-временем только при измеренных timestamp'ах;
#     отсутствующая метрика помечена как отсутствующая, а не подменена;
#   * отладочный снимок не меняет исход симуляции.
#
# Запуск:
#   python3 tests/agent/debug_diagnostics_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/debug_diagnostics_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "combat_diag")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def load(a, expr):
    return json.loads(a.eval(expr))


def main():
    with Agent(game=GAME, seed=4, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(5)
        a.eval("__dbg.traceOn(true)")

        # --- Цепочка удара по hit ID ------------------------------------------
        attack_id = a.eval("__dbg.attack()")
        strike = load(a, "JSON.stringify(__dbg.strike())")
        check(strike and strike.get("accepted") is True,
              "удар прошёл (accept=%s, applied=%s)" % (strike.get("accepted"), strike.get("applied")))

        chain = load(a, "__dbg.chain()")
        kinds = [s["kind"] for s in chain["steps"]]
        check(chain["found"], "цепочка по hit ID найдена (%s)" % types_of(kinds))
        check("attack" in kinds, "в цепочке есть источник атаки")
        check("combat:filter" in kinds, "в цепочке есть решение фильтра")
        check("damage" in kinds, "в цепочке есть результат урона")
        check(chain["complete"], "цепочка полная (источник → фильтр → результат)")
        check(chain["owner"], "цепочка называет владельца атаки (%s)" % chain["owner"])
        check(chain["hit"] == attack_id, "hit ID совпадает с id атаки (%s)" % chain["hit"])

        # --- Отказ виден как решение фильтра с причиной ------------------------
        # Отказ берём на СТАДИИ ФИЛЬТРА (неуязвимость), а не «окно закрыто»:
        # при закрытом окне удар отклоняется до фильтра, и цепочка была бы
        # неполной — это разные вещи, и тест проверяет именно решение фильтра.
        # Цепочку читаем по КОНКРЕТНОМУ id: `chain()` без аргумента вернул бы
        # последнюю атаку фикстуры, а не эту.
        refused_id = a.eval("""(() => {
            const atk = $.combat.attack({ source: '#hero', owner: '#hero', amount: 9, window: 2000 });
            // `iframes` — поле узла, а не attr: фильтр читает node.iframes.
            const foe = $('#foe').get(0);
            foe.iframes = 0.5;                 // цель неуязвима → отказ в фильтре
            $.combat.strike(atk, [{ node: '#foe', role: 'hurtbox' }]);
            foe.iframes = 0;
            return atk.id;
        })()""")
        refused = load(a, "__dbg.chain(%s)" % refused_id)
        refusal_steps = [s for s in refused["steps"] if s["kind"] == "combat:filter"]
        check(bool(refusal_steps), "отказ тоже попадает в цепочку")
        reason = (refusal_steps[-1]["data"] or {}).get("reason") if refusal_steps else None
        check(reason is not None, "у отказа названа причина (%s)" % reason)

        # --- Анатомия узла -----------------------------------------------------
        anatomy = load(a, "__dbg.anatomy('#hero')")
        check(anatomy["found"] and anatomy["nid"], "анатомия нашла узел (%s)" % anatomy.get("nid"))
        roles = {x["role"] for x in anatomy["areas"]}
        check("hitbox" in roles and "hurtbox" in roles,
              "видны области с ролями (%s)" % sorted(roles))
        check(all("index" in x for x in anatomy["areas"]),
              "у каждой области есть native-индекс")
        check(anatomy["body"] and anatomy["body"]["mask"] is not None,
              "видно тело с фильтром (%s)" % anatomy["body"])
        check(isinstance(anatomy["processing"], dict) and "update" in anatomy["processing"],
              "видна политика обработки (%s)" % anatomy["processing"])

        foe_anatomy = load(a, "__dbg.anatomy('#foe')")
        check(foe_anatomy["processing"]["update"] is False,
              "выключенное обновление врага видно в снимке (%s)" % foe_anatomy["processing"]["update"])

        windows = load(a, "__dbg.anatomy('#hero')")["windows"]
        check(windows is not None, "поле активных окон присутствует (значение %s)" % windows)

        # --- Контакты в удобном виде ------------------------------------------
        contacts = load(a, "__dbg.contacts()")
        check(isinstance(contacts, list), "контакты читаются списком (%d)" % len(contacts))
        if contacts:
            row = contacts[0]
            check("phase" in row and "self" in row and "other" in row,
                  "контакт называет фазу и участников (%s)" % {k: row[k] for k in ("phase", "self", "other")})
            check("hasNormal" in row, "у контакта явно помечено наличие нормали (%s)" % row["hasNormal"])

        # --- Профиль машиночитаем и честен про GPU ----------------------------
        a.eval("engine.profileReset(); $.debug.profiler.on(true); $.debug.profiler.reset()")
        a.step(20)
        prof = a.eval("engine.profile()") or {}
        check(isinstance(prof, dict) and "zones" in prof and "frame_ms" in prof,
              "профиль отдаёт CPU-зоны и frame_ms")
        gpu_available = prof.get("gpu_available")
        check(isinstance(gpu_available, bool), "признак доступности GPU-времени есть (%s)" % gpu_available)
        if gpu_available:
            check(isinstance(prof.get("gpu_ms"), (int, float)),
                  "GPU-время измерено timestamp'ами (%.2f мс)" % prof.get("gpu_ms"))
        else:
            check(prof.get("gpu_ms") is None,
                  "при отсутствии timestamp'ов GPU-время помечено как отсутствующее")
        rows = prof.get("rows") or []
        check(isinstance(rows, list) and len(rows) > 0, "профиль содержит разбивку по зонам (%d)" % len(rows))

        # --- §17.2: история кадра и перцентили --------------------------------
        # Кольцо одно: история и статистика читают те же кадры, что и средние.
        # Поэтому числа обязаны сходиться с уже известным размером окна, а
        # перцентили — с фактической историей, а не быть «правдоподобными».
        stats = prof.get("stats") or {}
        history = prof.get("history")
        hist_len = len(history) if isinstance(history, list) else history
        check(isinstance(history, list) and len(history) > 0,
              "профиль отдаёт историю кадров окна (%s значений)" % hist_len)
        check(stats.get("count", 0) > 0,
              "статистика окна непуста (count=%s)" % stats.get("count"))
        check(hist_len == stats.get("count") == prof.get("frames"),
              "history.length === stats.count === frames (%s)" % hist_len)

        p = [stats.get(k) for k in ("min", "p50", "p95", "p99", "max")]
        numeric = all(isinstance(v, (int, float)) for v in p)
        check(numeric, "min/p50/p95/p99/max — числа (%s)" % (p,))
        if numeric and isinstance(history, list) and history:
            check(p == sorted(p),
                  "перцентили не убывают: " + " ≤ ".join("%.2f" % v for v in p))
            check(abs(p[0] - min(history)) < 1e-9 and abs(p[4] - max(history)) < 1e-9,
                  "min/max совпадают с историей (%.2f … %.2f)"
                  % (min(history), max(history)))
            check(p[0] <= stats.get("mean", 0.0) <= p[4],
                  "mean лежит между min и max (%.2f)" % stats.get("mean", 0.0))
            check(abs(stats.get("current", -1) - history[-1]) < 1e-9,
                  "current — последний кадр окна (%.2f)" % stats.get("current", -1))

        # --- Снимок не меняет симуляцию ---------------------------------------
        before = load(a, "__dbg.stats()")
        a.eval("JSON.stringify($.debug.anatomy('#hero'))")
        a.eval("JSON.stringify($.debug.anatomy('#foe'))")
        a.eval("JSON.stringify($.trace.hits())")
        a.step(10)
        after = load(a, "__dbg.stats()")
        check(before == after,
              "отладочные снимки не меняют состояние боя (%s → %s)" % (before, after))

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, "нет ошибок игрового кода: %s" % errors[:2])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


def types_of(kinds):
    """Краткая подпись шагов цепочки для сообщения."""
    seen = []
    for k in kinds:
        if not seen or seen[-1] != k:
            seen.append(k)
    return " → ".join(seen)


if __name__ == "__main__":
    sys.exit(main())
