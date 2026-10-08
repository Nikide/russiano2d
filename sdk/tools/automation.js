// Thin RmlUi view of native batch and original engine agent protocol sessions.
import { escapeHtml, absolutePath } from '../lib/model.js';
import * as views from '../lib/views.js';
let singleton;
export async function open(app,args){if(!singleton)singleton=create(app);return singleton.openAsset(args.assetAbs||null);}
function create(app){
    const $=app.$,doc=$.ui.doc('sdk/ui/automation.rml');
    const s={active:false,busy:false,path:'',operation:'batch',report:null};
    function openAsset(path){s.active=true;s.path=path||'';s.report=null;s.operation=path&&/\.agent\.json$/i.test(path)?'agent':'batch';doc.text('au-mode',s.operation);if(app.doc)app.doc.hide();doc.show();doc.setValue('au-path',s.path);doc.setValue('au-json',path?$.fs.readText(path)||'':'');return api;}
    function close(){s.active=false;doc.hide();app.closeTool();}
    async function run(){
        if(s.busy)return null;s.busy=true;
        try{
            s.path=absolutePath($.fs.basePath(),String(doc.value('au-path')||'').trim());
            if(!s.path||!doc.value('au-path'))throw new Error('Укажите файл манифеста или сессии');
            const text=String(doc.value('au-json')||'');JSON.parse(text);
            if(!$.fs.write(s.path,text))throw new Error('Не удалось сохранить файл');
            const args=[s.operation,s.path],output=String(doc.value('au-output')||'').trim();if(output)args.push('--output',absolutePath($.fs.basePath(),output));
            doc.text('au-state','выполняю…');const r=await app.backend(args,'Automation: '+s.operation);s.report=r.json;
            doc.text('au-report',JSON.stringify(r.json,null,2));doc.html('au-diag',views.diagRows(r.json?r.json.diagnostics:app.state.diagnostics));
            doc.text('au-state',r.json&&r.json.ok?'готово':'есть ошибки');return r.json;
        }catch(e){doc.html('au-diag','<div class="diag diag-err">'+escapeHtml(e.message)+'</div>');doc.text('au-state','ошибка');return null;}
        finally{s.busy=false;}
    }
    doc.on('au-back','click',close);doc.on('au-run','click',run);
    for(const op of ['batch','agent'])doc.on('au-'+op,'click',()=>{s.operation=op;doc.text('au-mode',op);});
    const api={state:s,openAsset,close,run,snapshot(){return{active:s.active,busy:s.busy,path:s.path,operation:s.operation,report:s.report};}};
    app.studios.automation=api;return api;
}
