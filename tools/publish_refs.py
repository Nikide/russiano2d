"""Publish refs independently; a failed mirror never stops the next one."""
import argparse
import json
import subprocess
from pathlib import Path

def run(args, timeout=120):
    try:
        return subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, '', 'Timeout')

def publish(remotes, refs):
    seen=set()
    results=[]
    for remote in remotes:
        urls=run(['git','remote','get-url','--push','--all',remote])
        if urls.returncode:
            results.append({'remote':remote,'ok':False,'error':'missing remote'})
            continue
        for url in urls.stdout.splitlines():
            if url in seen: continue
            seen.add(url)
            pushed=run(['git','push',url,*refs])
            print(remote + ': ' + pushed.stdout + pushed.stderr, flush=True)
            verified=run(['git','ls-remote',url,*refs], timeout=45) if pushed.returncode==0 else None
            tips=dict(line.split()[::-1] for line in verified.stdout.splitlines()) if verified and verified.returncode==0 else {}
            expected={ref:run(['git','rev-parse',ref]).stdout.strip() for ref in refs}
            ok=pushed.returncode==0 and all(tips.get(ref)==sha for ref,sha in expected.items())
            results.append({'remote':remote,'url':url,'ok':ok,'pushExit':pushed.returncode})
    return results

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--remotes',nargs='+',required=True)
    p.add_argument('--refs',nargs='+',required=True)
    p.add_argument('--report',default='build/publish-results.json')
    a=p.parse_args()
    results=publish(a.remotes,a.refs)
    Path(a.report).parent.mkdir(parents=True,exist_ok=True)
    Path(a.report).write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(results,ensure_ascii=False),flush=True)
    raise SystemExit(0 if results and all(r['ok'] for r in results) else 1)
