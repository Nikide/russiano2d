#!/usr/bin/env python3
# ===========================================================================
# Зонд кадра: карта «патч → габарит в канвасе» через provenance.
#
# Зачем: чтобы не спорить с картинкой, берём у движка фактическую привязку
# каждого видимого пикселя к патчу (`$.real2d.provenance`) и строим bbox каждого
# патча в канвасе. Это единственный честный способ увидеть, куда реально сел
# торс/ноги/голова, когда кадр выглядит неверно.
#
# Запуск:
#   python3 demos/real2d/tools/pink_frame_probe.py --yaw 0
# ===========================================================================

import argparse
import json
import math
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
ROOT = DEMO.parent.parent
sys.path.insert(0, str(ROOT / "tools"))


def main():
    parser = argparse.ArgumentParser(description="Карта патчей кадра")
    parser.add_argument("--yaw", type=float, default=0.0)
    parser.add_argument("--container", type=Path, default=DEMO / "assets" / "pink_full_v4.r2d4")
    parser.add_argument("--step", type=int, default=4)
    parser.add_argument("--size", type=int, default=0, help="размер спрайта в пикселях экрана")
    parser.add_argument("--canvas-h", type=int, default=0, help="высота канваса (иначе = ширина)")
    args = parser.parse_args()

    from agent_client import Agent

    with Agent(game="demos/real2d", seed=7) as a:
        size = args.size or 720
        height = int(size * 2) if "full" in args.container.name else size
        a.eval("(() => { const n = real2dDemo.head(); n.size(%d, %d); n.real2dSrc(%s); "
               "real2dDemo.setYaw(%f); real2dDemo.render({provenance: true}); return 1; })()"
               % (size, height, json.dumps(str(args.container)), math.radians(args.yaw)))
        a.step(3)
        info = json.loads(a.eval("JSON.stringify(real2dDemo.info())"))
        canvas_w = info["canvas"]
        canvas_h = args.canvas_h or canvas_w
        js = """(() => {
          const out = {};
          const step = %d;
          for (let y = 0; y < %d; y += step) {
            for (let x = 0; x < %d; x += step) {
              let p = null;
              try { p = real2dDemo.provenance(x, y); } catch (e) { continue; }
              if (!p || !p.patch) continue;
              const b = out[p.patch] || (out[p.patch] = {x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0});
              if (x < b.x0) b.x0 = x; if (y < b.y0) b.y0 = y;
              if (x > b.x1) b.x1 = x; if (y > b.y1) b.y1 = y;
              b.n++;
            }
          }
          return JSON.stringify(out);
        })()""" % (args.step, canvas_h, canvas_w)
        boxes = json.loads(a.eval(js))

    print(f"канвас {canvas_w}×{canvas_h}, патчей {info['patches']}, "
          f"нарисовано {info['patches_drawn']}, yaw {args.yaw}")
    print(f"{'патч':<16} {'x0':>5} {'y0':>5} {'x1':>5} {'y1':>5} {'w':>5} {'h':>5} {'пикс':>6}")
    for name in sorted(boxes, key=lambda k: boxes[k]["y0"]):
        b = boxes[name]
        print(f"{name:<16} {b['x0']:>5} {b['y0']:>5} {b['x1']:>5} {b['y1']:>5} "
              f"{b['x1']-b['x0']:>5} {b['y1']-b['y0']:>5} {b['n']*args.step*args.step:>6}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
