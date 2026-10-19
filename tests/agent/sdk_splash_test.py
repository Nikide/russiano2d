#!/usr/bin/env python3
"""Сплэш SDK: картинка/название/прогресс и полная вшитость в бинарник.

Проверяется на живом движке (docs/SDK.md §1.1):
  * splash-документ открывается сразу и имеет реальную геометрию RmlUi;
  * текст «РУССИАНО 2Д КОМПЛЕКТ РАЗРАБОТКИ (SDK)» и прогрессбар на месте;
  * прогресс ведёт приложение (реестр/версия), затем сплэш скрывается;
  * три файла сплэша (jpg/rml/rcss) ВРЕМЕННО убраны с диска — сплэш всё равно
    работает, потому что вшит в бинарник (cmake/Splash.cmake).

Запуск: python3 tests/agent/sdk_splash_test.py
"""
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent, ROOT   # noqa: E402

DOC = "$.ui.doc('sdk/ui/splash.rml')"
API = "$.sdkApp.splash"
TITLE = 'КОМПЛЕКТ ДЛЯ РАЗРАБОТКИ (SDK)'
FILES = ['sdk/assets/splash.jpg', 'sdk/ui/splash.rml', 'sdk/ui/splash.rcss']
failures = []


def check(v, m):
    print(('  ok   ' if v else '  FAIL ') + m)
    if not v:
        failures.append(m)


def wait_hidden(a, limit=400):
    for _ in range(limit):
        if a.eval(API + '.snapshot().hidden===true'):
            return True
        a.step(2)
        time.sleep(.003)
    return False


def hide_files():
    moved = []
    for rel in FILES:
        src = os.path.join(ROOT, rel)
        if os.path.isfile(src):
            dst = os.path.join(ROOT, 'build', 'splash-embed-' + os.path.basename(rel) + '.bak')
            shutil.move(src, dst)
            moved.append((dst, src))
    return moved


def restore_files(moved):
    for dst, src in moved:
        if os.path.isfile(dst):
            os.makedirs(os.path.dirname(src), exist_ok=True)
            shutil.move(dst, src)


if __name__ == '__main__':
    moved = hide_files()
    try:
        check(not any(os.path.isfile(os.path.join(ROOT, rel)) for rel in FILES),
              'файлы сплэша убраны с диска (проверяем вшитость)')
        with Agent(game='sdk', seed=6) as a:
            a.step(2)
            snap = json.loads(a.eval('JSON.stringify(' + API + '.snapshot())'))
            check(bool(snap) and snap['failed'] is False, 'splash создан и не упал')
            check(snap['frames'] >= 1, 'splash уже рисуется на первых кадрах')
            check(snap['progress'] > 0, 'прогресс начался: %d%%' % snap['progress'])
            check(snap['version'].startswith('r2d-sdk'), 'версия backend в сплэше: ' + snap['version'])

            # Не понижаем target: finish() уже перевёл его в 100, иначе сплэш
            # никогда не скроется (это проверка 100%, а не ручной показ).
            a.eval(API + ".show();" + API + ".progress(100,'проверка UI');1")
            a.step(3)
            doc = json.loads(a.eval(
                "JSON.stringify((function(){var d=" + DOC + ";" +
                "var r=function(id){return d.rect(id)||{x:0,y:0,w:0,h:0};};" +
                "return {img:r('splash-img'),track:r('splash-track')," +
                "title:d.content('splash-title'),stage:d.content('splash-stage')," +
                "pct:d.content('splash-percent')};})())"))
            check(doc['title'] == TITLE, 'заголовок сплэша ровно по ТЗ')
            check(doc['img']['w'] > 1000 and doc['img']['h'] > 700,
                  'картинка занимает окно (%dx%d)' % (doc['img']['w'], doc['img']['h']))
            check(doc['track']['w'] > 300, 'прогрессбар имеет ширину (%d)' % doc['track']['w'])
            check(doc['stage'].startswith('проверка'), 'статус обновляется: ' + doc['stage'])
            check(doc['pct'].endswith('%'), 'процент виден: ' + doc['pct'])
            a.screenshot(os.path.join(ROOT, 'build', 'sdk-splash.png'))

            check(wait_hidden(a), 'сплэш скрылся после готовности')
            final = json.loads(a.eval('JSON.stringify(' + API + '.snapshot())'))
            check(final['hidden'] is True and final['visible'] is False, 'сплэш не мешает оболочке')
            check(final['progress'] >= 99, 'прогресс дошёл до 100%%')
            check(final['frames'] > 20, 'сплэш жил несколько кадров (не мигнул)')
    finally:
        restore_files(moved)
        check(all(os.path.isfile(os.path.join(ROOT, rel)) for rel in FILES), 'файлы сплэша восстановлены')

    print()
    if failures:
        print('FAILED: %d' % len(failures))
        for f in failures:
            print('  -', f)
        sys.exit(1)
    print('OK: splash')
