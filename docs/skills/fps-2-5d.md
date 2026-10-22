# Навык: вид от первого лица / 2.5D (бумер-шутер)

Для этого вида используется **новый** API `$.re2dWorld`; `.kind(Re2D)` и `$.camera.kind` — legacy, не трогай.
Подробности — `docs_show highlevel/re2d` и `docs/RE2D_WORLD_GUIDE.md`.

## 1. Конвейер

1. **Карта** в студии Hammer (`.re2dmap`): комнаты из кистей (`brush.create`), сущности (`entity.create` — старт, враги, предметы).
   Правки через `studio_edit`/`studio_op`, затем `studio_save`.
2. **Компиляция:** `r2d world-compile maps/level.re2dmap --renderer` → `.re2dworld` (через `r2d_cli`).
3. **Код:**
   ```js
   const world = $.re2dWorld.load('maps/level.re2dworld').backend('gpu');
   const ctrl = world.controller({ radius: 14, height: 56, eye: 48, step: 9 });
   ctrl.place(x, y, 0);
   const view = { x, y, h, yaw, pitch, fov, near };     // обновляй из ctrl и мыши каждый кадр
   $.render(() => world.render(view, 640, 360));
   ```
4. **Оружие и враги:** `weapon.hitscan`, `weapon.shotgun`, `weapon.ammo`, `weapon.reload`, `ai.chase`, `ai.ranged-attack`; HUD — `ui.health-bar`, `ui.weapon-panel`.
5. **Проверка:** `screenshot_check grid:true` — картинка занимает **весь** экран (частая ошибка — рендер только в части окна: размер
   `world.render(view, w, h)` должен совпадать с размером окна/целевой поверхности).

## 2. Правила

* Не оборачивай вызовы мира в `try/catch` — ошибки должны быть видны.
* Мышь управляет `yaw`/`pitch`; WASD — через `ctrl`. Камера и управление должны быть заметны в `playtest` (`eval` позиции).
* Освещение, небо, эффекты — возможности рендерера: `docs/RE2D_RENDER_FEATURES.md`, `docs/RE2D_SKY_BOUNDARY.md`, `docs/RE2D_VFX.md`.
* Размер уровня: начни с 3–5 комнат; проверь `r2d world-info` (статистика, порталы) перед тем, как наращивать.
* Для боя «бумер-шутера»: 3–4 типа врагов, 2–3 оружия, аптечки/патроны, ключи/двери, секреты; арена перед боссом.

## 3. Проверка

1. `world-compile` без ошибок, `r2d world-info` показывает комнаты и порталы.
2. `screenshot_check` — кадр не пустой, на весь экран.
3. `playtest`: `hold ["W"]` → позиция героя изменилась; стрельба → здоровье врага уменьшилось; убийство всех → выход открыт.
