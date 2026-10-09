// Authoring operations share the existing SDK history. Validation/compilation lives in C.
import { createHistory } from './history.js';
export const sections = ['cells', 'walls', 'portals', 'stairs', 'slopes'];
const copy = v => JSON.parse(JSON.stringify(v));
export function createWorldSession(source) {
    const data = copy(source), history = createHistory(data);
    const list = key => { if (!sections.includes(key)) throw new Error('Неизвестный раздел карты'); return data[key] || []; };
    const item = (key, i) => { const v = list(key)[i]; if (!v) throw new Error('Объект не выбран'); return v; };
    return {
        data, history,
        replace(key, i, value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Нужен объект JSON');
            item(key, i); history.run('Свойства', () => { data[key][i] = copy(value); });
        },
        add(key, value) {
            list(key); let i;
            history.run('Добавить ' + key, () => { if (!data[key]) data[key] = []; i = data[key].length; data[key].push(copy(value)); }); return i;
        },
        remove(key, i) { item(key, i); history.run('Удалить', () => data[key].splice(i, 1)); },
        move(key, i, dx, dy) {
            const v = item(key, i);
            history.run('Переместить', () => {
                if (v.rect) { v.rect[0] += dx; v.rect[1] += dy; }
                else { v.from[0] += dx; v.from[1] += dy; v.to[0] += dx; v.to[1] += dy; }
            });
        },
        splitWall(i) {
            const w = item('walls', i), mid = [(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2];
            let id = w.id + '-split'; while (list('walls').some(v => v.id === id)) id += '-split';
            history.run('Разрезать стену', () => { const next = copy(w); next.id = id; next.from = mid; w.to = mid; data.walls.splice(i + 1, 0, next); });
        },
        joinWalls(i, j) {
            if (i === j) throw new Error('Нужны две стены');
            const a = item('walls', i), b = item('walls', j);
            if (a.bottom !== b.bottom || a.top !== b.top || a.color !== b.color) throw new Error('Высоты и материал стен должны совпадать');
            const eq = (a,b) => a[0] === b[0] && a[1] === b[1];
            let from, to;
            if (eq(a.to,b.from)) { from = a.from; to = b.to; }
            else if (eq(a.from,b.to)) { from = b.from; to = a.to; }
            else if (eq(a.from,b.from)) { from = b.to; to = a.to; }
            else if (eq(a.to,b.to)) { from = a.from; to = b.from; }
            else throw new Error('Стены должны иметь общий конец');
            const ax=a.to[0]-a.from[0], ay=a.to[1]-a.from[1], bx=b.to[0]-b.from[0], by=b.to[1]-b.from[1];
            if (Math.abs(ax*by-ay*bx) > 0.001 || eq(from,to)) throw new Error('Объединение требует коллинеарных стен');
            history.run('Объединить стены', () => { a.from = copy(from); a.to = copy(to); data.walls.splice(j,1); });
        },
        text() { return JSON.stringify(data, null, 2) + '\n'; },
    };
}
