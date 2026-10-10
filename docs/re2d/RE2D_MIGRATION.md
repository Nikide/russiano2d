# Перенос старого Re2D на `$.re2dWorld`

Редакция 2026-10-10. Старые entry points остаются рабочими. Не заменяйте их имена механически: меняются topology, registration, camera configuration и render signature.

## Выбрать путь

| Существующая игра | Что переносить |
| --- | --- |
| ordinary 2D sprite/Box2D/UI | перенос не нужен для сохранения 2D игры |
| $.re2d.room + kind(Re2D) | перейти от node wall/floor/prism к inspectable cell/span/portal source |
| $.re2d.world(description) | сохранить стены/высотные интервалы, собрать explicit cells/portals; заменить frame entities на registrations |
| SDK legacy compiled.json | заново compile source с --renderer, загрузить .re2dworld |
| existing Re2DSprite PNG/character/animations | формат не меняется; добавить at/depth/size/angle и world.add |

Новый explicit world не использует переключение ordinary camera.kind как entry point. Legacy room pass и fullscreen newWorld.render одновременно приводят к двум разным world presentations; выберите один путь для данного viewport/frame.

## Старый и новый вызов

```js
// Старый CPU World, description — object; sprite list на каждом render.
const oldWorld=$.re2d.world(description);
$.render(() => oldWorld.render({x:40,y:120,eye:48,yaw:0,fov:70}, sprites,320,180));
```

```js
// Новый renderer, nativeDescription имеет version/cells/walls/portals.
const world=$.re2dWorld.fromJSON(JSON.stringify(nativeDescription)).backend('gpu');
world.add(sprites);
const view={x:40,y:120,h:48,yaw:0,pitch:0,fov:70,near:4};
$.render(() => world.render(view,320,180));
```

`sprites` — Re2DSprite wrapper/node/selector или array, не arbitrary entity mesh registry. Новое render не принимает спрайты вторым аргументом. `.camera(view)` заменяет configuration с defaults; `.render(null,...)` использует сохранённую. `h` — предпочтительное имя eye height; `eye` принимается alias нового wrapper.

## Безопасная последовательность

1. Сохранить старую игру и baseline screenshots/tests. Не переделывать sprite atlas/rig ради migration.
2. Создать author .re2dmap: disjoint rectangular XY cells, free spans, стены и explicit portals. Для same-XY этажей собрать spans в одном native owner; SDK может merge exact same-XY source rectangles.
3. Compile `--renderer`; проверить diagnostics, version и support/ray на обоих этажах до визуальной настройки.
4. Заменить loader/render; отключить legacy room presentation в этой сцене. UI сохранить существующим RmlUi.
5. Один раз включить спрайты в кадр World; скрыть отдельную обычную отрисовку. Facing — node.angle(rad), absolute feet — depth, physical sprite size — size. Weapon attach/equip сохраняется.
6. Подключить controller к native support/blocked/ray. Box2D не получает height filtering автоматически; не использовать старые 2D wall bodies как единственный источник многоэтажной collision.
7. Настроить material bank/surface assignments, classic span light, затем dynamic lights/shadows/fog. Проверить normal/emissive separately.
8. Проверить depth/owner/BSP/portals/light diagnostics и cold/warm animation cost. Задать pose policy осознанно.
9. Проверить reload с сохранением ссылок на узлы и handles динамических ресурсов; numeric span/surface/portal bindings перепривязать к новой topology, если domain изменился.

## Перенос API настроек

| Было | Стало |
| --- | --- |
| $.camera.kind(Re2D).eye(...).yaw(...) | отдельный world.camera({x,y,h,yaw,pitch,fov,near}) либо view в render |
| $.camera.fog(far,min) | per-span world.span(id).fog({density,start,color}); другая модель, не равные числа |
| $.re2d.poseBudget / poseStep | world.quality({poseBudget,poseStep}); defaults нового wrapper 1 / 3° |
| $.gfx.light для ordinary 2D | world.light({x,y,h,radius,intensity,color,shadow}) для world receivers |
| wall node sprite/top/tile | source wall segment+bottom/top; canonical surface.material + uScale/vScale |
| список спрайтов при render | world.add при spawn / world.remove при despawn |
| спрайт всегда поверх room mesh | native sample depth against world surfaces; неправильную высоту теперь видно как реальный occlusion bug |
| один floor/ceiling region | cell spans и explicit portal openings, continuous static slopes |

Примеры `<light>`, `<door>`, `<decal>` в исходном плане задают направление ergonomics. Текущий implemented world API — методы world.light/portalClosed/decal; автоматически переименовывать существующие ordinary 2D tags нельзя.

## Что не переносится автоматически

Node tint/alpha/shader/clip/flip semantics ordinary draw не гарантируются нативной композиции спрайтов. Полупрозрачные пиксели спрайта не являются world translucent material. Screen-space viewmodel и UI могут оставаться обычными 2D, но world lighting для них не возникает автоматически.

Old room surfaces были node prism/mesh presentation; новый world не импортирует этот mesh как authority. Его description нужно выразить walls/cells/spans/portals. Legacy finite wall/span description не содержит connectivity: отсутствие portal не означает, что C догадается о соседней room.

Old historical CPU benchmark относится к прежнему compositor. Новая cached GPU raster cost и anime synthesis — разные части бюджета. Сверяйте [performance](../RE2D_WORLD_PERF.md), а не повторяйте старую цифру FPS.

## Regression checklist

Проверить spawn/load/reload/despawn; lower/upper same-XY support и ray; door closed/open; перекрытие спрайта стеной и мостом; sockets/equipment; вспышку на спрайте, стене и полу; fog/material diagnostics; управление рядом со ступенями; invalid data rollback. Рабочие образцы и exact checks — [World guide](../RE2D_WORLD_GUIDE.md), [sprite integration](RE2DSPRITE_WORLD.md), [document audit](RE2D_DOCUMENT_ACCEPTANCE_AUDIT.md).

Legacy reference: [re2d_legacy.md](../highlevel/re2d_legacy.md). Новый reference: [runtime](RE2D_WORLD_RUNTIME.md). Public aliases rotSprite/rot* сохранены, новый код использует re2dSprite/re2d*.
