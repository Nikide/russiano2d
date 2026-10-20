// SpriteMesh authoring frontend: existing Atlas is canonical; native r2d-sdk
// builds one cache containing geometry for every frame.
import { escapeHtml } from '../lib/model.js';

const DOC = 'sdk/ui/sprite_mesh_studio.rml';
let current = null;

export async function open(app, args) {
    if (!current) current = create(app);
    return current.open(args.assetAbs || args.asset || null);
}

function create(app) {
    // Хост может дать свою раскладку с теми же id (Editor: editor/ui/sprite_mesh.rml);
    // в ней же лента кадров с миниатюрами (layouts.spriteMeshThumbs).
    const $ = app.$, doc = $.ui.doc((app.layouts && app.layouts.spriteMesh) || DOC);
    const thumbs = !!(app.layouts && app.layouts.spriteMeshThumbs);
    const s = { active: false, asset: '', cachePath: '', data: null, frames: [], tags: {}, texture: -1, textures: [],
        cache: null, selected: 0, animation: '', playing: false, elapsed: 0, camera: { yaw: .55, pitch: .3, zoom: 1 },
        drag: null, previewMode: 'textured', pivotOverride: false, updatingAnimationList: false, dirty: true, settings: { depth: .08, alphaThreshold: 16, unitsPerPixel: 1/32, pivotX: 0, pivotY: 0 }, error: '' };
    function status(text, error) { doc.text('sm-state', error ? 'ОШИБКА' : text); doc.text('sm-errors', error ? escapeHtml(error) : ''); }
    function readAtlas(path) {
        const raw = $.fs.readText(path);
        if (!raw) throw new Error('Не удалось прочитать Sprite/Atlas asset: ' + path);
        return JSON.parse(raw);
    }
    function normalize(data) {
        const fs = [], source = data.frames, pages=(data.meta&&data.meta.pages)||data.pages||[];
        const pageName=(p,i)=>typeof p==='string'?'page'+i:String(p.name===undefined?'page'+i:p.name);
        const pageIndex=value=>{if(value===undefined||value===null)return 0;if(Number.isInteger(value))return value;const i=pages.findIndex((p,n)=>pageName(p,n)===value);return i<0?0:i;};
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
    function choose(i) { s.selected=Math.max(0,Math.min(s.frames.length-1,i|0));if(!s.pivotOverride){const f=s.frames[s.selected];s.settings.pivotX=f.pivotX;s.settings.pivotY=f.pivotY;doc.setValue('sm-px',String(f.pivotX));doc.setValue('sm-py',String(f.pivotY));}renderLists(); }
    function renderLists() {
        doc.html('sm-frames', s.frames.map((f,i)=>thumbs
            ? `<button class="item thumb ${i===s.selected?'on':''}" data-key="${i}">${pageImage(f.page)?`<img class="thumb-img" src="${escapeHtml(pageImage(f.page))}" rect="${f.x} ${f.y} ${f.w} ${f.h}"/>`:''}<span class="thumb-n">${i}</span></button>`
            : `<button class="item ${i===s.selected?'on':''}" data-key="${i}">[${i}] ${escapeHtml(f.name)}</button>`).join(''));
        doc.html('sm-animations', Object.keys(s.tags).map((n,i)=>`<button id="sm-anim-${i}" class="item ${n===s.animation?'on':''}" data-key="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join(''));
        s.updatingAnimationList=true;
        doc.html('sm-animation', Object.keys(s.tags).map(n=>`<option value="${escapeHtml(n)}" ${n===s.animation?'selected':''}>${escapeHtml(n)}</option>`).join(''));
        s.updatingAnimationList=false;
        const f=s.frames[frameIndex()], m=s.cache&&s.cache.frames[frameIndex()];
        doc.html('sm-stats', m ? `Кадр ${frameIndex()+1} / ${s.frames.length}<br/>Непрозрачные пиксели: ${m.opaquePixels.toLocaleString()}<br/>Вершины: ${m.vertices.length/8|0}<br/>Треугольники: ${m.vertices.length/24|0}<br/>Кэш: ${s.cache.bytes.toLocaleString()} байт` : 'Mesh cache ещё не собран. Нажмите «Bake всех кадров».');
        doc.text('sm-hud', f ? `${f.name} · ${frameIndex()+1}/${s.frames.length} · ${s.playing?'воспроизведение':'пауза'}` : '—');
    }
    async function bake(outputPath, saved) {
        if (!s.asset) return;
        status('запекаю…');
        try {
            const args=['sprite-mesh-bake',s.asset,'--out',outputPath||s.cachePath,'--depth',String(s.settings.depth),'--alpha-threshold',String(s.settings.alphaThreshold),'--units-per-pixel',String(s.settings.unitsPerPixel)];
            if(s.pivotOverride)args.push('--pivot-x',String(s.settings.pivotX),'--pivot-y',String(s.settings.pivotY));
            const result=await app.backend(args,'SpriteMesh: bake всех кадров');
            if(!result.ok||!result.json||!result.json.ok)throw new Error((result.json&&result.json.diagnostics||[]).map(d=>d.message).join('\n')||'Bake завершился с ошибкой');
            s.cache=$.spriteMesh.loadCache(outputPath||s.cachePath);s.cache.bytes=result.json.bytes;s.dirty=!saved;s.error='';
            if(!saved&&outputPath&&$.fs&&typeof $.fs.remove==='function')$.fs.remove(outputPath);
            status(saved?'АКТУАЛЕН':'ПРЕДПРОСМОТР · не сохранён');renderLists();
        } catch(e) { s.error=e.message||String(e);status('',s.error); }
    }
    function saveAndBake() {
        if (s.asset.endsWith('.atlas.json')) {
            s.data.re2d = s.data.re2d || {};
            s.data.re2d.spriteMesh = Object.assign({}, s.settings, { enabled: true });
            if(!s.pivotOverride){delete s.data.re2d.spriteMesh.pivotX;delete s.data.re2d.spriteMesh.pivotY;}
            if ($.fs.write(s.asset, JSON.stringify(s.data, null, 2)) === false) {
                status('', 'Не удалось сохранить настройки SpriteMesh в Sprite asset'); return;
            }
        }
        return bake(s.cachePath, true);
    }
    function applySettings() {
        const n=id=>Number(doc.value(id));
        const next={depth:n('sm-depth'),alphaThreshold:n('sm-threshold'),unitsPerPixel:n('sm-upp'),pivotX:n('sm-px'),pivotY:n('sm-py')};
        if(!Object.values(next).every(Number.isFinite)||next.depth<0||next.depth>1||next.alphaThreshold<0||next.alphaThreshold>255||next.unitsPerPixel<=0){status('', 'Проверьте числа: глубина 0..1, threshold 0..255, units/pixel > 0');return;}
        const selected=s.frames[frameIndex()];if(selected&&(next.pivotX!==selected.pivotX||next.pivotY!==selected.pivotY))s.pivotOverride=true;
        s.settings=next;s.dirty=true;status('обновляю предпросмотр…');renderLists();
        return bake(s.asset+'.sprite-mesh-preview.cache', false);
    }
    function play() { if(!s.animation||!s.tags[s.animation])return;s.playing=true;s.elapsed=0;status(s.dirty?'ТРЕБУЕТСЯ BAKE':'АКТУАЛЕН'); }
    function tick(dt) {
        if(!s.active)return;
        if(s.playing){s.elapsed+=Math.max(0,dt)*1000;const seq=s.tags[s.animation];let total=seq.frames.reduce((a,n)=>a+(s.frames.find(f=>f.name===n)?.duration||100),0);if(total>0){if(seq.loop)s.elapsed%=total;else if(s.elapsed>=total){s.elapsed=total;s.playing=false;}let t=s.elapsed,idx=0;while(idx<seq.frames.length-1&&t>=(s.frames.find(f=>f.name===seq.frames[idx])?.duration||100)){t-=s.frames.find(f=>f.name===seq.frames[idx])?.duration||100;idx++;}const next=s.frames.findIndex(f=>f.name===seq.frames[idx]);if(next>=0&&next!==s.selected)choose(next);}}
        if(s.cache&&s.texture>=0){const r=doc.layoutRect('sm-view');if(r&&r.w>0&&r.h>0){const f=s.cache.frames[frameIndex()];if(f){const camera={yaw:s.camera.yaw,pitch:s.camera.pitch,zoom:Math.max(.01,Math.min((r.w-40)/Math.max(1,f.width*s.cache.unitsPerPixel),(r.h-40)/Math.max(1,f.height*s.cache.unitsPerPixel))*s.camera.zoom)};if(s.previewMode==='wireframe'){const p=$.spriteMesh.project(f.vertices,r,camera);for(let i=0;i<p.length;i+=24){const a=i,b=i+8,c=i+16;$.gfx.draw.line(p[a],p[a+1],p[b],p[b+1],'#8bd5ff',1);$.gfx.draw.line(p[b],p[b+1],p[c],p[c+1],'#8bd5ff',1);$.gfx.draw.line(p[c],p[c+1],p[a],p[a+1],'#8bd5ff',1);}}else $.spriteMesh.draw(s.cache,frameIndex(),s.textures[f.page]===undefined?s.texture:s.textures[f.page],r,camera);const px=r.x+r.w/2,py=r.y+r.h/2;$.gfx.draw.line(px-7,py,px+7,py,'#ff6b9d',1);$.gfx.draw.line(px,py-7,px,py+7,'#ff6b9d',1);}}}
    }
    function wire() {
        doc.on('sm-back','click',()=>{s.active=false;doc.hide();if(app.doc)app.doc.show();if(app.showView)app.showView('tools');});
        doc.on('sm-save-bake','click',saveAndBake);doc.on('sm-apply','click',applySettings);
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
        $.update(dt=>{if(!s.active){s.drag=null;return;}if(s.drag){const m=$.input.mouse();if($.input.mouseDown('left')){s.camera.yaw+=(m.x-s.drag.x)*.01;s.camera.pitch=Math.max(-1.2,Math.min(1.2,s.camera.pitch+(m.y-s.drag.y)*.01));s.drag={x:m.x,y:m.y};}else s.drag=null;}const w=$.input.wheel().y;if(w)s.camera.zoom=Math.max(.2,Math.min(8,s.camera.zoom*(w>0?1.1:.9)));tick(dt);});
    }
    wire();
    async function open(path) {
        if(!path)throw new Error('Откройте существующий Sprite asset из Asset Browser');
        s.active=true;s.asset=path;s.cachePath=path+'.sprite-mesh.cache';
        if(path.endsWith('.atlas.json')){s.data=readAtlas(path);const n=normalize(s.data);s.frames=n.frames;s.tags=n.tags;const cfg=s.data.re2d&&s.data.re2d.spriteMesh;if(cfg){s.settings=Object.assign(s.settings,cfg);s.pivotOverride=cfg.pivotX!==undefined||cfg.pivotY!==undefined;}if(!s.pivotOverride){s.settings.pivotX=s.frames[0].pivotX;s.settings.pivotY=s.frames[0].pivotY;}}
        else {const size=$.gfx.textureSize(path);if(!size||size[0]<=0||size[1]<=0)throw new Error('Не удалось прочитать PNG');s.data=null;s.frames=[{name:path.split('/').pop(),x:0,y:0,w:size[0],h:size[1],duration:100,page:0,pivotX:size[0]/2,pivotY:size[1]/2}];s.tags={};if(!s.pivotOverride){s.settings.pivotX=size[0]/2;s.settings.pivotY=size[1]/2;}}
        if(!s.frames.length)throw new Error('В Sprite asset нет кадров');
        s.animation=Object.keys(s.tags)[0]||'';s.selected=0;
        if(path.endsWith('.atlas.json')){const sheet=$.atlas.load('sprite-mesh-'+path,path);s.texture=sheet?sheet.texture:-1;s.textures=[];if(sheet)for(const f of s.frames){const info=sheet.spriteInfo(sheet.frame(f.name));if(info)s.textures[info.page]=info.texture;}}
        else {s.texture=$.gfx.texture(path);s.textures=[s.texture];}
        doc.text('sm-file',path.split('/').pop());doc.setValue('sm-depth',String(s.settings.depth));doc.setValue('sm-threshold',String(s.settings.alphaThreshold));doc.setValue('sm-upp',String(s.settings.unitsPerPixel));doc.setValue('sm-px',String(s.settings.pivotX||0));doc.setValue('sm-py',String(s.settings.pivotY||0));
        if(app.doc)app.doc.hide();doc.show();renderLists();app.studios.spriteMesh=api;
        const checkArgs=['sprite-mesh-bake',s.asset,'--check','--depth',String(s.settings.depth),'--alpha-threshold',String(s.settings.alphaThreshold),'--units-per-pixel',String(s.settings.unitsPerPixel)];if(s.pivotOverride)checkArgs.push('--pivot-x',String(s.settings.pivotX),'--pivot-y',String(s.settings.pivotY));
        const check=await app.backend(checkArgs,'SpriteMesh: проверка cache');
        if(check.json&&check.json.upToDate){try{s.cache=$.spriteMesh.loadCache(s.cachePath);s.dirty=false;status('АКТУАЛЕН');}catch(e){s.cache=null;s.dirty=true;status('',e.message);}}
        else{s.cache=null;s.dirty=true;await bake(s.asset+'.sprite-mesh-preview.cache',false);}
        renderLists();
        return {id:'sprite-mesh-studio',studio:api};
    }
    const api={state:s,render:renderLists,close(){s.active=false;s.playing=false;doc.hide();return true;},
        diagnostics:()=>s.error?[{code:'SDK_SPRITE_MESH',severity:'error',asset:s.asset,location:null,message:s.error}]:[],
        open,bake,saveAndBake,selectFrame:choose,selectAnimation(name){if(!s.tags[name])return false;s.animation=name;const i=s.frames.findIndex(f=>f.name===s.tags[name].frames[0]);choose(i);renderLists();return true;},play,pause:()=>{s.playing=false;},snapshot:()=>({asset:s.asset,frames:s.frames.length,animations:Object.keys(s.tags),animation:s.animation,selected:s.selected,playing:s.playing,dirty:s.dirty,texture:s.texture,cache:s.cache?$.spriteMesh.cacheInfo(s.cache):null,error:s.error})};
    return api;
}
