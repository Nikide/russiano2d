import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { API_DOCS_CATALOG } from '../../src/highlevel/api_docs_catalog.js';
import { documentApiMethod, documentApiSymbol, installApiDocs } from '../../src/highlevel/api_docs.js';

test('installApiDocs exposes generated metadata without enumerating it on $', () => {
    const api = {};
    installApiDocs(api);
    truthy(Object.keys(api).length === 0);
    truthy(api.__r2dApiDocs['$.gfx.push.stats']);
    eq(api.__r2dApiDocs['$.gfx.push.stats'].kind, 'function');
    eq(api.__r2dApiDoc('$.missing'), null);
});

test('documentApiSymbol and documentApiMethod register metadata and preserve functions', () => {
    const api = {};
    installApiDocs(api);
    documentApiSymbol(api, '$.test.extra', { kind: 'method', description: 'test' });
    const fn = () => 7;
    eq(documentApiMethod(api, '$.test.fn', fn, { kind: 'function' }), fn);
    eq(api.__r2dApiDoc('$.test.extra').description, 'test');
    eq(api.__r2dApiDoc('$.test.fn').kind, 'function');
    falsy(Object.keys(api).includes('__r2dApiDocs'));
});

test('generated catalog contains unique paths with callable metadata', () => {
    const paths = Object.keys(API_DOCS_CATALOG);
    truthy(paths.length > 1000);
    eq(new Set(paths).size, paths.length);
    for (const path of paths) {
        truthy(path.startsWith('$.'));
        truthy(API_DOCS_CATALOG[path] && API_DOCS_CATALOG[path].kind);
    }
});

finish();
