// Thin RmlUi view of native batch and original engine agent protocol sessions.
import { escapeHtml, absolutePath } from '../lib/model.js';
import { createPanel } from '../lib/panel_check.js';
import * as views from '../lib/views.js';
let singleton;
export const standalone=true;
export async function open(app,args){if(!singleton)singleton=create(app);return singleton.openAsset(args.assetAbs||null);}
function create(app){
    const $=app.$,doc=$.ui.doc('sdk/ui/automation.rml');
    const s={active:false,busy:false,path:'',operation:'batch',report:null};
    // §29: панель проверки манифеста/сессии — тот же backend, что CLI.
    let panel=null;
    function makePanel(){panel=createPanel(app,{label:'Automation',paths:()=>s.path?[s.path]:[],primary:()=>s.path||null,report:()=>auReport()});return panel;}
    function auReport(){
        const notes=[];
        let jobs=0,ops=[];
        const txt=s.path?$.fs.readText(s.path):null;
        try{const j=txt?JSON.parse(txt):null;if(j&&Array.isArray(j.jobs)){jobs=j.jobs.length;ops=j.jobs.map(x=>String(x&&x.op||'?'));}
            else if(j&&Array.isArray(j.requests)){jobs=j.requests.length;ops=['agent:'+j.requests.length];}
            else if(j)notes.push('манифест без jobs/requests');
        }catch(e){notes.push('манифест не разобран: правку проверьте кнопкой «Проверить»');}
        if(!s.report)notes.push('прогон ещё не выполнялся: сводка только по файлу');
        return {operation:s.operation,jobs,ops,output:s.report?!!s.report.ok:null,notes};
    }
    async function validate(){if(!s.path)return{ok:false,diagnostics:[]};if(!panel)makePanel();const r=await panel.validate();views.diagPanel(doc,'au-diag',r.diagnostics);doc.text('au-state',r.ok?'проверка: ошибок 0':'проверка: есть коды');return r;}
    function preview(){if(!panel)makePanel();const r=panel.preview();doc.text('au-state','preview: '+r.path);return r;}
    function openAsset(path){s.active=true;s.path=path||'';s.report=null;s.operation=path&&/\.agent\.json$/i.test(path)?'agent':'batch';doc.text('au-mode',s.operation==='agent'?'сессия агента':'пакет ассетов');if(app.doc)app.doc.hide();doc.show();doc.setValue('au-path',s.path);doc.setValue('au-json',path?$.fs.readText(path)||'':'');return api;}
    function close(){s.active=false;doc.hide();app.closeTool();}
    async function run(){
        if(s.busy)return null;s.busy=true;
        try{
            s.path=absolutePath($.fs.basePath(),String(doc.value('au-path')||'').trim());
            if(!panel)makePanel();
            if(!s.path||!doc.value('au-path'))throw new Error('Укажите файл манифеста или сессии');
            const text=String(doc.value('au-json')||'');JSON.parse(text);
            if(!$.fs.write(s.path,text))throw new Error('Не удалось сохранить файл');
            const args=[s.operation,s.path],output=String(doc.value('au-output')||'').trim();if(output)args.push('--output',absolutePath($.fs.basePath(),output));
            doc.text('au-state','выполняю…');const r=await app.backend(args,'Automation: '+s.operation);s.report=r.json;
            doc.text('au-report',JSON.stringify(r.json,null,2));views.diagPanel(doc,'au-diag',r.json?r.json.diagnostics:app.state.diagnostics);
            doc.text('au-state',r.json&&r.json.ok?'готово':'есть ошибки');return r.json;
        }catch(e){doc.html('au-diag','<div class="diag diag-err">'+escapeHtml(e.message)+'</div>');doc.text('au-state','ошибка');return null;}
        finally{s.busy=false;}
    }
    doc.on('au-back','click',close);doc.on('au-run','click',run);doc.on('au-validate','click',validate);doc.on('au-preview','click',preview);
    for(const op of ['batch','agent'])doc.on('au-'+op,'click',()=>{s.operation=op;doc.text('au-mode',op==='agent'?'сессия агента':'пакет ассетов');});
    const api={state:s,openAsset,close,run,validate,preview,report:()=>{if(!panel)makePanel();return panel.report();},get panel(){return panel;},snapshot(){return{active:s.active,busy:s.busy,path:s.path,operation:s.operation,report:s.report,panel:panel?panel.snapshot():null,summary:panel?panel.report():null};}};
    app.studios.automation=api;return api;
}
