#!/usr/bin/env python3
"""Quick Open and Command Palette: keyboard entry, filtering, and actions."""
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent
from editor_hammer_test import settle

E = '$.editorApp'
D = '$.ui.doc("ui/editor.rml")'
checks = 0


def check(agent, expression, label):
    global checks
    ok = agent.eval(expression)
    checks += 1
    print(('  ok   ' if ok else '  FAIL ') + label, flush=True)
    if not ok:
        raise AssertionError(label)


def open_palette(agent, shift=False):
    keys = ['Left Ctrl', 'Left Shift'] if shift else ['Left Ctrl']
    agent.hold(keys)
    agent.tap('P')
    agent.step(2)
    agent.release_all()
    agent.step(2)


def _run():
    with tempfile.TemporaryDirectory(prefix='r2d-palette-') as directory:
        project = Path(directory)
        (project / 'project.json').write_text(json.dumps({
            'format': 2, 'title': 'Palette fixture', 'entry': 'main.js',
        }))
        (project / 'main.js').write_text('$.ready(() => {});\n')
        (project / 'other.js').write_text(
            '// function hidden() {}\nconst label = "class fake {}";\n'
            'function startGame() {\n  const player = {};\n}\nclass WorldState {}\n')
        with Agent(game='editor', scene=str(project), seed=8) as agent:
            settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
            check(agent, E + '.state.entries.some(e=>e.path==="other.js")',
                  'fixture file is indexed for Quick Open')

            open_palette(agent)
            check(agent, E + '.state.palette && ' + E + '.state.palette.mode==="files"',
                  'Ctrl+P opens Quick Open')
            agent.eval(D + '.setValue("palette-input","other.js");1')
            agent.step(3)
            check(agent, E + '.state.palette.list.some(x=>x.item.path==="other.js")',
                  'Quick Open filters project files by name')
            agent.tap('Return')
            agent.step(4)
            check(agent, E + '.activeTab().path==="other.js" && ' + E + '.state.palette===null',
                  'Quick Open opens the selected file and closes the palette')
            open_palette(agent)
            agent.eval(D + '.setValue("palette-input","other.js");1')
            agent.step(2)
            agent.tap('Return')
            agent.step(3)
            check(agent, E + '.state.tabs.filter(t=>t.path==="other.js").length===1',
                  'opening a file already in a tab does not create a duplicate')

            open_palette(agent, shift=True)
            check(agent, E + '.state.palette && ' + E + '.state.palette.mode==="commands"',
                  'Ctrl+Shift+P opens the Command Palette')
            agent.eval(D + '.setValue("palette-input",">Вид: боковая панель");1')
            agent.step(3)
            check(agent, E + '.state.palette.list.some(x=>x.item.cmd && x.item.label==="Вид: боковая панель")',
                  'Command Palette fuzzy-filters Editor commands')
            agent.tap('Return')
            agent.step(3)
            check(agent, E + '.state.sidebarHidden===true && ' + E + '.state.palette===null',
                  'Command Palette executes the selected Editor command')
            open_palette(agent, shift=True)
            agent.eval(D + '.setValue("palette-input",">Вид: боковая панель");1')
            agent.step(3)
            agent.tap('Return')
            agent.step(3)
            check(agent, E + '.state.sidebarHidden===false',
                  'Command Palette command can restore the layout')
            agent.eval(E + '.activeTab().model.setText(' + json.dumps(
                '// function hidden() {}\nconst label = "class fake {}";\n'
                'function startGame() {\n  const player = {};\n}\nclass WorldState {}\n') + ');1')
            agent.hold(['Left Ctrl', 'Left Shift'])
            agent.tap('O')
            agent.step(2)
            agent.release_all()
            agent.step(2)
            check(agent, E + '.state.palette && ' + E + '.state.palette.mode==="symbols"',
                  'Ctrl+Shift+O opens the current JavaScript document outline')
            check(agent, E + '.state.palette.items.map(x=>x.symbol.name).join(",")==="label,startGame,player,WorldState"',
                  'outline ignores comments and strings while listing simple declarations')
            agent.eval(D + '.setValue("palette-input","player");1')
            agent.step(2)
            check(agent, E + '.state.palette.list.length===1 && ' + E + '.state.palette.list[0].item.symbol.name==="player"',
                  'symbol filter narrows the outline to the declaration')
            rect = agent.eval(D + '.rect("palette-list")')
            agent.mouse_move(x=rect['x'] + 40, y=rect['y'] + 10)
            agent.step(2)
            agent.mouse(button=1, action='click')
            agent.step(2)
            check(agent, E + '.state.palette===null && ' + E + '.activeTab().model.caret.line===3 && ' +
                  ' ' + E + '.activeTab().model.caret.col===8',
                  'choosing a symbol reveals its declaration location')
            agent.hold(['Left Shift'])
            agent.tap('F12')
            agent.step(2)
            agent.release_all()
            agent.step(2)
            check(agent, E + '.state.side==="search" && ' + E + '.state.searchQuery==="player" && ' +
                  E + '.state.searchResults.some(r=>r.path==="other.js" && r.line===4)',
                  'Shift+F12 searches the current word as project text matches')
    print(f'editor_palette_test: {checks} checks', flush=True)
    return 0


def main():
    state = ROOT / 'state.local.json'
    previous = state.read_bytes() if state.exists() else None
    try:
        return _run()
    finally:
        if previous is None:
            state.unlink(missing_ok=True)
        else:
            state.write_bytes(previous)


if __name__ == '__main__':
    raise SystemExit(main())
