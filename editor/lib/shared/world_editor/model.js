// ===========================================================================
// World Editor: authoring-модель .re2dmap (Hammer-like редактор).
//
// Здесь только данные и чистые помощники отображения/схем инспектора.
// Геометрия (выпуклость, clip, vertex, CSG, holes) НЕ проверяется и НЕ
// считается в JS: каждая правка уходит в нативный r2d-sdk world-edit, а
// канонический файл из --out остаётся источником истины. Проверка и
// компиляция — тоже native: world info / world compile.
//
// Модель намеренно не знает жанровых классов: список сущностей приходит из
// расширений (sdk/lib/extensions.js) плюс общие базовые классы.
// ===========================================================================

export const BRUSH_TOOLS = [
    'solid', 'nodraw', 'clip', 'enemyclip', 'playerclip', 'sky',
    'occluder', 'hint', 'skip', 'trigger', 'areaportal',
];

export const GRID_SIZES = [1, 2, 4, 8, 16, 32, 64, 128, 256];
export const ELEMENT_KINDS = { cell:'cells', wall:'walls', portal:'portals', stair:'stairs', slope:'slopes', light:'lights' };
export const ELEMENT_DEFAULTS = {
    cells:{rect:[0,0,128,128],spans:[{bottom:0,top:128,floorColor:'#687b91',ceilingColor:'#344858'}]},
    walls:{from:[0,0],to:[128,0],bottom:0,top:128,color:'#8b9ab2'},
    portals:{cellA:'',cellB:'',from:[0,0],to:[0,64],openings:[{bottom:0,top:96}]},
    stairs:{rect:[128,0,128,64],axis:'x',dir:1,steps:8,base:0,rise:16,top:256},
    slopes:{rect:[128,0,128,64],axis:'x',dir:1,segments:8,from:0,to:128,top:256},
    lights:{x:64,y:64,h:60,radius:180,intensity:1,color:'#ffd6a0',shadow:true},
};
export const SECTIONS = ['brushes', 'entities', 'paths', 'visgroups'];
export const KIND_SECTION = {
    ...ELEMENT_KINDS,
    brush: 'brushes',
    entity: 'entities',
    path: 'paths',
    visgroup: 'visgroups',
};

export const DEFAULT_COLORS = {
    floor: '#8f8b82',
    ceiling: '#586070',
    side: '#6f6250',
};

export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

/** Заменить содержимое объекта на месте: ссылки на модель остаются живыми (history/recovery). */
export function replaceContents(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source);
}

export function defaultWorld() {
    return {
        x: 0, y: 0, w: 1024, h: 1024,
        bottom: 0, top: 256,
        floorColor: DEFAULT_COLORS.floor,
        ceilingColor: DEFAULT_COLORS.ceiling,
        sideColor: DEFAULT_COLORS.side,
        boundary: 'sky',
    };
}

/** Новый/открытый .re2dmap без проверок: только структура и умолчания. */
export function createMap(source) {
    const map = clone(source || {});
    const cellWorld=Object.values(ELEMENT_KINDS).some(section=>Array.isArray(map[section]));
    if (!map.version) map.version = 1;
    if (!map.name) map.name = 'Новая карта';
    if (!cellWorld && (!Number.isFinite(Number(map.regionSize)) || Number(map.regionSize) <= 0)) map.regionSize = 256;
    if ((!map.world || typeof map.world !== 'object' || Array.isArray(map.world)) && !cellWorld) {
        map.world = defaultWorld();
    } else if(map.world) {
        map.world = Object.assign(defaultWorld(), map.world);
    }
    for (const section of SECTIONS) {
        if (!Array.isArray(map[section])) map[section] = [];
    }
    return map;
}

export function serialize(map) {
    return JSON.stringify(map, null, 2) + '\n';
}

export function sectionOf(kind) {
    return KIND_SECTION[kind] || null;
}

export function list(map, section) {
    return (map && Array.isArray(map[section])) ? map[section] : [];
}

export function find(map, section, id) {
    for (const value of list(map, section)) {
        if (value && String(value.id) === String(id)) return value;
    }
    return null;
}

export function indexOf(map, section, id) {
    const items = list(map, section);
    for (let i = 0; i < items.length; i++) {
        if (items[i] && String(items[i].id) === String(id)) return i;
    }
    return -1;
}

export function ids(map, section) {
    return list(map, section).map((v) => String(v && v.id));
}

/** Уникальный id в пределах секции (создание новых объектов/копий). */
export function nextId(map, section, prefix) {
    const used = new Set(ids(map, section));
    const base = prefix || (section === 'brushes' ? 'brush' : section === 'entities' ? 'entity' : section === 'paths' ? 'path' : 'visgroup');
    let n = 1;
    while (used.has(base + '.' + n)) n++;
    return base + '.' + n;
}

// --- Показ (только bbox/центр, не валидация геометрии) ----------------------

/** Прямоугольник footprint для отображения: rect или bbox вершин polygon. */
export function brushBox(brush) {
    if (!brush || typeof brush !== 'object') return null;
    if (Array.isArray(brush.rect) && brush.rect.length >= 4) {
        const x = Number(brush.rect[0]), y = Number(brush.rect[1]);
        const w = Number(brush.rect[2]), h = Number(brush.rect[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)) {
            return { x: x, y: y, w: w, h: h };
        }
    }
    if (Array.isArray(brush.polygon) && brush.polygon.length) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of brush.polygon) {
            if (!Array.isArray(p) || p.length < 2) continue;
            const x = Number(p[0]), y = Number(p[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        if (Number.isFinite(minX)) return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    return null;
}

export function brushZ(brush) {
    const bottom = Number(brush && brush.bottom);
    const top = Number(brush && brush.top);
    return {
        bottom: Number.isFinite(bottom) ? bottom : 0,
        top: Number.isFinite(top) ? top : 0,
    };
}

export function entityPos(entity) {
    const x = Number(entity && entity.x), y = Number(entity && entity.y), h = Number(entity && entity.h);
    return {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        h: Number.isFinite(h) ? h : 0,
    };
}

export function pathNodes(path) {
    return Array.isArray(path && path.nodes) ? path.nodes : [];
}

export function pathBox(path) {
    const nodes = pathNodes(path);
    if (!nodes.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
        const x = Number(node && node.x), y = Number(node && node.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Единый список объектов для дерева/выделения/отрисовки. */
export function displayItems(map) {
    const out = [];
    for (const brush of list(map, 'brushes')) {
        const box = brushBox(brush);
        const z = brushZ(brush);
        out.push({
            kind: 'brush', id: String(brush.id), label: String(brush.id),
            box: box, bottom: z.bottom, top: z.top, tool: brush.tool || 'solid', data: brush,
        });
    }
    for (const entity of list(map, 'entities')) {
        const p = entityPos(entity);
        out.push({
            kind: 'entity', id: String(entity.id), label: String(entity.id),
            box: { x: p.x - 8, y: p.y - 8, w: 16, h: 16 }, point: p,
            bottom: p.h, top: p.h, kindName: entity.kind || '', data: entity,
        });
    }
    for (const path of list(map, 'paths')) {
        out.push({
            kind: 'path', id: String(path.id), label: String(path.id),
            box: pathBox(path), nodes: pathNodes(path), bottom: 0, top: 0, data: path,
        });
    }
    for(const [kind,section] of Object.entries(ELEMENT_KINDS)) {
        for(const value of list(map,section)) {
            let box=brushBox(value);
            if(!box && Array.isArray(value.from) && Array.isArray(value.to))
                box={x:Math.min(value.from[0],value.to[0]),y:Math.min(value.from[1],value.to[1]),w:Math.abs(value.to[0]-value.from[0]),h:Math.abs(value.to[1]-value.from[1])};
            if(kind==='light')box={x:Number(value.x)-6,y:Number(value.y)-6,w:12,h:12};
            if(!box)continue;
            // Thin walls/portals remain selectable; only the display bbox expands.
            box={x:box.x-(box.w<2?1:0),y:box.y-(box.h<2?1:0),w:Math.max(2,box.w),h:Math.max(2,box.h)};
            const spans=kind==='cell' ? value.spans : kind==='portal' ? value.openings : null;
            const heights=Array.isArray(spans)&&spans.length ? spans : [{bottom:value.bottom??value.base??(kind==='slope'?Math.min(value.from,value.to):value.h)??0,top:value.top??value.h??0}];
            for(const span of heights)out.push({kind,id:String(value.id),label:String(value.id),box,
                bottom:Number(span.bottom)||0,top:Number(span.top)||0,data:value});
        }
    }
    return out;
}

/** Bbox всей карты: конверт мира плюс объекты (для focus/fit). */
export function mapBounds(map) {
    const items=displayItems(map);
    const world=map&&map.world;
    if(world)items.push({box:{x:Number(world.x)||0,y:Number(world.y)||0,w:Number(world.w)||0,h:Number(world.h)||0},bottom:Number(world.bottom)||0,top:Number(world.top)||0});
    if(!items.length){const w=defaultWorld();return {...w};}
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const item of items) {
        if(item.box) {
            minX=Math.min(minX,item.box.x);minY=Math.min(minY,item.box.y);
            maxX=Math.max(maxX,item.box.x+item.box.w);maxY=Math.max(maxY,item.box.y+item.box.h);
        }
        if(Number.isFinite(item.bottom))minZ=Math.min(minZ,item.bottom);
        if(Number.isFinite(item.top))maxZ=Math.max(maxZ,item.top);
    }
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY), bottom: minZ, top: maxZ };
}

export function centerOf(box) {
    if (!box) return { x: 0, y: 0, z: 0 };
    return { x: box.x + box.w / 2, y: box.y + box.h / 2, z: (box.bottom || 0) + ((box.top || 0) - (box.bottom || 0)) / 2 };
}

// --- Значения полей инспектора ---------------------------------------------

export function tagsToText(tags) {
    return Array.isArray(tags) ? tags.join(', ') : '';
}

export function tagsFromText(text) {
    return String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function numberText(value) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : '';
}

export function boolText(value) {
    return value ? 'true' : 'false';
}

export function pointText(point) {
    return Array.isArray(point) ? point.map(numberText).join(', ') : '';
}

export function rectText(rect) {
    return Array.isArray(rect) ? rect.map(numberText).join(', ') : '';
}

export function parseNumber(text, fallback) {
    const n = Number(String(text).trim());
    return Number.isFinite(n) ? n : fallback;
}

export function parseRect(text) {
    const parts = String(text || '').split(',').map((s) => Number(s.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    return parts;
}

export function parsePolygon(text) {
    try {
        const value = JSON.parse(String(text || '[]'));
        if (!Array.isArray(value)) return null;
        for (const point of value) {
            if (!Array.isArray(point) || point.length < 2) return null;
            if (!Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))) return null;
        }
        return value;
    } catch (e) {
        return null;
    }
}

/**
 * Схема инспектора: человек и агент видят одни и те же поля; значения берутся
 * из выбранного объекта. Никаких правил геометрии здесь нет.
 */
export function inspectorSchema(kind, map, selection) {
    if(ELEMENT_KINDS[kind]) {
        const id=selection&&selection.ids&&selection.ids[0];
        const value=find(map,ELEMENT_KINDS[kind],id)||{};
        return Object.keys(value).map(key=>({key,label:key,type:typeof value[key]==='object'?'json':'text',
            value:typeof value[key]==='object'?JSON.stringify(value[key],null,2):String(value[key])}));
    }
    const firstId = selection && selection.ids && selection.ids.length ? selection.ids[0] : null;
    if (kind === 'world') {
        const w = (map && map.world) || defaultWorld();
        return [
            { key: 'x', label: 'X', type: 'number', value: w.x },
            { key: 'y', label: 'Y', type: 'number', value: w.y },
            { key: 'w', label: 'Ширина', type: 'number', value: w.w },
            { key: 'h', label: 'Глубина', type: 'number', value: w.h },
            { key: 'bottom', label: 'Низ', type: 'number', value: w.bottom },
            { key: 'top', label: 'Верх', type: 'number', value: w.top },
            { key: 'boundary', label: 'Граница', type: 'text', value: w.boundary || '' },
            { key: 'floorColor', label: 'Пол', type: 'text', value: w.floorColor || '' },
            { key: 'ceilingColor', label: 'Потолок', type: 'text', value: w.ceilingColor || '' },
            { key: 'sideColor', label: 'Стены', type: 'text', value: w.sideColor || '' },
            { key: 'tags', label: 'Теги пола', type: 'tags', value: tagsToText(w.tags) },
        ];
    }
    if (kind === 'brush') {
        const brush = find(map, 'brushes', firstId) || {};
        return [
            { key: 'id', label: 'id', type: 'text', value: brush.id || '' },
            { key: 'tool', label: 'Инструмент', type: 'select', options: BRUSH_TOOLS, value: brush.tool || 'solid' },
            { key: 'rect', label: 'rect (x,y,w,h)', type: 'text', value: rectText(brush.rect) },
            { key: 'polygon', label: 'polygon JSON', type: 'text', value: brush.polygon ? JSON.stringify(brush.polygon) : '' },
            { key: 'bottom', label: 'Низ', type: 'number', value: brush.bottom },
            { key: 'top', label: 'Верх', type: 'number', value: brush.top },
            { key: 'sideColor', label: 'Цвет стен', type: 'text', value: brush.sideColor || '' },
            { key: 'floorColor', label: 'Цвет пола', type: 'text', value: brush.floorColor || '' },
            { key: 'ceilingColor', label: 'Цвет потолка', type: 'text', value: brush.ceilingColor || '' },
            { key: 'visgroup', label: 'VisGroup', type: 'text', value: brush.visgroup || '' },
            { key: 'tags', label: 'Теги пола', type: 'tags', value: tagsToText(brush.tags) },
            { key: 'ceilingTags', label: 'Теги потолка', type: 'tags', value: tagsToText(brush.ceilingTags) },
            { key: 'holes', label: 'holes JSON', type: 'text', value: brush.holes ? JSON.stringify(brush.holes) : '' },
            { key: 'subtract', label: 'subtract (true/false)', type: 'text', value: boolText(!!brush.subtract) },
        ];
    }
    if (kind === 'face') {
        const brushId = (selection && selection.ids && selection.ids.length) ? String(selection.ids[0]).split(':')[0] : '';
        const brush = find(map, 'brushes', brushId) || {};
        const face = (selection && selection.face) || 'side';
        const field = face === 'floor' ? 'floorColor' : face === 'ceiling' ? 'ceilingColor' : 'sideColor';
        const tagField = face === 'ceiling' ? 'ceilingTags' : 'tags';
        return [
            { key: 'face', label: 'Грань', type: 'select', options: ['side', 'floor', 'ceiling'], value: face },
            { key: 'material', label: 'Материал/цвет', type: 'text', value: brush[field] || '' },
            { key: 'tags', label: 'Теги', type: 'tags', value: tagsToText(brush[tagField]) },
        ];
    }
    if (kind === 'entity') {
        const entity = find(map, 'entities', firstId) || {};
        return [
            { key: 'id', label: 'id', type: 'text', value: entity.id || '' },
            { key: 'kind', label: 'Класс/kind', type: 'text', value: entity.kind || '' },
            { key: 'x', label: 'X', type: 'number', value: entity.x },
            { key: 'y', label: 'Y', type: 'number', value: entity.y },
            { key: 'h', label: 'Высота', type: 'number', value: entity.h },
            { key: 'brush', label: 'Brush', type: 'text', value: entity.brush || '' },
            { key: 'target', label: 'Target', type: 'text', value: entity.target || '' },
            { key: 'tags', label: 'Теги', type: 'tags', value: tagsToText(entity.tags) },
        ];
    }
    if (kind === 'path') {
        const path = find(map, 'paths', firstId) || {};
        return [
            { key: 'id', label: 'id', type: 'text', value: path.id || '' },
            { key: 'name', label: 'Имя', type: 'text', value: path.name || '' },
            { key: 'type', label: 'Тип', type: 'text', value: path.type || '' },
            { key: 'loop', label: 'loop (true/false)', type: 'text', value: boolText(!!path.loop) },
            { key: 'oneWay', label: 'oneWay (true/false)', type: 'text', value: boolText(!!path.oneWay) },
            { key: 'nodes', label: 'Узлы JSON', type: 'text', value: JSON.stringify(pathNodes(path)) },
            { key: 'metadata', label: 'metadata JSON', type: 'text', value: path.metadata ? JSON.stringify(path.metadata) : '' },
        ];
    }
    if (kind === 'visgroup') {
        const group = find(map, 'visgroups', firstId) || {};
        return [
            { key: 'id', label: 'id', type: 'text', value: group.id || '' },
            { key: 'name', label: 'Имя', type: 'text', value: group.name || '' },
            { key: 'visible', label: 'Видима (true/false)', type: 'text', value: boolText(group.visible !== false) },
            { key: 'locked', label: 'Заблокирована (true/false)', type: 'text', value: boolText(!!group.locked) },
        ];
    }
    return [{ key: 'json', label: 'JSON', type: 'json', value: JSON.stringify(map, null, 2) }];
}
