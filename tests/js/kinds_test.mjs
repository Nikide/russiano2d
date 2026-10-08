// ===========================================================================
// Юнит-тесты видов узла (`.kind()`, `$.kinds`, `Re2D`) — фаза 1 docs/RE2D.md.
//
// Главное правило: узел без `kind` — обычный 2D. Поэтому половина проверок о
// том, что для 2D ничего не изменилось: вид по умолчанию '2d', в данных
// prefab и снимке агента ключа `kind` у 2D-узла нет, а селекторы и реестр
// работают как раньше.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/kinds_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';
import { ctx, query } from '../../src/highlevel/core.js';
import {
    KIND_2D, KIND_RE2D, registerKind, hasKind, kindNames, normalizeKind,
    registerKindRenderer, kindRenderer, kindOf,
} from '../../src/highlevel/kinds.js';
import { nodeToData, applyData } from '../../src/highlevel/prefab.js';

const $ = createApi();

function clearWorld() {
    $('*').remove();
}

function throws(fn, fragment) {
    try { fn(); } catch (error) {
        const message = String(error && error.message ? error.message : error);
        if (fragment && !message.includes(fragment)) {
            throw new Error(`ошибка без подсказки «${fragment}»: ${message}`);
        }
        return;
    }
    throw new Error('ожидалось исключение');
}

test('константа Re2D: $.Re2D, глобальное имя и $.kinds.Re2D совпадают', () => {
    eq($.Re2D, 're2d', '$.Re2D');
    eq(globalThis.Re2D, 're2d', 'глобальное Re2D');
    eq($.kinds.Re2D, 're2d', '$.kinds.Re2D');
    eq(KIND_RE2D, 're2d', 'KIND_RE2D');
    eq(KIND_2D, '2d', 'KIND_2D');
});

test('в реестре два вида: 2d и re2d', () => {
    truthy(hasKind('2d') && hasKind('re2d'), 'оба зарегистрированы');
    eq(kindNames().slice(0, 2).join(','), '2d,re2d', 'порядок регистрации');
    falsy(hasKind('3d'), 'чужого вида нет');
});

test('узел без kind — обычный 2D', () => {
    clearWorld();
    const hero = $('<npc>', { id: 'bob' }).at(10, 20);
    eq(hero.kind(), '2d', 'вид по умолчанию');
    eq(hero.get(0).kind, '2d', 'поле узла');
    eq($('#nobody').kind(), '2d', 'пустая выборка — тоже 2d');
});

test('.kind(Re2D) назначает вид и возвращает цепочку', () => {
    clearWorld();
    const npc = $('<npc>', { id: 'russi' }).at(500, 400);
    const same = npc.kind(Re2D);
    eq(same, npc, 'цепочка');
    eq(npc.kind(), 're2d', 'вид после назначения');
    eq(npc.pos().x, 500, 'позиция не тронута');
    eq(npc.pos().y, 400, 'позиция не тронута');
});

test('kind назначается всей выборке, null возвращает 2D', () => {
    clearWorld();
    $('<npc>', { class: 'friend' }).at(0, 0);
    $('<npc>', { class: 'friend' }).at(1, 0);
    $('.friend').kind(Re2D);
    eq($('[kind=re2d]').length, 2, 'оба в Re2D');
    $('.friend').eq(0).kind(null);
    eq($('[kind=re2d]').length, 1, 'один вернули в 2D');
    eq($('[kind=2d]').length, 1, 'селектор по умолчанию тоже работает');
    $('.friend').kind('2d');
    eq($('[kind=re2d]').length, 0, 'вернули всех');
});

test('kind в атрибутах конструктора', () => {
    clearWorld();
    const n = $('<npc>', { kind: Re2D });
    eq(n.kind(), 're2d', 'вид из конструктора');
    throws(() => $('<npc>', { kind: 'nope' }), 'неизвестный вид');
});

test('неизвестный вид — ошибка с подсказкой', () => {
    clearWorld();
    const n = $('<npc>');
    throws(() => n.kind('3d'), 'доступны: 2d, re2d');
    throws(() => n.kind(42), 'неизвестный вид');
    eq(n.kind(), '2d', 'после ошибки вид прежний');
});

test('normalizeKind: пустые значения — это 2D', () => {
    eq(normalizeKind(null), '2d', 'null');
    eq(normalizeKind(undefined), '2d', 'undefined');
    eq(normalizeKind(''), '2d', 'пустая строка');
    eq(normalizeKind(false), '2d', 'false');
    eq(normalizeKind('re2d'), 're2d', 're2d');
});

test('registerKind: имя — строчная строка', () => {
    throws(() => registerKind(''), 'непустая строка');
    throws(() => registerKind('Mine'), 'строчными');
    eq(registerKind('probe', { title: 'Проба' }), 'probe', 'зарегистрирован');
    truthy(hasKind('probe'), 'теперь известен');
    eq(normalizeKind('probe'), 'probe', 'нормализуется');
});

test('отрисовщик вида: регистрация и чтение', () => {
    eq(kindRenderer('re2d'), undefined, 'у re2d пока нет отрисовщика (фаза 4)');
    const fn = () => true;
    registerKindRenderer('probe', fn);
    eq(kindRenderer('probe'), fn, 'функция та же');
    throws(() => registerKindRenderer('probe', 5), 'нужна функция');
    throws(() => registerKindRenderer('ghost', fn), 'не зарегистрирован');
});

test('kindOf терпит заглушки без поля', () => {
    eq(kindOf({}), '2d', 'объект без поля');
    eq(kindOf(null), '2d', 'null');
    eq(kindOf({ kind: 're2d' }), 're2d', 'поле есть');
});

test('$.kinds.list и $.kinds.of — структура фактов', () => {
    clearWorld();
    $('<npc>', { id: 'a' });
    $('<npc>', { id: 'b' }).kind(Re2D);
    const list = $.kinds.list();
    const re2d = list.find((k) => k.name === 're2d');
    const flat = list.find((k) => k.name === '2d');
    eq(re2d.nodes, 1, 'узлов в re2d');
    eq(flat.nodes, 1, 'узлов в 2d');
    eq(typeof re2d.renderer, 'boolean', 'флаг отрисовщика');
    eq($.kinds.of('#b'), 're2d', 'of(селектор)');
    eq($.kinds.of('#none'), null, 'нет узла — null');
});

test('prefab: у 2D-узла ключа kind нет, у Re2D — есть, и он восстанавливается', () => {
    clearWorld();
    const flat = $('<npc>', { id: 'flat' }).get(0);
    const data2d = nodeToData(flat);
    falsy('kind' in data2d, 'ключ kind у 2D-узла не пишется (сохранения прежние)');

    const tall = $('<npc>', { id: 'tall' }).kind(Re2D).get(0);
    const data = nodeToData(tall);
    eq(data.kind, 're2d', 'вид сохранён');

    const copy = applyData(Object.assign({}, data, { id: 'tall-copy' }), null);
    eq(copy.kind, 're2d', 'вид восстановлен');
});

test('prefab: порядок ключей 2D-данных не изменился', () => {
    clearWorld();
    const keys = Object.keys(nodeToData($('<rect>').get(0)));
    eq(keys.join(','),
        'tag,id,class,tags,data,x,y,w,h,angle,scaleX,scaleY,alpha,visible,layer,depth,color,'
        + 'hoverColor,textColor,fillColor,text,fontSize,value,max,radius,intensity,r,team,hp,'
        + 'maxHp,body,gravity,hitbox,collisionMask,layerBits,collisionGroup,sprite,frame,attrs,children',
        'набор и порядок ключей');
});

test('снимок агента: kind только у не-2D узлов', () => {
    clearWorld();
    $('<npc>', { id: 'flat' });
    $('<npc>', { id: 'tall' }).kind(Re2D);
    const flat = $.agent.node('#flat');
    const tall = $.agent.node('#tall');
    falsy('kind' in flat, 'у 2D-узла поля нет');
    eq(tall.kind, 're2d', 'у Re2D-узла есть');
});

test('реестр узлов не затронут: kind не меняет версию и срезы', () => {
    clearWorld();
    $('<npc>', { id: 'a' }).kind(Re2D);
    eq(query('npc').length, 1, 'селектор по тегу');
    eq(ctx.nodes.length, 1, 'узел один');
});

finish();
