// Документ ассета Editor: одна модель/история и native-проверка на вкладку.
import { createHistory } from '../../sdk/lib/history.js';
import { canonicalJson } from '../../sdk/lib/kit.js';
import { diag } from './studio_kit.js';
let counter=0;
export function createAssetDocument(host,kind) {
    const $=host.$,id=++counter;
    let history=null,closed=false,sequence=0;
    const s={path:'',data:null,source:'',busy:false,diagnostics:[],validated:null};
    const fail=(code,message)=>{s.diagnostics=[diag(code,'error',message,{asset:s.path})];host.changed();return false;};
    function open(path) {
        const source=$.fs.readText(path);
        if(source==null)throw new Error('Не удалось прочитать '+path);
        const data=JSON.parse(source);
        if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Корень ассета должен быть объектом');
        s.path=path;s.source=source;s.data=data;history=createHistory(data);live();
    }
    function live(){s.diagnostics=kind.validate(s.data).map(d=>Object.assign({},d,{asset:s.path}));}
    function edit(label,fn) {
        if(closed||s.busy)return false;
        try {history.run(label,()=>fn(s.data));live();host.changed();return true;}
        catch(e){return fail('EDITOR_ASSET_EDIT',e.message||e);}
    }
    function step(redo){if(closed||s.busy||!history)return false;const changed=redo?history.redo():history.undo();if(changed){live();host.changed();}return !!changed;}
    async function check() {
        const draft=s.path.replace(/[^/]*$/,'')+'.r2d-editor-'+id+'-'+(++sequence)+kind.SUFFIX;
        const source=canonicalJson(s.data);
        try {
            if($.fs.write(draft,source)===false)return fail('SDK_WRITE_FAILED','Не удалось записать черновик');
            const r=await host.backend(['validate',draft]);
            if(closed)return false;
            if(!r.json)return fail('SDK_BACKEND_NO_JSON','Validate не вернул JSON');
            s.diagnostics=(r.json.diagnostics||[]).map(d=>Object.assign({},d,{asset:d.asset===draft?s.path:d.asset||s.path}));
            s.validated=JSON.stringify(s.data);host.changed();return !!(r.ok&&r.json.ok);
        } catch(e){return fail('EDITOR_ASSET_VALIDATE',e.message||e);}
        finally {$.fs.remove(draft);}
    }
    async function validate(){if(closed||s.busy)return false;s.busy=true;try{return await check();}finally{s.busy=false;}}
    async function save() {
        if(closed||s.busy)return false;
        if(!history.dirty())return true;
        s.busy=true;
        try {
            if(!await check()||closed)return false;
            if($.fs.readText(s.path)!==s.source)return fail('EDITOR_WRITE_CONFLICT','Файл изменён извне: переоткройте '+s.path);
            const text=canonicalJson(s.data);
            if($.fs.write(s.path,text)===false)return fail('SDK_WRITE_FAILED','Не удалось сохранить '+s.path);
            s.source=text;history.markSaved();host.changed();return true;
        } finally {s.busy=false;}
    }
    return {state:s,open,edit,undo:()=>step(false),redo:()=>step(true),save,validate,
        dirty:()=>!!history&&history.dirty(),close(){closed=true;},fail,
        diagnostics:()=>s.diagnostics,snapshot:()=>({path:s.path,dirty:!!history&&history.dirty(),busy:s.busy,validationStale:s.validated!==JSON.stringify(s.data)})};
}
