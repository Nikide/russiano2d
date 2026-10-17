# `$.sfx` — звук удара (то, что слышно)

Модуль `src/highlevel/sfx.js` (задача `task-69`, разделение §F
`docs/VFX_ROADMAP.md`). Правило: **что слышно → `$.sfx`, что видно → `$.vfx`**
([`vfx.md`](vfx.md)). В `$.sfx` нет и не должно быть визуальных имён: ни
`flash`, ни `shake`, ни `hitStop` — это всё `$.vfx`.

Пресеты попадания — **один** реестр с `$.hits`: `$.sfx.presets()` читает тот же
объект, второй копии нет. Поэтому пресет удара не разъезжается на «звуковую» и
«визуальную» версии.

---

## 1. Вызовы

| Вызов | Что делает |
|---|---|
| `$.sfx.play(what, opts)` | сыграть звук: банк / пресет `$.hits` / путь |
| `$.sfx.presets()` | имена пресетов попадания (тот же список, что `$.hits.presets()`) |
| `$.sfx.preset(name, spec)` | задать/дополнить пресет (делегат `$.hits.preset`) |
| `$.sfx.bank(name, filesOrSpec)` | объявить банк звуков (делегат `$.sound.bank.define`) |
| `$.sfx.playBank(name, opts)` | сыграть из банка (делегат `$.sound.playBank`) |

`$.sfx.play` разбирает три случая **в этом порядке**:

1. `opts.bank` задан или имя зарегистрировано как банк
   (`$.sound.bankNames()`) → `playBank`;
2. имя — пресет `$.hits` → играется его поле `sound`; если оно пустое, это
   громкий отказ `R2D_SFX_PRESET_SILENT` (а не тишина);
3. иначе имя считается путём/именем звука → `$.sound.play`.

```js
$.sfx.bank('hit.metal', ['sfx/metal_a.wav', 'sfx/metal_b.wav']);

$.hits.preset('sword', { hitStop: 60, sound: 'sfx/sword.wav' });
$.sfx.play('sword');                       // пресет: возьмёт его sound
$.sfx.play('hit.metal', { pitchRange: 0.9 });  // банк: выберет файл
$.sfx.play('sfx/ui/click.wav', { volume: 0.4 }); // путь
```

## 2. Коды отказов (не тишина)

| Код | Когда |
|---|---|
| `R2D_SFX_UNAVAILABLE` | в сборке нет звука/банков (`$.sound` отсутствует) |
| `R2D_SFX_NO_TARGET` | `$.sfx.play()` вызван без имени |
| `R2D_SFX_PRESET_SILENT` | у пресета `$.hits` пустое поле `sound` |
| `R2D_SFX_UNKNOWN_BANK` | банк не объявлен |
| `R2D_SFX_PLAY_FAILED` | исключение из `$.sound.play` |

Все записи — `recoverable: true` в `$.debug.errors()`: один несыгранный звук не
должен останавливать кадр, но и молчать о нём нельзя.

Внутри движка тот же объект доступен как `$.ctx.sfx`; публичный контракт —
`$.sfx` (рядом с `$.ctx.fx`, `$.ctx.vfx`).

## 3. Связь с ударом

`$.vfx.impact(x, y, { sound: 'sword' })` рисует волну/тряску/hit-stop и зовёт
`$.sfx.play('sword')` — звук остаётся в звуковом пространстве. Слой спеки
`use: 'sound.playBank'` тоже идёт через `$.sfx` (и получает те же коды отказа).

Старый `$.hits.play(info, { sound: '...' })` продолжает работать: поле `sound`
в пресете никуда не переезжало, изменилось только рекомендованное пространство
вызова. Миграция — [migration.md](migration.md).

## 4. Тесты

`tests/agent/fx_split_mapping_test.py` проверяет: `$.sfx` существует, в нём нет
визуальных имён, `$.sfx.presets()` совпадает с `$.hits.presets()`, а старый и
новый `impact` зовут один и тот же `$.sfx.play` с одинаковыми аргументами.
Разброс высоты и выбор файла банка покрыты `tests/agent/clip_pitch_test.py`,
музыка/каналы — `tests/agent/sound_music_api_test.py`.
