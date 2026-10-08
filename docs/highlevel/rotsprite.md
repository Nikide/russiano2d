# Re2DSprite — совместимость старого имени

Документация переименована: [re2dsprite.md](re2dsprite.md).
Старые `$.rotSprite` и `.rot*` остаются совместимыми алиасами `$.re2dSprite` и
`.re2d*`: оба имени указывают на один и тот же код
(`src/highlevel/rotsprite.js`), поведение не отличается.

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

Новый код пишите с `re2d*`: именно эти имена описаны в справочнике и
используются в [Re2D](../RE2D.md). Старые алиасы удаляются только отдельным
решением владельца проекта, с заметкой о миграции.
