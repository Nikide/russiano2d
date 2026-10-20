// Рабочая область ассета: UI Editor, без SDK app/host и глобальных кадровых хуков.
import { studioDoc,esc,row,diag,uiScale,mousePx,inside,screenCamera } from './studio_kit.js';
import { createAssetDocument } from './asset_document.js';
export const button=(id,label,on)=>'<button class="st-btn'+(on?' on':'')+'" data-key="'+esc(id)+'">'+esc(label)+'</button>';
export function form(fields,prefix='f') {
    return fields.map(f=>'<div class="st-field"><label>'+esc(f.label||f.key)+'</label>'+
        (f.options?'<select id="'+prefix+'-'+esc(f.key)+'" class="st-in">'+f.options.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('')+'</select>':
        f.json?'<textarea id="'+prefix+'-'+esc(f.key)+'" class="st-area"></textarea>':'<input id="'+prefix+'-'+esc(f.key)+'" class="st-in" type="text"/>')+'</div>').join('');
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
        render,
        fieldValues(fields,target,prefix='f'){
            for(const f of fields){
                // Отсутствующее optional-поле показывается пустым и остаётся отсутствующим при Apply.
                const v=target[f.key]!==undefined?target[f.key]:f.optional?undefined:f.default;
                doc.setValue(prefix+'-'+f.key,v===undefined?'':f.json?JSON.stringify(v,null,2):String(v));
            }
        },
        read(fields,prefix='f'){
            const patch={};for(const f of fields){const raw=String(doc.value(prefix+'-'+f.key)||'').trim();
                if(f.optional&&raw===''){patch[f.key]=undefined;continue;}
                if(f.json)patch[f.key]=JSON.parse(raw);
                else if(f.number){if(!raw||!Number.isFinite(Number(raw)))throw new Error((f.label||f.key)+': нужно число');patch[f.key]=Number(raw);}
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
        doc.style('aw-document-apply','display',settings.length?'block':'none');
        doc.text('aw-state',file.dirty()?'не сохранено':'сохранено');renderDiagnostics();
        if(def.content)doc.html('aw-content',def.content(w));
        if(def.selected)def.selected(w);
        host.changed();
    }
    async function validate(){const ok=await file.validate();renderDiagnostics();return ok;}
    async function save(){const ok=await file.save();render();return ok;}
    function undo(){const ok=file.undo();if(ok){needsPreview=true;render();}return ok;}
    function redo(){const ok=file.redo();if(ok){needsPreview=true;render();}return ok;}
    function action(key){try{if(def.action)def.action(w,key);}catch(e){w.fail('EDITOR_ASSET_ACTION',e.message);}}
    doc.on('aw-list','click',(_id,_ev,key)=>{if(key!==null&&key!=='')w.select(Number(key));});
    for(const id of ['aw-tools','aw-actions','aw-library','aw-bottom','aw-content'])doc.on(id,'click',(_id,_ev,key)=>{if(key!==null&&key!=='')action(key);});
    doc.on('aw-apply','click',()=>{try{const fields=def.fields(w),patch=w.read(fields);w.edit('Свойства',()=>w.patch(def.target(w),patch));}catch(e){w.fail('EDITOR_ASSET_FIELD',e.message);}});
    doc.on('aw-document-apply','click',()=>{try{const patch=w.read(def.settings||[],'d');w.edit('Настройки',data=>w.patch(data,patch));}catch(e){w.fail('EDITOR_ASSET_FIELD',e.message);}});
    doc.on('aw-validate','click',validate);
    doc.on('aw-source-toggle','click',()=>{sourceMode=!sourceMode;doc.cls('aw-source-panel','st-hidden',!sourceMode);if(sourceMode)doc.setValue('aw-source',JSON.stringify(w.data,null,2));});
    doc.on('aw-source-apply','click',()=>{try{const data=JSON.parse(doc.value('aw-source'));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Нужен объект');w.edit('JSON',model=>{for(const k of Object.keys(model))delete model[k];Object.assign(model,data);});}catch(e){w.fail('EDITOR_ASSET_JSON',e.message);}});
    const api={doc,state:w,ops:{edit:w.edit,select:w.select,action,validate,...(def.ops?def.ops(w):{})},
        async open(path){file.open(path);if(def.init)def.init(w);render();},
        onActive(on){active=!!on;if(!on){if(def.deactivate)def.deactivate(w);disposePreview();needsPreview=true;}else screenCamera($);},
        update(dt){if(closed||!active||!w.data)return;screenCamera($);
            if(needsPreview){disposePreview();try{if(def.preview)def.preview(w);}catch(e){w.fail('EDITOR_ASSET_PREVIEW',e.message);}needsPreview=false;}
            try{if(def.update)def.update(w,dt);}catch(e){w.fail('EDITOR_ASSET_PREVIEW',e.message);}
            doc.text('aw-hud',def.hud?def.hud(w):def.kind.summary(w.data));
        },layout(){needsPreview=true;},save,undo,redo,dirty:file.dirty,diagnostics:file.diagnostics,
        close(){closed=true;active=false;file.close();disposePreview();doc.unload();},
        snapshot:()=>Object.assign(file.snapshot(),{selected:w.selected,previewNodes:w.nodes.length},def.snapshot?def.snapshot(w):{}),
        commands:()=>[{label:def.title+': проверить',run:validate},...(def.commands?def.commands(w):[])],
    };
    return api;
}
