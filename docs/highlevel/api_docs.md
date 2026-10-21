# Метаданные справки `$` API

`src/highlevel/api_docs.js` подключает каталог справки к экземпляру `$` во
внутреннем неперечисляемом реестре. Эти поля служат подсказкам Editor и не
становятся игровыми методами.

`installApiDocs($)` создаёт копию каталога для проекта. `documentApiSymbol($,
path, metadata)` добавляет описание символа, а `documentApiMethod($, path, fn,
metadata)` регистрирует справку и возвращает ту же функцию без изменения её
поведения.

Каталог `src/highlevel/api_docs_catalog.js` — сгенерированный артефакт. Исходные
описания находятся рядом с `$` API и в `docs/highlevel/api_symbol_descriptions.json`;
обновление выполняется командой `python3 scripts/generate_api_docs_catalog.py`.
Синхронность имён проверяют `tests/api_docs_sync_test.py` и
`tests/js/api_docs_test.mjs`.

Эти модули обслуживают справку редактора; они не открывают дополнительный
публичный namespace игры и не меняют контракт `$`.
