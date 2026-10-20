#!/usr/bin/env python3
"""Editor RmlUi studio: live RmlUi draft preview, tree ops with undo, pick in preview, linked RCSS, safe Save + validate, drafts cleaned."""
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from agent_client import Agent, ROOT
from editor_hammer_test import settle, run

E = '$.editorApp'
A = E + '.activeTab().inst'
checks = 0

RML = '''<rml>
<head>
    <link type="text/rcss" href="hud.rcss"/>
    <title>HUD</title>
</head>
<body>
<div id="panel" class="panel">
    <h1 id="title">Score</h1>
    <button id="go" class="btn">Go</button>
</div>
</body>
</rml>
'''
RCSS = 'body { font-family: Open Sans; }\n.panel { display: block; width: 300px; height: 200px; background-color: #334455; }\n#title { display: block; height: 40px; }\n.btn { display: block; width: 120px; height: 40px; }\n'


def check(value, message):
    global checks
    checks += 1
    print(('  ok   ' if value else '  FAIL ') + message, flush=True)
    if not value:
        raise AssertionError(message)


def main():
    recents = Path(ROOT) / 'state.local.json'
    previous = recents.read_bytes() if recents.exists() else None
    try:
        test()
        print('editor_rmlui_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def drafts(root):
    return sorted(p.name for p in root.rglob('.r2d-*'))


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-rmlui-') as tmp:
        root = Path(tmp)
        (root / 'project.json').write_text('{"title":"Rml","width":1440,"height":900}')
        (root / 'main.js').write_text('$.ready(() => {});')
        (root / 'hud.rml').write_text(RML)
        (root / 'hud.rcss').write_text(RCSS)
        (root / 'lone.rcss').write_text('.x { color: #fff; }\n')
        with Agent(game='editor', scene=tmp, seed=11) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.openFile("hud.rml");1')
            settle(a, '!!' + A + ' && ' + A + '.snapshot().preview')
            a.step(3)
            snap = a.eval(A + '.snapshot()')
            check(a.eval(E + '.activeTab().studio.id==="rmlui" && ' + E + '.studios.studioById("rmlui-studio").id==="rmlui"'), 'opens in native RmlUi studio; old id is an alias')
            check(snap['selected'] == 'body' and len(snap['sheets']) == 1 and snap['sheets'][0].endswith('hud.rcss'), 'body selected, linked stylesheet loaded')
            check(len(drafts(root)) == 2, 'preview runs from draft rml + draft rcss')

            # Pick: click the real button geometry in the preview.
            r = a.eval('(()=>{const p=' + A + '.state.preview,k=$.window.pixels().w/$.window.size().w,r=p.layoutRect("go");return {x:(r.x+r.w/2)/k,y:(r.y+r.h/2)/k};})()')
            a.mouse_move(x=r['x'], y=r['y']); a.step(1); a.mouse(1, 'click'); a.step(2)
            check(a.eval(A + '.snapshot().selected') == 'button#go.btn', 'click in preview selects the element under the cursor')

            # Tree ops, each one undo step; preview rebuilds from the draft.
            sel = a.eval(A + '.state.sel')
            check(a.eval(A + '.ops.setText(' + str(sel) + ', "Start")') and '>Start</button>' in a.eval(A + '.state.model.rml'), 'setText edits only the inner text')
            a.step(2)
            check(a.eval(A + '.state.preview.layoutRect("go").w') > 0, 'preview rebuilt after edit')
            check(a.eval(A + '.ops.move(' + str(sel) + ', -1)') and a.eval(A + '.snapshot().selected') == 'button#go.btn'
                  and a.eval(A + '.state.model.rml').index('id="go"') < a.eval(A + '.state.model.rml').index('id="title"'), 'move up swaps siblings and keeps selection')
            check(a.eval(A + '.undo()') and a.eval(A + '.state.model.rml').index('id="title"') < a.eval(A + '.state.model.rml').index('id="go"'), 'undo restores order')
            check(not a.eval(A + '.ops.remove(0)') and a.eval(A + '.snapshot().problems') >= 1, 'root sections cannot be removed (diagnostic)')
            check(a.eval(A + '.ops.setSheet(0, ' + json.dumps(RCSS + '.btn { color: #ff0000; }\n') + ')') and a.eval(A + '.dirty()'), 'RCSS edit marks the tab dirty')

            # Broken markup: preview keeps the last good version, Save is blocked.
            a.eval(A + '.ops.setSource(' + json.dumps(RML.replace('</div>', '')) + ');1'); a.step(2)
            check(a.eval(A + '.snapshot().problems') >= 1, 'broken markup reported live')
            check(run(a, A + '.save()') is False and (root / 'hud.rml').read_text() == RML, 'Save blocked while markup is broken')
            a.eval(A + '.undo();1'); a.step(2)

            check(run(a, A + '.save()') is True, 'Save writes and validates')
            check('>Start</button>' in (root / 'hud.rml').read_text() and '#ff0000' in (root / 'hud.rcss').read_text(), 'document and stylesheet written')
            check(not a.eval(A + '.dirty()'), 'clean after Save')

            # A lone .rcss opens with a sample document that is never saved.
            a.eval(E + '.openFile("lone.rcss");1')
            settle(a, E + '.activeTab().path==="lone.rcss" && !!' + A + ' && ' + A + '.snapshot().preview')
            check(a.eval(A + '.snapshot().virtual') and a.eval(A + '.ops.setSheet(0, ".x { color: #000; }\\n")'), 'lone stylesheet edits over a sample document')
            check(run(a, A + '.save()') is True and not (root / 'lone.rml').exists() and '#000' in (root / 'lone.rcss').read_text(), 'Save writes only the stylesheet')

            a.eval(E + '.closeTab("lone.rcss");1'); a.eval(E + '.closeTab("hud.rml");1'); a.step(3)
            check(drafts(root) == [], 'closing tabs removes preview drafts')


if __name__ == '__main__':
    sys.exit(main())
