#!/usr/bin/env python3
"""Editor Fonts studio: runtime specimen per style, inheritance like K.resolve, rename keeps children, font files, validated Save."""
import json
from pathlib import Path
import shutil
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from agent_client import Agent, ROOT
from editor_hammer_test import settle, run

E = '$.editorApp'
A = E + '.activeTab().inst'
checks = 0


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
        print('editor_fonts_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-fonts-') as tmp:
        root = Path(tmp)
        (root / 'fonts').mkdir()
        (root / 'project.json').write_text('{"title":"Fonts","width":1440,"height":900}')
        (root / 'main.js').write_text('$.ready(() => {});')
        shutil.copyfile(Path(ROOT) / 'assets/fonts/RobotoMono-Regular.ttf', root / 'fonts/RobotoMono-Regular.ttf')
        data = {'version': 1, 'fonts': [], 'styles': {'default': {'size': 18, 'color': '#e9edf6'}, 'hud': {'size': 20, 'color': '#ffffff'},
                                                      'title': {'base': 'hud', 'size': 40}}}
        path = root / 'ui.fonts.json'
        path.write_text(json.dumps(data))
        original = path.read_bytes()
        with Agent(game='editor', scene=tmp, seed=8) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            had_default = a.eval('JSON.stringify($.font.get("default"))')
            a.eval(E + '.openFile("ui.fonts.json");1')
            settle(a, '!!' + A + ' && ' + A + '.ops.files()!==null')
            a.step(4)
            check(a.eval(E + '.activeTab().studio.id==="fonts" && ' + E + '.studios.studioById("font-tools").id==="fonts"'), 'opens in native Fonts studio; old id is an alias')
            check(a.eval(A + '.snapshot().runtimeStyles') == 3 and a.eval(A + '.state.nodes.length') == 3, 'a runtime <text> per style')
            t = a.eval(A + '.ops.runtimeStyle("title")')
            check(t['size'] == 40 and t['color'] == '#ffffff', 'runtime title inherits color from base hud')
            check(a.eval('JSON.stringify($.font.get("default"))') == had_default, 'global default style is untouched')
            check(a.eval(A + '.ops.files()') == ['fonts/RobotoMono-Regular.ttf'], 'project font files via r2d assets')

            # Click on a specimen line selects its style.
            r = a.eval(A + '.doc.layoutRect("aw-canvas")')
            y = a.eval(A + '.ops.lineY("hud")')
            a.mouse_move(x=r['x'] + 200, y=y + 4); a.step(1); a.mouse(1, 'click'); a.step(2)
            check(a.eval(A + '.state.selected') == 1, 'click on specimen line selects the style')

            # Rename hud → panel: children's base follows, key order preserved.
            a.eval(A + '.doc.setValue("f-__name","panel");' + A + '.doc.click("aw-apply");1'); a.step(3)
            st = a.eval(A + '.state.data.styles')
            check(list(st.keys()) == ['default', 'panel', 'title'] and st['title']['base'] == 'panel', 'rename keeps order and rewrites base of children')
            check(a.eval(A + '.ops.runtimeStyle("title")')['color'] == '#ffffff', 'runtime still inherits after rename')
            check(a.eval(A + '.undo()') and list(a.eval(A + '.state.data.styles').keys())[1] == 'hud', 'rename is one undo step')

            # Font file → declared font; style uses it; width changes with the family.
            a.eval(A + '.ops.action("font:add:fonts/RobotoMono-Regular.ttf");1'); a.step(2)
            check(a.eval(A + '.state.data.fonts') == [{'name': 'RobotoMono-Regular', 'path': 'fonts/RobotoMono-Regular.ttf'}], 'font file added as declared font')
            before = a.eval(A + '.ops.measure("hud")')
            a.eval(A + '.ops.select(1);1'); a.step(1)
            a.eval(A + '.doc.setValue("f-font","RobotoMono-Regular");' + A + '.doc.click("aw-apply");1'); a.step(3)
            check(a.eval(A + '.snapshot().loaded') == 1 and a.eval(A + '.ops.measure("hud")') != before, 'style switched to the loaded family (measured width changed)')
            check(a.eval(A + '.diagnostics().length') == 0, 'no diagnostics')

            # New style, duplicate, delete.
            n = a.eval(A + '.ops.addStyle("caption")')
            check(n == 'caption' and a.eval(A + '.state.data.styles.caption.size') == 20, 'add style')
            check(a.eval(A + '.ops.duplicate()') == 'caption_copy', 'duplicate style')
            a.eval(A + '.ops.action("style:del");1'); a.step(2)
            check('caption_copy' not in a.eval(A + '.state.data.styles'), 'delete style')

            check(path.read_bytes() == original, 'nothing is written before Save')
            check(run(a, A + '.save()') is True and not a.eval(A + '.dirty()'), 'Save validates and writes')
            saved = json.loads(path.read_text())
            check(saved['styles']['hud']['font'] == 'RobotoMono-Regular' and 'caption' in saved['styles'], 'saved file has the edits')
            a.eval(E + '.closeTab("ui.fonts.json");1'); a.step(2)
            check(a.eval('$.font.list().filter(n=>n.startsWith("__editor_ft")).length') == 0, 'closing the tab removes preview styles')


if __name__ == '__main__':
    sys.exit(main())
