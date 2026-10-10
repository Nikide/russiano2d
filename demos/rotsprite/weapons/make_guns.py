#!/usr/bin/env python3
"""Generate detailed Re2DSprite weapons: pixel-art textures + real 3D volumes -> OBJ -> r2d-sdk bake-re2d.

No external art: every part is drawn here with a tiny pixel toolkit (masks, material
shading, rim light, outline). Output per gun (same format as ak47.*):
    <name>.material.png   1024x1024 part sheet
    <name>.surface.json   'grid' patches (flat plates, prisms, cylinders)
    <name>.character.json bone/parts/sockets (trigger, foregrip, muzzle)
    <name>.png            compiled 4096 atlas (tools/compile_rotsprite.py)

Run:  python3 demos/rotsprite/weapons/make_guns.py [name ...]
Units: x forward (muzzle +x), y down, z toward the viewer at yaw 0. ~12 art px per unit.
"""
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent

S = 12  # art pixels per unit
OUTLINE = np.array([12, 13, 17])

# ------------------------------------------------------------------ materials
def _noise(h, w, rnd, amp):
    return (np.array([[rnd.random() for _ in range(w)] for _ in range(h)]) - .5) * amp


def mat_steel(h, w, rnd, tone=1.0):
    t = np.linspace(0, 1, h)[:, None]
    base = np.array([138, 148, 166]) * (1 - t ** .8)[..., None] + np.array([34, 38, 48]) * (t ** .8)[..., None]
    spec = np.exp(-((t - .2) / .06) ** 2) * 70
    img = (base + spec[..., None]) * tone
    return img + _noise(h, w, rnd, 8)[..., None]


def mat_blued(h, w, rnd):
    t = np.linspace(0, 1, h)[:, None]
    base = np.array([112, 124, 146]) * (1 - t ** .7)[..., None] + np.array([30, 34, 44]) * (t ** .7)[..., None]
    spec = np.exp(-((t - .16) / .05) ** 2) * 80
    return base + spec[..., None] + _noise(h, w, rnd, 6)[..., None]


def mat_wood(h, w, rnd):
    yy, xx = np.mgrid[0:h, 0:w]
    grain = np.sin(yy * .55 + np.sin(xx * .12) * 2.2 + rnd.random() * 6) * .5 + .5
    t = yy / max(1, h - 1)
    base = np.array([164, 88, 36]) * (1 - .45 * t)[..., None]
    dark = np.array([84, 38, 16])
    img = base * (1 - .5 * grain[..., None]) + dark * (.5 * grain[..., None])
    return img + _noise(h, w, rnd, 10)[..., None]


def mat_poly(h, w, rnd):
    t = np.linspace(0, 1, h)[:, None]
    base = np.array([62, 66, 74]) * (1 - t)[..., None] + np.array([24, 26, 30]) * t[..., None]
    return base + _noise(h, w, rnd, 7)[..., None]


def mat_brass(h, w, rnd):
    t = np.linspace(0, 1, h)[:, None]
    base = np.array([236, 196, 84]) * (1 - t)[..., None] + np.array([138, 98, 30]) * t[..., None]
    return base + _noise(h, w, rnd, 6)[..., None]


def mat_olive(h, w, rnd):
    t = np.linspace(0, 1, h)[:, None]
    base = np.array([108, 122, 76]) * (1 - t)[..., None] + np.array([46, 56, 34]) * t[..., None]
    return base + _noise(h, w, rnd, 8)[..., None]


def mat_skin(h, w, rnd):
    t = np.linspace(0, 1, h)[:, None]
    base = np.array([226, 178, 140]) * (1 - .35 * t)[..., None] + np.array([150, 100, 74]) * (.35 * t)[..., None]
    return base + _noise(h, w, rnd, 6)[..., None]


MATS = dict(skin=mat_skin, steel=mat_steel, blued=mat_blued, wood=mat_wood, poly=mat_poly, brass=mat_brass, olive=mat_olive)

# ------------------------------------------------------------------ pixel canvas
class Art:
    """Silhouette canvas in unit space [x0..x1]x[y0..y1] at S px/unit."""

    def __init__(self, x0, x1, y0, y1, seed=1):
        self.x0, self.y0 = x0, y0
        up4 = lambda v: max(4, int(math.ceil(round(v * S) / 4.0)) * 4)
        self.w, self.h = up4(x1 - x0), up4(y1 - y0)
        self.x1, self.y1 = x0 + self.w / S, y0 + self.h / S
        self.rgb = np.zeros((self.h, self.w, 3))
        self.alpha = np.zeros((self.h, self.w), bool)
        self.rnd = random.Random(seed)
        self.silhouettes = []   # polygons (unit space) that define the extruded volume

    def px(self, x, y):
        return ((x - self.x0) * S, (y - self.y0) * S)

    def _mask(self, draw_fn):
        m = Image.new('L', (self.w, self.h), 0)
        draw_fn(ImageDraw.Draw(m))
        return np.array(m) > 127

    def poly(self, pts, mat, **kw):
        if not self.alpha.any() and 'flat' not in kw:
            self.silhouettes.append(list(pts))
        m = self._mask(lambda d: d.polygon([self.px(*p) for p in pts], fill=255))
        return self._paint(m, mat, **kw)

    def rect(self, x0, y0, x1, y1, mat, **kw):
        return self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], mat, **kw)

    def ellipse(self, cx, cy, rx, ry, mat, **kw):
        if not self.alpha.any() and 'flat' not in kw:
            self.silhouettes.append([(cx + math.cos(i / 24 * 2 * math.pi) * rx, cy + math.sin(i / 24 * 2 * math.pi) * ry) for i in range(24)])
        a, b = self.px(cx - rx, cy - ry), self.px(cx + rx, cy + ry)
        m = self._mask(lambda d: d.ellipse([a[0], a[1], b[0] - 1, b[1] - 1], fill=255))
        return self._paint(m, mat, **kw)

    def _paint(self, m, mat, tone=1.0, flat=None):
        if flat is not None:
            tex = np.zeros((self.h, self.w, 3)) + np.array(flat)
        else:
            ys, xs = np.nonzero(m)
            if not len(ys):
                return m
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            sub = MATS[mat](y1 - y0, x1 - x0, self.rnd) * tone if mat != 'steel' else mat_steel(y1 - y0, x1 - x0, self.rnd, tone)
            tex = np.zeros((self.h, self.w, 3))
            tex[y0:y1, x0:x1] = sub
        self.rgb[m] = tex[m]
        self.alpha |= m
        return m

    def line(self, p, q, color, width=1.0):
        m = self._mask(lambda d: d.line([self.px(*p), self.px(*q)], fill=255, width=max(1, int(round(width * S / 6)))))
        m &= self.alpha
        self.rgb[m] = color

    def dots(self, pts, color, r=.07):
        for x, y in pts:
            m = self._mask(lambda d: d.ellipse([self.px(x - r, y - r)[0], self.px(x - r, y - r)[1], self.px(x + r, y + r)[0], self.px(x + r, y + r)[1]], fill=255))
            m &= self.alpha
            self.rgb[m] = color

    def darken_rect(self, x0, y0, x1, y1, color):
        m = self._mask(lambda d: d.rectangle([*self.px(x0, y0), *self.px(x1, y1)], fill=255)) & self.alpha
        self.rgb[m] = color

    def ribs(self, x0, x1, y0, y1, step, color=(20, 22, 28), horizontal=False):
        x = x0
        while x < x1:
            if horizontal:
                self.darken_line(x0, x, x1, x, color)
            else:
                self.darken_line(x, y0, x, y1, color)
            x += step

    def darken_line(self, x0, y0, x1, y1, color):
        m = self._mask(lambda d: d.line([self.px(x0, y0), self.px(x1, y1)], fill=255, width=1)) & self.alpha
        self.rgb[m] = color

    def finish(self):
        """Rim light on upper edges, shade on lower edges, 1px outline; returns RGBA uint8."""
        a = self.alpha
        up = np.zeros_like(a); up[1:] = ~a[:-1]            # transparent above
        dn = np.zeros_like(a); dn[:-1] = ~a[1:]            # transparent below
        rgb = self.rgb.copy()
        edge_up = a & up
        edge_dn = a & dn
        rgb[edge_up] = np.clip(rgb[edge_up] * 1.28 + 14, 0, 255)
        rgb[edge_dn] = rgb[edge_dn] * .62
        # outline = dilated mask minus mask, but only inside canvas border margin handled by padding
        pad = np.pad(a, 1)
        inner = pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:] & a
        outline = a & ~inner          # outline lives inside the silhouette so geometry == picture
        out = np.zeros((self.h, self.w, 4), np.uint8)
        out[a, :3] = np.clip(rgb[a], 0, 255)
        out[a, 3] = 255
        out[outline, :3] = OUTLINE
        return Image.fromarray(out, 'RGBA')


def flat_tile(color, size=16):
    return Image.new('RGBA', (size, size), tuple(int(c) for c in color) + (255,))


def gradient_strip(w, h, dark, light, rnd):
    """Cylinder shading across rows: dark -> light -> dark."""
    t = np.linspace(0, 1, h)
    k = np.sin(t * math.pi)[:, None, None]
    img = np.array(dark) * (1 - k) + np.array(light) * k
    img = np.repeat(img, w, axis=1) + _noise(h, w, rnd, 5)[..., None]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')

# ------------------------------------------------------------------ 3D model builder (OBJ)
def triangulate(poly):
    """Ear clipping for a simple polygon (list of (x, y)); returns index triples."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    idx = list(range(n)) if area > 0 else list(range(n - 1, -1, -1))
    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    def inside(p, a, b, c):
        return cross(a, b, p) >= 0 and cross(b, c, p) >= 0 and cross(c, a, p) >= 0
    tris = []
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if cross(a, b, c) <= 1e-9:
                continue
            if any(inside(poly[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            break
        else:
            break
    if len(idx) == 3:
        tris.append(tuple(idx))
    return tris


class Gun:
    """Collects textured volumes; writes <name>.obj/.mtl/.png (source) for r2d-sdk bake-re2d."""

    def __init__(self, name, seed=3, fp=False, two_hand=True):
        self.name = name + ('_fp' if fp else '')
        self.fp, self.two_hand = fp, two_hand
        self.rnd = random.Random(seed)
        self.v, self.vt, self.f = [], [], []
        self.sheet = Image.new('RGBA', (2048, 2048), (0, 0, 0, 0))
        self.cursor = [0, 0, 0]
        self.sockets = {}

    def pack(self, img):
        w, h = img.size
        w2, h2 = w + 4, h + 4                      # 2 px bleed margin
        x, y, rh = self.cursor
        if x + w2 > 2048:
            x, y, rh = 0, y + rh, 0
        assert y + h2 <= 2048, 'material sheet full'
        self.sheet.alpha_composite(img, (x + 2, y + 2))
        self.cursor = [x + w2, y, max(rh, h2)]
        return (x + 2, y + 2, w, h)

    def _uv(self, rect, u, v):
        x, y, w, h = rect
        return (x + u * w, y + v * h)              # pixel space; normalised in write()

    def _vert(self, x, y, z):
        self.v.append((x, -y, z))                   # OBJ is Y-up; our unit space is Y-down
        return len(self.v)

    def _tex(self, rect, u, v):
        self.vt.append(self._uv(rect, u, v))
        return len(self.vt)

    def _quad(self, a, b, c, d, rect_uv):
        self.f.append([(a, rect_uv[0]), (b, rect_uv[1]), (c, rect_uv[2]), (d, rect_uv[3])])

    def volume(self, art, polys, z, edge=None):
        """Extrude silhouette polygons to +-z; textured faces use the art, sides a flat tile."""
        img = art.finish()
        rect_front, rect_back = self.pack(img), self.pack(img)   # unique UV cells per face (baker counts overlaps)
        col = edge if edge is not None else (tuple(np.clip(art.rgb[art.alpha].mean(0) * .75, 0, 255)) if art.alpha.any() else (40, 40, 40))
        tw, th = art.w / S, art.h / S
        for poly in polys:
            tris = triangulate(poly)
            for zz, flip in ((z, False), (-z, True)):
                ids = [self._vert(x, y, zz) for x, y in poly]
                rect = rect_back if flip else rect_front
                uvs = [self._tex(rect, (x - art.x0) / tw, (y - art.y0) / th) for x, y in poly]
                for i0, i1, i2 in tris:
                    tri = [(ids[i0], uvs[i0]), (ids[i1], uvs[i1]), (ids[i2], uvs[i2])]
                    self.f.append(tri[::-1] if flip else tri)
            n = len(poly)
            area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
            order = list(range(n)) if area > 0 else list(range(n - 1, -1, -1))
            for k in range(n):
                p, q = poly[order[k]], poly[order[(k + 1) % n]]
                length = math.hypot(q[0] - p[0], q[1] - p[1])
                if length < 1e-6:
                    continue
                w = max(4, int(math.ceil(length * S / 4)) * 4)
                h = max(4, int(math.ceil(2 * z * S / 4)) * 4)
                strip = self.pack(flat_tile(col, 4).resize((w, h), Image.NEAREST))
                a, b = self._vert(p[0], p[1], z), self._vert(q[0], q[1], z)
                c, d = self._vert(q[0], q[1], -z), self._vert(p[0], p[1], -z)
                uv = [self._tex(strip, 0, 0), self._tex(strip, 0, 1), self._tex(strip, 1, 1), self._tex(strip, 1, 0)]
                self._quad(a, d, c, b, uv)

    def plate(self, art, *_ignored, z=None, **kw):
        # legacy signature plate(art, x0, x1, y0, y1, z): z is the last positional or kw
        if z is None:
            z = _ignored[-1] if _ignored and not isinstance(_ignored[-1], bool) else .5
        polys = art.silhouettes or [[(art.x0 + .1, art.y0 + .1), (art.x1 - .1, art.y0 + .1), (art.x1 - .1, art.y1 - .1), (art.x0 + .1, art.y1 - .1)]]
        self.volume(art, polys, z)

    def barrel(self, x0, x1, cy, radius, dark, light, segs=10, cz=0.0, pid=None):
        length, circ = abs(x1 - x0), 2 * math.pi * radius
        strip = self.pack(gradient_strip(max(8, int(math.ceil(length * S / 4)) * 4), max(16, int(math.ceil(circ * S / 4)) * 4), dark, light, self.rnd))
        rings = []
        for xx in (x0, x1):
            rings.append([self._vert(xx, cy + math.sin(i / segs * 2 * math.pi) * radius, cz + math.cos(i / segs * 2 * math.pi) * radius) for i in range(segs)])
        for i in range(segs):
            j = (i + 1) % segs
            uv = [self._tex(strip, 0, i / segs), self._tex(strip, 1, i / segs), self._tex(strip, 1, (i + 1) / segs), self._tex(strip, 0, (i + 1) / segs)]
            self._quad(rings[0][i], rings[1][i], rings[1][j], rings[0][j], uv)
        side = max(8, int(math.ceil(2 * radius * S / 4)) * 4)
        for ring, flip in ((rings[0], True), (rings[1], False)):
            cap = self.pack(flat_tile(np.array(dark) * .7, 4).resize((side, side), Image.NEAREST))
            uvs = [self._tex(cap, .5 + .5 * math.cos(i / segs * 2 * math.pi), .5 + .5 * math.sin(i / segs * 2 * math.pi)) for i in range(segs)]
            for i in range(1, segs - 1):
                tri = [(ring[0], uvs[0]), (ring[i], uvs[i]), (ring[i + 1], uvs[i + 1])]
                self.f.append(tri[::-1] if flip else tri)

    def disc(self, art, cx, cy, radius, z, segs=18, **_):
        poly = [(cx + math.cos(i / segs * 2 * math.pi) * radius, cy + math.sin(i / segs * 2 * math.pi) * radius) for i in range(segs)]
        self.volume(art, [poly], z, edge=(54, 60, 72))

    def socket(self, name, p):
        self.sockets[name] = p

    # --- first-person hands: gloved hands on the grips + sleeved forearms -----------------
    def _glove(self, cx, cy, w, h, seed, z=.95):
        a = Art(cx - w / 2 - .2, cx + w / 2 + .2, cy - h / 2 - .2, cy + h / 2 + .2, seed)
        x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
        a.poly([(x0 + .5, y0), (x1 - .5, y0), (x1, y0 + .6), (x1, y1 - .9), (x1 - .8, y1), (x0 + .8, y1), (x0, y1 - .9), (x0, y0 + .6)], 'skin')
        for k in range(1, 4):                                      # finger seams
            a.line((x0 + .3, y0 + k * h / 4.2), (x1 - .3, y0 + k * h / 4.2), (120, 74, 52), 1)
        a.rect(x0 + .2, y1 - .9, x1 - .2, y1 - .2, 'poly')                # wrist band
        a.dots([(cx + w * .25, y0 + .7)], (250, 214, 184), .09)           # knuckle highlight
        self.plate(a, z=z)

    def _forearm(self, wx, wy, ex, ey, seed, w0=1.25, w1=1.9):
        dx, dy = ex - wx, ey - wy
        d = math.hypot(dx, dy)
        nx, ny = -dy / d, dx / d
        quad = [(wx + nx * w0, wy + ny * w0), (wx - nx * w0, wy - ny * w0), (ex - nx * w1, ey - ny * w1), (ex + nx * w1, ey + ny * w1)]
        xs, ys = [q[0] for q in quad], [q[1] for q in quad]
        a = Art(min(xs) - .2, max(xs) + .2, min(ys) - .2, max(ys) + .2, seed)
        a.poly(quad, 'olive')
        for t in (.12, .55, .8):                                   # sleeve folds
            px, py = wx + dx * t, wy + dy * t
            w = w0 + (w1 - w0) * t
            a.line((px + nx * w, py + ny * w), (px - nx * w, py - ny * w), (34, 42, 26), 1)
        cuff = [(wx + nx * w0, wy + ny * w0), (wx - nx * w0, wy - ny * w0),
                (wx + dx * .09 - nx * (w0 + .05), wy + dy * .09 - ny * (w0 + .05)), (wx + dx * .09 + nx * (w0 + .05), wy + dy * .09 + ny * (w0 + .05))]
        a.poly(cuff, 'poly', flat=(26, 28, 34))
        self.plate(a, z=1.05)

    def _add_hands(self):
        tx, ty, _ = self.sockets['trigger']
        fx, fy, _ = self.sockets['foregrip']
        # right hand on the grip, forearm falling back and down toward the viewer's elbow
        self._glove(tx - .1, ty + .6, 4.6, 4.8, 90, .95 if self.two_hand else 1.3)
        self._forearm(tx - 1.0, ty + 3.2, tx - 9.0, ty + 18.0, 91)
        if self.two_hand:     # left hand cups the handguard from below
            self._glove(fx + .6, fy + 1.0, 5.2, 3.4, 92)
            self._forearm(fx - .5, fy + 2.4, fx - 10.0, fy + 17.0, 93, 1.15, 1.8)
        else:                 # pistols: support hand wraps the front of the grip
            self._glove(tx + 2.4, ty + 1.8, 3.4, 3.6, 92, 1.3)
            self._forearm(tx + 2.2, ty + 3.4, tx - 5.0, ty + 16.0, 93, 1.1, 1.7)

    def write(self, equipment_pose=None):
        if self.fp:
            self._add_hands()
        src = HERE / 'source'
        src.mkdir(exist_ok=True)
        used_w = max(r for r in [0]) if False else None
        bbox = self.sheet.getbbox()
        W = max(64, ((bbox[2] + 3) // 4) * 4)
        H = max(64, ((bbox[3] + 3) // 4) * 4)
        sheet = self.sheet.crop((0, 0, W, H))
        sheet.putalpha(sheet.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
        sheet.save(src / f'{self.name}_model.png')
        self.vt = [(u / W, 1.0 - v / H) for u, v in self.vt]
        (src / f'{self.name}_model.mtl').write_text(f'newmtl gun\nKd 1 1 1\nmap_Kd {self.name}_model.png\n')
        lines = [f'mtllib {self.name}_model.mtl', 'usemtl gun']
        lines += [f'v {x:.4f} {y:.4f} {z:.4f}' for x, y, z in self.v]
        lines += [f'vt {u:.6f} {v:.6f}' for u, v in self.vt]
        for face in self.f:
            lines.append('f ' + ' '.join(f'{a}/{b}' for a, b in face))
        (src / f'{self.name}_model.obj').write_text('\n'.join(lines) + '\n')
        bb = np.array(self.v)
        (src / f'{self.name}_model.json').write_text(json.dumps(dict(
            min=bb.min(0).tolist(), max=bb.max(0).tolist(), sockets=self.sockets)))
        print(f'{self.name}: {len(self.v)} vertices, {len(self.f)} faces')


# ------------------------------------------------------------------ gun designs
def poly_mirror(pts):
    return pts


def build_ak47(fp=False):
    """Kalashnikov: dark steel receiver with dust cover, walnut furniture, curved magazine, gas tube."""
    g = Gun('ak47', 17, fp=fp, two_hand=True)
    wood = dict(tone=.82)
    # receiver + dust cover
    a = Art(-3.6, 11.6, -5.6, 1.8, 30)
    a.poly([(-3.2, -3.9), (9.0, -3.9), (9.8, -3.4), (11.2, -3.4), (11.2, 1.0), (-3.2, 1.0)], 'blued')
    a.poly([(-3.0, -3.8), (8.8, -3.8), (9.4, -3.3), (9.4, -2.6), (-3.0, -2.6)], 'steel', tone=1.0, flat=None)   # dust cover top
    a.rect(-1.6, -2.2, 4.8, -1.5, 'blued', flat=(10, 10, 12))                                                  # ejection slot
    a.line((-0.4, -0.6), (5.8, -0.6), (150, 158, 176), 1)                                                      # selector lever track
    a.rect(7.6, -5.2, 9.2, -3.9, 'blued')                                                                      # rear sight leaf
    a.rect(8.0, -5.5, 8.5, -5.2, 'steel')
    a.dots([(-2.4, -0.6), (0.6, 0.2), (9.8, -1.2), (10.4, 0.4)], (170, 178, 196), .1)                          # rivets
    a.ribs(9.9, 11.0, -3.0, 0.8, .3, (16, 18, 24))
    g.plate(a, z=.95)
    # trigger guard
    t = Art(-1.0, 4.2, 0.4, 3.6, 31)
    t.poly([(-0.6, 0.6), (3.8, 0.6), (3.8, 1.4), (2.6, 3.0), (-0.2, 3.1), (-0.6, 2.2)], 'blued')
    t.poly([(0.0, 1.0), (2.6, 1.0), (2.4, 2.4), (0.0, 2.4)], 'blued', flat=(12, 13, 17))
    t.rect(0.9, 0.9, 1.15, 2.0, 'steel', tone=1.0)
    g.plate(t, z=.5)
    # stock (walnut) with butt plate
    s_ = Art(-15.6, -2.6, -4.2, 5.0, 32)
    s_.poly([(-3.0, -3.5), (-8.0, -3.7), (-12.0, -3.2), (-15.0, -2.4), (-15.2, 4.4), (-11.0, 3.6), (-6.4, 1.6), (-3.0, 1.2)], 'wood', **wood)
    s_.rect(-15.2, -2.4, -14.5, 4.4, 'blued')
    s_.line((-6, -2.0), (-13.4, -1.3), (84, 38, 16), 1)
    s_.line((-5, -0.6), (-12.5, 0.6), (96, 44, 18), 1)
    s_.dots([(-14.85, -1.2), (-14.85, 3.2)], (150, 158, 176), .07)
    g.plate(s_, z=.8)
    # pistol grip (walnut)
    gr = Art(-3.2, 2.8, 0.4, 7.2, 33)
    gr.poly([(-1.4, 0.8), (1.6, 0.8), (2.0, 3.0), (1.6, 6.4), (-1.0, 6.6), (-2.4, 3.4)], 'wood', **wood)
    gr.line((-1.2, 1.8), (-0.8, 5.8), (84, 38, 16), 1)
    gr.rect(-1.0, 6.0, 1.6, 6.5, 'blued')
    g.plate(gr, z=.7)
    # magazine (curved, ribbed steel)
    m = Art(2.4, 12.0, 0.4, 10.0, 34)
    m.poly([(3.6, 1.0), (7.4, 1.0), (9.6, 4.6), (11.0, 8.6), (8.6, 9.4), (5.8, 6.0), (3.4, 2.8)], 'steel', tone=.62)
    for k in range(7):
        m.line((4.2 + k * .55, 1.4 + k * .9), (7.2 + k * .62, 1.4 + k * .9), (20, 22, 28), 1)
    m.rect(8.2, 8.6, 10.8, 9.2, 'blued')
    g.plate(m, z=.78)
    # handguard (lower walnut) with the gas tube above it, long barrel with front sight and brake
    h = Art(10.6, 22.4, -3.4, 2.8, 35)
    h.poly([(11.0, -1.8), (21.0, -1.8), (21.4, -1.2), (21.4, 1.2), (20.4, 2.0), (11.0, 2.0)], 'wood', **wood)
    h.line((11.4, -0.2), (21.2, -0.2), (84, 38, 16), 1)
    h.ribs(12.0, 20.4, 0.3, 1.7, .8, (84, 38, 16))
    h.rect(11.0, 1.7, 20.4, 2.0, 'blued')
    g.plate(h, z=.82)
    upper = Art(10.6, 22.6, -4.2, -1.4, 37)
    upper.poly([(11.0, -3.2), (22.0, -3.2), (22.2, -2.6), (22.2, -1.8), (11.0, -1.8)], 'wood', **wood)
    g.plate(upper, z=.7)
    g.barrel(11.0, 26.4, -3.7, .5, (24, 26, 34), (124, 134, 154), 10)         # gas tube
    gb = Art(25.6, 31.4, -5.6, -0.2, 36)
    gb.poly([(25.8, -4.2), (28.4, -4.2), (28.4, -2.0), (27.8, -0.6), (25.8, -0.6)], 'blued')   # gas block
    gb.poly([(30.2, -5.4), (30.8, -5.4), (30.8, -2.0), (30.2, -2.0)], 'steel')               # front sight post
    g.plate(gb, z=.55)
    g.barrel(20.6, 32.4, -1.4, .44, (20, 22, 28), (118, 128, 146), 10)         # barrel
    g.barrel(31.4, 34.4, -1.4, .62, (16, 18, 24), (88, 98, 114), 8)            # muzzle brake
    # Socket geometry matches the original AK (hold clips and the aim test are tuned to it): foregrip (12,2), muzzle on the (27,-5) line from the trigger.
    g.socket('trigger', [0, 3, 0]); g.socket('foregrip', [12, 2, 0]); g.socket('muzzle', [34.6, 3 - 5 * 34.6 / 27, 0])
    g.write()


def build_pistol(fp=False):
    """Makarov-style: slide, frame, grip panels, sights."""
    g = Gun('pistol', 11, fp=fp, two_hand=False)
    # slide (x -5.2..6.4, y -3.4..-0.6)
    a = Art(-5.4, 6.6, -3.8, -0.2, 1)
    a.poly([(-5.2, -3.3), (5.6, -3.3), (6.4, -2.9), (6.4, -0.6), (-5.2, -0.6)], 'blued')
    a.rect(-5.2, -3.3, 5.6, -3.0, 'steel', tone=.9)                     # top flat highlight
    a.ribs(-4.9, -2.6, -3.0, -0.8, .22, (16, 18, 24))                   # rear serrations
    a.rect(-1.4, -2.7, 2.2, -1.2, 'steel', tone=.7)                     # ejection port
    a.rect(-1.0, -2.4, 1.8, -1.5, 'blued', flat=(10, 10, 12))
    a.rect(-5.0, -3.8, -4.6, -3.3, 'blued')                             # rear sight
    a.rect(5.4, -3.7, 5.8, -3.3, 'blued')                               # front sight
    a.dots([(-0.4, -1.1), (3.4, -1.1)], (150, 158, 176), .06)
    slide = g.plate(a, -5.2, 6.4, -3.8, -0.2, .72)
    # frame + trigger guard
    b = Art(-5.4, 4.6, -0.8, 2.6, 2)
    b.poly([(-5.2, -0.6), (4.2, -0.6), (4.2, 0.2), (3.3, 0.5), (1.6, 0.5), (1.6, 1.8), (-0.2, 1.9), (-0.6, 0.8), (-5.2, 0.4)], 'blued')
    b.poly([(-0.2, 0.4), (1.6, 0.4), (1.6, 2.3), (-0.4, 2.3), (-0.6, 1.4)], 'blued', flat=(12, 13, 17))  # guard hole
    b.rect(0.3, 0.1, 0.55, 1.5, 'steel', tone=.95)                      # trigger
    b.dots([(-3.3, -0.1)], (150, 158, 176), .07)
    frame = g.plate(b, -5.2, 4.2, -0.8, 2.6, .62)
    # grip with slanted back strap (x -5.4..-1.2, y -0.4..5.2)
    c = Art(-6.6, -0.8, -0.8, 5.6, 3)
    c.poly([(-5.0, -0.6), (-1.4, -0.6), (-2.2, 5.0), (-5.7, 5.0)], 'poly')
    for k in range(9):                                                  # diagonal cross-hatch
        c.line((-5.2 + k * .45, 0.0), (-4.2 + k * .45, 4.8), (92, 100, 114), 1)
        c.line((-1.4 - k * .45, 0.0), (-2.4 - k * .45, 4.8), (92, 100, 114), 1)
    c.rect(-5.7, 4.4, -2.1, 5.0, 'steel', tone=.8)                      # base plate
    c.dots([(-3.5, 2.6)], (170, 178, 196), .13)                         # screw
    grip = g.plate(c, -6.2, -0.9, -0.8, 5.6, .7)
    g.barrel(5.0, 6.5, -1.9, .32, (18, 20, 26), (70, 76, 90), 8, pid=slide)
    g.socket('trigger', [0, 1.6, 0]); g.socket('foregrip', [0, 1.6, 0]); g.socket('muzzle', [7, -1.9, 0])
    g.write()


def build_revolver(fp=False):
    g = Gun('revolver', 12, fp=fp, two_hand=False)
    # frame + barrel shroud side view
    a = Art(-5.6, 9.4, -4.4, 2.8, 4)
    a.poly([(-1.2, -3.4), (9.0, -3.4), (9.0, -1.6), (3.2, -1.6), (3.2, 1.4), (-1.0, 1.4)], 'blued')
    a.rect(-1.0, -3.4, 9.0, -3.0, 'steel', tone=1.0)                    # top strap + rib
    a.rect(8.4, -4.2, 9.0, -3.4, 'blued')                               # front sight
    a.rect(-1.6, -3.9, 0.0, -3.4, 'blued')                              # rear sight
    a.rect(3.6, -2.6, 8.8, -2.3, 'steel', tone=.7)                      # ejector rod shadow
    a.poly([(1.2, 0.8), (3.4, 0.8), (3.4, 2.4), (1.6, 2.5), (1.2, 1.7)], 'blued', flat=(12, 13, 17))
    a.rect(2.0, 0.6, 2.25, 1.9, 'steel', tone=.9)
    a.dots([(0.4, -0.4)], (150, 158, 176), .08)
    frame = g.plate(a, -1.2, 9.0, -4.4, 2.8, .55)
    # cylinder (x 0.6..4.4)
    b = Art(0.4, 4.8, -3.8, 0.6, 5)
    b.rect(0.6, -3.5, 4.4, 0.2, 'steel', tone=.95)
    b.ribs(0.9, 4.3, -3.4, 0.1, .7, (28, 32, 40))                       # flutes
    b.dots([(2.5, -3.2), (2.5, -0.2)], (20, 22, 28), .12)
    b.rect(0.6, -3.5, 4.4, -3.2, 'steel', tone=1.1)
    cyl = g.plate(b, 0.6, 4.4, -3.8, 0.6, .95)
    # wooden grip (x -5.6..-0.8)
    c = Art(-6.4, -0.4, -1.4, 5.6, 6)
    c.poly([(-1.0, -1.0), (-2.4, -1.1), (-3.6, 0.2), (-4.8, 2.0), (-5.0, 4.6), (-4.4, 5.0), (-2.4, 4.8), (-1.3, 2.2)], 'wood')
    c.line((-4.9, 0.8), (-4.5, 4.7), (110, 52, 22), 1)
    c.line((-3.3, 0.2), (-3.0, 4.4), (126, 60, 24), 1)
    c.rect(-6.1, 4.7, -2.3, 5.4, 'blued')
    c.dots([(-2.5, 1.2)], (190, 160, 70), .12)
    grip = g.plate(c, -6.0, -0.9, -1.4, 5.6, .62)
    g.barrel(3.4, 9.0, -2.2, .5, (24, 26, 32), (110, 120, 138), 10, pid=frame)
    g.socket('trigger', [0, 1.8, 0]); g.socket('foregrip', [0, 1.8, 0]); g.socket('muzzle', [9.6, -2.4, 0])
    g.write()


def build_shotgun(fp=False):
    """Pump-action: long barrel + magazine tube, wooden pump and stock."""
    g = Gun('shotgun', 13, fp=fp, two_hand=True)
    # receiver (x -4..6.5, y -3.8..1.2)
    a = Art(-4.4, 6.9, -4.2, 1.6, 7)
    a.poly([(-4.0, -3.6), (5.6, -3.6), (6.5, -3.0), (6.5, 0.8), (-4.0, 0.8)], 'blued')
    a.rect(-4.0, -3.6, 5.6, -3.2, 'steel', tone=.95)
    a.rect(0.2, -2.6, 3.6, -1.6, 'blued', flat=(10, 10, 12))            # ejection port
    a.rect(0.3, -2.5, 3.4, -2.3, 'steel', tone=.6)
    a.ribs(5.0, 6.2, -2.8, 0.4, .25, (16, 18, 24))
    a.dots([(-3.2, -2.6), (-3.2, 0.0), (5.9, -3.0)], (150, 158, 176), .08)
    rec = g.plate(a, -4.0, 6.5, -4.2, 1.6, .85)
    # trigger guard
    t = Art(-3.4, 1.6, 0.4, 3.4, 8)
    t.poly([(-3.0, 0.6), (1.0, 0.6), (1.0, 2.6), (0.4, 3.0), (-2.0, 3.0), (-3.0, 1.8)], 'blued')
    t.poly([(-2.4, 0.9), (0.4, 0.9), (0.4, 2.4), (-2.0, 2.4)], 'blued', flat=(12, 13, 17))
    t.rect(-1.0, 0.8, -0.8, 1.9, 'steel', tone=1.0)
    g.plate(t, -3.0, 1.0, 0.4, 3.4, .5)
    # stock (x -17..-4), y -3.6..4.0 with comb and butt plate
    s = Art(-17.4, -3.6, -4.2, 4.6, 9)
    s.poly([(-4.0, -3.4), (-9.0, -3.4), (-13.0, -3.0), (-16.6, -2.6), (-17.0, 4.0), (-14.0, 3.2), (-9.5, 0.8), (-4.0, 0.9)], 'wood')
    s.rect(-17.0, -2.6, -16.4, 4.0, 'blued')                            # butt plate
    s.line((-9, -1.6), (-15.5, -0.8), (112, 54, 22), 1)
    s.line((-8, -0.4), (-14.5, 0.8), (126, 62, 26), 1)
    s.dots([(-16.7, -1.2), (-16.7, 2.6)], (150, 158, 176), .06)
    stock = g.plate(s, -17.0, -4.0, -4.2, 4.6, .75)
    # pump forend (x 6.8..15)
    f = Art(6.2, 15.6, -1.4, 2.6, 10)
    f.poly([(6.6, -1.0), (15.0, -1.0), (15.4, -0.4), (15.4, 1.8), (14.8, 2.2), (6.6, 2.2)], 'wood')
    f.ribs(7.4, 14.4, -0.6, 1.9, .55, (96, 44, 18))                     # grip grooves
    f.rect(6.6, -1.0, 15.0, -0.7, 'wood', tone=1.2)
    fore = g.plate(f, 6.6, 15.4, -1.4, 2.6, .95)
    # barrel + magazine tube (both cylinders), vent rib on top
    g.barrel(6.5, 30.0, -3.0, .55, (22, 24, 30), (128, 138, 156), 12)
    g.barrel(6.5, 24.0, -0.6, .5, (20, 22, 28), (96, 106, 124), 10)
    rib = Art(6.0, 30.4, -4.4, -2.6, 11)
    rib.rect(6.2, -3.9, 30.0, -3.4, 'steel', tone=.9)
    rib.ribs(6.5, 29.8, -3.9, -3.4, 1.0, (10, 11, 14))
    rib.rect(29.4, -4.3, 30.0, -3.4, 'brass')                           # bead sight
    g.plate(rib, 6.2, 30.0, -4.4, -2.6, .22, edges=True)
    cap = Art(23.2, 24.8, -1.4, 0.2, 12)
    cap.rect(23.4, -1.1, 24.6, 0.0, 'blued')
    g.plate(cap, 23.4, 24.6, -1.4, 0.2, .55)
    g.socket('trigger', [0, 2.2, 0]); g.socket('foregrip', [10.5, 0.8, 0]); g.socket('muzzle', [30.5, -3.0, 0])
    g.write()


def build_smg(fp=False):
    """Compact SMG (UZI-ish): boxy receiver, vertical grip magazine, wire stock."""
    g = Gun('smg', 14, fp=fp, two_hand=True)
    a = Art(-5.6, 12.4, -4.0, 1.8, 15)
    a.poly([(-5.2, -3.4), (10.6, -3.4), (11.2, -2.8), (11.2, 1.0), (-5.2, 1.0)], 'blued')
    a.rect(-5.2, -3.4, 10.6, -3.0, 'steel', tone=.9)
    a.ribs(-4.8, -2.4, -3.0, 0.8, .26, (16, 18, 24))
    a.rect(1.6, -2.4, 5.6, -1.4, 'blued', flat=(10, 10, 12))
    a.rect(1.7, -2.3, 5.2, -2.1, 'steel', tone=.55)
    a.rect(-1.6, -4.0, -1.0, -3.4, 'blued')
    a.rect(10.0, -4.0, 10.6, -3.4, 'blued')
    a.rect(6.2, -1.0, 10.0, 0.7, 'steel', tone=.6)                      # heat vent plate
    for k in range(6):
        a.dots([(6.6 + k * .55, -0.2)], (14, 15, 19), .09)
    a.dots([(-4.4, -0.4), (0.4, 0.4)], (150, 158, 176), .07)
    g.plate(a, -5.2, 11.2, -4.0, 1.8, .9)
    # pistol grip + magazine in one tall column
    b = Art(-3.6, 3.6, 0.6, 9.4, 16)
    b.poly([(-2.6, 0.8), (1.6, 0.8), (2.4, 8.8), (-3.0, 8.8)], 'poly')
    for k in range(6):
        b.line((-2.4 + k * .05, 1.6 + k * 1.1), (1.5 + k * .08, 1.6 + k * 1.1), (86, 92, 104), 1)
    b.rect(-3.0, 8.4, 2.4, 8.9, 'steel', tone=.8)
    g.plate(b, -3.0, 2.4, 0.6, 9.4, .85)
    # trigger guard
    t = Art(2.6, 8.4, 0.6, 3.2, 17)
    t.poly([(2.8, 0.8), (8.0, 0.8), (8.0, 1.4), (6.0, 1.4), (6.0, 2.8), (3.4, 2.8), (2.8, 2.0)], 'blued')
    t.rect(3.6, 0.8, 3.85, 1.9, 'steel', tone=1.0)
    g.plate(t, 2.8, 8.0, 0.6, 3.2, .45)
    # barrel + muzzle brake
    g.barrel(11.0, 16.0, -1.4, .42, (22, 24, 30), (112, 122, 140), 8)
    g.barrel(15.2, 17.0, -1.4, .62, (18, 20, 26), (86, 96, 112), 8)
    # folded wire stock stub
    w = Art(-12.6, -4.6, -3.6, 1.4, 18)
    w.rect(-12.2, -3.0, -5.0, -2.5, 'steel', tone=.8)
    w.rect(-12.2, -0.4, -5.0, 0.1, 'steel', tone=.7)
    w.rect(-12.4, -3.0, -11.8, 0.1, 'steel', tone=.8)
    g.plate(w, -12.2, -5.0, -3.6, 1.4, .5, edges=False)
    g.socket('trigger', [0, 2.0, 0]); g.socket('foregrip', [6.5, 0.6, 0]); g.socket('muzzle', [17.2, -1.4, 0])
    g.write()


def build_sniper(fp=False):
    """Bolt-action: long wooden stock, barrel, bolt handle, scope."""
    g = Gun('sniper', 15, fp=fp, two_hand=True)
    st = Art(-17.8, 11.0, -4.4, 5.0, 19)
    st.poly([(-17.2, -2.2), (-12.0, -3.0), (-6.0, -3.2), (-2.0, -3.0), (4.0, -2.6), (11.0, -1.6), (11.0, 0.8), (3.4, 1.4),
             (-1.0, 1.6), (-4.0, 4.4), (-6.5, 4.6), (-9.0, 1.0), (-14.0, 2.4), (-17.6, 4.8)], 'wood')
    st.line((-12, -1.2), (-4, -1.0), (112, 54, 22), 1)
    st.line((-14, 0.4), (-8, 0.6), (126, 62, 26), 1)
    st.line((2, -0.4), (10, -0.2), (112, 54, 22), 1)
    st.rect(-17.6, 2.8, -16.8, 4.8, 'blued')
    g.plate(st, -17.4, 11.0, -4.4, 5.0, .85)
    # receiver
    r = Art(-4.0, 6.0, -4.4, 0.4, 20)
    r.poly([(-3.6, -3.2), (5.4, -3.2), (5.4, -0.4), (-3.6, -0.4)], 'blued')
    r.rect(-3.6, -3.2, 5.4, -2.9, 'steel', tone=1.0)
    r.rect(0.0, -2.6, 3.6, -1.8, 'blued', flat=(10, 10, 12))
    r.dots([(-2.6, -1.4), (4.4, -1.4)], (150, 158, 176), .08)
    g.plate(r, -3.6, 5.4, -4.4, 0.4, .8)
    # bolt handle (side plate sticking out +z)
    b = Art(-3.4, 0.2, -3.6, 0.2, 21)
    b.ellipse(-1.4, -3.0, .5, .5, 'steel')
    b.poly([(-2.8, -1.9), (-1.7, -2.8), (-1.4, -2.5), (-2.5, -1.6)], 'steel')
    g.plate(b, z=1.6)
    # barrel long + muzzle
    g.barrel(5.2, 38.0, -1.9, .42, (20, 22, 28), (116, 126, 144), 10)
    g.barrel(36.4, 38.6, -1.9, .6, (16, 18, 24), (84, 94, 110), 8)
    # scope
    g.barrel(-0.5, 14.0, -5.6, .85, (18, 20, 26), (84, 94, 110), 12)
    g.barrel(12.8, 15.4, -5.6, 1.2, (14, 16, 22), (60, 70, 88), 12)    # objective bell
    g.barrel(-2.8, -0.4, -5.6, 1.1, (14, 16, 22), (60, 70, 88), 12)    # eyepiece
    lens = Art(14.2, 15.6, -7.0, -4.2, 22)
    lens.ellipse(14.9, -5.6, .62, 1.0, 'steel', flat=(52, 88, 140))
    lens.ellipse(14.7, -6.0, .22, .3, 'steel', flat=(170, 210, 250))
    g.plate(lens, 14.9, 15.7, -7.0, -4.2, .02, edges=False)
    mounts = Art(0.0, 12.0, -5.2, -2.4, 23)
    mounts.rect(1.0, -4.4, 2.2, -3.0, 'blued')
    mounts.rect(9.6, -4.4, 10.8, -3.0, 'blued')
    g.plate(mounts, 1.0, 10.8, -5.2, -2.4, .4)
    g.socket('trigger', [0, 1.4, 0]); g.socket('foregrip', [9.0, 0.6, 0]); g.socket('muzzle', [38.8, -1.9, 0])
    g.write()


def build_lmg(fp=False):
    """RPK-style light machine gun: long barrel, bipod, drum magazine."""
    g = Gun('lmg', 16, fp=fp, two_hand=True)
    a = Art(-4.4, 14.6, -4.0, 1.6, 24)
    a.poly([(-4.0, -3.4), (11.6, -3.4), (14.0, -2.6), (14.0, 0.6), (-4.0, 0.8)], 'blued')
    a.rect(-4.0, -3.4, 11.6, -3.0, 'steel', tone=.95)
    a.rect(0.0, -2.6, 5.0, -1.5, 'blued', flat=(10, 10, 12))
    a.ribs(11.0, 13.6, -2.4, 0.2, .3, (16, 18, 24))
    a.dots([(-3.0, -0.2), (7.0, 0.0)], (150, 158, 176), .08)
    g.plate(a, -4.0, 14.0, -4.0, 1.6, .85)
    # wooden handguard + wooden stock (olive polymer variant for a different silhouette)
    h = Art(13.6, 24.4, -3.6, 1.6, 25)
    h.poly([(14.0, -3.0), (24.0, -3.0), (24.0, 0.6), (14.0, 1.0)], 'wood')
    h.ribs(15.0, 23.4, -2.6, 0.3, .7, (96, 44, 18))
    g.plate(h, 14.0, 24.0, -3.6, 1.6, .95)
    s = Art(-16.4, -3.6, -4.0, 4.8, 26)
    s.poly([(-4.0, -3.0), (-9.0, -3.2), (-13.0, -2.8), (-16.0, -2.2), (-16.4, 4.2), (-12.0, 3.4), (-8.0, 0.9), (-4.0, 0.9)], 'wood')
    s.rect(-16.4, -2.2, -15.8, 4.2, 'blued')
    s.line((-9, -1.4), (-14.5, -0.8), (112, 54, 22), 1)
    g.plate(s, -16.2, -4.0, -4.0, 4.8, .75)
    # grip
    gr = Art(-3.2, 2.8, 0.2, 5.6, 27)
    gr.poly([(-2.6, 0.4), (1.4, 0.4), (2.2, 5.0), (-1.6, 5.4), (-2.8, 3.6)], 'wood')
    gr.line((-1.8, 1.4), (-1.2, 4.6), (110, 52, 22), 1)
    g.plate(gr, -2.8, 2.2, 0.2, 5.6, .7)
    # long barrel, muzzle device, gas tube
    g.barrel(24.0, 34.0, -1.9, .46, (22, 24, 30), (118, 128, 146), 10)
    g.barrel(32.6, 35.2, -1.9, .7, (16, 18, 24), (84, 94, 110), 8)
    g.barrel(14.0, 24.0, -3.8, .3, (22, 24, 30), (96, 106, 124), 8)
    # bipod folded under the barrel
    b = Art(20.0, 31.0, -0.6, 3.6, 28)
    b.line((24.0, 0.0), (21.6, 3.2), (96, 106, 124), 2)
    b.line((25.0, 0.0), (27.4, 3.2), (96, 106, 124), 2)
    b.rect(25.4, -0.4, 26.8, 0.4, 'blued')
    g.plate(b, 21.0, 28.0, -0.6, 3.6, .35, edges=False)
    # drum magazine
    d = Art(2.0, 8.2, -0.4, 5.8, 29)
    d.ellipse(5.1, 2.7, 3.0, 3.0, 'steel', tone=.75)
    d.ellipse(5.1, 2.7, 2.1, 2.1, 'blued')
    for k in range(8):
        a_ = k / 8 * 2 * math.pi
        d.line((5.1, 2.7), (5.1 + math.cos(a_) * 2.8, 2.7 + math.sin(a_) * 2.8), (20, 22, 28), 1)
    d.ellipse(5.1, 2.7, .55, .55, 'steel', tone=1.1)
    g.disc(d, 5.1, 2.7, 3.0, .8)
    g.socket('trigger', [0, 2.6, 0]); g.socket('foregrip', [18.0, 0.4, 0]); g.socket('muzzle', [35.4, -1.9, 0])
    g.write()


BUILDERS = dict(ak47=build_ak47, pistol=build_pistol, revolver=build_revolver, shotgun=build_shotgun, smg=build_smg,
                sniper=build_sniper, lmg=build_lmg)

if __name__ == '__main__':
    names = sys.argv[1:] or list(BUILDERS)
    for n in names:
        BUILDERS[n.replace('_fp', '')](fp=n.endswith('_fp'))
