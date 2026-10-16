#!/usr/bin/env python3
# ===========================================================================
# Промах цели в combat/net/prefab: слышен И не заливает журнал (task-48).
#
# Продолжение task-46 (правило для `$`-методов) и task-47 (alive/bsp/camera).
# Здесь промах уже был ГРОМКИМ, но писался на КАЖДЫЙ вызов: `$.combat.attach`
# в кадре или `$.net.replicate` в тике заливали журнал — та же болезнь, что
# была у `$.task`. Правило то же: ключ — СЫРАЯ цель, после успешного
# разрешения серия начинается заново; документированный возврат сохранён.
#
# Тест падает на старом коде: там либо 0 сообщений (health/detach/hit/ownerOf/
# prefab.load — молчание), либо N сообщений вместо одного.
#
# Запуск после сборки:
#   python3 tests/agent/target_miss_combat_net_prefab_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "hello")
FAILURES = []
MISS = "нет-такого"

CAPTURE = """
(function (fn) {
    const ctx = $.ctx;
    const real = ctx.log;
    const seen = [];
    ctx.log = function (msg) { seen.push(String(msg)); };
    try { fn(); } finally { ctx.log = real; }
    return seen;
})
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def logs(a, code):
    return a.eval("(%s)(function () { %s })" % (CAPTURE, code))


def hits(msgs, needle=MISS):
    return [m for m in msgs if needle in m]


def run_combat(a):
    print("--- $.combat ---")
    msgs = logs(a, "$.combat.attach('#%s'); $.combat.attach('#%s'); $.combat.attach('#%s');"
                    % (MISS, MISS, MISS))
    check(len(msgs) == 1, "attach: 3 вызова → 1 сообщение (было 3): %s" % (len(msgs),))
    check(any("combat.attach" in m for m in msgs), "в сообщении назван метод: %s" % (msgs,))
    check(a.eval("$.combat.attach('#%s') === null" % MISS) is True, "attach: возврат null сохранён")

    for method, expr, want in [
        ("health", "$.combat.health('#%s')" % MISS, "null"),
        ("detach", "$.combat.detach('#%s')" % MISS, "false"),
        ("hit", "$.combat.hit('#%s', 30, 'head')" % MISS, "null"),
    ]:
        msgs = logs(a, expr)
        got = a.eval("String(%s)" % expr)
        check(len(msgs) == 1, "%s: промах слышен один раз: %s" % (method, msgs))
        check(got == want, "%s: возврат %s сохранён (получено %s)" % (method, want, got))

    check(logs(a, "$.combat.health('#hero')") == [],
          "рабочий селектор молчит (нет модели — это законный ответ)")
    check(a.eval("$.combat.attach('#hero') !== null") is True, "attach('#hero') работает")

    # Кадры: вызов в кадре не должен заливать журнал. Лог перехватываем один раз
    # и держим, а промах повторяем на каждом кадре — как это делала бы игра.
    a.eval("""
    (function () {
        const ctx = $.ctx;
        globalThis.__miss = [];
        const real = ctx.log;
        ctx.log = function (msg) { if (String(msg).indexOf('нет-в-кадре') >= 0) globalThis.__miss.push(String(msg)); };
        globalThis.__restore = function () { ctx.log = real; };
    })()
    """)
    for _ in range(5):
        a.step(1)
        a.eval("$.combat.health('#нет-в-кадре')")
    count = a.eval("globalThis.__miss.length")
    a.eval("globalThis.__restore()")
    check(count == 1, "combat.health в кадре: 5 вызовов → сообщений %s (ждали 1)" % (count,))


def run_net(a):
    print("--- $.net ---")
    msgs = logs(a, "$.net.replicate('#%s'); $.net.replicate('#%s');" % (MISS, MISS))
    check(len(msgs) == 1, "replicate: 2 вызова → 1 сообщение (было 2): %s" % (len(msgs),))
    check(any("net.replicate" in m for m in msgs), "в сообщении назван метод: %s" % (msgs,))
    check(a.eval("$.net.replicate('#%s')" % MISS) == 0, "replicate: возврат 0 сохранён")

    for method, expr, want in [
        ("unreplicate", "$.net.unreplicate('#%s')" % MISS, "0"),
        ("ownerOf", "$.net.ownerOf('#%s')" % MISS, "0"),
        ("idOf", "$.net.idOf('#%s')" % MISS, "0"),
        ("owns", "$.net.owns(1, '#%s')" % MISS, "false"),
    ]:
        msgs = logs(a, expr)
        got = a.eval("String(%s)" % expr)
        check(len(msgs) == 1, "%s: промах слышен один раз: %s" % (method, msgs))
        check(got == want, "%s: возврат %s сохранён (получено %s)" % (method, want, got))

    check(logs(a, "$.net.idOf('#hero')") == [], "рабочий селектор молчит")
    check(a.eval("$.net.idOf('#hero')") != 0, "idOf('#hero') отвечает как раньше")


def run_prefab(a):
    print("--- $.prefab ---")
    msgs = logs(a, "$.prefab.save('#%s'); $.prefab.save('#%s');" % (MISS, MISS))
    check(len(msgs) == 1, "save: 2 вызова → 1 сообщение (было 2): %s" % (len(msgs),))
    check(a.eval("$.prefab.save('#%s') === null" % MISS) is True, "save: возврат null сохранён")

    data = a.eval("JSON.stringify($.prefab.save('#hero'))")
    check(isinstance(data, str) and len(data) > 2, "save('#hero') отдаёт данные")

    msgs = logs(a, "$.prefab.load(%s, '#%s')" % (data, MISS))
    check(len(msgs) == 1, "load с промахом родителя слышен: %s" % (msgs,))
    check(any("load" in m for m in msgs), "в сообщении назван load: %s" % (msgs,))

    msgs = logs(a, "$.prefab.instantiate(%s, { parent: '#%s' })" % (data, MISS))
    check(len(msgs) == 1, "instantiate с промахом родителя слышен: %s" % (msgs,))

    msgs = logs(a, "$.prefab.instantiate(%s, { parent: '#hero' })" % data)
    check(msgs == [], "instantiate с рабочим родителем молчит: %s" % (msgs,))
    check(a.eval("$('#hero').children().length") >= 1, "instantiate прикрепил к #hero")


def run_doc_examples(a):
    """Примеры docs/highlevel/{combat,net,prefab}.md с селекторами — кодом."""
    print("--- примеры доков (combat.md 21/22/25/53/76/111, net.md 15, prefab.md 65/66/139) ---")
    a.eval("""(function(){
        $('<enemy>', { id: 'enemy' }).at(500, 300).size(28, 40).health(30).appendTo($.world);
        $('<rect>', { id: 'cave' }).at(700, 300).size(80, 80).appendTo($.world);
    })()""")
    a.step(1)

    cases = [
        ("$.combat.attach('#hero') !== null", True, "combat.md:21 attach('#hero')"),
        ("$.combat.attach('#enemy', { onDeath: () => {} }) !== null", True, "combat.md:22 attach с opts"),
        ("typeof $.combat.hit('#enemy', 35, 'head')", "object", "combat.md:25 hit('#enemy', 35, 'head')"),
        ("$.combat.health('#hero') !== null", True, "combat.md:53 health('#hero')"),
        ("typeof $.combat.detach('#hero')", "boolean", "combat.md:76 detach('#hero')"),
        ("typeof $.combat.hit('#hero', 35, 'chest', { armor: 10 })", "object", "combat.md:111 hit с armor"),
        ("$.prefab.save('#hero') !== null", True, "prefab.md:139 save по селектору"),
        ("$.prefab.clone('#hero').length", 1, "prefab.md:66 clone('#hero')"),
        ("$.prefab.load($.prefab.save('#hero'), $('#cave')).length", 1, "prefab.md:65 load внутрь $('#cave')"),
    ]
    for code, want, label in cases:
        got = a.eval(code)
        check(got == want, "%s → %s" % (label, got))

    # net.md:15 — серверная форма: поднимаем хост и объявляем репликацию.
    hosted = a.eval("$.net.bindEngine(); $.net.host(47881, { maxPlayers: 2 })")
    a.step(1)
    if hosted:
        replicated = a.eval("$.net.replicate('#hero', { owner: 1 })")
        check(isinstance(replicated, int) and replicated > 0,
              "net.md:15 replicate('#hero', { owner: p }) → %s" % (replicated,))
    else:
        check(False, "net.md:15 не проверить: хост не поднялся (%s)" % (hosted,))
    a.eval("$.net.leave()")


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)
        run_combat(a)
        run_net(a)
        run_prefab(a)
        run_doc_examples(a)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки промахов combat/net/prefab пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
