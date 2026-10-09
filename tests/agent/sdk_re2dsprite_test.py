#!/usr/bin/env python3
# ===========================================================================
# Phase 3 — Re2DSprite Studio (docs/SDK.md §9): загрузка, просмотр настоящим
# рантаймом, yaw/pitch, отладочные виды карт, осмотр поверхности, проверка,
# правка скелета, сохранение и hot reload; невалидный ассет даёт диагностику.
#
# Запуск (после сборки): python3 tests/agent/sdk_re2dsprite_test.py
# ===========================================================================

import json
import os
import shutil
import struct
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
SDK_BIN = os.path.join(ROOT, "build", "r2d-sdk")
SRC = os.path.join(ROOT, "tests", "fixtures", "sdk", "re2d_proj")
PROJ = os.path.join(ROOT, "build", "sdk_re2d_proj")
MODEL = os.path.join(PROJ, "animal.character.json")
RS = "$.ui.doc('sdk/ui/re2d_studio.rml')"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def wait_idle(a, limit=400):
    a.step(2)
    for _ in range(limit):
        if a.eval("$.sdkApp.state.busy") == 0:
            a.step(2)
            return True
        a.step(2)
    return False


def snap(a):
    return json.loads(a.eval("JSON.stringify($.sdkApp.snapshot())"))


def rs(a):
    return snap(a)["studios"]["re2d"]


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def open_in_studio(a, model):
    a.eval(f"$.sdkApp.openProject({json.dumps(os.path.dirname(model))}); 1")
    wait_idle(a)
    name = os.path.basename(model)
    a.eval(f"$.sdkApp.selectAsset({json.dumps(name)}); 1")
    a.eval("$.sdkApp.openAsset().then(() => 1)")
    wait_idle(a)
    a.step(6)


def main():
    shutil.rmtree(PROJ, ignore_errors=True)
    shutil.copytree(SRC, PROJ)
    original = open(MODEL, encoding="utf-8").read()

    with Agent(game="sdk", seed=9) as a:
        wait_idle(a)
        a.eval(f"$.sdkApp.openProject({json.dumps(PROJ)}); 1")
        wait_idle(a)
        tool = {e["path"]: e["tool"] for e in a.eval("$.sdkApp.state.assets.entries")}
        check(tool.get("animal.character.json") == "re2dsprite-studio", "character.json открывается в Re2DSprite Studio (sdk_tools.json)")

        # --- Загрузка и просмотр настоящим рантаймом ----------------------------------------------------
        open_in_studio(a, MODEL)
        st = rs(a)
        check(st["active"] and st["file"] == MODEL, "студия открыла существующий asset")
        check(st["node"] and st["nodeError"] is None, "рантайм принял модель (узел $.re2dSprite создан)")
        check(st["runtime"] and st["runtime"]["version"] == 2, "PNG v2 загружен нативным рантаймом")
        check(st["clips"] == ["walk"], "клипы читаются из animations.json")
        check(a.eval(f"{RS}.rect('rs-viewport').w") > 300, "окно просмотра имеет геометрию")
        check(a.eval("$('#sdk-re2d').length") == 1, "в сцене ровно один узел просмотра")
        check(a.eval("$.re2dSprite.info('#sdk-re2d').hotReload") is True, "hot reload узла включён (модель читается с диска)")
        check(st["codes"] == [], "реальный ассет: диагностик нет")

        # yaw/pitch полями и мышью.
        a.eval(f"{RS}.setValue('v-yaw','45'); {RS}.setValue('v-pitch','-20'); {RS}.click('v-apply')")
        info = a.eval("$.re2dSprite.info('#sdk-re2d')")
        check(round(info["yaw"]) == 45 and round(info["pitch"]) == -20, "yaw/pitch применены к настоящему узлу рантайма")
        a.eval(f"{RS}.setValue('v-yaw','200'); {RS}.setValue('v-pitch','99'); {RS}.click('v-apply')")
        info = a.eval("$.re2dSprite.info('#sdk-re2d')")
        check(round(info["yaw"]) == -160 and info["pitch"] == 75, "углы нормализованы как в рантайме: yaw заворачивается, pitch ≤ 75")
        a.eval(f"{RS}.click('v-reset')")
        r = a.eval(f"{RS}.rect('rs-viewport')")
        cx, cy = r["x"] + r["w"] / 2, r["y"] + r["h"] / 2
        a.mouse_move(x=cx, y=cy); a.step(2)
        a.mouse(button=1, action="down"); a.step(2)
        a.mouse_move(x=cx + 60, y=cy - 30); a.step(2)
        a.mouse(button=1, action="up"); a.step(3)
        st = rs(a)
        check(abs(st["yaw"] - 36) < 1 and abs(st["pitch"] - 18) < 1, f"перетаскивание мыши вращает модель (yaw {st['yaw']:.0f}, pitch {st['pitch']:.0f})")
        a.eval(f"{RS}.click('v-reset')")

        # Движения, стиль, тело.
        a.eval(f"{RS}.click('mo-0')")
        check(rs(a)["motion"] == "walk" and a.eval("$.re2dSprite.info('#sdk-re2d').motion.mode") == "walk", "клип walk включён у рантайма")
        a.eval(f"{RS}.click('v-style-pixel')")
        check(a.eval("$.re2dSprite.info('#sdk-re2d').style") == "pixel", "стиль pixel применён рантаймом")
        a.eval(f"{RS}.click('v-style-anime')")
        check(a.eval("$.re2dSprite.info('#sdk-re2d').style") == "anime", "стиль anime вернулся")
        a.step(30)
        check(a.eval("$.re2dSprite.info('#sdk-re2d').animationTime") > 0, "анимация идёт кадровым шагом движка")

        # Скриншот: настоящая картинка рантайма в окне просмотра.
        shot = os.path.join(ROOT, "build", "sdk_re2d_shot.png")
        a.screenshot(shot)
        check(os.path.getsize(shot) > 4000, "скриншот студии снят")

        # --- Поверхность: отладочные виды карт ---------------------------------------------------------------
        a.eval(f"{RS}.click('rs-tab-surface')")
        wait_idle(a)
        a.step(4)
        st = rs(a)
        check(st["tab"] == "surface" and st["mode"] == "material" and not st["node"], "вкладка «Поверхность»: вид материала, узел просмотра убран")
        dbg = a.eval("$.sdkApp.studios.re2d.state.debug && $.sdkApp.studios.re2d.state.debug.path")
        check(dbg and os.path.isfile(dbg) and png_size(dbg) == (768, 576), "отладочный PNG 768×576 построен нативным r2d-sdk")
        for mode in ("part", "owner", "x", "y", "z", "coverage", "group", "overlap"):
            a.eval(f"{RS}.click('md-{mode}')")
            wait_idle(a)
            check(rs(a)["mode"] == mode and os.path.isfile(a.eval("$.sdkApp.studios.re2d.state.debug.path")), f"вид «{mode}» построен")
        a.eval(f"{RS}.click('md-part')")
        wait_idle(a)
        a.step(4)

        # Осмотр отсчёта: мышь над картой → нативный re2d-sample.
        d = a.eval("JSON.parse(JSON.stringify($.sdkApp.studios.re2d.state.debug))")
        found = None
        rc = subprocess.run([SDK_BIN, "re2d-info", MODEL], capture_output=True, text=True)
        info = json.loads(rc.stdout)
        check(info["ok"] and info["png"]["headerOk"] and info["samples"]["active"] > 100, "re2d-info: PNG v2 с заголовком и активными отсчётами")
        ids = {p["id"]: p["bone"] for p in info["parts"]}
        check(ids.get(90) == "body" and ids.get(91) == "head", "re2d-info: части сопоставлены с костями")
        # Ищем отсчёт тела по сэмплам нативной команды (первые нашедшиеся).
        for my in range(10, 190, 7):
            for mx in range(10, 250, 7):
                out = json.loads(subprocess.run([SDK_BIN, "re2d-sample", MODEL, "--x", str(mx), "--y", str(my)], capture_output=True, text=True).stdout)
                if out["sample"] and out["sample"]["coverage"] == 255 and out["sample"]["id"] in ids:
                    found = (mx, my, out["sample"])
                    break
            if found:
                break
        check(found is not None, "нашёлся активный отсчёт для осмотра")
        mx, my, expect = found
        a.mouse_move(x=d["x"] + (mx + 0.5) * d["cell"], y=d["y"] + (my + 0.5) * d["cell"]); a.step(3)
        wait_idle(a); a.step(4)
        got = rs(a)["sample"]
        check(got and got["id"] == expect["id"] and got["bone"] == ids[expect["id"]], f"осмотр под курсором: ID {expect['id']} · {ids[expect['id']]}")
        check(got and abs(got["x"] - expect["x"]) < 1e-3 and abs(got["z"] - expect["z"]) < 1e-3, "осмотр: XYZ отсчёта совпали с нативным чтением")
        check("ID" in a.eval(f"{RS}.content('rs-sample')"), "значения отсчёта показаны в RmlUi")

        # --- Скелет: правка, undo/redo, сохранение ----------------------------------------------------------------
        a.eval(f"{RS}.click('rs-tab-rig')")
        a.step(3)
        a.eval(f"{RS}.click('bn-1')")      # head
        check(rs(a)["boneSel"] == "head", "клик по строке выбирает кость head")
        a.eval(f"{RS}.setValue('b-px','-14'); {RS}.setValue('b-py','-6'); {RS}.setValue('b-pz','0')")
        a.eval(f"{RS}.setValue('b-qx',''); {RS}.setValue('b-qy',''); {RS}.setValue('b-qz','')")
        a.eval(f"{RS}.click('b-apply')")
        check(a.eval("JSON.stringify($.sdkApp.studios.re2d.def.rig.bones[1].pivot)") == "[-14,-6,0]", "pivot кости изменён в модели")
        check(rs(a)["dirty"] and rs(a)["canUndo"], "есть несохранённые правки и undo")
        a.eval(f"{RS}.click('rs-undo')")
        check(a.eval("JSON.stringify($.sdkApp.studios.re2d.def.rig.bones[1].pivot)") == "[-13,-5,0]", "undo вернул pivot")
        a.eval(f"{RS}.click('rs-redo')")
        check(a.eval("JSON.stringify($.sdkApp.studios.re2d.def.rig.bones[1].pivot)") == "[-14,-6,0]", "redo повторил правку")
        # Недопустимая правка отклоняется понятно и модель не портится.
        a.eval(f"{RS}.setValue('p-id','90'); {RS}.setValue('p-bone','нет_такой'); {RS}.click('p-apply')")
        check("SDK_EDIT_REJECTED" in rs(a)["codes"], "переназначение на несуществующую кость отклонено")
        check(a.eval("$.sdkApp.studios.re2d.def.rig.parts[0].bone") == "body", "часть осталась на своей кости")

        # Проверка черновика (несохранённых правок).
        a.eval(f"{RS}.click('rs-validate')")
        wait_idle(a)
        check(rs(a)["codes"] == [], "проверка черновика: ошибок нет")

        a.eval(f"{RS}.click('rs-save')")
        check(wait_idle(a), "сохранение завершилось")
        saved = open(MODEL, encoding="utf-8").read()
        check(saved != original, "файл на диске изменился")
        o_lines, s_lines = original.splitlines(), saved.splitlines()
        changed = [i for i, (x, y) in enumerate(zip(o_lines, s_lines)) if x != y]
        check(len(o_lines) == len(s_lines) and len(changed) == 2, f"git diff: изменились только две строки pivot ({len(changed)} из {len(o_lines)})")
        check(not rs(a)["dirty"], "после сохранения нет несохранённых правок")

        # --- Hot reload: правка файла снаружи подхватывается живым узлом рантайма ---------------------------------
        a.eval(f"{RS}.click('rs-tab-view')")
        a.step(8)
        st = rs(a)
        check(st["node"] and st["runtime"]["hotReload"], "после сохранения узел снова читает файл (hot reload включён)")
        before = st["runtime"]["reloads"]
        edited = json.loads(saved)
        edited["rig"]["bones"][1]["pivot"] = [-12, -4, 0]
        with open(MODEL, "w", encoding="utf-8") as f:
            f.write(json.dumps(edited, indent=2) + "\n")
        for _ in range(60):
            a.step(6)
            if rs(a)["runtime"]["reloads"] > before:
                break
        check(rs(a)["runtime"]["reloads"] > before, "hot reload: рантайм сам перечитал изменённый character.json")
        check(rs(a)["runtime"]["reloadError"] is None, "перечитывание прошло без ошибок")
        a.eval(f"{RS}.click('rs-back')")
        check(not rs(a)["active"], "кнопка «К SDK» закрывает студию")

        # --- Невалидные ассеты: диагностика, а не тишина ---------------------------------------------------------------
        bad_dir = os.path.join(PROJ, "bad")
        os.makedirs(bad_dir, exist_ok=True)
        for f in ("animal.animations.json", "animal.png"):
            shutil.copy(os.path.join(SRC, f), bad_dir)
        broken = json.loads(original)
        broken["rig"]["parts"][1]["bone"] = "призрак"
        broken["atlas"] = "нет_такого.png"
        bad_model = os.path.join(bad_dir, "broken.character.json")
        open(bad_model, "w", encoding="utf-8").write(json.dumps(broken, indent=2) + "\n")
        open_in_studio(a, bad_model)
        st = rs(a)
        check(st["active"] and not st["node"] and st["nodeError"], "невалидная модель: рантайм отказал, студия не упала")
        check("SDK_RE2D_PART_BONE" in st["codes"] and "SDK_RE2D_ATLAS_MISSING" in st["codes"], f"диагностика C: часть без кости и нет PNG ({st['codes']})")
        check("SDK_RE2D_RUNTIME" in st["codes"], "ошибка рантайма показана диагностикой SDK_RE2D_RUNTIME")
        a.eval(f"{RS}.click('rs-back')")

        # Реальный большой ассет (маскот Руси, PNG 4096): SDK его не меняет.
        russi = os.path.join(ROOT, "demos", "rotsprite", "russi.character.json")
        before_bytes = open(russi, "rb").read()
        open_in_studio(a, russi)
        a.step(10)
        st = rs(a)
        check(st["active"] and st["node"] and st["nodeError"] is None, "реальный ассет демо открывается в студии (PNG v2 4096²)")
        check(st["runtime"]["version"] == 2 and "walk" in st["clips"], "рантайм загрузил модель демо, клипы прочитаны")
        check(not [c for c in st["codes"] if c.startswith("SDK_RE2D_PNG") or c.endswith("_ROOT")], "диагностики маскота — только факты о поверхности")
        a.eval(f"{RS}.click('rs-back')")
        check(open(russi, "rb").read() == before_bytes, "SDK не меняет файл, который только открыли")

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
