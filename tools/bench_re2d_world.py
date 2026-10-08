#!/usr/bin/env python3
"""Measure full-resolution RE2D demo throughput; fixed-dt FPS is not a timer."""
import argparse
import json
import platform
from pathlib import Path
import statistics
import subprocess
import time
from agent_client import Agent

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--frames', type=int, default=60)
parser.add_argument('--samples', type=int, default=3)
parser.add_argument('--json', default='build/bench_re2d_world.json')
args = parser.parse_args()
if args.frames < 1 or args.samples < 1:
    parser.error('frames and samples must be positive')
report = dict(machine=platform.platform(), processor=platform.machine(),
              commit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              dirty=bool(subprocess.check_output(['git', 'diff', '--name-only'], text=True).strip()),
              timing='wall clock agent step, includes command overhead; not presented FPS',
              frames=args.frames, samples=args.samples, scenarios={})
cache = Path('build/CMakeCache.txt')
if cache.exists():
    report['build_config'] = [line for line in cache.read_text().splitlines()
                              if line.startswith(('CMAKE_BUILD_TYPE:', 'CMAKE_C_FLAGS_RELEASE:'))]
if platform.system() == 'Darwin':
    report['cpu'] = subprocess.check_output(['sysctl', '-n', 'machdep.cpu.brand_string'], text=True).strip()
for mode in ('stationary', 'turning', 'walking'):
    with Agent(game='demos/re2d_bsp_world', seed=5) as agent:
        agent.step(10)
        report['resolution'] = agent.eval('[world.info().width,world.info().height]')
        if mode == 'turning':
            agent.hold(['Right'])
        elif mode == 'walking':
            agent.hold(['W'])
        timings = []
        for _ in range(args.samples):
            agent.eval('hero.at(0,0).depth(0);view.yaw=0;view.pitch=0')
            start = time.perf_counter()
            remaining = args.frames
            while remaining:
                batch = min(20, remaining)
                agent.step(batch)
                remaining -= batch
            timings.append((time.perf_counter()-start)*1000/args.frames)
        agent.release_all()
        median = statistics.median(timings)
        report['scenarios'][mode] = dict(ms_per_frame=timings, median_ms=median,
                                        throughput_fps=1000/median)
        print(f'{mode}: {median:.2f} ms/frame ({1000/median:.1f} frames/s throughput)', flush=True)
with open(args.json, 'w') as output:
    json.dump(report, output, ensure_ascii=False, indent=2)
print(args.json)
