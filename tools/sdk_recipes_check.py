#!/usr/bin/env python3
"""Lint every ```js block in docs/recipes/ через native r2d."""
import os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BINARY = os.path.join(
    ROOT, "build-xmake", "macos-arm64", "macosx", "arm64", "release", "r2d"
)
BINARY = os.environ.get("R2D_BINARY", DEFAULT_BINARY)
RECIPE = os.path.join(ROOT, "docs", "recipes", "README.md")


def main():
    if not os.path.isfile(BINARY):
        print("  FAIL нет бинарника r2d: задайте R2D_BINARY или соберите цель r2d через Xmake", file=sys.stderr)
        return 2
    text = open(RECIPE, encoding="utf-8").read()
    blocks = re.findall(r"```js\n(.*?)```", text, re.S)
    if not blocks:
        print("  FAIL в recipes нет js-блоков", file=sys.stderr)
        return 2
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        for i, block in enumerate(blocks, 1):
            path = os.path.join(tmp, "recipe_%02d.js" % i)
            open(path, "w", encoding="utf-8").write(block)
            proc = subprocess.run([BINARY, "lint", path], capture_output=True, text=True)
            if proc.returncode != 0:
                bad += 1
                print("  FAIL recipe %d" % i)
                print(proc.stdout[-1500:])
    if bad:
        print("  FAIL recipes with diagnostics: %d/%d" % (bad, len(blocks)), file=sys.stderr)
        return 1
    print("  ok   recipes: %d js-блоков проходят API lint" % len(blocks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
