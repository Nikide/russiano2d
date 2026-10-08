# Контрольная сверка репозитория

Дата: 2026-10-08, macOS arm64, CMake Release. Исходный HEAD `375ea03`,
рабочая копия до начала чистая. Проверка охватывает текущее дерево документации,
новый SDK, архитектурные границы, tracked-файлы, release archives и тестовые слои.
Это локальная проверка; remote CI и публикация не выполнялись.

## 1. Документация

- README теперь описывает SDK/Re2DSprite/World и отличает свежие исходники от
  готовых пакетов 0.1.22. Инструкция SDK использует реальную команду `commands`.
- TASKS/GAP_ANALYSIS очищены от закрытых дефектов и устаревших проектных
  набросков. Текущий backlog содержит только оставшиеся возможности/ограничения;
  история прежних аудитов доступна в Git.
- Закон UI сверён с текущим launcher/DevTools/SDK и native text renderer.
  Удалены старые списки якобы неиспользуемых RmlUi-файлов и ImGui-текста.
- Исправлены отрицания working IME preview, world picking и mouse modality,
  ложная потеря contact events на подшагах, старые сведения об IK/seek и BSP.
- RELEASING и CI archive описывают фактический remote `github` и version-tag
  GitHub workflow. Старые GitLab/GitVerse конфигурации — исторический архив.
- SDK commands, форматы и ограничения сверены с кодом/тестами. Полный acceptance
  фаз не означает завершение всей большой спецификации. Source↔Re2D comparison,
  optimized UV и прочие дальнейшие инструменты остаются в backlog.
- Исторические performance measurements сохранены с датами и статусом: их
  нельзя объявлять текущим замером. SDK_AUDIT остаётся явно историческим снимком.

## 2. Соответствие философии

| Закон | Фактический новый SDK / World |
|---|---|
| `$` — public runtime API | SDK JS использует `$`, toolHost включает existing `$.sdk`; engine спрятан |
| CODE + DATA | Открытые JSON/PNG/JS остаются источником; GUI не создаёт скрытый обязательный project format |
| Весь новый UI — RmlUi | SDK/DevTools/launcher используют RmlUi; новых ImGui-окон нет |
| C — тяжёлая работа, JS — оркестрация | Native validation/bake/world compile/batch/agent в `sdk/native`; Python только development tests/tools |
| Existing runtime вместо дубликата | Preview использует `$.re2dSprite` / `$.re2d.world`; agent сохраняет исходный протокол |
| Spatial description → ordinary 2D | World синтезирует RGBA и передаёт обычный sprite в существующий 2D batch |
| Совместимость и воспроизводимость | Legacy пути сохранены, fixed-step/seed и parity tests проходят |
| Только известные факты | Diagnostics и reports структурированы; ограничения PVS/slopes/ownership указаны явно |

Нового отхода от этих принципов в SDK не обнаружено. Существующий ImGui-оверлей
и legacy node UI остаются переходным техническим долгом. Они не объявлены
целевой архитектурой. Формулировка философии уточнена: SDK-редактор открытых
данных допустим в уже заданном code/data-first подходе; канонический редактор
сцен со своим scene graph и обязательным проектным состоянием не вводится.

## 3. Очистка

Удалены tracked `.DS_Store`, временный `_tmp_apid.mjs`, runtime save/log,
Python caches и disposable `build-autobuild`, `build-release`, `build-ci`.
Освобождено около 3,4 ГБ. Рабочий build, Web dependencies, сайт и его доступы,
исходники, тестовые fixtures и запрошенный справочный deliverable сохранены.
Справочный deliverable — исторический срез, не текущий executable release.

В трёх `dist` archives удалены `.DS_Store`; внутренние manifests и внешние
контрольные суммы пересчитаны. **Все остальные payload files побайтно совпадают**
с версиями архивов до очистки: 36 Linux, 33 macOS, 29 Windows файлов.
Версия и executable payload не менялись. `tools/release.py` теперь исключает
OS/Python caches и local SDK state при копировании данных в будущий пакет.

## 4. Проверки

- Сборка прошла.
- Полный agent integration run: **106 ok, 0 fail, 0 skip**, 245,6 с.
- **91 JS suite** прошёл через bundled qjs.
- Все **10 native engine test executables** и **SDK core** прошли.
- Docs claims/coverage, duplicate keys и **16 docs-gate tests** прошли.
- Новый `tests/repository_hygiene_test.py`: tracked hygiene, существование local
  Markdown targets, package checksums, manifests внутри archives и отсутствие
  системного мусора. Он не проверяет remote URL или Markdown anchors.
- Реальный local `release.py --package-only` в игнорируемый build прошёл:
  macOS libraries, platform docs, archive и checksums. Это проверка packager,
  а не публикация нового релиза или доказательство готового SDK package.
- Сайт локально пересобран из docs: 136 документов, 7 картинок, без сообщений
  о недостающих документах. В локальном ignored builder добавлена страница
  ci-archive; она не публиковалась. Сводный AGENTS.md создан в build (117 документов).
  `site/` сохраняет существующую политику вне Git.
- `git diff --check` пройден.

`ctest` сообщает **No tests were found**: это не считается проверкой.
Нативные executable targets были запущены напрямую. Визуальная проверка SDK
в предыдущем завершённом срезе описана в [SDK_VERIFICATION.md](SDK_VERIFICATION.md);
в этом проходе runtime/UI не менялись, поэтому старые shots не выдаются за новые.

Логи этого прохода — игнорируемые `build/control_*.log`.

## 5. Оставшиеся ограничения

Готовые пакеты 0.1.22 не содержат новый SDK; packager пока не включает SDK
application/CLI/registry. Это честно вынесено в [TASKS.md](TASKS.md) §5.
Runtime PVS/portals отсутствуют, slopes ступенчатые, character ownership жёсткий,
bake имеет sampling seams, walk процедурный, MToon lighting не воспроизводится.
Эти ограничения не спрятаны статусом IMPLEMENTED. Подробности — [SDK.md](SDK.md),
[RE2D_WORLD_AUDIT.md](RE2D_WORLD_AUDIT.md).
