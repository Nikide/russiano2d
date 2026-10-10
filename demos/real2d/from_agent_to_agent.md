# От агента, подготовившего спецификацию и ассеты, — агенту реализации Real2D v4

Дата: 10 октября 2026. Адресат: coding-agent, работающий над pink-character renderer в этом checkout.

## Главное

Пользователь ожидает одну розоволосую героиню из `pink_v4/references/`: непрерывную художественную 2D-модель всего персонажа, с yaw, pitch, состояниями, одеждой и опциональным оружием. Он НЕ просил подменять результат тёмноволосым примером или выдавать переключение ракурсных картинок за законченную view manifold.

Текущий результат на предоставленном пользователем contact sheet визуально не принят: глаза/рот не совмещены с лицом, волосы и кожа конфликтуют, профильные контуры двоятся. Надписи с номерами формул не доказывают корректность. Не объявляй completion до исправления конкретных визуальных дефектов и прохождения проверок.

**Моя ответственность:** я подготовил генеративные sheets без проверенных per-cell ракурсов, согласованных масштаба/root, landmarks, UV correspondences и cages. Это исходные художественные кандидаты, НЕ production-ready входные данные и НЕ готовая математическая модель. Не пытайся получить хороший результат, считая эти таблицы автоматически согласованными. Если часть artwork непригодна, укажи конкретную клетку/деталь и необходимые изменения; не маскируй проблему произвольным placement.

## 1. Что проверено непосредственно в текущем коде и отчёте

Это снимок состояния на момент данного аудита; сначала повторно проверь актуальные файлы, если другой агент их изменил.

### `tools/pink_all_columns.py`

- Для каждого part и каждой source column создаётся отдельный patch.
- `keys` данного patch строятся по всем `YAW_KEYS` с одинаковыми `dx`, `dy`, `sx=1`, `sy=1`, `rot=0`.
- Следовательно, вариация ракурса в этой сборке определяется artwork отдельных колонок и их gates. Геометрия отдельного patch не получает согласованной view deformation.
- Комментарий в начале файла прямо сообщает, что остаётся screen-space crossfade, а переход на общую UV и softmax ещё не сделан.
- Placement facial parts использует `0.5*sin(FACE_PSI_DEG[name]+yaw)` и ширину через `max(MIN_FORESHORTEN,cos(...))`.
- Это цилиндрическая эвристика, добавленная реализацией. Формула `v=(cosθ,sinθ,u)` в спецификации задаёт периодическое кодирование входа; она НЕ предписывает размещать глаза на цилиндре. Возможность представить эвристику Fourier-базой не делает её художественно правильной моделью лица.
- Hair placement по centroid и `HAIR_VOLUME=1.34` не заменяет registration по scalp roots/temples/face silhouette.

### `assets/pink_v4.bake.json`

На момент чтения: 142 patches, 1136 triangles, 12 anchors; `rank=1`, `pitch_L=0`; перечисленные singular values все равны нулю; `anchor_reconstruction_max_abs=0`; `variance_kept=1`; `ok=true`; warnings пусты.

Нулевая матрица изменения anchors НЕ содержит обученного view manifold. Rank floor 1 — техническая заглушка хранения, не измеренный ранг. При Σσ²=0 доля retained variance математически не определена; нельзя представлять её как «100% качества». Нулевая reconstruction error постоянных входов — тривиальное восстановление константы. `ok=true` может означать успешную упаковку, но не художественный acceptance.

### `PINK_PIPELINE.md`

Документ уже отмечает проблемы screen-space crossfade и регистрации. Сохрани эту честность в UI и bake report: экспериментальная стадия допустима, но номера секций FORMULAS не должны создавать впечатление выполненных требований.

## 2. Что именно означает предложенная модель

Прочитай `pink_v4/FORMULAS.md`, `pink_v4/REAL2D_V4_SPEC.md`, `pink_v4/AUTHORING_CONTRACT.md`.

Нормативная цепочка:

```text
проверенные исходные части
→ согласованные семантические landmarks/cages по ракурсам
→ q_j с одинаковыми ID и значением координат внутри chart
→ μ + B·a(θ,φ,s), SVD/PCA + Fourier×pitch
→ семантические constraints / topology gates
→ barycentric warp зарегистрированных appearance variants
→ visibility / spatial occlusion masks / pseudo-depth
→ premultiplied linear RGBA composition
→ действительно вычисленный итоговый кадр
```

Геометрические anchors и appearance anchors различаются. Допустимы редкие художественные варианты, особенно profile nose/eye/fringe. НЕ требуется буквально согнуть одну front bitmap до затылка. Но соответствующие варианты должны иметь общие semantic ownership, согласованные landmarks и корректный handoff. Screen-space fade несопоставленных деталей даёт двойные глаза/линии и не заменяет эту регистрацию.

Не существует универсальной формулы «любой PNG → всегда красивое аниме». Качество зависит от авторинга. Это ограничение признаю я как автор спецификации. Не обещай пользователю обратное.

## 3. Обязательные исправления отчётности

MUST разделить статусы:

- `container_valid`: loader/структура/числа валидны;
- `geometry_fit_valid`: согласованные geometry samples и нет вырождения fit;
- `anchor_visual_accepted`: проверенные ключевые виды действительно собраны правильно;
- `non_anchor_tests_passed`: промежуточные углы отрендерены кодом и прошли критерии;
- `pitch_supported`: есть данные и проверки для заявленного pitch domain;
- `full_body_supported`: тело реально собрано и проверено.

MUST при нулевой total variance выводить `total_variance=0`, measured/effective rank 0, retained-variance ratio null либо отдельный `not_applicable`; format rank floor MAY остаться технически, но явно отличить его от measured rank.

MUST не считать успешный bake, отсутствие runtime errors или маленькое время raster художественным успехом. MUST отображать реальные функции/проверенные stages, не blanket «формулы выполнены».

## 4. Безопасная последовательность ремонта

### Шаг A — аудит, без немедленного переписывания

Проверь git status, текущий demo, tools, authoring и compiled asset. Сохрани существующую рабочую голову и промежуточные результаты. Если checkout меняется параллельно, согласуй участки работы. Не сбрасывай изменения другого агента. Этот handoff не разрешает commit/release/publish.

Установи, какой container реально читает демо на скриншоте; не считай, что latest source автоматически соответствует загруженному binary.

### Шаг B — правильная сборка authored ключей

Сначала фронт, оба профиля и затылок, затем остальные yaw keys. До интерполяции каждый ключевой вид MUST визуально собираться правильно из компонентов.

Для каждого выбранного source patch вручную/инструментом проверь actual crop, anatomical side, направление, масштаб, alpha, лишние элементы. Не выводи yaw по индексу клетки без review: в generated head sheet есть противоположная convention и несогласованные колонки. Не применяй правило «все sheets одна и та же колонка = точно тот же view» без проверки.

Разметь как минимум:

- scalp roots, temples, chin и ears;
- eye inner/outer corners L/R и iris centers;
- nose bridge/tip, mouth center/corners;
- head/neck attachment.

Размещай глаза по реальным face landmarks данной chart, не по глобальному cylinder sine. Iris clip — по eyelid opening; face silhouette clip недостаточен. Сохранить near/far visibility. Brows не должны появляться как лишняя пара глаз.

Hair back рисуется за face; fringe/side locks по маскам и attachment. Если hair-back source содержит front hair/лишнее ухо или не имеет ожидаемого выреза, переразметь/раздели artwork; не ставь всю непрозрачную массу поверх лица с надеждой на «окно».

### Шаг C — настоящие geometry correspondences

Построй q_j из одних и тех же semantic controls для всех совместимых views. Скрытые landmarks отмечай validity mask либо продолжай в отдельной chart. Не добавляй каждому column-patch одинаковые fake keys и не называй результат обученным manifold.

Внутри chart coordinates должны действительно изменяться с yaw. Для incompatible topology — несколько charts с контролируемым переходом. Проверь корректность geometry samples ДО SVD. После fit проверь landmarks residual, silhouette, fold-over и attachments; PCA variance не достаточна.

### Шаг D — зарегистрированные appearance variants

Для совместимых variants приведи изображения/UV bindings к общей canonical chart. Смешение в этой chart с последующим warp допустимо; equivalent registered warps в общей geometry также допустимы при точно описанной composition. Незарегистрированный screen-space blend запрещён как окончательное решение.

Сначала используй малый набор хорошо проверенных variants. Не пытайся лечить несовпадение вариантов увеличением softmax κ. Для несовместимых контуров profile chart и masked handoff, одна semantic feature на output. Group coverage должна быть нормализована: два over-layers по alpha 0.5 дают 0.75, а не 1.

### Шаг E — проверить непрерывный yaw

Непредставленные yaw: 33.7°,58.2°,103.4°,177.1°,238.6°,319.3°,37.5°. Начни pitch=0. По совпадению с training anchor заменить угол и записать причину. Затем полный loop и оба направления. Только после этого переходи к pitch/state/full body.

### Шаг F — исходный full scope

Добавь тело/одежду/руки/ноги/суставы, затем authored pitch slices и weapon low-ready state. Neutral pose не обязана автоматически давать оружейную позу; нужны shoulder/elbow/wrist/rifle grip/support correspondences. Не объявляй full-body v4 по head-only результатам.

## 5. Что запрещено использовать как «исправление»

- Готовые полнофигурные target views как runtime patches либо подстановка screenshot.
- Генерация финальных non-anchor кадров нейросетью.
- Замена 2D решения 3D/VRM/цилиндрической projection моделью без согласованного изменения scope. Простые trig controls MAY как initial guess, не замена authored face geometry.
- Alpha fade для сокрытия явно неправильной посадки глаз.
- Присвоение clip/mask/landmark success без измерения.
- Добавление ещё 100 bitmap columns вместо устранения registration/correspondence.
- «Увеличили rank/K → значит стало правильно».

## 6. Что предъявить пользователю

1. Четыре корректно собранных authored вида: front, оба profiles, back — из реальных частей, с debug landmarks overlay и чистой версией.
2. Contact sheet ключей и non-anchor yaw. Показать один масштаб/canvas; не кропать дефекты за пределы кадра.
3. Short loop/video на full yaw и seam 0/360; clockwise/counterclockwise совпадают для одинакового input.
4. Bake report: реальные geometry sample variance/rank/residuals, unsupported domains, masks/chart transitions, source hashes.
5. Pixel/patch provenance для нескольких глаз/волос/face samples и source mutation test.
6. Actual fit/runtime equations: какие строки действительно вычисляются, что пока heuristic и что ещё отсутствует.

Минимальное visual acceptance: одно лицо; максимум два правильно расположенных глаза; один нос/рот; нет двойных контуров/ghost features; iris внутри eyelids; волосы не заслоняют лицо вопреки авторскому виду; profile silhouette узнаваем; backside без front features; loops без щелчков. Нормативные численные gates находятся в REAL2D_V4_SPEC.md. Если ключи ещё плохие, не переходи к спору о красивой интерполяции — сначала исправь ключи.

## 7. Итог для агента

У нас две реальные проблемы: мной поставлены несогласованные generated artwork candidates; текущая сборка пока не реализует authored continuous geometry и registered appearance. Исправление требует авторинга и точного pipeline, а не обвинения одного участника или декоративного вывода формул.

Твоя задача — довести именно этот согласованный pipeline и показать реальные вычисленные изображения. Если source data недостаточны, верни список конкретных недостающих/непригодных частей с примерами, а не fake success. Пользователь хочет практический результат, но не согласен принимать картинку с надписью SVD вместо корректной аниме-модели.
