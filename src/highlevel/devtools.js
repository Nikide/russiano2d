// ===========================================================================
// DevTools: инспектор сущностей (F2) и диагностическая панель (F1) на RmlUi.
//
// Разделы docs/PRODUCTION_POLISH.md, которым подчиняется файл:
//   §17 PERF    — сводка кадра, график, перцентили, иерархический профиль;
//   §20 ENTITY  — поиск/фильтры и пять секций инспектора (F2);
//   §21 picking — режим «Pick entity»: клик по миру выбирает узел в F2.
//
// Законы, по которым он написан:
//   * RmlUi — единственный обычный UI DevTools (docs/UI_RMLUI_LAW.md): панели
//     строятся разметкой в памяти (engine.ui.loadMarkup), игровые ассеты не
//     нужны;
//   * данные берутся из существующих подсистем ($.agent, $.debug, $.reload,
//     engine.profile(), $.pick) — второй реализации поиска и второй
//     измеряющей обвязки нет (docs/DEVTOOLS.md §6–§7);
//   * неизмеримое значение показывается как N/A, выдуманных чисел в панели
//     быть не должно (§17.1). Поэтому, например, «батчи» и «render targets»
//     честно N/A: движок не отдаёт эти счётчики в JS.
//
// Переключение вкладок — engine.ui.setClass(doc, id, 'hidden', bool). Разметка
// создаётся один раз, слушатели живут на элементах, содержимое обновляется
// setText/setHtml/setClass — innerHTML панели не пересобирается.
//
// Данные инспектора берутся из `$.agent.nodes('*')` — того же описания узла,
// которым пользуется агент: DevTools, агент и игра видят одно описание.
// ===========================================================================

import { engine } from './native.js';
import { ctx, query } from './core.js';
import { effectiveProcessing } from './triggers.js';
import { getScope } from './scene.js';
import { prefabOf } from './prefab.js';

const ROWS = 24;              // сколько строк списка; остальное — «ещё N»
const REFRESH_FRAMES = 6;     // 10 Гц при 60 к/с: дешевле, чем каждый кадр
const HISTORY_MAX = 300;      // своё кольцо кадров, если движок не даёт history
const GRAPH_BARS = 48;        // столбцов в графике кадра
const HITCH_ROWS = 8;          // сколько захватов §18 видно в списке
const EVENTS_ROWS = 14;        // сколько записей $.trace видно на вкладке
const MEM_SAMPLES = 60;        // окно замеров счётчиков для поиска роста
const LEAK_RUN = 5;            // сколько замеров подряд считать ростом
const CONSOLE_HISTORY = 8;     // строк истории консоли
const CONSOLE_LOG = 12;        // строк лога консоли
const GRAPH_H = 56;           // высота области графика, px
const GRAPH_FLOOR_MS = 50;    // нижняя граница шкалы: 16.67 мс × 3
const FRAME_BUDGET_MS = 16.67; // бюджет кадра 60 к/с — порог подсветки
const NA = 'N/A';
const COPY_NONE = '—';

// Вкладки панели F1 и секции инспектора F2. Имена совпадают с id элементов
// `tab-<имя>`: по ним же переключается класс hidden.
const TABS = ['perf', 'hitch', 'physics', 'render', 'events', 'tree', 'diag',
              'audio', 'input', 'assets', 'memory', 'console', 'step', 'watch'];
const SECTIONS = ['identity', 'transform', 'gameplay', 'physics', 'presentation'];

// ---------------------------------------------------------------------------
// Разметка панелей. Строки вкладок объявлены здесь же — элементы существуют
// с момента создания документа, поэтому обработчики не теряются.
// ---------------------------------------------------------------------------

const MARKUP = `
<rml>
<head>
<style>
body { width: 100%; height: 100%; font-family: "Open Sans"; font-size: 13px; color: #dbe4f0; }
#dt { position: absolute; left: 12px; top: 12px; width: 760px; height: 520px;
      background-color: rgba(9,13,20,0.94); border-width: 1px; border-color: #33415a; }
#dt-title { display: block; padding: 4px 10px; color: #8fd8ff; }
#dt-bar { position: absolute; left: 10px; top: 28px; width: 740px; }
#dt-search { width: 140px; height: 24px; background-color: #203448; vertical-align: middle; }
#dt-list { position: absolute; left: 10px; top: 58px; width: 330px; height: 380px; }
#dt-secbar { position: absolute; left: 348px; top: 58px; }
#dt-inspect { position: absolute; left: 348px; top: 88px; width: 402px; height: 348px; }
#dt-foot { position: absolute; left: 10px; top: 446px; }
#dt-status { position: absolute; left: 10px; top: 480px; width: 740px; font-size: 11px; color: #a8b8cc; }
.dt-row { display: block; padding: 1px 6px; }
.dt-row.sel { background-color: #1d2c44; color: #ffffff; }
.dt-row.gone { display: none; }
.dt-sec { display: block; white-space: pre-wrap; font-size: 11px; }
.dt-sec span { display: block; }
.dt-sec b { color: #8fd8ff; }
button { padding: 3px 8px; margin: 1px; vertical-align: middle; }
button.on { background-color: #3d6a8f; color: #ffffff; }
input { width: 85px; height: 24px; background-color: #203448; vertical-align: middle; }
.hidden { display: none; }
</style>
</head>
<body>
<div id="dt">
  <div id="dt-title">DevTools — сущности (F2 — открыть/закрыть)</div>
  <div id="dt-bar">
    <input id="dt-search" type="text"/><button id="dt-search-go">Найти</button>
    <button id="dt-filter-visible">visible</button>
    <button id="dt-filter-physics">physics</button>
    <button id="dt-filter-active">active</button>
    <button id="dt-filter-room">room</button>
    <button id="dt-pick">Pick entity</button>
  </div>
  <div id="dt-list"></div>
  <div id="dt-secbar">
    <button id="dt-secbtn-identity">Identity</button>
    <button id="dt-secbtn-transform">Transform</button>
    <button id="dt-secbtn-gameplay">Gameplay</button>
    <button id="dt-secbtn-physics">Physics</button>
    <button id="dt-secbtn-presentation">Presentation</button>
  </div>
  <div id="dt-inspect">
    <div id="tab-identity" class="dt-sec"></div>
    <div id="tab-transform" class="dt-sec hidden"></div>
    <div id="tab-gameplay" class="dt-sec hidden"></div>
    <div id="tab-physics" class="dt-sec hidden"></div>
    <div id="tab-presentation" class="dt-sec hidden"></div>
  </div>
  <div id="dt-foot">
    <button id="dt-copy">Скопировать селектор</button>
    <button id="dt-copy-nid">Copy node ID</button>
    <button id="dt-copy-js">Copy JS</button>
  </div>
  <div id="dt-status"></div>
</div>
</body>
</rml>`;

const RUNTIME_MARKUP = `
<rml>
<head>
<style>
body { width: 100%; height: 100%; font-family: "Open Sans"; font-size: 13px; color: #dbe4f0; }
#rt { position: absolute; left: 12px; top: 12px; width: 760px; height: 560px;
      background-color: #0c1522; border-width: 1px; border-color: #33415a; }
#rt-title { display: block; padding: 4px 10px; color: #8fd8ff; }
#rt-tabs { position: absolute; left: 10px; top: 28px; }
.rt-tab { padding: 3px 8px; margin: 1px; }
.rt-tab.on { background-color: #3d6a8f; color: #ffffff; }
button.on { background-color: #3d6a8f; color: #ffffff; }
.rt-section { display: block; color: #8fd8ff; font-size: 12px; }
.rt-data { display: block; white-space: pre-wrap; font-size: 11px; }
.hidden { display: none; }
.rt-page { position: absolute; left: 10px; top: 76px; width: 740px; height: 388px; }
.rt-tabrow { display: block; }
#rt-phys-buttons { position: absolute; left: 0px; top: 22px; }
#rt-phys-mode { color: #a8b8cc; font-size: 11px; }
#rt-phys-table { position: absolute; left: 0px; top: 56px; width: 740px; height: 320px; overflow: hidden; }
#rt-render-info { position: absolute; left: 0px; top: 20px; width: 740px; height: 96px; }
#rt-render-targets { position: absolute; left: 0px; top: 132px; width: 740px; height: 96px; }
#rt-render-textures { position: absolute; left: 0px; top: 244px; width: 740px; height: 130px; }
#rt-events-buttons { position: absolute; left: 0px; top: 22px; }
#rt-events-list { position: absolute; left: 0px; top: 58px; width: 740px; height: 200px; overflow: hidden; }
#rt-events-detail { position: absolute; left: 0px; top: 266px; width: 740px; height: 116px; }
#rt-audio-info { position: absolute; left: 0px; top: 20px; width: 740px; height: 96px; }
#rt-audio-buses { position: absolute; left: 0px; top: 124px; width: 740px; height: 120px; }
#rt-audio-channels { position: absolute; left: 0px; top: 252px; width: 740px; height: 120px; }
#rt-audio-buttons { position: absolute; left: 0px; top: 88px; }
#rt-input-info { position: absolute; left: 0px; top: 20px; width: 740px; height: 76px; }
#rt-input-actions { position: absolute; left: 0px; top: 104px; width: 740px; height: 150px; overflow: hidden; }
#rt-input-issues { position: absolute; left: 0px; top: 262px; width: 740px; height: 120px; }
#rt-mem-counters { position: absolute; left: 0px; top: 20px; width: 740px; height: 96px; }
#rt-mem-limits { position: absolute; left: 0px; top: 124px; width: 740px; height: 120px; overflow: hidden; }
#rt-mem-leaks { position: absolute; left: 0px; top: 252px; width: 740px; height: 120px; }
#rt-mem-buttons { position: absolute; left: 0px; top: 88px; }
#rt-console-buttons { position: absolute; left: 0px; top: 22px; }
#rt-console-log { position: absolute; left: 0px; top: 58px; width: 500px; height: 220px; overflow: hidden; }
#rt-console-history { position: absolute; left: 512px; top: 58px; width: 228px; height: 220px; }
#rt-step-state { position: absolute; left: 0px; top: 20px; width: 740px; height: 90px; }
#rt-step-buttons { position: absolute; left: 0px; top: 118px; }
#rt-step-scales { position: absolute; left: 0px; top: 154px; }
#rt-step-notes { position: absolute; left: 0px; top: 200px; width: 740px; height: 180px; }
#rt-report-text { position: absolute; left: 0px; top: 250px; width: 740px; height: 130px; overflow: hidden; font-size: 10px; }
#rt-report-buttons { position: absolute; left: 0px; top: 214px; }
#rt-perf-summary { position: absolute; left: 0px; top: 18px; width: 740px; height: 130px; }
#rt-perf-graph-title { position: absolute; left: 0px; top: 154px; }
#rt-perf-graph { position: absolute; left: 0px; top: 176px; width: 500px; height: ${GRAPH_H}px;
                 background-color: #101a28; }
#rt-perf-stats { position: absolute; left: 0px; top: 240px; width: 740px; height: 58px; }
#rt-perf-buttons { position: absolute; left: 0px; top: 306px; }
#rt-tree-left { position: absolute; left: 0px; top: 20px; width: 360px; }
#rt-tree-right { position: absolute; left: 372px; top: 20px; width: 368px; }
#rt-stats { position: absolute; left: 0px; top: 0px; width: 740px; height: 44px; }
#rt-profile { position: absolute; left: 0px; top: 68px; width: 740px; height: 120px; }
#rt-limits { position: absolute; left: 0px; top: 216px; width: 740px; height: 80px; }
#rt-textures { position: absolute; left: 0px; top: 300px; width: 740px; height: 70px; }
#rt-assets { position: absolute; left: 0px; top: 20px; width: 740px; height: 60px; }
#rt-assets-buttons { position: absolute; left: 0px; top: 90px; }
#rt-assets-table { position: absolute; left: 0px; top: 120px; width: 740px; height: 250px; overflow: hidden; }
#rt-watches { position: absolute; left: 0px; top: 20px; width: 740px; height: 240px; }
#tab-hitch { position: absolute; left: 10px; top: 58px; width: 740px; height: 380px; }
#rt-hitch-buttons { position: absolute; left: 0px; top: 24px; }
#rt-hitch-list { position: absolute; left: 0px; top: 58px; width: 360px; height: 150px;
                 overflow: hidden; }
#rt-hitch-empty { position: absolute; left: 0px; top: 58px; color: #a8b8cc; }
#rt-hitch-detail { position: absolute; left: 372px; top: 58px; width: 368px; height: 150px; }
#rt-hitch-zones { position: absolute; left: 0px; top: 216px; width: 360px; height: 158px; }
#rt-hitch-graph { position: absolute; left: 372px; top: 232px; width: 368px; height: 56px;
                  background-color: #101a28; }
#rt-hitch-graph-labels { position: absolute; left: 372px; top: 292px; width: 368px; }
#rt-hitch-note { position: absolute; left: 372px; top: 330px; width: 368px; color: #a8b8cc; }
.rt-row { display: block; padding: 1px 4px; font-size: 11px; }
.rt-row.sel { background-color: #1d2c44; color: #ffffff; }
.rt-row.gone { display: none; }
.rt-hbar { position: absolute; bottom: 0px; width: 44px; background-color: #4a9ad4; }
.rt-hbar.peak { background-color: #d45a4a; }
#rt-watch-buttons { position: absolute; left: 0px; top: 270px; }
#rt-tools { position: absolute; left: 10px; top: 470px; width: 740px; }
#rt-error { display: block; font-size: 11px; color: #ffb0a0; }
.rt-bar { position: absolute; bottom: 0px; width: 5px; background-color: #4a9ad4; }
.rt-bar.over { background-color: #d4a24a; }
.rt-bar.peak { background-color: #d45a4a; }
button { padding: 3px 8px; margin: 1px; vertical-align: middle; }
input { width: 85px; height: 24px; background-color: #203448; vertical-align: middle; }
</style>
</head>
<body>
<div id="rt">
  <div id="rt-title">DevTools R2D (F1 — закрыть)</div>
  <div id="rt-tabs">
    <div class="rt-tabrow">
      <button id="rt-tab-perf" class="rt-tab">PERF</button>
      <button id="rt-tab-hitch" class="rt-tab">HITCH</button>
      <button id="rt-tab-physics" class="rt-tab">PHYS</button>
      <button id="rt-tab-render" class="rt-tab">RENDER</button>
      <button id="rt-tab-events" class="rt-tab">EVENTS</button>
      <button id="rt-tab-tree" class="rt-tab">ПРОФИЛЬ</button>
      <button id="rt-tab-diag" class="rt-tab">ДИАГ</button>
    </div>
    <div class="rt-tabrow">
      <button id="rt-tab-audio" class="rt-tab">AUDIO</button>
      <button id="rt-tab-input" class="rt-tab">INPUT</button>
      <button id="rt-tab-assets" class="rt-tab">ASSETS</button>
      <button id="rt-tab-memory" class="rt-tab">MEM</button>
      <button id="rt-tab-console" class="rt-tab">КОНСОЛЬ</button>
      <button id="rt-tab-step" class="rt-tab">ШАГ</button>
      <button id="rt-tab-watch" class="rt-tab">НАБЛЮД</button>
    </div>
  </div>

  <div id="tab-perf" class="rt-page">
    <div class="rt-section">Сводка кадра (§17.1). Неизмеряемое — N/A</div>
    <div id="rt-perf-summary" class="rt-data"></div>
    <div id="rt-perf-graph-title" class="rt-section">График кадра (§17.2): <span id="rt-perf-graph-src"></span></div>
    <div id="rt-perf-graph"></div>
    <div id="rt-perf-stats" class="rt-data"></div>
    <div id="rt-perf-buttons">
      <button id="rt-perf-profiler">Профайлер подсистем</button>
      <button id="rt-perf-reset">Сбросить профиль</button>
    </div>
  </div>

  <div id="tab-tree" class="rt-page hidden">
    <div class="rt-section">Иерархический профиль (§17.3–17.4): движковые зоны и $.debug.profiler.*</div>
    <div id="rt-tree-left" class="rt-data"></div>
    <div id="rt-tree-right" class="rt-data"></div>
  </div>

  <div id="tab-hitch" class="rt-page hidden">
    <div class="rt-section">Захваты долгих кадров (§18). Порог: <span id="rt-hitch-threshold"></span></div>
    <div id="rt-hitch-buttons">
      <button id="rt-hitch-th-16">16.67 мс</button>
      <button id="rt-hitch-th-25">25 мс</button>
      <button id="rt-hitch-th-33">33 мс</button>
      <button id="rt-hitch-th-50">50 мс</button>
      <input id="rt-hitch-th-custom" type="text"/><button id="rt-hitch-th-apply">Свой порог</button>
      <button id="rt-hitch-clear">Очистить</button>
    </div>
    <div id="rt-hitch-list"></div>
    <div id="rt-hitch-empty" class="rt-data">захватов нет</div>
    <div id="rt-hitch-detail" class="rt-data"></div>
    <div id="rt-hitch-zones" class="rt-data"></div>
    <div id="rt-hitch-graph"></div>
    <div id="rt-hitch-graph-labels" class="rt-data"></div>
    <div id="rt-hitch-note" class="rt-data"></div>
  </div>

  <div id="tab-physics" class="rt-page hidden">
    <div class="rt-section">Физика (§25): таблица тел и оверлей форм поверх кадра</div>
    <div id="rt-phys-buttons">
      <button id="rt-phys-sel">Только выбранный</button>
      <button id="rt-phys-all">Все</button>
      <button id="rt-phys-off">Выключить</button>
      <span id="rt-phys-mode"></span>
    </div>
    <div id="rt-phys-table" class="rt-data"></div>
  </div>

  <div id="tab-render" class="rt-page hidden">
    <div class="rt-section">Рендер (§26): счётчики кадра</div>
    <div id="rt-render-info" class="rt-data"></div>
    <div class="rt-section">Цели рендера и viewport</div>
    <div id="rt-render-targets" class="rt-data"></div>
    <div class="rt-section">Текстуры</div>
    <div id="rt-render-textures" class="rt-data"></div>
  </div>

  <div id="tab-events" class="rt-page hidden">
    <div class="rt-section">События (§28): журнал $.trace</div>
    <div id="rt-events-buttons">
      <button id="rt-events-pause">Пауза журнала</button>
      <button id="rt-events-clear">Очистить</button>
      <input id="rt-events-filter" type="text"/><button id="rt-events-apply">Фильтр kind</button>
      <button id="rt-events-hit">Цепочка hit</button>
    </div>
    <div id="rt-events-list" class="rt-data"></div>
    <div id="rt-events-detail" class="rt-data"></div>
  </div>

  <div id="tab-audio" class="rt-page hidden">
    <div class="rt-section">Звук (§29): голоса, шины, каналы</div>
    <div id="rt-audio-info" class="rt-data"></div>
    <div id="rt-audio-buttons">
      <input id="rt-audio-ch" type="text"/><button id="rt-audio-stop">Стоп канал</button>
      <input id="rt-audio-bus" type="text"/>
      <button id="rt-audio-mute">Mute звука</button>
      <button id="rt-audio-busmute">Mute шины</button>
      <button id="rt-audio-bussolo">Solo шины</button>
    </div>
    <div id="rt-audio-buses" class="rt-data"></div>
    <div id="rt-audio-channels" class="rt-data"></div>
  </div>

  <div id="tab-input" class="rt-page hidden">
    <div class="rt-section">Ввод (§29): действия, привязки, устройства</div>
    <div id="rt-input-info" class="rt-data"></div>
    <div id="rt-input-actions" class="rt-data"></div>
    <div id="rt-input-issues" class="rt-data"></div>
  </div>

  <div id="tab-memory" class="rt-page hidden">
    <div class="rt-section">Ресурсы и память (§29): счётчики, пределы, рост</div>
    <div id="rt-mem-counters" class="rt-data"></div>
    <div id="rt-mem-buttons">
      <button id="rt-mem-baseline">Сбросить базовую линию</button>
    </div>
    <div id="rt-mem-limits" class="rt-data"></div>
    <div id="rt-mem-leaks" class="rt-data"></div>
  </div>

  <div id="tab-console" class="rt-page hidden">
    <div class="rt-section">Консоль DevTools (§31): команды поверх существующих API</div>
    <div id="rt-console-buttons">
      <input id="rt-console-input" type="text"/><button id="rt-console-run">Выполнить</button>
      <button id="rt-console-clear">Очистить лог</button>
    </div>
    <div id="rt-console-log" class="rt-data"></div>
    <div id="rt-console-history"></div>
  </div>

  <div id="tab-step" class="rt-page hidden">
    <div class="rt-section">Время и шаг кадра (§33)</div>
    <div id="rt-step-state" class="rt-data"></div>
    <div id="rt-step-buttons">
      <button id="rt-step-pause">Пауза</button>
      <button id="rt-step-resume">Продолжить</button>
      <button id="rt-step-frame">Шаг кадра</button>
      <button id="rt-step-frames10">10 кадров</button>
      <button id="rt-step-hit">Hit-stop 120 мс</button>
      <button id="rt-step-slow">Замедление 0.5×/1 с</button>
      <button id="rt-step-reset">Сбросить время</button>
    </div>
    <div id="rt-step-scales">
      <button id="rt-step-scale-01">0.1×</button>
      <button id="rt-step-scale-025">0.25×</button>
      <button id="rt-step-scale-05">0.5×</button>
      <button id="rt-step-scale-1">1×</button>
      <button id="rt-step-scale-2">2×</button>
      <input id="rt-step-scale-custom" type="text"/><button id="rt-step-scale-apply">Свой</button>
    </div>
    <div id="rt-step-notes" class="rt-data"></div>
  </div>

  <div id="tab-diag" class="rt-page hidden">
    <div class="rt-section">Счётчики мира и кадра</div>
    <div id="rt-stats" class="rt-data"></div>
    <div class="rt-section">Профиль кадра CPU/GPU</div>
    <div id="rt-profile" class="rt-data"></div>
    <button id="rt-reset">Сбросить профиль</button>
    <div class="rt-section">Таблицы runtime</div>
    <div id="rt-limits" class="rt-data"></div>
    <div class="rt-section">Текстуры / отчёт (§39)</div>
    <div id="rt-textures" class="rt-data"></div>
    <div id="rt-report-buttons">
      <button id="rt-report-copy">Копировать текст отчёта</button>
      <button id="rt-report-copy-json">Копировать JSON</button>
    </div>
    <div id="rt-report-text" class="rt-data"></div>
  </div>

  <div id="tab-assets" class="rt-page hidden">
    <div class="rt-section">Ассеты §27 (hot reload)</div>
    <div id="rt-assets" class="rt-data"></div>
    <div id="rt-assets-table" class="rt-data"></div>
    <div id="rt-assets-buttons">
      <button id="rt-assets-reload">Перезагрузить ассеты</button>
      <button id="rt-assets-poll">Применить изменившиеся</button>
    </div>
  </div>

  <div id="tab-watch" class="rt-page hidden">
    <div class="rt-section">Наблюдения: значение / previous / delta / min / max / порог</div>
    <div id="rt-watches" class="rt-data"></div>
    <div id="rt-watch-buttons">
      <input id="rt-watch-th" type="text"/>
      <button id="rt-watch-apply">Порог (имя=значение)</button>
      <button id="rt-watch-reset">Сбросить мин/макс</button>
    </div>
  </div>

  <div id="rt-tools">
    Гравитация X<input id="rt-gx" type="text"/> Y<input id="rt-gy" type="text"/>
    <button id="rt-gravity">Применить</button>
    <button id="rt-reload">Перезапустить (F5)</button>
    <button id="rt-nodes">Инспектор узлов</button>
    <div id="rt-error"></div>
  </div>
</div>
</body>
</rml>`;

// ---------------------------------------------------------------------------
// Мелкие помощники: числа, текст, безопасный HTML.
// ---------------------------------------------------------------------------

/** Значение — конечное число? Только такие попадают в UI как числа. */
function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/** Число с фиксированной точностью или N/A. */
function numText(v, digits) {
    if (!isNum(v)) return NA;
    const d = digits === undefined ? 2 : digits;
    return v.toFixed(d);
}

/** Миллисекунды: «1.23 мс» или N/A. */
function msText(v, digits) {
    return isNum(v) ? numText(v, digits === undefined ? 2 : digits) + ' мс' : NA;
}

/** Целое или N/A (счётчики не выдумываем). */
function intText(v) {
    return isNum(v) ? String(Math.round(v)) : NA;
}

/** Текст или «—» для пустых/отсутствующих значений. */
function orDash(v) {
    if (v === undefined || v === null || v === '') return COPY_NONE;
    return String(v);
}

/** Экранирование пользовательских строк перед setHtml. */
function esc(v) {
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Вызов, который не должен ронять панель: ошибку показываем как N/A. */
function call(fn, fallback) {
    if (typeof fn !== 'function') return fallback;
    try {
        const v = fn();
        return v === undefined ? fallback : v;
    } catch (e) {
        return fallback;
    }
}

// ---------------------------------------------------------------------------
// Группировка зон профиля (§17.3). Имена меток — из api.js (порядок меток =
// порядок фаз кадра). Незнакомое имя — пользовательская зона (§17.4).
// ---------------------------------------------------------------------------

const SUB_ORDER = [
    'синк физики', 'контакты', 'сцена', 'время', 'логика игры', 'катсцена',
    'анимация+ввод', 'анимация', 'real2d', 'плеер анимации', 'состояния',
    'последовательности', 'задачи', 'области', 'экраны', 'диалоги', 'таймлайн',
    'tilemap', 'vfx', 'частицы', 'навигация', 'префабы', 'слои', 'виджеты',
    'триггеры', 'наблюдения', 'devtools', 'i18n', 'пулы', 'вьюпорты', 'http',
    'sdk', 'шины звука', 'акустика', 'интерфейс',
];

const SUB_GROUP = (() => {
    const g = {};
    const sim = ['синк физики', 'контакты', 'сцена', 'время', 'логика игры', 'катсцена',
                 'задачи', 'области', 'состояния', 'последовательности', 'триггеры',
                 'навигация', 'префабы', 'tilemap', 'наблюдения', 'пулы', 'вьюпорты',
                 'http', 'sdk', 'devtools', 'i18n', 'real2d'];
    const pres = ['анимация+ввод', 'анимация', 'плеер анимации', 'экраны', 'диалоги',
                  'таймлайн', 'vfx', 'частицы', 'слои', 'виджеты', 'интерфейс'];
    const audio = ['шины звука', 'акустика'];
    for (const n of sim) g[n] = 'simulation';
    for (const n of pres) g[n] = 'presentation';
    for (const n of audio) g[n] = 'audio';
    return g;
})();

const NATIVE_GROUP = {
    'JS: логика': 'simulation',
    'физика (Box2D)': 'simulation',
    'JS: сборка батча': 'presentation',
    'ожидание swapchain': 'presentation',
    'загрузка VB/IB': 'presentation',
    'draw-команды': 'presentation',
    'интерфейс (RmlUi)': 'presentation',
    'прочее': 'other',
    'GPU: кадр': 'gpu',
};

const GROUP_TITLE = {
    simulation: 'Simulation (§17.3)',
    presentation: 'Presentation (§17.3)',
    audio: 'Audio (§17.3)',
    user: 'Пользовательские зоны $.debug.profiler.* (§17.4)',
    other: 'Прочее',
    gpu: 'GPU',
};

export function installDevTools($) {
    const state = {
        doc: -1,
        open: false,
        selected_uid: null,
        selector: null,
        selected_nid: null,
        rows: 0,
        entities: 0,
        refreshed: 0,
        // §20: поиск и фильтры списка.
        search: '',
        search_kind: null,          // 'selector' | 'text' | null
        filters: { visible: false, physics: false, active: false, room: false },
        offset: 0,
        section: 'identity',
        // §21: режим выбора кликом по миру.
        pick: false,
        pick_hover_uid: null,
        last_pick: null,
        last_copied: null,
    };

    // Мостики к движку: без GUI (юнит-тест) они просто ничего не делают.
    function uiSetText(doc, id, text) {
        if (typeof engine === 'undefined' || !engine.ui) return;
        // setText в RmlUi разбирает строку как разметку, поэтому имена ассетов
        // и текстур вида «<memory 256x256>» превращались бы в элементы, а из
        // панели пропадали бы символы. Угловые скобки показываем похожими
        // знаками — это по-прежнему данные, но уже не разметка.
        const safe = String(text === undefined || text === null ? '' : text)
            .replace(/</g, '\u2039').replace(/>/g, '\u203a');
        engine.ui.setText(doc, id, safe);
    }
    function uiSetClass(doc, id, cls, add) {
        if (typeof engine !== 'undefined' && engine.ui) engine.ui.setClass(doc, id, cls, add);
    }
    function uiSetHtml(doc, id, html) {
        if (typeof engine !== 'undefined' && engine.ui) engine.ui.setHtml(doc, id, html);
    }
    function uiSetValue(doc, id, value) {
        if (typeof engine !== 'undefined' && engine.ui) engine.ui.setValue(doc, id, value);
    }
    function uiValue(doc, id) {
        if (typeof engine === 'undefined' || !engine.ui) return null;
        return engine.ui.getValue(doc, id);
    }
    function uiOk() {
        return typeof engine !== 'undefined' && engine.ui;
    }

    // -----------------------------------------------------------------------
    // §20: список сущностей, поиск и фильтры.
    // -----------------------------------------------------------------------

    /** Живые узлы реестра: uid → узел. Один проход, а не поиск на каждый узел. */
    function liveByUid() {
        const map = new Map();
        for (const node of ctx.nodes) if (!node.removed) map.set(node.uid, node);
        return map;
    }

    /** Описание узлов берём у агента — второго описания быть не должно (§7). */
    function agentBriefs() {
        if (ctx.agent && typeof ctx.agent.nodes === 'function') return ctx.agent.nodes('*');
        return [];
    }

    /** Селектор узла: id → класс → стабильный nid (уникален и всегда есть). */
    function selectorOf(node) {
        if (!node) return null;
        if (node.id) return `#${node.id}`;
        if (node.classes && node.classes.size > 0) return `.${[...node.classes][0]}`;
        if (node.nid) return `[nid=${node.nid}]`;
        return node.tag || null;
    }

    /** Имя prefab, из которого инстанцирован узел (§20.1), или null. */
    function prefabName(node) {
        return call(() => prefabOf(node), null);
    }

    /** Источник узла: script из attrs, иначе prefab, иначе неизвестен. */
    function sourceOf(node) {
        if (!node) return COPY_NONE;
        if (node.attrs && node.attrs.script) return String(node.attrs.script);
        const p = prefabName(node);
        return p ? `prefab:${p}` : COPY_NONE;
    }

    /** Узлы текущей опубликованной комнаты (§20: фильтр current room). */
    function roomNodeSet() {
        const rs = ctx.roomState;
        if (!rs || !rs.scope) return null;
        const scope = call(() => getScope(String(rs.scope)), null);
        if (!scope || typeof scope.nodes !== 'function') return null;
        const set = new Set();
        for (const n of scope.nodes()) set.add(n.uid);
        return set;
    }

    /** Строка поиска — селектор (если похожа) или подстрока по полям узла. */
    function applySearch(text) {
        state.search = String(text === undefined || text === null ? '' : text);
        const q = state.search.trim();
        state.search_kind = null;
        if (q) state.search_kind = /^[#.[]/.test(q) ? 'selector' : 'text';
        state.offset = 0;
        return state.search;
    }

    function searchSet(q) {
        const set = new Set();
        const found = call(() => query(q), []);
        for (const node of found || []) set.add(node.uid);
        return set;
    }

    function textMatch(node, brief, q) {
        const s = q.toLowerCase();
        // kind берём у самого узла: в nodeBrief он есть только для не-2D
        // (снимок 2D-игры не меняется), а поиск по kind нужен и для «2d».
        const parts = [
            brief.id, brief.tag, brief.class, node.kind, brief.state,
            prefabName(node), node.attrs ? node.attrs.state : null,
        ];
        for (const p of parts) {
            if (p === undefined || p === null) continue;
            if (String(p).toLowerCase().indexOf(s) >= 0) return true;
        }
        return false;
    }

    /**
     * Список пар «описание агента + живой узел» после поиска и фильтров.
     * Возвращает только факты: total — сколько прошло фильтр.
     */
    function filtered() {
        const map = liveByUid();
        const q = state.search.trim();
        const sel_set = q && state.search_kind === 'selector' ? searchSet(q) : null;
        const room = state.filters.room ? roomNodeSet() : null;
        const out = [];
        for (const brief of agentBriefs()) {
            const node = map.get(brief.uid);
            if (!node) continue;
            if (state.filters.visible && brief.visible !== true) continue;
            if (state.filters.physics && !(isNum(brief.body) && brief.body >= 0)) continue;
            if (state.filters.active && !call(() => effectiveProcessing(node).update !== false, true)) continue;
            if (state.filters.room && !(room && room.has(node.uid))) continue;
            if (q) {
                // Селектор пробуем как селектор; если он ничего не нашёл —
                // ищем тем же текстом по полям узла (поиск обязан находить).
                const ok = sel_set ? (sel_set.has(node.uid) || textMatch(node, brief, q))
                                   : textMatch(node, brief, q);
                if (!ok) continue;
            }
            out.push({ brief, node });
        }
        return out;
    }

    function rowText(brief, index) {
        const hp = brief.max_hp ? ` ${brief.hp}/${brief.max_hp}` : '';
        const name = brief.id ? `#${brief.id}` : `${brief.tag}#${brief.uid}`;
        const kind = brief.kind ? ` [${brief.kind}]` : '';
        return `${index + 1}. ${name} <${brief.tag}>${kind}${hp}`;
    }

    function setRow(doc, i, brief, selected) {
        const id = `dt-row-${i}`;
        if (!brief) {
            uiSetClass(doc, id, 'gone', true);
            return;
        }
        uiSetText(doc, id, rowText(brief, i));
        uiSetClass(doc, id, 'gone', false);
        uiSetClass(doc, id, 'sel', selected);
    }

    // -----------------------------------------------------------------------
    // §20.1–20.5: секции инспектора.
    // -----------------------------------------------------------------------

    function sectionRows(rows) {
        const clean = rows.map(([k, v]) => [k, orDash(v)]);
        const html = clean.map(([k, v]) => `<span>${esc(k)}: ${esc(v)}</span>`).join('');
        const text = clean.map(([k, v]) => `${k}: ${v}`).join('\n');
        return { rows: clean, html, text };
    }

    /**
     * Связь узла с ассетом §27: среди ассетов под наблюдением ($.reload.list)
     * ищем тот, чьё имя или путь совпадает с source/prefab узла. Ничего не
     * додумываем: нет совпадения — «—».
     */
    function reloadMatch(node) {
        if (!$.reload || typeof $.reload.list !== 'function') return null;
        const wanted = [];
        if (node.attrs && node.attrs.script) wanted.push(String(node.attrs.script));
        const prefab = prefabName(node);
        if (prefab) wanted.push(String(prefab));
        if (wanted.length === 0) return null;
        const list = call(() => $.reload.list(), []) || [];
        for (const item of list) {
            if (!item) continue;
            for (const key of [item.name, item.path]) {
                if (key && wanted.indexOf(String(key)) >= 0) {
                    return { name: item.name, kind: item.kind, version: item.version, status: item.status };
                }
            }
        }
        return null;
    }

    function identitySection(node) {
        const room = call(() => (ctx.scene ? ctx.scene.current() : null), null);
        // Владелец — область §5: показываем текущую комнату только если узел
        // действительно в её списке владения (иначе «—», а не догадка).
        const room_set = roomNodeSet();
        const owner = room_set && room_set.has(node.uid) ? String(room) : COPY_NONE;
        const tags = call(() => node.get('tags'), '');
        const asset = reloadMatch(node);
        return sectionRows([
            ['selector', selectorOf(node)],
            ['nid', node.nid],
            ['uid', node.uid],
            ['kind', node.kind],
            ['tag', node.tag],
            ['class', [...node.classes].join(' ') || COPY_NONE],
            ['tags', tags || COPY_NONE],
            ['prefab', prefabName(node) || COPY_NONE],
            ['source', sourceOf(node)],
            ['ассет ($.reload)', asset ? `${asset.name} v${asset.version} (${asset.status})` : COPY_NONE],
            ['owner (room)', owner],
            ['scene', room === null || room === undefined ? COPY_NONE : String(room)],
        ]);
    }

    function transformSection(node) {
        const parent = node.parent_node;
        const local = node.local_mode === true;
        return sectionRows([
            ['позиция (мир)', `${round2(node.x)}, ${round2(node.y)}`],
            ['позиция (локальная)', local ? `${round2(node.local_x)}, ${round2(node.local_y)}` : COPY_NONE],
            ['угол (мир)', `${round2(node.angle)} рад (${round2(node.angle * 180 / Math.PI)}°)`],
            ['угол (локальный)', local ? `${round2(node.local_angle)} рад` : COPY_NONE],
            ['масштаб', `${round2(node.scale_x === undefined ? 1 : node.scale_x)} × ${round2(node.scale_y === undefined ? 1 : node.scale_y)}`],
            ['размер', `${round2(node.w)} × ${round2(node.h)}`],
            ['родитель', parent ? selectorOf(parent) : COPY_NONE],
            ['детей', node.child_nodes.length],
        ]);
    }

    function gameplaySection(node) {
        const attrs = call(() => JSON.stringify(node.attrs), '{}');
        const state_attr = node.attrs ? node.attrs.state : undefined;
        const hp = node.max_hp > 0 ? `${round2(node.cur_hp)} / ${round2(node.max_hp)}` : COPY_NONE;
        return sectionRows([
            ['state', state_attr === undefined ? COPY_NONE : state_attr],
            ['hp (exposed)', hp],
            ['value / max', `${round2(node.value)} / ${round2(node.max_value)}`],
            ['team', node.team],
            ['speed', round2(node.speed)],
            ['alive', node.cur_hp > 0 && !node.removed ? 'да' : 'нет'],
            ['attrs', attrs.length > 320 ? attrs.slice(0, 320) + '…' : attrs],
        ]);
    }

    function physicsSection(node) {
        const a = call(() => $.debug.anatomy(node), null);
        const body = node.body >= 0 ? `${node.body} (${node.body_kind || '—'})` : COPY_NONE;
        const vel = node.body >= 0 ? call(() => engine.getVelocity(node.body), null) : null;
        const areas = a && a.areas ? a.areas.map((x) => `${x.name || '#' + x.index}${x.sensor ? ' (sensor)' : ''}`).join(', ') : '';
        const contacts = call(() => $.debug.contacts(), []) || [];
        const mine = contacts.filter((c) => c.self === node.nid || c.other === node.nid);
        const ground = a && a.ground ? (a.ground.on ? `да${a.ground.oneWay ? ' (one-way)' : ''}` : 'нет') : NA;
        // Формы тела — из engine.devtools.shapes (список, а не только число).
        const shape_list = node.body >= 0 && engine.devtools && typeof engine.devtools.shapes === 'function'
            ? call(() => engine.devtools.shapes(node.body), null) : null;
        const shapes = Array.isArray(shape_list)
            ? (shape_list.length
                ? shape_list.map((x) => `${x.kind}${x.sensor ? ' (sensor)' : ''}`).join(', ')
                : 'нет')
            : COPY_NONE;
        return sectionRows([
            ['body', body],
            ['формы (shapes)', shapes],
            ['скорость', vel ? `${round2(vel[0])}, ${round2(vel[1])} px/с` : COPY_NONE],
            ['области', areas || COPY_NONE],
            ['контакты (за шаг)', String(mine.length)],
            ['опора (floor)', ground],
            ['слой (layer bits)', node.body >= 0 ? '0x' + (node.layer_bits >>> 0).toString(16) : COPY_NONE],
            ['маска (mask)', node.body >= 0 ? '0x' + (node.collision_mask >>> 0).toString(16) : COPY_NONE],
            ['группа', node.body >= 0 ? String(node.collision_group) : COPY_NONE],
        ]);
    }

    function presentationSection(node) {
        const a = call(() => $.debug.anatomy(node), null);
        const windows = a && a.windows ? (Array.isArray(a.windows) ? a.windows.join(', ') : String(a.windows)) : '';
        const clip = node.attrs ? node.attrs.clip : undefined;
        const material = node.attrs ? node.attrs.material : undefined;
        const mask = node.attrs ? node.attrs.lightMask : undefined;
        let mat = COPY_NONE;
        if (typeof material === 'string') mat = material;
        else if (material && typeof material === 'object') mat = 'объект (inline)';
        return sectionRows([
            ['visible', node.visible ? 'да' : 'нет'],
            ['alpha', round2(node.alpha)],
            ['layer', node.layer],
            ['depth', node.depth],
            ['ключ сортировки', `layer ${node.layer} → depth ${node.depth} → y ${round2(node.y)}`],
            ['спрайт', node.sprite >= 0 ? String(node.sprite) : COPY_NONE],
            ['clip', clip === undefined || clip === null ? COPY_NONE : (clip === true ? 'по коробке' : JSON.stringify(clip))],
            ['анимация (окна)', windows || COPY_NONE],
            ['кадр анимации', isNum(node.frame_index) && node.frame_index > 0 ? String(node.frame_index) : COPY_NONE],
            ['материал', mat],
            ['маска света', mask === undefined ? 'все (по умолчанию)' : '0x' + (Number(mask) >>> 0).toString(16)],
        ]);
    }

    function round2(v) {
        return isNum(v) ? Math.round(v * 100) / 100 : v;
    }

    /** Выбранный узел (или null, если он уже удалён — это тоже факт). */
    function selectedNode() {
        if (state.selected_uid === null) return null;
        for (const node of ctx.nodes) {
            if (node.uid === state.selected_uid && !node.removed) return node;
        }
        return null;
    }

    /** Данные всех пяти секций выбранного узла (то же, что видно в панели). */
    function inspect() {
        const node = selectedNode();
        if (!node) {
            return { found: false, uid: state.selected_uid, nid: state.selected_nid,
                     selector: state.selector, sections: {} };
        }
        const sections = {
            identity: identitySection(node),
            transform: transformSection(node),
            gameplay: gameplaySection(node),
            physics: physicsSection(node),
            presentation: presentationSection(node),
        };
        return { found: true, uid: node.uid, nid: node.nid, selector: selectorOf(node), sections };
    }

    function setSection(name) {
        if (SECTIONS.indexOf(name) < 0) return false;
        state.section = name;
        if (state.doc >= 0) {
            for (const s of SECTIONS) {
                uiSetClass(state.doc, 'tab-' + s, 'hidden', s !== name);
                uiSetClass(state.doc, 'dt-secbtn-' + s, 'on', s === name);
            }
        }
        return true;
    }

    // -----------------------------------------------------------------------
    // §21: выбор сущности кликом по миру + подсветка bounds.
    // -----------------------------------------------------------------------

    /** Курсор в экранных координатах. */
    function mousePos() {
        if (typeof engine === 'undefined') return { x: 0, y: 0 };
        return { x: engine.mouseX, y: engine.mouseY };
    }

    /** Курсор над панелью? Тогда клик принадлежит панели, а не миру. */
    function overPanel(p) {
        if (!uiOk() || state.doc < 0 || typeof engine.ui.rect !== 'function') return false;
        const r = call(() => engine.ui.rect(state.doc, 'dt'), null);
        if (!r) return false;
        return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    }

    /** Узел под точкой экрана — через тот же $.pick, что и игра. */
    function pickAtScreen(p) {
        if (typeof $.pick !== 'function') return null;
        const world = ctx.camera && typeof ctx.camera.screenToWorld === 'function'
            ? ctx.camera.screenToWorld({ x: p.x, y: p.y })
            : { x: p.x, y: p.y };
        if (!world) return null;
        const wrapped = call(() => $.pick(world), null);
        const node = wrapped && wrapped.nodes && wrapped.nodes[0] ? wrapped.nodes[0] : null;
        return node ? { node, world } : null;
    }

    /** Клик по миру: выбрать узел и запомнить факт выбора (для панели и тестов). */
    function pickFromScreen(p) {
        if (!state.pick) return null;
        if (overPanel(p)) return null;
        const hit = pickAtScreen(p);
        if (!hit) {
            state.last_pick = null;
            return null;
        }
        const node = hit.node;
        select(node.uid);
        state.last_pick = {
            uid: node.uid, nid: node.nid, selector: selectorOf(node),
            source: sourceOf(node), tag: node.tag,
            screen: { x: round2(p.x), y: round2(p.y) },
            world: { x: round2(hit.world.x), y: round2(hit.world.y) },
        };
        // §21: панель обязана показать, что именно выбрано и откуда узел.
        status(`Pick: ${state.last_pick.selector} (источник: ${state.last_pick.source})`);
        return state.last_pick;
    }

    /** Подсветка bounds выбранного (красный) и наведённого (жёлтый) узла. */
    function highlight(node, color) {
        if (!node || !$.debug || !$.debug.draw) return;
        const hw = Math.abs(node.w) / 2;
        const hh = Math.abs(node.h) / 2;
        // Координаты МИРОВЫЕ: `$.debug.draw.*` принимает мир и переводит его в
        // экранные сам (docs/highlevel/fx.md, «$.debug.draw.* — мировые,
        // переводит модуль отладки»). Переводить здесь второй раз нельзя —
        // рамка уехала бы на смещение камеры (проверено пиксельно в
        // tests/agent/devtools_pick_test.py).
        call(() => $.debug.draw.rect({ x: node.x - hw, y: node.y - hh },
                                     { x: node.x + hw, y: node.y + hh }, color), null);
    }

    /** Кадровый шаг picking: подсветка наведения и клик по миру. */
    function tickPick() {
        if (!state.pick || state.doc < 0 || !state.open) return;
        const p = mousePos();
        const inside = overPanel(p);
        const hit = inside ? null : pickAtScreen(p);
        state.pick_hover_uid = hit ? hit.node.uid : null;
        if (hit) highlight(hit.node, '#ffd24a');
        const picked = selectedNode();
        if (picked) highlight(picked, '#ff5a4a');
        if (!inside && ctx.input && typeof ctx.input.mousePressed === 'function' && ctx.input.mousePressed(1)) {
            pickFromScreen(p);
        }
    }

    // -----------------------------------------------------------------------
    // Копирование (§21): Copy selector / Copy node ID / Copy JS.
    // -----------------------------------------------------------------------

    function copyText(text, what) {
        if (!text) return false;
        state.last_copied = { what, text: String(text) };
        if (typeof engine.setClipboard === 'function') engine.setClipboard(String(text));
        return true;
    }

    function copySelector() {
        return copyText(state.selector, 'selector');
    }
    function copyNodeId() {
        const node = selectedNode();
        return copyText(node ? node.nid : null, 'nid');
    }
    function copyJs() {
        const sel = state.selector;
        return copyText(sel ? `$('${sel}')` : null, 'js');
    }

    function status(text) {
        if (state.doc >= 0) uiSetText(state.doc, 'dt-status', text);
    }

    // -----------------------------------------------------------------------
    // Обновление панели сущностей (F2).
    // -----------------------------------------------------------------------

    function refresh(force) {
        if (!state.open || state.doc < 0) return state;
        state.refreshed++;
        if (!force && state.refreshed % REFRESH_FRAMES !== 0) return state;

        const all = filtered();
        state.entities = all.length;
        const view = all.slice(state.offset, state.offset + ROWS);
        state.rows = view.length;

        for (let i = 0; i < ROWS; i++) {
            const item = view[i] || null;
            const brief = item ? item.brief : null;
            if (brief && brief.uid === state.selected_uid) state.selector = selectorOf(item.node);
            setRow(state.doc, i, brief, !!brief && brief.uid === state.selected_uid);
        }

        const from = state.entities === 0 ? 0 : state.offset + 1;
        const to = state.offset + state.rows;
        const flt = Object.keys(state.filters).filter((k) => state.filters[k]);
        uiSetText(state.doc, 'dt-title',
            `DevTools — сущности: ${state.entities} (${from}–${to})`
            + (state.search ? ` | поиск ${state.search_kind === 'selector' ? 'селектором' : 'текстом'}: "${state.search}"` : '')
            + (flt.length ? ` | фильтры: ${flt.join(', ')}` : '')
            + ' | F2 — закрыть');

        // Секции инспектора: обновляем только тексты, разметка не пересобирается.
        const info = inspect();
        if (!info.found) {
            uiSetHtml(state.doc, 'tab-identity',
                `<span>${state.selected_uid === null ? 'Выберите сущность слева или включите Pick entity.' : 'Выбранная сущность исчезла из мира.'}</span>`);
            for (const s of SECTIONS) if (s !== 'identity') uiSetHtml(state.doc, 'tab-' + s, '');
            return state;
        }
        state.selector = info.selector;
        state.selected_nid = info.nid;
        for (const s of SECTIONS) uiSetHtml(state.doc, 'tab-' + s, info.sections[s].html);
        return state;
    }

    function select(uid) {
        state.selected_uid = uid === undefined ? null : uid;
        const node = selectedNode();
        state.selector = node ? selectorOf(node) : null;
        state.selected_nid = node ? node.nid : null;
        // §21: выбранный кликом узел обязан быть виден в списке — сдвигаем окно.
        if (node && state.open) {
            const all = filtered();
            const idx = all.findIndex((it) => it.node.uid === node.uid);
            if (idx >= 0 && (idx < state.offset || idx >= state.offset + ROWS)) {
                state.offset = Math.floor(idx / ROWS) * ROWS;
            }
        }
        refresh(true);
        return state.selector;
    }

    function selectBy(sel) {
        const node = query(sel)[0];
        return node ? select(node.uid) : null;
    }

    function setFilter(name, value) {
        if (!(name in state.filters)) return false;
        state.filters[name] = value === undefined ? !state.filters[name] : !!value;
        state.offset = 0;
        if (state.doc >= 0) uiSetClass(state.doc, 'dt-filter-' + name, 'on', state.filters[name]);
        refresh(true);
        status(`Фильтр ${name}: ${state.filters[name] ? 'включён' : 'выключен'} (сущностей ${state.entities})`);
        return state.filters[name];
    }

    function setPick(on) {
        state.pick = on === undefined ? !state.pick : !!on;
        if (state.doc >= 0) uiSetClass(state.doc, 'dt-pick', 'on', state.pick);
        status(state.pick
            ? 'Pick entity: кликните по объекту в мире (клик по панели не выбирает)'
            : 'Pick entity выключен');
        return state.pick;
    }

    function open() {
        if (typeof engine === 'undefined' || !engine.ui || typeof engine.ui.loadMarkup !== 'function') {
            ctx.log('$.devtools: сборка без RmlUi — панель недоступна');
            return false;
        }
        if (state.doc < 0) {
            state.doc = engine.ui.loadMarkup('devtools', MARKUP);
            if (state.doc < 0) {
                ctx.log('$.devtools: не удалось создать документ панели');
                return false;
            }
            uiSetHtml(state.doc, 'dt-list', Array.from({length: ROWS}, (_, i) =>
                `<div class="dt-row" id="dt-row-${i}"></div>`).join(''));
            // Строки и кнопки создаются один раз: обработчик в RmlUi живёт на
            // элементе, поэтому перерисовывать разметку нельзя — обновляем
            // текст и классы (иначе слушатели исчезли бы вместе с элементами).
            for (let i = 0; i < ROWS; i++) {
                engine.ui.on(state.doc, `dt-row-${i}`, 'click', () => {
                    const all = filtered();
                    const item = all[state.offset + i];
                    if (item) select(item.node.uid);
                });
            }
            engine.ui.on(state.doc, 'dt-search-go', 'click', () => {
                applySearch(uiValue(state.doc, 'dt-search'));
                refresh(true);
                status(`Поиск: ${state.search || 'пусто'} → ${state.entities} сущностей`);
            });
            engine.ui.on(state.doc, 'dt-copy', 'click', () => {
                copySelector();
                ctx.log(`$.devtools: селектор ${state.selector || '—'} в буфере обмена`);
                status(`Скопировано: ${state.last_copied ? state.last_copied.text : COPY_NONE}`);
            });
            engine.ui.on(state.doc, 'dt-copy-nid', 'click', () => {
                copyNodeId();
                status(`Скопировано: ${state.last_copied ? state.last_copied.text : COPY_NONE}`);
            });
            engine.ui.on(state.doc, 'dt-copy-js', 'click', () => {
                copyJs();
                status(`Скопировано: ${state.last_copied ? state.last_copied.text : COPY_NONE}`);
            });
            engine.ui.on(state.doc, 'dt-pick', 'click', () => setPick());
            for (const name of ['visible', 'physics', 'active', 'room']) {
                engine.ui.on(state.doc, `dt-filter-${name}`, 'click', () => setFilter(name));
            }
            for (const name of SECTIONS) {
                engine.ui.on(state.doc, `dt-secbtn-${name}`, 'click', () => setSection(name));
            }
        }
        const w = Math.max(560, Math.min(760, engine.width - 24));
        const h = Math.max(360, Math.min(520, engine.height - 24));
        engine.ui.setProperty(state.doc, 'dt', 'width', w + 'px');
        engine.ui.setProperty(state.doc, 'dt', 'height', h + 'px');
        engine.ui.show(state.doc);
        state.open = true;
        setSection(state.section);
        for (const name of ['visible', 'physics', 'active', 'room']) {
            uiSetClass(state.doc, `dt-filter-${name}`, 'on', state.filters[name]);
        }
        uiSetClass(state.doc, 'dt-pick', 'on', state.pick);
        refresh(true);
        return true;
    }

    function close() {
        if (state.doc >= 0 && typeof engine !== 'undefined' && engine.ui) engine.ui.hide(state.doc);
        state.open = false;
        return true;
    }

    // =======================================================================
    // Панель F1: вкладки, PERF, дерево профиля, диагностика, ассеты, наблюдения.
    // =======================================================================

    const runtime = {
        open: false, doc: -1, frames: 0, snapshot: null,
        tab: 'perf',
        graph_samples: [],       // свои замеры, когда движок не отдаёт history
        watch_stats: new Map(),  // имя → { prev, min, max, threshold }
        // §18: выбранный захват. pinned=false — панель сама показывает самый
        // свежий; pinned=true — выбор сделан кликом и не перебивается новыми.
        hitch: { selected: null, pinned: false },
        phys_mode: 'off',            // §25: off | all | selected
        events: { filter: '', paused: false, snapshot: null, force_hit: null },   // §28
        mem: { samples: [], baseline: null },                    // §29
        console: { history: [], log: [], last: null },           // §31
        step_left: 0,                // §33: осталось кадров «шага»
    };

    // --- §17.1: сводка кадра ------------------------------------------------

    /** Время метки подсистемы из $.debug.profiler.report() (или null). */
    function subTime(report, names) {
        if (!report) return null;
        let sum = 0;
        let found = false;
        for (const n of names) {
            const t = report[n];
            if (t && isNum(t.avg_ms)) { sum += t.avg_ms; found = true; }
        }
        return found ? sum : null;
    }

    /**
     * Сводка §17.1. Каждое поле несёт источник; всё неизмеряемое — null
     * (в тексте N/A). Числа берутся только из движка.
     */
    function perfData() {
        const stats = call(() => $.debug.stats(), {}) || {};
        const counters = stats.counters || call(() => $.debug.counters(), {}) || {};
        const limits = call(() => $.debug.limits(), {}) || {};
        const prof = call(() => $.debug.profile(), null);
        const rows = prof && Array.isArray(prof.rows) ? prof.rows : [];
        const render = call(() => $.debug.render(), null);
        const info = render && render.info ? render.info : null;
        const light = call(() => ($.gfx && $.gfx.light && $.gfx.light.stats ? $.gfx.light.stats() : null), null);
        const textures = call(() => $.debug.textures(), []) || [];
        const profiler_on = call(() => $.debug.profiler.isOn(), false);
        const report = profiler_on ? call(() => $.debug.profiler.report(), null) : null;
        // Таймеры — публичный счётчик живых таймеров шага симуляции и ожиданий.
        const timers = call(() => ($.time && typeof $.time.timers === 'function'
            ? $.time.timers() : null), null);

        const zone = (name) => {
            for (const r of rows) if (r && r.name === name && r.valid !== false && isNum(r.ms)) return r.ms;
            return null;
        };
        const zoneSum = (names) => {
            let sum = 0;
            let found = false;
            for (const n of names) {
                const v = zone(n);
                if (v !== null) { sum += v; found = true; }
            }
            return found ? sum : null;
        };

        const gpu_available = !!(prof && prof.gpu_available === true);
        const gpu_ms = gpu_available && prof && isNum(prof.gpu_ms) && prof.gpu_ms >= 0 ? prof.gpu_ms : null;

        // Формы: сумма по живым телам. Источника два, и оба честные:
        // engine.devtools.shapes(body) (подробный список форм) и
        // engine.shapeCount(body) — им пользуются, если первого нет.
        // Дубли body id не считаем дважды.
        let shapes = null;
        const shapesOf = (typeof engine.devtools === 'object' && engine.devtools &&
                          typeof engine.devtools.shapes === 'function')
            ? (body) => call(() => (engine.devtools.shapes(body) || []).length, null)
            : (typeof engine.shapeCount === 'function' ? (body) => call(() => engine.shapeCount(body), null) : null);
        if (shapesOf) {
            const seen = new Set();
            let sum = 0;
            for (const node of ctx.nodes) {
                if (node.removed || !(node.body >= 0)) continue;
                if (seen.has(node.body)) continue;
                seen.add(node.body);
                const n = shapesOf(node.body);
                if (isNum(n)) sum += n;
            }
            shapes = seen.size > 0 ? sum : 0;
        }

        const rows_spec = [
            ['fps', 'FPS', isNum(stats.fps) ? stats.fps : null, '', '$.debug.stats().fps'],
            ['frame_ms', 'кадр', isNum(stats.frame_ms) ? stats.frame_ms : null, 'мс', '$.debug.stats().frame_ms'],
            ['simulation_ms', 'симуляция CPU', zone('JS: логика'), 'мс', 'engine.profile().rows «JS: логика»'],
            ['render_ms', 'рендер CPU', zoneSum(['JS: сборка батча', 'загрузка VB/IB', 'draw-команды']), 'мс', 'engine.profile().rows (батч+upload+draw)'],
            ['gpu_ms', 'GPU', gpu_ms, 'мс', gpu_available ? 'engine.profile().gpu_ms' : 'engine.profile().gpu_available = false'],
            ['physics_ms', 'физика', zone('физика (Box2D)'), 'мс', 'engine.profile().rows «физика (Box2D)»'],
            ['js_ms', 'JS (метки подсистем)', subTime(report, SUB_ORDER), 'мс', profiler_on ? '$.debug.profiler.report()' : 'профайлер подсистем выключен'],
            ['animation_ms', 'анимация', subTime(report, ['анимация', 'анимация+ввод', 'плеер анимации']), 'мс', '$.debug.profiler.report()'],
            ['ui_ms', 'UI', zone('интерфейс (RmlUi)') !== null ? zone('интерфейс (RmlUi)') : subTime(report, ['интерфейс']), 'мс', 'engine.profile().rows / $.debug.profiler'],
            ['audio_ms', 'звук', subTime(report, ['шины звука', 'акустика']), 'мс', '$.debug.profiler.report()'],
            ['contacts', 'контактов (живых)', isNum(limits.contact_events) ? limits.contact_events : null, '', 'engine.limits().contact_events'],
            ['draw_calls', 'draw calls', info && isNum(info.draw_calls) ? info.draw_calls
                : (info && isNum(info.draws) ? info.draws : null), '', 'engine.renderInfo().draw_calls'],
            ['batches', 'батчи', info && isNum(info.batches) ? info.batches : null, '', 'engine.renderInfo().batches'],
            ['sprites', 'спрайтов за кадр', isNum(stats.sprites) ? stats.sprites : null, '', '$.debug.stats().sprites'],
            ['particles', 'частиц', isNum(counters.particles) ? counters.particles : null, '', '$.debug.counters().particles'],
            ['lights', 'источников света', light && isNum(light.lights) ? light.lights : null, '', '$.gfx.light.stats().lights'],
            ['shadow_lights', 'источников с тенями', light && isNum(light.shadowLights) ? light.shadowLights : null, '', '$.gfx.light.stats().shadowLights'],
            ['bodies', 'тел', isNum(counters.bodies) ? counters.bodies : null, '', '$.debug.counters().bodies'],
            ['shapes', 'форм', shapes, '', 'Σ engine.devtools.shapes(тело).length'],
            ['nodes', 'узлов', isNum(counters.nodes) ? counters.nodes : null, '', '$.debug.counters().nodes'],
            ['timers', 'таймеров', timers && isNum(timers.total) ? timers.total : null, '',
                '$.time.timers().total (after/every/waits)'],
            ['tweens', 'твинов', isNum(counters.tweens) ? counters.tweens : null, '', '$.debug.counters().tweens'],
            ['audio_voices', 'голосов звука', isNum(stats.sounds) ? stats.sounds : null, '', '$.debug.stats().sounds'],
            ['textures', 'текстур', isNum(limits.textures) ? limits.textures
                : (info && info.textures && isNum(info.textures.count) ? info.textures.count : textures.length),
                '', 'engine.limits().textures'],
            ['render_targets', 'render targets', info && Array.isArray(info.targets) ? info.targets.length : null,
                '', 'engine.renderInfo().targets'],
        ];

        const rows_out = rows_spec.map(([key, label, value, unit, source]) => {
            const measured = isNum(value);
            const text = `${label}: ${measured ? (unit ? numText(value, 2) + ' ' + unit : String(Math.round(value * 100) / 100)) : NA}`;
            return { key, label, value: measured ? value : null, unit, source, measured, text };
        });
        const summary = {};
        for (const r of rows_out) summary[r.key] = r.value;

        const lines = [];
        for (let i = 0; i < rows_out.length; i += 3) {
            lines.push(rows_out.slice(i, i + 3).map((r) => r.text).join(' | '));
        }
        const summary_extra = { timers_detail: timers };
        return { rows: rows_out, summary, text: lines.join('\n'), profiler_on, timers: summary_extra.timers_detail };
    }

    // --- §17.2: график кадра и перцентили -----------------------------------

    function percentile(sorted, p) {
        if (!sorted.length) return null;
        const idx = (sorted.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return sorted[lo];
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    }

    function graphData(perf) {
        const prof = call(() => $.debug.profile(), null);
        const engine_hist = prof && Array.isArray(prof.history) ? prof.history.filter(isNum) : null;
        const engine_stats = prof && prof.stats && isNum(prof.stats.current) ? prof.stats : null;
        const from_engine = !!(engine_hist && engine_hist.length > 0);
        const samples = from_engine ? engine_hist.slice() : runtime.graph_samples.slice();
        const source = from_engine
            ? 'engine.profile().history'
            : '$.debug.stats().frame_ms (свои замеры, ~10 Гц)';

        let stats_out;
        let stats_source;
        if (engine_stats) {
            stats_out = {
                current: engine_stats.current, min: engine_stats.min, mean: engine_stats.mean,
                p50: engine_stats.p50, p95: engine_stats.p95, p99: engine_stats.p99,
                max: engine_stats.max, count: engine_stats.count,
            };
            stats_source = 'engine.profile().stats';
        } else {
            const sorted = samples.slice().sort((a, b) => a - b);
            const sum = samples.reduce((a, b) => a + b, 0);
            stats_out = {
                current: samples.length ? samples[samples.length - 1] : null,
                min: sorted.length ? sorted[0] : null,
                mean: sorted.length ? sum / sorted.length : null,
                p50: percentile(sorted, 0.5),
                p95: percentile(sorted, 0.95),
                p99: percentile(sorted, 0.99),
                max: sorted.length ? sorted[sorted.length - 1] : null,
                count: samples.length,
            };
            stats_source = 'свои замеры $.debug.stats().frame_ms';
        }

        // Столбцы: если замеров больше, чем столбцов — берём равномерную выборку.
        const bars = [];
        if (samples.length > 0) {
            const n = Math.min(GRAPH_BARS, samples.length);
            const step = samples.length / n;
            const top = Math.max(GRAPH_FLOOR_MS, stats_out.max === null || stats_out.max === undefined ? 0 : stats_out.max);
            for (let i = 0; i < n; i++) {
                const ms = samples[Math.min(samples.length - 1, Math.floor(i * step))];
                const h = Math.max(1, Math.min(GRAPH_H, Math.round((ms / top) * GRAPH_H)));
                const cls = ms >= FRAME_BUDGET_MS * 2 ? 'peak' : (ms > FRAME_BUDGET_MS ? 'over' : '');
                bars.push({ ms: Math.round(ms * 100) / 100, h, cls });
            }
        }

        const stats_text = 'текущий ' + msText(stats_out.current)
            + ' | мин ' + msText(stats_out.min)
            + ' | среднее ' + msText(stats_out.mean)
            + ' | p50 ' + msText(stats_out.p50)
            + ' | p95 ' + msText(stats_out.p95)
            + ' | p99 ' + msText(stats_out.p99)
            + ' | макс ' + msText(stats_out.max)
            + ' | замеров ' + intText(stats_out.count) + ' (' + stats_source + ')';

        return { source, samples, bars, stats: stats_out, stats_source, text: stats_text, floor_ms: GRAPH_FLOOR_MS };
    }

    /** Столбцы графика — разметкой: высота в px, поэтому картинка = данные. */
    function graphHtml(graph) {
        return graph.bars.map((b, i) =>
            `<div class="rt-bar${b.cls ? ' ' + b.cls : ''}" id="rt-graph-bar-${i}" `
            + `style="left: ${i * 6}px; height: ${b.h}px;"></div>`).join('');
    }

    // --- §17.3–17.4: иерархический профиль ----------------------------------

    function treeData() {
        const prof = call(() => $.debug.profile(), null);
        const rows = prof && Array.isArray(prof.rows) ? prof.rows : [];
        const profiler_on = call(() => $.debug.profiler.isOn(), false);
        const report = profiler_on ? call(() => $.debug.profiler.report(), null) : null;

        const groups = { simulation: [], presentation: [], audio: [], other: [], user: [], gpu: [] };
        for (const r of rows) {
            if (!r) continue;
            const g = NATIVE_GROUP[r.name] || 'other';
            groups[g].push({
                name: r.name,
                ms: r.valid === false ? null : (isNum(r.ms) ? r.ms : null),
                peak: r.valid === false ? null : (isNum(r.peak) ? r.peak : null),
                calls: null,
                source: 'engine.profile().rows',
            });
        }
        if (report) {
            const known = [];
            const rest = [];
            for (const name of Object.keys(report)) {
                if (SUB_ORDER.indexOf(name) >= 0) known.push(name); else rest.push(name);
            }
            known.sort((a, b) => SUB_ORDER.indexOf(a) - SUB_ORDER.indexOf(b));
            for (const name of known.concat(rest)) {
                const t = report[name];
                const g = SUB_GROUP[name] || 'user';
                groups[g].push({
                    name, ms: isNum(t.avg_ms) ? t.avg_ms : null,
                    peak: isNum(t.max_ms) ? t.max_ms : null,
                    calls: isNum(t.calls) ? t.calls : null,
                    source: SUB_GROUP[name] ? '$.debug.profiler' : '$.debug.profiler (пользовательская зона)',
                });
            }
        }

        const pad = (s, n) => {
            let out = String(s);
            while (out.length < n) out += ' ';
            return out;
        };
        const renderGroups = (names) => {
            const out = [];
            for (const g of names) {
                const list = groups[g];
                if (!list || list.length === 0) continue;
                out.push(GROUP_TITLE[g]);
                for (const r of list) {
                    const peak = r.peak !== null ? ' (пик ' + numText(r.peak, 3) + ')' : '';
                    const calls = r.calls !== null ? ' ×' + r.calls : '';
                    out.push('  ' + pad(r.name, 24) + pad(msText(r.ms, 3) + calls + peak, 22));
                }
            }
            return out.join('\n');
        };

        const left = renderGroups(['simulation']);
        const right = renderGroups(['presentation', 'audio', 'user', 'other', 'gpu']);
        const note = profiler_on
            ? ''
            : '\nпрофайлер подсистем выключен: метки $.debug.profiler не записаны '
              + '(кнопка «Профайлер подсистем» на вкладке PERF)';
        return {
            profiler_on,
            groups,
            native_rows: rows.length,
            text: { left: left + note, right },
        };
    }

    // --- §17.5: наблюдения (previous/delta/min/max/порог) -------------------

    function watchRows() {
        const list = call(() => $.debug.watches(), []) || [];
        const out = [];
        for (const w of list) {
            const v = w && isNum(w.value) ? w.value : null;
            let st = runtime.watch_stats.get(w.name);
            if (!st) { st = { prev: null, min: null, max: null, threshold: null }; runtime.watch_stats.set(w.name, st); }
            if (v !== null) {
                st.min = st.min === null ? v : Math.min(st.min, v);
                st.max = st.max === null ? v : Math.max(st.max, v);
            }
            const delta = (v !== null && st.prev !== null) ? v - st.prev : null;
            const hit = (v !== null && st.threshold !== null) ? Math.abs(v) >= st.threshold : false;
            out.push({
                name: w.name, value: v, previous: st.prev, delta, min: st.min, max: st.max,
                threshold: st.threshold, threshold_hit: hit,
                text: `${w.name}: ${v === null ? NA : numText(v, 3)}`
                    + ` | previous ${st.prev === null ? NA : numText(st.prev, 3)}`
                    + ` | delta ${delta === null ? NA : numText(delta, 3)}`
                    + ` | min ${st.min === null ? NA : numText(st.min, 3)}`
                    + ` | max ${st.max === null ? NA : numText(st.max, 3)}`
                    + ` | порог ${st.threshold === null ? COPY_NONE : numText(st.threshold, 3)}`
                    + (hit ? ' ПРЕВЫШЕН' : ''),
            });
            st.prev = v === null ? st.prev : v;
        }
        return out;
    }

    function watchText() {
        const rows = watchRows();
        if (rows.length === 0) return 'Наблюдений нет: $.debug.watch("hp", () => 42)';
        return rows.map((r) => r.text).join('\n');
    }

    function watchThreshold(name, value) {
        if (typeof name !== 'string' || !name) return false;
        let st = runtime.watch_stats.get(name);
        if (!st) { st = { prev: null, min: null, max: null, threshold: null }; runtime.watch_stats.set(name, st); }
        if (value === null || value === false || value === undefined) st.threshold = null;
        else if (isNum(value)) st.threshold = value;
        else return false;
        return true;
    }

    function watchReset() {
        for (const st of runtime.watch_stats.values()) { st.prev = null; st.min = null; st.max = null; }
        return true;
    }

    // --- §18: захваты долгих кадров (hitch detector) ------------------------

    /** Биндинги движка (без них вкладка честно скажет, что данных нет). */
    function hitchApi() {
        const h = (typeof engine === 'undefined') ? null : engine.hitch;
        if (!h || typeof h.count !== 'function' || typeof h.get !== 'function') return null;
        return h;
    }

    /** Один захват в терминах панели: только факты из записи движка. */
    function normalizeCapture(index, c) {
        if (!c || typeof c !== 'object') return null;
        const center = isNum(c.center) ? c.center : 0;
        const zones = Array.isArray(c.zones) ? c.zones : [];
        const zoneRows = (zones[center] && Array.isArray(zones[center]) ? zones[center] : [])
            .map((z) => ({
                name: z && z.name ? String(z.name) : COPY_NONE,
                ms: z && isNum(z.ms) ? z.ms : null,
            }));
        return {
            index,
            frame: isNum(c.frame) ? c.frame : null,
            frame_ms: isNum(c.frame_ms) ? c.frame_ms : null,
            real_ms: isNum(c.real_ms) ? c.real_ms : null,
            threshold_ms: isNum(c.threshold_ms) ? c.threshold_ms : null,
            center,
            filled: isNum(c.filled) ? c.filled : 0,
            zones_ms: isNum(c.zones_ms) ? c.zones_ms : null,
            unaccounted_ms: isNum(c.unaccounted_ms) ? c.unaccounted_ms : null,
            reason: c.reason ? String(c.reason) : null,
            reason_zone: isNum(c.reason_zone) ? c.reason_zone : null,
            reason_ms: isNum(c.reason_ms) ? c.reason_ms : null,
            ms: Array.isArray(c.ms) ? c.ms.filter(isNum) : [],
            zones_count: zones.length,
            zone_rows: zoneRows,
            context_before: center,
            context_after: Math.max(0, (isNum(c.filled) ? c.filled : 0) - center - 1),
        };
    }

    /** Причина захвата: имя зоны из записи + её время (§18). */
    function hitchReasonText(rec) {
        if (!rec || !rec.reason) return COPY_NONE;
        const where = rec.reason_zone === null ? '' : ` (зона #${rec.reason_zone})`;
        return `${rec.reason}${where}${rec.reason_ms !== null ? ' — ' + msText(rec.reason_ms) : ''}`;
    }

    /**
     * Строка списка захватов (§18): номер кадра, время кадра, порог и причина.
     * Формат намеренно короткий — строка списка должна остаться одной строкой,
     * иначе восемь захватов не помещаются в свою область панели.
     */
    function hitchRowText(rec) {
        const cause = rec.reason
            ? rec.reason + (rec.reason_ms !== null ? ' ' + msText(rec.reason_ms) : '')
            : COPY_NONE;
        return `кадр ${rec.frame === null ? COPY_NONE : rec.frame}: ${msText(rec.frame_ms)}`
            + `, порог ${rec.threshold_ms === null ? NA : numText(rec.threshold_ms, 0)}`
            + `, ${cause}`;
    }

    function hitchData() {
        const h = hitchApi();
        if (!h) {
            return {
                available: false, count: 0, total: 0, threshold: null,
                list: [], selected: null, capture: null,
                text: { list: '', detail: 'Захватов нет: движок без hitch-детектора.',
                        zones: '', graph: '', threshold: NA },
            };
        }
        const count = call(() => h.count(), 0) || 0;
        const total = call(() => h.total(), 0) || 0;
        const threshold = call(() => (typeof h.threshold === 'function' ? h.threshold() : null), null);
        const list = [];
        for (let i = 0; i < count; i++) {
            const rec = normalizeCapture(i, call(() => h.get(i), null));
            if (rec) list.push(rec);
        }
        // Выбор: пока захват не выбран кликом, показываем самый свежий
        // (get(0) — самый старый, get(count-1) — новый). Иначе новый захват
        // «уезжал» бы вниз списка, а панель продолжала показывать старый.
        let selected = null;
        if (runtime.hitch.pinned && runtime.hitch.selected !== null
            && runtime.hitch.selected >= 0 && runtime.hitch.selected < list.length) {
            selected = runtime.hitch.selected;
        } else {
            runtime.hitch.pinned = false;
            selected = list.length > 0 ? list.length - 1 : null;
        }
        runtime.hitch.selected = selected;
        const capture = selected === null ? null : list[selected];

        // Тексты — те же, что уходят в панель.
        const listText = list.map(hitchRowText).join('\n');
        let detail = 'Захватов нет: долгих кадров выше порога не было.';
        let zonesText = '';
        let graphText = '';
        if (capture) {
            detail = `Выбран захват #${capture.index} (i=${capture.index}): кадр `
                + `${capture.frame === null ? COPY_NONE : capture.frame}\n`
                + `кадр ${msText(capture.frame_ms)} | реальный dt ${msText(capture.real_ms)}`
                + ` | порог ${capture.threshold_ms === null ? NA : numText(capture.threshold_ms, 2)} мс\n`
                + `зоны кадра ${msText(capture.zones_ms)} | неучтено ${msText(capture.unaccounted_ms)}`
                + ` | контекст ${intText(capture.filled)} (${capture.context_before} до / ${capture.context_after} после)\n`
                + `причина: ${hitchReasonText(capture)}`;
            zonesText = capture.zone_rows.length
                ? capture.zone_rows.map((z, i) =>
                    `${i === capture.reason_zone ? '→ ' : '  '}${z.name}: ${msText(z.ms)}`).join('\n')
                  + `\nИтого зон: ${msText(capture.zones_ms)}`
                : 'Разбивки по зонам у этого захвата нет.';
            const top = Math.max(0.001, capture.ms.length ? Math.max.apply(null, capture.ms) : 0);
            graphText = capture.ms.map((v, i) => {
                const label = i === capture.center ? 'всплеск' : (i < capture.center ? '-' + (capture.center - i) : '+' + (i - capture.center));
                return `${label}: ${numText(v, 2)} мс`;
            }).join(' | ');
            graphText += `\nшкала 0…${numText(top, 2)} мс (${capture.ms.length} кадров контекста)`;
        }
        return {
            available: true, count, total,
            threshold: isNum(threshold) ? threshold : null,
            list, selected, capture,
            text: {
                list: listText, detail, zones: zonesText, graph: graphText,
                threshold: isNum(threshold) ? numText(threshold, 2) + ' мс' : NA,
            },
        };
    }

    /** Микро-график ms[] (§18): всплеск в центре — красный столбец. */
    function hitchGraphHtml(capture) {
        if (!capture || capture.ms.length === 0) return '';
        const top = Math.max(0.001, Math.max.apply(null, capture.ms));
        return capture.ms.map((v, i) => {
            const h = Math.max(1, Math.min(GRAPH_H, Math.round((v / top) * GRAPH_H)));
            return `<div class="rt-hbar${i === capture.center ? ' peak' : ''}" id="rt-hitch-bar-${i}" `
                + `style="left: ${i * 62}px; height: ${h}px;"></div>`;
        }).join('');
    }

    function hitchSelect(index) {
        const h = hitchApi();
        if (!h) return false;
        const i = Math.floor(Number(index));
        if (!Number.isFinite(i)) return false;
        const count = call(() => h.count(), 0) || 0;
        if (i < 0 || i >= count) return false;
        runtime.hitch.selected = i;
        runtime.hitch.pinned = true;    // выбор сделан явно — авто-режим выключен
        refreshRuntime(true);
        return true;
    }

    /** Порог детектора: без аргумента — прочитать, с числом — выставить (§18). */
    function hitchThreshold(ms) {
        const h = hitchApi();
        if (!h || typeof h.threshold !== 'function') return null;
        if (ms === undefined) {
            const v = call(() => h.threshold(), null);
            return isNum(v) ? v : null;
        }
        const value = Number(ms);
        if (!Number.isFinite(value) || value <= 0) return null;
        const v = call(() => h.threshold(value), null);
        refreshRuntime(true);
        return isNum(v) ? v : null;
    }

    function hitchClear() {
        const h = hitchApi();
        if (!h || typeof h.clear !== 'function') return false;
        call(() => h.clear(), null);
        runtime.hitch.selected = null;
        runtime.hitch.pinned = false;
        refreshRuntime(true);
        return true;
    }

    // =======================================================================
    // PASS 4: инспекторы подсистем (§25–§29, §31, §33, §39).
    //
    // Правила те же, что у остальных вкладок: данные берём только из
    // существующих подсистем, неизмеримое показываем как N/A или «нет данных»,
    // разметку не пересобираем (setText/setHtml/setClass).
    // =======================================================================

    /** Массив/объект → построчный текст; пусто — пустая строка. */
    function listText(value, itemFn) {
        if (Array.isArray(value)) return value.length ? value.map(itemFn).join('\n') : '';
        if (value && typeof value === 'object') {
            return Object.keys(value).map((k) => `${k}: ${JSON.stringify(value[k])}`).join('\n');
        }
        return value === null || value === undefined ? '' : String(value);
    }

    /** Обрезка длинной строки для панели. */
    function clip(text, max) {
        const s = String(text === null || text === undefined ? '' : text);
        return s.length > max ? s.slice(0, max) + '…' : s;
    }

    // --- §25: физика --------------------------------------------------------

    const PHYS_COLORS = {
        static: '#6f8fa8', kinematic: '#d4a24a', dynamic: '#4ad47a',
        sensor: '#d4d24a', disabled: '#4a5560', selected: '#ff5a4a',
    };

    /** Узлы с телами: по одному на body id (тело может быть общим). */
    function bodyNodes() {
        const seen = new Set();
        const out = [];
        for (const node of ctx.nodes) {
            if (node.removed || !(node.body >= 0) || seen.has(node.body)) continue;
            seen.add(node.body);
            out.push(node);
        }
        return out;
    }

    function shapesOfBody(body) {
        const list = (typeof engine.devtools === 'object' && engine.devtools &&
                      typeof engine.devtools.shapes === 'function')
            ? call(() => engine.devtools.shapes(body), null) : null;
        return Array.isArray(list) ? list : null;
    }

    function physRowText(r) {
        const name = (r.selector || ('<' + r.tag + '>')).padEnd(16).slice(0, 16);
        const v = r.vx === null || r.vy === null ? NA : `${numText(r.vx, 1)},${numText(r.vy, 1)}`;
        const sleep = r.sleeping === null ? NA : (r.sleeping ? 'да' : 'нет');
        const mass = r.mass === null ? NA : numText(r.mass, 2);
        const kinds = r.kinds ? clip(r.kinds, 28) : NA;
        return `${name} body ${r.body} ${r.type || '—'} m ${mass} v ${v}`
            + ` w ${r.angular === null ? NA : numText(r.angular, 2)} sleep ${sleep}`
            + ` слои 0x${r.layer.toString(16)}/0x${r.mask.toString(16)} g${r.group}`
            + ` форм ${r.shapes === null ? NA : r.shapes} (${kinds})`;
    }

    function physicsData() {
        const rows = [];
        for (const node of bodyNodes()) {
            const body = node.body;
            const vel = call(() => engine.getVelocity(body), null);
            const av = call(() => engine.getAngularVelocity(body), null);
            const mass = call(() => engine.bodyMass(body), null);
            const sleeping = call(() => engine.isSleeping(body), null);
            const shapes = shapesOfBody(body);
            rows.push({
                uid: node.uid, selector: selectorOf(node), tag: node.tag, body,
                type: node.body_kind || null,
                mass: isNum(mass) ? mass : null,
                vx: vel && isNum(vel[0]) ? vel[0] : null,
                vy: vel && isNum(vel[1]) ? vel[1] : null,
                angular: isNum(av) ? av : null,
                sleeping: sleeping === null ? null : sleeping === true,
                layer: node.layer_bits >>> 0, mask: node.collision_mask >>> 0,
                group: node.collision_group | 0,
                shapes: shapes ? shapes.length : null,
                kinds: shapes ? shapes.map((sh) => `${sh.kind}${sh.sensor ? '(sensor)' : ''}`).join(', ') : null,
                x: round2(node.x), y: round2(node.y), angle: isNum(node.angle) ? node.angle : 0,
            });
        }
        const text = rows.length ? rows.map(physRowText).join('\n') : 'Тел в мире нет.';
        return { mode: runtime.phys_mode, bodies: rows, text,
                 overlay: runtime.phys_mode !== 'off' ? rows.length : 0 };
    }

    /** Точки формы в мировых координатах (форма задана локально телу). */
    function shapeWorldPoints(node, sh) {
        const body_angle = isNum(node.angle) ? node.angle : 0;
        const local_angle = isNum(sh.angle) ? sh.angle : 0;
        const rot = (lx, ly) => {
            const a = body_angle;
            const c = Math.cos(a), s = Math.sin(a);
            const x = sh.x + lx, y = sh.y + ly;
            return { x: node.x + x * c - y * s, y: node.y + x * s + y * c };
        };
        const kind = String(sh.kind || 'box');
        if (kind === 'circle') {
            const c = rot(0, 0);
            return { kind, circle: { x: c.x, y: c.y, r: sh.radius || 0 } };
        }
        if (kind === 'capsule') {
            const r = sh.radius || 0;
            const half = sh.halfH || sh.halfW || 0;
            // Ось капсулы задана углом формы: 90° — вертикальная (проверено
            // на живом движке: rect 40×20 даёт halfH 10, radius 10, angle π/2).
            const axis = Math.abs(Math.cos(local_angle)) > 0.5 ? { x: 1, y: 0 } : { x: 0, y: 1 };
            const a = rot(-axis.x * half, -axis.y * half);
            const b = rot(axis.x * half, axis.y * half);
            return { kind, capsule: { a, b, r } };
        }
        const hw = sh.halfW || 0, hh = sh.halfH || 0;
        if (Array.isArray(sh.points) && sh.points.length >= 4) {
            const pts = [];
            for (let i = 0; i + 1 < sh.points.length; i += 2) pts.push(rot(sh.points[i], sh.points[i + 1]));
            return { kind: 'polygon', points: pts };
        }
        return { kind, points: [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)] };
    }

    function drawShapeOutline(node, sh, color) {
        const w = shapeWorldPoints(node, sh);
        if (w.circle || w.capsule) {
            const c = w.circle || null;
            if (c) {
                call(() => $.debug.draw.ring({ x: c.x, y: c.y }, Math.max(0.5, c.r), color, 2), null);
                return;
            }
            const cap = w.capsule;
            call(() => $.debug.draw.line(cap.a, cap.b, color, 2), null);
            call(() => $.debug.draw.ring(cap.a, Math.max(0.5, cap.r), color, 2), null);
            call(() => $.debug.draw.ring(cap.b, Math.max(0.5, cap.r), color, 2), null);
            return;
        }
        const pts = w.points || [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            call(() => $.debug.draw.line(a, b, color, 2), null);
        }
    }

    /** Оверлей форм поверх кадра: §25, режим all/selected/off. */
    function tickPhysicsOverlay() {
        if (runtime.phys_mode === 'off' || !runtime.open || runtime.doc < 0) return;
        const only_selected = runtime.phys_mode === 'selected';
        for (const node of bodyNodes()) {
            if (only_selected && node.uid !== state.selected_uid) continue;
            const shapes = shapesOfBody(node.body) || [];
            const selected = node.uid === state.selected_uid;
            for (const sh of shapes) {
                let color = PHYS_COLORS[node.body_kind] || PHYS_COLORS.static;
                if (sh.enabled === false) color = PHYS_COLORS.disabled;
                else if (sh.sensor === true) color = PHYS_COLORS.sensor;
                if (selected) color = PHYS_COLORS.selected;
                drawShapeOutline(node, sh, color);
            }
        }
    }

    function physOverlay(mode) {
        if (mode !== undefined) {
            const m = String(mode);
            if (['off', 'all', 'selected'].indexOf(m) < 0) return false;
            runtime.phys_mode = m;
            if (runtime.doc >= 0) {
                uiSetClass(runtime.doc, 'rt-phys-sel', 'on', m === 'selected');
                uiSetClass(runtime.doc, 'rt-phys-all', 'on', m === 'all');
                uiSetClass(runtime.doc, 'rt-phys-off', 'on', m === 'off');
            }
        }
        return runtime.phys_mode;
    }

    // --- §26: рендер --------------------------------------------------------

    function renderData() {
        // Без движка биндинг может вернуть не объект: панель обязана честно
        // сказать «нет данных», а не показывать нули.
        const info_raw = call(() => engine.renderInfo(), null);
        const info = info_raw && typeof info_raw === 'object' ? info_raw : null;
        const textures = call(() => $.debug.textures(), []) || [];
        const limits = call(() => $.debug.limits(), {}) || {};
        const light = call(() => ($.gfx && $.gfx.light && $.gfx.light.stats ? $.gfx.light.stats() : null), null);
        const lights = call(() => (engine.devtools && typeof engine.devtools.lights === 'function'
            ? engine.devtools.lights() : null), null);
        const dropped = call(() => (engine.devtools && typeof engine.devtools.lightsDropped === 'function'
            ? engine.devtools.lightsDropped() : null), null);
        const targets = info && Array.isArray(info.targets) ? info.targets : [];
        const viewport = info && info.viewport ? info.viewport : null;

        const info_text = !info ? 'нет данных: engine.renderInfo() недоступен'
            : [
                `батчей ${intOrNa(info.batches)} | draw calls ${intOrNa(info.draw_calls !== undefined ? info.draw_calls : info.draws)}`
                    + ` | проходов ${intOrNa(info.passes)} | fx-команд ${intOrNa(info.fx_cmds)}`,
                `пост-обработка: ${info.post ? 'да' : 'нет'} | bloom: ${info.bloom ? 'да' : 'нет'}`
                    + ` | снап вершин: ${info.snap ? 'да' : 'нет'}`,
                `текстуры: ${info.textures ? `${info.textures.count}/${info.textures.max}, пикселей ${info.textures.pixels}` : NA}`
                    + ` | свет: ${light ? `${light.lights} (теней ${light.shadowLights})` : NA}`
                    + ` | источников в списке: ${lights ? lights.length : NA}`
                    + (dropped === null ? '' : `, отсечено бюджетом ${dropped}`),
            ].join('\n');

        const targets_text = [
            viewport ? `viewport: ${viewport.w}×${viewport.h}, снап: ${viewport.snap ? 'да' : 'нет'}, bound: ${viewport.bound}` : 'viewport: нет данных',
            targets.length
                ? targets.map((t) => `цель ${t.name}: ${t.w}×${t.h}${t.active ? '' : ' (неактивна)'}`).join('\n')
                : 'целей рендера нет.',
        ].join('\n');

        const textures_text = textures.length
            ? `живых текстур ${textures.length} из ${limits.textures_max === undefined ? NA : limits.textures_max}\n`
              + textures.map((t) => `#${t.id} ${clip(t.name, 28)} ${t.width}×${t.height}`).join('\n')
            : 'текстур нет.';
        return { info, targets, textures, viewport, lights, dropped,
                 text: { info: info_text, targets: targets_text, textures: textures_text } };
    }

    function intOrNa(v) {
        return isNum(v) ? String(Math.round(v)) : NA;
    }

    // --- §28: события ($.trace) --------------------------------------------

    /** Источник/цель записи: nid — строка; всё прочее не печатаем в панель. */
    function nidText(v) {
        return typeof v === 'string' && v ? v : (v === null || v === undefined ? null : clip(String(v), 16));
    }

    function traceEntryText(e) {
        const data = e.data === null || e.data === undefined ? '' : ' ' + clip(JSON.stringify(e.data), 90);
        const src = nidText(e.source);
        const dst = nidText(e.target);
        const pair = (src || dst) ? ` ${src || '—'}→${dst || '—'}` : '';
        return `#${e.n} кадр ${e.frame}: ${e.kind}${pair}${data}`;
    }

    /** id атаки в записи (если она боевая) — для $.trace.hit(§28). */
    function hitIdOf(e) {
        const d = e && e.data ? e.data : null;
        if (!d) return null;
        const id = d.attack !== undefined ? d.attack : (d.attackId !== undefined ? d.attackId : d.hit);
        return isNum(id) ? id : null;
    }

    function eventsData() {
        const on = call(() => $.trace.on(), false);
        const dropped = call(() => $.trace.dropped(), 0) || 0;
        // all — живой журнал (по нему считаем записи и потери), shown — то, что
        // панель показывает: на паузе это замороженный снимок.
        const all = call(() => $.trace.list(), []) || [];
        let shown = all;
        if (runtime.events.paused && runtime.events.snapshot) shown = runtime.events.snapshot;
        else runtime.events.snapshot = all;
        const filter = runtime.events.filter;
        const list = filter ? shown.filter((e) => String(e.kind).indexOf(filter) >= 0) : shown;
        const tail = list.slice(-EVENTS_ROWS);
        const rows = tail.slice().reverse();
        const text = rows.length
            ? rows.map(traceEntryText).join('\n')
            : (on ? 'Записей нет.' : 'Журнал выключен: $.trace.on(true).');
        // Связь с §28: цепочка последней боевой записи, у которой есть hit id.
        let hit = null;
        const forced = runtime.events.force_hit;
        if (forced !== null && forced !== undefined) {
            hit = { id: forced, chain: call(() => $.trace.hit(forced), null), forced: true };
        } else {
            for (let i = tail.length - 1; i >= 0; i--) {
                const id = hitIdOf(tail[i]);
                if (id !== null) { hit = { id, chain: call(() => $.trace.hit(id), null) }; break; }
            }
        }
        const limit = call(() => $.trace.limit, null);
        let detail = `записей ${all.length}${limit === null ? '' : ' из ' + limit}`
            + (runtime.events.paused ? ` (показан снимок ${shown.length})` : '')
            + ` | фильтр: ${filter || 'нет'}`
            + ` | потеряно переполнением: ${dropped} | пауза: ${runtime.events.paused ? 'да' : 'нет'}`;
        if (hit && hit.chain) {
            detail += `\nцепочка hit #${hit.id}: найдена ${hit.chain.found ? 'да' : 'нет'},`
                + ` полна ${hit.chain.complete ? 'да' : 'нет'}, шагов ${(hit.chain.steps || []).length}`;
            for (const s of (hit.chain.steps || []).slice(0, 6)) {
                detail += `\n  ${s.kind} кадр ${s.frame}` + (s.node ? ` узел ${s.node}` : '');
            }
        } else {
            detail += '\nбоевых записей с hit id в журнале нет';
        }
        return { on, count: all.length, dropped, filter, paused: runtime.events.paused,
                 entries: rows, hit, text: { list: text, detail } };
    }

    function eventsFilter(kind) {
        runtime.events.filter = String(kind === undefined || kind === null ? '' : kind).trim();
        refreshRuntime(true);
        return runtime.events.filter;
    }

    function eventsPause(on) {
        runtime.events.paused = on === undefined ? !runtime.events.paused : !!on;
        refreshRuntime(true);
        return runtime.events.paused;
    }

    function eventsClear() {
        call(() => $.trace.clear(), null);
        runtime.events.snapshot = null;
        refreshRuntime(true);
        return true;
    }

    // --- §29: звук ----------------------------------------------------------

    function audioData() {
        const busy = call(() => $.sound.busy(), null);
        const playing = call(() => $.sound.playing(), null);
        // Внимание: $.sound.sfxVolume()/musicVolume() — это ПРОСТРАНСТВА ИМЁН
        // звуковой шины, а не геттеры. Громкости читаем у $.audio.* и
        // $.sound.volume() (проверено на живом движке).
        const sfx = call(() => (typeof $.audio.sfxVolume === 'function' ? $.audio.sfxVolume()
            : $.sound.volume()), null);
        const music = call(() => (typeof $.audio.musicVolume === 'function' ? $.audio.musicVolume() : null), null);
        const master = call(() => $.audio.getMasterVolume(), null);
        const muted = call(() => $.sound.mute(), null);
        // $.audio.buses() отдаёт ОПИСАНИЯ шин ({name, volume, muted, solo…}),
        // а не имена — панель обязана это учитывать.
        const buses = (call(() => $.audio.buses(), []) || []).map((b) => (b && typeof b === 'object'
            ? b : { name: String(b) }));
        const handles = call(() => $.audio.handles(), []) || [];
        const total = busy && isNum(busy.total) ? busy.total : 0;
        const channels = [];
        for (let i = 0; i < total; i++) {
            const ch = call(() => $.sound.channel(i), null);
            if (!ch) continue;
            channels.push({ index: i, playing: ch.playing === true, volume: isNum(ch.volume) ? ch.volume : null,
                            pan: isNum(ch.pan) ? ch.pan : null, pitch: isNum(ch.pitch) ? ch.pitch : null,
                            position: isNum(ch.position) ? ch.position : null,
                            duration: isNum(ch.duration) ? ch.duration : null,
                            effect: ch.effect || null });
        }
        const info_text = [
            `голосов: ${busy ? `${busy.active} занято, ${busy.free} свободно, всего ${busy.total}` : NA}`
                + ` | музыка играет: ${playing === null ? NA : (playing ? 'да' : 'нет')}`,
            `громкость: мастер ${numOrNa(master)} | sfx ${numOrNa(sfx)} | музыка ${numOrNa(music)}`
                + ` | mute звука: ${muted === null ? NA : (muted === true ? 'да' : 'нет')}`,
            `шин: ${buses.length}${buses.length ? ' (' + clip(buses.join(', '), 60) + ')' : ''} | handle'ов: ${handles.length}`,
        ].join('\n');
        const bus_rows = buses.map((info) => {
            const name = info.name || COPY_NONE;
            return `шина ${name}: громкость ${numOrNa(info.volume)}`
                + ` mute ${info.muted === true ? 'да' : 'нет'} solo ${info.solo === true ? 'да' : 'нет'}`
                + ` родитель ${info.parent || COPY_NONE} эффект ${info.effect || '—'}`;
        });
        const buses_text = bus_rows.length ? bus_rows.join('\n') : "шин нет ($.audio.bus('имя', {…})).";
        const channels_text = channels.length
            ? channels.map((c) => `канал ${c.index}: ${c.playing ? 'играет' : 'свободен'}`
                + ` громкость ${numOrNa(c.volume)} панорама ${numOrNa(c.pan)} питч ${numOrNa(c.pitch)}`
                + ` позиция ${c.position === null || c.position < 0 ? NA : numText(c.position, 2)}`
                + `/${c.duration === null || c.duration < 0 ? NA : numText(c.duration, 2)}`
                + ` эффект ${c.effect || '—'}`).join('\n')
            : 'каналов нет.';
        return { busy, playing, sfx, music, master, muted, buses, handles, channels,
                 text: { info: info_text, buses: buses_text, channels: channels_text } };
    }

    function numOrNa(v) {
        return isNum(v) ? numText(v, 2) : NA;
    }

    /**
     * §29: остановить канал. «Остановлен» возвращаем только если голос там
     * действительно играл: $.sound.stop() возвращает API-объект, а не признак,
     * и врать об успехе пустого канала нельзя.
     */
    function audioStop(channel) {
        const i = Math.floor(Number(channel));
        if (!Number.isFinite(i) || i < 0) return false;
        const before = call(() => $.sound.channel(i), null);
        const was_playing = !!(before && before.playing === true);
        call(() => $.sound.stop(i), null);
        refreshRuntime(true);
        return was_playing;
    }

    function audioBusControl(what, name, value) {
        if (!name) return false;
        const ok = call(() => (what === 'mute' ? $.audio.mute(String(name), value)
            : what === 'solo' ? $.audio.solo(String(name), value)
            : $.audio.volume(String(name), Number(value))), null);
        refreshRuntime(true);
        return ok !== null && ok !== undefined ? true : false;
    }

    // --- §29: ввод ----------------------------------------------------------

    /**
     * Конфликты привязок: у $.input.conflicts(action, keys) спрашиваем про
     * каждое действие отдельно (без аргументов метод всегда возвращает пусто),
     * повторные пары убираем.
     */
    function inputConflicts(bindings) {
        const out = [];
        const seen = new Set();
        for (const action of Object.keys(bindings)) {
            const list = call(() => $.input.conflicts(action, bindings[action]), null);
            if (!Array.isArray(list)) continue;
            for (const item of list) {
                const other = item && item.action ? String(item.action) : COPY_NONE;
                const keys = item && Array.isArray(item.keys) ? item.keys.join(', ') : '';
                const id = `${action}<->${other}:${keys}`;
                if (seen.has(id)) continue;
                seen.add(id);
                out.push({ action, other, keys });
            }
        }
        return out;
    }

    function inputData() {
        const actions = call(() => $.input.actions(), []) || [];
        const bindings = call(() => $.input.bindings(), {}) || {};
        const conflicts = inputConflicts(bindings);
        const waiters = call(() => $.input.waiters(), []) || [];
        const stuck = call(() => $.input.stuck(), []) || [];
        const consumed = call(() => $.input.consumed(), null);
        const devices = call(() => $.input.devices(), []) || [];
        const pads = call(() => $.input.padCount(), null);
        const slots = call(() => $.input.padSlots(), null);
        const mouse = call(() => $.input.mouse(), null);
        const rows = actions.map((a) => {
            const d = call(() => $.input.describe(a), null) || {};
            const keys = (d.keys && d.keys.length) ? d.keys.join(', ') : (bindings[a] || []).join(', ');
            return `${String(a).padEnd(14).slice(0, 14)} клавиши: ${keys || COPY_NONE}`
                + ` | нажато: ${d.down ? 'да' : 'нет'} | фронт: ${d.pressed ? 'да' : 'нет'}`;
        });
        const info_text = [
            `действий: ${actions.length} | привязок: ${Object.keys(bindings).length}`
                + ` | геймпадов подключено: ${pads === null ? NA : pads} из ${slots === null ? NA : slots}`,
            `мышь: ${mouse ? `${numText(mouse.x, 0)}, ${numText(mouse.y, 0)}` : NA}`
                + ` | shift/ctrl/alt: ${$.input.shiftDown() ? '1' : '0'}/${$.input.ctrlDown() ? '1' : '0'}/${$.input.altDown() ? '1' : '0'}`,
            listText(devices, (d) => `слот ${d.slot}: игрок ${d.player}`
                + ` serial ${d.serial === null ? COPY_NONE : d.serial}`
                + ` удерживает ${(d.held || []).length}`) || 'устройств нет',
        ].join('\n');
        const actions_text = rows.length ? rows.join('\n') : 'Действий нет: $.input.bind("jump", ["Space"]).';
        const issues = [
            `конфликты привязок: ${conflicts.length}`,
            listText(conflicts, (c) => '  ' + clip(JSON.stringify(c), 120)),
            `ожидания ввода: ${waiters.length}`,
            listText(waiters, (w) => '  ' + clip(JSON.stringify(w), 120)),
            `залипшие клавиши: ${stuck.length}${stuck.length ? ' — ' + clip(JSON.stringify(stuck), 100) : ''}`,
            `захват ввода (consumed): ${consumed === null || consumed === undefined ? NA : clip(JSON.stringify(consumed), 100)}`,
        ].filter((line) => line !== '').join('\n');
        return { actions, bindings, conflicts, waiters, stuck, consumed, devices, pads, slots, mouse,
                 text: { info: info_text, actions: actions_text, issues } };
    }

    // --- §29: ассеты --------------------------------------------------------

    function assetSizeOf(item, textures) {
        for (const t of textures) {
            if (t.name && (t.name === item.name || t.name === item.path)) {
                return `${t.width}×${t.height} (текстура #${t.id})`;
            }
        }
        return COPY_NONE;
    }

    function assetsData() {
        if (!$.reload) return { available: false, list: [], stats: null,
                                text: { table: '$.reload не поставлен в этой сборке', stats: '' } };
        const list = call(() => $.reload.list(), []) || [];
        const stats = call(() => $.reload.stats(), null);
        const textures = call(() => $.debug.textures(), []) || [];
        const rows = list.map((a) => ({
            name: a.name, kind: a.kind, path: a.path, version: a.version, status: a.status,
            deps: (a.deps || []).length,
            size: assetSizeOf(a, textures),
            last_frame: a.last && isNum(a.last.frame) ? a.last.frame : null,
            last_ok: a.last ? a.last.ok === true : null,
        }));
        const table = rows.length
            ? rows.map((r) => `${clip(r.name, 24).padEnd(24)} ${String(r.kind).padEnd(8)}`
                + ` ${String(r.status).padEnd(10)} v${intOrNa(r.version)} deps ${r.deps}`
                + ` размер ${r.size}`
                + ` последнее ${r.last_frame === null ? COPY_NONE : `кадр ${r.last_frame} ${r.last_ok ? 'ok' : 'FAIL'}`}`).join('\n')
            : "Наблюдаемых ассетов нет: $.reload.watch('имя', { kind: 'json', path: '…' }).";
        const stats_text = stats
            ? `под наблюдением ${stats.watched} | применено ${stats.applied} | неудачных ${stats.failed}`
              + ` | ждут освобождения ${stats.pending_release}`
              + ` | последнее: ${stats.last ? `${stats.last.ok ? 'ok' : 'FAILED'} ${stats.last.stage} v${stats.last.version}` : '—'}`
            : 'нет статистики $.reload.';
        return { available: true, list: rows, stats, text: { table, stats: stats_text } };
    }

    // --- §29: ресурсы и память ---------------------------------------------

    function memSample() {
        const counters = call(() => $.debug.counters(), null);
        if (!counters) return;
        const s = runtime.mem.samples;
        const frame = call(() => $.time.frame(), 0);
        if (s.length && s[s.length - 1].frame === frame) return;
        s.push({ frame, counters: Object.assign({}, counters) });
        while (s.length > MEM_SAMPLES) s.shift();
    }

    function memoryData() {
        memSample();
        const counters = call(() => $.debug.counters(), {}) || {};
        const limits = call(() => $.debug.limits(), {}) || {};
        const samples = runtime.mem.samples;
        const base = runtime.mem.baseline || (samples.length ? samples[0].counters : null);
        const first = samples.length ? samples[0] : null;
        const last = samples.length ? samples[samples.length - 1] : null;

        const counter_keys = Object.keys(counters);
        const delta_text = counter_keys.map((k) => {
            const now = counters[k];
            const was = base && isNum(base[k]) ? base[k] : null;
            const d = was === null || !isNum(now) ? null : now - was;
            return `${k}: ${intOrNa(now)}${d === null ? '' : ` (Δ ${d >= 0 ? '+' : ''}${d})`}`;
        }).join(' | ');

        const limit_keys = Object.keys(limits);
        const limits_text = limit_keys.map((k) => `${k}: ${limits[k]}`).join(' | ');

        // Подозрение на утечку: счётчик рос в каждом из последних LEAK_RUN
        // замеров. Ждать роста всё окно (60 замеров) бессмысленно: рост может
        // начаться посреди окна, и «утечка» тогда не находилась бы вовсе.
        const leaks = [];
        if (samples.length >= LEAK_RUN + 1) {
            for (const k of counter_keys) {
                let grew = true;
                for (let i = samples.length - LEAK_RUN; i < samples.length; i++) {
                    const a = samples[i - 1].counters[k];
                    const b = samples[i].counters[k];
                    if (!isNum(a) || !isNum(b) || b <= a) { grew = false; break; }
                }
                if (grew) {
                    leaks.push({ key: k, from: samples[samples.length - LEAK_RUN - 1].counters[k],
                                 to: last.counters[k], samples: LEAK_RUN });
                }
            }
        }
        const leak_text = samples.length < LEAK_RUN + 1
            ? `замеров пока ${samples.length} из ${LEAK_RUN + 1} — вывод о росте преждевременен`
            : (leaks.length
                ? leaks.map((l) => `растёт последние ${l.samples} замеров: ${l.key} ${l.from} → ${l.to}`).join('\n')
                : `подозрений на утечку нет: ни один счётчик не растёт ${LEAK_RUN} замеров подряд`);
        return {
            counters, limits, samples: samples.length, series: samples.slice(),
            window_frames: first && last ? last.frame - first.frame : 0,
            deltas: counter_keys.reduce((acc, k) => {
                const was = base && isNum(base[k]) ? base[k] : null;
                acc[k] = was === null || !isNum(counters[k]) ? null : counters[k] - was;
                return acc;
            }, {}),
            leaks,
            text: { counters: `кадры ${first ? first.frame : NA}…${last ? last.frame : NA} (замеров ${samples.length})\n${delta_text}`,
                    limits: limits_text, leaks: leak_text },
        };
    }

    function memBaseline() {
        memSample();
        const s = runtime.mem.samples;
        runtime.mem.baseline = s.length ? Object.assign({}, s[s.length - 1].counters) : null;
        refreshRuntime(true);
        return true;
    }

    // --- §31: консоль -------------------------------------------------------

    /** Команды — тонкие обёртки над существующими API (§31). */
    function consoleCommand(line) {
        const parts = String(line).trim().split(/\s+/);
        const cmd = (parts.shift() || '').toLowerCase();
        const arg = parts.join(' ');
        switch (cmd) {
        case '': return { ok: false, out: 'пустая команда' };
        case 'help': return { ok: true, out: 'pause | resume | step [N] | timescale X | reload | dump | errors | watches | goto-node SEL | physics [off|all|selected]' };
        case 'pause': call(() => $.time.pause(), null); return { ok: true, out: 'пауза включена' };
        case 'resume': call(() => $.time.resume(), null); return { ok: true, out: 'пауза снята' };
        case 'step': {
            const n = Math.max(1, Math.floor(Number(arg) || 1));
            stepFrames(n);
            return { ok: true, out: `шаг ${n} кадр(ов): время идёт, дальше пауза` };
        }
        case 'timescale': {
            const x = Number(arg);
            if (!Number.isFinite(x) || x < 0) return { ok: false, out: 'timescale: нужно неотрицательное число' };
            call(() => $.time.scale(x), null);
            return { ok: true, out: `масштаб времени ${x}` };
        }
        case 'reload': call(() => $.script.request('консоль DevTools'), null); return { ok: true, out: 'перезапуск скриптов запрошен' };
        case 'dump': {
            const r = reportData();
            return { ok: true, out: `отчёт собран: ${r.text.split('\n').length} строк, ${r.json.length} байт JSON` };
        }
        case 'errors': {
            const list = call(() => $.debug.errors(), []) || [];
            const rep = call(() => $.debug.report(), null);
            return { ok: true, out: `ошибок ${list.length}, неустранимых ${rep ? rep.fatal : NA}, журнал ${rep && rep.clean ? 'чист' : 'не чист'}` };
        }
        case 'watches': {
            const w = call(() => $.debug.watches(), []) || [];
            return { ok: true, out: w.length ? w.map((x) => `${x.name}: ${JSON.stringify(x.value)}`).join('\n') : 'наблюдений нет' };
        }
        case 'goto-node': {
            if (!arg) return { ok: false, out: 'goto-node: нужен селектор' };
            const sel = selectBy(arg);
            return sel ? { ok: true, out: `выбрано: ${sel}` } : { ok: false, out: `узел не найден: ${arg}` };
        }
        case 'physics': {
            const m = arg || 'all';
            return physOverlay(m) ? { ok: true, out: `оверлей физики: ${m}` } : { ok: false, out: 'physics: off | all | selected' };
        }
        default: return { ok: false, out: `неизвестная команда: ${cmd} (help)` };
        }
    }

    function consoleRun(line) {
        const text = String(line === undefined || line === null ? '' : line).trim();
        const res = consoleCommand(text);
        runtime.console.history.push(text);
        while (runtime.console.history.length > CONSOLE_HISTORY) runtime.console.history.shift();
        runtime.console.log.push(`> ${text}\n${res.out}`);
        while (runtime.console.log.length > CONSOLE_LOG) runtime.console.log.shift();
        runtime.console.last = { line: text, ok: res.ok, out: res.out };
        if (runtime.doc >= 0) {
            uiSetText(runtime.doc, 'rt-console-log', consoleLogText());
            uiSetValue(runtime.doc, 'rt-console-input', '');
        }
        refreshRuntime(true);
        return runtime.console.last;
    }

    function consoleLogText() {
        return runtime.console.log.length ? runtime.console.log.join('\n') : 'Консоль пуста. help — список команд.';
    }

    function consoleClear() {
        runtime.console.log.length = 0;
        if (runtime.doc >= 0) uiSetText(runtime.doc, 'rt-console-log', consoleLogText());
        return true;
    }

    // --- §33: время и шаг кадра --------------------------------------------

    function stepData() {
        const paused = call(() => $.time.isPaused(), null);
        const scale = call(() => $.time.scale(), null);
        const sim = call(() => $.time.simTime(), null);
        const pres = call(() => $.time.presentationTime(), null);
        const steps = call(() => $.time.lastSteps(), null);
        const freeze_left = call(() => $.time.freezeLeft(), null);
        const slow_count = call(() => $.time.slowCount(), null);
        const physical = call(() => $.time.physicsScale(), null);
        const state = [
            `кадр ${intOrNa(call(() => $.time.frame(), null))} | пауза: ${paused === null ? NA : (paused ? 'да' : 'нет')}`
                + ` | масштаб ${numOrNa(scale)} (шаг физики ${numOrNa(physical)})`,
            `simTime ${numOrNa(sim)} с | presentationTime ${numOrNa(pres)} с`
                + ` | шагов симуляции в кадре ${intOrNa(steps)}`,
            `hit-stop осталось ${freeze_left === null ? NA : msText(freeze_left)}`
                + ` | активных замедлений ${intOrNa(slow_count)}`
                + (runtime.step_left > 0 ? ` | шагаем: осталось ${runtime.step_left}` : ''),
        ].join('\n');
        const notes = [
            'Шаг кадра: время идёт ровно N кадров, затем пауза возвращается сама.',
            'Шага физики отдельно нет: движок не отдаёт публичного «одного шага симуляции»;',
            'в кадре выполняется steps шагов фиксированного dt (см. выше).',
            'Пауза останавливает логику и физику, но кадр и интерфейс продолжают рисоваться.',
        ].join('\n');
        return { paused, scale, sim, pres, steps, freeze_left, slow_count,
                 step_left: runtime.step_left, text: { state, notes } };
    }

    /** Шаг кадра: возобновляем время на N кадров и снова ставим паузу. */
    function stepFrames(n) {
        const count = Math.max(1, Math.min(600, Math.floor(Number(n) || 1)));
        runtime.step_left = count;
        call(() => $.time.resume(), null);
        refreshRuntime(true);
        return count;
    }

    function pauseTime(on) {
        const value = on === undefined ? !call(() => $.time.isPaused(), false) : !!on;
        if (value) call(() => $.time.pause(), null);
        else { runtime.step_left = 0; call(() => $.time.resume(), null); }
        refreshRuntime(true);
        return value;
    }

    function timeScale(x) {
        const v = Number(x);
        if (!Number.isFinite(v) || v < 0) return null;
        call(() => $.time.scale(v), null);
        refreshRuntime(true);
        return v;
    }

    function timeControl(what, value) {
        if (what === 'hitStop') { call(() => $.time.hitStop(Number(value) || 0), null); }
        else if (what === 'freeze') { call(() => $.time.freeze(Number(value) || 0), null); }
        // Внимание: у $.time.slow(ms, factor) СНАЧАЛА миллисекунды, потом
        // множитель (проверено на живом движке) — раньше аргументы путались.
        else if (what === 'slow') { call(() => $.time.slow(1000, Number(value) || 0.5), null); }
        else if (what === 'reset') {
            runtime.step_left = 0;
            call(() => $.time.unfreeze(), null);
            call(() => $.time.scale(1), null);
            call(() => $.time.resume(), null);
        } else return false;
        refreshRuntime(true);
        return true;
    }

    // --- §39: отчёт ---------------------------------------------------------

    function reportData() {
        const counters = call(() => $.debug.counters(), {}) || {};
        const limits = call(() => $.debug.limits(), {}) || {};
        const diag = call(() => $.debug.report(), null);
        const prof = call(() => $.debug.profile(), null);
        const stats = call(() => $.debug.stats(), {}) || {};
        const info = call(() => engine.renderInfo(), null);
        const hitch = call(() => (hitchApi() ? hitchApi().count() : null), null);
        const timers = call(() => ($.time && $.time.timers ? $.time.timers() : null), null);
        const scene = call(() => (ctx.scene ? ctx.scene.current() : null), null);
        const snapshot = {
            version: (typeof engine !== 'undefined' && engine.version) ? String(engine.version) : null,
            frame: isNum(stats.frame) ? stats.frame : null,
            fps: isNum(stats.fps) ? stats.fps : null,
            scene: scene === null || scene === undefined ? null : String(scene),
            counters, limits,
            diagnostics: diag,
            profile: prof ? { frame_ms: prof.frame_ms, frames: prof.frames, gpu_ms: prof.gpu_ms,
                              gpu_available: prof.gpu_available, stats: prof.stats || null } : null,
            render: info ? { batches: info.batches, draw_calls: info.draw_calls,
                             targets: (info.targets || []).length,
                             textures: info.textures || null } : null,
            timers: timers || null,
            hitch: hitch,
        };
        const text = [
            `R2D DevTools report, версия ${snapshot.version || NA}`,
            `кадр ${intOrNa(snapshot.frame)} | FPS ${numOrNa(snapshot.fps)} | сцена ${snapshot.scene || COPY_NONE}`,
            `счётчики: ${Object.keys(counters).map((k) => `${k}=${counters[k]}`).join(' ')}`,
            `пределы: ${Object.keys(limits).map((k) => `${k}=${limits[k]}`).join(' ')}`,
            `диагностика: записей ${diag ? diag.total : NA}, неустранимых ${diag ? diag.fatal : NA},`
                + ` вытеснено ${diag ? diag.dropped : NA}, журнал ${diag && diag.clean ? 'чист' : 'не чист'}`,
            `профиль: кадр ${prof ? numText(prof.frame_ms, 2) : NA} мс, окно ${prof ? prof.frames : NA} кадров,`
                + ` GPU ${prof && prof.gpu_available ? msText(prof.gpu_ms) : NA}`,
            `рендер: батчей ${info ? intOrNa(info.batches) : NA}, draw calls ${info ? intOrNa(info.draw_calls) : NA},`
                + ` целей ${info && info.targets ? info.targets.length : NA}`,
            `таймеры: ${timers ? `after ${timers.after}, every ${timers.every}, waits ${timers.waits}` : NA}`
                + ` | захватов hitch: ${hitch === null ? NA : hitch}`,
        ].join('\n');
        return { snapshot, text, json: call(() => JSON.stringify(snapshot, null, 1), '{}') };
    }

    function copyReport(what) {
        const r = reportData();
        const text = what === 'json' ? r.json : r.text;
        state.last_copied = { what: what === 'json' ? 'report-json' : 'report-text', text };
        if (typeof engine.setClipboard === 'function') engine.setClipboard(text);
        return text;
    }

    // --- Обновление панели F1 ----------------------------------------------

    function refreshRuntime(force) {
        if (!runtime.open) return;
        if (!force && ++runtime.frames % REFRESH_FRAMES !== 1) return;
        runtime.snapshot = {
            stats: call(() => $.debug.stats(), {}),
            profile: call(() => $.debug.profile(), null),
            limits: call(() => $.debug.limits(), {}),
            gravity: call(() => $.world.gravity(), null),
            reloads: call(() => $.script.count(), 0),
            error: call(() => $.script.error(), ''),
            textures: call(() => $.debug.textures(), []),
            watches: call(() => $.debug.watches(), []),
            assets: $.reload ? {
                stats: call(() => $.reload.stats(), null),
                list: call(() => $.reload.list(), []),
                graph: call(() => $.reload.graph(), null),
            } : null,
        };
        const r = runtime.snapshot;
        const doc = runtime.doc;

        // §17: сводка, график и перцентили.
        const perf = perfData();
        // Свои замеры копим только когда движок не отдаёт history (§17.2):
        // иначе график рисовался бы по второму источнику.
        const has_history = !!(r.profile && Array.isArray(r.profile.history) && r.profile.history.length > 0);
        if (!has_history && isNum(r.stats.frame_ms)) {
            runtime.graph_samples.push(r.stats.frame_ms);
            if (runtime.graph_samples.length > HISTORY_MAX) runtime.graph_samples.shift();
        }
        const graph = graphData(perf);
        uiSetText(doc, 'rt-perf-summary', perf.text);
        uiSetHtml(doc, 'rt-perf-graph', graphHtml(graph));
        uiSetText(doc, 'rt-perf-graph-src', graph.source + (graph.bars.length ? '' : ' — замеров пока нет'));
        uiSetText(doc, 'rt-perf-stats', graph.text);
        uiSetClass(doc, 'rt-perf-profiler', 'on', perf.profiler_on);

        // §17.3–17.4: дерево.
        const tree = treeData();
        uiSetText(doc, 'rt-tree-left', tree.text.left);
        uiSetText(doc, 'rt-tree-right', tree.text.right);

        // Диагностика (прежний состав панели).
        const lines = Object.entries(r.stats).filter(([, v]) => typeof v !== 'object')
            .map(([k, v]) => `${k}: ${v}`).join('  |  ');
        uiSetText(doc, 'rt-stats', lines);
        uiSetText(doc, 'rt-profile', r.profile ?
            'Кадр: ' + r.profile.frame_ms.toFixed(2) + ' мс\n' + (r.profile.zones || []).map((z) =>
                z.name + ': ' + (z.valid ? z.ms.toFixed(3) + ' мс; пик ' + z.peak.toFixed(3) : 'нет данных')).join('\n') : 'Профиль недоступен');
        uiSetText(doc, 'rt-limits', Object.entries(r.limits).map(([k, v]) => k + ': ' + v).join(' | '));
        uiSetText(doc, 'rt-textures', r.textures.map((t) => t.id + ': ' + t.name + ' (' + t.width + ' x ' + t.height + ')').join(' | '));
        uiSetText(doc, 'rt-watches', watchText());

        // §18: захваты долгих кадров. Список — фиксированные строки (создаются
        // один раз при открытии), поэтому слушатели кликов не теряются.
        const hitch = hitchData();
        uiSetText(doc, 'rt-hitch-threshold', hitch.text.threshold);
        uiSetText(doc, 'rt-hitch-detail', hitch.text.detail);
        uiSetText(doc, 'rt-hitch-zones', hitch.text.zones);
        uiSetText(doc, 'rt-hitch-graph-labels', hitch.text.graph);
        uiSetHtml(doc, 'rt-hitch-graph', hitchGraphHtml(hitch.capture));
        uiSetClass(doc, 'rt-hitch-empty', 'hidden', hitch.count > 0);
        const order = hitch.list.slice().reverse();     // свежие сверху
        for (let i = 0; i < HITCH_ROWS; i++) {
            const rec = order[i] || null;
            const id = `rt-hitch-row-${i}`;
            if (!rec) {
                uiSetClass(doc, id, 'gone', true);
                continue;
            }
            uiSetText(doc, id, hitchRowText(rec));
            uiSetClass(doc, id, 'gone', false);
            uiSetClass(doc, id, 'sel', rec.index === hitch.selected);
        }
        for (const [preset, element] of [[16.67, 'rt-hitch-th-16'], [25, 'rt-hitch-th-25'],
                                         [33, 'rt-hitch-th-33'], [50, 'rt-hitch-th-50']]) {
            uiSetClass(doc, element, 'on',
                       hitch.threshold !== null && Math.abs(hitch.threshold - preset) < 0.005);
        }

        // §27: индикатор хот-релоада — сколько ассетов под наблюдением, сколько
        // неудачных, что случилось последним и сколько handle'ов ждёт
        // освобождения (очередь §27).
        if (r.assets) {
            const st = r.assets.stats;
            const last = st.last
                ? `${st.last.ok ? 'ok' : 'FAILED'} ${st.last.stage}${st.last.code ? ' ' + st.last.code : ''} v${st.last.version}`
                : '—';
            uiSetText(doc, 'rt-assets',
                `под наблюдением: ${st.watched} | неудачных: ${st.failed} | версий применено: ${st.applied}` +
                ` | ждут освобождения: ${st.pending_release} | последнее: ${last}`);
        } else {
            uiSetText(doc, 'rt-assets', '$.reload не поставлен в этой сборке');
        }

        // §25 PHYSICS: таблица тел + состояние оверлея.
        const phys = physicsData();
        uiSetText(doc, 'rt-phys-table', phys.text);
        uiSetText(doc, 'rt-phys-mode',
            `оверлей: ${phys.mode === 'off' ? 'выключен' : (phys.mode === 'all' ? 'все тела' : 'только выбранный')}`
            + ` | тел ${phys.bodies.length}`);

        // §26 RENDER.
        const render = renderData();
        uiSetText(doc, 'rt-render-info', render.text.info);
        uiSetText(doc, 'rt-render-targets', render.text.targets);
        uiSetText(doc, 'rt-render-textures', render.text.textures);

        // §28 EVENTS.
        const ev = eventsData();
        uiSetText(doc, 'rt-events-list', ev.text.list);
        uiSetText(doc, 'rt-events-detail', ev.text.detail);
        uiSetClass(doc, 'rt-events-pause', 'on', ev.paused);

        // §29 AUDIO.
        const audio = audioData();
        uiSetText(doc, 'rt-audio-info', audio.text.info);
        uiSetText(doc, 'rt-audio-buses', audio.text.buses);
        uiSetText(doc, 'rt-audio-channels', audio.text.channels);

        // §29 INPUT.
        const input = inputData();
        uiSetText(doc, 'rt-input-info', input.text.info);
        uiSetText(doc, 'rt-input-actions', input.text.actions);
        uiSetText(doc, 'rt-input-issues', input.text.issues);

        // §29 ASSETS: таблица наблюдаемых ассетов (строка статистики — выше).
        const assets_tab = assetsData();
        uiSetText(doc, 'rt-assets-table', assets_tab.text.table);

        // §29 RESOURCE/MEMORY.
        const mem = memoryData();
        uiSetText(doc, 'rt-mem-counters', mem.text.counters);
        uiSetText(doc, 'rt-mem-limits', mem.text.limits);
        uiSetText(doc, 'rt-mem-leaks', mem.text.leaks);

        // §31 CONSOLE: лог и история (строки истории созданы один раз).
        uiSetText(doc, 'rt-console-log', consoleLogText());
        const hist = runtime.console.history.slice().reverse();
        for (let i = 0; i < CONSOLE_HISTORY; i++) {
            const id = `rt-console-h-${i}`;
            if (hist[i] === undefined) { uiSetClass(doc, id, 'gone', true); continue; }
            uiSetText(doc, id, `> ${hist[i]}`);
            uiSetClass(doc, id, 'gone', false);
        }

        // §33 STEP: состояние времени и подсветка активных кнопок.
        const step = stepData();
        uiSetText(doc, 'rt-step-state', step.text.state);
        uiSetText(doc, 'rt-step-notes', step.text.notes);
        uiSetClass(doc, 'rt-step-pause', 'on', step.paused === true);
        for (const [value, element] of [[0.1, 'rt-step-scale-01'], [0.25, 'rt-step-scale-025'],
                                         [0.5, 'rt-step-scale-05'], [1, 'rt-step-scale-1'],
                                         [2, 'rt-step-scale-2']]) {
            uiSetClass(doc, element, 'on',
                       step.scale !== null && Math.abs(step.scale - value) < 1e-6);
        }

        // §39 REPORT: текст снимка (JSON копируется кнопкой).
        uiSetText(doc, 'rt-report-text', reportData().text);

    }

    function setTab(name) {
        if (TABS.indexOf(name) < 0) return false;
        runtime.tab = name;
        if (runtime.doc >= 0) {
            for (const t of TABS) {
                uiSetClass(runtime.doc, 'tab-' + t, 'hidden', t !== name);
                uiSetClass(runtime.doc, 'rt-tab-' + t, 'on', t === name);
            }
        }
        return true;
    }

    function openRuntime() {
        if (!engine.ui || typeof engine.ui.loadMarkup !== 'function') return false;
        if (runtime.doc < 0) {
            runtime.doc = engine.ui.loadMarkup('runtime-debug', RUNTIME_MARKUP);
            if (runtime.doc < 0) return false;
            engine.ui.on(runtime.doc, 'rt-reset', 'click', () => $.debug.profileReset());
            engine.ui.on(runtime.doc, 'rt-reload', 'click', () => $.script.request('RmlUi DevTools'));
            engine.ui.on(runtime.doc, 'rt-nodes', 'click', () => { closeRuntime(); open(); });
            // §17: кнопки вкладки PERF.
            engine.ui.on(runtime.doc, 'rt-perf-reset', 'click', () => {
                $.debug.profileReset();
                runtime.graph_samples.length = 0;
                refreshRuntime(true);
            });
            engine.ui.on(runtime.doc, 'rt-perf-profiler', 'click', () => {
                const on = !call(() => $.debug.profiler.isOn(), false);
                call(() => $.debug.profiler.on(on), null);
                refreshRuntime(true);
            });
            // Вкладки: разметка не меняется, меняются только классы.
            for (const t of TABS) {
                engine.ui.on(runtime.doc, 'rt-tab-' + t, 'click', () => setTab(t));
            }
            // §17.5: порог наблюдения «имя=значение».
            engine.ui.on(runtime.doc, 'rt-watch-apply', 'click', () => {
                const raw = String(uiValue(runtime.doc, 'rt-watch-th') === null ? '' : uiValue(runtime.doc, 'rt-watch-th')).trim();
                const m = /^([^=<>]+)\s*(?:=|>|<)\s*(-?\d+(?:[.,]\d+)?)$/.exec(raw);
                if (!m) {
                    uiSetText(runtime.doc, 'rt-error', 'Порог: введите «имя=число» или «имя>число».');
                    return;
                }
                watchThreshold(m[1].trim(), Number(String(m[2]).replace(',', '.')));
                uiSetText(runtime.doc, 'rt-error', `Порог для «${m[1].trim()}» применён.`);
                refreshRuntime(true);
            });
            engine.ui.on(runtime.doc, 'rt-watch-reset', 'click', () => { watchReset(); refreshRuntime(true); });
            // §18: строки списка захватов создаются ОДИН раз — на них висят
            // обработчики выбора, поэтому пересобирать разметку нельзя.
            uiSetHtml(runtime.doc, 'rt-hitch-list', Array.from({length: HITCH_ROWS}, (_, i) =>
                `<div class="rt-row" id="rt-hitch-row-${i}"></div>`).join(''));
            for (let i = 0; i < HITCH_ROWS; i++) {
                engine.ui.on(runtime.doc, `rt-hitch-row-${i}`, 'click', () => {
                    // Строки идут свежими сверху: i-я строка — захват (count-1-i).
                    const count = call(() => (hitchApi() ? hitchApi().count() : 0), 0) || 0;
                    const index = count - 1 - i;
                    if (index >= 0) hitchSelect(index);
                });
            }
            engine.ui.on(runtime.doc, 'rt-hitch-th-16', 'click', () => { hitchThreshold(16.67); });
            engine.ui.on(runtime.doc, 'rt-hitch-th-25', 'click', () => { hitchThreshold(25); });
            engine.ui.on(runtime.doc, 'rt-hitch-th-33', 'click', () => { hitchThreshold(33); });
            engine.ui.on(runtime.doc, 'rt-hitch-th-50', 'click', () => { hitchThreshold(50); });
            engine.ui.on(runtime.doc, 'rt-hitch-th-apply', 'click', () => {
                const raw = String(uiValue(runtime.doc, 'rt-hitch-th-custom') === null
                    ? '' : uiValue(runtime.doc, 'rt-hitch-th-custom')).trim().replace(',', '.');
                const value = Number(raw);
                if (!raw || !Number.isFinite(value) || value <= 0) {
                    uiSetText(runtime.doc, 'rt-hitch-note', 'Порог: нужно число больше нуля (мс).');
                    return;
                }
                const set = hitchThreshold(value);
                uiSetText(runtime.doc, 'rt-hitch-note', set === null
                    ? 'Порог не применён: hitch-детектор недоступен.'
                    : `Порог ${numText(set, 2)} мс применён.`);
            });
            engine.ui.on(runtime.doc, 'rt-hitch-clear', 'click', () => {
                hitchClear();
                uiSetText(runtime.doc, 'rt-hitch-note', 'Кольцо захватов очищено.');
            });
            // §25: режим оверлея форм (off/all/selected).
            engine.ui.on(runtime.doc, 'rt-phys-sel', 'click', () => { physOverlay('selected'); refreshRuntime(true); });
            engine.ui.on(runtime.doc, 'rt-phys-all', 'click', () => { physOverlay('all'); refreshRuntime(true); });
            engine.ui.on(runtime.doc, 'rt-phys-off', 'click', () => { physOverlay('off'); refreshRuntime(true); });
            // §28: журнал событий — пауза, очистка, фильтр, цепочка hit.
            engine.ui.on(runtime.doc, 'rt-events-pause', 'click', () => { eventsPause(); });
            engine.ui.on(runtime.doc, 'rt-events-clear', 'click', () => { eventsClear(); });
            engine.ui.on(runtime.doc, 'rt-events-apply', 'click', () => {
                eventsFilter(String(uiValue(runtime.doc, 'rt-events-filter') === null
                    ? '' : uiValue(runtime.doc, 'rt-events-filter')));
            });
            engine.ui.on(runtime.doc, 'rt-events-hit', 'click', () => {
                const raw = String(uiValue(runtime.doc, 'rt-events-filter') === null
                    ? '' : uiValue(runtime.doc, 'rt-events-filter')).trim();
                const want = Number(raw);
                const list = call(() => $.trace.list(), []) || [];
                let id = Number.isFinite(want) && want > 0 ? Math.floor(want) : null;
                if (id === null) {
                    for (let i = list.length - 1; i >= 0; i--) {
                        const v = hitIdOf(list[i]);
                        if (v !== null) { id = v; break; }
                    }
                }
                runtime.events.force_hit = id;
                refreshRuntime(true);
                if (id === null) {
                    uiSetText(runtime.doc, 'rt-events-detail', 'боевых записей с hit id в журнале нет');
                }
            });
            // §29: звук — стоп канала и mute/solo шины из полей панели.
            engine.ui.on(runtime.doc, 'rt-audio-stop', 'click', () => {
                const ch = Number(String(uiValue(runtime.doc, 'rt-audio-ch') === null
                    ? '' : uiValue(runtime.doc, 'rt-audio-ch')).trim());
                uiSetText(runtime.doc, 'rt-audio-info',
                    audioStop(Number.isFinite(ch) ? ch : 0) ? 'канал остановлен' : 'канал не остановлен');
            });
            engine.ui.on(runtime.doc, 'rt-audio-mute', 'click', () => {
                const now = call(() => $.sound.mute(), false);
                call(() => $.sound.mute(!(now === true)), null);
                refreshRuntime(true);
            });
            for (const [element, what] of [['rt-audio-busmute', 'mute'], ['rt-audio-bussolo', 'solo']]) {
                engine.ui.on(runtime.doc, element, 'click', () => {
                    const raw = String(uiValue(runtime.doc, 'rt-audio-bus') === null
                        ? '' : uiValue(runtime.doc, 'rt-audio-bus')).trim();
                    const name = raw || ((call(() => $.audio.buses(), []) || [])[0] || '');
                    if (!name) {
                        uiSetText(runtime.doc, 'rt-audio-info', 'шин нет: $.audio.bus("имя", {...})');
                        return;
                    }
                    const now = call(() => $.audio[what](name), false);
                    audioBusControl(what, name, !(now === true));
                });
            }
            // §29: базовая линия счётчиков для дельт и поиска роста.
            engine.ui.on(runtime.doc, 'rt-mem-baseline', 'click', () => { memBaseline(); });
            // §31: консоль — выполнить строку, очистить лог, повторить из истории.
            engine.ui.on(runtime.doc, 'rt-console-run', 'click', () => {
                consoleRun(String(uiValue(runtime.doc, 'rt-console-input') === null
                    ? '' : uiValue(runtime.doc, 'rt-console-input')));
            });
            engine.ui.on(runtime.doc, 'rt-console-clear', 'click', () => { consoleClear(); });
            uiSetHtml(runtime.doc, 'rt-console-history', Array.from({length: CONSOLE_HISTORY}, (_, i) =>
                `<div class="rt-row" id="rt-console-h-${i}"></div>`).join(''));
            for (let i = 0; i < CONSOLE_HISTORY; i++) {
                engine.ui.on(runtime.doc, `rt-console-h-${i}`, 'click', () => {
                    const hist = runtime.console.history;
                    const line = hist[hist.length - 1 - i];
                    if (line === undefined) return;
                    uiSetValue(runtime.doc, 'rt-console-input', line);
                    consoleRun(line);
                });
            }
            // §33: время — пауза, шаг кадра, hit-stop, замедление, масштабы.
            engine.ui.on(runtime.doc, 'rt-step-pause', 'click', () => { pauseTime(); });
            engine.ui.on(runtime.doc, 'rt-step-resume', 'click', () => { pauseTime(false); });
            engine.ui.on(runtime.doc, 'rt-step-frame', 'click', () => { stepFrames(1); });
            engine.ui.on(runtime.doc, 'rt-step-frames10', 'click', () => { stepFrames(10); });
            engine.ui.on(runtime.doc, 'rt-step-hit', 'click', () => { timeControl('hitStop', 120); });
            engine.ui.on(runtime.doc, 'rt-step-slow', 'click', () => { timeControl('slow', 0.5); });
            engine.ui.on(runtime.doc, 'rt-step-reset', 'click', () => { timeControl('reset'); });
            for (const [element, value] of [['rt-step-scale-01', 0.1], ['rt-step-scale-025', 0.25],
                                            ['rt-step-scale-05', 0.5], ['rt-step-scale-1', 1],
                                            ['rt-step-scale-2', 2]]) {
                engine.ui.on(runtime.doc, element, 'click', () => { timeScale(value); });
            }
            engine.ui.on(runtime.doc, 'rt-step-scale-apply', 'click', () => {
                const raw = String(uiValue(runtime.doc, 'rt-step-scale-custom') === null
                    ? '' : uiValue(runtime.doc, 'rt-step-scale-custom')).trim().replace(',', '.');
                const x = Number(raw);
                uiSetText(runtime.doc, 'rt-error', Number.isFinite(x) && x >= 0
                    ? `Масштаб времени ${timeScale(x)}`
                    : 'Масштаб: нужно неотрицательное число.');
            });
            // §39: отчёт — копирование текста и JSON.
            engine.ui.on(runtime.doc, 'rt-report-copy', 'click', () => {
                const text = copyReport('text');
                runtime.console.log.push(`> dump\nотчёт (${text.length} байт) скопирован`);
                while (runtime.console.log.length > CONSOLE_LOG) runtime.console.log.shift();
                refreshRuntime(true);
            });
            engine.ui.on(runtime.doc, 'rt-report-copy-json', 'click', () => {
                const text = copyReport('json');
                runtime.console.log.push(`> dump json\nJSON (${text.length} байт) скопирован`);
                while (runtime.console.log.length > CONSOLE_LOG) runtime.console.log.shift();
                refreshRuntime(true);
            });

            // §27: кнопки хот-релоада ассетов. Данные не трогают: применяется
            // то, что уже прочитано и проверено конвейером $.reload.
            if ($.reload) {
                engine.ui.on(runtime.doc, 'rt-assets-reload', 'click', () => {
                    const res = $.reload.reloadAll();
                    uiSetText(runtime.doc, 'rt-assets',
                        `Перезагружено ${res.applied} из ${res.total}, ошибок ${res.failed}`);
                    refreshRuntime(true);
                });
                engine.ui.on(runtime.doc, 'rt-assets-poll', 'click', () => {
                    const res = $.reload.poll();
                    uiSetText(runtime.doc, 'rt-assets',
                        `Изменилось ${res.applied}, ошибок ${res.failed}`);
                    refreshRuntime(true);
                });
            }
            engine.ui.on(runtime.doc, 'rt-gravity', 'click', () => {
                const x = uiValue(runtime.doc, 'rt-gx');
                const y = uiValue(runtime.doc, 'rt-gy');
                if (!String(x).trim() || !String(y).trim() || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
                    uiSetText(runtime.doc, 'rt-error', 'Введите конечные числа X и Y.');
                    return;
                }
                $.world.gravity(Number(x), Number(y));
                uiSetText(runtime.doc, 'rt-error', 'Гравитация применена к текущему миру.');
            });
        }
        const g = $.world.gravity();
        engine.ui.setValue(runtime.doc, 'rt-gx', String(g.x));
        engine.ui.setValue(runtime.doc, 'rt-gy', String(g.y));
        engine.ui.setProperty(runtime.doc, 'rt', 'width', Math.max(560, Math.min(760, engine.width - 24)) + 'px');
        engine.ui.setProperty(runtime.doc, 'rt', 'height', Math.max(420, Math.min(560, engine.height - 24)) + 'px');
        engine.ui.show(runtime.doc);
        runtime.open = true; runtime.frames = 0;
        setTab(runtime.tab);
        refreshRuntime(true);
        return true;
    }
    function closeRuntime() {
        if (runtime.doc >= 0) engine.ui.hide(runtime.doc);
        runtime.open = false;
        return true;
    }

    const devtools = {
        openRuntime,
        closeRuntime,
        refreshRuntime,
        runtimePanel() {
            return {
                open: runtime.open, doc: runtime.doc, tab: runtime.tab,
                frames: runtime.frames, snapshot: runtime.snapshot,
            };
        },
        /** Переключить вкладку панели F1 (для тестов и команд). */
        tab: setTab,
        /** Текущая вкладка панели F1. */
        tabName() { return runtime.tab; },
        /** Секция инспектора F2 (Identity/Transform/Gameplay/Physics/Presentation). */
        section: setSection,
        sectionName() { return state.section; },

        /** §17: сводка кадра, график, перцентили — те же факты, что в панели. */
        perf() {
            const perf = perfData();
            const graph = graphData(perf);
            return { tab: runtime.tab, rows: perf.rows, summary: perf.summary,
                     text: { summary: perf.text, stats: graph.text, source: graph.source },
                     graph: { source: graph.source, stats: graph.stats, stats_source: graph.stats_source,
                              bars: graph.bars, samples: graph.samples.length, floor_ms: graph.floor_ms } };
        },
        /** §17.3–17.4: дерево профиля (движковые зоны + $.debug.profiler.*). */
        tree() { return treeData(); },
        /** §17.5: наблюдения с previous/delta/min/max/порог. */
        watches() { return watchRows(); },
        watchThreshold,
        watchReset,

        /**
         * §18: захваты долгих кадров — то же, что видно на вкладке HITCH:
         * список (свежие сверху), выбранный захват с разбивкой по зонам и
         * текстами строк. Нет данных — count 0 и честный текст.
         */
        hitch() {
            const h = hitchData();
            return {
                available: h.available, count: h.count, total: h.total,
                threshold: h.threshold, selected: h.selected,
                rows: h.list.slice().reverse().map((rec) => ({
                    index: rec.index, frame: rec.frame, frame_ms: rec.frame_ms,
                    threshold_ms: rec.threshold_ms, reason: rec.reason,
                    reason_zone: rec.reason_zone, reason_ms: rec.reason_ms,
                    text: hitchRowText(rec),
                })),
                capture: h.capture ? {
                    index: h.capture.index, frame: h.capture.frame, frame_ms: h.capture.frame_ms,
                    real_ms: h.capture.real_ms, threshold_ms: h.capture.threshold_ms,
                    center: h.capture.center, filled: h.capture.filled,
                    zones_ms: h.capture.zones_ms, unaccounted_ms: h.capture.unaccounted_ms,
                    reason: h.capture.reason, reason_zone: h.capture.reason_zone,
                    reason_ms: h.capture.reason_ms, ms: h.capture.ms,
                    zone_rows: h.capture.zone_rows,
                } : null,
                text: h.text,
            };
        },
        /** §18: выбрать захват по индексу движка (0 — самый старый). */
        hitchSelect,
        /** §18: порог детектора — прочитать (без аргумента) или выставить. */
        hitchThreshold,
        /** §18: очистить кольцо захватов. */
        hitchClear,
        // --- PASS 4: инспекторы подсистем (§25–§33, §39) --------------------

        /** §25: таблица тел — те же факты, что в панели. */
        physics() {
            const p = physicsData();
            return { mode: p.mode, bodies: p.bodies, overlay: p.overlay, text: p.text };
        },
        /** §25: режим оверлея форм: 'off' | 'all' | 'selected' (без аргумента — чтение). */
        physicsOverlay(mode) { return physOverlay(mode); },

        /** §26: счётчики рендера, цели, текстуры, viewport. */
        render() {
            const r = renderData();
            return { info: r.info, targets: r.targets, textures: r.textures, viewport: r.viewport,
                     lights: r.lights, lights_dropped: r.dropped, text: r.text };
        },

        /** §28: журнал событий ($.trace) — записи, фильтр, потери, цепочка hit. */
        events() {
            const e = eventsData();
            return { on: e.on, count: e.count, dropped: e.dropped, filter: e.filter,
                     paused: e.paused, rows: e.entries, hit: e.hit, text: e.text };
        },
        eventsFilter,
        eventsPause,
        eventsClear,

        /** §29: звук — голоса, шины, каналы. */
        audio() {
            const a = audioData();
            return { busy: a.busy, playing: a.playing, sfx: a.sfx, music: a.music, master: a.master,
                     buses: a.buses, handles: a.handles, channels: a.channels, text: a.text };
        },
        audioStop,
        /** §29: mute/solo/громкость шины. */
        audioBus(what, name, value) { return audioBusControl(what, name, value); },

        /** §29: ввод — действия, привязки, конфликты, ожидания, устройства. */
        input() {
            const i = inputData();
            return { actions: i.actions, bindings: i.bindings, conflicts: i.conflicts,
                     waiters: i.waiters, stuck: i.stuck, consumed: i.consumed,
                     devices: i.devices, pads: i.pads, slots: i.slots, mouse: i.mouse, text: i.text };
        },

        /** §29: ассеты — таблица наблюдаемых ассетов (§27 остаётся в assets()). */
        assetsTab() {
            const a = assetsData();
            return { available: a.available, list: a.list, stats: a.stats, text: a.text };
        },

        /** §29: счётчики/пределы с дельтами и подозрением на рост. */
        memory() {
            const m = memoryData();
            return { counters: m.counters, limits: m.limits, deltas: m.deltas,
                     samples: m.samples, series: m.series, window_frames: m.window_frames,
                     leaks: m.leaks, text: m.text };
        },
        memoryBaseline: memBaseline,

        /** §31: консоль — выполнить строку, история, лог. */
        consoleRun,
        consoleClear,
        consoleHistory() { return runtime.console.history.slice(); },
        consoleLog() { return runtime.console.log.slice(); },
        consoleLast() { return runtime.console.last; },

        /** §33: состояние времени и шаг кадра. */
        timeStep() { return stepData(); },
        step() { return stepFrames(1); },
        steps(n) { return stepFrames(n); },
        pause: pauseTime,
        timeScale,
        timeControl,

        /** §39: отчёт — снимок, текст, JSON и копирование. */
        report() { return reportData(); },
        copyReport,

        /** Открыта ли панель F1 (нужно кадровым оверлеям вроде §25). */
        runtimeOpen() { return runtime.open; },

        /** Кадровый шаг оверлея физики (вызывает tickDevTools). */
        tickOverlay() { tickPhysicsOverlay(); },
        /** Кадровый шаг «шага кадра»: вернуть паузу после N кадров (§33). */
        tickStep() {
            if (runtime.step_left > 0) {
                runtime.step_left--;
                if (runtime.step_left === 0) call(() => $.time.pause(), null);
            }
        },


        /** Открыть панель (в сборке без RmlUi честно вернёт false). */
        open,
        close,
        toggle() { return state.open ? (close(), false) : open(); },
        isOpen() { return state.open; },

        /** Выбрать сущность по uid (строки списка) — для тестов и команд. */
        select,

        /** Выбрать по селектору: `$.devtools.selectBy('#hero')`. */
        selectBy,

        /** Селектор выбранной сущности — то, что копирует кнопка. */
        selector() { return state.selector; },

        /** §20: поиск по selector/ID/tag/kind/prefab/state. */
        search(text) {
            const r = applySearch(text);
            if (state.doc >= 0) uiSetValue(state.doc, 'dt-search', state.search);
            refresh(true);
            return r;
        },
        searchText() { return { text: state.search, kind: state.search_kind }; },

        /** §20: фильтры visible/physics/active/room. */
        filter(name, value) { return setFilter(name, value); },
        filters() { return Object.assign({}, state.filters); },

        /** §20: данные всех секций выбранного узла (те же, что в панели). */
        inspect,

        /**
         * §20: текущая выборка списка с учётом поиска и фильтров — те же
         * факты, что видны в панели. Порядок совпадает с порядком строк.
         */
        list() {
            const room = roomNodeSet();
            return filtered().map(({ brief, node }) => ({
                uid: node.uid,
                nid: node.nid,
                selector: selectorOf(node),
                tag: node.tag,
                kind: node.kind,
                class: [...node.classes].join(' ') || null,
                prefab: prefabName(node) || null,
                state: node.attrs && node.attrs.state !== undefined ? node.attrs.state : null,
                body: isNum(brief.body) ? brief.body : null,
                visible: brief.visible === true,
                active: call(() => effectiveProcessing(node).update !== false, null),
                room: room ? room.has(node.uid) : null,
            }));
        },

        /** §21: режим Pick entity. */
        pickMode(on) { return setPick(on); },
        pickOn() { return state.pick; },
        /** Кадровый шаг picking: подсветка bounds и выбор кликом по миру. */
        tickPick,
        /** Выбор кликом по экранной точке — тем же путём, что и клик мышью. */
        pickAt(x, y) {
            const was = state.pick;
            state.pick = true;
            const r = pickFromScreen({ x: Number(x) || 0, y: Number(y) || 0 });
            state.pick = was;
            return r;
        },
        /** Последний выбор кликом: selector/source/координаты (§21). */
        picked() { return state.last_pick; },
        pickHover() { return state.pick_hover_uid; },

        /** §21: действия копирования. LastCopied — что реально ушло в буфер. */
        copySelector, copyNodeId, copyJs,
        lastCopied() { return state.last_copied; },

        /** Машиночитаемое состояние панели (правила 8–9: только факты). */
        panel() {
            return {
                open: state.open,
                doc: state.doc,
                rows: state.rows,
                entities: state.entities,
                selected: state.selected_uid,
                selected_nid: state.selected_nid,
                selector: state.selector,
                refreshed: state.refreshed,
                search: state.search,
                search_kind: state.search_kind,
                filters: Object.assign({}, state.filters),
                offset: state.offset,
                section: state.section,
                pick: state.pick,
                pick_hover: state.pick_hover_uid,
                picked: state.last_pick,
            };
        },

        /**
         * §27: состояние хот-релоада ассетов — индикатор, список и граф.
         * Тесты и внешние инструменты видят те же факты, что панель.
         */
        assets() {
            if (!$.reload) return null;
            return { indicator: $.reload.indicator(), stats: $.reload.stats(),
                     list: $.reload.list(), graph: $.reload.graph() };
        },

        /** Нажать кнопки хот-релоада программно (без RmlUi): тесты и команды. */
        assetsReload() { return $.reload ? $.reload.reloadAll() : null; },
        assetsPoll() { return $.reload ? $.reload.poll() : null; },

        /** Перерисовать немедленно (тесты и внешние команды). */
        refresh() {
            refresh(true);
            return devtools.panel();
        },
    };

    ctx.devtools = devtools;
    $.devtools = devtools;
}

/** Кадровый шаг: F2 открывает/закрывает панель, содержимое обновляется редко. */
export function tickDevTools(dt) {
    const d = ctx.devtools;
    if (!d) return;
    if (ctx.input && ctx.input.pressed) {
        if (ctx.input.pressed('f2')) d.toggle();
        if (ctx.input.pressed('f1') && ctx.debug) ctx.debug.toggle();
    }
    d.refreshRuntime();
    if (d.isOpen()) {
        d.refresh();
        // §21: подсветка и выбор кликом — каждый кадр, но только пока панель
        // открыта и включён режим Pick entity.
        if (d.pickOn()) d.tickPick();
    }
    // §25: оверлей форм физики живёт на панели F1 (runtime), а не на F2 —
    // проверять надо именно её открытость.
    if (d.runtimeOpen() && d.physicsOverlay() !== 'off') d.tickOverlay();
    // §33: «шаг кадра» — вернуть паузу после запрошенного числа кадров.
    d.tickStep();
}
