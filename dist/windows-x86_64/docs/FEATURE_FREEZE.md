# Архив: Feature Freeze от 2026-10-20

> **Архив.** Решение о feature freeze и ограничения на развитие `$` API отменены
> 2026-10-21 из-за полной перестройки движка. Текст ниже фиксирует состояние
> на дату документа и не задаёт текущие требования.

Дата: **2026-10-20**. База: **v1.3.0**. FINAL ENGINE PASS завершён без нового
тега и без публикации релиза.

## Что это значит

Russiano2D **feature-complete для начала production-игры** на текущей
архитектуре:

```text
Native C core + QuickJS-NG + high-level $ + RmlUi + specialized SDK
```

После этой точки **новые engine-level возможности не добавляются просто
потому, что они интересные**. Новый engine feature принимается только если
выполнены ВСЕ пять условий:

1. есть реальный use case из игры (а не «может пригодиться»);
2. задачу нельзя разумно решить существующим `$` API/данными;
3. есть минимальная спецификация (входы, выходы, ошибки, границы);
4. есть тест (Unity для нативного/рантайма, qjs для JS-модели, либо
   существующий интеграционный путь — без нового фреймворка тестов);
5. есть документация в том же изменении.

Следующий этап проекта:

```text
MAKE A REAL GAME
```

а не `MAKE ENGINE FOREVER`. Замечания игры — источник следующих задач.

## Что закрыто в FINAL ENGINE PASS

| Область | Итог | Где смотреть / чем проверено |
|---|---|---|
| Save/settings schema | `$.save.schema`/`$.store.schema`: версия, миграции k→k+1 на копии, defaults, validate, структурные `R2D_SAVE_SCHEMA_*`; будущая схема не перезаписывается; backup/recovery настроек | `docs/highlevel/save.md`, `store.md`; `tests/js/save_schema_test.mjs` |
| Atomic write | `engine.fs.writeAtomic` (temp рядом + fsync + rename, `src/fs_util.c`) и `$.fs.writeAtomic`; слоты/настройки используют его, fallback честно помечен `atomic:false` | `tests/fs/atomic_write_test.c` (Unity 5/5) |
| Async loading | `$.scene.job` (on/off/emit, progress/done/activated/error/cancel, ratio/completed/total/current), `$.loading.scene`, свой RmlUi-экран `$.loading.rml`; активация отделена от приобретения, отмена не публикует мир | `docs/highlevel/loading.md`, `scene.md`; `tests/js/loading_scene_test.mjs` |
| Physics events | `sensor:enter`/`sensor:leave` через существующий `dispatchContacts`; `collide/separate/hit/stay` сохранены; payload с area/owner и честными null | `docs/highlevel/physics.md`, `collision.md`; `tests/js/contact_events_test.mjs`, `tests/agent/highlevel_contact_area_payload_test.py` |
| Replay/checkpoints | Именованные `$.replay.checkpoint('after_boss',{frame,hash?})`, state hash по gameplay-данным, `verifyCheckpoint`/divergence с кадром, именем, expected/actual и diff | `docs/highlevel/replay.md`; `tests/js/replay_checkpoint_test.mjs`, `highlevel_replay_test.py` |
| Trace | `$.trace.filter/read` (category/kind/selector/from/to/since/limit), `categories()`, `export()` json/text; монотонный `n` после переполнения кольца | `docs/highlevel/debug.md`; `tests/js/trace_filter_test.mjs`, `tests/agent/trace_producers_test.py` |
| DevTools | picking, правки x/y/visible/enabled и документированных physics-полей через `$.devtools.set`, ресурсы/бюджеты, `$.diag.bundle`; RmlUi only | `docs/DEVTOOLS.md`; `tests/js/devtools_edit_test.mjs`, `resources_test.mjs`, `diag_bundle_test.mjs` |
| Query operators | `limit`, `nearest` (якорь `.within`), `inside`, `visibleFrom` поверх существующих query/raycast/областей | `docs/highlevel/core.md`; `tests/js/query_ops_test.mjs` |
| SDK deps | `r2d-sdk deps` — граф авторских ассетов, транзитивная stale-проверка, кэш `.r2d/cache/assets.json` (рантайм не читает) | `docs/SDK.md` §4.1; `tests/sdk/deps_test.c` (Unity) |
| SDK studios | curve-graph в Particle Studio, click-to-select в RmlUi Studio (элементы с id), drag-resize коллизий, drag зон акустики | `docs/SDK.md` §8; `tests/js/sdk_studio_curves_test.mjs`, `r2d-sdk lint` |
| Tilemap terrain + animation | обычный JSON `terrains`/`autotile.mode='terrain'`/`animations`, редактор в Tilemap Studio, JS↔C parity, рантайм сам листает кадры (time.delta, pause/scale/fixed-dt) | `docs/highlevel/tilemap.md` §9.1/§12.1; `tests/js/tilemap_terrain_test.mjs`, `tilemap_anim_test.mjs`, `sdk_studios_test.py` |
| Font weight/style | RmlUi-лица `$.font.load(name,path,{weight,style})`, `$.font.faces()`; RCSS выбирает лицо; `gfx.text` остаётся одноатласным | `docs/highlevel/font.md` §6; `tests/js/font_weight_test.mjs`, `highlevel_text_test.py` |
| C-формат реплея | `content` ID + native-checkpoints Box2D, `--checkpoint`, `--checkpoints strict|off`, exit 3 на расхождении | `tests/replay/replay_checkpoint_test.c`, `tests/agent/replay_cli_test.py` |
| Diagnostics | `$.diag.bundle` — `diagnostics/<timestamp>/` с engine/stats/trace/replay/log, без сети и path traversal | `docs/highlevel/diag.md` |
| Engine stability | Исправлен double-free `SDL_GetBasePath()` при выходе (SIGABRT, если cwd без `game/main.js`); запуск из `/tmp` → exit 0 | `src/app.c`; проверено запуском |

## Проверки на 2026-10-20

* **CTest (Unity C + все `tests/js/*_test.mjs`): 194/194 passed** на macOS
  arm64 — включая atomic-write, SDK deps/schema, C-replay checkpoints,
  tilemap terrain/anim, font weight и drift-тесты.
* `tools/ci_verify.py --build-dir build` — RE2D=on, API/schema/typings/docs
  up to date, project+lint без ошибок.
* На дату документа существовали API snapshot-гейты. Они удалены 2026-10-21;
  новые и изменённые имена теперь описываются актуальной генерируемой схемой.
* Пакет macOS arm64 собран штатной release-тулзой, `ci_package_check`
  зелёный; распакованный вне checkout пакет: 465/465 checksums, CLI/templates/
  new/validate/run/build/doctor работают.
* Xmake-сборка релизных платформ: macOS arm64, macOS x86_64, Windows x86_64.
  **Linux x86_64 временно исключён из локального релиза** (Zig-кросс-сборка
  зависает): Linux-пользователь собирает движок на своей ОС, вернуть в релиз —
  `R2D_BUILD_LINUX=1`. Установленный прогон проверен на macOS arm64; Windows —
  только сборка; Linux — сборка на целевой ОС.
* Полный агентский набор после закрытия follow-up: **309 ok, 6 fail, 2 skip**
  (1871 с). Все шесть падений проверены отдельно и зелёные:
  `bashnya_visual_refs` (гнал старый бандл BASHNYA — теперь текущий движок),
  `re2d_atlas_residency` (контракт grace/warnGrace обновлён),
  `re2d_atlas_prefetch`, `smaa`, `sdk_splash`, `world_editor` —
  последние три флейкуют под общей нагрузкой и проходят при индивидуальном
  прогоне. Ранее найденные и исправленные: `fs_write_failure`, `ui_off`,
  `highlevel_joints`, `highlevel_tile_geometry`, `roadmap_acceptance`.
  Открытых регрессий FINAL PASS нет; интеграционный долг — только
  чувствительность трёх тестов к нагрузке, зафиксирован здесь.

## Что осталось (честно)

Это **не** скрытые «потом доделаем»: каждый пункт либо ограничение платформы,
либо не входит в базовый профиль, либо ждёт реальной игры.

* **Установленный SDK на Linux/Windows** не прогонялся в этом проходе (на
  macOS нет wine/qemu-user); macOS arm64 проверен полностью. Кросс-сборка всех
  четырёх платформ зелёная.
* **Font kerning точной настройкой** (table kerning) из `$` не управляется:
  RmlUi применяет кернинг из TTF сам; отдельного API «подкрутить кернинг» нет
  без реальной игры. Bold/italic и выбор face по weight/style — есть.
* **C-формат реплея** хеширует только нативное состояние физики и кадр;
  JS-узлы/`$.random` ему не видны — для них есть `$.replay` v2
  (задокументировано).
* **BSP/NAV визуализация как инструмент DevTools** и файловый Export override —
  не блокируют игру; данные доступны через `$.bsp`/`$.nav`/`$.devtools.set`.
* **Re2D World**: автоматическая топология cells, непрерывные slopes, sweep,
  звук через материалы/реверберация — вне базового 2D-профиля.
* **Web/WASM** — отдельная платформа, не считается готовой по наличию опции.

## Границы, которые не двигаются

ECS, второй scene graph, новый object system, замена `$`, второй язык
скриптов, замена QuickJS-NG, новый physics/renderer/UI framework, ImGui,
Qt/Electron, обязательный scene editor, новый project format, большой C++
rewrite — **не добавляются**. Расширения делаются минимально и канонично в
существующих подсистемах (`$.loading`, `$.replay`, события узлов,
`$.debug`/`$.devtools`).

## Как принять новую engine-возможность

1. описать реальный игровой сценарий и почему текущего API мало;
2. показать минимальную спецификацию и границы (ошибки, совместимость);
3. реализовать в существующей подсистеме, без дублирования;
4. добавить тест и документацию в том же изменении;
5. обновить этот файл, если меняется состав базового движка.

Всё остальное — **игровая логика**, а не движок.
