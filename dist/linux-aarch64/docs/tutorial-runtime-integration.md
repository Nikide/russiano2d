# Туториал: runtime integration — HUD, язык, вставка, слои и переход

Как собрать «игру целиком» из готовых подсистем `$`: постоянный HUD на RmlUi,
переключение языка на ходу, короткая вставка на `$.timeline`, музыкальные слои
и переход между комнатами через область владения. Полный запускаемый пример —
[`demos/showcase`](../demos/showcase/README.md), автоматическая приёмка —
`python3 tools/run_tests.py showcase_test`.

Справочники по вызовам: [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md),
[ui.md](highlevel/ui.md), [i18n.md](highlevel/i18n.md),
[timeline.md](highlevel/timeline.md), [audiobus.md](highlevel/audiobus.md),
[scene.md](highlevel/scene.md).

---

## 1. Постоянный HUD на RmlUi

Документ RmlUi — не узел мира: его не снимают ни `$.scene.load`, ни закрытие
области владения. Поэтому HUD, загруженный один раз, переживает и переход
комнаты, и вставку.

```js
let hud = $.ui.doc('demos/showcase/rml/hud.rml').show();

function drawHud() {
    hud.text('hud-score', $.tr('hud.score', { score: state.score }));
    hud.text('hud-room',  $.tr('hud.room', { room: $.tr('room.' + state.room) }));
}
$.update(drawHud);            // один постоянный кадровый хук
```

Правила, которые видны в примере:

* **HUD не принадлежит комнате.** Его создают один раз (не в `enter`), иначе
  он умрёт вместе со сценой.
* **Значение приходит из игры.** HUD не «читает» мир сам: игра пишет строку, а
  HUD её показывает. В примере очки меняет маркер вставки — тест проверяет,
  что строка HUD обновилась.
* **Строки — ключи словаря.** `$.tr` вызывается в кадре, поэтому смена языка
  видна сразу.

## 2. Локализация без перезапуска

```js
$.i18n.add('ru', { 'hud.score': 'Очки: {score}' });
$.i18n.add('en', { 'hud.score': 'Score: {score}' });
$.i18n.lang('ru');  $.i18n.fallback('ru');

$.tr('hud.score', { score: 12 });   // → 'Очки: 12'
```

Реплики `$.dialog`/`$.timeline` переводятся сами, если строка совпала с ключом
словаря: текст разрешается в момент показа, поэтому смена языка действует на
следующую реплику. Демо-фасад `$.showcase.setLang('en')` переключает словарь и
сразу перерисовывает HUD; тест сверяет и строку HUD, и текст диалога.

## 3. Вставка на `$.timeline`

```js
$.timeline.define('showcase-intro', {
    backdrop: '#0b1020',
    script: [
        { narrate: 'intro.line1' },
        { narrate: 'intro.line2', emit: 'intro-mid' },   // маркер
        { do: () => $.showcase.addScore(5) },            // правка состояния игры
        { narrate: 'intro.line3' },
    ],
});

$.timeline.auto(500);                    // без нажатий: вставку можно догнать
$.timeline.play('showcase-intro', { transition: 'none' });
$.timeline.on('end', (e) => {
    // e.reason: 'end' — дошла сама, 'manual' — прервана stop()
    $.scene.load(back, { transition: 'none', scope: true });
});
$.timeline.stop('manual');               // прерывание
```

Что стоит помнить:

* таймлайн регистрирует **свою сцену** (`scene: id`), поэтому вставка — не
  overlay: мир комнаты на время вставки снимается, а после `end` комната
  собирается заново;
* `emit` в бите — маркер для игры (`$.timeline.on('имя', …)`), `do` — свой код;
* `stop(reason)` отличается от естественного конца по `e.reason` — различайте
  «прошла» и «прервана» в статистике и flow.

## 4. Музыкальные слои

```js
$.audio.bus('music.base', { parent: 'music', volume: 0.45 });
$.audio.bus('music.mid',  { parent: 'music', volume: 0 });
$.audio.play('demos/assets/audio/music/lobby_groove.mp3', { bus: 'music.base', loop: true });
$.audio.play('demos/assets/audio/music/action.ogg', { bus: 'music.mid', loop: true });

$.audio.volume('music.mid', 0.7);        // интенсивность боя выросла
```

Слои независимы: громкость слоя не трогает остальные, `$.audio.gain(name)`
показывает эффективную громкость с учётом родителей. **Чего нет:** общего
transport/clock для stems (§25) — нельзя стартовать слои с одной метки или
перемотать вместе. В примере это честно названо ограничением.

## 5. Переход комнаты через область владения (§5)

Область владения связывает узлы, подписки, таймеры, потоки и задачи комнаты,
не вводя второй scene graph. Переход — `prepare` → `commit`, отмена — `discard`:

```js
$.scene.add('lobby', { enter($, scope) { buildLobby($, scope); } });
$.scene.add('arena', {
    prepare($, scope) { buildArena($, scope); },   // временная область
    enter($, scope)   { state.room = 'arena'; },   // публикация
});

const next = $.scene.prepare('arena');
if (next.ok) $.scene.commit(next);       // старый мир закрывается после нового
else         $.scene.discard(next);      // сцена не опубликована
```

Свойства, на которые опирается пример:

* `prepare` строит мир во **временной** области; `discard` убирает его целиком,
  число узлов возвращается к прежнему — тест это проверяет;
* ошибка `prepare` не ломает текущую сцену: игра остаётся играбельной;
* `load(name, { scope: true })` — обычный переход с областью; persistent-узлы
  (`scene-persistent`, `attrs.persistent`) и RmlUi-документы остаются;
* закрытие области отложено до безопасной фазы кадра, поэтому `close()` можно
  звать из обработчика события.

Комната с областью собирается в `enter($, scope)`: узлы, созданные внутри
контекста (или с `{ scope: 'имя' }`), принадлежат области автоматически.

## 6. Чего не хватает сегодня (видно в примере)

| Чего нет | Обход в примере | Нужный пункт |
|---|---|---|
| Общий transport для stems, seek и синхронный старт | старт всех слоёв в одном кадре + громкость шин | §25 |
| Data-binding RmlUi на `$.store`/`$.i18n` | кадровый `$.ui.doc(...).text(el, $.tr(...))` | §16 |
| Невидимая подготовка staging-мира, progress | prepare виден один кадр | §45 |
| Вставка как overlay поверх комнаты | комната снимается и собирается заново | §10/§16 |

Ограничения перечислены рядом с API в [README примера](../demos/showcase/README.md),
а не только здесь.
