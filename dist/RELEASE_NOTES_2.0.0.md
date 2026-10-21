# Russiano2D 2.0.0 — 2026-10-22

84 коммита в релизе.

### Исправления

- Сниппеты: patch версии и changelog 23 исправленных пакетов (`d3a8acf3a`)
- Жанровые проекты через Editor: 7 жанров, скриншоты, область world:editor (`65a82da61`)
- fix(camera): $.camera.isOnScreen принимает обёртку $(...) (`cd3c799ba`)
- Сниппеты: разделы A и B (34 пакета) — сущности, профили, движение (`fb0c1fcff`)
- r2d snippet: manifest, каталог, editor.snippets и детерминированный генератор (`af7a4d1ae`)
- editor: редактор кода ближе к VS Code (`87a409db7`)

### Добавлено

- Сниппеты: 19 новых механик, наборы без пробелов, функциональный тест (`2cef196ed`)
- ТЗ сниппетов: нормализация §12 — 19 дублей заменены недостающими механиками (`0799bb191`)
- Сниппеты: объект из Editor и автор пакета проекта (`2b805e321`)
- Editor: панель «Кирпичики» (каталог, Inspector полей, генерация) (`66a4c67b1`)
- input: altDown() и имена alt/lalt/ralt работают на macOS (клавиша Option) (`dcf2575bf`)
- feat(fs,editor): system folder/file dialogs everywhere the Editor asks for a path (`5b4473dd0`)

### Удалено и изменено

- $.updateFor(node, fn): покадровая подписка, принадлежащая узлу (`ae5541cae`)

### Документация

- Сниппеты: итоговая приёмка §19, co-op authority и визуальные доказательства (`04c45200d`)
- Сниппеты: разделы T, U, V–Y — каталог 500/500 (`df7ea9587`)
- Сниппеты: разделы R, S (40 пакетов) — HUD на RmlUi, сохранения, настройки, доступность (`950654b8b`)
- fix(editor): project graph as a bottom-panel tab, settings and JSON fixes (`c4d6e4392`)

### Тесты и гейты

- Сниппеты: кэш сущности по селектору в 67 пакетах (как ai.chase) (`c644c2d67`)
- Сниппеты: разделы O, P, Q (56 пакетов) — камера, экран, анимация, звук, обратная связь (`da98758e2`)
- Сниппеты: разделы C, D, E (46 пакетов) — оружие, здоровье и статусы, ИИ (`935edb4f7`)
- $ API: .flip() без аргументов возвращает { x, y } (`30b37d1f3`)
- $ API: .damage(amount, source, type), .damageFilter(fn) и событие 'damaged' (`21407b4d8`)
- Сниппеты: владение generated (own code|generator), откат project.json, проверка Build (`008e34e4e`)
- Сниппеты: оружие и зона — weapon.base/hitscan/projectile/melee, trigger.base, kit.top-down-shooter (`6cd83b48c`)
- Каталог сниппетов: ID по разделу 12 ТЗ, 22 пакета, runtime-тест каталога (`82aff362f`)

### Сборка и версии

- sdk_api: справка всегда печатает имена и типы аргументов; без двойной записи API_REFERENCE (`7d2341046`)
- r2d snippet update: декларативные миграции значений между версиями пакета (`8168e1930`)
- build: drop CMake, build and package with xmake only (`b6f19bda4`)
- docs(agents): prohibit CMake and require xmake for all builds (`fdf042ed2`)

### Прочее

- merge (`c1ff2602f`)
- Сниппеты: RmlUi без world UI, resource cues и полная gap matrix (`4f4017f77`)
- Сниппеты: рабочие VN callbacks и здоровье JRPG, приёмка семи жанров (`cedd1908d`)
- Кирпичики: безопасное preview, kit authoring и проверенный RmlUi UX (`344418473`)
- Сниппеты: xmake каталог, границы всех полей и функциональные разделы (`2249c5357`)
- Сниппеты: кэш цели в оставшихся 14 nearPress пакетах (`7019006f4`)
- docs: передача системы сниппетов Codex (HANDOFF_CODEX.md, ссылка в AGENTS.md) (`7ba23f83d`)
- docs: SNIPPET_PROGRESS — с чего продолжать (`f295b318d`)
- docs: SNIPPET_PROGRESS — миграции, жанры, производительность (`79d3a57c8`)
- Производительность сниппетов: замер и оптимизации (8.55 → 2.65 мс на 500) (`97a64b7f8`)
- docs: SNIPPET_PROGRESS — нормализация §12, отмена/фильтр (`ce88c31a2`)
- Кирпичики: фильтр категорий и многошаговая отмена/повтор (`0f4c8012d`)
- docs: SNIPPET_PROGRESS — каталог 500/500, пробелы §12, следующие шаги (`9648ca6ed`)
- snippet_matrix: механики вне §12 у наборов — в колонке пробелов (`4f92258ac`)
- r2d snippet: якорь #__snippets для project, SNIP083/SNIP084, раскрытие наборов (`7f2092d28`)
- r2d snippet: SNIP104 — вызов несуществующего $.… (`3b135f6bb`)
- docs: SNIPPET_PROGRESS — 287/500 и следующие шаги (`a44e76501`)
- Сниппеты: разделы K, L, M, N (80 пакетов) — задания, диалоги и сюжет, головоломки, мир (`077c68bf8`)
- docs: SNIPPET_PROGRESS — 207/500, API-изменения (`b08bc9ed8`)
- Сниппеты: разделы F, G, H, I, J (99 пакетов) (`72cc37b95`)
- r2d snippet: SNIP103 (вызов $.… без requires) и зарезервированные id полей (`f4b6d2913`)
- docs: SNIPPET_PROGRESS — матрица, entity/new, оружие, own/rollback (`a223487fb`)
- Матрица 500 пакетов (§20.2): scripts/snippet_matrix.py → docs/SNIPPET_MATRIX.md (`0f597d567`)
- docs: SNIPPET_PROGRESS.md — чек-лист ТЗ сниппетов (`037049f03`)
- tests: обновлены результаты бенчмарка huge_scaling после полного прогона (`d06944b69`)
- engine, docs, demos and tests: pending updates (`6dbff3e0b`)
- editor: studio and UI updates on the shared studio kit (`3e6362b6a`)
- sdk: remove the legacy SDK app libs, templates and UI (`6fb7dbba6`)
- feat(project): project.json schema 2 and editor project graph (`cdf707285`)
- feat(editor): clearer start screen for opening and creating projects (`cbb8e3f1b`)
- feat(project): project.json v2 — entry, scenes index, file roles (`6eb63a0fb`)
- refactor(editor): drop the SDK studio bridge; every tab is a native studio (`7293a534e`)
- feat(editor): native RmlUi studio with live draft preview and pick-in-preview (`e2086ed44`)
- feat(editor): rewrite Re2DSprite as a per-tab Editor studio with history (`2e00bf4f7`)
- feat(editor): native Input studio; all data studios leave the SDK bridge (`2399aa7e3`)
- feat(editor): native Audio studio with runtime mixer and zone map (`e291de0d6`)
- feat(editor): native Fonts studio with runtime specimen (`d30ea728f`)
- feat(editor): native Parallax studio with in-preview sprite editing (`572075b6f`)
- feat(editor): native Collision studio with mouse shape editing and physics (`537a690bd`)
- feat(editor): native Particles studio with ramp graph and live emitter (`3739a712d`)
- feat(editor): native Tilemap studio on the asset workspace (`4354dccac`)
- test(editor): wait for SpriteMesh tab to finish opening before Save (`3ce4ed877`)
- fix(editor): save legacy studio tabs and never drop unsaved group tabs (`e911278b8`)
- wip(editor): preserve new asset workspace draft and Claude handoff (`19d5a8f86`)
- feat(editor): integrate Re2D World authoring into Hammer (`634fba2c6`)
- feat(world-edit): add transactional cell-world authoring operations (`1cd359f97`)
- docs(editor): clarify existing Re2DSprite integration and remaining studios (`3de3b62b6`)
- refactor(editor): migrate SpriteMesh to independent native studio tabs (`ac759b85f`)
- fix(sprite-mesh): preserve zero camera angles in projection (`b17ff19d0`)
- Move VN Maker onto per-tab editor studio lifecycle (`0f9490867`)
- Validate VN image paths separately from transition duration (`27d70007a`)
- Add lossless source editing model for VN studio (`c37e8a5a6`)
- Move Hammer onto per-tab editor studio lifecycle (`9e29dfbb1`)
- Sync editor API artifacts and xmake version with 1.3.2 (`69272fb9d`)
- Integrate editor and native tools into unified r2d binary (`5e77eca65`)
