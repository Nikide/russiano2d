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
| §31-3 Pattern arena | **закрыт** | `demos/arena` + `tests/agent/arena_test.py` (62): фазы по таблице HP/таймера/маркера, отменяемая фаза (после отмены за 90 кадров ни одного снаряда), пул с потолком узлов (48 при 163 выдачах), пауза через `$.time.pause` + §44-политику, смерть ровно один раз, рестарт возвращает числа к исходным (узлы 15/тела 10/подписки 1/таймеры 2/области 2) |
| §31-2 Melee/contact | **закрыт** | `demos/melee` + `melee_test.py` (44): удар по окну анимации, три hurtbox → один удар, отражение снаряда, отдача в стену, feedback не влияет на урон |
| §31-6 Runtime integration | **закрыт** | `demos/showcase` + `showcase_test.py` (56): RmlUi HUD, смена языка на ходу, вставка timeline с маркерами, слои музыки, scoped переход с persistent HUD |
| §31 «работают из пакета» | **проверяется машиной** | `tests/demos_examples_test.py`: у всех семи примеров есть project.json, точка входа, README, приёмочная проверка и описание в docs/demos.md; каждый запускается движком `--headless` без ошибок игрового кода |
| §31-7 Recovery | **закрыт** | `demos/recovery` + `recovery_test.py` (66): битый слот → восстановление из `.bak`, битый ассет → `ok:false` с кодом и живая игра, safe reload после починки, replay divergence с первым расходящимся тиком, чистый прогон без расхождения |
| §31-5 Lit sprites | **закрыт** | `demos/litsprites` + `litsprites_test.py` (25): яркость на свету/в тени, маски источников, динамический occluder, скрытый occluder не заслоняет, UI не темнеет, atlas-флипы без протечки |
| §31-4 Generated rooms | **закрыт** | `demos/roguerooms` + `roguerooms_test.py` (52): seed → hash, validation до публикации, бюджеты с жёсткими лимитами, checkpoint/restore с отменой генерации |
| §31-1 Platform foundations | **закрыт** | `demos/foundations` + `README`, `tests/agent/foundations_test.py` (25 проверок) |
| §39 local/world transforms | **закрыт** | `transformSpace/localAt/localAngle/localScale/worldPoint/localPoint/worldTransform`, нативный пакетный проход + JS-резерв, reparent keep-world/keep-local; `tests/js/transforms_test.mjs` (21), `highlevel_transforms_test.py` (62) |
| §40 независимые sensors и enable | **закрыт** | `.area/.areaOn/.areas/.areaOverlap`, native `setShapeEnabled/setShape/shapeOverlaps`, routing `areaA/roleA/ownerA`; форма вне физики и запросов без потери владельца, index переживает пересборку |
| §41 multi-target tracks | **закрыт** | `tests/js/anim_tracks_test.mjs` (50), `tests/agent/highlevel_animtracks_test.py` (53): клип ведёт кадры, оружие, shape.enabled, emitter, UI и SFX; seek предпросмотра урона не наносит |
| §10 tracks/markers | **закрыт** (в объёме §41) | маркеры с ID и policy, gameplay-окна, прерывание закрывает окно |
| §16 UI/HUD/i18n/timeline | **закрыт** | `$.ui.persist/transient` (постоянный HUD переживает смену сцены — раньше он умирал на первой же), модальность через контекст `ui.modal` + `inputBlocked()`, локализация на ходу с явным fallback (`i18n.missing/mark/number`), привязки данных с пропуском неизменных кадров, timeline-маркеры и контракт возврата `state().restored`; `highlevel_ui_contract_test.py` (76). Честно: вёрстку RmlUi при resize движок не перекладывает, HiDPI как политика не проверялся, языки — ru/en |
| §23 комнаты/tilemap/prefab data | **закрыт** | `$.room`: validateRoom до создания узлов → staging-область → публикация на границе кадра; комната регистрируется сценой `room:<id>`; визуал+коллизия+occluders из одних данных; инкрементальная пересборка тел по геометрии (`dirty_cells/created/reused/destroyed`); `room_transaction_test.py` (31): неудачная загрузка не меняет мир, 10 смен комнаты без роста счётчиков, ошибки `R2D_ROOM_*` в `$.debug.errors()`. Честно: стриминга внутри комнаты нет, `$.room` не редактирует данные, fade заказывается явно |
| §42 partial tile collision | **закрыт** | дескриптор `tiles` (shape/visual/occluder/masks), logical origin + pad, `fail`-политика лимита тел; `tests/js/tilemap_test.mjs` (35), `tests/agent/highlevel_tile_geometry_test.py` (67), замеры в docs/highlevel/tilemap.md §6 |
| §43 seeded simplex | **закрыт** | `$.random.simplex2D/noise/fbm2D/hashCells`, `tests/js/simplex_noise_test.mjs` (21), `highlevel_random_test.py` (34), эталоны `tests/fixtures/generation_noise` |
| §26 RNG state (часть random) | **закрыт** (интерфейс готов) | `$.random.state/restore/validateState/stream`; потребители save/replay — пакет W2-C |
| §30/§37 профиль 2D | **проверяется машиной** | `tests/profile_2d_test.py`: OFF-сборка поднимает `$`, запускает игру и примеры, отдаёт все подсистемы 2D-профиля, не содержит authoring-подсистем 3D и не пишет ошибок; запускается при релизе |
| §33 состав данных | **проверяется машиной** | `docs/FORMATS.md` + `tests/format_extensions_test.py`: для каждого расширения названо место в коде; незаявленное (страницы атласа, полный материал, музыка) помечено как «не заявляется», а не выдано за реализованное |
| сборка: разбор модулей | **проверяется машиной** | `tests/parse_all_test.py`: все модули и точки входа разбираются тем же QuickJS, что и в игре (ловит то, что пропускает `node --check`) |
| сборка: встраивание скриптов | **проверяется машиной** | `tests/embed_sync_test.py`: встроенный бандл побайтово равен исходникам; ловит случай «исходники целы, а движок падает на старте» (был реальным) |
| §35 программа приёмки | **проверяется машиной** | `tests/acceptance_test.py`: 35.1 доказательства по классам сценариев, 35.2 отчёт замера с конфигурацией (commit, backend, разрешение, counts, p50/p95/p99, CPU-зоны, GPU-время) и gate p95 ≤ 16,67 мс, 35.3 ревизия/команда/факт; запускается перед релизом |
| §37 checklist | **проверяется машиной** | `tests/checklist_test.py`: архитектурные обязательства §1.1/§36, доказательство для каждого P0-пункта, README у примеров, трассируемость плана; ожидающие пункты помечаются явно, а не «зеленеют» по умолчанию |
| §31-2 stress-стенд §35.2 | **закрыт** (стенд) | `demos/stress` (6 сцен, 200 тел / 500 снарядов / 5 000 частиц / 32 света / карта 200×100), `tools/bench_stress.py`, отчёт `build/stress-on.json` |
| §6 часы/pause/hit-stop | **закрыт** | фиксированный шаг: `engine.dt` = fixedDt, приращения времени одинаковы (разброс 0.00e+00), движение = скорость × шаг (отклонение 1.7e-05), камера едет 3.3333 px/кадр без дёрганья (`highlevel_camera_fixedstep_test`); hit-stop замораживает время (`highlevel_feel_test`), фазы кадра документированы (`frame_phases_test`) |
| §5/13 lifecycle и cleanup | **закрыт** (документация в очереди) | scope active→closing→closed, prepare→commit, scoped-подписки/таймеры/задачи; числа: 100 restart/load — nodes 12→12, bodies 10→10, subs 1→1, timers 2→2, flows 2→2; `lifecycle_numbers_test.py` (44) |
| §7/8/9 контакты, контроллер, damage | **закрыт** | края, ступени, потолок, склон, one-way, движущиеся платформы (`highlevel_controls_test`), контакты и queries при удалении форм (`highlevel_contact_test`), окна атаки и дедупликация урона (`highlevel_combat_contract_test`) |
| §10/14/26 save/RNG/replay | **закрыт** | формат слота v3 (profile/run/room/presentation), restore по `nid` с prepare→commit, `.bak`/`recover`, отказ слота будущей версии без перезаписи; replay v2 с engine/content/seed/streams и divergence по первому тику; `highlevel_save_test` (101), `save_restore_test` (68), `replay_test.mjs` (19) |
| §15 input contexts | **закрыт** (без физического геймпада) | контексты с приоритетом, глобальный `consume`, конфликты/эталон/сохранение привязок, захват с отменой и таймаутом, политика слотов, подписи, оси с гистерезисом, виртуальный ввод; `highlevel_input_contexts_test.py` (25) + `tests/js/input_contexts_test.mjs` (10) |
| §44 обработка и тики | **закрыт** | политики `update/fixed/animation/timers/physics` с наследованием от scope, `$.activation.watch` (screen/region, margin+hysteresis, камеры, once), счётчик тиков отдельно от кадров; `highlevel_activation_test` (42), `highlevel_triggers_test` (32); числа: 120 тиков за 59/119/288 кадров |
| §45 загрузка и progress | **закрыт** | `$.loading`/`$.resource` с прогрессом, ошибкой и отменой: тяжёлый PNG не блокирует анимацию загрузки, отмена и отказ видны машине; `highlevel_loading_test` + `tests/fixtures/loading`. Честно: GPU-upload, декод аудио и разбор JSON остаются на главном потоке; путь >127 символов может грузиться дважды |
| §46 экранный эффект | **закрыт** | `$.gfx.post({distort,wave_amp,wave_freq,wave_speed,wave_axis,noise_amount,noise_scale,channel_shift})` + пресеты `underwater`/`glitch`; `tests/agent/screenfx_test.py` (14), фикстура `tests/fixtures/screenfx`; нейтральный пост — тождество, resize и отсутствие feedback проверены |
| §47 particle параметры | **закрыт** | `p.clock` (simulation/presentation), seed + фиксированный шаг дают одинаковую эволюцию (`highlevel_particles_test`), `$.hits.reduced` и бюджет частиц замерены (`highlevel_particle_budget_test`); ограничения записаны рядом с API |
| §48 audio bus isolation | **закрыт** | `highlevel_audiobus_test`: звук чужой шины не пострадал, освобождённая шина исчезает из списка, dB↔gain симметричны (0.5 → -6.02 dB → 0.501), кадры идут после операций с шинами |
| §18 renderer presentation | **закрыт** | контракт порядка проходов в render.md §4.5, снаппинг/целочисленная шкала/материалы, `highlevel_presentation_test.py` (42) на фикстуре `render_presentation`, смена слоя не меняет логику (числа в отчёте) |
| §19 камера и комнаты | **закрыт** | `$.camera.zone/enter/leave/lease/release/control`: зона — данные поверх камеры, приоритет решает конфликт, аренда возвращает прежнюю конфигурацию и истекает по времени; `camera_zones_test.py` (18) на фикстуре двух комнат |
| §20.2 normal-карты | **закрыт измерением и объявленным fallback** | измерено: спрайтовая вершинная стадия без юниформов (20 Б/вершина: x,y,u,v,rgba), свет — один аддитивный композит в текстуре 640×360, поэтому (а) до 29.5 млн «источник↔пиксель» на кадр и (б) размытие смешивает каналы. Выбран вариант (в): `$.gfx.normalPath()` отдаёт `{supported:false, reason:'sprite_stage_has_no_normal_input', fallback:'flat_normal', required:[...]}`, `perPixelNormal(true)` не включает режим, а объясняет причину. Приёмка изображениями: `node_normal_map_test.py` (18) — лампа слева/справа зеркалит градиент (89.8/60.0), материал с normal = базовый (60,58,58), trimmed кадр не смещает свет, тень следует за occluder (34.0 → 91.8). Замер до/после: p95 8.348 → 8.345 мс, GPU 1.817 → 1.660 мс |
| §20.1 маска получателя света | **закрыт** | измерено: N композитов по слоям = N × 0.030 мс и всё равно требует маску получателя, поэтому выбран проход маски (только если в кадре есть узел с маской) + гейт `(receiver & layer) != 0` при накоплении света. Вершина 20 → 24 Б (+2.9 КБ/кадр в стресс-сцене против 0.88 МБ геометрии света). Публично: `.lightMask(bits)`, `.lightLayer(bits)`, `$.gfx.light.layer(bits)`, `$.gfx.light.maskPath()`. Приёмка `light_receiver_mask_test.py` (22): получатель слоя 1 освещён 194.9 и не освещён 169.3 при слое 2, обмен масок зеркален, без масок `maskPasses == 0`, fallback возвращает прежние 219.9/219.5. Замером найдены и исправлены 4 дефекта (`.lit(false)` получал свет поверх себя: 255 вместо 169.3; неосвещённый слой рисовался конвейером композита; юниформы шейдера узла затирались параметрами стадии; затенение `mode`). p95 8.35 → 8.35–8.36 мс, бюджет §35 не затронут |
| §20 свет и материалы | **закрыт** (кроме попиксельных normal-карт) | профиль качества с измеренной деградацией, маски, динамический occluder (найден и исправлен баг: свои препятствия узла не участвовали в лучах), `.lit(false)`, инвалидация по области; `highlevel_light_limits_test.py` (46). Честно: попиксельный normal-проход требует второго сэмплера и нового прохода — данные материалов готовы, влияние нормалей не заявлено |
| §21 particles/VFX бюджеты | **закрыт** | `clock: 'presentation'\|'simulation'` по эмиттеру, событие `particlesEnd`, жёсткие пределы и pool, `$.hits.reduced()` (presentation-only); `highlevel_particle_budget_test.py` (18): 400 ударов → узлы 12→12, эмиттеры 9→9, reduced 14→1 частиц при том же уроне |
| §22 атласы | **закрыт** | страницы/пути относительно JSON, мипмапы только при padding+extrusion (иначе протечка), import-манифест с версией и импортёром, 11 кодов ошибок и 5 предупреждений в `$.atlas.verify()`, отказ на повёрнутый кадр; `atlas_test.mjs` (17) + `highlevel_atlas_test.py` (28) |
| §25 audio stems | не начато | PCM/transport timestamps |
| §27 hot reload | **закрыт** | `$.reload` (watch/reload/poll/versions/graph/order/behavior/restartScene): read→validate→prepare→apply, last-known-good с кодами `R2D_RELOAD_*`, граф зависимостей и топологический порядок, отложенное освобождение handles после кадра; 100 reload — счётчики без изменений; `highlevel_reload_test.py` (58) + `reload_test.mjs` (15). Ограничения: смена размера текстуры и внешний `.rcss` отклоняются/предупреждают |
| §28 debug/profiling | **закрыт** (P0) | `$.trace.hit/hits` — цепочка attack → combat:filter → damage → death по hit ID (включая ОТКАЗ с причиной), `$.debug.anatomy(sel)` (тело, области с ролями и индексами, опора, окна, политики), `$.debug.contacts()` (фаза, нормаль, роли), профиль машиночитаем и честен про GPU; `debug_diagnostics_test.py` (24) |
| §29 SDK panels | **закрыт** | `sdk_tools_panels_test` (126): у девяти инструментов валидация через ТОТ ЖЕ backend, что CLI, коды равны CLI на одном файле, preview-путь совпадает с проверенным, undo/redo не теряется; `sdk_validation_test` (11 типов + манифест/сессия/ссылка звука) и `sdk_preview_parity_test` |
| §30 packaging/CI | **закрыт с объявленными ограничениями** | упаковка, CI и 5 платформенных автосборок работают, установка и перенос проверены в поставке (`dist/*`, `docs/BUILD.md`). Честно и явно: рекурсивного разрешения зависимостей АССЕТОВ из цепочки import нет (`--add` перечисляет их сам — осознанно, см. docs/BUILD.md: эвристика «любая строка похожа на путь» включала бы в груз мусор и ломала корректные сборки); путь Docker не прогонялся в этой среде; установка на чистую систему не воспроизводилась |
| §31 docs и вертикальные примеры | **закрыт** | семь примеров §31 с приёмочными тестами и описанием в docs/demos.md; `demos_examples_test` запускает каждый движком из дерева и проверяет структуру проекта |
