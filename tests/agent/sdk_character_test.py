#!/usr/bin/env python3
# ===========================================================================
# Phase 5 — Character / VRM в Re2D Baker (docs/SDK.md §10).
#
#   VRM → humanoid → псевдоскелет Re2D → владение частями по скину
#       → PNG v2 + character.json + animations → правится Re2DSprite-инструментами
#
# Фикстуры — СИНТЕТИЧЕСКИЕ (tests/fixtures/sdk/make_vrm_fixtures.py), не файлы VRoid:
# проверяется контракт конвейера, а не совместимость с редакторами моделей.
#
# Запуск (после сборки): python3 tests/agent/sdk_character_test.py
# ===========================================================================

import json
import os
import shutil
import struct
import subprocess
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
SDK_BIN = os.path.join(ROOT, "build", "r2d-sdk")
VRM = os.path.join(ROOT, "tests", "fixtures", "sdk", "vrm")
PROPS = os.path.join(ROOT, "tests", "fixtures", "sdk", "props")
OUT = os.path.join(ROOT, "build", "sdk_character_out")
RUNTIME_GAME = os.path.join(ROOT, "tests", "fixtures", "sdk", "re2d_proj")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def sdk(*args):
    p = subprocess.run([SDK_BIN, *args], cwd=ROOT, capture_output=True, text=True, timeout=300)
    lines = [l for l in p.stdout.splitlines() if l.strip()]
    return p.returncode, (json.loads(lines[-1]) if lines else {})


def bake(src, out, *extra):
    return sdk("bake-re2d", os.path.join(VRM, src), "--type", "character", "--output", out, *extra)


def codes(d):
    return [x["code"] for x in d.get("diagnostics", [])]


def idat(path):
    data = open(path, "rb").read()
    pos, raw = 8, b""
    while pos < len(data):
        n = struct.unpack(">I", data[pos:pos + 4])[0]
        if data[pos + 4:pos + 8] == b"IDAT":
            raw += data[pos + 8:pos + 8 + n]
        pos += 12 + n
    return zlib.decompress(raw)


def cli_cases():
    shutil.rmtree(OUT, ignore_errors=True)
    rc1, r1 = bake("humanoid.vrm", os.path.join(OUT, "v1"), "--name", "hero")
    check(rc1 == 0 and r1["ok"] and r1["type"] == "character", "VRM 1.0 → character: bake ok")
    ch = r1["character"]
    check(ch["vrm"]["version"] == 1 and ch["vrm"]["humanBones"] == 21 and not ch["vrm"]["rotated180"], "отчёт: VRM 1.0, 21 humanoid-кость, без поворота")
    own = ch["ownership"]
    check(own["triangles"] == 192 and sum(own["perBone"].values()) == 192, "каждый треугольник принадлежит ровно одной кости")
    check(set(own["perBone"]) == {"root", "head", "armLeft", "armRight", "forearmLeft", "forearmRight", "hipLeft", "hipRight", "kneeLeft", "kneeRight"},
          "кости Re2D: root/head/arm/forearm/hip/knee × Left/Right")
    check(own["ambiguous"] == 48 and len(own["pairs"]) == 4 and all(p["triangles"] == 12 for p in own["pairs"]),
          "неоднозначность посчитана: 48 треугольников на 4 границах суставов (12 на каждую)")
    check(own["perBone"]["head"] == 36 and own["perBone"]["root"] == 12, "волосы (сустав без humanoid) достались голове, торс — root")
    check("SDK_BAKE_SKIN_AMBIGUOUS" in codes(r1) and "SDK_BAKE_EXPRESSIONS_NOT_BAKED" in codes(r1), "диагностика неоднозначности и выражений со стабильными кодами")
    expr = {e["vrm"]: e["re2d"] for e in ch["expressions"]}
    check(expr.get("happy") == "happy" and expr.get("relaxed") == "neutral" and expr.get("aa") is None and "wink" in expr,
          "выражения VRM сопоставлены эмоциям Re2DSprite; без пары — null (не выдумываются)")

    # Результат — обычный Re2DSprite: проходит валидатор C и info.
    char = r1["files"]["character"]
    rc, v = sdk("validate", char)
    check(rc == 0 and v.get("ok"), "результат проходит валидатор Re2DSprite")
    rc, info = sdk("re2d-info", char)
    check(rc == 0 and info.get("ok"), "re2d-info читает результат")
    doc = json.load(open(char))
    bones = {b["name"]: b for b in doc["rig"]["bones"]}
    check(len(bones) == 10 and bones["forearmLeft"]["parent"] == "armLeft" and bones["kneeRight"]["parent"] == "hipRight", "иерархия костей: родитель раньше ребёнка")
    check(bones["armLeft"]["pivot"][0] < 0 < bones["armRight"]["pivot"][0], "Left — сторона X<0 (как у Russi), pivot плеча на своей стороне")
    check(bones["head"]["pivot"][1] < bones["armLeft"]["pivot"][1] < bones["hipLeft"]["pivot"][1], "pivot'ы упорядочены по высоте (Y вниз): голова выше плеча выше бедра")
    check({s["name"] for s in doc["rig"]["sockets"]} == {"handLeft", "handRight"}, "сокеты кистей из humanoid")
    anims = json.load(open(r1["files"]["animations"]))
    check(set(anims["clips"]) == {"spin", "walk"}, "клипы spin и walk (процедурные, не авторские)")
    check(os.path.isfile(os.path.join(OUT, "v1", "hero.bake.json")), "отчёт лежит рядом с ассетом")

    # VRM 0.x (лицом к -Z) → после поворота на 180° тот же результат.
    rc0, r0 = bake("humanoid0.vrm", os.path.join(OUT, "v0"), "--name", "hero")
    check(rc0 == 0 and r0["character"]["vrm"]["version"] == 0 and r0["character"]["vrm"]["rotated180"], "VRM 0.x: распознан и повёрнут на 180°")
    check(open(r1["files"]["character"]).read() == open(r0["files"]["character"]).read(), "VRM 0.x и 1.0 дают одинаковый character.json")
    check(idat(r1["files"]["png"]) == idat(r0["files"]["png"]), "и побайтно одинаковые карты PNG v2")
    check(any(e["vrm"] == "happy" and e["re2d"] == "happy" for e in r0["character"]["expressions"]) is False and
          any(e["vrm"] == "joy" and e["re2d"] == "happy" for e in r0["character"]["expressions"]), "VRM 0.x: пресеты blendShapeGroups (joy→happy)")

    # Детерминизм.
    _, again = bake("humanoid.vrm", os.path.join(OUT, "v1b"), "--name", "hero")
    check(idat(again["files"]["png"]) == idat(r1["files"]["png"]), "детерминизм: повторный bake даёт те же карты")

    # Честные отказы.
    rc, bad = bake("plain_skin.glb", os.path.join(OUT, "plain"))
    check(rc == 1 and "SDK_BAKE_CHARACTER_NO_HUMANOID" in codes(bad), "скин без humanoid: отказ SDK_BAKE_CHARACTER_NO_HUMANOID, а не угадывание костей")
    rc, bad = bake("incomplete.vrm", os.path.join(OUT, "inc"))
    d = next((x for x in bad["diagnostics"] if x["code"] == "SDK_BAKE_HUMANOID_INCOMPLETE"), None)
    check(rc == 1 and d and "rightLowerArm" in d["message"], "неполный humanoid: названа недостающая кость")
    check(not os.path.exists(os.path.join(OUT, "inc", "incomplete.character.json")), "при отказе файлов не остаётся")
    rc, prop = sdk("bake-re2d", os.path.join(VRM, "humanoid.vrm"), "--type", "prop", "--output", os.path.join(OUT, "asprop"))
    check(rc == 0 and "SDK_BAKE_SKIN_IGNORED" in codes(prop), "тот же VRM как prop: скин игнорируется с предупреждением")
    rc, none = sdk("bake-re2d", os.path.join(PROPS, "crate.glb"), "--type", "character", "--output", os.path.join(OUT, "crate"))
    check(rc == 1 and "SDK_BAKE_CHARACTER_NO_HUMANOID" in codes(none), "обычный GLB как character: отказ")
    return r1


def runtime_cases(r1):
    """Результат обычным Re2DSprite: поза, ходьба, предмет в руке; VRM рантайму не нужен."""
    char = r1["files"]["character"]
    prop_char = None
    rc, pr = sdk("bake-re2d", os.path.join(PROPS, "crate.glb"), "--output", os.path.join(OUT, "crate_prop"), "--size", "1024", "--scale", "6")
    if rc == 0:
        prop_char = pr["files"]["character"]
    with Agent(game=RUNTIME_GAME, seed=5) as a:
        a.step(3)
        ok = a.eval("(()=>{try{globalThis.h=$.re2dSprite.from(%s,{id:'hero'}).at(0,0).size(360,360).re2dMotion('walk');return 'ok';}"
                    "catch(e){return String(e.message||e);}})()" % json.dumps(char))
        check(ok == "ok", f"Re2DSprite загрузил персонажа ({ok})")
        info = a.eval("$.re2dSprite.info('#hero')")
        check(info["version"] == 2 and info["surfaceSamples"] == r1["samples"], f"рантайм видит {info['surfaceSamples']} отсчётов поверхности")
        shots = []
        for t, name in ((0, "walk_a"), (15, "walk_b")):
            a.step(t or 3)
            path = os.path.join(OUT, name + ".png")
            a.screenshot(path)
            shots.append(path)
        a.eval("$('#hero').re2dMotion('spin',0).re2dPose(90, 5); 1")
        a.step(3)
        side = os.path.join(OUT, "side.png")
        a.screenshot(side)
        sizes = [os.path.getsize(p) for p in shots + [side]]
        check(all(s > 2000 for s in sizes), "персонаж рисуется на ходьбе и в профиль")
        check(open(shots[0], "rb").read() != open(shots[1], "rb").read(), "ходьба меняет кадр (кости из клипа walk двигают части)")
        if prop_char:
            ok = a.eval("(()=>{try{const p=$.re2dSprite.from(%s,{id:'held'});$.re2dSprite.info('#held');p.re2dAttach($('#hero'),'handRight',{});return 'ok';}"
                        "catch(e){return String(e.message||e);}})()" % json.dumps(prop_char))
            check(ok == "ok", f"предмет крепится к сокету handRight ({ok})")
    check(not any(f.endswith((".glb", ".gltf", ".vrm", ".bin")) for f in os.listdir(os.path.dirname(char))), "рядом с результатом нет исходного 3D — рантайм VRM не читает")


def gui_cases():
    proj = os.path.join(ROOT, "build", "sdk_character_proj")
    shutil.rmtree(proj, ignore_errors=True)
    os.makedirs(proj)
    shutil.copy(os.path.join(VRM, "humanoid.vrm"), proj)
    open(os.path.join(proj, "project.json"), "w").write('{"title":"vrm"}')
    BK = "$.ui.doc('sdk/ui/baker.rml')"

    def wait_idle(a, limit=600):
        a.step(2)
        for _ in range(limit):
            if a.eval("$.sdkApp.state.busy") == 0:
                a.step(2)
                return True
            a.step(2)
        return False

    def snap(a):
        return json.loads(a.eval("JSON.stringify($.sdkApp.snapshot().studios)"))

    with Agent(game="sdk", seed=9) as a:
        wait_idle(a)
        a.eval(f"$.sdkApp.openProject({json.dumps(proj)}); 1")
        wait_idle(a)
        tool = {e["path"]: e["tool"] for e in a.eval("$.sdkApp.state.assets.entries")}
        check(tool.get("humanoid.vrm") == "re2d-baker", "VRM открывается в Re2D Baker (sdk_tools.json)")
        a.eval("$.sdkApp.selectAsset('humanoid.vrm'); 1")
        a.eval("$.sdkApp.openAsset().then(() => 1)")
        wait_idle(a)
        a.step(4)
        st = snap(a)["baker"]
        check(st["active"] and st["type"] == "character", "для .vrm тип Character выбран автоматически")
        a.eval(f"{BK}.click('bk-run')")
        check(wait_idle(a), "bake завершился")
        a.step(6)
        st = snap(a)["baker"]
        check(st["ok"] and st["parts"] == 10 and st["character"]["ownership"]["ambiguous"] == 48, "GUI: 10 частей, неоднозначность 48")
        check(st["preview"], "превью — настоящий Re2DSprite")
        report = a.eval(f"{BK}.content('bk-report')")
        check("VRM 1.0" in report and "Владение" in report and "happy » happy" in report, "панель отчёта показывает VRM, владение и выражения")
        # GUI и CLI — один код: PNG побайтно совпадает с CLI.
        _, cli = bake("humanoid.vrm", os.path.join(OUT, "cli_gui"), "--name", "humanoid")
        check(idat(st["files"]["png"]) == idat(cli["files"]["png"]), "GUI и CLI дают побайтно одинаковые карты")
        # «Правится Re2DSprite-инструментами»: открывается в Re2DSprite Studio.
        a.eval(f"{BK}.click('bk-open')")
        wait_idle(a)
        a.step(6)
        rs = snap(a).get("re2d") or snap(a).get("re2dsprite") or {}
        check(bool(rs) and rs.get("active", True), "результат открывается в Re2DSprite Studio")


def main():
    r1 = cli_cases()
    runtime_cases(r1)
    gui_cases()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("sdk_character_test: все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
