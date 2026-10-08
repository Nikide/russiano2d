#!/usr/bin/env python3
# ===========================================================================
# Паритет валидаторов Re2DSprite: нативный `r2d-sdk validate` (C) и рантайм
# (`$.re2dSprite.from`, JS) обязаны принимать и отвергать одни и те же описания.
#
# QuickJS в инструментах SDK запрещён, поэтому правила продублированы в C
# (sdk/native/sdk_re2d.c). Этот тест — страховка от расхождения: каждую правку
# описания проверяют оба, и решения должны совпасть.
#
# Запуск (после сборки): python3 tests/agent/sdk_re2d_parity_test.py
# ===========================================================================

import copy
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

SDK_BIN = os.path.join(ROOT, "build", "r2d-sdk")
SRC = os.path.join(ROOT, "tests", "fixtures", "sdk", "re2d_proj")
PROJ = os.path.join(ROOT, "build", "sdk_re2d_parity")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def base():
    d = json.load(open(os.path.join(SRC, "animal.character.json"), encoding="utf-8"))
    d["animations"] = {
        "version": 1,
        "clips": {
            "walk": {"duration": 1.0, "loop": True, "tracks": [
                {"target": "head", "channel": "rotation.z", "keys": [[0, 0], [0.5, 10], [1, 0]]},
                {"target": "face", "channel": "eyes", "keys": [[0, "open"], [0.5, "closed"]]},
            ]},
            "once": {"duration": 2, "loop": False, "tracks": [
                {"target": "tail", "channel": "translation.x", "interpolation": "step", "keys": [[0, 0], [1, 3]]},
            ]},
        },
    }
    d["emotions"] = {"happy": {"eyes": "happy", "mouth": "smile"}}
    d["rig"]["sockets"] = [{"name": "hand", "bone": "paw0", "point": [0, 1, 0], "rotation": [0, 0, 0]}]
    d["rig"]["controls"] = {"nod": {"bone": "head", "axis": "x"}}
    d["rig"]["parts"].append({"id": 97, "bone": "head", "selector": "eyes", "variant": 2, "oneSided": True, "portrait": False})
    d["defaults"] = {"body": True, "motion": "walk", "rig": {"nod": 3}, "expression": {"eyes": "open"}}
    d["projection"] = {"bodyScale": 1.5, "portraitScale": 2}
    return d


def set_(path, value):
    def apply(d):
        cur = d
        keys = path.split(".")
        for k in keys[:-1]:
            cur = cur[int(k)] if isinstance(cur, list) else cur[k]
        last = keys[-1]
        if isinstance(cur, list):
            cur[int(last)] = value
        else:
            cur[last] = value
    return apply


def delete(path):
    def apply(d):
        cur = d
        keys = path.split(".")
        for k in keys[:-1]:
            cur = cur[int(k)] if isinstance(cur, list) else cur[k]
        if isinstance(cur, list):
            del cur[int(keys[-1])]
        else:
            del cur[keys[-1]]
    return apply


MUTATIONS = [
    # (имя, правка) — ожидаемое решение определяет рантайм, а не мы.
    ("без правок", lambda d: None),
    ("style pixel", set_("style", "pixel")),
    ("style неизвестный", set_("style", "cartoon")),
    ("style null", set_("style", None)),
    ("version 2", set_("version", 2)),
    ("version строкой", set_("version", "1")),
    ("atlas пустой", set_("atlas", "")),
    ("atlas не строка", set_("atlas", 5)),
    ("atlas нет файла", set_("atlas", "нет_такого.png")),
    ("bones пусто", set_("rig.bones", [])),
    ("parts пусто", set_("rig.parts", [])),
    ("кость без имени", set_("rig.bones.1.name", "")),
    ("имя кости __proto__", set_("rig.bones.1.name", "__proto__")),
    ("повтор имени кости", set_("rig.bones.2.name", "head")),
    ("родитель позже ребёнка", set_("rig.bones.0.parent", "head")),
    ("родитель не существует", set_("rig.bones.1.parent", "призрак")),
    ("pivot из двух", set_("rig.bones.1.pivot", [1, 2])),
    ("pivot строка", set_("rig.bones.1.pivot", [1, 2, "z"])),
    ("pivot огромный", set_("rig.bones.1.pivot", [1e9, 0, 0])),
    ("portraitPivot плохой", set_("rig.bones.1.portraitPivot", [1, 2])),
    ("pivot null", set_("rig.bones.1.pivot", None)),
    ("part.id 0", set_("rig.parts.0.id", 0)),
    ("part.id 255", set_("rig.parts.0.id", 255)),
    ("part.id дробный", set_("rig.parts.0.id", 12.5)),
    ("part.id повтор", set_("rig.parts.1.id", 90)),
    ("part.bone нет", set_("rig.parts.0.bone", "призрак")),
    ("selector плохой", set_("rig.parts.7.selector", "nose")),
    ("variant 4", set_("rig.parts.7.variant", 4)),
    ("variant отсутствует", delete("rig.parts.7.variant")),
    ("portrait строкой", set_("rig.parts.0.portrait", "yes")),
    ("oneSided числом", set_("rig.parts.0.oneSided", 1)),
    ("bind.scale плохой", set_("rig.parts.0.bind", {"scale": [1, 1]})),
    ("bind.translation ок", set_("rig.parts.0.bind", {"translation": [1, 2, 3]})),
    ("группа с чужим ID", set_("groups.material", [90, 200])),
    ("группа пуста", set_("groups.material", [])),
    ("группа с повтором", set_("groups.material", [90, 90])),
    ("joint без кости", set_("rig.joints.0.bone", "призрак")),
    ("joint повтор имени", lambda d: d["rig"]["joints"].append(dict(d["rig"]["joints"][0]))),
    ("joint point плохой", set_("rig.joints.0.point", [1])),
    ("control ось", set_("rig.controls.nod.axis", "w")),
    ("control кость", set_("rig.controls.nod.bone", "призрак")),
    ("projection 0", set_("projection.bodyScale", 0)),
    ("projection 9", set_("projection.bodyScale", 9)),
    ("projection 8", set_("projection.bodyScale", 8)),
    ("projection строкой", set_("projection.portraitScale", "2")),
    ("socket повтор", lambda d: d["rig"]["sockets"].append(dict(d["rig"]["sockets"][0]))),
    ("socket кость", set_("rig.sockets.0.bone", "призрак")),
    ("socket portrait строкой", set_("rig.sockets.0.portrait", "да")),
    ("socket rotation плохой", set_("rig.sockets.0.rotation", [0, 0])),
    ("defaults.body строкой", set_("defaults.body", "yes")),
    ("defaults.motion неизвестный", set_("defaults.motion", "fly")),
    ("defaults.rig строкой", set_("defaults.rig.nod", "много")),
    ("defaults.expression плохой", set_("defaults.expression.eyes", "squint")),
    ("emotion плохая", set_("emotions.happy.mouth", "grin")),
    ("emotion компонент", set_("emotions.happy.nose", "big")),
    ("clip duration 0", set_("animations.clips.walk.duration", 0)),
    ("clip loop не bool", set_("animations.clips.walk.loop", "да")),
    ("clip без loop", delete("animations.clips.walk.loop")),
    ("track цель", set_("animations.clips.walk.tracks.0.target", "призрак")),
    ("track канал", set_("animations.clips.walk.tracks.0.channel", "rotation.w")),
    ("track канал scale", set_("animations.clips.walk.tracks.0.channel", "scale.x")),
    ("track повтор", lambda d: d["animations"]["clips"]["walk"]["tracks"].append(copy.deepcopy(d["animations"]["clips"]["walk"]["tracks"][0]))),
    ("interpolation плохая", set_("animations.clips.walk.tracks.0.interpolation", "cubic")),
    ("face linear", set_("animations.clips.walk.tracks.1.interpolation", "linear")),
    ("keys пусто", set_("animations.clips.walk.tracks.0.keys", [])),
    ("ключи не по порядку", set_("animations.clips.walk.tracks.0.keys", [[1, 0], [0.5, 1]])),
    ("ключ после duration", set_("animations.clips.walk.tracks.0.keys", [[0, 0], [1.5, 1]])),
    ("ключ отрицательный", set_("animations.clips.walk.tracks.0.keys", [[-1, 0], [0.5, 1]])),
    ("ключ не пара", set_("animations.clips.walk.tracks.0.keys", [[0, 0, 1]])),
    ("face значение", set_("animations.clips.walk.tracks.1.keys", [[0, "wink"]])),
    ("значение не число", set_("animations.clips.walk.tracks.0.keys", [[0, "много"]])),
    ("animations version", set_("animations.version", 2)),
    ("animations clips массив", set_("animations.clips", [])),
    ("animations без клипов", set_("animations.clips", {})),
    # допустимые правки: рантайм принимает — C не должен ругаться
    ("style anime", set_("style", "anime")),
    ("новая эмоция", set_("emotions.sad", {"eyes": "half", "brows": "sad"})),
    ("defaults.motion once", set_("defaults.motion", "once")),
    ("portrait true", set_("rig.parts.0.portrait", True)),
    ("socket portrait true", set_("rig.sockets.0.portrait", True)),
    ("projection 0.5", set_("projection.bodyScale", 0.5)),
    ("variant 0", set_("rig.parts.7.variant", 0)),
    ("ещё одна кость", lambda d: d["rig"]["bones"].append({"name": "ear", "parent": "head", "pivot": [0, -9, 0]})),
]


def main():
    shutil.rmtree(PROJ, ignore_errors=True)
    shutil.copytree(SRC, PROJ)
    path = os.path.join(PROJ, "mut.character.json")

    with Agent(game=PROJ, seed=3) as a:
        mismatches = []
        accepted = rejected = 0
        for name, fn in MUTATIONS:
            d = base()
            fn(d)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(d, f, ensure_ascii=False, indent=2)
            code = ("(()=>{try{const n=$.re2dSprite.from(" + json.dumps(path) + ");n.remove();return 'ok';}"
                    "catch(e){return String(e && e.message || e);}})()")
            runtime = a.eval(code)
            runtime_ok = runtime == "ok"
            p = subprocess.run([SDK_BIN, "validate", path], capture_output=True, text=True)
            c = json.loads(p.stdout.strip().splitlines()[-1])
            native_ok = c["errors"] == 0
            accepted += runtime_ok
            rejected += not runtime_ok
            if runtime_ok != native_ok:
                mismatches.append((name, runtime, [x["code"] for x in c["diagnostics"] if x["severity"] in ("error", "fatal")]))
        check(not mismatches, f"C и рантайм принимают и отвергают одни и те же описания ({len(MUTATIONS)} правок, принято {accepted}, отвергнуто {rejected})")
        for name, runtime, codes in mismatches:
            print(f"      расхождение: «{name}»: рантайм={runtime!r}, C={codes}")
        check(accepted >= 12 and rejected >= 50, "корпус содержит и допустимые, и недопустимые описания")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
