#!/usr/bin/env python3
# ===========================================================================
# Real2D v4, стадия A: доказательный тест.
#
# Проверяет не «картинка похожа», а обязательства спецификации
# (demos/real2d/REAL2D_V4_SPEC.md §17): петля yaw, шов на 0/2π, не-анкорные
# углы, provenance цепочки пикселя, мутации источника и hard-validator
# вывернутых треугольников. Всё считается по реальным кадрам движка.
#
# Запуск:
#   python3 tests/agent/real2d_test.py
# ===========================================================================

import hashlib
import os
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

# Углы из спеки §17: ни один не совпадает с якорным (0/30/…/330).
FIXED_DEG = [33.7, 58.2, 103.4, 177.1, 238.6, 319.3, 37.5]
FAILURES = []

# Что обязано лежать в контейнере: манифест, один атлас и бинарная геометрия.
# Любой лишний PNG или файл с именем угла — это готовый кадр, которого в
# рантайм-пакете быть не должно (спека §17, runtime package audit).
CONTAINER = os.path.join(ROOT, "demos", "real2d", "assets", "head_real2d_v4.r2d4")
SOURCE_SHEET = os.path.join(ROOT, "demos", "real2d", "assets",
                            "head_components_candidate_v1.png")
EXPECTED_ENTRIES = {
    "manifest.json", "atlas/atlas_00.png",
    "geometry/verts.f32", "geometry/uvs.f32", "geometry/tris.u32",
    "geometry/bind_tri.u32", "geometry/bind_w.f32", "geometry/cage.f32",
    "geometry/manifold.f32",
}


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def audit_package():
    """Что лежит в контейнере: без готовых кадров и с исходным атласом."""
    if not os.path.exists(CONTAINER):
        check(False, f"контейнер на месте: {CONTAINER}")
        return
    with zipfile.ZipFile(CONTAINER) as archive:
        names = archive.namelist()
        atlas = archive.read("atlas/atlas_00.png")
    check(set(names) == EXPECTED_ENTRIES,
          f"в контейнере только манифест, атлас и геометрия (лишнее: {sorted(set(names) - EXPECTED_ENTRIES)})")
    check(sum(1 for n in names if n.lower().endswith(".png")) == 1,
          "в контейнере ровно один PNG — атлас; полнофигурных кадров нет")
    check(not [n for n in names if any(c.isdigit() for c in os.path.basename(n)) and n.endswith(".png")
               and n != "atlas/atlas_00.png"],
          "нет файлов с углами в имени (ready-frame cache отсутствует)")
    with open(SOURCE_SHEET, "rb") as handle:
        source = handle.read()
    check(hashlib.sha256(atlas).hexdigest() == hashlib.sha256(source).hexdigest(),
          "атлас контейнера байт в байт равен исходному шиту (texels не перерисованы)")


def main():
    with Agent(game="demos/real2d", seed=7) as a:
        a.step(5)
        info = a.eval("real2dDemo.info()")
        if not isinstance(info, dict):
            check(False, "контейнер не загрузился вовсе")
            return 1
        check(info.get("ok") is True, f"cadr собран без ошибок (last_error='{info.get('last_error')}')")
        check(info.get("stage") == "A-head-only", f"стадия объявлена честно ({info.get('stage')})")
        check(info.get("canvas") == 512, f"растр {info.get('canvas')}×{info.get('canvas')}")
        check(int(info.get("rank", 0)) >= 1 and int(info.get("dim", 0)) > 0,
              f"манифолд: dim={info.get('dim')} rank={info.get('rank')} K={info.get('yaw_K')}")
        check(info.get("atlas_w", 0) > 0 and info.get("patches", 0) == 20,
              f"ассет: атлас {info.get('atlas_w')}px, патчей {info.get('patches')}")

        # 1. Не-анкорные углы: кадр непустой, валидатор молчит.
        for deg in FIXED_DEG:
            a.eval(f"real2dDemo.setYaw({deg} * Math.PI / 180);1")
            m = a.eval("real2dDemo.measure()")
            check(bool(m.get("ok")) and int(m.get("fold_rejects", -1)) == 0,
                  f"{deg}°: без отказов валидатора (error='{m.get('last_error')}')")
            check(int(m.get("opaque", 0)) > 2000,
                  f"{deg}°: кадр непустой ({m.get('opaque')} непрозрачных пикселей)")
            check(m.get("bbox") is not None,
                  f"{deg}°: силуэт найден в кадре (bbox={m.get('bbox')})")

        # 2. Петля yaw: θ и θ±2πk — один и тот же кадр (R(θ+2π)=R(θ)).
        hashes = {}
        for expr, key in (("0", "0"), ("2*Math.PI", "+2π"), ("-2*Math.PI", "−2π"),
                          ("4*Math.PI", "+4π")):
            a.eval(f"real2dDemo.setYaw({expr});1")
            hashes[key] = a.eval("real2dDemo.measure().hash")
        check(len(set(hashes.values())) == 1,
              f"петля yaw: одинаковый кадр на θ, θ±2πk ({hashes})")

        # 3. Шов: ε-окрестность нуля и 2π. Критерий — не «ни одного пикселя не
        #    изменилось» (на жёсткой альфе кромки одиночный пиксель может
        #    перескочить), а: среднее не растёт, скачки остаются единичными, и
        #    при десятикратном ε картинка меняется не более чем в ~10 раз —
        #    то есть функция в этом месте непрерывна, а не разрывна.
        for label, expr in (("0/−ε", "real2dDemo.compare(0, -1e-4)"),
                            ("0/+ε", "real2dDemo.compare(0, 1e-4)"),
                            ("2π−ε/2π", "real2dDemo.compare(2*Math.PI - 1e-4, 2*Math.PI)")):
            diff = a.eval(expr)
            check(float(diff["mean"]) <= 1.0,
                  f"шов {label}: среднее |Δ|={round(diff['mean'], 4)} ≤ 1/255")
            check(float(diff["big_share"]) <= 0.005,
                  f"шов {label}: скачков >8/255 всего {round(100 * diff['big_share'], 4)}% пикселей")
        small = a.eval("real2dDemo.compare(0, 1e-4)")
        large = a.eval("real2dDemo.compare(0, 1e-3)")
        check(int(large["max"]) <= max(16, int(small["max"]) * 12),
              f"шов непрерывен: max|Δ(ε)|={small['max']} при ε=1e−4 и {large['max']} при 10ε")

        # 4. Provenance: у непустого пикселя есть цепочка patch → треугольник.
        chain = a.eval("real2dDemo.provenanceAt(256, 430)")
        check(isinstance(chain, dict) and chain.get("patch"),
              f"provenance: пиксель объясняется патчем ({chain})")
        check(isinstance(chain, dict) and isinstance(chain.get("triangle"), int),
              "provenance: указан треугольник")
        empty = a.eval("real2dDemo.provenanceAt(2, 2)")
        check(empty is None, "provenance: пустой пиксель без цепочки (фон не выдуман)")

        # 5. Полное зануление атласа делает кадр прозрачным, восстановление
        #    возвращает тот же кадр — источник пикселей это атлас, а не кэш кадров.
        a.eval("real2dDemo.setYaw(0);1")
        base = a.eval("real2dDemo.measure()")
        a.eval("real2dDemo.zeroAtlas(); real2dDemo.renderAt(0);1")
        zeroed = a.eval("real2dDemo.measure()")
        check(int(zeroed["opaque"]) == 0 and int(zeroed["partial"]) == 0,
              f"зануление атласа: кадр пуст (непрозрачных {zeroed['opaque']}, полупрозрачных {zeroed['partial']})")
        a.eval("real2dDemo.restoreAtlas(); real2dDemo.renderAt(0);1")
        restored = a.eval("real2dDemo.measure()")
        check(restored["hash"] == base["hash"],
              "восстановление атласа: кадр побитово тот же")

        # 6. Мутация одного патча меняет только его пиксели (по provenance).
        a.eval("real2dDemo.setYaw(0); real2dDemo.snapshot();1")
        a.eval("real2dDemo.tintPatch('hair_bangs', [255, 0, 0]); real2dDemo.renderAt(0);1")
        diff = a.eval("real2dDemo.diffSnapshot()")
        changed = int(diff["changed"])
        owned = int(diff["by_patch"].get("hair_bangs", 0))
        check(changed > 0, f"мутация чёлки: изменения есть ({changed} пикселей)")
        check(owned / max(changed, 1) >= 0.95,
              f"мутация чёлки: {owned} из {changed} изменённых пикселей принадлежат чёлке "
              f"({round(100 * owned / max(changed, 1), 2)}%)")
        others = {k: v for k, v in diff["by_patch"].items() if k != "hair_bangs"}
        check(sum(others.values()) + int(diff["unowned"]) <= 0.05 * max(changed, 1),
              f"прочие патчи затронуты только по кромке ({others}, без владельца {diff['unowned']})")
        a.eval("real2dDemo.restoreAtlas(); real2dDemo.renderAt(0);1")

        # 7. Hard-validator: ни одного вывернутого треугольника, швов fill rule нет.
        a.eval("real2dDemo.render({ yaw: 0, validate: true });1")
        validated = a.eval("real2dDemo.measure()")
        check(int(validated["fold_rejects"]) == 0, "валидатор: вывернутых треугольников нет")
        check(float(validated["max_coverage"]) <= 1.001,
              f"fill rule: пиксель не записан дважды (max coverage {validated['max_coverage']})")

        # 8. Полный круг: каждый из 24 шагов даёт непустой кадр без отказов,
        #    и кадры РАЗНЫЕ — то есть углы вычисляются, а не берутся из готовых.
        broken = []
        hashes = set()
        for step in range(24):
            deg = step * 15.0
            a.eval(f"real2dDemo.setYaw({deg} * Math.PI / 180);1")
            m = a.eval("real2dDemo.measure()")
            hashes.add(m.get("hash"))
            if not m.get("ok") or int(m.get("opaque", 0)) < 1000 or int(m.get("fold_rejects", 1)) != 0:
                broken.append((deg, m.get("opaque"), m.get("last_error")))
        check(not broken, f"полный круг yaw (24 шага) без провалов ({broken[:3]})")
        check(len(hashes) >= 20,
              f"кадры на 24 углах различны ({len(hashes)} уникальных хешей) — готовых кадров нет")

    # 9. Аудит самого пакета: что реально лежит в контейнере.
    audit_package()
    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
