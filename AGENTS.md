# Russiano2D Agent Rules

Движок и игры проекта — **2D/2.5D только**. Не добавляй ECS, альтернативный scene
graph, собственный event bus, asset loader, physics/audio-абстракции или
«менеджеры ради менеджеров». Публичный API — это `$` API; сначала проверь его,
потом пиши игру. Runtime (`russiano2d`) не зависит от SDK (`r2d-sdk`).

## Перед реализацией игровой функциональности

1. Проверь сгенерированную API schema (`api.schema.json`) и API docs.
2. Проверь существующие recipes/examples.
3. Переиспользуй движковые возможности; не дублируй подсистемы.
4. Не пиши второй движок внутри игры.
5. Запусти `r2d-sdk lint` на изменённых скриптах.
6. Запусти `r2d-sdk validate` на проекте.
7. Исправь диагностику до того, как считать задачу готовой.

## Сборка и проверки

```bash
cmake --build build -j 8
cmake --build build --target r2d_check -j 8
python3 tools/ci_verify.py --build-dir build
python3 tests/doc_claims_test.py && python3 tests/doc_coverage_test.py && \
python3 tests/api_docs_sync_test.py && python3 tests/api_freeze_test.py
```

- Runtime: `./build/russiano2d --game <dir> --scene <name>`.
- SDK CLI: `./build/r2d-sdk <command>` (единственный backend для CLI, GUI и агентов).
- GUI SDK: `./build/russiano2d --game sdk` / `./run_sdk.sh`; GUI вызывает native
  операции, а не реализует второй линтер/валидатор.
- Документация: `docs/` — human docs; generated API reference не править руками.
- `dist/` — релизный пакет; не создавать параллельные бинарники и не менять его
  структуру без релизного инструмента.

## Диагностика

Ошибки — со стабильными кодами (`R2D001`, `SDK_*`, ...) и machine-readable
`--json`, пригодным для GUI/CI/агентов. Никаких молчаливых fallback'ов.
