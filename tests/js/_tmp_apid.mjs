import { createApi } from '../../src/highlevel/api.js';
try {
    const $ = createApi();
    console.log('createApi ok, подсистем:', Object.keys($).length);
} catch (e) {
    console.log('ОШИБКА:', e && e.message ? e.message : String(e));
    const stack = String(e && e.stack || '').split('\n');
    console.log('   ', (stack.find((l) => l.includes('src/highlevel')) || '').trim());
}
