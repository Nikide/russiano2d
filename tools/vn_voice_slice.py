#!/usr/bin/env python3
"""Нарезать сгенерированную озвучку новеллы на файлы по репликам.

На вход — один аудиофайл, в котором реплики разделены паузами (в демо-новелле
это `<#2.5#>` в тексте MiniMax). Инструмент находит тишину, режет по ней и
раскладывает куски в `<out>/<id>.mp3`, где `id` — идентификатор реплики из
`lines.json` (`tl3`, `tl4`, …). Именно эти имена ищет движок: см. опцию `voice`
в `docs/highlevel/timeline.md`.

Почему не «по количеству слов»: длительность реплики не предсказуема, а пауза —
предсказуема. Тишина длиннее `--min-silence` считается границей; всё, что короче,
остаётся внутри реплики (актёрские паузы в тексте).

    python3 tools/vn_voice_slice.py --audio ~/Downloads/rusi.mp3
    python3 tools/vn_voice_slice.py --audio rusi.mp3 --dry-run       # только отчёт
    python3 tools/vn_voice_slice.py --audio rusi.mp3 --min-silence 1.8

Если число кусков не совпало с числом реплик, инструмент ничего не пишет и
показывает таблицу: где нашлась лишняя пауза, какой кусок короче остальных.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MAP = os.path.join(ROOT, "demos", "russi_vn", "voice", "lines.json")
DEFAULT_OUT = os.path.join(ROOT, "demos", "russi_vn", "voice")


def need_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        print("нужен ffmpeg в PATH (brew install ffmpeg)", file=sys.stderr)
        raise SystemExit(2)
    return path


def duration(ffmpeg: str, path: str) -> float:
    out = subprocess.run([ffmpeg.replace("ffmpeg", "ffprobe"), "-v", "error",
                          "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip().split(",")[0])
    except ValueError:
        return 0.0


def silences(ffmpeg: str, path: str, threshold: str, min_silence: float) -> list[tuple[float, float]]:
    """Границы тишины: [(начало, конец), …] — по выводу silencedetect."""
    proc = subprocess.run(
        [ffmpeg, "-hide_banner", "-nostats", "-i", path,
         "-af", f"silencedetect=noise={threshold}:d={min_silence}", "-f", "null", "-"],
        capture_output=True, text=True)
    log = proc.stderr
    starts = [float(m) for m in re.findall(r"silence_start:\s*(-?[\d.]+)", log)]
    ends = [float(m) for m in re.findall(r"silence_end:\s*([\d.]+)", log)]
    pairs = []
    for index, start in enumerate(starts):
        end = ends[index] if index < len(ends) else None
        if end is None:
            continue
        if start < 0:
            start = 0.0
        pairs.append((start, end))
    return pairs


def segments(total: float, silence: list[tuple[float, float]], min_len: float) -> list[tuple[float, float]]:
    """Куски речи между паузами (тишина в начале и конце отбрасывается)."""
    out = []
    cursor = 0.0
    for start, end in silence:
        if start - cursor >= min_len:
            out.append((cursor, start))
        cursor = max(cursor, end)
    if total - cursor >= min_len:
        out.append((cursor, total))
    return out


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--audio", required=True, help="сгенерированный файл целиком")
    parser.add_argument("--map", default=DEFAULT_MAP, help="lines.json с репликами")
    parser.add_argument("--out", default=DEFAULT_OUT, help="куда класть <id>.mp3")
    parser.add_argument("--min-silence", type=float, default=1.6,
                        help="тишина длиннее этого (с) считается границей реплики")
    parser.add_argument("--threshold", default="-35dB", help="порог тишины для ffmpeg")
    parser.add_argument("--min-len", type=float, default=0.35, help="куски короче — мусор")
    parser.add_argument("--dry-run", action="store_true", help="только показать, что получится")
    parser.add_argument("--bitrate", default="4", help="качество MP3 (lame -q:a)")
    args = parser.parse_args(argv)

    ffmpeg = need_ffmpeg()
    with open(args.map, encoding="utf-8") as handle:
        mapping = json.load(handle)
    lines = mapping.get("lines", [])
    if not lines:
        print(f"в {args.map} нет списка lines", file=sys.stderr)
        return 2

    total = duration(ffmpeg, args.audio)
    found = silences(ffmpeg, args.audio, args.threshold, args.min_silence)
    pieces = segments(total, found, args.min_len)

    print(f"файл: {args.audio} ({total:.1f} с)")
    print(f"пауз найдено: {len(found)} (>{args.min_silence} с), кусков речи: {len(pieces)}")
    print(f"реплик в карте: {len(lines)}")

    ok = len(pieces) == len(lines)
    for index, (start, end) in enumerate(pieces):
        line = lines[index] if index < len(lines) else None
        name = (line['file'] if line else '—')
        text = (line['text'][:44] + '…') if line and len(line['text']) > 44 else (line['text'] if line else '')
        print(f"  {index + 1:3d} {end - start:6.2f} с  {name:<10} {text}")

    if not ok:
        print()
        print("ЧИСЛО КУСКОВ НЕ СОВПАЛО — файлы не записаны.")
        print("Что делать: поднять --min-silence (если реплики склеились) или опустить")
        print("его (если одна реплика распалась). Полезно посмотреть на подозрительно")
        print("короткие куски выше: обычно это обрывок, отрезанный от своей реплики.")
        return 1
    if args.dry_run:
        print("\n--dry-run: файлы не записаны, всё сходится")
        return 0

    os.makedirs(args.out, exist_ok=True)
    written = []
    for index, (start, end) in enumerate(pieces):
        target = os.path.join(args.out, lines[index]['file'])
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                        "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", args.audio,
                        "-c:a", "libmp3lame", "-q:a", str(args.bitrate), "-ar", "48000", target],
                       check=True)
        written.append({"file": lines[index]['file'], "node": lines[index]['node'],
                        "seconds": round(end - start, 2)})

    with open(os.path.join(args.out, "segments.json"), "w", encoding="utf-8") as handle:
        json.dump({"audio": os.path.basename(args.audio), "lines": written},
                  handle, ensure_ascii=False, indent=2)
    print(f"\nзаписано файлов: {len(written)} в {args.out}")
    print("проверка: ./build/russiano2d --game demos --scene russi_vn")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
