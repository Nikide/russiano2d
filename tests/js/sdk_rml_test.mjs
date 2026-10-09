// RML-модель RmlUi Studio: разбор, правки, ссылки, RCSS. Запуск: qjs -m tests/js/sdk_rml_test.mjs
import * as R from '../../sdk/lib/rml_model.js';

let fails = 0;
const check = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

const SRC = `<rml>
<head>
    <link type="text/rcss" href="menu.rcss"/>
    <title>Меню</title>
</head>
<body>
<!-- комментарий <b> -->
<div id="menu" class="panel big">
    <h1>Заголовок &amp; тест</h1>
    <button id="btn-play" class="btn" disabled>Играть</button>
    <input type="text" value="a>b"/>
</div>
</body>
</rml>
`;

const p = R.parse(SRC);
check(p.diagnostics.length === 0, 'корректный документ без диагностик');
check(p.nodes.map((n) => n.tag).join(',') === 'rml,head,link,title,body,div,h1,button,input', 'порядок элементов');
const div = p.nodes.find((n) => n.tag === 'div');
check(R.label(div) === 'div#menu.panel.big', 'метка элемента как селектор');
check(div.children.length === 3 && div.depth === 2, 'дети и глубина');
const input = p.nodes.find((n) => n.tag === 'input');
check(R.attr(input, 'value') === 'a>b', '«>» внутри кавычек не обрывает тег');
const btn = p.nodes.find((n) => n.tag === 'button');
check(btn.attrs.find((a) => a.name === 'disabled').bare === true, 'атрибут без значения');

const t2 = R.setAttrs(SRC, btn, { class: 'btn primary', id: 'play' });
check(t2.includes('<button id="play" class="btn primary" disabled>Играть</button>'), 'setAttrs: порядок и bare сохраняются');
check(R.parse(t2).diagnostics.length === 0, 'после правки документ корректен');
check(R.setAttrs(SRC, btn, { disabled: null }).includes('<button id="btn-play" class="btn">'), 'атрибут удаляется');

const h1 = p.nodes.find((n) => n.tag === 'h1');
check(R.innerText(SRC, h1) === 'Заголовок & тест', 'innerText снимает сущности');
const t3 = R.setInnerText(SRC, h1, 'A < B & C');
check(t3.includes('<h1>A &lt; B &amp; C</h1>') && R.parse(t3).diagnostics.length === 0, 'setInnerText экранирует');
let threw = false;
try { R.setInnerText(SRC, div, 'x'); } catch (e) { threw = true; }
check(threw, 'текст нельзя править у элемента с детьми');

check(R.links(p).length === 1 && R.links(p)[0].href === 'menu.rcss', 'ссылки на стили');
const t4 = R.retargetLinks(SRC, { 'menu.rcss': '.draft-menu.rcss' });
check(t4.includes('href=".draft-menu.rcss"') && !t4.includes('"menu.rcss"'), 'retargetLinks подменяет href');
const wb = R.withBodyId(SRC, 'r2d-pv');
check(wb.id === 'r2d-pv' && wb.text.includes('<body id="r2d-pv">'), 'withBodyId ставит id');
check(R.withBodyId(wb.text, 'x').id === 'r2d-pv', 'уже есть id — не трогаем');

const bad = R.parse('<rml><body><div></body></rml>');
check(bad.diagnostics.some((d) => d.code === 'SDK_RML_UNBALANCED'), 'несоответствие закрывающего тега');
check(R.parse('<rml><body><div>').diagnostics.some((d) => d.code === 'SDK_RML_UNCLOSED'), 'незакрытые теги');
check(R.parse('<html></html>').diagnostics.some((d) => d.code === 'SDK_RML_ROOT'), 'корень не <rml>');
check(R.parse('<rml><!-- x').diagnostics.some((d) => d.code === 'SDK_RML_UNCLOSED'), 'незакрытый комментарий');

check(R.checkRcss('a { color: red; } /* c } */ b { x: "}"; }').length === 0, 'RCSS: скобки в комментариях и строках не считаются');
check(R.checkRcss('a { color: red;').some((d) => d.code === 'SDK_RCSS_BRACES'), 'RCSS: не закрыт блок');
check(R.checkRcss('a { } }').some((d) => d.code === 'SDK_RCSS_BRACES'), 'RCSS: лишняя «}»');
check(R.checkRcss('a { } /* x').some((d) => d.code === 'SDK_RCSS_COMMENT'), 'RCSS: не закрыт комментарий');

console.log(fails ? 'ПРОВАЛОВ: ' + fails : 'Все проверки пройдены');
if (fails) throw new Error('fail');
