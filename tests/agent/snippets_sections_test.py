#!/usr/bin/env python3
"""Functional assertions across catalogue sections; real generated JS and runtime.

Complements combat/mechanics/genre suites. Checks observable results, rejected
operations, respawn and scene disposal, including global event subscriptions.
"""
import json
import os
from pathlib import Path
import sys
import socket
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent
from snippets_mechanics_test import r2d

os.environ.setdefault('R2D_BINARY', str(ROOT / 'build-xmake/macos-arm64/macosx/arm64/release/r2d'))

PLAN = [
    ('actor.identity', 'identity', {'name': 'Проверка', 'description': 'Описание'}),
    ('movement.top-down', 'move', {'speed': 120}),
    ('health.regeneration', 'regen', {'rate': 60, 'delay': 100}),
    ('ai.chase', 'chase', {'target': '#hero', 'speed': 60, 'radius': 500}),
    ('npc.relationship', 'relation', {}),
    ('interact.door', 'door', {}),
    ('inventory.grid', 'bag', {'start': ['coin=2']}),
    ('economy.wallet', 'wallet', {'start': 20, 'max': 30}),
    ('progression.xp', 'xp', {'thresholds': ['10', '20']}),
    ('ability.cooldown', 'cooldown', {'id': 'blink', 'cooldown': 100}),
    ('quest.definition', 'quest', {'id': 'test', 'autoAccept': True, 'objectives': ['Нажать=1']}),
    ('quest.objective-interact', 'objective', {'quest': 'test'}),
    ('story.counter', 'counter', {}),
    ('puzzle.sequence-lock', 'puzzle', {'solution': ['rune:a', 'rune:b']}),
    ('world.secret-area', 'secret', {}),
    ('render.fade', 'fade', {'ms': 100}),
    ('animation.idle-run', 'anim', {'idle': '0-0@6', 'run': '0-0@6'}),
    ('feedback.combo-popup', 'combo', {'window': 100}),
    ('ui.health-bar', 'hud', {'who': '#regen'}),
    ('save.story-state', 'save', {'key': 'test-story'}),
    ('settings.audio', 'settings', {}),
    ('net.ready-check', 'ready', {'minPlayers': 1}),
    ('net.replicate-health', 'replica', {}),
]


def main():
    with tempfile.TemporaryDirectory(prefix='r2d-snip-sections-') as tmp:
        root = Path(tmp)
        (root / 'main.js').write_text("""$.scene.add('first', () => {
    $.world.gravity(0, 0);
    $.items.define({id:'coin', title:'Монета', stack:99});
    $('<hero>', {id:'hero'}).at(100,100).size(16,16).appendTo($.world);
""" + '\n'.join("    $('<thing>', {id:%s}).at(%d,100).size(16,16).body('dynamic').health(100).appendTo($.world);" % (json.dumps(owner), 120 if owner in ('door', 'secret') else 200) for _, owner, _ in PLAN) + """
});
$.scene.add('empty', () => {});
$.ready(() => $.scene.load('first', {transition:'none'}));
""")
        (root / 'project.json').write_text(json.dumps({'schema_version': 2, 'project': {'name': 'Sections', 'version': '1.0.0'}, 'runtime': {'entry': 'main.js', 'window': {'width': 960, 'height': 640}}}))
        assert r2d('project-index', tmp, '--write')['ok']
        for package, owner, values in PLAN:
            res = r2d('snippet', 'add', tmp, package, '--owner', 'object:' + owner)
            assert res['ok'], (package, res)
            if values:
                res = r2d('snippet', 'set', tmp, 'snippet:' + owner + ':' + package, *[k + '=' + json.dumps(v, ensure_ascii=False) for k, v in values.items()])
                assert res['ok'], (package, res)
        assert r2d('snippet', 'generate', tmp, '--write')['ok']
        assert r2d('validate', tmp)['ok']
        with Agent(game=tmp, seed=4) as a:
            a.step(8)
            def eq(code, expected, label):
                actual = a.eval(code)
                assert actual == expected, (label, actual, expected)
                print('  ok  ' + label, flush=True)
            def ev(code):
                return a.eval(code + "; 'ok'")
            eq("$('#identity').data('identity').name", 'Проверка', 'A: identity stored')
            a.hold(['D']); a.step(5); a.release_all()
            eq("Math.round($('#move').velocity().x)", 120, 'B: movement responds to input')
            ev("$('#regen').damage(30)"); a.step(3)
            eq("$('#regen').hp()", 70, 'D: regeneration delay')
            a.step(20)
            assert a.eval("$('#regen').hp()") > 70
            ev("$('#relation').emit('relationship',{delta:1000})")
            eq("$('#relation').data('relationship')", 100, 'F: relationship clamps upper limit')
            ev("$('#relation').emit('relationship',{delta:-1000})")
            eq("$('#relation').data('relationship')", -100, 'F: relationship clamps lower limit')
            ev("$('#door').data('locked',true).emit('interact',{by:$('#hero')})")
            eq("!!$('#door').data('open')", False, 'G: locked door rejects interaction')
            ev("$('#door').emit('unlock').emit('interact',{by:$('#hero')})")
            eq("$('#door').data('open')", True, 'G: unlocked door opens')
            # Cache must resolve the replacement hero, not retain removed wrapper.
            ev("$('#hero').remove(); $('<hero>',{id:'hero'}).at(100,100).size(16,16).appendTo($.world)")
            a.step(3); a.tap('E'); a.step(3)
            eq("$('#door').data('open')", False, 'G: cached actor resolves respawn')
            eq("$('#bag').data('inv').count('coin')", 2, 'H: starting inventory')
            ev("$.emit('pickup',{item:'coin',count:3,by:$('#bag')})")
            eq("$('#bag').data('inv').count('coin')", 5, 'H: pickup reaches inventory')
            ev("$('#wallet').emit('money',{delta:-21})")
            eq("$('#wallet').data('money')", 20, 'I: insufficient funds rejected')
            ev("$('#wallet').emit('money',{delta:100})")
            eq("$('#wallet').data('money')", 30, 'I: wallet maximum')
            ev("globalThis.thresholds=[]; $('#xp').on('xp:threshold',e=>thresholds.push(e.data.index)); $('#xp').emit('xp',{amount:25})")
            eq('thresholds', [1, 2], 'J: XP crosses both thresholds in order')
            ev("globalThis.blocked=null; $('#cooldown').on('ability:try',e=>{blocked=e.data.ok}); $('#cooldown').emit('ability:cast',{id:'blink'}).emit('ability:try',{id:'blink',ok:true})")
            eq('blocked', False, 'J: cooldown rejects cast'); a.step(10)
            ev("$('#cooldown').emit('ability:try',{id:'blink',ok:true})")
            eq('blocked', True, 'J: cooldown expires')
            ev("$('#objective').emit('interact')")
            eq("$.quest.isReady('test')", True, 'K: objective completes quest')
            ev("$.emit('helped'); $.emit('helped'); $.emit('lied')")
            eq("$.story.flags.trust", 0, 'L: story counter increments and decrements')
            ev("globalThis.solved=0; $.on('puzzle:solved',()=>solved++); $.emit('rune:b'); $.emit('rune:a')")
            eq('solved', 0, 'M: wrong sequence does not solve')
            ev("$.emit('rune:b'); $.emit('rune:a'); $.emit('rune:b')")
            eq('solved', 1, 'M: correct sequence solves exactly once')
            ev("$('#hero').at(120,100)"); a.step(3)
            eq("$.save.get('secrets')", 1, 'N: secret found once')
            ev("globalThis.fades=0; $.on('fade:done-out',()=>fades++); $.emit('fade:out')"); a.step(10)
            eq('fades', 1, 'O: fade completes')
            ev("$('#anim').velocity(-50,0)"); a.step(2)
            eq("[$('#anim').data('animKey'),$('#anim').flip().x]", ['run', True], 'P: animation chooses run and flips')
            ev("$('#combo').emit('attack').emit('attack')")
            eq("$('#combo').data('combo')", 2, 'Q: combo accumulates'); a.step(10)
            eq("$('#combo').data('combo')", 0, 'Q: combo expires')
            eq("!!$.ui.doc('snippets/ui.health-bar.rml').rect('fill')", True, 'R: real RmlUi health bar exists')
            ev("$.story.set('checkpoint',7); $.emit('save:before'); $.story.set('checkpoint',0); $.emit('loaded')")
            eq('$.story.flags.checkpoint', 7, 'S: story save round trip')
            ev("$.emit('audio:set',{kind:'master',value:2})")
            eq("$.store.get('volume.master')", 1, 'S: audio setting clamps')
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            ev("$.net.host(%d, {maxPeers:2})" % port)
            eq('$.net.isAuthority()', True, 'T: real host authority')
            ev("globalThis.starts=0; $.on('match:start',()=>starts++); $.emit('ready:toggle')")
            eq('starts', 1, 'T: authority starts ready match')
            ev("$('#replica').damage(12)")
            eq("$('#replica').hp()", 88, 'U: offline authority can damage replicated health')
            # Scene removal disposes global subscriptions and reattachment stays singular.
            ev("$.scene.load('empty',{transition:'none'})"); a.step(5)
            before = a.eval('$.story.flags.trust')
            ev("$.emit('helped')")
            eq('$.story.flags.trust', before, 'scene cleanup removes global subscription')
            ev("$.scene.load('first',{transition:'none'})"); a.step(8)
            before = a.eval('$.story.flags.trust')
            ev("$.emit('helped')")
            eq('$.story.flags.trust', before + 1, 'scene reattach installs exactly one subscription')
            eq('$.debug.errors()', [], 'runtime has no errors')
    print('snippets_sections_test: ok')

if __name__ == '__main__':
    main()
