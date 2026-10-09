#!/usr/bin/env python3
# ===========================================================================
# Phase 2 — вертикальный срез Classic 2D (docs/SDK.md §7–8):
#
#   PNG → Sprite Studio → анимация → сохранение → hot reload → игра/превью
#
# Проверяется на настоящих процессах: SDK (приложение R2D) правит файлы
# проекта, отдельный процесс игры (без агента, без SDK) читает их обычным
# `$.atlas` и перезапускается сам, когда движок видит изменённый *.atlas.json.
#
# Запуск (после сборки): python3 tests/agent/sdk_classic2d_test.py
# ===========================================================================

import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
SDK_BIN = os.path.join(ROOT, "build", "r2d-sdk")
ENGINE = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "russiano2d"))
SRC = os.path.join(ROOT, "tests", "fixtures", "sdk", "sprite_proj")
PROJ = os.path.join(ROOT, "build", "sdk_c2d_proj")
ATLAS = os.path.join(PROJ, "hero.atlas.json")
STATE_FILE = os.path.join(PROJ, "hero_state.json")
SPR = "$.ui.doc('sdk/ui/sprite_studio.rml')"
ANI = "$.ui.doc('sdk/ui/animation_studio.rml')"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def wait_idle(a, limit=300):
    a.step(2)
    for _ in range(limit):
        if a.eval("$.sdkApp.state.busy") == 0:
            a.step(2)
            return True
        a.step(2)
    return False


def sdk_cli(*args):
    p = subprocess.run([SDK_BIN, *args], cwd=ROOT, capture_output=True, text=True, timeout=60)
    return p.returncode, json.loads(p.stdout.strip().splitlines()[-1])


def snap(a):
    return json.loads(a.eval("JSON.stringify($.sdkApp.snapshot())"))


def wait_game_state(predicate, timeout=25.0):
    """Ждать в реальном времени, пока процесс игры допишет hero_state.json."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            d = json.load(open(STATE_FILE, encoding="utf-8"))
            if predicate(d):
                return d
        except (OSError, ValueError):
            pass
        time.sleep(0.15)
    return None


def edit_sprites(a):
    """Правки кадров: форма, undo/redo, мышь, метаданные, отклонённая правка."""
    a.eval(f"{SPR}.click('fr-2')")
    check(snap(a)["studios"]["sprite"]["selected"] == 2, "клик по строке списка выбирает кадр 2")
    a.eval(f"{SPR}.setValue('f-name','hero_run'); {SPR}.setValue('f-px','16'); {SPR}.setValue('f-py','31'); {SPR}.setValue('f-dur','100')")
    a.eval(f"{SPR}.click('ss-apply')")
    sp = snap(a)["studios"]["sprite"]
    check(sp["dirty"] and sp["canUndo"], "правка формой: есть несохранённые изменения и undo")
    check(a.eval("$.sdkApp.studios.sprite.session.doc.frames[2].name") == "hero_run", "имя кадра изменено")
    check(a.eval("JSON.stringify($.sdkApp.studios.sprite.session.doc.frames[2].pivot)") == '{"x":16,"y":31}', "пивот записан в модель")

    a.eval(f"{SPR}.click('ss-undo')")
    check(a.eval("$.sdkApp.studios.sprite.session.doc.frames[2].name") == "hero_2", "undo вернул имя")
    check(snap(a)["studios"]["sprite"]["canRedo"], "после undo доступен redo")
    a.eval(f"{SPR}.click('ss-redo')")
    check(a.eval("$.sdkApp.studios.sprite.session.doc.frames[2].name") == "hero_run", "redo повторил правку")

    # Новый кадр мышью: тянем рамку по картинке (настоящие координаты вида).
    view = a.eval("JSON.parse(JSON.stringify($.sdkApp.studios.sprite.state.view))")

    def to_screen(tx, ty):
        return view["cx"] + (tx - view["px"]) * view["zoom"], view["cy"] + (ty - view["py"]) * view["zoom"]

    # Середины пикселей, а не границы: floor/ceil рамки не должны зависеть от дробной раскладки RmlUi.
    x0, y0 = to_screen(4.1, 4.1)
    x1, y1 = to_screen(11.9, 11.9)
    a.mouse_move(x=x0, y=y0); a.step(2)
    a.mouse(button=1, action="down"); a.step(2)
    a.mouse_move(x=(x0 + x1) / 2, y=(y0 + y1) / 2); a.step(2)
    a.mouse_move(x=x1, y=y1); a.step(2)
    a.mouse(button=1, action="up"); a.step(3)
    check(snap(a)["studios"]["sprite"]["frames"] == 9, "кадр создан перетаскиванием мыши по картинке")
    fr = json.loads(a.eval("JSON.stringify($.sdkApp.studios.sprite.session.doc.frames[8])"))
    check((fr["x"], fr["y"], fr["w"], fr["h"]) == (4, 4, 8, 8), "рамка кадра совпала с протянутой областью 8×8 (получено %r)" % ((fr["x"], fr["y"], fr["w"], fr["h"]),))
    a.eval(f"{SPR}.click('ss-undo')")
    check(snap(a)["studios"]["sprite"]["frames"] == 8, "undo убрал кадр, созданный мышью")

    a.eval(f"{SPR}.setValue('m-key','author'); {SPR}.setValue('m-val','Ника'); {SPR}.click('ss-meta-set')")
    check(a.eval("JSON.stringify($.sdkApp.studios.sprite.session.doc.custom)") == '{"author":"Ника"}', "метаданные записаны")

    a.eval(f"{SPR}.setValue('f-x','200'); {SPR}.click('ss-apply')")
    check("SDK_EDIT_REJECTED" in json.dumps(a.eval("$.sdkApp.studios.sprite.session.diagnostics.map(d => d.code)")),
          "кадр за пределами картинки отклонён диагностикой SDK_EDIT_REJECTED")
    check(a.eval("$.sdkApp.studios.sprite.session.doc.frames[2].x") == 64, "модель не изменилась после отклонённой правки")


def edit_animation(a):
    a.eval(f"{SPR}.click('ss-to-anim')")
    wait_idle(a)
    an = snap(a)["studios"]["animation"]
    check(an and an["active"] and an["file"] == ATLAS, "Animation Studio открыт на том же атласе (общая сессия)")
    check(a.eval("$.sdkApp.studios.animation.session.doc.frames[2].name") == "hero_run", "несохранённые правки Sprite Studio видны в Animation Studio")
    a.eval(f"{ANI}.click('an-add-tag')")
    an = snap(a)["studios"]["animation"]
    check(an["tags"] == ["anim1"] and an["tag"] == 0, "новый тег создан")
    a.eval(f"{ANI}.setValue('t-name','idle'); {ANI}.setValue('t-from','0'); {ANI}.setValue('t-to','3'); {ANI}.setValue('t-dur','120')")
    a.eval(f"{ANI}.click('t-dir-forward'); {ANI}.click('an-apply')")
    check(snap(a)["studios"]["animation"]["tags"] == ["idle"], "тег переименован и применён")
    a.step(3)
    an = snap(a)["studios"]["animation"]
    check(an["frames"] == 4 and an["names"] == ["hero_0", "hero_1", "hero_run", "hero_3"],
          "просмотр: настоящий рантайм собрал 4 кадра тега из ТЕКУЩЕЙ модели")
    seen = set()
    for _ in range(60):
        a.step(2)
        seen.add(snap(a)["studios"]["animation"]["frameIndex"])
    check(len(seen) >= 3, f"просмотр: узел рантайма листает кадры ({sorted(seen)})")
    a.eval(f"{ANI}.click('an-play')")
    a.step(2)
    f1 = snap(a)["studios"]["animation"]["frameIndex"]
    a.step(40)
    an = snap(a)["studios"]["animation"]
    check(f1 == an["frameIndex"] and not an["playing"], "пауза останавливает анимацию")
    a.eval(f"{ANI}.click('an-play')")
    a.eval(f"{ANI}.click('an-sp-4')")
    check(snap(a)["studios"]["animation"]["speed"] == 4, "скорость воспроизведения ×4")

    a.eval("$.sdkApp.studios.animation.ops.addTag({name:'bounce',from:4,to:7,direction:'pingpong'}); 1")
    a.eval(f"{ANI}.click('an-validate')")
    wait_idle(a)
    codes = a.eval("$.sdkApp.studios.animation.session.diagnostics.map(d => d.code)")
    check("SDK_ATLAS_TAG_PINGPONG" in codes, "проверка черновика: pingpong помечен предупреждением")
    a.eval("$.sdkApp.studios.animation.ops.removeTag(1); 1")


def save_and_reload(a, text0):
    a.eval(f"{ANI}.click('an-save')")
    check(wait_idle(a), "сохранение завершилось")
    check(a.eval("$.sdkApp.studios.animation.session.diagnostics.filter(d => d.severity==='error').length") == 0,
          "после сохранения ошибок проверки нет")
    check(not snap(a)["studios"]["animation"]["dirty"], "после сохранения нет несохранённых правок")
    text1 = open(ATLAS, encoding="utf-8").read()
    check(text1 != text0 and '"name": "idle"' in text1 and '"hero_run"' in text1, "файл на диске изменился: тег и новое имя кадра")

    rc, fmt = sdk_cli("atlas-format", ATLAS)
    check(rc == 0 and fmt["ok"] and fmt["changed"] is False,
          "JS-сериализатор Studio пишет те же байты, что канонический вид C (atlas-format)")
    rc, val = sdk_cli("validate", ATLAS)
    check(rc == 0 and val["ok"] and val["type"] == "sprite.atlas", "CLI validate: сохранённый атлас валиден")

    # Игра перезапустилась сама и прочитала новый тег — без SDK.
    h = wait_game_state(lambda d: d.get("loads", 0) >= 2)
    check(h is not None, "игра перезапустилась сама: hot reload по *.atlas.json (loads >= 2)")
    h = h or {}
    check(h.get("tags") == ["idle"] and h.get("idle") == ["hero_0", "hero_1", "hero_run", "hero_3"],
          f"игра читает новый тег через $.atlas: {h.get('idle')}")
    check(h.get("interval") == 120, "игра берёт длительность тега (tagInterval) из сохранённого файла")
    check(h.get("slices") == ["hero_run"] and h["pivot"]["pivotLx"] == 16 and h["pivot"]["pivotLy"] == 31,
          "пивот кадра, заданный в Studio, читается рантаймом как sheet.slice(...)")
    an = snap(a)["studios"]["animation"]
    check(an["names"] == h.get("idle"), "превью и игра играют один и тот же список кадров тега")

    # git diff осмысленный: правка длительности тега меняет только строки кадров этого тега.
    a.eval("$.sdkApp.studios.animation.ops.setDuration(0, 90); 1")
    before = text1.splitlines()
    a.eval(f"{ANI}.click('an-save')")
    wait_idle(a)
    after = open(ATLAS, encoding="utf-8").read().splitlines()
    changed = [i for i, (x, y) in enumerate(zip(before, after)) if x != y]
    check(len(before) == len(after) and len(changed) == 4,
          f"git diff: смена длительности тега затронула 4 строки кадров из {len(before)}")
    h = wait_game_state(lambda d: d.get("loads", 0) >= 3 and d.get("interval") == 90)
    check(h is not None, "второе сохранение тоже подхвачено игрой (interval 90)")


def main():
    shutil.rmtree(PROJ, ignore_errors=True)
    shutil.copytree(SRC, PROJ)

    with Agent(game="sdk", seed=5) as a:
        wait_idle(a)
        a.eval(f"$.sdkApp.openProject({json.dumps(PROJ)}); 1")
        check(wait_idle(a), "проект открыт")
        entries = a.eval("$.sdkApp.state.assets.entries")
        tool = {e["path"]: e["tool"] for e in entries}
        check("hero.png" in tool, "Asset Browser видит hero.png")
        check(tool.get("hero.png") == "sprite-studio", "hero.png открывается в Sprite Studio (по sdk_tools.json)")

        # --- PNG → Sprite Studio (режим «создать атлас») ---------------------------------------
        a.eval("$.sdkApp.selectAsset('hero.png'); 1")
        a.eval("$.sdkApp.openAsset().then(() => 1)")
        wait_idle(a)
        sp = snap(a)["studios"]["sprite"]
        check(sp and sp["active"] and sp["createFor"] and sp["size"] == {"w": 128, "h": 64},
              "Sprite Studio открыт на PNG: режим создания, размер 128×64")
        check(a.eval(f"{SPR}.rect('ss-view').w") > 300, "окно просмотра занимает место")
        check(a.eval(f"{SPR}.rect('ss-create').h") > 0, "панель нарезки видна")

        a.eval(f"{SPR}.setValue('g-cols','4'); {SPR}.setValue('g-rows','2'); {SPR}.setValue('g-dur','120')")
        a.eval(f"{SPR}.click('ss-make-atlas')")
        check(wait_idle(a), "нарезка завершилась")
        check(os.path.isfile(ATLAS), "атлас hero.atlas.json создан рядом с PNG")
        sp = snap(a)["studios"]["sprite"]
        check(sp["frames"] == 8 and not sp["createFor"] and sp["file"] == ATLAS, "студия открыла созданный атлас: 8 кадров")
        text0 = open(ATLAS, encoding="utf-8").read()
        rc, info = sdk_cli("atlas-info", ATLAS)
        check(rc == 0 and info["ok"] and len(info["frames"]) == 8, "CLI atlas-info подтверждает 8 кадров")

        # Игра стартует отдельным процессом: без SDK и без агента; движок следит за *.atlas.json.
        # R2D_GAME_DIR делает каталог проекта базовым: относительная запись hero_state.json
        # из игры ложится рядом с проектом, а не в каталог запуска.
        if os.path.exists(STATE_FILE):
            os.remove(STATE_FILE)
        game = subprocess.Popen([ENGINE, "--game", PROJ, "--headless", "--seconds", "45"], cwd=ROOT,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                env=dict(os.environ, SDL_AUDIODRIVER="dummy", R2D_GAME_DIR=PROJ))
        try:
            h = wait_game_state(lambda d: d.get("loads", 0) >= 1)
            check(h is not None and h["loaded"] is True and len(h["frames"]) == 8 and h["tags"] == [],
                  "игра без SDK прочитала атлас: 8 кадров, тегов ещё нет")
            edit_sprites(a)
            edit_animation(a)
            save_and_reload(a, text0)
        finally:
            game.terminate()
            try:
                game.wait(timeout=10)
            except subprocess.TimeoutExpired:
                game.kill()

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
