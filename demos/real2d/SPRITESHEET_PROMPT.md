# Промпт исходного component spritesheet — Real2D v4

Статус: source candidate для head-only MVP, НЕ готовый валидированный runtime atlas. Это исходные рисунки; финальные случайные ракурсы агент обязан вычислять кодом. Character design выбран как нейтральный пример: взрослая аниме-девушка, тёмные прямые волосы, голубые глаза. Для другого дизайна заменить описание до генерации, не менять identity внутри sheet.

## Prompt для image generation

```text
Use case: stylized-concept
Asset type: production 2D anime character component spritesheet for a deterministic layered warp renderer.
Create a square, high resolution 4 by 4 grid of exactly 16 isolated RGBA components on a genuinely transparent background, equal cells, no borders, no labels, no text. Each item centered inside its cell with generous transparent padding. Flat clean anime line art, crisp coherent outlines, restrained cel shading, consistent palette and scale. One consistent adult anime woman with straight dark navy hair, blue eyes, pale warm skin. This is a disassembled head asset sheet, NOT a turnaround of complete assembled characters. Draw only the specified isolated component in each cell; do not duplicate complete faces inside eye/nose/mouth cells. No 3D rendering, photorealism, scenery, checkerboard painted into the background or decorative layout.
Exact row-major cell content:
Row 1: (1) front bald face skin silhouette with ears, no eyes eyebrows nose mouth or hair; (2) bald face three-quarter silhouette with nose pointing screen-right, no facial features; (3) bald profile face skin silhouette with nose pointing screen-right, no separate drawn eye eyebrow or mouth; (4) back of bald head with ears and neck, no facial features.
Row 2: (5) isolated front left anatomical open blue eye with eyebrow, no skin patch; (6) isolated front right anatomical open blue eye with eyebrow, no skin patch; (7) isolated three-quarter near open blue eye with eyebrow for screen-right facing head; (8) isolated closed eyelid line and eyebrow, no skin patch.
Row 3: (9) isolated small anime front nose line, no face; (10) isolated three-quarter nose line for screen-right turn, no face; (11) isolated closed neutral mouth lips, no face; (12) isolated open mouth with lips and dark interior, no face.
Row 4: (13) isolated back hair mass, straight shoulder-length navy hair, no head or body; (14) isolated front bangs/fringe, no face; (15) isolated left anatomical side hair lock, no face; (16) isolated right anatomical side hair lock, no face.
Keep the same character proportions and identity. Avoid texture shadows belonging to other components. All visible parts fully inside their own cells. Actual transparent alpha outside shapes. Pixel asset only, no explanation.
```

## Что агент обязан сделать после генерации

1. Проверить реальный размер, RGBA и прозрачность; проверить все 16 клеток визуально. Grid не считать точным до проверки.
2. Извлечь rect/masks из реального PNG, удалить только технические поля средствами авторинга; сохранить исходник/hash. Не автоматически предполагать pixel-perfect boundaries.
3. Проверить: отдельные components, отсутствующие features, front/3q/profile соответствуют подписи metadata. Если генератор нарисовал полные лица вместо компонентов — asset rejected, перегенерация.
4. Эта версия содержит только right-facing appearance. Для полноценного full-circle персонажа добавить left 3q/profile и соответствующие eye/nose варианты; отражение разрешить только после явного symmetry review. Нельзя заявлять, что 16 клеток закрывают все требования v4.
5. Создать cage, landmarks, geometry anchors, gates, chart correspondences по `REAL2D_V4_SPEC.md`. Пиксельный sheet не содержит эти данные и не заменяет их.
6. Записать `authoring_manifest.json` только после проверки фактических координат. Не поставлять пустой manifest под видом готовых данных.

## Prompt для coding-agent

Прочитай REAL2D_V4_SPEC.md. Сначала проверь исходный component sheet и существующую архитектуру движка. Реализуй стадию A: детерминированный CPU layered 2D warp renderer без 3D и без генерации итоговых кадров. Подготовь согласованные geometry anchors и metadata, перечисли отсутствующие appearance варианты. Все non-anchor outputs должны происходить из реальных texels sheet через barycentric warp, visibility masks и композицию. Выдай исходники, bake report, provenance и случайные углы. Не утверждай full-body/pitch success, пока не выполнены стадии B/C. Не используй готовые assembled view images как runtime atlas patches.
