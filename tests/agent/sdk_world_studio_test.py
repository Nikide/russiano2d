#!/usr/bin/env python3
"""World Studio: RmlUi editing -> native compiler -> actual runtime preview."""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent, ROOT
OUT=os.path.join(ROOT,'build','studio-world.re2dmap')
DOC="$.ui.doc('sdk/ui/world_studio.rml')"
failures=[]
def check(v,m):
    print(('  ok   ' if v else '  FAIL ')+m)
    if not v: failures.append(m)
def wait(a):
    for _ in range(300):
        a.step(2);time.sleep(.005)
        if a.eval('$.sdkApp.state.busy===0 && (!$.sdkApp.studios.world || !$.sdkApp.studios.world.state.busy)'):return True
    return False
def snap(a):return json.loads(a.eval('JSON.stringify($.sdkApp.studios.world.snapshot())'))
with Agent(game='sdk',seed=6) as a:
    a.step(4);wait(a)
    a.eval("$.sdkApp.openTool('re2d-world-studio',{assetAbs:'tests/fixtures/sdk/world/stack.re2dmap'});1")
    wait(a);a.step(3)
    check(a.eval('!!$.sdkApp.studios.world'), 'экран World Studio открыт из реестра')
    check(snap(a)['active'], 'World Studio активен')
    check(a.eval(DOC+".rect('ws-plan').w")>100,'план XY имеет рабочую геометрию')
    check(a.eval(DOC+".rect('ws-section').w")>100,'высотный разрез имеет рабочую геометрию')
    a.eval("$.sdkApp.studios.world.state.path="+json.dumps(OUT))
    a.eval(DOC+".click('ws-compile');1");wait(a);a.step(3)
    s=snap(a);check(s['preview'] and s['stats']['spans']==2,'клик компиляции создаёт настоящий runtime world (два этажа)')
    check(a.eval("$.sdkApp.studios.world.state.world.support(100,100,160,50,0).height")==160,'preview: опора на верхнем этаже')
    a.screenshot(os.path.join(ROOT,'build','codex-world-studio.png'))
    a.eval("$.sdkApp.studios.world.select('walls',0);1")
    a.eval(DOC+".click('ws-split');1");a.step(2)
    check(len(snap(a)['data']['walls'])==5,'кнопка разрезает выбранную стену')
    a.eval(DOC+".click('ws-undo');1");a.step(2)
    check(len(snap(a)['data']['walls'])==4,'undo возвращает исходную стену')
    a.eval(DOC+".click('ws-redo');1");a.step(2)
    check(len(snap(a)['data']['walls'])==5,'redo повторяет разрез')
    a.eval(DOC+".setValue('ws-join-index','1');1")
    a.eval(DOC+".click('ws-join');1");a.step(2)
    check(len(snap(a)['data']['walls'])==4,'join снова объединяет коллинеарные стены')
    a.eval("$.sdkApp.studios.world.select('cells',0);1")
    c=snap(a)['data']['cells'][0];c['spans'][1]['bottom']=176
    a.eval(DOC+".setValue('ws-properties',"+json.dumps(json.dumps(c))+');1')
    a.eval(DOC+".click('ws-apply');1");a.step(2)
    check(snap(a)['data']['cells'][0]['spans'][1]['bottom']==176,'клик применяет свойства height spans')
    a.eval(DOC+".click('ws-save');1");a.step(2)
    check(os.path.isfile(OUT) and not snap(a)['dirty'],'сохранён JSON исходник, dirty сброшен')
    a.eval("$.sdkApp.studios.world.compile(false);1");wait(a);a.step(2)
    check(snap(a)['preview'],'изменённая карта снова принята runtime')
    a.eval("$.sdkApp.studios.world.close();1");a.step(2)
    check(not snap(a)['active'] and not snap(a)['preview'],'закрытие освобождает world и возвращает оболочку')
sys.exit(bool(failures))
