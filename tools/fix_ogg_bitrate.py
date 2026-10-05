#!/usr/bin/env python3
"""Чинит поле nominal bitrate в Ogg Vorbis файлах.

Зачем: кодировщик vorbis, встроенный в ffmpeg (`-c:a vorbis -strict -2`),
записывает в заголовок идентификации нулевой nominal bitrate. Из-за этого
библиотеки, которые оценивают длительность как «размер файла / битрейт»
(так делает SDL_mixer), сообщают бессмысленные числа: 11-секундный трек
превращается в 498 секунд.

Скрипт считает точную длительность по granule position последней страницы,
вычисляет настоящий средний битрейт, записывает его в заголовок и
пересчитывает CRC страницы.

    python3 tools/fix_ogg_bitrate.py <файл.ogg> [ещё файлы...]
    python3 tools/fix_ogg_bitrate.py --recursive <каталог>
"""

from __future__ import annotations

import os
import struct
import sys

# CRC-32 из спецификации Ogg: полином 0x04c11db7, без отражения и без
# финального XOR (в отличие от привычного zlib.crc32).
_CRC_TABLE: list[int] = []


def _build_crc_table() -> None:
    for i in range(256):
        r = i << 24
        for _ in range(8):
            r = ((r << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if (r & 0x80000000) else (r << 1) & 0xFFFFFFFF
        _CRC_TABLE.append(r)


_build_crc_table()


def ogg_crc(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ _CRC_TABLE[((crc >> 24) & 0xFF) ^ byte]
    return crc


def parse_pages(data: bytes):
    """Идёт по страницам Ogg и отдаёт (смещение, длина, granule)."""
    off = 0
    n = len(data)
    while off + 27 <= n:
        if data[off:off + 4] != b"OggS":
            raise ValueError(f"страница Ogg не найдена по смещению {off}")
        segments = data[off + 26]
        table_end = off + 27 + segments
        if table_end > n:
            raise ValueError("обрезанная таблица сегментов")
        payload = sum(data[off + 27:table_end])
        total = 27 + segments + payload
        if off + total > n:
            raise ValueError("обрезанная страница")
        granule = struct.unpack_from("<q", data, off + 6)[0]
        yield off, total, granule
        off += total


def fix_file(path: str) -> tuple[bool, str]:
    with open(path, "rb") as f:
        data = bytearray(f.read())

    pages = list(parse_pages(data))
    if not pages:
        return False, "нет страниц Ogg"

    first_off, _first_len, _ = pages[0]
    segments = data[first_off + 26]
    packet = first_off + 27 + segments

    # Заголовок идентификации Vorbis: 0x01, "vorbis", версия, каналы, частота,
    # три битрейта, размер блока, признак кадрирования.
    if bytes(data[packet:packet + 7]) != b"\x01vorbis":
        return False, "это не Vorbis-поток"

    channels = data[packet + 11]
    sample_rate = struct.unpack_from("<I", data, packet + 12)[0]
    nominal_off = packet + 20
    old_nominal = struct.unpack_from("<I", data, nominal_off)[0]

    if sample_rate == 0:
        return False, "нулевая частота дискретизации"

    # Точная длительность — по granule последней значащей страницы
    # (у последней страницы granule может быть -1, тогда берём предыдущую).
    total_samples = 0
    for _off, _len, granule in pages:
        if granule >= 0:
            total_samples = granule
    if total_samples <= 0:
        return False, "не удалось определить длину"

    duration = total_samples / sample_rate
    new_nominal = int(len(data) * 8 / duration)
    if new_nominal <= 0 or new_nominal > 0xFFFFFFFF:
        return False, "получился неправдоподобный битрейт"

    if old_nominal == new_nominal:
        return True, f"уже в порядке ({new_nominal} бит/с, {duration:.3f} с)"

    struct.pack_into("<I", data, nominal_off, new_nominal)

    # CRC пересчитываем по всей первой странице, обнулив поле контрольной суммы.
    page_len = pages[0][1]
    struct.pack_into("<I", data, first_off + 22, 0)
    crc = ogg_crc(bytes(data[first_off:first_off + page_len]))
    struct.pack_into("<I", data, first_off + 22, crc)

    with open(path, "wb") as f:
        f.write(data)

    return True, (f"было {old_nominal} → стало {new_nominal} бит/с "
                  f"({channels} кан., {sample_rate} Гц, {duration:.3f} с)")


def main(argv: list[str]) -> int:
    args = argv[1:]
    if not args:
        print(__doc__)
        return 2

    targets: list[str] = []
    if args[0] == "--recursive":
        for root, _dirs, files in os.walk(args[1]):
            targets += [os.path.join(root, f) for f in sorted(files) if f.lower().endswith(".ogg")]
    else:
        targets = args

    ok = 0
    for path in targets:
        try:
            changed, note = fix_file(path)
        except Exception as exc:  # noqa: BLE001
            print(f"  ОШИБКА {path}: {exc}")
            continue
        status = "OK  " if changed else "ПРОПУСК"
        print(f"  {status} {os.path.relpath(path)}: {note}")
        ok += 1 if changed else 0

    print(f"обработано файлов: {ok} из {len(targets)}")
    return 0 if ok == len(targets) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
