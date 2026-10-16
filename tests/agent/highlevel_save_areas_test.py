#!/usr/bin/env python3
# ===========================================================================
# §10 плана дополировки: области актёра переживают сохранение и загрузку.
#
# Область (§40/§7.3) — часть узла, а не отдельный узел. Значит и в сейве она
# обязана быть частью данных узла: иначе после загрузки у актёра не осталось бы
# ни хитбокса, ни hurtbox, а выключенная область молча вернулась бы включённой
# (потерянный выключенный hurtbox — это снова открытое окно урона).
#
# Проверяется на реальном движке:
#   * выключенная область остаётся выключенной после load;
#   * включённая — включённой, вместе с геометрией и ролью;
#   * владелец-узел восстанавливается (а не подменяется самим узлом);
#   * область можно включить/выключить ПОСЛЕ загрузки — identity не потеряна;
#   * выключенная область действительно не участвует в запросах (areaOverlap).
#
# Фикстура — tests/fixtures/save_areas.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_save_areas_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "save_areas")
SLOT = "build/test_saves/slot-9.json"

#: Поля, которые законно меняются от сохранения к сохранению: это метаданные
#: момента, а не состояние мира.
VOLATILE = ("saved_at", "saved_frame", "time")


def same_payload(first, second):
    """Сравнить два сейва без полей момента (§10: данные не должны «плыть»)."""
    import json

    def strip(value):
        if isinstance(value, dict):
            return {k: strip(v) for k, v in value.items() if k not in VOLATILE}
        if isinstance(value, list):
            return [strip(v) for v in value]
        return value

    try:
        return strip(json.loads(first)) == strip(json.loads(second))
    except Exception:
        return False


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def area_of(a, node, name):
    return a.eval("(() => { const l = $('#%s').areas();"
                  " return l.filter((x) => x.name === '%s')[0] || null; })()" % (node, name))


def main():
    with Agent(game=GAME, seed=5) as a:
        a.step(5)

        before_guard = area_of(a, "guard", "hurtbox")
        before_blade = area_of(a, "blade", "attack")
        check(before_guard and before_guard.get("enabled") is True, "до сейва hurtbox включён")
        check(before_blade and before_blade.get("enabled") is False, "до сейва attack выключен")

        # Выключаем hurtbox и меняем геометрию attack: сейв обязан запомнить и то,
        # и другое.
        a.eval("$('#guard').areaOn('hurtbox', false)")
        a.eval("$('#blade').area('attack', { w: 64, h: 24 })")
        a.step(2)

        check(a.eval("$.save.save(9)") is True, "слот 9 записан")
        a.eval("$.save.dir('build/test_saves')")
        a.eval("$.save.save(9)")
        payload_path = SLOT
        check(a.eval("$.fs.exists('%s')" % payload_path) is True, "файл слота на диске")
        check(a.eval("$.fs.readText('%s').indexOf('\"areas\"') >= 0" % payload_path) is True,
              "в слоте есть раздел областей узла")

        # Ломаем состояние: включаем hurtbox, уменьшаем attack и удаляем области.
        a.eval("$('#guard').areaOn('hurtbox', true)")
        a.eval("$('#blade').area('attack', { w: 2, h: 2 })")
        a.step(2)
        check(area_of(a, "guard", "hurtbox").get("enabled") is True,
              "перед загрузкой hurtbox снова включён (состояние испорчено)")

        result = a.eval("$.save.load(9)")
        check(result is True, "слот загружен (load вернул true): %s" % (result,))
        a.step(3)

        # save → load → save обязан дать те же ДАННЫЕ (кроме метаданных времени):
        # иначе каждое сохранение после загрузки копило бы расхождения —
        # порядок областей, лишние поля, потерянные флаги.
        first = a.eval("$.fs.readText('%s')" % SLOT)
        a.eval("$.save.save(10)")
        second = a.eval("$.fs.readText('build/test_saves/slot-10.json')")
        check(isinstance(first, str) and same_payload(first, second),
              "save → load → save даёт те же данные")

        after_guard = area_of(a, "guard", "hurtbox")
        after_blade = area_of(a, "blade", "attack")
        check(after_guard is not None, "hurtbox существует после загрузки")
        check(after_blade is not None, "attack существует после загрузки")
        if after_guard:
            check(after_guard.get("enabled") is False,
                  "выключенный hurtbox остался выключенным")
            check(after_guard.get("role") == "hurtbox", "роль hurtbox сохранилась")
            check(after_guard.get("w") == 40 and after_guard.get("h") == 40,
                  "геометрия hurtbox сохранилась: %sx%s"
                  % (after_guard.get("w"), after_guard.get("h")))
        if after_blade:
            check(after_blade.get("enabled") is False, "выключенный attack остался выключенным")
            check(after_blade.get("w") == 64 and after_blade.get("h") == 24,
                  "изменённая ПЕРЕД сейвом геометрия attack сохранилась: %sx%s"
                  % (after_blade.get("w"), after_blade.get("h")))

        # Владелец: attack объявлен с owner=guard, а не «сам узел blade».
        owner = a.eval("(() => { const l = $('#blade').areas();"
                       " const x = l.filter((y) => y.name === 'attack')[0];"
                       " return x ? (x.owner && x.owner.id ? x.owner.id : String(x.owner)) : null; })()")
        check(owner == "guard", "владелец attack после загрузки — guard, а не blade (%s)" % owner)

        # После загрузки область снова управляема: identity не потеряна.
        a.eval("$('#guard').areaOn('hurtbox', true)")
        a.step(2)
        check(area_of(a, "guard", "hurtbox").get("enabled") is True,
              "область включается после загрузки")
        a.eval("$('#guard').areaOn('hurtbox', false)")
        a.step(2)
        check(area_of(a, "guard", "hurtbox").get("enabled") is False,
              "и снова выключается (OFF→ON→OFF не ломает identity)")

        # Выключенная область не участвует в запросах: цель внутри неё не находится.
        a.eval("$('#blade').at(200, 180)")
        a.step(2)
        off = a.eval("$('#blade').areaOverlap('attack').length")
        a.eval("$('#blade').areaOn('attack', true)")
        a.step(2)
        on = a.eval("$('#blade').areaOverlap('attack').length")
        check(off == 0, "выключенная область никого не находит (%s)" % off)
        check(on >= 1, "включённая область находит цель (%s)" % on)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
