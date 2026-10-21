import * as K from '../lib/shared/kinds/tilemap.js';
import { createWorkspace,button } from '../lib/asset_workspace.js';
import { esc, FILTERS } from '../lib/studio_kit.js';
export const meta={id:'tilemap',title:'Tilemap',icon:'grid_on',match:p=>/\.tilemap\.json$/i.test(p)};
export function create(host) {
    const layer=w=>w.data.layers[w.selected];
    const geometry=w=>{const r=w.rect(),l=layer(w),t=w.data.tile*w.ext.zoom;return r&&l?{r,t,w:l.data[0]?.length||0,h:l.data.length,cx:r.x+r.w/2+w.ext.panX,cy:r.y+r.h/2+w.ext.panY}:null;};
    function fit(w){const r=w.rect(),l=layer(w);if(!r||!l)return;w.ext.zoom=Math.max(.05,Math.min(8,(r.w-40)/(l.data[0].length*w.data.tile),(r.h-40)/(l.data.length*w.data.tile)));w.ext.panX=w.ext.panY=0;}
    function paint(w,x,y,id){return w.edit('Кисть',()=>K.setTile(layer(w),x,y,id));}
    const def={kind:K,title:'Tilemap',listTitle:'Слои карты',
        init(w){Object.assign(w.ext,{zoom:1,panX:0,panY:0,brush:1,tool:'brush',grid:true,page:0,stroke:null,wasDown:false,needFit:true});},
        items:w=>(w.data.layers||[]).map(l=>({label:l.name||'Слой',detail:l.data?.length+' строк'})),target:layer,
        fields:()=>[{key:'name',label:'Имя'},{key:'depth',label:'Глубина',number:true,default:0},{key:'solid',label:'Коллизия',json:true,optional:true}],
        settings:[{key:'src',label:'Тайлсет',file:{filters:FILTERS.image}},{key:'tile',label:'Размер, px',number:true},{key:'cols',label:'Колонки',number:true},{key:'solid',label:'Solid IDs',json:true}],
        tools:w=>['brush','erase','fill','rect','pick'].map((id,i)=>button('tool:'+id,['Кисть','Ластик','Заливка','Прямоугольник','Пипетка'][i],w.ext.tool===id)).join('')+button('fit','Вписать')+button('grid','Сетка',w.ext.grid)+button('solid','Коллизия',w.ext.solid),
        actions:()=>button('layer:add','+ Слой')+button('layer:up','Выше')+button('layer:down','Ниже')+button('layer:remove','Удалить'),
        library(w){
            let size;try{size=w.$.gfx.textureSize(w.path(w.data.src));}catch(_){return '';}
            if(!size||!size[0])return '<span class="st-note">Укажите PNG тайлсета справа.</span>';
            const cap=K.tilesetCapacity(w.data,size[0],size[1]),first=w.ext.page*64+1,last=Math.min(cap,first+63),tile=w.data.tile,cols=w.data.cols;
            let html='<span class="st-h">Палитра · '+w.ext.brush+'</span>'+button('page:prev','‹')+button('page:next','›')+'<div class="aw-palette">';
            for(let id=first;id<=last;id++){const x=(id-1)%cols*tile,y=Math.floor((id-1)/cols)*tile;html+='<button class="aw-tile'+(id===w.ext.brush?' on':'')+'" data-key="tile:'+id+'"><img src="'+esc(w.path(w.data.src))+'" rect="'+x+' '+y+' '+tile+' '+tile+'"/></button>';}
            const names=Object.keys(w.data.terrains||{}), terrains=w.data.terrains||{};
            if(w.ext.terrain===undefined)w.ext.terrain=names[0]||'';
            html+='</div><span class="st-h">Autotile · runtime</span>'+button('autotile:off','Выкл.',!w.data.autotile)+button('autotile:bit16','Bit16',w.data.autotile?.mode==='bit16')+button('autotile:blob47','Blob47',w.data.autotile?.mode==='blob47');
            if(w.data.autotile){const at=w.data.autotile,solids=at.solid===undefined?(w.data.solid===undefined?[1]:w.data.solid):at.solid;html+='<div class="st-field-group"><span class="st-h">Параметры autotile</span><div class="st-field"><label>Базовый tile id</label><input id="tm-autotile-base" class="st-in" value="'+(at.base===undefined?'':at.base)+'"/></div><div class="st-field"><label>Свои тайлы · JSON</label><textarea id="tm-autotile-solid" class="st-area">'+esc(JSON.stringify(solids,null,2))+'</textarea></div><div class="st-field"><label>Граница</label><select id="tm-autotile-border" class="st-in"><option value="false"'+(at.border?'':' selected')+'>false</option><option value="true"'+(at.border?' selected':'')+'>true</option></select></div>'+button('autotile:apply','Применить autotile')+'</div>';}
            html+='<span class="st-h">Террейны</span>'+names.map(n=>button('terrain:select:'+n,n,w.ext.terrain===n)).join('');
            html+='<div class="st-field"><label>Новый набор</label><input id="tm-terrain-new-name" class="st-in" value="terrain"/><button class="st-btn" data-key="terrain:add">Создать</button></div>';
            const name=w.ext.terrain,spec=terrains[name];
            if(spec)html+='<div class="st-field-group"><span class="st-h">'+esc(name)+'</span><div class="st-field"><label>Имя</label><input id="tm-terrain-name" class="st-in" value="'+esc(name)+'"/></div><div class="st-field"><label>Режим</label><select id="tm-terrain-mode" class="st-in"><option value="bit16"'+(spec.mode==='bit16'?' selected':'')+'>bit16</option><option value="blob47"'+(spec.mode!=='bit16'?' selected':'')+'>blob47</option></select></div><div class="st-field"><label>Базовый tile id</label><input id="tm-terrain-base" class="st-in" value="'+(spec.base===undefined?1:spec.base)+'"/></div><div class="st-field"><label>Свои тайлы (JSON)</label><textarea id="tm-terrain-solid" class="st-area">'+esc(JSON.stringify(spec.solid===undefined?w.data.solid:spec.solid,null,2))+'</textarea></div><div class="st-field"><label>Переходы mask:id (JSON)</label><textarea id="tm-terrain-transitions" class="st-area">'+esc(JSON.stringify(spec.transitions||spec.tiles||{},null,2))+'</textarea></div><div class="st-field"><label>Граница</label><select id="tm-terrain-border" class="st-in"><option value="false"'+(spec.border?'':' selected')+'>false</option><option value="true"'+(spec.border?' selected':'')+'>true</option></select></div>'+button('terrain:apply','Применить')+button('terrain:delete','Удалить')+button('terrain:'+name,'Красить террейном',w.data.autotile?.mode==='terrain'&&w.data.autotile?.terrain===name)+'</div>';
            const animations=Array.isArray(w.data.animations)?w.data.animations:[];
            if(w.ext.animation===undefined)w.ext.animation=animations.length?0:-1;
            html+='<span class="st-h">Анимации</span>'+animations.map((a,i)=>button('anim:select:'+i,'tile '+(a&&a.tile||'?')+' · '+(a&&Array.isArray(a.frames)?a.frames.length:0)+' кадров',w.ext.animation===i)).join('')+button('anim:add','+ Анимация');
            const ai=w.ext.animation,an=animations[ai];
            if(an&&Array.isArray(an.frames))html+='<div class="st-field-group"><span class="st-h">Анимация '+(ai+1)+'</span><div class="st-field"><label>Исходный tile</label><input id="tm-anim-tile" class="st-in" value="'+(an.tile||'')+'"/></div><div class="st-field"><label>Кадры · id через запятую</label><input id="tm-anim-frames" class="st-in" value="'+esc(an.frames.join(', '))+'"/></div><div class="st-field"><label>FPS</label><input id="tm-anim-fps" class="st-in" value="'+(an.fps===undefined?'':an.fps)+'"/></div><div class="st-field"><label>Интервал, мс</label><input id="tm-anim-interval" class="st-in" value="'+(an.interval===undefined?'':an.interval)+'"/></div><div class="st-field"><label>Случайное смещение</label><select id="tm-anim-random" class="st-in"><option value="false"'+(an.random?'':' selected')+'>false</option><option value="true"'+(an.random?' selected':'')+'>true</option></select></div><div class="st-field"><label>Offset</label><input id="tm-anim-offset" class="st-in" value="'+(an.offset===undefined?'':an.offset)+'"/></div><div class="st-field"><label>Слой</label><input id="tm-anim-layer" class="st-in" value="'+(an.layer===undefined?'':an.layer)+'"/></div>'+button('anim:apply','Применить')+button('anim:delete','Удалить')+'</div>';
            return html;
        },
        bottom:w=>'<div class="st-bar"><span class="st-label">Размер слоя</span><input id="tm-w" class="st-in" value="'+(layer(w)?.data[0]?.length||1)+'"/><input id="tm-h" class="st-in" value="'+(layer(w)?.data.length||1)+'"/>'+button('resize','Изменить')+'<span class="st-label">Мазок — одна отмена · СКМ панорама · колесо масштаб</span></div>',
        action(w,key){
            if(key.startsWith('tool:')){w.ext.tool=key.slice(5);w.render();}
            else if(key.startsWith('tile:')){w.ext.brush=Number(key.slice(5));w.render();}
            else if(key==='fit'){fit(w);w.ext.userView=false;}
            else if(key==='grid'){w.ext.grid=!w.ext.grid;w.render();}
            else if(key==='solid'){w.ext.solid=!w.ext.solid;w.render();}
            else if(key==='autotile:apply'){const current=w.data.autotile;if(!current)throw new Error('Сначала выберите режим autotile');const next=JSON.parse(JSON.stringify(current)),raw=String(w.doc.value('tm-autotile-base')||'').trim(),solid=JSON.parse(String(w.doc.value('tm-autotile-solid')||''));if(raw==='')delete next.base;else{next.base=Number(raw);if(!Number.isInteger(next.base)||next.base<1||next.base>K.MAX_ID)throw new Error('base — целое 1..'+K.MAX_ID);}if(!(typeof solid==='boolean'||Array.isArray(solid)&&solid.every(id=>Number.isInteger(id)&&id>=1&&id<=K.MAX_ID)))throw new Error('solid — true/false или массив tile id 1..'+K.MAX_ID);next.solid=solid;next.border=String(w.doc.value('tm-autotile-border'))==='true';if(next.mode==='terrain'&&(!next.terrain||!w.data.terrains[next.terrain]))throw new Error('Autotile terrain указывает на отсутствующий набор');w.edit('Настроить autotile',m=>{m.autotile=next;});}
            else if(key.startsWith('autotile:')){const mode=key.slice(9);w.edit('Autotile',m=>{if(mode==='off')delete m.autotile;else m.autotile={mode};});}
            else if(key.startsWith('terrain:select:')){w.ext.terrain=key.slice(15);w.render();}
            else if(key==='terrain:add'){const name=String(w.doc.value('tm-terrain-new-name')||'').trim();if(!name||w.data.terrains&&w.data.terrains[name])throw new Error('Укажите новое уникальное имя террейна');w.edit('Создать террейн',m=>{m.terrains=m.terrains||{};m.terrains[name]={mode:'blob47',base:w.ext.brush||1,solid:m.solid===undefined?[1]:JSON.parse(JSON.stringify(m.solid)),border:false};});w.ext.terrain=name;w.render();}
            else if(key==='terrain:apply'){const old=w.ext.terrain,name=String(w.doc.value('tm-terrain-name')||'').trim(),base=Number(w.doc.value('tm-terrain-base')),solid=JSON.parse(String(w.doc.value('tm-terrain-solid')||'')),transitions=JSON.parse(String(w.doc.value('tm-terrain-transitions')||'')),mode=String(w.doc.value('tm-terrain-mode')),border=String(w.doc.value('tm-terrain-border'))==='true';if(!name||name!==old&&w.data.terrains[name])throw new Error('Имя террейна должно быть непустым и уникальным');const next=JSON.parse(JSON.stringify(w.data.terrains[old]||{}));Object.assign(next,{mode,base,border,solid,transitions});delete next.tiles;if(!K.terrainSpecOk(next))throw new Error('Неверный террейн: base 1..65535, solid — bool/id[], transitions — mask 0..255 → tile 1..65535');w.edit('Настроить террейн',m=>{m.terrains=m.terrains||{};if(name!==old){delete m.terrains[old];if(m.autotile&&m.autotile.terrain===old)m.autotile.terrain=name;}m.terrains[name]=next;});w.ext.terrain=name;w.render();}
            else if(key==='terrain:delete'){const name=w.ext.terrain;if(!name)return;w.edit('Удалить террейн',m=>{delete m.terrains[name];if(m.autotile&&m.autotile.terrain===name)delete m.autotile;});w.ext.terrain=Object.keys(w.data.terrains||{})[0]||'';w.render();}
            else if(key.startsWith('anim:select:')){w.ext.animation=Number(key.slice(12));w.render();}
            else if(key==='anim:add'){if((w.data.animations||[]).length>=K.MAX_ANIMS)throw new Error('Достигнут лимит анимаций '+K.MAX_ANIMS);const id=w.ext.brush||1;w.edit('Добавить анимацию',m=>{m.animations=m.animations||[];m.animations.push({tile:id,frames:[id],fps:6});});w.ext.animation=w.data.animations.length-1;w.render();}
            else if(key==='anim:apply'){const index=w.ext.animation,old=w.data.animations[index];if(!old)throw new Error('Анимация не выбрана');const num=id=>{const raw=String(w.doc.value(id)||'').trim();if(!raw)return undefined;const value=Number(raw);if(!Number.isFinite(value))throw new Error(id+': нужно число');return value;};const next=JSON.parse(JSON.stringify(old));next.tile=Number(w.doc.value('tm-anim-tile'));next.frames=String(w.doc.value('tm-anim-frames')||'').split(',').map(x=>Number(x.trim()));next.random=String(w.doc.value('tm-anim-random'))==='true';for(const k of ['fps','interval','offset','layer']){const value=num('tm-anim-'+k);if(value===undefined)delete next[k];else next[k]=value;}if(!K.animationSpecOk(next))throw new Error('Неверная анимация: tile/frames 1..65535, 1..16 кадров; fps > 0, interval 1..60000, layer 0..15');w.edit('Настроить анимацию',m=>{m.animations[index]=next;});}
            else if(key==='anim:delete'){const index=w.ext.animation;if(index<0)return;w.edit('Удалить анимацию',m=>m.animations.splice(index,1));w.ext.animation=Math.min(index,(w.data.animations||[]).length-1);w.render();}
            else if(key.startsWith('page:')){w.ext.page=Math.max(0,w.ext.page+(key==='page:next'?1:-1));w.render();}
            else if(key==='layer:add')w.edit('Добавить слой',m=>{K.addLayer(m,'layer'+m.layers.length);w.selected=m.layers.length-1;});
            else if(key==='layer:remove')w.edit('Удалить слой',m=>K.removeLayer(m,w.selected));
            else if(key==='layer:up'||key==='layer:down')w.edit('Порядок слоя',m=>{const to=Math.max(0,Math.min(m.layers.length-1,w.selected+(key==='layer:up'?-1:1)));K.moveLayer(m,w.selected,to);w.selected=to;});
            else if(key==='resize'){const x=Number(w.doc.value('tm-w')),y=Number(w.doc.value('tm-h'));if(!Number.isInteger(x)||!Number.isInteger(y)||x<1||y<1||x>K.MAX_SIDE||y>K.MAX_SIDE||x*y>K.MAX_AREA)throw new Error('Размер вне лимитов карты');w.edit('Размер слоя',()=>K.resize(layer(w),x,y));}
            else if(key.startsWith('terrain:')){const name=key.slice(8);if(!w.data.terrains[name])throw new Error('Террейн не найден: '+name);w.edit('Террейн',m=>{m.autotile={mode:'terrain',terrain:name};});w.ext.brush=w.data.terrains[name].base||1;}
        },
        preview(w){if(!w.data.src)return;const opts=JSON.parse(JSON.stringify(w.data));opts.src=w.path(opts.src);delete opts.autotile;
            w.ext.node=w.$('<tilemap>',opts).appendTo(w.$.world);if(w.data.autotile)w.ext.node.autotile(w.data.autotile);w.nodes.push(w.ext.node);
        },
        deactivate(w){commit(w);w.ext.rectangle=null;w.ext.wasDown=false;w.ext.last=null;},
        update(w){const $=w.$,p=w.point();if(!p)return;
            const m=$.input.mouse(),e=w.ext;
            // Вписываем, пока человек сам не двигал вид; раскладка документа приходит кадром позже.
            const rk=Math.round(p.r.w)+'x'+Math.round(p.r.h);if(rk!==e.rectKey){e.rectKey=rk;if(!e.userView)fit(w);}
            if(p.inside&&!w.host.typing()){
                const wheel=$.input.wheel().y;if(wheel){e.zoom=Math.max(.05,Math.min(16,e.zoom*(wheel>0?1.15:1/1.15)));e.userView=true;}
                if($.input.mouseDown('middle')&&e.last){e.panX+=m.x-e.last.x;e.panY+=m.y-e.last.y;e.userView=true;}
            }e.last=m;
            const g=geometry(w);if(!g)return;
            if(e.node)e.node.at(g.cx,g.cy).scale(e.zoom);
            const x=Math.floor((m.x-g.cx+g.w*g.t/2)/g.t),y=Math.floor((m.y-g.cy+g.h*g.t/2)/g.t),l=layer(w),valid=p.inside&&K.inBounds(l,x,y);
            const pressed=$.input.mousePressed('left'),down=$.input.mouseDown('left');
            if(valid&&!w.host.typing()&&!w.file.state.busy){
                if($.input.mousePressed('right')||(pressed&&e.tool==='pick')){e.brush=l.data[y][x];w.render();}
                else if(pressed&&e.tool==='fill')w.edit('Заливка',()=>K.floodFill(l,x,y,e.brush));
                else if(pressed&&e.tool==='rect')e.rectangle={x,y,toX:x,toY:y};
                else if(pressed){e.stroke=new Map();e.strokeLayer=w.selected;}
                if((down||pressed)&&e.stroke){const id=e.tool==='erase'?0:e.brush;e.stroke.set(x+','+y,id);if(e.node)e.node.setTile(x,y,id,w.selected);}
                if(down&&e.rectangle){e.rectangle.toX=x;e.rectangle.toY=y;}
            }
            // Короткий клик (нажатие и отпускание в одном кадре) тоже завершает мазок.
            if(!down&&(e.stroke||e.rectangle)){commit(w);if(e.rectangle){const r=e.rectangle;e.rectangle=null;w.edit('Прямоугольник',()=>K.fillRect(l,r.x,r.y,r.toX,r.toY,e.brush));}}
            e.wasDown=down;
            overlay(w,g,p.r,valid?{x,y}:null);
        },
        hud:w=>K.summary(w.data)+' · ×'+w.ext.zoom.toFixed(2)+' · тайл '+w.ext.brush,
        ops:w=>({cellPoint(x,y){const g=geometry(w);return g?{x:g.cx-g.w*g.t/2+(x+.5)*g.t,y:g.cy-g.h*g.t/2+(y+.5)*g.t}:null;},tile:(x,y,l)=>w.data.layers[l===undefined?w.selected:l].data[y][x],paint:(x,y,id)=>paint(w,x,y,id),fill:(x,y,id)=>w.edit('Заливка',()=>K.floodFill(layer(w),x,y,id)),resize:(x,y)=>w.edit('Размер',()=>K.resize(layer(w),x,y)),setTerrain:(name,spec)=>w.edit('Террейн',m=>{m.terrains=m.terrains||{};m.terrains[name]=spec;}),setAnimation:spec=>w.edit('Анимация',m=>{m.animations=m.animations||[];m.animations.push(spec);})}),
        snapshot:w=>({layers:w.data.layers.length,brush:w.ext.brush,tool:w.ext.tool}),
    };
    // Оверлей поверх карты: коллизия, сетка, прямоугольник, клетка под курсором (только внутри холста).
    function overlay(w,g,clip,hover) {
        const $=w.$,e=w.ext,t=g.t,left=g.cx-g.w*t/2,top=g.cy-g.h*t/2;
        const x0=Math.max(left,clip.x),y0=Math.max(top,clip.y),x1=Math.min(left+g.w*t,clip.x+clip.w),y1=Math.min(top+g.h*t,clip.y+clip.h);
        if(x1<=x0||y1<=y0)return;
        const cell=(cx,cy,cw,ch,c)=>{const a=Math.max(x0,left+cx*t),b=Math.max(y0,top+cy*t),r=Math.min(x1,left+(cx+cw)*t),d=Math.min(y1,top+(cy+ch)*t);if(r>a&&d>b)$.gfx.draw.rect(a,b,r-a,d-b,c);};
        // Коллизию считает сама карта (runtime solidAt), а не копия правил.
        if(e.solid&&e.node){for(let y=0;y<g.h;y++)for(let x=0;x<g.w;x++)if(e.node.solidAt(x,y,w.selected))cell(x,y,1,1,'rgba(255,90,60,0.35)');}
        if(e.grid&&t>=8){const c='rgba(255,255,255,0.14)';
            for(let i=0;i<=g.w;i++){const lx=left+i*t;if(lx>=x0&&lx<=x1)$.gfx.draw.line(lx,y0,lx,y1,c,1);}
            for(let i=0;i<=g.h;i++){const ly=top+i*t;if(ly>=y0&&ly<=y1)$.gfx.draw.line(x0,ly,x1,ly,c,1);}}
        if(e.rectangle){const r=e.rectangle;cell(Math.min(r.x,r.toX),Math.min(r.y,r.toY),Math.abs(r.toX-r.x)+1,Math.abs(r.toY-r.y)+1,'rgba(74,217,145,0.30)');}
        if(hover)cell(hover.x,hover.y,1,1,e.tool==='erase'?'rgba(255,90,60,0.30)':'rgba(255,255,255,0.20)');
    }
    function commit(w){const stroke=w.ext.stroke;if(!stroke)return;w.ext.stroke=null;const index=w.ext.strokeLayer;w.edit('Мазок',m=>{for(const [key,id] of stroke){const [x,y]=key.split(',').map(Number);K.setTile(m.layers[index],x,y,id);}});}
    return createWorkspace(host,def);
}
