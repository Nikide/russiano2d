#!/usr/bin/env python3
# ===========================================================================
# §66 плана дополировки: финальный acceptance checklist — проверяется машинно.
#
# Смысл гейта не в том, чтобы «все галочки стояли» — а в том, чтобы каждая
# галочка называла доказательство, а каждый незакрытый пункт называл причину.
# Иначе чеклист закрывается словами, и через месяц никто не скажет, чем именно
# он был закрыт.
#
# Правила:
#   * `- [x] пункт — доказательство`   → в строке обязана быть ссылка на
#     существующий файл (tests/..., tools/..., .github/...) либо на job CI;
#     файл проверяется на диске;
#   * `- [ ] пункт — причина: ...`     → у незакрытого пункта обязана быть
#     причина не короче 15 символов;
#   * `- [ ] пункт` без причины        → провал: молчаливый незакрытый пункт
#     ничем не отличается от забытого.
#
# Запуск:
#   python3 tests/production_polish_checklist_test.py
# ===========================================================================

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(ROOT, "docs", "PRODUCTION_POLISH.md")
SECTION = re.compile(r"^#\s*66\.", re.M)
NEXT_SECTION = re.compile(r"^#\s*\d+\.", re.M)
ITEM = re.compile(r"^\s*-\s*\[( |x|X)\]\s*(.+?)\s*$")
PATH = re.compile(r"(tests/[\w./\u0400-\u04ff-]+\.\w+|tools/[\w./-]+\.\w+|"
                  r"\.github/workflows/[\w./-]+|\.gitlab-ci\.yml|"
                  r"\.gitverse/workflows/[\w./-]+)")
CI_JOB = re.compile(r"CI:\s*[\w-]+")
MIN_REASON = 15

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def section_text():
    with open(PLAN, encoding="utf-8") as handle:
        text = handle.read()
    start = SECTION.search(text)
    if not start:
        raise SystemExit("в %s нет раздела «66.»" % PLAN)
    tail = text[start.end():]
    nxt = NEXT_SECTION.search(tail)
    return tail[:nxt.start()] if nxt else tail


def split_reason(body):
    """Пункт и его обоснование: отделяем по длинному тире или дефису."""
    for sep in ("\u2014", " -- ", " - "):
        if sep in body:
            head, _, tail = body.partition(sep)
            return head.strip(), tail.strip()
    return body.strip(), ""


def main():
    text = section_text()
    items = []
    for line in text.splitlines():
        match = ITEM.match(line)
        if match:
            items.append((match.group(1).lower() == "x", match.group(2)))

    print("§66: пунктов %d" % len(items))
    check(len(items) >= 30, "чеклист на месте (пунктов %d)" % len(items))

    done = missing = bare = 0
    for checked, body in items:
        head, reason = split_reason(body)
        if checked:
            done += 1
            refs = PATH.findall(reason)
            if refs:
                bad = [r for r in refs if not os.path.exists(os.path.join(ROOT, r))]
                check(not bad, "«%s»: доказательство существует (%s)"
                      % (head[:44], ", ".join(refs)))
            else:
                check(bool(CI_JOB.search(reason)),
                      "«%s»: доказательство названо (файл или job CI): %r"
                      % (head[:44], reason[:60]))
        else:
            if len(reason) >= MIN_REASON:
                missing += 1
            else:
                bare += 1
                check(False, "«%s»: незакрытый пункт без причины" % head[:44])

    print("\nзакрыто: %d, незакрыто с причиной: %d, незакрыто молча: %d"
          % (done, missing, bare))
    if done == 0:
        check(False, "чеклист ещё не начат")

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES[:20]:
            print("  - " + line)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
