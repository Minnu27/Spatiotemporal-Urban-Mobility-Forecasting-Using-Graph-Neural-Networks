"""Download official TLC zone polygons for a self-contained dashboard map."""
import csv,io,json,pathlib,urllib.request,zipfile
import shapefile
from pyproj import Transformer
root=pathlib.Path(__file__).resolve().parents[1]
base='https://d37ci6vzurychx.cloudfront.net/misc/'
lookup=list(csv.DictReader(io.StringIO(urllib.request.urlopen(base+'taxi_zone_lookup.csv').read().decode())))
lookup={int(r['LocationID']):r for r in lookup if r['Borough'] in ['Manhattan','Brooklyn','Queens','Bronx','Staten Island','EWR']}
archive=zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(base+'taxi_zones.zip').read()))
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
  if len(ring)>180:ring=ring[::max(1,len(ring)//180)]+[ring[-1]]
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
