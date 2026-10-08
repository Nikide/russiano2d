// ===========================================================================
// Стенд замера стоимости высокоуровневого API $.
//
// Зачем: у движка есть профайлер кадра (src/profile.c), но нет сцены, на
// которой видно, сколько стоит сам слой $ — цикл кадра, селекторы, обёртки,
// сборка батча. Этот стенд даёт такую сцену: вид работы и количество объектов
// задаются через --scene "<вид>:<N>", например
//
//   ./build/russiano2d --game tests/fixtures/bench --scene sprite:1000 \
//       --agent --headless --fixed-dt 0.0166667 --seed 1
//
// Прогоняет и читает замеры tools/bench_highlevel.py. Сценарий намеренно
// повторяет то, как пишут игры: наивный вариант (селектор и обёртка в кадре)
// идущий рядом с кэшированным — разница между ними и есть цена API.
//
// Виды:
//   none      — пустая сцена: фиксированная цена цикла кадра;
//   sprite    — N статических прямоугольников: перебор узлов + сборка батча;
//   body      — N динамических тел: синхронизация физики + перебор узлов;
//   query     — N узлов, каждый кадр $('.mob') с обходом .each() (как в примерах);
//   id        — N узлов, один поиск $('#mob<k>') за кадр (селектор по id);
//   cached    — та же работа, что в query, но по массиву из $.ready;
//   tween     — N параллельных циклических твинов;
//   particles — один эмиттер на N частиц;
//   ui        — N узлов интерфейса (ui.label);
//   text      — N мировых надписей (у каждой свой measureText/drawText);
//   tilemap   — карта N тайлов (сетка cols×rows ≈ N);
//   signal    — N рассылок $.signal.emit за кадр с одним подписчиком;
//   chain     — N узлов, каждый кадр цепной метод ядра ($('.mob').alpha(1));
//   fast      — то же, но обход через .eachNode(): без обёртки на узел;
//   churn     — N узлов в мире + пачка спавна/удаления каждый кадр;
//   batch     — то же самое, но пачка идёт через $.batch (одна уборка реестра).
// ===========================================================================

const spec = String($.startScene || 'none:0');
const parts = spec.split(':');
const KIND = parts[0] || 'none';
const N = Math.max(0, parseInt(parts[1] || '0', 10) || 0);

// Сетка, центрированная в начале координат: камера стоит в (0,0), поэтому все
// узлы попадают в кадр и отсечение по экрану их не выкидывает.
function grid(i, cols, step) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { x: (col - (cols - 1) / 2) * step, y: (row - (cols - 1) / 2) * step };
}

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(-100000, -100000, 200000, 200000);
    $.camera.at(0, 0);

    // Стенд сам о себе рассказывает: сколько узлов вышло и сколько нарисовано.
    $.bench = { kind: KIND, wanted: N, nodes: 0 };

    if (KIND === 'none') {
        $.bench.nodes = 0;
        return;
    }

    if (KIND === 'sprite' || KIND === 'query' || KIND === 'id' || KIND === 'cached' || KIND === 'signal'
        || KIND === 'chain' || KIND === 'fast') {
        const cols = Math.ceil(Math.sqrt(N)) || 1;
        const nodes = [];
        for (let i = 0; i < N; i++) {
            const p = grid(i, cols, 24);
            const node = $('<rect>', { id: 'mob' + i, class: 'mob' })
                .at(p.x, p.y).size(16, 16).color('#3aa0ff')
                .appendTo($.world).nodes[0];
            nodes.push(node);
        }
        $.bench.nodes = N;

        if (KIND === 'query') {
            // Наивный, но самый частый в примерах способ: каждый кадр заново
            // найти всех и обойти обёрткой.
            $.update(() => {
                // Колбэк получает (i, обёртка): раньше здесь стояло `(el) =>`,
                // то есть el был индексом, и сцена ничего не двигала.
                $('.mob').each((i, el) => { el.x += 0.1; });
            });
        } else if (KIND === 'chain') {
            // Цепной метод ядра: внутри он обходит узлы через eachNode() и
            // обёртку на узел не создаёт — видно цену самого обхода.
            $.update(() => { $('.mob').alpha(1); });
        } else if (KIND === 'fast') {
            // Явный обход без обёртки: то же, что .each(), но колбэк получает
            // сам узел (docs/HIGH_LEVEL_API.md, «Коллекция»).
            $.update(() => { $('.mob').eachNode((i, n) => { n.x += 0.1; }); });
        } else if (KIND === 'cached') {
            // То же самое, но узлы найдены один раз.
            $.update(() => {
                for (let i = 0; i < nodes.length; i++) nodes[i].x += 0.1;
            });
        } else if (KIND === 'id') {
            // Поиск по id: каждый кадр один запрос по разным узлам. Именно так
            // выглядит «найти игрока» у каждого врага — при N врагах это уже
            // N запросов за кадр, поэтому здесь запрос один: видно цену самого
            // поиска, а не его квадрат.
            let k = 0;
            $.update(() => {
                $('#mob' + (k % N)).x += 0.1;
                k++;
            });
        } else if (KIND === 'signal') {
            $.signal.on('bench:tick', () => { $.bench.hits = ($.bench.hits || 0) + 1; });
            $.update(() => {
                for (let i = 0; i < N; i++) $.signal.emit('bench:tick', i);
            });
        }
        return;
    }

    if (KIND === 'body') {
        const cols = Math.ceil(Math.sqrt(N)) || 1;
        const bodies = [];
        for (let i = 0; i < N; i++) {
            const p = grid(i, cols, 48);
            const node = $('<enemy>', { id: 'mob' + i })
                .at(p.x, p.y).size(16, 16).color('#ff7a59')
                .appendTo($.world).nodes[0];
            bodies.push(node);
        }
        $.bench.nodes = N;
        // Держим тела в движении: спящее тело Box2D почти ничего не стоит, а
        // нам нужна цена «тысячи живых тел», как в реальной сцене.
        const movers = $(bodies);
        $.update(() => { movers.velocity(30, 0); });
        return;
    }

    if (KIND === 'tween') {
        const cols = Math.ceil(Math.sqrt(N)) || 1;
        for (let i = 0; i < N; i++) {
            const p = grid(i, cols, 24);
            const node = $('<rect>', { id: 'mob' + i }).at(p.x, p.y).size(16, 16).appendTo($.world);
            // .property() возвращает Tweener, а не Tween: цепочку ведём от
            // самого объекта твина — иначе .loops() улетает в Tweener.
            const t = $.tween(node);
            t.property('x', p.x + 40, 1);
            t.loops(-1);
        }
        $.bench.nodes = N;
        return;
    }

    if (KIND === 'particles') {
        $('<particles>', {
            id: 'fx',
            amount: Math.max(1, N),
            rate: Math.max(1, N) * 4,
            lifetime: 2000,
            speed: [20, 60],
            spread: 360,
            size: [2, 4],
            seed: 7,
        }).at(0, 0).appendTo($.world);
        $.bench.nodes = 1;
        return;
    }

    if (KIND === 'ui') {
        const cols = Math.ceil(Math.sqrt(N)) || 1;
        for (let i = 0; i < N; i++) {
            const p = grid(i, cols, 40);
            $('<ui.label>', { id: 'ui' + i, text: 'метка ' + i })
                .at(p.x, p.y).size(0, 0).appendTo($.ui);
        }
        $.bench.nodes = N;
        return;
    }

    if (KIND === 'text') {
        const cols = Math.ceil(Math.sqrt(N)) || 1;
        for (let i = 0; i < N; i++) {
            const p = grid(i, cols, 48);
            $('<text>', { id: 't' + i, text: 'кадр ' + i })
                .at(p.x, p.y).size(0, 0).appendTo($.world);
        }
        $.bench.nodes = N;
        return;
    }

    if (KIND === 'churn' || KIND === 'batch') {
        // Очереди выстрелов и волны врагов: узлы рождаются и умирают пачками.
        // Разница между churn и batch — цена K удалений из реестра
        // (docs/HIGH_LEVEL_API_PERF.md §3.6, пункты 14–15 плана).
        const per_frame = Math.max(4, Math.round(N / 10));
        const cols = Math.ceil(Math.sqrt(N)) || 1;
        for (let i = 0; i < N; i++) {
            const p = grid(i, cols, 12);
            $('<rect>', { class: 'base' }).at(p.x, p.y).size(8, 8).appendTo($.world);
        }
        $.bench.nodes = N;
        $.update(() => {
            const work = () => {
                for (let i = 0; i < per_frame; i++) {
                    $('<rect>', { class: 'churn' }).at(i * 3, 0).size(8, 8).appendTo($.world);
                }
                $('.churn').remove();
            };
            if (KIND === 'batch') $.batch(work);
            else work();
        });
        return;
    }

    if (KIND === 'tilemap') {
        const cols = Math.max(1, Math.ceil(Math.sqrt(N)));
        const rows = Math.max(1, Math.ceil(N / cols));
        const solid = [];
        const deco = [];
        for (let y = 0; y < rows; y++) {
            solid.push('1'.repeat(cols));
            deco.push((y % 2 === 0 ? '2' : '.').repeat(cols));
        }
        const map = $('<tilemap>', {
            id: 'map',
            // Путь к текстуре движок разрешает от рабочего каталога запуска
            // (корня репозитория), а не от каталога игры: стенд гоняют из
            // корня, поэтому путь полный.
            src: 'tests/fixtures/bench/assets/tiles.png',
            tile: 16,
            cols: cols,
            layers: [
                { data: solid, solid: false, depth: 0, tile: 16 },
                { data: deco, solid: false, depth: 1, tile: 16 },
            ],
        }).at(0, 0).appendTo($.world);
        $.bench.nodes = cols * rows;
        return;
    }
});
