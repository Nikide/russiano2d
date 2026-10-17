# SDK agent tooling — Phase 0 report

Источник: спецификация `R2D_SDK_AGENT_TOOLING_SPEC.md` (Phase 0: Documentation &
Repository Cleanup). Отчёт фиксирует фактически выполненное, а не план.

## Updated docs

- `AGENTS.md` — корневой файл правил для агентов (до Phase 0 отсутствовал в
  корне; в `dist/*/AGENTS.md` лежала только release-версия).
- `docs/SDK.md` проверен против текущего CLI `r2d-sdk` (команды, JSON-выход,
  GUI→native мост, тесты) — расхождений по перечню команд не найдено.
- `README.md`, `docs/HIGH_LEVEL_API.md`, `docs/highlevel/*`, `docs/TESTING.md`,
  `docs/BUILD.md`, `docs/AGENT_API.md` прогнаны существующими гейтами.

## Removed obsolete docs

- Устаревших/дублирующихся generated-артефактов API не найдено: до Phase 1 в
  репозитории нет `api.schema.json`/`.d.ts`, поэтому нечего было оставлять
  «канонический вариант».
- Служебные release-архивы `dist/*.tar.gz` и release notes оставлены как
  осознанная история релизов (не удалять).

## Removed service files

- `dist/.DS_Store` (отслеживался git).
- `dist/macos-arm64/.DS_Store` и другие `.DS_Store` внутри `dist/` (на диске,
  не отслеживались).
- `.DS_Store` в `witch_game/` (локальный каталог, не часть продукта).

## Updated ignore rules

`.gitignore` дополнен явными правилами `.DS_Store`, `*.old`, `*.bak`, `*.tmp`,
`*~` (раньше `.DS_Store` был только в IDE-блоке).

## Verification

```text
python3 tests/doc_claims_test.py     ok
python3 tests/doc_coverage_test.py   ok
python3 tests/api_docs_sync_test.py  ok
python3 tests/api_freeze_test.py     ok
```

Примеры из документации проверяются гейтами API-freeze/docs-sync; полный
автоматический прогон всех JS-блоков из всех `.md` пока не существует (это
Phase 7/CI, не Phase 0). Documentation claim tests — единственный текущий
механизм проверки примеров, и он зелёный.

## Remaining known documentation gaps

1. `dist/macos-arm64/` не содержит каталог `sdk/`, хотя `README.md` пакета его
   упоминает; `dist/macos-x86_64/sdk/` присутствует. Это расхождение
   release-пакета, а не root-документации; чинится пересборкой/обновлением dist
   релизным инструментом, не ручным копированием (иначе разъедется
   `SHA256SUMS.txt`).
2. `dist/` содержит релиз 1.2.4 и release notes 1.2.0–1.2.4; актуализация
   release notes — часть релизного процесса, не Phase 0.
3. Корневой `README.md` — витрина проекта, а не SDK reference; SDK-документация
   живёт в `docs/SDK.md`. Это осознанное разделение.
