#!/usr/bin/env python3
"""Rebuild the Dust2 NPC's Re2D animation JSON from its supplied Mixamo FBXs."""
import json
import os
import subprocess
import tempfile
from pathlib import Path

root=Path(__file__).resolve().parents[2]
demo=Path(__file__).resolve().parent
binary=Path(os.environ.get('R2D_SDK_BINARY',str(root/'build/r2d-sdk')))
rig=demo/'npc.character.json'
clips={}
with tempfile.TemporaryDirectory(prefix='re2d-npc-import-') as tmp:
    for filename,name in [('npc_talking.fbx','talking'),('npc_standing_arguing.fbx','arguing'),('npc_walk_in_circle.fbx','walkCircle')]:
        output=Path(tmp)/(name+'.json')
        subprocess.run([str(binary), 'animation-import', str(demo/'source'/filename), '--rig', str(rig), '--output', str(output), '--clip', name, '--stack', 'mixamo.com', '--fps', '15', '--seam', '.15'],cwd=root,check=True)
        clips.update(json.loads(output.read_text())['clips'])
clips.update(json.loads((root/'demos/rotsprite/russi.animations.json').read_text())['clips'])
result={'version':1,'clips':clips}
target=demo/'npc.animations.json'
tmp=target.with_suffix('.json.tmp')
tmp.write_text(json.dumps(result,separators=(',',':'))+'\n')
os.replace(tmp,target)
print(f'Published {len(clips)} clips to {target.relative_to(root)}')
