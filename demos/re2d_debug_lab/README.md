# Re2D debug-overlay lab — P4

Показывает данные `world.debug.overlay/draw`: automap-линии (seen/unseen/portal
цвета), semantic точки (trigger/secret) и маркеры boss hit-зон. Данные берутся
из нативного мира, рисование — через `$.gfx.draw`, без 3D-gizmo API.

F1 — включить/выключить overlay; Esc — выход.
