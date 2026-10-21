# Каталог справки `$` API

`src/highlevel/api_docs_catalog.js` генерируется из описаний API и содержит
сигнатуры, имена аргументов и краткие пояснения для подсказок Editor.

Не редактируйте каталог вручную: измените JSDoc рядом с реализацией API или
описание в `docs/highlevel/api_symbol_descriptions.json`, затем запустите
`python3 scripts/generate_api_docs_catalog.py`.

Каталог подключает модуль [`api_docs.js`](api_docs.md). Проверка генератора и
регистрация справки покрыты `tests/js/api_docs_test.mjs`; согласованность
публичных имён с документацией проверяет `tests/api_docs_sync_test.py`.

Метаданные используются редактором кода и не являются частью игрового API.
