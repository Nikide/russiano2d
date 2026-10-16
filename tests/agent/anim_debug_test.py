#!/usr/bin/env python3
# ===========================================================================
# §36. Animation debugger: отладочный оверлей анимационного плеера.
#
# Проверяется на реальном движке (фикстура tests/fixtures/anim_debug — клип
# `attack` с gameplay-окном 150..400 мс) и на пикселях кадра:
#   * по умолчанию оверлей ВЫКЛЮЧЕН: $.debug.draw.* не зовётся, кадр не меняется;
#   * данные оверлея совпадают с $.anim.playersOn() и $.anim.nodeState():
#     клип, время, скорость, слоты, счётчик плееров;
#   * окно удара на оверлее — РЕАЛЬНОЕ окно: интервал берётся из маркеров
#     клипа, а `open` совпадает с $.anim.player().window('attack') и на
#     открытии, и после закрытия;
#   * дорожки и точки событий совпадают с bindings() и событиями клипа;
#   * выключение возвращает РОВНО прежний кадр (анимация на паузе — кадр
#     отличается только оверлеем).
#
# Запуск после сборки:
#   python3 tests/agent/anim_debug_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/anim_debug_test.py
# ===========================================================================

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "anim_debug")
FAILURES = []

PATCH = """
(() => {
  globalThis.__andbg = { rect: [], line: [], circle: [], ring: [], text: [], arrow: [] };
  for (const k of Object.keys(globalThis.__andbg)) {
    const orig = $.debug.draw[k];
    $.debug.draw[k] = (...args) => {
      if (k === 'rect') globalThis.__andbg.rect.push([args[0].x, args[0].y, args[1].x, args[1].y]);
      else if (k === 'line') globalThis.__andbg.line.push([args[0].x, args[0].y, args[1].x, args[1].y]);
      else if (k === 'circle' || k === 'ring') globalThis.__andbg[k].push([args[0].x, args[0].y, args[1]]);
      else if (k === 'text') globalThis.__andbg.text.push(String(args[0]));
      return orig(...args);
    };
  }
  return true;
})()
"""

RESET = ("globalThis.__andbg = { rect: [], line: [], circle: [], ring: [], text: [], arrow: [] };"
         " true")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def calls(a):
    return json.loads(a.eval("JSON.stringify(globalThis.__andbg)"))


def image(path):
    return Image.open(path).convert("RGB")


def same_pixels(path_a, path_b):
    ia, ib = image(path_a), image(path_b)
    if ia.size != ib.size:
        return ia.size[0] * ia.size[1]
    pa, pb = ia.load(), ib.load()
    diff = 0
    for y in range(ia.size[1]):
        for x in range(ia.size[0]):
            if pa[x, y] != pb[x, y]:
                diff += 1
    return diff


def near(a, b, tol=1e-6):
    return abs(a - b) <= tol


def main():
    shots = os.path.join(ROOT, "build")

    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(4)
        a.eval(PATCH)

        # --- по умолчанию выключен --------------------------------------------
        facts = a.eval("$.anim.debug()")
        check(facts["on"] is False, "оверлей анимации по умолчанию выключен")
        check(facts["drawn"] is None, "у выключенного оверлея нет фактов кадра")
        a.eval(RESET)
        a.step(3)
        idle = calls(a)
        check(sum(len(idle[k]) for k in idle) == 0,
              "без оверлея $.debug.draw.* не зовётся: %s" % {k: len(v) for k, v in idle.items()})

        # --- клип удара: время внутри окна -------------------------------------
        a.step(6)                       # ~11 кадров ≈ 183 мс
        time_ms = a.eval("$.anim.player('hero').time()")
        check(150 <= time_ms < 400, "герой внутри окна удара: %.1f мс" % time_ms)
        check(a.eval("$.anim.player('hero').window('attack')") is True,
              "окно attack действительно открыто игрой")

        a.eval(RESET)
        facts = a.eval("$.anim.debug('#hero')")
        a.step(1)
        drawn = a.eval("$.anim.debug().drawn")

        check(facts["on"] is True, "оверлей включается селектором узла")
        check(facts["node"] and facts["node"]["nid"] is not None, "факты называют узел")
        check(len(facts["players"]) == 1 and facts["players"][0]["name"] == "hero",
              "в отчёте ровно плеер героя: %s" % [p["name"] for p in facts["players"]])
        hero = facts["players"][0]
        check(hero["clip"] == "attack", "текущий клип — attack: %s" % hero["clip"])
        check(hero["duration"] == 600, "длительность клипа — 600 мс: %s" % hero["duration"])
        check(hero["loop"] == "once", "эффективный режим повтора — once: %s" % hero["loop"])
        check(near(hero["speed"], 1), "скорость плеера — 1: %s" % hero["speed"])
        check(near(hero["normalized"], hero["time"] / 600, 1e-9),
              "нормированное время посчитано от длительности клипа")
        check(hero["clock"] == "simulation", "часы плеера названы: %s" % hero["clock"])

        # --- данные оверлея == playersOn()/nodeState() --------------------------
        verdict = a.eval("""
        (() => {
          const node = $('#hero').get(0);
          const list = $.anim.playersOn(node);
          const st = $.anim.nodeState(node);
          if (!st || !st.players) return 'nodeState пуст';
          const f = $.anim.debug();
          if (f.players.length !== list.length) return 'playersOn=' + list.length + ' facts=' + f.players.length;
          for (const p of f.players) {
            const ps = st.players[p.name];
            if (!ps) return 'нет состояния плеера ' + p.name;
            const live = list.find((x) => x.name === p.name);
            if (!live) return 'нет живого плеера ' + p.name;
            if (live.clip() !== p.clip) return 'клип: ' + live.clip() + ' != ' + p.clip;
            if (Math.abs(live.time() - p.time) > 1e-6) return 'время расходится';
            if (Math.abs(live.total() - p.total) > 1e-6) return 'часы расходятся';
            if (live.speed() !== p.speed) return 'скорость расходится';
            if (live.paused() !== p.paused) return 'пауза расходится';
            if (ps.slots.length !== p.slots.length) return 'слотов ' + ps.slots.length + ' != ' + p.slots.length;
            if (ps.slots[0].clip !== p.slots[0].clip) return 'слот не тот';
            if (ps.slots[0].loop !== p.slots[0].loop) return 'режим слота не тот';
            const open = ps.windows.map((w) => w.name).sort().join(',');
            const shown = f.windows.filter((w) => w.open).map((w) => w.name).sort().join(',');
            if (open !== shown) return 'окна: state=[' + open + '] overlay=[' + shown + ']';
          }
          return 'ok';
        })()
        """)
        check(verdict == "ok", "отчёт оверлея совпал с playersOn()/nodeState(): %s" % verdict)

        # --- окно удара: интервал из маркеров клипа -----------------------------
        spans = a.eval("$.anim.debug().windows")
        check(len(spans) == 1, "у клипа одно окно: %s" % spans)
        span = spans[0]
        check(span["name"] == "attack" and span["openAt"] == 150 and span["closeAt"] == 400,
              "границы окна — из маркеров клипа: %s..%s" % (span["openAt"], span["closeAt"]))
        check(span["open"] is True, "оверлей видит окно открытым внутри интервала")
        markers = a.eval("""
        (() => {
          const t = $.anim.clipGet('attack');
          return t.events.filter((e) => e.window === 'attack')
                         .map((e) => [e.name, e.at, e.windowPhase]);
        })()
        """)
        check(sorted(markers) == sorted([["attack-open", 150, "open"], ["attack-close", 400, "close"]]),
              "маркеры окна в клипе — те же, что показал оверлей: %s" % markers)

        # --- дорожки и точки событий -------------------------------------------
        tracks = a.eval("$.anim.debug().tracks")
        live_bindings = a.eval("$.anim.player('hero').bindings()")
        check(len(tracks) == len(live_bindings) and len(tracks) > 0,
              "дорожек в отчёте столько же, сколько у плеера: %d/%d"
              % (len(tracks), len(live_bindings)))
        check(sorted(t["id"] for t in tracks) == sorted(b["id"] for b in live_bindings),
              "имена дорожек совпали с bindings(): %s" % sorted(t["id"] for t in tracks))
        check(all(t["resolved"] is True for t in tracks), "все дорожки разрешены в цели")
        events = a.eval("$.anim.debug().events")
        clip_events = a.eval("$.anim.clipGet('attack').events.map((e) => [e.name, e.at])")
        check(sorted([e["name"], e["at"]] for e in events) == sorted(clip_events),
              "точки событий совпали с событиями клипа: %s" % sorted([e["name"] for e in events]))

        # Что именно нарисовано: полоса, окно и засечки событий.
        check(drawn["bars"] == 1, "полоса клипа нарисована: %s" % drawn["bars"])
        check(drawn["windows"] == 1, "окно удара подсвечено на полосе: %s" % drawn["windows"])
        check(drawn["ticks"] == 4, "засечек по событиям клипа четыре: %s" % drawn["ticks"])
        check(drawn["primitives"]["texts"] >= 3, "подписи оверлея нарисованы: %s"
              % drawn["primitives"]["texts"])
        recorded = calls(a)
        check(any("hero: attack" in t for t in recorded["text"]),
              "подпись называет плеер и клип: %s" % recorded["text"][:2])
        check(any("окна: attack" in t for t in recorded["text"]),
              "подпись называет открытое окно: %s" % recorded["text"][-1:])

        # --- окно закрывается по маркеру, а не «примерно» -----------------------
        a.step(16)                      # > 400 мс
        later = a.eval("$.anim.player('hero').time()")
        check(later >= 400, "герой дошёл до закрытия окна: %.1f мс" % later)
        check(a.eval("$.anim.player('hero').window('attack')") is False,
              "игра закрыла окно attack")
        closed = a.eval("$.anim.debug().windows")[0]
        check(closed["open"] is False,
              "оверлей тоже видит окно закрытым: %s" % closed["open"])
        check(closed["openAt"] == 150 and closed["closeAt"] == 400,
              "границы окна не «поехали» после закрытия")

        # --- выбор узла: оверлей показывает плееров выбранного узла -------------
        other = a.eval("$.anim.debug('#other')")
        check(len(other["players"]) == 1 and other["players"][0]["name"] == "other",
              "переключение на #other показывает его плеер: %s"
              % [p["name"] for p in other["players"]])
        check(other["players"][0]["clip"] == "idle", "клип второго узла — idle")
        check(other["node"]["x"] == 120, "узел в отчёте — именно #other")
        back = a.eval("$.anim.debug('#hero')")
        check(back["players"][0]["name"] == "hero" and len(back["events"]) == 4,
              "возврат на #hero вернул его события")

        # --- пиксели: пауза + оверлей ------------------------------------------
        # Оверлей выключаем ДО базового кадра: иначе «до» уже содержит полосу.
        a.eval("$.anim.debug(false)")
        a.eval("$.anim.player('hero').pause()")
        a.step(4)
        base_a = a.screenshot(os.path.join(shots, "anim_debug_off_a.png"))
        a.step(3)
        base_b = a.screenshot(os.path.join(shots, "anim_debug_off_b.png"))
        stable = same_pixels(base_a, base_b)
        check(stable == 0, "на паузе кадр без оверлея стабилен (%d пикселей различия)" % stable)

        a.eval(RESET)
        a.eval("$.anim.debug('#hero')")
        a.step(3)
        on_shot = a.screenshot(os.path.join(shots, "anim_debug_on.png"))
        diff_on = same_pixels(base_a, on_shot)
        check(diff_on > 0, "включённый оверлей видно на кадре (%d пикселей)" % diff_on)
        on_drawn = a.eval("$.anim.debug().drawn")
        check(on_drawn and on_drawn["bars"] == 1,
              "оверлей рисуется и на паузе (полоса клипа): %s" % (on_drawn or {}).get("bars"))

        a.eval(RESET)
        a.eval("$.anim.debug(false)")
        a.step(3)
        off_shot = a.screenshot(os.path.join(shots, "anim_debug_off_again.png"))
        check(same_pixels(base_a, off_shot) == 0, "выключение вернуло прежний вид")
        after = calls(a)
        check(sum(len(after[k]) for k in after) == 0, "после выключения примитивов нет")
        check(a.eval("$.anim.debug().on") is False, "факты подтверждают выключение")
        check(a.eval("$.anim.debug().players") == [], "у выключенного оверлея нет отчёта")

        # --- частичное выключение: полоса без окон и событий --------------------
        a.eval(RESET)
        a.eval("$.anim.debug('#hero', { windows: false, events: false })")
        a.step(1)
        partial = a.eval("$.anim.debug().drawn")
        check(partial["bars"] == 1 and partial["windows"] == 0 and partial["ticks"] == 0,
              "флаги windows/events снимают подсветку: %s" % partial)

        # --- неизвестный узел не включает оверлей -------------------------------
        a.eval("$.anim.debug(false)")
        missing = a.eval("$.anim.debug('#нет-такого-узла')")
        check(missing["on"] is False, "неизвестный узел не включает оверлей")
        check(a.eval("$.anim.debug().drawn") is None, "и ничего не рисует")

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки §36 (animation debugger) пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
