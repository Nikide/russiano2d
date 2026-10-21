// Модель графа проекта Editor: виды, раскладка, поиск, навигация.
import { normalizeGraph, overviewView, areaView, scenesView, resourcesView, searchGraph, locate, describe, crumbsOf, cardOf } from '../../editor/lib/shared/graph_model.js';

let checks = 0;
function check(cond, msg) { checks++; if (!cond) { console.log('FAIL ' + msg); throw new Error(msg); } else console.log('  ok   ' + msg); }

const ent = (key, area, type, extra) => Object.assign({ key, area, type, origin: 'code' }, extra);
const edge = (type, from, to, api) => ({ key: 'edge:' + type + ':' + from + '>' + to, type, from, to, origin: 'code', evidence: { api, file: 'main.js', line: 1 } });

const raw = {
    format: 1, status: 'current', sources: [], diagnostics: [],
    areas: [
        { key: 'project:main', type: 'project', label: 'Проект' },
        { key: 'world:game', type: 'world', label: 'World', runtime_root: '$.world', scene: 'scene:game' },
        { key: 'children:object:hero', type: 'entity', label: '<player> #hero', entity: 'object:hero', parent: 'world:game' },
    ],
    entities: [
        ent('script:main.js', 'project:main', 'script', { path: 'main.js', entry: true }),
        ent('scene:game', 'project:main', 'scene', { name: 'game', source: { file: 'main.js', line: 1 } }),
        ent('object:hero', 'world:game', 'object', { tag: 'player', public_id: 'hero', source: { file: 'main.js', line: 2 } }),
        ent('object:hero_body', 'world:game', 'object', { tag: 'sprite', public_id: 'hero_body', source: { file: 'main.js', line: 6 } }),
        ent('object:smoke', 'world:game', 'object', { tag: 'particles', public_id: 'smoke', source: { file: 'main.js', line: 10 } }),
        ent('resource:art/hero.png', 'project:main', 'resource', { path: 'art/hero.png' }),
    ],
    edges: [
        edge('scene_registration', 'script:main.js', 'scene:game', '$.scene.add'),
        edge('spatial_parent', 'world:game', 'object:hero', 'appendTo'),
        edge('spatial_parent', 'object:hero', 'object:hero_body', 'appendTo'),
        edge('spatial_parent', 'object:hero', 'object:smoke', 'appendTo'),
        edge('uses_resource', 'object:hero_body', 'resource:art/hero.png', 'sprite'),
        { key: 'edge:bad', type: 'spatial_parent', from: 'nope', to: 'object:hero' },
    ],
};

const g = normalizeGraph(raw);
check(g && g.entities.size === 6 && g.edges.length === 5, 'граф разобран, битое ребро отброшено');
check(g.problems.length === 1, 'битое ребро записано в problems');
check(normalizeGraph(null) === null && normalizeGraph(undefined) === null, 'нет графа → null');

const ov = overviewView(g);
const kinds = (v) => v.nodes.map((n) => n.kind).sort().join(',');
check(kinds(ov) === 'resource,scene,script,world', 'обзор: скрипт, сцена, World, ресурс (' + kinds(ov) + ')');
check(ov.edges.some((e) => e.type === 'scene_registration') && ov.edges.some((e) => e.from === 'scene:game' && e.to === 'world:game' && e.label === '.world'),
      'обзор: регистрация сцены отдельно, World связан со сценой');
check(!ov.edges.some((e) => e.type === 'spatial_parent'), 'обзор: сцена не пространственный родитель');
check(ov.edges.some((e) => e.type === 'uses_resource' && e.from === 'world:game'), 'обзор: ресурс World агрегирован');
check(ov.nodes.every((n) => n.x >= 0 && n.y >= 0 && n.w > 0), 'у карточек есть координаты');
const world = ov.nodes.find((n) => n.kind === 'world');
check(world.open === 'world:game' && /3 объекта/.test(world.sub), 'карточка World открывается и считает объекты (' + world.sub + ')');

const wv = areaView(g, 'world:game');
check(wv.nodes.find((n) => n.root).kind === 'world', 'World-область: корень');
const titles = wv.nodes.map((n) => n.title);
check(titles.includes('<player> #hero') && titles.includes('<sprite> #hero_body') && titles.includes('<particles> #smoke'),
      'World: объекты как <тег> #id');
check(wv.edges.some((e) => e.from === 'object:hero' && e.to === 'object:hero_body' && e.label === '.appendTo(…)'), 'World: связь .appendTo(…)');
check(wv.edges.some((e) => e.type === 'uses_resource' && e.label === '.sprite(…)' && e.to === 'resource:art/hero.png'), 'World: связь .sprite(…) с ресурсом');
const hero = wv.nodes.find((n) => n.id === 'object:hero');
check(hero.open === 'children:object:hero', 'составной объект открывается как область');
check(wv.crumbs.map((c) => c.label).join(' / ') === 'Проект / Сцена game / World', 'крошки: ' + wv.crumbs.map((c) => c.label).join(' / '));

const ev = areaView(g, 'children:object:hero');
check(ev.crumbs.map((c) => c.label).join(' / ') === 'Проект / Сцена game / World / <player> #hero', 'крошки сущности');
check(ev.nodes.filter((n) => !n.root).length === 3, 'область сущности: потомки и ресурс');
check(areaView(g, 'project:main') === null && areaView(g, 'нет') === null, 'не-области не открываются');

// Агрегирование большого World.
const bigRaw = JSON.parse(JSON.stringify(raw));
for (let i = 0; i < 80; i++) {
    bigRaw.entities.push(ent('object:n' + i, 'world:game', 'object', { tag: 'enemy' }));
    bigRaw.edges.push(edge('spatial_parent', 'world:game', 'object:n' + i, 'appendTo'));
}
const big = normalizeGraph(bigRaw);
const bv = areaView(big, 'world:game');
check(bv.collapsed === true, 'большой World агрегируется');
const bHero = bv.nodes.find((n) => n.id === 'object:hero');
check(bHero.badge === '+2', 'карточка с детьми показывает «+N» (' + bHero.badge + ')');
check(!bv.nodes.some((n) => n.id === 'object:smoke'), 'потомки свёрнуты');
check(locate(big, 'object:smoke').area === 'children:object:hero', 'locate ведёт к предку свёрнутой области');
check(locate(g, 'object:smoke').area === 'world:game', 'locate в малом World — сама область');

check(searchGraph(g, 'hero').length >= 2, 'поиск по id');
check(searchGraph(g, 'particles')[0].key === 'object:smoke', 'поиск по тегу');
check(searchGraph(g, 'hero.png')[0].kind === 'resource', 'поиск по пути ресурса');
check(searchGraph(g, 'main.js').length >= 3, 'поиск по месту в коде');
check(searchGraph(g, '').length === 0, 'пустой запрос — пусто');

const d = describe(g, 'object:hero');
check(d.find((r) => r[0] === 'Тип')[1] === '<player>' && d.find((r) => r[0] === 'Потомков')[1] === '2', 'describe: тип и потомки');
check(d.find((r) => r[0] === 'Файл')[2].line === 2, 'describe: ссылка на код');
check(describe(g, 'resource:art/hero.png').some((r) => r[0] === 'Используют' && r[1] === '1'), 'describe: ресурс');

check(scenesView(g).nodes.length === 3 && resourcesView(g).nodes.length === 2, 'виды «Сцены» и «Ресурсы»');
check(cardOf(g, 'object:hero').icon === 'directions_run', 'иконка по тегу');
check(crumbsOf(g, 'world:game').length === 3, 'crumbsOf');
console.log('graph_model_test: ' + checks + ' checks');
