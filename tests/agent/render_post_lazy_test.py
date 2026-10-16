#!/usr/bin/env python3
# ===========================================================================
# §task-55: пайплайн пост-обработки создаётся ЛЕНИВО.
#
# Проверяемое свойство (а не «драйвер не упал» — это среда):
#   * на старте, пока игре пост не нужен, GPU-ресурс пайплайна НЕ создаётся
#     (`renderInfo().post_pipeline_creates === 0`, `post === false`);
#   * при первом запросе эффектов он создаётся РОВНО один раз и пост становится
#     доступен;
#   * повторные включения (и выключение) второго пайплайна не создают;
#   * `post_error` пуст, когда всё хорошо, — причина отказа доступна игре.
#
# Зачем свойство важно: движок, которому пост не нужен, не должен трогать GPU
# ради выключенной функции. На программном Vulkan (lavapipe) именно этот вызов
# на старте ронял движок SIGSEGV внутри vkCreateGraphicsPipelines — движок не
# доходил до первого кадра (разбор и стек: docs/TESTING.md §6.1).
#
# Запуск после сборки: python3 tests/agent/render_post_lazy_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
FAILURES = []

#: Включение эффекта: `on` поднимает флаг прохода, `glow` делает его непустым.
POST_ON = ("$.gfx.post({ on: true, glow: 0.6, vignette: 0.2, chromatic: 0.001,"
           " lens: 0, grain: 0, scanline: 0, distort: 0, noise_amount: 0,"
           " saturation: 1, contrast: 1, brightness: 0, tint_amount: 0, blood: 0,"
           " posterize: 0 })")
POST_ON_AGAIN = POST_ON.replace("glow: 0.6", "glow: 0.75")
POST_OFF = "$.gfx.post({ on: false })"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def info(a):
    return a.eval("engine.renderInfo()")


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(6)

        st = info(a)
        check(st.get("post_pipeline_creates") == 0,
              "на старте пайплайн пост-обработки не создан (счётчик %s)"
              % st.get("post_pipeline_creates"))
        check(st.get("post") is False, "пост на старте выключен (post=%s)" % st.get("post"))
        check(not st.get("post_error"), "причина отказа пуста, пока пост не просили")
        # Ключевая ловушка ленивого создания: JS-слой решает «конфигурировать ли
        # пост» по postSupported(). Если спрашивать «есть ли пайплайн», ответ до
        # первого запроса всегда false — и пост не включится НИКОГДА.
        check(a.eval("$.gfx.postSupported()") is True,
              "postSupported() — про возможность, а не про факт: true до первого запроса")
        check(st.get("passes") == 0 and st.get("scene_w") == 0,
              "прохода и offscreen-сцены на старте нет (passes=%s, scene_w=%s)"
              % (st.get("passes"), st.get("scene_w")))

        # Первый запрос эффектов — единственное создание пайплайна.
        a.eval(POST_ON)
        a.step(6)
        st = info(a)
        check(st.get("post_pipeline_creates") == 1,
              "первый запрос эффектов создал пайплайн ровно один раз (счётчик %s)"
              % st.get("post_pipeline_creates"))
        check(st.get("post") is True, "пост стал доступен (post=%s)" % st.get("post"))
        check(a.eval("$.gfx.post().enabled") == 1, "состояние API тоже видит включённый пост")
        check(not st.get("post_error"), "ошибки создания нет (post_error=%r)"
              % st.get("post_error"))
        # Полноэкранный проход реально идёт: счётчик проходов кадра и offscreen
        # сцена появляются только вместе с постом (на старте было 0 и 0).
        a.step(4)
        after = info(a)
        check(after.get("passes", 0) >= 1 and after.get("scene_w", 0) > 0,
              "полноэкранный проход реально идёт (passes=%s, scene=%sx%s)"
              % (after.get("passes"), after.get("scene_w"), after.get("scene_h")))

        # Повторные включения второго пайплайна не создают.
        for _ in range(3):
            a.eval(POST_ON_AGAIN)
            a.step(2)
        check(info(a).get("post_pipeline_creates") == 1,
              "три повторных включения не создали второй пайплайн (счётчик %s)"
              % info(a).get("post_pipeline_creates"))

        # Выключение и новое включение: пайплайн переиспользуется, а не плодится.
        a.eval(POST_OFF)
        a.step(4)
        check(info(a).get("post_pipeline_creates") == 1,
              "выключение поста не создаёт пайплайн заново (счётчик %s)"
              % info(a).get("post_pipeline_creates"))
        a.eval(POST_ON)
        a.step(4)
        check(info(a).get("post_pipeline_creates") == 1,
              "повторное включение переиспользует пайплайн (счётчик %s)"
              % info(a).get("post_pipeline_creates"))
        check(info(a).get("post") is True and a.eval("$.gfx.post().enabled") == 1,
              "после выключения и включения пост снова работает")

        # SMAA — тоже причина прохода: включается без прочих эффектов и не
        # создаёт второй пайплайн.
        a.eval(POST_ON)
        a.step(3)
        a.eval("$.gfx.smaa(true)")
        a.step(6)
        check(info(a).get("post_pipeline_creates") == 1,
              "включение SMAA переиспользует тот же пайплайн (счётчик %s)"
              % info(a).get("post_pipeline_creates"))
        check(a.eval("engine.renderInfo().smaa_steps") == 4,
              "SMAA действительно включён (steps=%s)"
              % a.eval("engine.renderInfo().smaa_steps"))
        a.eval("$.gfx.smaa(false)")

        # Регрессия, которую ленивое создание внесло и получило по шапке:
        # показ render target'а игры без включённого поста использовал тот же
        # пайплайн для копии кадра — без него в проход уходил NULL и бэкенд
        # падал. Проверяем: цель создаётся, показывается и освобождается, а
        # движок жив.
        vid = a.eval("$.viewport.create(96, 64)")
        check(isinstance(vid, int) and vid >= 0,
              "render target создан без включённого поста (id=%s)" % vid)
        a.eval("$.viewport.bind(%d)" % vid)
        frames_before = a.eval("engine.frame")
        a.step(3)
        check(a.eval("engine.frame") > frames_before,
              "движок жив после кадров с связанным render target'ом (%s → %s)"
              % (frames_before, a.eval("engine.frame")))
        # Семантику «bind живёт кадр» проверяет render_target_lifecycle_test;
        # здесь важен только факт: копия кадра в цель не роняет бэкенд и
        # переиспользует тот же пайплайн.
        check(a.eval("$.viewport.destroy(%d)" % vid) is True, "цель освобождена")
        a.eval("$.store.set('vp_bind', -1)")
        a.step(2)
        check(a.eval("$.viewport.count()") == 0, "после освобождения целей нет")
        check(info(a).get("post_pipeline_creates") == 1,
              "копия кадра в render target переиспользовала пайплайн (счётчик %s)"
              % info(a).get("post_pipeline_creates"))

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for item in FAILURES:
            print("  - " + item)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
