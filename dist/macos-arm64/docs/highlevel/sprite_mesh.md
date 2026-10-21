# SpriteMesh — baked mesh для обычного Sprite

SpriteMesh добавляет экструдированную геометрию к существующему спрайту. Он
использует его текстуру, кадры, анимации и pivot; отдельного объекта или
анимационной системы не создаёт.

```js
const player = $('player');
player.spriteMesh({
    enabled: true,
    depth: 0.08,
    alphaThreshold: 16,
    unitsPerPixel: 1 / 32,
});

player.play('walk'); // обычная Sprite animation выбирает соответствующий mesh
```

Вызов без аргумента возвращает настройки, а `spriteMesh(false)` отключает
отрисовку mesh для узла. Настройки по умолчанию можно записать в Sprite/Atlas
asset через SpriteMesh Studio в Editor.

## Bake и cache

SDK строит и сохраняет mesh для **каждого** кадра. Runtime загружает cache и при
обычном переключении кадра выбирает соответствующий готовый mesh. Геометрия не
перестраивается в animation update. Cache инвалидируется изменением текстуры,
раскладки кадров, pivot, настроек или версии формата.

SpriteMesh Studio открывает PNG или Atlas JSON, показывает кадры и animations,
позволяет проигрывать animation, менять depth/alpha threshold/units per pixel,
pivot и режим preview, затем запечь cache всех кадров вместе с настройками
asset (для PNG записывается только cache; при повторном открытии студии —
настройки по умолчанию).

## Ограничения

Геометрия строится extrusion-ом непрозрачных пикселей по alpha threshold.
Соседние opaque-пиксели объединяются без внутренних стенок; границы atlas frame
изолированы. Cache содержит CPU mesh и загружается через существующий Re2D mesh
renderer. Это 2D/2.5D представление обычного Sprite, а не новый renderer.

Preview camera принимает `yaw: 0` и `pitch: 0` как точный вид спереди;
пропущенные углы используют ракурс по умолчанию.
