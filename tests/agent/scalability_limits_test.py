#!/usr/bin/env python3
# ===========================================================================
# Стресс масштабируемости: реестр текстур, атлас шрифтов, очередь загрузки.
#
# Проверяет требования scalability-pass:
#   * больше 256 одновременных текстур (бывший R2D_MAX_TEXTURES) и корректный
#     возврат слотов после free — реестр динамический;
#   * 1000+ ранее не встречавшихся глифов растеризуются, атлас переходит на
#     новые страницы, а не упирается в один массив;
#   * обновления текстур за кадр не ждут GPU-fence (renderInfo().texture_fence_waits == 0).
#
# Запуск после сборки:
#   python3 tests/agent/scalability_limits_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


TEXTURE_STRESS = """
(() => {
  const ids = [];
  const px = new Uint8Array(16);
  for (let i = 0; i < 400; i++) {
    px.fill(i & 255);
    const id = engine.textureFromPixels(2, 2, px);
    if (id < 0) return {error: 'texture ' + i + ' failed', made: ids.length};
    ids.push(id);
  }
  const before = engine.limits();
  for (const id of ids) engine.freeTexture(id);
  const after = engine.limits();
  return {made: ids.length, before: {live: before.textures, cap: before.textures_max},
          after: {live: after.textures, cap: after.textures_max}};
})()
"""

FONT_STRESS = """
(() => {
  let s = '';
  for (let cp = 0x0410; cp < 0x0410 + 64; cp++) s += String.fromCodePoint(cp);
  for (let cp = 33; cp < 33 + 60; cp++) s += String.fromCodePoint(cp);
  const before = engine.fontStats();
  for (let size = 6; size <= 90; size++) engine.drawText(s, 10, 10, size, 0xffffffff, 0, '', 0, 1);
  return {before, after: engine.fontStats()};
})()
"""


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(3)

        tex = a.eval(TEXTURE_STRESS)
        print("  texture:", tex)
        check(isinstance(tex, dict) and "error" not in tex, "400 текстур созданы без отказа")
        check(tex.get("before", {}).get("live", 0) >= 400,
              "реестр текстур держит >256 одновременно (было: %s)"
              % tex.get("before", {}).get("live"))
        check(tex.get("before", {}).get("cap", 0) >= 400,
              "ёмкость реестра видна в limits().textures_max: %s"
              % tex.get("before", {}).get("cap"))
        check(tex.get("after", {}).get("live", 999) < 20,
              "после free слоты вернулись (живых: %s)" % tex.get("after", {}).get("live"))

        font = a.eval(FONT_STRESS)
        print("  font:", font)
        check(font.get("after", {}).get("glyphs", 0) >= 1000,
              "1000+ глифов растеризованы: %s" % font.get("after", {}).get("glyphs"))
        a.step(4)
        info = a.eval("engine.renderInfo()")
        print("  render:", {k: info.get(k) for k in
                            ("texture_uploads", "texture_upload_batches",
                             "texture_upload_bytes", "texture_fence_waits")})
        check(info.get("texture_fence_waits", -1) == 0,
              "обновления текстур не ждут GPU-fence: %s" % info.get("texture_fence_waits"))

    if FAILURES:
        print("\nПРОВАЛЫ:")
        for f in FAILURES:
            print("  -", f)
        return 1
    print("\nВсе проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
