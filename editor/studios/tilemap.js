import * as K from '../../sdk/lib/kinds/tilemap.js';
import { createWorkspace,button } from '../lib/asset_workspace.js';
import { esc } from '../lib/studio_kit.js';
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
        settings:[{key:'src',label:'Тайлсет'},{key:'tile',label:'Размер, px',number:true},{key:'cols',label:'Колонки',number:true},{key:'solid',label:'Solid IDs',json:true},{key:'terrains',label:'Террейны',json:true,optional:true},{key:'animations',label:'Анимации',json:true,optional:true},{key:'autotile',label:'Autotile',json:true,optional:true}],
        tools:w=>['brush','erase','fill','rect','pick'].map((id,i)=>button('tool:'+id,['Кисть','Ластик','Заливка','Прямоугольник','Пипетка'][i],w.ext.tool===id)).join('')+button('fit','Вписать')+button('grid','Сетка',w.ext.grid),
        actions:()=>button('layer:add','+ Слой')+button('layer:up','↑')+button('layer:down','↓')+button('layer:remove','Удалить'),
        library(w){
            let size;try{size=w.$.gfx.textureSize(w.path(w.data.src));}catch(_){return '';}
            if(!size||!size[0])return '<span class="st-note">Укажите PNG тайлсета справа.</span>';
            const cap=K.tilesetCapacity(w.data,size[0],size[1]),first=w.ext.page*64+1,last=Math.min(cap,first+63),tile=w.data.tile,cols=w.data.cols;
            let html='<span class="st-h">Палитра · '+w.ext.brush+'</span>'+button('page:prev','‹')+button('page:next','›')+'<div class="aw-palette">';
            for(let id=first;id<=last;id++){const x=(id-1)%cols*tile,y=Math.floor((id-1)/cols)*tile;html+='<button class="aw-tile'+(id===w.ext.brush?' on':'')+'" data-key="tile:'+id+'"><img src="'+esc(w.path(w.data.src))+'" rect="'+x+' '+y+' '+tile+' '+tile+'"/></button>';}
            return html+'</div><span class="st-h">Террейн</span>'+Object.keys(w.data.terrains||{}).map(n=>button('terrain:'+n,n,w.data.autotile?.terrain===n)).join('');
        },
        bottom:w=>'<div class="st-bar"><span class="st-label">Размер слоя</span><input id="tm-w" class="st-in" value="'+(layer(w)?.data[0]?.length||1)+'"/><input id="tm-h" class="st-in" value="'+(layer(w)?.data.length||1)+'"/>'+button('resize','Изменить')+'<span class="st-label">Мазок — одна отмена · СКМ панорама · колесо масштаб</span></div>',
        action(w,key){
            if(key.startsWith('tool:')){w.ext.tool=key.slice(5);w.render();}
            else if(key.startsWith('tile:')){w.ext.brush=Number(key.slice(5));w.render();}
            else if(key==='fit')fit(w);
            else if(key==='grid'){w.ext.grid=!w.ext.grid;w.render();}
            else if(key.startsWith('page:')){w.ext.page=Math.max(0,w.ext.page+(key==='page:next'?1:-1));w.render();}
            else if(key==='layer:add')w.edit('Добавить слой',m=>{K.addLayer(m,'layer'+m.layers.length);w.selected=m.layers.length-1;});
            else if(key==='layer:remove')w.edit('Удалить слой',m=>K.removeLayer(m,w.selected));
            else if(key==='layer:up'||key==='layer:down')w.edit('Порядок слоя',m=>{const to=Math.max(0,Math.min(m.layers.length-1,w.selected+(key==='layer:up'?-1:1)));K.moveLayer(m,w.selected,to);w.selected=to;});
            else if(key==='resize'){const x=Number(w.doc.value('tm-w')),y=Number(w.doc.value('tm-h'));if(!Number.isInteger(x)||!Number.isInteger(y)||x<1||y<1||x>K.MAX_SIDE||y>K.MAX_SIDE||x*y>K.MAX_AREA)throw new Error('Размер вне лимитов карты');w.edit('Размер слоя',()=>K.resize(layer(w),x,y));}
            else if(key.startsWith('terrain:')){const name=key.slice(8);w.edit('Террейн',m=>{m.autotile={mode:'terrain',terrain:name};});w.ext.brush=w.data.terrains[name].base||1;}
        },
        preview(w){if(!w.data.src)return;const opts=JSON.parse(JSON.stringify(w.data));opts.src=w.path(opts.src);delete opts.autotile;
            w.ext.node=w.$('<tilemap>',opts).appendTo(w.$.world);if(w.data.autotile)w.ext.node.autotile(w.data.autotile);w.nodes.push(w.ext.node);
        },
        deactivate(w){commit(w);w.ext.wasDown=false;w.ext.last=null;},
        update(w){const $=w.$,p=w.point();if(!p)return;if(w.ext.needFit){fit(w);w.ext.needFit=false;}
            const m=$.input.mouse(),e=w.ext;if(p.inside&&!w.host.typing()){
                const wheel=$.input.wheel().y;if(wheel)e.zoom=Math.max(.05,Math.min(16,e.zoom*(wheel>0?1.15:1/1.15)));
                if($.input.mouseDown('middle')&&e.last){e.panX+=m.x-e.last.x;e.panY+=m.y-e.last.y;}
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
            if(e.wasDown&&!down){commit(w);if(e.rectangle){const r=e.rectangle;e.rectangle=null;w.edit('Прямоугольник',()=>K.fillRect(l,r.x,r.y,r.toX,r.toY,e.brush));}}
            e.wasDown=down;
            if(e.grid&&g.t>=8){const c='#65708566',left=g.cx-g.w*g.t/2,top=g.cy-g.h*g.t/2;for(let i=0;i<=g.w;i++)if(left+i*g.t>=p.r.x&&left+i*g.t<=p.r.x+p.r.w)$.gfx.draw.line(left+i*g.t,Math.max(top,p.r.y),left+i*g.t,Math.min(top+g.h*g.t,p.r.y+p.r.h),c,1);for(let i=0;i<=g.h;i++)if(top+i*g.t>=p.r.y&&top+i*g.t<=p.r.y+p.r.h)$.gfx.draw.line(Math.max(left,p.r.x),top+i*g.t,Math.min(left+g.w*g.t,p.r.x+p.r.w),top+i*g.t,c,1);}
        },
        hud:w=>K.summary(w.data)+' · ×'+w.ext.zoom.toFixed(2)+' · тайл '+w.ext.brush,
        ops:w=>({paint:(x,y,id)=>paint(w,x,y,id),fill:(x,y,id)=>w.edit('Заливка',()=>K.floodFill(layer(w),x,y,id)),resize:(x,y)=>w.edit('Размер',()=>K.resize(layer(w),x,y)),setTerrain:(name,spec)=>w.edit('Террейн',m=>{m.terrains=m.terrains||{};m.terrains[name]=spec;}),setAnimation:spec=>w.edit('Анимация',m=>{m.animations=m.animations||[];m.animations.push(spec);})}),
        snapshot:w=>({layers:w.data.layers.length,brush:w.ext.brush,tool:w.ext.tool}),
    };
    function commit(w){const stroke=w.ext.stroke;if(!stroke)return;w.ext.stroke=null;const index=w.ext.strokeLayer;w.edit('Мазок',m=>{for(const [key,id] of stroke){const [x,y]=key.split(',').map(Number);K.setTile(m.layers[index],x,y,id);}});}
    return createWorkspace(host,def);
}
