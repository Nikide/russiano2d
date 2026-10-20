#!/usr/bin/env python3
# ===========================================================================
# World Editor (universal Hammer-like Re2D editor): agent test on the real engine.
#
# Проверяется (docs/SDK.md §9, docs/WORLD_EDITOR.md):
#   * инструмент открывается из sdk_tools.json (id world-editor);
#   * четыре вьюпорта (Top/Front/Side/3D) имеют реальную геометрию RmlUi;
#   * brush create/move/resize/face material+tags, entity, path, visgroup;
#   * undo/redo, save, native validate (world info), compile (world compile)
#     и настоящий runtime preview ($.re2dWorld);
#   * каждая GUI-кнопка вызывает ту же операцию, что фасад/агент;
#   * минимум один реальный клик мышью по RmlUi и одно реальное событие
#     мыши/клавиатуры агента (панорама/сетка).
#
# Запуск: python3 tests/agent/world_editor_test.py
# ===========================================================================
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FIXTURE = os.path.join(ROOT, "tests", "fixtures", "sdk", "world", "editor_base.re2dmap")
BASE = os.path.join(ROOT, "build", "world-editor-base.re2dmap")
OUT = os.path.join(ROOT, "build", "world-editor-test.re2dmap")
DOC = "$.ui.doc('sdk/ui/world_editor.rml')"
API = "$.sdkApp.studios.world"
failures = []


def check(value, message):
    print(("  ok   " if value else "  FAIL ") + message)
    if not value:
        failures.append(message)


def snap(a):
    return json.loads(a.eval("JSON.stringify(" + API + ".snapshot())"))


def mapof(a):
    return json.loads(a.eval("JSON.stringify(" + API + ".map)"))


def size(a, element):
    return json.loads(a.eval(
        "(function(){var d=" + DOC + ";var r=d.rect('" + element + "')||d.layoutRect('" + element +
        "');return JSON.stringify(r||{x:0,y:0,w:0,h:0});})()"))


def wait_idle(a, limit=500):
    idle = 0
    for _ in range(limit):
        a.step(2)
        idle_js = ("(function(){var s=$.sdkApp.studios.world;"
                   "return $.sdkApp.state.busy===0 && (!s || !s.session || !s.session.state.busy);})()")
        if a.eval(idle_js):
            idle += 1
            if idle >= 2:
                return True
        else:
            idle = 0
    return False


def run(a, code):
    a.eval(code + ";1")
    a.step(6)
    return wait_idle(a)


def click_xy(a, element):
    r = size(a, element)
    a.mouse_move(x=r["x"] + r["w"] / 2, y=r["y"] + r["h"] / 2)
    a.step(3)
    a.mouse(button=1, action="click")
    a.step(4)
    return r


def brush_by_id(data, brush_id):
    for brush in data.get("brushes", []):
        if brush.get("id") == brush_id:
            return brush
    return None


def entity_by_id(data, entity_id):
    for entity in data.get("entities", []):
        if entity.get("id") == entity_id:
            return entity
    return None


def path_by_id(data, path_id):
    for path in data.get("paths", []):
        if path.get("id") == path_id:
            return path
    return None


def main():
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    # Recovery-файл прошлого прогона иначе откроет диалог и перехватит мышь.
    for recovery in (os.path.join(ROOT, "build", ".r2d-recovery-world-editor-base.re2dmap.json"),
                     os.path.join(ROOT, "build", ".r2d-recovery-world-editor-test.re2dmap.json")):
        if os.path.isfile(recovery):
            os.remove(recovery)
    shutil.copyfile(FIXTURE, BASE)
    for stale in (OUT, BASE + ".re2dworld", OUT + ".re2dworld"):
        if os.path.isfile(stale):
            os.remove(stale)

    with Agent(game="sdk", seed=6) as a:
        a.step(4)
        wait_idle(a)

        # --- Реестр и открытие ------------------------------------------------
        a.eval("$.sdkApp.loadRegistry();1")
        wait_idle(a)
        tools = json.loads(a.eval("JSON.stringify($.sdkApp.state.registry.tools)"))
        check(any(t.get("id") == "world-editor" and t.get("valid") for t in tools),
              "инструмент world-editor есть в sdk_tools.json и валиден")
        run(a, "$.sdkApp.openTool('world-editor',{assetAbs:'" + BASE.replace("\\", "/") + "'})")
        a.step(3)
        state = snap(a)
        check(state["active"], "экран World Editor открыт из реестра")
        icon_api = json.loads(a.eval("JSON.stringify({count:$.ui.iconCount(),save:$.ui.hasIcon('save'),move:$.ui.hasIcon('open_with')})"))
        icon_box = size(a, "we-icon-save")
        check(icon_api["count"] >= 2000 and icon_api["save"] and icon_api["move"],
              "движок предоставляет встроенные Material Icons для редактора")
        check(icon_box["w"] > 0 and icon_box["h"] > 0,
              "иконка сохранения размещена в живом RmlUi-документе")
        a.eval("$.sdkApp.recovery.discard(" + json.dumps(BASE) + ");1")
        a.step(2)

        # --- Форма снимка ----------------------------------------------------
        expected = {"active", "file", "dirty", "tool", "grid", "selection", "map", "extensions", "diagnostics"}
        check(set(state.keys()) == expected, "snapshot: ровно контрактные поля")
        check(set(state["map"].keys()) == {"brushes", "entities", "paths", "visgroups"},
              "snapshot.map: brushes/entities/paths/visgroups")
        check(isinstance(state["extensions"], list), "snapshot.extensions — массив id")
        check(state["selection"] == {"kind": "none", "ids": []}, "стартовое выделение пусто")

        # --- Четыре вьюпорта -------------------------------------------------
        for element in ("we-vp-top", "we-vp-front", "we-vp-side", "we-vp-3d"):
            r = size(a, element)
            check(r["w"] > 100 and r["h"] > 50, element + " имеет реальную геометрию (%dx%d)" % (r["w"], r["h"]))
        check(a.eval(API + ".viewports.views.length") == 4, "в редакторе ровно 4 вьюпорта")

        # --- Brush: создать / переместить / изменить размер ------------------
        before = mapof(a)
        run(a, API + ".ops.createBrush({rect:[16,16,64,64],bottom:0,top:96,tool:'nodraw',sideColor:'#778899',tags:['alpha']})")
        data = mapof(a)
        check(len(data["brushes"]) == len(before["brushes"]) + 1, "ops.createBrush добавляет brush")
        brush_id = data["brushes"][-1]["id"]
        brush = brush_by_id(data, brush_id)
        check(brush is not None and brush.get("rect") == [16, 16, 64, 64], "id/rect нового brush пришли из native")
        check(snap(a)["selection"]["kind"] == "brush" and brush_id in snap(a)["selection"]["ids"],
              "созданный brush выделен (выбор из result.ids)")
        check(snap(a)["dirty"], "правка помечает карту dirty")
        recovery = json.loads(a.eval("JSON.stringify($.sdkApp.recovery.snapshot())"))
        check(any(os.path.abspath(r.get("asset", "")) == os.path.abspath(BASE) for r in recovery),
              "crash recovery следит за открытой картой")

        run(a, API + ".ops.setGrid(64)")
        check(snap(a)["grid"] == 64, "ops.setGrid переключает шаг сетки")
        run(a, API + ".ops.setGrid(16)")
        check(snap(a)["grid"] == 16, "ops.setGrid возвращает шаг 16")

        run(a, API + ".ops.moveSelection(16,0,0)")
        brush = brush_by_id(mapof(a), brush_id)
        check(brush["rect"][0] == 32 and brush["rect"][1] == 16, "ops.moveSelection сдвигает brush")

        run(a, API + ".ops.resizeSelection(16,16,0)")
        brush = brush_by_id(mapof(a), brush_id)
        check(brush["rect"][2] == 80 and brush["rect"][3] == 80, "ops.resizeSelection меняет размер")

        # --- Инспектор по схеме (GUI) ----------------------------------------
        a.eval(API + ".select('brush',['" + brush_id + "']);1")
        a.eval(DOC + ".setValue('we-prop-top','140');1")
        a.eval(DOC + ".click('we-apply');1")
        wait_idle(a)
        brush = brush_by_id(mapof(a), brush_id)
        check(brush.get("top") == 140, "инспектор из схемы применяет поле top")

        # --- Грань: материал и теги ------------------------------------------
        run(a, API + ".ops.setFaceMaterial('" + brush_id + "','side','#ff8800')")
        brush = brush_by_id(mapof(a), brush_id)
        check(brush.get("sideColor") == "#ff8800", "ops.setFaceMaterial пишет материал грани")
        # native хранит tags только у floor/ceiling (side — material only).
        run(a, API + ".ops.setTags('face',['" + brush_id + "'],'alpha, beta','floor')")
        brush = brush_by_id(mapof(a), brush_id)
        check(brush.get("tags") == ["alpha", "beta"], "ops.setTags пишет теги грани floor")

        # --- GUI-кнопки duplicate/delete и undo/redo --------------------------
        count = len(mapof(a)["brushes"])
        a.eval(API + ".select('brush',['" + brush_id + "']);1")
        a.eval(DOC + ".click('we-duplicate');1")
        wait_idle(a)
        check(len(mapof(a)["brushes"]) == count + 1, "кнопка duplicate вызывает ops.duplicateSelection")
        a.eval(DOC + ".click('we-undo');1")
        a.step(3)
        check(len(mapof(a)["brushes"]) == count, "undo отменяет duplicate")
        a.eval(DOC + ".click('we-redo');1")
        a.step(3)
        check(len(mapof(a)["brushes"]) == count + 1, "redo повторяет duplicate")
        a.eval(DOC + ".click('we-undo');1")
        a.step(3)

        a.eval(API + ".select('brush',['" + brush_id + "']);1")
        a.eval(DOC + ".click('we-delete');1")
        wait_idle(a)
        check(len(mapof(a)["brushes"]) == count - 1, "кнопка delete вызывает ops.deleteSelection")
        a.eval(DOC + ".click('we-undo');1")
        a.step(3)
        check(len(mapof(a)["brushes"]) == count, "undo возвращает удалённый brush")

        # --- Entity ----------------------------------------------------------
        before = mapof(a)
        run(a, API + ".ops.createEntity({kind:'light',x:96,y:96,h:64,tags:['lamp']})")
        data = mapof(a)
        check(len(data["entities"]) == len(before["entities"]) + 1, "ops.createEntity добавляет сущность")
        entity_id = data["entities"][-1]["id"]
        entity = entity_by_id(data, entity_id)
        check(entity.get("kind") == "light" and entity.get("x") == 96, "сущность создана с kind/x из args")
        run(a, API + ".ops.moveSelection(16,0,0)")
        check(entity_by_id(mapof(a), entity_id)["x"] == 112, "перемещение сущности")

        # --- Path ------------------------------------------------------------
        before = mapof(a)
        run(a, API + ".ops.createPath({type:'path',nodes:[{x:32,y:32,h:0},{x:96,y:32,h:0}],oneWay:true})")
        data = mapof(a)
        check(len(data["paths"]) == len(before["paths"]) + 1, "ops.createPath добавляет путь")
        path_id = data["paths"][-1]["id"]
        check(len(path_by_id(data, path_id)["nodes"]) == 2, "у пути два узла")
        run(a, API + ".ops.addPathNode('" + path_id + "',{x:160,y:32,h:0})")
        check(len(path_by_id(mapof(a), path_id)["nodes"]) == 3, "ops.addPathNode добавляет узел")
        run(a, API + ".ops.connectPath('" + path_id + "',0,2)")
        path = path_by_id(mapof(a), path_id)
        check([0, 2] in path.get("connections", []), "ops.connectPath пишет соединение узлов")
        run(a, API + ".ops.setPathFields('" + path_id + "',{loop:true,name:'route'})")
        path = path_by_id(mapof(a), path_id)
        check(path.get("loop") is True and path.get("name") == "route", "path.set: loop/name")
        paths_before = len(mapof(a)["paths"])
        a.eval(API + ".select('path',['" + path_id + "']);1")
        a.eval(DOC + ".click('we-delete');1")
        wait_idle(a)
        check(len(mapof(a)["paths"]) == paths_before - 1, "кнопка delete удаляет path (native path.delete)")
        a.eval(DOC + ".click('we-undo');1")
        a.step(3)
        check(len(mapof(a)["paths"]) == paths_before, "undo возвращает path")

        # --- VisGroup --------------------------------------------------------
        before = mapof(a)
        run(a, API + ".ops.ensureVisgroup({name:'Main'})")
        data = mapof(a)
        check(len(data["visgroups"]) == len(before["visgroups"]) + 1, "ops.ensureVisgroup создаёт группу")
        group = data["visgroups"][-1]
        group_id = group["id"]
        check(group.get("visible") is not False, "visgroup видима по умолчанию")
        run(a, API + ".ops.setVisgroupState('" + group_id + "',{visible:false,locked:true})")
        group = [g for g in mapof(a)["visgroups"] if g["id"] == group_id][0]
        check(group.get("visible") is False and group.get("locked") is True, "visgroup.state: visible/locked")

        # --- World properties + GUI undo/redo --------------------------------
        run(a, API + ".ops.setWorld({top:320})")
        check(mapof(a)["world"]["top"] == 320, "ops.setWorld меняет конверт мира")
        a.eval(DOC + ".click('we-undo');1")
        a.step(3)
        check(mapof(a)["world"]["top"] == 256, "кнопка undo отменяет world.set")
        a.eval(DOC + ".click('we-redo');1")
        a.step(3)
        check(mapof(a)["world"]["top"] == 320, "кнопка redo повторяет world.set")

        # --- Vertex / clip ---------------------------------------------------
        data = mapof(a)
        brush = brush_by_id(data, brush_id)
        run(a, API + ".ops.vertexMove('" + brush_id + "',0," + str(brush["rect"][0] + 8) + "," + str(brush["rect"][1]) + ")")
        check(snap(a)["diagnostics"]["errors"] == 0, "vertex.move принят native (или отклонён без mutation)")
        a.eval(DOC + ".click('we-undo');1")
        a.step(3)
        run(a, API + ".ops.duplicateSelection()")
        data = mapof(a)
        clip_id = data["brushes"][-1]["id"]
        clip_brush = brush_by_id(data, clip_id)
        cx = clip_brush["rect"][0] + clip_brush["rect"][2] / 2
        clip_count = len(data["brushes"])
        run(a, API + ".ops.clip('" + clip_id + "','x'," + str(cx) + ",'both')")
        check(len(mapof(a)["brushes"]) > clip_count, "ops.clip разрезает brush (native clip)")
        a.eval(DOC + ".click('we-undo');1")
        a.step(3)

        # --- Save (native noop --out) ---------------------------------------
        a.eval(API + ".session.state.path=" + json.dumps(OUT) + ";1")
        a.eval(DOC + ".click('we-save');1")
        wait_idle(a)
        check(os.path.isfile(OUT), "save пишет канонический .re2dmap через native noop")
        check(not snap(a)["dirty"], "после save dirty сброшен")
        saved = json.load(open(OUT, encoding="utf-8"))
        check(saved.get("version") == 1 and len(saved.get("brushes", [])) == len(mapof(a)["brushes"]),
              "сохранённый файл содержит модель редактора")
        check(os.path.abspath(OUT) != os.path.abspath(FIXTURE), "fixture не перезаписан")

        # --- Validate / compile / preview -----------------------------------
        a.eval(DOC + ".click('we-validate');1")
        wait_idle(a)
        stats = json.loads(a.eval("JSON.stringify(" + API + ".session.state.stats)"))
        check(stats and stats.get("brushes", 0) >= 1, "validate: native world info вернул stats")
        a.eval(DOC + ".click('we-compile');1")
        wait_idle(a)
        check(a.eval("!!" + API + ".session.state.world"), "compile: настоящий runtime world создан")
        check(os.path.isfile(OUT.replace(".re2dmap", ".re2dworld")), "compile пишет .re2dworld")
        check(a.eval(API + ".session.state.world.info().spans") > 0, "runtime preview отвечает info().spans")

        # --- ops parity ------------------------------------------------------
        required = ["createBrush", "deleteSelection", "duplicateSelection", "moveSelection", "resizeSelection",
                    "setGrid", "setFaceMaterial", "setTags", "createEntity", "connectPath", "validate",
                    "compile", "buildAndRun", "open", "save"]
        missing_ops = [name for name in required if a.eval("typeof " + API + ".ops[" + json.dumps(name) + "]") != "function"]
        missing_api = [name for name in required if a.eval("typeof " + API + "[" + json.dumps(name) + "]") != "function"]
        check(not missing_ops, "ops: все обязательные операции — функции (%s)" % missing_ops)
        check(not missing_api, "фасад: все обязательные операции доступны агенту (%s)" % missing_api)
        buttons = ["we-save", "we-undo", "we-redo", "we-validate", "we-compile", "we-run", "we-build-run",
                   "we-tool-select", "we-tool-block", "we-tool-move", "we-tool-resize", "we-tool-vertex",
                   "we-tool-clip", "we-tool-face", "we-tool-entity", "we-tool-path", "we-grid-dec", "we-grid-inc",
                   "we-focus-selection", "we-apply"]
        collapsed = [b for b in buttons if size(a, b)["w"] <= 0 or size(a, b)["h"] <= 0]
        check(not collapsed, "все кнопки меню/панели — реальные RmlUi-элементы (%s)" % collapsed)

        # --- Extension hooks -------------------------------------------------
        a.eval("$.sdkApp.extensions.registerEntityType({id:'test.point',class:'test.point',label:'Test Point',fields:['x','y']});"
               "$.sdkApp.extensions.registerWorldTool({id:'test.tool',label:'Test Tool',op:'noop',args:{}});1")
        a.step(3)
        defs = json.loads(a.eval("JSON.stringify(" + API + ".extensions.entityDefinitions())"))
        check(any(d.get("id") == "test.point" for d in defs), "extension entityDefinitions доходят до редактора")
        a.eval(API + ".render();1")
        a.step(3)
        check("Test Tool" in a.eval(DOC + ".content('we-ext-toolbar')"), "extension worldTools попадают в toolbar")

        # --- Реальная клавиатура: [ / ] меняют сетку -------------------------
        grid = snap(a)["grid"]
        a.key("[", "tap")
        a.step(4)
        check(snap(a)["grid"] < grid, "реальная клавиша '[' уменьшает сетку")
        a.key("]", "tap")
        a.step(4)
        check(snap(a)["grid"] == grid, "реальная клавиша ']' возвращает сетку")

        # --- Реальная мышь: панорама и клик по кнопке -----------------------
        pan_before = a.eval(API + ".viewports.byId('top').panX")
        r = size(a, "we-vp-top")
        a.mouse_move(x=r["x"] + r["w"] / 2, y=r["y"] + r["h"] / 2)
        a.step(2)
        a.mouse(button=2, action="down")
        a.step(2)
        a.mouse_move(x=r["x"] + r["w"] / 2 + 40, y=r["y"] + r["h"] / 2)
        a.step(3)
        a.mouse(button=2, action="up")
        a.step(2)
        check(a.eval(API + ".viewports.byId('top').panX") != pan_before, "реальная СКМ-мышь панорамирует Top")
        click_xy(a, "we-tool-block")
        check(snap(a)["tool"] == "block", "реальный клик мышью переключает инструмент на block")

        # Реальное создание brush перетаскиванием в Top (block tool).
        before = len(mapof(a)["brushes"])
        a.eval(DOC + ".setValue('we-height','64');" + DOC + ".setValue('we-bottom','0');1")
        r = size(a, "we-vp-top")
        a.mouse_move(x=r["x"] + 60, y=r["y"] + 40)
        a.step(3)
        a.mouse(button=1, action="down")
        a.step(2)
        a.mouse_move(x=r["x"] + 130, y=r["y"] + 90)
        a.step(3)
        a.mouse(button=1, action="up")
        a.step(4)
        wait_idle(a)
        data = mapof(a)
        check(len(data["brushes"]) == before + 1, "реальное перетаскивание в Top создаёт brush")
        if len(data["brushes"]) == before + 1:
            created = data["brushes"][-1]
            check(created.get("top") == 64 and created.get("bottom") == 0,
                  "высота brush берётся из числового поля (top=64)")
        a.eval(DOC + ".click('we-undo');1")
        a.step(3)
        check(len(mapof(a)["brushes"]) == before, "undo отменяет brush, созданный мышью")

        # --- Максимизация / восстановление ----------------------------------
        a.eval(DOC + ".click('we-pane-max-top');1")
        a.step(3)
        check(a.eval(API + ".viewports.state.maximized") == "top", "Max разворачивает Top")
        a.eval(DOC + ".click('we-restore');1")
        a.step(3)
        check(a.eval(API + ".viewports.state.maximized") is None, "4 вида восстанавливаются")

        # --- Закрытие --------------------------------------------------------
        a.eval(DOC + ".click('we-back');1")
        a.step(3)
        check(not snap(a)["active"], "закрытие возвращает оболочку SDK")

    for recovery in (os.path.join(ROOT, "build", ".r2d-recovery-world-editor-base.re2dmap.json"),
                     os.path.join(ROOT, "build", ".r2d-recovery-world-editor-test.re2dmap.json")):
        if os.path.isfile(recovery):
            os.remove(recovery)

    # run_tests.py classifies any output line starting with "FAIL" as a failed
    # assertion, including this historical summary when the count is zero.
    print("\nASSERTION_FAILURES: %d" % len(failures))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
