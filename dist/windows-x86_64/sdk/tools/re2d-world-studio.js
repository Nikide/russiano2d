// RmlUi world authoring. Geometry compilation/validation is the native world-compile.
import { createWorldSession, sections } from '../lib/world_model.js';
import { escapeHtml as esc, dirOf, joinPath } from '../lib/model.js';
import * as views from '../lib/views.js';
let singleton;
export const standalone = true;
export async function open(app, args) {
    if (!singleton) singleton = createStudio(app);
    return singleton.openAsset(args.assetAbs || args.asset || null);
}
export function createStudio(app) {
    const $ = app.$, doc = $.ui.doc('sdk/ui/world_studio.rml');
    const s = { active: false, path: null, session: null, selection: null, report: null, diagnostics: [], world: null, node: null,
        view: { x: 100, y: 100, eye: 60, yaw: 0, pitch: 0, fov: 70 }, scale: 1, origin: [0,0], drag: null, busy: false };
    const fail = (e, code='SDK_WORLD_EDIT') => { s.diagnostics = [{ code, severity: 'error', asset: s.path, message: String(e.message || e), location: null, details: null }]; doc.html('ws-diag', views.diagRows(s.diagnostics)); };
    const dispose = () => { if (s.world) s.world.dispose(); s.world = null; if (s.node) s.node.remove(); s.node = null; };
    function select(key, i) { s.selection = { key, i }; render(); return s.selection; }
    function operation(fn) { try { const v=fn(); s.report=null; dispose(); render(); return v; } catch(e) { fail(e); return null; } }
    function render() {
        if (!s.session) return;
        const d = s.session.data, sel=s.selection;
        doc.text('ws-file', s.path); doc.text('ws-dirty', s.session.history.dirty() ? 'изменено' : '');
        doc.html('ws-tree', sections.map(key => '<h4>'+key+'</h4>'+ (d[key]||[]).map((v,i) => '<div class="row'+(sel&&sel.key===key&&sel.i===i?' sel':'')+'" data-key="'+key+':'+i+'">'+i+' · '+esc(v.id || '?')+'</div>').join('')).join(''));
        const selected=sel&&(d[sel.key]||[])[sel.i];
        doc.text('ws-selection', selected ? sel.key+' #'+sel.i+' · '+selected.id : 'Выберите объект');
        doc.setValue('ws-properties', selected ? JSON.stringify(selected,null,2) : '');
        doc.html('ws-materials', [...new Set([...(d.walls||[]).map(w=>w.color), ...(d.cells||[]).flatMap(c=>(c.spans||[]).flatMap(v=>[v.floorColor,v.ceilingColor]))].filter(Boolean))].map(c=>'<div style="color:'+esc(/^#[0-9a-f]{3,8}$/i.test(c)?c:'#fff')+'">'+esc(c)+'</div>').join(''));
        const r=s.report;doc.text('ws-stats',r&&r.ok ? r.stats.compiledWalls+' стен · '+r.stats.spans+' spans · '+r.stats.stacks+' этажных пар' : '');
        drawPlans();
    }
    function drawPlans() {
        const d=s.session.data, r=doc.rect('ws-plan');if (!r||r.w<1||r.h<1)return;
        const points=[];for(const key of sections)for(const v of d[key]||[]){ if(v.rect)points.push([v.rect[0],v.rect[1]],[v.rect[0]+v.rect[2],v.rect[1]+v.rect[3]]);else if(Array.isArray(v.from)&&Array.isArray(v.to))points.push(v.from,v.to); }
        const minX=points.length?Math.min(...points.map(v=>v[0])):0,minY=points.length?Math.min(...points.map(v=>v[1])):0;
        const maxX=points.length?Math.max(...points.map(v=>v[0])):200,maxY=points.length?Math.max(...points.map(v=>v[1])):200;
        s.scale=Math.max(.001,Math.min((r.w-30)/Math.max(100,maxX-minX),(r.h-30)/Math.max(100,maxY-minY)));s.origin=[minX-15/s.scale,minY-15/s.scale];
        const html=[]; const shape=(key,i,v,x,y,w,h,extra='')=>'<div class="world-shape'+(s.selection&&s.selection.key===key&&s.selection.i===i?' sel':'')+'" data-key="'+key+':'+i+'" style="left:'+x+'px;top:'+y+'px;width:'+Math.max(3,w)+'px;height:'+Math.max(3,h)+'px;'+extra+'">'+esc(v.id)+'</div>';
        for(const key of sections)for(let i=0;i<(d[key]||[]).length;i++){const v=d[key][i]; if(v.rect){ const q=v.rect;html.push(shape(key,i,v,(q[0]-s.origin[0])*s.scale,(q[1]-s.origin[1])*s.scale,q[2]*s.scale,q[3]*s.scale)); }
            else if(Array.isArray(v.from)&&Array.isArray(v.to)){const a=v.from,b=v.to,dx=b[0]-a[0],dy=b[1]-a[1];html.push(shape(key,i,v,(a[0]-s.origin[0])*s.scale,(a[1]-s.origin[1])*s.scale,Math.hypot(dx,dy)*s.scale,3,'transform-origin:0px 0px;transform:rotate('+Math.atan2(dy,dx)+'rad);background-color:'+(key==='portals'?'#83dba4':'#98bddd')+';'));}}
        doc.html('ws-plan',html.join(''));
        const sec=doc.rect('ws-section'), cells=s.report&&s.report.ok?s.report.world.cells:(d.cells||[]).filter(c=>Array.isArray(c.rect)).map(c=>({x:c.rect[0],w:c.rect[2],spans:c.spans,id:c.id}));
        const z=cells.flatMap(c=>(c.spans||[]).flatMap(v=>[v.bottom,v.top]));const lo=z.length?Math.min(...z):0,hi=z.length?Math.max(...z):288;
        const kx=Math.max(.001,(sec.w-30)/Math.max(100,maxX-minX)),kz=Math.max(.001,(sec.h-30)/Math.max(100,hi-lo));
        doc.html('ws-section',cells.flatMap((c,i)=>(c.spans||[]).map(v=>shape('cells',i,{id:(c.id||'cell '+i)+' ['+v.bottom+'…'+v.top+']'},15+(c.x-minX)*kx,15+(hi-v.top)*kz,c.w*kx,(v.top-v.bottom)*kz))).join(''));
    }
    async function openAsset(path) {
        dispose(); s.path=path||joinPath($.fs.basePath(),'build/new-world.re2dmap');
        const text=path?$.fs.readText(path):null;
        s.session=createWorldSession(text?JSON.parse(text):{version:1,name:'Новая карта',cells:[],walls:[],portals:[],stairs:[],slopes:[]});
        s.selection=null;s.report=null;s.active=true;s.diagnostics=[];
        if(app.doc)app.doc.hide();doc.show();const size=$.gfx.size();$.camera.at(size.w/2,size.h/2).zoom(1);render();
        if(app.recovery)app.recovery.watch(s.path,s.session.data,s.session.history,render);
        return {id:'re2d-world-studio',world:api};
    }
    async function compile(write=true) {
        if(s.busy)return null;s.busy=true;
        const draft=joinPath(dirOf(s.path),'.r2d-sdk-world-draft.re2dmap');
        try {
            if(!$.fs.write(draft,s.session.text()))throw new Error('Не удалось записать черновик');
            const args=['world-compile',draft];if(write)args.push('--output',s.path.replace(/\.re2dmap(?:\.json)?$/i,'')+'.compiled.json');else args[0]='world-info';
            const r=await app.backend(args,'Компиляция мира');s.report=r.json;s.diagnostics=r.json?r.json.diagnostics:app.state.diagnostics;
            doc.html('ws-diag',views.diagRows(s.diagnostics));dispose();
            if(r.json&&r.json.ok){s.world=$.re2d.world(r.json.world);s.node=$('<sprite>',{id:'sdk-world-preview'});doc.text('ws-preview-state','настоящий runtime');}
            else doc.text('ws-preview-state','ошибка компиляции');
            render();return r.json;
        }catch(e){fail(e);return null;}finally{$.fs.remove(draft);s.busy=false;}
    }
    function save(){if(!$.fs.write(s.path,s.session.text())){fail(new Error('Не удалось сохранить'),'SDK_WRITE_FAILED');return false;}s.session.history.markSaved();render();return true;}
    const defaults={cells:{rect:[0,0,128,128],spans:[{bottom:0,top:128,floorColor:'#687b91',ceilingColor:'#344858'}]},walls:{from:[0,0],to:[128,0],bottom:0,top:128,color:'#8b9ab2'},portals:{cellA:'',cellB:'',from:[0,0],to:[0,64],openings:[{bottom:0,top:96}]},stairs:{rect:[128,0,128,64],axis:'x',dir:1,steps:8,base:0,rise:16,top:256},slopes:{rect:[128,0,128,64],axis:'x',dir:1,segments:8,from:0,to:128,top:256}};
    function add(key){return operation(()=>{let n=(s.session.data[key]||[]).length,id;do{id=key+'-'+n++;}while((s.session.data[key]||[]).some(v=>v.id===id));const i=s.session.add(key,Object.assign({id},defaults[key]));s.selection={key,i};return i;});}
    function close(){s.active=false;dispose();doc.hide();app.closeTool();}
    const pick=key=>{const [section,i]=String(key).split(':');if(sections.includes(section))select(section,Number(i));};
    doc.on('ws-plan','mousedown',(id,ev,key)=>pick(key));
    doc.on('ws-tree','click',(id,ev,key)=>pick(key));doc.on('ws-plan','click',(id,ev,key)=>pick(key));
    doc.on('ws-back','click',close);doc.on('ws-save','click',save);doc.on('ws-compile','click',()=>compile());doc.on('ws-preview','click',()=>compile(false));
    doc.on('ws-undo','click',()=>operation(()=>s.session.history.undo()));doc.on('ws-redo','click',()=>operation(()=>s.session.history.redo()));
    doc.on('ws-apply','click',()=>operation(()=>{const {key,i}=s.selection||{};s.session.replace(key,i,JSON.parse(doc.value('ws-properties')));}));
    doc.on('ws-delete','click',()=>operation(()=>{const {key,i}=s.selection||{};s.session.remove(key,i);s.selection=null;}));
    for(const [button,key]of [['cell','cells'],['wall','walls'],['portal','portals'],['stair','stairs'],['slope','slopes']])doc.on('ws-add-'+button,'click',()=>add(key));
    doc.on('ws-split','click',()=>operation(()=>{if(!s.selection||s.selection.key!=='walls')throw new Error('Выберите стену');s.session.splitWall(s.selection.i);}));
    doc.on('ws-join','click',()=>operation(()=>{if(!s.selection||s.selection.key!=='walls')throw new Error('Выберите стену');s.session.joinWalls(s.selection.i,Number(doc.value('ws-join-index')));s.selection=null;}));
    doc.on('ws-camera','click',()=>{try {for(const [k,id]of [['x','x'],['y','y'],['eye','eye'],['yaw','yaw'],['pitch','pitch']]){const v=Number(doc.value('ws-cam-'+id));if(!Number.isFinite(v)||Math.abs(v)>1e6)throw new Error('Неверная камера');s.view[k]=v;} }catch(e){fail(e);} });
    doc.on('ws-diag','click',(id,ev,key)=>{const d=s.diagnostics[Number(key)];if(d&&d.location){const loc=d.location;if(sections.includes(loc.section)&&Number.isInteger(loc.index))select(loc.section,loc.index);}});
    let wasDown=false;
    $.update(()=>{if(!s.active)return;
        if($.input.ctrlDown()&&$.input.pressed('z'))operation(()=>$.input.shiftDown()?s.session.history.redo():s.session.history.undo());
        const down=$.input.mouseDown('left'),m=$.input.mouse(),r=doc.rect('ws-plan');
        if(down&&!wasDown&&s.selection&&m.x>=r.x&&m.x<r.x+r.w&&m.y>=r.y&&m.y<r.y+r.h)s.drag={x:m.x,y:m.y,selection:{...s.selection},scale:s.scale};
        if(!down&&wasDown&&s.drag){const drag=s.drag;s.drag=null;const grid=Math.max(1,Number(doc.value('ws-grid'))||16);const dx=Math.round((m.x-drag.x)/drag.scale/grid)*grid,dy=Math.round((m.y-drag.y)/drag.scale/grid)*grid;if(dx||dy)operation(()=>s.session.move(drag.selection.key,drag.selection.i,dx,dy));}
        wasDown=down;
        if(s.world&&s.node){const v=doc.rect('ws-view');if(v.w>0&&v.h>0){const texture=s.world.render(s.view,[],Math.min(640,Math.round(v.w)),Math.min(360,Math.round(v.h)));s.node.sprite(texture).at(v.x+v.w/2,v.y+v.h/2).size(v.w,v.h);}}
    });
    const api={state:s,openAsset,close,select,add,save,compile,operation,render,
        snapshot(){return {active:s.active,path:s.path,dirty:s.session?s.session.history.dirty():false,selection:s.selection,busy:s.busy,preview:!!s.world,stats:s.report?s.report.stats:null,codes:s.diagnostics.map(d=>d.code),data:s.session?s.session.data:null};}};
    app.studios.world=api;return api;
}
