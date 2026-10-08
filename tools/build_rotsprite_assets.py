#!/usr/bin/env python3
"""Build JSON-described RotSprite materials/surfaces; geometry remains in data."""
import argparse,json
from pathlib import Path
from PIL import Image
from compile_rotsprite import compile_surface,save_png

def build(path):
    path=Path(path);data=json.loads(path.read_text());root=path.parent
    if data.get('version')!=1:raise ValueError('build version=1')
    for job in data['jobs']:
        material=None
        if 'material' in job:material=root/job['material']
        if 'materials' in job:
            image=Image.new('RGBA',(1024,1024))
            for item in job['materials']:
                x,y,w,h=item['rect']
                if 'color' in item:image.paste(tuple(item['color'])+(255,),(x,y,x+w,y+h));continue
                source=Image.open(root/item['source']).convert('RGBA')
                source.putalpha(source.getchannel('A').point(lambda a:255 if a>=128 else 0))
                box=tuple(round(v*s) for v,s in zip(item['crop'],[source.width,source.height]*2))
                part=source.crop(box);bbox=part.getbbox()
                if not bbox:raise ValueError('material crop is empty')
                part=part.crop(bbox).resize((w,h),Image.Resampling.NEAREST)
                image.paste(part,(x,y))
            image.putalpha(image.getchannel('A').point(lambda a:255 if a>=128 else 0))
            material=root/job['materialOutput'];save_png(image,material)
        surface=json.loads((root/job['surface']).read_text())
        output=root/job['output'];output.parent.mkdir(parents=True,exist_ok=True)
        save_png(compile_surface(surface,material,job.get('size',1024),job.get('segments',False)),output)
        print(output)
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('build');build(parser.parse_args().build)
