# Навык: звук и музыка

Движок проигрывает файлы (`.wav`, `.ogg`, `.mp3`). **Звуковые эффекты можно сделать самому** — навык `generate-sound`
(`generate_sound`: описание словами или пресет → WAV). **Музыки и речи генератор не делает** — для них только существующие файлы.
Выдуманный путь к несуществующему файлу — ошибка `R2D_SFX_*` в `$.debug.errors()`, поэтому:

1. Эффект нужен — `skill_load generate-sound`, затем `generate_sound { path: "assets/sfx/jump.wav", text: "прыжок" }`.
2. Музыка — `list_files ext:"ogg"` / `"mp3"`: что уже есть в проекте и шаблоне. Нет подходящего — играй без музыки и скажи в отчёте,
   какой трек не хватает.
3. Эффекты вида «удар/взрыв/подбор» через готовые пресеты и банки: `$.hits.presets()`, `$.sfx.presets()`, `$.sfxgen.presets()`.

## 1. Вызовы

| Задача | API |
|---|---|
| Сгенерировать звук (в игре) | `$.sfxgen.play('coin')`, `$.sfxgen.bank('hit', [...])` — подробнее в навыке `generate-sound` |
| Звук-эффект по пути | `$.sound.play('assets/sfx/jump.wav', { volume: 0.6 })` |
| Звук в точке мира | `$.sound.playAt(...)` |
| Несколько вариантов (чтобы не надоедало) | `$.sfx.bank('hit.metal', ['sfx/a.wav', 'sfx/b.wav'])`, затем `$.sfx.play('hit.metal', { pitchRange: 0.9 })` |
| Звук удара | `$.hits.preset('sword', { sound: 'sfx/sword.wav', hitStop: 60 })`, `$.sfx.play('sword')` |
| Музыка | `$.sound.music('assets/audio/music/action.ogg', { loop: true })`, остановка — `$.sound.musicStop()` |
| Переход между треками | `$.sound.crossfade(...)` или кирпичик `audio.music-transition` |
| Громкости | `$.sound.sfxVolume(v)`, `$.sound.musicVolume(v)`; шины и приглушение — `$.audio.bus`, `audio.ducking` |

Кирпичики: `audio.footsteps`, `audio.ambience`, `audio.weapon`, `audio.damage`, `audio.ui`, `audio.one-shot`, `audio.loop`,
`audio.distance-profile`, `audio.dialogue`, `audio.music-transition`, `world.audio-zone`, `settings.audio` (ползунки в настройках).

## 2. Что озвучить в первую очередь

1. **Действия игрока:** прыжок, выстрел/удар, подбор — игрок слышит отклик на каждое нажатие.
2. **Урон и смерть** (герой и враги).
3. **Интерфейс:** клик, подтверждение, победа, поражение.
4. **Музыка:** одна зацикленная тема на уровень, потише эффектов (0.4–0.6 против 0.8–1.0).

## 3. Правила

* Звуки одного и того же события чередуй через банк с `pitchRange` — повтор одного сэмпла быстро раздражает.
* Не запускай музыку повторно каждый кадр: один вызов при входе в сцену (`$.scene.add('level', …)`).
* Для речи и драматических сцен приглушай музыку (`audio.ducking`).
* Настройки громкости сохраняются (`settings.audio`); по умолчанию — не на максимум.
* Демо-музыка проекта лежит в `demos/assets/audio/music/` — её можно предложить пользователю, но не копируй в проект без просьбы.
