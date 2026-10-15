# План закрытия спецификации производственной готовности

Этот файл — рабочий журнал по [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)
(далее — Спецификация). Он не заменяет её: разделы, приоритеты и критерии
приёмки берутся оттуда. Здесь только порядок работы, владельцы файлов и
фактическое состояние пунктов, чтобы правки не пересекались, а «закрыто»
означало проверенный сценарий, а не наличие метода.

## Правила

1. **Спецификация главнее плана.** Если реализация расходится с §-текстом —
   правится реализация, а расхождение фиксируется в отчёте.
2. **Один пункт = код + тест + документация + запускаемый пример.**
   Checklist §37 закрывается только с доказательством (§35.3).
3. **Архитектурные обязательства §1.1 и anti-goals §36 не обсуждаются.**
   `$` — единственная публичная точка входа, node/tag/wrapper сохраняются,
   новый UI — только RmlUi, ECS и второй scene graph не вводятся.
4. **Закрытый пункт вычёркивается из текущего плана** в том же изменении
   (правило [TASKS.md](TASKS.md)).

## Волны и владельцы

Волна — набор пунктов, которые можно делать параллельно без общих файлов.
Владелец файла указывается явно; при пересечении правку делает один человек.

| Волна | Пункт | Спецификация | Владелец файлов |
|---|---|---|---|
| 1 | Local/world transforms, attachments, shape enable | §39, §40, §4.1 | `src/highlevel/core.js`, `api.js`, `src/nodes.c`, `src/physics.c/.h`, `src/script.c` |
| 1 | Multi-target animation и property/audio tracks | §41, §6 | `src/highlevel/animplayer.js`, `anim.js`, `time.js` |
| 1 | Частичная коллизия тайла и логические координаты | §42 | `src/highlevel/tilemap.js` |
| 1 | Seeded simplex noise | §43 | `src/highlevel/random.js` |
| 2 | Contact/controller contract, hit/hurt, damage | §7, §8, §9 | `src/physics.c`, `highlevel/collision.js`, `api.js`, `combat.js`, `hits.js` |
| 2 | Lifecycle scope и cleanup | §5, §13 | `src/highlevel/scene.js`, `signal.js`, `flow.js`, `task.js` |
| 2 | Save/restore, stable IDs, RNG state | §10, §14, §26 | `src/highlevel/save.js`, `store.js`, `prefab.js`, `random.js`, `replay.js` |
| 2 | Input contexts, rebinding, gamepad | §15 | `src/highlevel/input.js` |
| 3 | Processing policy, visibility events, ticks | §44 | `src/highlevel/api.js`, `triggers.js`, `time.js` |
| 3 | Асинхронная загрузка и progress | §45 | `src/highlevel/resource.js`, `loading.js`, `scene.js`, `src/render.c` |
| 3 | Room/camera/tilemap transactions | §19, §23 | `camera.js`, `tilemap.js`, `prefab.js` |
| 3 | Atlas correctness | §22 | `src/highlevel/atlas.js` |
| 3 | Generation helpers и validation | §24 | `src/highlevel/grid.js`, `nav.js`, `task.js` |
| 4 | Screen effect pass | §46 | `src/highlevel/fx.js`, `render.js`, `src/render.c` |
| 4 | Particle profile parameters | §47 | `src/highlevel/particles.js` |
| 4 | Audio routing и bus isolation | §25, §48 | `src/highlevel/sound.js`, `audiobus.js`, `soundbank.js`, `src/audio*.c` |
| 4 | Renderer/layers/lighting presentation | §18, §20 | `src/render.c`, `highlevel/render.js`, `layers.js` |
| 4 | UI/HUD/localization/timeline integration | §16, §31 | `src/highlevel/ui.js`, `i18n.js`, `timeline.js`, `cutscene.js` |
| 4 | DevTools/diagnostics/profiling | §17, §28 | `src/highlevel/devtools.js`, `debug.js`, `agent.js` |
| 5 | SDK panels, examples, packaging, CI | §29, §30, §31 | `sdk/**`, `tools/**`, `.github/**`, `demos/**` |

## Готовые пакеты работ (очередь)

Пакеты ниже готовы к передаче исполнителю: границы файлов, объём и проверка
уже определены. Они берутся в работу, когда освобождается исполнитель (в
команде ограничение на число одновременных участников, поэтому очередь
разгружается по мере закрытия волны).

### Пакет W2-A. Контакты, контроллер, damage (§7, §8, §9)
* Файлы: `src/physics.c/.h`, `src/highlevel/collision.js`, `combat.js`, `hits.js`,
  `api.js` (контроллер и урон), `script.c` (биндинги).
* Обязательно: валидация полигона/капсулы до создания тела; shape role и
  безопасная очередь изменений формы; grounded по контактам и sweep с учётом
  ширины тела; attack instance ID/owner/team/window/dedup; причина отказа в
  ответе damage request; `$.hits` — только presentation.
* Приёмка: края, ступени, потолок, склон, one-way stack, смерть в drop-through;
  один удар при нескольких hurtboxes; invulnerability не отключает движение;
  отражение меняет owner/team; смерть ровно один раз.

### Пакет W2-B. Lifecycle scope и cleanup (§5, §13)
* Файлы: `src/highlevel/scene.js`, `signal.js`, `flow.js`, `task.js`.
* Обязательно: состояния active/closing/closed, prepare→commit, отмена ожиданий,
  безопасное удаление узлов в своей фазе, persistent HUD с другим владельцем.
* Приёмка: 100 restart/load не растят узлы, тела, подписки и таймеры.

### Пакет W2-C. Save/restore, RNG state, replay hashes (§10, §14, §26)
* Файлы: `src/highlevel/save.js`, `store.js`, `prefab.js`, `random.js`,
  `replay.js`, `src/highlevel/api.js` (хуки восстановления).
* Обязательно: namespace/schema policy (профиль, прохождение, комната,
  presentation), restore protocol с временной областью, atomic replace и backup,
  RNG export/import с version/algorithm ID, replay header с build/content hashes.
* Приёмка: загрузка в прыжке/полёте снаряда/cooldown/фазе врага; испорченный
  JSON и неизвестная версия не уничтожают последний слот; два прогона дают
  одинаковые события и hashes.

### Пакет W2-D. Input contexts, rebinding, gamepad (§15)
* Файлы: `src/highlevel/input.js`, `tests/js/input_*`.
* Обязательно: контексты gameplay/menu/dialogue/loading с приоритетом
  потребления; rebind workflow с cancel/timeout/conflict report; deadzone и
  hysteresis аналогов; reconnect без stuck action.
* Приёмка: меню проходится геймпадом; отключение во время прыжка не оставляет
  зажатую кнопку; rebind переживает перезапуск.

### Пакет W3-A. Processing policy, visibility events, simulation ticks (§44)
* Файлы: `src/highlevel/api.js` (политики), `triggers.js`, `time.js`.
* Обязательно: opt-in политики node update / fixed update / animation / timers /
  physics, наследуемые от scope; screen/region enter/exit с margin и
  hysteresis; отдельный счётчик simulation ticks, не зависящий от render FPS.
* Приёмка: inactive враг не двигается, но sensor включается отдельно; снаряд
  живёт одинаковое simulation time при разном FPS.

### Пакет W3-B. Асинхронная загрузка и progress (§45)
* Файлы: `src/highlevel/resource.js`, `loading.js`, `scene.js`, `src/render.c`
  (upload в безопасной фазе).
* Обязательно: состояния queued/loading/decoded/uploading/ready/failed/cancelled,
  progress в известных единицах, I/O и decode вне главного потока, QuickJS не
  используется конкурентно.
* Приёмка: тяжёлый PNG/audio не блокирует анимацию загрузки и cancel; неверный
  путь даёт failed; отменённая сцена не появляется позже новой.

### Пакет W3-C. Room/camera/tilemap transactions (§19, §23)
* Файлы: `src/highlevel/camera.js`, `tilemap.js`, `prefab.js`.
* Обязательно: camera zones с lease и приоритетом; bounds с учётом viewport,
  zoom и rotation; пакетное изменение карты (cells → visual/collision/occlusion
  → publish) без промежуточного несогласованного состояния.
* Приёмка: переходы комнат без пустого края; дверь меняет картинку, коллизию и
  occlusion согласованно.

### Пакет W3-D. Atlas correctness (§22)
* Файлы: `src/highlevel/atlas.js`.
* Обязательно: source size, trim rect, pivot, длительности кадров до playback,
  tags/directions, sockets, collision metadata; rotated frames — канонизация
  или явный отказ; разделение автополей и авторских данных.
* Приёмка: fixtures на unequal durations, reverse/pingpong, trimmed, sockets,
  page switch, отсутствие текстуры.

### Пакет W3-E. Generation helpers и validation (§24)
* Файлы: `src/highlevel/grid.js`, `nav.js`, `task.js`.
* Обязательно: связные области, поиск опор, free-space по размеру, distance/
  clearance map, weighted placement с exclusion radius, проверка связности
  room graph, optional reachability по параметрам контроллера; pipeline
  seed → layout → collision → placement → validation → publish с ограниченным
  retry и derived seed.
* Приёмка: 1000 фиксированных seeds проходят инварианты; одинаковый seed при
  разном task budget даёт одинаковый hash; отмена не оставляет половину карты.

### Пакет W4-A. Screen effect pass (§46)
* Файлы: `src/highlevel/fx.js`, `render.js`, `src/render.c`.
* Обязательно: один безопасный screen pass (source texture, optional auxiliary,
  bounded typed params, resolution/time, blending, ownership); запрет чтения из
  одновременно записываемого target; fallback при ошибке шейдера.
* Приёмка: wave/noise/channel shift при resize и движущейся камере; save/replay
  логики не зависит от visual noise.

### Пакет W4-B. Particle profile params (§47)
* Файлы: `src/highlevel/particles.js`.
* Обязательно: emission cycle/explosiveness/timing randomness, per-emitter speed
  scale, radial/tangential acceleration от origin эмиттера, hue variation.
* Приёмка: preset с seed повторяется при fixed step, работает при отрицательной
  гравитации и движущемся emitter.

### Пакет W4-C. Audio routing и bus isolation (§25, §48)
* Файлы: `src/highlevel/sound.js`, `audiobus.js`, `soundbank.js`, `src/audio*.c`.
* Обязательно: единая маршрутизация, voice limit/priority/stealing, stems с
  общим sample-clock и квантованием переключения, wet/send или изолированный bus
  DSP, явное различие dB и linear.
* Приёмка: stems без нарастающего рассинхрона (PCM/transport timestamps); dry UI
  click остаётся dry при wet ambience.

### Пакет W4-D. Renderer/layers/lighting contract (§18, §20)
* Файлы: `src/render.c`, `src/highlevel/render.js`, `layers.js`.
* Обязательно: стабильный порядок layer/Z/Y/creation, разделение world/lighting/
  overlay/UI проходов, семантика current/previous frame у render targets,
  pixel-art профиль (nearest, snapping только presentation), masks света и
  инвалидация динамического occluder только затронутой области, лимиты качества
  с документированной деградацией, material keys в batch key.
* Приёмка: эталонные сцены alpha/add/multiply/Y-sort/UI/parallax/offscreen;
  смена сцены не показывает освобождённую текстуру; профиль RE2D=OFF сохраняет
  полный обычный 2D-путь.

### Пакет W4-E. UI/localization/timeline integration (§16, §31)
* Файлы: `src/highlevel/ui.js`, `i18n.js`, `timeline.js`, `cutscene.js`.
* Обязательно: data bindings здоровья/cooldown/таймера/прогресса; пути .rml/
  .rcss/шрифтов одинаковы при прямом запуске, из SDK и из пакета; focus stack;
  обновление открытых документов при смене языка; timeline owner/pause policy и
  определённое конечное состояние при skip/stop.
* Приёмка: HUD переживает restart; Escape закрывает верхний контекст и
  возвращает фокус; skip не повторяет необратимые effects.

### Пакет W4-F. Diagnostics и profiling (§17, §28)
* Файлы: `src/highlevel/devtools.js`, `debug.js`, `agent.js`.
* Обязательно: структурированный результат критических операций (code,
  subsystem, operation, assetPath/nodeId, message, recoverability); loader не
  выдаёт success при неполном обязательном мире; QuickJS exception со stack и
  source path; rate limit повторных сообщений со счётчиком потерь; devtools
  представления collider/hitbox/hurtbox, contact normals, ground support,
  active windows, FSM, ownership таймеров, input contexts; profiler разделяет
  simulation/physics/queries/scripts/animation/particles/shadows/batch/UI/GPU и
  не называет GPU time без GPU timestamps.
* Приёмка: по hit ID находится источник, контакт, решение фильтра и damage
  result; inspector не обращается к уничтоженному handle; отчёт профиля
  машиночитаем.

## Состояние пунктов

Отметка «закрыт» ставится только после прогона, указанного в колонке
«доказательство», на текущей ревизии.

| Пункт | Состояние | Доказательство |
|---|---|---|
| §4.3 фазы кадра | **закрыт** | `docs/FRAME_PHASES.md`, `tests/agent/frame_phases_test.py` (порядок, удаление в callback, ID события) |
| §14/§4.2 стабильные ID узлов | **закрыт** (основа) | `$('#x').nid()`, снимок узла, поле в `$.prefab.save` |
| §13/§28 журнал трассировки | **закрыт** (основа) | `$.trace` (кольцо 256, `note/dropped`), `frame_phases_test` |
| §17 диагностика | **закрыт** | `src/highlevel/diag.js`, `docs/highlevel/diag.md`, `tests/js/diag_test.mjs`, `tests/agent/highlevel_diag_test.py` |
| §31-1 Platform foundations | **закрыт** | `demos/foundations` + `README`, `tests/agent/foundations_test.py` (25 проверок) |
| §39 local/world transforms | **закрыт** | `transformSpace/localAt/localAngle/localScale/worldPoint/localPoint/worldTransform`, нативный пакетный проход + JS-резерв, reparent keep-world/keep-local; `tests/js/transforms_test.mjs` (21), `highlevel_transforms_test.py` (62) |
| §40 независимые sensors и enable | **закрыт** | `.area/.areaOn/.areas/.areaOverlap`, native `setShapeEnabled/setShape/shapeOverlaps`, routing `areaA/roleA/ownerA`; форма вне физики и запросов без потери владельца, index переживает пересборку |
| §41 multi-target tracks | **закрыт** | `tests/js/anim_tracks_test.mjs` (50), `tests/agent/highlevel_animtracks_test.py` (53): клип ведёт кадры, оружие, shape.enabled, emitter, UI и SFX; seek предпросмотра урона не наносит |
| §10 tracks/markers | **закрыт** (в объёме §41) | маркеры с ID и policy, gameplay-окна, прерывание закрывает окно |
| §42 partial tile collision | **закрыт** | дескриптор `tiles` (shape/visual/occluder/masks), logical origin + pad, `fail`-политика лимита тел; `tests/js/tilemap_test.mjs` (35), `tests/agent/highlevel_tile_geometry_test.py` (67), замеры в docs/highlevel/tilemap.md §6 |
| §43 seeded simplex | **закрыт** | `$.random.simplex2D/noise/fbm2D/hashCells`, `tests/js/simplex_noise_test.mjs` (21), `highlevel_random_test.py` (34), эталоны `tests/fixtures/generation_noise` |
| §26 RNG state (часть random) | **закрыт** (интерфейс готов) | `$.random.state/restore/validateState/stream`; потребители save/replay — пакет W2-C |
| §31-2 stress-стенд §35.2 | **закрыт** (стенд) | `demos/stress` (6 сцен, 200 тел / 500 снарядов / 5 000 частиц / 32 света / карта 200×100), `tools/bench_stress.py`, отчёт `build/stress-on.json` |
| §6 часы/pause/hit-stop | частично (C-гейт `setTimeScale`, `$.time.freeze/slow`) | 30/60/144 FPS, одинаковые simulation events |
| §5/13 lifecycle и cleanup | **закрыт** (документация в очереди) | scope active→closing→closed, prepare→commit, scoped-подписки/таймеры/задачи; числа: 100 restart/load — nodes 12→12, bodies 10→10, subs 1→1, timers 2→2, flows 2→2; `lifecycle_numbers_test.py` (44) |
| §7/8/9 контакты, контроллер, damage | частично (controls, one-way, CCD) | края, ступени, потолок, склон, one-way stack, смерть в drop-through |
| §10/14/26 save/RNG/replay | не начато | mid-session restore, испорченный слот, divergence report |
| §15 input contexts | не начато | меню геймпадом, reconnect, rebind между запусками |
| §44 processing policy и ticks | частично (`$.time`, visibility) | inactive враг: sensor отдельно, смерть по clock, тот же simulation time при разном FPS |
| §45 загрузка и progress | частично (`loadAsync`, `$.loading`) | тяжёлый PNG не блокирует анимацию загрузки и cancel |
| §46 screen effect pass | не начато | wave/noise/channel shift при resize, fallback |
| §47 particle параметры | частично | seed+fixed step, отрицательная гравитация, движущийся emitter |
| §48 audio bus isolation | частично (шины, reverb) | dry click остаётся dry при wet ambience |
| §18 renderer presentation | не начато | эталонные сцены alpha/add/multiply/Y-sort/UI/parallax |
| §19 camera и комнаты | частично (follow/deadzone/lookahead/limits) | переходы комнат без пустого края, resize, cutscene-stop |
| §20 свет и материалы | частично (light nodes, occluders) | маски, динамический occluder, quality limits, flat-normal fallback |
| §21 particles/VFX бюджеты | частично (presets, ramps, pool) | сотни ударов без роста узлов, reduced flash |
| §22-24 atlas/tilemap/generation | частично | fixtures кадров, room reload, seed corpus |
| §25 audio stems | не начато | PCM/transport timestamps |
| §27 hot reload | частично (reload hooks) | last-known-good при ошибке, серия reload без роста памяти |
| §28 debug/profiling | частично (DevTools, agent) | hit ID → источник → контакт → damage result |
| §29 SDK panels | частично | создание/правка/CLI-проверка/preview/игра без project database |
| §30 packaging/CI | частично (упаковка, CI) | установленный пакет вне checkout: пример, сборка, перенос |
| §31 docs и вертикальные примеры | частично | семь примеров §31 запускаются из пакета |
