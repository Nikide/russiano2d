// SpriteMesh authoring: per-tab controller; geometry and cache use native r2d.
import { escapeHtml } from '../../sdk/lib/model.js';
import { createHistory } from '../../sdk/lib/history.js';
import { studioDoc, uiScale, mousePx, inside, numberOf, screenCamera, diag } from '../lib/studio_kit.js';

export const meta = {
    id:'sprite-mesh',title:'SpriteMesh',icon:'box',match:()=>false,
    also:p=>/\.(atlas\.json|png)$/i.test(p),
    summary:s=>s ? [['Кадров',s.frames],['Настройки',s.dirty?'не сохранены':'сохранены'],['Cache',s.cacheStale?'нужен bake':'актуален']] : [],
};
export function create(host) {
    const $=host.$,doc=host.document||studioDoc($,'sprite_mesh');
    const thumbs=!host.document;
    const model={settings:{depth:.08,alphaThreshold:16,unitsPerPixel:1/32,pivotX:0,pivotY:0},pivotOverride:false};
    let history=createHistory(model),closed=false,sequence=0;
    const s={active:false,asset:'',cachePath:'',data:null,frames:[],tags:{},texture:-1,textures:[],cache:null,
        selected:0,animation:'',playing:false,elapsed:0,camera:{yaw:.55,pitch:.3,zoom:1},drag:null,
        previewMode:'textured',updatingAnimationList:false,error:'',diags:[],busy:false,cacheStale:true,previewStale:false};
    Object.defineProperties(s,{
        settings:{get:()=>model.settings,set:v=>{model.settings=v;}},
        pivotOverride:{get:()=>model.pivotOverride,set:v=>{model.pivotOverride=v;}},
        dirty:{get:()=>history.dirty()},
    });
    function status(text,error) {
        if(closed)return;
        doc.text('sm-state',error?'ОШИБКА':text);doc.text('sm-errors',error||'');
        host.status(error||text,error?'err':'');
    }
    function readAtlas(path) {
        const raw = $.fs.readText(path);
        if (!raw) throw new Error('Не удалось прочитать Sprite/Atlas asset: ' + path);
        return JSON.parse(raw);
    }
    function normalize(data) {
        const fs = [], source = data.frames, pages=(data.meta&&data.meta.pages)||data.pages||[];
        const pageName=(p,i)=>typeof p==='string'?'page'+i:String(p.name===undefined?'page'+i:p.name);
        const pageIndex=value=>{if(value===undefined||value===null)return 0;if(Number.isInteger(value))return value;const i=pages.findIndex((p,n)=>pageName(p,n)===value);if(i<0)throw new Error('Неизвестная страница атласа: '+value);return i;};
        if (Array.isArray(source)) source.forEach((f,i) => { const b=f.frame||f; fs.push({name:String(f.filename||i),x:+b.x,y:+b.y,w:+b.w,h:+b.h,duration:+f.duration||100,page:pageIndex(f.page)}); });
        else Object.keys(source||{}).forEach((name,i) => { const f=source[name],b=f.frame||f;fs.push({name,x:+b.x,y:+b.y,w:+b.w,h:+b.h,duration:+f.duration||100,page:pageIndex(f.page)}); });
        const tags = {};
        for (const t of (data.meta && data.meta.frameTags) || []) {
            const names=[]; const step=t.from<=t.to?1:-1;
            for(let i=t.from; step>0?i<=t.to:i>=t.to; i+=step) if(fs[i]) names.push(fs[i].name);
            if(t.direction==='reverse') names.reverse();
            if(t.direction==='pingpong'&&names.length>2) names.push(...names.slice(1,-1).reverse());
            if(names.length)tags[t.name]={frames:names,loop:t.loop!==false};
        }
        for (const slice of (data.meta && data.meta.slices) || []) {
            const i=fs.findIndex(f=>f.name===slice.name), keys=slice.keys||[];
            if(i<0||!keys.length)continue;
            const key=keys.find(k=>k.frame===i)||keys[0], pivot=key&&key.pivot;
            if(pivot&&Number.isFinite(Number(pivot.x))&&Number.isFinite(Number(pivot.y))){fs[i].pivotX=Number(pivot.x)-fs[i].x;fs[i].pivotY=Number(pivot.y)-fs[i].y;}
        }
        fs.forEach(f=>{if(f.pivotX===undefined)f.pivotX=f.w/2;if(f.pivotY===undefined)f.pivotY=f.h/2;});
        return { frames: fs, tags };
    }
    // Картинка страницы атласа (для миниатюр): путь из meta.image/pages
    // относительно файла атласа; у PNG-ассета — сам файл.
    function pageImage(page) {
        if (!s.data) return s.asset;
        const pages=(s.data.meta&&s.data.meta.pages)||s.data.pages||[];
        const p=pages[page|0], name=typeof p==='string'?p:(p&&(p.image||p.file))||(page?'':(s.data.meta&&s.data.meta.image)||'');
        if(!name)return '';
        const dir=s.asset.replace(/[^/]*$/,'');
        return /^(\/|[A-Za-z]:)/.test(name)?name:dir+name;
    }
    function frameIndex() { return Math.max(0, Math.min(s.frames.length-1, s.selected|0)); }
    function choose(i) { s.selected=Math.max(0,Math.min(s.frames.length-1,i|0));if(!s.pivotOverride){const f=s.frames[s.selected];doc.setValue('sm-px',String(f.pivotX));doc.setValue('sm-py',String(f.pivotY));}renderLists(); }
    function renderLists() {
        if(closed)return;
        doc.html('sm-frames', s.frames.map((f,i)=>thumbs
            ? `<button class="item thumb ${i===s.selected?'on':''}" data-key="${i}">${pageImage(f.page)?`<img class="thumb-img" src="${escapeHtml(pageImage(f.page))}" rect="${f.x} ${f.y} ${f.w} ${f.h}"/>`:''}<span class="thumb-n">${i}</span></button>`
            : `<button class="item ${i===s.selected?'on':''}" data-key="${i}">[${i}] ${escapeHtml(f.name)}</button>`).join(''));
        doc.html('sm-animations', Object.keys(s.tags).map((n,i)=>`<button id="sm-anim-${i}" class="item ${n===s.animation?'on':''}" data-key="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join(''));
        s.updatingAnimationList=true;
        doc.html('sm-animation', Object.keys(s.tags).map(n=>`<option value="${escapeHtml(n)}" ${n===s.animation?'selected':''}>${escapeHtml(n)}</option>`).join(''));
        s.updatingAnimationList=false;
        const f=s.frames[frameIndex()], m=s.cache&&s.cache.frames[frameIndex()];
        doc.html('sm-stats', m ? `Кадр ${frameIndex()+1} / ${s.frames.length}<br/>Непрозрачные пиксели: ${m.opaquePixels.toLocaleString()}<br/>Вершины: ${m.vertices.length/8|0}<br/>Треугольники: ${m.vertices.length/24|0}<br/>Кэш: ${s.cache.bytes.toLocaleString()} байт` : 'Mesh cache ещё не собран. Нажмите «Bake всех кадров».');
        if(s.previewStale)doc.text('sm-state','ПРЕДПРОСМОТР УСТАРЕЛ · Bake preview');
        doc.text('sm-hud', f ? `${f.name} · ${frameIndex()+1}/${s.frames.length} · ${s.playing?'воспроизведение':'пауза'}` : '—');
    }
    function requireResult(result) {
        if (!result || !result.json) throw Object.assign(new Error('Backend не вернул JSON'), {code:'SDK_BACKEND_NO_JSON'});
        if (!result.ok || !result.json.ok) {
            const ds = result.json.diagnostics || [];
            throw Object.assign(new Error(ds.map(d=>d.message).join('\n') || 'Bake завершился с ошибкой'), {diagnostics:ds});
        }
        return result.json;
    }
    function failure(e) {
        if (closed) return false;
        s.error=String(e.message||e);
        s.diags=e.diagnostics && e.diagnostics.length ? e.diagnostics : [diag(e.code||'SDK_SPRITEMESH_PREVIEW','error',s.error,{asset:s.asset})];
        status('',s.error);host.changed();return false;
    }
    function argsFor(path) {
        const args=['sprite-mesh-bake',s.asset,'--out',path,'--depth',String(s.settings.depth),'--alpha-threshold',String(s.settings.alphaThreshold),'--units-per-pixel',String(s.settings.unitsPerPixel)];
        if(s.pivotOverride)args.push('--pivot-x',String(s.settings.pivotX),'--pivot-y',String(s.settings.pivotY));
        return args;
    }
    function changed() { syncFields();renderLists();host.changed(); }
    function syncFields() {
        for (const [field,key] of Object.entries({depth:'depth',threshold:'alphaThreshold',upp:'unitsPerPixel',px:'pivotX',py:'pivotY'}))
            doc.setValue('sm-'+field,String(!s.pivotOverride && (key==='pivotX'||key==='pivotY') && s.frames[frameIndex()] ? s.frames[frameIndex()][key] : s.settings[key]));
    }
    function edit(next, override) {
        if(closed || s.busy)return false;
        if(!override){next.pivotX=0;next.pivotY=0;}
        history.run('Mesh Settings',()=>{model.settings=next;model.pivotOverride=override;});
        s.previewStale=true;changed();return true;
    }
    async function bake(outputPath, saved) {
        if(saved) return saveAndBake();
        if(closed || s.busy || !s.asset)return false;
        s.busy=true;
        // Unique scratch per tab and request; never overwrite another tab's preview.
        const temp=s.asset+'.sprite-mesh-preview-'+doc.id+'-'+(++sequence)+'.cache';
        status('запекаю…');host.changed();
        try {
            const report=requireResult(await host.backend(argsFor(temp)));
            if(closed)return false;
            const cache=$.spriteMesh.loadCache(temp);cache.bytes=report.bytes;
            s.cache=cache;s.previewStale=false;s.error='';s.diags=[];
            status(s.cacheStale?'ПРЕДПРОСМОТР · cache не сохранён':'ПРЕДПРОСМОТР');renderLists();return true;
        } catch(e) { return failure(e); }
        finally { $.fs.remove(temp);s.busy=false;if(!closed)host.changed(); }
    }
    async function saveAndBake() {
        if(closed || s.busy || !s.asset)return false;
        if(s.data && $.fs.readText(s.asset)!==s.savedSource)return failure(Object.assign(new Error('Atlas изменён на диске; переоткройте вкладку'),{code:'SDK_SPRITEMESH_WRITE_CONFLICT'}));
        // First validate geometry with a scratch bake; source is unchanged on failure.
        if(!await bake() || closed)return false;
        s.busy=true;let wrote=false,next=s.savedSource;
        try {
            if(s.data && $.fs.readText(s.asset)!==s.savedSource)throw Object.assign(new Error('Atlas изменён во время bake'),{code:'SDK_SPRITEMESH_WRITE_CONFLICT'});
            const data=s.data ? JSON.parse(s.savedSource) : null;
            if(data && (history.dirty() || !data.re2d || !data.re2d.spriteMesh || data.re2d.spriteMesh.enabled!==true)) {
                data.re2d=data.re2d||{};
                const cfg=Object.assign({},s.settings,{enabled:true});
                if(!s.pivotOverride){delete cfg.pivotX;delete cfg.pivotY;}
                data.re2d.spriteMesh=Object.assign({},data.re2d.spriteMesh||{},cfg);
                if(!s.pivotOverride){delete data.re2d.spriteMesh.pivotX;delete data.re2d.spriteMesh.pivotY;}
                next=JSON.stringify(data,null,2)+'\n';
                if($.fs.write(s.asset,next)===false)throw Object.assign(new Error('Не удалось записать Atlas'),{code:'SDK_WRITE_FAILED'});
                wrote=true;
            }
            // Native command publishes the persistent cache with atomic rename.
            const report=requireResult(await host.backend(argsFor(s.cachePath)));
            s.savedSource=next;history.markSaved();s.cacheStale=false;s.previewStale=false;s.error='';s.diags=[];
            if(!closed){s.cache=$.spriteMesh.loadCache(s.cachePath);s.cache.bytes=report.bytes;status('АКТУАЛЕН');renderLists();}
            return true;
        } catch(e) {
            if(wrote && ($.fs.readText(s.asset)!==next || $.fs.write(s.asset,s.savedSource)===false))
                return failure(Object.assign(new Error('Bake не выполнен; не удалось восстановить Atlas'),{code:'SDK_SPRITEMESH_ROLLBACK'}));
            return failure(e);
        } finally { s.busy=false;if(!closed)host.changed(); }
    }
    function applySettings() {
        const next={};
        for(const [key,id] of Object.entries({depth:'depth',alphaThreshold:'threshold',unitsPerPixel:'upp',pivotX:'px',pivotY:'py'}))next[key]=numberOf(doc,'sm-'+id);
        if(Object.values(next).some(v=>v===null)||next.depth<0||next.depth>1||!Number.isInteger(next.alphaThreshold)||next.alphaThreshold<0||next.alphaThreshold>255||next.unitsPerPixel<=0)
            return failure(Object.assign(new Error('Глубина 0..1; threshold — целое 0..255; units/pixel > 0'),{code:'SDK_SPRITEMESH_SETTINGS'}));
        const f=s.frames[frameIndex()];
        const override=s.pivotOverride || next.pivotX!==f.pivotX || next.pivotY!==f.pivotY;
        if(!edit(next,override))return false;
        return bake();
    }
    function undo() { if(closed||s.busy||!history.undo())return false;s.previewStale=true;changed();return true; }
    function redo() { if(closed||s.busy||!history.redo())return false;s.previewStale=true;changed();return true; }
    function play() { if(!s.animation||!s.tags[s.animation])return;s.playing=true;s.elapsed=0;status(s.cacheStale||s.dirty?'ПРЕДПРОСМОТР · cache не сохранён':'АКТУАЛЕН'); }
    function tick(dt) {
        if(!s.active)return;
        if(s.playing) {
            s.elapsed+=Math.max(0,dt)*1000;
            const seq=s.tags[s.animation];
            const duration=name=>s.frames.find(f=>f.name===name)?.duration||100;
            const total=seq.frames.reduce((sum,name)=>sum+duration(name),0);
            if(total>0) {
                if(seq.loop)s.elapsed%=total;
                else if(s.elapsed>=total){s.elapsed=total;s.playing=false;}
                let t=s.elapsed,idx=0;
                while(idx<seq.frames.length-1 && t>=duration(seq.frames[idx]))t-=duration(seq.frames[idx++]);
                const next=s.frames.findIndex(f=>f.name===seq.frames[idx]);
                if(next>=0 && next!==s.selected)choose(next);
            }
        }
        if(!s.cache || s.texture<0)return;
        const physical=doc.layoutRect('sm-view'),k=uiScale($);
        if(!physical || physical.w<=0 || physical.h<=0)return;
        const r={x:physical.x/k,y:physical.y/k,w:physical.w/k,h:physical.h/k};
        const f=s.cache.frames[frameIndex()];
        if(!f)return;
        const fit=Math.min(
            (r.w-40)/Math.max(1e-6,f.width*s.cache.unitsPerPixel,s.cache.depth),
            (r.h-40)/Math.max(1e-6,f.height*s.cache.unitsPerPixel,s.cache.depth));
        const camera={yaw:s.camera.yaw,pitch:s.camera.pitch,zoom:Math.max(.01,fit*s.camera.zoom)};
        if(s.previewMode==='wireframe') {
            const projected=$.spriteMesh.project(f.vertices,r,camera);
            for(let i=0;i<projected.length;i+=24) {
                for(const [a,b] of [[i,i+8],[i+8,i+16],[i+16,i]])
                    $.gfx.draw.line(projected[a],projected[a+1],projected[b],projected[b+1],'#8bd5ff',1);
            }
        } else $.spriteMesh.draw(s.cache,frameIndex(),s.textures[f.page]===undefined?s.texture:s.textures[f.page],r,camera);
        const px=r.x+r.w/2,py=r.y+r.h/2;
        $.gfx.draw.line(px-7,py,px+7,py,'#ff6b9d',1);
        $.gfx.draw.line(px,py-7,px,py+7,'#ff6b9d',1);
    }
    function wire() {
        doc.on('sm-back','click',()=>host.closeTab && host.closeTab());
        doc.on('sm-save-bake','click',saveAndBake);doc.on('sm-apply','click',applySettings);
        doc.on('sm-pivot-auto','click',()=>{if(edit(Object.assign({},s.settings),false))bake();});
        doc.on('sm-play','click',play);doc.on('sm-pause','click',()=>{s.playing=false;renderLists();});
        doc.on('sm-restart','click',()=>{s.elapsed=0;s.playing=true;if(s.tags[s.animation]){const i=s.frames.findIndex(f=>f.name===s.tags[s.animation].frames[0]);choose(i);}});
        doc.on('sm-prev','click',()=>choose(frameIndex()-1));doc.on('sm-next','click',()=>choose(frameIndex()+1));
        doc.on('sm-frames','click',(id,ev,key)=>{if(key!=='')choose(Number(key));});
        doc.on('sm-animations','click',(id,ev,key)=>{if(s.tags[key]){s.animation=key;const i=s.frames.findIndex(f=>f.name===s.tags[key].frames[0]);choose(i);renderLists();}});
        doc.on('sm-animation','change',()=>{if(s.updatingAnimationList)return;const selected=doc.value('sm-animation');if(selected===s.animation)return;s.animation=selected;const tag=s.tags[s.animation];if(tag){const i=s.frames.findIndex(f=>f.name===tag.frames[0]);choose(i);}});
        doc.on('sm-reset-camera','click',()=>{s.camera={yaw:.55,pitch:.3,zoom:1};});
        doc.on('sm-front','click',()=>{s.camera={yaw:0,pitch:0,zoom:1};});
        doc.on('sm-angle','click',()=>{s.camera={yaw:.55,pitch:.3,zoom:1};});
        doc.on('sm-back-view','click',()=>{s.camera={yaw:Math.PI,pitch:0,zoom:1};});
        doc.on('sm-preview-mode','change',()=>{s.previewMode=doc.value('sm-preview-mode');});
        doc.on('sm-view','mousedown',()=>{const m=$.input.mouse();s.drag={x:m.x,y:m.y};});
    }
    function update(dt) {
        if (closed || !s.active) return;
        if (s.drag) {
            const m = $.input.mouse();
            if ($.input.mouseDown('left')) {
                s.camera.yaw += (m.x-s.drag.x)*.01;
                s.camera.pitch = Math.max(-1.2,Math.min(1.2,s.camera.pitch+(m.y-s.drag.y)*.01));
                s.drag = {x:m.x,y:m.y};
            } else s.drag = null;
        }
        const w = $.input.wheel().y;
        if (w && inside(mousePx($), doc.layoutRect('sm-view')) && !host.typing())
            s.camera.zoom = Math.max(.2,Math.min(8,s.camera.zoom*(w>0?1.1:.9)));
        screenCamera($);tick(dt);
    }

    async function open(path) {
        if(!path)throw new Error('Откройте существующий Sprite asset из Asset Browser');
        s.asset=path;s.cachePath=path+'.sprite-mesh.cache';
        if(path.endsWith('.atlas.json')) {
            s.savedSource=$.fs.readText(path);s.data=readAtlas(path);
            const n=normalize(s.data);s.frames=n.frames;s.tags=n.tags;
            const cfg=s.data.re2d&&s.data.re2d.spriteMesh;
            if(cfg){Object.assign(s.settings,cfg);s.pivotOverride=cfg.pivotX!==undefined||cfg.pivotY!==undefined;}
        } else {
            const size=$.gfx.textureSize(path);
            if(!size||size[0]<=0||size[1]<=0)throw new Error('Не удалось прочитать PNG');
            s.frames=[{name:path.split('/').pop(),x:0,y:0,w:size[0],h:size[1],duration:100,page:0,pivotX:size[0]/2,pivotY:size[1]/2}];
        }
        if(!s.frames.length)throw new Error('В Sprite asset нет кадров');
        s.animation=Object.keys(s.tags)[0]||'';
        if(s.data) {
            const sheet=$.atlas.load('sprite-mesh-'+doc.id,path);
            s.texture=sheet?sheet.texture:-1;
            if(sheet)for(const f of s.frames) {
                const info=sheet.spriteInfo(sheet.frame(f.name));
                if(info)s.textures[info.page]=info.texture;
            }
        } else {s.texture=$.gfx.texture(path);s.textures=[s.texture];}
        doc.text('sm-file',path.split('/').pop());syncFields();renderLists();
        history=createHistory(model);
        const checkArgs=argsFor(s.cachePath);checkArgs.push('--check');
        try {
            const check=await host.backend(checkArgs);
            if(closed)return;
            requireResult(check);
            if(check.json.upToDate) {
                s.cache=$.spriteMesh.loadCache(s.cachePath);s.cacheStale=false;status('АКТУАЛЕН');
            } else await bake();
        } catch(e) {failure(e);}
        renderLists();
    }
    wire();
    function snapshot() {return {asset:s.asset,frames:s.frames.length,animations:Object.keys(s.tags),animation:s.animation,
        selected:s.selected,playing:s.playing,dirty:s.dirty,busy:s.busy,cacheStale:s.cacheStale||s.dirty,
        previewStale:s.previewStale,settings:Object.assign({},s.settings),pivotOverride:s.pivotOverride,texture:s.texture,
        cache:s.cache?$.spriteMesh.cacheInfo(s.cache):null,error:s.error};}
    const api={doc,state:s,open,update,onActive(on){s.active=on;s.drag=null;},save:saveAndBake,saveAndBake,bake,
        undo,redo,dirty:()=>s.dirty,diagnostics:()=>s.diags,snapshot,render:renderLists,
        close(){closed=true;s.active=false;s.playing=false;s.drag=null;doc.hide();doc.place(null);return true;},
        selectFrame:choose,selectAnimation(name){if(!s.tags[name])return false;s.animation=name;s.elapsed=0;choose(s.frames.findIndex(f=>f.name===s.tags[name].frames[0]));return true;},
        play,pause(){s.playing=false;renderLists();},ops:{applySettings,preview:bake},
        commands:()=>[{label:'SpriteMesh: Bake preview',run:bake},{label:'SpriteMesh: Save + Bake',run:saveAndBake}],
    };
    return api;
}
