// Generated from Microsoft's TypeScript ECMAScript standard-library declarations.
// Run scripts/generate_js_builtin_catalog.cjs with TypeScript 5.9.3 to update.
export const JS_BUILTIN_CATALOG = {
  "source": "TypeScript ECMAScript lib.esnext.d.ts; host libraries excluded",
  "typescriptVersion": "5.9.3",
  "globals": [
    {
      "name": "AggregateError",
      "path": "AggregateError",
      "kind": "function",
      "signature": "(errors: Iterable<any>, message?: string): AggregateError",
      "overloads": [
        "(errors: Iterable<any>, message?: string): AggregateError",
        "(errors: Iterable<any>, message?: string, options?: ErrorOptions): AggregateError"
      ],
      "type": "AggregateErrorConstructor",
      "description": ""
    },
    {
      "name": "Array",
      "path": "Array",
      "kind": "function",
      "signature": "(arrayLength?: number): any[]",
      "overloads": [
        "(arrayLength?: number): any[]",
        "<T>(arrayLength: number): T[]",
        "<T>(...items: T[]): T[]"
      ],
      "type": "ArrayConstructor",
      "description": ""
    },
    {
      "name": "ArrayBuffer",
      "path": "ArrayBuffer",
      "kind": "function",
      "signature": "(byteLength: number): ArrayBuffer",
      "overloads": [
        "(byteLength: number): ArrayBuffer",
        "(): ArrayBuffer",
        "(byteLength: number, options?: { maxByteLength?: number; }): ArrayBuffer"
      ],
      "type": "ArrayBufferConstructor",
      "description": "Represents a raw buffer of binary data, which is used to store data for the\ndifferent typed arrays. ArrayBuffers cannot be read from or written to directly,\nbut can be passed to a typed array or DataView Object to interpret the raw\nbuffer as needed."
    },
    {
      "name": "AsyncDisposableStack",
      "path": "AsyncDisposableStack",
      "kind": "function",
      "signature": "(): AsyncDisposableStack",
      "overloads": [
        "(): AsyncDisposableStack"
      ],
      "type": "AsyncDisposableStackConstructor",
      "description": ""
    },
    {
      "name": "Atomics",
      "path": "Atomics",
      "kind": "property",
      "signature": "",
      "overloads": [],
      "type": "Atomics",
      "description": ""
    },
    {
      "name": "BigInt",
      "path": "BigInt",
      "kind": "function",
      "signature": "(value: string | number | bigint | boolean): bigint",
      "overloads": [
        "(value: string | number | bigint | boolean): bigint"
      ],
      "type": "BigIntConstructor",
      "description": ""
    },
    {
      "name": "BigInt64Array",
      "path": "BigInt64Array",
      "kind": "function",
      "signature": "(length?: number): BigInt64Array<ArrayBuffer>",
      "overloads": [
        "(length?: number): BigInt64Array<ArrayBuffer>",
        "(array: ArrayLike<bigint> | Iterable<bigint>): BigInt64Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): BigInt64Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): BigInt64Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<bigint>): BigInt64Array<ArrayBuffer>"
      ],
      "type": "BigInt64ArrayConstructor",
      "description": "A typed array of 64-bit signed integer values. The contents are initialized to 0. If the\nrequested number of bytes could not be allocated, an exception is raised."
    },
    {
      "name": "BigUint64Array",
      "path": "BigUint64Array",
      "kind": "function",
      "signature": "(length?: number): BigUint64Array<ArrayBuffer>",
      "overloads": [
        "(length?: number): BigUint64Array<ArrayBuffer>",
        "(array: ArrayLike<bigint> | Iterable<bigint>): BigUint64Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): BigUint64Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): BigUint64Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<bigint>): BigUint64Array<ArrayBuffer>"
      ],
      "type": "BigUint64ArrayConstructor",
      "description": "A typed array of 64-bit unsigned integer values. The contents are initialized to 0. If the\nrequested number of bytes could not be allocated, an exception is raised."
    },
    {
      "name": "Boolean",
      "path": "Boolean",
      "kind": "function",
      "signature": "<T>(value?: T): boolean",
      "overloads": [
        "<T>(value?: T): boolean",
        "(value?: any): Boolean"
      ],
      "type": "BooleanConstructor",
      "description": ""
    },
    {
      "name": "DataView",
      "path": "DataView",
      "kind": "function",
      "signature": "<TArrayBuffer extends ArrayBufferLike & { BYTES_PER_ELEMENT?: never; }>(buffer: TArrayBuffer, byteOffset?: number, byteLength?: number): DataView<TArrayBuffer>",
      "overloads": [
        "<TArrayBuffer extends ArrayBufferLike & { BYTES_PER_ELEMENT?: never; }>(buffer: TArrayBuffer, byteOffset?: number, byteLength?: number): DataView<TArrayBuffer>"
      ],
      "type": "DataViewConstructor",
      "description": ""
    },
    {
      "name": "Date",
      "path": "Date",
      "kind": "function",
      "signature": "(): string",
      "overloads": [
        "(): string",
        "(): Date",
        "(value: string | number): Date",
        "(year: number, monthIndex: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): Date",
        "(value: string | number | Date): Date"
      ],
      "type": "DateConstructor",
      "description": "Enables basic storage and retrieval of dates and times."
    },
    {
      "name": "decodeURI",
      "path": "decodeURI",
      "kind": "function",
      "signature": "(encodedURI: string): string",
      "overloads": [
        "(encodedURI: string): string"
      ],
      "type": "(encodedURI: string) => string",
      "description": "Gets the unencoded version of an encoded Uniform Resource Identifier (URI)."
    },
    {
      "name": "decodeURIComponent",
      "path": "decodeURIComponent",
      "kind": "function",
      "signature": "(encodedURIComponent: string): string",
      "overloads": [
        "(encodedURIComponent: string): string"
      ],
      "type": "(encodedURIComponent: string) => string",
      "description": "Gets the unencoded version of an encoded component of a Uniform Resource Identifier (URI)."
    },
    {
      "name": "DisposableStack",
      "path": "DisposableStack",
      "kind": "function",
      "signature": "(): DisposableStack",
      "overloads": [
        "(): DisposableStack"
      ],
      "type": "DisposableStackConstructor",
      "description": ""
    },
    {
      "name": "encodeURI",
      "path": "encodeURI",
      "kind": "function",
      "signature": "(uri: string): string",
      "overloads": [
        "(uri: string): string"
      ],
      "type": "(uri: string) => string",
      "description": "Encodes a text string as a valid Uniform Resource Identifier (URI)"
    },
    {
      "name": "encodeURIComponent",
      "path": "encodeURIComponent",
      "kind": "function",
      "signature": "(uriComponent: string | number | boolean): string",
      "overloads": [
        "(uriComponent: string | number | boolean): string"
      ],
      "type": "(uriComponent: string | number | boolean) => string",
      "description": "Encodes a text string as a valid component of a Uniform Resource Identifier (URI)."
    },
    {
      "name": "Error",
      "path": "Error",
      "kind": "function",
      "signature": "(message?: string): Error",
      "overloads": [
        "(message?: string): Error",
        "(message?: string, options?: ErrorOptions): Error"
      ],
      "type": "ErrorConstructor",
      "description": ""
    },
    {
      "name": "escape",
      "path": "escape",
      "kind": "function",
      "signature": "(string: string): string",
      "overloads": [
        "(string: string): string"
      ],
      "type": "(string: string) => string",
      "description": "Computes a new string in which certain characters have been replaced by a hexadecimal escape sequence."
    },
    {
      "name": "eval",
      "path": "eval",
      "kind": "function",
      "signature": "(x: string): any",
      "overloads": [
        "(x: string): any"
      ],
      "type": "(x: string) => any",
      "description": "Evaluates JavaScript code and executes it."
    },
    {
      "name": "EvalError",
      "path": "EvalError",
      "kind": "function",
      "signature": "(message?: string): EvalError",
      "overloads": [
        "(message?: string): EvalError",
        "(message?: string, options?: ErrorOptions): EvalError",
        "(message?: string): Error",
        "(message?: string, options?: ErrorOptions): Error"
      ],
      "type": "EvalErrorConstructor",
      "description": ""
    },
    {
      "name": "FinalizationRegistry",
      "path": "FinalizationRegistry",
      "kind": "function",
      "signature": "<T>(cleanupCallback: (heldValue: T) => void): FinalizationRegistry<T>",
      "overloads": [
        "<T>(cleanupCallback: (heldValue: T) => void): FinalizationRegistry<T>"
      ],
      "type": "FinalizationRegistryConstructor",
      "description": ""
    },
    {
      "name": "Float16Array",
      "path": "Float16Array",
      "kind": "function",
      "signature": "(length?: number): Float16Array<ArrayBuffer>",
      "overloads": [
        "(length?: number): Float16Array<ArrayBuffer>",
        "(array: ArrayLike<number> | Iterable<number>): Float16Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): Float16Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): Float16Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<number>): Float16Array<ArrayBuffer>"
      ],
      "type": "Float16ArrayConstructor",
      "description": "A typed array of 16-bit float values. The contents are initialized to 0. If the requested number\nof bytes could not be allocated an exception is raised."
    },
    {
      "name": "Float32Array",
      "path": "Float32Array",
      "kind": "function",
      "signature": "(length: number): Float32Array<ArrayBuffer>",
      "overloads": [
        "(length: number): Float32Array<ArrayBuffer>",
        "(array: ArrayLike<number>): Float32Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): Float32Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): Float32Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<number>): Float32Array<ArrayBuffer>",
        "(elements: Iterable<number>): Float32Array<ArrayBuffer>",
        "(): Float32Array<ArrayBuffer>"
      ],
      "type": "Float32ArrayConstructor",
      "description": "A typed array of 32-bit float values. The contents are initialized to 0. If the requested number\nof bytes could not be allocated an exception is raised."
    },
    {
      "name": "Float64Array",
      "path": "Float64Array",
      "kind": "function",
      "signature": "(length: number): Float64Array<ArrayBuffer>",
      "overloads": [
        "(length: number): Float64Array<ArrayBuffer>",
        "(array: ArrayLike<number>): Float64Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): Float64Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): Float64Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<number>): Float64Array<ArrayBuffer>",
        "(elements: Iterable<number>): Float64Array<ArrayBuffer>",
        "(): Float64Array<ArrayBuffer>"
      ],
      "type": "Float64ArrayConstructor",
      "description": "A typed array of 64-bit float values. The contents are initialized to 0. If the requested\nnumber of bytes could not be allocated an exception is raised."
    },
    {
      "name": "Function",
      "path": "Function",
      "kind": "function",
      "signature": "(...args: string[]): Function",
      "overloads": [
        "(...args: string[]): Function"
      ],
      "type": "FunctionConstructor",
      "description": "Creates a new function."
    },
    {
      "name": "Infinity",
      "path": "Infinity",
      "kind": "property",
      "signature": "",
      "overloads": [],
      "type": "number",
      "description": ""
    },
    {
      "name": "Int16Array",
      "path": "Int16Array",
      "kind": "function",
      "signature": "(length: number): Int16Array<ArrayBuffer>",
      "overloads": [
        "(length: number): Int16Array<ArrayBuffer>",
        "(array: ArrayLike<number>): Int16Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): Int16Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): Int16Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<number>): Int16Array<ArrayBuffer>",
        "(elements: Iterable<number>): Int16Array<ArrayBuffer>",
        "(): Int16Array<ArrayBuffer>"
      ],
      "type": "Int16ArrayConstructor",
      "description": "A typed array of 16-bit signed integer values. The contents are initialized to 0. If the\nrequested number of bytes could not be allocated an exception is raised."
    },
    {
      "name": "Int32Array",
      "path": "Int32Array",
      "kind": "function",
      "signature": "(length: number): Int32Array<ArrayBuffer>",
      "overloads": [
        "(length: number): Int32Array<ArrayBuffer>",
        "(array: ArrayLike<number>): Int32Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): Int32Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): Int32Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<number>): Int32Array<ArrayBuffer>",
        "(elements: Iterable<number>): Int32Array<ArrayBuffer>",
        "(): Int32Array<ArrayBuffer>"
      ],
      "type": "Int32ArrayConstructor",
      "description": "A typed array of 32-bit signed integer values. The contents are initialized to 0. If the\nrequested number of bytes could not be allocated an exception is raised."
    },
    {
      "name": "Int8Array",
      "path": "Int8Array",
      "kind": "function",
      "signature": "(length: number): Int8Array<ArrayBuffer>",
      "overloads": [
        "(length: number): Int8Array<ArrayBuffer>",
        "(array: ArrayLike<number>): Int8Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): Int8Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): Int8Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<number>): Int8Array<ArrayBuffer>",
        "(elements: Iterable<number>): Int8Array<ArrayBuffer>",
        "(): Int8Array<ArrayBuffer>"
      ],
      "type": "Int8ArrayConstructor",
      "description": "A typed array of 8-bit integer values. The contents are initialized to 0. If the requested\nnumber of bytes could not be allocated an exception is raised."
    },
    {
      "name": "isFinite",
      "path": "isFinite",
      "kind": "function",
      "signature": "(number: number): boolean",
      "overloads": [
        "(number: number): boolean"
      ],
      "type": "(number: number) => boolean",
      "description": "Determines whether a supplied number is finite."
    },
    {
      "name": "isNaN",
      "path": "isNaN",
      "kind": "function",
      "signature": "(number: number): boolean",
      "overloads": [
        "(number: number): boolean"
      ],
      "type": "(number: number) => boolean",
      "description": "Returns a Boolean value that indicates whether a value is the reserved value NaN (not a number)."
    },
    {
      "name": "Iterator",
      "path": "Iterator",
      "kind": "function",
      "signature": "<T, TResult = undefined, TNext = unknown>(): Iterator<T, TResult, TNext>",
      "overloads": [
        "<T, TResult = undefined, TNext = unknown>(): Iterator<T, TResult, TNext>"
      ],
      "type": "IteratorConstructor",
      "description": ""
    },
    {
      "name": "JSON",
      "path": "JSON",
      "kind": "property",
      "signature": "",
      "overloads": [],
      "type": "JSON",
      "description": "An intrinsic object that provides functions to convert JavaScript values to and from the JavaScript Object Notation (JSON) format."
    },
    {
      "name": "Map",
      "path": "Map",
      "kind": "function",
      "signature": "(): Map<any, any>",
      "overloads": [
        "(): Map<any, any>",
        "<K, V>(entries?: readonly (readonly [K, V])[]): Map<K, V>",
        "<K, V>(iterable?: Iterable<readonly [K, V]>): Map<K, V>"
      ],
      "type": "MapConstructor",
      "description": ""
    },
    {
      "name": "Math",
      "path": "Math",
      "kind": "property",
      "signature": "",
      "overloads": [],
      "type": "Math",
      "description": "An intrinsic object that provides basic mathematics functionality and constants."
    },
    {
      "name": "NaN",
      "path": "NaN",
      "kind": "property",
      "signature": "",
      "overloads": [],
      "type": "number",
      "description": ""
    },
    {
      "name": "Number",
      "path": "Number",
      "kind": "function",
      "signature": "(value?: any): number",
      "overloads": [
        "(value?: any): number",
        "(value?: any): Number"
      ],
      "type": "NumberConstructor",
      "description": "An object that represents a number of any kind. All JavaScript numbers are 64-bit floating-point numbers."
    },
    {
      "name": "Object",
      "path": "Object",
      "kind": "function",
      "signature": "(): any",
      "overloads": [
        "(): any",
        "(value: any): any",
        "(value?: any): Object"
      ],
      "type": "ObjectConstructor",
      "description": "Provides functionality common to all JavaScript objects."
    },
    {
      "name": "parseFloat",
      "path": "parseFloat",
      "kind": "function",
      "signature": "(string: string): number",
      "overloads": [
        "(string: string): number"
      ],
      "type": "(string: string) => number",
      "description": "Converts a string to a floating-point number."
    },
    {
      "name": "parseInt",
      "path": "parseInt",
      "kind": "function",
      "signature": "(string: string, radix?: number): number",
      "overloads": [
        "(string: string, radix?: number): number"
      ],
      "type": "(string: string, radix?: number) => number",
      "description": "Converts a string to an integer."
    },
    {
      "name": "Promise",
      "path": "Promise",
      "kind": "function",
      "signature": "<T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>",
      "overloads": [
        "<T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>"
      ],
      "type": "PromiseConstructor",
      "description": "Represents the completion of an asynchronous operation"
    },
    {
      "name": "Proxy",
      "path": "Proxy",
      "kind": "function",
      "signature": "<T extends object>(target: T, handler: ProxyHandler<T>): T",
      "overloads": [
        "<T extends object>(target: T, handler: ProxyHandler<T>): T"
      ],
      "type": "ProxyConstructor",
      "description": ""
    },
    {
      "name": "RangeError",
      "path": "RangeError",
      "kind": "function",
      "signature": "(message?: string): RangeError",
      "overloads": [
        "(message?: string): RangeError",
        "(message?: string, options?: ErrorOptions): RangeError",
        "(message?: string): Error",
        "(message?: string, options?: ErrorOptions): Error"
      ],
      "type": "RangeErrorConstructor",
      "description": ""
    },
    {
      "name": "ReferenceError",
      "path": "ReferenceError",
      "kind": "function",
      "signature": "(message?: string): ReferenceError",
      "overloads": [
        "(message?: string): ReferenceError",
        "(message?: string, options?: ErrorOptions): ReferenceError",
        "(message?: string): Error",
        "(message?: string, options?: ErrorOptions): Error"
      ],
      "type": "ReferenceErrorConstructor",
      "description": ""
    },
    {
      "name": "Reflect",
      "path": "Reflect",
      "kind": "property",
      "signature": "",
      "overloads": [],
      "type": "typeof Reflect",
      "description": ""
    },
    {
      "name": "RegExp",
      "path": "RegExp",
      "kind": "function",
      "signature": "(pattern: string | RegExp): RegExp",
      "overloads": [
        "(pattern: string | RegExp): RegExp",
        "(pattern: string, flags?: string): RegExp",
        "(pattern: string | RegExp, flags?: string): RegExp"
      ],
      "type": "RegExpConstructor",
      "description": ""
    },
    {
      "name": "Set",
      "path": "Set",
      "kind": "function",
      "signature": "<T = any>(values?: readonly T[]): Set<T>",
      "overloads": [
        "<T = any>(values?: readonly T[]): Set<T>",
        "<T>(iterable?: Iterable<T>): Set<T>"
      ],
      "type": "SetConstructor",
      "description": ""
    },
    {
      "name": "SharedArrayBuffer",
      "path": "SharedArrayBuffer",
      "kind": "function",
      "signature": "(byteLength?: number): SharedArrayBuffer",
      "overloads": [
        "(byteLength?: number): SharedArrayBuffer",
        "(byteLength: number, options?: { maxByteLength?: number; }): SharedArrayBuffer"
      ],
      "type": "SharedArrayBufferConstructor",
      "description": ""
    },
    {
      "name": "String",
      "path": "String",
      "kind": "function",
      "signature": "(value?: any): string",
      "overloads": [
        "(value?: any): string",
        "(value?: any): String"
      ],
      "type": "StringConstructor",
      "description": "Allows manipulation and formatting of text strings and determination and location of substrings within strings."
    },
    {
      "name": "SuppressedError",
      "path": "SuppressedError",
      "kind": "function",
      "signature": "(error: any, suppressed: any, message?: string): SuppressedError",
      "overloads": [
        "(error: any, suppressed: any, message?: string): SuppressedError"
      ],
      "type": "SuppressedErrorConstructor",
      "description": ""
    },
    {
      "name": "Symbol",
      "path": "Symbol",
      "kind": "function",
      "signature": "(description?: string | number): symbol",
      "overloads": [
        "(description?: string | number): symbol"
      ],
      "type": "SymbolConstructor",
      "description": ""
    },
    {
      "name": "SyntaxError",
      "path": "SyntaxError",
      "kind": "function",
      "signature": "(message?: string): SyntaxError",
      "overloads": [
        "(message?: string): SyntaxError",
        "(message?: string, options?: ErrorOptions): SyntaxError",
        "(message?: string): Error",
        "(message?: string, options?: ErrorOptions): Error"
      ],
      "type": "SyntaxErrorConstructor",
      "description": ""
    },
    {
      "name": "TypeError",
      "path": "TypeError",
      "kind": "function",
      "signature": "(message?: string): TypeError",
      "overloads": [
        "(message?: string): TypeError",
        "(message?: string, options?: ErrorOptions): TypeError",
        "(message?: string): Error",
        "(message?: string, options?: ErrorOptions): Error"
      ],
      "type": "TypeErrorConstructor",
      "description": ""
    },
    {
      "name": "Uint16Array",
      "path": "Uint16Array",
      "kind": "function",
      "signature": "(length: number): Uint16Array<ArrayBuffer>",
      "overloads": [
        "(length: number): Uint16Array<ArrayBuffer>",
        "(array: ArrayLike<number>): Uint16Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): Uint16Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): Uint16Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<number>): Uint16Array<ArrayBuffer>",
        "(elements: Iterable<number>): Uint16Array<ArrayBuffer>",
        "(): Uint16Array<ArrayBuffer>"
      ],
      "type": "Uint16ArrayConstructor",
      "description": "A typed array of 16-bit unsigned integer values. The contents are initialized to 0. If the\nrequested number of bytes could not be allocated an exception is raised."
    },
    {
      "name": "Uint32Array",
      "path": "Uint32Array",
      "kind": "function",
      "signature": "(length: number): Uint32Array<ArrayBuffer>",
      "overloads": [
        "(length: number): Uint32Array<ArrayBuffer>",
        "(array: ArrayLike<number>): Uint32Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): Uint32Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): Uint32Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<number>): Uint32Array<ArrayBuffer>",
        "(elements: Iterable<number>): Uint32Array<ArrayBuffer>",
        "(): Uint32Array<ArrayBuffer>"
      ],
      "type": "Uint32ArrayConstructor",
      "description": "A typed array of 32-bit unsigned integer values. The contents are initialized to 0. If the\nrequested number of bytes could not be allocated an exception is raised."
    },
    {
      "name": "Uint8Array",
      "path": "Uint8Array",
      "kind": "function",
      "signature": "(length: number): Uint8Array<ArrayBuffer>",
      "overloads": [
        "(length: number): Uint8Array<ArrayBuffer>",
        "(array: ArrayLike<number>): Uint8Array<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): Uint8Array<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): Uint8Array<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<number>): Uint8Array<ArrayBuffer>",
        "(elements: Iterable<number>): Uint8Array<ArrayBuffer>",
        "(): Uint8Array<ArrayBuffer>"
      ],
      "type": "Uint8ArrayConstructor",
      "description": "A typed array of 8-bit unsigned integer values. The contents are initialized to 0. If the\nrequested number of bytes could not be allocated an exception is raised."
    },
    {
      "name": "Uint8ClampedArray",
      "path": "Uint8ClampedArray",
      "kind": "function",
      "signature": "(length: number): Uint8ClampedArray<ArrayBuffer>",
      "overloads": [
        "(length: number): Uint8ClampedArray<ArrayBuffer>",
        "(array: ArrayLike<number>): Uint8ClampedArray<ArrayBuffer>",
        "<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): Uint8ClampedArray<TArrayBuffer>",
        "(buffer: ArrayBuffer, byteOffset?: number, length?: number): Uint8ClampedArray<ArrayBuffer>",
        "(array: ArrayBuffer | ArrayLike<number>): Uint8ClampedArray<ArrayBuffer>",
        "(elements: Iterable<number>): Uint8ClampedArray<ArrayBuffer>",
        "(): Uint8ClampedArray<ArrayBuffer>"
      ],
      "type": "Uint8ClampedArrayConstructor",
      "description": "A typed array of 8-bit unsigned integer (clamped) values. The contents are initialized to 0.\nIf the requested number of bytes could not be allocated an exception is raised."
    },
    {
      "name": "unescape",
      "path": "unescape",
      "kind": "function",
      "signature": "(string: string): string",
      "overloads": [
        "(string: string): string"
      ],
      "type": "(string: string) => string",
      "description": "Computes a new string in which hexadecimal escape sequences are replaced with the character that it represents."
    },
    {
      "name": "URIError",
      "path": "URIError",
      "kind": "function",
      "signature": "(message?: string): URIError",
      "overloads": [
        "(message?: string): URIError",
        "(message?: string, options?: ErrorOptions): URIError",
        "(message?: string): Error",
        "(message?: string, options?: ErrorOptions): Error"
      ],
      "type": "URIErrorConstructor",
      "description": ""
    },
    {
      "name": "WeakMap",
      "path": "WeakMap",
      "kind": "function",
      "signature": "<K extends WeakKey = WeakKey, V = any>(entries?: readonly (readonly [K, V])[]): WeakMap<K, V>",
      "overloads": [
        "<K extends WeakKey = WeakKey, V = any>(entries?: readonly (readonly [K, V])[]): WeakMap<K, V>",
        "<K extends WeakKey, V>(iterable: Iterable<readonly [K, V]>): WeakMap<K, V>"
      ],
      "type": "WeakMapConstructor",
      "description": ""
    },
    {
      "name": "WeakRef",
      "path": "WeakRef",
      "kind": "function",
      "signature": "<T extends WeakKey>(target: T): WeakRef<T>",
      "overloads": [
        "<T extends WeakKey>(target: T): WeakRef<T>"
      ],
      "type": "WeakRefConstructor",
      "description": ""
    },
    {
      "name": "WeakSet",
      "path": "WeakSet",
      "kind": "function",
      "signature": "<T extends WeakKey = WeakKey>(values?: readonly T[]): WeakSet<T>",
      "overloads": [
        "<T extends WeakKey = WeakKey>(values?: readonly T[]): WeakSet<T>",
        "<T extends WeakKey = WeakKey>(iterable: Iterable<T>): WeakSet<T>"
      ],
      "type": "WeakSetConstructor",
      "description": ""
    }
  ],
  "types": {
    "Array": {
      "static": [
        {
          "name": "from",
          "path": "Array.from",
          "kind": "function",
          "signature": "<T>(arrayLike: ArrayLike<T>): T[]",
          "overloads": [
            "<T>(arrayLike: ArrayLike<T>): T[]",
            "<T, U>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => U, thisArg?: any): U[]",
            "<T>(iterable: Iterable<T> | ArrayLike<T>): T[]",
            "<T, U>(iterable: Iterable<T> | ArrayLike<T>, mapfn: (v: T, k: number) => U, thisArg?: any): U[]"
          ],
          "type": "{ <T>(arrayLike: ArrayLike<T>): T[]; <T, U>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => U, thisArg?: any): U[]; <T>(iterable: Iterable<T> | ArrayLike<T>): T[]; <T, U>(iterable: Iterable<T> | ArrayLike<T>, mapfn: (v: T, k: number) => U, thisArg?: any): U[]; }",
          "description": "Creates an array from an array-like object.\nCreates an array from an iterable object."
        },
        {
          "name": "fromAsync",
          "path": "Array.fromAsync",
          "kind": "function",
          "signature": "<T>(iterableOrArrayLike: AsyncIterable<T> | Iterable<T | PromiseLike<T>> | ArrayLike<T | PromiseLike<T>>): Promise<T[]>",
          "overloads": [
            "<T>(iterableOrArrayLike: AsyncIterable<T> | Iterable<T | PromiseLike<T>> | ArrayLike<T | PromiseLike<T>>): Promise<T[]>",
            "<T, U>(iterableOrArrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>, mapFn: (value: Awaited<T>, index: number) => U, thisArg?: any): Promise<Awaited<U>[]>"
          ],
          "type": "{ <T>(iterableOrArrayLike: AsyncIterable<T> | Iterable<T | PromiseLike<T>> | ArrayLike<T | PromiseLike<T>>): Promise<T[]>; <T, U>(iterableOrArrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>, mapFn: (value: Awaited<T>, index: number) => U, thisArg?: any): Promise<Awaited<U>[]>; }",
          "description": "Creates an array from an async iterator or iterable object."
        },
        {
          "name": "isArray",
          "path": "Array.isArray",
          "kind": "function",
          "signature": "(arg: any): arg is any[]",
          "overloads": [
            "(arg: any): arg is any[]"
          ],
          "type": "(arg: any) => arg is any[]",
          "description": ""
        },
        {
          "name": "of",
          "path": "Array.of",
          "kind": "function",
          "signature": "<T>(...items: T[]): T[]",
          "overloads": [
            "<T>(...items: T[]): T[]"
          ],
          "type": "<T>(...items: T[]) => T[]",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Array.prototype.at",
          "kind": "function",
          "signature": "(index: number): T",
          "overloads": [
            "(index: number): T"
          ],
          "type": "(index: number) => T | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "concat",
          "path": "Array.prototype.concat",
          "kind": "function",
          "signature": "(...items: ConcatArray<T>[]): T[]",
          "overloads": [
            "(...items: ConcatArray<T>[]): T[]",
            "(...items: (T | ConcatArray<T>)[]): T[]"
          ],
          "type": "{ (...items: ConcatArray<T>[]): T[]; (...items: (T | ConcatArray<T>)[]): T[]; }",
          "description": "Combines two or more arrays.\nThis method returns a new array without modifying any existing arrays."
        },
        {
          "name": "copyWithin",
          "path": "Array.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): T[]",
          "overloads": [
            "(target: number, start: number, end?: number): T[]"
          ],
          "type": "(target: number, start: number, end?: number) => T[]",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Array.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, T]>",
          "overloads": [
            "(): ArrayIterator<[number, T]>"
          ],
          "type": "() => ArrayIterator<[number, T]>",
          "description": "Returns an iterable of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Array.prototype.every",
          "kind": "function",
          "signature": "<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): this is S[]",
          "overloads": [
            "<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): this is S[]",
            "(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean"
          ],
          "type": "{ <S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): this is S[]; (predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean; }",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Array.prototype.fill",
          "kind": "function",
          "signature": "(value: T, start?: number, end?: number): T[]",
          "overloads": [
            "(value: T, start?: number, end?: number): T[]"
          ],
          "type": "(value: T, start?: number, end?: number) => T[]",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Array.prototype.filter",
          "kind": "function",
          "signature": "<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[]",
          "overloads": [
            "<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[]",
            "(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T[]"
          ],
          "type": "{ <S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[]; (predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T[]; }",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Array.prototype.find",
          "kind": "function",
          "signature": "<S extends T>(predicate: (value: T, index: number, obj: T[]) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends T>(predicate: (value: T, index: number, obj: T[]) => value is S, thisArg?: any): S",
            "(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): T"
          ],
          "type": "{ <S extends T>(predicate: (value: T, index: number, obj: T[]) => value is S, thisArg?: any): S; (predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): T | undefined; }",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Array.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Array.prototype.findLast",
          "kind": "function",
          "signature": "<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S",
            "(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T"
          ],
          "type": "{ <S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S; (predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Array.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "flat",
          "path": "Array.prototype.flat",
          "kind": "function",
          "signature": "<A, D extends number = 1>(this: A, depth?: D): FlatArray<A, D>[]",
          "overloads": [
            "<A, D extends number = 1>(this: A, depth?: D): FlatArray<A, D>[]"
          ],
          "type": "<A, D extends number = 1>(this: A, depth?: D) => FlatArray<A, D>[]",
          "description": "Returns a new array with all sub-array elements concatenated into it recursively up to the\nspecified depth."
        },
        {
          "name": "flatMap",
          "path": "Array.prototype.flatMap",
          "kind": "function",
          "signature": "<U, This = undefined>(callback: (this: This, value: T, index: number, array: T[]) => U | readonly U[], thisArg?: This): U[]",
          "overloads": [
            "<U, This = undefined>(callback: (this: This, value: T, index: number, array: T[]) => U | readonly U[], thisArg?: This): U[]"
          ],
          "type": "<U, This = undefined>(callback: (this: This, value: T, index: number, array: T[]) => U | readonly U[], thisArg?: This) => U[]",
          "description": "Calls a defined callback function on each element of an array. Then, flattens the result into\na new array.\nThis is identical to a map followed by flat with depth 1."
        },
        {
          "name": "forEach",
          "path": "Array.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Array.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: T, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: T, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: T, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Array.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: T, fromIndex?: number): number",
          "overloads": [
            "(searchElement: T, fromIndex?: number): number"
          ],
          "type": "(searchElement: T, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array, or -1 if it is not present."
        },
        {
          "name": "join",
          "path": "Array.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array into a string, separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Array.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an iterable of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Array.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: T, fromIndex?: number): number",
          "overloads": [
            "(searchElement: T, fromIndex?: number): number"
          ],
          "type": "(searchElement: T, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a specified value in an array, or -1 if it is not present."
        },
        {
          "name": "map",
          "path": "Array.prototype.map",
          "kind": "function",
          "signature": "<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[]",
          "overloads": [
            "<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[]"
          ],
          "type": "<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any) => U[]",
          "description": "Calls a defined callback function on each element of an array, and returns an array that contains the results."
        },
        {
          "name": "pop",
          "path": "Array.prototype.pop",
          "kind": "function",
          "signature": "(): T",
          "overloads": [
            "(): T"
          ],
          "type": "() => T | undefined",
          "description": "Removes the last element from an array and returns it.\nIf the array is empty, undefined is returned and the array is not modified."
        },
        {
          "name": "push",
          "path": "Array.prototype.push",
          "kind": "function",
          "signature": "(...items: T[]): number",
          "overloads": [
            "(...items: T[]): number"
          ],
          "type": "(...items: T[]) => number",
          "description": "Appends new elements to the end of an array, and returns the new length of the array."
        },
        {
          "name": "reduce",
          "path": "Array.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T",
          "overloads": [
            "(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T",
            "(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T",
            "<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T; (callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T; <U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Array.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T",
          "overloads": [
            "(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T",
            "(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T",
            "<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T; (callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T; <U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Array.prototype.reverse",
          "kind": "function",
          "signature": "(): T[]",
          "overloads": [
            "(): T[]"
          ],
          "type": "() => T[]",
          "description": "Reverses the elements in an array in place.\nThis method mutates the array and returns a reference to the same array."
        },
        {
          "name": "shift",
          "path": "Array.prototype.shift",
          "kind": "function",
          "signature": "(): T",
          "overloads": [
            "(): T"
          ],
          "type": "() => T | undefined",
          "description": "Removes the first element from an array and returns it.\nIf the array is empty, undefined is returned and the array is not modified."
        },
        {
          "name": "slice",
          "path": "Array.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): T[]",
          "overloads": [
            "(start?: number, end?: number): T[]"
          ],
          "type": "(start?: number, end?: number) => T[]",
          "description": "Returns a copy of a section of an array.\nFor both start and end, a negative index can be used to indicate an offset from the end of the array.\nFor example, -2 refers to the second to last element of the array."
        },
        {
          "name": "some",
          "path": "Array.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Array.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: T, b: T) => number): T[]",
          "overloads": [
            "(compareFn?: (a: T, b: T) => number): T[]"
          ],
          "type": "(compareFn?: (a: T, b: T) => number) => T[]",
          "description": "Sorts an array in place.\nThis method mutates the array and returns a reference to the same array."
        },
        {
          "name": "splice",
          "path": "Array.prototype.splice",
          "kind": "function",
          "signature": "(start: number, deleteCount?: number): T[]",
          "overloads": [
            "(start: number, deleteCount?: number): T[]",
            "(start: number, deleteCount: number, ...items: T[]): T[]"
          ],
          "type": "{ (start: number, deleteCount?: number): T[]; (start: number, deleteCount: number, ...items: T[]): T[]; }",
          "description": "Removes elements from an array and, if necessary, inserts new elements in their place, returning the deleted elements."
        },
        {
          "name": "toLocaleString",
          "path": "Array.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales: string | string[], options?: NumberFormatOptions & DateTimeFormatOptions): string"
          ],
          "type": "{ (): string; (locales: string | string[], options?: Intl.NumberFormatOptions & Intl.DateTimeFormatOptions): string; }",
          "description": "Returns a string representation of an array. The elements are converted to string using their toLocaleString methods."
        },
        {
          "name": "toReversed",
          "path": "Array.prototype.toReversed",
          "kind": "function",
          "signature": "(): T[]",
          "overloads": [
            "(): T[]"
          ],
          "type": "() => T[]",
          "description": "Returns a copy of an array with its elements reversed."
        },
        {
          "name": "toSorted",
          "path": "Array.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: T, b: T) => number): T[]",
          "overloads": [
            "(compareFn?: (a: T, b: T) => number): T[]"
          ],
          "type": "(compareFn?: (a: T, b: T) => number) => T[]",
          "description": "Returns a copy of an array with its elements sorted."
        },
        {
          "name": "toSpliced",
          "path": "Array.prototype.toSpliced",
          "kind": "function",
          "signature": "(start: number, deleteCount: number, ...items: T[]): T[]",
          "overloads": [
            "(start: number, deleteCount: number, ...items: T[]): T[]",
            "(start: number, deleteCount?: number): T[]"
          ],
          "type": "{ (start: number, deleteCount: number, ...items: T[]): T[]; (start: number, deleteCount?: number): T[]; }",
          "description": "Copies an array and removes elements and, if necessary, inserts new elements in their place. Returns the copied array.\nCopies an array and removes elements while returning the remaining elements."
        },
        {
          "name": "toString",
          "path": "Array.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "unshift",
          "path": "Array.prototype.unshift",
          "kind": "function",
          "signature": "(...items: T[]): number",
          "overloads": [
            "(...items: T[]): number"
          ],
          "type": "(...items: T[]) => number",
          "description": "Inserts new elements at the start of an array, and returns the new length of the array."
        },
        {
          "name": "values",
          "path": "Array.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<T>",
          "overloads": [
            "(): ArrayIterator<T>"
          ],
          "type": "() => ArrayIterator<T>",
          "description": "Returns an iterable of values in the array"
        },
        {
          "name": "with",
          "path": "Array.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: T): T[]",
          "overloads": [
            "(index: number, value: T): T[]"
          ],
          "type": "(index: number, value: T) => T[]",
          "description": "Copies an array, then overwrites the value at the provided index with the\ngiven value. If the index is negative, then it replaces from the end\nof the array."
        }
      ]
    },
    "ArrayBuffer": {
      "static": [
        {
          "name": "isView",
          "path": "ArrayBuffer.isView",
          "kind": "function",
          "signature": "(arg: any): arg is ArrayBufferView<ArrayBufferLike>",
          "overloads": [
            "(arg: any): arg is ArrayBufferView<ArrayBufferLike>"
          ],
          "type": "(arg: any) => arg is ArrayBufferView",
          "description": ""
        }
      ],
      "instance": [
        {
          "name": "byteLength",
          "path": "ArrayBuffer.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "Read-only. The length of the ArrayBuffer (in bytes)."
        },
        {
          "name": "detached",
          "path": "ArrayBuffer.prototype.detached",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a boolean indicating whether or not this buffer has been detached (transferred).\n\n[MDN](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/detached)"
        },
        {
          "name": "maxByteLength",
          "path": "ArrayBuffer.prototype.maxByteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "If this ArrayBuffer is resizable, returns the maximum byte length given during construction; returns the byte length if not.\n\n[MDN](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/maxByteLength)"
        },
        {
          "name": "resizable",
          "path": "ArrayBuffer.prototype.resizable",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns true if this ArrayBuffer can be resized.\n\n[MDN](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/resizable)"
        },
        {
          "name": "resize",
          "path": "ArrayBuffer.prototype.resize",
          "kind": "function",
          "signature": "(newByteLength?: number): void",
          "overloads": [
            "(newByteLength?: number): void"
          ],
          "type": "(newByteLength?: number) => void",
          "description": "Resizes the ArrayBuffer to the specified size (in bytes).\n\n[MDN](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/resize)"
        },
        {
          "name": "slice",
          "path": "ArrayBuffer.prototype.slice",
          "kind": "function",
          "signature": "(begin?: number, end?: number): ArrayBuffer",
          "overloads": [
            "(begin?: number, end?: number): ArrayBuffer"
          ],
          "type": "(begin?: number, end?: number) => ArrayBuffer",
          "description": "Returns a section of an ArrayBuffer."
        },
        {
          "name": "transfer",
          "path": "ArrayBuffer.prototype.transfer",
          "kind": "function",
          "signature": "(newByteLength?: number): ArrayBuffer",
          "overloads": [
            "(newByteLength?: number): ArrayBuffer"
          ],
          "type": "(newByteLength?: number) => ArrayBuffer",
          "description": "Creates a new ArrayBuffer with the same byte content as this buffer, then detaches this buffer.\n\n[MDN](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transfer)"
        },
        {
          "name": "transferToFixedLength",
          "path": "ArrayBuffer.prototype.transferToFixedLength",
          "kind": "function",
          "signature": "(newByteLength?: number): ArrayBuffer",
          "overloads": [
            "(newByteLength?: number): ArrayBuffer"
          ],
          "type": "(newByteLength?: number) => ArrayBuffer",
          "description": "Creates a new non-resizable ArrayBuffer with the same byte content as this buffer, then detaches this buffer.\n\n[MDN](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transferToFixedLength)"
        }
      ]
    },
    "AsyncDisposableStack": {
      "static": [],
      "instance": [
        {
          "name": "adopt",
          "path": "AsyncDisposableStack.prototype.adopt",
          "kind": "function",
          "signature": "<T>(value: T, onDisposeAsync: (value: T) => void | PromiseLike<void>): T",
          "overloads": [
            "<T>(value: T, onDisposeAsync: (value: T) => void | PromiseLike<void>): T"
          ],
          "type": "<T>(value: T, onDisposeAsync: (value: T) => PromiseLike<void> | void) => T",
          "description": "Adds a value and associated disposal callback as a resource to the stack."
        },
        {
          "name": "defer",
          "path": "AsyncDisposableStack.prototype.defer",
          "kind": "function",
          "signature": "(onDisposeAsync: () => void | PromiseLike<void>): void",
          "overloads": [
            "(onDisposeAsync: () => void | PromiseLike<void>): void"
          ],
          "type": "(onDisposeAsync: () => PromiseLike<void> | void) => void",
          "description": "Adds a callback to be invoked when the stack is disposed."
        },
        {
          "name": "disposeAsync",
          "path": "AsyncDisposableStack.prototype.disposeAsync",
          "kind": "function",
          "signature": "(): Promise<void>",
          "overloads": [
            "(): Promise<void>"
          ],
          "type": "() => Promise<void>",
          "description": "Disposes each resource in the stack in the reverse order that they were added."
        },
        {
          "name": "disposed",
          "path": "AsyncDisposableStack.prototype.disposed",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a value indicating whether this stack has been disposed."
        },
        {
          "name": "move",
          "path": "AsyncDisposableStack.prototype.move",
          "kind": "function",
          "signature": "(): AsyncDisposableStack",
          "overloads": [
            "(): AsyncDisposableStack"
          ],
          "type": "() => AsyncDisposableStack",
          "description": "Move all resources out of this stack and into a new `DisposableStack`, and marks this stack as disposed."
        },
        {
          "name": "use",
          "path": "AsyncDisposableStack.prototype.use",
          "kind": "function",
          "signature": "<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T",
          "overloads": [
            "<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T"
          ],
          "type": "<T extends AsyncDisposable | Disposable | null | undefined>(value: T) => T",
          "description": "Adds a disposable resource to the stack, returning the resource."
        }
      ]
    },
    "BigInt": {
      "static": [
        {
          "name": "asIntN",
          "path": "BigInt.asIntN",
          "kind": "function",
          "signature": "(bits: number, int: bigint): bigint",
          "overloads": [
            "(bits: number, int: bigint): bigint"
          ],
          "type": "(bits: number, int: bigint) => bigint",
          "description": "Interprets the low bits of a BigInt as a 2's-complement signed integer.\nAll higher bits are discarded."
        },
        {
          "name": "asUintN",
          "path": "BigInt.asUintN",
          "kind": "function",
          "signature": "(bits: number, int: bigint): bigint",
          "overloads": [
            "(bits: number, int: bigint): bigint"
          ],
          "type": "(bits: number, int: bigint) => bigint",
          "description": "Interprets the low bits of a BigInt as an unsigned integer.\nAll higher bits are discarded."
        }
      ],
      "instance": [
        {
          "name": "toLocaleString",
          "path": "BigInt.prototype.toLocaleString",
          "kind": "function",
          "signature": "(locales?: LocalesArgument, options?: BigIntToLocaleStringOptions): string",
          "overloads": [
            "(locales?: LocalesArgument, options?: BigIntToLocaleStringOptions): string"
          ],
          "type": "(locales?: Intl.LocalesArgument, options?: BigIntToLocaleStringOptions) => string",
          "description": "Returns a string representation appropriate to the host environment's current locale."
        },
        {
          "name": "toString",
          "path": "BigInt.prototype.toString",
          "kind": "function",
          "signature": "(radix?: number): string",
          "overloads": [
            "(radix?: number): string"
          ],
          "type": "(radix?: number) => string",
          "description": "Returns a string representation of an object."
        },
        {
          "name": "valueOf",
          "path": "BigInt.prototype.valueOf",
          "kind": "function",
          "signature": "(): bigint",
          "overloads": [
            "(): bigint"
          ],
          "type": "() => bigint",
          "description": "Returns the primitive value of the specified object."
        }
      ]
    },
    "Boolean": {
      "static": [],
      "instance": [
        {
          "name": "valueOf",
          "path": "Boolean.prototype.valueOf",
          "kind": "function",
          "signature": "(): boolean",
          "overloads": [
            "(): boolean"
          ],
          "type": "() => boolean",
          "description": "Returns the primitive value of the specified object."
        }
      ]
    },
    "DataView": {
      "static": [],
      "instance": [
        {
          "name": "buffer",
          "path": "DataView.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": ""
        },
        {
          "name": "byteLength",
          "path": "DataView.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": ""
        },
        {
          "name": "byteOffset",
          "path": "DataView.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": ""
        },
        {
          "name": "getBigInt64",
          "path": "DataView.prototype.getBigInt64",
          "kind": "function",
          "signature": "(byteOffset: number, littleEndian?: boolean): bigint",
          "overloads": [
            "(byteOffset: number, littleEndian?: boolean): bigint"
          ],
          "type": "(byteOffset: number, littleEndian?: boolean) => bigint",
          "description": "Gets the BigInt64 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "getBigUint64",
          "path": "DataView.prototype.getBigUint64",
          "kind": "function",
          "signature": "(byteOffset: number, littleEndian?: boolean): bigint",
          "overloads": [
            "(byteOffset: number, littleEndian?: boolean): bigint"
          ],
          "type": "(byteOffset: number, littleEndian?: boolean) => bigint",
          "description": "Gets the BigUint64 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "getFloat16",
          "path": "DataView.prototype.getFloat16",
          "kind": "function",
          "signature": "(byteOffset: number, littleEndian?: boolean): number",
          "overloads": [
            "(byteOffset: number, littleEndian?: boolean): number"
          ],
          "type": "(byteOffset: number, littleEndian?: boolean) => number",
          "description": "Gets the Float16 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "getFloat32",
          "path": "DataView.prototype.getFloat32",
          "kind": "function",
          "signature": "(byteOffset: number, littleEndian?: boolean): number",
          "overloads": [
            "(byteOffset: number, littleEndian?: boolean): number"
          ],
          "type": "(byteOffset: number, littleEndian?: boolean) => number",
          "description": "Gets the Float32 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "getFloat64",
          "path": "DataView.prototype.getFloat64",
          "kind": "function",
          "signature": "(byteOffset: number, littleEndian?: boolean): number",
          "overloads": [
            "(byteOffset: number, littleEndian?: boolean): number"
          ],
          "type": "(byteOffset: number, littleEndian?: boolean) => number",
          "description": "Gets the Float64 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "getInt16",
          "path": "DataView.prototype.getInt16",
          "kind": "function",
          "signature": "(byteOffset: number, littleEndian?: boolean): number",
          "overloads": [
            "(byteOffset: number, littleEndian?: boolean): number"
          ],
          "type": "(byteOffset: number, littleEndian?: boolean) => number",
          "description": "Gets the Int16 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "getInt32",
          "path": "DataView.prototype.getInt32",
          "kind": "function",
          "signature": "(byteOffset: number, littleEndian?: boolean): number",
          "overloads": [
            "(byteOffset: number, littleEndian?: boolean): number"
          ],
          "type": "(byteOffset: number, littleEndian?: boolean) => number",
          "description": "Gets the Int32 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "getInt8",
          "path": "DataView.prototype.getInt8",
          "kind": "function",
          "signature": "(byteOffset: number): number",
          "overloads": [
            "(byteOffset: number): number"
          ],
          "type": "(byteOffset: number) => number",
          "description": "Gets the Int8 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "getUint16",
          "path": "DataView.prototype.getUint16",
          "kind": "function",
          "signature": "(byteOffset: number, littleEndian?: boolean): number",
          "overloads": [
            "(byteOffset: number, littleEndian?: boolean): number"
          ],
          "type": "(byteOffset: number, littleEndian?: boolean) => number",
          "description": "Gets the Uint16 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "getUint32",
          "path": "DataView.prototype.getUint32",
          "kind": "function",
          "signature": "(byteOffset: number, littleEndian?: boolean): number",
          "overloads": [
            "(byteOffset: number, littleEndian?: boolean): number"
          ],
          "type": "(byteOffset: number, littleEndian?: boolean) => number",
          "description": "Gets the Uint32 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "getUint8",
          "path": "DataView.prototype.getUint8",
          "kind": "function",
          "signature": "(byteOffset: number): number",
          "overloads": [
            "(byteOffset: number): number"
          ],
          "type": "(byteOffset: number) => number",
          "description": "Gets the Uint8 value at the specified byte offset from the start of the view. There is\nno alignment constraint; multi-byte values may be fetched from any offset."
        },
        {
          "name": "setBigInt64",
          "path": "DataView.prototype.setBigInt64",
          "kind": "function",
          "signature": "(byteOffset: number, value: bigint, littleEndian?: boolean): void",
          "overloads": [
            "(byteOffset: number, value: bigint, littleEndian?: boolean): void"
          ],
          "type": "(byteOffset: number, value: bigint, littleEndian?: boolean) => void",
          "description": "Stores a BigInt64 value at the specified byte offset from the start of the view."
        },
        {
          "name": "setBigUint64",
          "path": "DataView.prototype.setBigUint64",
          "kind": "function",
          "signature": "(byteOffset: number, value: bigint, littleEndian?: boolean): void",
          "overloads": [
            "(byteOffset: number, value: bigint, littleEndian?: boolean): void"
          ],
          "type": "(byteOffset: number, value: bigint, littleEndian?: boolean) => void",
          "description": "Stores a BigUint64 value at the specified byte offset from the start of the view."
        },
        {
          "name": "setFloat16",
          "path": "DataView.prototype.setFloat16",
          "kind": "function",
          "signature": "(byteOffset: number, value: number, littleEndian?: boolean): void",
          "overloads": [
            "(byteOffset: number, value: number, littleEndian?: boolean): void"
          ],
          "type": "(byteOffset: number, value: number, littleEndian?: boolean) => void",
          "description": "Stores an Float16 value at the specified byte offset from the start of the view."
        },
        {
          "name": "setFloat32",
          "path": "DataView.prototype.setFloat32",
          "kind": "function",
          "signature": "(byteOffset: number, value: number, littleEndian?: boolean): void",
          "overloads": [
            "(byteOffset: number, value: number, littleEndian?: boolean): void"
          ],
          "type": "(byteOffset: number, value: number, littleEndian?: boolean) => void",
          "description": "Stores an Float32 value at the specified byte offset from the start of the view."
        },
        {
          "name": "setFloat64",
          "path": "DataView.prototype.setFloat64",
          "kind": "function",
          "signature": "(byteOffset: number, value: number, littleEndian?: boolean): void",
          "overloads": [
            "(byteOffset: number, value: number, littleEndian?: boolean): void"
          ],
          "type": "(byteOffset: number, value: number, littleEndian?: boolean) => void",
          "description": "Stores an Float64 value at the specified byte offset from the start of the view."
        },
        {
          "name": "setInt16",
          "path": "DataView.prototype.setInt16",
          "kind": "function",
          "signature": "(byteOffset: number, value: number, littleEndian?: boolean): void",
          "overloads": [
            "(byteOffset: number, value: number, littleEndian?: boolean): void"
          ],
          "type": "(byteOffset: number, value: number, littleEndian?: boolean) => void",
          "description": "Stores an Int16 value at the specified byte offset from the start of the view."
        },
        {
          "name": "setInt32",
          "path": "DataView.prototype.setInt32",
          "kind": "function",
          "signature": "(byteOffset: number, value: number, littleEndian?: boolean): void",
          "overloads": [
            "(byteOffset: number, value: number, littleEndian?: boolean): void"
          ],
          "type": "(byteOffset: number, value: number, littleEndian?: boolean) => void",
          "description": "Stores an Int32 value at the specified byte offset from the start of the view."
        },
        {
          "name": "setInt8",
          "path": "DataView.prototype.setInt8",
          "kind": "function",
          "signature": "(byteOffset: number, value: number): void",
          "overloads": [
            "(byteOffset: number, value: number): void"
          ],
          "type": "(byteOffset: number, value: number) => void",
          "description": "Stores an Int8 value at the specified byte offset from the start of the view."
        },
        {
          "name": "setUint16",
          "path": "DataView.prototype.setUint16",
          "kind": "function",
          "signature": "(byteOffset: number, value: number, littleEndian?: boolean): void",
          "overloads": [
            "(byteOffset: number, value: number, littleEndian?: boolean): void"
          ],
          "type": "(byteOffset: number, value: number, littleEndian?: boolean) => void",
          "description": "Stores an Uint16 value at the specified byte offset from the start of the view."
        },
        {
          "name": "setUint32",
          "path": "DataView.prototype.setUint32",
          "kind": "function",
          "signature": "(byteOffset: number, value: number, littleEndian?: boolean): void",
          "overloads": [
            "(byteOffset: number, value: number, littleEndian?: boolean): void"
          ],
          "type": "(byteOffset: number, value: number, littleEndian?: boolean) => void",
          "description": "Stores an Uint32 value at the specified byte offset from the start of the view."
        },
        {
          "name": "setUint8",
          "path": "DataView.prototype.setUint8",
          "kind": "function",
          "signature": "(byteOffset: number, value: number): void",
          "overloads": [
            "(byteOffset: number, value: number): void"
          ],
          "type": "(byteOffset: number, value: number) => void",
          "description": "Stores an Uint8 value at the specified byte offset from the start of the view."
        }
      ]
    },
    "Date": {
      "static": [
        {
          "name": "now",
          "path": "Date.now",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Returns the number of milliseconds elapsed since midnight, January 1, 1970 Universal Coordinated Time (UTC)."
        },
        {
          "name": "parse",
          "path": "Date.parse",
          "kind": "function",
          "signature": "(s: string): number",
          "overloads": [
            "(s: string): number"
          ],
          "type": "(s: string) => number",
          "description": "Parses a string containing a date, and returns the number of milliseconds between that date and midnight, January 1, 1970."
        },
        {
          "name": "UTC",
          "path": "Date.UTC",
          "kind": "function",
          "signature": "(year: number, monthIndex: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number",
          "overloads": [
            "(year: number, monthIndex: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number",
            "(year: number, monthIndex?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number"
          ],
          "type": "{ (year: number, monthIndex: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number; (year: number, monthIndex?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number; }",
          "description": "Returns the number of milliseconds between midnight, January 1, 1970 Universal Coordinated Time (UTC) (or GMT) and the specified date."
        }
      ],
      "instance": [
        {
          "name": "getDate",
          "path": "Date.prototype.getDate",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the day-of-the-month, using local time."
        },
        {
          "name": "getDay",
          "path": "Date.prototype.getDay",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the day of the week, using local time."
        },
        {
          "name": "getFullYear",
          "path": "Date.prototype.getFullYear",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the year, using local time."
        },
        {
          "name": "getHours",
          "path": "Date.prototype.getHours",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the hours in a date, using local time."
        },
        {
          "name": "getMilliseconds",
          "path": "Date.prototype.getMilliseconds",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the milliseconds of a Date, using local time."
        },
        {
          "name": "getMinutes",
          "path": "Date.prototype.getMinutes",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the minutes of a Date object, using local time."
        },
        {
          "name": "getMonth",
          "path": "Date.prototype.getMonth",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the month, using local time."
        },
        {
          "name": "getSeconds",
          "path": "Date.prototype.getSeconds",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the seconds of a Date object, using local time."
        },
        {
          "name": "getTime",
          "path": "Date.prototype.getTime",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Returns the stored time value in milliseconds since midnight, January 1, 1970 UTC."
        },
        {
          "name": "getTimezoneOffset",
          "path": "Date.prototype.getTimezoneOffset",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the difference in minutes between Universal Coordinated Time (UTC) and the time on the local computer."
        },
        {
          "name": "getUTCDate",
          "path": "Date.prototype.getUTCDate",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the day-of-the-month, using Universal Coordinated Time (UTC)."
        },
        {
          "name": "getUTCDay",
          "path": "Date.prototype.getUTCDay",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the day of the week using Universal Coordinated Time (UTC)."
        },
        {
          "name": "getUTCFullYear",
          "path": "Date.prototype.getUTCFullYear",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the year using Universal Coordinated Time (UTC)."
        },
        {
          "name": "getUTCHours",
          "path": "Date.prototype.getUTCHours",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the hours value in a Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "getUTCMilliseconds",
          "path": "Date.prototype.getUTCMilliseconds",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the milliseconds of a Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "getUTCMinutes",
          "path": "Date.prototype.getUTCMinutes",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the minutes of a Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "getUTCMonth",
          "path": "Date.prototype.getUTCMonth",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the month of a Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "getUTCSeconds",
          "path": "Date.prototype.getUTCSeconds",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Gets the seconds of a Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "setDate",
          "path": "Date.prototype.setDate",
          "kind": "function",
          "signature": "(date: number): number",
          "overloads": [
            "(date: number): number"
          ],
          "type": "(date: number) => number",
          "description": "Sets the numeric day-of-the-month value of the Date object using local time."
        },
        {
          "name": "setFullYear",
          "path": "Date.prototype.setFullYear",
          "kind": "function",
          "signature": "(year: number, month?: number, date?: number): number",
          "overloads": [
            "(year: number, month?: number, date?: number): number"
          ],
          "type": "(year: number, month?: number, date?: number) => number",
          "description": "Sets the year of the Date object using local time."
        },
        {
          "name": "setHours",
          "path": "Date.prototype.setHours",
          "kind": "function",
          "signature": "(hours: number, min?: number, sec?: number, ms?: number): number",
          "overloads": [
            "(hours: number, min?: number, sec?: number, ms?: number): number"
          ],
          "type": "(hours: number, min?: number, sec?: number, ms?: number) => number",
          "description": "Sets the hour value in the Date object using local time."
        },
        {
          "name": "setMilliseconds",
          "path": "Date.prototype.setMilliseconds",
          "kind": "function",
          "signature": "(ms: number): number",
          "overloads": [
            "(ms: number): number"
          ],
          "type": "(ms: number) => number",
          "description": "Sets the milliseconds value in the Date object using local time."
        },
        {
          "name": "setMinutes",
          "path": "Date.prototype.setMinutes",
          "kind": "function",
          "signature": "(min: number, sec?: number, ms?: number): number",
          "overloads": [
            "(min: number, sec?: number, ms?: number): number"
          ],
          "type": "(min: number, sec?: number, ms?: number) => number",
          "description": "Sets the minutes value in the Date object using local time."
        },
        {
          "name": "setMonth",
          "path": "Date.prototype.setMonth",
          "kind": "function",
          "signature": "(month: number, date?: number): number",
          "overloads": [
            "(month: number, date?: number): number"
          ],
          "type": "(month: number, date?: number) => number",
          "description": "Sets the month value in the Date object using local time."
        },
        {
          "name": "setSeconds",
          "path": "Date.prototype.setSeconds",
          "kind": "function",
          "signature": "(sec: number, ms?: number): number",
          "overloads": [
            "(sec: number, ms?: number): number"
          ],
          "type": "(sec: number, ms?: number) => number",
          "description": "Sets the seconds value in the Date object using local time."
        },
        {
          "name": "setTime",
          "path": "Date.prototype.setTime",
          "kind": "function",
          "signature": "(time: number): number",
          "overloads": [
            "(time: number): number"
          ],
          "type": "(time: number) => number",
          "description": "Sets the date and time value in the Date object."
        },
        {
          "name": "setUTCDate",
          "path": "Date.prototype.setUTCDate",
          "kind": "function",
          "signature": "(date: number): number",
          "overloads": [
            "(date: number): number"
          ],
          "type": "(date: number) => number",
          "description": "Sets the numeric day of the month in the Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "setUTCFullYear",
          "path": "Date.prototype.setUTCFullYear",
          "kind": "function",
          "signature": "(year: number, month?: number, date?: number): number",
          "overloads": [
            "(year: number, month?: number, date?: number): number"
          ],
          "type": "(year: number, month?: number, date?: number) => number",
          "description": "Sets the year value in the Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "setUTCHours",
          "path": "Date.prototype.setUTCHours",
          "kind": "function",
          "signature": "(hours: number, min?: number, sec?: number, ms?: number): number",
          "overloads": [
            "(hours: number, min?: number, sec?: number, ms?: number): number"
          ],
          "type": "(hours: number, min?: number, sec?: number, ms?: number) => number",
          "description": "Sets the hours value in the Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "setUTCMilliseconds",
          "path": "Date.prototype.setUTCMilliseconds",
          "kind": "function",
          "signature": "(ms: number): number",
          "overloads": [
            "(ms: number): number"
          ],
          "type": "(ms: number) => number",
          "description": "Sets the milliseconds value in the Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "setUTCMinutes",
          "path": "Date.prototype.setUTCMinutes",
          "kind": "function",
          "signature": "(min: number, sec?: number, ms?: number): number",
          "overloads": [
            "(min: number, sec?: number, ms?: number): number"
          ],
          "type": "(min: number, sec?: number, ms?: number) => number",
          "description": "Sets the minutes value in the Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "setUTCMonth",
          "path": "Date.prototype.setUTCMonth",
          "kind": "function",
          "signature": "(month: number, date?: number): number",
          "overloads": [
            "(month: number, date?: number): number"
          ],
          "type": "(month: number, date?: number) => number",
          "description": "Sets the month value in the Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "setUTCSeconds",
          "path": "Date.prototype.setUTCSeconds",
          "kind": "function",
          "signature": "(sec: number, ms?: number): number",
          "overloads": [
            "(sec: number, ms?: number): number"
          ],
          "type": "(sec: number, ms?: number) => number",
          "description": "Sets the seconds value in the Date object using Universal Coordinated Time (UTC)."
        },
        {
          "name": "toDateString",
          "path": "Date.prototype.toDateString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a date as a string value."
        },
        {
          "name": "toISOString",
          "path": "Date.prototype.toISOString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a date as a string value in ISO format."
        },
        {
          "name": "toJSON",
          "path": "Date.prototype.toJSON",
          "kind": "function",
          "signature": "(key?: any): string",
          "overloads": [
            "(key?: any): string"
          ],
          "type": "(key?: any) => string",
          "description": "Used by the JSON.stringify method to enable the transformation of an object's data for JavaScript Object Notation (JSON) serialization."
        },
        {
          "name": "toLocaleDateString",
          "path": "Date.prototype.toLocaleDateString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales?: string | string[], options?: DateTimeFormatOptions): string",
            "(locales?: LocalesArgument, options?: DateTimeFormatOptions): string"
          ],
          "type": "{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }",
          "description": "Returns a date as a string value appropriate to the host environment's current locale.\nConverts a date to a string by using the current or specified locale."
        },
        {
          "name": "toLocaleString",
          "path": "Date.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales?: string | string[], options?: DateTimeFormatOptions): string",
            "(locales?: LocalesArgument, options?: DateTimeFormatOptions): string"
          ],
          "type": "{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }",
          "description": "Returns a value as a string value appropriate to the host environment's current locale.\nConverts a date and time to a string by using the current or specified locale."
        },
        {
          "name": "toLocaleTimeString",
          "path": "Date.prototype.toLocaleTimeString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales?: string | string[], options?: DateTimeFormatOptions): string",
            "(locales?: LocalesArgument, options?: DateTimeFormatOptions): string"
          ],
          "type": "{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }",
          "description": "Returns a time as a string value appropriate to the host environment's current locale.\nConverts a time to a string by using the current or specified locale."
        },
        {
          "name": "toString",
          "path": "Date.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of a date. The format of the string depends on the locale."
        },
        {
          "name": "toTimeString",
          "path": "Date.prototype.toTimeString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a time as a string value."
        },
        {
          "name": "toUTCString",
          "path": "Date.prototype.toUTCString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a date converted to a string using Universal Coordinated Time (UTC)."
        },
        {
          "name": "valueOf",
          "path": "Date.prototype.valueOf",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Returns the stored time value in milliseconds since midnight, January 1, 1970 UTC."
        }
      ]
    },
    "DisposableStack": {
      "static": [],
      "instance": [
        {
          "name": "adopt",
          "path": "DisposableStack.prototype.adopt",
          "kind": "function",
          "signature": "<T>(value: T, onDispose: (value: T) => void): T",
          "overloads": [
            "<T>(value: T, onDispose: (value: T) => void): T"
          ],
          "type": "<T>(value: T, onDispose: (value: T) => void) => T",
          "description": "Adds a value and associated disposal callback as a resource to the stack."
        },
        {
          "name": "defer",
          "path": "DisposableStack.prototype.defer",
          "kind": "function",
          "signature": "(onDispose: () => void): void",
          "overloads": [
            "(onDispose: () => void): void"
          ],
          "type": "(onDispose: () => void) => void",
          "description": "Adds a callback to be invoked when the stack is disposed."
        },
        {
          "name": "dispose",
          "path": "DisposableStack.prototype.dispose",
          "kind": "function",
          "signature": "(): void",
          "overloads": [
            "(): void"
          ],
          "type": "() => void",
          "description": "Disposes each resource in the stack in the reverse order that they were added."
        },
        {
          "name": "disposed",
          "path": "DisposableStack.prototype.disposed",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a value indicating whether this stack has been disposed."
        },
        {
          "name": "move",
          "path": "DisposableStack.prototype.move",
          "kind": "function",
          "signature": "(): DisposableStack",
          "overloads": [
            "(): DisposableStack"
          ],
          "type": "() => DisposableStack",
          "description": "Move all resources out of this stack and into a new `DisposableStack`, and marks this stack as disposed."
        },
        {
          "name": "use",
          "path": "DisposableStack.prototype.use",
          "kind": "function",
          "signature": "<T extends Disposable | null | undefined>(value: T): T",
          "overloads": [
            "<T extends Disposable | null | undefined>(value: T): T"
          ],
          "type": "<T extends Disposable | null | undefined>(value: T) => T",
          "description": "Adds a disposable resource to the stack, returning the resource."
        }
      ]
    },
    "Error": {
      "static": [
        {
          "name": "isError",
          "path": "Error.isError",
          "kind": "function",
          "signature": "(error: unknown): error is Error",
          "overloads": [
            "(error: unknown): error is Error"
          ],
          "type": "(error: unknown) => error is Error",
          "description": "Indicates whether the argument provided is a built-in Error instance or not."
        }
      ],
      "instance": [
        {
          "name": "cause",
          "path": "Error.prototype.cause",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "unknown",
          "description": ""
        },
        {
          "name": "message",
          "path": "Error.prototype.message",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "stack",
          "path": "Error.prototype.stack",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        }
      ]
    },
    "EvalError": {
      "static": [
        {
          "name": "isError",
          "path": "EvalError.isError",
          "kind": "function",
          "signature": "(error: unknown): error is Error",
          "overloads": [
            "(error: unknown): error is Error"
          ],
          "type": "(error: unknown) => error is Error",
          "description": "Indicates whether the argument provided is a built-in Error instance or not."
        }
      ],
      "instance": [
        {
          "name": "cause",
          "path": "EvalError.prototype.cause",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "unknown",
          "description": ""
        },
        {
          "name": "message",
          "path": "EvalError.prototype.message",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "stack",
          "path": "EvalError.prototype.stack",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        }
      ]
    },
    "Float16Array": {
      "static": [
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Float16Array.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "from",
          "path": "Float16Array.from",
          "kind": "function",
          "signature": "(arrayLike: ArrayLike<number>): Float16Array<ArrayBuffer>",
          "overloads": [
            "(arrayLike: ArrayLike<number>): Float16Array<ArrayBuffer>",
            "<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Float16Array<ArrayBuffer>",
            "(elements: Iterable<number>): Float16Array<ArrayBuffer>",
            "<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Float16Array<ArrayBuffer>"
          ],
          "type": "{ (arrayLike: ArrayLike<number>): Float16Array<ArrayBuffer>; <T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Float16Array<ArrayBuffer>; (elements: Iterable<number>): Float16Array<ArrayBuffer>; <T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Float16Array<ArrayBuffer>; }",
          "description": "Creates an array from an array-like or iterable object."
        },
        {
          "name": "of",
          "path": "Float16Array.of",
          "kind": "function",
          "signature": "(...items: number[]): Float16Array<ArrayBuffer>",
          "overloads": [
            "(...items: number[]): Float16Array<ArrayBuffer>"
          ],
          "type": "(...items: number[]) => Float16Array<ArrayBuffer>",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Float16Array.prototype.at",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "buffer",
          "path": "Float16Array.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": "The ArrayBuffer instance referenced by the array."
        },
        {
          "name": "byteLength",
          "path": "Float16Array.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The length in bytes of the array."
        },
        {
          "name": "byteOffset",
          "path": "Float16Array.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The offset in bytes of the array."
        },
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Float16Array.prototype.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "copyWithin",
          "path": "Float16Array.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): Float16Array<TArrayBuffer>",
          "overloads": [
            "(target: number, start: number, end?: number): Float16Array<TArrayBuffer>"
          ],
          "type": "(target: number, start: number, end?: number) => Float16Array<TArrayBuffer>",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Float16Array.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, number]>",
          "overloads": [
            "(): ArrayIterator<[number, number]>"
          ],
          "type": "() => ArrayIterator<[number, number]>",
          "description": "Returns an array of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Float16Array.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Float16Array.prototype.fill",
          "kind": "function",
          "signature": "(value: number, start?: number, end?: number): Float16Array<TArrayBuffer>",
          "overloads": [
            "(value: number, start?: number, end?: number): Float16Array<TArrayBuffer>"
          ],
          "type": "(value: number, start?: number, end?: number) => Float16Array<TArrayBuffer>",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Float16Array.prototype.filter",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => any, thisArg?: any): Float16Array<ArrayBuffer>",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => any, thisArg?: any): Float16Array<ArrayBuffer>"
          ],
          "type": "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => any, thisArg?: any) => Float16Array<ArrayBuffer>",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Float16Array.prototype.find",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Float16Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Float16Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Float16Array<TArrayBuffer>) => boolean, thisArg?: any) => number | undefined",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Float16Array.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Float16Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Float16Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Float16Array<TArrayBuffer>) => boolean, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Float16Array.prototype.findLast",
          "kind": "function",
          "signature": "<S extends number>(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends number>(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => value is S, thisArg?: any): S",
            "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "{ <S extends number>(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => value is S, thisArg?: any): S; (predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any): number | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Float16Array.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "forEach",
          "path": "Float16Array.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Float16Array<TArrayBuffer>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Float16Array<TArrayBuffer>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Float16Array<TArrayBuffer>) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Float16Array.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: number, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: number, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Float16Array.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array."
        },
        {
          "name": "join",
          "path": "Float16Array.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Float16Array.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Float16Array.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a value in an array."
        },
        {
          "name": "map",
          "path": "Float16Array.prototype.map",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Float16Array<TArrayBuffer>) => number, thisArg?: any): Float16Array<ArrayBuffer>",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Float16Array<TArrayBuffer>) => number, thisArg?: any): Float16Array<ArrayBuffer>"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Float16Array<TArrayBuffer>) => number, thisArg?: any) => Float16Array<ArrayBuffer>",
          "description": "Calls a defined callback function on each element of an array, and returns an array that\ncontains the results."
        },
        {
          "name": "reduce",
          "path": "Float16Array.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of\nthe callback function is the accumulated result, and is provided as an argument in the next\ncall to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Float16Array.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float16Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order.\nThe return value of the callback function is the accumulated result, and is provided as an\nargument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Float16Array.prototype.reverse",
          "kind": "function",
          "signature": "(): Float16Array<TArrayBuffer>",
          "overloads": [
            "(): Float16Array<TArrayBuffer>"
          ],
          "type": "() => Float16Array<TArrayBuffer>",
          "description": "Reverses the elements in an Array."
        },
        {
          "name": "set",
          "path": "Float16Array.prototype.set",
          "kind": "function",
          "signature": "(array: ArrayLike<number>, offset?: number): void",
          "overloads": [
            "(array: ArrayLike<number>, offset?: number): void"
          ],
          "type": "(array: ArrayLike<number>, offset?: number) => void",
          "description": "Sets a value or an array of values."
        },
        {
          "name": "slice",
          "path": "Float16Array.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): Float16Array<ArrayBuffer>",
          "overloads": [
            "(start?: number, end?: number): Float16Array<ArrayBuffer>"
          ],
          "type": "(start?: number, end?: number) => Float16Array<ArrayBuffer>",
          "description": "Returns a section of an array."
        },
        {
          "name": "some",
          "path": "Float16Array.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Float16Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Float16Array.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Float16Array<TArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Float16Array<TArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Float16Array<TArrayBuffer>",
          "description": "Sorts an array."
        },
        {
          "name": "subarray",
          "path": "Float16Array.prototype.subarray",
          "kind": "function",
          "signature": "(begin?: number, end?: number): Float16Array<TArrayBuffer>",
          "overloads": [
            "(begin?: number, end?: number): Float16Array<TArrayBuffer>"
          ],
          "type": "(begin?: number, end?: number) => Float16Array<TArrayBuffer>",
          "description": "Gets a new Float16Array view of the ArrayBuffer store for this array, referencing the elements\nat begin, inclusive, up to end, exclusive."
        },
        {
          "name": "toLocaleString",
          "path": "Float16Array.prototype.toLocaleString",
          "kind": "function",
          "signature": "(locales?: string | string[], options?: NumberFormatOptions): string",
          "overloads": [
            "(locales?: string | string[], options?: NumberFormatOptions): string"
          ],
          "type": "(locales?: string | string[], options?: Intl.NumberFormatOptions) => string",
          "description": "Converts a number to a string by using the current locale."
        },
        {
          "name": "toReversed",
          "path": "Float16Array.prototype.toReversed",
          "kind": "function",
          "signature": "(): Float16Array<ArrayBuffer>",
          "overloads": [
            "(): Float16Array<ArrayBuffer>"
          ],
          "type": "() => Float16Array<ArrayBuffer>",
          "description": "Copies the array and returns the copy with the elements in reverse order."
        },
        {
          "name": "toSorted",
          "path": "Float16Array.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Float16Array<ArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Float16Array<ArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Float16Array<ArrayBuffer>",
          "description": "Copies and sorts the array."
        },
        {
          "name": "toString",
          "path": "Float16Array.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "valueOf",
          "path": "Float16Array.prototype.valueOf",
          "kind": "function",
          "signature": "(): Float16Array<TArrayBuffer>",
          "overloads": [
            "(): Float16Array<TArrayBuffer>"
          ],
          "type": "() => Float16Array<TArrayBuffer>",
          "description": "Returns the primitive value of the specified object."
        },
        {
          "name": "values",
          "path": "Float16Array.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of values in the array"
        },
        {
          "name": "with",
          "path": "Float16Array.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: number): Float16Array<ArrayBuffer>",
          "overloads": [
            "(index: number, value: number): Float16Array<ArrayBuffer>"
          ],
          "type": "(index: number, value: number) => Float16Array<ArrayBuffer>",
          "description": "Copies the array and inserts the given number at the provided index."
        }
      ]
    },
    "Float32Array": {
      "static": [
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Float32Array.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "from",
          "path": "Float32Array.from",
          "kind": "function",
          "signature": "(arrayLike: ArrayLike<number>): Float32Array<ArrayBuffer>",
          "overloads": [
            "(arrayLike: ArrayLike<number>): Float32Array<ArrayBuffer>",
            "<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Float32Array<ArrayBuffer>",
            "(elements: Iterable<number>): Float32Array<ArrayBuffer>",
            "<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Float32Array<ArrayBuffer>"
          ],
          "type": "{ (arrayLike: ArrayLike<number>): Float32Array<ArrayBuffer>; <T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Float32Array<ArrayBuffer>; (elements: Iterable<number>): Float32Array<ArrayBuffer>; <T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Float32Array<ArrayBuffer>; }",
          "description": "Creates an array from an array-like or iterable object."
        },
        {
          "name": "of",
          "path": "Float32Array.of",
          "kind": "function",
          "signature": "(...items: number[]): Float32Array<ArrayBuffer>",
          "overloads": [
            "(...items: number[]): Float32Array<ArrayBuffer>"
          ],
          "type": "(...items: number[]) => Float32Array<ArrayBuffer>",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Float32Array.prototype.at",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "buffer",
          "path": "Float32Array.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": "The ArrayBuffer instance referenced by the array."
        },
        {
          "name": "byteLength",
          "path": "Float32Array.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The length in bytes of the array."
        },
        {
          "name": "byteOffset",
          "path": "Float32Array.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The offset in bytes of the array."
        },
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Float32Array.prototype.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "copyWithin",
          "path": "Float32Array.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): Float32Array<TArrayBuffer>",
          "overloads": [
            "(target: number, start: number, end?: number): Float32Array<TArrayBuffer>"
          ],
          "type": "(target: number, start: number, end?: number) => Float32Array<TArrayBuffer>",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Float32Array.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, number]>",
          "overloads": [
            "(): ArrayIterator<[number, number]>"
          ],
          "type": "() => ArrayIterator<[number, number]>",
          "description": "Returns an array of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Float32Array.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Float32Array.prototype.fill",
          "kind": "function",
          "signature": "(value: number, start?: number, end?: number): Float32Array<TArrayBuffer>",
          "overloads": [
            "(value: number, start?: number, end?: number): Float32Array<TArrayBuffer>"
          ],
          "type": "(value: number, start?: number, end?: number) => Float32Array<TArrayBuffer>",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Float32Array.prototype.filter",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => any, thisArg?: any): Float32Array<ArrayBuffer>",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => any, thisArg?: any): Float32Array<ArrayBuffer>"
          ],
          "type": "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => any, thisArg?: any) => Float32Array<ArrayBuffer>",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Float32Array.prototype.find",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Float32Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Float32Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Float32Array<TArrayBuffer>) => boolean, thisArg?: any) => number | undefined",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Float32Array.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Float32Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Float32Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Float32Array<TArrayBuffer>) => boolean, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Float32Array.prototype.findLast",
          "kind": "function",
          "signature": "<S extends number>(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends number>(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => value is S, thisArg?: any): S",
            "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "{ <S extends number>(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => value is S, thisArg?: any): S; (predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any): number | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Float32Array.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "forEach",
          "path": "Float32Array.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Float32Array<TArrayBuffer>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Float32Array<TArrayBuffer>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Float32Array<TArrayBuffer>) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Float32Array.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: number, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: number, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Float32Array.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array."
        },
        {
          "name": "join",
          "path": "Float32Array.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Float32Array.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Float32Array.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a value in an array."
        },
        {
          "name": "map",
          "path": "Float32Array.prototype.map",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Float32Array<TArrayBuffer>) => number, thisArg?: any): Float32Array<ArrayBuffer>",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Float32Array<TArrayBuffer>) => number, thisArg?: any): Float32Array<ArrayBuffer>"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Float32Array<TArrayBuffer>) => number, thisArg?: any) => Float32Array<ArrayBuffer>",
          "description": "Calls a defined callback function on each element of an array, and returns an array that\ncontains the results."
        },
        {
          "name": "reduce",
          "path": "Float32Array.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of\nthe callback function is the accumulated result, and is provided as an argument in the next\ncall to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Float32Array.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float32Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order.\nThe return value of the callback function is the accumulated result, and is provided as an\nargument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Float32Array.prototype.reverse",
          "kind": "function",
          "signature": "(): Float32Array<TArrayBuffer>",
          "overloads": [
            "(): Float32Array<TArrayBuffer>"
          ],
          "type": "() => Float32Array<TArrayBuffer>",
          "description": "Reverses the elements in an Array."
        },
        {
          "name": "set",
          "path": "Float32Array.prototype.set",
          "kind": "function",
          "signature": "(array: ArrayLike<number>, offset?: number): void",
          "overloads": [
            "(array: ArrayLike<number>, offset?: number): void"
          ],
          "type": "(array: ArrayLike<number>, offset?: number) => void",
          "description": "Sets a value or an array of values."
        },
        {
          "name": "slice",
          "path": "Float32Array.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): Float32Array<ArrayBuffer>",
          "overloads": [
            "(start?: number, end?: number): Float32Array<ArrayBuffer>"
          ],
          "type": "(start?: number, end?: number) => Float32Array<ArrayBuffer>",
          "description": "Returns a section of an array."
        },
        {
          "name": "some",
          "path": "Float32Array.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Float32Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Float32Array.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Float32Array<TArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Float32Array<TArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Float32Array<TArrayBuffer>",
          "description": "Sorts an array."
        },
        {
          "name": "subarray",
          "path": "Float32Array.prototype.subarray",
          "kind": "function",
          "signature": "(begin?: number, end?: number): Float32Array<TArrayBuffer>",
          "overloads": [
            "(begin?: number, end?: number): Float32Array<TArrayBuffer>"
          ],
          "type": "(begin?: number, end?: number) => Float32Array<TArrayBuffer>",
          "description": "Gets a new Float32Array view of the ArrayBuffer store for this array, referencing the elements\nat begin, inclusive, up to end, exclusive."
        },
        {
          "name": "toLocaleString",
          "path": "Float32Array.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales: string | string[], options?: NumberFormatOptions): string"
          ],
          "type": "{ (): string; (locales: string | string[], options?: Intl.NumberFormatOptions): string; }",
          "description": "Converts a number to a string by using the current locale."
        },
        {
          "name": "toReversed",
          "path": "Float32Array.prototype.toReversed",
          "kind": "function",
          "signature": "(): Float32Array<ArrayBuffer>",
          "overloads": [
            "(): Float32Array<ArrayBuffer>"
          ],
          "type": "() => Float32Array<ArrayBuffer>",
          "description": "Copies the array and returns the copy with the elements in reverse order."
        },
        {
          "name": "toSorted",
          "path": "Float32Array.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Float32Array<ArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Float32Array<ArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Float32Array<ArrayBuffer>",
          "description": "Copies and sorts the array."
        },
        {
          "name": "toString",
          "path": "Float32Array.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "valueOf",
          "path": "Float32Array.prototype.valueOf",
          "kind": "function",
          "signature": "(): Float32Array<TArrayBuffer>",
          "overloads": [
            "(): Float32Array<TArrayBuffer>"
          ],
          "type": "() => Float32Array<TArrayBuffer>",
          "description": "Returns the primitive value of the specified object."
        },
        {
          "name": "values",
          "path": "Float32Array.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of values in the array"
        },
        {
          "name": "with",
          "path": "Float32Array.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: number): Float32Array<ArrayBuffer>",
          "overloads": [
            "(index: number, value: number): Float32Array<ArrayBuffer>"
          ],
          "type": "(index: number, value: number) => Float32Array<ArrayBuffer>",
          "description": "Copies the array and inserts the given number at the provided index."
        }
      ]
    },
    "Float64Array": {
      "static": [
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Float64Array.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "from",
          "path": "Float64Array.from",
          "kind": "function",
          "signature": "(arrayLike: ArrayLike<number>): Float64Array<ArrayBuffer>",
          "overloads": [
            "(arrayLike: ArrayLike<number>): Float64Array<ArrayBuffer>",
            "<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Float64Array<ArrayBuffer>",
            "(elements: Iterable<number>): Float64Array<ArrayBuffer>",
            "<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Float64Array<ArrayBuffer>"
          ],
          "type": "{ (arrayLike: ArrayLike<number>): Float64Array<ArrayBuffer>; <T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Float64Array<ArrayBuffer>; (elements: Iterable<number>): Float64Array<ArrayBuffer>; <T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Float64Array<ArrayBuffer>; }",
          "description": "Creates an array from an array-like or iterable object."
        },
        {
          "name": "of",
          "path": "Float64Array.of",
          "kind": "function",
          "signature": "(...items: number[]): Float64Array<ArrayBuffer>",
          "overloads": [
            "(...items: number[]): Float64Array<ArrayBuffer>"
          ],
          "type": "(...items: number[]) => Float64Array<ArrayBuffer>",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Float64Array.prototype.at",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "buffer",
          "path": "Float64Array.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": "The ArrayBuffer instance referenced by the array."
        },
        {
          "name": "byteLength",
          "path": "Float64Array.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The length in bytes of the array."
        },
        {
          "name": "byteOffset",
          "path": "Float64Array.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The offset in bytes of the array."
        },
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Float64Array.prototype.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "copyWithin",
          "path": "Float64Array.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): Float64Array<TArrayBuffer>",
          "overloads": [
            "(target: number, start: number, end?: number): Float64Array<TArrayBuffer>"
          ],
          "type": "(target: number, start: number, end?: number) => Float64Array<TArrayBuffer>",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Float64Array.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, number]>",
          "overloads": [
            "(): ArrayIterator<[number, number]>"
          ],
          "type": "() => ArrayIterator<[number, number]>",
          "description": "Returns an array of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Float64Array.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Float64Array.prototype.fill",
          "kind": "function",
          "signature": "(value: number, start?: number, end?: number): Float64Array<TArrayBuffer>",
          "overloads": [
            "(value: number, start?: number, end?: number): Float64Array<TArrayBuffer>"
          ],
          "type": "(value: number, start?: number, end?: number) => Float64Array<TArrayBuffer>",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Float64Array.prototype.filter",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => any, thisArg?: any): Float64Array<ArrayBuffer>",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => any, thisArg?: any): Float64Array<ArrayBuffer>"
          ],
          "type": "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => any, thisArg?: any) => Float64Array<ArrayBuffer>",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Float64Array.prototype.find",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Float64Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Float64Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Float64Array<TArrayBuffer>) => boolean, thisArg?: any) => number | undefined",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Float64Array.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Float64Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Float64Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Float64Array<TArrayBuffer>) => boolean, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Float64Array.prototype.findLast",
          "kind": "function",
          "signature": "<S extends number>(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends number>(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => value is S, thisArg?: any): S",
            "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "{ <S extends number>(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => value is S, thisArg?: any): S; (predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any): number | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Float64Array.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "forEach",
          "path": "Float64Array.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Float64Array<TArrayBuffer>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Float64Array<TArrayBuffer>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Float64Array<TArrayBuffer>) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Float64Array.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: number, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: number, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Float64Array.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array."
        },
        {
          "name": "join",
          "path": "Float64Array.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Float64Array.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Float64Array.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a value in an array."
        },
        {
          "name": "map",
          "path": "Float64Array.prototype.map",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Float64Array<TArrayBuffer>) => number, thisArg?: any): Float64Array<ArrayBuffer>",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Float64Array<TArrayBuffer>) => number, thisArg?: any): Float64Array<ArrayBuffer>"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Float64Array<TArrayBuffer>) => number, thisArg?: any) => Float64Array<ArrayBuffer>",
          "description": "Calls a defined callback function on each element of an array, and returns an array that\ncontains the results."
        },
        {
          "name": "reduce",
          "path": "Float64Array.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of\nthe callback function is the accumulated result, and is provided as an argument in the next\ncall to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Float64Array.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Float64Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order.\nThe return value of the callback function is the accumulated result, and is provided as an\nargument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Float64Array.prototype.reverse",
          "kind": "function",
          "signature": "(): Float64Array<TArrayBuffer>",
          "overloads": [
            "(): Float64Array<TArrayBuffer>"
          ],
          "type": "() => Float64Array<TArrayBuffer>",
          "description": "Reverses the elements in an Array."
        },
        {
          "name": "set",
          "path": "Float64Array.prototype.set",
          "kind": "function",
          "signature": "(array: ArrayLike<number>, offset?: number): void",
          "overloads": [
            "(array: ArrayLike<number>, offset?: number): void"
          ],
          "type": "(array: ArrayLike<number>, offset?: number) => void",
          "description": "Sets a value or an array of values."
        },
        {
          "name": "slice",
          "path": "Float64Array.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): Float64Array<ArrayBuffer>",
          "overloads": [
            "(start?: number, end?: number): Float64Array<ArrayBuffer>"
          ],
          "type": "(start?: number, end?: number) => Float64Array<ArrayBuffer>",
          "description": "Returns a section of an array."
        },
        {
          "name": "some",
          "path": "Float64Array.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Float64Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Float64Array.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Float64Array<TArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Float64Array<TArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Float64Array<TArrayBuffer>",
          "description": "Sorts an array."
        },
        {
          "name": "subarray",
          "path": "Float64Array.prototype.subarray",
          "kind": "function",
          "signature": "(begin?: number, end?: number): Float64Array<TArrayBuffer>",
          "overloads": [
            "(begin?: number, end?: number): Float64Array<TArrayBuffer>"
          ],
          "type": "(begin?: number, end?: number) => Float64Array<TArrayBuffer>",
          "description": "Gets a new Float64Array view of the ArrayBuffer store for this array, referencing the elements\nat begin, inclusive, up to end, exclusive."
        },
        {
          "name": "toLocaleString",
          "path": "Float64Array.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales: string | string[], options?: NumberFormatOptions): string"
          ],
          "type": "{ (): string; (locales: string | string[], options?: Intl.NumberFormatOptions): string; }",
          "description": "Converts a number to a string by using the current locale."
        },
        {
          "name": "toReversed",
          "path": "Float64Array.prototype.toReversed",
          "kind": "function",
          "signature": "(): Float64Array<ArrayBuffer>",
          "overloads": [
            "(): Float64Array<ArrayBuffer>"
          ],
          "type": "() => Float64Array<ArrayBuffer>",
          "description": "Copies the array and returns the copy with the elements in reverse order."
        },
        {
          "name": "toSorted",
          "path": "Float64Array.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Float64Array<ArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Float64Array<ArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Float64Array<ArrayBuffer>",
          "description": "Copies and sorts the array."
        },
        {
          "name": "toString",
          "path": "Float64Array.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "valueOf",
          "path": "Float64Array.prototype.valueOf",
          "kind": "function",
          "signature": "(): Float64Array<TArrayBuffer>",
          "overloads": [
            "(): Float64Array<TArrayBuffer>"
          ],
          "type": "() => Float64Array<TArrayBuffer>",
          "description": "Returns the primitive value of the specified object."
        },
        {
          "name": "values",
          "path": "Float64Array.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of values in the array"
        },
        {
          "name": "with",
          "path": "Float64Array.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: number): Float64Array<ArrayBuffer>",
          "overloads": [
            "(index: number, value: number): Float64Array<ArrayBuffer>"
          ],
          "type": "(index: number, value: number) => Float64Array<ArrayBuffer>",
          "description": "Copies the array and inserts the given number at the provided index."
        }
      ]
    },
    "Function": {
      "static": [],
      "instance": [
        {
          "name": "apply",
          "path": "Function.prototype.apply",
          "kind": "function",
          "signature": "(this: Function, thisArg: any, argArray?: any): any",
          "overloads": [
            "(this: Function, thisArg: any, argArray?: any): any"
          ],
          "type": "(this: Function, thisArg: any, argArray?: any) => any",
          "description": "Calls the function, substituting the specified object for the this value of the function, and the specified array for the arguments of the function."
        },
        {
          "name": "bind",
          "path": "Function.prototype.bind",
          "kind": "function",
          "signature": "(this: Function, thisArg: any, ...argArray: any[]): any",
          "overloads": [
            "(this: Function, thisArg: any, ...argArray: any[]): any"
          ],
          "type": "(this: Function, thisArg: any, ...argArray: any[]) => any",
          "description": "For a given function, creates a bound function that has the same body as the original function.\nThe this object of the bound function is associated with the specified object, and has the specified initial parameters."
        },
        {
          "name": "call",
          "path": "Function.prototype.call",
          "kind": "function",
          "signature": "(this: Function, thisArg: any, ...argArray: any[]): any",
          "overloads": [
            "(this: Function, thisArg: any, ...argArray: any[]): any"
          ],
          "type": "(this: Function, thisArg: any, ...argArray: any[]) => any",
          "description": "Calls a method of an object, substituting another object for the current object."
        },
        {
          "name": "toString",
          "path": "Function.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of a function."
        }
      ]
    },
    "Int8Array": {
      "static": [
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Int8Array.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "from",
          "path": "Int8Array.from",
          "kind": "function",
          "signature": "(arrayLike: ArrayLike<number>): Int8Array<ArrayBuffer>",
          "overloads": [
            "(arrayLike: ArrayLike<number>): Int8Array<ArrayBuffer>",
            "<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Int8Array<ArrayBuffer>",
            "(elements: Iterable<number>): Int8Array<ArrayBuffer>",
            "<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Int8Array<ArrayBuffer>"
          ],
          "type": "{ (arrayLike: ArrayLike<number>): Int8Array<ArrayBuffer>; <T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Int8Array<ArrayBuffer>; (elements: Iterable<number>): Int8Array<ArrayBuffer>; <T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Int8Array<ArrayBuffer>; }",
          "description": "Creates an array from an array-like or iterable object."
        },
        {
          "name": "of",
          "path": "Int8Array.of",
          "kind": "function",
          "signature": "(...items: number[]): Int8Array<ArrayBuffer>",
          "overloads": [
            "(...items: number[]): Int8Array<ArrayBuffer>"
          ],
          "type": "(...items: number[]) => Int8Array<ArrayBuffer>",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Int8Array.prototype.at",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "buffer",
          "path": "Int8Array.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": "The ArrayBuffer instance referenced by the array."
        },
        {
          "name": "byteLength",
          "path": "Int8Array.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The length in bytes of the array."
        },
        {
          "name": "byteOffset",
          "path": "Int8Array.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The offset in bytes of the array."
        },
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Int8Array.prototype.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "copyWithin",
          "path": "Int8Array.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): Int8Array<TArrayBuffer>",
          "overloads": [
            "(target: number, start: number, end?: number): Int8Array<TArrayBuffer>"
          ],
          "type": "(target: number, start: number, end?: number) => Int8Array<TArrayBuffer>",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Int8Array.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, number]>",
          "overloads": [
            "(): ArrayIterator<[number, number]>"
          ],
          "type": "() => ArrayIterator<[number, number]>",
          "description": "Returns an array of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Int8Array.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Int8Array.prototype.fill",
          "kind": "function",
          "signature": "(value: number, start?: number, end?: number): Int8Array<TArrayBuffer>",
          "overloads": [
            "(value: number, start?: number, end?: number): Int8Array<TArrayBuffer>"
          ],
          "type": "(value: number, start?: number, end?: number) => Int8Array<TArrayBuffer>",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Int8Array.prototype.filter",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => any, thisArg?: any): Int8Array<ArrayBuffer>",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => any, thisArg?: any): Int8Array<ArrayBuffer>"
          ],
          "type": "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => any, thisArg?: any) => Int8Array<ArrayBuffer>",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Int8Array.prototype.find",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Int8Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Int8Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Int8Array<TArrayBuffer>) => boolean, thisArg?: any) => number | undefined",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Int8Array.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Int8Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Int8Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Int8Array<TArrayBuffer>) => boolean, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Int8Array.prototype.findLast",
          "kind": "function",
          "signature": "<S extends number>(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends number>(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => value is S, thisArg?: any): S",
            "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "{ <S extends number>(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => value is S, thisArg?: any): S; (predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any): number | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Int8Array.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "forEach",
          "path": "Int8Array.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Int8Array<TArrayBuffer>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Int8Array<TArrayBuffer>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Int8Array<TArrayBuffer>) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Int8Array.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: number, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: number, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Int8Array.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array."
        },
        {
          "name": "join",
          "path": "Int8Array.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Int8Array.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Int8Array.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a value in an array."
        },
        {
          "name": "map",
          "path": "Int8Array.prototype.map",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Int8Array<TArrayBuffer>) => number, thisArg?: any): Int8Array<ArrayBuffer>",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Int8Array<TArrayBuffer>) => number, thisArg?: any): Int8Array<ArrayBuffer>"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Int8Array<TArrayBuffer>) => number, thisArg?: any) => Int8Array<ArrayBuffer>",
          "description": "Calls a defined callback function on each element of an array, and returns an array that\ncontains the results."
        },
        {
          "name": "reduce",
          "path": "Int8Array.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of\nthe callback function is the accumulated result, and is provided as an argument in the next\ncall to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Int8Array.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int8Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order.\nThe return value of the callback function is the accumulated result, and is provided as an\nargument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Int8Array.prototype.reverse",
          "kind": "function",
          "signature": "(): Int8Array<TArrayBuffer>",
          "overloads": [
            "(): Int8Array<TArrayBuffer>"
          ],
          "type": "() => Int8Array<TArrayBuffer>",
          "description": "Reverses the elements in an Array."
        },
        {
          "name": "set",
          "path": "Int8Array.prototype.set",
          "kind": "function",
          "signature": "(array: ArrayLike<number>, offset?: number): void",
          "overloads": [
            "(array: ArrayLike<number>, offset?: number): void"
          ],
          "type": "(array: ArrayLike<number>, offset?: number) => void",
          "description": "Sets a value or an array of values."
        },
        {
          "name": "slice",
          "path": "Int8Array.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): Int8Array<ArrayBuffer>",
          "overloads": [
            "(start?: number, end?: number): Int8Array<ArrayBuffer>"
          ],
          "type": "(start?: number, end?: number) => Int8Array<ArrayBuffer>",
          "description": "Returns a section of an array."
        },
        {
          "name": "some",
          "path": "Int8Array.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Int8Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Int8Array.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Int8Array<TArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Int8Array<TArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Int8Array<TArrayBuffer>",
          "description": "Sorts an array."
        },
        {
          "name": "subarray",
          "path": "Int8Array.prototype.subarray",
          "kind": "function",
          "signature": "(begin?: number, end?: number): Int8Array<TArrayBuffer>",
          "overloads": [
            "(begin?: number, end?: number): Int8Array<TArrayBuffer>"
          ],
          "type": "(begin?: number, end?: number) => Int8Array<TArrayBuffer>",
          "description": "Gets a new Int8Array view of the ArrayBuffer store for this array, referencing the elements\nat begin, inclusive, up to end, exclusive."
        },
        {
          "name": "toLocaleString",
          "path": "Int8Array.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales: string | string[], options?: NumberFormatOptions): string"
          ],
          "type": "{ (): string; (locales: string | string[], options?: Intl.NumberFormatOptions): string; }",
          "description": "Converts a number to a string by using the current locale."
        },
        {
          "name": "toReversed",
          "path": "Int8Array.prototype.toReversed",
          "kind": "function",
          "signature": "(): Int8Array<ArrayBuffer>",
          "overloads": [
            "(): Int8Array<ArrayBuffer>"
          ],
          "type": "() => Int8Array<ArrayBuffer>",
          "description": "Copies the array and returns the copy with the elements in reverse order."
        },
        {
          "name": "toSorted",
          "path": "Int8Array.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Int8Array<ArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Int8Array<ArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Int8Array<ArrayBuffer>",
          "description": "Copies and sorts the array."
        },
        {
          "name": "toString",
          "path": "Int8Array.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "valueOf",
          "path": "Int8Array.prototype.valueOf",
          "kind": "function",
          "signature": "(): Int8Array<TArrayBuffer>",
          "overloads": [
            "(): Int8Array<TArrayBuffer>"
          ],
          "type": "() => Int8Array<TArrayBuffer>",
          "description": "Returns the primitive value of the specified object."
        },
        {
          "name": "values",
          "path": "Int8Array.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of values in the array"
        },
        {
          "name": "with",
          "path": "Int8Array.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: number): Int8Array<ArrayBuffer>",
          "overloads": [
            "(index: number, value: number): Int8Array<ArrayBuffer>"
          ],
          "type": "(index: number, value: number) => Int8Array<ArrayBuffer>",
          "description": "Copies the array and inserts the given number at the provided index."
        }
      ]
    },
    "Int16Array": {
      "static": [
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Int16Array.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "from",
          "path": "Int16Array.from",
          "kind": "function",
          "signature": "(arrayLike: ArrayLike<number>): Int16Array<ArrayBuffer>",
          "overloads": [
            "(arrayLike: ArrayLike<number>): Int16Array<ArrayBuffer>",
            "<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Int16Array<ArrayBuffer>",
            "(elements: Iterable<number>): Int16Array<ArrayBuffer>",
            "<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Int16Array<ArrayBuffer>"
          ],
          "type": "{ (arrayLike: ArrayLike<number>): Int16Array<ArrayBuffer>; <T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Int16Array<ArrayBuffer>; (elements: Iterable<number>): Int16Array<ArrayBuffer>; <T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Int16Array<ArrayBuffer>; }",
          "description": "Creates an array from an array-like or iterable object."
        },
        {
          "name": "of",
          "path": "Int16Array.of",
          "kind": "function",
          "signature": "(...items: number[]): Int16Array<ArrayBuffer>",
          "overloads": [
            "(...items: number[]): Int16Array<ArrayBuffer>"
          ],
          "type": "(...items: number[]) => Int16Array<ArrayBuffer>",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Int16Array.prototype.at",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "buffer",
          "path": "Int16Array.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": "The ArrayBuffer instance referenced by the array."
        },
        {
          "name": "byteLength",
          "path": "Int16Array.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The length in bytes of the array."
        },
        {
          "name": "byteOffset",
          "path": "Int16Array.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The offset in bytes of the array."
        },
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Int16Array.prototype.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "copyWithin",
          "path": "Int16Array.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): Int16Array<TArrayBuffer>",
          "overloads": [
            "(target: number, start: number, end?: number): Int16Array<TArrayBuffer>"
          ],
          "type": "(target: number, start: number, end?: number) => Int16Array<TArrayBuffer>",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Int16Array.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, number]>",
          "overloads": [
            "(): ArrayIterator<[number, number]>"
          ],
          "type": "() => ArrayIterator<[number, number]>",
          "description": "Returns an array of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Int16Array.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Int16Array.prototype.fill",
          "kind": "function",
          "signature": "(value: number, start?: number, end?: number): Int16Array<TArrayBuffer>",
          "overloads": [
            "(value: number, start?: number, end?: number): Int16Array<TArrayBuffer>"
          ],
          "type": "(value: number, start?: number, end?: number) => Int16Array<TArrayBuffer>",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Int16Array.prototype.filter",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => any, thisArg?: any): Int16Array<ArrayBuffer>",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => any, thisArg?: any): Int16Array<ArrayBuffer>"
          ],
          "type": "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => any, thisArg?: any) => Int16Array<ArrayBuffer>",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Int16Array.prototype.find",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Int16Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Int16Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Int16Array<TArrayBuffer>) => boolean, thisArg?: any) => number | undefined",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Int16Array.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Int16Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Int16Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Int16Array<TArrayBuffer>) => boolean, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Int16Array.prototype.findLast",
          "kind": "function",
          "signature": "<S extends number>(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends number>(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => value is S, thisArg?: any): S",
            "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "{ <S extends number>(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => value is S, thisArg?: any): S; (predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any): number | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Int16Array.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "forEach",
          "path": "Int16Array.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Int16Array<TArrayBuffer>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Int16Array<TArrayBuffer>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Int16Array<TArrayBuffer>) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Int16Array.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: number, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: number, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Int16Array.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array."
        },
        {
          "name": "join",
          "path": "Int16Array.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Int16Array.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Int16Array.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a value in an array."
        },
        {
          "name": "map",
          "path": "Int16Array.prototype.map",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Int16Array<TArrayBuffer>) => number, thisArg?: any): Int16Array<ArrayBuffer>",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Int16Array<TArrayBuffer>) => number, thisArg?: any): Int16Array<ArrayBuffer>"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Int16Array<TArrayBuffer>) => number, thisArg?: any) => Int16Array<ArrayBuffer>",
          "description": "Calls a defined callback function on each element of an array, and returns an array that\ncontains the results."
        },
        {
          "name": "reduce",
          "path": "Int16Array.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of\nthe callback function is the accumulated result, and is provided as an argument in the next\ncall to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Int16Array.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int16Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order.\nThe return value of the callback function is the accumulated result, and is provided as an\nargument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Int16Array.prototype.reverse",
          "kind": "function",
          "signature": "(): Int16Array<TArrayBuffer>",
          "overloads": [
            "(): Int16Array<TArrayBuffer>"
          ],
          "type": "() => Int16Array<TArrayBuffer>",
          "description": "Reverses the elements in an Array."
        },
        {
          "name": "set",
          "path": "Int16Array.prototype.set",
          "kind": "function",
          "signature": "(array: ArrayLike<number>, offset?: number): void",
          "overloads": [
            "(array: ArrayLike<number>, offset?: number): void"
          ],
          "type": "(array: ArrayLike<number>, offset?: number) => void",
          "description": "Sets a value or an array of values."
        },
        {
          "name": "slice",
          "path": "Int16Array.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): Int16Array<ArrayBuffer>",
          "overloads": [
            "(start?: number, end?: number): Int16Array<ArrayBuffer>"
          ],
          "type": "(start?: number, end?: number) => Int16Array<ArrayBuffer>",
          "description": "Returns a section of an array."
        },
        {
          "name": "some",
          "path": "Int16Array.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Int16Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Int16Array.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Int16Array<TArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Int16Array<TArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Int16Array<TArrayBuffer>",
          "description": "Sorts an array."
        },
        {
          "name": "subarray",
          "path": "Int16Array.prototype.subarray",
          "kind": "function",
          "signature": "(begin?: number, end?: number): Int16Array<TArrayBuffer>",
          "overloads": [
            "(begin?: number, end?: number): Int16Array<TArrayBuffer>"
          ],
          "type": "(begin?: number, end?: number) => Int16Array<TArrayBuffer>",
          "description": "Gets a new Int16Array view of the ArrayBuffer store for this array, referencing the elements\nat begin, inclusive, up to end, exclusive."
        },
        {
          "name": "toLocaleString",
          "path": "Int16Array.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales: string | string[], options?: NumberFormatOptions): string"
          ],
          "type": "{ (): string; (locales: string | string[], options?: Intl.NumberFormatOptions): string; }",
          "description": "Converts a number to a string by using the current locale."
        },
        {
          "name": "toReversed",
          "path": "Int16Array.prototype.toReversed",
          "kind": "function",
          "signature": "(): Int16Array<ArrayBuffer>",
          "overloads": [
            "(): Int16Array<ArrayBuffer>"
          ],
          "type": "() => Int16Array<ArrayBuffer>",
          "description": "Copies the array and returns the copy with the elements in reverse order."
        },
        {
          "name": "toSorted",
          "path": "Int16Array.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Int16Array<ArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Int16Array<ArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Int16Array<ArrayBuffer>",
          "description": "Copies and sorts the array."
        },
        {
          "name": "toString",
          "path": "Int16Array.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "valueOf",
          "path": "Int16Array.prototype.valueOf",
          "kind": "function",
          "signature": "(): Int16Array<TArrayBuffer>",
          "overloads": [
            "(): Int16Array<TArrayBuffer>"
          ],
          "type": "() => Int16Array<TArrayBuffer>",
          "description": "Returns the primitive value of the specified object."
        },
        {
          "name": "values",
          "path": "Int16Array.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of values in the array"
        },
        {
          "name": "with",
          "path": "Int16Array.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: number): Int16Array<ArrayBuffer>",
          "overloads": [
            "(index: number, value: number): Int16Array<ArrayBuffer>"
          ],
          "type": "(index: number, value: number) => Int16Array<ArrayBuffer>",
          "description": "Copies the array and inserts the given number at the provided index."
        }
      ]
    },
    "Int32Array": {
      "static": [
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Int32Array.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "from",
          "path": "Int32Array.from",
          "kind": "function",
          "signature": "(arrayLike: ArrayLike<number>): Int32Array<ArrayBuffer>",
          "overloads": [
            "(arrayLike: ArrayLike<number>): Int32Array<ArrayBuffer>",
            "<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Int32Array<ArrayBuffer>",
            "(elements: Iterable<number>): Int32Array<ArrayBuffer>",
            "<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Int32Array<ArrayBuffer>"
          ],
          "type": "{ (arrayLike: ArrayLike<number>): Int32Array<ArrayBuffer>; <T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Int32Array<ArrayBuffer>; (elements: Iterable<number>): Int32Array<ArrayBuffer>; <T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Int32Array<ArrayBuffer>; }",
          "description": "Creates an array from an array-like or iterable object."
        },
        {
          "name": "of",
          "path": "Int32Array.of",
          "kind": "function",
          "signature": "(...items: number[]): Int32Array<ArrayBuffer>",
          "overloads": [
            "(...items: number[]): Int32Array<ArrayBuffer>"
          ],
          "type": "(...items: number[]) => Int32Array<ArrayBuffer>",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Int32Array.prototype.at",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "buffer",
          "path": "Int32Array.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": "The ArrayBuffer instance referenced by the array."
        },
        {
          "name": "byteLength",
          "path": "Int32Array.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The length in bytes of the array."
        },
        {
          "name": "byteOffset",
          "path": "Int32Array.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The offset in bytes of the array."
        },
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Int32Array.prototype.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "copyWithin",
          "path": "Int32Array.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): Int32Array<TArrayBuffer>",
          "overloads": [
            "(target: number, start: number, end?: number): Int32Array<TArrayBuffer>"
          ],
          "type": "(target: number, start: number, end?: number) => Int32Array<TArrayBuffer>",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Int32Array.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, number]>",
          "overloads": [
            "(): ArrayIterator<[number, number]>"
          ],
          "type": "() => ArrayIterator<[number, number]>",
          "description": "Returns an array of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Int32Array.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Int32Array.prototype.fill",
          "kind": "function",
          "signature": "(value: number, start?: number, end?: number): Int32Array<TArrayBuffer>",
          "overloads": [
            "(value: number, start?: number, end?: number): Int32Array<TArrayBuffer>"
          ],
          "type": "(value: number, start?: number, end?: number) => Int32Array<TArrayBuffer>",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Int32Array.prototype.filter",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => any, thisArg?: any): Int32Array<ArrayBuffer>",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => any, thisArg?: any): Int32Array<ArrayBuffer>"
          ],
          "type": "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => any, thisArg?: any) => Int32Array<ArrayBuffer>",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Int32Array.prototype.find",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Int32Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Int32Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Int32Array<TArrayBuffer>) => boolean, thisArg?: any) => number | undefined",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Int32Array.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Int32Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Int32Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Int32Array<TArrayBuffer>) => boolean, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Int32Array.prototype.findLast",
          "kind": "function",
          "signature": "<S extends number>(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends number>(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => value is S, thisArg?: any): S",
            "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "{ <S extends number>(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => value is S, thisArg?: any): S; (predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any): number | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Int32Array.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "forEach",
          "path": "Int32Array.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Int32Array<TArrayBuffer>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Int32Array<TArrayBuffer>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Int32Array<TArrayBuffer>) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Int32Array.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: number, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: number, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Int32Array.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array."
        },
        {
          "name": "join",
          "path": "Int32Array.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Int32Array.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Int32Array.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a value in an array."
        },
        {
          "name": "map",
          "path": "Int32Array.prototype.map",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Int32Array<TArrayBuffer>) => number, thisArg?: any): Int32Array<ArrayBuffer>",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Int32Array<TArrayBuffer>) => number, thisArg?: any): Int32Array<ArrayBuffer>"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Int32Array<TArrayBuffer>) => number, thisArg?: any) => Int32Array<ArrayBuffer>",
          "description": "Calls a defined callback function on each element of an array, and returns an array that\ncontains the results."
        },
        {
          "name": "reduce",
          "path": "Int32Array.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of\nthe callback function is the accumulated result, and is provided as an argument in the next\ncall to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Int32Array.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Int32Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order.\nThe return value of the callback function is the accumulated result, and is provided as an\nargument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Int32Array.prototype.reverse",
          "kind": "function",
          "signature": "(): Int32Array<TArrayBuffer>",
          "overloads": [
            "(): Int32Array<TArrayBuffer>"
          ],
          "type": "() => Int32Array<TArrayBuffer>",
          "description": "Reverses the elements in an Array."
        },
        {
          "name": "set",
          "path": "Int32Array.prototype.set",
          "kind": "function",
          "signature": "(array: ArrayLike<number>, offset?: number): void",
          "overloads": [
            "(array: ArrayLike<number>, offset?: number): void"
          ],
          "type": "(array: ArrayLike<number>, offset?: number) => void",
          "description": "Sets a value or an array of values."
        },
        {
          "name": "slice",
          "path": "Int32Array.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): Int32Array<ArrayBuffer>",
          "overloads": [
            "(start?: number, end?: number): Int32Array<ArrayBuffer>"
          ],
          "type": "(start?: number, end?: number) => Int32Array<ArrayBuffer>",
          "description": "Returns a section of an array."
        },
        {
          "name": "some",
          "path": "Int32Array.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Int32Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Int32Array.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Int32Array<TArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Int32Array<TArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Int32Array<TArrayBuffer>",
          "description": "Sorts an array."
        },
        {
          "name": "subarray",
          "path": "Int32Array.prototype.subarray",
          "kind": "function",
          "signature": "(begin?: number, end?: number): Int32Array<TArrayBuffer>",
          "overloads": [
            "(begin?: number, end?: number): Int32Array<TArrayBuffer>"
          ],
          "type": "(begin?: number, end?: number) => Int32Array<TArrayBuffer>",
          "description": "Gets a new Int32Array view of the ArrayBuffer store for this array, referencing the elements\nat begin, inclusive, up to end, exclusive."
        },
        {
          "name": "toLocaleString",
          "path": "Int32Array.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales: string | string[], options?: NumberFormatOptions): string"
          ],
          "type": "{ (): string; (locales: string | string[], options?: Intl.NumberFormatOptions): string; }",
          "description": "Converts a number to a string by using the current locale."
        },
        {
          "name": "toReversed",
          "path": "Int32Array.prototype.toReversed",
          "kind": "function",
          "signature": "(): Int32Array<ArrayBuffer>",
          "overloads": [
            "(): Int32Array<ArrayBuffer>"
          ],
          "type": "() => Int32Array<ArrayBuffer>",
          "description": "Copies the array and returns the copy with the elements in reverse order."
        },
        {
          "name": "toSorted",
          "path": "Int32Array.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Int32Array<ArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Int32Array<ArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Int32Array<ArrayBuffer>",
          "description": "Copies and sorts the array."
        },
        {
          "name": "toString",
          "path": "Int32Array.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "valueOf",
          "path": "Int32Array.prototype.valueOf",
          "kind": "function",
          "signature": "(): Int32Array<TArrayBuffer>",
          "overloads": [
            "(): Int32Array<TArrayBuffer>"
          ],
          "type": "() => Int32Array<TArrayBuffer>",
          "description": "Returns the primitive value of the specified object."
        },
        {
          "name": "values",
          "path": "Int32Array.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of values in the array"
        },
        {
          "name": "with",
          "path": "Int32Array.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: number): Int32Array<ArrayBuffer>",
          "overloads": [
            "(index: number, value: number): Int32Array<ArrayBuffer>"
          ],
          "type": "(index: number, value: number) => Int32Array<ArrayBuffer>",
          "description": "Copies the array and inserts the given number at the provided index."
        }
      ]
    },
    "JSON": {
      "static": [
        {
          "name": "parse",
          "path": "JSON.parse",
          "kind": "function",
          "signature": "(text: string, reviver?: (this: any, key: string, value: any) => any): any",
          "overloads": [
            "(text: string, reviver?: (this: any, key: string, value: any) => any): any"
          ],
          "type": "(text: string, reviver?: (this: any, key: string, value: any) => any) => any",
          "description": "Converts a JavaScript Object Notation (JSON) string into an object."
        },
        {
          "name": "stringify",
          "path": "JSON.stringify",
          "kind": "function",
          "signature": "(value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string",
          "overloads": [
            "(value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string",
            "(value: any, replacer?: (string | number)[], space?: string | number): string"
          ],
          "type": "{ (value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string; (value: any, replacer?: (number | string)[] | null, space?: string | number): string; }",
          "description": "Converts a JavaScript value to a JavaScript Object Notation (JSON) string."
        }
      ],
      "instance": [
        {
          "name": "parse",
          "path": "JSON.prototype.parse",
          "kind": "function",
          "signature": "(text: string, reviver?: (this: any, key: string, value: any) => any): any",
          "overloads": [
            "(text: string, reviver?: (this: any, key: string, value: any) => any): any"
          ],
          "type": "(text: string, reviver?: (this: any, key: string, value: any) => any) => any",
          "description": "Converts a JavaScript Object Notation (JSON) string into an object."
        },
        {
          "name": "stringify",
          "path": "JSON.prototype.stringify",
          "kind": "function",
          "signature": "(value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string",
          "overloads": [
            "(value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string",
            "(value: any, replacer?: (string | number)[], space?: string | number): string"
          ],
          "type": "{ (value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string; (value: any, replacer?: (number | string)[] | null, space?: string | number): string; }",
          "description": "Converts a JavaScript value to a JavaScript Object Notation (JSON) string."
        }
      ]
    },
    "Map": {
      "static": [
        {
          "name": "groupBy",
          "path": "Map.groupBy",
          "kind": "function",
          "signature": "<K, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K): Map<K, T[]>",
          "overloads": [
            "<K, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K): Map<K, T[]>"
          ],
          "type": "<K, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K) => Map<K, T[]>",
          "description": "Groups members of an iterable according to the return value of the passed callback."
        }
      ],
      "instance": [
        {
          "name": "clear",
          "path": "Map.prototype.clear",
          "kind": "function",
          "signature": "(): void",
          "overloads": [
            "(): void"
          ],
          "type": "() => void",
          "description": ""
        },
        {
          "name": "delete",
          "path": "Map.prototype.delete",
          "kind": "function",
          "signature": "(key: K): boolean",
          "overloads": [
            "(key: K): boolean"
          ],
          "type": "(key: K) => boolean",
          "description": ""
        },
        {
          "name": "entries",
          "path": "Map.prototype.entries",
          "kind": "function",
          "signature": "(): MapIterator<[K, V]>",
          "overloads": [
            "(): MapIterator<[K, V]>"
          ],
          "type": "() => MapIterator<[K, V]>",
          "description": "Returns an iterable of key, value pairs for every entry in the map."
        },
        {
          "name": "forEach",
          "path": "Map.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any) => void",
          "description": "Executes a provided function once per each key/value pair in the Map, in insertion order."
        },
        {
          "name": "get",
          "path": "Map.prototype.get",
          "kind": "function",
          "signature": "(key: K): V",
          "overloads": [
            "(key: K): V"
          ],
          "type": "(key: K) => V | undefined",
          "description": "Returns a specified element from the Map object. If the value that is associated to the provided key is an object, then you will get a reference to that object and any change made to that object will effectively modify it inside the Map."
        },
        {
          "name": "has",
          "path": "Map.prototype.has",
          "kind": "function",
          "signature": "(key: K): boolean",
          "overloads": [
            "(key: K): boolean"
          ],
          "type": "(key: K) => boolean",
          "description": ""
        },
        {
          "name": "keys",
          "path": "Map.prototype.keys",
          "kind": "function",
          "signature": "(): MapIterator<K>",
          "overloads": [
            "(): MapIterator<K>"
          ],
          "type": "() => MapIterator<K>",
          "description": "Returns an iterable of keys in the map"
        },
        {
          "name": "set",
          "path": "Map.prototype.set",
          "kind": "function",
          "signature": "(key: K, value: V): Map<K, V>",
          "overloads": [
            "(key: K, value: V): Map<K, V>"
          ],
          "type": "(key: K, value: V) => Map<K, V>",
          "description": "Adds a new element with a specified key and value to the Map. If an element with the same key already exists, the element will be updated."
        },
        {
          "name": "size",
          "path": "Map.prototype.size",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": ""
        },
        {
          "name": "values",
          "path": "Map.prototype.values",
          "kind": "function",
          "signature": "(): MapIterator<V>",
          "overloads": [
            "(): MapIterator<V>"
          ],
          "type": "() => MapIterator<V>",
          "description": "Returns an iterable of values in the map"
        }
      ]
    },
    "Math": {
      "static": [
        {
          "name": "abs",
          "path": "Math.abs",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the absolute value of a number (the value without regard to whether it is positive or negative).\nFor example, the absolute value of -5 is the same as the absolute value of 5."
        },
        {
          "name": "acos",
          "path": "Math.acos",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the arc cosine (or inverse cosine) of a number."
        },
        {
          "name": "acosh",
          "path": "Math.acosh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the inverse hyperbolic cosine of a number."
        },
        {
          "name": "asin",
          "path": "Math.asin",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the arcsine of a number."
        },
        {
          "name": "asinh",
          "path": "Math.asinh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the inverse hyperbolic sine of a number."
        },
        {
          "name": "atan",
          "path": "Math.atan",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the arctangent of a number."
        },
        {
          "name": "atan2",
          "path": "Math.atan2",
          "kind": "function",
          "signature": "(y: number, x: number): number",
          "overloads": [
            "(y: number, x: number): number"
          ],
          "type": "(y: number, x: number) => number",
          "description": "Returns the angle (in radians) between the X axis and the line going through both the origin and the given point."
        },
        {
          "name": "atanh",
          "path": "Math.atanh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the inverse hyperbolic tangent of a number."
        },
        {
          "name": "cbrt",
          "path": "Math.cbrt",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns an implementation-dependent approximation to the cube root of number."
        },
        {
          "name": "ceil",
          "path": "Math.ceil",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the smallest integer greater than or equal to its numeric argument."
        },
        {
          "name": "clz32",
          "path": "Math.clz32",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the number of leading zero bits in the 32-bit binary representation of a number."
        },
        {
          "name": "cos",
          "path": "Math.cos",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the cosine of a number."
        },
        {
          "name": "cosh",
          "path": "Math.cosh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the hyperbolic cosine of a number."
        },
        {
          "name": "E",
          "path": "Math.E",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The mathematical constant e. This is Euler's number, the base of natural logarithms."
        },
        {
          "name": "exp",
          "path": "Math.exp",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns e (the base of natural logarithms) raised to a power."
        },
        {
          "name": "expm1",
          "path": "Math.expm1",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the result of (e^x - 1), which is an implementation-dependent approximation to\nsubtracting 1 from the exponential function of x (e raised to the power of x, where e\nis the base of the natural logarithms)."
        },
        {
          "name": "f16round",
          "path": "Math.f16round",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the nearest half precision float representation of a number."
        },
        {
          "name": "floor",
          "path": "Math.floor",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the greatest integer less than or equal to its numeric argument."
        },
        {
          "name": "fround",
          "path": "Math.fround",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the nearest single precision float representation of a number."
        },
        {
          "name": "hypot",
          "path": "Math.hypot",
          "kind": "function",
          "signature": "(...values: number[]): number",
          "overloads": [
            "(...values: number[]): number"
          ],
          "type": "(...values: number[]) => number",
          "description": "Returns the square root of the sum of squares of its arguments."
        },
        {
          "name": "imul",
          "path": "Math.imul",
          "kind": "function",
          "signature": "(x: number, y: number): number",
          "overloads": [
            "(x: number, y: number): number"
          ],
          "type": "(x: number, y: number) => number",
          "description": "Returns the result of 32-bit multiplication of two numbers."
        },
        {
          "name": "LN10",
          "path": "Math.LN10",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The natural logarithm of 10."
        },
        {
          "name": "LN2",
          "path": "Math.LN2",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The natural logarithm of 2."
        },
        {
          "name": "log",
          "path": "Math.log",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the natural logarithm (base e) of a number."
        },
        {
          "name": "log10",
          "path": "Math.log10",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the base 10 logarithm of a number."
        },
        {
          "name": "LOG10E",
          "path": "Math.LOG10E",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The base-10 logarithm of e."
        },
        {
          "name": "log1p",
          "path": "Math.log1p",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the natural logarithm of 1 + x."
        },
        {
          "name": "log2",
          "path": "Math.log2",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the base 2 logarithm of a number."
        },
        {
          "name": "LOG2E",
          "path": "Math.LOG2E",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The base-2 logarithm of e."
        },
        {
          "name": "max",
          "path": "Math.max",
          "kind": "function",
          "signature": "(...values: number[]): number",
          "overloads": [
            "(...values: number[]): number"
          ],
          "type": "(...values: number[]) => number",
          "description": "Returns the larger of a set of supplied numeric expressions."
        },
        {
          "name": "min",
          "path": "Math.min",
          "kind": "function",
          "signature": "(...values: number[]): number",
          "overloads": [
            "(...values: number[]): number"
          ],
          "type": "(...values: number[]) => number",
          "description": "Returns the smaller of a set of supplied numeric expressions."
        },
        {
          "name": "PI",
          "path": "Math.PI",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "Pi. This is the ratio of the circumference of a circle to its diameter."
        },
        {
          "name": "pow",
          "path": "Math.pow",
          "kind": "function",
          "signature": "(x: number, y: number): number",
          "overloads": [
            "(x: number, y: number): number"
          ],
          "type": "(x: number, y: number) => number",
          "description": "Returns the value of a base expression taken to a specified power."
        },
        {
          "name": "random",
          "path": "Math.random",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Returns a pseudorandom number between 0 and 1."
        },
        {
          "name": "round",
          "path": "Math.round",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns a supplied numeric expression rounded to the nearest integer."
        },
        {
          "name": "sign",
          "path": "Math.sign",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the sign of the x, indicating whether x is positive, negative or zero."
        },
        {
          "name": "sin",
          "path": "Math.sin",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the sine of a number."
        },
        {
          "name": "sinh",
          "path": "Math.sinh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the hyperbolic sine of a number."
        },
        {
          "name": "sqrt",
          "path": "Math.sqrt",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the square root of a number."
        },
        {
          "name": "SQRT1_2",
          "path": "Math.SQRT1_2",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The square root of 0.5, or, equivalently, one divided by the square root of 2."
        },
        {
          "name": "SQRT2",
          "path": "Math.SQRT2",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The square root of 2."
        },
        {
          "name": "tan",
          "path": "Math.tan",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the tangent of a number."
        },
        {
          "name": "tanh",
          "path": "Math.tanh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the hyperbolic tangent of a number."
        },
        {
          "name": "trunc",
          "path": "Math.trunc",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the integral part of the a numeric expression, x, removing any fractional digits.\nIf x is already an integer, the result is x."
        }
      ],
      "instance": [
        {
          "name": "abs",
          "path": "Math.prototype.abs",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the absolute value of a number (the value without regard to whether it is positive or negative).\nFor example, the absolute value of -5 is the same as the absolute value of 5."
        },
        {
          "name": "acos",
          "path": "Math.prototype.acos",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the arc cosine (or inverse cosine) of a number."
        },
        {
          "name": "acosh",
          "path": "Math.prototype.acosh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the inverse hyperbolic cosine of a number."
        },
        {
          "name": "asin",
          "path": "Math.prototype.asin",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the arcsine of a number."
        },
        {
          "name": "asinh",
          "path": "Math.prototype.asinh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the inverse hyperbolic sine of a number."
        },
        {
          "name": "atan",
          "path": "Math.prototype.atan",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the arctangent of a number."
        },
        {
          "name": "atan2",
          "path": "Math.prototype.atan2",
          "kind": "function",
          "signature": "(y: number, x: number): number",
          "overloads": [
            "(y: number, x: number): number"
          ],
          "type": "(y: number, x: number) => number",
          "description": "Returns the angle (in radians) between the X axis and the line going through both the origin and the given point."
        },
        {
          "name": "atanh",
          "path": "Math.prototype.atanh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the inverse hyperbolic tangent of a number."
        },
        {
          "name": "cbrt",
          "path": "Math.prototype.cbrt",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns an implementation-dependent approximation to the cube root of number."
        },
        {
          "name": "ceil",
          "path": "Math.prototype.ceil",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the smallest integer greater than or equal to its numeric argument."
        },
        {
          "name": "clz32",
          "path": "Math.prototype.clz32",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the number of leading zero bits in the 32-bit binary representation of a number."
        },
        {
          "name": "cos",
          "path": "Math.prototype.cos",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the cosine of a number."
        },
        {
          "name": "cosh",
          "path": "Math.prototype.cosh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the hyperbolic cosine of a number."
        },
        {
          "name": "E",
          "path": "Math.prototype.E",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The mathematical constant e. This is Euler's number, the base of natural logarithms."
        },
        {
          "name": "exp",
          "path": "Math.prototype.exp",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns e (the base of natural logarithms) raised to a power."
        },
        {
          "name": "expm1",
          "path": "Math.prototype.expm1",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the result of (e^x - 1), which is an implementation-dependent approximation to\nsubtracting 1 from the exponential function of x (e raised to the power of x, where e\nis the base of the natural logarithms)."
        },
        {
          "name": "f16round",
          "path": "Math.prototype.f16round",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the nearest half precision float representation of a number."
        },
        {
          "name": "floor",
          "path": "Math.prototype.floor",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the greatest integer less than or equal to its numeric argument."
        },
        {
          "name": "fround",
          "path": "Math.prototype.fround",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the nearest single precision float representation of a number."
        },
        {
          "name": "hypot",
          "path": "Math.prototype.hypot",
          "kind": "function",
          "signature": "(...values: number[]): number",
          "overloads": [
            "(...values: number[]): number"
          ],
          "type": "(...values: number[]) => number",
          "description": "Returns the square root of the sum of squares of its arguments."
        },
        {
          "name": "imul",
          "path": "Math.prototype.imul",
          "kind": "function",
          "signature": "(x: number, y: number): number",
          "overloads": [
            "(x: number, y: number): number"
          ],
          "type": "(x: number, y: number) => number",
          "description": "Returns the result of 32-bit multiplication of two numbers."
        },
        {
          "name": "LN10",
          "path": "Math.prototype.LN10",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The natural logarithm of 10."
        },
        {
          "name": "LN2",
          "path": "Math.prototype.LN2",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The natural logarithm of 2."
        },
        {
          "name": "log",
          "path": "Math.prototype.log",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the natural logarithm (base e) of a number."
        },
        {
          "name": "log10",
          "path": "Math.prototype.log10",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the base 10 logarithm of a number."
        },
        {
          "name": "LOG10E",
          "path": "Math.prototype.LOG10E",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The base-10 logarithm of e."
        },
        {
          "name": "log1p",
          "path": "Math.prototype.log1p",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the natural logarithm of 1 + x."
        },
        {
          "name": "log2",
          "path": "Math.prototype.log2",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the base 2 logarithm of a number."
        },
        {
          "name": "LOG2E",
          "path": "Math.prototype.LOG2E",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The base-2 logarithm of e."
        },
        {
          "name": "max",
          "path": "Math.prototype.max",
          "kind": "function",
          "signature": "(...values: number[]): number",
          "overloads": [
            "(...values: number[]): number"
          ],
          "type": "(...values: number[]) => number",
          "description": "Returns the larger of a set of supplied numeric expressions."
        },
        {
          "name": "min",
          "path": "Math.prototype.min",
          "kind": "function",
          "signature": "(...values: number[]): number",
          "overloads": [
            "(...values: number[]): number"
          ],
          "type": "(...values: number[]) => number",
          "description": "Returns the smaller of a set of supplied numeric expressions."
        },
        {
          "name": "PI",
          "path": "Math.prototype.PI",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "Pi. This is the ratio of the circumference of a circle to its diameter."
        },
        {
          "name": "pow",
          "path": "Math.prototype.pow",
          "kind": "function",
          "signature": "(x: number, y: number): number",
          "overloads": [
            "(x: number, y: number): number"
          ],
          "type": "(x: number, y: number) => number",
          "description": "Returns the value of a base expression taken to a specified power."
        },
        {
          "name": "random",
          "path": "Math.prototype.random",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Returns a pseudorandom number between 0 and 1."
        },
        {
          "name": "round",
          "path": "Math.prototype.round",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns a supplied numeric expression rounded to the nearest integer."
        },
        {
          "name": "sign",
          "path": "Math.prototype.sign",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the sign of the x, indicating whether x is positive, negative or zero."
        },
        {
          "name": "sin",
          "path": "Math.prototype.sin",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the sine of a number."
        },
        {
          "name": "sinh",
          "path": "Math.prototype.sinh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the hyperbolic sine of a number."
        },
        {
          "name": "sqrt",
          "path": "Math.prototype.sqrt",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the square root of a number."
        },
        {
          "name": "SQRT1_2",
          "path": "Math.prototype.SQRT1_2",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The square root of 0.5, or, equivalently, one divided by the square root of 2."
        },
        {
          "name": "SQRT2",
          "path": "Math.prototype.SQRT2",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The square root of 2."
        },
        {
          "name": "tan",
          "path": "Math.prototype.tan",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the tangent of a number."
        },
        {
          "name": "tanh",
          "path": "Math.prototype.tanh",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the hyperbolic tangent of a number."
        },
        {
          "name": "trunc",
          "path": "Math.prototype.trunc",
          "kind": "function",
          "signature": "(x: number): number",
          "overloads": [
            "(x: number): number"
          ],
          "type": "(x: number) => number",
          "description": "Returns the integral part of the a numeric expression, x, removing any fractional digits.\nIf x is already an integer, the result is x."
        }
      ]
    },
    "Number": {
      "static": [
        {
          "name": "EPSILON",
          "path": "Number.EPSILON",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The value of Number.EPSILON is the difference between 1 and the smallest value greater than 1\nthat is representable as a Number value, which is approximately:\n2.2204460492503130808472633361816 x 10‍−‍16."
        },
        {
          "name": "isFinite",
          "path": "Number.isFinite",
          "kind": "function",
          "signature": "(number: unknown): boolean",
          "overloads": [
            "(number: unknown): boolean"
          ],
          "type": "(number: unknown) => boolean",
          "description": "Returns true if passed value is finite.\nUnlike the global isFinite, Number.isFinite doesn't forcibly convert the parameter to a\nnumber. Only finite values of the type number, result in true."
        },
        {
          "name": "isInteger",
          "path": "Number.isInteger",
          "kind": "function",
          "signature": "(number: unknown): boolean",
          "overloads": [
            "(number: unknown): boolean"
          ],
          "type": "(number: unknown) => boolean",
          "description": "Returns true if the value passed is an integer, false otherwise."
        },
        {
          "name": "isNaN",
          "path": "Number.isNaN",
          "kind": "function",
          "signature": "(number: unknown): boolean",
          "overloads": [
            "(number: unknown): boolean"
          ],
          "type": "(number: unknown) => boolean",
          "description": "Returns a Boolean value that indicates whether a value is the reserved value NaN (not a\nnumber). Unlike the global isNaN(), Number.isNaN() doesn't forcefully convert the parameter\nto a number. Only values of the type number, that are also NaN, result in true."
        },
        {
          "name": "isSafeInteger",
          "path": "Number.isSafeInteger",
          "kind": "function",
          "signature": "(number: unknown): boolean",
          "overloads": [
            "(number: unknown): boolean"
          ],
          "type": "(number: unknown) => boolean",
          "description": "Returns true if the value passed is a safe integer."
        },
        {
          "name": "MAX_SAFE_INTEGER",
          "path": "Number.MAX_SAFE_INTEGER",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The value of the largest integer n such that n and n + 1 are both exactly representable as\na Number value.\nThe value of Number.MAX_SAFE_INTEGER is 9007199254740991 2^53 − 1."
        },
        {
          "name": "MAX_VALUE",
          "path": "Number.MAX_VALUE",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The largest number that can be represented in JavaScript. Equal to approximately 1.79E+308."
        },
        {
          "name": "MIN_SAFE_INTEGER",
          "path": "Number.MIN_SAFE_INTEGER",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The value of the smallest integer n such that n and n − 1 are both exactly representable as\na Number value.\nThe value of Number.MIN_SAFE_INTEGER is −9007199254740991 (−(2^53 − 1))."
        },
        {
          "name": "MIN_VALUE",
          "path": "Number.MIN_VALUE",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The closest number to zero that can be represented in JavaScript. Equal to approximately 5.00E-324."
        },
        {
          "name": "NaN",
          "path": "Number.NaN",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "A value that is not a number.\nIn equality comparisons, NaN does not equal any value, including itself. To test whether a value is equivalent to NaN, use the isNaN function."
        },
        {
          "name": "NEGATIVE_INFINITY",
          "path": "Number.NEGATIVE_INFINITY",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "A value that is less than the largest negative number that can be represented in JavaScript.\nJavaScript displays NEGATIVE_INFINITY values as -infinity."
        },
        {
          "name": "parseFloat",
          "path": "Number.parseFloat",
          "kind": "function",
          "signature": "(string: string): number",
          "overloads": [
            "(string: string): number"
          ],
          "type": "(string: string) => number",
          "description": "Converts a string to a floating-point number."
        },
        {
          "name": "parseInt",
          "path": "Number.parseInt",
          "kind": "function",
          "signature": "(string: string, radix?: number): number",
          "overloads": [
            "(string: string, radix?: number): number"
          ],
          "type": "(string: string, radix?: number) => number",
          "description": "Converts A string to an integer."
        },
        {
          "name": "POSITIVE_INFINITY",
          "path": "Number.POSITIVE_INFINITY",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "A value greater than the largest number that can be represented in JavaScript.\nJavaScript displays POSITIVE_INFINITY values as infinity."
        }
      ],
      "instance": [
        {
          "name": "toExponential",
          "path": "Number.prototype.toExponential",
          "kind": "function",
          "signature": "(fractionDigits?: number): string",
          "overloads": [
            "(fractionDigits?: number): string"
          ],
          "type": "(fractionDigits?: number) => string",
          "description": "Returns a string containing a number represented in exponential notation."
        },
        {
          "name": "toFixed",
          "path": "Number.prototype.toFixed",
          "kind": "function",
          "signature": "(fractionDigits?: number): string",
          "overloads": [
            "(fractionDigits?: number): string"
          ],
          "type": "(fractionDigits?: number) => string",
          "description": "Returns a string representing a number in fixed-point notation."
        },
        {
          "name": "toLocaleString",
          "path": "Number.prototype.toLocaleString",
          "kind": "function",
          "signature": "(locales?: string | string[], options?: NumberFormatOptions): string",
          "overloads": [
            "(locales?: string | string[], options?: NumberFormatOptions): string",
            "(locales?: LocalesArgument, options?: NumberFormatOptions): string"
          ],
          "type": "{ (locales?: string | string[], options?: Intl.NumberFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions): string; }",
          "description": "Converts a number to a string by using the current or specified locale."
        },
        {
          "name": "toPrecision",
          "path": "Number.prototype.toPrecision",
          "kind": "function",
          "signature": "(precision?: number): string",
          "overloads": [
            "(precision?: number): string"
          ],
          "type": "(precision?: number) => string",
          "description": "Returns a string containing a number represented either in exponential or fixed-point notation with a specified number of digits."
        },
        {
          "name": "toString",
          "path": "Number.prototype.toString",
          "kind": "function",
          "signature": "(radix?: number): string",
          "overloads": [
            "(radix?: number): string"
          ],
          "type": "(radix?: number) => string",
          "description": "Returns a string representation of an object."
        },
        {
          "name": "valueOf",
          "path": "Number.prototype.valueOf",
          "kind": "function",
          "signature": "(): number",
          "overloads": [
            "(): number"
          ],
          "type": "() => number",
          "description": "Returns the primitive value of the specified object."
        }
      ]
    },
    "AsyncIteratorObject": {
      "static": [],
      "instance": [
        {
          "name": "next",
          "path": "AsyncIteratorObject.prototype.next",
          "kind": "function",
          "signature": "(...[value]: [] | [TNext]): Promise<IteratorResult<T, TReturn>>",
          "overloads": [
            "(...[value]: [] | [TNext]): Promise<IteratorResult<T, TReturn>>"
          ],
          "type": "(...[value]: [] | [TNext]) => Promise<IteratorResult<T, TReturn>>",
          "description": ""
        },
        {
          "name": "return",
          "path": "AsyncIteratorObject.prototype.return",
          "kind": "function",
          "signature": "(value?: TReturn | PromiseLike<TReturn>): Promise<IteratorResult<T, TReturn>>",
          "overloads": [
            "(value?: TReturn | PromiseLike<TReturn>): Promise<IteratorResult<T, TReturn>>"
          ],
          "type": "(value?: TReturn | PromiseLike<TReturn>) => Promise<IteratorResult<T, TReturn>>",
          "description": ""
        },
        {
          "name": "throw",
          "path": "AsyncIteratorObject.prototype.throw",
          "kind": "function",
          "signature": "(e?: any): Promise<IteratorResult<T, TReturn>>",
          "overloads": [
            "(e?: any): Promise<IteratorResult<T, TReturn>>"
          ],
          "type": "(e?: any) => Promise<IteratorResult<T, TReturn>>",
          "description": ""
        }
      ]
    },
    "Iterator": {
      "static": [
        {
          "name": "from",
          "path": "Iterator.from",
          "kind": "function",
          "signature": "<T>(value: Iterator<T, unknown, undefined> | Iterable<T, unknown, undefined>): IteratorObject<T, undefined, unknown>",
          "overloads": [
            "<T>(value: Iterator<T, unknown, undefined> | Iterable<T, unknown, undefined>): IteratorObject<T, undefined, unknown>"
          ],
          "type": "<T>(value: Iterator<T, unknown, undefined> | Iterable<T, unknown, undefined>) => IteratorObject<T, undefined, unknown>",
          "description": "Creates a native iterator from an iterator or iterable object.\nReturns its input if the input already inherits from the built-in Iterator class."
        }
      ],
      "instance": [
        {
          "name": "next",
          "path": "Iterator.prototype.next",
          "kind": "function",
          "signature": "(...[value]: [] | [TNext]): IteratorResult<T, TReturn>",
          "overloads": [
            "(...[value]: [] | [TNext]): IteratorResult<T, TReturn>"
          ],
          "type": "(...[value]: [] | [TNext]) => IteratorResult<T, TReturn>",
          "description": ""
        },
        {
          "name": "return",
          "path": "Iterator.prototype.return",
          "kind": "function",
          "signature": "(value?: TReturn): IteratorResult<T, TReturn>",
          "overloads": [
            "(value?: TReturn): IteratorResult<T, TReturn>"
          ],
          "type": "(value?: TReturn) => IteratorResult<T, TReturn>",
          "description": ""
        },
        {
          "name": "throw",
          "path": "Iterator.prototype.throw",
          "kind": "function",
          "signature": "(e?: any): IteratorResult<T, TReturn>",
          "overloads": [
            "(e?: any): IteratorResult<T, TReturn>"
          ],
          "type": "(e?: any) => IteratorResult<T, TReturn>",
          "description": ""
        }
      ]
    },
    "IteratorObject": {
      "static": [],
      "instance": [
        {
          "name": "drop",
          "path": "IteratorObject.prototype.drop",
          "kind": "function",
          "signature": "(count: number): IteratorObject<T, undefined, unknown>",
          "overloads": [
            "(count: number): IteratorObject<T, undefined, unknown>"
          ],
          "type": "(count: number) => IteratorObject<T, undefined, unknown>",
          "description": "Creates an iterator whose values are the values from this iterator after skipping the provided count."
        },
        {
          "name": "every",
          "path": "IteratorObject.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: T, index: number) => unknown): boolean",
          "overloads": [
            "(predicate: (value: T, index: number) => unknown): boolean"
          ],
          "type": "(predicate: (value: T, index: number) => unknown) => boolean",
          "description": "Determines whether all the members of this iterator satisfy the specified test."
        },
        {
          "name": "filter",
          "path": "IteratorObject.prototype.filter",
          "kind": "function",
          "signature": "<S extends T>(predicate: (value: T, index: number) => value is S): IteratorObject<S, undefined, unknown>",
          "overloads": [
            "<S extends T>(predicate: (value: T, index: number) => value is S): IteratorObject<S, undefined, unknown>",
            "(predicate: (value: T, index: number) => unknown): IteratorObject<T, undefined, unknown>"
          ],
          "type": "{ <S extends T>(predicate: (value: T, index: number) => value is S): IteratorObject<S, undefined, unknown>; (predicate: (value: T, index: number) => unknown): IteratorObject<T, undefined, unknown>; }",
          "description": "Creates an iterator whose values are those from this iterator for which the provided predicate returns true."
        },
        {
          "name": "find",
          "path": "IteratorObject.prototype.find",
          "kind": "function",
          "signature": "<S extends T>(predicate: (value: T, index: number) => value is S): S",
          "overloads": [
            "<S extends T>(predicate: (value: T, index: number) => value is S): S",
            "(predicate: (value: T, index: number) => unknown): T"
          ],
          "type": "{ <S extends T>(predicate: (value: T, index: number) => value is S): S; (predicate: (value: T, index: number) => unknown): T | undefined; }",
          "description": "Returns the value of the first element in this iterator where predicate is true, and undefined\notherwise."
        },
        {
          "name": "flatMap",
          "path": "IteratorObject.prototype.flatMap",
          "kind": "function",
          "signature": "<U>(callback: (value: T, index: number) => Iterator<U, unknown, undefined> | Iterable<U, unknown, undefined>): IteratorObject<U, undefined, unknown>",
          "overloads": [
            "<U>(callback: (value: T, index: number) => Iterator<U, unknown, undefined> | Iterable<U, unknown, undefined>): IteratorObject<U, undefined, unknown>"
          ],
          "type": "<U>(callback: (value: T, index: number) => Iterator<U, unknown, undefined> | Iterable<U, unknown, undefined>) => IteratorObject<U, undefined, unknown>",
          "description": "Creates an iterator whose values are the result of applying the callback to the values from this iterator and then flattening the resulting iterators or iterables."
        },
        {
          "name": "forEach",
          "path": "IteratorObject.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: T, index: number) => void): void",
          "overloads": [
            "(callbackfn: (value: T, index: number) => void): void"
          ],
          "type": "(callbackfn: (value: T, index: number) => void) => void",
          "description": "Performs the specified action for each element in the iterator."
        },
        {
          "name": "map",
          "path": "IteratorObject.prototype.map",
          "kind": "function",
          "signature": "<U>(callbackfn: (value: T, index: number) => U): IteratorObject<U, undefined, unknown>",
          "overloads": [
            "<U>(callbackfn: (value: T, index: number) => U): IteratorObject<U, undefined, unknown>"
          ],
          "type": "<U>(callbackfn: (value: T, index: number) => U) => IteratorObject<U, undefined, unknown>",
          "description": "Creates an iterator whose values are the result of applying the callback to the values from this iterator."
        },
        {
          "name": "next",
          "path": "IteratorObject.prototype.next",
          "kind": "function",
          "signature": "(...[value]: [] | [TNext]): IteratorResult<T, TReturn>",
          "overloads": [
            "(...[value]: [] | [TNext]): IteratorResult<T, TReturn>"
          ],
          "type": "(...[value]: [] | [TNext]) => IteratorResult<T, TReturn>",
          "description": ""
        },
        {
          "name": "reduce",
          "path": "IteratorObject.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: T, currentValue: T, currentIndex: number) => T): T",
          "overloads": [
            "(callbackfn: (previousValue: T, currentValue: T, currentIndex: number) => T): T",
            "(callbackfn: (previousValue: T, currentValue: T, currentIndex: number) => T, initialValue: T): T",
            "<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: T, currentValue: T, currentIndex: number) => T): T; (callbackfn: (previousValue: T, currentValue: T, currentIndex: number) => T, initialValue: T): T; <U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in this iterator. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function."
        },
        {
          "name": "return",
          "path": "IteratorObject.prototype.return",
          "kind": "function",
          "signature": "(value?: TReturn): IteratorResult<T, TReturn>",
          "overloads": [
            "(value?: TReturn): IteratorResult<T, TReturn>"
          ],
          "type": "(value?: TReturn) => IteratorResult<T, TReturn>",
          "description": ""
        },
        {
          "name": "some",
          "path": "IteratorObject.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: T, index: number) => unknown): boolean",
          "overloads": [
            "(predicate: (value: T, index: number) => unknown): boolean"
          ],
          "type": "(predicate: (value: T, index: number) => unknown) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of this iterator."
        },
        {
          "name": "take",
          "path": "IteratorObject.prototype.take",
          "kind": "function",
          "signature": "(limit: number): IteratorObject<T, undefined, unknown>",
          "overloads": [
            "(limit: number): IteratorObject<T, undefined, unknown>"
          ],
          "type": "(limit: number) => IteratorObject<T, undefined, unknown>",
          "description": "Creates an iterator whose values are the values from this iterator, stopping once the provided limit is reached."
        },
        {
          "name": "throw",
          "path": "IteratorObject.prototype.throw",
          "kind": "function",
          "signature": "(e?: any): IteratorResult<T, TReturn>",
          "overloads": [
            "(e?: any): IteratorResult<T, TReturn>"
          ],
          "type": "(e?: any) => IteratorResult<T, TReturn>",
          "description": ""
        },
        {
          "name": "toArray",
          "path": "IteratorObject.prototype.toArray",
          "kind": "function",
          "signature": "(): T[]",
          "overloads": [
            "(): T[]"
          ],
          "type": "() => T[]",
          "description": "Creates a new array from the values yielded by this iterator."
        }
      ]
    },
    "Object": {
      "static": [
        {
          "name": "assign",
          "path": "Object.assign",
          "kind": "function",
          "signature": "<T extends {}, U>(target: T, source: U): T & U",
          "overloads": [
            "<T extends {}, U>(target: T, source: U): T & U",
            "<T extends {}, U, V>(target: T, source1: U, source2: V): T & U & V",
            "<T extends {}, U, V, W>(target: T, source1: U, source2: V, source3: W): T & U & V & W",
            "(target: object, ...sources: any[]): any"
          ],
          "type": "{ <T extends {}, U>(target: T, source: U): T & U; <T extends {}, U, V>(target: T, source1: U, source2: V): T & U & V; <T extends {}, U, V, W>(target: T, source1: U, source2: V, source3: W): T & U & V & W; (target: object, ...sources: any[]): any; }",
          "description": "Copy the values of all of the enumerable own properties from one or more source objects to a\ntarget object. Returns the target object."
        },
        {
          "name": "create",
          "path": "Object.create",
          "kind": "function",
          "signature": "(o: object): any",
          "overloads": [
            "(o: object): any",
            "(o: object, properties: PropertyDescriptorMap & ThisType<any>): any"
          ],
          "type": "{ (o: object | null): any; (o: object | null, properties: PropertyDescriptorMap & ThisType<any>): any; }",
          "description": "Creates an object that has the specified prototype or that has null prototype.\nCreates an object that has the specified prototype, and that optionally contains specified properties."
        },
        {
          "name": "defineProperties",
          "path": "Object.defineProperties",
          "kind": "function",
          "signature": "<T>(o: T, properties: PropertyDescriptorMap & ThisType<any>): T",
          "overloads": [
            "<T>(o: T, properties: PropertyDescriptorMap & ThisType<any>): T"
          ],
          "type": "<T>(o: T, properties: PropertyDescriptorMap & ThisType<any>) => T",
          "description": "Adds one or more properties to an object, and/or modifies attributes of existing properties."
        },
        {
          "name": "defineProperty",
          "path": "Object.defineProperty",
          "kind": "function",
          "signature": "<T>(o: T, p: PropertyKey, attributes: PropertyDescriptor & ThisType<any>): T",
          "overloads": [
            "<T>(o: T, p: PropertyKey, attributes: PropertyDescriptor & ThisType<any>): T"
          ],
          "type": "<T>(o: T, p: PropertyKey, attributes: PropertyDescriptor & ThisType<any>) => T",
          "description": "Adds a property to an object, or modifies attributes of an existing property."
        },
        {
          "name": "entries",
          "path": "Object.entries",
          "kind": "function",
          "signature": "<T>(o: { [s: string]: T; } | ArrayLike<T>): [string, T][]",
          "overloads": [
            "<T>(o: { [s: string]: T; } | ArrayLike<T>): [string, T][]",
            "(o: {}): [string, any][]"
          ],
          "type": "{ <T>(o: { [s: string]: T; } | ArrayLike<T>): [string, T][]; (o: {}): [string, any][]; }",
          "description": "Returns an array of key/values of the enumerable own properties of an object"
        },
        {
          "name": "freeze",
          "path": "Object.freeze",
          "kind": "function",
          "signature": "<T extends Function>(f: T): T",
          "overloads": [
            "<T extends Function>(f: T): T",
            "<T extends { [idx: string]: U | null | undefined | object; }, U extends string | bigint | number | boolean | symbol>(o: T): Readonly<T>",
            "<T>(o: T): Readonly<T>"
          ],
          "type": "{ <T extends Function>(f: T): T; <T extends { [idx: string]: U | null | undefined | object; }, U extends string | bigint | number | boolean | symbol>(o: T): Readonly<T>; <T>(o: T): Readonly<T>; }",
          "description": "Prevents the modification of existing property attributes and values, and prevents the addition of new properties."
        },
        {
          "name": "fromEntries",
          "path": "Object.fromEntries",
          "kind": "function",
          "signature": "<T = any>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T; }",
          "overloads": [
            "<T = any>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T; }",
            "(entries: Iterable<readonly any[]>): any"
          ],
          "type": "{ <T = any>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T; }; (entries: Iterable<readonly any[]>): any; }",
          "description": "Returns an object created by key-value entries for properties and methods"
        },
        {
          "name": "getOwnPropertyDescriptor",
          "path": "Object.getOwnPropertyDescriptor",
          "kind": "function",
          "signature": "(o: any, p: PropertyKey): PropertyDescriptor",
          "overloads": [
            "(o: any, p: PropertyKey): PropertyDescriptor"
          ],
          "type": "(o: any, p: PropertyKey) => PropertyDescriptor | undefined",
          "description": "Gets the own property descriptor of the specified object.\nAn own property descriptor is one that is defined directly on the object and is not inherited from the object's prototype."
        },
        {
          "name": "getOwnPropertyDescriptors",
          "path": "Object.getOwnPropertyDescriptors",
          "kind": "function",
          "signature": "<T>(o: T): { [P in keyof T]: TypedPropertyDescriptor<T[P]>; } & { [x: string]: PropertyDescriptor; }",
          "overloads": [
            "<T>(o: T): { [P in keyof T]: TypedPropertyDescriptor<T[P]>; } & { [x: string]: PropertyDescriptor; }"
          ],
          "type": "<T>(o: T) => { [P in keyof T]: TypedPropertyDescriptor<T[P]>; } & { [x: string]: PropertyDescriptor; }",
          "description": "Returns an object containing all own property descriptors of an object"
        },
        {
          "name": "getOwnPropertyNames",
          "path": "Object.getOwnPropertyNames",
          "kind": "function",
          "signature": "(o: any): string[]",
          "overloads": [
            "(o: any): string[]"
          ],
          "type": "(o: any) => string[]",
          "description": "Returns the names of the own properties of an object. The own properties of an object are those that are defined directly\non that object, and are not inherited from the object's prototype. The properties of an object include both fields (objects) and functions."
        },
        {
          "name": "getOwnPropertySymbols",
          "path": "Object.getOwnPropertySymbols",
          "kind": "function",
          "signature": "(o: any): symbol[]",
          "overloads": [
            "(o: any): symbol[]"
          ],
          "type": "(o: any) => symbol[]",
          "description": "Returns an array of all symbol properties found directly on object o."
        },
        {
          "name": "getPrototypeOf",
          "path": "Object.getPrototypeOf",
          "kind": "function",
          "signature": "(o: any): any",
          "overloads": [
            "(o: any): any"
          ],
          "type": "(o: any) => any",
          "description": "Returns the prototype of an object."
        },
        {
          "name": "groupBy",
          "path": "Object.groupBy",
          "kind": "function",
          "signature": "<K extends PropertyKey, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K): Partial<Record<K, T[]>>",
          "overloads": [
            "<K extends PropertyKey, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K): Partial<Record<K, T[]>>"
          ],
          "type": "<K extends PropertyKey, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K) => Partial<Record<K, T[]>>",
          "description": "Groups members of an iterable according to the return value of the passed callback."
        },
        {
          "name": "hasOwn",
          "path": "Object.hasOwn",
          "kind": "function",
          "signature": "(o: object, v: PropertyKey): boolean",
          "overloads": [
            "(o: object, v: PropertyKey): boolean"
          ],
          "type": "(o: object, v: PropertyKey) => boolean",
          "description": "Determines whether an object has a property with the specified name."
        },
        {
          "name": "is",
          "path": "Object.is",
          "kind": "function",
          "signature": "(value1: any, value2: any): boolean",
          "overloads": [
            "(value1: any, value2: any): boolean"
          ],
          "type": "(value1: any, value2: any) => boolean",
          "description": "Returns true if the values are the same value, false otherwise."
        },
        {
          "name": "isExtensible",
          "path": "Object.isExtensible",
          "kind": "function",
          "signature": "(o: any): boolean",
          "overloads": [
            "(o: any): boolean"
          ],
          "type": "(o: any) => boolean",
          "description": "Returns a value that indicates whether new properties can be added to an object."
        },
        {
          "name": "isFrozen",
          "path": "Object.isFrozen",
          "kind": "function",
          "signature": "(o: any): boolean",
          "overloads": [
            "(o: any): boolean"
          ],
          "type": "(o: any) => boolean",
          "description": "Returns true if existing property attributes and values cannot be modified in an object, and new properties cannot be added to the object."
        },
        {
          "name": "isSealed",
          "path": "Object.isSealed",
          "kind": "function",
          "signature": "(o: any): boolean",
          "overloads": [
            "(o: any): boolean"
          ],
          "type": "(o: any) => boolean",
          "description": "Returns true if existing property attributes cannot be modified in an object and new properties cannot be added to the object."
        },
        {
          "name": "keys",
          "path": "Object.keys",
          "kind": "function",
          "signature": "(o: object): string[]",
          "overloads": [
            "(o: object): string[]",
            "(o: {}): string[]"
          ],
          "type": "{ (o: object): string[]; (o: {}): string[]; }",
          "description": "Returns the names of the enumerable string properties and methods of an object."
        },
        {
          "name": "preventExtensions",
          "path": "Object.preventExtensions",
          "kind": "function",
          "signature": "<T>(o: T): T",
          "overloads": [
            "<T>(o: T): T"
          ],
          "type": "<T>(o: T) => T",
          "description": "Prevents the addition of new properties to an object."
        },
        {
          "name": "seal",
          "path": "Object.seal",
          "kind": "function",
          "signature": "<T>(o: T): T",
          "overloads": [
            "<T>(o: T): T"
          ],
          "type": "<T>(o: T) => T",
          "description": "Prevents the modification of attributes of existing properties, and prevents the addition of new properties."
        },
        {
          "name": "setPrototypeOf",
          "path": "Object.setPrototypeOf",
          "kind": "function",
          "signature": "(o: any, proto: object): any",
          "overloads": [
            "(o: any, proto: object): any"
          ],
          "type": "(o: any, proto: object | null) => any",
          "description": "Sets the prototype of a specified object o to object proto or null. Returns the object o."
        },
        {
          "name": "values",
          "path": "Object.values",
          "kind": "function",
          "signature": "<T>(o: { [s: string]: T; } | ArrayLike<T>): T[]",
          "overloads": [
            "<T>(o: { [s: string]: T; } | ArrayLike<T>): T[]",
            "(o: {}): any[]"
          ],
          "type": "{ <T>(o: { [s: string]: T; } | ArrayLike<T>): T[]; (o: {}): any[]; }",
          "description": "Returns an array of values of the enumerable own properties of an object"
        }
      ],
      "instance": [
        {
          "name": "constructor",
          "path": "Object.prototype.constructor",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "Function",
          "description": "The initial value of Object.prototype.constructor is the standard built-in Object constructor."
        },
        {
          "name": "hasOwnProperty",
          "path": "Object.prototype.hasOwnProperty",
          "kind": "function",
          "signature": "(v: PropertyKey): boolean",
          "overloads": [
            "(v: PropertyKey): boolean"
          ],
          "type": "(v: PropertyKey) => boolean",
          "description": "Determines whether an object has a property with the specified name."
        },
        {
          "name": "isPrototypeOf",
          "path": "Object.prototype.isPrototypeOf",
          "kind": "function",
          "signature": "(v: Object): boolean",
          "overloads": [
            "(v: Object): boolean"
          ],
          "type": "(v: Object) => boolean",
          "description": "Determines whether an object exists in another object's prototype chain."
        },
        {
          "name": "propertyIsEnumerable",
          "path": "Object.prototype.propertyIsEnumerable",
          "kind": "function",
          "signature": "(v: PropertyKey): boolean",
          "overloads": [
            "(v: PropertyKey): boolean"
          ],
          "type": "(v: PropertyKey) => boolean",
          "description": "Determines whether a specified property is enumerable."
        },
        {
          "name": "toLocaleString",
          "path": "Object.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a date converted to a string using the current locale."
        },
        {
          "name": "toString",
          "path": "Object.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an object."
        },
        {
          "name": "valueOf",
          "path": "Object.prototype.valueOf",
          "kind": "function",
          "signature": "(): Object",
          "overloads": [
            "(): Object"
          ],
          "type": "() => Object",
          "description": "Returns the primitive value of the specified object."
        }
      ]
    },
    "Promise": {
      "static": [
        {
          "name": "all",
          "path": "Promise.all",
          "kind": "function",
          "signature": "<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]>",
          "overloads": [
            "<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]>",
            "<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]>; }>"
          ],
          "type": "{ <T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]>; <T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]>; }>; }",
          "description": "Creates a Promise that is resolved with an array of results when all of the provided Promises\nresolve, or rejected when any Promise is rejected."
        },
        {
          "name": "allSettled",
          "path": "Promise.allSettled",
          "kind": "function",
          "signature": "<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>>; }>",
          "overloads": [
            "<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>>; }>",
            "<T>(values: Iterable<T | PromiseLike<T>>): Promise<PromiseSettledResult<Awaited<T>>[]>"
          ],
          "type": "{ <T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>>; }>; <T>(values: Iterable<T | PromiseLike<T>>): Promise<PromiseSettledResult<Awaited<T>>[]>; }",
          "description": "Creates a Promise that is resolved with an array of results when all\nof the provided Promises resolve or reject."
        },
        {
          "name": "any",
          "path": "Promise.any",
          "kind": "function",
          "signature": "<T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>>",
          "overloads": [
            "<T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>>",
            "<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>"
          ],
          "type": "{ <T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>>; <T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>; }",
          "description": "The any function returns a promise that is fulfilled by the first given promise to be fulfilled, or rejected with an AggregateError containing an array of rejection reasons if all of the given promises are rejected. It resolves all elements of the passed iterable to promises as it runs this algorithm."
        },
        {
          "name": "race",
          "path": "Promise.race",
          "kind": "function",
          "signature": "<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>",
          "overloads": [
            "<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>",
            "<T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>>"
          ],
          "type": "{ <T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>; <T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>>; }",
          "description": "Creates a Promise that is resolved or rejected when any of the provided Promises are resolved\nor rejected."
        },
        {
          "name": "reject",
          "path": "Promise.reject",
          "kind": "function",
          "signature": "<T = never>(reason?: any): Promise<T>",
          "overloads": [
            "<T = never>(reason?: any): Promise<T>"
          ],
          "type": "<T = never>(reason?: any) => Promise<T>",
          "description": "Creates a new rejected promise for the provided reason."
        },
        {
          "name": "resolve",
          "path": "Promise.resolve",
          "kind": "function",
          "signature": "(): Promise<void>",
          "overloads": [
            "(): Promise<void>",
            "<T>(value: T): Promise<Awaited<T>>",
            "<T>(value: T | PromiseLike<T>): Promise<Awaited<T>>"
          ],
          "type": "{ (): Promise<void>; <T>(value: T): Promise<Awaited<T>>; <T>(value: T | PromiseLike<T>): Promise<Awaited<T>>; }",
          "description": "Creates a new resolved promise.\nCreates a new resolved promise for the provided value."
        },
        {
          "name": "try",
          "path": "Promise.try",
          "kind": "function",
          "signature": "<T, U extends unknown[]>(callbackFn: (...args: U) => T | PromiseLike<T>, ...args: U): Promise<Awaited<T>>",
          "overloads": [
            "<T, U extends unknown[]>(callbackFn: (...args: U) => T | PromiseLike<T>, ...args: U): Promise<Awaited<T>>"
          ],
          "type": "<T, U extends unknown[]>(callbackFn: (...args: U) => T | PromiseLike<T>, ...args: U) => Promise<Awaited<T>>",
          "description": "Takes a callback of any kind (returns or throws, synchronously or asynchronously) and wraps its result\nin a Promise."
        },
        {
          "name": "withResolvers",
          "path": "Promise.withResolvers",
          "kind": "function",
          "signature": "<T>(): PromiseWithResolvers<T>",
          "overloads": [
            "<T>(): PromiseWithResolvers<T>"
          ],
          "type": "<T>() => PromiseWithResolvers<T>",
          "description": "Creates a new Promise and returns it in an object, along with its resolve and reject functions."
        }
      ],
      "instance": [
        {
          "name": "catch",
          "path": "Promise.prototype.catch",
          "kind": "function",
          "signature": "<TResult = never>(onrejected?: (reason: any) => TResult | PromiseLike<TResult>): Promise<T | TResult>",
          "overloads": [
            "<TResult = never>(onrejected?: (reason: any) => TResult | PromiseLike<TResult>): Promise<T | TResult>"
          ],
          "type": "<TResult = never>(onrejected?: (reason: any) => TResult | PromiseLike<TResult>) => Promise<T | TResult>",
          "description": "Attaches a callback for only the rejection of the Promise."
        },
        {
          "name": "finally",
          "path": "Promise.prototype.finally",
          "kind": "function",
          "signature": "(onfinally?: () => void): Promise<T>",
          "overloads": [
            "(onfinally?: () => void): Promise<T>"
          ],
          "type": "(onfinally?: () => void) => Promise<T>",
          "description": "Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The\nresolved value cannot be modified from the callback."
        },
        {
          "name": "then",
          "path": "Promise.prototype.then",
          "kind": "function",
          "signature": "<TResult1 = T, TResult2 = never>(onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2>",
          "overloads": [
            "<TResult1 = T, TResult2 = never>(onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2>"
          ],
          "type": "<TResult1 = T, TResult2 = never>(onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>) => Promise<TResult1 | TResult2>",
          "description": "Attaches callbacks for the resolution and/or rejection of the Promise."
        }
      ]
    },
    "Proxy": {
      "static": [
        {
          "name": "revocable",
          "path": "Proxy.revocable",
          "kind": "function",
          "signature": "<T extends object>(target: T, handler: ProxyHandler<T>): { proxy: T; revoke: () => void; }",
          "overloads": [
            "<T extends object>(target: T, handler: ProxyHandler<T>): { proxy: T; revoke: () => void; }"
          ],
          "type": "<T extends object>(target: T, handler: ProxyHandler<T>) => { proxy: T; revoke: () => void; }",
          "description": "Creates a revocable Proxy object."
        }
      ],
      "instance": []
    },
    "RangeError": {
      "static": [
        {
          "name": "isError",
          "path": "RangeError.isError",
          "kind": "function",
          "signature": "(error: unknown): error is Error",
          "overloads": [
            "(error: unknown): error is Error"
          ],
          "type": "(error: unknown) => error is Error",
          "description": "Indicates whether the argument provided is a built-in Error instance or not."
        }
      ],
      "instance": [
        {
          "name": "cause",
          "path": "RangeError.prototype.cause",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "unknown",
          "description": ""
        },
        {
          "name": "message",
          "path": "RangeError.prototype.message",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "stack",
          "path": "RangeError.prototype.stack",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        }
      ]
    },
    "ReferenceError": {
      "static": [
        {
          "name": "isError",
          "path": "ReferenceError.isError",
          "kind": "function",
          "signature": "(error: unknown): error is Error",
          "overloads": [
            "(error: unknown): error is Error"
          ],
          "type": "(error: unknown) => error is Error",
          "description": "Indicates whether the argument provided is a built-in Error instance or not."
        }
      ],
      "instance": [
        {
          "name": "cause",
          "path": "ReferenceError.prototype.cause",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "unknown",
          "description": ""
        },
        {
          "name": "message",
          "path": "ReferenceError.prototype.message",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "stack",
          "path": "ReferenceError.prototype.stack",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        }
      ]
    },
    "RegExp": {
      "static": [
        {
          "name": "$_",
          "path": "RegExp.$_",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$'",
          "path": "RegExp.$'",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$&",
          "path": "RegExp.$&",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$`",
          "path": "RegExp.$`",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$+",
          "path": "RegExp.$+",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$1",
          "path": "RegExp.$1",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$2",
          "path": "RegExp.$2",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$3",
          "path": "RegExp.$3",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$4",
          "path": "RegExp.$4",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$5",
          "path": "RegExp.$5",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$6",
          "path": "RegExp.$6",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$7",
          "path": "RegExp.$7",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$8",
          "path": "RegExp.$8",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "$9",
          "path": "RegExp.$9",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "input",
          "path": "RegExp.input",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "lastMatch",
          "path": "RegExp.lastMatch",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "lastParen",
          "path": "RegExp.lastParen",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "leftContext",
          "path": "RegExp.leftContext",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "rightContext",
          "path": "RegExp.rightContext",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        }
      ],
      "instance": [
        {
          "name": "compile",
          "path": "RegExp.prototype.compile",
          "kind": "function",
          "signature": "(pattern: string, flags?: string): RegExp",
          "overloads": [
            "(pattern: string, flags?: string): RegExp"
          ],
          "type": "(pattern: string, flags?: string) => RegExp",
          "description": ""
        },
        {
          "name": "dotAll",
          "path": "RegExp.prototype.dotAll",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a Boolean value indicating the state of the dotAll flag (s) used with a regular expression.\nDefault is false. Read-only."
        },
        {
          "name": "exec",
          "path": "RegExp.prototype.exec",
          "kind": "function",
          "signature": "(string: string): RegExpExecArray",
          "overloads": [
            "(string: string): RegExpExecArray"
          ],
          "type": "(string: string) => RegExpExecArray | null",
          "description": "Executes a search on a string using a regular expression pattern, and returns an array containing the results of that search."
        },
        {
          "name": "flags",
          "path": "RegExp.prototype.flags",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": "Returns a string indicating the flags of the regular expression in question. This field is read-only.\nThe characters in this string are sequenced and concatenated in the following order:\n\n   - \"g\" for global\n   - \"i\" for ignoreCase\n   - \"m\" for multiline\n   - \"u\" for unicode\n   - \"y\" for sticky\n\nIf no flags are set, the value is the empty string."
        },
        {
          "name": "global",
          "path": "RegExp.prototype.global",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a Boolean value indicating the state of the global flag (g) used with a regular expression. Default is false. Read-only."
        },
        {
          "name": "hasIndices",
          "path": "RegExp.prototype.hasIndices",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a Boolean value indicating the state of the hasIndices flag (d) used with a regular expression.\nDefault is false. Read-only."
        },
        {
          "name": "ignoreCase",
          "path": "RegExp.prototype.ignoreCase",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a Boolean value indicating the state of the ignoreCase flag (i) used with a regular expression. Default is false. Read-only."
        },
        {
          "name": "lastIndex",
          "path": "RegExp.prototype.lastIndex",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": ""
        },
        {
          "name": "multiline",
          "path": "RegExp.prototype.multiline",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a Boolean value indicating the state of the multiline flag (m) used with a regular expression. Default is false. Read-only."
        },
        {
          "name": "source",
          "path": "RegExp.prototype.source",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": "Returns a copy of the text of the regular expression pattern. Read-only. The regExp argument is a Regular expression object. It can be a variable name or a literal."
        },
        {
          "name": "sticky",
          "path": "RegExp.prototype.sticky",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a Boolean value indicating the state of the sticky flag (y) used with a regular\nexpression. Default is false. Read-only."
        },
        {
          "name": "test",
          "path": "RegExp.prototype.test",
          "kind": "function",
          "signature": "(string: string): boolean",
          "overloads": [
            "(string: string): boolean"
          ],
          "type": "(string: string) => boolean",
          "description": "Returns a Boolean value that indicates whether or not a pattern exists in a searched string."
        },
        {
          "name": "unicode",
          "path": "RegExp.prototype.unicode",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a Boolean value indicating the state of the Unicode flag (u) used with a regular\nexpression. Default is false. Read-only."
        },
        {
          "name": "unicodeSets",
          "path": "RegExp.prototype.unicodeSets",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns a Boolean value indicating the state of the unicodeSets flag (v) used with a regular expression.\nDefault is false. Read-only."
        }
      ]
    },
    "Set": {
      "static": [],
      "instance": [
        {
          "name": "add",
          "path": "Set.prototype.add",
          "kind": "function",
          "signature": "(value: T): Set<T>",
          "overloads": [
            "(value: T): Set<T>"
          ],
          "type": "(value: T) => Set<T>",
          "description": "Appends a new element with a specified value to the end of the Set."
        },
        {
          "name": "clear",
          "path": "Set.prototype.clear",
          "kind": "function",
          "signature": "(): void",
          "overloads": [
            "(): void"
          ],
          "type": "() => void",
          "description": ""
        },
        {
          "name": "delete",
          "path": "Set.prototype.delete",
          "kind": "function",
          "signature": "(value: T): boolean",
          "overloads": [
            "(value: T): boolean"
          ],
          "type": "(value: T) => boolean",
          "description": "Removes a specified value from the Set."
        },
        {
          "name": "difference",
          "path": "Set.prototype.difference",
          "kind": "function",
          "signature": "<U>(other: ReadonlySetLike<U>): Set<T>",
          "overloads": [
            "<U>(other: ReadonlySetLike<U>): Set<T>"
          ],
          "type": "<U>(other: ReadonlySetLike<U>) => Set<T>",
          "description": ""
        },
        {
          "name": "entries",
          "path": "Set.prototype.entries",
          "kind": "function",
          "signature": "(): SetIterator<[T, T]>",
          "overloads": [
            "(): SetIterator<[T, T]>"
          ],
          "type": "() => SetIterator<[T, T]>",
          "description": "Returns an iterable of [v,v] pairs for every value `v` in the set."
        },
        {
          "name": "forEach",
          "path": "Set.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any) => void",
          "description": "Executes a provided function once per each value in the Set object, in insertion order."
        },
        {
          "name": "has",
          "path": "Set.prototype.has",
          "kind": "function",
          "signature": "(value: T): boolean",
          "overloads": [
            "(value: T): boolean"
          ],
          "type": "(value: T) => boolean",
          "description": ""
        },
        {
          "name": "intersection",
          "path": "Set.prototype.intersection",
          "kind": "function",
          "signature": "<U>(other: ReadonlySetLike<U>): Set<T & U>",
          "overloads": [
            "<U>(other: ReadonlySetLike<U>): Set<T & U>"
          ],
          "type": "<U>(other: ReadonlySetLike<U>) => Set<T & U>",
          "description": ""
        },
        {
          "name": "isDisjointFrom",
          "path": "Set.prototype.isDisjointFrom",
          "kind": "function",
          "signature": "(other: ReadonlySetLike<unknown>): boolean",
          "overloads": [
            "(other: ReadonlySetLike<unknown>): boolean"
          ],
          "type": "(other: ReadonlySetLike<unknown>) => boolean",
          "description": ""
        },
        {
          "name": "isSubsetOf",
          "path": "Set.prototype.isSubsetOf",
          "kind": "function",
          "signature": "(other: ReadonlySetLike<unknown>): boolean",
          "overloads": [
            "(other: ReadonlySetLike<unknown>): boolean"
          ],
          "type": "(other: ReadonlySetLike<unknown>) => boolean",
          "description": ""
        },
        {
          "name": "isSupersetOf",
          "path": "Set.prototype.isSupersetOf",
          "kind": "function",
          "signature": "(other: ReadonlySetLike<unknown>): boolean",
          "overloads": [
            "(other: ReadonlySetLike<unknown>): boolean"
          ],
          "type": "(other: ReadonlySetLike<unknown>) => boolean",
          "description": ""
        },
        {
          "name": "keys",
          "path": "Set.prototype.keys",
          "kind": "function",
          "signature": "(): SetIterator<T>",
          "overloads": [
            "(): SetIterator<T>"
          ],
          "type": "() => SetIterator<T>",
          "description": "Despite its name, returns an iterable of the values in the set."
        },
        {
          "name": "size",
          "path": "Set.prototype.size",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": ""
        },
        {
          "name": "symmetricDifference",
          "path": "Set.prototype.symmetricDifference",
          "kind": "function",
          "signature": "<U>(other: ReadonlySetLike<U>): Set<T | U>",
          "overloads": [
            "<U>(other: ReadonlySetLike<U>): Set<T | U>"
          ],
          "type": "<U>(other: ReadonlySetLike<U>) => Set<T | U>",
          "description": ""
        },
        {
          "name": "union",
          "path": "Set.prototype.union",
          "kind": "function",
          "signature": "<U>(other: ReadonlySetLike<U>): Set<T | U>",
          "overloads": [
            "<U>(other: ReadonlySetLike<U>): Set<T | U>"
          ],
          "type": "<U>(other: ReadonlySetLike<U>) => Set<T | U>",
          "description": ""
        },
        {
          "name": "values",
          "path": "Set.prototype.values",
          "kind": "function",
          "signature": "(): SetIterator<T>",
          "overloads": [
            "(): SetIterator<T>"
          ],
          "type": "() => SetIterator<T>",
          "description": "Returns an iterable of values in the set."
        }
      ]
    },
    "SharedArrayBuffer": {
      "static": [],
      "instance": [
        {
          "name": "byteLength",
          "path": "SharedArrayBuffer.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "Read-only. The length of the ArrayBuffer (in bytes)."
        },
        {
          "name": "grow",
          "path": "SharedArrayBuffer.prototype.grow",
          "kind": "function",
          "signature": "(newByteLength?: number): void",
          "overloads": [
            "(newByteLength?: number): void"
          ],
          "type": "(newByteLength?: number) => void",
          "description": "Grows the SharedArrayBuffer to the specified size (in bytes).\n\n[MDN](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer/grow)"
        },
        {
          "name": "growable",
          "path": "SharedArrayBuffer.prototype.growable",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "boolean",
          "description": "Returns true if this SharedArrayBuffer can be grown.\n\n[MDN](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer/growable)"
        },
        {
          "name": "maxByteLength",
          "path": "SharedArrayBuffer.prototype.maxByteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "If this SharedArrayBuffer is growable, returns the maximum byte length given during construction; returns the byte length if not.\n\n[MDN](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer/maxByteLength)"
        },
        {
          "name": "slice",
          "path": "SharedArrayBuffer.prototype.slice",
          "kind": "function",
          "signature": "(begin?: number, end?: number): SharedArrayBuffer",
          "overloads": [
            "(begin?: number, end?: number): SharedArrayBuffer"
          ],
          "type": "(begin?: number, end?: number) => SharedArrayBuffer",
          "description": "Returns a section of an SharedArrayBuffer."
        }
      ]
    },
    "String": {
      "static": [
        {
          "name": "fromCharCode",
          "path": "String.fromCharCode",
          "kind": "function",
          "signature": "(...codes: number[]): string",
          "overloads": [
            "(...codes: number[]): string"
          ],
          "type": "(...codes: number[]) => string",
          "description": ""
        },
        {
          "name": "fromCodePoint",
          "path": "String.fromCodePoint",
          "kind": "function",
          "signature": "(...codePoints: number[]): string",
          "overloads": [
            "(...codePoints: number[]): string"
          ],
          "type": "(...codePoints: number[]) => string",
          "description": "Return the String value whose elements are, in order, the elements in the List elements.\nIf length is 0, the empty string is returned."
        },
        {
          "name": "raw",
          "path": "String.raw",
          "kind": "function",
          "signature": "(template: { raw: readonly string[] | ArrayLike<string>; }, ...substitutions: any[]): string",
          "overloads": [
            "(template: { raw: readonly string[] | ArrayLike<string>; }, ...substitutions: any[]): string"
          ],
          "type": "(template: { raw: readonly string[] | ArrayLike<string>; }, ...substitutions: any[]) => string",
          "description": "String.raw is usually used as a tag function of a Tagged Template String. When called as\nsuch, the first argument will be a well formed template call site object and the rest\nparameter will contain the substitution values. It can also be called directly, for example,\nto interleave strings and values from your own tag function, and in this case the only thing\nit needs from the first argument is the raw property."
        }
      ],
      "instance": [
        {
          "name": "anchor",
          "path": "String.prototype.anchor",
          "kind": "function",
          "signature": "(name: string): string",
          "overloads": [
            "(name: string): string"
          ],
          "type": "(name: string) => string",
          "description": "Returns an `<a>` HTML anchor element and sets the name attribute to the text value"
        },
        {
          "name": "at",
          "path": "String.prototype.at",
          "kind": "function",
          "signature": "(index: number): string",
          "overloads": [
            "(index: number): string"
          ],
          "type": "(index: number) => string | undefined",
          "description": "Returns a new String consisting of the single UTF-16 code unit located at the specified index."
        },
        {
          "name": "big",
          "path": "String.prototype.big",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a `<big>` HTML element"
        },
        {
          "name": "blink",
          "path": "String.prototype.blink",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a `<blink>` HTML element"
        },
        {
          "name": "bold",
          "path": "String.prototype.bold",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a `<b>` HTML element"
        },
        {
          "name": "charAt",
          "path": "String.prototype.charAt",
          "kind": "function",
          "signature": "(pos: number): string",
          "overloads": [
            "(pos: number): string"
          ],
          "type": "(pos: number) => string",
          "description": "Returns the character at the specified index."
        },
        {
          "name": "charCodeAt",
          "path": "String.prototype.charCodeAt",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number",
          "description": "Returns the Unicode value of the character at the specified location."
        },
        {
          "name": "codePointAt",
          "path": "String.prototype.codePointAt",
          "kind": "function",
          "signature": "(pos: number): number",
          "overloads": [
            "(pos: number): number"
          ],
          "type": "(pos: number) => number | undefined",
          "description": "Returns a nonnegative integer Number less than 1114112 (0x110000) that is the code point\nvalue of the UTF-16 encoded code point starting at the string element at position pos in\nthe String resulting from converting this object to a String.\nIf there is no element at that position, the result is undefined.\nIf a valid UTF-16 surrogate pair does not begin at pos, the result is the code unit at pos."
        },
        {
          "name": "concat",
          "path": "String.prototype.concat",
          "kind": "function",
          "signature": "(...strings: string[]): string",
          "overloads": [
            "(...strings: string[]): string"
          ],
          "type": "(...strings: string[]) => string",
          "description": "Returns a string that contains the concatenation of two or more strings."
        },
        {
          "name": "endsWith",
          "path": "String.prototype.endsWith",
          "kind": "function",
          "signature": "(searchString: string, endPosition?: number): boolean",
          "overloads": [
            "(searchString: string, endPosition?: number): boolean"
          ],
          "type": "(searchString: string, endPosition?: number) => boolean",
          "description": "Returns true if the sequence of elements of searchString converted to a String is the\nsame as the corresponding elements of this object (converted to a String) starting at\nendPosition – length(this). Otherwise returns false."
        },
        {
          "name": "fixed",
          "path": "String.prototype.fixed",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a `<tt>` HTML element"
        },
        {
          "name": "fontcolor",
          "path": "String.prototype.fontcolor",
          "kind": "function",
          "signature": "(color: string): string",
          "overloads": [
            "(color: string): string"
          ],
          "type": "(color: string) => string",
          "description": "Returns a `<font>` HTML element and sets the color attribute value"
        },
        {
          "name": "fontsize",
          "path": "String.prototype.fontsize",
          "kind": "function",
          "signature": "(size: number): string",
          "overloads": [
            "(size: number): string",
            "(size: string): string"
          ],
          "type": "{ (size: number): string; (size: string): string; }",
          "description": "Returns a `<font>` HTML element and sets the size attribute value"
        },
        {
          "name": "includes",
          "path": "String.prototype.includes",
          "kind": "function",
          "signature": "(searchString: string, position?: number): boolean",
          "overloads": [
            "(searchString: string, position?: number): boolean"
          ],
          "type": "(searchString: string, position?: number) => boolean",
          "description": "Returns true if searchString appears as a substring of the result of converting this\nobject to a String, at one or more positions that are\ngreater than or equal to position; otherwise, returns false."
        },
        {
          "name": "indexOf",
          "path": "String.prototype.indexOf",
          "kind": "function",
          "signature": "(searchString: string, position?: number): number",
          "overloads": [
            "(searchString: string, position?: number): number"
          ],
          "type": "(searchString: string, position?: number) => number",
          "description": "Returns the position of the first occurrence of a substring."
        },
        {
          "name": "isWellFormed",
          "path": "String.prototype.isWellFormed",
          "kind": "function",
          "signature": "(): boolean",
          "overloads": [
            "(): boolean"
          ],
          "type": "() => boolean",
          "description": "Returns true if all leading surrogates and trailing surrogates appear paired and in order."
        },
        {
          "name": "italics",
          "path": "String.prototype.italics",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns an `<i>` HTML element"
        },
        {
          "name": "lastIndexOf",
          "path": "String.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchString: string, position?: number): number",
          "overloads": [
            "(searchString: string, position?: number): number"
          ],
          "type": "(searchString: string, position?: number) => number",
          "description": "Returns the last occurrence of a substring in the string."
        },
        {
          "name": "link",
          "path": "String.prototype.link",
          "kind": "function",
          "signature": "(url: string): string",
          "overloads": [
            "(url: string): string"
          ],
          "type": "(url: string) => string",
          "description": "Returns an `<a>` HTML element and sets the href attribute value"
        },
        {
          "name": "localeCompare",
          "path": "String.prototype.localeCompare",
          "kind": "function",
          "signature": "(that: string): number",
          "overloads": [
            "(that: string): number",
            "(that: string, locales?: string | string[], options?: CollatorOptions): number",
            "(that: string, locales?: LocalesArgument, options?: CollatorOptions): number"
          ],
          "type": "{ (that: string): number; (that: string, locales?: string | string[], options?: Intl.CollatorOptions): number; (that: string, locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions): number; }",
          "description": "Determines whether two strings are equivalent in the current locale.\nDetermines whether two strings are equivalent in the current or specified locale."
        },
        {
          "name": "match",
          "path": "String.prototype.match",
          "kind": "function",
          "signature": "(regexp: string | RegExp): RegExpMatchArray",
          "overloads": [
            "(regexp: string | RegExp): RegExpMatchArray",
            "(matcher: { [Symbol.match](string: string): RegExpMatchArray; }): RegExpMatchArray"
          ],
          "type": "{ (regexp: string | RegExp): RegExpMatchArray | null; (matcher: { [Symbol.match](string: string): RegExpMatchArray | null; }): RegExpMatchArray | null; }",
          "description": "Matches a string with a regular expression, and returns an array containing the results of that search.\nMatches a string or an object that supports being matched against, and returns an array\ncontaining the results of that search, or null if no matches are found."
        },
        {
          "name": "matchAll",
          "path": "String.prototype.matchAll",
          "kind": "function",
          "signature": "(regexp: RegExp): RegExpStringIterator<RegExpExecArray>",
          "overloads": [
            "(regexp: RegExp): RegExpStringIterator<RegExpExecArray>"
          ],
          "type": "(regexp: RegExp) => RegExpStringIterator<RegExpExecArray>",
          "description": "Matches a string with a regular expression, and returns an iterable of matches\ncontaining the results of that search."
        },
        {
          "name": "normalize",
          "path": "String.prototype.normalize",
          "kind": "function",
          "signature": "(form: \"NFC\" | \"NFD\" | \"NFKC\" | \"NFKD\"): string",
          "overloads": [
            "(form: \"NFC\" | \"NFD\" | \"NFKC\" | \"NFKD\"): string",
            "(form?: string): string"
          ],
          "type": "{ (form: \"NFC\" | \"NFD\" | \"NFKC\" | \"NFKD\"): string; (form?: string): string; }",
          "description": "Returns the String value result of normalizing the string into the normalization form\nnamed by form as specified in Unicode Standard Annex #15, Unicode Normalization Forms."
        },
        {
          "name": "padEnd",
          "path": "String.prototype.padEnd",
          "kind": "function",
          "signature": "(maxLength: number, fillString?: string): string",
          "overloads": [
            "(maxLength: number, fillString?: string): string"
          ],
          "type": "(maxLength: number, fillString?: string) => string",
          "description": "Pads the current string with a given string (possibly repeated) so that the resulting string reaches a given length.\nThe padding is applied from the end (right) of the current string."
        },
        {
          "name": "padStart",
          "path": "String.prototype.padStart",
          "kind": "function",
          "signature": "(maxLength: number, fillString?: string): string",
          "overloads": [
            "(maxLength: number, fillString?: string): string"
          ],
          "type": "(maxLength: number, fillString?: string) => string",
          "description": "Pads the current string with a given string (possibly repeated) so that the resulting string reaches a given length.\nThe padding is applied from the start (left) of the current string."
        },
        {
          "name": "repeat",
          "path": "String.prototype.repeat",
          "kind": "function",
          "signature": "(count: number): string",
          "overloads": [
            "(count: number): string"
          ],
          "type": "(count: number) => string",
          "description": "Returns a String value that is made from count copies appended together. If count is 0,\nthe empty string is returned."
        },
        {
          "name": "replace",
          "path": "String.prototype.replace",
          "kind": "function",
          "signature": "(searchValue: string | RegExp, replaceValue: string): string",
          "overloads": [
            "(searchValue: string | RegExp, replaceValue: string): string",
            "(searchValue: string | RegExp, replacer: (substring: string, ...args: any[]) => string): string",
            "(searchValue: { [Symbol.replace](string: string, replaceValue: string): string; }, replaceValue: string): string",
            "(searchValue: { [Symbol.replace](string: string, replacer: (substring: string, ...args: any[]) => string): string; }, replacer: (substring: string, ...args: any[]) => string): string"
          ],
          "type": "{ (searchValue: string | RegExp, replaceValue: string): string; (searchValue: string | RegExp, replacer: (substring: string, ...args: any[]) => string): string; (searchValue: { [Symbol.replace](string: string, replaceValue: string): string; }, replaceValue: string): string; (searchValue: { [Symbol.replace](string: string, replacer: (substring: string, ...args: any[]) => string): string; }, replacer: (substring: string, ...args: any[]) => string): string; }",
          "description": "Replaces text in a string, using a regular expression or search string.\nPasses a string and {@linkcode replaceValue} to the `[Symbol.replace]` method on {@linkcode searchValue}. This method is expected to implement its own replacement algorithm.\nReplaces text in a string, using an object that supports replacement within a string."
        },
        {
          "name": "replaceAll",
          "path": "String.prototype.replaceAll",
          "kind": "function",
          "signature": "(searchValue: string | RegExp, replaceValue: string): string",
          "overloads": [
            "(searchValue: string | RegExp, replaceValue: string): string",
            "(searchValue: string | RegExp, replacer: (substring: string, ...args: any[]) => string): string"
          ],
          "type": "{ (searchValue: string | RegExp, replaceValue: string): string; (searchValue: string | RegExp, replacer: (substring: string, ...args: any[]) => string): string; }",
          "description": "Replace all instances of a substring in a string, using a regular expression or search string."
        },
        {
          "name": "search",
          "path": "String.prototype.search",
          "kind": "function",
          "signature": "(regexp: string | RegExp): number",
          "overloads": [
            "(regexp: string | RegExp): number",
            "(searcher: { [Symbol.search](string: string): number; }): number"
          ],
          "type": "{ (regexp: string | RegExp): number; (searcher: { [Symbol.search](string: string): number; }): number; }",
          "description": "Finds the first substring match in a regular expression search."
        },
        {
          "name": "slice",
          "path": "String.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): string",
          "overloads": [
            "(start?: number, end?: number): string"
          ],
          "type": "(start?: number, end?: number) => string",
          "description": "Returns a section of a string."
        },
        {
          "name": "small",
          "path": "String.prototype.small",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a `<small>` HTML element"
        },
        {
          "name": "split",
          "path": "String.prototype.split",
          "kind": "function",
          "signature": "(separator: string | RegExp, limit?: number): string[]",
          "overloads": [
            "(separator: string | RegExp, limit?: number): string[]",
            "(splitter: { [Symbol.split](string: string, limit?: number): string[]; }, limit?: number): string[]"
          ],
          "type": "{ (separator: string | RegExp, limit?: number): string[]; (splitter: { [Symbol.split](string: string, limit?: number): string[]; }, limit?: number): string[]; }",
          "description": "Split a string into substrings using the specified separator and return them as an array."
        },
        {
          "name": "startsWith",
          "path": "String.prototype.startsWith",
          "kind": "function",
          "signature": "(searchString: string, position?: number): boolean",
          "overloads": [
            "(searchString: string, position?: number): boolean"
          ],
          "type": "(searchString: string, position?: number) => boolean",
          "description": "Returns true if the sequence of elements of searchString converted to a String is the\nsame as the corresponding elements of this object (converted to a String) starting at\nposition. Otherwise returns false."
        },
        {
          "name": "strike",
          "path": "String.prototype.strike",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a `<strike>` HTML element"
        },
        {
          "name": "sub",
          "path": "String.prototype.sub",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a `<sub>` HTML element"
        },
        {
          "name": "substr",
          "path": "String.prototype.substr",
          "kind": "function",
          "signature": "(from: number, length?: number): string",
          "overloads": [
            "(from: number, length?: number): string"
          ],
          "type": "(from: number, length?: number) => string",
          "description": "Gets a substring beginning at the specified location and having the specified length."
        },
        {
          "name": "substring",
          "path": "String.prototype.substring",
          "kind": "function",
          "signature": "(start: number, end?: number): string",
          "overloads": [
            "(start: number, end?: number): string"
          ],
          "type": "(start: number, end?: number) => string",
          "description": "Returns the substring at the specified location within a String object."
        },
        {
          "name": "sup",
          "path": "String.prototype.sup",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a `<sup>` HTML element"
        },
        {
          "name": "toLocaleLowerCase",
          "path": "String.prototype.toLocaleLowerCase",
          "kind": "function",
          "signature": "(locales?: string | string[]): string",
          "overloads": [
            "(locales?: string | string[]): string",
            "(locales?: LocalesArgument): string"
          ],
          "type": "{ (locales?: string | string[]): string; (locales?: Intl.LocalesArgument): string; }",
          "description": "Converts all alphabetic characters to lowercase, taking into account the host environment's current locale."
        },
        {
          "name": "toLocaleUpperCase",
          "path": "String.prototype.toLocaleUpperCase",
          "kind": "function",
          "signature": "(locales?: string | string[]): string",
          "overloads": [
            "(locales?: string | string[]): string",
            "(locales?: LocalesArgument): string"
          ],
          "type": "{ (locales?: string | string[]): string; (locales?: Intl.LocalesArgument): string; }",
          "description": "Returns a string where all alphabetic characters have been converted to uppercase, taking into account the host environment's current locale."
        },
        {
          "name": "toLowerCase",
          "path": "String.prototype.toLowerCase",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Converts all the alphabetic characters in a string to lowercase."
        },
        {
          "name": "toString",
          "path": "String.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of a string."
        },
        {
          "name": "toUpperCase",
          "path": "String.prototype.toUpperCase",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Converts all the alphabetic characters in a string to uppercase."
        },
        {
          "name": "toWellFormed",
          "path": "String.prototype.toWellFormed",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string where all lone or out-of-order surrogates have been replaced by the Unicode replacement character (U+FFFD)."
        },
        {
          "name": "trim",
          "path": "String.prototype.trim",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Removes the leading and trailing white space and line terminator characters from a string."
        },
        {
          "name": "trimEnd",
          "path": "String.prototype.trimEnd",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Removes the trailing white space and line terminator characters from a string."
        },
        {
          "name": "trimLeft",
          "path": "String.prototype.trimLeft",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Removes the leading white space and line terminator characters from a string."
        },
        {
          "name": "trimRight",
          "path": "String.prototype.trimRight",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Removes the trailing white space and line terminator characters from a string."
        },
        {
          "name": "trimStart",
          "path": "String.prototype.trimStart",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Removes the leading white space and line terminator characters from a string."
        },
        {
          "name": "valueOf",
          "path": "String.prototype.valueOf",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns the primitive value of the specified object."
        }
      ]
    },
    "Symbol": {
      "static": [
        {
          "name": "asyncDispose",
          "path": "Symbol.asyncDispose",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.asyncDispose",
          "description": "A method that is used to asynchronously release resources held by an object. Called by the semantics of the `await using` statement."
        },
        {
          "name": "asyncIterator",
          "path": "Symbol.asyncIterator",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.asyncIterator",
          "description": "A method that returns the default async iterator for an object. Called by the semantics of\nthe for-await-of statement."
        },
        {
          "name": "dispose",
          "path": "Symbol.dispose",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.dispose",
          "description": "A method that is used to release resources held by an object. Called by the semantics of the `using` statement."
        },
        {
          "name": "for",
          "path": "Symbol.for",
          "kind": "function",
          "signature": "(key: string): symbol",
          "overloads": [
            "(key: string): symbol"
          ],
          "type": "(key: string) => symbol",
          "description": "Returns a Symbol object from the global symbol registry matching the given key if found.\nOtherwise, returns a new symbol with this key."
        },
        {
          "name": "hasInstance",
          "path": "Symbol.hasInstance",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.hasInstance",
          "description": "A method that determines if a constructor object recognizes an object as one of the\nconstructor’s instances. Called by the semantics of the instanceof operator."
        },
        {
          "name": "isConcatSpreadable",
          "path": "Symbol.isConcatSpreadable",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.isConcatSpreadable",
          "description": "A Boolean value that if true indicates that an object should flatten to its array elements\nby Array.prototype.concat."
        },
        {
          "name": "iterator",
          "path": "Symbol.iterator",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.iterator",
          "description": "A method that returns the default iterator for an object. Called by the semantics of the\nfor-of statement."
        },
        {
          "name": "keyFor",
          "path": "Symbol.keyFor",
          "kind": "function",
          "signature": "(sym: symbol): string",
          "overloads": [
            "(sym: symbol): string"
          ],
          "type": "(sym: symbol) => string | undefined",
          "description": "Returns a key from the global symbol registry matching the given Symbol if found.\nOtherwise, returns a undefined."
        },
        {
          "name": "match",
          "path": "Symbol.match",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.match",
          "description": "A regular expression method that matches the regular expression against a string. Called\nby the String.prototype.match method."
        },
        {
          "name": "matchAll",
          "path": "Symbol.matchAll",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.matchAll",
          "description": "A regular expression method that matches the regular expression against a string. Called\nby the String.prototype.matchAll method."
        },
        {
          "name": "metadata",
          "path": "Symbol.metadata",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.metadata",
          "description": ""
        },
        {
          "name": "replace",
          "path": "Symbol.replace",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.replace",
          "description": "A regular expression method that replaces matched substrings of a string. Called by the\nString.prototype.replace method."
        },
        {
          "name": "search",
          "path": "Symbol.search",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.search",
          "description": "A regular expression method that returns the index within a string that matches the\nregular expression. Called by the String.prototype.search method."
        },
        {
          "name": "species",
          "path": "Symbol.species",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.species",
          "description": "A function valued property that is the constructor function that is used to create\nderived objects."
        },
        {
          "name": "split",
          "path": "Symbol.split",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.split",
          "description": "A regular expression method that splits a string at the indices that match the regular\nexpression. Called by the String.prototype.split method."
        },
        {
          "name": "toPrimitive",
          "path": "Symbol.toPrimitive",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.toPrimitive",
          "description": "A method that converts an object to a corresponding primitive value.\nCalled by the ToPrimitive abstract operation."
        },
        {
          "name": "toStringTag",
          "path": "Symbol.toStringTag",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.toStringTag",
          "description": "A String value that is used in the creation of the default string description of an object.\nCalled by the built-in method Object.prototype.toString."
        },
        {
          "name": "unscopables",
          "path": "Symbol.unscopables",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "typeof Symbol.unscopables",
          "description": "An Object whose truthy properties are properties that are excluded from the 'with'\nenvironment bindings of the associated objects."
        }
      ],
      "instance": [
        {
          "name": "description",
          "path": "Symbol.prototype.description",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": "Expose the [[Description]] internal slot of a symbol directly."
        },
        {
          "name": "toString",
          "path": "Symbol.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an object."
        },
        {
          "name": "valueOf",
          "path": "Symbol.prototype.valueOf",
          "kind": "function",
          "signature": "(): symbol",
          "overloads": [
            "(): symbol"
          ],
          "type": "() => symbol",
          "description": "Returns the primitive value of the specified object."
        }
      ]
    },
    "SyntaxError": {
      "static": [
        {
          "name": "isError",
          "path": "SyntaxError.isError",
          "kind": "function",
          "signature": "(error: unknown): error is Error",
          "overloads": [
            "(error: unknown): error is Error"
          ],
          "type": "(error: unknown) => error is Error",
          "description": "Indicates whether the argument provided is a built-in Error instance or not."
        }
      ],
      "instance": [
        {
          "name": "cause",
          "path": "SyntaxError.prototype.cause",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "unknown",
          "description": ""
        },
        {
          "name": "message",
          "path": "SyntaxError.prototype.message",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "stack",
          "path": "SyntaxError.prototype.stack",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        }
      ]
    },
    "TypeError": {
      "static": [
        {
          "name": "isError",
          "path": "TypeError.isError",
          "kind": "function",
          "signature": "(error: unknown): error is Error",
          "overloads": [
            "(error: unknown): error is Error"
          ],
          "type": "(error: unknown) => error is Error",
          "description": "Indicates whether the argument provided is a built-in Error instance or not."
        }
      ],
      "instance": [
        {
          "name": "cause",
          "path": "TypeError.prototype.cause",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "unknown",
          "description": ""
        },
        {
          "name": "message",
          "path": "TypeError.prototype.message",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "stack",
          "path": "TypeError.prototype.stack",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        }
      ]
    },
    "Uint8Array": {
      "static": [
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Uint8Array.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "from",
          "path": "Uint8Array.from",
          "kind": "function",
          "signature": "(arrayLike: ArrayLike<number>): Uint8Array<ArrayBuffer>",
          "overloads": [
            "(arrayLike: ArrayLike<number>): Uint8Array<ArrayBuffer>",
            "<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Uint8Array<ArrayBuffer>",
            "(elements: Iterable<number>): Uint8Array<ArrayBuffer>",
            "<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Uint8Array<ArrayBuffer>"
          ],
          "type": "{ (arrayLike: ArrayLike<number>): Uint8Array<ArrayBuffer>; <T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Uint8Array<ArrayBuffer>; (elements: Iterable<number>): Uint8Array<ArrayBuffer>; <T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Uint8Array<ArrayBuffer>; }",
          "description": "Creates an array from an array-like or iterable object."
        },
        {
          "name": "of",
          "path": "Uint8Array.of",
          "kind": "function",
          "signature": "(...items: number[]): Uint8Array<ArrayBuffer>",
          "overloads": [
            "(...items: number[]): Uint8Array<ArrayBuffer>"
          ],
          "type": "(...items: number[]) => Uint8Array<ArrayBuffer>",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Uint8Array.prototype.at",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "buffer",
          "path": "Uint8Array.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": "The ArrayBuffer instance referenced by the array."
        },
        {
          "name": "byteLength",
          "path": "Uint8Array.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The length in bytes of the array."
        },
        {
          "name": "byteOffset",
          "path": "Uint8Array.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The offset in bytes of the array."
        },
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Uint8Array.prototype.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "copyWithin",
          "path": "Uint8Array.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): Uint8Array<TArrayBuffer>",
          "overloads": [
            "(target: number, start: number, end?: number): Uint8Array<TArrayBuffer>"
          ],
          "type": "(target: number, start: number, end?: number) => Uint8Array<TArrayBuffer>",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Uint8Array.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, number]>",
          "overloads": [
            "(): ArrayIterator<[number, number]>"
          ],
          "type": "() => ArrayIterator<[number, number]>",
          "description": "Returns an array of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Uint8Array.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Uint8Array.prototype.fill",
          "kind": "function",
          "signature": "(value: number, start?: number, end?: number): Uint8Array<TArrayBuffer>",
          "overloads": [
            "(value: number, start?: number, end?: number): Uint8Array<TArrayBuffer>"
          ],
          "type": "(value: number, start?: number, end?: number) => Uint8Array<TArrayBuffer>",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Uint8Array.prototype.filter",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => any, thisArg?: any): Uint8Array<ArrayBuffer>",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => any, thisArg?: any): Uint8Array<ArrayBuffer>"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => any, thisArg?: any) => Uint8Array<ArrayBuffer>",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Uint8Array.prototype.find",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Uint8Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Uint8Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Uint8Array<TArrayBuffer>) => boolean, thisArg?: any) => number | undefined",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Uint8Array.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Uint8Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Uint8Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Uint8Array<TArrayBuffer>) => boolean, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Uint8Array.prototype.findLast",
          "kind": "function",
          "signature": "<S extends number>(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends number>(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => value is S, thisArg?: any): S",
            "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "{ <S extends number>(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => value is S, thisArg?: any): S; (predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any): number | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Uint8Array.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "forEach",
          "path": "Uint8Array.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Uint8Array.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: number, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: number, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Uint8Array.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array."
        },
        {
          "name": "join",
          "path": "Uint8Array.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Uint8Array.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Uint8Array.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a value in an array."
        },
        {
          "name": "map",
          "path": "Uint8Array.prototype.map",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => number, thisArg?: any): Uint8Array<ArrayBuffer>",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => number, thisArg?: any): Uint8Array<ArrayBuffer>"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => number, thisArg?: any) => Uint8Array<ArrayBuffer>",
          "description": "Calls a defined callback function on each element of an array, and returns an array that\ncontains the results."
        },
        {
          "name": "reduce",
          "path": "Uint8Array.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of\nthe callback function is the accumulated result, and is provided as an argument in the next\ncall to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Uint8Array.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order.\nThe return value of the callback function is the accumulated result, and is provided as an\nargument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Uint8Array.prototype.reverse",
          "kind": "function",
          "signature": "(): Uint8Array<TArrayBuffer>",
          "overloads": [
            "(): Uint8Array<TArrayBuffer>"
          ],
          "type": "() => Uint8Array<TArrayBuffer>",
          "description": "Reverses the elements in an Array."
        },
        {
          "name": "set",
          "path": "Uint8Array.prototype.set",
          "kind": "function",
          "signature": "(array: ArrayLike<number>, offset?: number): void",
          "overloads": [
            "(array: ArrayLike<number>, offset?: number): void"
          ],
          "type": "(array: ArrayLike<number>, offset?: number) => void",
          "description": "Sets a value or an array of values."
        },
        {
          "name": "slice",
          "path": "Uint8Array.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): Uint8Array<ArrayBuffer>",
          "overloads": [
            "(start?: number, end?: number): Uint8Array<ArrayBuffer>"
          ],
          "type": "(start?: number, end?: number) => Uint8Array<ArrayBuffer>",
          "description": "Returns a section of an array."
        },
        {
          "name": "some",
          "path": "Uint8Array.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint8Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Uint8Array.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Uint8Array<TArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Uint8Array<TArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Uint8Array<TArrayBuffer>",
          "description": "Sorts an array."
        },
        {
          "name": "subarray",
          "path": "Uint8Array.prototype.subarray",
          "kind": "function",
          "signature": "(begin?: number, end?: number): Uint8Array<TArrayBuffer>",
          "overloads": [
            "(begin?: number, end?: number): Uint8Array<TArrayBuffer>"
          ],
          "type": "(begin?: number, end?: number) => Uint8Array<TArrayBuffer>",
          "description": "Gets a new Uint8Array view of the ArrayBuffer store for this array, referencing the elements\nat begin, inclusive, up to end, exclusive."
        },
        {
          "name": "toLocaleString",
          "path": "Uint8Array.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales: string | string[], options?: NumberFormatOptions): string"
          ],
          "type": "{ (): string; (locales: string | string[], options?: Intl.NumberFormatOptions): string; }",
          "description": "Converts a number to a string by using the current locale."
        },
        {
          "name": "toReversed",
          "path": "Uint8Array.prototype.toReversed",
          "kind": "function",
          "signature": "(): Uint8Array<ArrayBuffer>",
          "overloads": [
            "(): Uint8Array<ArrayBuffer>"
          ],
          "type": "() => Uint8Array<ArrayBuffer>",
          "description": "Copies the array and returns the copy with the elements in reverse order."
        },
        {
          "name": "toSorted",
          "path": "Uint8Array.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Uint8Array<ArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Uint8Array<ArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Uint8Array<ArrayBuffer>",
          "description": "Copies and sorts the array."
        },
        {
          "name": "toString",
          "path": "Uint8Array.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "valueOf",
          "path": "Uint8Array.prototype.valueOf",
          "kind": "function",
          "signature": "(): Uint8Array<TArrayBuffer>",
          "overloads": [
            "(): Uint8Array<TArrayBuffer>"
          ],
          "type": "() => Uint8Array<TArrayBuffer>",
          "description": "Returns the primitive value of the specified object."
        },
        {
          "name": "values",
          "path": "Uint8Array.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of values in the array"
        },
        {
          "name": "with",
          "path": "Uint8Array.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: number): Uint8Array<ArrayBuffer>",
          "overloads": [
            "(index: number, value: number): Uint8Array<ArrayBuffer>"
          ],
          "type": "(index: number, value: number) => Uint8Array<ArrayBuffer>",
          "description": "Copies the array and inserts the given number at the provided index."
        }
      ]
    },
    "Uint8ClampedArray": {
      "static": [
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Uint8ClampedArray.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "from",
          "path": "Uint8ClampedArray.from",
          "kind": "function",
          "signature": "(arrayLike: ArrayLike<number>): Uint8ClampedArray<ArrayBuffer>",
          "overloads": [
            "(arrayLike: ArrayLike<number>): Uint8ClampedArray<ArrayBuffer>",
            "<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Uint8ClampedArray<ArrayBuffer>",
            "(elements: Iterable<number>): Uint8ClampedArray<ArrayBuffer>",
            "<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Uint8ClampedArray<ArrayBuffer>"
          ],
          "type": "{ (arrayLike: ArrayLike<number>): Uint8ClampedArray<ArrayBuffer>; <T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Uint8ClampedArray<ArrayBuffer>; (elements: Iterable<number>): Uint8ClampedArray<ArrayBuffer>; <T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Uint8ClampedArray<ArrayBuffer>; }",
          "description": "Creates an array from an array-like or iterable object."
        },
        {
          "name": "of",
          "path": "Uint8ClampedArray.of",
          "kind": "function",
          "signature": "(...items: number[]): Uint8ClampedArray<ArrayBuffer>",
          "overloads": [
            "(...items: number[]): Uint8ClampedArray<ArrayBuffer>"
          ],
          "type": "(...items: number[]) => Uint8ClampedArray<ArrayBuffer>",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Uint8ClampedArray.prototype.at",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "buffer",
          "path": "Uint8ClampedArray.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": "The ArrayBuffer instance referenced by the array."
        },
        {
          "name": "byteLength",
          "path": "Uint8ClampedArray.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The length in bytes of the array."
        },
        {
          "name": "byteOffset",
          "path": "Uint8ClampedArray.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The offset in bytes of the array."
        },
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Uint8ClampedArray.prototype.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "copyWithin",
          "path": "Uint8ClampedArray.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): Uint8ClampedArray<TArrayBuffer>",
          "overloads": [
            "(target: number, start: number, end?: number): Uint8ClampedArray<TArrayBuffer>"
          ],
          "type": "(target: number, start: number, end?: number) => Uint8ClampedArray<TArrayBuffer>",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Uint8ClampedArray.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, number]>",
          "overloads": [
            "(): ArrayIterator<[number, number]>"
          ],
          "type": "() => ArrayIterator<[number, number]>",
          "description": "Returns an array of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Uint8ClampedArray.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Uint8ClampedArray.prototype.fill",
          "kind": "function",
          "signature": "(value: number, start?: number, end?: number): Uint8ClampedArray<TArrayBuffer>",
          "overloads": [
            "(value: number, start?: number, end?: number): Uint8ClampedArray<TArrayBuffer>"
          ],
          "type": "(value: number, start?: number, end?: number) => Uint8ClampedArray<TArrayBuffer>",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Uint8ClampedArray.prototype.filter",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => any, thisArg?: any): Uint8ClampedArray<ArrayBuffer>",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => any, thisArg?: any): Uint8ClampedArray<ArrayBuffer>"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => any, thisArg?: any) => Uint8ClampedArray<ArrayBuffer>",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Uint8ClampedArray.prototype.find",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Uint8ClampedArray<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Uint8ClampedArray<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Uint8ClampedArray<TArrayBuffer>) => boolean, thisArg?: any) => number | undefined",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Uint8ClampedArray.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Uint8ClampedArray<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Uint8ClampedArray<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Uint8ClampedArray<TArrayBuffer>) => boolean, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Uint8ClampedArray.prototype.findLast",
          "kind": "function",
          "signature": "<S extends number>(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends number>(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => value is S, thisArg?: any): S",
            "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "{ <S extends number>(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => value is S, thisArg?: any): S; (predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any): number | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Uint8ClampedArray.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "forEach",
          "path": "Uint8ClampedArray.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Uint8ClampedArray.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: number, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: number, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Uint8ClampedArray.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array."
        },
        {
          "name": "join",
          "path": "Uint8ClampedArray.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Uint8ClampedArray.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Uint8ClampedArray.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a value in an array."
        },
        {
          "name": "map",
          "path": "Uint8ClampedArray.prototype.map",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => number, thisArg?: any): Uint8ClampedArray<ArrayBuffer>",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => number, thisArg?: any): Uint8ClampedArray<ArrayBuffer>"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => number, thisArg?: any) => Uint8ClampedArray<ArrayBuffer>",
          "description": "Calls a defined callback function on each element of an array, and returns an array that\ncontains the results."
        },
        {
          "name": "reduce",
          "path": "Uint8ClampedArray.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of\nthe callback function is the accumulated result, and is provided as an argument in the next\ncall to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Uint8ClampedArray.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint8ClampedArray<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order.\nThe return value of the callback function is the accumulated result, and is provided as an\nargument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Uint8ClampedArray.prototype.reverse",
          "kind": "function",
          "signature": "(): Uint8ClampedArray<TArrayBuffer>",
          "overloads": [
            "(): Uint8ClampedArray<TArrayBuffer>"
          ],
          "type": "() => Uint8ClampedArray<TArrayBuffer>",
          "description": "Reverses the elements in an Array."
        },
        {
          "name": "set",
          "path": "Uint8ClampedArray.prototype.set",
          "kind": "function",
          "signature": "(array: ArrayLike<number>, offset?: number): void",
          "overloads": [
            "(array: ArrayLike<number>, offset?: number): void"
          ],
          "type": "(array: ArrayLike<number>, offset?: number) => void",
          "description": "Sets a value or an array of values."
        },
        {
          "name": "slice",
          "path": "Uint8ClampedArray.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): Uint8ClampedArray<ArrayBuffer>",
          "overloads": [
            "(start?: number, end?: number): Uint8ClampedArray<ArrayBuffer>"
          ],
          "type": "(start?: number, end?: number) => Uint8ClampedArray<ArrayBuffer>",
          "description": "Returns a section of an array."
        },
        {
          "name": "some",
          "path": "Uint8ClampedArray.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint8ClampedArray<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Uint8ClampedArray.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Uint8ClampedArray<TArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Uint8ClampedArray<TArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Uint8ClampedArray<TArrayBuffer>",
          "description": "Sorts an array."
        },
        {
          "name": "subarray",
          "path": "Uint8ClampedArray.prototype.subarray",
          "kind": "function",
          "signature": "(begin?: number, end?: number): Uint8ClampedArray<TArrayBuffer>",
          "overloads": [
            "(begin?: number, end?: number): Uint8ClampedArray<TArrayBuffer>"
          ],
          "type": "(begin?: number, end?: number) => Uint8ClampedArray<TArrayBuffer>",
          "description": "Gets a new Uint8ClampedArray view of the ArrayBuffer store for this array, referencing the elements\nat begin, inclusive, up to end, exclusive."
        },
        {
          "name": "toLocaleString",
          "path": "Uint8ClampedArray.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales: string | string[], options?: NumberFormatOptions): string"
          ],
          "type": "{ (): string; (locales: string | string[], options?: Intl.NumberFormatOptions): string; }",
          "description": "Converts a number to a string by using the current locale."
        },
        {
          "name": "toReversed",
          "path": "Uint8ClampedArray.prototype.toReversed",
          "kind": "function",
          "signature": "(): Uint8ClampedArray<ArrayBuffer>",
          "overloads": [
            "(): Uint8ClampedArray<ArrayBuffer>"
          ],
          "type": "() => Uint8ClampedArray<ArrayBuffer>",
          "description": "Copies the array and returns the copy with the elements in reverse order."
        },
        {
          "name": "toSorted",
          "path": "Uint8ClampedArray.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Uint8ClampedArray<ArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Uint8ClampedArray<ArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Uint8ClampedArray<ArrayBuffer>",
          "description": "Copies and sorts the array."
        },
        {
          "name": "toString",
          "path": "Uint8ClampedArray.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "valueOf",
          "path": "Uint8ClampedArray.prototype.valueOf",
          "kind": "function",
          "signature": "(): Uint8ClampedArray<TArrayBuffer>",
          "overloads": [
            "(): Uint8ClampedArray<TArrayBuffer>"
          ],
          "type": "() => Uint8ClampedArray<TArrayBuffer>",
          "description": "Returns the primitive value of the specified object."
        },
        {
          "name": "values",
          "path": "Uint8ClampedArray.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of values in the array"
        },
        {
          "name": "with",
          "path": "Uint8ClampedArray.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: number): Uint8ClampedArray<ArrayBuffer>",
          "overloads": [
            "(index: number, value: number): Uint8ClampedArray<ArrayBuffer>"
          ],
          "type": "(index: number, value: number) => Uint8ClampedArray<ArrayBuffer>",
          "description": "Copies the array and inserts the given number at the provided index."
        }
      ]
    },
    "Uint16Array": {
      "static": [
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Uint16Array.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "from",
          "path": "Uint16Array.from",
          "kind": "function",
          "signature": "(arrayLike: ArrayLike<number>): Uint16Array<ArrayBuffer>",
          "overloads": [
            "(arrayLike: ArrayLike<number>): Uint16Array<ArrayBuffer>",
            "<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Uint16Array<ArrayBuffer>",
            "(elements: Iterable<number>): Uint16Array<ArrayBuffer>",
            "<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Uint16Array<ArrayBuffer>"
          ],
          "type": "{ (arrayLike: ArrayLike<number>): Uint16Array<ArrayBuffer>; <T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Uint16Array<ArrayBuffer>; (elements: Iterable<number>): Uint16Array<ArrayBuffer>; <T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Uint16Array<ArrayBuffer>; }",
          "description": "Creates an array from an array-like or iterable object."
        },
        {
          "name": "of",
          "path": "Uint16Array.of",
          "kind": "function",
          "signature": "(...items: number[]): Uint16Array<ArrayBuffer>",
          "overloads": [
            "(...items: number[]): Uint16Array<ArrayBuffer>"
          ],
          "type": "(...items: number[]) => Uint16Array<ArrayBuffer>",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Uint16Array.prototype.at",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "buffer",
          "path": "Uint16Array.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": "The ArrayBuffer instance referenced by the array."
        },
        {
          "name": "byteLength",
          "path": "Uint16Array.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The length in bytes of the array."
        },
        {
          "name": "byteOffset",
          "path": "Uint16Array.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The offset in bytes of the array."
        },
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Uint16Array.prototype.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "copyWithin",
          "path": "Uint16Array.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): Uint16Array<TArrayBuffer>",
          "overloads": [
            "(target: number, start: number, end?: number): Uint16Array<TArrayBuffer>"
          ],
          "type": "(target: number, start: number, end?: number) => Uint16Array<TArrayBuffer>",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Uint16Array.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, number]>",
          "overloads": [
            "(): ArrayIterator<[number, number]>"
          ],
          "type": "() => ArrayIterator<[number, number]>",
          "description": "Returns an array of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Uint16Array.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Uint16Array.prototype.fill",
          "kind": "function",
          "signature": "(value: number, start?: number, end?: number): Uint16Array<TArrayBuffer>",
          "overloads": [
            "(value: number, start?: number, end?: number): Uint16Array<TArrayBuffer>"
          ],
          "type": "(value: number, start?: number, end?: number) => Uint16Array<TArrayBuffer>",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Uint16Array.prototype.filter",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => any, thisArg?: any): Uint16Array<ArrayBuffer>",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => any, thisArg?: any): Uint16Array<ArrayBuffer>"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => any, thisArg?: any) => Uint16Array<ArrayBuffer>",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Uint16Array.prototype.find",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Uint16Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Uint16Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Uint16Array<TArrayBuffer>) => boolean, thisArg?: any) => number | undefined",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Uint16Array.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Uint16Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Uint16Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Uint16Array<TArrayBuffer>) => boolean, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Uint16Array.prototype.findLast",
          "kind": "function",
          "signature": "<S extends number>(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends number>(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => value is S, thisArg?: any): S",
            "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "{ <S extends number>(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => value is S, thisArg?: any): S; (predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any): number | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Uint16Array.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "forEach",
          "path": "Uint16Array.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Uint16Array.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: number, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: number, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Uint16Array.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array."
        },
        {
          "name": "join",
          "path": "Uint16Array.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Uint16Array.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Uint16Array.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a value in an array."
        },
        {
          "name": "map",
          "path": "Uint16Array.prototype.map",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => number, thisArg?: any): Uint16Array<ArrayBuffer>",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => number, thisArg?: any): Uint16Array<ArrayBuffer>"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => number, thisArg?: any) => Uint16Array<ArrayBuffer>",
          "description": "Calls a defined callback function on each element of an array, and returns an array that\ncontains the results."
        },
        {
          "name": "reduce",
          "path": "Uint16Array.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of\nthe callback function is the accumulated result, and is provided as an argument in the next\ncall to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Uint16Array.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint16Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order.\nThe return value of the callback function is the accumulated result, and is provided as an\nargument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Uint16Array.prototype.reverse",
          "kind": "function",
          "signature": "(): Uint16Array<TArrayBuffer>",
          "overloads": [
            "(): Uint16Array<TArrayBuffer>"
          ],
          "type": "() => Uint16Array<TArrayBuffer>",
          "description": "Reverses the elements in an Array."
        },
        {
          "name": "set",
          "path": "Uint16Array.prototype.set",
          "kind": "function",
          "signature": "(array: ArrayLike<number>, offset?: number): void",
          "overloads": [
            "(array: ArrayLike<number>, offset?: number): void"
          ],
          "type": "(array: ArrayLike<number>, offset?: number) => void",
          "description": "Sets a value or an array of values."
        },
        {
          "name": "slice",
          "path": "Uint16Array.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): Uint16Array<ArrayBuffer>",
          "overloads": [
            "(start?: number, end?: number): Uint16Array<ArrayBuffer>"
          ],
          "type": "(start?: number, end?: number) => Uint16Array<ArrayBuffer>",
          "description": "Returns a section of an array."
        },
        {
          "name": "some",
          "path": "Uint16Array.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint16Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Uint16Array.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Uint16Array<TArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Uint16Array<TArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Uint16Array<TArrayBuffer>",
          "description": "Sorts an array."
        },
        {
          "name": "subarray",
          "path": "Uint16Array.prototype.subarray",
          "kind": "function",
          "signature": "(begin?: number, end?: number): Uint16Array<TArrayBuffer>",
          "overloads": [
            "(begin?: number, end?: number): Uint16Array<TArrayBuffer>"
          ],
          "type": "(begin?: number, end?: number) => Uint16Array<TArrayBuffer>",
          "description": "Gets a new Uint16Array view of the ArrayBuffer store for this array, referencing the elements\nat begin, inclusive, up to end, exclusive."
        },
        {
          "name": "toLocaleString",
          "path": "Uint16Array.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales: string | string[], options?: NumberFormatOptions): string"
          ],
          "type": "{ (): string; (locales: string | string[], options?: Intl.NumberFormatOptions): string; }",
          "description": "Converts a number to a string by using the current locale."
        },
        {
          "name": "toReversed",
          "path": "Uint16Array.prototype.toReversed",
          "kind": "function",
          "signature": "(): Uint16Array<ArrayBuffer>",
          "overloads": [
            "(): Uint16Array<ArrayBuffer>"
          ],
          "type": "() => Uint16Array<ArrayBuffer>",
          "description": "Copies the array and returns the copy with the elements in reverse order."
        },
        {
          "name": "toSorted",
          "path": "Uint16Array.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Uint16Array<ArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Uint16Array<ArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Uint16Array<ArrayBuffer>",
          "description": "Copies and sorts the array."
        },
        {
          "name": "toString",
          "path": "Uint16Array.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "valueOf",
          "path": "Uint16Array.prototype.valueOf",
          "kind": "function",
          "signature": "(): Uint16Array<TArrayBuffer>",
          "overloads": [
            "(): Uint16Array<TArrayBuffer>"
          ],
          "type": "() => Uint16Array<TArrayBuffer>",
          "description": "Returns the primitive value of the specified object."
        },
        {
          "name": "values",
          "path": "Uint16Array.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of values in the array"
        },
        {
          "name": "with",
          "path": "Uint16Array.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: number): Uint16Array<ArrayBuffer>",
          "overloads": [
            "(index: number, value: number): Uint16Array<ArrayBuffer>"
          ],
          "type": "(index: number, value: number) => Uint16Array<ArrayBuffer>",
          "description": "Copies the array and inserts the given number at the provided index."
        }
      ]
    },
    "Uint32Array": {
      "static": [
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Uint32Array.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "from",
          "path": "Uint32Array.from",
          "kind": "function",
          "signature": "(arrayLike: ArrayLike<number>): Uint32Array<ArrayBuffer>",
          "overloads": [
            "(arrayLike: ArrayLike<number>): Uint32Array<ArrayBuffer>",
            "<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Uint32Array<ArrayBuffer>",
            "(elements: Iterable<number>): Uint32Array<ArrayBuffer>",
            "<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Uint32Array<ArrayBuffer>"
          ],
          "type": "{ (arrayLike: ArrayLike<number>): Uint32Array<ArrayBuffer>; <T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): Uint32Array<ArrayBuffer>; (elements: Iterable<number>): Uint32Array<ArrayBuffer>; <T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): Uint32Array<ArrayBuffer>; }",
          "description": "Creates an array from an array-like or iterable object."
        },
        {
          "name": "of",
          "path": "Uint32Array.of",
          "kind": "function",
          "signature": "(...items: number[]): Uint32Array<ArrayBuffer>",
          "overloads": [
            "(...items: number[]): Uint32Array<ArrayBuffer>"
          ],
          "type": "(...items: number[]) => Uint32Array<ArrayBuffer>",
          "description": "Returns a new array from a set of elements."
        }
      ],
      "instance": [
        {
          "name": "at",
          "path": "Uint32Array.prototype.at",
          "kind": "function",
          "signature": "(index: number): number",
          "overloads": [
            "(index: number): number"
          ],
          "type": "(index: number) => number | undefined",
          "description": "Returns the item located at the specified index."
        },
        {
          "name": "buffer",
          "path": "Uint32Array.prototype.buffer",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "TArrayBuffer",
          "description": "The ArrayBuffer instance referenced by the array."
        },
        {
          "name": "byteLength",
          "path": "Uint32Array.prototype.byteLength",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The length in bytes of the array."
        },
        {
          "name": "byteOffset",
          "path": "Uint32Array.prototype.byteOffset",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The offset in bytes of the array."
        },
        {
          "name": "BYTES_PER_ELEMENT",
          "path": "Uint32Array.prototype.BYTES_PER_ELEMENT",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "number",
          "description": "The size in bytes of each element in the array."
        },
        {
          "name": "copyWithin",
          "path": "Uint32Array.prototype.copyWithin",
          "kind": "function",
          "signature": "(target: number, start: number, end?: number): Uint32Array<TArrayBuffer>",
          "overloads": [
            "(target: number, start: number, end?: number): Uint32Array<TArrayBuffer>"
          ],
          "type": "(target: number, start: number, end?: number) => Uint32Array<TArrayBuffer>",
          "description": "Returns the this object after copying a section of the array identified by start and end\nto the same array starting at position target"
        },
        {
          "name": "entries",
          "path": "Uint32Array.prototype.entries",
          "kind": "function",
          "signature": "(): ArrayIterator<[number, number]>",
          "overloads": [
            "(): ArrayIterator<[number, number]>"
          ],
          "type": "() => ArrayIterator<[number, number]>",
          "description": "Returns an array of key, value pairs for every entry in the array"
        },
        {
          "name": "every",
          "path": "Uint32Array.prototype.every",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether all the members of an array satisfy the specified test."
        },
        {
          "name": "fill",
          "path": "Uint32Array.prototype.fill",
          "kind": "function",
          "signature": "(value: number, start?: number, end?: number): Uint32Array<TArrayBuffer>",
          "overloads": [
            "(value: number, start?: number, end?: number): Uint32Array<TArrayBuffer>"
          ],
          "type": "(value: number, start?: number, end?: number) => Uint32Array<TArrayBuffer>",
          "description": "Changes all array elements from `start` to `end` index to a static `value` and returns the modified array"
        },
        {
          "name": "filter",
          "path": "Uint32Array.prototype.filter",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => any, thisArg?: any): Uint32Array<ArrayBuffer>",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => any, thisArg?: any): Uint32Array<ArrayBuffer>"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => any, thisArg?: any) => Uint32Array<ArrayBuffer>",
          "description": "Returns the elements of an array that meet the condition specified in a callback function."
        },
        {
          "name": "find",
          "path": "Uint32Array.prototype.find",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Uint32Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Uint32Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Uint32Array<TArrayBuffer>) => boolean, thisArg?: any) => number | undefined",
          "description": "Returns the value of the first element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findIndex",
          "path": "Uint32Array.prototype.findIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, obj: Uint32Array<TArrayBuffer>) => boolean, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, obj: Uint32Array<TArrayBuffer>) => boolean, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, obj: Uint32Array<TArrayBuffer>) => boolean, thisArg?: any) => number",
          "description": "Returns the index of the first element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "findLast",
          "path": "Uint32Array.prototype.findLast",
          "kind": "function",
          "signature": "<S extends number>(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => value is S, thisArg?: any): S",
          "overloads": [
            "<S extends number>(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => value is S, thisArg?: any): S",
            "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "{ <S extends number>(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => value is S, thisArg?: any): S; (predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any): number | undefined; }",
          "description": "Returns the value of the last element in the array where predicate is true, and undefined\notherwise."
        },
        {
          "name": "findLastIndex",
          "path": "Uint32Array.prototype.findLastIndex",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any): number",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any): number"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any) => number",
          "description": "Returns the index of the last element in the array where predicate is true, and -1\notherwise."
        },
        {
          "name": "forEach",
          "path": "Uint32Array.prototype.forEach",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => void, thisArg?: any): void",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => void, thisArg?: any): void"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => void, thisArg?: any) => void",
          "description": "Performs the specified action for each element in an array."
        },
        {
          "name": "includes",
          "path": "Uint32Array.prototype.includes",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): boolean",
          "overloads": [
            "(searchElement: number, fromIndex?: number): boolean"
          ],
          "type": "(searchElement: number, fromIndex?: number) => boolean",
          "description": "Determines whether an array includes a certain element, returning true or false as appropriate."
        },
        {
          "name": "indexOf",
          "path": "Uint32Array.prototype.indexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the first occurrence of a value in an array."
        },
        {
          "name": "join",
          "path": "Uint32Array.prototype.join",
          "kind": "function",
          "signature": "(separator?: string): string",
          "overloads": [
            "(separator?: string): string"
          ],
          "type": "(separator?: string) => string",
          "description": "Adds all the elements of an array separated by the specified separator string."
        },
        {
          "name": "keys",
          "path": "Uint32Array.prototype.keys",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of keys in the array"
        },
        {
          "name": "lastIndexOf",
          "path": "Uint32Array.prototype.lastIndexOf",
          "kind": "function",
          "signature": "(searchElement: number, fromIndex?: number): number",
          "overloads": [
            "(searchElement: number, fromIndex?: number): number"
          ],
          "type": "(searchElement: number, fromIndex?: number) => number",
          "description": "Returns the index of the last occurrence of a value in an array."
        },
        {
          "name": "map",
          "path": "Uint32Array.prototype.map",
          "kind": "function",
          "signature": "(callbackfn: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => number, thisArg?: any): Uint32Array<ArrayBuffer>",
          "overloads": [
            "(callbackfn: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => number, thisArg?: any): Uint32Array<ArrayBuffer>"
          ],
          "type": "(callbackfn: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => number, thisArg?: any) => Uint32Array<ArrayBuffer>",
          "description": "Calls a defined callback function on each element of an array, and returns an array that\ncontains the results."
        },
        {
          "name": "reduce",
          "path": "Uint32Array.prototype.reduce",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array. The return value of\nthe callback function is the accumulated result, and is provided as an argument in the next\ncall to the callback function."
        },
        {
          "name": "reduceRight",
          "path": "Uint32Array.prototype.reduceRight",
          "kind": "function",
          "signature": "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => number): number",
          "overloads": [
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => number): number",
            "(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => number, initialValue: number): number",
            "<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => U, initialValue: U): U"
          ],
          "type": "{ (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => number): number; (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => number, initialValue: number): number; <U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: Uint32Array<TArrayBuffer>) => U, initialValue: U): U; }",
          "description": "Calls the specified callback function for all the elements in an array, in descending order.\nThe return value of the callback function is the accumulated result, and is provided as an\nargument in the next call to the callback function."
        },
        {
          "name": "reverse",
          "path": "Uint32Array.prototype.reverse",
          "kind": "function",
          "signature": "(): Uint32Array<TArrayBuffer>",
          "overloads": [
            "(): Uint32Array<TArrayBuffer>"
          ],
          "type": "() => Uint32Array<TArrayBuffer>",
          "description": "Reverses the elements in an Array."
        },
        {
          "name": "set",
          "path": "Uint32Array.prototype.set",
          "kind": "function",
          "signature": "(array: ArrayLike<number>, offset?: number): void",
          "overloads": [
            "(array: ArrayLike<number>, offset?: number): void"
          ],
          "type": "(array: ArrayLike<number>, offset?: number) => void",
          "description": "Sets a value or an array of values."
        },
        {
          "name": "slice",
          "path": "Uint32Array.prototype.slice",
          "kind": "function",
          "signature": "(start?: number, end?: number): Uint32Array<ArrayBuffer>",
          "overloads": [
            "(start?: number, end?: number): Uint32Array<ArrayBuffer>"
          ],
          "type": "(start?: number, end?: number) => Uint32Array<ArrayBuffer>",
          "description": "Returns a section of an array."
        },
        {
          "name": "some",
          "path": "Uint32Array.prototype.some",
          "kind": "function",
          "signature": "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean",
          "overloads": [
            "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any): boolean"
          ],
          "type": "(predicate: (value: number, index: number, array: Uint32Array<TArrayBuffer>) => unknown, thisArg?: any) => boolean",
          "description": "Determines whether the specified callback function returns true for any element of an array."
        },
        {
          "name": "sort",
          "path": "Uint32Array.prototype.sort",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Uint32Array<TArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Uint32Array<TArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Uint32Array<TArrayBuffer>",
          "description": "Sorts an array."
        },
        {
          "name": "subarray",
          "path": "Uint32Array.prototype.subarray",
          "kind": "function",
          "signature": "(begin?: number, end?: number): Uint32Array<TArrayBuffer>",
          "overloads": [
            "(begin?: number, end?: number): Uint32Array<TArrayBuffer>"
          ],
          "type": "(begin?: number, end?: number) => Uint32Array<TArrayBuffer>",
          "description": "Gets a new Uint32Array view of the ArrayBuffer store for this array, referencing the elements\nat begin, inclusive, up to end, exclusive."
        },
        {
          "name": "toLocaleString",
          "path": "Uint32Array.prototype.toLocaleString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string",
            "(locales: string | string[], options?: NumberFormatOptions): string"
          ],
          "type": "{ (): string; (locales: string | string[], options?: Intl.NumberFormatOptions): string; }",
          "description": "Converts a number to a string by using the current locale."
        },
        {
          "name": "toReversed",
          "path": "Uint32Array.prototype.toReversed",
          "kind": "function",
          "signature": "(): Uint32Array<ArrayBuffer>",
          "overloads": [
            "(): Uint32Array<ArrayBuffer>"
          ],
          "type": "() => Uint32Array<ArrayBuffer>",
          "description": "Copies the array and returns the copy with the elements in reverse order."
        },
        {
          "name": "toSorted",
          "path": "Uint32Array.prototype.toSorted",
          "kind": "function",
          "signature": "(compareFn?: (a: number, b: number) => number): Uint32Array<ArrayBuffer>",
          "overloads": [
            "(compareFn?: (a: number, b: number) => number): Uint32Array<ArrayBuffer>"
          ],
          "type": "(compareFn?: (a: number, b: number) => number) => Uint32Array<ArrayBuffer>",
          "description": "Copies and sorts the array."
        },
        {
          "name": "toString",
          "path": "Uint32Array.prototype.toString",
          "kind": "function",
          "signature": "(): string",
          "overloads": [
            "(): string"
          ],
          "type": "() => string",
          "description": "Returns a string representation of an array."
        },
        {
          "name": "valueOf",
          "path": "Uint32Array.prototype.valueOf",
          "kind": "function",
          "signature": "(): Uint32Array<TArrayBuffer>",
          "overloads": [
            "(): Uint32Array<TArrayBuffer>"
          ],
          "type": "() => Uint32Array<TArrayBuffer>",
          "description": "Returns the primitive value of the specified object."
        },
        {
          "name": "values",
          "path": "Uint32Array.prototype.values",
          "kind": "function",
          "signature": "(): ArrayIterator<number>",
          "overloads": [
            "(): ArrayIterator<number>"
          ],
          "type": "() => ArrayIterator<number>",
          "description": "Returns an list of values in the array"
        },
        {
          "name": "with",
          "path": "Uint32Array.prototype.with",
          "kind": "function",
          "signature": "(index: number, value: number): Uint32Array<ArrayBuffer>",
          "overloads": [
            "(index: number, value: number): Uint32Array<ArrayBuffer>"
          ],
          "type": "(index: number, value: number) => Uint32Array<ArrayBuffer>",
          "description": "Copies the array and inserts the given number at the provided index."
        }
      ]
    },
    "URIError": {
      "static": [
        {
          "name": "isError",
          "path": "URIError.isError",
          "kind": "function",
          "signature": "(error: unknown): error is Error",
          "overloads": [
            "(error: unknown): error is Error"
          ],
          "type": "(error: unknown) => error is Error",
          "description": "Indicates whether the argument provided is a built-in Error instance or not."
        }
      ],
      "instance": [
        {
          "name": "cause",
          "path": "URIError.prototype.cause",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "unknown",
          "description": ""
        },
        {
          "name": "message",
          "path": "URIError.prototype.message",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        },
        {
          "name": "stack",
          "path": "URIError.prototype.stack",
          "kind": "property",
          "signature": "",
          "overloads": [],
          "type": "string",
          "description": ""
        }
      ]
    },
    "WeakMap": {
      "static": [],
      "instance": [
        {
          "name": "delete",
          "path": "WeakMap.prototype.delete",
          "kind": "function",
          "signature": "(key: K): boolean",
          "overloads": [
            "(key: K): boolean"
          ],
          "type": "(key: K) => boolean",
          "description": "Removes the specified element from the WeakMap."
        },
        {
          "name": "get",
          "path": "WeakMap.prototype.get",
          "kind": "function",
          "signature": "(key: K): V",
          "overloads": [
            "(key: K): V"
          ],
          "type": "(key: K) => V | undefined",
          "description": ""
        },
        {
          "name": "has",
          "path": "WeakMap.prototype.has",
          "kind": "function",
          "signature": "(key: K): boolean",
          "overloads": [
            "(key: K): boolean"
          ],
          "type": "(key: K) => boolean",
          "description": ""
        },
        {
          "name": "set",
          "path": "WeakMap.prototype.set",
          "kind": "function",
          "signature": "(key: K, value: V): WeakMap<K, V>",
          "overloads": [
            "(key: K, value: V): WeakMap<K, V>"
          ],
          "type": "(key: K, value: V) => WeakMap<K, V>",
          "description": "Adds a new element with a specified key and value."
        }
      ]
    },
    "WeakSet": {
      "static": [],
      "instance": [
        {
          "name": "add",
          "path": "WeakSet.prototype.add",
          "kind": "function",
          "signature": "(value: T): WeakSet<T>",
          "overloads": [
            "(value: T): WeakSet<T>"
          ],
          "type": "(value: T) => WeakSet<T>",
          "description": "Appends a new value to the end of the WeakSet."
        },
        {
          "name": "delete",
          "path": "WeakSet.prototype.delete",
          "kind": "function",
          "signature": "(value: T): boolean",
          "overloads": [
            "(value: T): boolean"
          ],
          "type": "(value: T) => boolean",
          "description": "Removes the specified element from the WeakSet."
        },
        {
          "name": "has",
          "path": "WeakSet.prototype.has",
          "kind": "function",
          "signature": "(value: T): boolean",
          "overloads": [
            "(value: T): boolean"
          ],
          "type": "(value: T) => boolean",
          "description": ""
        }
      ]
    },
    "Atomics": {
      "static": [
        {
          "name": "add",
          "path": "Atomics.add",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Adds a value to the value at the given position in the array, returning the original value.\nUntil this atomic operation completes, any other read or write operation against the array\nwill block."
        },
        {
          "name": "and",
          "path": "Atomics.and",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Stores the bitwise AND of a value with the value at the given position in the array,\nreturning the original value. Until this atomic operation completes, any other read or\nwrite operation against the array will block."
        },
        {
          "name": "compareExchange",
          "path": "Atomics.compareExchange",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, expectedValue: number, replacementValue: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, expectedValue: number, replacementValue: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, expectedValue: bigint, replacementValue: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, expectedValue: number, replacementValue: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, expectedValue: bigint, replacementValue: bigint): bigint; }",
          "description": "Replaces the value at the given position in the array if the original value equals the given\nexpected value, returning the original value. Until this atomic operation completes, any\nother read or write operation against the array will block."
        },
        {
          "name": "exchange",
          "path": "Atomics.exchange",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Replaces the value at the given position in the array, returning the original value. Until\nthis atomic operation completes, any other read or write operation against the array will\nblock."
        },
        {
          "name": "isLockFree",
          "path": "Atomics.isLockFree",
          "kind": "function",
          "signature": "(size: number): boolean",
          "overloads": [
            "(size: number): boolean"
          ],
          "type": "(size: number) => boolean",
          "description": "Returns a value indicating whether high-performance algorithms can use atomic operations\n(`true`) or must use locks (`false`) for the given number of bytes-per-element of a typed\narray."
        },
        {
          "name": "load",
          "path": "Atomics.load",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number): bigint; }",
          "description": "Returns the value at the given position in the array. Until this atomic operation completes,\nany other read or write operation against the array will block."
        },
        {
          "name": "notify",
          "path": "Atomics.notify",
          "kind": "function",
          "signature": "(typedArray: Int32Array<ArrayBufferLike>, index: number, count?: number): number",
          "overloads": [
            "(typedArray: Int32Array<ArrayBufferLike>, index: number, count?: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike>, index: number, count?: number): number"
          ],
          "type": "{ (typedArray: Int32Array<ArrayBufferLike>, index: number, count?: number): number; (typedArray: BigInt64Array<ArrayBufferLike>, index: number, count?: number): number; }",
          "description": "Wakes up sleeping agents that are waiting on the given index of the array, returning the\nnumber of agents that were awoken."
        },
        {
          "name": "or",
          "path": "Atomics.or",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Stores the bitwise OR of a value with the value at the given position in the array,\nreturning the original value. Until this atomic operation completes, any other read or write\noperation against the array will block."
        },
        {
          "name": "pause",
          "path": "Atomics.pause",
          "kind": "function",
          "signature": "(n?: number): void",
          "overloads": [
            "(n?: number): void"
          ],
          "type": "(n?: number) => void",
          "description": "Performs a finite-time microwait by signaling to the operating system or\nCPU that the current executing code is in a spin-wait loop."
        },
        {
          "name": "store",
          "path": "Atomics.store",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Stores a value at the given position in the array, returning the new value. Until this\natomic operation completes, any other read or write operation against the array will block."
        },
        {
          "name": "sub",
          "path": "Atomics.sub",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Subtracts a value from the value at the given position in the array, returning the original\nvalue. Until this atomic operation completes, any other read or write operation against the\narray will block."
        },
        {
          "name": "wait",
          "path": "Atomics.wait",
          "kind": "function",
          "signature": "(typedArray: Int32Array<ArrayBufferLike>, index: number, value: number, timeout?: number): \"ok\" | \"not-equal\" | \"timed-out\"",
          "overloads": [
            "(typedArray: Int32Array<ArrayBufferLike>, index: number, value: number, timeout?: number): \"ok\" | \"not-equal\" | \"timed-out\"",
            "(typedArray: BigInt64Array<ArrayBufferLike>, index: number, value: bigint, timeout?: number): \"ok\" | \"not-equal\" | \"timed-out\""
          ],
          "type": "{ (typedArray: Int32Array<ArrayBufferLike>, index: number, value: number, timeout?: number): \"ok\" | \"not-equal\" | \"timed-out\"; (typedArray: BigInt64Array<ArrayBufferLike>, index: number, value: bigint, timeout?: number): \"ok\" | \"not-equal\" | \"timed-out\"; }",
          "description": "If the value at the given position in the array is equal to the provided value, the current\nagent is put to sleep causing execution to suspend until the timeout expires (returning\n`\"timed-out\"`) or until the agent is awoken (returning `\"ok\"`); otherwise, returns\n`\"not-equal\"`."
        },
        {
          "name": "waitAsync",
          "path": "Atomics.waitAsync",
          "kind": "function",
          "signature": "(typedArray: Int32Array<ArrayBufferLike>, index: number, value: number, timeout?: number): { async: false; value: \"not-equal\" | \"timed-out\"; } | { async: true; value: Promise<\"ok\" | \"timed-out\">; }",
          "overloads": [
            "(typedArray: Int32Array<ArrayBufferLike>, index: number, value: number, timeout?: number): { async: false; value: \"not-equal\" | \"timed-out\"; } | { async: true; value: Promise<\"ok\" | \"timed-out\">; }",
            "(typedArray: BigInt64Array<ArrayBufferLike>, index: number, value: bigint, timeout?: number): { async: false; value: \"not-equal\" | \"timed-out\"; } | { async: true; value: Promise<\"ok\" | \"timed-out\">; }"
          ],
          "type": "{ (typedArray: Int32Array, index: number, value: number, timeout?: number): { async: false; value: \"not-equal\" | \"timed-out\"; } | { async: true; value: Promise<\"ok\" | \"timed-out\">; }; (typedArray: BigInt64Array, index: number, value: bigint, timeout?: number): { async: false; value: \"not-equal\" | \"timed-out\"; } | { async: true; value: Promise<\"ok\" | \"timed-out\">; }; }",
          "description": "A non-blocking, asynchronous version of wait which is usable on the main thread.\nWaits asynchronously on a shared memory location and returns a Promise"
        },
        {
          "name": "xor",
          "path": "Atomics.xor",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Stores the bitwise XOR of a value with the value at the given position in the array,\nreturning the original value. Until this atomic operation completes, any other read or write\noperation against the array will block."
        }
      ],
      "instance": [
        {
          "name": "add",
          "path": "Atomics.prototype.add",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Adds a value to the value at the given position in the array, returning the original value.\nUntil this atomic operation completes, any other read or write operation against the array\nwill block."
        },
        {
          "name": "and",
          "path": "Atomics.prototype.and",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Stores the bitwise AND of a value with the value at the given position in the array,\nreturning the original value. Until this atomic operation completes, any other read or\nwrite operation against the array will block."
        },
        {
          "name": "compareExchange",
          "path": "Atomics.prototype.compareExchange",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, expectedValue: number, replacementValue: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, expectedValue: number, replacementValue: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, expectedValue: bigint, replacementValue: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, expectedValue: number, replacementValue: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, expectedValue: bigint, replacementValue: bigint): bigint; }",
          "description": "Replaces the value at the given position in the array if the original value equals the given\nexpected value, returning the original value. Until this atomic operation completes, any\nother read or write operation against the array will block."
        },
        {
          "name": "exchange",
          "path": "Atomics.prototype.exchange",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Replaces the value at the given position in the array, returning the original value. Until\nthis atomic operation completes, any other read or write operation against the array will\nblock."
        },
        {
          "name": "isLockFree",
          "path": "Atomics.prototype.isLockFree",
          "kind": "function",
          "signature": "(size: number): boolean",
          "overloads": [
            "(size: number): boolean"
          ],
          "type": "(size: number) => boolean",
          "description": "Returns a value indicating whether high-performance algorithms can use atomic operations\n(`true`) or must use locks (`false`) for the given number of bytes-per-element of a typed\narray."
        },
        {
          "name": "load",
          "path": "Atomics.prototype.load",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number): bigint; }",
          "description": "Returns the value at the given position in the array. Until this atomic operation completes,\nany other read or write operation against the array will block."
        },
        {
          "name": "notify",
          "path": "Atomics.prototype.notify",
          "kind": "function",
          "signature": "(typedArray: Int32Array<ArrayBufferLike>, index: number, count?: number): number",
          "overloads": [
            "(typedArray: Int32Array<ArrayBufferLike>, index: number, count?: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike>, index: number, count?: number): number"
          ],
          "type": "{ (typedArray: Int32Array<ArrayBufferLike>, index: number, count?: number): number; (typedArray: BigInt64Array<ArrayBufferLike>, index: number, count?: number): number; }",
          "description": "Wakes up sleeping agents that are waiting on the given index of the array, returning the\nnumber of agents that were awoken."
        },
        {
          "name": "or",
          "path": "Atomics.prototype.or",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Stores the bitwise OR of a value with the value at the given position in the array,\nreturning the original value. Until this atomic operation completes, any other read or write\noperation against the array will block."
        },
        {
          "name": "pause",
          "path": "Atomics.prototype.pause",
          "kind": "function",
          "signature": "(n?: number): void",
          "overloads": [
            "(n?: number): void"
          ],
          "type": "(n?: number) => void",
          "description": "Performs a finite-time microwait by signaling to the operating system or\nCPU that the current executing code is in a spin-wait loop."
        },
        {
          "name": "store",
          "path": "Atomics.prototype.store",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Stores a value at the given position in the array, returning the new value. Until this\natomic operation completes, any other read or write operation against the array will block."
        },
        {
          "name": "sub",
          "path": "Atomics.prototype.sub",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Subtracts a value from the value at the given position in the array, returning the original\nvalue. Until this atomic operation completes, any other read or write operation against the\narray will block."
        },
        {
          "name": "wait",
          "path": "Atomics.prototype.wait",
          "kind": "function",
          "signature": "(typedArray: Int32Array<ArrayBufferLike>, index: number, value: number, timeout?: number): \"ok\" | \"not-equal\" | \"timed-out\"",
          "overloads": [
            "(typedArray: Int32Array<ArrayBufferLike>, index: number, value: number, timeout?: number): \"ok\" | \"not-equal\" | \"timed-out\"",
            "(typedArray: BigInt64Array<ArrayBufferLike>, index: number, value: bigint, timeout?: number): \"ok\" | \"not-equal\" | \"timed-out\""
          ],
          "type": "{ (typedArray: Int32Array<ArrayBufferLike>, index: number, value: number, timeout?: number): \"ok\" | \"not-equal\" | \"timed-out\"; (typedArray: BigInt64Array<ArrayBufferLike>, index: number, value: bigint, timeout?: number): \"ok\" | \"not-equal\" | \"timed-out\"; }",
          "description": "If the value at the given position in the array is equal to the provided value, the current\nagent is put to sleep causing execution to suspend until the timeout expires (returning\n`\"timed-out\"`) or until the agent is awoken (returning `\"ok\"`); otherwise, returns\n`\"not-equal\"`."
        },
        {
          "name": "waitAsync",
          "path": "Atomics.prototype.waitAsync",
          "kind": "function",
          "signature": "(typedArray: Int32Array<ArrayBufferLike>, index: number, value: number, timeout?: number): { async: false; value: \"not-equal\" | \"timed-out\"; } | { async: true; value: Promise<\"ok\" | \"timed-out\">; }",
          "overloads": [
            "(typedArray: Int32Array<ArrayBufferLike>, index: number, value: number, timeout?: number): { async: false; value: \"not-equal\" | \"timed-out\"; } | { async: true; value: Promise<\"ok\" | \"timed-out\">; }",
            "(typedArray: BigInt64Array<ArrayBufferLike>, index: number, value: bigint, timeout?: number): { async: false; value: \"not-equal\" | \"timed-out\"; } | { async: true; value: Promise<\"ok\" | \"timed-out\">; }"
          ],
          "type": "{ (typedArray: Int32Array, index: number, value: number, timeout?: number): { async: false; value: \"not-equal\" | \"timed-out\"; } | { async: true; value: Promise<\"ok\" | \"timed-out\">; }; (typedArray: BigInt64Array, index: number, value: bigint, timeout?: number): { async: false; value: \"not-equal\" | \"timed-out\"; } | { async: true; value: Promise<\"ok\" | \"timed-out\">; }; }",
          "description": "A non-blocking, asynchronous version of wait which is usable on the main thread.\nWaits asynchronously on a shared memory location and returns a Promise"
        },
        {
          "name": "xor",
          "path": "Atomics.prototype.xor",
          "kind": "function",
          "signature": "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
          "overloads": [
            "(typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number",
            "(typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint"
          ],
          "type": "{ (typedArray: Int8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>, index: number, value: number): number; (typedArray: BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike>, index: number, value: bigint): bigint; }",
          "description": "Stores the bitwise XOR of a value with the value at the given position in the array,\nreturning the original value. Until this atomic operation completes, any other read or write\noperation against the array will block."
        }
      ]
    },
    "Reflect": {
      "static": [
        {
          "name": "apply",
          "path": "Reflect.apply",
          "kind": "function",
          "signature": "<T, A extends readonly any[], R>(target: (this: T, ...args: A) => R, thisArgument: T, argumentsList: Readonly<A>): R",
          "overloads": [
            "<T, A extends readonly any[], R>(target: (this: T, ...args: A) => R, thisArgument: T, argumentsList: Readonly<A>): R",
            "(target: Function, thisArgument: any, argumentsList: ArrayLike<any>): any"
          ],
          "type": "{ <T, A extends readonly any[], R>(target: (this: T, ...args: A) => R, thisArgument: T, argumentsList: Readonly<A>): R; (target: Function, thisArgument: any, argumentsList: ArrayLike<any>): any; }",
          "description": "Calls the function with the specified object as the this value\nand the elements of specified array as the arguments."
        },
        {
          "name": "construct",
          "path": "Reflect.construct",
          "kind": "function",
          "signature": "<A extends readonly any[], R>(target: new (...args: A) => R, argumentsList: Readonly<A>, newTarget?: new (...args: any) => any): R",
          "overloads": [
            "<A extends readonly any[], R>(target: new (...args: A) => R, argumentsList: Readonly<A>, newTarget?: new (...args: any) => any): R",
            "(target: Function, argumentsList: ArrayLike<any>, newTarget?: Function): any"
          ],
          "type": "{ <A extends readonly any[], R>(target: new (...args: A) => R, argumentsList: Readonly<A>, newTarget?: new (...args: any) => any): R; (target: Function, argumentsList: ArrayLike<any>, newTarget?: Function): any; }",
          "description": "Constructs the target with the elements of specified array as the arguments\nand the specified constructor as the `new.target` value."
        },
        {
          "name": "defineProperty",
          "path": "Reflect.defineProperty",
          "kind": "function",
          "signature": "(target: object, propertyKey: PropertyKey, attributes: PropertyDescriptor & ThisType<any>): boolean",
          "overloads": [
            "(target: object, propertyKey: PropertyKey, attributes: PropertyDescriptor & ThisType<any>): boolean"
          ],
          "type": "(target: object, propertyKey: PropertyKey, attributes: PropertyDescriptor & ThisType<any>) => boolean",
          "description": "Adds a property to an object, or modifies attributes of an existing property."
        },
        {
          "name": "deleteProperty",
          "path": "Reflect.deleteProperty",
          "kind": "function",
          "signature": "(target: object, propertyKey: PropertyKey): boolean",
          "overloads": [
            "(target: object, propertyKey: PropertyKey): boolean"
          ],
          "type": "(target: object, propertyKey: PropertyKey) => boolean",
          "description": "Removes a property from an object, equivalent to `delete target[propertyKey]`,\nexcept it won't throw if `target[propertyKey]` is non-configurable."
        },
        {
          "name": "get",
          "path": "Reflect.get",
          "kind": "function",
          "signature": "<T extends object, P extends PropertyKey>(target: T, propertyKey: P, receiver?: unknown): P extends keyof T ? T[P] : any",
          "overloads": [
            "<T extends object, P extends PropertyKey>(target: T, propertyKey: P, receiver?: unknown): P extends keyof T ? T[P] : any"
          ],
          "type": "<T extends object, P extends PropertyKey>(target: T, propertyKey: P, receiver?: unknown) => P extends keyof T ? T[P] : any",
          "description": "Gets the property of target, equivalent to `target[propertyKey]` when `receiver === target`."
        },
        {
          "name": "getOwnPropertyDescriptor",
          "path": "Reflect.getOwnPropertyDescriptor",
          "kind": "function",
          "signature": "<T extends object, P extends PropertyKey>(target: T, propertyKey: P): TypedPropertyDescriptor<P extends keyof T ? T[P] : any>",
          "overloads": [
            "<T extends object, P extends PropertyKey>(target: T, propertyKey: P): TypedPropertyDescriptor<P extends keyof T ? T[P] : any>"
          ],
          "type": "<T extends object, P extends PropertyKey>(target: T, propertyKey: P) => TypedPropertyDescriptor<P extends keyof T ? T[P] : any> | undefined",
          "description": "Gets the own property descriptor of the specified object.\nAn own property descriptor is one that is defined directly on the object and is not inherited from the object's prototype."
        },
        {
          "name": "getPrototypeOf",
          "path": "Reflect.getPrototypeOf",
          "kind": "function",
          "signature": "(target: object): object",
          "overloads": [
            "(target: object): object"
          ],
          "type": "(target: object) => object | null",
          "description": "Returns the prototype of an object."
        },
        {
          "name": "has",
          "path": "Reflect.has",
          "kind": "function",
          "signature": "(target: object, propertyKey: PropertyKey): boolean",
          "overloads": [
            "(target: object, propertyKey: PropertyKey): boolean"
          ],
          "type": "(target: object, propertyKey: PropertyKey) => boolean",
          "description": "Equivalent to `propertyKey in target`."
        },
        {
          "name": "isExtensible",
          "path": "Reflect.isExtensible",
          "kind": "function",
          "signature": "(target: object): boolean",
          "overloads": [
            "(target: object): boolean"
          ],
          "type": "(target: object) => boolean",
          "description": "Returns a value that indicates whether new properties can be added to an object."
        },
        {
          "name": "ownKeys",
          "path": "Reflect.ownKeys",
          "kind": "function",
          "signature": "(target: object): (string | symbol)[]",
          "overloads": [
            "(target: object): (string | symbol)[]"
          ],
          "type": "(target: object) => (string | symbol)[]",
          "description": "Returns the string and symbol keys of the own properties of an object. The own properties of an object\nare those that are defined directly on that object, and are not inherited from the object's prototype."
        },
        {
          "name": "preventExtensions",
          "path": "Reflect.preventExtensions",
          "kind": "function",
          "signature": "(target: object): boolean",
          "overloads": [
            "(target: object): boolean"
          ],
          "type": "(target: object) => boolean",
          "description": "Prevents the addition of new properties to an object."
        },
        {
          "name": "set",
          "path": "Reflect.set",
          "kind": "function",
          "signature": "<T extends object, P extends PropertyKey>(target: T, propertyKey: P, value: P extends keyof T ? T[P] : any, receiver?: any): boolean",
          "overloads": [
            "<T extends object, P extends PropertyKey>(target: T, propertyKey: P, value: P extends keyof T ? T[P] : any, receiver?: any): boolean",
            "(target: object, propertyKey: PropertyKey, value: any, receiver?: any): boolean"
          ],
          "type": "{ <T extends object, P extends PropertyKey>(target: T, propertyKey: P, value: P extends keyof T ? T[P] : any, receiver?: any): boolean; (target: object, propertyKey: PropertyKey, value: any, receiver?: any): boolean; }",
          "description": "Sets the property of target, equivalent to `target[propertyKey] = value` when `receiver === target`."
        },
        {
          "name": "setPrototypeOf",
          "path": "Reflect.setPrototypeOf",
          "kind": "function",
          "signature": "(target: object, proto: object): boolean",
          "overloads": [
            "(target: object, proto: object): boolean"
          ],
          "type": "(target: object, proto: object | null) => boolean",
          "description": "Sets the prototype of a specified object o to object proto or null."
        }
      ],
      "instance": []
    }
  }
};
