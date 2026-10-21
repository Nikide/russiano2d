// Рабочая область ассета: UI Editor, без SDK app/host и глобальных кадровых хуков.
import { studioDoc,esc,row,diag,uiScale,mousePx,inside,screenCamera,pickProjectFile } from './studio_kit.js';
import { createAssetDocument } from './asset_document.js';
export const button=(id,label,on)=>'<button class="st-btn'+(on?' on':'')+'" data-key="'+esc(id)+'">'+esc(label)+'</button>';
// Поля формы: {key,label,number?,int?,min?,max?,bool?,json?,options?,optional?,default?,pair?:'range'|'vec',group?,hint?,file?:{filters}}.
// file — путь к файлу проекта: рядом кнопка «…» открывает окно ОС.
// pair — два поля: 'range' — число или [от, до]; 'vec' — [x, y].
export function form(fields,prefix='f') {
    return fields.map(f=>f.group?'<div class="st-field-group"><span class="st-h">'+esc(f.label||f.key)+'</span>'+form(f.group,prefix+'-'+f.key)+'</div>':'<div class="st-field"><label>'+esc(f.label||f.key)+'</label>'+
        (f.pair?'<input id="'+prefix+'-'+esc(f.key)+'-0" class="st-in" type="text"/><input id="'+prefix+'-'+esc(f.key)+'-1" class="st-in" type="text"/>':
        f.options?'<select id="'+prefix+'-'+esc(f.key)+'" class="st-in">'+(f.optional?['']:[]).concat(f.options).map(v=>'<option value="'+esc(v)+'">'+esc(v===''?'—':v)+'</option>').join('')+'</select>':
        f.json?'<textarea id="'+prefix+'-'+esc(f.key)+'" class="st-area"></textarea>':'<input id="'+prefix+'-'+esc(f.key)+'" class="st-in" type="text"/>')+
        (f.file?'<button class="st-btn st-browse" data-key="browse:'+esc(prefix)+':'+esc(f.key)+'">…</button>':'')+'</div>').join('');
}
const num=(f,t)=>{const v=Number(t);if(!Number.isFinite(v))throw new Error((f.label||f.key)+': нужно число');return v;};
function pairOf(f,v) {
    if(v===undefined||v===null)return ['',''];
    if(Array.isArray(v))return [String(v[0]??''),String(v[1]??'')];
    if(typeof v==='object')return [String(v.x??''),String(v.y??'')];
    return f.pair==='vec'?['0',String(v)]:[String(v),''];
}
function readPair(f,a,b) {
    if(a===''&&b===''){if(f.optional)return undefined;throw new Error((f.label||f.key)+': нужно значение');}
    if(f.pair==='vec')return [a===''?0:num(f,a),b===''?0:num(f,b)];
    if(b===''||a==='')return num(f,a===''?b:a);
    const lo=num(f,a),hi=num(f,b);if(lo>hi)throw new Error((f.label||f.key)+': «от» больше «до»');return lo===hi?lo:[lo,hi];
}
export function createWorkspace(host,def) {
    const $=host.$,doc=studioDoc($,'asset'),file=createAssetDocument(host,def.kind);
    let closed=false,active=false,needsPreview=true,sourceMode=false;
    const w={$,doc,host,file,selected:0,ext:{},nodes:[],cleanup:[],prefix:'__editor_'+doc.id+'_',
        get data(){return file.state.data;},get active(){return active;},
        path:p=>p&&/^(\/|[A-Za-z]:)/.test(p)?p:host.root()+'/'+(p||''),
        rect(){const r=doc.layoutRect('aw-canvas'),k=uiScale($);return r?{x:r.x/k,y:r.y/k,w:r.w/k,h:r.h/k}:null;},
        point(){const r=w.rect(),m=$.input.mouse();return r?{x:m.x-r.x,y:m.y-r.y,inside:inside(mousePx($),doc.layoutRect('aw-canvas')),r}:null;},
        fail:(code,msg)=>{file.fail(code,msg);renderDiagnostics();},
        edit(label,fn){if(!file.edit(label,fn))return false;needsPreview=true;render();return true;},
        select(i){w.selected=i;render();},
        rebuild(){needsPreview=true;},
        render,browse,
        fieldValues(fields,target,prefix='f'){
            for(const f of fields){
                if(f.group){this.fieldValues(f.group,target[f.key]&&typeof target[f.key]==='object'?target[f.key]:{},prefix+'-'+f.key);continue;}
                // Отсутствующее optional-поле показывается пустым и остаётся отсутствующим при Apply.
                const v=target[f.key]!==undefined?target[f.key]:f.optional?undefined:f.default;
                if(f.pair){const two=pairOf(f,v);doc.setValue(prefix+'-'+f.key+'-0',two[0]);doc.setValue(prefix+'-'+f.key+'-1',two[1]);continue;}
                doc.setValue(prefix+'-'+f.key,v===undefined?'':f.json?JSON.stringify(v,null,2):String(v));
            }
        },
        read(fields,prefix='f'){
            const patch={};for(const f of fields){
                if(f.group){patch[f.key]=this.read(f.group,prefix+'-'+f.key);continue;}
                if(f.pair){patch[f.key]=readPair(f,String(doc.value(prefix+'-'+f.key+'-0')||'').trim(),String(doc.value(prefix+'-'+f.key+'-1')||'').trim());continue;}
                const raw=String(doc.value(prefix+'-'+f.key)||'').trim();
                if(f.optional&&raw===''){patch[f.key]=undefined;continue;}
                if(f.json)patch[f.key]=JSON.parse(raw);
                else if(f.number){if(!raw||!Number.isFinite(Number(raw)))throw new Error((f.label||f.key)+': нужно число');const n=Number(raw);if(f.int&&!Number.isInteger(n))throw new Error((f.label||f.key)+': нужно целое');if(f.min!==undefined&&n<f.min||f.max!==undefined&&n>f.max)throw new Error((f.label||f.key)+': диапазон '+(f.min===undefined?'−∞':f.min)+'..'+(f.max===undefined?'∞':f.max));patch[f.key]=n;}
                else if(f.bool){if(!['true','false'].includes(raw))throw new Error(f.key+': true/false');patch[f.key]=raw==='true';}
                else patch[f.key]=raw;
            }return patch;
        },
        patch(target,patch){for(const [k,v] of Object.entries(patch)){if(v===undefined)delete target[k];else target[k]=v;}},
    };
    function disposePreview(){if(def.release)def.release(w);for(const n of w.nodes)n.remove();w.nodes=[];for(const fn of w.cleanup)fn();w.cleanup=[];}
    function renderDiagnostics(){doc.html('aw-diagnostics',file.diagnostics().map(d=>'<div>'+esc(d.code+': '+d.message)+'</div>').join(''));}
    function render() {
        if(closed||!w.data)return;
        const items=def.items(w);w.selected=Math.max(0,Math.min(items.length-1,w.selected));
        doc.text('aw-title',def.title);doc.text('aw-list-title',def.listTitle);
        doc.html('aw-list',items.map((item,i)=>row(i,esc(item.label)+(item.detail?'<span class="st-sub">'+esc(item.detail)+'</span>':''),i===w.selected?'sel':'')).join(''));
        doc.html('aw-tools',def.tools?def.tools(w):'');doc.html('aw-actions',def.actions?def.actions(w):'');
        doc.html('aw-library',def.library?def.library(w):'');doc.html('aw-bottom',def.bottom?def.bottom(w):'');
        doc.text('aw-inspector-title',items[w.selected]?.label||'Свойства');
        const selected=def.target(w),fields=def.fields(w);
        doc.html('aw-inspector',selected?form(fields):'<span class="st-note">Выберите объект или создайте новый.</span>');
        if(selected)w.fieldValues(fields,selected);
        const settings=def.settings||[];doc.html('aw-document',form(settings,'d'));w.fieldValues(settings,w.data,'d');
        doc.style('aw-document-apply','display',settings.length?'block':'none');doc.style('aw-document-title','display',settings.length?'block':'none');
        doc.text('aw-state',file.dirty()?'не сохранено':'сохранено');renderDiagnostics();
        if(def.content)doc.html('aw-content',def.content(w));
        if(def.selected)def.selected(w);
        renderConflict();
        host.changed();
    }
    async function validate(){const ok=await file.validate();renderDiagnostics();return ok;}
    function renderConflict(){
        const c=file.state.conflict;
        if(!c){doc.cls('aw-conflict','st-hidden',true);doc.html('aw-conflict','');return;}
        const missing=typeof c.disk!=='string';
        doc.cls('aw-conflict','st-hidden',false);
        doc.html('aw-conflict','<div class="aw-conflict-shade"></div><div class="aw-conflict-card"><span class="aw-conflict-title">Файл изменён вне Editor</span><span class="aw-conflict-message">На диске есть другая версия. Перезагрузка заменит несохранённые правки. Перезапись сохранит текущий документ Editor поверх версии на диске.</span><span class="aw-conflict-path">'+esc(file.state.path)+(missing?' · файл удалён':'')+'</span><div class="aw-conflict-actions">'+
            (missing?'':'<button id="aw-conflict-reload" class="st-btn" data-key="reload">Перезагрузить</button>')+
            '<button id="aw-conflict-overwrite" class="st-btn primary" data-key="overwrite">Перезаписать</button><button id="aw-conflict-cancel" class="st-btn" data-key="cancel">Отмена</button></div></div>');
    }
    async function resolveConflict(choice){const ok=await file.resolveConflict(choice);if(ok&&choice==='reload')needsPreview=true;render();return ok;}
    async function save(){const ok=await file.save();render();return ok;}
    function undo(){const ok=file.undo();if(ok){needsPreview=true;render();}return ok;}
    function redo(){const ok=file.redo();if(ok){needsPreview=true;render();}return ok;}
    function action(key){try{if(def.action)def.action(w,key);}catch(e){w.fail('EDITOR_ASSET_ACTION',e.message);}}
    doc.on('aw-list','click',(_id,_ev,key)=>{if(key!==null&&key!=='')w.select(Number(key));});
    for(const id of ['aw-tools','aw-actions','aw-library','aw-bottom','aw-content'])doc.on(id,'click',(_id,_ev,key)=>{if(key!==null&&key!=='')action(key);});
    function applyInspector(){try{const fields=def.fields(w),patch=w.read(fields);w.edit('Свойства',data=>def.apply?def.apply(w,data,patch):w.patch(def.target(w),patch));}catch(e){w.fail('EDITOR_ASSET_FIELD',e.message);}}
    function applyDocument(){try{const patch=w.read(def.settings||[],'d');w.edit('Настройки',data=>w.patch(data,patch));}catch(e){w.fail('EDITOR_ASSET_FIELD',e.message);}}
    // «…» у поля-файла: окно ОС, путь относительно проекта, сразу применить.
    async function browse(key){
        const [,prefix,...rest]=key.split(':'),name=rest.join(':');
        const fields=prefix==='d'?(def.settings||[]):def.fields(w),f=fields.find(x=>x.key===name);if(!f)return;
        const id=prefix+'-'+name,cur=String(doc.value(id)||'').trim();
        const r=await pickProjectFile($,host.root(),{title:'Выберите файл: '+(f.label||f.key),path:cur?w.path(cur):host.root(),filters:f.file&&f.file.filters});
        if(r.error){w.fail('EDITOR_ASSET_FILE',r.error);return;}
        if(r.cancelled)return;
        doc.setValue(id,r.rel);
        if(prefix==='d')applyDocument();else applyInspector();
    }
    doc.on('aw-apply','click',applyInspector);
    doc.on('aw-document-apply','click',applyDocument);
    for(const id of ['aw-inspector','aw-document'])doc.on(id,'click',(_id,_ev,key)=>{if(key&&key.startsWith('browse:'))browse(key);});
    doc.on('aw-validate','click',validate);
    doc.on('aw-conflict','click',(_id,_ev,key)=>{if(key==='reload'||key==='overwrite'||key==='cancel')resolveConflict(key);});
    doc.on('aw-source-toggle','click',()=>{sourceMode=!sourceMode;doc.cls('aw-source-panel','st-hidden',!sourceMode);if(sourceMode)doc.setValue('aw-source',JSON.stringify(w.data,null,2));});
    doc.on('aw-source-apply','click',()=>{try{const data=JSON.parse(doc.value('aw-source'));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Нужен объект');w.edit('JSON',model=>{for(const k of Object.keys(model))delete model[k];Object.assign(model,data);});}catch(e){w.fail('EDITOR_ASSET_JSON',e.message);}});
    const api={doc,state:w,ops:{edit:w.edit,select:w.select,action,validate,browse,resolveConflict,...(def.ops?def.ops(w):{})},
        async open(path){file.open(path);if(def.init)def.init(w);render();},
        onActive(on){active=!!on;if(!on){if(def.deactivate)def.deactivate(w);disposePreview();needsPreview=true;}else screenCamera($);},
        update(dt){if(closed||!active||!w.data)return;screenCamera($);
            if(needsPreview){disposePreview();try{if(def.preview)def.preview(w);}catch(e){w.fail('EDITOR_ASSET_PREVIEW',e.message);}needsPreview=false;}
            try{if(def.update)def.update(w,dt);}catch(e){w.fail('EDITOR_ASSET_PREVIEW',e.message);}
            doc.text('aw-hud',def.hud?def.hud(w):def.kind.summary(w.data));
        },layout(){needsPreview=true;},save,undo,redo,dirty:file.dirty,diagnostics:file.diagnostics,
        close(){if(active&&def.deactivate)def.deactivate(w);closed=true;active=false;file.close();disposePreview();doc.unload();},
        snapshot:()=>Object.assign(file.snapshot(),{selected:w.selected,previewNodes:w.nodes.length},def.snapshot?def.snapshot(w):{}),
        commands:()=>[{label:def.title+': проверить',run:validate},...(def.commands?def.commands(w):[])],
    };
    return api;
}
