#!/usr/bin/env python3
"""Author the standalone "burning facility" map (second world of the Dust2 demo).

    python3 demos/re2d_dust2/fire/build_fire.py        # writes fire.re2dmap and fire.json
    build/r2d-sdk world-compile demos/re2d_dust2/fire/fire.re2dmap --renderer --output demos/re2d_dust2/fire/fire.re2dworld

Uses the same Annex authoring helpers as the Dust2 wing (rooms, openings, lintel walls, themes) but produces a
separate .re2dmap: main.js loads it as its own `$.re2dWorld` and switches worlds on key 0.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))
import build_annex as BA  # noqa: E402

G = BA.G


def main():
    A = BA.Annex()
    span = BA.span
    fog = {'density': .0022, 'start': 40, 'color': '#3c1c0d'}
    dark = lambda lo, hi, floor, level=.16: [span(lo, hi, floor, '#0e0c0b', level, '#ff6a38', fog)]

    # --- rooms (grid cell coordinates) -------------------------------------------------------------
    ctl = A.grid('ctl', 1, 3, 7, 8, dark(0, 300, '#2b2724'), 'metal')                   # control room
    cor = A.grid('cor', 7, 5, 15, 6, dark(0, 260, '#2b2724'), 'metal')                  # emergency-lit corridor
    srv = A.grid('srv', 15, 2, 22, 10, dark(0, 300, '#2f2b28'), 'server')               # server hall
    rea = A.grid('rea', 22, 3, 30, 9, dark(0, 480, '#2a2623', .18), 'concrete')         # reactor hall (taller)
    sto = A.grid('sto', 15, 10, 22, 13, dark(0, 280, '#2b2724'), 'concrete')            # storage
    A.door(ctl[(6, 5)], cor[(7, 5)], 5 * G + 80, width=G, height=300, door=False)
    A.door(cor[(14, 5)], srv[(15, 5)], 5 * G + 80, width=G, height=300, door=False)
    A.door(srv[(21, 5)], rea[(22, 5)], 5 * G + 80, width=G, height=300, door=False)
    A.door(srv[(18, 9)], sto[(18, 10)], 10 * G, width=G, height=280, door=False)

    # --- solid blocks (consoles, racks, crates) as raised cells; walls are added below -----------------
    covers = {}
    def block(cells, group, height, ceil):
        for key in cells:
            cid = group[key]
            A.cells[cid]['spans'] = [span(height, ceil, '#3a342f', '#0e0c0b', .05, '#ff5a30', fog)]
            covers[key] = height
    import os
    NO = os.environ.get('NO_COVERS')
    if not NO:
        block([(2, 4), (3, 4), (5, 4), (2, 7), (6, 7), (4, 6)], ctl, 90, 300)
    racks = [(c, r) for c in (17, 19) for r in (3, 4, 6, 7, 8)]
    if not NO:
        block(racks, srv, 270, 300)
        block([(16, 11), (18, 11), (20, 11), (17, 12), (19, 12)], sto, 120, 280)
    pit = [(c, r) for c in (25, 26, 27) for r in (5, 6)]
    for key in pit:                                                                       # sunken reactor pit
        A.cells[rea[key]]['spans'] = [span(-64, 480, '#1f1a16', '#0e0c0b', .06, '#ff6a30', fog)]

    # --- lights / audio / spawns ------------------------------------------------------------------------
    L = lambda x, y, h, r, i, c: A.lights.append(dict(x=x, y=y, h=h, radius=r, intensity=i, color=c, shadow=True))
    for c in range(8, 15, 2):
        L(c * G + 80, 5 * G + 80, 220, 420, 1.9, '#ff1810')                               # corridor emergency lights
    L(4 * G, 5 * G, 250, 520, 1.5, '#ff2418')
    L(18 * G + 80, 5 * G + 80, 250, 520, 1.5, '#ff2418')
    L(26 * G, 6 * G, 420, 900, 1.8, '#ff3a18')
    L(18 * G + 80, 11 * G + 80, 230, 420, .6, '#ff2418')

    fires = [  # fire spots (open floor cells, never inside blocks): x, y, h
        (1 * G + 80, 4 * G + 80, 40), (5 * G + 80, 7 * G + 80, 40), (16 * G + 80, 4 * G + 80, 60),
        (18 * G + 80, 7 * G + 80, 60), (16 * G + 80, 3 * G + 80, 40), (24 * G + 80, 7 * G + 80, 40),
        (28 * G + 80, 4 * G + 80, 40), (21 * G + 80, 11 * G + 80, 40), (28 * G + 80, 8 * G + 80, 40),
    ]
    alarm = [(10 * G, 5 * G + 80, 235), (3 * G + 80, 5 * G, 270), (18 * G, 5 * G + 80, 270), (26 * G, 6 * G, 430)]
    zombies = [(5 * G + 80, 6 * G + 80), (11 * G + 80, 5 * G + 80), (16 * G + 80, 6 * G + 80), (20 * G + 80, 4 * G + 80),
               (17 * G + 80, 11 * G + 80), (24 * G + 80, 4 * G + 80), (28 * G + 80, 7 * G + 80), (26 * G + 80, 8 * G + 80)]
    A.theme([1 * G, 3 * G, 6 * G, 5 * G], 'metal', 'concrete')
    A.theme([7 * G, 5 * G, 8 * G, G], 'metal', 'concrete')
    A.theme([15 * G, 2 * G, 7 * G, 8 * G], 'metal', 'concrete')
    A.theme([25 * G, 5 * G, 3 * G, 2 * G], 'hazard', 'concrete')
    A.theme([22 * G, 3 * G, 8 * G, 6 * G], 'concrete', 'concrete')
    A.theme([15 * G, 10 * G, 7 * G, 3 * G], 'concrete', 'concrete')

    cells, walls, portals = BA.build(A, {})
    # side walls around blocks and the sunken pit (blocks carry their own risers)
    extra = []
    def strip(axis, coord, lo, hi, b, t, tag):
        f, to = BA.seg(axis, coord, lo, hi)
        extra.append({'id': f'a_f{len(extra)}', 'from': f, 'to': to, 'bottom': b, 'top': t, 'color': '#ffffff', 'tag': 'annex-' + tag})
    # (blocks and the pit get their risers from the generic opening walls of build_annex.build)
    # red emergency panels (emissive) along both corridor walls and over the control room door
    for c in range(8, 15, 2):
        strip('y', 5 * G + 3, c * G + 40, c * G + 120, 170, 215, 'alarm')
        strip('y', 6 * G - 3, c * G + 40, c * G + 120, 170, 215, 'alarm')
    for c in (2, 4):
        strip('y', 3 * G + 3, c * G, c * G + G, 150, 200, 'alarm')

    m = {'version': 1, 'name': 'Re2D fire facility', 'cells': cells, 'walls': walls + extra, 'portals': portals, 'slopes': [],
         'lighting': {'mode': 'classic', 'enabled': True, 'dynamic': True, 'shadows': True, 'distanceScale': 0.00012},
         'lights': A.lights}
    (HERE / 'fire.re2dmap').write_text(json.dumps(m, indent=1) + '\n')
    meta = {
        'spawn': {'x': 3 * G + 70, 'y': 5 * G + 70, 'h': 48, 'yaw': 0},   # never exactly on a cell edge (degenerate visibility window)
        'bounds': [G, 2 * G, 30 * G, 13 * G],
        'fires': [dict(x=x, y=y, h=h) for x, y, h in fires],
        'alarm': dict(file='annex/fire_alarm.mp3', range=2600, reference=320, volume=.55,
                      sources=[dict(x=x, y=y, h=h) for x, y, h in alarm]),
        'crackle': dict(file='annex/crackle.wav', range=800, reference=90, volume=.8),
        'boom': dict(file='annex/explosion.wav', volume=1.0, range=2600),
        'zombies': [dict(x=x, y=y) for x, y in zombies],
        'themes': A.themes,
    }
    (HERE / 'fire.json').write_text(json.dumps(meta, indent=1) + '\n')
    print('fire map: cells', len(cells), 'walls', len(walls) + len(extra), 'portals', len(portals), 'static lights', len(A.lights),
          'fires', len(fires), 'zombies', len(zombies))


if __name__ == '__main__':
    main()
