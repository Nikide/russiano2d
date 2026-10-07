#!/usr/bin/env python3
"""Авторинг одной развёртки Руси-тян. Не генерирует ракурсы или sprite sheet."""
import math
import pathlib
import struct
import zlib

N = 64
W = H = 8 * N
PALETTE = {
    'ink': (24, 36, 35, 255), 'hair': (49, 126, 71, 255),
    'dark': (32, 86, 51, 255), 'light': (85, 166, 92, 255),
    'shine': (139, 198, 121, 255), 'skin': (248, 211, 186, 255),
    'shadow': (215, 156, 137, 255), 'blush': (233, 166, 154, 255),
    'white': (249, 242, 224, 255), 'eye': (128, 84, 40, 255),
    'gold': (203, 159, 67, 255), 'pink': (223, 157, 147, 255),
    'cloth': (44, 41, 50, 255), 'fold': (65, 57, 68, 255),
    'red': (145, 43, 51, 255), 'redlight': (198, 73, 71, 255),
}


def head(u, v):
    lon = (u - .5) * math.tau
    lat = v * math.pi
    x, y = 14 * math.sin(lon) * math.sin(lat), -18 * math.cos(lat)
    # Чёлка выражена в координатах поверхности и непрерывно оборачивается.
    bang = -6 + 7 * max(0, 1 - abs(x - 2) / 4)
    if abs(lon) > 1.22 or y < bang:
        stripe = (int(u * 100) + int(v * 8)) % 12
        if stripe < 2: return 'dark'
        if stripe == 3 and .14 < v < .39: return 'shine'
        if stripe < 5: return 'light'
        return 'hair'
    c = 'skin' if abs(x) < 10 else 'shadow'
    for cx in (-5, 5):
        if abs(x - cx) < 3.3 and 0 < y < 4.6:
            if y < 1 or abs(x-cx) > 2.9: return 'ink'
            if abs(x-cx) < 1.5:
                if y < 2 and x < cx: return 'white'
                return 'eye' if y < 3.7 else 'gold'
            return 'white'
        if abs(x-cx) < 3 and -2.7 < y < -1.8: return 'dark'
    if 6 < abs(x) < 10 and 5 < y < 7: return 'blush'
    if abs(x) < .8 and 6 < y < 7.5: return 'shadow'
    if abs(x) < 2 and 10 < y < 10.8: return 'shadow'
    return c


def ear(u, v):
    back = v >= .5
    v = (v * 2) % 1
    if back: return 'light' if u < .45 else 'hair'
    if .25 < u < .73 and .18 < v < .82: return 'pink' if u > .38 else 'shadow'
    return 'hair' if u < .2 or u > .86 else 'white'


def material(name, u, v):
    a = abs(u-.5)
    if name in ('hair', 'tail', 'bang'):
        return ('dark','hair','hair','light','hair','shine')[int(u*48) % 6]
    if name == 'torso':
        if .32 < u < .68:
            if v < .17: return 'skin'
            if .25 < v < .43 and a < .14: return 'redlight' if u < .5 else 'red'
            if a < .08 or (v < .33 and a < .2): return 'white'
        return 'fold' if int(u*20) % 5 == 0 else 'cloth'
    if name == 'skirt':
        if v > .91: return 'white'
        return 'fold' if int(u*24) % 3 == 0 else 'cloth'
    if name == 'arm':
        if v < .28: return 'white' if int(u*12)%4 else 'shadow'
        if v > .86: return 'white'
        return 'skin' if .35 < u < .7 else 'shadow'
    if name == 'leg':
        if v < .27: return 'skin' if .2 < u < .65 else 'shadow'
        return 'fold' if .3 < u < .5 else 'cloth'
    if name == 'hand': return 'skin' if int(u*9)%3 else 'shadow'
    return 'ink' if v > .7 else 'cloth'


def build():
    data = bytearray(W * H * 4)
    regions = [
        (0,0,4*N,2*N,head), (4*N,0,N,2*N,ear), (5*N,0,N,2*N,ear),
        (6*N,0,2*N,2*N,'hair'), (0,2*N,4*N,2*N,'torso'),
        (4*N,2*N,2*N,2*N,'arm'), (6*N,2*N,2*N,2*N,'arm'),
        (0,4*N,4*N,2*N,'skirt'), (4*N,4*N,2*N,2*N,'leg'),
        (6*N,4*N,2*N,2*N,'leg'), (0,6*N,2*N,2*N,'tail'),
        (2*N,6*N,2*N,2*N,'bang'), (4*N,6*N,2*N,2*N,'hand'),
        (6*N,6*N,2*N,2*N,'shoe'),
    ]
    for ox, oy, w, h, fn in regions:
        for y in range(h):
            for x in range(w):
                u, v = (x+.5)/w, (y+.5)/h
                key = fn(u,v) if callable(fn) else material(fn,u,v)
                i = ((oy+y)*W+ox+x)*4
                data[i:i+4] = bytes(PALETTE[key])
    return data


def write_png(path, data):
    def chunk(tag, body):
        return struct.pack('>I',len(body)) + tag + body + struct.pack('>I',zlib.crc32(tag+body))
    rows = b''.join(b'\0'+data[y*W*4:(y+1)*W*4] for y in range(H))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',struct.pack('>IIBBBBB',W,H,8,6,0,0,0))
    png += chunk(b'IDAT',zlib.compress(rows,9)) + chunk(b'IEND',b'')
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(png)


if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parent.parent
    target = root / 'demos/assets/art/mascot/russi_rotsprite_v1.png'
    write_png(target,build())
    print(f'{target}: {W}×{H}, один атлас всего тела')
