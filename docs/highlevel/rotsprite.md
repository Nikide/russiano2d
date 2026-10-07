# RotSprite — `$.rotSprite`

Один большой PNG всего персонажа, без готовых ракурсов. Первый milestone
синтезирует голову и уши из общего атласа; тело пока не проецируется.
Строгая раскладка, оси, формулы и ограничения — [RotSprite v1](../ROTSPRITE_V1.md).

```js
$.ready(() => {
    $.rotSprite.create('art/mascot_rotsprite.png', { id: 'russi' })
        .at(320, 240).size(256,256).rotPose(35,-15).appendTo($.world);
});
$.update(() => $('#russi').rotPose($.time.now() * 25,0));
```

| Вызов | Результат |
|---|---|
| `$.rotSprite.create(path, opts?)` | узел `<rotsprite>` с собственным ресурсом |
| `.rotSpriteAtlas(path)` | загрузить/заменить общий PNG, цепочка |
| `.rotPose(yaw, pitch=0)` | поза в градусах, цепочка, не поворот в плоскости |
| `$.rotSprite.pose(target,yaw,pitch=0)` | то же для селектора/обёртки |
| `$.rotSprite.info(target)` | `{sprite,texture,revision,yaw,pitch,width,height,atlasWidth,path,version,milestone,disposed}` или `null` |
| `$.rotSprite.dispose(target)` | отпустить ресурс; узел остаётся, но ничего не рисует |

`revision` растёт только при успешном изменении позы. Совпадающая поза не
пересчитывается; поворот на 360° равен исходному. NaN/Infinity отклоняются.
`.remove()` и смена сцены освобождают ресурс; native finalizer — страховка
при сборке мусора и hot reload. Замена невалидным PNG сохраняет старый ресурс.
После dispose можно снова вызвать `.rotSpriteAtlas(path)`.

Пиксельный масштаб целый, минимум 1; используется меньший габарит `.size()`.
Экранная позиция округляется после камеры. Nearest закреплён только за этим
спрайтом и работает даже при `$.gfx.filter(true)`. Цвет, альфа, слой, камера,
клип и видимость наследуются обычным путём R2D. `.angle()`, `.pivot()`,
неравномерный scale и flip в этом milestone не поддержаны. Шейдеры узла,
outline и shadow стандартного спрайтового рисователя также не применяются.

Низкий уровень: `engine.rotSpriteLoad(path)` → opaque handle;
`rotSpritePose(handle,yaw,pitch)` → sprite id; `rotSpriteInfo(handle)` →
структура состояния; `rotSpriteDispose(handle)` → undefined, идемпотентно.
Чужой handle и поза освобождённого ресурса вызывают исключение.

Демо: `./build/russiano2d --game demos --scene rotsprite`.
Проверки: `tests/js/rotsprite_test.mjs`, `r2d_rotsprite_test`,
`tests/agent/highlevel_rotsprite_test.py`.
