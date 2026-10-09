#!/usr/bin/env python3
# Генератор OBJ-фикстур Baker (python — только для тестов): куб с текстурой из двух половин,
# квад с отрицательными индексами и негативные случаи. Запуск: python3 tests/fixtures/sdk/make_obj_fixtures.py
import os
import struct
import zlib

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "props")


def png(path, w, h, rgba_rows):
    raw = b"".join(b"\x00" + bytes(sum(([c for c in px] for px in row), [])) for row in rgba_rows)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def main():
    os.makedirs(HERE, exist_ok=True)
    # Текстура 8×8: верхняя половина красная, нижняя синяя (проверка переворота V).
    red, blue = (230, 30, 30, 255), (30, 30, 230, 255)
    png(os.path.join(HERE, "cube.png"), 8, 8, [[red] * 8] * 4 + [[blue] * 8] * 4)
    v = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
    faces = [(1, 2, 3, 4), (5, 8, 7, 6), (1, 5, 6, 2), (4, 3, 7, 8), (1, 4, 8, 5), (2, 6, 7, 3)]
    out = ["# куб 2×2×2 с материалом и текстурой (OBJ-фикстура Baker)", "mtllib cube.mtl", "o cube"]
    out += ["v %d %d %d" % p for p in v]
    out += ["vt 0 0", "vt 1 0", "vt 1 1", "vt 0 1", "usemtl wood"]
    for a, b, c, d in faces:
        out.append("f %d/1 %d/2 %d/3 %d/4" % (a, b, c, d))
    open(os.path.join(HERE, "cube.obj"), "w").write("\n".join(out) + "\n")
    open(os.path.join(HERE, "cube.mtl"), "w").write("newmtl wood\nKd 1 1 1\nmap_Kd cube.png\n")
    # Квад отрицательными индексами: одна грань из четырёх вершин → два треугольника, без MTL.
    open(os.path.join(HERE, "quad_neg.obj"), "w").write("v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\nf -4 -3 -2 -1\n")
    open(os.path.join(HERE, "bad_index.obj"), "w").write("v 0 0 0\nv 1 0 0\nv 0 1 0\n\nf 1 2 9\n")
    open(os.path.join(HERE, "bad_empty.obj"), "w").write("v 0 0 0\nv 1 0 0\n# граней нет\n")
    open(os.path.join(HERE, "bad_syntax.obj"), "w").write("v 0 0 zero\nf 1 1 1\n")
    open(os.path.join(HERE, "no_mtl.obj"), "w").write("mtllib missing.mtl\nusemtl m\nv 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3\n")


main()
