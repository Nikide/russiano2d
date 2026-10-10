# Контракт ассетов розоволосой героини

## 1. Дизайн и единая модель

Все компоненты принадлежат одной взрослой героине из original_reference_06.png. Запрещена замена персонажа тёмноволосым примером. Pink bob, cat clip, red/rose eyes, sailor blouse, red ribbon, gray/red plaid skirt, stockings, boots и tactical accessories сохраняются между views. Reference camera signs могут быть противоречивы: нормативна convention полной спецификации (yaw90 nose вправо; positive pitch camera above).

Source PNGs — generated artwork candidates. Intended cells описаны ниже; фактическое содержание MUST проверить. `.r2d4` не создавать пока сетки/коэффициенты и проверки отсутствуют. Empty metadata не считается completed authoring.

## 2. View sampling

Yaw keys: [0,30,60,90,120,150,180,210,240,270,300,330] degrees. Pitch geometry slices [−30,0,+30]. Минимум 36 **размеченных** geometry samples, не 36 клеток произвольного рисунка. Компонентные yaw sheets сейчас предназначены для φ=0. Отдельные pitch targets служат guide; они не покрывают все 36 geometry anchors. Недостающий pitch authoring агент фиксирует как незавершённый, а не экстраполирует молча.

12 yaw keys — geometry supervision; редкие appearance variants — 3..6 совместимых artwork charts для важных parts после review. Не нужно хранить все 12×layers как неизменяемые полные snapshots. Вокруг profiles и visibility transitions добавить samples при необходимости; exact training angle не разрешает выбирать готовый frame.

## 3. Source sheets и semantic rows

Columns у первых четырёх sheets — 12 yaw keys в указанном порядке.

| Sheet | Rows сверху вниз |
|---|---|
| pink_head_hair_yaw_layers_v1.png | bald head/skin/ears; back hair; hair anatomical L; hair anatomical R; fringe; cat clip |
| pink_face_yaw_layers_v1.png | eye L sclera+lid; eye R sclera+lid; iris+pupil+highlight; brows; nose; mouth |
| pink_body_limbs_yaw_layers_v1.png | opaque camisole torso+neck/pelvis; arm L; arm R; hand L; hand R; paired legs with opaque shorts/stockings |
| pink_clothing_equipment_yaw_layers_v1.png | blouse/collar/ribbon; skirt; belt/pouches; boot L; boot R |

`pink_weapon_pose_expressions_v1.png`: 6×4 cells; rifle variants (side/3q/axial opposite directions), hand grip/open/fist variants, mouth expression variants, eye expression variants. These columns НЕ yaw keys персонажа. Для rifle view нужен самостоятельный проверенный domain annotation.

`pink_full_character_target_yaw_pitch_v1.png`: reference-only: 12 neutral assembled yaw views; 6 head/pitch target examples; 3 assembled low-ready weapon targets. Layout intent не равно проверенному angle annotation. Source atlas MUST NOT содержать эти assembled figures.

## 4. Обязательная разметка

Для каждого source image: actual width/height, SHA256, alpha convention, effective cell bounds, crop rect, padding, review status. Для каждого patch: semantic_id, anatomical side, chart_id, owner_group, reference UV, reference mesh, cage, bindings, valid domain, visibility rule, appearance anchors. Для каждой geometry anchor: yaw/pitch/state, q controls, landmarks, mask-validity и reviewer.

Patch semantic IDs постоянны. Отсутствующий глаз у спины не заменять front eye artwork. Draw order по view меняется; заранее фиксированный общий список слоёв из инфографики не достаточен. Оружие имеет grip/support/muzzle/stock и attachment к wrist/hand controls.

Общие landmarks: root, neck_base, chin, temples, scalp_roots, eye_corners_L/R, nose_tip, mouth_center/corners, shoulders_L/R, elbows_L/R, wrists_L/R, hips_L/R, knees_L/R, ankles_L/R, rifle_grip/support.

Whole legs cell разделить на L/R subpatches после проверки; руки shoulder→wrist сегментировать upper/forearm с elbow controls при animation. Брови и глаза пары разделить если реально нарисованы вместе. Sleeve/collar in combined blouse не дублировать отдельным overlay. Profile ears inside head cell MAY оставить в head chart или отделить согласованным cutout. Нельзя объявлять автоматическую segmentation идеальной без визуального review.

## 5. Единый runtime atlas

Baker пакует validated patches всех source sheets в `atlas_00.png` с metadata (дополнительные atlas pages MAY при size limit), затем единый `.r2d4`. Single-container НЕ означает, что художник обязан нарисовать всё на одной гигантской таблице. Authoring sheets и original infographic sheets — вспомогательные источники. Full target stored только references, runtime loader его не читает.

Runtime texel provenance должен ссылаться на конкретный validated source/patch/UV. Не использовать background/UI/text из исходных инфографик как runtime content.

## 6. Доказательный pipeline

1. Review actual generated sheets: counts, angles, anatomy, transparency, style consistency.
2. Segmentation и rects; reject/repair bad cells. Указать, что GENERATED_CANDIDATE проходит только initial source stage.
3. Authored cage/landmarks и key geometry, pitch coverage.
4. Basis fit и masks; compile; CPU reference render.
5. Проверить 37.5°,58.2°,103.4°,177.1°,238.6°,319.3° и random yaw/pitch pairs, которых нет в authoring.
6. Выдать contact sheet/video/metrics/provenance. Изображение target не подставлять в result.

## 7. Задание coding-agent

Прочитай README, FORMULAS, полную спецификацию и этот контракт. Проаудируй существующее head demo, не переписывай его без необходимости. Создай новый pink-character asset pipeline и полную 2D модель: общий manifold, Fourier×pitch, registered appearance charts, visibility/topology, barycentric warp и occlusion masks. Для отсутствующих данных выдай конкретный authoring checklist. Не заявляй completion по одним generated sheets. Не используй 3D/VRM и image generation для финальных кадров. Постепенные этапы допустимы, но финальный scope — именно эта full-body героиня с optional weapon pose и pitch, не голова другого персонажа.
