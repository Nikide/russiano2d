#!/usr/bin/env python3
"""SpriteMesh tabs share the native bake/runtime, with independent settings/history."""
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from agent_client import Agent, ROOT
from editor_hammer_test import settle, run
from sdk_sprite_mesh_test import png
E = '$.editorApp'
A = E + '.activeTab().inst'
checks = 0

def check(value, text):
    global checks
    checks += 1
    print(('  ok   ' if value else '  FAIL ') + text, flush=True)
    if not value:
        raise AssertionError(text)

def main():
    recents = Path(ROOT) / 'state.local.json'
    previous = recents.read_bytes() if recents.exists() else None
    try:
        return test()
    finally:
        if previous is None: recents.unlink(missing_ok=True)
        else: recents.write_bytes(previous)

def test():
    with tempfile.TemporaryDirectory(prefix='r2d-mesh-tabs-') as tmp:
        root = Path(tmp)
        (root/'project.json').write_text('{"title":"SpriteMesh tabs","width":1440,"height":900}')
        (root/'main.js').write_text('$.ready(()=>{});')
        png(str(root/'sheet.png'), [(255,80,120,255), (40,180,255,255)])
        atlas = {'frames':[{'filename':name,'frame':{'x':i,'y':0,'w':1,'h':1},'duration':100} for i,name in enumerate(['a','b'])],
                 'meta':{'image':'sheet.png','frameTags':[{'name':'idle','from':0,'to':1}]}, 're2d':{'spriteMesh':{'enabled':True,'depth':0.08,'alphaThreshold':16,'unitsPerPixel':0.03125}}, 'custom':{'keep':True}}
        source = json.dumps(atlas, indent=4)+'\n'
        for name in ['a','b']: (root/(name+'.atlas.json')).write_text(source)
        bare=dict(atlas);bare.pop('re2d');(root/'new.atlas.json').write_text(json.dumps(bare))
        ap = root/'a.atlas.json'
        with Agent(game='editor', scene=tmp, seed=9) as a:
            settle(a, E+'.state.project!==null && '+E+'.state.busy===0')
            run(a, E+'.openWith("a.atlas.json","sprite-mesh-studio")')
            settle(a, '!!'+A+' && !'+A+'.state.busy')
            a.eval('globalThis.meshA='+A+';1')
            check(a.eval(E+'.activeTab().studio.native && '+E+'.activeTab().studio.id==="sprite-mesh"'), 'old id resolves to native SpriteMesh tab')
            check(a.eval('!meshA.dirty() && meshA.snapshot().cacheStale && meshA.snapshot().cache.frames===2'), 'opening missing cache generates clean temporary preview of all frames')
            check(ap.read_text()==source and not (root/'a.atlas.json.sprite-mesh.cache').exists(), 'opening preview writes neither source nor persistent cache')
            check(not list(root.glob('*preview*')), 'temporary bake files removed after preview')
            check(a.eval('meshA.selectAnimation("idle");meshA.play();meshA.state.playing'), 'authored frame tag plays')
            run(a, E+'.openWith("b.atlas.json","sprite-mesh")')
            settle(a, '!!'+A+' && !'+A+'.state.busy')
            a.eval('globalThis.meshB='+A+';1')
            check(a.eval('meshA.doc.id!==meshB.doc.id && !meshA.state.active && meshB.state.active'), 'two SpriteMesh tabs own separate documents and active state')
            before = a.eval('meshA.state.elapsed'); a.step(15)
            check(a.eval('meshA.state.elapsed')==before, 'inactive animation does not advance')
            a.eval('meshB.doc.setValue("sm-depth","0.2");1')
            check(run(a,'meshB.ops.applySettings()'), 'Apply bakes current tab settings without saving')
            check(a.eval('meshB.dirty() && !meshA.dirty() && meshA.state.settings.depth===0.08'), 'settings and dirty state isolated per tab')
            check(a.eval('meshB.undo() && !meshB.dirty() && meshB.snapshot().previewStale'), 'undo returns to saved settings and marks preview stale')
            check(a.eval('meshB.redo() && meshB.dirty()'), 'redo restores settings')
            a.hold(['Left Ctrl']);a.tap('Z');a.step(2);a.release_all();a.step(2)
            check(a.eval('!meshB.dirty()'), 'Editor keyboard undo applies once to active SpriteMesh tab')
            a.hold(['Left Ctrl']);a.tap('Y');a.step(2);a.release_all();a.step(2)
            check(a.eval('meshB.dirty() && !meshA.dirty()'), 'Editor keyboard redo leaves inactive tab unchanged')
            check(run(a,'meshB.save()') and a.eval('!meshB.dirty() && !meshB.snapshot().cacheStale'), 'Save writes settings and persistent native cache')
            check(json.loads((root/'b.atlas.json').read_text())['custom']['keep'], 'saving preserves unrelated atlas fields')
            check(ap.read_text()==source, 'saving B leaves A unchanged')
            check(run(a,'meshA.save()') and ap.read_text()==source, 'untouched Save bakes cache without reformatting source')
            cache = (root/'a.atlas.json.sprite-mesh.cache').read_bytes()
            # Invalid authoring fields fail before any native operation.
            a.eval('meshA.doc.setValue("sm-depth","");1')
            check(not run(a,'meshA.ops.applySettings()') and a.eval('meshA.diagnostics()[0].code==="SDK_SPRITEMESH_SETTINGS"'), 'empty numeric input produces stable diagnostic')
            a.eval('meshA.doc.setValue("sm-depth","0.3");1')
            check(run(a,'meshA.ops.applySettings()'), 'dirty settings receive preview')
            # Corrupt a source frame after open. Native bake must reject before source write.
            bad = dict(atlas); bad['frames']=[{'filename':'bad','frame':{'x':500,'y':0,'w':1,'h':1}}]
            ap.write_text(json.dumps(bad))
            check(not run(a,'meshA.save()') and json.loads(ap.read_text())==bad, 'external source conflict preserves disk data')
            ap.write_text(source)
            image=(root/'sheet.png').read_bytes();(root/'sheet.png').write_bytes(b'broken')
            check(not run(a,'meshA.save()') and ap.read_text()==source, 'native image failure preserves atlas settings')
            check((root/'a.atlas.json.sprite-mesh.cache').read_bytes()==cache, 'failed bake preserves last good persistent cache')
            check(a.eval('meshA.diagnostics()[0].code.startsWith("SDK_SPRITEMESH_")'), 'native diagnostic code preserved')
            check(a.eval(E+'.state.problemList.some(d=>d.code.startsWith("SDK_SPRITEMESH_"))'), 'native bake diagnostic reaches Editor Problems')
            (root/'sheet.png').write_bytes(image)
            check(run(a,'meshA.save()'), 'save recovers after fixing source')
            saved=ap.read_bytes()
            a.eval('meshA.doc.setValue("sm-depth","0.4");1')
            check(run(a,'meshA.ops.applySettings()'), 'new settings are previewed before rollback scenario')
            cp=root/'a.atlas.json.sprite-mesh.cache'
            previous_cache=cp.read_bytes();cp.unlink();cp.mkdir();(cp/'block').write_text('blocked')
            check(not run(a,'meshA.save()') and ap.read_bytes()==saved and a.eval('meshA.dirty()'), 'persistent cache write failure rolls back source and retains dirty settings')
            (cp/'block').unlink();cp.rmdir();cp.write_bytes(previous_cache)
            check(run(a,'meshA.save()'), 'Save succeeds after cache destination is repaired')
            a.eval('meshA.doc.setValue("sm-px","0");meshA.doc.setValue("sm-py","0");1')
            check(run(a,'meshA.ops.applySettings()') and a.eval('meshA.state.pivotOverride'), 'manual zero pivot is recorded')
            a.eval('meshA.doc.click("sm-pivot-auto");1');settle(a,'!meshA.state.busy')
            check(a.eval('!meshA.state.pivotOverride && meshA.state.settings.pivotX===0'), 'per-frame pivot button clears manual override')
            check(run(a,'meshA.save()'), 'automatic frame pivot is saved')

            # Return A to screen and verify front/wireframe layout through actual update.
            run(a,E+'.openWith("a.atlas.json","sprite-mesh")')
            a.eval('meshA.pause();meshA.doc.click("sm-front");meshA.doc.setValue("sm-preview-mode","wireframe");1');a.step(4)
            check(a.eval('meshA.state.camera.yaw===0 && meshA.state.camera.pitch===0 && meshA.doc.layoutRect("sm-view").w>0'), 'front view and embedded viewport are usable')
            a.screenshot(str(Path(ROOT)/'build/editor-sprite-mesh-tabs.png'))
            run(a,E+'.openWith("new.atlas.json","sprite-mesh")')
            check(run(a,A+'.save()') and json.loads((root/'new.atlas.json').read_text())['re2d']['spriteMesh']['enabled'], 'first Save + Bake enables SpriteMesh on an unconfigured atlas')
            # Native PNG remains an alternate studio, with clean default settings.
            run(a,E+'.openWith("sheet.png","sprite-mesh")')
            check(a.eval(A+'.snapshot().frames===1 && !'+A+'.dirty() && '+A+'.state.settings.depth===0.08'), 'PNG opens independently with default settings')
            # Async close: pending bake cleans scratch and cannot publish a cache.
            a.eval('globalThis.meshP='+A+';globalThis.meshPending=meshP.ops.preview();'+E+'.closeTab("sheet.png");1')
            settle(a,'!meshP.state.busy')
            check(not list(root.glob('*preview*')) and not (root/'sheet.png.sprite-mesh.cache').exists(), 'closing pending preview removes scratch without persisting cache')
            check(a.eval('meshA.state.cache!==null && meshB.state.cache!==null'), 'closing another tab retains existing caches')
    print('All', checks, 'SpriteMesh Studio checks passed.')
    return 0

if __name__=='__main__': raise SystemExit(main())
