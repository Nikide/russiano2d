# R2D: покрытие 2D API и реальные границы

Сверка: 2026-10-08. Старые таблицы 2026-10-05 с колонкой «нет» для уже
реализованных модулей удалены. Проектные наброски и история итераций остаются
в Git; текущий справочник — [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md).
Это сопоставление областей 2D-движка, а не обещание совместимости с Godot.

## 1. Реализованные области

| Область | Текущая подсистема / документация |
|---|---|
| Узлы, селекторы, transform, иерархия | [core](highlevel/core.md), [render](highlevel/render.md) |
| Спрайты, region/nine-slice, атласы, шрифты | [atlas](highlevel/atlas.md), [text](highlevel/text.md), [font](highlevel/font.md) |
| Анимация и состояния | [anim](highlevel/anim.md), [animplayer](highlevel/animplayer.md), [state](highlevel/state.md) |
| Тайлы, частицы, навигация | [tilemap](highlevel/tilemap.md), [particles](highlevel/particles.md), [navmesh](highlevel/nav.md) |
| Prefab, сцены и загрузка | [prefab](highlevel/prefab.md), [scene](highlevel/scene.md), [task](highlevel/task.md) |
| Box2D формы/зоны/суставы/CCD/запросы | [world](highlevel/world.md) |
| Камеры, render targets, shader/post/VFX | [camera](highlevel/camera.md), [viewport](highlevel/viewport.md), [fx](highlevel/fx.md) |
| Шины, эффекты, seek, приоритеты голосов | [audiobus](highlevel/audiobus.md), [sound](highlevel/sound.md), [acoustics](highlevel/acoustics.md) |
| UI, ввод, локализация | [ui](highlevel/ui.md), [input](highlevel/input.md), [i18n](highlevel/i18n.md) |
| Mesh/кости/IK, Re2DSprite, Re2D World | [mesh](highlevel/mesh.md), [re2dsprite](highlevel/re2dsprite.md), [re2d](highlevel/re2d.md) |
| Сеть, record/replay, агент/DevTools | [net](highlevel/net.md), [replay](highlevel/replay.md), [agent](highlevel/agent.md), [devtools](highlevel/devtools.md) |
| Авторинг и нативные операции SDK | [SDK](SDK.md) |

Наличие подсистемы не означает совпадения всех возможностей с другим движком.
Подробные диапазоны, лимиты и fallback поведения указаны на страницах модулей.
Низкоуровневый `engine` — внутренность `$`, а не второй публичный игровой API.

## 2. Что остаётся

Актуальные незакрытые задачи собраны в [TASKS.md](TASKS.md): запросы/trace,
расширение DevTools, runtime portals/PVS и другие границы World, улучшение
bake и дальнейшие SDK-инструменты, упаковка SDK и проверка других платформ.
`Curve`/`Gradient`, nine-slice, IK, наследование visible/alpha, относительная
глубина, звук seek/priority и BSP-обёртка уже есть; их старые «нет» не актуальны.

## 3. Архитектура сравнения

R2D сохраняет `$`, C-ядро, JS-оркестрацию и пакетный кадр. Код и открытые данные
авторитетны; SDK-инструменты — их представления. UI — RmlUi, legacy пути
сохраняются по переходному правилу. Re2D синтезирует ordinary 2D representation.
См. [PHILOSOPHY.md](PHILOSOPHY.md), [UI_RMLUI_LAW.md](UI_RMLUI_LAW.md).

Исторические замеры производительности — [HIGH_LEVEL_API_PERF.md](HIGH_LEVEL_API_PERF.md).
Числа оттуда нельзя переносить на текущую сборку без повторного измерения.
