#!/usr/bin/env python3
# ===========================================================================
# Метрика профиля силуэта: кадр берётся ИЗ РАНТАЙМА (`$.real2d.pixels()`), без
# интерфейса демо. Скриншот для этого не годится: кнопки HUD попадали в силуэт и
# зона 0.98 не менялась ни от одной правки нижних деталей — это был признак
# загрязнения (дефект C26 в HANDOFF_DEFECTS.md).
#
# Профиль ширины считается в JS по буферу канваса, наружу уходят 64 числа;
# реф нормируется теми же 64 зонами. Печатается RMS и худшая зона.
#
# Запуск:
#   python3 demos/real2d/tools/pink_profile_metric.py --container assets/pink_full_v4.r2d4 --yaw 0
# ===========================================================================

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
ROOT = DEMO.parent.parent
sys.path.insert(0, str(ROOT / "tools"))

BANDS = 64
PROFILE_JS = """(() => {
  const id = real2dDemo.head().get(0).real2d.id;
  const px = $.real2d.pixels(id);
  const info = $.real2d.info(id);
  const W = info.canvas;
  const H = px.length / 4 / W;
  const widths = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = 0; x < W; x++) { if (px[(y * W + x) * 4 + 3] > 8) c++; }
    widths[y] = c;
  }
  let top = -1, bottom = -1;
  for (let y = 0; y < H; y++) { if (widths[y] > 2) { if (top < 0) top = y; bottom = y; } }
  if (top < 0) return JSON.stringify({error: 'кадр пуст'});
  const cut = widths.slice(top, bottom + 1);
  const peak = Math.max.apply(null, cut) || 1;
  const out = [];
  for (let k = 0; k < %d; k++) {
    const idx = Math.round(k * (cut.length - 1) / (%d - 1));
    out.push(cut[idx] / peak);
  }
  return JSON.stringify({profile: out, height: bottom - top, canvas: [W, H]});
})()""" % (BANDS, BANDS)


def reference_profile(yaw=0):
    landmarks = json.loads((DEMO / "authoring" / "pink.target_landmarks.json").read_text(encoding="utf-8"))
    figure = next((f for f in landmarks["figures"] if f["yaw"] == yaw), None)
    if figure is None:
        return None
    image = Image.open(DEMO / "pink_v4" / "assets" / "pink_full_character_target_yaw_pitch_v1.png")
    crop = np.asarray(image.convert("RGB").crop(tuple(figure["figure_bbox"]))).astype(int)
    mask = (crop.mean(axis=2) < 225) | ((crop.max(axis=2) - crop.min(axis=2)) > 25)
    widths = mask.sum(axis=1)
    found = np.nonzero(widths > 2)[0]
    if not found.size:
        return None
    cut = widths[found.min():found.max() + 1].astype(float)
    cut /= max(1.0, cut.max())
    return cut[np.linspace(0, len(cut) - 1, BANDS).astype(int)]


def main():
    parser = argparse.ArgumentParser(description="Профиль силуэта: рантайм против рефа")
    parser.add_argument("--container", type=Path, default=DEMO / "assets" / "pink_full_v4.r2d4")
    parser.add_argument("--yaw", type=float, default=0.0)
    args = parser.parse_args()

    from agent_client import Agent

    with Agent(game="demos/real2d", seed=7) as a:
        a.eval("(() => { const n = real2dDemo.head(); n.real2dSrc(%s); real2dDemo.setYaw(%f); return 1; })()"
               % (json.dumps(str(args.container)), args.yaw * 3.141592653589793 / 180.0))
        a.step(3)
        payload = json.loads(a.eval(PROFILE_JS))
    if "error" in payload:
        print("кадр пуст")
        return 1
    engine = np.array(payload["profile"])
    ref = reference_profile(int(round(args.yaw)) % 360)
    if ref is None:
        print("нет рефа для этого угла")
        return 1
    diff = engine - ref
    rms = float(np.sqrt((diff ** 2).mean()))
    worst = int(np.argmax(np.abs(diff)))
    print(f"кадр рантайма: {payload['canvas']}, рост {payload['height']} px, yaw {args.yaw:g}°")
    print(f"{'зона':>6} {'движок':>8} {'реф':>8} {'Δ':>8}")
    for k in range(0, BANDS, 8):
        print(f"{k/BANDS:>6.2f} {engine[k]:>8.3f} {ref[k]:>8.3f} {diff[k]:>+8.3f}")
    print(f"\nRMS профиля ширины: {rms:.4f}")
    print(f"худшая зона {worst/BANDS:.2f}: движок {engine[worst]:.3f}, реф {ref[worst]:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
