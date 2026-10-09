// Драйвер паритета для tests/agent/sdk_data_parity_test.py: проверяет файлы JS-моделью форматов
// (sdk/lib/kinds/*.js, sdk/lib/rml_model.js) и печатает { путь: ["severity:code", …] }.
// Запуск: qjs -m tests/js/sdk_parity_driver.mjs -- список.txt   (строки «вид<TAB>путь»)
import * as std from 'qjs:std';
import { KINDS } from '../../sdk/lib/kinds/index.js';
import * as R from '../../sdk/lib/rml_model.js';

const list = std.loadFile(scriptArgs[scriptArgs.length - 1]).split('\n').filter(Boolean);
const out = {};
for (const line of list) {
    const [kind, path] = line.split('\t');
    const text = std.loadFile(path);
    let diags;
    if (kind === 'rml') diags = R.checkRml(text);
    else if (kind === 'rcss') diags = R.checkRcss(text);
    else diags = KINDS[kind].validate(JSON.parse(text));
    out[path] = diags.map((d) => d.severity + ':' + d.code).sort();
}
print(JSON.stringify(out));
