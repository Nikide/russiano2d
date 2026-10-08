#!/usr/bin/env python3
# Генератор синтетических VRM-фикстур для Phase 5 (тестовая обвязка, не инструмент SDK).
#
# Это НЕ модель из VRoid/VRM Studio: человекоподобный набор боксов со скином, humanoid и
# выражениями. Он проверяет контракт (humanoid → кости Re2D, владение частями, поворот VRM 0.x),
# но не реальные файлы редакторов — об этом сказано в docs/SDK.md.
#
#   python3 tests/fixtures/sdk/make_vrm_fixtures.py
import json
import os
import struct

OUT = os.path.join(os.path.dirname(__file__), "vrm")

# имя, родитель, мировая позиция (glTF: Y вверх, лицо в +Z, левая сторона персонажа на +X)
J = [
    ("Root", None, (0, 0, 0)),
    ("hips", "Root", (0, 0.95, 0)), ("spine", "hips", (0, 1.1, 0)), ("chest", "spine", (0, 1.3, 0)),
    ("neck", "chest", (0, 1.5, 0)), ("head", "neck", (0, 1.6, 0)), ("hair", "head", (0, 1.8, 0)),
    ("leftShoulder", "chest", (0.12, 1.45, 0)), ("leftUpperArm", "leftShoulder", (0.25, 1.45, 0)),
    ("leftLowerArm", "leftUpperArm", (0.25, 1.15, 0)), ("leftHand", "leftLowerArm", (0.25, 0.85, 0)),
    ("rightShoulder", "chest", (-0.12, 1.45, 0)), ("rightUpperArm", "rightShoulder", (-0.25, 1.45, 0)),
    ("rightLowerArm", "rightUpperArm", (-0.25, 1.15, 0)), ("rightHand", "rightLowerArm", (-0.25, 0.85, 0)),
    ("leftUpperLeg", "hips", (0.1, 0.95, 0)), ("leftLowerLeg", "leftUpperLeg", (0.1, 0.5, 0)),
    ("leftFoot", "leftLowerLeg", (0.1, 0.08, 0)), ("leftToes", "leftFoot", (0.1, 0.05, 0.12)),
    ("rightUpperLeg", "hips", (-0.1, 0.95, 0)), ("rightLowerLeg", "rightUpperLeg", (-0.1, 0.5, 0)),
    ("rightFoot", "rightLowerLeg", (-0.1, 0.08, 0)), ("rightToes", "rightFoot", (-0.1, 0.05, 0.12)),
]
HUMANOID = [n for n, _, _ in J if n not in ("Root", "hair")]
EXPR1 = ["happy", "angry", "sad", "relaxed", "surprised", "blink", "aa"]
EXPR0 = [("Joy", "joy"), ("Angry", "angry"), ("Sorrow", "sorrow"), ("Fun", "fun"), ("Blink", "blink"), ("A", "a")]
IDX = {n: i for i, (n, _, _) in enumerate(J)}


def rot180(p):
    return (-p[0], p[1], -p[2])


def box(lo, hi):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)]
    tris = []
    for a, b, c, d in f:
        tris += [(a, b, c), (a, c, d)]
    return v, tris


def build(mode):
    """mode: 'v1' (VRM 1.0), 'v0' (VRM 0.x, лицом к -Z), 'plain' (скин без humanoid)."""
    flip = rot180 if mode == "v0" else (lambda p: p)
    wpos = {n: flip(p) for n, _, p in J}
    # (материал, нижняя точка, верхняя точка, [(y-порог, {joint: вес})...]) — вес по высоте
    S = (0.87, 0.67, 0.55, 1.0)      # кожа
    C = (0.2, 0.45, 0.85, 1.0)       # рубашка
    P = (0.25, 0.25, 0.3, 1.0)       # штаны
    H = (0.15, 0.1, 0.05, 1.0)       # волосы
    parts = [
        (0, S, (-0.09, 1.5, -0.09), (0.09, 1.8, 0.09), lambda y: {"head": 1.0}),
        (0, S, (-0.02, 1.6, 0.09), (0.02, 1.66, 0.13), lambda y: {"head": 1.0}),      # нос: показывает, куда смотрит лицо
        (3, H, (-0.1, 1.8, -0.1), (0.1, 1.9, 0.1), lambda y: {"hair": 1.0}),
        (1, C, (-0.2, 0.95, -0.1), (0.2, 1.5, 0.1), lambda y: {"hips": 1.0} if y < 1.1 else {"chest": 1.0} if y > 1.3 else {"spine": 1.0}),
        (1, C, (0.2, 1.15, -0.05), (0.3, 1.45, 0.05), lambda y: {"leftUpperArm": 1.0} if y > 1.3 else {"leftUpperArm": 0.5, "leftLowerArm": 0.5}),
        (1, C, (0.2, 0.85, -0.05), (0.3, 1.15, 0.05), lambda y: {"leftLowerArm": 1.0} if y < 1.0 else {"leftUpperArm": 0.5, "leftLowerArm": 0.5}),
        (0, S, (0.2, 0.7, -0.05), (0.3, 0.85, 0.05), lambda y: {"leftHand": 1.0}),
        (1, C, (-0.3, 1.15, -0.05), (-0.2, 1.45, 0.05), lambda y: {"rightUpperArm": 1.0} if y > 1.3 else {"rightUpperArm": 0.5, "rightLowerArm": 0.5}),
        (1, C, (-0.3, 0.85, -0.05), (-0.2, 1.15, 0.05), lambda y: {"rightLowerArm": 1.0} if y < 1.0 else {"rightUpperArm": 0.5, "rightLowerArm": 0.5}),
        (0, S, (-0.3, 0.7, -0.05), (-0.2, 0.85, 0.05), lambda y: {"rightHand": 1.0}),
        (2, P, (0.04, 0.5, -0.07), (0.16, 0.95, 0.07), lambda y: {"leftUpperLeg": 1.0} if y > 0.9 else {"leftUpperLeg": 0.5, "leftLowerLeg": 0.5}),
        (2, P, (0.04, 0.08, -0.07), (0.16, 0.5, 0.07), lambda y: {"leftLowerLeg": 1.0} if y < 0.4 else {"leftUpperLeg": 0.5, "leftLowerLeg": 0.5}),
        (2, P, (0.04, 0.0, -0.07), (0.16, 0.08, 0.15), lambda y: {"leftFoot": 1.0}),
        (2, P, (-0.16, 0.5, -0.07), (-0.04, 0.95, 0.07), lambda y: {"rightUpperLeg": 1.0} if y > 0.9 else {"rightUpperLeg": 0.5, "rightLowerLeg": 0.5}),
        (2, P, (-0.16, 0.08, -0.07), (-0.04, 0.5, 0.07), lambda y: {"rightLowerLeg": 1.0} if y < 0.4 else {"rightUpperLeg": 0.5, "rightLowerLeg": 0.5}),
        (2, P, (-0.16, 0.0, -0.07), (-0.04, 0.08, 0.15), lambda y: {"rightFoot": 1.0}),
    ]
    mats = [S, C, P, H]
    skin_nodes = [IDX[n] for n, _, _ in J]
    verts, joints, weights, per_mat = [], [], [], {}
    for mat, _, lo, hi, wf in parts:
        v, tris = box(lo, hi)
        base = len(verts)
        for p in v:
            verts.append(flip(p))
            w = wf(p[1])
            jj = [IDX[k] for k in w][:4]
            ww = [w[k] for k in w][:4]
            while len(jj) < 4:
                jj.append(0)
                ww.append(0.0)
            joints.append(jj)
            weights.append(ww)
        per_mat.setdefault(mat, []).extend((base + a, base + b, base + c) for a, b, c in tris)
    # бинарный буфер
    bin_ = bytearray()
    views, accs = [], []

    def add(data, ctype, count, typ, target=None, extra=None):
        while len(bin_) % 4:
            bin_.append(0)
        views.append({"buffer": 0, "byteOffset": len(bin_), "byteLength": len(data), **({"target": target} if target else {})})
        bin_.extend(data)
        a = {"bufferView": len(views) - 1, "componentType": ctype, "count": count, "type": typ}
        if extra:
            a.update(extra)
        accs.append(a)
        return len(accs) - 1

    mn = [min(p[i] for p in verts) for i in range(3)]
    mx = [max(p[i] for p in verts) for i in range(3)]
    pos = add(b"".join(struct.pack("<3f", *p) for p in verts), 5126, len(verts), "VEC3", 34962, {"min": mn, "max": mx})
    jac = add(b"".join(struct.pack("<4B", *j) for j in joints), 5121, len(joints), "VEC4", 34962)
    wac = add(b"".join(struct.pack("<4f", *w) for w in weights), 5126, len(weights), "VEC4", 34962)
    prims = []
    for m in sorted(per_mat):
        ix = [i for t in per_mat[m] for i in t]
        ia = add(b"".join(struct.pack("<I", i) for i in ix), 5125, len(ix), "SCALAR", 34963)
        prims.append({"attributes": {"POSITION": pos, "JOINTS_0": jac, "WEIGHTS_0": wac}, "indices": ia, "material": m})
    ibm = bytearray()
    for n, _, _ in J:
        x, y, z = wpos[n]
        ibm += struct.pack("<16f", 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1)
    ia = add(bytes(ibm), 5126, len(J), "MAT4")
    nodes = []
    for n, parent, _ in J:
        p = wpos[n]
        q = wpos[parent] if parent else (0, 0, 0)
        nodes.append({"name": n, "translation": [p[0] - q[0], p[1] - q[1], p[2] - q[2]]})
    for i, (n, parent, _) in enumerate(J):
        if parent:
            nodes[IDX[parent]].setdefault("children", []).append(i)
    nodes.append({"name": "Body", "mesh": 0, "skin": 0})
    gltf = {
        "asset": {"version": "2.0", "generator": "r2d make_vrm_fixtures"},
        "scene": 0, "scenes": [{"nodes": [0, len(nodes) - 1]}], "nodes": nodes,
        "meshes": [{"name": "Body", "primitives": prims}],
        "skins": [{"joints": skin_nodes, "inverseBindMatrices": ia, "skeleton": 0}],
        "materials": [{"name": n, "pbrMetallicRoughness": {"baseColorFactor": list(c), "metallicFactor": 0}} for n, c in zip(["Skin", "Shirt", "Pants", "Hair"], mats)],
        "buffers": [{"byteLength": len(bin_)}], "bufferViews": views, "accessors": accs,
    }
    if mode == "v1":
        gltf["extensionsUsed"] = ["VRMC_vrm"]
        gltf["extensions"] = {"VRMC_vrm": {
            "specVersion": "1.0",
            "meta": {"name": "Synthetic Humanoid", "authors": ["r2d-tests"], "licenseUrl": "https://vrm.dev/licenses/1.0/"},
            "humanoid": {"humanBones": {n: {"node": IDX[n]} for n in HUMANOID}},
            "expressions": {"preset": {e: {} for e in EXPR1}, "custom": {"wink": {}}},
        }}
    elif mode == "v0":
        gltf["extensionsUsed"] = ["VRM"]
        gltf["extensions"] = {"VRM": {
            "exporterVersion": "r2d-fixture", "specVersion": "0.0",
            "meta": {"title": "Synthetic Humanoid 0.x", "author": "r2d-tests", "licenseName": "CC0"},
            "humanoid": {"humanBones": [{"bone": n, "node": IDX[n]} for n in HUMANOID]},
            "blendShapeMaster": {"blendShapeGroups": [{"name": a, "presetName": b, "binds": []} for a, b in EXPR0]},
        }}
    return gltf, bytes(bin_)


def write_glb(path, gltf, bin_):
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    bin_ += b"\0" * (-len(bin_) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(bin_), 0x004E4942) + bin_
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for mode, name in (("v1", "humanoid.vrm"), ("v0", "humanoid0.vrm"), ("plain", "plain_skin.glb")):
        g, b = build(mode)
        write_glb(os.path.join(OUT, name), g, b)
    # неполный humanoid: нет правой кисти/рук
    g, b = build("v1")
    del g["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]["rightLowerArm"]
    write_glb(os.path.join(OUT, "incomplete.vrm"), g, b)
    print("ok")
