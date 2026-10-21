#!/usr/bin/env python3
"""Real RmlUi focus, text events, Tab, scrolling and resize dogfood."""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent
from editor_hammer_test import settle, run

E = '$.editorApp'
D = "$.ui.doc('ui/editor.rml')"


def main():
    os.environ.setdefault('R2D_BINARY', str(ROOT / 'build-xmake/macos-arm64/macosx/arm64/release/r2d'))
    with tempfile.TemporaryDirectory(prefix='r2d-sn-ux-') as tmp:
        root = Path(tmp)
        shutil.copytree(ROOT / 'tests/fixtures/snippets_basic', root, dirs_exist_ok=True, ignore=shutil.ignore_patterns('generated', '*.bak'))
        pj = json.loads((root / 'project.json').read_text())
        pj.get('editor', {}).pop('snippets', None)
        (root / 'project.json').write_text(json.dumps(pj))
        with Agent(game='editor', scene=tmp, seed=7) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.showSnippets();1')
            settle(a, E + '.snippets.state.loaded && ' + E + '.state.busy===0')
            assert a.eval(D + ".focus('sn-query')"); a.step(5)
            a.cmd('text', text='дви'); a.step(5)
            a.cmd('text', text='жение'); a.step(5)
            value = a.eval(D + ".value('sn-query')")
            assert value == 'движение', ('search lost focus while typing', value)
            assert a.eval(E + '.snippets.state.query') == 'движение'
            content = a.eval(D + ".content('sn-results')")
            assert 'movement.top-down' in content
            assert 'net.host-session' not in content
            print('  ok Russian search preserves focus across consecutive text events', flush=True)
            if '--shots' in sys.argv:
                a.screenshot(str(ROOT / 'docs/snippets/images/acceptance-search.png'))
            # Tab must move to category selector, rather than an editor command.
            a.eval("globalThis.catFocused=false;" + D + ".on('sn-cat','focus',()=>{catFocused=true});1")
            a.tap('Tab'); a.step(4)
            assert a.eval('catFocused'), 'Tab from search must focus category'
            print('  ok Tab order: search → category', flush=True)
            a.eval(D + ".setValue('sn-query','');1")
            run(a, E + ".snippets.changed('sn-query')")
            # Sidebar content must actually scroll on wheel, not clip 500 entries.
            a.eval(D + ".focus('sn-query');1"); a.step(3)
            before = a.eval(D + ".layoutRect('sn-query')")
            side = a.eval(D + ".rect('side-body')")
            a.mouse_move(x=side['x'] + side['w']/2, y=side['y'] + side['h']/2)
            a.wheel(-10); a.step(5)
            after = a.eval(D + ".layoutRect('sn-query')")
            assert after['y'] != before['y'], ('sidebar does not scroll', before, after)
            print('  ok 500-entry catalog scrolls with wheel', flush=True)
            for w, h in [(960, 640), (1440, 900)]:
                a.eval('$.window.resize(%d,%d);1' % (w, h)); a.step(8)
                side = a.eval(D + ".rect('side-body')")
                assert side and side['w'] > 100 and 100 < side['h'] <= h
                assert a.eval(E + '.snippets.state.catalog.length') == 500
            print('  ok sidebar remains available at 960×640 and 1440×900', flush=True)
            a.eval(D + ".focus('sn-query');1"); a.step(5)
            if '--shots' in sys.argv:
                path = ROOT / 'docs/snippets/images/acceptance-catalog-scroll.png'
                a.screenshot(str(path))
            assert not a.eval('$.debug.errors()'), a.eval('$.debug.errors()')
    print('editor_snippets_ux_test: ok')

if __name__ == '__main__':
    main()
