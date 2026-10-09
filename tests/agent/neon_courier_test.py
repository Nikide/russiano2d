"""Игровой цикл проекта, созданного SDK: ввод, UI, доставка, повреждение, таймер."""
import os
import sys
import subprocess
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent, ROOT


def main():
    with Agent(game='games/neon-courier', seed=19) as a:
        def state(): return a.state()['courier']
        def check(ok, text):
            print(('  ok   ' if ok else '  FAIL ') + text)
            assert ok, text
        def click(id):
            r=a.eval("$.ui.doc('ui/menu.rml').rect('%s')" % id)
            a.mouse_move(x=r['x']+r['w']/2, y=r['y']+r['h']/2)
            a.step(3);a.mouse(button=1,action='click');a.step(3)
        a.step(5)
        check(state()['phase']=='menu', 'начальное меню')
        a.screenshot(os.path.join(ROOT,'build','neon_courier_menu.png'))
        click('play')
        check(state()['phase']=='playing', 'настоящий клик начинает рейс')
        x=state()['player']['x'];a.hold(['D']);a.step(20);a.release_all()
        check(state()['player']['x']>x+60, 'раскладка SDK управляет героем')
        a.tap('Escape');a.step(2);s=state();a.step(120)
        check(state()['phase']=='paused' and state()['remaining']==s['remaining'], 'пауза останавливает таймер')
        click('play');check(state()['phase']=='playing','кнопка продолжает рейс')
        a.tap('R');a.step(2)
        check(state()['score']==0 and state()['hp']==3,'перезапуск сбрасывает состояние')
        # Контролируемые позиции проверяют логику сбора отдельно от маршрута ввода.
        for p in state()['parcels']:
            a.eval("$('#hero').at(%s,%s)" % (p['x'],p['y']));a.step(1)
        check(state()['score']==6 and not a.query('#parcel-0'), 'все посылки собраны и удалены')
        a.eval("$('#hero').at(110,330)");a.step(1)
        check(state()['phase']=='won','доставка на базу завершает игру победой')
        a.screenshot(os.path.join(ROOT,'build','neon_courier_win.png'))
        click('play');check(state()['phase']=='playing' and state()['score']==0,'новый рейс после победы')
        d=state()['drones'][0];a.eval("$('#hero').at(%s,%s)" % (d['x'],d['y']));a.step(1)
        check(state()['hp']==2 and state()['shield']>0,'дрон повреждает щит и даёт неуязвимость')
        d=state()['drones'][0];a.eval("$('#hero').at(%s,%s)" % (d['x'],d['y']));a.step(1)
        check(state()['hp']==2,'неуязвимость предотвращает повторный урон')
        for _ in range(2):
            a.eval("$('#hero').at(110,330)");a.step(100)
            d=state()['drones'][0];a.eval("$('#hero').at(%s,%s)" % (d['x'],d['y']));a.step(1)
        check(state()['phase']=='lost','исчерпание щита завершает рейс')
        a.tap('R');a.step(2);a.step(301, dt=0.25)
        check(state()['phase']=='lost' and state()['remaining']==0,'таймер завершает рейс')
        a.tap('R');a.step(2, dt=1.0/60.0)
        a.screenshot(os.path.join(ROOT,'build','neon_courier_game.png'))
        check(state()['privateApiHidden'] and a.eval('$.sdk.available()') is False,'игра независима от SDK и приватного engine')
        # Полный выигрышный маршрут обычными клавишами, без телепортации.
        route=[(110,130),(220,130),(220,180),(220,130),(440,130),(440,180),(440,130),
               (740,130),(740,180),(740,130),(820,130),(820,480),(820,530),
               (580,530),(580,480),(580,530),(300,530),(300,480),(300,530),(110,530),(110,330)]
        for tx,ty in route:
            for _ in range(100):
                if state()['phase']=='won': break
                p=state()['player'];dx=tx-p['x'];dy=ty-p['y']
                if abs(dx)<=5 and abs(dy)<=5: break
                if abs(dx)>5: keys=['D' if dx>0 else 'A'];distance=abs(dx)
                else: keys=['S' if dy>0 else 'W'];distance=abs(dy)
                a.hold(keys);a.step(max(1,min(20,int(distance/4))));a.release_all()
            else: raise AssertionError('маршрут не достиг точки')
        check(state()['phase']=='won' and state()['hp']>0,'весь рейс можно выиграть обычным вводом')
        errors=[s for s in a.stderr_tail().splitlines() if 'ошибка в $.update' in s or 'ReferenceError' in s or 'TypeError' in s]
        check(not errors,'нет ошибок игровой логики: '+str(errors))
    with tempfile.TemporaryDirectory(prefix='r2d-courier-package-') as tmp:
        binary=os.path.join(tmp,'courier')
        result=subprocess.run([os.path.join(ROOT,'build','r2d-sdk'),'build',
                               os.path.join(ROOT,'games','neon-courier'),'--out',binary,'--no-encrypt'],
                              cwd=ROOT,capture_output=True,text=True,timeout=60)
        check(result.returncode==0,'SDK собирает исполняемую игру')
        with Agent(binary=binary,game=None,cwd=tmp,seed=19) as a:
            a.step(5)
            check(a.state().get('courier',{}).get('phase')=='menu', 'собранная игра читает JSON и RML без проекта и SDK')
            r=a.eval("$.ui.doc('ui/menu.rml').rect('play')")
            check(r and r['w']>80 and r['h']>25, 'упакованы RCSS и шрифт: кнопка имеет размер')
            a.mouse_move(x=r['x']+r['w']/2,y=r['y']+r['h']/2);a.step(3)
            a.mouse(button=1,action='click');a.step(3)
            check(a.state()['courier']['phase']=='playing','кнопка упакованной игры начинает рейс')
            a.hold(['D']);a.step(20);a.release_all()
            check(a.state()['courier']['player']['x']>170,'упакованная раскладка управления работает')
            a.screenshot(os.path.join(ROOT,'build','neon_courier_standalone.png'))

if __name__=='__main__': main()
