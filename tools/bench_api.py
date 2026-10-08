#!/usr/bin/env python3
"""Optional periodic $ API performance sweep; never run by the normal test runner.

python3 tools/bench_api.py
python3 tools/bench_api.py --baseline docs/benchmarks/api-performance.json --json build/bench_api_next.json --md docs/API_PERFORMANCE.md
python3 tools/bench_api.py --only selectors,nav,sprite --samples 3 --frames 60

Micro workloads use $.time.perfNow inside the actual runtime (no RPC/startup in
these timings). Frame workloads reuse bench_highlevel and native profile zones.
Raw measurements and machine/build/workload provenance are saved alongside MD.
"""
from __future__ import annotations
import argparse
import datetime
import hashlib
import json
import math
import os
import platform
from pathlib import Path
import statistics
import subprocess
import sys
import time

from agent_client import Agent
from bench_highlevel import measure as measure_frame

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / 'tools/bench_api_cases.json'
SCHEMA = 1
INFRA = {'bootstrap': 'process startup (wall clock, includes IPC)',
         'index': 'process startup (module installation)',
         'native': 'shared native bridge; included in native/frame workloads',
         'render': 'frame scenarios: batch collection and native renderer'}
FRAME_JOBS = [('none',0), ('sprite',100), ('sprite',1000), ('sprite',2000),
              ('body',100), ('body',1000), ('query',1000), ('cached',1000),
              ('id',1000), ('tween',1000), ('move',1000), ('particles',1000),
              ('ui',100), ('text',100), ('tilemap',10000), ('signal',1000),
              ('chain',1000), ('fast',1000), ('churn',1000), ('batch',1000)]


def command(args):
    return subprocess.check_output(args,cwd=ROOT,text=True,stderr=subprocess.DEVNULL).strip()


def optional(args):
    try:
        return command(args)
    except (OSError, subprocess.CalledProcessError):
        return None


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def percentile(values, q=0.95):
    data=sorted(values); index=(len(data)-1)*q; low=math.floor(index); high=math.ceil(index)
    return data[low]+(data[high]-data[low])*(index-low)


def metadata(binary,args):
    cache=Path(args.cache).resolve()
    config={}
    if cache.is_file():
        for line in cache.read_text().splitlines():
            if line.startswith(('CMAKE_BUILD_TYPE:', 'CMAKE_C_COMPILER:', 'CMAKE_C_FLAGS_RELEASE:', 'R2D_')) and '=' in line:
                key,value=line.split('=',1);config[key]=value
    hardware={'cpu':platform.processor() or platform.machine(),'model':None,'logical_cpus':os.cpu_count(),'ram_bytes':None,'gpu':None}
    if platform.system()=='Darwin':
        raw_machine=optional(['system_profiler','SPHardwareDataType','-json'])
        if raw_machine:
            info=json.loads(raw_machine).get('SPHardwareDataType',[{}])[0]
            hardware['product']=info.get('machine_name')
            hardware['physical_cpus']=optional(['sysctl','-n','hw.physicalcpu'])
        hardware.update(cpu=optional(['sysctl','-n','machdep.cpu.brand_string']),
                        model=optional(['sysctl','-n','hw.model']),ram_bytes=optional(['sysctl','-n','hw.memsize']))
        raw=optional(['system_profiler','SPDisplaysDataType','-json'])
        if raw:
            displays=json.loads(raw).get('SPDisplaysDataType',[])
            hardware['gpu']=[{k:v for k,v in d.items() if k in ['sppci_model','spdisplays_vendor','spdisplays_vram','spdisplays_cores','spdisplays_metal']} for d in displays]
        hardware['power']=optional(['pmset','-g','batt'])
    elif platform.system()=='Linux':
        hardware['cpu']=optional(['lscpu'])
        hardware['gpu']=optional(['lspci'])
        if Path('/proc/meminfo').exists():hardware['ram_bytes']=Path('/proc/meminfo').read_text().splitlines()[0]
    dirty=command(['git','status','--porcelain'])
    return {'date':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'timezone':'UTC',
            'os':platform.platform(),'architecture':platform.machine(),'hardware':hardware,
            'commit':command(['git','rev-parse','HEAD']),'dirty':bool(dirty),'dirty_paths':dirty.splitlines(),
            'binary':str(binary),'binary_sha256':sha(binary),'cmake_cache':str(cache),'build':config,
            'compiler':optional([next((v for k,v in config.items() if k.startswith('CMAKE_C_COMPILER:')),'cc'),'--version']), 'python':sys.version.split()[0],
            'workload_sha256':hashlib.sha256(CASES.read_bytes()+(ROOT/'tests/fixtures/bench_api/main.js').read_bytes()+(ROOT/'tests/fixtures/bench/main.js').read_bytes()).hexdigest(),
            'parameters':{'seed':17,'fixed_dt':1/60,'headless':True,'resolution':[1280,720],
                          'warm_frames':args.warm,'measurement_frames':args.frames,'samples':args.samples,
                          'micro_target_ms':args.target_ms,'max_iterations':16384,'audio':'SDL dummy unless R2D_TEST_AUDIO=real','selection':args.only},
            'environment':{k:v for k,v in os.environ.items() if k.startswith(('R2D_', 'SDL_')) and not any(word in k.lower() for word in ['key','token','secret','password'])},
            'background_process_names':optional(['ps','-axo','comm'])}


def micro(case,args,binary):
    start=time.perf_counter()
    with Agent(game='tests/fixtures/bench_api',binary=str(binary),seed=17,timeout=120,start_timeout=60) as a:
        startup=(time.perf_counter()-start)*1000
        a.step(1)
        code='$.benchApi.configure(()=>{const N='+str(case['size'])+';'+case['setup']+';return i=>{'+case['operation']+';};});true'
        a.eval(code)
        a.step(args.warm) # Warm actual caches/frames, including recorded replay input.
        a.eval('$.benchApi.run(8)')
        iterations=getattr(args,'baseline_iterations',{}).get(case['id'],16)
        while case['id'] not in getattr(args,'baseline_iterations',{}):
            probe=a.eval(f'$.benchApi.run({iterations})')
            if probe['elapsed_ms']>=args.target_ms or iterations>=16384:break
            iterations=min(16384,iterations*2)
            a.step(1)
        raw=[]
        for _ in range(args.samples):
            a.step(1) # Retire killed tweens/flush bounded per-frame registries.
            raw.append(a.eval(f'$.benchApi.run({iterations})'))
        render=a.eval('$.debug.render()')
        ready=a.ready
    timings=[r['elapsed_ms']*1000/r['iterations'] for r in raw]
    if not all(math.isfinite(x) and x>0 for x in timings):raise RuntimeError('nonpositive timing')
    return {**case,'type':'micro','median_us':statistics.median(timings),'p95_us':percentile(timings),
            'min_us':min(timings),'max_us':max(timings),'iterations':iterations,'raw':raw,
            'startup_ms':startup,'ready':ready,'render':render}


def frames(kind,n,args,binary):
    options={'warm':args.warm,'frames':args.frames,'binary':str(binary),'seed':17}
    runs=[measure_frame(kind,n,options) for _ in range(args.samples)]
    values=[r['js_ms'] for r in runs]
    return {'id':f'{kind}:{n}','kind':kind,'size':n,'type':'frame','description':kind,
            'median_ms':statistics.median(values),'p95_ms':percentile(values),'raw':runs,
            'logic_ms':statistics.median([r['logic_ms'] for r in runs]),
            'batch_ms':statistics.median([r['batch_ms'] for r in runs]),
            'physics_ms':statistics.median([r['physics_ms'] for r in runs])}


def compare(report,baseline,args):
    if not baseline:return {'status':'no baseline','regressions':[]}
    old=json.loads(Path(baseline).read_text());a=report['metadata'];b=old['metadata']
    keys=['os','architecture','hardware','build','workload_sha256','parameters','gpu_backend']
    mismatches=[]
    for key in keys:
        av,bv=a.get(key),b.get(key)
        if key=='hardware':
            av={k:v for k,v in av.items() if k!='power'}
            bv={k:v for k,v in bv.items() if k!='power'}
        if av!=bv:mismatches.append(key)
    def source(m):
        text=m['hardware'].get('power') or ''
        return text.splitlines()[0] if text else None
    if source(a)!=source(b):mismatches.append('power source')
    if mismatches:
        return {'status':'incomparable','differences':mismatches,'regressions':[]}
    index={r['id']:r for r in old['results']};regressions=[]
    for row in report['results']:
        previous=index.get(row['id'])
        if not previous or row.get('error') or previous.get('error'):continue
        metric='median_us' if row['type']=='micro' else 'median_ms'
        before=previous[metric];after=row[metric];row['baseline']=before
        row['delta_percent']=(after/before-1)*100 if before else None
        floor=args.absolute_us if row['type']=='micro' else args.absolute_ms
        if before>0 and after-before>floor and after/before>1+args.threshold/100:
            regressions.append(row['id'])
    return {'status':'compared','threshold_percent':args.threshold,'absolute_us':args.absolute_us,'absolute_ms':args.absolute_ms,'regressions':regressions}


def markdown(report):
    m=report['metadata'];h=m['hardware'];p=m['parameters'];results=report['results'];lines=[
        '# Производительность компонентов `$` API','',
        'Отдельный периодический стенд. Он **не входит** в обычный прогон тестов или CI.',
        'Это базовая линия конкретной машины, не обещание FPS на другом оборудовании.','',
        '## Машина и сборка','',
        '| Условие | Значение |','|---|---|',
        f"| Дата UTC | {m['date']} |",f"| ОС / архитектура | {m['os']} / {m['architecture']} |",
        f"| Компьютер / CPU | {h.get('product','')} {h['model']} / {str(h['cpu']).replace(chr(10),'; ')} |",
        f"| RAM / logical CPU | {h['ram_bytes']} bytes / {h['logical_cpus']} |",
        f"| GPU | `{json.dumps(h['gpu'],ensure_ascii=False)}` |",
        f"| GPU backend | {m.get('gpu_backend','unknown')} |",
        f"| Питание | {str(h.get('power','not captured')).replace(chr(10),' ; ')} |",
        f"| Binary version / SHA256 | {m.get('engine_version')} / `{m['binary_sha256']}` |",
        f"| HEAD / dirty | `{m['commit']}` / {m['dirty']} |",
        f"| Build | `{json.dumps(m['build'],ensure_ascii=False)}` |",
        f"| Разрешение / режим | {p['resolution'][0]}×{p['resolution'][1]}, headless, fixed dt 1/60, seed {p['seed']} |",
        f"| Прогрев / frame window / повторов | {p['warm_frames']} / {p['measurement_frames']} кадров / {p['samples']} |",
        f"| Таймер micro | $.time.perfNow, monotonic native clock; target {p['micro_target_ms']} ms на batch |",'',
        'Полные compiler flags, dirty paths, environment, список фоновых процессов и сырые',
        'результаты сохранены в JSON (базовая линия: `docs/benchmarks/api-performance.json`). Тест не останавливает чужие процессы.',
        'На фоне тяжёлой сборки/нагрузки замер следует повторить.','',
        '## Охват и методика','',
        'Режим: '+('полный sweep' if not p['selection'] else 'частичная выборка '+p['selection']),
        f"В дереве {len(report['modules'])} high-level модулей. Micro workloads: {sum(r['type']=='micro' for r in results)}; frame workloads: {sum(r['type']=='frame' for r in results)}.",
        'Таблица указывает конкретную операцию: это представительные нагрузки компонентов,',
        '**не замер каждого метода и каждой комбинации опций**. HTTP/SDK control rows',
        'меряют только overhead capability/path queries, не сеть, импорт или компиляцию.',
        'Micro timer исключает запуск процесса, подготовку и IPC; µs — время одной',
        'описанной операции (часто над N объектами), включая вызов callback и checksum.',
        'P95 в micro — percentile средних по повторным batches, не latency каждой операции.',
        'Frame CPU — native profiler averages по окну; P95 — разброс окон, не отдельных кадров.',
        'Обе метрики зависят от сборки, частоты CPU и фоновой нагрузки.','',
        '| Компонент / нагрузка | N | Median µs/op | P95 µs/op | Δ baseline |',
        '|---|---:|---:|---:|---:|']
    for r in results:
        if r['type']!='micro':continue
        title=', '.join(r['modules'])+' — '+r['description']
        if r.get('error'):lines.append(f"| {title} | {r['size']} | ERROR | {r['error']} | — |")
        else:
            delta=f"{r['delta_percent']:+.1f}%" if r.get('delta_percent') is not None else '—'
            lines.append(f"| {title} | {r['size']} | {r['median_us']:.3f} | {r['p95_us']:.3f} | {delta} |")
    lines+=['','## Практические кадровые нагрузки','','| Сценарий | N | Логика ms | Батч ms | CPU вместе ms | P95 окон ms | Box2D ms |','|---|---:|---:|---:|---:|---:|---:|']
    for r in results:
        if r['type']!='frame':continue
        if r.get('error'):lines.append(f"| {r['id']} | {r['size']} | ERROR | — | — | — | — |")
        else:lines.append(f"| {r['kind']} | {r['size']} | {r['logic_ms']:.3f} | {r['batch_ms']:.3f} | {r['median_ms']:.3f} | {r['p95_ms']:.3f} | {r['physics_ms']:.3f} |")
    lines+=['','## Инфраструктура / ограничения охвата','']
    for name,description in INFRA.items():lines.append(f'- `{name}`: {description}.')
    lines+=['',f"Неописанные новые модули: {report['uncovered'] or 'нет'}.",
            'GPU fill-rate, реальная сеть/HTTP, дисковая запись, full SDK bake, audio output latency',
            'и все сцены каждой игры не покрываются micro таблицей. Audio использует SDL dummy.',
            'Re2DSprite row измеряет native synthesize pose на малом animal fixture; full World/VRM требует отдельных',
            'стендов (например `tools/bench_re2d_world.py`), не подменяется этой цифрой.','',
            '## Батчинг и тесты','',
            f"Измеренный batching probe: `{json.dumps(report.get('batching'),ensure_ascii=False)}`.",
            f"В дереве {report['agent_suites']} агентских наборов; их наличие не означает, что этот скрипт их запускает.",
            'draw calls / sprite зависит от текстур, порядка, blend и clipping. Probe — одна',
            'текстура, без смены blend/clip. Это не постоянная стоимость произвольной сцены.','',
            '## Повторный запуск и сравнение','',
            '```bash','python3 tools/bench_api.py',
            'python3 tools/bench_api.py --baseline docs/benchmarks/api-performance.json --json build/bench_api_next.json --md docs/API_PERFORMANCE.md','```','',
            f"Сравнение: `{json.dumps(report['comparison'],ensure_ascii=False)}`.",
            'Одинаковыми должны быть hardware/OS/build flags/backend/workload/parameters.',
            'Binary SHA и commit записываются, но могут отличаться: именно новые сборки сравниваются.',
            'По умолчанию подозрение на деградацию: >20% и >0.5 µs/op (micro) / >0.1 ms (frame).',
            'Exit 0 — измерения успешны, 1 — ошибка/неописанный модуль, 2 — неверные параметры,',
            '3 — найдены регрессии, 4 — baseline несопоставим. Один шумный результат требует повторения.',
            'JSON сохранить вне build, если он должен пережить очистку сборочных артефактов.','']
    return '\n'.join(lines)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',default=os.environ.get('R2D_BINARY','build/russiano2d'))
    parser.add_argument('--cache',default='build/CMakeCache.txt')
    parser.add_argument('--samples',type=int,default=7);parser.add_argument('--warm',type=int,default=40)
    parser.add_argument('--frames',type=int,default=120);parser.add_argument('--target-ms',type=float,default=20)
    parser.add_argument('--only');parser.add_argument('--baseline');parser.add_argument('--threshold',type=float,default=20)
    parser.add_argument('--absolute-us',type=float,default=0.5);parser.add_argument('--absolute-ms',type=float,default=0.1)
    parser.add_argument('--json',default='build/bench_api.json');parser.add_argument('--md',default='docs/API_PERFORMANCE.md')
    args=parser.parse_args()
    if args.samples<3 or args.warm<1 or args.frames<10 or args.target_ms<=0 or not math.isfinite(args.target_ms) or args.threshold<0 or args.absolute_us<0 or args.absolute_ms<0:parser.error('samples >=3, warm >=1, frames >=10, target-ms >0 required')
    os.chdir(ROOT);binary=Path(args.binary).resolve()
    args.baseline_iterations={}
    if args.baseline:
        if Path(args.baseline).resolve()==Path(args.json).resolve():parser.error('baseline and output JSON must differ')
        previous=json.loads(Path(args.baseline).read_text())
        args.baseline_iterations={r['id']:r['iterations'] for r in previous['results'] if r['type']=='micro' and not r.get('error')}
    if not binary.is_file():parser.error('binary missing; build engine first')
    cases=json.loads(CASES.read_text());modules=sorted(p.stem for p in (ROOT/'src/highlevel').glob('*.js'))
    covered=set(INFRA)|{m for c in cases for m in c['modules']}
    uncovered=sorted(set(modules)-covered)
    selected=set(args.only.split(',')) if args.only else None
    valid={c['id'] for c in cases}|{kind for kind,n in FRAME_JOBS}
    if selected and selected-valid:parser.error('unknown scenarios: '+str(sorted(selected-valid)))
    report={'schema':SCHEMA,'metadata':metadata(binary,args),'modules':modules,'uncovered':uncovered,
            'agent_suites':len(list((ROOT/'tests/agent').glob('*_test.py'))),'results':[]}
    for case in cases:
        if selected and case['id'] not in selected:continue
        print('micro',case['id'],flush=True)
        try:report['results'].append(micro(case,args,binary))
        except Exception as exc:report['results'].append({**case,'type':'micro','error':str(exc)})
    for kind,n in FRAME_JOBS:
        if selected and kind not in selected:continue
        print('frame',kind,n,flush=True)
        try:report['results'].append(frames(kind,n,args,binary))
        except Exception as exc:report['results'].append({'id':f'{kind}:{n}','kind':kind,'size':n,'type':'frame','error':str(exc)})
    with Agent(game='tests/fixtures/bench',scene='sprite:1000',binary=str(binary),seed=17) as a:
        a.step(args.warm);render=a.eval('$.debug.render()');sprites=a.eval('$.gfx.stats().sprites')
        report['batching']={'scene':'sprite:1000','sprites':sprites,'draw_calls':render['info']['draws'],
                            'calls_per_sprite':render['info']['draws']/sprites,'resolution':[1280,720]}
        report['metadata']['engine_version']=a.ready['version']
        # GPU backend is emitted by SDL startup diagnostics, not invented from OS.
        stderr='\n'.join(a._stderr_lines)
        report['metadata']['runtime_startup_log']=stderr
        import re
        found=re.search(r'GPU-бэкенд:\s*(\w+)',stderr)
        report['metadata']['gpu_backend']=found.group(1) if found else 'not reported'
    if sha(binary)!=report['metadata']['binary_sha256']:raise RuntimeError('binary changed during measurements; repeat on stable build')
    report['comparison']=compare(report,args.baseline,args)
    for path,content in [(args.json,json.dumps(report,ensure_ascii=False,indent=2)+'\n'),(args.md,markdown(report))]:
        p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content)
    print(args.md,args.json,report['comparison'],flush=True)
    if uncovered or any(r.get('error') for r in report['results']):return 1
    if report['comparison']['status']=='incomparable':return 4
    return 3 if report['comparison']['regressions'] else 0


if __name__=='__main__':
    raise SystemExit(main())
