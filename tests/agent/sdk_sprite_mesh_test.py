#!/usr/bin/env python3
"""End-to-end test for r2d SpriteMesh bake and cache identity."""
import sys
import json
import os
import struct
import subprocess
import tempfile
import zlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import resolve_binary
SDK = str(resolve_binary())


def png(path, pixels):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xffffffff)
    raw = b"\0" + b"".join(bytes(px) for px in pixels)
    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", len(pixels), 1, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    open(path, "wb").write(data)


def bake(atlas, out, *args):
    p = subprocess.run([SDK, "sprite-mesh-bake", atlas, "--out", out, *args],
                       cwd=ROOT, text=True, capture_output=True)
    try:
        return p.returncode, json.loads(p.stdout)
    except Exception as exc:
        raise AssertionError(f"invalid bake response: {p.stdout!r} {p.stderr!r}") from exc


def main():
    assert os.path.isfile(SDK), "build r2d-sdk before this integration test"
    with tempfile.TemporaryDirectory(prefix="r2d-spritemesh-") as tmp:
        image = os.path.join(tmp, "sheet.png")
        atlas = os.path.join(tmp, "hero.atlas.json")
        cache = os.path.join(tmp, "hero.cache")
        # Adjacent opaque texels are deliberately split across frame bounds.
        png(image, [(255, 255, 255, 255), (255, 255, 255, 255)])
        doc = {"meta": {"image": "sheet.png", "frameTags": [
            {"name": "idle", "from": 0, "to": 0}, {"name": "walk", "from": 0, "to": 1}]},
            "frames": {"idle_0": {"frame": {"x": 0, "y": 0, "w": 1, "h": 1}},
                       "walk_0": {"frame": {"x": 1, "y": 0, "w": 1, "h": 1}}}}
        doc["meta"]["slices"] = [{"name": "walk_0", "keys": [{"frame": 1, "bounds": {"x": 1, "y": 0, "w": 1, "h": 1}, "pivot": {"x": 1, "y": 0}}]}]
        open(atlas, "w", encoding="utf-8").write(json.dumps(doc))
        rc, first = bake(atlas, cache)
        assert rc == 0 and first["ok"], first
        assert first["frames"] == 2 and first["opaquePixels"] == 2
        assert first["vertices"] == 72 and first["triangles"] == 24, first
        raw = open(cache, "rb").read()
        assert raw[:8] == b"R2DSMCH1" and struct.unpack_from("<I", raw, 8)[0] == 3
        assert struct.unpack_from("<I", raw, 12)[0] == 2
        vc0 = struct.unpack_from("<I", raw, 48)[0]
        f1 = 48 + 20 + vc0 * 32
        assert abs(struct.unpack_from("<f", raw, f1 + 20)[0]) < 1e-6, "per-frame Sprite pivot was not applied"
        checked = subprocess.run([SDK, "sprite-mesh-bake", atlas, "--check", "--out", cache],
                                 cwd=ROOT, text=True, capture_output=True)
        assert checked.returncode == 0 and json.loads(checked.stdout)["upToDate"] is True
        _, second = bake(atlas, cache, "--depth", "0.12")
        assert second["settingsHash"] != first["settingsHash"]
        checked = subprocess.run([SDK, "sprite-mesh-bake", atlas, "--check", "--out", cache],
                                 cwd=ROOT, text=True, capture_output=True)
        assert checked.returncode == 0 and json.loads(checked.stdout)["upToDate"] is False
        doc["frames"]["walk_0"]["frame"]["x"] = 0
        open(atlas, "w", encoding="utf-8").write(json.dumps(doc))
        _, third = bake(atlas, cache, "--depth", "0.12")
        assert third["layoutHash"] != second["layoutHash"]
        png(image, [(255, 255, 255, 255), (255, 255, 255, 0)])
        _, fourth = bake(atlas, cache, "--depth", "0.12")
        assert fourth["sourceHash"] != third["sourceHash"]
        bad = os.path.join(tmp, "bad.atlas.json")
        open(bad, "w", encoding="utf-8").write('{"frames": []}')
        rc, failure = bake(bad, cache)
        assert rc == 1 and failure["ok"] is False
        codes = {d["code"] for d in failure["diagnostics"]}
        assert "SDK_SPRITEMESH_FRAMES" in codes, failure
        page1, page2 = os.path.join(tmp, "page1.png"), os.path.join(tmp, "page2.png")
        png(page1, [(255, 255, 255, 255)]); png(page2, [(255, 255, 255, 255)])
        multi = os.path.join(tmp, "multi.atlas.json")
        multi_doc = {"meta": {"pages": [{"name": "body", "image": "page1.png"},
                                          {"name": "props", "image": "page2.png"}]},
                     "frames": {"body_0": {"frame": {"x": 0, "y": 0, "w": 1, "h": 1}, "page": "body"},
                                "prop_0": {"frame": {"x": 0, "y": 0, "w": 1, "h": 1}, "page": "props"}}}
        open(multi, "w", encoding="utf-8").write(json.dumps(multi_doc))
        rc, multi_result = bake(multi, os.path.join(tmp, "multi.cache"))
        assert rc == 0 and multi_result["pages"] == 2, multi_result
        packed = open(os.path.join(tmp, "multi.cache"), "rb").read()
        vc0 = struct.unpack_from("<I", packed, 48)[0]; f1 = 48 + 20 + vc0 * 32
        assert struct.unpack_from("<I", packed, 64)[0] == 0
        assert struct.unpack_from("<I", packed, f1 + 16)[0] == 1
    print("SDK SpriteMesh bake: single/multi-page, frame pivot, isolation and cache invalidation PASS")


if __name__ == "__main__":
    main()
