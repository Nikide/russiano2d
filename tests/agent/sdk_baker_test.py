#!/usr/bin/env python3
# ===========================================================================
# Phase 4 — Re2D Baker MVP (GLB/glTF + Prop), docs/SDK.md §10.
#
#   GLB → parse → нормализация → выборка поверхности → PNG v2 + character.json
#       → настоящий Re2DSprite вращает результат
#
# Проверяется: несколько low-poly props проходят конвейер; исходный 3D рантайму
# не нужен; диагностика структурирована; CLI и GUI используют один бэкенд
# (`r2d-sdk bake-re2d`); результат открывается и вращается рантаймом.
#
# Запуск (после сборки): python3 tests/agent/sdk_baker_test.py
# ===========================================================================

import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
SDK_BIN = os.path.join(ROOT, "build", "r2d-sdk")
PROPS = os.path.join(ROOT, "tests", "fixtures", "sdk", "props")
OUT = os.path.join(ROOT, "build", "sdk_baker_out")
RUNTIME_GAME = os.path.join(ROOT, "tests", "fixtures", "sdk", "re2d_proj")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def bake(*args):
    p = subprocess.run([SDK_BIN, "bake-re2d", *args], cwd=ROOT, capture_output=True, text=True, timeout=300)
    lines = [l for l in p.stdout.splitlines() if l.strip()]
    return p.returncode, (json.loads(lines[-1]) if lines else {})


def codes(d):
    return [x["code"] for x in d.get("diagnostics", [])]


def read_png(path):
    data = open(path, "rb").read()
    pos, idat, w, h, ct = 8, b"", 0, 0, 0
    while pos < len(data):
        n = struct.unpack(">I", data[pos:pos + 4])[0]
        t, c = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if t == b"IHDR":
            w, h, _, ct = struct.unpack(">IIBB", c[:10])
        elif t == b"IDAT":
            idat += c
    raw = zlib.decompress(idat)
    bpp = 4 if ct == 6 else 3
    stride, rows, prev, i = w * bpp, [], bytearray(w * bpp), 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(bytes(line))
        prev = line
    return w, h, rows, bpp


def painted(path, bg_tolerance=6):
    """Число пикселей скриншота, заметно отличающихся от фона (угол кадра)."""
    w, h, rows, bpp = read_png(path)
    bg = rows[2][2 * bpp:2 * bpp + 3]
    n = 0
    for r in rows:
        for x in range(w):
            p = r[x * bpp:x * bpp + 3]
            if max(abs(p[i] - bg[i]) for i in range(3)) > bg_tolerance:
                n += 1
    return n


def diff_pixels(a_path, b_path):
    wa, ha, ra, ba = read_png(a_path)
    wb, hb, rb, bb = read_png(b_path)
    n = 0
    for y in range(ha):
        for x in range(wa):
            if ra[y][x * ba:x * ba + 3] != rb[y][x * bb:x * bb + 3]:
                n += 1
    return n


def cli_cases():
    shutil.rmtree(OUT, ignore_errors=True)
    results = {}
    # --- несколько реальных low-poly props проходят конвейер --------------------------------------
    expected = {"crate": (1, ".glb"), "barrel": (2, ".glb"), "lamp": (2, ".glb"), "chair": (2, ".gltf")}
    for name, (parts, ext) in expected.items():
        rc, d = bake(os.path.join(PROPS, name + ext), "--type", "prop", "--output", os.path.join(OUT, name))
        results[name] = d
        check(rc == 0 and d["ok"] and d["success"] and d["parts"] == parts, f"{name}{ext}: bake ok, частей {d.get('parts')}")
        check(d["errors"] == 0 and d["atlasUsage"] > 0.1 and d["samples"] > 5000, f"{name}: отсчётов {d.get('samples')}, атлас {d.get('atlasUsage'):.2f}")
        f = d["files"]
        check(all(os.path.isfile(f[k]) for k in ("png", "character", "animations")), f"{name}: PNG, character.json и animations.json записаны")
        check(os.path.isfile(os.path.join(OUT, name, name + ".bake.json")), f"{name}: отчёт .bake.json лежит рядом")
        w, h, _, _ = read_png(f["png"])
        check((w, h) == (1024, 1024), f"{name}: PNG 1024×1024")
        rc2 = subprocess.run([SDK_BIN, "validate", f["character"]], capture_output=True, text=True)
        v = json.loads(rc2.stdout)
        check(rc2.returncode == 0 and v["errors"] == 0, f"{name}: нативный валидатор Re2DSprite принимает результат")
        info = json.loads(subprocess.run([SDK_BIN, "re2d-info", f["character"]], capture_output=True, text=True).stdout)
        check(info["ok"] and info["png"]["sub"] and info["samples"]["active"] == d["samples"], f"{name}: re2d-info читает те же {d['samples']} отсчётов, что записал baker")
        ids = sorted(p["id"] for p in info["parts"] if p["samples"] > 0)
        check(ids == list(range(80, 80 + parts)), f"{name}: ID частей {ids}")

    # --- вписывание (Coordinate Fit) --------------------------------------------------------------------
    for name, d in results.items():
        fit = d["fit"]
        lim = fit["limits"]
        inside = all(lim[a][0] - 1e-3 <= fit[a][0] and fit[a][1] <= lim[a][1] + 1e-3 for a in ("x", "y", "z"))
        check(inside, f"{name}: габарит внутри допустимого диапазона Re2D")
        # Центр по X/Z у начала координат, как просит Origin.
        check(abs(fit["x"][0] + fit["x"][1]) < 0.1 and abs(fit["z"][0] + fit["z"][1]) < 0.1, f"{name}: центр по X/Z в нуле")
    # Y вниз: у лампы абажур (верх модели) должен оказаться при МЕНЬШЕМ Y — проверяем по барицентру отсчётов.
    rc, d = bake(os.path.join(PROPS, "barrel.glb"), "--output", os.path.join(OUT, "barrel_feet"), "--origin", "feet")
    check(rc == 0 and abs(d["fit"]["y"][1]) < 0.05 and d["fit"]["y"][0] >= -64, f"origin feet: низ на Y=0, верх {d['fit']['y'][0]:.1f} в допустимом диапазоне")
    rc, d = bake(os.path.join(PROPS, "crate.glb"), "--output", os.path.join(OUT, "crate_big"), "--scale", "500")
    check(rc == 1 and "SDK_BAKE_FIT_OVERFLOW" in codes(d), "слишком большой --scale: SDK_BAKE_FIT_OVERFLOW")
    det = [x for x in d["diagnostics"] if x["code"] == "SDK_BAKE_FIT_OVERFLOW"][0]
    check(det["details"]["scale"] == 500 and "limits" in det["details"], "диагностика вписывания несёт диапазоны и масштаб")

    # --- режимы UV ------------------------------------------------------------------------------------------
    rc, d = bake(os.path.join(PROPS, "crate.glb"), "--uv", "existing", "--output", os.path.join(OUT, "crate_existing"))
    check(rc == 0 and d["uvMode"] == "existing" and d["uvOverlapTexels"] == 0 and d["atlasUsage"] > 0.5, "Use Existing UV: развёртка куба без наложений")
    rc, d = bake(os.path.join(PROPS, "barrel.glb"), "--uv", "existing", "--output", os.path.join(OUT, "bad"))
    check(rc == 1 and "SDK_BAKE_UV_MISSING" in codes(d), "existing без UV: SDK_BAKE_UV_MISSING")
    rc, d = bake(os.path.join(PROPS, "tiled_uv.glb"), "--uv", "existing", "--output", os.path.join(OUT, "bad"))
    check(rc == 1 and "SDK_BAKE_UV_RANGE" in codes(d), "тайлящиеся UV: SDK_BAKE_UV_RANGE")
    rc, d = bake(os.path.join(PROPS, "crate.glb"), "--uv", "optimized", "--output", os.path.join(OUT, "bad"))
    check(rc == 2 and "SDK_BAKE_UV_MODE_UNSUPPORTED" in codes(d), "Re2D Optimized честно не реализован")
    rc, d = bake(os.path.join(PROPS, "crate.glb"), "--type", "character", "--output", os.path.join(OUT, "bad"))
    check(rc == 1 and "SDK_BAKE_TYPE_UNSUPPORTED" in codes(d), "Character пока не реализован: SDK_BAKE_TYPE_UNSUPPORTED")

    # --- размеры PNG и детерминизм ---------------------------------------------------------------------------
    rc, d = bake(os.path.join(PROPS, "crate.glb"), "--size", "2048", "--output", os.path.join(OUT, "crate_2048"))
    w, h, _, _ = read_png(d["files"]["png"])
    check(rc == 0 and (w, h) == (2048, 2048), "PNG 2048×2048")
    v = json.loads(subprocess.run([SDK_BIN, "validate", d["files"]["character"]], capture_output=True, text=True).stdout)
    check(v["errors"] == 0, "2048: результат валиден")
    rc, d1 = bake(os.path.join(PROPS, "lamp.glb"), "--output", os.path.join(OUT, "lamp_a"))
    rc, d2 = bake(os.path.join(PROPS, "lamp.glb"), "--output", os.path.join(OUT, "lamp_b"))
    h1 = hashlib.sha256(open(d1["files"]["png"], "rb").read()).hexdigest()
    h2 = hashlib.sha256(open(d2["files"]["png"], "rb").read()).hexdigest()
    check(h1 == h2, "bake детерминирован: два запуска дают байт-в-байт один PNG")

    # --- диагностика отказов ------------------------------------------------------------------------------------
    cases = [("bad_draco.gltf", "SDK_BAKE_EXTENSION_UNSUPPORTED"), ("bad_buffer.gltf", "SDK_BAKE_BUFFER_MISSING"),
             ("bad_index.glb", "SDK_BAKE_INDEX_RANGE"), ("bad_truncated.glb", "SDK_BAKE_GLB_HEADER"), ("bad_empty.gltf", "SDK_BAKE_NO_MESH"),
             ("нет_такого.glb", "SDK_BAKE_INPUT_MISSING")]
    for fname, code in cases:
        rc, d = bake(os.path.join(PROPS, fname), "--output", os.path.join(OUT, "bad"))
        check(rc == 1 and not d["ok"] and code in codes(d), f"{fname}: {code}")
    check(codes(results["chair"]) == ["SDK_BAKE_TEXTURE_NO_UV"], "chair.gltf: текстура без UV — предупреждение, а не тишина")
    rc, d = bake()
    check(rc == 2 and "SDK_USAGE" in codes(d), "bake-re2d без аргументов — SDK_USAGE")
    return results


def runtime_cases(results):
    """Результат вращается настоящим Re2DSprite; исходного GLB рядом нет."""
    with Agent(game=RUNTIME_GAME, seed=4) as a:
        a.step(3)
        for name in ("crate", "barrel", "lamp", "chair"):
            character = results[name]["files"]["character"]
            ok = a.eval("(()=>{try{globalThis.n && globalThis.n.remove();globalThis.n=$.re2dSprite.from(%s).at(0,0).size(300,300).re2dMotion('spin',0);return 'ok';}"
                        "catch(e){return String(e.message||e);}})()" % json.dumps(character))
            check(ok == "ok", f"{name}: Re2DSprite загрузил запечённую модель ({ok})")
            info = a.eval("$.re2dSprite.info(globalThis.n)")
            check(info["version"] == 2 and info["surfaceSamples"] == results[name]["samples"], f"{name}: рантайм видит {info['surfaceSamples']} отсчётов поверхности")
            shots = []
            for yaw in (0, 90, 180):
                a.eval(f"globalThis.n.re2dPose({yaw}, 10); 1")
                a.step(3)
                path = os.path.join(OUT, f"{name}_{yaw}.png")
                a.screenshot(path)
                shots.append(path)
            counts = [painted(p) for p in shots]
            check(all(c > 4000 for c in counts), f"{name}: на всех ракурсах нарисовано (пикселей {counts})")
            check(diff_pixels(shots[0], shots[1]) > 300 or name in ("barrel",), f"{name}: поворот меняет изображение")
        # Куб с текстурой: боковая и фронтальная грани рисуются разными кусками текстуры.
    # Исходной модели рядом с результатом нет: рантайм не зависит от GLB.
    check(not any(f.endswith((".glb", ".gltf", ".bin")) for f in os.listdir(os.path.dirname(results["crate"]["files"]["character"]))),
          "рядом с результатом нет исходной 3D-модели — рантайм её не читает")


def gui_cases():
    proj = os.path.join(ROOT, "build", "sdk_baker_proj")
    shutil.rmtree(proj, ignore_errors=True)
    shutil.copytree(PROPS, proj)
    open(os.path.join(proj, "project.json"), "w").write('{"title":"props"}')
    BK = "$.ui.doc('sdk/ui/baker.rml')"

    def wait_idle(a, limit=600):
        a.step(2)
        for _ in range(limit):
            if a.eval("$.sdkApp.state.busy") == 0:
                a.step(2)
                return True
            a.step(2)
        return False

    def snap(a):
        return json.loads(a.eval("JSON.stringify($.sdkApp.snapshot().studios)"))

    with Agent(game="sdk", seed=8) as a:
        wait_idle(a)
        a.eval(f"$.sdkApp.openProject({json.dumps(proj)}); 1")
        wait_idle(a)
        tool = {e["path"]: e["tool"] for e in a.eval("$.sdkApp.state.assets.entries")}
        check(tool.get("crate.glb") == "re2d-baker" and tool.get("chair.gltf") == "re2d-baker", "GLB и glTF открываются в Re2D Baker (sdk_tools.json)")
        a.eval("$.sdkApp.selectAsset('crate.glb'); 1")
        a.eval("$.sdkApp.openAsset().then(() => 1)")
        wait_idle(a)
        a.step(4)
        st = snap(a)["baker"]
        check(st["active"] and st["source"].endswith("crate.glb") and st["uv"] == "auto" and st["size"] == 1024, "Baker открыт на crate.glb с параметрами по умолчанию")
        a.eval(f"{BK}.click('bk-origin-feet'); {BK}.click('bk-size-2048'); {BK}.click('bk-uv-existing')")
        st = snap(a)["baker"]
        check(st["origin"] == "feet" and st["size"] == 2048 and st["uv"] == "existing", "кнопки меняют параметры bake")
        a.eval(f"{BK}.click('bk-uv-auto'); {BK}.click('bk-size-1024'); {BK}.click('bk-origin-center')")

        a.eval(f"{BK}.click('bk-run')")
        check(wait_idle(a), "bake завершился")
        a.step(6)
        st = snap(a)["baker"]
        check(st["ok"] and st["parts"] == 1 and st["atlasUsage"] > 0.5, f"GUI: bake ok, атлас {st['atlasUsage']:.2f}")
        check(st["preview"], "превью: запечённая модель вращается настоящим рантаймом")
        check(os.path.isfile(st["files"]["character"]), "файлы результата записаны рядом с моделью")
        fit = a.eval(f"{BK}.content('bk-fit')")
        check("✓" in fit and "Scale" in fit, "панель Coordinate Fit показывает диапазоны и ✓")
        report = a.eval(f"{BK}.content('bk-report')")
        check("Частей: 1" in report and "треугольников" not in report.lower() or "Треугольников: 12" in report, "панель отчёта показывает статистику")
        a.step(30)
        yaw1 = a.eval("$.re2dSprite.info('#sdk-bake-preview').yaw")
        a.step(30)
        yaw2 = a.eval("$.re2dSprite.info('#sdk-bake-preview').yaw")
        check(yaw1 != yaw2, "превью вращается (yaw меняется)")

        # Тот же CLI-код: результат GUI совпадает с CLI побайтно.
        rc, d = bake(os.path.join(PROPS, "crate.glb"), "--output", os.path.join(OUT, "crate_cli_twin"), "--name", "crate")
        gui_png = hashlib.sha256(open(st["files"]["png"], "rb").read()).hexdigest()
        cli_png = hashlib.sha256(open(d["files"]["png"], "rb").read()).hexdigest()
        check(gui_png == cli_png, "GUI и CLI дают один и тот же PNG (одна реализация baker)")

        # Режим, который не реализован, даёт структурную ошибку.
        a.eval(f"{BK}.click('bk-uv-opt'); {BK}.click('bk-run')")
        wait_idle(a)
        st = snap(a)["baker"]
        check(not st["ok"] and "SDK_BAKE_UV_MODE_UNSUPPORTED" in st["codes"], "Re2D Optimized в GUI: SDK_BAKE_UV_MODE_UNSUPPORTED")
        a.eval(f"{BK}.click('bk-uv-auto'); {BK}.click('bk-run')")
        wait_idle(a)
        a.step(4)
        check(snap(a)["baker"]["ok"], "после возврата на Auto Unwrap bake снова успешен")

        # Результат открывается в Re2DSprite Studio.
        a.eval(f"{BK}.click('bk-open')")
        wait_idle(a)
        a.step(8)
        re = snap(a)["re2d"]
        check(re and re["active"] and re["file"].endswith("crate.character.json") and re["node"] and re["nodeError"] is None,
              "результат открыт в Re2DSprite Studio, рантайм принял модель")
        check(re["codes"] == [], "диагностик нет у запечённой модели")
        a.eval("$.ui.doc('sdk/ui/re2d_studio.rml').click('rs-back')")

        # Ошибочный вход: структурная диагностика в панели.
        a.eval("$.sdkApp.selectAsset('bad_draco.gltf'); 1")
        a.eval("$.sdkApp.openAsset().then(() => 1)")
        wait_idle(a)
        a.eval(f"{BK}.click('bk-run')")
        wait_idle(a)
        st = snap(a)["baker"]
        check(not st["ok"] and "SDK_BAKE_EXTENSION_UNSUPPORTED" in st["codes"], "GUI: сжатая модель — SDK_BAKE_EXTENSION_UNSUPPORTED")
        check("SDK_BAKE_EXTENSION_UNSUPPORTED" in a.eval(f"{BK}.content('bk-diag')"), "ошибка видна в панели диагностик RmlUi")


def main():
    results = cli_cases()
    runtime_cases(results)
    gui_cases()
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
