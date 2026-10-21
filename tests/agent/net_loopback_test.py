#!/usr/bin/env python3
# ===========================================================================
# High-level ENet loopback: two runtime instances use only $.net.
#
# This acceptance scenario deliberately does not inspect engine.net* or ENet
# sockets. It exercises the gameplay contract: availability, authoritative host
# and join, automatic polling, messages, stats and clean shutdown.
#
# Run after an xmake build:
#   python3 tests/agent/net_loopback_test.py
# ===========================================================================

import os
import socket
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def free_port():
    """Reserve a UDP ephemeral port briefly, then return it for ENet."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def pump(server, client, n=1):
    for _ in range(n):
        server.step(1)
        client.step(1)
        time.sleep(0.01)


def main():
    port = free_port()
    print(f"  UDP port: {port}")
    with Agent(game=GAME, seed=5) as server, Agent(game=GAME, seed=6) as client:
        check(server.eval("$.net.available()") is True,
              "built-in ENet transport is available through $.net")
        check(server.eval("$.net.topology()") == "authoritative",
              "authoritative topology is the default")

        server.eval("""
            globalThis.__netLog = [];
            $.net.on('connect', peer => __netLog.push('connect:' + peer.id));
            $.net.on('input', (data, peerId) => __netLog.push('input:' + data.seq + ':' + peerId));
            $.net.host(%d, { maxPeers: 4 });
        """ % port)
        client.eval("""
            globalThis.__netLog = [];
            $.net.on('connect', peer => __netLog.push('connect:' + peer.id));
            $.net.join('127.0.0.1', %d);
        """ % port)

        connected = False
        for _ in range(100):
            pump(server, client)
            if server.eval("$.net.peers().length") == 1 and client.eval("$.net.peers().length") == 1:
                connected = True
                break
        check(connected, "host and client established an ENet peer connection")
        check("connect:" in server.eval("__netLog.join('|')"),
              "host received a high-level connect event")
        check("connect:" in client.eval("__netLog.join('|')"),
              "client received a high-level connect event")

        check(client.eval("$.net.send('input', { seq: 1, moveX: 1 }, { delivery: 'input' })") is True,
              "client sent input through $.net")
        received = False
        for _ in range(60):
            pump(server, client)
            if "input:1:" in server.eval("__netLog.join('|')"):
                received = True
                break
        check(received, "host received the input event without manual transport polling")
        check(client.eval("$.net.stats().sent") > 0, "high-level sent counter advanced")
        check(server.eval("$.net.stats().received") > 0, "high-level received counter advanced")

        client.eval("$.net.simulate({ loss: 100, delay: 0, seed: 7 })")
        before = server.eval("$.net.stats().received")
        client.eval("$.net.send('input', { seq: 2 }, { delivery: 'input' })")
        pump(server, client, 12)
        check(server.eval("$.net.stats().received") == before,
              "high-level loss simulation can drop an outgoing message")
        check(client.eval("$.net.stats().dropped") > 0,
              "dropped-message counter is visible through $.net.stats()")

        client.eval("$.net.simulate({ loss: 0, delay: 0, jitter: 0 })")
        client.eval("$.net.leave()")
        server.eval("$.net.leave()")
        check(client.eval("$.net.online()") is False, "client session closed")
        check(server.eval("$.net.online()") is False, "host session closed")

    print()
    if FAILURES:
        print(f"FAILURES: {len(FAILURES)}")
        for failure in FAILURES:
            print("  - " + failure)
        return 1
    print("All checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
