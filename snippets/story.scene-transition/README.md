# Переход сюжетной сцены

По событию — затемнение и $.scene.load следующей сцены (или $.story.play сценария).

Поля:

- `event` (string) — Событие
- `scene` (string) — Сцена
- `script` (string) — Или сценарий story
- `fade` (int) — Затемнение

## Изменения 1.0.1

Штатный scene transition и RmlUi затемнение story с owner-scoped cleanup.
Схема полей совместима с 1.0.0; миграция значений не требуется.
Проверки приёмки — `docs/SNIPPET_PROGRESS.md` в репозитории движка.
