#!/usr/bin/env python3
# ===========================================================================
# P0.1: user surface tags + exact ground lookup (GTA-like roadmap).
#
# Verifies the whole authored-data chain end-to-end:
#   .re2dmap span tags/ceilingTags -> r2d-sdk world-compile (native author JSON
#   + baked .re2dworld wire v6) -> $.re2dWorld.fromJSON -> public
#   world.groundAt / surface(i).tags()/hasTag()/tag() / surfaceTagsAt.
# Also proves old untagged payloads keep their legacy wire version and that
# spawn-point filtering by sidewalk/no_spawn works through the public API.
#
# Запуск (после сборки):
#   python3 tests/agent/re2d_surface_tags_test.py
# ===========================================================================
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
sys.path.insert(0, os.path.dirname(__file__))
from re2d_skip import skip_without_sdk_command, skip_without_re2d   # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if skip_without_sdk_command('world-compile', what='Re2D surface tags'):
    sys.exit(0)
from agent_client import Agent   # noqa: E402

SDK = os.environ.get('R2D_SDK_BINARY', 'build/r2d-sdk')
FAILED = []


def check(ok, message):
    print(('  ok   ' if ok else '  FAIL ') + message, flush=True)
    if not ok:
        FAILED.append(message)


def write_map(path, data):
    path.write_text(json.dumps(data))
    return path


def compile_map(source, output):
    result = subprocess.run([SDK, 'world-compile', str(source), '--renderer',
                             '--output', str(output)], capture_output=True, text=True)
    report = {}
    try:
        report = json.loads(result.stdout)
    except (TypeError, ValueError):
        pass
    return result, report


TAGGED_MAP = {
    'version': 1, 'name': 'surface tags',
    'cells': [
        {'id': 'street', 'rect': [0, 0, 200, 200], 'spans': [
            {'bottom': 0, 'top': 128, 'floorColor': '#777777',
             'tags': [' road ', 'road']},
            {'bottom': 160, 'top': 288, 'floorColor': '#888888',
             'tags': ['bridge'], 'ceilingTags': ['sky', 'roof']},
        ]},
        {'id': 'walk', 'rect': [200, 0, 100, 200], 'spans': [
            {'bottom': 0, 'top': 128, 'floorColor': '#999999', 'tags': ['sidewalk']},
        ]},
        {'id': 'closed_walk', 'rect': [300, 0, 100, 200], 'spans': [
            {'bottom': 0, 'top': 128, 'floorColor': '#999999',
             'tags': ['sidewalk', 'no_spawn']},
        ]},
    ],
    'walls': [
        {'id': 'n', 'from': [0, 0], 'to': [400, 0], 'bottom': 0, 'top': 288, 'color': '#aaaaaa'},
        {'id': 's', 'from': [0, 200], 'to': [400, 200], 'bottom': 0, 'top': 288, 'color': '#aaaaaa'},
        {'id': 'w', 'from': [0, 0], 'to': [0, 200], 'bottom': 0, 'top': 288, 'color': '#aaaaaa'},
        {'id': 'e', 'from': [400, 0], 'to': [400, 200], 'bottom': 0, 'top': 288, 'color': '#aaaaaa'},
    ],
    'portals': [],
    'spawns': [
        {'id': 'player.start', 'type': 'player', 'x': 50, 'y': 50, 'h': 0},
        {'id': 'ped.pavement', 'type': 'enemy', 'x': 250, 'y': 50, 'h': 0},
        {'id': 'ped.road', 'type': 'enemy', 'x': 150, 'y': 50, 'h': 0},
        {'id': 'ped.no_spawn', 'type': 'enemy', 'x': 350, 'y': 50, 'h': 0},
    ],
}

AUTHOR_MAP = {
    'version': 1, 'walls': [], 'portals': [],
    'cells': [{'x': 0, 'y': 0, 'w': 100, 'h': 100, 'spans': [
        {'bottom': 0, 'top': 64, 'tags': [' grass ', 'no_spawn', 'grass']},
        {'bottom': 80, 'top': 160, 'tags': ['roof'], 'ceilingTags': ['sky']},
    ]}],
}

BRUSH_MAP = {
    'version': 1, 'name': 'brush surface tags',
    'world': {'x': 0, 'y': 0, 'w': 300, 'h': 200, 'bottom': 0, 'top': 288,
              'floorColor': '#9a9a9a', 'ceilingColor': '#6a7078',
              'sideColor': '#8f7a58', 'boundary': 'sky',
              'tags': ['ground'], 'ceilingTags': ['world_ceiling']},
    'brushes': [
        # Solid slab above: its underside owns the ceiling of the open floor.
        {'id': 'overhang', 'rect': [0, 0, 100, 200], 'bottom': 160, 'top': 288,
         'tags': ['overhang_floor'], 'ceilingTags': ['overhang_ceiling']},
        # Solid platform below: its top owns the floor of the raised area.
        {'id': 'platform', 'rect': [100, 0, 200, 200], 'bottom': 0, 'top': 128,
         'tags': ['platform_top'], 'ceilingTags': ['platform_bottom']},
    ],
}

PLAIN_MAP = {
    'version': 1, 'name': 'untagged',
    'cells': [{'id': 'room', 'rect': [0, 0, 100, 100], 'spans': [
        {'bottom': 0, 'top': 128, 'floorColor': '#777777'},
    ]}],
    'walls': [
        {'id': 'n', 'from': [0, 0], 'to': [100, 0], 'bottom': 0, 'top': 128, 'color': '#aaaaaa'},
        {'id': 's', 'from': [0, 100], 'to': [100, 100], 'bottom': 0, 'top': 128, 'color': '#aaaaaa'},
        {'id': 'w', 'from': [0, 0], 'to': [0, 100], 'bottom': 0, 'top': 128, 'color': '#aaaaaa'},
        {'id': 'e', 'from': [100, 0], 'to': [100, 100], 'bottom': 0, 'top': 128, 'color': '#aaaaaa'},
    ],
    'portals': [],
}


def test_sdk_compile():
    print('\n== SDK authoring: tags -> native author JSON -> baked wire ==')
    source = write_map(Path('build/test_surface_tags.re2dmap'), TAGGED_MAP)
    output = Path('build/test_surface_tags.re2dworld')
    result, report = compile_map(source, output)
    check(result.returncode == 0, 'tagged .re2dmap compiles (exit 0)')
    if result.returncode != 0:
        print(result.stdout, result.stderr)
        return None
    compiled = json.loads(output.read_text())
    spans = [span for cell in compiled['cells'] for span in cell['spans']]
    check(spans[0].get('tags') == ['road'],
          'SDK trims tags and ignores duplicates in authored span tags')
    check(spans[1].get('tags') == ['bridge'] and spans[1].get('ceilingTags') == ['sky', 'roof'],
          'SDK passes authored floor tags and optional ceilingTags through')
    check(spans[2].get('tags') == ['sidewalk'] and spans[3].get('tags') == ['sidewalk', 'no_spawn'],
          'different cells keep disjoint authored surface tags')
    check(compiled.get('baked', {}).get('version') == 6,
          'tagged SDK output bumps baked wire to RDW6')
    check(report.get('outputFormat') == 're2dworld-v1' and
          [spawn['id'] for spawn in compiled.get('spawns', [])] ==
          ['player.start', 'ped.pavement', 'ped.road', 'ped.no_spawn'],
          'compiled output keeps the runtime format and authored spawns')

    # Stairs/slopes generated spans inherit the source element's tags.
    stairs = write_map(Path('build/test_surface_tags_stairs.re2dmap'), {
        'version': 1, 'cells': [], 'walls': [], 'portals': [],
        'stairs': [{'id': 'steps', 'rect': [0, 0, 100, 100], 'axis': 'x', 'dir': 1,
                    'steps': 4, 'base': 0, 'rise': 8, 'top': 120,
                    'tags': ['stairs', 'no_ped'], 'ceilingTags': ['roof']}],
    })
    stairs_out = Path('build/test_surface_tags_stairs.re2dworld')
    stair_result, _ = compile_map(stairs, stairs_out)
    stair_spans = [span for cell in json.loads(stairs_out.read_text())['cells']
                   for span in cell['spans']] if stair_result.returncode == 0 else []
    check(stair_result.returncode == 0 and len(stair_spans) == 4 and
          all(span.get('tags') == ['stairs', 'no_ped'] and
              span.get('ceilingTags') == ['roof'] for span in stair_spans),
          'generated stair spans inherit authored tags/ceilingTags')

    # Invalid tag data is an explicit SDK_FIELD error, never a silent drop.
    for label, bad_tags in [
            ('non-array', 'road'),
            ('non-string', ['road', 5]),
            ('empty-after-trim', ['road', '  ']),
            ('over-32-bytes', ['a' * 33]),
            ('over-32-tags', ['tag%d' % i for i in range(33)]),
    ]:
        broken = dict(TAGGED_MAP)
        broken['cells'] = [{'id': 'street', 'rect': [0, 0, 200, 200],
                            'spans': [{'bottom': 0, 'top': 128, 'tags': bad_tags}]}]
        source = write_map(Path('build/test_surface_tags_bad.re2dmap'), broken)
        result, report = compile_map(source, Path('build/test_surface_tags_bad.re2dworld'))
        diagnostics = report.get('diagnostics', []) if isinstance(report, dict) else []
        check(result.returncode != 0 and all(d.get('severity') == 'error' for d in diagnostics) and
              any(d.get('code') == 'SDK_WORLD_FIELD' for d in diagnostics),
              'SDK rejects %s tags with a stable diagnostic code' % label)

    # Untagged map keeps the legacy wire version and the old public contract.
    plain_source = write_map(Path('build/test_surface_tags_plain.re2dmap'), PLAIN_MAP)
    plain_out = Path('build/test_surface_tags_plain.re2dworld')
    plain_result, _ = compile_map(plain_source, plain_out)
    plain_compiled = json.loads(plain_out.read_text()) if plain_result.returncode == 0 else {}
    check(plain_result.returncode == 0 and plain_compiled.get('baked', {}).get('version', 0) < 6,
          'untagged SDK output keeps its legacy baked wire version (no RDW6)')

    # Brush-only authoring forwards brush/world surface tags into baked spans.
    brush_source = write_map(Path('build/test_surface_tags_brush.re2dmap'), BRUSH_MAP)
    brush_out = Path('build/test_surface_tags_brush.re2dworld')
    brush_result, brush_report = compile_map(brush_source, brush_out)
    check(brush_result.returncode == 0, 'brush-only tagged .re2dmap compiles (exit 0)')
    brush_compiled = json.loads(brush_out.read_text()) if brush_result.returncode == 0 else {}
    brush_spans = [span for cell in brush_compiled.get('cells', []) for span in cell['spans']]
    brush_floor_tags = sorted(span['tags'][0] for span in brush_spans if span.get('tags'))
    brush_ceiling_tags = sorted(span['ceilingTags'][0] for span in brush_spans
                                if span.get('ceilingTags'))
    check(len(brush_spans) == 2 and
          brush_floor_tags == ['ground', 'platform_top'] and
          brush_ceiling_tags == ['overhang_ceiling', 'world_ceiling'],
          'brush compiler forwards owner-floor and owner-ceiling tags (bounds fallback included)')
    check(brush_compiled.get('baked', {}).get('version') == 6,
          'brush-tagged output also uses baked wire v6')

    for label, broken in [
            ('brush tags non-array', {**BRUSH_MAP, 'brushes': [
                {**BRUSH_MAP['brushes'][1], 'tags': 'road'}]}),
            ('brush tag non-string', {**BRUSH_MAP, 'brushes': [
                {**BRUSH_MAP['brushes'][1], 'tags': ['road', 5]}]}),
            ('brush ceiling tag empty', {**BRUSH_MAP, 'brushes': [
                {**BRUSH_MAP['brushes'][1], 'ceilingTags': ['  ']}]}),
            ('world tags non-array', {**BRUSH_MAP, 'world': {
                **BRUSH_MAP['world'], 'tags': 'ground'}}),
    ]:
        broken_source = write_map(Path('build/test_surface_tags_brush_bad.re2dmap'), broken)
        broken_result, broken_report = compile_map(
            broken_source, Path('build/test_surface_tags_brush_bad.re2dworld'))
        diagnostics = broken_report.get('diagnostics', []) if isinstance(broken_report, dict) else []
        check(broken_result.returncode != 0 and
              any(d.get('code') == 'SDK_WORLD_FIELD' for d in diagnostics),
              'SDK rejects %s with SDK_WORLD_FIELD' % label)
    return compiled, plain_compiled, brush_compiled


def test_public_api(compiled, plain):
    print('\n== Public $ API: groundAt/surface tags on a compiled tagged map ==')
    with Agent(game='tests/fixtures/re2d_native', seed=3) as a:
        if skip_without_re2d(a, what='Re2D surface tags'):
            return
        tagged_json = json.dumps(json.dumps(compiled))
        result = a.eval(
            '(()=>{'
            'const w=$.re2dWorld.fromJSON(' + tagged_json + ');'
            'const road=w.groundAt(50,50,{h:0});'
            'const bridge=w.groundAt(50,50,{h:200});'
            'const walk=w.groundAt(250,50,{h:0});'
            'const closed=w.groundAt(350,50,{h:0});'
            'let ambiguityError=false,message="";'
            'try{w.groundAt(50,50);}catch(e){ambiguityError=e instanceof RangeError;message=e.message||"";}'
            'const floor=road.surface;'
            'const tagsBefore=w.surface(floor).tags();'
            'w.surface(floor).tag("no_spawn",true);'
            'const added=w.surface(floor).hasTag("no_spawn")&&w.groundAt(50,50,{h:0}).tags.indexOf("no_spawn")>=0;'
            'w.surface(floor).tag("no_spawn",false);'
            'const removed=!w.surface(floor).hasTag("no_spawn");'
            'let invalidEmpty=false,invalidType=false;'
            'try{w.surface(floor).tag("",true);}catch(e){invalidEmpty=e instanceof RangeError;}'
            'try{w.surface(floor).tag(5);}catch(e){invalidType=e instanceof TypeError;}'
            'const viaWrapper=w.surfaceTagsAt(250,50,{h:0});'
            'const filtered=w.spawns().filter(s=>{const g=w.groundAt(s.x,s.y,{h:s.h});'
            'return !!g&&g.tags.indexOf("sidewalk")>=0&&g.tags.indexOf("no_spawn")<0;}).map(s=>s.id);'
            'const geometryOk=w.cellAt(50,50)===0&&w.spanAt(50,50,0)===0&&w.spanAt(50,50,200)===1'
            '&&w.info().spans===4&&w.info().cells===3;'
            'const baked=w.info().bakedTopology;'
            'let missingH="";try{w.groundAt(50,50);}catch(e){missingH=e.message||"";}'
            'let badXY=false;try{w.groundAt(NaN,50,{h:0});}catch(e){badXY=e instanceof RangeError;}'
            'let unknownOption=false;try{w.groundAt(50,50,{height:0});}catch(e){unknownOption=e instanceof TypeError;}'
            'let miss=null;try{miss=w.groundAt(9999,9999,{h:0});}catch(e){miss="threw";}'
            'w.dispose();'
            'return {road,bridge,walk,closed,ambiguityError,message,missingH,'
            'tagsBefore,added,removed,invalidEmpty,invalidType,viaWrapper,filtered,geometryOk,baked,'
            'badXY,unknownOption,miss};'
            '})()')
        check(isinstance(result, dict), 'tagged baked .re2dworld loads through $.re2dWorld.fromJSON')
        if not isinstance(result, dict):
            print(result)
            return
        road, bridge, walk = result['road'], result['bridge'], result['walk']
        check(road and road['tags'] == ['road'] and road['height'] == 0,
              'groundAt returns the authored road tags and support height')
        check(bridge and bridge['tags'] == ['bridge'] and bridge['height'] == 160,
              'bridge at the same XY resolves by h (no silent floor)')
        check(road['cell'] == bridge['cell'] and road['span'] != bridge['span'] and
              road['surface'] != bridge['surface'],
              'same XY resolves distinct spans/surfaces for road vs bridge')
        check(walk and walk['tags'] == ['sidewalk'] and result['closed']['tags'] == ['sidewalk', 'no_spawn'],
              'groundAt resolves per-cell sidewalk/no_spawn tags')
        check(result['ambiguityError'] and
              'h' in result['missingH'] and result['missingH'] == result['message'],
              'groundAt without h on a stacked XY throws RangeError naming the h requirement')
        check(result['closed'] is not None and result['viaWrapper'] == ['sidewalk'],
              'surfaceTagsAt is a thin ground/tags wrapper')
        check(result['tagsBefore'] == ['road'] and result['added'] and result['removed'],
              'surface(i).tags()/hasTag()/tag() add and remove runtime tags')
        check(result['invalidEmpty'] and result['invalidType'],
              'invalid runtime tag input fails with RangeError/TypeError (no silent fallback)')
        check(result['geometryOk'],
              'runtime tag mutation leaves cell/span/surface geometry unchanged')
        check(result['baked'] is True,
              'tagged map loads the baked native tables (no authoring rebuild)')
        check(result['filtered'] == ['ped.pavement'],
              'spawn filtering by sidewalk/no_spawn uses only the public groundAt')
        check(result['badXY'] and result['unknownOption'] and result['miss'] is None,
              'groundAt validates x/y/options and returns null outside the map')

        # Plain author JSON path (no bake) round-trips tags and ceilingTags.
        author_json = json.dumps(json.dumps(AUTHOR_MAP))
        author = a.eval(
            '(()=>{'
            'const w=$.re2dWorld.fromJSON(' + author_json + ');'
            'const lower=w.groundAt(50,50,{h:0});'
            'const upper=w.groundAt(50,50,{h:80});'
            'let ambiguous=false;try{w.groundAt(50,50);}catch(e){ambiguous=e instanceof RangeError;}'
            'const ceiling=w.surface(3).tags();'
            'w.dispose();'
            'return {lower,upper,ambiguous,ceiling};'
            '})()')
        check(author['lower']['tags'] == ['grass', 'no_spawn'] and
              author['lower']['height'] == 0,
              'native author JSON trims authored tags and ignores duplicates')
        check(author['upper']['tags'] == ['roof'] and author['upper']['height'] == 80 and
              author['ceiling'] == ['sky'],
              'native author JSON stores ceilingTags on the ceiling surface')
        check(author['ambiguous'], 'author JSON stacked spans keep the h-required policy')

        for label, broken in [
                ('non-array', {**AUTHOR_MAP, 'cells': [{'x': 0, 'y': 0, 'w': 10, 'h': 10,
                                                        'spans': [{'bottom': 0, 'top': 8, 'tags': 'road'}]}]}),
                ('over-32-bytes', {**AUTHOR_MAP, 'cells': [{'x': 0, 'y': 0, 'w': 10, 'h': 10,
                                                            'spans': [{'bottom': 0, 'top': 8, 'tags': ['a' * 33]}]}]}),
        ]:
            rejected = a.eval(
                '(()=>{try{$.re2dWorld.fromJSON(' + json.dumps(json.dumps(broken)) +
                ');}catch(e){return e instanceof TypeError||e instanceof RangeError;}return false;})()')
            check(rejected is True, 'invalid author JSON %s tags are rejected natively' % label)

        # An untagged compiled map still loads and answers groundAt without tags.
        plain_json = json.dumps(json.dumps(plain))
        old = a.eval(
            '(()=>{'
            'const w=$.re2dWorld.fromJSON(' + plain_json + ');'
            'const g=w.groundAt(50,50,{h:0});'
            'const ok=!!g&&w.surface(g.surface).tags().length===0&&!w.surface(g.surface).hasTag("road");'
            'w.dispose();return ok;'
            '})()')
        check(old is True, 'old untagged baked payload loads with no tags (backward compatible)')


def test_brush_public_api(brush):
    print('\n== Public $ API: brush-authored tags ==')
    with Agent(game='tests/fixtures/re2d_native', seed=4) as a:
        if skip_without_re2d(a, what='brush surface tags'):
            return
        brush_json = json.dumps(json.dumps(brush))
        result = a.eval(
            '(()=>{'
            'const w=$.re2dWorld.fromJSON(' + brush_json + ');'
            'const open=w.groundAt(50,50,{h:0});'
            'const platform=w.groundAt(250,50,{h:160});'
            'const openCeiling=open?w.surface(open.surface+1).tags():null;'
            'const platformCeiling=platform?w.surface(platform.surface+1).tags():null;'
            'const singleSpan=w.groundAt(50,50);'
            'const hasTag=platform?w.surface(platform.surface).hasTag("platform_top"):false;'
            'const baked=w.info().bakedTopology;'
            'w.dispose();'
            'return {open,platform,openCeiling,platformCeiling,singleSpan,hasTag,baked};'
            '})()')
        check(isinstance(result, dict), 'brush-tagged baked map loads through $.re2dWorld.fromJSON')
        if not isinstance(result, dict):
            print(result)
            return
        check(result['open'] and result['open']['tags'] == ['ground'] and
              result['open']['height'] == 0,
              'ground floor under the overhang carries the world/bounds floor tag')
        check(result['platform'] and result['platform']['tags'] == ['platform_top'] and
              result['platform']['height'] == 128,
              'raised platform floor carries the owning brush floor tag')
        check(result['openCeiling'] == ['overhang_ceiling'],
              'ceiling under the solid overhang carries the owning brush ceiling tag')
        check(result['platformCeiling'] == ['world_ceiling'],
              'open ceiling above the platform falls back to world bounds ceiling tags')
        check(result['singleSpan'] and result['singleSpan']['tags'] == ['ground'] and
              result['hasTag'] is True,
              'single-span brush XY may omit h; brush tags also work via surface.hasTag')
        check(result['baked'] is True, 'brush-tagged map loads the baked native tables')


def test_save_state_tags(compiled):
    print('\n== Save/load: runtime surface tags survive saveStateJSON/loadStateJSON ==')
    with Agent(game='tests/fixtures/re2d_native', seed=5) as a:
        if skip_without_re2d(a, what='surface tags save state'):
            return
        tagged_json = json.dumps(json.dumps(compiled))
        result = a.eval(
            '(()=>{'
            'const w=$.re2dWorld.fromJSON(' + tagged_json + ');'
            'const floor=w.groundAt(50,50,{h:0}).surface;'
            'const authored=w.surface(floor).tags().slice();'
            'w.surface(floor).tag("runtime_saved",true);'
            'w.surface(floor).tag("road",false);'
            'const save=w.saveState();'
            'const savedHasSection=!!(save.state&&save.state.surfaceTags&&'
            'save.state.surfaceTags.some(e=>e.surface===floor&&e.tags.length===1&&'
            'e.tags[0]==="runtime_saved"));'
            'w.surface(floor).tag("runtime_saved",false);'
            'w.surface(floor).tag("road",true);'
            'w.surface(floor).tag("ephemeral",true);'
            'const applied=w.loadState(save);'
            'const restored=w.surface(floor).tags().slice();'
            'const saveV1=w.saveState();'
            'w.surface(floor).tag("v1_kept",true);'
            'saveV1.state.version=1;'
            'delete saveV1.state.surfaceTags;'
            'const v1Applied=w.loadState(saveV1);'
            'const v1Tags=w.surface(floor).tags().slice();'
            'const geometry=w.spanAt(50,50,0)===0&&w.spanAt(50,50,200)===1;'
            'w.dispose();'
            'return {authored,savedHasSection,applied,restored,v1Applied,v1Tags,geometry};'
            '})()')
        check(isinstance(result, dict), 'saveState/loadState execute on a tagged world')
        if not isinstance(result, dict):
            print(result)
            return
        check(result['authored'] == ['road'], 'authored floor tags are the save base')
        check(result['savedHasSection'] is True, 'v2 native save contains the surfaceTags section')
        check(result['applied'] is True, 'loadState applies a tag-bearing save')
        check('runtime_saved' in result['restored'] and 'road' not in result['restored'] and
              'ephemeral' not in result['restored'],
              'save restores runtime-added tags and runtime-removed authored tags exactly')
        check(result['v1Applied'] is True and 'v1_kept' in result['v1Tags'],
              'v1 snapshot without surfaceTags leaves the live tag table untouched')
        check(result['geometry'] is True, 'tag restore does not mutate span geometry')


def main():
    compiled = test_sdk_compile()
    if compiled is None:
        return 1
    test_public_api(compiled[0], compiled[1])
    test_brush_public_api(compiled[2])
    test_save_state_tags(compiled[0])
    print('\n%d failure(s)' % len(FAILED))
    return 1 if FAILED else 0


if __name__ == '__main__':
    raise SystemExit(main())
