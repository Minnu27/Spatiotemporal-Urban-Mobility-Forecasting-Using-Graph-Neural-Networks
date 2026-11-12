"""Download official TLC zone polygons for a self-contained dashboard map."""
import csv,io,json,pathlib,urllib.request,zipfile
import shapefile
from pyproj import Transformer
root=pathlib.Path(__file__).resolve().parents[1]
base='https://d37ci6vzurychx.cloudfront.net/misc/'
lookup=list(csv.DictReader(io.StringIO(urllib.request.urlopen(base+'taxi_zone_lookup.csv').read().decode())))
lookup={int(r['LocationID']):r for r in lookup if r['Borough'] in ['Manhattan','Brooklyn','Queens','Bronx','Staten Island','EWR']}
archive=zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(base+'taxi_zones.zip').read()))
def simplify(points,tolerance=.00025):
    if len(points)<=2:return points
    a,b=points[0],points[-1];dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
    distances=[]
    for p in points[1:-1]:
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)) if den else 0
        distances.append(((p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2)**.5)
    distance=max(distances,default=0)
    if distance<=tolerance:return [a,b]
    i=distances.index(distance)+1
    return simplify(points[:i+1],tolerance)[:-1]+simplify(points[i:],tolerance)

def member(ext):return io.BytesIO(archive.read(next(n for n in archive.namelist() if n.endswith(ext))))
reader=shapefile.Reader(shp=member('.shp'),shx=member('.shx'),dbf=member('.dbf'))
project=Transformer.from_crs(2263,4326,always_xy=True)
shapes={}
for record in reader.iterShapeRecords():
 r=record.record.as_dict();z=int(r['LocationID'])
 if z not in lookup:continue
 pts=record.shape.points;parts=list(record.shape.parts)+[len(pts)]
 rings=[]
 for a,b in zip(parts,parts[1:]):
  ring=[list(project.transform(*p)) for p in pts[a:b]]
  # Thin dense boundaries for map display; retain closure.
  reduced=simplify(ring)
  if len(reduced)>=4:ring=reduced
  rings.append([[round(x,5),round(y,5)] for x,y in ring])
 shapes.setdefault(z,[]).extend(rings)
zones=[];features=[]
for z,rings in sorted(shapes.items()):
 points=[p for ring in rings for p in ring]
 lon=sum(p[0] for p in points)/len(points);lat=sum(p[1] for p in points)/len(points)
 zones.append({'id':z,'name':lookup[z]['Zone'],'borough':lookup[z]['Borough'],'longitude':round(lon,5),'latitude':round(lat,5)})
 # Coordinates are display rings, not routing geometry or polygon containment.
 features.append({'id':z,'rings':rings})
assert len(zones)==263
(root/'data/zones.json').write_text(json.dumps(zones,separators=(',',':'))+'\n')
(root/'data/geography.json').write_text(json.dumps(features,separators=(',',':'))+'\n')
print('Saved',len(zones),'official taxi zone display geometries')
