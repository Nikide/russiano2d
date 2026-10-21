// Inspector conversion must preserve authored values and let native validation
// reject invalid input, rather than silently replace it with a default.
import { fieldToJson, displayValue, assetChoices } from '../../editor/lib/snippets_panel.js';
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(JSON.stringify({actual:a, expected:b})); };
eq(fieldToJson({type:'vec2'}, 'oops', '2'), '["oops",2]');
eq(fieldToJson({type:'vec2'}, '', ''), null);
eq(fieldToJson({type:'vec2'}, '-1.5', '2'), '[-1.5,2]');
eq(fieldToJson({type:'list'}, '["good: saved_town, spared_boss","bad:"]'), '["good: saved_town, spared_boss","bad:"]');
eq(fieldToJson({type:'list'}, 'a, b'), '["a","b"]');
eq(fieldToJson({type:'list'}, '[invalid'), '"[invalid"');
eq(fieldToJson({type:'number'}, 'oops'), '"oops"');
eq(displayValue({id:'rules',type:'list',default:['a,b','c']}, {}), '["a,b","c"]');
eq(assetChoices([{path:'ui/test.rml'}, {path:'art/HERO.PNG'}, {path:'sfx/a.ogg'}], 'image'), ['art/HERO.PNG']);
print('snippets_panel_test: ok');
