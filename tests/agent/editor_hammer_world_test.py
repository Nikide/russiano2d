#!/usr/bin/env python3
"""Re2D World authoring shares Hammer tabs, history and native preview."""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
from agent_client import Agent, ROOT
from editor_hammer_test import settle, run
E='$.editorApp'
A=E+'.activeTab().inst'
checks=0

def check(ok,text):
    global checks
    checks+=1
    print(('  ok   ' if ok else '  FAIL ')+text,flush=True)
    if not ok: raise AssertionError(text)

def main():
    recents=Path(ROOT)/'state.local.json'
    previous=recents.read_bytes() if recents.exists() else None
    try: return test()
    finally:
        if previous is None: recents.unlink(missing_ok=True)
        else: recents.write_bytes(previous)

def test():
    with tempfile.TemporaryDirectory(prefix='r2d-hammer-world-') as tmp:
        root=Path(tmp)
        (root/'project.json').write_text('{"title":"Hammer + Re2D World","width":1440,"height":900}')
        (root/'main.js').write_text('$.ready(()=>{});')
        for name in ['a','b']:
            shutil.copyfile(Path(ROOT)/'tests/fixtures/sdk/world/stack.re2dmap',root/(name+'.re2dmap'))
        (root/'assets').mkdir()
        shutil.copyfile(Path(ROOT)/'demos/re2d_world_renderer_lab/brick.png',root/'assets/brick.png')
        shutil.copyfile(Path(ROOT)/'demos/re2d_world_renderer_lab/brick_n.png',root/'assets/brick_n.png')
        original=(root/'a.re2dmap').read_bytes()
        with Agent(game='editor',scene=tmp,seed=14) as a:
            settle(a,E+'.state.project!==null && '+E+'.state.busy===0')
            run(a,E+'.openWith("a.re2dmap","re2d-world-studio")')
            settle(a,'!!'+A)
            a.eval('globalThis.worldA='+A+';1')
            check(a.eval(E+'.activeTab().studio.native && '+E+'.activeTab().studio.id==="hammer"'),'old Re2D World id opens native Hammer')
            check(a.eval('worldA.map.cells.length===1 && !worldA.map.world && worldA.map.regionSize===undefined'),'cell-world source keeps its envelope and region semantics')
            check(run(a,'worldA.save()') and (root/'a.re2dmap').read_bytes()==original,'untouched cell map Save preserves source bytes')
            check(a.eval('worldA.doc.content("we-tree").includes("cell:ground") && worldA.doc.content("we-tree").includes("wall:w0")'),'shared object tree includes cell and walls')
            check(a.eval('worldA.doc.content("we-overlay-top").includes("cell:ground") && worldA.doc.content("we-overlay-front").includes("cell:ground")'),'XY and height views show authored cells/spans')
            a.eval('worldA.select("cell",["ground"]);1');a.step(3)
            check(a.eval('worldA.doc.value("we-prop-spans").includes("160")'),'cell inspector shows both original height spans')
            a.eval('worldA.doc.click("we-toggle-elements");worldA.doc.setValue("we-element-json",JSON.stringify({...worldA.map.cells[0],customTag:"kept"}));worldA.doc.click("we-element-apply");1')
            settle(a,'!worldA.session.state.busy')
            check(a.eval('worldA.map.cells[0].customTag==="kept" && worldA.undo() && !worldA.dirty()'),'full JSON editor adds custom fields in the same native history')
            a.eval('worldA.doc.click("we-toggle-elements");1');a.step(2)
            check(run(a,'worldA.ops.applyInspector("cell",{spans:JSON.stringify([{bottom:0,top:128,floorColor:"#abcabc"},{bottom:160,top:288}])})')['ok'],'nested spans edit uses native world-edit')
            check(a.eval('worldA.dirty() && worldA.undo() && !worldA.dirty()'),'cell edit is one step in Hammer history')
            check(a.eval('worldA.redo() && worldA.dirty()'),'same history restores cell edit')
            # Alternating cells and brushes proves this is one session/history.
            check(run(a,'worldA.ops.createBrush({id:"marker",rect:[256,256,32,32],bottom:0,top:32,tool:"clip"})')['ok'],'brush edit is accepted in the same source')
            check(a.eval('worldA.undo() && !worldA.map.brushes.length && worldA.map.cells[0].spans[0].floorColor==="#abcabc"'),'undo brush retains preceding cell edit')
            check(a.eval('worldA.undo() && !worldA.dirty()'),'next undo reaches original cell document')
            a.eval('worldA.select("wall",["w0"]);1')
            check(run(a,'worldA.ops.splitWall()')['ok'] and a.eval('worldA.map.walls.length===5'),'split wall is a native Hammer operation')
            created=a.eval('worldA.selection.snapshot().ids.find(id=>id!=="w0")')
            check(run(a,'worldA.ops.joinWalls("w0",'+json.dumps(created)+')')['ok'] and a.eval('worldA.map.walls.length===4'),'join wall runs in same history and preserves original wall')
            check(a.eval('worldA.undo() && worldA.map.walls.length===5 && worldA.redo()'),'wall split/join participate in shared undo/redo')
            a.eval('worldA.select("cell",["ground"]);1')
            check(run(a,'worldA.ops.moveSelection(16,32,8)')['ok'] and a.eval('worldA.map.cells[0].rect[0]===16 && worldA.map.cells[0].spans[1].bottom===168'),'Move shifts XY and absolute span heights')
            a.eval('worldA.undo();1')
            # Mouse drag through Hammer Move tool on the original cell.
            a.eval('worldA.select("cell",["ground"]);worldA.setTool("move");1');a.step(3)
            point=a.eval('(()=>{const v=worldA.viewports.byId("top"),r=worldA.doc.layoutRect("we-vp-top"),p=worldA.viewports.projectPoint(v,100,100,0),k=$.window.pixels().w/$.window.size().w;return {x:(r.x+p.x)/k,y:(r.y+p.y)/k,dx:worldA.viewports.state.gridSize*v.zoom/k};})()')
            a.mouse_move(x=point['x'],y=point['y']);a.step(2);a.mouse(button=1,action='down');a.step(2)
            a.mouse_move(x=point['x']+point['dx']*2,y=point['y']);a.step(2);a.mouse(button=1,action='up')
            settle(a,'!worldA.session.state.busy')
            check(a.eval('worldA.map.cells[0].rect[0]===32'),'actual mouse drag moves cell through Hammer grid/native command')
            check(a.eval('worldA.undo() && worldA.map.cells[0].rect[0]===0'),'mouse drag is one undo step')
            # Add each existing section through the actual buttons, then undo.
            a.eval('worldA.doc.click("we-toggle-elements");1');a.step(2)
            for section in ['cells','walls','portals','stairs','slopes','lights']:
                n=a.eval('(worldA.map['+json.dumps(section)+']||[]).length')
                a.eval('worldA.doc.click('+json.dumps('we-add-'+section)+');1');settle(a,'!worldA.session.state.busy')
                check(a.eval('(worldA.map['+json.dumps(section)+']||[]).length')==n+1,section+' toolbar button creates native authoring element')
                a.eval('worldA.undo();1');a.step(2)
            check(run(a,'worldA.ops.addWorldElement("lights")')['ok'],'authored light added through public Hammer ops')
            check(run(a,'worldA.compile(true)')['ok'],'cell-world compile loads actual shared runtime preview')
            check(a.eval('worldA.session.state.world.info().spans===2 && worldA.session.state.world.info().lights===1'),'native preview contains original two floors and authored light')
            check((root/'a.re2dmap').read_bytes()==original,'Compile does not autosave map source')
            check(run(a,'worldA.ops.previewMaterial({name:"brick",surfaces:[0],albedo:"assets/brick.png",normal:"assets/brick_n.png"})')['materials']==1,'PNG albedo/normal preview uses shared world runtime with project paths')
            a.eval('worldA.doc.click("we-3d-backend");worldA.doc.click("we-3d-debug");1');a.step(3)
            check(a.eval('worldA.session.state.world.info().backend==="gpu-reference" && worldA.session.state.debugView!=="final"'),'GPU and diagnostic controls operate the same preview')
            check(run(a,'worldA.ops.validate()')['ok'],'native Validate accepts edited cell-world source')
            # Save source, reopen alias, and independently edit second map.
            check(run(a,'worldA.save()') and not a.eval('worldA.dirty()'),'shared Save writes cell-world source and clears dirty')
            saved=json.loads((root/'a.re2dmap').read_text())
            check(saved['cells'][0]['spans'][1]['bottom']==160 and not saved.get('brushes'),'Save keeps cells/spans without brush conversion')
            run(a,E+'.openWith("a.re2dmap","re2d-world-studio")')
            check(a.eval(E+'.state.tabs.filter(t=>t.kind==="studio").length===1 && '+A+'===worldA'),'old World alias reuses the existing Hammer tab/history')
            run(a,E+'.openFile("b.re2dmap")');settle(a,'!!'+A)
            a.eval('globalThis.worldB='+A+';1')
            check(a.eval('worldA.doc.id!==worldB.doc.id && !worldA.state.active && worldB.state.active'),'two cell maps have independent Hammer documents')
            check(run(a,'worldB.ops.addWorldElement("lights")')['ok'] and a.eval('worldB.dirty() && !worldA.dirty()'),'editing second cell map keeps first document clean')
            run(a,E+'.openFile("a.re2dmap")');a.step(4)
            # Invalid draft compile must keep last valid baked file/runtime.
            out=Path(a.eval('worldA.session.state.previewOut'));good=out.read_bytes()
            cell=a.eval('worldA.map.cells[0]');cell['spans'][0]['top']=-1
            check(run(a,'worldA.ops.setWorldElement("cells","ground",'+json.dumps(cell)+')')['ok'],'incomplete cell draft remains editable')
            check(not run(a,'worldA.compile(true)')['ok'] and out.read_bytes()==good and a.eval('!!worldA.session.state.world'),'invalid cell compile preserves last good output and runtime')
            check(a.eval(E+'.state.problemList.some(d=>d.source && d.source.location && d.source.location.section==="cells")'),'native cell diagnostic appears in Editor Problems')
            d=a.eval(E+'.state.problemList.find(d=>d.source && d.source.location && d.source.location.section==="cells").source')
            check(a.eval('worldA.navigateDiagnostic('+json.dumps(d)+') && worldA.selection.snapshot().kind==="cell"'),'Problems navigation selects cell in common inspector')
            a.eval('worldA.undo();1');run(a,'worldA.ops.validate()');a.eval('worldA.session.state.debugView="final";worldA.session.state.world.debug.view("final");worldA.render();1');a.step(4)
            if os.environ.get('R2D_CAPTURE_VISUALS') == '1':
                a.screenshot(str(Path(ROOT)/'build/editor-hammer-world.png'))
            check(not list(Path(ROOT).glob('editor/build/.we-*-in-*')),'native edit scratch files are removed')
            a.eval(E+'.closeTab("a.re2dmap");1');a.step(3)
            check(a.eval('!worldA.session.state.world && !!worldB.map.cells'),'closing A releases only its runtime and retains B map')
    print('All',checks,'Hammer/Re2D World checks passed.')
    return 0

if __name__=='__main__': raise SystemExit(main())
