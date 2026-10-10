#!/usr/bin/env python3
"""Procedural original textures and loopable sounds for the Dust2 annex.

Everything is generated from math here (no third-party assets). Run from anywhere:
    python3 demos/re2d_dust2/make_annex_assets.py
Outputs go to demos/re2d_dust2/annex/.
"""
import wave
from pathlib import Path
import numpy as np
from PIL import Image

OUT = Path(__file__).with_name('annex')
OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(7)
N = 128


def save(name, arr):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(OUT / name)


def noise(n=N, scale=1.0):
    return rng.random((n, n)) * scale


def tile_noise(cells):
    """Smooth tileable value noise."""
    g = rng.random((cells, cells))
    xs = np.linspace(0, cells, N, endpoint=False)
    i = xs.astype(int)
    f = xs - i
    f = f * f * (3 - 2 * f)
    rows = g[i][:, :] * (1 - f)[:, None] + g[(i + 1) % cells] * f[:, None]
    return rows[:, i] * (1 - f)[None, :] + rows[:, (i + 1) % cells] * f[None, :]


def rgb(base, shade):
    return np.stack([base[k] * shade for k in range(3)], -1)


def normal_from_height(h, strength=2.0):
    gx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([(nx / ln * .5 + .5) * 255, (ny / ln * .5 + .5) * 255, (nz / ln * .5 + .5) * 255], -1)


# --- brick (+ normal) -------------------------------------------------------
brick_h = np.zeros((N, N))
brick = np.zeros((N, N, 3))
bh, bw = 16, 32
for r in range(N // bh):
    off = (bw // 2) * (r % 2)
    for c in range(N // bw + 1):
        x0 = (c * bw + off) % N
        tone = .72 + rng.random() * .28
        for y in range(r * bh + 1, (r + 1) * bh):
            for x in range(x0 + 1, x0 + bw):
                brick[y, x % N] = np.array([168, 78, 56]) * tone
                brick_h[y, x % N] = 1.0
brick[brick.sum(-1) == 0] = [90, 86, 80]
brick *= (.9 + .1 * tile_noise(8))[..., None]
save('brick.png', brick)
save('brick_n.png', normal_from_height(brick_h + .15 * tile_noise(16), 3.0))

# --- metal plates with rivets ----------------------------------------------
m = np.ones((N, N)) * .55 + .12 * tile_noise(6)
m[::64, :] *= .55
m[:, ::64] *= .55
for cy in (8, 56, 72, 120):
    for cx in (8, 56, 72, 120):
        yy, xx = np.ogrid[:N, :N]
        m[((yy - cy) ** 2 + (xx - cx) ** 2) < 9] += .25
save('metal.png', rgb([150, 160, 172], m))

# --- floor tiles -------------------------------------------------------------
t = np.ones((N, N))
t[::32, :] = .35
t[:, ::32] = .35
chk = ((np.indices((N, N)) // 32).sum(0) % 2) * .18 + .72
save('tile.png', rgb([205, 205, 198], t * chk * (.95 + .05 * tile_noise(10))))

# --- wood ------------------------------------------------------------------
w = np.zeros((N, N))
for x in range(N):
    w[:, x] = .6 + .25 * np.sin(x * .55 + 3 * tile_noise(4)[:, x]) + .1 * rng.random()
w[:, ::32] *= .6
save('wood.png', rgb([150, 100, 58], w))

# --- crisp block/panel textures (hard pixels, seams, grain) --------------------------------
def blocks(base, bw, bh, offset=True, tone=.16, seam=.55, grain=.07):
    img = np.zeros((N, N, 3))
    for r in range(N // bh):
        off = (bw // 2) * (r % 2) if offset else 0
        for c in range(N // bw + 1):
            x0 = (c * bw + off) % N
            t = 1 - tone + rng.random() * tone * 2
            for y in range(r * bh, (r + 1) * bh):
                for x in range(x0, x0 + bw):
                    k = t
                    if y == r * bh or (x - x0) == 0:
                        k *= seam
                    elif y == r * bh + 1:
                        k *= 1.12
                    img[y, x % N] = np.array(base) * k
    img *= (1 + (rng.random((N, N)) - .5) * grain * 2)[..., None]
    return img


save('concrete.png', blocks([150, 150, 146], 64, 64, offset=False, tone=.07, seam=.62))
save('carpet.png', rgb([120, 40, 70], .75 + .25 * noise() * (.6 + .4 * tile_noise(24))))

# --- hazard stripes ----------------------------------------------------------
yy, xx = np.indices((N, N))
stripe = (((xx + yy) // 16) % 2).astype(float)
hz = np.zeros((N, N, 3))
hz[stripe == 1] = [235, 190, 30]
hz[stripe == 0] = [30, 30, 32]
save('hazard.png', hz * (.9 + .1 * tile_noise(8))[..., None])

# --- toxic floor (albedo + emissive) ----------------------------------------
tox = tile_noise(6) * .6 + .4 * tile_noise(12)
save('toxic.png', np.stack([30 + 40 * tox, 120 + 110 * tox, 40 + 30 * tox], -1))
save('toxic_e.png', np.stack([10 * tox, 200 * tox ** 2, 30 * tox], -1))

# --- grate (masked, alpha) --------------------------------------------------
ga = np.zeros((N, N, 4))
ga[..., :3] = [70, 72, 78]
bars = ((xx % 16) < 4) | ((yy % 16) < 4)
ga[..., 3] = bars * 255
Image.fromarray(ga.astype(np.uint8), 'RGBA').save(OUT / 'grate.png')

# --- glass (translucent) -----------------------------------------------------
gl = np.zeros((N, N, 4))
gl[..., :3] = [150, 210, 230]
gl[..., 3] = 70 + 40 * tile_noise(4)
gl[(xx < 4) | (yy < 4) | (xx > N - 5) | (yy > N - 5), 3] = 190
Image.fromarray(gl.astype(np.uint8), 'RGBA').save(OUT / 'glass.png')

# --- server rack panel (albedo + emissive LEDs) -----------------------------
sv = np.ones((N, N, 3)) * np.array([28, 32, 38]) * (.9 + .1 * noise())[..., None]
sve = np.zeros((N, N, 3))
for row in range(6, N, 12):
    sv[row:row + 8, 6:N - 6] = [14, 16, 20]
    for led in range(10, N - 10, 10):
        c = [(255, 40, 30), (40, 255, 90), (255, 190, 30)][int(rng.integers(0, 3))]
        if rng.random() < .65:
            sve[row + 3:row + 5, led:led + 3] = c
            sv[row + 3:row + 5, led:led + 3] = c
save('server.png', sv)
save('server_e.png', sve)

# --- neon panel (emissive white-cyan) --------------------------------------
nn = np.zeros((N, N, 3))
nn[...] = [14, 22, 30]
nn[10:N - 10, 10:N - 10] = [96, 180, 222]
nn[10:N - 10, 10:N - 10] *= (.85 + .15 * tile_noise(4))[10:N - 10, 10:N - 10, None]
save('neon.png', nn)

# --- red emergency panel (albedo + emissive stripe) -----------------------------------------------------
al = np.zeros((N, N, 3)); al[...] = [40, 14, 14]
ale = np.zeros((N, N, 3))
al[24:104, 12:116] = [150, 20, 16]
ale[24:104, 12:116] = [255, 30, 20]
ale[24:104, 12:116] *= (.75 + .25 * tile_noise(4)[24:104, 12:116, None])
for x in range(12, 116, 16):
    al[24:104, x:x + 2] = [30, 8, 8]
    ale[24:104, x:x + 2] = 0
save('alarm.png', al)
save('alarm_e.png', ale)

# --- grass/sand for courtyard + stone brick for yard walls ------------------
save('grass.png', np.stack([50 + 40 * tile_noise(10), 110 + 60 * tile_noise(14), 40 + 20 * tile_noise(8)], -1))
save('plaster.png', blocks([214, 202, 176], 32, 16, tone=.1, seam=.7))

# ===================== sounds ===================================================
SR = 48000


def write(name, data, peak=.8):
    data = np.asarray(data, float)
    data = data / max(1e-9, np.abs(data).max()) * peak
    with wave.open(str(OUT / name), 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes((data * 32767).astype('<i2').tobytes())


def loop_noise(seconds, lo, hi):
    """Circular band-limited noise: seamless as a loop."""
    n = int(SR * seconds)
    spec = rng.normal(size=n // 2 + 1) + 1j * rng.normal(size=n // 2 + 1)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(spec, n)


def t_axis(seconds):
    return np.arange(int(SR * seconds)) / SR


# server hum: 4 s, integer-cycle harmonics + fan noise
t = t_axis(4)
hum = sum(np.sin(2 * np.pi * 60 * k * t) / k for k in range(1, 7)) * .6 + loop_noise(4, 200, 3000) * .5
write('hum_server.wav', hum, .6)
# machinery rumble (hall)
t = t_axis(6)
write('rumble.wav', loop_noise(6, 25, 120) * 1.5 + .25 * np.sin(2 * np.pi * 50 * t), .7)
# fan
t = t_axis(4)
write('fan.wav', loop_noise(4, 100, 2500) * (.65 + .35 * np.sin(2 * np.pi * 2 * t)), .6)
# alarm: two-tone, 2 s
t = t_axis(2)
tone = np.where((t % 1) < .5, np.sin(2 * np.pi * 880 * t), np.sin(2 * np.pi * 660 * t)) * (((t % .5) < .42) * 1.0)
write('alarm.wav', tone, .5)
# light buzz 100 Hz with flicker
t = t_axis(3)
write('buzz.wav', (np.sin(2 * np.pi * 100 * t) + .5 * np.sin(2 * np.pi * 300 * t) + .25 * loop_noise(3, 2000, 8000)) * (.8 + .2 * np.sign(np.sin(2 * np.pi * 7 * t))), .45)
# toxic bubbling: random soft pops over low noise
n = SR * 5
bub = loop_noise(5, 60, 400) * .4
for _ in range(60):
    p = int(rng.integers(0, n - 4000))
    k = np.arange(4000)
    f0 = rng.uniform(250, 700)
    bub[p:p + 4000] += np.sin(2 * np.pi * (f0 + k * .06) * k / SR) * np.exp(-k / 700) * rng.uniform(.4, 1)
write('bubble.wav', bub, .7)
# drip with tail, 3 s loop
n = SR * 3
dr = np.zeros(n)
for at in (0.2, 1.1, 2.3):
    p = int(at * SR)
    k = np.arange(14000)
    dr[p:p + 14000] += np.sin(2 * np.pi * (1100 - 600 * np.exp(-k / 1500)) * k / SR) * np.exp(-k / 2500) * .8
    dr[p:p + 14000] += loop_noise(14000 / SR, 1500, 6000)[:14000] * np.exp(-k / 900) * .05
write('drip.wav', dr, .7)
# clock tick, 2 s
n = SR * 2
tk = np.zeros(n)
for at in np.arange(0, 2, .5):
    p = int(at * SR)
    k = np.arange(1500)
    tk[p:p + 1500] += loop_noise(1500 / SR, 1000, 5000)[:1500] * np.exp(-k / 150)
write('tick.wav', tk, .6)
# water fountain / flow
write('water.wav', loop_noise(5, 400, 7000) * (.7 + .3 * np.sin(2 * np.pi * .4 * t_axis(5))), .5)
# electric crackle
n = SR * 4
cr = loop_noise(4, 3000, 12000) * .05
for _ in range(40):
    p = int(rng.integers(0, n - 800))
    cr[p:p + 800] += rng.normal(size=800) * np.exp(-np.arange(800) / 120)
write('crackle.wav', cr, .55)
# door open (creak) and close (thud) one-shots
k = np.arange(int(SR * .9))
creak = np.sin(2 * np.pi * (180 + 90 * np.sin(k / SR * 9)) * k / SR) * .4 + loop_noise(.9, 300, 1600)[:len(k)] * .3
write('door_open.wav', creak * np.minimum(1, k / 3000) * np.exp(-k / (SR * .5)), .7)
k = np.arange(int(SR * .5))
write('door_close.wav', (np.sin(2 * np.pi * 70 * k / SR) * np.exp(-k / 2500) + loop_noise(.5, 100, 1500)[:len(k)] * np.exp(-k / 1500) * .6), .9)
# muzzle flash shot one-shot
k = np.arange(int(SR * .45))
write('shot.wav', loop_noise(.45, 80, 6000)[:len(k)] * np.exp(-k / 3500) + np.sin(2 * np.pi * 90 * k / SR) * np.exp(-k / 4000), .9)

# explosion one-shot: sub boom + noisy blast + debris rattle tail (2.4 s)
n = int(SR * 2.4)
k = np.arange(n)
boom = np.sin(2 * np.pi * (28 + 90 * np.exp(-k / 2600.0)) * k / SR) * np.exp(-k / 15000.0)
blast = loop_noise(2.4, 40, 5200)[:n] * np.exp(-k / 6500.0)
tail = np.zeros(n)
for _ in range(70):
    p = int(rng.uniform(.15, 2.0) * SR)
    m = min(900, n - p)
    tail[p:p + m] += rng.normal(size=m) * np.exp(-np.arange(m) / 140) * rng.uniform(.04, .22) * np.exp(-p / (SR * 1.1))
write('explosion.wav', boom * 1.1 + blast * .9 + tail, .95)

# --- muzzle flash variants: additive star burst (soft glow + hot core + uneven rays), 256x256 RGBA ---
def flash(seed, rays=7):
    r = np.random.default_rng(seed)
    n = 256
    yy, xx = np.mgrid[0:n, 0:n]
    cx = cy = n / 2
    dx, dy = xx - cx, yy - cy
    d = np.hypot(dx, dy) / (n / 2)
    ang = np.arctan2(dy, dx)
    glow = np.exp(-(d / .38) ** 2)
    core = np.exp(-(d / .12) ** 2)
    star = np.zeros_like(d)
    for k in range(rays):
        a0 = r.uniform(0, 2 * np.pi)
        w = r.uniform(.05, .12)
        ln = r.uniform(.55, 1.0)
        diff = np.abs(((ang - a0 + np.pi) % (2 * np.pi)) - np.pi)
        star += np.exp(-(diff / w) ** 2) * np.clip(1 - d / ln, 0, 1) ** 1.6
    a = np.clip(glow * .55 + core * 1.0 + star * .9, 0, 1)
    col = np.stack([np.clip(255 * (core + glow * .9 + star), 0, 255),
                    np.clip(190 * (core * 1.2 + glow * .55 + star * .8), 0, 255),
                    np.clip(90 * (core * 1.4 + glow * .25 + star * .35), 0, 255)], -1)
    out = np.dstack([col, a * 255]).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(OUT / f'flash_{seed}.png')


for sd in range(4):
    flash(sd + 1, 6 + sd)

# --- zombie voices: jittery low pitch, odd harmonics, raspy amplitude gargle, vowel formants, breath noise ---------
def zvoice(name, seed, dur, f0, rasp, fall=.25, gain=.85, vowel=((620, 160, 1.0), (1050, 200, .8), (2400, 350, .35))):
    r = np.random.default_rng(seed)
    n = int(SR * dur)
    t = np.arange(n) / SR
    jit = np.cumsum(r.normal(size=n)) / SR
    contour = f0 * (1 + .12 * np.sin(2 * np.pi * (1.4 + r.random()) * t) + .05 * np.sin(2 * np.pi * 5.3 * t) + 1.5 * jit) * (1 - fall * t / dur)
    ph = 2 * np.pi * np.cumsum(contour) / SR
    sig = sum(np.sin(ph * k + r.random() * 6) / k ** 1.05 for k in range(1, 36))
    am = .55 + .45 * np.sin(2 * np.pi * rasp * t + 2.5 * np.sin(2 * np.pi * 3.1 * t))
    sig = sig * am
    breath = r.normal(size=n)
    spec = np.fft.rfft(breath)
    fr = np.fft.rfftfreq(n, 1 / SR)
    spec[(fr < 150) | (fr > 3500)] = 0
    sig = sig + .9 * np.fft.irfft(spec, n) * (.4 + .6 * am)
    S = np.fft.rfft(sig)
    env = sum(a * np.exp(-((fr - c) / w) ** 2) for c, w, a in vowel) + .06
    sig = np.fft.irfft(S * env, n)
    sig *= np.minimum(1, t / .07) * np.minimum(1, (dur - t) / .3)
    sig = np.tanh(sig / (np.abs(sig).max() + 1e-9) * 2.2)
    write(name, sig * gain, .9)


zvoice('zombie_growl_1.wav', 1, 1.7, 78, 24)
zvoice('zombie_growl_2.wav', 2, 2.3, 62, 17, .35)
zvoice('zombie_growl_3.wav', 3, 1.3, 96, 31, .15)
zvoice('zombie_attack.wav', 4, .9, 135, 42, .05, 1.0, ((820, 220, 1.0), (1500, 260, .7), (2800, 400, .4)))
zvoice('zombie_die.wav', 5, 2.1, 105, 14, .55, .9, ((500, 140, 1.0), (900, 180, .7), (2100, 300, .3)))
zvoice('zombie_groan.wav', 6, 2.8, 70, 11, .2, .7, ((450, 120, 1.0), (850, 160, .6), (2200, 300, .2)))

print('annex assets:', len(list(OUT.iterdir())), 'files in', OUT)
