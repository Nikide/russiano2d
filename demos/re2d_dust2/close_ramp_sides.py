#!/usr/bin/env python3
"""Close exposed ramp/ledge solid intervals using constrained wall strips.

Reads compiled cell/span topology, writes inspectable author walls. Inclined
edges use one-unit strips (maximum 0.8-unit deviation); floors stay continuous.
Recompile the source afterwards with r2d-sdk world-compile --renderer.
"""
import json,math
from pathlib import Path
path=Path(__file__).with_name('dust2.re2dmap')
data=json.loads(path.read_text())
cells=json.loads(path.with_suffix('.re2dworld').read_text())['cells']
data['walls']=[w for w in data['walls'] if w.get('tag')!='ramp-side']
original=list(data['walls'])
def floor(c,s,x,y):
    slope=s.get('floorSlope',{})
    return s['bottom']+slope.get('a',0)*(x-c['x'])+slope.get('b',0)*(y-c['y'])
def emit(a,b,axis,coord,lo,hi):
    varying=any(s.get('floorSlope') for c in (a,b) for s in c['spans'])
    count=math.ceil(hi-lo) if varying else 1
    for i in range(count):
        u=lo+(hi-lo)*i/count;v=lo+(hi-lo)*(i+1)/count
        start=[coord,u] if axis==0 else [u,coord]
        end=[coord,v] if axis==0 else [v,coord]
        previous=0
        for solid in sorted(a['spans'],key=lambda s:s['bottom']):
            high=max(floor(a,solid,*start),floor(a,solid,*end))
            for free in b['spans']:
                bottom=max(previous,min(floor(b,free,*start),floor(b,free,*end)))
                top=min(high,free['top'])
                if top<=bottom+1e-6:continue
                if any(w['bottom']<=bottom and w['top']>=top and
                       w['from'][axis]==coord and w['to'][axis]==coord and
                       min(w['from'][1-axis],w['to'][1-axis])<=u and
                       max(w['from'][1-axis],w['to'][1-axis])>=v for w in original):continue
                data['walls'].append({'id':f"side_{len(data['walls'])}",'from':start,'to':end,'bottom':bottom,'top':top,'color':'#736348','tag':'ramp-side'})
            previous=solid['top']
for i,a in enumerate(cells):
    for b in cells[:i]:
        edge=None
        if a['x']+a['w']==b['x'] or b['x']+b['w']==a['x']:
            edge=(0,max(a['x'],b['x']),max(a['y'],b['y']),min(a['y']+a['h'],b['y']+b['h']))
        elif a['y']+a['h']==b['y'] or b['y']+b['h']==a['y']:
            edge=(1,max(a['y'],b['y']),max(a['x'],b['x']),min(a['x']+a['w'],b['x']+b['w']))
        if edge and edge[3]>edge[2]:emit(a,b,*edge);emit(b,a,*edge)
path.write_text(json.dumps(data,indent=2)+'\n')
print('exposed ramp/ledge wall strips:',sum(w.get('tag')=='ramp-side' for w in data['walls']))
