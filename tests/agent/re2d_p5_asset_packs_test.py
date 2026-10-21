#!/usr/bin/env python3
# ===========================================================================
# P5 asset packs: 16-direction ultra sprites, per-layer sky, distant city.
#
# Assets-only gate: manifests, atlas grid, PNG dimensions/alpha and runtime
# compatibility with `$.atlas`. Runs `r2d atlas-info` for every atlas and
# loads the sheets through the real engine (agent mode, no pixels asserted).
#
# Run:
#   python3 tests/agent/re2d_p5_asset_packs_test.py
# ===========================================================================
import json
import os
import struct
import subprocess
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SDK = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "r2d"))
ULTRA = os.path.join(ROOT, "assets", "sprites", "ultra16")
SKY = os.path.join(ROOT, "assets", "sky")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def path(*parts):
    return os.path.join(*parts)


def read_json(name):
    with open(name, encoding="utf-8") as handle:
        return json.load(handle)


def png_info(name):
    with open(name, "rb") as handle:
        data = handle.read(24)
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", data[16:24])


def png_rgba(name):
    data = open(name, "rb").read()
    pos = 8
    idat = bytearray()
    w = h = bpp = 0
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            w, h, depth, color = struct.unpack(">IIBB", body[:10])
            check(depth == 8 and color == 6, "RGBA8 PNG header: " + os.path.basename(name))
            bpp = 4
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(bytes(idat))
    stride = w * bpp
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    index = 0
    for y in range(h):
        filt = raw[index]
        index += 1
        line = bytearray(raw[index:index + stride])
        index += stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            v = line[x]
            if filt == 1:
                v = (v + a) & 0xFF
            elif filt == 2:
                v = (v + b) & 0xFF
            elif filt == 3:
                v = (v + ((a + b) >> 1)) & 0xFF
            elif filt == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                v = (v + pr) & 0xFF
            line[x] = v
        prev = line
        out[y * stride:(y + 1) * stride] = line
    return w, h, out


def alpha_spread(out):
    alphas = out[3::4]
    return min(alphas), max(alphas)


def main():
    # --- ultra16 pack ------------------------------------------------------
    pack = read_json(path(ULTRA, "pack.json"))
    check(pack.get("format") == "r2d-ultra16-pack", "ultra16 pack format")
    check(pack.get("directions") == 16, "ultra16 declares 16 directions")
    check(pack.get("cell") == {"w": 64, "h": 64}, "ultra16 cell is 64x64")
    sets = pack.get("sets", [])
    check(len(sets) == 2, "ultra16 has 2 sets (character + prop): %d" % len(sets))
    total_frames = 0
    for entry in sets:
        name = entry["name"]
        world = read_json(path(ULTRA, entry["world"]))
        atlas = read_json(path(ULTRA, entry["atlas"]))
        image = path(ULTRA, entry["image"])
        info = png_info(image)
        frames = atlas.get("frames", {})
        expected_rows = world.get("rows", 0)
        expected = expected_rows * 16
        total_frames += expected
        check(world.get("directions") == 16 and world.get("columns") == 16,
              "%s world manifest: 16 columns/directions" % name)
        check(world.get("pivot") == "feet", "%s world manifest pivot=feet" % name)
        check(len(frames) == expected, "%s atlas frames %d/%d" % (name, len(frames), expected))
        check(info is not None and info[0] == 1024 and info[1] == expected_rows * 64,
              "%s PNG is 1024x%d" % (name, expected_rows * 64))
        check(all(f["frame"]["w"] == 64 and f["frame"]["h"] == 64 and
                  f["frame"]["x"] % 64 == 0 and f["frame"]["y"] % 64 == 0
                  for f in frames.values()), "%s atlas grid is 64x64" % name)
        check(len(atlas.get("meta", {}).get("frameTags", [])) >= 2,
              "%s atlas has state tags" % name)
        w, h, rgba = png_rgba(image)
        lo, hi = alpha_spread(rgba)
        check(lo == 0 and hi == 255, "%s PNG has transparent + opaque pixels" % name)
        proc = subprocess.run([SDK, "atlas-info", path(ULTRA, entry["atlas"])],
                              capture_output=True, text=True)
        report = json.loads(proc.stdout or "{}")
        check(proc.returncode == 0 and report.get("ok") is True,
              "%s r2d atlas-info ok" % name)
        check(len(report.get("frames", [])) == expected, "%s SDK frame count %d" % (name, expected))
    check(total_frames == 336, "ultra16 total frames = 336 (got %d)" % total_frames)

    # --- sky layers --------------------------------------------------------
    layers = read_json(path(SKY, "layers.json"))
    check(layers.get("version") == 1, "sky layers.json version 1")
    entries = layers.get("layers", [])
    check(len(entries) == 4, "sky has 4 independent parallax layers")
    for layer in entries:
        tex = layer.get("texture", "")
        absolute = os.path.join(ROOT, tex)
        info = png_info(absolute) if os.path.isfile(absolute) else None
        check(info == (1024, 512), "sky layer %s is 1024x512" % layer.get("id"))
        check(0.0 <= float(layer.get("alpha", 0)) <= 1.0, "sky layer %s alpha valid" % layer.get("id"))
    weather = layers.get("weather", {})
    check(len(weather) >= 4, "sky has 4+ weather cards")
    for name, tex in weather.items():
        absolute = os.path.join(ROOT, tex)
        info = png_info(absolute) if os.path.isfile(absolute) else None
        check(info == (512, 512), "weather %s is 512x512" % name)
    for name in ("sun", "moon"):
        absolute = os.path.join(ROOT, layers.get(name, ""))
        check(os.path.isfile(absolute) and png_info(absolute) == (128, 128),
              "celestial %s.png is 128x128" % name)
    manifest = read_json(path(SKY, "manifest.json"))
    check(manifest.get("canonicalManifest") == "assets/sky/layers.json",
          "extended sky manifest points at canonical layers.json")
    check(len(manifest.get("layers", [])) == 4, "extended sky manifest has 4 slots")
    check(len(manifest.get("weather", [])) >= 4, "extended sky manifest lists weather cards")

    # --- distant city ------------------------------------------------------
    distant = read_json(path(SKY, "distant", "manifest.json"))
    cards = distant.get("cards", [])
    check(distant.get("format") == "r2d-distant-cards", "distant manifest format")
    check(len(cards) == 4, "distant manifest has 4 city cards")
    for card in cards:
        image = path(SKY, "distant", card["image"])
        info = png_info(image) if os.path.isfile(image) else None
        check(info == (1024, 256), "distant card %s is 1024x256" % card["name"])
        w, h, rgba = png_rgba(image)
        lo, hi = alpha_spread(rgba)
        check(lo == 0 and hi > 0, "distant card %s has transparent silhouette" % card["name"])

    # --- runtime compatibility --------------------------------------------
    with Agent(game="game", seed=1, headless=True, start_timeout=120) as agent:
        agent.step(2)
        for name in ("warden", "turret"):
            rel = "assets/sprites/ultra16/%s_ultra16.atlas.json" % name
            result = agent.eval(
                "(() => { const s=$.atlas.load(%r,%r);"
                " return {size:s.size(), frames:s.frames().length, tags:s.tags()}; })()"
                % ("p5_" + name, rel))
            expected = 240 if name == "warden" else 96
            check(result.get("frames") == expected,
                  "%s loads through $.atlas: %s frames" % (name, expected))
            check(tuple(result.get("size", [])) == (1024, 960 if name == "warden" else 384),
                  "%s atlas runtime size" % name)
            check("idle" in result.get("tags", []), "%s atlas exposes idle tag" % name)

    print()
    if FAILURES:
        print("FAILED %d" % len(FAILURES))
        for failure in FAILURES:
            print("  - " + failure)
        return 1
    print("All checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
