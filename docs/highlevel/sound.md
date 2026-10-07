# Звук — `$.sound`

Эффекты, позиционное звучание, музыка. Позиционность приблизительная:
SDL_mixer умеет панораму (pan −1..1) и громкость, поэтому «где звучит»
вычисляется относительно камеры. Для 2D этого достаточно: источник слева — в
левом ухе.

```js
$.sound.play('shot.wav', { volume: 0.8, pitch: 1.1 });
$.sound.playAt('boom.wav', 500, 200, { radius: 600 });
$.sound.music('theme.ogg', { volume: 0.4, loop: true });
$.sound.crossfade('battle.ogg', 1.5);
```

---

## 1. Эффекты

| Вызов | Смысл |
|---|---|
| `play(file, opts?)` | проиграть ( `volume`, `pitch`, `loop`, `pan` ) |
| `playAt(file, x, y, opts?)` | позиционно от камеры |
| `stopAll()` / `stop(handle)` / `playing(handle)` / `count()` | управление каналами |
| `activeChannels()` | сколько каналов занято |
| `preload(file)` / `duration(file)` | подготовка и длительность |
| `volume(value?)` / `sfxVolume(value?)` / `mute(on?)` | общая и эффектовая громкость |

## 2. Музыка

| Вызов | Смысл |
|---|---|
| `music(file, opts?)` / `stopMusic()` / `musicPlaying()` | запуск и стоп |
| `musicVolume(value?)` / `musicPitch(value?)` | громкость и тон |
| `pauseMusic(on?)` | пауза музыки (эффекты продолжают) |
| `crossfade(file, seconds)` | переход между треками |

## 3. Ограничения

| Чего нет | Что делать |
|---|---|
| Реверба и эффектов по зонам | отдельная подсистема `$.audio.room` (см. [acoustics.md](acoustics.md)) |
| Честного 3D-звука | только панорама и громкость; высота не передаётся |
| Микширования в JS | всё делает SDL_mixer; свои эффекты — `$.audio` низкого уровня |
| Сжатия в рантайме | файлы берутся как есть (WAV/OGG/MP3) |

## 4. Связанное

* [sound_bank.md](sound_bank.md) — варианты одного звука (шаги, попадания);
* [acoustics.md](acoustics.md) — реверберация помещений;
* `$.steps`/`$.barks` — шаги по материалу и реплики NPC.
