# Проверки проекта

Сборка и нативные тестовые цели проекта управляются Xmake. Неиспользуемые
CMake build files и CMake-проверки удалены.

## Сборка

```bash
xmake f -p macosx -a arm64 -m release -o build-xmake/macos-arm64
xmake build -y -j 8 r2d
export R2D_BINARY=build-xmake/macos-arm64/macosx/arm64/release/r2d
```

На другой платформе укажите её Xmake platform/architecture и фактический путь
собранного бинарника.

## Нативные и JS тесты

Тестовые C-цели определены в [xmake/tests.lua](../xmake/tests.lua). Запуск:

```bash
xmake test -y -j 8
```

В сборку также входят JS unit-тесты (`tests/js/*_test.mjs`). Интеграционные
сценарии запускайте адресно через единый движок:

```bash
R2D_BINARY="$R2D_BINARY" python3 tests/agent/<name>_test.py
```

Они открывают реальные проекты в headless/agent режиме, поэтому проверяют
runtime-поведение, а не только компиляцию тестового исполняемого файла.

## Проверки API и Editor

```bash
python3 tests/doc_claims_test.py
python3 tests/doc_coverage_test.py
python3 tests/api_docs_sync_test.py
"$R2D_BINARY" lint editor --json
"$R2D_BINARY" validate editor --json
```

Изменения Editor следует дополнительно проверять подходящими тестами из
`tests/agent/editor_*_test.py`. Статус сборки сам по себе не доказывает, что
Editor корректно открывает проект или сохраняет документы.

## Примечание о старых инструкциях

Исторические планы и отчёты могли фиксировать команды и результаты старой
CMake-конфигурации. Их результаты не являются инструкциями для текущей
сборки; используйте `xmake.lua`, `xmake/tests.lua` и `R2D_BINARY`.
