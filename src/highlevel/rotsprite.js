// Re2DSprite: один общий PNG персонажа → синтез персонажа в обычном 2D-батче.
import { engine } from './native.js';
import { TAGS, def, withAlpha } from './core.js';
import { registerNodeRenderer } from './render.js';

export function normalizeRotPose(yaw = 0, pitch = 0) {
    if (typeof yaw !== 'number' || typeof pitch !== 'number' ||
        !Number.isFinite(yaw) || !Number.isFinite(pitch)) {
        throw new RangeError('$.re2dSprite: yaw/pitch должны быть конечными числами');
    }
    const y = ((yaw % 360) + 540) % 360 - 180;
    return { yaw: y === 0 ? 0 : y, pitch: Math.max(-75, Math.min(75, pitch)) };
}

export function rotPixelRect(t, rasterSize = 64) {
    const scale = Math.max(1, Math.round(Math.min(Math.abs(t.w), Math.abs(t.h)) / rasterSize));
    const size = rasterSize * scale;
    const left = Math.round(t.x - size / 2), top = Math.round(t.y - size / 2);
    return { x: left + size / 2, y: top + size / 2, w: size, h: size, scale };
}

const FACE = {eyes:['open','half','closed','happy'],mouth:['closed','open','smile','talk'],brows:['neutral','angry','sad','surprised']};
const identity = () => [1,0,0,0,0,1,0,0,0,0,1,0];
const finite = (v,label) => {if (typeof v!=='number' || !Number.isFinite(v) || Math.abs(v)>1e6) throw new RangeError(`Re2DSprite JSON: ${label} — конечное число`);return v;};
const vector = (v,fallback,label) => {v=v ?? fallback;if (!Array.isArray(v) || v.length!==3) throw new TypeError(`Re2DSprite JSON: ${label} — три числа`);return v.map(x=>finite(x,label));};
function cloneData(v) {return JSON.parse(JSON.stringify(v,(k,x)=>{if (typeof x==='function' || typeof x==='symbol' || typeof x==='number' && !Number.isFinite(x)) throw new TypeError('Re2DSprite JSON: только JSON-данные');return x;}));}
function name(v) {if (typeof v!=='string' || !v || v.length>80 || ['__proto__','constructor','prototype'].includes(v)) throw new TypeError('Re2DSprite JSON: имя');return v;}
export function validateRotDefinition(source) {
    const d=cloneData(source);
    if (!d || d.version!==1 || typeof d.atlas!=='string' || !d.atlas) throw new TypeError('Re2DSprite JSON: version=1 и atlas');
    d.style=d.style ?? 'anime';if (!['anime','pixel'].includes(d.style)) throw new TypeError('Re2DSprite JSON: style');
    const rig=d.rig;if (!rig || !Array.isArray(rig.bones) || !rig.bones.length || rig.bones.length>64 || !Array.isArray(rig.parts) || !rig.parts.length || rig.parts.length>254) throw new TypeError('Re2DSprite JSON: 1..64 bones, 1..254 parts');
    const names=new Set(),ids=new Set();
    for (const b of rig.bones) {
        name(b.name);if (names.has(b.name) || b.parent!=null && !names.has(b.parent)) throw new TypeError('Re2DSprite JSON: уникальные bones, родитель раньше ребёнка');
        names.add(b.name);b.pivot=vector(b.pivot,[0,0,0],'pivot');b.portraitPivot=vector(b.portraitPivot,b.pivot,'portraitPivot');
    }
    const binding=b => {b=b ?? {};return {scale:vector(b.scale,[1,1,1],'bind.scale'),translation:vector(b.translation,[0,0,0],'bind.translation'),rotation:vector(b.rotation,[0,0,0],'bind.rotation')};};
    for (const p of rig.parts) {
        if (!Number.isInteger(p.id) || p.id<1 || p.id>254 || ids.has(p.id) || !names.has(p.bone)) throw new TypeError('Re2DSprite JSON: уникальный part.id 1..254 и существующая bone');
        ids.add(p.id);p.bind=binding(p.bind);p.portraitBind=binding(p.portraitBind ?? p.bind);
        if (p.selector!=null && !Object.hasOwn(FACE,p.selector) || p.selector && (!Number.isInteger(p.variant) || p.variant<0 || p.variant>3)) throw new TypeError('Re2DSprite JSON: selector и variant 0..3');
        for (const key of ['portrait','oneSided']) if (p[key]!=null && typeof p[key]!=='boolean') throw new TypeError(`Re2DSprite JSON: ${key} — boolean`);
    }
    d.groups=d.groups ?? {};for (const [key,list] of Object.entries(d.groups)) {
        name(key);if (!Array.isArray(list) || !list.length || new Set(list).size!==list.length || list.some(id=>!ids.has(id))) throw new TypeError('Re2DSprite JSON: группа содержит ID описанных частей');
    }
    rig.joints=rig.joints ?? [];const jointNames=new Set();
    if (!Array.isArray(rig.joints) || rig.joints.length>128) throw new TypeError('Re2DSprite JSON: joints');
    for (const j of rig.joints) {name(j.name);if (jointNames.has(j.name) || !names.has(j.bone)) throw new TypeError('Re2DSprite JSON: joint');jointNames.add(j.name);j.point=vector(j.point,[0,0,0],'joint.point');}
    rig.controls=rig.controls ?? {};for (const [key,c] of Object.entries(rig.controls)) {name(key);if (!names.has(c.bone) || !['x','y','z'].includes(c.axis)) throw new TypeError('Re2DSprite JSON: control bone/axis');}
    d.projection=d.projection ?? {};for (const key of ['bodyScale','portraitScale']) {d.projection[key]=finite(d.projection[key] ?? (key==='bodyScale'?1:2),key);if (d.projection[key]<=0 || d.projection[key]>8) throw new RangeError('Re2DSprite JSON: projection 0..8');}
    rig.sockets=rig.sockets ?? [];const sockets=new Set();
    if (!Array.isArray(rig.sockets) || rig.sockets.length>128) throw new TypeError('Re2DSprite JSON: sockets');
    for (const socket of rig.sockets) {
        name(socket.name);if (sockets.has(socket.name) || !names.has(socket.bone)) throw new TypeError('Re2DSprite JSON: socket');sockets.add(socket.name);
        socket.point=vector(socket.point,[0,0,0],'socket.point');socket.rotation=vector(socket.rotation,[0,0,0],'socket.rotation');
        if (socket.portrait!=null && typeof socket.portrait!=='boolean') throw new TypeError('Re2DSprite JSON: socket.portrait');
    }
    d.defaults=d.defaults ?? {};if (d.defaults.body!=null && typeof d.defaults.body!=='boolean') throw new TypeError('Re2DSprite JSON: defaults.body');
    d.emotions=d.emotions ?? {};for (const [key,e] of Object.entries(d.emotions)) {name(key);for (const [component,value] of Object.entries(e)) if (!FACE[component]?.includes(value)) throw new TypeError('Re2DSprite JSON: эмоция');}
    return d;
}
export function validateRotAnimations(source,definition) {
    const a=cloneData(source);
    if (!a || a.version!==1 || !a.clips || typeof a.clips!=='object' || Array.isArray(a.clips) || Object.keys(a.clips).length>64) throw new TypeError('Re2DSprite JSON: animations version=1, clips');
    const bones=new Set(definition.rig.bones.map(b=>b.name));
    for (const [key,c] of Object.entries(a.clips)) {
        name(key);finite(c.duration,'duration');if (c.duration<=0 || typeof c.loop!=='boolean' || !Array.isArray(c.tracks) || c.tracks.length>256) throw new TypeError('Re2DSprite JSON: duration>0, loop, tracks');
        const used=new Set();
        for (const t of c.tracks) {
            const face=t.target==='face';
            if (face ? !Object.hasOwn(FACE,t.channel) : !bones.has(t.target) || !/^(rotation|translation)\.[xyz]$/.test(t.channel)) throw new TypeError('Re2DSprite JSON: track target/channel');
            const id=t.target+':'+t.channel;if (used.has(id)) throw new TypeError('Re2DSprite JSON: повтор track');used.add(id);
            t.interpolation=t.interpolation ?? (face?'step':'linear');if (!['linear','step'].includes(t.interpolation) || face && t.interpolation!=='step') throw new TypeError('Re2DSprite JSON: interpolation');
            if (!Array.isArray(t.keys) || !t.keys.length || t.keys.length>1024) throw new TypeError('Re2DSprite JSON: keys');
            let previous=-1;for (const k of t.keys) {
                if (!Array.isArray(k) || k.length!==2) throw new TypeError('Re2DSprite JSON: [time,value]');
                finite(k[0],'key.time');if (k[0]<0 || k[0]>c.duration || k[0]<=previous) throw new RangeError('Re2DSprite JSON: ключи возрастают в 0..duration');previous=k[0];
                if (face) {if (!FACE[t.channel].includes(k[1])) throw new TypeError('Re2DSprite JSON: ключ выражения');}else finite(k[1],'key.value');
            }
        }
    }
    return a;
}
export function sampleRotClip(clip,time) {
    finite(time,'animation time');if (time<0) throw new RangeError('Re2DSprite JSON: time>=0');
    const t=clip.loop ? time%clip.duration : Math.min(time,clip.duration),bones={},face={};
    for (const track of clip.tracks) {
        const keys=track.keys;let value=keys[0][1];
        for (let i=0;i<keys.length;i++) {
            if (t<keys[i][0]) break;value=keys[i][1];
            if (i+1<keys.length && t<keys[i+1][0]) {
                if (track.interpolation==='linear') value+=(keys[i+1][1]-value)*(t-keys[i][0])/(keys[i+1][0]-keys[i][0]);break;
            }
        }
        if (track.target==='face') face[track.channel]=value;
        else {bones[track.target] ??= {};bones[track.target][track.channel]=value;}
    }
    return {bones,face,time:t,ended:!clip.loop && time>=clip.duration};
}
function multiply(a,b) {
    const m=Array(12).fill(0);
    for (let row=0;row<3;row++) {for (let col=0;col<3;col++) for (let j=0;j<3;j++) m[row*4+col]+=a[row*4+j]*b[j*4+col];m[row*4+3]=a[row*4+3];for (let j=0;j<3;j++) m[row*4+3]+=a[row*4+j]*b[j*4+3];}return m;
}
function affine(pivot,translation,rotation,scale=[1,1,1]) {
    const [x,y,z]=rotation.map(v=>v*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
    const m=[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx,0,sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx,0,-sy,cy*sx,cy*cx,0];
    for (let row=0;row<3;row++) {for (let col=0;col<3;col++) m[row*4+col]*=scale[col];m[row*4+3]=pivot[row]+translation[row]-m[row*4]*pivot[0]-m[row*4+1]*pivot[1]-m[row*4+2]*pivot[2];}return m;
}
const transform = (m,p) => [0,1,2].map(row=>m[row*4]*p[0]+m[row*4+1]*p[1]+m[row*4+2]*p[2]+m[row*4+3]);
export function buildRotModelPose(definition,sample={},rig={},manual={},visibleParts=null) {
    const boneMatrices={},body=rig.body!==false;
    for (const b of definition.rig.bones) {
        const values={...sample.bones?.[b.name],...manual[b.name]};
        const rotation=['x','y','z'].map(k=>values['rotation.'+k] ?? 0),translation=['x','y','z'].map(k=>values['translation.'+k] ?? 0);
        for (const [key,c] of Object.entries(definition.rig.controls)) if (c.bone===b.name) rotation[['x','y','z'].indexOf(c.axis)]+=rig[key] || 0;
        const local=affine(body?b.pivot:b.portraitPivot,translation,rotation);
        boneMatrices[b.name]=multiply(b.parent?boneMatrices[b.parent]:identity(),local);
    }
    const records=definition.rig.parts.map(p=>{
        const bind=body?p.bind:p.portraitBind,m=multiply(boneMatrices[p.bone],affine([0,0,0],bind.translation,bind.rotation,bind.scale));
        return [p.id,p.selector ? ['','eyes','mouth','brows'].indexOf(p.selector):0,p.variant ?? 0,p.oneSided?1:0,(body || p.portrait) && (visibleParts===null || visibleParts.includes(p.id)) ? 1:0,...m];
    });
    return {records,bones:boneMatrices,scale:body?definition.projection.bodyScale:definition.projection.portraitScale};
}
function inverse(m) {
    const a=m[0],b=m[1],c=m[2],d=m[4],e=m[5],f=m[6],g=m[8],h=m[9],i=m[10],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
    if (Math.abs(det)<1e-8) throw new RangeError('Re2DSprite: вырожденная матрица точки хвата');
    const n=[(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det,0,(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det,0,(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det,0];
    for (let row=0;row<3;row++) n[row*4+3]=-n[row*4]*m[3]-n[row*4+1]*m[7]-n[row*4+2]*m[11];return n;
}
function socketMatrix(r,key,pose=r.modelPose) {
    const socket=r.definition.rig.sockets.find(s=>s.name===key);
    if (!socket) throw new TypeError(`Re2DSprite: сокет ${key} отсутствует в JSON`);
    return multiply(pose.bones[socket.bone],affine([0,0,0],socket.point,socket.rotation));
}
function applyModel($,node) {
    const r=node.rot_sprite,c=r.animations.clips[r.motion.mode],sample=c?sampleRotClip(c,r.motion.time || 0):{bones:{},face:{}};
    for (const [key,layer] of Object.entries(r.layers)) {
        const extra=sampleRotClip(r.animations.clips[key],layer.time);
        for (const [bone,values] of Object.entries(extra.bones)) sample.bones[bone]={...sample.bones[bone],...values};
        Object.assign(sample.face,extra.face);
    }
    r.modelPose=buildRotModelPose(r.definition,sample,r.rig,r.boneOverrides,r.visibleParts ?? null);
    let pose=engine.rotSpriteInfo(r.handle);
    if (r.attachment) {
        const a=r.attachment,parent=a.parent.rot_sprite;
        if (!parent?.definition) throw new TypeError('Re2DSprite: родитель крепления освобождён');
        let mount=multiply(socketMatrix(parent,a.socket),affine([0,0,0],a.offset,a.rotation,a.scale));
        if (a.grip) mount=multiply(mount,inverse(socketMatrix(r,a.grip)));
        r.modelPose.records=r.modelPose.records.map(row=>[...row.slice(0,5),...multiply(mount,row.slice(5))]);
        for (const key of Object.keys(r.modelPose.bones)) r.modelPose.bones[key]=multiply(mount,r.modelPose.bones[key]);
        r.modelPose.scale=parent.modelPose.scale;
        if (!parent.rig.body && !parent.definition.rig.sockets.find(s=>s.name===a.socket).portrait) for (const row of r.modelPose.records) row[4]=0;
        pose=engine.rotSpriteInfo(parent.handle);
        const position=$(a.parent).globalPos();$(node).at(position.x,position.y).size(a.parent.w*Math.abs(a.parent.scale_x),a.parent.h*Math.abs(a.parent.scale_y));
        const center=transform(mount,[0,0,0]),angle=pose.yaw*Math.PI/180,pt=pose.pitch*Math.PI/180;
        const z=Math.sin(pt)*center[1]+Math.cos(pt)*(-Math.sin(angle)*center[0]+Math.cos(angle)*center[2]);
        node.layer=a.parent.layer;node.depth=a.parent.depth+(z>=0?.01:-.01);
    }
    engine.rotSpriteModelPose(r.handle,r.modelPose.scale,r.modelPose.records,!!r.rig.body);
    const face={eyes:FACE.eyes[pose.eyes ?? 0],mouth:FACE.mouth[pose.mouth ?? 0],brows:FACE.brows[pose.brows ?? 0],...r.faceBase,...sample.face};
    const submit=r.worldComposed && typeof engine.rotSpritePrepare==='function' ? engine.rotSpritePrepare : engine.rotSpritePose;
    r.sprite=submit(r.handle,pose.yaw ?? 0,pose.pitch ?? 0,FACE.eyes.indexOf(face.eyes),FACE.mouth.indexOf(face.mouth),FACE.brows.indexOf(face.brows));
    for (const child of r.children) if (child.rot_sprite) applyModel($,child);
}
// World asks native C to coalesce animated model state and the final view pose.
export function prepareRotWorldPose(node,yaw,pitch) {
    const r=node.rot_sprite,p=normalizeRotPose(yaw,pitch);r.worldComposed=true;
    const submit=typeof engine.rotSpritePrepare==='function' ? engine.rotSpritePrepare : engine.rotSpritePose;
    r.sprite=submit(r.handle,p.yaw,p.pitch);
    for(const child of r.children || [])if(child.rot_sprite){child.rot_sprite.worldComposed=true;applyModel(rotApi,child);}
}
// Configuration-time registration mirror. Native render never converts Sets.
export function registerRotWorldNode(node) {
    const r=node.rot_sprite;if(!r)return;
    r.worldComposed=true;r.nativeChildren=[...(r.children || [])];
    for(const child of r.nativeChildren)registerRotWorldNode(child);
}
function modelJoints(r,pose) {
    const cy=Math.cos(pose.yaw*Math.PI/180),sy=Math.sin(pose.yaw*Math.PI/180),cp=Math.cos(pose.pitch*Math.PI/180),sp=Math.sin(pose.pitch*Math.PI/180),result={};
    for (const j of r.definition.rig.joints) {const [x,y,z]=transform(r.modelPose.bones[j.bone],j.point),zz=-sy*x+cy*z;result[j.name]={x:64+(cy*x+sy*z)*r.modelPose.scale,y:64+(cp*y-sp*zz)*r.modelPose.scale};}return result;
}
export function relativeAsset(file,path) {
    if (typeof path!=='string' || !path) throw new TypeError('Re2DSprite JSON: путь');
    if (path.startsWith('/')) return path;
    // Модель по абсолютному пути (так её открывает SDK): ведущий «/» нельзя терять,
    // иначе атлас рядом с ней превращается в относительный путь и не находится.
    const root=typeof file==='string' && file.startsWith('/') ? '/' : '';
    const parts=(file?file.slice(0,file.lastIndexOf('/')+1):'').split('/').filter(Boolean);
    for (const p of path.split('/')) {if (p==='..') {if (!parts.length) throw new RangeError('Re2DSprite JSON: путь выходит за корень');parts.pop();}else if (p && p!=='.') parts.push(p);}
    return root+parts.join('/');
}
function readDefinition($,source) {
    const read=p=>{const text=$.fs.readText(p);if (text==null) throw new Error(`Re2DSprite JSON: не удалось прочитать ${p}`);return JSON.parse(text);};
    const file=typeof source==='string'?source:null,d=validateRotDefinition(file?read(file):source);
    const atlas=relativeAsset(file,d.atlas),animationPath=typeof d.animations==='string'?relativeAsset(file,d.animations):null;
    const animations=validateRotAnimations(animationPath?read(animationPath):d.animations ?? {version:1,clips:{}},d);
    return {definition:d,animations,atlas,source:file ?? cloneData(source),files:[file,animationPath].filter(Boolean)};
}

function release(node,detach=true) {
    if (detach && node.rot_sprite?.definition) {
        if (node.rot_sprite.attachment) node.rot_sprite.attachment.parent.rot_sprite?.children.delete(node);
        for (const child of [...node.rot_sprite.children]) if (child.rot_sprite) rotApi(child).rotDetach();
    }
    if (node.rot_sprite) engine.rotSpriteDispose(node.rot_sprite.handle);
    node.rot_sprite = null;
}

let rotApi, pollTime=0;
export function installRotSprite($) {
    rotApi=$;
    TAGS.rotsprite = { w: 64, h: 64, body: null };
    def('rotSpriteAtlas', function (path) { return this.eachNode((i,node) => {
        if (node.tag !== 'rotsprite') throw new TypeError('rotSpriteAtlas: нужен узел <rotsprite>');
        if (typeof path !== 'string' || !path) throw new TypeError('rotSpriteAtlas: нужен путь к общему PNG');
        // Не теряем действующий ресурс, если новый PNG не прошёл проверку.
        const handle = engine.rotSpriteLoad(path);
        const info = engine.rotSpriteInfo(handle);
        release(node);
        node.rot_sprite = { handle, path, sprite: info.sprite, width: info.width, style: 'pixel', rig: {}, motion: {mode:'idle',speed:1}, parts: {}, stamps: {}, hotReload: false, reloads: 0 };
        if (!node.rot_cleanup) {
            node.rot_cleanup = true;
            node.on('remove', () => release(node));
        }
    }); });
    def('rotStyle', function (style='anime') { return this.eachNode((i,node) => {
        if (!node.rot_sprite || !['pixel','anime'].includes(style)) throw new TypeError('rotStyle: pixel / anime');
        if (node.rot_sprite.style===style) return;
        const old=node.rot_sprite,previous=old.style;old.style=style;
        try { $(node).rotReload(); }
        catch (error) {old.style=previous;throw error;}
    }); });
    def('rotPose', function (yaw, pitch = 0) { return this.eachNode((i,node) => {
        const p = normalizeRotPose(yaw,pitch);
        if (!node.rot_sprite) throw new TypeError('rotPose: сначала вызовите .rotSpriteAtlas(path)');
        if (node.rot_sprite.attachment) throw new TypeError('rotPose: у закреплённого объекта поворот задаёт родитель, локальный — rotAttach.rotation');
        node.rot_sprite.sprite = engine.rotSpritePose(node.rot_sprite.handle,p.yaw,p.pitch);
        if (node.rot_sprite.children) for (const child of node.rot_sprite.children) if (child.rot_sprite) applyModel($,child);
    }); });
    def('rotExpression', function ({eyes = 'open', mouth = 'closed', brows = 'neutral'} = {}) {
        const e = ['open','half','closed','happy'].indexOf(eyes);
        const m = ['closed','open','smile','talk'].indexOf(mouth);
        const b = ['neutral','angry','sad','surprised'].indexOf(brows);
        if (e<0 || m<0 || b<0) throw new RangeError('rotExpression: неизвестное выражение');
        return this.eachNode((i,node) => {
            if (!node.rot_sprite) throw new TypeError('rotExpression: сначала загрузите PNG');
            if (node.rot_sprite.definition) {node.rot_sprite.faceBase={eyes,mouth,brows};applyModel($,node);return;}
            const p=engine.rotSpriteInfo(node.rot_sprite.handle);
            node.rot_sprite.sprite=engine.rotSpritePose(node.rot_sprite.handle,p.yaw,p.pitch,e,m,b);
        });
    });
    def('rotEmotion', function (name) {
        const a={neutral:{},happy:{eyes:'happy',mouth:'smile'},angry:{eyes:'half',brows:'angry'},sad:{eyes:'half',brows:'sad'},surprised:{mouth:'open',brows:'surprised'},sleepy:{eyes:'half'}};
        return this.eachNode((i,node)=>{
            const modes=node.rot_sprite?.definition ? node.rot_sprite.definition.emotions : a;
            if (!Object.hasOwn(modes,name)) throw new RangeError('rotEmotion: неизвестная эмоция');
            $(node).rotExpression(modes[name]);
        });
    });
    // Select rendered atlas parts without removing bones or attachment sockets.
    def('rotVisibleParts', function (parts = null) { return this.eachNode((i,node) => {
        const r=node.rot_sprite;
        if (!r?.definition) throw new TypeError('rotVisibleParts: JSON model required');
        if (parts!==null && (!Array.isArray(parts) || parts.some(id=>!Number.isInteger(id) || !r.definition.rig.parts.some(p=>p.id===id))))
            throw new TypeError('rotVisibleParts: array of model part IDs or null');
        r.visibleParts=parts===null ? null : [...new Set(parts)];applyModel($,node);
    }); });
    def('rotRig', function (options = {}) { return this.eachNode((i,node) => {
        if (!node.rot_sprite) throw new TypeError('rotRig: сначала загрузите PNG');
        const r={body:false,phase:0,stride:0,armLeft:0,armRight:0,headYaw:0,...node.rot_sprite.rig,...options};
        for (const key of new Set(['phase','stride','armLeft','armRight','headYaw',...Object.keys(node.rot_sprite.definition?.rig.controls ?? {})])) {
            r[key] ??= 0;
            if (typeof r[key]!=='number' || !Number.isFinite(r[key])) throw new RangeError('rotRig: конечные числа');
        }
        r.phase%=Math.PI*2;r.stride=Math.max(-75,Math.min(75,r.stride));
        r.armLeft=normalizeRotPose(r.armLeft).yaw;r.armRight=normalizeRotPose(r.armRight).yaw;r.headYaw=normalizeRotPose(r.headYaw).yaw;
        node.rot_sprite.rig=r;
        if (node.rot_sprite.definition) applyModel($,node);
        else node.rot_sprite.sprite=engine.rotSpriteRig(node.rot_sprite.handle,!!r.body,r.phase,r.stride,r.armLeft,r.armRight,r.headYaw);
    }); });
    const masks={head:6|(1<<5),hair:8,tail:1<<4,hat:1<<5,torso:64,arms:(1<<7)|(1<<11),legs:(1<<8)|(1<<12),skirt:1<<9,shoes:(1<<13)|(1<<14),costume:(1<<5)|(1<<6)|(1<<7)|(1<<8)|(1<<9)|(1<<11)|(1<<12)|(1<<13)|(1<<14)};
    def('rotMotion', function (mode='idle',speed=1) { return this.eachNode((i,node) => {
        if (!node.rot_sprite) throw new TypeError('rotMotion: сначала загрузите Re2DSprite');
        if (node.rot_sprite.definition ? !Object.hasOwn(node.rot_sprite.animations.clips,mode) : !['idle','walk','run'].includes(mode)) throw new TypeError('rotMotion: неизвестный клип');
        if (typeof speed!=='number' || !Number.isFinite(speed) || speed<0) throw new RangeError('rotMotion: неотрицательная скорость');
        if (node.rot_sprite.definition) {
            node.rot_sprite.motion={mode,speed,time:0};node.rot_sprite.rig.body=true;applyModel($,node);return;
        }
        $(node).rotRig({body:true,stride:mode==='run' ? 38 : mode==='walk' ? 22 : 0});
        node.rot_sprite.motion={mode,speed};
    }); });
    def('rotPart', function (part,path) { return this.eachNode((i,node) => {
        const groups=node.rot_sprite?.definition?.groups ?? masks;
        if (!node.rot_sprite || !Object.hasOwn(groups,part) || typeof path!=='string') throw new TypeError('rotPart: часть и PNG v2');
        node.rot_sprite.sprite=engine.rotSpritePart(node.rot_sprite.handle,path,groups[part]);
        delete node.rot_sprite.parts[part];
        node.rot_sprite.parts[part]=path;
        node.rot_sprite.stamps[part]=engine.rotSpriteFileStamp(path);
    }); });
    def('rotReload', function () { return this.eachNode((i,node) => {
        if (!node.rot_sprite) throw new TypeError('rotReload: сначала загрузите PNG');
        const old=node.rot_sprite, pose=engine.rotSpriteInfo(old.handle);
        // Load and apply all overrides before replacing the visible resource.
        const temp=old.definition ? $.rotSprite.from(old.source) : $.rotSprite.create(old.path);
        try {
            if (old.style!==temp.get(0).rot_sprite.style) {
                const r=temp.get(0).rot_sprite;r.sprite=engine.rotSpriteStyle(r.handle,old.style);r.width=engine.rotSpriteInfo(r.handle).width;r.style=old.style;
            }
            for (const [part,path] of Object.entries(old.parts)) temp.rotPart(part,path);
            if (old.definition) {
                const r=temp.get(0).rot_sprite;
                if (Object.keys(r.animations.clips).length && !Object.hasOwn(r.animations.clips,old.motion.mode)) throw new TypeError('rotReload: активный клип удалён');
                if (old.visibleParts?.some(id=>!r.definition.rig.parts.some(p=>p.id===id))) throw new TypeError('rotReload: visible part removed');
                r.worldComposed=old.worldComposed;r.visibleParts=old.visibleParts===undefined || old.visibleParts===null ? null : [...old.visibleParts];r.motion={...old.motion};r.boneOverrides=cloneData(old.boneOverrides);r.layers=cloneData(old.layers);r.faceBase={...old.faceBase};
                for (const key of Object.keys(r.layers)) if (!Object.hasOwn(r.animations.clips,key)) throw new TypeError('rotReload: активный слой удалён');
            }
            if (pose.version===2) temp.rotRig(old.rig);
            temp.rotPose(pose.yaw,pose.pitch);
            if (old.definition) {
                const r=temp.get(0).rot_sprite;
                for (const child of old.children) if (child.rot_sprite?.attachment && !r.definition.rig.sockets.some(s=>s.name===child.rot_sprite.attachment.socket)) throw new TypeError('rotReload: занятый сокет удалён');
                r.attachment=old.attachment;applyModel($,temp.get(0));
            }
            if (!old.definition) temp.rotExpression({eyes:['open','half','closed','happy'][pose.eyes],mouth:['closed','open','smile','talk'][pose.mouth],brows:['neutral','angry','sad','surprised'][pose.brows || 0]});
            release(node,false); node.rot_sprite=temp.get(0).rot_sprite; temp.get(0).rot_sprite=null;
            if (old.definition) {node.rot_sprite.children=old.children;if(node.rot_sprite.worldComposed)registerRotWorldNode(node);for (const child of old.children) if (child.rot_sprite) applyModel($,child);}
            node.rot_sprite.motion={...old.motion};node.rot_sprite.hotReload=old.hotReload;node.rot_sprite.reloads=old.reloads+1;
        } finally { temp.remove(); }
    }); });
    def('rotHotReload', function (enabled=true) { return this.eachNode((i,node) => {
        if (!node.rot_sprite) throw new TypeError('rotHotReload: сначала загрузите PNG');
        node.rot_sprite.hotReload=!!enabled;
    }); });
    def('rotAttach',function(parentTarget,socket,options={}) {
        const parent=$(parentTarget).get(0);if (!parent?.rot_sprite?.definition) throw new TypeError('rotAttach: родитель с описанием JSON');
        if (this.length!==1) throw new TypeError('rotAttach: один объект');
        return this.eachNode((i,node)=>{
            const r=node.rot_sprite;if (!r?.definition || node.parent_node) throw new TypeError('rotAttach: объект JSON на корне сцены');
            if (parent.parent_node) throw new TypeError('rotAttach: родитель на корне сцены');
            for (let n=parent;n;n=n.rot_sprite?.attachment?.parent) if (n===node) throw new TypeError('rotAttach: цикл креплений');
            socketMatrix(parent.rot_sprite,socket);
            if (options.grip) inverse(socketMatrix(r,options.grip));
            const a={parent,socket,grip:options.grip ?? null,offset:vector(options.offset,[0,0,0],'attachment.offset'),rotation:vector(options.rotation,[0,0,0],'attachment.rotation'),scale:vector(options.scale,[1,1,1],'attachment.scale')};
            if (a.scale.some(v=>v<=0)) throw new RangeError('rotAttach: положительный scale');
            const previous=r.attachment;if (previous) previous.parent.rot_sprite?.children.delete(node);
            r.attachment=a;parent.rot_sprite.children.add(node);
            if(parent.rot_sprite.worldComposed)registerRotWorldNode(parent);
            if(previous?.parent.rot_sprite?.worldComposed)registerRotWorldNode(previous.parent);
            try {applyModel($,node);}catch(error) {parent.rot_sprite.children.delete(node);r.attachment=previous;if(previous) previous.parent.rot_sprite.children.add(node);if(parent.rot_sprite.worldComposed)registerRotWorldNode(parent);if(previous?.parent.rot_sprite?.worldComposed)registerRotWorldNode(previous.parent);throw error;}
        });
    });
    def('rotDetach',function() {return this.eachNode((i,node)=>{
        const r=node.rot_sprite;if (!r?.attachment) return;
        const parent=r.attachment.parent;parent.rot_sprite?.children.delete(node);r.attachment=null;if(parent.rot_sprite?.worldComposed)registerRotWorldNode(parent);applyModel($,node);
    });});
    def('rotVariant',function(group,key) {return this.eachNode((i,node)=>{
        const r=node.rot_sprite,path=r?.definition?.variants?.[group]?.[key];
        if (typeof path!=='string') throw new TypeError('rotVariant: группа и вариант из JSON');
        $(node).rotPart(group,relativeAsset(typeof r.source==='string'?r.source:null,path));
    });});
    def('rotLayer',function(key,enabled=true,speed=1) {return this.eachNode((i,node)=>{
        const r=node.rot_sprite;
        if (!r?.definition || !Object.hasOwn(r.animations.clips,key)) throw new TypeError('rotLayer: клип из JSON');finite(speed,'layer speed');if (speed<0) throw new RangeError('rotLayer: speed>=0');
        if (enabled) r.layers[key]={time:r.layers[key]?.time ?? 0,speed};else delete r.layers[key];applyModel($,node);
    });});
    def('rotBone',function (bone,options={}) {return this.eachNode((i,node)=>{
        const r=node.rot_sprite;if (!r?.definition || !r.definition.rig.bones.some(b=>b.name===bone)) throw new TypeError('rotBone: имя сустава из JSON');
        const values={...r.boneOverrides[bone]};
        for (const key of ['rotation','translation']) if (options[key]!=null) vector(options[key],null,key).forEach((v,j)=>{values[key+'.'+['x','y','z'][j]]=v;});
        r.boneOverrides[bone]=values;applyModel($,node);
    });});
    def('rotSeek',function (time=0) {return this.eachNode((i,node)=>{
        const r=node.rot_sprite;if (!r?.definition) throw new TypeError('rotSeek: описание JSON');finite(time,'time');if (time<0) throw new RangeError('rotSeek: time>=0');
        r.motion.time=time;applyModel($,node);
    });});
    $.rotSprite = {
        from(source,opts={}) {
            const loaded=readDefinition($,source),node=$.rotSprite.create(loaded.atlas,opts);
            try {
                const r=node.get(0).rot_sprite,d=loaded.definition;
                if (engine.rotSpriteInfo(r.handle).version!==2) throw new TypeError('Re2DSprite JSON: нужен PNG v2');
                Object.assign(r,loaded,{boneOverrides:{},layers:{},children:new Set(),attachment:null,definitionStamps:{}});
                for (const f of loaded.files) r.definitionStamps[f]=engine.rotSpriteFileStamp(f);
                if (r.style!==d.style) {r.sprite=engine.rotSpriteStyle(r.handle,d.style);r.style=d.style;r.width=engine.rotSpriteInfo(r.handle).width;}
                r.motion={mode:d.defaults.motion ?? Object.keys(loaded.animations.clips)[0] ?? 'idle',speed:1,time:0};
                if (Object.keys(loaded.animations.clips).length && !Object.hasOwn(loaded.animations.clips,r.motion.mode)) throw new TypeError('Re2DSprite JSON: неизвестный defaults.motion');
                node.rotRig({body:d.defaults.body ?? true,...d.defaults.rig});node.rotExpression(d.defaults.expression ?? {});
                return node;
            } catch(error) {node.remove();throw error;}
        },
        equip(parentTarget,key,opts={}) {
            const parent=$(parentTarget),d=$.rotSprite.definition(parent),spec=d?.equipment?.[key];
            if (!spec || typeof spec.model!=='string' || typeof spec.socket!=='string') throw new TypeError('rotSprite.equip: предмет из equipment JSON');
            const r=parent.get(0).rot_sprite;
            const item=$.rotSprite.from(relativeAsset(typeof r.source==='string'?r.source:null,spec.model),opts);
            try {item.rotAttach(parent,spec.socket,{grip:spec.grip,rotation:spec.rotation,offset:spec.offset,scale:spec.scale});return item;}
            catch(error) {item.remove();throw error;}
        },
        definition(target) {const r=$(target).get(0)?.rot_sprite;return r?.definition ? cloneData(r.definition) : null;},
        create(path, opts = {}) {
            const node = $('<rotsprite>',opts);
            try { return node.rotSpriteAtlas(path); }
            catch (error) { node.remove(); throw error; }
        },
        pose(target, yaw, pitch = 0) { return $(target).rotPose(yaw,pitch); },
        info(target) {
            const node = $(target).get(0);
            const r=node?.rot_sprite,pose=r ? engine.rotSpriteInfo(r.handle) : null;
            return r ? { ...pose,...(r.definition ? {joints:modelJoints(r,pose),definition:typeof r.source==='string'?r.source:null,animationTime:r.motion.time,layers:cloneData(r.layers),attachment:r.attachment?{socket:r.attachment.socket,grip:r.attachment.grip,parent:r.attachment.parent.id}:null,sockets:Object.fromEntries(r.definition.rig.sockets.map(s=>[s.name,{matrix:socketMatrix(r,s.name)}]))}:{}),
                path: node.rot_sprite.path, rig:{...node.rot_sprite.rig}, motion:{...node.rot_sprite.motion}, parts:{...node.rot_sprite.parts}, hotReload:node.rot_sprite.hotReload, reloads:node.rot_sprite.reloads, reloadError:node.rot_sprite.reloadError || null, milestone: node.rot_sprite.rig.body ? 'body-prototype' : 'head' } : null;
        },
        dispose(target) { $(target).eachNode((i,node) => release(node)); },
    };
    // Public name; legacy namespace and node methods remain compatible.
    $.re2dSprite=$.rotSprite;
    for (const old of ['rotSpriteAtlas','rotStyle','rotPose','rotExpression','rotEmotion','rotRig','rotMotion','rotPart','rotReload','rotHotReload','rotAttach','rotDetach','rotVariant','rotLayer','rotBone','rotSeek','rotVisibleParts']) {
        const current=old.replace(/^rot/,'re2d');
        def(current,function(...args) {return this[old](...args);});
    }
    registerNodeRenderer('rotsprite', (node,t,cam) => {
        if (!node.rot_sprite) return;
        let frame=node.rot_sprite;while (frame.attachment) frame=frame.attachment.parent.rot_sprite;
        const p = frame.style==='anime' ? t : rotPixelRect(t,frame.width);
        if (p.x + p.w/2 < 0 || p.y + p.h/2 < 0 ||
            p.x - p.w/2 > cam.w || p.y - p.h/2 > cam.h) return;
        if(node.rot_sprite.worldComposed) {
            const r=node.rot_sprite,pose=engine.rotSpriteInfo(r.handle);
            r.sprite=engine.rotSpritePose(r.handle,pose.yaw,pose.pitch);
        }
        $.gfx.push.sprite(node.rot_sprite.sprite,p.x,p.y,p.w,p.h,0,
            withAlpha(node.color,node.alpha),node.blend_mode);
    });
}

// Poll files at a bounded frequency; VFS-packed assets remain immutable.
export function tickRotSprite(dt, motionDt=dt) {
    if (!rotApi) return;
    const changedRoots=new Set();
    rotApi('rotsprite').eachNode((i,node) => {
        const r=node.rot_sprite;
        if (!r) return;
        if (r.definition) {
            const clip=r.animations.clips[r.motion.mode];
            let changed=false;
            if (clip && r.motion.speed && (clip.loop || r.motion.time<clip.duration)) {
                r.motion.time=(r.motion.time || 0)+motionDt*r.motion.speed;
                r.rig.phase=(r.motion.time/clip.duration*Math.PI*2)%(Math.PI*2);changed=true;
            }
            for (const [key,layer] of Object.entries(r.layers)) {
                const c=r.animations.clips[key];if (layer.speed && (c.loop || layer.time<c.duration)) {layer.time+=motionDt*layer.speed;changed=true;}
            }
            if (changed) {let root=node;while (root.rot_sprite?.attachment) root=root.rot_sprite.attachment.parent;changedRoots.add(root);}return;
        }
        if (r.motion.mode==='idle' || !r.motion.speed) return;
        const rate=r.motion.mode==='run' ? 10 : 5;
        rotApi(node).rotRig({phase:((r.rig.phase || 0)+motionDt*rate*r.motion.speed)%(Math.PI*2)});
    });
    for (const root of changedRoots) if (root.rot_sprite) applyModel(rotApi,root);
    pollTime+=dt;
    if (pollTime<.5) return;
    pollTime=0;
    rotApi('rotsprite').eachNode((i,node) => {
        const r=node.rot_sprite;
        if (!r || !r.hotReload) return;
        const changed=engine.rotSpriteChanged(r.handle) || (r.files ?? []).some(f=>engine.rotSpriteFileStamp(f)!==r.definitionStamps[f]) || Object.entries(r.parts).some(([part,path]) => engine.rotSpriteFileStamp(path)!==r.stamps[part]);
        if (!changed) return;
        try { rotApi(node).rotReload(); }
        catch (error) { r.reloadError=String(error); }
    });
}
