"""Отладочные панели RmlUi: F1, мышь, физика, reload, --overlay."""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent, ROOT


def main():
    count = 0
    def check(ok, text):
        nonlocal count
        assert ok, text
        count += 1
        print('  ok   ' + text)
    with Agent(game='tests/fixtures/within') as a:
        a.step(5)
        check(not a.eval('$.debug.isOn()'), 'диагностика изначально закрыта')
        a.tap('F1'); a.step(3)
        p = a.eval('$.devtools.runtimePanel()')
        check(p['open'] and p['doc'] >= 0, 'F1 открывает документ RmlUi')
        check(p['snapshot']['stats']['nodes'] > 0, 'показаны настоящие счётчики мира')
        def click(id):
            r = a.eval('engine.ui.rect(%s,%r)' % (p['doc'], id))
            a.mouse_move(x=r['x']+r['w']/2, y=r['y']+r['h']/2)
            a.step(3); a.mouse(button=1, action='click'); a.step(3)
        a.eval('engine.ui.setValue(%s,"rt-gx","12"); engine.ui.setValue(%s,"rt-gy","345")' % (p['doc'],p['doc']))
        click('rt-gravity')
        check(a.eval('$.world.gravity()') == {'x':12,'y':345}, 'кнопка меняет гравитацию общего мира')
        a.eval('engine.ui.setValue(%s,"rt-gx","bad")' % p['doc'])
        click('rt-gravity')
        check(a.eval('$.world.gravity().x') == 12, 'невалидное поле не меняет физику')
        check(a.eval('$.debug.textures().length') > 0, 'панель использует метаданные живых GPU-текстур')
        check(a.eval("typeof $.script.error() === 'string'"), 'ошибка скрипта доступна через общий публичный API')
        a.screenshot(ROOT+'/build/sdk_runtime_rmlui.png')
        before = a.eval('$.script.count()')
        click('rt-reload')
        check(a.eval('$.script.count()') == before+1, 'настоящая кнопка запрашивает reload на границе кадра')
        a.tap('F1');a.step(2);a.tap('F1');a.step(2)
        check(not a.eval('$.debug.isOn()'), 'F1 закрывает панель')
        a.eval('$.debug.on()');a.step(2)
        check(a.eval('$.devtools.runtimePanel().open'), '$.debug.on использует ту же панель')
        a.eval('$.debug.off()');a.step(2)
        check(not a.eval('$.devtools.runtimePanel().open'), '$.debug.off скрывает документ')
        a.eval('$.devtools.open()');a.step(2)
        rect = a.eval('engine.ui.rect($.devtools.panel().doc,"dt-row-0")')
        check(rect['w'] > 0 and rect['h'] > 0, 'строки инспектора существуют и доступны мыши')
    with Agent(game='tests/fixtures/within', extra_args=['--overlay']) as a:
        a.step(3)
        check(a.eval('$.debug.isOn()'), '--overlay открывает RmlUi диагностику при старте')
    print('Все проверки пройдены (%s)' % count)
    return 0

if __name__ == '__main__':
    sys.exit(main())
