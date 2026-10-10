#!/usr/bin/env python3
"""Tiny ASCII FBX fixtures for the baker's FBX loader (a textured-less red cube with UVs)."""
import sys
from pathlib import Path

CUBE_V = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
CUBE_F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)]


def cube_fbx(color=(1, 0, 0), name='Cube'):
    verts = ','.join(f'{c}' for v in CUBE_V for c in v)
    idx = []
    for f in CUBE_F:
        idx += list(f[:-1]) + [-f[-1] - 1]
    uv = '0,0,1,0,1,1,0,1'
    uvi = ','.join(str(i % 4) for i in range(24))
    return f'''; FBX 7.4.0 project file
FBXHeaderExtension:  {{
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}}
GlobalSettings:  {{
	Version: 1000
	Properties70:  {{
		P: "UpAxis", "int", "Integer", "",1
		P: "UpAxisSign", "int", "Integer", "",1
		P: "FrontAxis", "int", "Integer", "",2
		P: "FrontAxisSign", "int", "Integer", "",1
		P: "CoordAxis", "int", "Integer", "",0
		P: "CoordAxisSign", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",100
	}}
}}
Objects:  {{
	Geometry: 1000, "Geometry::{name}", "Mesh" {{
		Vertices: *24 {{
			a: {verts}
		}}
		PolygonVertexIndex: *24 {{
			a: {','.join(map(str, idx))}
		}}
		GeometryVersion: 124
		LayerElementUV: 0 {{
			Version: 101
			Name: "UVMap"
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "IndexToDirect"
			UV: *8 {{
				a: {uv}
			}}
			UVIndex: *24 {{
				a: {uvi}
			}}
		}}
		LayerElementMaterial: 0 {{
			Version: 101
			Name: ""
			MappingInformationType: "AllSame"
			ReferenceInformationType: "IndexToDirect"
			Materials: *1 {{
				a: 0
			}}
		}}
		Layer: 0 {{
			Version: 100
			LayerElement:  {{
				Type: "LayerElementUV"
				TypedIndex: 0
			}}
			LayerElement:  {{
				Type: "LayerElementMaterial"
				TypedIndex: 0
			}}
		}}
	}}
	Model: 2000, "Model::{name}", "Mesh" {{
		Version: 232
		Properties70:  {{
		}}
	}}
	Material: 3000, "Material::Paint", "" {{
		Version: 102
		ShadingModel: "phong"
		Properties70:  {{
			P: "DiffuseColor", "Color", "", "A",{color[0]},{color[1]},{color[2]}
		}}
	}}
}}
Connections:  {{
	C: "OO",2000,0
	C: "OO",1000,2000
	C: "OO",3000,2000
}}
'''


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    (out / 'cube.fbx').write_text(cube_fbx())
    print(out / 'cube.fbx')
