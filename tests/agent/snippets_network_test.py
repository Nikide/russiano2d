#!/usr/bin/env python3
"""Generated ready-check: real host/client, minimum, readiness and disconnect."""
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent
from snippets_mechanics_test import r2d
from net_loopback_test import free_port, pump


def main():
    with tempfile.TemporaryDirectory(prefix='r2d-sn-net-') as tmp:
        root = Path(tmp)
        (root / 'main.js').write_text('$.ready(() => {});')
        (root / 'project.json').write_text(json.dumps({'schema_version': 2, 'project': {'name': 'Ready', 'version': '1.0.0'}, 'runtime': {'entry': 'main.js'}}))
        assert r2d('project-index', tmp, '--write')['ok']
        assert r2d('snippet', 'add', tmp, 'net.ready-check', '--owner', 'project')['ok']
        assert r2d('snippet', 'generate', tmp, '--write')['ok']
        port = free_port()
        with Agent(game=tmp, seed=1) as host, Agent(game=tmp, seed=2) as client:
            for a in (host, client):
                a.step(3)
                a.eval("globalThis.starts=0;globalThis.ready=-1;globalThis.blocks=0;$.on('match:start',()=>starts++);$.on('ready:changed',e=>{ready=e.data.ready});$.on('ready:blocked',()=>blocks++);'ok'")
            host.eval('$.net.host(%d,{maxPeers:4});1' % port)
            host.eval("$.emit('ready:toggle');1")
            assert host.eval('starts') == 0 and host.eval('blocks') == 1, 'minimum includes host exactly once'
            client.eval("$.net.join('127.0.0.1',%d);1" % port)
            for _ in range(100):
                pump(host, client)
                if host.eval('$.net.playerCount()') == 2:
                    break
            assert host.eval('$.net.playerCount()') == 2, 'client connects'
            host.eval("$.emit('ready:toggle');1")
            assert host.eval('starts') == 0, 'unready client blocks start'
            client.eval("$.emit('ready:toggle');1")
            for _ in range(100):
                pump(host, client)
                if host.eval('ready') == 1:
                    break
            assert host.eval('ready') == 1, 'host receives client ready'
            host.eval("$.emit('ready:toggle');1")
            for _ in range(100):
                pump(host, client)
                if client.eval('starts'):
                    break
            assert [host.eval('starts'), client.eval('starts')] == [1, 1], 'match starts once on both peers'
            client.eval('$.net.disconnect($.net.peers()[0].id);1')
            for _ in range(100):
                pump(host, client)
                if host.eval('$.net.playerCount()') == 1:
                    break
            assert host.eval('$.net.playerCount()') == 1, 'disconnect delivered'
            assert host.eval('ready') == 0, 'disconnect removes stale readiness'
            assert not host.eval('$.debug.errors()') and not client.eval('$.debug.errors()')
    print('snippets_network_test: ok')

if __name__ == '__main__':
    os.environ.setdefault('R2D_BINARY', str(ROOT / 'build-xmake/macos-arm64/macosx/arm64/release/r2d'))
    main()
