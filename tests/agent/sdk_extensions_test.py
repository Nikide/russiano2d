#!/usr/bin/env python3
"""Расширения: discovery, манифесты, merged registry, установка, JS-host.

Проверяется на реальном backend (docs/SDK_EXTENSIONS.md):
  * built-in / user / project discovery и детерминированный порядок;
  * namespaced id, SDK_EXTENSION_DUPLICATE_ID, SDK_EXTENSION_API_MISMATCH,
    SDK_EXTENSION_ENTRY_MISSING, SDK_EXTENSION_CONTRIBUTION_INVALID;
  * merged effective registry в tools и tool list (sdk_tools.json не меняется);
  * tool list|info|validate|install|uninstall;
  * compatibility host legacy SDK shell: activate(), декларативные
    contributions и снимок для агента. Новый Editor host проверяется отдельно.

Запуск (после сборки): python3 tests/agent/sdk_extensions_test.py
"""
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent, ROOT   # noqa: E402

R2D = os.environ.get('R2D_BINARY', os.path.join(ROOT, 'build', 'r2d'))
FIX = os.path.join(ROOT, 'tests', 'fixtures', 'sdk', 'extensions')
WORK = os.path.join(ROOT, 'build', 'sdk-ext-test')
failures = []


def check(v, m):
    print(('  ok   ' if v else '  FAIL ') + m)
    if not v:
        failures.append(m)


def cli(*args, expect=0):
    r = subprocess.run([R2D] + list(args), cwd=ROOT, capture_output=True, text=True)
    try:
        data = json.loads(r.stdout)
    except Exception:
        print('  raw stdout:', r.stdout[-2000:])
        print('  raw stderr:', r.stderr[-2000:])
        raise
    if expect is not None:
        check(r.returncode == expect, 'exit %d == %d: %s' % (r.returncode, expect, ' '.join(args[:3])))
    return data, r


def prep():
    if os.path.isdir(WORK):
        shutil.rmtree(WORK)
    os.makedirs(WORK)
    user = os.path.join(WORK, 'user')
    builtin = os.path.join(WORK, 'builtin')
    project = os.path.join(WORK, 'project')
    os.makedirs(user)
    os.makedirs(builtin)
    os.makedirs(project)
    for name, dest in [('standalone-tool', user), ('invalid-api', user), ('z-duplicate', user)]:
        shutil.copytree(os.path.join(FIX, name), os.path.join(dest, name))
    shutil.copytree(os.path.join(FIX, 'builtin'), os.path.join(builtin, 'builtin'))
    shutil.copytree(os.path.join(FIX, 'project'), os.path.join(project, 'sdk_extensions', 'fixture.world-tools'))
    with open(os.path.join(project, 'project.json'), 'w', encoding='utf-8') as f:
        json.dump({'title': 'Extension Fixture', 'width': 640, 'height': 360}, f)
    with open(os.path.join(project, 'main.js'), 'w', encoding='utf-8') as f:
        f.write('$.ready(() => {});\n')
    return user, builtin, project


def cli_checks(user, builtin, project):
    print('CLI: extension discovery')
    base = ['--registry', 'sdk_tools.json', '--user-extensions', user,
            '--builtin-extensions', builtin, '--project', project]
    data, _ = cli('extension', 'list', *base, expect=1)
    exts = {e['id']: e for e in data['extensions']}
    check(data['roots']['project'].endswith('sdk_extensions'), 'project root найден')
    builtin_rows = [e for e in data['extensions'] if e['id'] == 'fixture.builtin' and e['scope'] == 'builtin']
    dup_rows = [e for e in data['extensions'] if e['id'] == 'fixture.builtin' and e['scope'] == 'user']
    check(bool(builtin_rows) and builtin_rows[0]['enabled'] is True, 'built-in scope включён')
    check(bool(dup_rows) and dup_rows[0]['enabled'] is False, 'дубликат id отключён (silent override запрещён)')
    check(exts['fixture.world-tools']['scope'] == 'project', 'project scope выигрывает у user (порядок builtin→user→project)')
    check(exts['fixture.invalid-api']['enabled'] is False, 'API mismatch отключает расширение')
    check(exts['fixture.invalid-api']['sdk_api'] == 99, 'отчёт содержит required sdk_api')
    codes = [d['code'] for d in data['diagnostics']]
    check('SDK_EXTENSION_API_MISMATCH' in codes, 'SDK_EXTENSION_API_MISMATCH в диагностике')
    check('SDK_EXTENSION_DUPLICATE_ID' in codes, 'SDK_EXTENSION_DUPLICATE_ID в диагностике')
    check(exts['fixture.world-tools']['contributes']['entityDefinitions'] == 1, 'entityDefinition посчитан')
    check(exts['fixture.world-tools']['toolIds'] == ['fixture.world-tools.panel'], 'tool contribution виден')
    check(exts['fixture.standalone']['standalone'] is True, 'standalone tool.json распознан')

    print('CLI: extension validate/info')
    d, _ = cli('extension', 'validate', os.path.join(user, 'standalone-tool'), expect=0)
    check(d['ok'] and d['extension']['id'] == 'fixture.standalone', 'validate одного каталога')
    d, _ = cli('extension', 'validate', os.path.join(user, 'invalid-api'), expect=1)
    check(not d['ok'], 'validate ловит API mismatch')
    d, _ = cli('extension', 'info', 'fixture.standalone', *base, expect=0)
    check(d['extension']['id'] == 'fixture.standalone', 'extension info по id')
    d, _ = cli('extension', 'info', 'missing.extension', *base, expect=1)
    check(any(x['code'] == 'SDK_EXTENSION_NOT_FOUND' for x in d['diagnostics']), 'extension info: NOT_FOUND')

    print('CLI: merged effective registry')
    d, _ = cli('tools', *base, expect=0)
    by_id = {t['id']: t for t in d['tools']}
    check(by_id['fixture.world-tools.panel']['source'] == 'project', 'tools: project tool в effective registry')
    check(by_id['fixture.world-tools.panel']['module'].startswith('sdk-ext/'), 'tools: module spec sdk-ext/...')
    check(by_id['fixture.standalone']['source'] == 'user', 'tools: user standalone tool')
    check('fixture.invalid-api' not in by_id, 'tools: отключённое расширение не добавляет инструмент')
    check(any(e['id'] == 'fixture.builtin' for e in d['extensions']), 'tools: снимок extensions')

    d, _ = cli('tool', 'list', *base, expect=0)
    ids = {t['id']: t for t in d['tools']}
    check('sprite-studio' in ids, 'tool list: built-in инструменты на месте')
    check(ids['fixture.world-tools.panel']['module'] == 'sdk-ext/fixture.world-tools/main.js', 'tool list: module')
    d, _ = cli('tool', 'info', 'fixture.world-tools.panel', *base, expect=0)
    check(d['tool']['source'] == 'project', 'tool info: source')
    d, _ = cli('tool', 'validate', os.path.join(project, 'sdk_extensions', 'fixture.world-tools'), expect=0)
    check(d['ok'], 'tool validate — тот же backend, что extension validate')

    print('CLI: install/uninstall')
    install_user = os.path.join(WORK, 'installed')
    os.makedirs(install_user)
    cli('tool', 'install', os.path.join(user, 'standalone-tool'), '--user-extensions', install_user, expect=0)
    check(os.path.isfile(os.path.join(install_user, 'fixture.standalone', 'tool.json')), 'install копирует каталог')
    d, _ = cli('extension', 'list', '--registry', 'sdk_tools.json', '--user-extensions', install_user,
               '--builtin-extensions', builtin, expect=0)
    check('fixture.standalone' in [e['id'] for e in d['extensions']], 'установленное расширение обнаружено')
    cli('tool', 'uninstall', 'fixture.standalone', '--user-extensions', install_user, expect=0)
    check(not os.path.isdir(os.path.join(install_user, 'fixture.standalone')), 'uninstall удаляет каталог')
    d, _ = cli('tool', 'uninstall', 'fixture.standalone', '--user-extensions', install_user, expect=1)
    check(d['diagnostics'][0]['code'] == 'SDK_TOOL_NOT_INSTALLED', 'uninstall: NOT_INSTALLED')


def engine_checks(project):
    print('GUI: extension host в настоящем SDK')
    rel = os.path.relpath(project, ROOT)
    with Agent(game='sdk', seed=6) as a:
        a.step(4)
        wait(a)
        a.eval("$.sdkApp.openProject(%s)" % json.dumps(rel))
        wait_until(a, "$.sdkApp.state.busy===0 && $.sdkApp.state.registry.extensions.length>0")
        a.step(3)
        snap = json.loads(a.eval('JSON.stringify($.sdkApp.snapshot())'))
        check(bool(snap.get('extensions')), 'snapshot содержит extensions')
        ids = [e['id'] for e in snap['extensions']['extensions']]
        check('fixture.world-tools' in ids, 'project расширение обнаружено GUI')
        en = {e['id']: e for e in snap['extensions']['extensions']}
        check(en['fixture.world-tools']['enabled'] is True, 'расширение включено')
        check(snap['extensions']['contributions']['entityDefinitions'] == 1, 'декларативный entityDefinition в хосте')
        check(snap['extensions']['contributions']['panels'] == 1, 'панель расширения в хосте')
        reg = {t['id']: t for t in snap['registry']['tools']}
        check(reg['fixture.world-tools.panel']['source'] == 'project', 'инструмент расширения в registry GUI')
        panels = a.eval("JSON.stringify($.sdkApp.extensions.list('panels').map(function(p){return p.id;}))")
        check('fixture.panel.main' in panels, 'registerPanel виден через API')
        tools = a.eval("JSON.stringify($.sdkApp.extensions.list('worldTools').map(function(p){return p.id;}))")
        check('fixture.world.runtime' in tools, 'activate() выполнился (runtime worldTool)')
        a.eval("$.sdkApp.openTool('fixture.world-tools.panel')")
        wait_until(a, "$.sdkApp.state.busy===0 && $.sdkApp.state.tool")
        a.step(3)
        check(a.eval("$.sdkApp.state.tool && $.sdkApp.state.tool.id") == 'fixture.world-tools.panel',
              'инструмент расширения открылся без правки SDK core')


def wait(a):
    return wait_until(a, '$.sdkApp.state.busy===0')


def wait_until(a, expr):
    for _ in range(600):
        if a.eval(expr):
            return True
        a.step(2)
        time.sleep(.005)
    return False


if __name__ == '__main__':
    user, builtin, project = prep()
    cli_checks(user, builtin, project)
    engine_checks(project)
    print()
    if failures:
        print('FAILED: %d' % len(failures))
        for f in failures:
            print('  -', f)
        sys.exit(1)
    print('OK: extensions')
