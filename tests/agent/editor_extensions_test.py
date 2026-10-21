#!/usr/bin/env python3
"""Project extension discovery and failure isolation inside the current Editor."""
import json
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent
from editor_hammer_test import settle

E = '$.editorApp'
checks = 0


def check(value, label):
    global checks
    checks += 1
    print(('  ok   ' if value else '  FAIL ') + label, flush=True)
    if not value:
        raise AssertionError(label)


def _run():
    with tempfile.TemporaryDirectory(prefix='r2d-editor-extensions-') as temporary:
        project = Path(temporary) / 'project'
        project.mkdir()
        (project / 'project.json').write_text(json.dumps({
            'title': 'Editor extensions', 'entry': 'main.js', 'toolHost': True,
        }))
        (project / 'main.js').write_text('$.ready(() => {});')
        (project / 'map.re2dmap').write_text(json.dumps({
            'version': 1, 'name': 'Extension overlay fixture', 'regionSize': 128,
            'world': {'x': 0, 'y': 0, 'w': 512, 'h': 512, 'bottom': 0, 'top': 128},
            'brushes': [{'id': 'wall.north', 'rect': [0, 0, 128, 32], 'bottom': 0, 'top': 64}],
        }))
        (project / 'sdk_extensions').mkdir()
        shutil.copytree(
            ROOT / 'tests/fixtures/sdk/extensions/project',
            project / 'sdk_extensions/fixture.world-tools',
        )
        broken = project / 'sdk_extensions/author.broken'
        broken.mkdir()
        (broken / 'extension.json').write_text(json.dumps({
            'schema_version': 1, 'id': 'author.broken', 'name': 'Broken fixture',
            'version': '1.0.0', 'sdk_api': 1, 'entry': 'main.js',
            'contributes': {'worldTools': [{'id': 'author.broken.leaked', 'label': 'Must be removed'}]},
        }))
        (broken / 'main.js').write_text('throw new Error("fixture activation failure");')

        with Agent(game='editor', scene=str(project), seed=6) as agent:
            settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0 && ' + E + '.extensions.state.loaded')
            check(
                agent.eval(E + ".extensions.extensions().some(e=>e.id==='fixture.world-tools')"),
                'Editor loads the project extension through native discovery',
            )
            check(
                agent.eval(E + ".extensions.list('worldTools').some(x=>x.id==='fixture.world.bevel')"),
                'declarative World Tool reaches the shared extension registry',
            )
            check(
                agent.eval(E + ".extensions.list('worldTools').some(x=>x.id==='fixture.world.runtime')"),
                'activate() contributions reach the same registry',
            )
            check(
                agent.eval(E + ".state.extensionDiags.some(d=>d.code==='SDK_EXTENSION_INIT_FAILED' && d.extension==='author.broken')"),
                'activation failure is visible in Editor diagnostics',
            )
            check(
                agent.eval(E + ".extensions.extensions().some(e=>e.id==='author.broken' && !e.enabled)"),
                'activation failure marks only the broken extension disabled',
            )
            check(
                not agent.eval(E + ".extensions.list('worldTools').some(x=>x.id==='author.broken.leaked')"),
                'failed activation rolls back its declarative contributions',
            )
            check(
                agent.eval(E + ".extensions.extensions().some(e=>e.id==='fixture.world-tools') && " + E + ".extensions.list('worldTools').length>=2"),
                'one broken extension does not disable healthy contributions',
            )
            check(
                any(d.get('code') == 'SDK_EXTENSION_INIT_FAILED' for d in agent.eval(E + '.state.extensionDiags')),
                'extension failure is retained in Problems state',
            )
            agent.eval(E + ".openFile('map.re2dmap');1")
            settle(agent, E + ".activeTab() && " + E + ".activeTab().kind==='studio'")
            check(
                agent.eval(E + ".activeTab().inst.snapshot().extensions.includes('fixture.world-tools')"),
                'Hammer studio receives the loaded project extension',
            )
            check(
                agent.eval(E + ".activeTab().inst.extensions.worldTools().some(x=>x.id==='fixture.world.bevel')"),
                'Hammer exposes the extension World Tool to its toolbar model',
            )
            overlay_doc = E + ".activeTab().inst.doc"
            agent.eval(E + ".activeTab().inst.render();1")
            agent.step(3)
            overlay_markup = "(() => { const h=" + E + ".activeTab().inst; return h.viewports.buildOverlay(h.viewports.byId('top'), {map:h.map, extensionOverlays:h.extensions.overlays().filter(item=>h.state.extensionOverlays.get(item.id)!==false)}); })()"
            check(
                agent.eval(overlay_doc + ".content('we-ext-overlays').includes('Fixture guides') && " +
                           overlay_doc + ".content('we-overlay-top').includes('Guide point') && " +
                           overlay_doc + ".content('we-overlay-top').includes('Guide line') && " +
                           overlay_doc + ".content('we-overlay-top').includes('Guide volume')"),
                'declarative extension point, line and rect are drawn in the Hammer XY viewport',
            )
            check(
                agent.eval(overlay_markup + ".includes('Fallback color') && !(" + overlay_markup +
                           ".includes('Invalid coordinate')) && " + overlay_markup + ".includes('rgba(255,209,102,0.35)')"),
                'overlay renderer rejects string coordinates and replaces invalid colors safely',
            )
            check(
                agent.eval("(() => { const h=" + E + ".activeTab().inst; return ['front','side'].every(id=>{ const html=h.viewports.buildOverlay(h.viewports.byId(id),{map:h.map,extensionOverlays:h.extensions.overlays()}); return html.includes('Guide point') && html.includes('Guide line') && html.includes('Guide volume'); }); })()"),
                'extension overlay coordinates project into Hammer XZ and YZ viewports',
            )
            agent.eval(overlay_doc + ".click('we-ext-overlay-fixture.overlay.guide');1")
            agent.step(2)
            check(
                not agent.eval(overlay_doc + ".content('we-overlay-top').includes('Guide point')"),
                'extension overlay toggle removes its annotations from the viewport',
            )
            agent.eval(overlay_doc + ".click('we-ext-overlay-fixture.overlay.guide');1")
            agent.step(2)
            check(
                agent.eval(overlay_doc + ".content('we-overlay-top').includes('Guide point')"),
                'extension overlay toggle restores its annotations',
            )
            agent.eval(E + ".activeTab().inst.doc.click('we-ext-tool-fixture.world.runtime');1")
            settle(agent, E + ".activeTab().inst.map.world.x===64")
            check(
                agent.eval(E + ".activeTab().inst.map.world.x===64"),
                'runtime World Tool executes its operation through Hammer session history',
            )
            agent.eval(E + ".activeTab().inst.undo();1")
            check(
                agent.eval(E + ".activeTab().inst.map.world.x===0"),
                'runtime World Tool operation participates in Hammer undo',
            )
            check(
                agent.eval(E + ".activeTab().inst.extensions.entityDefinitions().some(x=>x.class==='fixture.spawn') && "
                           + E + ".activeTab().inst.extensions.menus().some(x=>x.id==='fixture.menu.generate') && "
                           + E + ".activeTab().inst.extensions.toolbar().some(x=>x.id==='fixture.toolbar.generate')"),
                'Hammer receives entity definitions and menu/toolbar contributions',
            )
            check(
                agent.eval(E + ".activeTab().inst.extensions.panels().some(x=>x.id==='fixture.panel.main') && "
                           + E + ".activeTab().inst.extensions.inspectors().some(x=>x.id==='fixture.inspector.meta')"),
                'Hammer receives panel and exposes inspector data through its host',
            )
            agent.eval('globalThis.extensionValidateDone=false;globalThis.extensionValidationResult=null;Promise.resolve(' + E + '.activeTab().inst.validate()).then(r=>{globalThis.extensionValidationResult=r;globalThis.extensionValidateDone=true;});1')
            settle(agent, 'globalThis.extensionValidateDone')
            check(
                agent.eval(E + ".activeTab().inst.diagnostics().some(d=>d.code==='FIXTURE_RUNTIME_VALIDATOR' && d.details.frozen===true)"),
                'runtime validator receives a frozen map snapshot and reports structured diagnostics',
            )
            check(
                agent.eval(E + ".activeTab().inst.diagnostics().some(d=>d.code==='SDK_EXTENSION_RUN_FAILED' && d.message.includes('fixture validator failure'))"),
                'throwing runtime validator becomes an isolated Hammer diagnostic',
            )
            check(
                agent.eval("globalThis.extensionValidationResult.ok===false && globalThis.extensionValidationResult.diagnostics.some(d=>d.code==='SDK_EXTENSION_RUN_FAILED') && "
                           + E + ".activeTab().inst.doc.content('we-diag').includes('SDK_EXTENSION_RUN_FAILED')"),
                'extension validation errors fail the Validate result and appear in Problems',
            )
            check(
                agent.eval(E + ".activeTab().inst.map.brushes.length===1 && " + E + ".extensions.extensions().some(e=>e.id==='fixture.world-tools' && e.enabled)"),
                'validator execution leaves the map intact and extension enabled',
            )
            agent.eval(E + ".activeTab().inst.select('brush',['wall.north']);" + E + ".activeTab().inst.render();1")
            check(
                agent.eval(E + ".activeTab().inst.doc.content('we-ext-inspectors').includes('Runtime inspector') && "
                           + E + ".activeTab().inst.doc.content('we-ext-context-actions').includes('Move selected context')"),
                'extension inspector sections and selected-object context actions render in Hammer',
            )
            agent.eval(E + ".activeTab().inst.doc.setValue('we-ext-inspector-field-fixture.inspector.runtime-targetY','96');" +
                       E + ".activeTab().inst.doc.click('we-ext-inspector-fixture.inspector.runtime');1")
            settle(agent, E + ".activeTab().inst.map.world.y===96")
            check(
                agent.eval(E + ".activeTab().inst.map.world.y===96"),
                'inspector action reads its field and commits through Hammer history',
            )
            agent.eval(E + ".activeTab().inst.undo();1")
            check(
                agent.eval(E + ".activeTab().inst.map.world.y===0"),
                'inspector contribution edit is undoable',
            )
            agent.eval(E + ".activeTab().inst.doc.click('we-ext-context-action-fixture.context.runtime');1")
            settle(agent, E + ".activeTab().inst.map.world.x===96")
            check(
                agent.eval(E + ".activeTab().inst.map.world.x===96"),
                'context action receives the selected object and applies its operation',
            )
            agent.eval(E + ".activeTab().inst.undo();1")
            check(
                agent.eval(E + ".activeTab().inst.map.world.x===0"),
                'context action operation is undoable',
            )
            print(f'OK: {checks} Editor extension checks', flush=True)


def main():
    state = ROOT / 'state.local.json'
    previous = state.read_bytes() if state.exists() else None
    try:
        _run()
        return 0
    finally:
        if previous is None:
            state.unlink(missing_ok=True)
        else:
            state.write_bytes(previous)


if __name__ == '__main__':
    raise SystemExit(main())
