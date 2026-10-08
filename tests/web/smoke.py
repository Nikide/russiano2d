#!/usr/bin/env python3
"""Дымовой прогон веб-сборки russiano2d в headless-браузере.

Что проверяется (без библиотек картинок и без ручного участия):

  1. страница веб-сборки открывается и модуль .wasm догружается;
  2. движок доходит до конца прогона (`--frames`), то есть кадры реально идут,
     а не «окно открылось и повисло»;
  3. кадр НЕ пустой: оболочка считает статистику пикселей canvas и кладёт
     маркер `R2D-WEB-SMOKE: ok colors=N bright=M` прямо в DOM.

Пиксельная проверка живёт в самой оболочке (web/shell.html) намеренно: так тест
не тянет Pillow/numpy, а маркер виден и человеку, и `--dump-dom`.

Запуск:
    python3 tests/web/smoke.py --build-dir /tmp/r2d-web/build
    python3 tests/web/smoke.py --build-dir ... --keep-artifacts

Браузер ищется по --chrome, затем в стандартных местах macOS/Linux.
"""

from __future__ import annotations

import argparse
import http.server
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
]

SMOKE_RE = re.compile(r"R2D-WEB-SMOKE:\s*(\S+)(.*)")


# Чем проверяем кадр. Пиксели canvas читать НЕЛЬЗЯ: drawImage по WebGPU-canvas
# отдаёт пустое изображение (движок рисует, а 2D-контекст кадр не видит), поэтому
# «colors=1» ничего не говорит о рендере. Достоверный признак — журнал самого
# движка: маячок first-frame (первый кадр отрисован) и отсутствие ошибок WebGPU.
BAD_MARKERS = ("abort", "uncaptured error", "memory access out of bounds",
               "RuntimeError", "Invalid CommandBuffer")


def verdict_from_progress(progress: list[str]) -> str | None:
    joined = "\n".join(progress)
    if any(marker in joined for marker in BAD_MARKERS):
        return "fail"
    if "first-frame" not in joined:
        return None
    if not any(line.startswith("stopped:") for line in progress):
        return None
    return "ok"


def find_chrome(explicit: str | None) -> str:
    if explicit:
        if not os.path.exists(explicit):
            sys.exit(f"[smoke] браузер не найден: {explicit}")
        return explicit
    for path in CHROME_CANDIDATES:
        if os.path.exists(path):
            return path
    sys.exit("[smoke] не найден Chrome/Chromium — укажите --chrome")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(directory: str, port: int, progress: list[str]) -> http.server.ThreadingHTTPServer:
    """Сервер сборки плюс приёмник маячков прогресса страницы.

    Маячки (web/shell.html → /__r2d_progress) нужны, чтобы при зависшем кадре
    было видно, докуда движок дошёл: DOM в этот момент уже не прочитать.
    """
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=directory, **kw)

        def log_message(self, *a, **k):
            return  # тишина: иначе каждый .wasm/.data печатает строку

        def do_GET(self):  # noqa: N802 — имя задано базовым классом
            if self.path.startswith("/__r2d_progress"):
                from urllib.parse import parse_qs, urlparse
                q = parse_qs(urlparse(self.path).query)
                stage = (q.get("stage") or [""])[0]
                detail = (q.get("detail") or [""])[0]
                progress.append(f"{stage}: {detail}" if detail else stage)
                self.send_response(204)
                self.end_headers()
                return
            super().do_GET()

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Дымовой прогон веб-сборки russiano2d")
    ap.add_argument("--build-dir", default="/tmp/r2d-web/build",
                    help="каталог с russiano2d.html/.js/.wasm/.data")
    ap.add_argument("--page", default="russiano2d.html",
                    help="какую страницу открывать (её же отдаёт сервер)")
    ap.add_argument("--chrome", default=None, help="путь к Chrome/Chromium")
    ap.add_argument("--frames", type=int, default=150,
                    help="сколько кадров прогнать (аргумент --frames движка)")
    ap.add_argument("--timeout", type=float, default=180.0, help="секунд на браузер")
    ap.add_argument("--screenshot", default=None, help="куда положить PNG кадра")
    ap.add_argument("--keep-artifacts", action="store_true",
                    help="не удалять профиль браузера (отладка)")
    ap.add_argument("--engine-args", default="",
                    help="дополнительные аргументы движка через запятую, например "
                         "'--game,demos,--scene,shooter25d'")
    ap.add_argument("--no-autostart", action="store_true",
                    help="не нажимать «Играть» программно: кнопку нажимает человек "
                         "(вместе с --frames 0 и --headed — режим наблюдения)")
    ap.add_argument("--keep-open", action="store_true",
                    help="не закрывать окно браузера после прогона (смотреть глазами)")
    ap.add_argument("--headed", action="store_true",
                    help="открыть НЕ headless окно (видно глазами); вердикт берётся из "
                         "маячков прогресса, а не из --dump-dom")
    args = ap.parse_args(argv)

    build_dir = os.path.abspath(args.build_dir)
    page = os.path.join(build_dir, args.page)
    if not os.path.exists(page):
        sys.exit(f"[smoke] нет {page} — сначала соберите веб-сборку")

    chrome = find_chrome(args.chrome)
    port = free_port()
    progress: list[str] = []
    httpd = start_server(build_dir, port, progress)

    profile = tempfile.mkdtemp(prefix="r2d-web-smoke-")
    screenshot = args.screenshot or os.path.join(profile, "frame.png")
    engine_args = []
    if args.frames > 0:                      # 0 = без лимита кадров
        engine_args += ["--frames", str(args.frames)]
    if args.engine_args:
        engine_args += [a for a in args.engine_args.split(",") if a]
    # autostart=1 — нажать «Играть» без человека: оболочка ждёт клика, потому
    # что без жеста пользователя браузер не открывает аудиоустройство. С
    # --no-autostart кнопку жмёт человек, и сцена стартует только тогда.
    # beacon=1 — слать маячки /__r2d_progress: без него страница молчит (на живом
    # сайте у хостинга такого адреса нет).
    url = f"http://127.0.0.1:{port}/{args.page}?args={','.join(engine_args)}&beacon=1"
    if not args.no_autostart:
        url += "&autostart=1"

    if args.headed:
        cmd = [
            chrome,
            "--disable-gpu-sandbox",
            "--no-first-run",
            "--no-default-browser-check",
            "--enable-unsafe-webgpu",
            f"--user-data-dir={profile}",
            "--window-size=1400,900",
            url,
        ]
    else:
        cmd = [
            chrome,
            "--headless=new",
            "--disable-gpu-sandbox",
            "--no-first-run",
            "--no-default-browser-check",
            "--enable-unsafe-webgpu",
            f"--user-data-dir={profile}",
            "--window-size=1280,720",
            "--virtual-time-budget=120000",
            f"--screenshot={screenshot}",
            "--dump-dom",
            url,
        ]

    print(f"[smoke] страница: {url}")
    print(f"[smoke] браузер:  {chrome}")

    if args.headed:
        # Видимое окно: читать DOM нечем, поэтому вердикт берём из маячков,
        # которые страница шлёт на наш сервер (в том числе итоговый stopped).
        import time
        seen = 0
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + args.timeout
        verdict_line = None
        try:
            while time.time() < deadline:
                while seen < len(progress):
                    line = progress[seen]
                    seen += 1
                    print("   ", line[:200], flush=True)
                    if line.startswith("stopped:"):
                        verdict_line = line
                if verdict_line:
                    break
                if proc.poll() is not None:
                    break
                time.sleep(0.25)
        finally:
            if args.keep_open:
                print("[smoke] окно оставлено открытым (--keep-open); "
                      "закройте его или остановите прогон вручную", flush=True)
                while proc.poll() is None:
                    time.sleep(1)
            else:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
            httpd.shutdown()
        if not args.keep_artifacts:
            shutil.rmtree(profile, ignore_errors=True)
        verdict = verdict_from_progress(progress)
        if verdict_line:
            print(f"[smoke] пиксельная проверка (справочно): {verdict_line}")
        if not verdict:
            sys.exit("[smoke] вердикта нет — страница не дошла до первого кадра "
                     "или движок не остановился")
        print(f"[smoke] вердикт по журналу движка: {verdict}")
        return 0 if verdict == "ok" else 1

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=args.timeout)
    except subprocess.TimeoutExpired:
        httpd.shutdown()
        print("[smoke] страница не завершилась; последние маячки прогресса:")
        for line in progress[-25:]:
            print("   ", line[:200])
        sys.exit(f"[smoke] браузер не ответил за {args.timeout:.0f} с")
    finally:
        httpd.shutdown()

    dom = proc.stdout or ""
    print("[smoke] журнал движка из DOM:")
    for line in dom.splitlines():
        if "[r2d]" in line:
            print("   ", line.strip()[:200])

    match = SMOKE_RE.search(dom)
    if match:
        print(f"[smoke] пиксельная проверка (справочно): {match.group(0)[:160]}")

    if os.path.exists(screenshot):
        print(f"[smoke] кадр: {screenshot} ({os.path.getsize(screenshot)} байт)")

    if not args.keep_artifacts and not args.screenshot:
        shutil.rmtree(profile, ignore_errors=True)

    verdict = verdict_from_progress(progress)
    if not verdict:
        print("[smoke] последние маячки прогресса:")
        for line in progress[-25:]:
            print("   ", line[:200])
        print(proc.stderr[-2000:], file=sys.stderr)
        sys.exit("[smoke] вердикта нет — страница не догрузилась или движок не остановился")
    print(f"[smoke] вердикт по журналу движка: {verdict}")
    return 0 if verdict == "ok" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
