#!/usr/bin/env python3
"""Fast checks of benchmark accounting/comparison; no performance run."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import bench_api as bench


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.args=SimpleNamespace(absolute_us=0.5,absolute_ms=0.1,threshold=20)
        self.report={'metadata':{'os':'test','architecture':'arm64','hardware':{'cpu':'CPU','power':"Now drawing from 'AC Power'\n100%"},'build':{'type':'Release'},'workload_sha256':'abc','parameters':{'samples':7},'gpu_backend':'metal'},'results':[{'id':'x','type':'micro','median_us':10}]}

    def compare(self,report,baseline=None):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'baseline.json';path.write_text(json.dumps(baseline or self.report))
            return bench.compare(report,path,self.args)

    def test_detects_regression(self):
        r=copy.deepcopy(self.report);r['results'][0]['median_us']=13
        self.assertEqual(self.compare(r)['regressions'],['x'])
        self.assertEqual(r['results'][0]['delta_percent'],30.000000000000004)

    def test_absolute_noise_floor(self):
        baseline=copy.deepcopy(self.report);baseline['results'][0]['median_us']=0.1
        r=copy.deepcopy(baseline);r['results'][0]['median_us']=0.15
        self.assertEqual(self.compare(r,baseline)['regressions'],[])

    def test_different_machine_or_workload_is_not_comparable(self):
        for key in ('hardware','parameters','build','workload_sha256','gpu_backend'):
            r=copy.deepcopy(self.report)
            if key=='hardware':r['metadata'][key]['cpu']='other'
            else:r['metadata'][key]='other'
            self.assertEqual(self.compare(r)['status'],'incomparable')

    def test_battery_percentage_is_not_a_hardware_change(self):
        r=copy.deepcopy(self.report);r['metadata']['hardware']['power']="Now drawing from 'AC Power'\n99%"
        self.assertEqual(self.compare(r)['status'],'compared')
        r['metadata']['hardware']['power']="Now drawing from 'Battery Power'\n99%"
        self.assertEqual(self.compare(r)['status'],'incomparable')

    def test_binary_and_commit_may_change(self):
        r=copy.deepcopy(self.report);r['metadata'].update(binary_sha256='new',commit='new')
        self.assertEqual(self.compare(r)['status'],'compared')

    def test_manifest_covers_every_live_module(self):
        cases=json.loads(bench.CASES.read_text());self.assertEqual(len({c['id'] for c in cases}),len(cases))
        modules={p.stem for p in (ROOT/'src/highlevel').glob('*.js')}
        covered=set(bench.INFRA)|{m for c in cases for m in c['modules']}
        self.assertEqual(modules-covered,set())

    def test_interpolated_p95(self):
        self.assertEqual(bench.percentile([1,2,3,4,5]),4.8)


if __name__=='__main__':unittest.main()
