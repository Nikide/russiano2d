#!/usr/bin/env python3
# ===========================================================================
# §9. Общий damage contract: роли форм, attack instance, дедупликация,
# причины отказа, отражение, физическая отдача и presentation-статус $.hits.
#
# Фикстура: tests/fixtures/controller_combat/main.js.
#
# Запуск:
#   python3 tests/agent/highlevel_combat_contract_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "controller_combat")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def make_attack(a, amount=20, **extra):
    """Создать атаку из #hero через $.combat.attack и вернуть её объект."""
    spec = {"source": "#hero", "team": 1, "window": 500, "amount": amount}
    spec.update(extra)
    a.eval(f"$.store.set('atk', $.combat.attack({_js(spec)}))")
    return a.eval("$.store.get('atk')")


def _js(value):
    """Python → JS-литерал (только простые типы фикстуры)."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str) and value.startswith("#"):
        return f"'{value}'"
    if isinstance(value, dict):
        return "{" + ", ".join(f"{k}: {_js(v)}" for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ", ".join(_js(v) for v in value) + "]"
    return f"'{value}'"


def strike(a, area="blade", opts=None):
    """Ударить текущей атакой из $.store.get('atk') по кандидатам areaOverlap."""
    return a.eval(
        f"$.combat.strike($.store.get('atk'), $('#hero').areaOverlap('{area}'), {_js(opts or {})})")


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(5)

        # --- Роли форм: metadata существующего узла, не компоненты -----------
        roles = a.eval("$('#dummy').areas().map((x) => x.role).join(',')")
        check(roles == "hurtbox,hurtbox", f"hurtbox-роли объявлены ({roles})")
        blade = a.eval("$('#hero').area('blade')")
        check(isinstance(blade, dict) and blade.get("role") == "hitbox",
              "hitbox объявлен с ролью")
        check(a.eval("$('#dummy').get(0).body >= 0")
              and a.eval("$('#hero').get(0).body >= 0"),
              "movement collider остаётся телом узла")

        # --- Одна атака: две hurtbox цели = ОДИН gameplay-hit ----------------
        hp0 = a.eval("$('#dummy').hp()")
        make_attack(a)
        res = strike(a)
        check(res.get("accepted") == 1,
              f"две hurtbox одной цели — один удар (принято {res.get('accepted')})")
        hp1 = a.eval("$('#dummy').hp()")
        check(hp1 == hp0 - 20, f"урон применён один раз ({hp0:.0f} → {hp1:.0f})")

        # --- Повтор той же атаки — duplicate, новая атака — снова урон -------
        again = strike(a)
        check(again.get("rejected") == 1
              and again.get("results", [{}])[0].get("reason") == "duplicate",
              f"повтор той же атаки отклонён (duplicate): {again.get('results')}")
        check(a.eval("$('#dummy').hp()") == hp1, "отказ не меняет здоровье")

        make_attack(a)
        res2 = strike(a)
        check(res2.get("accepted") == 1 and a.eval("$('#dummy').hp()") == hp1 - 20,
              "новая атака поражает ту же цель снова")

        # --- Причины отказа: team, immunity, destroyed, inactive window -----
        make_attack(a, team=1)
        team_res = a.eval(
            "$.combat.damageRequest({ amount: 20, source: '#hero', target: '#ally', team: 1, friendlyFire: false })")
        check(team_res.get("reason") == "team", f"своя команда отклонена ({team_res.get('reason')})")
        check(a.eval("$('#ally').hp()") == 100, "урон союзнику не применён")

        ghost_res = a.eval(
            "$.combat.damageRequest({ amount: 20, source: '#hero', target: '#ghost' })")
        check(ghost_res.get("reason") == "immunity",
              f"неуязвимость — фактическая причина ({ghost_res.get('reason')})")
        check(a.eval("engine.bodyEnabled($('#ghost').get(0).body)") is True,
              "invulnerability НЕ отключает movement collider")
        check(a.eval("$('#ghost').collidesWith('#dummy')") is True,
              "invulnerability не меняет слои/маски движения")

        corpse_res = a.eval(
            "$.combat.damageRequest({ amount: 20, source: '#hero', target: '#corpse' })")
        check(corpse_res.get("reason") == "destroyed_target",
              f"мёртвая цель — destroyed_target ({corpse_res.get('reason')})")

        a.eval("$.store.set('atk2', $.combat.attack({ source: '#hero', team: 1, amount: 10, window: 1 }))")
        a.step(5)   # окно 1 мс давно закрыто
        late = a.eval("$.combat.strike($.store.get('atk2'), ['#dummy'])")
        check(late.get("reason") == "inactive_window",
              f"закрытое окно — inactive_window ({late.get('reason')})")

        # --- Смерть ровно один раз ------------------------------------------
        a.eval("$('#dummy').hp(15)")
        a.eval("$.store.set('atk3', $.combat.attack({ source: '#hero', team: 1, amount: 50, window: 500 }))")
        kill = a.eval("$.combat.strike($.store.get('atk3'), ['#dummy'])")
        first = kill.get("results", [{}])[0]
        check(first.get("death") is True, f"смертельный удар помечен death ({first})")
        second = a.eval(
            "$.combat.damageRequest({ amount: 50, source: '#hero', target: '#dummy' })")
        check(second.get("reason") == "destroyed_target" and second.get("death") is False,
              f"второй урон по мёртвому не «убивает» снова ({second.get('reason')})")

        # --- Атака умершего владельца: явное правило -------------------------
        # Правило 'continue': атака продолжает жить, но попадание отклоняется
        # фактической причиной owner_dead.
        a.eval("$('#hero').hp(0)")
        a.eval("$.store.set('atk4', $.combat.attack({ source: '#hero', team: 1, amount: 10, window: 500, onOwnerDeath: 'continue' }))")
        dead_owner2 = a.eval(
            "$.combat.damageRequest({ amount: 10, attack: $.store.get('atk4'), source: '#hero', target: '#ally', friendlyFire: true })")
        check(dead_owner2.get("reason") == "owner_dead",
              f"атака умершего владельца: owner_dead по правилу continue ({dead_owner2.get('reason')})")

        a.eval("$('#hero').hp(0)")
        a.eval("$.store.set('atk5', $.combat.attack({ source: '#hero', team: 3, amount: 10, window: 500 }))")
        cancel_res = a.eval(
            "$.combat.damageRequest({ amount: 10, attack: $.store.get('atk5'), source: '#hero', target: '#ally', team: 3 })")
        check(cancel_res.get("reason") == "inactive_window"
              and a.eval("$.store.get('atk5').cancelled") is True,
              "правило cancel закрывает атаку умершего владельца")
        a.eval("$('#hero').hp(100)")

        # --- Отражение: новая identity, owner/team по политике ---------------
        a.eval("""$.store.set('src', $.combat.attack({ source: '#hero', owner: '#hero', team: 1,
                                                        amount: 20, damageType: 'bullet', window: 500 }))""")
        refl = a.eval(
            "(() => { const r = $.combat.reflect($.store.get('src'),"
            " { owner: '#ally', team: 3, multiplier: 2 }); $.store.set('refl', r); return r; })()")
        check(refl.get("id") != a.eval("$.store.get('src').id"),
              "отражение — новая attack identity")
        check(refl.get("owner_id") == a.eval("$('#ally').nid()"),
              f"отражение меняет владельца ({refl.get('owner_id')})")
        check(refl.get("amount") == 40, f"урон по политике отражения ({refl.get('amount')})")
        check(a.eval("$.store.get('src').reflectedBy") == refl.get("id"),
              "старая атака помечена reflectedBy")

        # --- Отражённая атака обычна по форме: журналы, сводка, фильтр -------
        check(isinstance(refl.get("hits"), list),
              f"reflect() создаёт журнал hits[] ({type(refl.get('hits')).__name__})")
        check(isinstance(refl.get("hit_targets"), dict) and isinstance(refl.get("cooldown_until"), dict),
              "hit_targets и cooldown_until созданы")
        listed = a.eval(f"$.combat.attacks()")
        check(isinstance(listed, list) and any(x.get("id") == refl.get("id") for x in listed),
              "$.combat.attacks() не падает и видит отражённую атаку")
        # Фильтр по владельцу: отражённая принадлежит #ally, не #hero.
        by_owner = a.eval(f"$.combat.attacks({_js(a.eval('$(\"#ally\").nid()'))})")
        check(isinstance(by_owner, list) and len(by_owner) >= 1
              and all(x.get("owner_id") == a.eval("$('#ally').nid()") for x in by_owner),
              f"attacks(owner) отбирает по владельцу ({len(by_owner)} шт.)")
        wrong_owner = a.eval("$.combat.attacks('нет-такого-nid')")
        check(wrong_owner == [], "attacks(чужой owner) пуст")
        # Атаку, собранную руками (без журналов), движок не роняет.
        manual = a.eval("""(() => {
            const atk = { id: 999, until: $.time.now() + 10, amount: 5, rehit: 'once',
                          hit_targets: {}, hits: [] };
            delete atk.hits; delete atk.hit_targets;
            const res = $.combat.strike(atk, ['#dummy']);
            return { accepted: res.accepted, hasHits: Array.isArray(atk.hits),
                     hasTargets: !!atk.hit_targets, reason: res.results.length ? res.results[0].reason : null };
        })()""")
        check(manual.get("hasHits") is True and manual.get("hasTargets") is True,
              f"атака, собранная руками, получает журналы ({manual})")
        # Сводка по цели: отражённая атака бьёт союзника (её команда 3 ≠ 1).
        struck = a.eval("""(() => {
            const atk = $.store.get('refl');
            const res = $.combat.strike(atk, ['#ally']);
            return { accepted: res.accepted, hits: atk.hits.length,
                     logged: Object.keys(atk.hit_targets).length };
        })()""")
        check(struck.get("hits") == 1 and struck.get("logged") == 1,
              f"отражённая атака пишет попадание в свой журнал ({struck})")
        by_target = a.eval(f"$.combat.attacks({{ target: {_js(a.eval('$(\"#ally\").nid()'))} }})")
        check(isinstance(by_target, list) and len(by_target) >= 1,
              f"attacks({{target}}) отбирает по цели ({len(by_target)} шт.)")

        # --- $.hits играет прямо по ответу §9 --------------------------------
        played = a.eval("""(() => {
            const res = $.combat.damageRequest({ amount: 3, source: '#hero', target: '#ally',
                                                 friendlyFire: true });
            const out = $.hits.play(res, { particles: false, shake: 0, hitStop: 0, squash: 0 });
            return { accepted: res.accepted, hasX: typeof res.x === 'number',
                     target: out && out.target ? out.target.nid : null,
                     plays: $.hits.stats().plays };
        })()""")
        check(played.get("accepted") is True and played.get("hasX") is True,
              f"ответ несёт точку презентации ({played})")
        check(played.get("target") == a.eval("$('#ally').nid()"),
              f"$.hits находит цель ответа по nid без ручного {{x,y,self}} ({played.get('target')})")

        # --- Физическая отдача: импульс не стирается управлением -------------
        kx0 = a.eval("$('#knockee').pos().x")
        kn = a.eval("""$.combat.damageRequest({ amount: 5, source: '#hero', target: '#knockee',
                                                impulse: { x: 220, y: 0 }, dir: { x: 1, y: 0 } })""")
        check(kn.get("accepted") is True and kn.get("applied") == 5,
              f"damage с импульсом применён ({kn})")
        a.step(6)
        kx1 = a.eval("$('#knockee').pos().x")
        check(kx1 - kx0 > 5,
              f"отдача — физическое движение, а не косметика ({kx1 - kx0:.1f} px)")

        # --- $.hits — presentation, не источник урона ------------------------
        plays = a.eval("$.hits.stats().plays")
        make_attack(a)
        strike(a)
        check(a.eval("$.hits.stats().plays") == plays,
              "урон применён без единого вызова $.hits (presentation отдельно)")
        check(isinstance(a.eval("$.combat.refusalReasons()"), list)
              and len(a.eval("$.combat.refusalReasons()")) == 8,
              "список причин отказа доступен машине")

        if FAILURES:
            print(a.stderr_tail(15))

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
