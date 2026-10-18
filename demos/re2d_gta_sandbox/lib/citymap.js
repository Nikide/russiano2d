// Сборка маленького GTA-подобного города в native author JSON Re2D World.
//
// Сетка клеток 96u. Дороги (крест), тротуары вдоль них, парки/газон и
// здания-кварталы. У здания два span'а: [0..150] интерьер и [150..170] крыша —
// с top-down камеры видна именно крыша, а не пол. Каждая клетка получает
// surface tags: road/sidewalk/grass/park/building/roof/no_spawn (P0.1).
// Тут же генерируются: статические стены, порталы между соседями, дорожный и
// пешеходный графы, точки спавна и парковки.
'use strict';

export const CELL = 96;
export const COLS = 16;
export const ROWS = 14;
export const WORLD_W = COLS * CELL;
export const WORLD_H = ROWS * CELL;

const COLORS = {
    road: '#3a3a40', sidewalk: '#76736c', grass: '#3e6136', roof: '#705844',
    interior: '#2a2a2e', wall: '#5c4a3a', boundary: '#26262b',
};

function span(bottom, top, tags, floorColor, ceilingColor, ceilingTags) {
    const out = { bottom, top, tags, floorColor, ceilingColor };
    if (ceilingTags) out.ceilingTags = ceilingTags;
    return out;
}

function cellKind(c, r) {
    const road = (r === 6 || r === 7) || (c === 7 || c === 8);
    if (road) return 'road';
    const sidewalk = (r === 5 || r === 8) || (c === 6 || c === 9);
    if (sidewalk) return 'sidewalk';
    const buildingZone = (c < 6 || c > 9) && (r < 5 || r > 8);
    if (!buildingZone) return 'grass';
    // Детерминированные парки-пятачки внутри кварталов.
    if ((c * 7 + r * 11) % 9 === 0) return 'park';
    if ((c * 5 + r * 3) % 11 === 0) return 'park';
    return 'building';
}

const TAGS = {
    road: ['road', 'driveable', 'fast'],
    sidewalk: ['sidewalk', 'walkable', 'spawn'],
    grass: ['grass', 'walkable', 'soft'],
    park: ['grass', 'park', 'walkable', 'no_spawn'],
    building: ['building'],
    roof: ['building', 'roof'],
};

function wall(x1, y1, x2, y2, bottom, top, color) {
    return { from: [x1, y1], to: [x2, y2], bottom, top, color };
}

export function buildCity() {
    const cells = [];
    const walls = [];
    const index = (c, r) => r * COLS + c;
    const kinds = [];

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const kind = cellKind(c, r);
            kinds.push(kind);
            const x = c * CELL, y = r * CELL;
            if (kind === 'building') {
                cells.push({
                    x, y, w: CELL, h: CELL,
                    spans: [
                        span(0, 150, TAGS.building, COLORS.interior, COLORS.interior, ['sky']),
                        span(150, 170, TAGS.roof, COLORS.roof, COLORS.roof, ['roof']),
                    ],
                });
            } else {
                const tags = kind === 'road' ? TAGS.road
                    : kind === 'sidewalk' ? TAGS.sidewalk
                        : kind === 'park' ? TAGS.park : TAGS.grass;
                const color = kind === 'road' ? COLORS.road
                    : kind === 'sidewalk' ? COLORS.sidewalk : COLORS.grass;
                cells.push({
                    x, y, w: CELL, h: CELL,
                    spans: [span(0, 400, tags, color, color, ['sky'])],
                });
            }
        }
    }

    // Здания: периметр 0..170 (стена видна сбоку, крыша — сверху).
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (kinds[index(c, r)] !== 'building') continue;
            const x = c * CELL, y = r * CELL;
            walls.push(wall(x, y, x + CELL, y, 0, 170, COLORS.wall));
            walls.push(wall(x, y + CELL, x + CELL, y + CELL, 0, 170, COLORS.wall));
            walls.push(wall(x, y, x, y + CELL, 0, 170, COLORS.wall));
            walls.push(wall(x + CELL, y, x + CELL, y + CELL, 0, 170, COLORS.wall));
        }
    }
    // Граница мира: машина не уезжает за карту.
    walls.push(wall(0, 0, WORLD_W, 0, 0, 400, COLORS.boundary));
    walls.push(wall(0, WORLD_H, WORLD_W, WORLD_H, 0, 400, COLORS.boundary));
    walls.push(wall(0, 0, 0, WORLD_H, 0, 400, COLORS.boundary));
    walls.push(wall(WORLD_W, 0, WORLD_W, WORLD_H, 0, 400, COLORS.boundary));

    // Порталы между всеми соседями: openings — пересечения free spans.
    const portals = [];
    const overlaps = (a, b) => {
        const out = [];
        for (const sa of a.spans) {
            for (const sb of b.spans) {
                const bottom = Math.max(sa.bottom, sb.bottom);
                const top = Math.min(sa.top, sb.top);
                if (top - bottom > 1e-3) {
                    const key = bottom + ':' + top;
                    if (!out.some((o) => o.key === key)) out.push({ key, bottom, top });
                }
            }
        }
        return out.map(({ bottom, top }) => ({ bottom, top }));
    };
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const a = cells[index(c, r)];
            if (c + 1 < COLS) {
                const b = cells[index(c + 1, r)];
                const openings = overlaps(a, b);
                if (openings.length) {
                    const edge = (c + 1) * CELL;
                    portals.push({ cellA: index(c, r), cellB: index(c + 1, r),
                        from: [edge, r * CELL], to: [edge, (r + 1) * CELL], openings });
                }
            }
            if (r + 1 < ROWS) {
                const b = cells[index(c, r + 1)];
                const openings = overlaps(a, b);
                if (openings.length) {
                    const edge = (r + 1) * CELL;
                    portals.push({ cellA: index(c, r), cellB: index(c, r + 1),
                        from: [c * CELL, edge], to: [(c + 1) * CELL, edge], openings });
                }
            }
        }
    }

    // Дорожный граф: две полосы на каждое направление креста.
    const lane = CELL / 4;
    const roads = [
        { id: 'main.ew', kind: 'road', oneWay: false, speedLimit: 260,
          points: [[0, 7 * CELL], [WORLD_W, 7 * CELL]], laneOffset: lane },
        { id: 'main.ns', kind: 'road', oneWay: false, speedLimit: 260,
          points: [[7.5 * CELL, 0], [7.5 * CELL, WORLD_H]], laneOffset: lane },
    ];
    const walk = [];
    for (const r of [5, 8]) walk.push({ id: 'walk.row' + r, points: [[0, r * CELL + CELL / 2], [WORLD_W, r * CELL + CELL / 2]] });
    for (const c of [6, 9]) walk.push({ id: 'walk.col' + c, points: [[c * CELL + CELL / 2, 0], [c * CELL + CELL / 2, WORLD_H]] });

    const spawns = [];
    for (let c = 0; c < COLS; c++) {
        for (const r of [5, 8]) {
            if (kinds[index(c, r)] === 'sidewalk') {
                spawns.push({ kind: 'pedestrian', x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });
            }
        }
    }
    // Парковки на обочине главной дороги.
    const parking = [];
    for (let c = 1; c < COLS - 1; c += 2) {
        if (kinds[index(c, 6)] === 'road') parking.push({ x: c * CELL + CELL / 2, y: 6 * CELL + CELL / 2, angle: 0 });
        if (kinds[index(c, 7)] === 'road') parking.push({ x: c * CELL + CELL / 2, y: 7 * CELL + CELL / 2, angle: Math.PI });
    }
    const playerStart = { x: 6 * CELL + CELL / 2, y: 5 * CELL + CELL / 2 };
    const playerCar = { x: 7 * CELL + lane, y: 6 * CELL + CELL / 2, angle: -Math.PI / 2 };

    return {
        width: WORLD_W, height: WORLD_H, cell: CELL,
        map: { version: 1, cells, walls, portals },
        kinds, index,
        roads, walk, spawns, parking, playerStart, playerCar,
        buildings: cells.filter((cell, i) => kinds[i] === 'building')
            .map((cell) => ({ x: cell.x, y: cell.y, w: cell.w, h: cell.h, top: 170 })),
        wallColliders: walls.filter((w) => w.top >= 100),
    };
}
