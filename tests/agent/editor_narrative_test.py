#!/usr/bin/env python3
"""Native VN tabs, lossless save, draft validation and actual story playback."""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from agent_client import Agent, ROOT
from editor_hammer_test import settle, run

E = '$.editorApp'
D = '$.ui.doc("ui/editor.rml")'
A = E + '.activeTab().inst'
checks = 0


def check(value, message):
    global checks
    checks += 1
    print(('  ok   ' if value else '  FAIL ') + message, flush=True)
    if not value:
        raise AssertionError(message)


def select(a, kind):
    a.eval(A + '.ops.select(' + A + '.ops.listCommands().findIndex(c=>c.kind===' + json.dumps(kind) + '));1')
    a.step(2)


def main():
    recents = Path(ROOT) / 'state.local.json'
    previous = recents.read_bytes() if recents.exists() else None
    try:
        return test()
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-vn-tabs-') as tmp:
        root = Path(tmp)
        for name in ['story', 'assets', 'i18n', 'ui/dialog']:
            (root / name).mkdir(parents=True)
        (root / 'project.json').write_text('{"title":"VN Studio","width":1440,"height":900}')
        (root / 'main.js').write_text('$.ready(() => {});')
        shutil.copyfile(Path(ROOT) / 'demos/assets/art/vn/bg/classroom_day.png', root / 'assets/bg.png')
        shutil.copyfile(root / 'assets/bg.png', root / 'assets/other.png')
        speakers = {'speakers': {'w': {'name': 'Witness', 'expressions': ['neutral'], 'portraits': {'neutral': 'assets/bg.png'}}}}
        (root / 'story/speakers.json').write_text(json.dumps(speakers))
        (root / 'i18n/en.json').write_text('{"intro":{"line":"Translated"}}')
        (root / 'ui/dialog/test.rml').write_text('<rml><body><div data-dialog-role="root"><div data-dialog-role="text"></div><div data-dialog-role="choices"></div></div></body></rml>')
        (root / 'ui/dialog/test.rcss').write_text('body { color: #ffffff; }')
        original = '# canon\r\n@theme test\r\n:start\r\nimage assets/bg.png 0\r\nw (neutral): Hello\r\n- Yes {trust += 1} -> yes\r\n- No -> end\r\n:yes\r\n~ End\r\nend'
        a_path, b_path = root / 'story/a.scene', root / 'story/b.story'
        a_path.write_bytes(original.encode())
        b_path.write_text('# B\n:start\n~ Second\nend\n')
        b_original = b_path.read_bytes()
        with Agent(game='editor', scene=tmp, seed=8) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.openFile("story/a.scene");1')
            settle(a, '!!' + A)
            a.eval('globalThis.vnA=' + A + ';1')
            check(a.eval(E + '.activeTab().studio.native && ' + E + '.activeTab().studio.id==="narrative"'), 'scene opens in native Narrative Studio')
            check(run(a, A + '.save()') and a_path.read_bytes() == original.encode(), 'untouched Save preserves CRLF and EOF bytes')
            select(a, 'say')
            p = a.eval(A + '.preview()')
            check(p['bg']=='assets/bg.png' and p['portrait']=='assets/bg.png' and p['speaker']=='Witness', 'selected-row preview uses project background, portrait and display name')
            a.eval(A + '.doc.setValue("vnm-f-text","Edited");' + A + '.doc.click("vnm-apply");1'); a.step(3)
            check(a.eval(A + '.state.source.includes("w (neutral): Edited")'), 'inspector preserves speaker and expression')
            check(a.eval(A + '.state.source.startsWith("# canon\\r\\n")'), 'inspector preserves neighboring comments and CRLF')
            check(a.eval(A + '.undo() && !' + A + '.dirty()'), 'undo to saved source clears dirty')
            a.eval(A + '.redo();1')
            a.eval(E + '.openFile("story/b.story");1')
            settle(a, '!!' + A)
            a.eval('globalThis.vnB=' + A + ';1')
            check(a.eval(E + '.state.tabs.filter(t=>t.kind==="studio").length===2 && vnA.doc.id!==vnB.doc.id'), 'two scenes have independent documents and tabs')
            a.eval('vnB.ops.insert("say");1'); a.step(2)
            check(a.eval('vnB.undo() && !vnB.dirty() && vnA.dirty()'), 'histories and saved state are independent')
            a.eval(E + '.openFile("story/a.scene");1'); a.step(4)
            select(a, 'choice')
            a.eval(A + '.doc.setValue("vnm-f-text","Agree");' + A + '.doc.click("vnm-apply");1'); a.step(2)
            check(a.eval(A + '.state.source.includes("- Agree {trust += 1} -> yes")'), 'choice inspector preserves gameplay flag commit')
            select(a, 'image')
            a.eval(A + '.state.pickTarget="asset";' + A + '.ops.findAssets();' + A + '.ops.pickAsset("assets/other.png");' + A + '.doc.click("vnm-apply");1'); a.step(2)
            check(a.eval(A + '.state.source.includes("image assets/other.png 0")'), 'asset picker edits path without losing image duration')
            select(a, 'say')
            n = a.eval(A + '.snapshot().commandCount')
            a.eval(A + '.doc.focus("vnm-f-text");1'); a.step(2)
            a.tap('Backspace'); a.step(2)
            check(a.eval(A + '.snapshot().commandCount') == n, 'Backspace in text field does not delete a command')
            a.eval(A + '.doc.focus("vnm-f-text",false);1'); a.step(2)
            a.hold(['Left Ctrl']); a.tap('Z'); a.step(2); a.release_all(); a.step(3)
            check(a.eval(A + '.state.source.includes("image assets/bg.png 0")'), 'Editor keyboard undo routes once to Narrative history')
            a.hold(['Left Ctrl']); a.tap('Y'); a.step(2); a.release_all(); a.step(3)
            check(a.eval(A + '.state.source.includes("image assets/other.png 0")'), 'Editor keyboard redo restores the same transaction')
            result = run(a, A + '.ops.validate()')
            check(result['ok'] and result['speakers_registry'], 'native validator checks dirty draft with speaker registry')
            check(a_path.read_bytes() == original.encode(), 'Validate never saves the original scene')
            check(not list((root / 'build').glob('.r2d-vn-*')), 'validation scratch files and directories are removed')
            a.eval(A + '.ops.setSource(' + A + '.state.source+"\\r\\ngoto missing");1'); a.step(2)
            result = run(a, A + '.ops.validate()')
            d = next(d for d in result['diagnostics'] if d['code']=='STORY_GOTO_UNKNOWN')
            check(not result['ok'] and d['asset']==str(a_path) and d['location']['line']>0, 'draft errors map native codes and lines back to original source')
            check(a.eval(E + '.state.problemList.some(d=>d.code==="STORY_GOTO_UNKNOWN")'), 'native story diagnostic appears in Editor Problems')
            check(a.eval(A + '.navigateDiagnostic(' + json.dumps(d) + ')'), 'diagnostic selects its narrative source row')
            a.eval(A + '.undo();1'); a.step(2)
            check(a.eval(A + '.snapshot().validationStale'), 'editing after validation marks its result stale')
            # Source mode uses a distinct buffer id and records edits in the same history.
            a.eval(A + '.doc.click("vnm-source-mode");1'); a.step(3)
            check(a.eval(A + '.state.mode==="source" && ' + A + '.doc.rect("vnm-source-buffer").h>0'), 'Source button opens a separate usable text buffer')
            a.eval(A + '.doc.setValue("vnm-source-buffer",' + A + '.state.source+"\\r\\n# source edit");' + A + '.ops.commitSource();1'); a.step(2)
            check(a.eval(A + '.state.source.endsWith("# source edit")'), 'Source buffer commits through the same operation as its change event')
            check(a.eval(A + '.undo()'), 'source edits share undo with structured operations')
            a.eval(A + '.doc.click("vnm-source-mode");' + A + '.doc.click("vnm-graph");1'); a.step(2)
            check(a.eval(A + '.doc.content("vnm-graph-view").includes("yes")'), 'label/transition overview shows actual authored references')
            a.eval(A + '.doc.click("vnm-graph");1'); a.step(2)
            select(a, 'say')
            # Play must use the current buffer through the actual story/dialog runtime.
            check(a.eval(A + '.ops.playScene()'), 'Play starts current unsaved buffer')
            settle(a, '$.dialog.isOpen()')
            check(a.eval(E + '.state.fullPreview!==null && $.story.running()'), 'Editor enters full preview with actual story playback')
            check(a.eval('$.dialog.theme().includes("__vn_")'), 'preview applies authored project theme through dialog runtime')
            check(a.eval('$.dialog.fullText()==="Edited" && $.dialog.speakerName()==="Witness"'), 'runtime displays edited dialogue and registered speaker')
            check(a_path.read_bytes()==original.encode(), 'Play does not autosave source')
            a.eval(E + '.closeTab("story/b.story");1'); a.step(2)
            check(a.eval('$.story.running()'), 'closing another scene does not stop active playback')
            a.tap('Escape'); a.step(5)
            check(a.eval(E + '.state.fullPreview===null && !$.story.running()'), 'Escape stops runtime and returns to Editor')
            check(a.eval('!$.dialog.theme().includes("__vn_")'), 'preview stop restores previous dialog theme')
            check(a.eval(A + '.ops.playFromHere()'), 'Play From Here uses runtime label entry')
            settle(a, '$.dialog.isOpen()')
            check(a.eval('$.dialog.fullText()==="Edited"'), 'Play From Here starts at selected source row')
            a.tap('Escape'); a.step(4)
            # Standalone completion must restore the Editor without requiring Esc.
            a.eval(A + '.ops.setSource("end\\n");' + A + '.ops.playScene();1'); a.step(12)
            check(a.eval(E + '.state.fullPreview===null && !$.story.running()'), 'natural playback completion restores Editor')
            a.eval(A + '.undo();1'); a.step(3)
            check(run(a, A + '.save()') and not a.eval(A + '.dirty()'), 'Save writes buffer and marks current source saved')
            check(b_path.read_bytes()==b_original, 'saving scene A leaves scene B untouched')
            saved = a_path.read_bytes()
            a_path.write_text('~ External edit\nend\n')
            a.eval(A + '.ops.insert("wait");1'); a.step(2)
            check(not run(a, A + '.save()') and a_path.read_text()=='~ External edit\nend\n', 'external write conflict is diagnosed without overwriting disk')
            a_path.write_bytes(saved)
            # Resource forms and i18n are still available through the same native instance.
            a.eval(A + '.ops.selectSpeaker("w");' + A + '.doc.setValue("vnm-ch-name","Updated witness");1')
            check(a.eval(A + '.ops.saveCharacter()'), 'speaker form writes existing registry format')
            check(json.loads((root/'story/speakers.json').read_text())['speakers']['w']['portraits']['neutral']=='assets/bg.png', 'speaker save preserves portraits and unknown fields')
            a.eval(A + '.ops.selectI18n("en.json");' + A + '.doc.setValue("vnm-i18n-json",\'{"intro":{"line":"New"}}\');1')
            check(a.eval(A + '.ops.saveI18n()'), 'i18n resource save is connected')
            a.eval(A + '.ops.selectTheme("ui/dialog/test.rml");1')
            check(run(a, A + '.ops.validateTheme()')['ok'], 'theme validation uses native dialog validator')
            check(not a.eval(A + '.ops.newScene("../outside.scene")'), 'new scene path cannot escape project root')
            check(a.eval(A + '.ops.newScene("story/new.scene")'), 'new scene opens its own tab')
            settle(a, '!!' + A)
            check(a.eval(E + '.activeTab().path==="story/new.scene"'), 'new scene does not replace previous document identity')
            a.eval(E + '.openFile("story/a.scene");1'); a.step(4)
            if os.environ.get('R2D_CAPTURE_VISUALS') == '1':
                a.screenshot(str(Path(ROOT) / 'build/editor-narrative-tabs.png'))
            check(a.eval(A + '.ops.playScene()'), 'dirty document can preview before a close decision')
            settle(a, '$.story.running()')
            a.eval(E + '.closeTab("story/a.scene");1'); a.step(2)
            check(a.eval(E + '.state.tabs.some(t=>t.path==="story/a.scene")'), 'first close preserves dirty narrative tab')
            check(a.eval(E + '.state.closeRequest==="story/a.scene"'), 'dirty narrative close exposes explicit confirmation actions')
            a.eval(D + '.click("close-confirm-discard");1'); a.step(3)
            check(not a.eval(E + '.state.tabs.some(t=>t.path==="story/a.scene")'), 'confirmed close releases only that document')
            check(a.eval(E + '.state.fullPreview===null && !$.story.running()'), 'closing active preview restores Editor and stops only its runtime')
    print('All', checks, 'Narrative Studio checks passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
