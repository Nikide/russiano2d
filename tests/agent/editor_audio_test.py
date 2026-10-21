#!/usr/bin/env python3
"""Editor Audio studio: runtime mixer (gain with mute/solo), rename/remove buses, real playback, zone drag, validated Save."""
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
        print('editor_audio_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def drag(a, frm, to):
    a.mouse_move(x=frm['x'], y=frm['y']); a.step(1); a.mouse(1, 'down'); a.step(1)
    for i in range(1, 5):
        a.mouse_move(x=frm['x'] + (to['x'] - frm['x']) * i / 4, y=frm['y'] + (to['y'] - frm['y']) * i / 4); a.step(1)
    a.mouse(1, 'up'); a.step(2)


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-audio-') as tmp:
        root = Path(tmp)
        (root / 'sfx').mkdir()
        (root / 'project.json').write_text('{"title":"Audio","width":1440,"height":900}')
        (root / 'main.js').write_text('$.ready(() => {});')
        shutil.copyfile(Path(ROOT) / 'demos/re2d_dust2/annex/bubble.wav', root / 'sfx/bubble.wav')
        data = {'version': 1, 'buses': {'music': {'volume': 0.6, 'effect': 'echo', 'effectParams': {'delay': 120, 'feedback': 0.4, 'preserved': 7}}, 'sfx': {'volume': 1}, 'ui': {'parent': 'sfx', 'volume': 0.5}},
                'sounds': {'pop': {'path': 'sfx/bubble.wav', 'bus': 'ui', 'loop': True}},
                'zones': [{'name': 'hall', 'rect': [0, 0, 600, 300], 'height': 6, 'material': 'concrete'}]}
        path = root / 'mix.audio.json'
        path.write_text(json.dumps(data))
        original = path.read_bytes()
        with Agent(game='editor', scene=tmp, seed=9) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.openFile("mix.audio.json");1')
            settle(a, '!!' + A + ' && ' + A + '.ops.files()!==null')
            a.step(3)
            check(a.eval(E + '.activeTab().studio.id==="audio" && ' + E + '.studios.studioById("audio-tools").id==="audio"'), 'opens in native Audio studio; old id is an alias')
            check(a.eval(A + '.snapshot().runtimeBuses') == 3 and abs(a.eval(A + '.ops.gain("ui")') - 0.5) < 1e-6, 'runtime buses created; ui gain = sfx × ui')
            check(a.eval(A + '.ops.files()') == ['sfx/bubble.wav'], 'project audio files via r2d assets')

            # Mixer strip buttons: mute and volume are undoable edits reflected in runtime gain.
            a.eval(A + '.ops.action("mute:sfx");1'); a.step(2)
            check(a.eval(A + '.ops.gain("ui")') == 0, 'muting a parent silences its child (runtime gain)')
            check(a.eval(A + '.undo()'), 'mute undo')
            a.step(1)
            check(abs(a.eval(A + '.ops.gain("ui")') - 0.5) < 1e-6, 'runtime gain restored after undo')
            a.eval(A + '.ops.action("vol:+:music");1'); a.step(1)
            check(abs(a.eval(A + '.state.data.buses.music.volume') - 0.65) < 1e-9, 'strip + raises volume by 0.05')

            check(a.eval(A + '.doc.value("f-effectParams-delay")') == '120' and
                  a.eval(A + '.doc.value("f-effectParams-feedback")') == '0.4',
                  'selected echo bus exposes typed parameter fields')
            a.eval(A + '.doc.setValue("f-effectParams-delay","320");' + A + '.doc.click("aw-apply");1'); a.step(2)
            check(a.eval(A + '.state.data.buses.music.effectParams.delay') == 320 and
                  a.eval(A + '.state.data.buses.music.effectParams.preserved') == 7,
                  'effect field edit merges known params and preserves unknown runtime data')
            check(a.eval(A + '.undo()') and a.eval(A + '.state.data.buses.music.effectParams.delay') == 120,
                  'effect parameter edit is one undoable document operation')
            check(a.eval(A + '.redo()') and a.eval(A + '.state.data.buses.music.effectParams.delay') == 320,
                  'effect parameter redo restores the same authored value')
            a.eval(A + '.doc.setValue("f-effectParams-feedback","1");' + A + '.doc.click("aw-apply");1'); a.step(2)
            check(a.eval(A + '.state.data.buses.music.effectParams.feedback') == 0.4 and
                  a.eval(A + '.diagnostics()[0].code === "EDITOR_ASSET_FIELD"'),
                  'out-of-range feedback is rejected without changing the bus')

            # Real playback through the file's bus.
            check(a.eval(A + '.ops.play("pop")') and a.eval(A + '.ops.playing()') == ['pop'], 'sound plays through the runtime')

            # Rename sfx → fx: children parents and sound buses follow.
            a.eval(A + '.ops.selectEntry("bus","sfx");1'); a.step(1)
            a.eval(A + '.doc.setValue("f-__name","fx");' + A + '.doc.click("aw-apply");1'); a.step(2)
            b = a.eval(A + '.state.data.buses')
            check('fx' in b and 'sfx' not in b and b['ui']['parent'] == 'fx', 'bus rename rewrites children parents')
            a.step(1)
            check(a.eval(A + '.ops.selectEntry("bus","ui").type') == 'bus' and abs(a.eval(A + '.ops.gain("ui")') - 0.5) < 1e-6, 'runtime rebuilt after rename')

            # Remove a parent bus: child reparented to its grandparent, sounds keep a valid bus.
            a.eval(A + '.ops.selectEntry("bus","fx");' + A + '.ops.action("del");1'); a.step(2)
            b = a.eval(A + '.state.data.buses')
            check('fx' not in b and 'parent' not in b['ui'], 'removing a bus reparents its children to master')

            # Zone: drag body moves, corner resizes; each drag = one undo.
            a.eval(A + '.ops.selectEntry("zone",0);1'); a.step(2)
            p0, p1 = a.eval(A + '.ops.zonePoint(300,150)'), a.eval(A + '.ops.zonePoint(400,200)')
            drag(a, p0, p1)
            z = a.eval(A + '.state.data.zones[0].rect')
            check(abs(z[0] - 100) <= 1 and abs(z[1] - 50) <= 1 and z[2] == 600, 'zone drag moves rect by world delta')
            check(a.eval(A + '.undo()') and a.eval(A + '.state.data.zones[0].rect') == [0, 0, 600, 300], 'zone drag is one undo')
            c0, c1 = a.eval(A + '.ops.zonePoint(600,300)'), a.eval(A + '.ops.zonePoint(500,250)')
            drag(a, c0, c1)
            z = a.eval(A + '.state.data.zones[0].rect')
            check(z[0] == 0 and abs(z[2] - 500) <= 2 and abs(z[3] - 250) <= 2, 'corner handle resizes the zone')

            # Library file → new sound.
            a.eval(A + '.ops.action("file:sfx/bubble.wav");1'); a.step(1)
            check(a.eval(A + '.state.data.sounds.bubble.path') == 'sfx/bubble.wav', 'library click adds a sound named after the file')

            check(path.read_bytes() == original, 'nothing is written before Save')
            check(run(a, A + '.save()') is True and not a.eval(A + '.dirty()'), 'Save validates and writes')
            saved = json.loads(path.read_text())
            check('fx' not in saved['buses'] and 'bubble' in saved['sounds'], 'saved file has the edits')

            a.eval(E + '.closeTab("mix.audio.json");1'); a.step(2)
            check(a.eval('$.audio.buses().filter(b=>String(b.name).startsWith("__editor_au")).length') == 0, 'closing the tab removes preview buses')


if __name__ == '__main__':
    sys.exit(main())
