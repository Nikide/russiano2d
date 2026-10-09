#!/usr/bin/env python3
# ===========================================================================
# Phase 6 — Re2D World Studio: компилятор карты `*.re2dmap` (docs/SDK.md §11).
#
#   исходник (cells, height spans, walls, portals, stairs, slopes)
#       → проверка (правила рантайма + диагностика) → описание для $.re2d.world
#
# Обязательный приёмочный тест спецификации (§66): два проходимых span на одном XY на
# разных высотах — room-over-room — проверяется настоящим рантаймом (support/ray/blocked).
#
# Запуск (после сборки): python3 tests/agent/sdk_world_test.py
# ===========================================================================

import copy
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
SDK_BIN = os.path.join(ROOT, "build", "r2d-sdk")
FIX = os.path.join(ROOT, "tests", "fixtures", "sdk", "world")
OUT = os.path.join(ROOT, "build", "sdk_world_out")
RUNTIME_GAME = os.path.join(ROOT, "tests", "fixtures", "sdk", "re2d_proj")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def sdk(*args):
    p = subprocess.run([SDK_BIN, *args], cwd=ROOT, capture_output=True, text=True, timeout=120)
    lines = [l for l in p.stdout.splitlines() if l.strip()]
    return p.returncode, (json.loads(lines[-1]) if lines else {})


def codes(d):
    return [x["code"] for x in d.get("diagnostics", [])]


def fx(name):
    return os.path.join(FIX, name)


def cli_cases():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)

    rc, d = sdk("world-info", fx("stack.re2dmap"))
    check(rc == 0 and d["ok"] and d["stats"]["spans"] == 2 and d["stats"]["stacks"] == 1, "room-over-room: два spans на одном XY найдены компилятором")
    st = d["stacks"][0]
    check(st["xy"] == [0, 0, 200, 200] and st["lower"]["top"] <= st["upper"]["bottom"], "stack: общий XY и разные высоты (нижний ниже верхнего)")

    rc, demo = sdk("world-compile", fx("demo.re2dmap"), "--output", os.path.join(OUT, "demo.json"))
    s = demo["stats"]
    check(rc == 0 and demo["ok"], "карта демо компилируется")
    check(s["stairSteps"] == 8 and s["compiledCells"] == 3 + 8, "лестница раскрыта в 8 ступеней-cells")
    check(s["stacks"] == 3, "room-over-room в демо: холл и две комнаты (3 этажных пары)")
    check(s["compiledWalls"] == 14 + 8 and s["spans"] == 6 + 8, "стены: 14 явных + 8 подступёнков; spans: 6 + 8")
    check(codes(demo).count("SDK_WORLD_OPEN_EDGE") == 2, "диагностика находит открытые кромки на нижнем этаже (roomN/roomS у лестницы)")
    desc = json.load(open(os.path.join(OUT, "demo.json")))
    check(set(desc) == {"walls", "cells"} and len(desc["walls"]) == 22 and len(desc["cells"]) == 11, "файл описания: walls + cells как у $.re2d.world")
    check(desc["cells"][3]["spans"] == [{"bottom": 20, "top": 288, "floorColor": "#736348", "ceilingColor": "#344858"}],
          "первая ступень: пол 20, потолок 288 (как у демо)")
    risers = [w for w in desc["walls"] if w["from"][0] == w["to"][0] and 160 <= w["from"][0] < 360 and w["top"] - w["bottom"] == 20]
    check(len(risers) == 8, "подступёнки по 20 ед. на входных кромках ступеней")
    rc2, again = sdk("world-compile", fx("demo.re2dmap"), "--output", os.path.join(OUT, "demo2.json"))
    check(open(os.path.join(OUT, "demo.json")).read() == open(os.path.join(OUT, "demo2.json")).read(), "детерминизм: повторная компиляция даёт те же байты")

    # Портал, PVS, диагностика.
    rc, two = sdk("world-info", fx("two.re2dmap"))
    check(rc == 0 and two["portals"][0]["id"] == "door" and "SDK_WORLD_PORTALS_NOT_IN_RUNTIME" in codes(two), "портал: данные в отчёте и честная пометка «рантайм не использует»")
    check(two["pvs"]["runtimeUsed"] is False and two["pvs"]["conservative"] and two["pvs"]["cells"]["left"] == ["right"], "PVS — консервативная достижимость через порталы, runtimeUsed=false")
    check("SDK_WORLD_OPEN_EDGE" not in codes(two), "портал закрывает проход в общей стене: утечек нет")

    rc, sl = sdk("world-info", fx("slope.re2dmap"))
    check(rc == 0 and sl["stats"]["slopeSegments"] == 5 and "SDK_WORLD_SLOPE_STEPPED" in codes(sl), "slope аппроксимирован ступенями с диагностикой")

    for name, code, expect_rc in (
        ("bad_overlap", "SDK_WORLD_SPAN_OVERLAP", 1), ("bad_leak", "SDK_WORLD_OPEN_EDGE", 0), ("bad_portal_edge", "SDK_WORLD_PORTAL_EDGE", 1),
        ("bad_portal_cell", "SDK_WORLD_PORTAL_CELL", 1), ("bad_portal_opening", "SDK_WORLD_PORTAL_OPENING", 0),
        ("bad_span_height", "SDK_WORLD_SPAN_HEIGHT", 1), ("bad_dup_id", "SDK_WORLD_ID_DUPLICATE", 1),
        ("bad_wall_degenerate", "SDK_WORLD_WALL_DEGENERATE", 1), ("bad_color", "SDK_WORLD_FIELD", 1), ("bad_range", "SDK_WORLD_RANGE", 1),
    ):
        rc, d = sdk("world-compile", fx(name + ".re2dmap"), "--output", os.path.join(OUT, name + ".json"))
        loc = next((x["location"] for x in d["diagnostics"] if x["code"] == code), None)
        check(code in codes(d) and rc == expect_rc and bool(loc), f"{name}: {code} (rc={rc}), указано место")
        if expect_rc == 1:
            check(not os.path.exists(os.path.join(OUT, name + ".json")), f"{name}: при ошибке описание не пишется")

    # Тип ассета и общий validate.
    rc, v = sdk("validate", fx("stack.re2dmap"))
    check(rc == 0 and v["type"] == "re2d.world" and v["ok"], "validate: тип re2d.world проверяется общим реестром")
    rc, v = sdk("validate", fx("bad_overlap.re2dmap"))
    check(rc == 1 and "SDK_WORLD_SPAN_OVERLAP" in codes(v), "validate: ошибка карты видна общему валидатору")
    bad = os.path.join(OUT, "notjson.re2dmap")
    open(bad, "w").write("{oops")
    rc, v = sdk("validate", bad)
    check(rc == 1 and "SDK_JSON_PARSE" in codes(v), "битый JSON: SDK_JSON_PARSE")
    ver = os.path.join(OUT, "ver.re2dmap")
    open(ver, "w").write('{"version":9}')
    rc, v = sdk("validate", ver)
    check(rc == 1 and "SDK_WORLD_VERSION" in codes(v), "неизвестная version: SDK_WORLD_VERSION")

    # Audit regressions: malformed collections, generated geometry, diagnostics, I/O.
    base = json.load(open(fx("stack.re2dmap")))
    for key in ("cells", "walls", "portals", "stairs", "slopes"):
        m = copy.deepcopy(base); m[key] = {"invalid": []}
        path = os.path.join(OUT, "malformed.re2dmap"); json.dump(m, open(path, "w"))
        rc, d = sdk("world-info", path)
        check(rc == 1 and not d["ok"] and "SDK_WORLD_FIELD" in codes(d), f"{key}: объект вместо массива отвергается")
    m = copy.deepcopy(base); m["cells"][0]["id"] = 'room"\\name'; m["cells"][0]["spans"][0]["top"] = -1
    path = os.path.join(OUT, "quoted.re2dmap"); json.dump(m, open(path, "w"))
    rc, d = sdk("world-info", path)
    check(rc == 1 and d["diagnostics"][0]["location"]["id"] == m["cells"][0]["id"], "кавычки и обратный слеш в id сохраняют валидный JSON диагностики")
    for key, value, code in (("top", 10, "SDK_WORLD_SPAN_HEIGHT"), ("steps", 2.5, "SDK_WORLD_FIELD"), ("dir", 0, "SDK_WORLD_FIELD")):
        m = {"version": 1, "stairs": [{"id": "s", "rect": [0, 0, 100, 100], "steps": 2, "base": 0, "rise": 20, "top": 100}]}
        m["stairs"][0][key] = value
        path = os.path.join(OUT, "stairs_bad.re2dmap"); json.dump(m, open(path, "w"))
        rc, d = sdk("world-info", path)
        check(rc == 1 and not d["ok"] and code in codes(d), f"ступени: неверный {key} не попадает в runtime")
    rc, d = sdk("world-compile", fx("stack.re2dmap"), "--output", OUT)
    check(rc == 1 and not d["ok"] and "SDK_WRITE_FAILED" in codes(d), "ошибка записи возвращает ok=false и ненулевой код")


    # A closed edge assembled from more than 510 pieces must not lose coverage.
    m={"version":1,"cells":[{"id":"many","rect":[0,0,600,600],"spans":[{"bottom":0,"top":100}]}],"walls":[]}
    for i in range(600):m["walls"].append({"id":"n"+str(i),"from":[i,0],"to":[i+1,0],"bottom":0,"top":100})
    for id_,a,b in [("s",[0,600],[600,600]),("w",[0,0],[0,600]),("e",[600,0],[600,600])]:m["walls"].append({"id":id_,"from":a,"to":b,"bottom":0,"top":100})
    path=os.path.join(OUT,"many.re2dmap");json.dump(m,open(path,"w"))
    rc,d=sdk("world-info",path)
    check(rc==0 and "SDK_WORLD_OPEN_EDGE" not in codes(d),"кромка из 600 стен проверяется целиком, без ложной утечки")


def description_of(src):
    """То, что получил бы $.re2d.world без компилятора: только явные cells и walls."""
    return {"walls": [{k: w[k] for k in ("from", "to", "bottom", "top", "color") if k in w} for w in src.get("walls", [])],
            "cells": [{"x": c["rect"][0], "y": c["rect"][1], "w": c["rect"][2], "h": c["rect"][3], "spans": c["spans"]} for c in src.get("cells", [])]}


def runtime_cases():
    with Agent(game=RUNTIME_GAME, seed=6) as a:
        a.step(3)
        rc, comp = sdk("world-compile", fx("stack.re2dmap"), "--output", os.path.join(OUT, "stack.json"))
        desc = comp["world"]
        res = json.loads(a.eval("(()=>{const w=$.re2d.world(%s);globalThis.W=w;"
                                "const s=(x,y,f,h,st)=>{const r=w.support(x,y,f,h,st);return r&&{span:r.span,height:r.height,ceiling:r.ceiling};};"
                                "return JSON.stringify({info:w.info(),"
                                "ground:s(100,100,0,50,0),upper:s(100,100,160,50,0),gap:s(100,100,140,50,0),gapStep:s(100,100,140,50,30),"
                                "tooTall:s(100,100,0,200,0),outside:s(500,500,0,50,0),"
                                "up:w.ray({x:100,y:100,height:10},{x:100,y:100,height:250}),fromGap:w.ray({x:100,y:100,height:140},{x:100,y:100,height:250}),"
                                "wallLow:w.blocked(3,100,5,10,60),wallUp:w.blocked(3,100,5,170,200)});})()" % json.dumps(desc)))
        check(res["info"]["spans"] == 2 and res["info"]["walls"] == 4, "рантайм принял скомпилированную карту: 2 spans, 4 стены")
        check(res["ground"] and res["ground"]["height"] == 0 and res["ground"]["ceiling"] == 128, "room-over-room: на одном XY нижний этаж — пол 0, потолок 128")
        check(res["upper"] and res["upper"]["height"] == 160 and res["upper"]["ceiling"] == 288, "room-over-room: на том же XY верхний этаж — пол 160, потолок 288")
        check(res["ground"]["span"] != res["upper"]["span"], "это два разных span (не один и тот же этаж)")
        check(res["gap"] is None and res["gapStep"] and res["gapStep"]["height"] == 160, "между этажами опоры нет; со step 30 достаётся верхний пол")
        check(res["tooTall"] is None, "персонаж выше этажа не помещается (headroom)")
        check(res["outside"] is None, "за пределами cells опоры нет")
        check(res["up"] and res["up"]["ceiling"] is True and res["up"]["height"] == 128, "луч снизу вверх упирается в потолок нижнего этажа (128), а не в верхний")
        check(res["fromGap"] and res["fromGap"]["ceiling"] is False and res["fromGap"]["height"] == 160, "луч из зазора попадает в пол верхнего этажа (160)")
        check(res["wallLow"] is True and res["wallUp"] is True, "стены блокируют на обоих этажах (стены высотой 0..288)")

        # Отдельные карты: нижний/верхний этаж с разной высотой стены.
        res = json.loads(a.eval("(()=>{const w=$.re2d.world({walls:[{from:[0,-50],to:[0,50],bottom:0,top:100,color:'#fff'}],"
                                "cells:[{x:-100,y:-100,w:200,h:200,spans:[{bottom:0,top:120},{bottom:200,top:300}]}]});"
                                "return JSON.stringify({low:w.blocked(0,0,5,10,60),high:w.blocked(0,0,5,200,260)});})()"))
        check(res["low"] is True and res["high"] is False, "высотная стена блокирует нижний этаж и не мешает верхнему на том же XY")

        # Лестница из компилятора ведёт наверх: на каждой ступени своя опора.
        rc, demo = sdk("world-compile", fx("demo.re2dmap"), "--output", os.path.join(OUT, "demo.json"))
        got = json.loads(a.eval("(()=>{const w=$.re2d.world(%s);const out=[];"
                                "for(let i=0;i<8;i++){const x=160+i*25+12;const r=w.support(x,0,i*20,50,20);out.push(r&&r.height);}"
                                "return JSON.stringify({heights:out,info:w.info(),hall:[w.support(-100,0,0,50,0).height,w.support(-100,0,160,50,0).height]});})()" % json.dumps(demo["world"])))
        check(got["heights"] == [20, 40, 60, 80, 100, 120, 140, 160], f"лестница из компилятора: опоры 20…160 по ступеням ({got['heights']})")
        check(got["hall"] == [0, 160], "холл демо: два этажа на одном XY")
        check(got["info"]["spans"] == 14 and got["info"]["walls"] == 22, "демо в рантайме: 14 spans, 22 стены")

        # Паритет: решение C-валидатора == решение рантайма на корпусе мутаций.
        base = json.load(open(fx("stack.re2dmap")))
        cases = []

        def add(label, fn):
            m = copy.deepcopy(base)
            fn(m)
            cases.append((label, m))
        add("исходная", lambda m: None)
        add("span top==bottom", lambda m: m["cells"][0]["spans"][0].update(top=0))
        add("span top<bottom", lambda m: m["cells"][0]["spans"][1].update(top=100))
        add("перекрытие 1", lambda m: m["cells"][0]["spans"][1].update(bottom=100))
        add("касание (top==bottom)", lambda m: m["cells"][0]["spans"][1].update(bottom=128))
        add("перекрытие впритык", lambda m: m["cells"][0]["spans"][1].update(bottom=127.5))
        add("w=0", lambda m: m["cells"][0]["rect"].__setitem__(2, 0))
        add("h<0", lambda m: m["cells"][0]["rect"].__setitem__(3, -1))
        add("стена нулевая", lambda m: m["walls"][0].update(to=m["walls"][0]["from"]))
        add("стена top==bottom", lambda m: m["walls"][0].update(top=0))
        add("стена top<bottom", lambda m: m["walls"][1].update(top=-5))
        add("второй cell на том же XY, те же высоты", lambda m: m["cells"].append({"id": "c2", "rect": [0, 0, 200, 200], "spans": [{"bottom": 0, "top": 128}]}))
        add("второй cell на другом этаже", lambda m: m["cells"].append({"id": "c2", "rect": [50, 50, 100, 100], "spans": [{"bottom": 300, "top": 400}]}))
        add("второй cell рядом", lambda m: m["cells"].append({"id": "c2", "rect": [200, 0, 100, 100], "spans": [{"bottom": 0, "top": 128}]}))
        add("второй cell внахлёст по X", lambda m: m["cells"].append({"id": "c2", "rect": [199, 0, 100, 100], "spans": [{"bottom": 0, "top": 128}]}))
        add("второй cell, отрицательные высоты", lambda m: m["cells"].append({"id": "c2", "rect": [10, 10, 5, 5], "spans": [{"bottom": -100, "top": -1}]}))
        add("вне ±1e6", lambda m: m["cells"][0]["rect"].__setitem__(0, 2e6))
        add("стена вне ±1e6", lambda m: m["walls"][0]["from"].__setitem__(0, -2e6))
        add("высота вне ±1e6", lambda m: m["walls"][0].update(top=3e6))
        for label, m in cases:
            path = os.path.join(OUT, "parity.re2dmap")
            json.dump(m, open(path, "w"))
            rc, d = sdk("world-info", path)
            runtime_ok = a.eval("(()=>{try{const w=$.re2d.world(%s);w.dispose();return true;}catch(e){return false;}})()" % json.dumps(description_of(m)))
            check(bool(d["ok"]) == bool(runtime_ok), f"паритет «{label}»: компилятор {'принял' if d['ok'] else 'отклонил'}, рантайм {'принял' if runtime_ok else 'отклонил'}")


def main():
    cli_cases()
    runtime_cases()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("sdk_world_test: все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
