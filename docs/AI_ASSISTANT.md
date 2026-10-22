# R2D Assistant — план реализации V1

Статус: **фаза 0 (аудит и план)**. Кода ассистента ещё нет; ничего ниже не заявлено как готовое.

## Окружение (замерено 2026-10-22)

| Что | Значение |
|-----|----------|
| Машина | Apple M4, 16 ГБ ОЗУ, ~30 ГБ свободно на диске |
| llama.cpp | `brew install llama.cpp` 0.7.0 (`llama-embedding`, `llama-cli`, `llama-server`, `llama-quantize`) — для бенчмарков; в движок — xmake-пакет `llama.cpp-3775` |
| SQLite | xmake `sqlite3` 3.54 |
| Python | numpy есть; torch/transformers/peft **нет** (нужны только для обучения, в облаке) |

## Корпус (что индексируем)

* `docs/**/*.md` (публичные; `tools/public_docs.py`), `docs/highlevel/*.md`
* `api.schema.json` — 4111 имён `$`-API (путь, kind, описание, arity, args)
* `snippets/*/snippet.json` + `src/*.js` + README
* `demos/**/*.js`, `templates/**`, `tests/agent/*.py` (примеры использования)
* `russiano2d.d.ts`

Чанкер учитывает тип: markdown — по заголовкам; JS — по функциям/`export`; API — одна запись на имя; JSON — по ключам верхнего уровня. Каждый чанк: `source`, `kind`, `lang` (ru/en), `title`, `content_hash`.

## Архитектура

```
src/ai/            C: llama.cpp embeddings, SQLite-индекс, brute-force cosine, гибридный поиск
sdk/native/sdk_ai.c  r2d ai index|reindex|search|ask|stats|benchmark   (JSON в stdout)
tools/ai/          Python: корпус, датасет, обучение LoRA/QLoRA, eval, merge, GGUF export
editor/            панель Assistant (RmlUi), вызывает native `r2d ai`
models/            GGUF ставятся отдельно (dist/models/), в бинарник не встраиваются
```

* Индекс инкрементальный по `content_hash`; БД: `chunks(id, source, kind, lang, title, text, hash)`, `vectors(chunk_id, dim, blob)`.
* Поиск: BM25-подобный лексический (SQLite FTS5) + косинус по эмбеддингам, слияние RRF; `--debug` печатает вклад каждой ветки.
* Валидатор галлюцинаций: каждый `$.…`-путь из ответа проверяется по `api.schema.json`; неизвестный → диагностика + ближайшие имена.

## Выбор моделей — только по замеру

Кандидаты (проверить бенчмарком на RU/EN-вопросах по R2D, метрики recall@k / MRR / латентность / ОЗУ):

* embedding: `bge-m3` (мультиязычный), `multilingual-e5-small/base`, `Qwen3-Embedding-0.6B`, `nomic-embed-text-v2`
* generative (GGUF Q4/Q5): `Qwen2.5-Coder-1.5B/3B-Instruct`, `Qwen3-1.7B/4B`, `Llama-3.2-3B`, `gemma-3-1b`

Скачивание весов — по согласованию (размеры ниже в отчёте бенчмарка).

## Обучение

Только инструментарий: `tools/ai/` + `docs/AI_TRAINING_CLOUDRU.md`. Cloud.ru — чистые вычисления; ключи только из переменных окружения, в репозиторий и логи не попадают; запуск и стоимость подтверждает пользователь. **Пока обучение не запускалось, ни одна метрика «дообученной» модели не заявляется.**

## Фазы

0 аудит/план · 1 корпус · 2 чанкер · 3 SQLite-индекс · 4 llama.cpp-эмбеддинги · 5 гибридный поиск · 6 CLI `r2d ai` · 7 бенчмарк эмбеддингов · 8 бенчмарк генеративных · 9 RAG-ответы · 10 валидатор API · 11 датасет · 12 train-тулинг · 13 eval · 14 merge/GGUF · 15 Editor-панель · 16 тесты · 17 доки/уборка.
