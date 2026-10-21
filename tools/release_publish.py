#!/usr/bin/env python3
"""Публикация ОДНИХ И ТЕХ ЖЕ архивов из dist/ в GitHub и GitVerse.

Единственный публикатор релиза. build_and_push вызывает его после push тега;
CI релизы больше не создаёт. Архивы не пересобираются: на все сервисы уходят
файлы из dist/ и один SHA256SUMS.txt.

Провайдеры:
  * GitHub      — gh CLI (уже авторизован локально);
  * GitVerse    — публичный API https://api.gitverse.ru (Bearer GITVERSE_TOKEN);

Если токена провайдера нет, это НЕ успех и НЕ тихий skip: статус
'skipped-no-token' и итоговый код 1. Git-тег при этом уже отправлен — это
отражается в отчёте.
"""
import argparse
import json
import mimetypes
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import release  # noqa: E402

# Linux x86_64 временно вне локального релиза (Zig-кросс зависает); платформа
# собирается на целевой ОС. Вернуть в публикацию: R2D_BUILD_LINUX=1.
PLATFORMS = ["macos-arm64", "macos-x86_64", "windows-x86_64"]
if os.environ.get("R2D_BUILD_LINUX") == "1":
    PLATFORMS.append("linux-x86_64")
GITHUB_REPO = "Nikide/russiano2d"
API_ACCEPT = "application/vnd.gitverse.object+json;version=1"


def log(msg=""):
    print(msg, flush=True)


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def remote_path(remote, fallback):
    res = run(["git", "remote", "get-url", "push", remote], cwd=ROOT)
    url = (res.stdout or "").strip() if res.returncode == 0 else ""
    m = re.search(r"[:/]([^/:]+)/([^/]+?)(?:\.git)?$", url)
    if m:
        return m.group(1) + "/" + m.group(2)
    return fallback


def archives(version):
    files = []
    for platform in PLATFORMS:
        name = release.archive_name(platform, version)
        path = os.path.join(ROOT, "dist", name)
        if not os.path.isfile(path):
            raise SystemExit("release_publish: нет архива %s" % path)
        files.append(path)
    sums = os.path.join(ROOT, "dist", "SHA256SUMS.txt")
    if not os.path.isfile(sums):
        raise SystemExit("release_publish: нет dist/SHA256SUMS.txt")
    files.append(sums)
    return files


# ---------------------------------------------------------------------------
# GitHub: gh CLI
# ---------------------------------------------------------------------------
def publish_github(tag, title, notes, files, dry):
    if run(["gh", "auth", "status"]).returncode != 0:
        return {"provider": "GitHub", "status": "skipped-no-token",
                "detail": "gh не авторизован (gh auth login)"}
    view = run(["gh", "release", "view", tag, "--repo", GITHUB_REPO])
    if dry:
        return {"provider": "GitHub", "status": "dry-run",
                "detail": "create/update %s + upload %d файлов" % (tag, len(files))}
    if view.returncode != 0:
        created = run(["gh", "release", "create", tag, "--repo", GITHUB_REPO,
                       "--title", title, "--notes-file", notes, "--verify-tag"])
        if created.returncode != 0:
            return {"provider": "GitHub", "status": "failed", "detail": created.stderr.strip()}
    else:
        edited = run(["gh", "release", "edit", tag, "--repo", GITHUB_REPO, "--notes-file", notes])
        if edited.returncode != 0:
            return {"provider": "GitHub", "status": "failed", "detail": edited.stderr.strip()}
    up = run(["gh", "release", "upload", tag, "--repo", GITHUB_REPO, "--clobber", *files])
    return {"provider": "GitHub", "status": "ok" if up.returncode == 0 else "failed",
            "detail": (up.stderr or "").strip()}


# ---------------------------------------------------------------------------
# HTTP helpers (без внешних зависимостей)
# ---------------------------------------------------------------------------
def http_json(url, token, method="GET", body=None, accept="application/json"):
    data = None
    headers = {"Authorization": "Bearer " + token, "Accept": accept}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"raw": raw}
        return exc.code, payload
    except Exception as exc:  # noqa: BLE001
        return 0, {"error": str(exc)}


def multipart_upload(url, token, path, field, accept=API_ACCEPT, params=None,
                     auth_field="Authorization", auth_value=None):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    boundary = "----r2d-release-" + os.urandom(8).hex()
    filename = os.path.basename(path)
    ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    with open(path, "rb") as handle:
        content = handle.read()
    prefix = ("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
              "Content-Type: %s\r\n\r\n" % (boundary, field, filename, ctype)).encode()
    suffix = ("\r\n--%s--\r\n" % boundary).encode()
    req = urllib.request.Request(url, data=prefix + content + suffix,
                                 headers={auth_field: auth_value or ("Bearer " + token),
                                          "Accept": accept,
                                          "Content-Type": "multipart/form-data; boundary=" + boundary},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        return exc.code, {"raw": raw}
    except Exception as exc:  # noqa: BLE001
        return 0, {"error": str(exc)}


# ---------------------------------------------------------------------------
# GitVerse
# ---------------------------------------------------------------------------
def publish_gitverse(tag, title, notes, files, dry):
    token = os.environ.get("GITVERSE_TOKEN") or os.environ.get("GITVERSE_API_KEY")
    if not token:
        return {"provider": "GitVerse", "status": "skipped-no-token",
                "detail": "нет GITVERSE_TOKEN/GITVERSE_API_KEY"}
    repo = remote_path("gitverse", "Nikide/russiano2d")
    base = "https://api.gitverse.ru/repos/" + repo + "/releases"
    if dry:
        return {"provider": "GitVerse", "status": "dry-run",
                "detail": "%s: create/list + upload %d файлов" % (base, len(files))}
    status, rel = http_json(base + "/tags/" + urllib.parse.quote(tag), token, accept=API_ACCEPT)
    if status == 404:
        status, rel = http_json(base, token, method="POST", accept=API_ACCEPT,
                                body={"tag_name": tag, "name": title, "body": notes,
                                      "draft": False, "prerelease": False})
    if status not in (200, 201):
        return {"provider": "GitVerse", "status": "failed",
                "detail": "release API: %s %s" % (status, rel)}
    release_id = rel.get("id")
    if not release_id:
        return {"provider": "GitVerse", "status": "failed", "detail": "нет release id в ответе"}
    existing = {a.get("name") for a in rel.get("assets", []) if isinstance(a, dict)}
    for path in files:
        name = os.path.basename(path)
        if name in existing:
            continue
        code, payload = multipart_upload(base + "/" + str(release_id) + "/assets", token, path,
                                         "attachment", params={"name": name})
        if code not in (200, 201):
            return {"provider": "GitVerse", "status": "failed",
                    "detail": "asset %s: %s %s" % (name, code, payload)}
    return {"provider": "GitVerse", "status": "ok", "detail": "release %s, %d файлов" % (release_id, len(files))}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--version", required=True)
    p.add_argument("--tag", required=True)
    p.add_argument("--title", default=None)
    p.add_argument("--notes-file", required=True)
    p.add_argument("--dist", default=os.path.join(ROOT, "dist"))
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--only", choices=("github", "gitverse"), default=None)
    args = p.parse_args()
    title = args.title or ("Russiano2D " + args.tag)
    notes = open(args.notes_file, encoding="utf-8").read()
    files = archives(args.version)
    log("release_publish: %s, %d файлов" % (args.tag, len(files)))
    handlers = {"github": lambda: publish_github(args.tag, title, args.notes_file, files, args.dry_run),
                "gitverse": lambda: publish_gitverse(args.tag, title, notes, files, args.dry_run)}
    results = []
    for key, fn in handlers.items():
        if args.only and key != args.only:
            continue
        try:
            res = fn()
        except Exception as exc:  # noqa: BLE001
            res = {"provider": key, "status": "failed", "detail": str(exc)}
        results.append(res)
        log("  %-8s %-16s %s" % (res["provider"], res["status"], res.get("detail", "")))
    ok = all(r["status"] in ("ok", "dry-run") for r in results)
    if not ok and not args.dry_run:
        log("!! не все сервисы получили релиз — см. статусы выше")
    return 0 if ok or args.dry_run else 1


if __name__ == "__main__":
    sys.exit(main())
