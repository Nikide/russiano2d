import { test, eq, truthy, finish } from './_harness.mjs';
import { createMap, displayItems, mapBounds, inspectorSchema } from '../../sdk/lib/world_editor/model.js';
import { createSelection } from '../../sdk/lib/world_editor/selection.js';
import { createViewports } from '../../sdk/lib/world_editor/viewport.js';

const source={version:1,cells:[{id:'room',rect:[100,200,128,64],spans:[{bottom:0,top:96},{bottom:128,top:256}]}],walls:[{id:'edge',from:[100,200],to:[228,200],bottom:0,top:256}]};
test('cell maps keep native region defaults and have no injected world envelope',()=>{
    const map=createMap(source);eq(map.world,undefined);eq(map.regionSize,undefined);
    const bounds=mapBounds(map);truthy(bounds.x>=99 && bounds.x<=100);eq(bounds.top,256);
    truthy(bounds.w<140);eq(source.brushes,undefined);
});
test('both vertical spans are visible under the same selection identity',()=>{
    const map=createMap(source),items=displayItems(map).filter(v=>v.kind==='cell');
    eq(items.length,2);eq(items[0].id,items[1].id);eq(items[1].bottom,128);
    const sel=createSelection(()=>map);sel.set('cell',['room']);eq(sel.first(),'room');
    eq(sel.items()[0].value.spans.length,2);
    const viewports=createViewports(16),view=viewports.byId('front');viewports.setSize('front',500,400);viewports.focus(mapBounds(map));
    const html=viewports.buildOverlay(view,{map,selection:sel.snapshot()});
    truthy(html.includes('cell:room'));truthy(html.includes('we-sel'));
});
test('thin walls remain pickable and nested authoring properties remain editable',()=>{
    const map=createMap(source),sel=createSelection(()=>map);
    const wall=sel.pick(box=>box,150,200,['wall']);eq(wall.id,'edge');
    sel.set('cell',['room']);
    const fields=inspectorSchema('cell',map,sel.snapshot());
    eq(fields.find(f=>f.key==='spans').type,'json');
    eq(JSON.parse(fields.find(f=>f.key==='spans').value).length,2);
});
test('brush maps retain their original envelope defaults',()=>{
    const map=createMap({brushes:[]});eq(map.world.w,1024);eq(map.regionSize,256);
});
finish();
