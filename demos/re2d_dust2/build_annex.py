#!/usr/bin/env python3
"""Append the big "Annex" wing to dust2.re2dmap (data only; native SDK compiles it).

Idempotent: everything this tool adds has an id starting with `a_`, static lights after the
first 3 originals are dropped and regenerated, routes.json `annex*` keys are rewritten.
Walls are emitted pre-split around openings (like the original door posts) so the compiled
authored-wall order of the original map is preserved.

    python3 demos/re2d_dust2/build_annex.py            # edit map + routes
    build/r2d-sdk world-compile demos/re2d_dust2/dust2.re2dmap --renderer \
        --output demos/re2d_dust2/dust2.re2dworld
    python3 demos/re2d_dust2/build_annex.py --doors    # map compiled door ids into routes.json
"""
import json, random, sys
from pathlib import Path

HERE = Path(__file__).parent
MAP = HERE / 'dust2.re2dmap'
ROUTES = HERE / 'routes.json'
WORLD = HERE / 'dust2.re2dworld'
G = 160
DOOR_W, DOOR_H = 96, 128


def span(bottom, top, floor, ceil, level, color, fog=None):
    s = {'bottom': bottom, 'top': top, 'floorColor': floor, 'ceilingColor': ceil,
         'lighting': {'level': level, 'color': color}}
    if fog:
        s['lighting']['fog'] = fog
    return s


class Annex:
    def __init__(self):
        self.cells = {}      # id -> dict(rect, spans, kind, wall)
        self.slopes = []
        self.doors = []      # portal specs with door flag
        self.openings = []   # explicit non-door portals
        self.windows = []
        self.lights = []
        self.dyn = []
        self.audio = []
        self.themes = []
        self.zones = []
        self.cameras = {}
        self.voids = set()

    # --- authoring helpers -------------------------------------------------
    def cell(self, cid, rect, spans, wall='plaster', group=None, top360=False):
        self.cells[cid] = dict(rect=list(rect), spans=spans, wall=wall, group=group, outdoor=top360)

    def grid(self, name, c0, r0, c1, r1, spans, wall, voids=(), group=None, outdoor=False):
        ids = {}
        for r in range(r0, r1):
            for c in range(c0, c1):
                if (c, r) in voids:
                    continue
                cid = f'a_{name}_{c}_{r}'
                self.cell(cid, [c * G, r * G, G, G], json.loads(json.dumps(spans)), wall, group or name, outdoor)
                ids[(c, r)] = cid
        return ids

    def door(self, a, b, along, width=DOOR_W, height=DOOR_H, door=True):
        self.doors.append(dict(a=a, b=b, along=along, width=width, height=height, door=door))

    def window(self, a, b, along, kind, width=96, lo=90, hi=190):
        self.windows.append(dict(a=a, b=b, along=along, kind=kind, width=width, lo=lo, hi=hi))

    def theme(self, rect, floor, ceil):
        self.themes.append(dict(rect=list(rect), floor=floor, ceil=ceil))

    def zone(self, rect, name, indoor=True):
        self.zones.append(dict(rect=list(rect), name=name, floor=0, indoor=indoor))


def overlap(a, b):
    """Shared edge of two rects: (axis, coord, lo, hi) or None. axis 'x' means vertical line x=coord."""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    if ax + aw == bx or bx + bw == ax:
        lo, hi = max(ay, by), min(ay + ah, by + bh)
        if hi > lo:
            return 'x', (ax + aw if ax + aw == bx else ax), lo, hi
    if ay + ah == by or by + bh == ay:
        lo, hi = max(ax, bx), min(ax + aw, bx + bw)
        if hi > lo:
            return 'y', (ay + ah if ay + ah == by else ay), lo, hi
    return None


def seg(axis, coord, lo, hi):
    return ([coord, lo], [coord, hi]) if axis == 'x' else ([lo, coord], [hi, coord])


def build(A, base):
    """Return (cells, walls, portals, slopes) lists for the annex."""
    cells = []
    for cid, c in A.cells.items():
        cells.append({'id': cid, 'rect': c['rect'], 'spans': c['spans']})
    for sl in A.slopes:
        pass
    rects = {cid: c['rect'] for cid, c in A.cells.items()}
    for sl in A.slopes:
        rects[sl['id']] = sl['rect']
    top = {cid: (360 if c['outdoor'] else max(s['top'] for s in c['spans'])) for cid, c in A.cells.items()}
    bottom = {cid: min(s['bottom'] for s in c['spans']) for cid, c in A.cells.items()}
    for sl in A.slopes:
        top[sl['id']] = sl['top']
        bottom[sl['id']] = min(sl['from'], sl['to'])
    wall_tag = {cid: c['wall'] for cid, c in A.cells.items()}
    for sl in A.slopes:
        wall_tag[sl['id']] = sl.get('wall', 'concrete')
    existing = dict(base)  # club room etc.
    for k, v in existing.items():
        rects[k] = v['rect']
        top[k] = max(s['top'] for s in v['spans'])
        bottom[k] = min(s['bottom'] for s in v['spans'])

    portals, walls = [], []
    covered = {}  # (a,b) -> list of intervals already carrying a portal

    def add_portal(a, b, axis, coord, lo, hi, openings, door):
        f, t = seg(axis, coord, lo, hi)
        portals.append({'id': f'a_p{len(portals)}', 'cellA': a, 'cellB': b, 'from': f, 'to': t,
                        'openings': openings, 'door': door})
        covered.setdefault(frozenset((a, b)), []).append((lo, hi))

    def span_list(cid):
        if cid in A.cells:
            return A.cells[cid]['spans']
        if cid in existing:
            return existing[cid]['spans']
        sl = next(s for s in A.slopes if s['id'] == cid)
        return [{'bottom': min(sl['from'], sl['to']), 'top': sl['top']}]

    def intersect(a, b, limit_top=None):
        out = []
        for sa in span_list(a):
            for sb in span_list(b):
                lo, hi = max(sa['bottom'], sb['bottom']), min(sa['top'], sb['top'])
                if limit_top is not None:
                    hi = min(hi, limit_top)
                if hi > lo:
                    out.append({'bottom': lo, 'top': hi})
        return out

    lintels = []
    # explicit doors / wide openings
    for d in A.doors:
        a, b = d['a'], d['b']
        e = overlap(rects[a], rects[b])
        assert e, f'door {a}-{b} not adjacent'
        axis, coord, lo, hi = e
        w = min(d['width'], hi - lo)
        c0 = max(lo, min(hi - w, d['along'] - w // 2)) if d['along'] is not None else lo
        c1 = c0 + w
        ops = intersect(a, b, d['height'] if d['door'] else None)
        assert ops, f'door {a}-{b} no free height'
        add_portal(a, b, axis, coord, c0, c1, ops, d['door'])

    # air portals inside groups; windows are walls only
    win_by_pair = {}
    for w in A.windows:
        win_by_pair.setdefault(frozenset((w['a'], w['b'])), []).append(w)
    ids = list(A.cells)
    seen = set()
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            ca, cb = A.cells[a], A.cells[b]
            e = overlap(ca['rect'], cb['rect'])
            if not e:
                continue
            key = frozenset((a, b))
            axis, coord, lo, hi = e
            if ca['group'] and ca['group'] == cb['group'] and (a, b) not in A.__dict__.get('closed', set()) \
                    and (b, a) not in A.__dict__.get('closed', set()):
                ops = intersect(a, b)
                if ops:
                    add_portal(a, b, axis, coord, lo, hi, ops, False)

    # walls: every cell edge interval minus portal intervals minus void/ramp-end exemptions
    def subtract(lo, hi, cuts):
        out = [(lo, hi)]
        for c0, c1 in sorted(cuts):
            nxt = []
            for l, h in out:
                if c1 <= l or c0 >= h:
                    nxt.append((l, h))
                else:
                    if c0 > l:
                        nxt.append((l, c0))
                    if c1 < h:
                        nxt.append((c1, h))
            out = nxt
        return [(l, h) for l, h in out if h - l > 0.01]

    wcount = [0]

    def emit_wall(axis, coord, lo, hi, b, t, tag, color='#ffffff'):
        f, to = seg(axis, coord, lo, hi)
        walls.append({'id': f'a_w{wcount[0]}', 'from': f, 'to': to, 'bottom': b, 'top': t,
                      'color': color, 'tag': 'annex-' + tag})
        wcount[0] += 1

    # ramp geometry: which edges are ends
    def ramp_end(sl, axis, coord):
        x, y, w, h = sl['rect']
        if sl['axis'] == 'x' and axis == 'x':
            if coord == x:
                return 'low' if sl['dir'] == 1 else 'high'
            if coord == x + w:
                return 'high' if sl['dir'] == 1 else 'low'
        if sl['axis'] == 'y' and axis == 'y':
            if coord == y:
                return 'low' if sl['dir'] == 1 else 'high'
            if coord == y + h:
                return 'high' if sl['dir'] == 1 else 'low'
        return None

    def ramp_edge_height(sl, end):
        return sl['to'] if end == 'high' else sl['from']

    all_ids = list(rects)
    handled_pairs = set()
    for a in all_ids:
        if a in existing:
            continue
        ra = rects[a]
        edges = [('x', ra[0], ra[1], ra[1] + ra[3]), ('x', ra[0] + ra[2], ra[1], ra[1] + ra[3]),
                 ('y', ra[1], ra[0], ra[0] + ra[2]), ('y', ra[1] + ra[3], ra[0], ra[0] + ra[2])]
        for axis, coord, lo, hi in edges:
            nbrs = []
            for b in all_ids:
                if b == a:
                    continue
                e = overlap(ra, rects[b])
                if e and e[0] == axis and e[1] == coord:
                    nbrs.append((b, e[2], e[3]))
            neighbor_cover = [(max(lo, n[1]), min(hi, n[2])) for n in nbrs]
            # void portion -> wall owned by a
            for l, h in subtract(lo, hi, neighbor_cover):
                if a in existing:
                    continue
                if coord == 2400 and axis == 'x' and 1680 <= l and h <= 2000:
                    continue
                is_slope = a not in A.cells
                end = None
                if is_slope:
                    sl = next(s for s in A.slopes if s['id'] == a)
                    end = ramp_end(sl, axis, coord)
                if end == 'low':
                    continue
                t = top[a]
                b0 = bottom[a]
                if end == 'high':
                    t = ramp_edge_height(next(s for s in A.slopes if s['id'] == a), 'high')
                emit_wall(axis, coord, l, h, b0, t, wall_tag[a])
            # shared portions: emit once (a < b)
            for b, l0, h0 in nbrs:
                key = frozenset((a, b))
                if (key, axis, coord) in handled_pairs:
                    continue
                handled_pairs.add((key, axis, coord))
                l, h = max(lo, l0), min(hi, h0)
                if b in existing:
                    continue
                cuts = list(covered.get(key, []))
                a_is_slope, b_is_slope = a not in A.cells, b not in A.cells
                ends = []
                for cid, flag in ((a, a_is_slope), (b, b_is_slope)):
                    if flag:
                        sl = next(s for s in A.slopes if s['id'] == cid)
                        ends.append((cid, ramp_end(sl, axis, coord), sl))
                low = any(e[1] == 'low' for e in ends)
                high = [e for e in ends if e[1] == 'high']
                for sl_, hh in subtract(l, h, cuts):
                    if low and not any(e[1] == 'high' for e in ends):
                        continue  # ramp low end flows into the neighbour
                    if low:
                        continue
                    tag = wall_tag[a]
                    if high:
                        e = high[0]
                        eh = ramp_edge_height(e[2], 'high')
                        other = b if e[0] == a else a
                        ob = bottom[other]
                        # solid below the ramp's high edge only (skipped when it is not above the neighbour floor)
                        if eh > ob:
                            emit_wall(axis, coord, sl_, hh, ob, eh, tag)
                    else:
                        wins = win_by_pair.get(key, [])
                        pieces = [(sl_, hh)]
                        for w in wins:
                            wl, wh = w['along'] - w['width'] // 2, w['along'] + w['width'] // 2
                            if wl < sl_ or wh > hh:
                                continue
                            pieces = [p for pp in pieces for p in subtract(pp[0], pp[1], [(wl, wh)])]
                            tmax = max(top[a], top[b])
                            emit_wall(axis, coord, wl, wh, min(bottom[a], bottom[b]), w['lo'], tag)
                            emit_wall(axis, coord, wl, wh, w['lo'], w['hi'], w['kind'])
                            emit_wall(axis, coord, wl, wh, w['hi'], tmax, tag)
                        for pl, ph in pieces:
                            emit_wall(axis, coord, pl, ph, min(bottom[a], bottom[b]), max(top[a], top[b]), tag)
                # a door leaves a lintel gap that native closures fill; nothing to author here
    # The runtime does not close the part of a span above/below an open portal opening, so every
    # portal gets explicit walls for the heights its openings do not cover (lintels, floor-to-floor gaps).
    def uncovered(cid, openings):
        out = []
        for sp in span_list(cid):
            rest = [(sp['bottom'], sp['top'])]
            for o in sorted(openings, key=lambda o: o['bottom']):
                nxt = []
                for l, h in rest:
                    if o['top'] <= l or o['bottom'] >= h:
                        nxt.append((l, h))
                    else:
                        if o['bottom'] > l:
                            nxt.append((l, o['bottom']))
                        if o['top'] < h:
                            nxt.append((o['top'], h))
                rest = nxt
            out += [(l, h) for l, h in rest if h - l > .5]
        return out
    for port in portals:
        a_, b_ = port['cellA'], port['cellB']
        if port['from'][0] == port['to'][0]:
            axis, coord = 'x', port['from'][0]
            lo, hi = sorted((port['from'][1], port['to'][1]))
        else:
            axis, coord = 'y', port['from'][1]
            lo, hi = sorted((port['from'][0], port['to'][0]))
        ranges = sorted(set(uncovered(a_, port['openings']) + uncovered(b_, port['openings'])))
        merged = []
        for l, h in ranges:
            if merged and l <= merged[-1][1] + .01:
                merged[-1] = (merged[-1][0], max(merged[-1][1], h))
            else:
                merged.append((l, h))
        taller = a_ if max(x['top'] for x in span_list(a_)) >= max(x['top'] for x in span_list(b_)) else b_
        tag = wall_tag.get(taller, 'metal')
        for l, h in merged:
            if a_ in existing and b_ in existing:
                continue
            emit_wall(axis, coord, lo, hi, l, h, tag)
    return cells, walls, portals


def main():
    doors_only = '--doors' in sys.argv
    if doors_only:
        fix_door_indices()
        return
    m = json.loads(MAP.read_text())
    for k in ('cells', 'walls', 'portals', 'slopes'):
        m[k] = [x for x in m[k] if not str(x['id']).startswith('a_')]
    m['lights'] = m['lights'][:3]
    # restore club east wall if previously split
    for w in list(m['walls']):
        if w['id'] == 'club_wall_301':
            w['from'], w['to'] = [2400, 1680], [2400, 2000]
    club = next(c for c in m['cells'] if c['id'] == 'club_room')

    A = Annex()
    # ---------------- layout ----------------
    # Blue fog gate corridor east of the club
    A.cell('a_gate', [2400, 1760, 960, 160],
           [span(0, 256, '#4a5568', '#222a38', .24, '#6f8cff', {'density': .0035, 'start': 80, 'color': '#16244a'})], 'metal')
    A.door('club_room', 'a_gate', 1840)

    # Dark brick maze (north of gate)
    rnd = random.Random(11)
    mc0, mr0, mc1, mr1 = 15, 5, 21, 11
    maze = A.grid('maze', mc0, mr0, mc1, mr1,
                  [span(0, 256, '#4a4a4a', '#222222', .1, '#ff6a48', {'density': .003, 'start': 40, 'color': '#120808'})],
                  'brick', group=None)
    A.closed = set()
    for cid in maze.values():
        A.cells[cid]['group'] = None
    stack = [(17, 10)]
    visited = {(17, 10)}
    passages = set()
    while stack:
        c, r = stack[-1]
        nb = [(c + dc, r + dr) for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1))
              if (c + dc, r + dr) in maze and (c + dc, r + dr) not in visited]
        if not nb:
            stack.pop()
            continue
        n = rnd.choice(nb)
        visited.add(n)
        passages.add(frozenset(((c, r), n)))
        stack.append(n)
    for p in passages:
        (c1, r1), (c2, r2) = tuple(p)
        A.doors.append(dict(a=maze[(c1, r1)], b=maze[(c2, r2)], along=None, width=G, height=256, door=False))
    A.door('a_gate', maze[(17, 10)], 2800)
    A.theme([2400, 800, 960, 960], 'concrete', 'concrete')

    # Grand hall with 7 pillars
    hall_spans = [span(0, 480, '#b8b0a0', '#6a6258', .46, '#ffe2b8')]
    pill = {(23, 9), (23, 13), (26, 9), (26, 13), (29, 9), (29, 13), (26, 11)}
    hall = A.grid('hall', 21, 8, 31, 15, hall_spans, 'plaster', voids=pill)
    A.door('a_gate', hall[(21, 11)], 1840, width=160, height=256, door=False)
    A.door(maze[(20, 10)], hall[(21, 10)], 1680, door=True)
    A.theme([3360, 1280, 1600, 1120], 'tile', 'concrete')

    # Server room (dark, red, emissive racks)
    sv = A.grid('srv', 24, 4, 28, 8,
                [span(0, 320, '#30343a', '#16181c', .06, '#ff4030', {'density': .002, 'start': 60, 'color': '#200808'})],
                'server', voids={(24, 5), (25, 5), (26, 6), (27, 6)})
    A.door(sv[(25, 7)], hall[(25, 8)], 4080)
    A.window(sv[(27, 7)], hall[(27, 8)], 4400, 'grate', lo=40, hi=220)
    A.theme([3840, 640, 640, 640], 'metal', 'concrete')

    # Toxic pool room
    tx = [
        ('a_tx_n', [3840, 2400, 640, 160]), ('a_tx_s', [3840, 2880, 640, 160]),
        ('a_tx_w', [3840, 2560, 80, 320]), ('a_tx_e', [4400, 2560, 80, 320]),
    ]
    tspan = lambda b: [span(b, 320, '#3c6a44', '#1c2c20', .26, '#78ff98', {'density': .006, 'start': 30, 'color': '#0c3418'})]
    for cid, r in tx:
        A.cell(cid, r, tspan(0), 'metal', group='tx')
    A.cell('a_tx_pool', [3920, 2560, 400, 320], tspan(-32), 'metal', group='tx')
    A.slopes.append({'id': 'a_tx_ramp', 'rect': [4320, 2560, 80, 320], 'axis': 'x', 'dir': 1, 'from': -32, 'to': 0,
                     'top': 320, 'floorColor': '#3c6a44', 'ceilingColor': '#1c2c20',
                     'lighting': {'level': .26, 'color': '#78ff98', 'fog': {'density': .006, 'start': 30, 'color': '#0c3418'}},
                     'wall': 'metal'})
    A.door('a_tx_n', hall[(25, 14)], 4080)
    A.theme([3920, 2560, 400, 320], 'toxic', 'concrete')
    A.theme([3840, 2400, 640, 640], 'hazard', 'concrete')

    # Three offices south of gate
    off = [('a_off1', [2400, 1920, 320, 480], 2560, 'wood', .62, '#ffd48a', '#8a6a44'),
           ('a_off2', [2720, 1920, 320, 480], 2880, 'carpet', .5, '#ff9ad8', '#703050'),
           ('a_off3', [3040, 1920, 320, 480], 3200, 'tile', .78, '#cfe9ff', '#c8d6e0')]
    for cid, r, along, mat, lv, col, fl in off:
        A.cell(cid, r, [span(0, 256, fl, '#d8d2c8', lv, col)], 'plaster')
        A.door('a_gate', cid, along)
        A.theme(r, mat, 'plaster')
    A.window('a_gate', 'a_off2', 2780, 'glass')

    # Atrium: two storeys at the same XY
    A.cell('a_atrium', [4960, 1280, 960, 1120],
           [span(0, 224, '#a8a090', '#585048', .4, '#fff0dd'), span(288, 544, '#7c8aa0', '#3c4452', .5, '#cfe0ff')], 'plaster')
    for r in range(8, 15):
        A.doors.append(dict(a=hall[(30, r)], b='a_atrium', along=None, width=G, height=100000, door=False))
    A.theme([4960, 1280, 960, 1120], 'concrete', 'concrete')

    # Service corridors, ramp and yard
    A.cell('a_sv1', [5120, 2400, 160, 320], [span(0, 224, '#6a6258', '#3a3630', .2, '#ffb060', {'density': .0025, 'start': 40, 'color': '#3a2e22'})], 'concrete')
    A.cell('a_sv2', [5120, 2720, 1280, 160], [span(0, 224, '#6a6258', '#3a3630', .2, '#ffb060', {'density': .0025, 'start': 40, 'color': '#3a2e22'})], 'concrete')
    A.door('a_atrium', 'a_sv1', 5200)
    A.doors.append(dict(a='a_sv1', b='a_sv2', along=None, width=160, height=224, door=False))
    A.theme([5120, 2400, 1280, 480], 'metal', 'concrete')
    A.slopes.append({'id': 'a_ramp', 'rect': [5920, 1760, 480, 160], 'axis': 'x', 'dir': -1, 'from': 0, 'to': 288,
                     'top': 544, 'floorColor': '#9a948a', 'ceilingColor': '#3c4452',
                     'lighting': {'level': .38, 'color': '#e8f0ff'}, 'wall': 'concrete'})
    yard_span = lambda b: [span(b, 1024, '#5a7a3a' if b == 0 else '#8a8f98', '#9ac0e0', .9, '#fffaf0',
                                {'density': .0008, 'start': 300, 'color': '#d8c8a0'})]
    yard = A.grid('yard', 40, 8, 45, 18, yard_span(0), 'plaster', outdoor=True)
    covers = {(41, 10): 200, (41, 11): 200, (43, 13): 140, (43, 14): 140, (42, 16): 100, (40, 9): 140, (44, 9): 140,
              (41, 12): 56, (42, 12): 56, (41, 13): 56, (42, 13): 56}
    for (c, r), hgt in covers.items():
        A.cells[yard[(c, r)]]['spans'] = yard_span(hgt)
    cover_walls = dict(covers)
    A.door('a_sv2', yard[(40, 17)], 2800, width=160, height=224, door=False)

    A.theme([6400, 1280, 800, 1600], 'grass', 'plaster')

    # ---------------- lights / audio / cameras ------------------------------------------
    L = lambda x, y, h, r, i, c, sh=True: A.lights.append(dict(x=x, y=y, h=h, radius=r, intensity=i, color=c, shadow=sh))
    for x in (2560, 2960, 3280):
        L(x, 1840, 170, 330, .9, '#4a70ff')
    for x, y in ((2480, 1700), (2800, 1220), (3240, 900), (2640, 1020)):
        L(x, y, 120, 260, .7, '#ff3a20')
    for c in (22, 25, 28):
        for y in (1360, 1840, 2320):
            L(c * G + 80, y, 330, 520, 1.0, '#ff8a3a' if (c + y // 160) % 2 else '#4aa8ff')
    for x, y in ((3960, 760), (4400, 1180)):
        L(x, y, 220, 320, .9, '#ff2a2a')
    L(4160, 2720, 140, 360, 1.3, '#40ff80')
    L(4000, 2960, 140, 260, .9, '#40ff80')
    L(4400, 2960, 140, 260, .9, '#40ff80')
    L(2560, 2160, 180, 300, 1.0, '#ffcf88')
    L(2880, 2160, 180, 300, 1.0, '#ff70d0')
    L(3200, 2160, 180, 300, 1.1, '#e8f4ff')
    L(5440, 1840, 150, 600, 1.0, '#fff0dd')
    L(5440, 1500, 440, 600, 1.1, '#aac8ff')
    L(5440, 2200, 440, 600, 1.0, '#ffd0a0')
    L(5200, 2600, 150, 300, .9, '#ffb060')
    L(5760, 2800, 150, 300, .9, '#ffb060')
    L(6160, 1840, 380, 360, .9, '#e8f0ff')
    L(6800, 2000, 500, 1200, 1.4, '#fff4d8')
    L(6800, 1500, 500, 1000, 1.2, '#fff4d8')
    A.dyn = [
        dict(x=4080, y=1000, h=240, radius=520, intensity=1.8, color='#ff2020', pulse=dict(min=.1, max=1.0, rate=1.6)),
        dict(x=4000, y=1180, h=200, radius=420, intensity=1.4, color='#ff5030', flicker=dict(min=.3, max=1.0, rate=11, seed=3)),
        dict(x=4160, y=2720, h=60, radius=420, intensity=1.6, color='#40ff80', flicker=dict(min=.55, max=1.0, rate=5, seed=9)),
        dict(x=2900, y=1140, h=120, radius=360, intensity=1.2, color='#ff3820', flicker=dict(min=.1, max=1.0, rate=14, seed=21)),
        dict(x=3040, y=1500, h=140, radius=300, intensity=1.0, color='#ff7040', flicker=dict(min=.2, max=1.0, rate=9, seed=5)),
        dict(x=5440, y=1840, h=500, radius=700, intensity=1.2, color='#80b8ff', orbit=dict(cx=5440, cy=1840, r=320, speed=.5)),
        dict(x=4160, y=1840, h=330, radius=800, intensity=1.5, color='#ff40ff', orbit=dict(cx=4160, cy=1840, r=480, speed=.4)),
        dict(x=4160, y=1840, h=330, radius=800, intensity=1.5, color='#40ffff', orbit=dict(cx=4160, cy=1840, r=480, speed=-.4, phase=3.14)),
    ]
    # HRTF sources (the game keeps only the nearest few alive; 16 mixer channels total)
    S = lambda f, x, y, h, rng, ref, vol: A.audio.append(dict(file='annex/' + f, x=x, y=y, h=h, range=rng, reference=ref, volume=vol))
    S('buzz.wav', 2560, 1840, 200, 700, 80, .35)
    S('buzz.wav', 3200, 1840, 200, 700, 80, .35)
    S('drip.wav', 2900, 1200, 100, 500, 60, .6)
    S('drip.wav', 3200, 900, 100, 500, 60, .6)
    S('rumble.wav', 4160, 1840, 300, 1500, 300, .5)
    S('hum_server.wav', 4000, 900, 160, 900, 100, .7)
    S('fan.wav', 4300, 700, 280, 800, 100, .5)
    S('alarm.wav', 4080, 1000, 240, 1200, 150, .35)
    S('bubble.wav', 4120, 2720, 40, 800, 100, .8)
    S('crackle.wav', 4440, 2560, 200, 600, 80, .4)
    S('tick.wav', 2560, 2200, 150, 450, 50, .6)
    S('hum_server.wav', 2880, 2300, 120, 450, 60, .25)
    S('fan.wav', 3200, 2100, 240, 500, 80, .4)
    S('rumble.wav', 5440, 1840, 350, 1400, 300, .4)
    S('drip.wav', 5200, 2600, 100, 500, 60, .6)
    S('fan.wav', 5760, 2800, 190, 600, 80, .4)
    S('water.wav', 6640, 1760, 40, 900, 100, .8)
    A.cameras = {
        'ANNEX GATE': [2440, 1840, 48, 0], 'MAZE': [2800, 1680, 48, -90], 'GRAND HALL': [3400, 1840, 48, 0],
        'SERVER': [4080, 1220, 48, -90], 'TOXIC': [4080, 2440, 48, 90], 'OFFICES': [2440, 1800, 48, 90],
        'ATRIUM LOW': [5000, 1840, 48, 0], 'MEZZANINE': [5700, 1840, 336, 180], 'YARD': [6440, 2000, 48, 0],
    }
    # zones for HUD/sky
    A.zone([2400, 1760, 960, 160], 'ANNEX / BLUE GATE')
    A.zone([2400, 800, 960, 960], 'ANNEX / MAZE')
    A.zone([3360, 1280, 1600, 1120], 'ANNEX / GRAND HALL')
    A.zone([3840, 640, 640, 640], 'ANNEX / SERVER ROOM')
    A.zone([3840, 2400, 640, 640], 'ANNEX / TOXIC ROOM')
    A.zone([2400, 1920, 960, 480], 'ANNEX / OFFICES')
    A.zone([4960, 1280, 960, 1120], 'ANNEX / ATRIUM')
    A.zone([5120, 2400, 1280, 480], 'ANNEX / SERVICE')
    A.zone([5920, 1760, 480, 160], 'ANNEX / RAMP')
    A.zone([6400, 1280, 800, 1600], 'ANNEX / YARD', indoor=False)

    # ---------------- emit -----------------------------------------------------------------------
    base = {'club_room': club}
    cells, walls, portals = build(A, base)
    # split the club east wall around the new door (preserves original indices; extra piece appended)
    cw = next(w for w in m['walls'] if w['id'] == 'club_wall_301')
    cw['from'], cw['to'] = [2400, 1680], [2400, 1792]
    extra = dict(cw)
    extra.update(id='a_club_wall_b', **{'from': [2400, 1888], 'to': [2400, 2000]})
    neon = []
    def strip(axis, coord, lo, hi):
        f, t = seg(axis, coord, lo, hi)
        neon.append({'id': f'a_xn{len(neon)}', 'from': f, 'to': t, 'bottom': 200, 'top': 236, 'color': '#ffffff', 'tag': 'annex-neon'})
    for (c, r) in pill:
        x0, y0 = c * G, r * G
        strip('y', y0 - 2, x0, x0 + G); strip('y', y0 + G + 2, x0, x0 + G)
        strip('x', x0 - 2, y0, y0 + G); strip('x', x0 + G + 2, y0, y0 + G)
    for x0 in range(3400, 4900, 300):
        strip('y', 1282, x0, x0 + 160); strip('y', 2398, x0, x0 + 160)
    def side(axis, coord, lo, hi, b0, t0, tag):
        f, t = seg(axis, coord, lo, hi)
        neon.append({'id': f'a_xn{len(neon)}', 'from': f, 'to': t, 'bottom': b0, 'top': t0, 'color': '#ffffff', 'tag': 'annex-' + tag})
    for (c, r), hgt in cover_walls.items():
        x0, y0 = c * G, r * G
        for nx, ny, axis, coord, lo, hi in ((c - 1, r, 'x', x0, y0, y0 + G), (c + 1, r, 'x', x0 + G, y0, y0 + G),
                                            (c, r - 1, 'y', y0, x0, x0 + G), (c, r + 1, 'y', y0 + G, x0, x0 + G)):
            if cover_walls.get((nx, ny)) == hgt:
                continue
            side(axis, coord, lo, hi, 0, hgt, 'concrete')
    side('x', 3920, 2560, 2880, -32, 0, 'hazard')
    side('y', 2560, 3920, 4320, -32, 0, 'hazard')
    side('y', 2880, 3920, 4320, -32, 0, 'hazard')
    m['cells'] += cells
    m['walls'] += [extra] + walls + neon
    m['portals'] += portals
    m['slopes'] += A.slopes
    m['lights'] += A.lights
    MAP.write_text(json.dumps(m, indent=2) + '\n')

    r = json.loads(ROUTES.read_text())
    r['annexCameras'] = A.cameras
    r['annexLights'] = A.dyn
    r['annexAudio'] = A.audio
    r['annexThemes'] = A.themes
    r['annexDoors'] = []
    r.pop('annexFire', None)
    r['zones'] = [z for z in r['zones'] if not z['name'].startswith('ANNEX')] + A.zones
    ROUTES.write_text(json.dumps(r, indent=2) + '\n')
    print('annex: cells', len(cells), 'slopes', len(A.slopes), 'walls', len(walls) + 1 + len(neon), 'portals', len(portals),
          'static lights', len(A.lights), 'dynamic', len(A.dyn), 'audio', len(A.audio))


def fix_door_indices():
    """Map annex door portals to compiled portal indices (matched by endpoints)."""
    m = json.loads(MAP.read_text())
    w = json.loads(WORLD.read_text())
    comp = w['portals']
    want = [p for p in m['portals'] if p['id'].startswith('a_') and p.get('door')]
    idx = []
    for p in want:
        for i, q in enumerate(comp):
            if sorted(map(tuple, (q['from'], q['to']))) == sorted(map(tuple, (p['from'], p['to']))) and i >= 152:
                idx.append(i)
                break
        else:
            print('door not found in compiled world:', p['id'], p['from'], p['to'])
    r = json.loads(ROUTES.read_text())
    r['annexDoors'] = idx
    ROUTES.write_text(json.dumps(r, indent=2) + '\n')
    print('annex doors', idx)


if __name__ == '__main__':
    main()
