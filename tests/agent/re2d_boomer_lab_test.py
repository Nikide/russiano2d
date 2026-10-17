#!/usr/bin/env python3
# ===========================================================================
# Re2D boomer lab (P0-A): нативные flat directional atlas world sprites.
#
# Проверяется живым прогоном:
#   * сцена грузит скомпилированный мир и регистрирует 4 узла как atlas sprites;
#   * спрайты реально видны на кадре (а не ui.image-оверлей);
#   * направление (колонка атласа) выбирает нативный C: поворот актёра меняет
#     картинку при неподвижной камере;
#   * за внутренней стеной спрайт скрывается попиксельно нативным depth-тестом:
#     перенос пробы за стену меняет кадр, хотя мир/камера не менялись;
#   * нет ошибок игрового кода и JS-проекционного цикла.
#
# Запуск: python3 tests/agent/re2d_boomer_lab_test.py
# ===========================================================================

import os
import sys

from PIL import Image, ImageChops

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402
from re2d_skip import skip_without_re2d   # noqa: E402

GAME = "demos"
SCENE = "re2d_boomer_lab"
SHOTS = os.path.join("build", "shots")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def state(a):
    return a.state().get("re2dBoomerLab") or {}


def green_pixels(path):
    img = Image.open(path).convert("RGB")
    n = 0
    for y in range(0, img.size[1], 2):
        for x in range(0, img.size[0], 2):
            r, g, b = img.getpixel((x, y))
            if g > r + 18 and g > b + 18 and g > 60:
                n += 1
    return n


def red_pixels(path):
    img = Image.open(path).convert("RGB")
    n = 0
    for y in range(0, img.size[1], 2):
        for x in range(0, img.size[0], 2):
            r, g, b = img.getpixel((x, y))
            if r > 150 and g < 90 and b < 90:
                n += 1
    return n


def changed_pixels(a_path, b_path, threshold=20):
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    diff = ImageChops.difference(a, b)
    return sum(1 for px in diff.getdata() if px[0] + px[1] + px[2] > threshold), diff.getbbox()


def main():
    with Agent(game=GAME, scene=SCENE, seed=5) as a:
        if skip_without_re2d(a):
            return 0
        a.step(20)

        check(a.eval("$.scene.current()") == SCENE,
              f"сцена загружена: {a.eval('$.scene.current()')}")
        st = state(a)
        info = st.get("info") or {}
        check(info.get("atlasSprites") == 4,
              f"4 узла зарегистрированы как atlas sprites: {info}")
        check(info.get("visibleAtlasSprites", 0) >= 3,
              f"нативный проход видит спрайты: {info.get('visibleAtlasSprites')}")
        check(st.get("nativeWorldSprite") is True,
              "сцена подтверждает нативный путь world sprite")
        check(st.get("uiEnemyOverlays") == 0, "ui.image-оверлея врагов нет")
        check(a.eval("$.findNodes('#enemy-view-probe').length") == 0,
              "устаревших enemy-view узлов нет")

        os.makedirs(SHOTS, exist_ok=True)
        shot = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab.png"))
        check(green_pixels(shot) > 300,
              f"актёры видны на кадре (зелёных пикселей {green_pixels(shot)})")

        # Направление выбирает C: тот же актёр, другая сторона — другая колонка.
        a.eval("boomerLab.setProbeAngle(Math.PI/2)"); a.step(3)
        turned = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_turned.png"))
        n, box = changed_pixels(shot, turned)
        check(n > 4000 and box is not None,
              f"поворот актёра меняет нативный кадр (изменено {n} px, bbox={box})")
        a.eval("boomerLab.setProbeAngle(-Math.PI/2)"); a.step(3)

        # Нативный depth test: тот же спрайт за внутренней стеной не рисуется.
        a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_clear.png"))
        a.eval("boomerLab.moveProbe(800,500)"); a.step(4)
        occluded = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_occluded.png"))
        n2, box2 = changed_pixels(
            os.path.join(SHOTS, "re2d_boomer_lab_clear.png"), occluded)
        check(n2 > 4000 and box2 is not None,
              f"за стеной спрайт скрыт попиксельно (изменено {n2} px, bbox={box2})")

        # Вернули на место — снова видно.
        a.eval("boomerLab.moveProbe(800,900)"); a.step(4)
        back = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_back.png"))
        n3, _ = changed_pixels(os.path.join(SHOTS, "re2d_boomer_lab_clear.png"), back)
        check(n3 < 2000, f"после возврата кадр совпадает (изменено {n3} px)")

        # CPU reference backend даёт тот же нативный атлас (parity пути, не пиксель).
        a.eval("boomerLab.backend('cpu')"); a.step(6)
        cpu_shot = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_cpu.png"))
        check(green_pixels(cpu_shot) > 300,
              f"CPU-backend тоже рисует атласные спрайты (зелёных пикселей {green_pixels(cpu_shot)})")
        check((state(a).get("backend") or "").startswith("cpu"),
              f"бэкенд переключился: {state(a).get('backend')}")
        a.eval("boomerLab.backend('gpu')"); a.step(4)

        # --- Unified world+actor trace (P0-B) через $ high-level API ---------
        check(a.eval("typeof $.re2dWorld.load") == "function"
              and a.eval("typeof $.re2dWorld.fromJSON") == "function"
              and a.eval("$.re2dEnabled") is True,
              "$.re2dWorld и $.re2dEnabled — публичный вход")
        enemy_hit = a.eval("JSON.stringify(boomerLab.trace({x:800,y:900,h:75},['enemy']))")
        check(enemy_hit and "lab-probe" in enemy_hit and '"type":2' in enemy_hit,
              f"world.trace находит actor proxy: {enemy_hit}")
        check(a.eval("boomerLab.trace({x:800,y:900,h:75},['world'])") is None,
              "маска world не задевает actor proxy")
        both = a.eval("JSON.stringify(boomerLab.traceAll({x:800,y:0,h:75}))")
        check(both is not None and both.index('"type":2') < both.index('"type":1'),
              f"traceAll сортирует actor перед стеной: {both}")
        wall_only = a.eval("JSON.stringify(boomerLab.trace({x:800,y:0,h:75},['world']))")
        check(wall_only and '"type":1' in wall_only and '"surface":6' in wall_only,
              f"world.trace возвращает surface/span стены: {wall_only}")
        check(a.eval("boomerLab.trace({x:800,y:900,h:75},['enemy'],boomerLab.probeNode())") is None,
              "ignore узла исключает его прокси")
        a.eval("boomerLab.moveProbe(800,500)"); a.step(3)
        behind = a.eval("JSON.stringify(boomerLab.trace({x:800,y:500,h:75},['world','enemy']))")
        check(behind and '"type":1' in behind,
              f"за стеной trace возвращает стену, а не дальний proxy: {behind}")
        a.eval("boomerLab.moveProbe(800,900)"); a.step(3)

        # --- P0-C/D/E/F high-level probes ------------------------------------
        find_raw = a.eval("JSON.stringify(boomerLab.findProbe())")
        import json as _json
        find = _json.loads(find_raw) if find_raw else {}
        check(find.get("north") is not None and find.get("north") >= 0
              and find.get("room") == 0 and find.get("missing") is None
              and find.get("surfaceKind") == 0,
              f"semantic find_* по authored ID: {find_raw}")
        ctrl = a.eval("JSON.stringify(boomerLab.controllerProbe())")
        ctrl_state = _json.loads(ctrl) if ctrl else {}
        check(ctrl_state.get("y", 1080) < 1000 and abs(ctrl_state.get("x", 0) - 800) < 1 and ctrl_state.get("grounded") is True,
              f"controller прошёл вперёд и стоит на полу: {ctrl}")
        check(a.eval("JSON.stringify(boomerLab.moverProbe())") is not None, "mover создан через $ API")
        a.step(25)
        mover_state = a.eval("JSON.stringify(boomerLab.moverProbeInfo())")
        check(mover_state is not None and '"position":' in mover_state, f"mover шагает: {mover_state}")
        a.eval("boomerLab.moverClose()"); a.step(30)
        check(a.eval("JSON.stringify(boomerLab.moverProbeInfo())") is not None, "mover закрывается")
        check(a.eval("boomerLab.triggerProbe()") is True, "trigger создан через $ API")
        fired = a.eval("JSON.stringify(boomerLab.triggerUse())")
        seen = a.eval("JSON.stringify(boomerLab.triggerEvents())")
        check(fired and 'lab.use' in fired and seen and 'gate.main' in seen,
              f"trigger эмитит семантическое событие: fired={fired}, seen={seen}")

        portal = a.eval("(function(){var w=$.re2dWorld.load('re2d_dust2/dust2.re2dworld');"
                         "var n=w.info().portals;w.portalOpen(0,0.4);var f=w.portalFraction(0);"
                         "w.portalClosed(0,true);var g=w.portalFraction(0);w.dispose();"
                         "return JSON.stringify({n:n,f:f,g:g});})()")
        check(portal is not None and '"n":' in portal and '"f":0.4' in portal and '"g":0' in portal,
              f"portalOpen smooth fraction и бинарный portalClosed сосуществуют: {portal}")

        # --- P1: nav graph, automap, metadata/spawns, particles ---------------
        nav = a.eval("JSON.stringify(boomerLab.navProbe())")
        check(nav is not None and '"nodes":' in nav and '"path":[' in nav,
              f"navBuild/navNearest/navPath через $ API: {nav}")
        automap = a.eval("JSON.stringify(boomerLab.automapProbe())")
        check(automap is not None and '"lines":' in automap and '"proj":' in automap,
              f"automapLines/automapProject через $ API: {automap}")
        meta = a.eval("JSON.stringify(boomerLab.metadataProbe())")
        check(meta is not None and 'tower.testroom' in meta and 'player.start' in meta
              and '"missing":null' in meta,
              f"metadata/spawns/spawn через $ API: {meta}")

        a.eval("boomerLab.backend('cpu')"); a.step(2)
        spawned = a.eval("JSON.stringify(boomerLab.particleProbe())")
        check(spawned is not None and '"spawned":80' in spawned, f"native particle burst: {spawned}")
        a.step(4)
        pshot = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_particles.png"))
        red = red_pixels(pshot)
        check(red > 150, f"частицы видны на CPU-кадре (красных пикселей {red})")
        check(a.eval("boomerLab.particleInfo().alive") > 0, "пул частиц жив")
        a.eval("boomerLab.particlesClear()")
        check(a.eval("boomerLab.particleInfo().alive") == 0, "particlesClear очищает пул")
        a.eval("boomerLab.backend('gpu')"); a.step(2)
        a.eval("JSON.stringify(boomerLab.particleProbe())"); a.step(4)
        gshot = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_particles_gpu.png"))
        check(red_pixels(gshot) > 150,
              f"частицы видны и на GPU-кадре (красных пикселей {red_pixels(gshot)})")
        a.eval("boomerLab.particlesClear()")

        fx = a.eval("JSON.stringify(boomerLab.fxProbe())")
        check(fx is not None and '"particles":90' in fx and '"alive":90' in fx,
              f"world.fxSpawn собрал particles+light bundle: {fx}")
        a.step(3)
        fxshot = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_fx.png"))
        check(red_pixels(fxshot) > 150, f"VFX bundle виден на кадре (красных {red_pixels(fxshot)})")
        a.eval("boomerLab.particlesClear()")

        save = a.eval("JSON.stringify(boomerLab.saveProbe())")
        check(save is not None and '"restored":true' in save and '"movers":1' in save
              and '"spans":1' in save and '"portals":0' in save,
              f"world.saveState/loadState восстанавливает native state: {save}")
        check('"found":0' in save and '"hp":100' in save and '"broken":0' in save,
              f"save/load возвращает secret/breakable state: {save}")

        anim = a.eval("JSON.stringify(boomerLab.materialAnimProbe())")
        check(anim is not None and '"index":' in anim and '"uOffset":' in anim,
              f"world.materialAnim включает анимацию материала: {anim}")
        a.step(3)
        before_anim = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_anim_a.png"))
        a.step(20)
        after_anim = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_anim_b.png"))
        changed, _ = changed_pixels(before_anim, after_anim)
        check(changed > 1000, f"scrolling/emissive материал меняет кадр ({changed} px)")

        volume = a.eval("JSON.stringify(boomerLab.volumeProbe())")
        check(volume is not None and '"parts":4' in volume and '"after":8' in volume,
              f"world.volume box регистрирует 4 native parts: {volume}")
        a.step(3)
        vshot = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_volume.png"))
        check(green_pixels(vshot) > 150, f"volumetric box виден на кадре ({green_pixels(vshot)} px)")
        a.eval("JSON.stringify(boomerLab.volumeProbe())")  # remove

        caps = a.eval("JSON.stringify($.capabilities.re2d)")
        check(caps is not None and '"worldGpu":true' in caps and '"mirrorPortal":false' in caps,
              f"$.capabilities.re2d доступен: {caps}")
        prof = a.eval("JSON.stringify({m:boomerLab.info().movers,t:boomerLab.info().traceCalls,n:boomerLab.info().navQueries,av:boomerLab.info().audioVoicesActive})")
        check(prof is not None and '"t":' in prof, f"profiler-поля видны: {prof}")

        a.step(2)
        post_before = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_post_before.png"))
        post = a.eval("JSON.stringify(boomerLab.postProbe())")
        check(post is not None and '"flash":' in post and '"vignette":' in post,
              f"world.post.profile/update даёт uniform-ы: {post}")
        a.step(2)
        post_after = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_post_after.png"))
        changed_post, _ = changed_pixels(post_before, post_after)
        check(changed_post > 1000, f"postprocess меняет итоговый 2D-кадр ({changed_post} px)")
        a.eval("boomerLab.postReset()")

        boss = a.eval("JSON.stringify(boomerLab.bossProbe())")
        check(boss is not None and '"zone":2' in boss and '"mult":4' in boss
              and '"zone":0' in boss and '"mult":1' in boss,
              f"multi-zone boss hit proxy: {boss}")

        check("[]" == a.eval("JSON.stringify($.debug.errors())"),
              f"ошибок игрового кода нет: {a.eval('JSON.stringify($.debug.errors())')}")

    print()
    if FAILURES:
        print("ПРОВАЛОВ:", len(FAILURES))
        for f in FAILURES:
            print("  -", f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
