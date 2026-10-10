# Re2DSprite — совместимость старого имени

Документация переименована: [re2dsprite.md](re2dsprite.md).
Старые `$.rotSprite` и `.rot*` остаются совместимыми алиасами `$.re2dSprite` и
`.re2d*`: оба имени указывают на один и тот же код
(`src/highlevel/rotsprite.js`), поведение не отличается.

## Что даёт модуль

`src/highlevel/rotsprite.js` — вся подсистема Re2DSprite: namespace `$.rotSprite`
(он же `$.re2dSprite`) и методы узла `rot*`/`re2d*`.

| Вызов | Что делает |
|---|---|
| `$.rotSprite.from(path, opts?)` | загрузить character.json и создать узел |
| `$.rotSprite.definition(path)` | разобранная модель без создания узла |
| `$.rotSprite.equip(target, item)` | надеть предмет (сокет/смена части) |
| `$.rotSprite.create(path, opts?)` | создать узел `<rotsprite>` и загрузить атлас `path` |
| `$.rotSprite.pose(target, yaw, pitch?)` / `.info(target)` / `.dispose(target)` | поза, состояние, освобождение ресурса |

Формат выбирается по `atlasInfo.version`: **2** (развёртка v2) или **3**
(плотная поверхность, [RE2DSPRITE_V3.md](../RE2DSPRITE_V3.md)); другое значение —
ошибка. Вид синтеза v3 задаёт сам JSON (`projection.raster/light/detail/eye/window/
cull/motionLod`), а не вызовы из игры; нативный вход —
`engine.rotSpriteConfig(handle, raster, light24, detail, view)` и
`engine.rotSpritePrepare(handle)` ([internal/NATIVE.md](../internal/NATIVE.md)).

| Старое имя | Новое имя |
|---|---|
| `$.rotSprite` | `$.re2dSprite` |
| `<rotsprite>` | `<rotsprite>` (тег не менялся) |
| `.rotSpriteAtlas(path)` | `.re2dSpriteAtlas(path)` |
| `.rotPose(yaw, pitch)` | `.re2dPose(yaw, pitch)` |
| `.rotStyle(style)` | `.re2dStyle(style)` |
| `.rotExpression(...)`, `.rotEmotion(name)` | `.re2dExpression(...)`, `.re2dEmotion(name)` |
| `.rotRig(...)`, `.rotMotion(...)` | `.re2dRig(...)`, `.re2dMotion(...)` |
| `.rotPart(group, path)`, `.rotVariant(group, key)` | `.re2dPart(group, path)`, `.re2dVariant(group, key)` |
| `.rotReload()`, `.rotHotReload(on)` | `.re2dReload()`, `.re2dHotReload(on)` |
| `.rotAttach(...)`, `.rotDetach()` | `.re2dAttach(...)`, `.re2dDetach()` |
| `.rotBone(...)`, `.rotLayer(...)`, `.rotSeek(t)` | `.re2dBone(...)`, `.re2dLayer(...)`, `.re2dSeek(t)` |
| `.rotVisibleParts(ids)` | `.re2dVisibleParts(ids=null)` |

Полный список алиасов объявляет сам модуль циклом — 17 имён; таблица выше
перечисляет те, что встречаются в примерах и справочниках.

Новый код пишите с `re2d*`: именно эти имена описаны в справочнике и
используются в [Re2D](../RE2D.md). Старые алиасы удаляются только отдельным
решением владельца проекта, с заметкой о миграции.
