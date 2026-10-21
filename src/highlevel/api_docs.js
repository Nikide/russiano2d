// Documentation metadata for the public `$` API.
// The registry is non-enumerable so it does not become part of the game API.
import { API_DOCS_CATALOG } from './api_docs_catalog.js';

export function installApiDocs($) {
    const registry = Object.assign(Object.create(null), API_DOCS_CATALOG);
    Object.defineProperty($, '__r2dApiDocs', {
        value: registry,
        configurable: false,
        enumerable: false,
        writable: false,
    });
    Object.defineProperty($, '__r2dApiDoc', {
        value: (path) => registry[String(path || '')] || null,
        configurable: false,
        enumerable: false,
        writable: false,
    });
}

/** Return the same function after attaching its documentation to this API. */
export function documentApiSymbol($, path, metadata) {
    const registry = $ && $.__r2dApiDocs;
    if (registry) {
        registry[path] = Object.assign({ path }, metadata || {});
    }
}

export function documentApiMethod($, path, fn, metadata) {
    documentApiSymbol($, path, metadata);
    return fn;
}
