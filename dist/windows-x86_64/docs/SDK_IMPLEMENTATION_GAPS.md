# Недостающие возможности SDK и Re2D

Обновлено 2026-10-10. Этот документ — очередь дальнейшей реализации.
[SDK_HANDOFF.md](../SDK_HANDOFF.md) хранит изменения, команды, результаты и
ошибки; здесь хранится то, что ещё нужно сделать, и условия приёмки.
Статусы: **проверено**, **в работе**, **запланировано**. Наличие исходников
или красивого кадра само по себе не переводит пункт в «проверено».

Архитектурные условия: [PHILOSOPHY.md](PHILOSOPHY.md),
[ARCHITECTURE.md](ARCHITECTURE.md),
[AGENT_IMPLEMENTATION_RULES.md](AGENT_IMPLEMENTATION_RULES.md).
Расширяем существующие нативные модули через C → `$`; игровой код и данные
остаются открытыми файлами. World использует XY и вертикальные интервалы,
анимация выводится существующим Re2DSprite. Gameplay использует существующие
узлы и компоненты; новая иерархия Actor, отдельная 3D-сцена и 3D-физика
не входят в эти задачи. Любой новый интерфейс SDK делается на RmlUi.

## Ближайший порядок работ

1. **Закрыть текущие дефекты Dust2 — в работе.** Сохранить воспроизводимые
   позиции камеры для каждого присланного дефекта; проверить углы стен,
   лестницы, края рамп и NPC. Мировые UV и линейная фильтрация уже написаны,
   но нужна отдельная проверка неизменности картинки при разбиении и развороте
   стены. Принять после конкретных регрессий, прохода маршрутов без провалов
   и просмотра кадров; общий успешный тест не закрывает все ракурсы.
2. **Завершить панорамное небо — в работе.** Пользовательский EXR читается
   нативным адаптером, его тесты прошли 7/7; реальные кадры CPU/GPU получены.
   Осталось отдельно проверить шов 360°, поворот, отсутствие параллакса при
   перемещении и сохранение закрытых потолков. Небо — выборка 2D-панорамы.
3. **Завершить Chicken Dance — в работе.** Нативный SDK уже выдал из
   предоставленного FBX клип 4.76666667 с, 144 отсчёта и 31 дорожку;
   кадр танцующей клубной тянки получен. Остались воспроизводимый повторный
   импорт, проверка поз на границе цикла и работающего автоматического
   воспроизведения. Runtime читает animation JSON; FBX нужен при импорте.
4. **Обобщить импорт анимаций — запланировано.** Пользовательская карта
   костей, разные исходные позы, выбор клипа, сохранение скручивания,
   кисти/пальцы, переходы между движениями и явный root motion. Текущий
   пресет для десяти костей маскота не считать универсальным импортом.
5. **Расширить акустику — запланировано.** Прохождение звука через
   материалы, огибание углов, отражения и реверберация комнаты; сглаживание
   по времени. Использовать ту же геометрию World. Текущие расстояние,
   прямая преграда и HRTF проверены отдельно: 9 DSP + 12 World проверок.
6. **Проверить поставку — запланировано.** Запустить установленный пакет
   вне рабочего дерева на macOS, Linux и Windows; проверить зависимости,
   EXR, импорт и HRTF. Наличие настроек сборки не доказывает работу пакета.

Для каждого нового пункта записывать: воспроизводимый пример, затронутый
существующий модуль/API, ожидаемое поведение, тест, реальный кадр или PCM
при необходимости, ограничения и результат проверки. Если потребуется
новый исходный риг для проверки ретаргетинга или материал для акустики,
фиксировать конкретный недостающий файл в handoff. Сейчас предоставленные
музыка, EXR и FBX доступны; текущая работа не требует дополнительных файлов
от пользователя.

## Технические ограничения и критерии приёмки

Дополнение 2026-10-10: крышки пяти коробок и их твёрдый объём проверены
нативными лучами/опорой и реальными кадрами CPU/GPU. Шаги и ветер используют
существующий World audio; проверены движение, остановка, прыжок и приглушение
ветра потолками (18/18 специальных проверок). Следующие улучшения: банк шагов
по материалу вместо выбранных снежных записей; различение намеренного запаса
воздуха над стенами и случайных дыр в диагностике SDK. Сейчас авторская карта
даёт79 предупреждений `SDK_WORLD_OPEN_EDGE` над наружными стенами; это не
ошибки компиляции, но утверждать «0 предупреждений» для неё нельзя.

Реализация NPC на карте Dust2 завершена в текущем узком объёме: три
предоставленных Mixamo-совместимых стека импортируются в animation JSON;
сближение запускает голос, RmlUi-реплику и чередование трёх клипов. Штатные
`headYaw`/`bodyYaw` controls ограничивают поворот головы и передают остаток
корпусу. Новые риги и карта кости остаются отдельными будущими возможностями.

This is an evidence-based backlog, not a claim that every plan is implemented. Current code/data and specific acceptance tests remain authoritative. Last updated 2026-10-10; active work is tracked in SDK_HANDOFF.md.

| Area | Current implementation / active work | Remaining capability | Acceptance criterion |
|---|---|---|---|
| Re2D World audio | Existing SDL_mixer, positioned sources, native distance and direct-ray wall/ceiling/door obstruction; Steam Audio PCM HRTF. Verified 9 DSP + 12 world tests. | Material transmission, diffraction around corners, reflections and room reverberation; time-based smoothing. | Same authored XY/spans/portals drive sound; opening/closing a door changes impulse response; reproducible PCM tests; no independent 3D scene. |
| Audio portability | macOS runtime exercised; Linux x64/Windows x64 build integration exists. | Actual platform runtime and release bundle tests, unsupported-target policy validation. | Fresh installed bundle plays HRTF MP3 without development-tree libraries; requested missing HRTF fails explicitly. |
| Panorama sky | Native equirectangular selection existed for PNG; direct EXR/tone mapping/yaw and smooth sampling are active work. Supplied EXR decoded by new native adapter tests. | Complete current camera/seam/CPU-GPU regression and demo launch before marking done; larger-than-4K or multipart/deep EXR deliberately unsupported. | Actual supplied file, yaw/pitch and 360 seam, no translation parallax, enclosed club/tunnel ceilings remain closed, CPU/GPU agreement. |
| Surface rendering | World-coordinate UV and optional bilinear sampling are active corrections to segment/cell texture resets. | Complete actual-frame regressions; mipmaps/footprint-aware minification if distant shimmer persists. | Splitting/reversing a wall does not change world-mapped appearance; matching CPU/GPU frames; collision unchanged. |
| FBX motion | Re2DSprite animation JSON playback and validation already existed. Direct FBX motion import was missing; native SDK humanoid importer is active work for Chicken Dance. | Finish current import/runtime/loop verification. No generic importer completion claim yet. | Real provided FBX yields version1 clip, valid target bones, nontrivial sampled poses, bounded keys, seamless loop and actual club playback. Runtime consumes JSON, not FBX. |
| Retargeting | Current importer targets the existing mascot's ten humanoid bones with explicit image-side mapping and swing retargeting. | User-supplied source/target bone maps, differing rest poses/bone axes, missing bones, multiple stacks/clips, twist/roll preservation. | Different humanoid rigs retarget without hardcoded names; bind pose and bone length preserved; unsupported mappings return structured errors. |
| Hands/fingers | Existing mascot rig does not expose finger bones. | Author finger surfaces/rig and import individual finger tracks; foot/hand contact constraints if required. | Visible articulation and seam inspection in real Re2DSprite output, not an imported 3D mesh preview. |
| Motion loops | Current dance import bakes a short closing seam and in-place root movement. | General root-motion extraction, blend transitions, quaternion interpolation/bake continuity checks near singular rotations. | Loop boundary has no visible jump; root motion is explicit data consumed by game logic; deterministic pose tests. |

Keep this table current after verification. A passing generic suite does not prove untested acoustics, platform packaging, universal FBX retargeting or all camera angles. Detailed commands, evidence, failures and remaining risks belong in SDK_HANDOFF.md.
