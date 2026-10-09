# SDK: проверенное состояние и ограничения

Сверка 2026-10-09, macOS arm64/Metal, CMake Release. Команды и возможности —
[SDK.md](SDK.md), журнал и история проверок — [SDK_HANDOFF.md](../SDK_HANDOFF.md).

## Автоматические проверки

- Полный agent suite: **116/116**, fail 0, skip 0, 301.3 с.
- **93 JS suites**, native SDK core **100 checks**; doc claims/coverage прошли.
- Новые проверки: runtime RmlUi UI 13, SDK archive 10, crash recovery 10,
  source/runtime comparison 6, Baker modes 9, игра 21.
- SDK archive распаковывается в отдельный каталог: CLI/GUI, 18 инструментов,
  четыре шаблона, new/run/build и самостоятельная собранная игра проверены.
- Все 25 source/runtime ракурсов Baker проверены; comparison screenshot просмотрен.
- Recovery проверен аварийным завершением процесса, реальной кнопкой Restore,
  undo/redo/Save. Невидимый текст окна найден визуально и исправлен.
- Публикационный pipeline: actionlint, shell syntax, native/JS/batch на свежей
  macOS Release-сборке, временные Git зеркала с одним отказом, mock FTP prune/retry
  и пять заголовков CPU/platform. Несовпадение архитектуры не стирает старый пакет.

Это число наборов/проверок конкретных сценариев, а не доказательство полного
выполнения всего большого гайдлайна. Логи — build/sdk_completion_* и build/publish_*.

## Практическая игра

[Неоновый курьер](../games/neon-courier/README.md) создан через шаблон SDK,
Input Tools, Particle Studio и Run/Package. Использует публичный `$`, RmlUi,
обычные JSON/JS/RML/RCSS. Полный выигрышный маршрут воспроизводится клавишами;
упакованное меню нажимается мышью в пустом каталоге без проекта и SDK.

## Ограничения

FBX, кисти поверхности, графические кривые и автоматическая численная метрика
сравнения не реализованы. Skin — dominant rigid ownership; walk процедурный,
MToon lighting не переносится. Source-preview — C tool-only raster, справа
настоящий Re2DSprite runtime. World runtime не использует PVS, slopes ступенчатые.

В этой сессии VRM/GLB регрессии используют fixtures. Реальные Seed-san/GLB
из предыдущего этапа заново не скачивались и не выдаются за свежую проверку.
macOS append codesign выдавал strict validation warning: локальный запуск
работает, пригодная для распространения подпись игры не подтверждена.
Удалённый CI/пять Release assets подтверждаются только фактическим GitHub run;
результаты публикации записываются отдельно в handoff.
