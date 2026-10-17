#!/usr/bin/env python3
"""Scene-W crossover acceptance (roadmap §141): VN + Re2D in one agent scene.

The whole chain is driven through public APIs on the `tests/fixtures/within`
game, which is otherwise an empty 2D scene:

  player input -> native world trigger enter
    -> $.cutscene takes input and cinematic mode
    -> Re2D camera/view looks at W (a native world sprite)
    -> W is lit by a Re2D world light and rendered by the world compositor
    -> $.dialog plays a custom BASHNYA RML/RCSS/font theme
    -> expression changes neutral -> angry
    -> continuous environmental VFX keep running during the scene
    -> gameplay choice commits state and spawns the native `vanish` FX bundle
    -> W disappears, input returns, player moves again

Assertions use engine state/counters and real screenshots; no method-existence
checks count as a pass.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_native_test import decode  # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
FAILED = []
BEFORE = os.path.join(ROOT, "build", "scene_w_before.png")
AFTER = os.path.join(ROOT, "build", "scene_w_after.png")


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def state(a):
    text = a.eval("JSON.stringify(sceneW.snapshot())")
    return json.loads(text or "{}")


def pixels(path):
    w, h, bpp, rows = decode(path)
    return w, h, bpp, rows


def bright_count(path, x0, y0, x1, y1, threshold=45):
    w, h, bpp, rows = pixels(path)
    x0 = max(0, min(w - 1, int(x0)))
    x1 = max(0, min(w, int(x1)))
    y0 = max(0, min(h - 1, int(y0)))
    y1 = max(0, min(h, int(y1)))
    count = 0
    for y in range(y0, y1):
        row = rows[y]
        for x in range(x0, x1):
            r, g, b = row[x * bpp:x * bpp + 3]
            if max(r, g, b) > threshold:
                count += 1
    return count


def changed_fraction(a_path, b_path):
    w1, h1, bpp1, rows1 = pixels(a_path)
    w2, h2, bpp2, rows2 = pixels(b_path)
    if (w1, h1) != (w2, h2):
        return 1.0
    changed = 0
    total = 0
    for y in range(h1):
        ra, rb = rows1[y], rows2[y]
        for x in range(0, w1 * 4, 4):
            total += 1
            if any(abs(ra[x + c] - rb[x + c]) > 8 for c in range(3)):
                changed += 1
    return changed / max(1, total)


SETUP = r'''
globalThis.__sceneWCommit = 0;
$.on('sceneW.commit', () => { globalThis.__sceneWCommit++; });
globalThis.sceneW = (() => {
  const W = { x: 1000, y: 900, h: 75 };
  const world = $.re2dWorld.load('demos/re2d_testroom/testroom.re2dworld').backend('gpu');
  const view = { x: 800, y: 1080, h: 76, yaw: -90, pitch: 0, fov: 72, near: 4 };
  world.camera(view);
  world.lighting({ mode: 'classic', dynamic: true, shadows: true, distanceScale: .001 });
  const lamp = world.light({ x: W.x, y: W.y, h: 140, radius: 450, intensity: 2.2,
                             color: '#ffb070', shadow: true });
  const node = $('<sprite>', { id: 'scene-w' }).at(W.x, W.y).depth(0)
      .size(150, 150).angle(-Math.PI / 2).hide().appendTo($.world);
  node.get(0).sprite_row = 0;
  world.sprite(node, { atlas: 'demos/re2d_testroom/assets/enemy_sheet.png',
      columns: 5, rows: 8, directions: 5, mirror: true,
      cell: { w: 198, h: 198 }, pivot: 'feet', width: 150, height: 150, blend: 'masked' });
  const hero = $('<sprite>', { id: 'scene-w-hero' }).at(680, 900).depth(0)
      .size(32, 64).hide().appendTo($.world);

  world.vfx.define('vanish', $.fs.readText('assets/vfx/magic/vanish.json'));

  const state = {
    world, view, node, lamp, hero, W,
    triggerFired: 0, committed: 0, cinematic: false, wGone: false,
    targetYaw: Math.atan2(W.y - view.y, W.x - view.x) * 180 / Math.PI,
    wScreen: null, particlesBefore: 0, particlesDuring: 0, particlesAfter: 0,
    theme: '', viewKind: '', choiceSlots: 0, expressionBefore: '', expressionAfter: '',
    vfxCardsBefore: 0, vfxCardsAfter: 0, vfxSpawnedBefore: 0, vfxSpawnedAfter: 0,
  };
  function project(x, y, h) {
    const yaw = view.yaw * Math.PI / 180, pitch = view.pitch * Math.PI / 180;
    const dx = x - view.x, dy = y - view.y, dh = h - view.h;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const zf = dx * cy * cp + dy * sy * cp + dh * sp;
    if (zf < 8) return null;
    const right = -dx * sy + dy * cy;
    const up = -dx * sp * cy - dy * sp * sy + dh * cp;
    const focal = (600 / 2) / Math.tan(view.fov * Math.PI / 360);
    return { x: 400 + focal * right / zf, y: 300 - focal * up / zf, z: zf };
  }
  state.project = project;
  state.snapshot = () => ({
    triggerFired: state.triggerFired, cinematic: state.cinematic, wGone: state.wGone,
    committed: state.committed, eventCount: globalThis.__sceneWCommit,
    store: $.store.get('sceneW.committed', 0),
    yaw: view.yaw, targetYaw: state.targetYaw,
    camX: $.camera.x(), camY: $.camera.y(),
    cutscene: $.cutscene.running(), blocking: $.cutscene.blocking(),
    taken: $.input.taken(), dialog: $.dialog.isOpen(), worldMode: $.dialog.worldMode(),
    theme: $.dialog.theme(), viewKind: (() => { const i = $.dialog.inspect(); return i.view; })(),
    choiceSlots: $.dialog.inspect().choiceSlots,
    expression: $.dialog.expression(), text: $.dialog.fullText(),
    choices: $.dialog.choices().length,
    heroX: state.hero.get(0).x,
    sprites: world.info().visibleAtlasSprites, actors: world.info().composedActors,
    lights: world.info().lights, particles: world.info().particles,
    vfxCards: world.vfx.info().cards, vfxSpawned: world.vfx.info().cardsSpawned,
    wScreen: state.wScreen, errors: $.debug.errors(),
  });

  const trigger = world.trigger({ type: 'enter', id: 'sceneW.enter', target: 'w.actor',
      x: W.x, y: W.y, radius: 70, bottom: 0, top: 200, once: true });
  world.onTrigger('sceneW.enter', () => {
    state.triggerFired++;
    state.cinematic = true;
    state.particlesBefore = world.info().particles;
    state.vfxCardsBefore = world.vfx.info().cards;
    state.vfxSpawnedBefore = world.vfx.info().cardsSpawned;
    if (!$.cutscene.running()) $.cutscene.play('scene_w');
    $.dialog.themeDefine('bashnya', { rml: '@ui/dialog/bashnya.rml',
        rcss: '@ui/dialog/bashnya.rcss', choiceSlots: 8 });
    $.dialog.theme('bashnya');
    $.dialog.speaker('w', { name: 'W',
        portraits: { neutral: 'demos/re2d_testroom/assets/enemy_sheet.png' } });
    $.dialog.define('scene_w_dialog', { start: 'a', nodes: {
      a: { speaker: 'w', expression: 'neutral', slot: 'left', text: 'Смотри на меня.', to: 'b' },
      b: { speaker: 'w', expression: 'angry', slot: 'left', text: 'Я исчезаю.',
           choices: [{ text: 'Отпустить', do: () => {
             state.committed = 1;
             state.expressionAfter = $.dialog.expression();
             $.store.set('sceneW.committed', 1);
             $.emit('sceneW.commit', { id: 'sceneW' });
             world.vfx.spawn('vanish', { x: W.x, y: W.y, h: W.h, seed: 7 });
             state.vfxCardsAfter = world.vfx.info().cards;
             state.vfxSpawnedAfter = world.vfx.info().cardsSpawned;
             state.wGone = true;
             world.remove(node);
             node.remove();
             state.cinematic = false;
             $.cutscene.stop();
           }, to: null }] }
    } });
    state.expressionBefore = 'neutral';
    $.dialog.play('scene_w_dialog');
    state.theme = $.dialog.theme();
    state.viewKind = $.dialog.inspect().view;
    state.choiceSlots = $.dialog.inspect().choiceSlots;
  });

  $.cutscene.define('scene_w', [
    { take: 'input' },
    { camera: { at: [900, 1000], zoom: 1.3, ms: 200 } },
    { wait: 60000 },
    { give: 'input' },
  ]);
  $.update((dt) => {
    if (state.cinematic) {
      view.yaw = state.targetYaw;
      state.wScreen = project(W.x, W.y, W.h / 2);
      state.particlesDuring = world.info().particles;
    } else {
      const ax = $.input.axis('left', 'right');
      const h = state.hero.get(0);
      h.x = Math.max(500, Math.min(1120, h.x + ax * 180 * dt));
    }
    if (!state.wGone) {
      const h = state.hero.get(0);
      world.triggerTick(dt, { x: h.x, y: h.y, feet: 0 });
    }
    world.particles.continuous({ x: 900, y: 950, h: 40, rate: 30, life: 1.2, size: 6,
        color: '#80c0ff', alpha: .5, blend: 'additive', mode: 'billboard' }, dt);
    if (!state.cinematic) state.particlesAfter = world.info().particles;
  });
  $.render(() => world.render(view, 800, 600));
  return state;
})();
true
'''


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(2)
        check(a.eval(SETUP) is True, "Scene-W fixture initializes")
        a.step(3)
        s = state(a)
        check(s["sprites"] >= 1 and s["actors"] >= 1, "W is a lit native world sprite")
        check(s["lights"] >= 1, "Re2D world light exists")
        check(s["triggerFired"] == 0 and not s["dialog"] and not s["blocking"],
              "scene starts idle with input live")
        check(a.eval("$.fs.readText('ui/dialog/bashnya.rcss').includes('Bashnya Sans')") is True,
              "BASHNYA theme ships a custom font rule")
        check(a.eval("$.fs.readText('assets/vfx/magic/vanish.json') != null") is True,
              "vanish FX bundle asset exists")

        # Player actually walks into the trigger using normal input.
        a.key("Right", "down")
        fired = 0
        for _ in range(140):
            a.step(1)
            fired = state(a)["triggerFired"]
            if fired:
                break
        a.key("Right", "up")
        check(fired == 1, "player input enters the native trigger exactly once")
        a.step(5)
        s = state(a)
        check(s["cutscene"] is True and s["blocking"] is True,
              "trigger starts a cutscene and takes input")
        check(s["taken"] is True, "$.input reports the scene is input-locked")
        check(abs(s["camX"] - 900) < 2, "cutscene camera moved to the authored point: %.1f" % s["camX"])
        check(abs(s["yaw"] - s["targetYaw"]) < 1.0,
              "Re2D view looks at W (yaw %.2f target %.2f)" % (s["yaw"], s["targetYaw"]))
        check(s["dialog"] is True and s["theme"] == "bashnya", "BASHNYA dialog is open")
        check(s["viewKind"] == "rml" and s["choiceSlots"] == 8,
              "dialog uses custom RML with eight choice slots")
        check(s["worldMode"] == "cinematic", "dialog/world is in cinematic mode")
        check(s["expression"] == "neutral" and s["text"] == "Смотри на меня.",
              "first line shows W's neutral expression")
        check(s["particles"] > 0, "environmental VFX are alive during the cutscene: %s" % s["particles"])
        a.screenshot(BEFORE)

        # W is actually visible and lit in the frame around its projected point.
        ws = s.get("wScreen") or {}
        if ws:
            bright = bright_count(BEFORE, ws["x"] - 80, ws["y"] - 80,
                                  ws["x"] + 80, ws["y"] + 80, 45)
            check(bright > 200, "W contributes lit pixels at its projected screen point: %d" % bright)
        else:
            check(False, "W projection available")

        # Expression change through the same dialog runtime.
        a.eval("$.dialog.skip(); $.dialog.next()")
        a.step(2)
        s = state(a)
        check(s["expression"] == "angry", "expression changes neutral -> angry")
        check(s["text"] == "Я исчезаю." and s["choices"] == 1, "second line exposes the commit choice")
        check(s["particles"] > 0, "environmental VFX continue through the dialog")

        # Commit -> FX bundle + W vanish + input return.
        a.eval("$.dialog.choose(0)")
        a.step(6)
        s = state(a)
        check(s["committed"] == 1 and s["eventCount"] == 1 and s["store"] == 1,
              "gameplay commit fired exactly once and reached $.store")
        check(s["vfxCards"] >= 1 and s["vfxSpawned"] >= 1,
              "W vanish spawned the native VFX bundle (cards %s, spawned %s)"
              % (s["vfxCards"], s["vfxSpawned"]))
        check(s["wGone"] is True and s["sprites"] == 0,
              "W disappeared from the native world sprite list")
        check(s["dialog"] is False and s["cutscene"] is False and s["blocking"] is False,
              "dialog and cutscene ended")
        check(s["taken"] is False, "input gate is released")
        check(s["worldMode"] == "live", "world mode returned to live")
        check(s["particles"] > 0, "environmental VFX survive the transition: %s" % s["particles"])
        a.screenshot(AFTER)
        frac = changed_fraction(BEFORE, AFTER)
        check(frac > 0.01, "vanquish/dialog transition changes actual pixels: %.2f%%" % (100 * frac))

        # Input is usable again: the same hero responds to the opposite key.
        x1 = s["heroX"]
        a.key("Left", "down")
        a.step(20)
        a.key("Left", "up")
        s = state(a)
        check(s["heroX"] < x1 - 20,
              "player input returns after the commit (x %.1f -> %.1f)" % (x1, s["heroX"]))
        check(not s["errors"], "no script errors in the whole Scene-W flow")

    print()
    if FAILED:
        print("ПРОВАЛОВ:", len(FAILED))
        for item in FAILED:
            print("  -", item)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
