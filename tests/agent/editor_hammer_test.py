#!/usr/bin/env python3
"""Hammer tabs: independent documents, native transactions, focus and preview.

R2D_BINARY=build-xmake/macos-arm64/macosx/arm64/release/r2d \
    python3 tests/agent/editor_hammer_test.py
"""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from agent_client import Agent, ROOT

FIXTURE = Path(ROOT) / 'tests/fixtures/sdk/world/editor_base.re2dmap'
E = '$.editorApp'
A = E + '.activeTab().inst'
failures = []


def check(value, label):
    print(('  ok   ' if value else '  FAIL ') + label, flush=True)
    if not value:
        failures.append(label)


def settle(a, predicate='true', seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        a.step(3)
        if a.eval(predicate):
            a.step(3)
            return
        time.sleep(.005)
    raise AssertionError('timeout: ' + predicate + '\n' + a.stderr_tail())


def run(a, code):
    a.eval('globalThis.hammerDone=false;globalThis.hammerResult=null;Promise.resolve().then(()=>(' + code + ')).then(v=>{globalThis.hammerResult=v;globalThis.hammerDone=true;},e=>{globalThis.hammerResult={error:String(e)};globalThis.hammerDone=true;});1')
    settle(a, 'globalThis.hammerDone')
    result = a.eval('globalThis.hammerResult')
    if isinstance(result, dict) and result.get('error'):
        raise AssertionError(result)
    return result


def snap(a, ref=A):
    return a.eval(ref + '.snapshot()')


def run_test():
    with tempfile.TemporaryDirectory(prefix='r2d-hammer-') as tmp:
        project = Path(tmp)
        (project / 'project.json').write_text('{"title":"Hammer tabs","width":1280,"height":720}')
        (project / 'main.js').write_text('$.ready(() => {});')
        for name in ['a', 'b']:
            shutil.copyfile(FIXTURE, project / (name + '.re2dmap'))
        original = (project / 'a.re2dmap').read_bytes()
        with Agent(game='editor', scene=tmp, seed=6) as a:
            settle(a, E + '.state.project !== null && ' + E + '.state.busy === 0')
            a.eval(E + ".openFile('a.re2dmap');1")
            settle(a, A + ' !== undefined && !!' + A)
            check(a.eval(E + '.activeTab().studio.native && ' + E + ".activeTab().studio.id==='hammer'"), 'map opens in native Hammer Studio')
            a.eval('globalThis.hammerA=' + A + ';1')
            check(run(a, A + '.save()'), 'untouched Save succeeds')
            check((project / 'a.re2dmap').read_bytes() == original, 'untouched Save preserves source bytes')
            for view in ['top', 'front', 'side', '3d']:
                r = a.eval(A + ".doc.rect('we-vp-" + view + "')")
                check(r and r['w'] > 80 and r['h'] > 40, view + ' has a real viewport')
            a.eval(E + ".openFile('b.re2dmap');1")
            settle(a, A + ' !== undefined && !!' + A)
            a.eval('globalThis.hammerB=' + A + ';1')
            check(a.eval(E + '.state.tabs.filter(t=>t.kind==="studio").length===2 && hammerA.doc.id!==hammerB.doc.id'), 'two maps remain open in independent RmlUi documents')
            check(a.eval('!hammerA.active && hammerB.active'), 'only the active tab receives updates')
            before = snap(a)['map']['brushes']
            r = run(a, "Promise.all([hammerA.ops.createBrush({rect:[16,16,32,32],bottom:0,top:64}),hammerB.ops.createBrush({rect:[64,16,32,32],bottom:0,top:96})])")
            check(all(x['ok'] for x in r), 'parallel native edits use independent scratch files')
            check(a.eval('hammerA.map.brushes.at(-1).rect[0]===16 && hammerB.map.brushes.at(-1).rect[0]===64'), 'parallel edits keep each map and selection independent')
            check(a.eval('hammerA.dirty() && hammerB.dirty()'), 'each tab tracks unsaved changes')
            check(a.eval('hammerB.undo() && hammerB.map.brushes.length===' + str(before) + ' && hammerA.map.brushes.length===' + str(before + 1)), 'one undo affects only its tab')
            check(a.eval('hammerB.redo()'), 'redo restores the transaction')
            # Real keyboard input in an inspector field must not delete map objects.
            a.eval(A + ".doc.focus('we-height');1")
            a.step(3)
            n = snap(a)['map']['brushes']
            a.tap('Backspace'); a.step(3)
            check(snap(a)['map']['brushes'] == n, 'Backspace in inspector does not delete selection')
            a.eval(A + ".doc.focus('we-height',false);1")
            a.step(2)
            a.hold(['Left Ctrl']); a.tap('Z'); a.step(2); a.release_all(); a.step(3)
            check(snap(a)['map']['brushes'] == before, 'Editor Ctrl+Z routes once into active studio history')
            a.hold(['Left Ctrl']); a.tap('Y'); a.step(2); a.release_all(); a.step(3)
            check(snap(a)['map']['brushes'] == before + 1, 'Editor Ctrl+Y routes into active studio history')
            # Face material + tags must be a single reversible edit.
            a.eval(A + '.selection.setFace(' + A + '.map.brushes.at(-1).id,"floor");1')
            check(a.eval(A + '.selection.snapshot().kind==="face"'), 'face selection retains brush identity')
            face_before = a.eval('JSON.stringify(' + A + '.map.brushes.at(-1))')
            a.eval(A + '.doc.setValue("we-face-material","#123456");' + A + '.doc.setValue("we-face-tags","stone");' + A + '.doc.click("we-face-apply");1')
            settle(a, '!' + A + '.session.state.busy')
            check(a.eval(A + '.map.brushes.at(-1).floorColor==="#123456" && ' + A + '.map.brushes.at(-1).tags.includes("stone")'), 'face UI applies material and tags through native face.set')
            a.eval(A + '.undo();1'); a.step(3)
            check(a.eval('JSON.stringify(' + A + '.map.brushes.at(-1))') == face_before, 'one undo restores both material and tags')
            a.eval(A + '.select("brush",[' + A + '.map.brushes.at(-1).id]);1')
            check(run(a, A + '.compile(true)')['ok'], 'native compile creates real runtime preview')
            check(snap(a)['preview']['state'] == 'актуален', 'preview identifies current compiled state')
            r = run(a, 'Promise.all([' + A + '.compile(true),' + A + '.ops.createBrush({rect:[0,0,16,16],bottom:0,top:64})])')
            check(r[0]['ok'] and not r[1]['ok'] and r[1]['diagnostics'][0]['code']=='SDK_WORLD_EDIT_BUSY', 'in-flight compile prevents concurrent edits in the same tab')
            out = project / 'b.re2dworld'
            check(out.exists() and a.eval(A + '.session.state.world.info().spans>0'), 'compiled file and actual runtime spans exist')
            a.eval(A + '.select("brush",[' + A + '.map.brushes.at(-1).id]);1')
            run(a, A + '.ops.moveSelection(16,0,0)')
            check(snap(a)['preview']['state'] == 'устарел', 'edit marks compiled preview stale')
            a.eval(A + '.undo();1'); a.step(3)
            check(snap(a)['preview']['state'] == 'актуален', 'undo back to compiled data restores freshness')
            run(a, A + '.ops.moveSelection(16,0,0)')
            # A failed compile must preserve the last valid output and runtime.
            good_output = out.read_bytes()
            a.eval(A + '.session.state.history.run("invalid draft",m=>{m.brushes[0].rect[2]=-1;});1')
            check(not run(a, A + '.compile(true)')['ok'], 'invalid draft compile reports failure')
            check(out.read_bytes() == good_output and a.eval('!!' + A + '.session.state.world'), 'failed compile preserves last valid file and runtime')
            a.eval(A + '.undo();1'); a.step(3)
            current = a.eval('JSON.stringify(' + A + '.map)')
            r = run(a, A + '.ops.createBrush({rect:[0,0,-1,16],bottom:0,top:64})')
            check(not r['ok'] and a.eval('JSON.stringify(' + A + '.map)') == current, 'invalid native edit leaves document unchanged')
            check(a.eval(E + '.state.problemList.some(d=>d.code.startsWith("SDK_WORLD_EDIT"))'), 'native rejection is visible in Editor Problems')
            r = run(a, A + '.ops.applyInspector("brush",{rect:"0,0,-1,16"})')
            check(not r['ok'] and a.eval(A + '.navigateDiagnostic(hammerResult.diagnostics[0])'), 'native diagnostic locates its brush by object id')
            check(run(a, A + '.save()') and not snap(a)['dirty'], 'Save writes canonical map and clears dirty')
            check((project / 'a.re2dmap').read_bytes() == original, 'saving B leaves A on disk untouched')
            pipeline = run(a, A + '.buildAndRun()')
            check(pipeline['ok'] and pipeline['stage']=='run' and a.eval(E + '.state.run.running'), 'shared save/validate/compile/run pipeline launches the project')
            a.eval(E + '.stop();1'); a.step(3)
            # Compile both maps and switch tabs; a hidden tab must hide its runtime sprite.
            check(run(a, 'hammerA.compile(true)')['ok'], 'inactive map can compile without showing preview')
            check(a.eval('hammerA.session.state.node.attr("id")!==hammerB.session.state.node.attr("id")'), 'preview node identities are per-session')
            check(a.eval('!hammerA.session.state.node.isVisible()'), 'inactive preview stays hidden after async compile')
            a.eval(E + ".openFile('a.re2dmap');1"); a.step(8)
            check(a.eval('hammerA.active && !hammerB.active && !hammerB.session.state.node.isVisible()'), 'tab switch hides the previous runtime preview')
            # One real mouse drag creates one undoable native brush.
            a.eval('hammerA.setTool("block");hammerA.doc.setValue("we-height","64");1')
            rect = a.eval('hammerA.doc.rect("we-vp-top")')
            k = a.eval('$.window.pixels().w/$.window.size().w')
            x, y = (rect['x'] + rect['w'] * .2) / k, (rect['y'] + rect['h'] * .3) / k
            n = snap(a)['map']['brushes']
            a.mouse_move(x=x, y=y); a.step(2); a.mouse(action='down'); a.step(2)
            a.mouse_move(x=x+40/k, y=y+30/k); a.step(2); a.mouse(action='up')
            settle(a, '!hammerA.session.state.busy')
            check(snap(a)['map']['brushes'] == n + 1, 'real viewport drag creates a native brush')
            check(a.eval('hammerA.undo() && hammerA.map.brushes.length===' + str(n)), 'viewport drag is one undo step')
            # Dirty close is guarded by the Editor and second close releases only that tab.
            a.eval(E + '.closeTab("a.re2dmap");1'); a.step(2)
            check(a.eval(E + '.state.tabs.filter(t=>t.kind==="studio").length===2'), 'first close preserves a dirty tab')
            a.eval(E + '.closeTab("a.re2dmap");1'); a.step(5)
            check(a.eval(E + '.state.tabs.filter(t=>t.kind==="studio").length===1 && hammerB.active && hammerA.session.state.node===null'), 'confirmed close disposes only its own preview')
            # Capture one useful state for layout review, not a sequence of screenshots.
            capture = Path(ROOT) / 'build/editor-hammer-tabs.png'
            a.screenshot(str(capture))
            check(not a.eval(E + '.state.tabs.some(t=>!!t.error)'), 'Editor reports no tab loading errors')
    print('\nASSERTION_FAILURES:', len(failures))
    return bool(failures)


def main():
    # Editor recents are user state, never leave temporary fixtures there.
    state = Path(ROOT) / 'state.local.json'
    previous = state.read_bytes() if state.exists() else None
    try:
        return run_test()
    finally:
        if previous is None:
            state.unlink(missing_ok=True)
        else:
            state.write_bytes(previous)


if __name__ == '__main__':
    raise SystemExit(main())
