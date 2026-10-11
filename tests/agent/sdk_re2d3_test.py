#!/usr/bin/env python3
# ===========================================================================
# Re2DSprite v3 в SDK (docs/SDK.md §6, docs/RE2DSPRITE_V3.md):
#   * нативный бэкенд читает контейнер v3 — `re2d-info`, `re2d-debug`,
#     `re2d-sample` и `validate` (раньше v3 отвергался как «не PNG v2»);
#   * `re2d3-paint` правит сетку текселей (кость, блеск, цвет) и пишет
#     контейнер, который рантайм затем читает как v3;
#   * редактор «Сетка» в Re2DSprite Studio: факты контейнера, правка кистью,
#     undo/redo, сохранение только по кнопке, отказ на картах v2.
#
# Запуск (после сборки): python3 tests/agent/sdk_re2d3_test.py
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
SDK = os.path.join(ROOT, "build", "r2d-sdk")
V3_MODEL = os.path.join(ROOT, "demos", "rotsprite", "russi3.character.json")
V3_PNG = os.path.join(ROOT, "demos", "rotsprite", "russi3.png")
V2_MODEL = os.path.join(ROOT, "demos", "rotsprite", "russi.character.json")
V2_PNG = os.path.join(ROOT, "demos", "assets", "art", "mascot", "russi_model_maid.png")
PROJ = os.path.join(ROOT, "build", "sdk_re2d3_proj")
MODEL = os.path.join(PROJ, "russi3.character.json")
PNG = os.path.join(PROJ, "russi3.png")
RS = "$.ui.doc('sdk/ui/re2d_studio.rml')"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def sdk(*args):
    r = subprocess.run([SDK] + list(args), capture_output=True, text=True, cwd=ROOT)
    try:
        data = json.loads(r.stdout)
    except Exception:
        data = None
    return r.returncode, data, r.stdout + r.stderr


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def codes(data):
    return [d.get("code") for d in (data or {}).get("diagnostics", [])]


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


def open_in_studio(a, model):
    a.eval(f"$.sdkApp.openProject({json.dumps(os.path.dirname(model))}); 1")
    wait_idle(a)
    a.eval(f"$.sdkApp.selectAsset({json.dumps(os.path.basename(model))}); 1")
    a.eval("$.sdkApp.openAsset().then(() => 1)")
    wait_idle(a)
    a.step(6)


def cli_checks():
    # --- Нативное чтение контейнера v3 -------------------------------------------------
    rc, info, raw = sdk("re2d-info", V3_MODEL)
    check(rc == 0 and info and info["format"] == "v3", f"re2d-info распознаёт контейнер v3 (rc={rc})")
    check(info and info["png"]["grid"] == [2048, 1536] and info["png"]["extent"] == 128,
          f"сетка и extent из заголовка: {info['png']['grid'] if info else None}")
    check(info and info["samples"]["live"] > 100000 and 0 < info["samples"]["coverage"] <= 1,
          f"живых текселей {info['samples']['live'] if info else 0}")
    bones = (info or {}).get("bones", [])
    check(bool(bones) and any(b["asBone"] for b in bones), "идентификаторы разобраны как индексы костей")
    check(any(b["asPart"] for b in bones), "и идентификаторы частей v2 тоже показаны (факт обеих трактовок)")
    check(not codes(info), f"проверка v3 без диагностики: {codes(info)}")

    # Нулевые веса (штатный случай convert-re2d3: у части без костей весов нет) —
    # факт-информация, а не отказ: рантайм подставляет кость 1.
    zero_weights = (info or {}).get("materials", {}).get("weights", {}).get("zero", 0)
    if zero_weights:
        check(info["ok"] and "SDK_RE2D3_WEIGHT_ZERO" in codes(info),
              f"нулевые веса ({zero_weights}) сообщаются как факт и не ломают проверку")
    else:
        check(True, "нулевых весов в контейнере нет")

    rc, v2, _ = sdk("re2d-info", V2_MODEL)
    check(rc == 0 and v2 and v2["format"] == "v2" and v2["samples"]["active"] > 0, "карты v2 читаются по-прежнему")

    rc, val, _ = sdk("validate", V3_MODEL)
    check(rc == 0 and val and val["ok"], "validate принимает character.json с контейнером v3")
    check(not [c for c in codes(val) if c and c.startswith("SDK_RE2D_PNG")],
          f"v3 больше не отвергается как «не PNG v2»: {codes(val)}")

    # --- Отладочные виды ---------------------------------------------------------------
    out = os.path.join(PROJ, "owner.png")
    rc, dbg, _ = sdk("re2d-debug", V3_PNG, "--mode", "owner", "--out", out, "--scale", "1")
    check(rc == 0 and dbg and dbg["format"] == "v3" and dbg["mapW"] == 2048 and dbg["mapH"] == 1536,
          "re2d-debug строит вид v3 по сетке")
    check(png_size(out) == (2048, 1536), f"размер вида = сетка × масштаб ({png_size(out)})")

    rc, bad, _ = sdk("re2d-debug", V3_PNG, "--mode", "part", "--out", out)
    check(rc == 1 and "SDK_RE2D3_MODE" in codes(bad), f"режим карт v2 для контейнера v3 отвергнут: {codes(bad)}")
    rc, bad, _ = sdk("re2d-debug", V2_PNG, "--mode", "gloss", "--out", out)
    check(rc == 1 and "SDK_RE2D_MODE" in codes(bad), f"режим v3 для карт v2 отвергнут: {codes(bad)}")

    # --- Отсчёт под курсором ----------------------------------------------------------
    rc, s1, _ = sdk("re2d-sample", V3_MODEL, "--x", "900", "--y", "700")
    s = (s1 or {}).get("sample") or {}
    check(rc == 0 and s.get("live") and len(s.get("position", [])) == 3 and s.get("weightsSum") == 255,
          f"re2d-sample отдаёт материал текселя: {s.get('bones')}")
    rc, bad, _ = sdk("re2d-sample", V3_MODEL, "--x", "99999", "--y", "0")
    check(rc == 1 and "SDK_RE2D_SAMPLE_RANGE" in codes(bad), "тексель вне сетки — ошибка диапазона")

    # --- Правка сетки -------------------------------------------------------------------
    edits = os.path.join(PROJ, "ops.json")
    with open(edits, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "ops": [
            {"op": "bone", "rects": [[900, 700, 8, 8], [900, 720, 4, 4]], "bones": [[2, 255]]},
            {"op": "gloss", "rects": [[900, 700, 8, 8]], "value": 200},
            {"op": "color", "rects": [[900, 700, 2, 2]], "rgb": [255, 0, 0]},
        ]}, f, indent=2)

    before = open(PNG, "rb").read()
    rc, paint, _ = sdk("re2d3-paint", PNG, "--edits", edits, "--out", PNG)
    check(rc == 0 and paint and paint["ok"] and paint["painted"] > 100,
          f"re2d3-paint применил операции к {paint['painted'] if paint else '?'} текселям")
    check(open(PNG, "rb").read() != before, "контейнер на диске изменился")
    rc, s2, _ = sdk("re2d-sample", PNG, "--x", "901", "--y", "701", "--model", MODEL)
    s = (s2 or {}).get("sample") or {}
    check(s.get("gloss") == 200 and s.get("color", [None])[0] == 255 and s.get("bones", [{}])[0].get("id") == 2,
          f"правка видна в отсчёте: gloss={s.get('gloss')} color={s.get('color')} bones={s.get('bones')}")

    # Сломанный файл правок: ошибка и НИЧЕГО не записано.
    keep = open(PNG, "rb").read()
    with open(edits, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "ops": [{"op": "bone", "rects": [[0, 0, 4, 4]], "bones": [[0, 255]]}]}, f)
    rc, bad, _ = sdk("re2d3-paint", PNG, "--edits", edits, "--out", PNG)
    check(rc == 1 and "SDK_RE2D3_BONE" in codes(bad), f"id кости 0 отвергнут: {codes(bad)}")
    check(open(PNG, "rb").read() == keep, "на ошибке контейнер не перезаписан")

    # Версия файла правок и неизвестная операция проверяются до записи.
    with open(edits, "w", encoding="utf-8") as f:
        json.dump({"version": 2, "ops": [{"op": "gloss", "rects": [[0, 0, 4, 4]], "value": 10}]}, f)
    rc, bad, _ = sdk("re2d3-paint", PNG, "--edits", edits, "--out", PNG)
    check(rc == 1 and "SDK_RE2D3_EDITS" in codes(bad), f"version файла правок проверяется: {codes(bad)}")
    with open(edits, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "ops": [{"op": "position", "rects": [[0, 0, 4, 4]]}]}, f)
    rc, bad, _ = sdk("re2d3-paint", PNG, "--edits", edits, "--out", PNG)
    check(rc == 1 and "SDK_RE2D3_OP" in codes(bad), f"неизвестная операция отвергнута: {codes(bad)}")
    with open(edits, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "ops": [{"op": "gloss", "rects": [[1e18, 0, 4, 4]], "value": 10}]}, f)
    rc, bad, _ = sdk("re2d3-paint", PNG, "--edits", edits, "--out", PNG)
    check(rc == 1 and "SDK_RE2D3_RECT" in codes(bad), f"нечисловые/огромные координаты отвергнуты: {codes(bad)}")
    with open(edits, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "ops": [{"op": "gloss", "rects": [[0.5, 0, 4, 4]], "value": 10}]}, f)
    rc, bad, _ = sdk("re2d3-paint", PNG, "--edits", edits, "--out", PNG)
    check(rc == 1 and "SDK_RE2D3_RECT" in codes(bad), f"дробная координата отвергнута, а не усечена: {codes(bad)}")
    with open(edits, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "ops": [{"op": "bone", "rects": [[0, 0, 4, 4]], "bones": [[2, 0]]}]}, f)
    rc, bad, _ = sdk("re2d3-paint", PNG, "--edits", edits, "--out", PNG)
    check(rc == 1 and "SDK_RE2D3_BONE" in codes(bad), f"нулевая сумма весов отвергнута: {codes(bad)}")
    with open(edits, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "ops": [{"op": "gloss", "rects": [[0, 0, 4, 4]], "value": True}]}, f)
    rc, bad, _ = sdk("re2d3-paint", PNG, "--edits", edits, "--out", PNG)
    check(rc == 1 and "SDK_RE2D3_OP" in codes(bad), f"bool вместо числа отвергнут: {codes(bad)}")
    check(open(PNG, "rb").read() == keep, "после ошибок контейнер всё ещё не перезаписан")

    # Правка карт v2 контейнером v3 — честный отказ.
    with open(edits, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "ops": [{"op": "gloss", "rects": [[0, 0, 4, 4]], "value": 10}]}, f)
    rc, bad, _ = sdk("re2d3-paint", V2_PNG, "--edits", edits, "--out", os.path.join(PROJ, "v2_out.png"))
    check(rc == 1 and codes(bad), f"карты v2 не правятся как сетка v3: {codes(bad)}")
    check(not os.path.exists(os.path.join(PROJ, "v2_out.png")), "неудачная правка не создаёт файл")


def engine_checks():
    # Рантайм читает то, что записал re2d3-paint: контейнер остаётся контейнером v3.
    with Agent(game="sdk", seed=11) as a:
        wait_idle(a)
        a.eval(f"globalThis.v3node = $.re2dSprite.from({json.dumps(MODEL)}).at(200, 200).size(120, 120).appendTo($.world); 1")
        a.step(6)
        info = json.loads(a.eval("JSON.stringify($.re2dSprite.info(globalThis.v3node))"))
        check(info and info["version"] == 3 and info["surfaceSamples"] > 100000,
              f"рантайм принял правленый контейнер: v{info['version'] if info else '?'}, текселей {info['surfaceSamples'] if info else 0}")

        # --- Редактор «Сетка» в студии ---------------------------------------------------
        open_in_studio(a, MODEL)
        st = rs(a)
        check(st["container"] and st["container"]["format"] == "v3" and st["container"]["grid"] == [2048, 1536],
              f"студия знает версию и сетку контейнера: {st['container']}")
        a.eval(f"{RS}.click('rs-tab-grid')")
        a.step(8)
        st = rs(a)
        check(st["tab"] == "grid" and st["grid"]["ops"] == 0, "вкладка «Сетка» открывается на контейнере v3")

        # Кисть: тот же путь, что у мыши (gridPaint — программный вход той же операции).
        # Вид сетки перестраивается асинхронно (черновик → нативный вид), поэтому ждём факта.
        r = json.loads(a.eval("JSON.stringify($.sdkApp.studios.re2d.gridPaint([[900,700,16,16]], 'bone', 2))"))
        for _ in range(80):
            wait_idle(a)
            a.step(4)
            if rs(a)["grid"]["ops"] == 1 and rs(a)["grid"]["painted"] > 0:
                break
        st = rs(a)
        check(r.get("ok") and st["grid"]["ops"] == 1 and st["grid"]["painted"] > 0,
              f"правка сетки применена к черновику: {r} painted={st['grid']['painted']}")
        check(st["grid"]["dirty"] and st["grid"]["canUndo"], "правка отмечена как несохранённая, undo доступен")

        # До сохранения исходник не меняется.
        on_disk = open(PNG, "rb").read()
        r = json.loads(a.eval("JSON.stringify($.sdkApp.studios.re2d.gridPaint([[900,720,8,8]], 'gloss', 210))"))
        wait_idle(a)
        a.step(6)
        check(rs(a)["grid"]["ops"] == 2, "вторая правка добавилась в список")
        check(open(PNG, "rb").read() == on_disk, "черновик не трогает контейнер до «Сохранить»")

        # Recovery: несохранённые правки лежат рядом с ассетом отдельным файлом.
        rec = os.path.join(PROJ, ".r2d-recovery-russi3.character.json.grid.json")
        a.eval("$.sdkApp.recovery.flush(); 1")
        a.step(2)
        check(os.path.exists(rec), f"несохранённые правки сетки уходят в recovery ({os.path.basename(rec)})")
        if os.path.exists(rec):
            payload = json.load(open(rec, encoding="utf-8"))
            check(payload.get("asset") == MODEL + ".grid" and len(payload.get("doc", {}).get("ops", [])) == 2,
                  "recovery хранит список операций, а не картинку")

        # Undo/redo правок сетки.
        a.eval("$.sdkApp.studios.re2d.gridUndo(); 1")
        wait_idle(a)
        check(rs(a)["grid"]["ops"] == 1 and rs(a)["grid"]["canRedo"], "undo снял последнюю правку")
        a.eval("$.sdkApp.studios.re2d.gridRedo(); 1")
        wait_idle(a)
        check(rs(a)["grid"]["ops"] == 2, "redo вернул правку")

        # Кисть мышью: тот же мазок, что делает автор (pointer → мазок → операция).
        rect = json.loads(a.eval(f"JSON.stringify({RS}.rect('rs-viewport'))"))
        cx, cy = int(rect["x"] + rect["w"] * 0.5), int(rect["y"] + rect["h"] * 0.5)
        ops_before = rs(a)["grid"]["ops"]
        a.mouse_move(x=cx, y=cy)
        a.step(3)
        a.mouse(button=1, action="down")
        a.step(2)
        a.mouse_move(x=cx + 14, y=cy + 8)
        a.step(3)
        a.mouse(button=1, action="up")
        a.step(6)
        wait_idle(a)
        check(rs(a)["grid"]["ops"] == ops_before + 1, "мазок мышью добавляет ровно одну правку сетки")
        check(rs(a)["grid"]["painted"] > 0, "мазок покрасил живые тексели")

        # Сохранение: контейнер меняется, рантайм читает уже новый файл.
        # eval возвращает Promise как есть, поэтому результат кладём в globalThis.
        a.eval("globalThis.gridSave = null; $.sdkApp.studios.re2d.gridSave().then(x => { globalThis.gridSave = x; }); 1")
        r = {}
        for _ in range(80):
            wait_idle(a)
            a.step(4)
            raw = a.eval("globalThis.gridSave ? JSON.stringify(globalThis.gridSave) : ''")
            if raw:
                r = json.loads(raw)
                break
        wait_idle(a)
        check(r.get("ok") and r.get("saved"), f"«Сохранить PNG» записало контейнер: {r}")
        check(open(PNG, "rb").read() != on_disk, "после сохранения контейнер на диске изменился")
        st = rs(a)["grid"]
        check(not st["dirty"] and st["ops"] == 0 and not st["canUndo"] and not st["canRedo"],
              f"после сохранения ассет — новая база, список правок пуст: {st}")
        check(not os.path.exists(rec), "после сохранения recovery-файл снят")

        # Рантайм снова читает контейнер: тот же ассет, уже с правками.
        a.eval(f"{RS}.click('rs-tab-view')")
        a.step(10)
        rt = rs(a)["runtime"]
        check(rt and rt["version"] == 3, f"после сохранения узел рантайма читает контейнер v3: {rt}")
        a.eval(f"{RS}.click('rs-tab-surface')")
        a.step(6)
        check(rs(a)["tab"] == "surface", "вкладка «Поверхность» открывается на v3")
        r = json.loads(a.eval("JSON.stringify($.sdkApp.studios.re2d.setGridMode('normal'))"))
        check(r == "normal", "режим «Нормаль» доступен контейнеру v3")

        # Отсчёт под курсором на «Поверхности» тоже работает: панель «Сетка» там скрыта.
        rect = json.loads(a.eval(f"JSON.stringify({RS}.rect('rs-viewport'))"))
        a.mouse_move(x=int(rect["x"] + rect["w"] * 0.5), y=int(rect["y"] + rect["h"] * 0.5))
        sample = None
        for _ in range(60):
            a.step(4)
            wait_idle(a)
            sample = rs(a)["sample"]
            if sample:
                break
        check(bool(sample) and sample.get("live") is not None,
              f"вкладка «Поверхность» показывает тексель v3 под курсором: {sample}")

        # Карты v2: редактор сетки отказывает честно, вкладка не переключается.
        a.eval(f"{RS}.click('rs-back')")
        a.step(4)
        open_in_studio(a, os.path.join(PROJ, "v2.character.json"))
        a.eval(f"{RS}.click('rs-tab-grid')")
        a.step(6)
        st = rs(a)
        check(st["tab"] != "grid", "на картах v2 вкладка «Сетка» не открывается")
        check("SDK_RE2D3_ONLY" in st["codes"], f"отказ объяснён диагностикой: {st['codes']}")
        check(st["container"] and st["container"]["format"] == "v2", "студия видит, что это карты v2")
        a.eval(f"{RS}.click('rs-back')")


def main():
    shutil.rmtree(PROJ, ignore_errors=True)
    os.makedirs(PROJ, exist_ok=True)
    # Работаем на копиях: тест не имеет права менять ассеты демо.
    shutil.copy(V3_PNG, PNG)
    shutil.copy(V3_MODEL, MODEL)
    src_dir = os.path.dirname(V3_MODEL)
    for name in os.listdir(src_dir):
        if name.endswith(".animations.json") and not os.path.exists(os.path.join(PROJ, name)):
            shutil.copy(os.path.join(src_dir, name), os.path.join(PROJ, name))
    # Карты v2: атлас лежит в demos/assets, путь оставляем абсолютным.
    v2 = json.load(open(V2_MODEL, encoding="utf-8"))
    v2["atlas"] = os.path.join(ROOT, "demos", "assets", "art", "mascot", "russi_model_maid.png")
    with open(os.path.join(PROJ, "v2.character.json"), "w", encoding="utf-8") as f:
        json.dump(v2, f, indent=2)
        f.write("\n")

    cli_checks()
    engine_checks()

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
