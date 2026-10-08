#!/usr/bin/env python3
"""Гейт документации Russiano2D для Claude Code.

PostToolUse(Read): запоминает, какие обязательные доки прочитаны ЦЕЛИКОМ.
PreToolUse(Edit|Write|NotebookEdit): не даёт править src/** пока не прочитано
ARCHITECTURE -> AGENT_IMPLEMENTATION_RULES -> API -> HIGH_LEVEL_API (а для
src/highlevel/** ещё highlevel/_CONTRACT.md и страница модуля, если есть).
Состояние — по session_id во временной папке.
"""
import json, os, sys, tempfile

ROOT = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", ".."))
CORE = ["docs/ARCHITECTURE.md", "docs/AGENT_IMPLEMENTATION_RULES.md",
        "docs/API.md", "docs/HIGH_LEVEL_API.md"]


def rel(p):
    p = os.path.realpath(p)
    return os.path.relpath(p, ROOT) if p.startswith(ROOT + os.sep) else None


def state_path(sid):
    return os.path.join(tempfile.gettempdir(), f"r2d_gate_{sid}.json")


def load(sid):
    try:
        return set(json.load(open(state_path(sid))))
    except Exception:
        return set()


def line_count(path):
    with open(path, "rb") as f:
        return sum(1 for _ in f)


def required(r):
    need = []
    if r.startswith("src/"):
        need += CORE
    if r.startswith("src/highlevel/"):
        need.append("docs/highlevel/_CONTRACT.md")
        name = os.path.splitext(os.path.basename(r))[0]
        page = f"docs/highlevel/{name}.md"
        if os.path.exists(os.path.join(ROOT, page)):
            need.append(page)
    return need


def main():
    d = json.load(sys.stdin)
    sid = d.get("session_id", "x")
    ev = d.get("hook_event_name")
    ti = d.get("tool_input") or {}
    fp = ti.get("file_path") or ti.get("notebook_path")
    if not fp:
        return 0
    r = rel(fp)
    if r is None:
        return 0
    if ev == "PostToolUse" and d.get("tool_name") == "Read":
        if r.startswith("docs/") and r.endswith(".md"):
            lim = ti.get("limit")
            if (not lim or lim >= line_count(fp)) and not ti.get("offset"):
                s = load(sid); s.add(r)
                json.dump(sorted(s), open(state_path(sid), "w"))
        return 0
    if ev == "PreToolUse":
        missing = [x for x in required(r) if x not in load(sid)]
        if missing:
            sys.stderr.write(
                "Гейт доков R2D: перед правкой %s прочитай ЦЕЛИКОМ (Read без limit), "
                "по порядку: %s. См. docs/AGENT_IMPLEMENTATION_RULES.md." %
                (r, ", ".join(missing)))
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
