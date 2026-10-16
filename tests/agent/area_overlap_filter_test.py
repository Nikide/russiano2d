#!/usr/bin/env python3
# ===========================================================================
# A3 отчёта BASHNYA (0.1.34): `areaOverlap` фильтровал пересечения В ДВЕ
# стороны. Тело попадало в результат, только если
#     (маска области & слой тела) != 0   И   (маска тела & слой области) != 0.
# Из-за второго условия маска ЧУЖОГО тела решала, увидит ли его моя область:
# у врага область `hurt` со слоем 0x8 и полной маской не находила цель со слоем
# 0x2 и маской 0x1|0x4 (5 & 8 == 0), хотя сама область её видит.
#
# Правило движка для запросов одно и то же во всех путях ($.world.raycast,
# $.world.queryPoint/Box/Circle, engine.castShape): у ЗАПРОСА нет своего слоя
# (категория запроса — все биты), поэтому решает только маска запроса; маска
# цели не участвует. Осознанное исключение — тело с маской 0 («не сталкивается
# ни с кем»): Box2D не отдаёт его ни одному запросу, и это проверяется отдельно.
#
# После правки `.areaOverlap()` следует тому же правилу (односторонний фильтр
# по маске области). Прежний двусторонний режим остался доступен явно:
# `.areaOverlap('hurt', { both: true })` — и он же проверяется здесь, чтобы
# совместимость не была обещанием без реализации.
#
# Сцена — repro из отчёта (числа их):
#   #foe     динамическое тело, слой 0x4, маска 0x1, область `hurt` 220x120;
#   #target  статичное тело, слой 0x2, маска 0x1|0x4 (её маска НЕ пересекает
#            слой области 0x8 — это и был сломанный случай);
#   #wall    статичное тело, слой 0x1, маска «все биты» — видна всегда;
#   #ghost   статичное тело, слой 0x2, маска 0 — не отдаётся ни одному запросу.
# Сцена собирается из теста: отдельная фикстура не нужна, числа видны рядом с
# проверками.
#
# Запуск (после сборки):
#   python3 tests/agent/area_overlap_filter_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/area_overlap_filter_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "bare")
FAILURES = []

AREA_ALL = 0xFFFFFFFF
LAYER_AREA = 0x8
MASK_ONLY_WALL = 0x1


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


SETUP = """(() => {
    // Гравитация выключена: сцена обязана стоять на месте между кадрами.
    $.world.gravity(0, 0);

    // Враг — динамическое тело со слоем 0x4 и маской 0x1 (числа отчёта).
    $('<enemy>', { id: 'foe' }).at(400, 300).size(24, 24)
        .layerBits(0x4).mask(0x1).gravity(false).appendTo($.world);

    // Цель: слой 0x2, маска 0x1|0x4. Её маска не пересекает слой области 0x8 —
    // именно на ней ломался хитбокс.
    $('<rect>', { id: 'target' }).at(340, 300).size(20, 20)
        .body('static').layerBits(0x2).mask(0x1 | 0x4).appendTo($.world);

    // Стена: слой 0x1 и полная маска — попадает в запрос при любом слое области.
    $('<wall>', { id: 'wall' }).at(460, 300).size(20, 20)
        .body('static').layerBits(0x1).mask(0xFFFFFFFF).appendTo($.world);

    // Тень: маска 0 — «не сталкивается ни с кем», запросы её не возвращают.
    $('<rect>', { id: 'ghost' }).at(400, 340).size(20, 20)
        .body('static').layerBits(0x2).mask(0).appendTo($.world);

    return true;
})()"""


def area_filter(a, layer, mask):
    """Объявить область `hurt` с фильтром (layer, mask) и дать кадру устояться."""
    a.eval("$('#foe').area('hurt', { shape: 'box', w: 220, h: 120, sensor: true,"
           " layer: %d, mask: %d }); 'ok'" % (layer, mask))
    a.step(2)


def found(a, opts=None):
    """nid найденных узлов, в устойчивом порядке (nid — публичный id узла)."""
    call = "$('#foe').areaOverlap('hurt'%s)" % ("" if opts is None else ", %s" % opts)
    return a.eval("(() => { const r = %s;"
                  " return r.map((h) => (h && h.node) ? h.node.nid() : null).sort(); })()" % call)


def names(raw, by_nid):
    """Человекочитаемые имена для отчёта и проверок."""
    return sorted(by_nid.get(x, str(x)) for x in raw)


def raw_native(a, layer, mask):
    """Сколько тел вернул СЫРОЙ биндинг engine.shapeOverlaps с этим фильтром."""
    return a.eval("(() => { const n = $('#foe').get(0); const area = $('#foe').area('hurt');"
                  " return engine.shapeOverlaps(n.body, area.index, %d, %d, 32).length; })()"
                  % (layer, mask))


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.eval(SETUP)
        a.step(2)

        check(a.eval("$('#foe').get(0).body") >= 0, "у врага есть тело")
        check(a.eval("$('#target').get(0).body") >= 0 and a.eval("$('#wall').get(0).body") >= 0,
              "цель и стена имеют тела")
        by_nid = {a.eval("$('#%s').nid()" % name): name
                  for name in ("target", "wall", "ghost")}

        # --- Главный случай отчёта: маска ЦЕЛИ не должна решать -----------------
        area_filter(a, LAYER_AREA, AREA_ALL)
        check(a.eval("$('#foe').area('hurt').index") >= 0, "область hurt объявлена")
        before = names(found(a), by_nid)
        print("  --   слой области 0x%X, маска 0x%X → %s" % (LAYER_AREA, AREA_ALL, before))
        check("target" in before,
              "цель со своей маской 0x1|0x4 ВИДНА области со слоем 0x%X и полной маской (%s)"
              % (LAYER_AREA, before))
        check("wall" in before, "стена с полной маской видна (%s)" % before)
        check("ghost" not in before,
              "тело с маской 0 в запрос не попадает — правило движка (%s)" % before)
        check(sorted(before) == ["target", "wall"],
              "область со слоем 0x%X и полной маской видит ровно цель и стену (%s)"
              % (LAYER_AREA, before))

        # --- Маска ОБЛАСТИ решает: слой цели вне маски — не видна ---------------
        area_filter(a, LAYER_AREA, MASK_ONLY_WALL)
        masked = names(found(a), by_nid)
        print("  --   слой области 0x%X, маска 0x%X → %s" % (LAYER_AREA, MASK_ONLY_WALL, masked))
        check(masked == ["wall"],
              "маска области 0x%X оставляет только стену (слой 0x1), цель (слой 0x2) не видна (%s)"
              % (MASK_ONLY_WALL, masked))

        # --- Явный двусторонний режим для совместимости -------------------------
        area_filter(a, LAYER_AREA, AREA_ALL)
        both = names(found(a, "{ both: true }"), by_nid)
        print("  --   слой области 0x%X, полная маска, { both: true } → %s" % (LAYER_AREA, both))
        check(both == ["wall"],
              "{ both: true } возвращает прежний двусторонний фильтр: цель со своей маской "
              "0x1|0x4 в нём не проходит (%s)" % both)
        check("target" in names(found(a), by_nid),
              "без { both: true } та же цель снова видна (%s)" % names(found(a), by_nid))

        # --- Сырой биндинг остался двусторонним (правило живёт в JS-слое) -------
        area_filter(a, LAYER_AREA, AREA_ALL)
        raw = raw_native(a, LAYER_AREA, AREA_ALL)
        print("  --   engine.shapeOverlaps(слой 0x%X, маска 0x%X) → %d тел"
              % (LAYER_AREA, AREA_ALL, raw))
        check(raw == 1,
              "сырой engine.shapeOverlaps сохранил фильтр Box2D (видна только стена: %d)" % raw)

        # --- Слой области запрос не сужает: решает маска ------------------------
        # У запроса нет своего слоя (как у $.world.raycast), поэтому слой самой
        # области на то, кого она видит, не влияет — влияет только её маска.
        area_filter(a, 0x8000, AREA_ALL)
        alien = names(found(a), by_nid)
        print("  --   слой области 0x8000, полная маска → %s" % alien)
        check(alien == ["target", "wall"],
              "слой области не сужает запрос: с полной маской видны цель и стена (%s)" % alien)

        area_filter(a, LAYER_AREA, 0x2)
        only_target = names(found(a), by_nid)
        print("  --   слой области 0x%X, маска 0x2 → %s" % (LAYER_AREA, only_target))
        check(only_target == ["target"],
              "маска области 0x2 видит только цель (слой 0x2), стена (слой 0x1) не видна (%s)"
              % only_target)

        # --- Явная маска запроса переопределяет маску области -------------------
        area_filter(a, LAYER_AREA, MASK_ONLY_WALL)
        override = names(found(a, "{ mask: 0x2 }"), by_nid)
        print("  --   маска области 0x%X, запрос { mask: 0x2 } → %s" % (MASK_ONLY_WALL, override))
        check(override == ["target"],
              "явный { mask: 0x2 } переопределяет маску области (%s)" % override)

        a.eval("$.world.gravity(0, 0); 'ok'")


if __name__ == "__main__":
    main()
    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")
    sys.exit(0)
