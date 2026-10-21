#!/usr/bin/env node
// Generate the Editor's JavaScript built-in completion catalog from the
// official TypeScript ECMAScript declaration files. Browser/host libraries
// (DOM, WebWorker, ScriptHost) are intentionally excluded.
//
// Usage:
//   npm install --prefix /tmp/r2d-typescript typescript@5.9.3
//   node scripts/generate_js_builtin_catalog.cjs --typescript /tmp/r2d-typescript/node_modules/typescript

const fs = require('node:fs');
const path = require('node:path');

function argValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const tsPath = argValue('--typescript');
let ts;
try {
    ts = require(tsPath || 'typescript');
} catch (error) {
    console.error('TypeScript compiler API not found. Pass --typescript <package path>.');
    process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'editor/lib/js_builtin_catalog.js');
const libDir = path.dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ESNext }));
const rootFile = path.join(libDir, 'lib.esnext.d.ts');
if (!fs.existsSync(rootFile)) {
    console.error(`TypeScript ES2023 declarations not found: ${rootFile}`);
    process.exit(2);
}

const options = {
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
};
const program = ts.createProgram([rootFile], options);
const checker = program.getTypeChecker();
const source = program.getSourceFile(rootFile);
if (!source) throw new Error(`Could not load ${rootFile}`);

const excludedMembers = new Set(['__@iterator@', '__@asyncIterator@']);
const excludedGlobals = new Set(['arguments', 'Intl']);
const hostSourcePattern = /lib\.(?:dom|webworker|scripthost|decorators|esnext\.intl|es\d{4}\.intl)/i;

function sourceOf(symbol) {
    const declaration = symbol && symbol.valueDeclaration || symbol && symbol.declarations && symbol.declarations[0];
    return declaration && declaration.getSourceFile().fileName || '';
}

function isEcmaSymbol(symbol) {
    const file = sourceOf(symbol);
    return file.startsWith(libDir) && !hostSourcePattern.test(path.basename(file));
}

function docsOf(symbol) {
    return ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
}

function signatureText(signature) {
    return checker.signatureToString(signature, undefined,
        ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
}

function describeSymbol(symbol, owner) {
    const declaration = symbol.valueDeclaration || symbol.declarations && symbol.declarations[0];
    const location = declaration || source;
    let type;
    try { type = checker.getTypeOfSymbolAtLocation(symbol, location); }
    catch (_) { type = null; }
    const signatures = type ? type.getCallSignatures().map(signatureText) : [];
    const constructSignatures = type ? type.getConstructSignatures().map(signatureText) : [];
    const signature = signatures[0] || constructSignatures[0] || '';
    const kind = signatures.length || constructSignatures.length ? 'function' : 'property';
    const displayOwner = owner && owner.endsWith(' instance')
        ? `${owner.slice(0, -9)}.prototype` : owner;
    return {
        name: symbol.getName(),
        path: displayOwner ? `${displayOwner}.${symbol.getName()}` : symbol.getName(),
        kind,
        signature,
        overloads: [...new Set([...signatures, ...constructSignatures])].slice(0, 8),
        type: type ? checker.typeToString(type, location, ts.TypeFormatFlags.NoTruncation) : 'any',
        description: docsOf(symbol),
    };
}

function membersOf(type, owner) {
    if (!type) return [];
    const properties = checker.getPropertiesOfType(type);
    const entries = [];
    for (const property of properties) {
        const name = property.getName();
        if (!name || name.startsWith('__@') || excludedMembers.has(name) ||
            ['prototype', 'length', 'name', 'caller', 'arguments'].includes(name) ||
            !isEcmaSymbol(property)) continue;
        entries.push(describeSymbol(property, owner));
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
}

const globals = [];
const globalTypes = Object.create(null);
const globalValues = checker.getSymbolsInScope(source, ts.SymbolFlags.Value);
for (const symbol of globalValues) {
    const name = symbol.getName();
    if (excludedGlobals.has(name) || name.startsWith('__') || !isEcmaSymbol(symbol)) continue;
    const item = describeSymbol(symbol, null);
    // The JS language declarations include a few compiler-only helper values.
    if (item.type.includes('__type') || item.type.includes('Intrinsic')) continue;
    globals.push(item);
}
globals.sort((a, b) => a.name.localeCompare(b.name));

const constructorNames = new Set([
    'Array', 'ArrayBuffer', 'AsyncDisposableStack', 'BigInt', 'Boolean', 'DataView', 'Date', 'DisposableStack', 'Error',
    'EvalError', 'Float16Array', 'Float32Array', 'Float64Array', 'Function', 'Int8Array',
    'Int16Array', 'Int32Array', 'JSON', 'Map', 'Math', 'Number',
    'AsyncIteratorObject', 'Iterator', 'IteratorObject', 'Object', 'Promise', 'Proxy', 'RangeError', 'ReferenceError', 'RegExp',
    'Set', 'SharedArrayBuffer', 'String', 'Symbol', 'SyntaxError',
    'TypeError', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array',
    'URIError', 'WeakMap', 'WeakSet', 'Atomics', 'Reflect',
]);
for (const name of constructorNames) {
    const valueSymbol = checker.resolveName(name, source, ts.SymbolFlags.Value, false);
    const typeSymbol = checker.resolveName(name, source, ts.SymbolFlags.Type, false);
    if ((!valueSymbol || !isEcmaSymbol(valueSymbol)) && (!typeSymbol || !isEcmaSymbol(typeSymbol))) continue;
    const valueType = valueSymbol ? checker.getTypeOfSymbolAtLocation(valueSymbol, source) : null;
    const staticMembers = valueType ? membersOf(valueType, name) : [];
    let instanceMembers = [];
    if (typeSymbol) {
        try { instanceMembers = membersOf(checker.getDeclaredTypeOfSymbol(typeSymbol), `${name} instance`); }
        catch (_) { /* Some global namespace objects intentionally have no instance side. */ }
    }
    globalTypes[name] = { static: staticMembers, instance: instanceMembers };
}
const globalThisSymbol = checker.resolveName('globalThis', source, ts.SymbolFlags.Value, false);
if (globalThisSymbol && isEcmaSymbol(globalThisSymbol)) {
    globalTypes.globalThis = {
        static: membersOf(checker.getTypeOfSymbolAtLocation(globalThisSymbol, source), 'globalThis'),
        instance: [],
    };
}

const catalog = {
    source: 'TypeScript ECMAScript lib.esnext.d.ts; host libraries excluded',
    typescriptVersion: ts.version,
    globals,
    types: globalTypes,
};
const output = `// Generated from Microsoft's TypeScript ECMAScript standard-library declarations.\n` +
    `// Run scripts/generate_js_builtin_catalog.cjs with TypeScript ${ts.version} to update.\n` +
    `export const JS_BUILTIN_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`;
fs.writeFileSync(OUTPUT, output);
console.log(`wrote ${globals.length} globals and ${Object.keys(globalTypes).length} built-in types to ${path.relative(ROOT, OUTPUT)}`);
