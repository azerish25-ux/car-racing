#!/usr/bin/env python3
"""Rebuild the ODbL street dataset from a downloaded OSM map and route GeoJSON.
No image acquisition, scraping, model inference or network calls are performed.
Usage: python scripts/import-charlottetown.py --osm map.osm --route route.geojson
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

ORIGIN = [-63.1295, 46.2385]
PHI = math.radians(ORIGIN[1])
A = 6378137.0
E2 = 6.69437999014e-3
W = math.sqrt(1 - E2 * math.sin(PHI)**2)
METRES_LON = math.pi / 180 * A / W * math.cos(PHI)
METRES_LAT = math.pi / 180 * A * (1-E2) / W**3
BBOX = [-63.140, 46.2337, -63.119, 46.2430]

def project(p):
    return [round(-(p[0]-ORIGIN[0])*METRES_LON, 3), round((p[1]-ORIGIN[1])*METRES_LAT, 3)]

def tags(element):
    return {x.get('k'):x.get('v') for x in element.findall('tag')}

def distance(p, route):
    best = float('inf')
    for a,b in zip(route,route[1:]):
        dx,dz=b[0]-a[0],b[1]-a[1]
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz or 1)))
        best=min(best,math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz))
    return best

def area(poly):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))*.5

def num(text, default):
    try:
        value=float(str(text).split(';')[0].replace(' m',''))
        return value if math.isfinite(value) else default
    except (ValueError,TypeError):
        return default

def clip_line(points):
    # Liang-Barsky against the exact acquisition rectangle, in world metres.
    xmin,xmax=project([BBOX[2],ORIGIN[1]])[0],project([BBOX[0],ORIGIN[1]])[0]
    zmin,zmax=project([ORIGIN[0],BBOX[1]])[1],project([ORIGIN[0],BBOX[3]])[1]
    runs=[]; current=[]
    for a,b in zip(points,points[1:]):
        dx,dz=b[0]-a[0],b[1]-a[1]; t0,t1=0.,1.; valid=True
        for p,q in [(-dx,a[0]-xmin),(dx,xmax-a[0]),(-dz,a[1]-zmin),(dz,zmax-a[1])]:
            if abs(p)<1e-12:
                if q<0:valid=False;break
            elif p<0:t0=max(t0,q/p)
            else:t1=min(t1,q/p)
        if not valid or t0>t1:
            if len(current)>1:runs.append(current)
            current=[];continue
        c=[round(a[0]+dx*t0,3),round(a[1]+dz*t0,3)]
        d=[round(a[0]+dx*t1,3),round(a[1]+dz*t1,3)]
        if math.dist(c,d)<.05:continue
        if current and math.dist(current[-1],c)>.1:
            if len(current)>1:runs.append(current)
            current=[]
        if not current:current=[c]
        current.append(d)
    if len(current)>1:runs.append(current)
    return runs

def build(osm_path, route_path):
    raw=osm_path.read_bytes(); root=ET.fromstring(raw)
    gj=json.loads(route_path.read_text())
    line=next(f['geometry']['coordinates'] for f in gj['features'] if f['geometry']['type']=='LineString')
    route=[project(p) for p in line]
    nodes={n.get('id'):project([float(n.get('lon')),float(n.get('lat'))]) for n in root.findall('node')}
    buildings=[]; roads=[]; greens=[]; parking=[]; footways=[]; trees=[]; landmarks=[]
    used_tags=['name','building','building:levels','height','roof:shape','roof:height','roof:colour','building:material','building:colour','addr:street','addr:housenumber','amenity','operator']
    streets={'residential','primary','secondary','tertiary','unclassified','living_street'}
    for w in root.findall('way'):
        t=tags(w); coords=[nodes[n.get('ref')] for n in w.findall('nd') if n.get('ref') in nodes]
        if len(coords)<2:continue
        wid=w.get('id'); name=t.get('name','Unnamed street')
        centre=[sum(p[i] for p in coords)/len(coords) for i in [0,1]]
        nearby=min(distance(p,route) for p in coords+[centre])
        if 'building' in t and t['building'] not in ['no','roof','construction'] and coords[0]==coords[-1] and nearby<210:
            poly=coords[:-1]
            if len(poly)<3 or area(poly)<8:continue
            kind=t.get('building','yes'); levels=num(t.get('building:levels'),3 if kind in ['commercial','apartments','school','public','civic','hotel'] or t.get('amenity')=='college' else 2)
            levels=max(1,min(12,levels)); h=num(t.get('height'),levels*3.15+.55)
            buildings.append({'id':'osm-way-'+wid,'footprint':poly,'height':round(max(2,min(65,h)),2),'floors':levels,'heightSource':'osm-height' if 'height' in t else 'osm-levels-estimate' if 'building:levels' in t else 'estimated','tags':{k:t[k] for k in used_tags if k in t}})
        hw=t.get('highway')
        if hw in streets and nearby<340:
            for i,run in enumerate(clip_line(coords)):
                if sum(math.dist(a,b) for a,b in zip(run,run[1:]))<4:continue
                lanes=max(1,min(4,num(t.get('lanes'),2)))
                default=3.1 if name=='Maloney Drive' else 4.6 if lanes<=2 else lanes*1.65
                width=num(t.get('width'),default*2)/2
                roads.append({'id':'osm-way-'+wid+('-'+str(i) if i else ''),'name':name,'points':run,'halfWidth':round(max(2.6,min(8,width)),2),'widthSource':'osm-width' if 'width' in t else 'estimated','oneway':t.get('oneway','no'),'lanes':lanes})
        if nearby<220 and coords[0]==coords[-1]:
            item={'id':'osm-way-'+wid,'name':t.get('name',''),'points':coords[:-1]}
            if t.get('leisure') in ['park','garden','playground','pitch'] or t.get('landuse') in ['grass','recreation_ground'] or t.get('natural') in ['wood','scrub']:
                greens.append({**item,'kind':t.get('leisure',t.get('landuse',t.get('natural')))})
            if t.get('amenity')=='parking':parking.append(item)
        if hw in ['footway','pedestrian','service'] and nearby<170:
            for run in clip_line(coords):
                footways.append({'id':'osm-way-'+wid,'points':run,'width':max(.8,min(6,num(t.get('width'),3 if hw=='service' else 1.5))),'kind':hw})
    for n in root.findall('node'):
        t=tags(n); p=nodes[n.get('id')]
        if distance(p,route)>210:continue
        if t.get('natural')=='tree':
            trees.append({'id':'osm-node-'+n.get('id'),'x':p[0],'z':p[1],'height':max(3,min(24,num(t.get('height'),9+int(n.get('id'))%600/100))),'heightSource':'osm-height' if 'height' in t else 'estimated'})
        if t.get('highway') in ['traffic_signals','crossing']:
            landmarks.append({'id':'osm-node-'+n.get('id'),'kind':t.get('highway'),'x':p[0],'z':p[1]})
    # Keep route-inspection stations separately from geometry. These are URLs, not images.
    stations=[{'id':i+1,'x':project(f['geometry']['coordinates'])[0],'z':project(f['geometry']['coordinates'])[1]} for i,f in enumerate([f for f in gj['features'] if f['geometry']['type']=='Point' and 'station' in str(f['properties']).lower()])]
    if len(stations)!=100:
        arc=[0]
        for a,b in zip(route,route[1:]):arc.append(arc[-1]+math.dist(a,b))
        stations=[]
        for i in range(100):
            s=arc[-1]*i/99;j=next((j for j in range(len(arc)-1) if arc[j+1]>=s),len(arc)-2)
            f=(s-arc[j])/(arc[j+1]-arc[j]); a,b=route[j],route[j+1]
            stations.append({'id':i+1,'x':round(a[0]+(b[0]-a[0])*f,3),'z':round(a[1]+(b[1]-a[1])*f,3)})
    return {'schema':1,'originLonLat':ORIGIN,'coordinateSystem':'local WGS84 tangent approximation, x west, z north, metres','source':{'attribution':'© OpenStreetMap contributors','license':'ODbL-1.0','licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/','url':'https://www.openstreetmap.org/api/0.6/map?bbox='+','.join(map(str,BBOX)),'retrieved':'2026-10-19','sha256':hashlib.sha256(raw).hexdigest(),'routeSource':'OSRM / OpenStreetMap; supplied 100-viewpoint pack, 2026-10-19','imageryUsed':False,'facadesVerified':False,'elevationVerified':False},'route':route,'routeLonLat':line,'stations':stations,'roads':roads,'buildings':buildings,'greens':greens,'parking':parking,'footways':footways,'trees':trees,'streetNodes':landmarks}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--osm',type=Path,required=True);p.add_argument('--route',type=Path,required=True);p.add_argument('--output',type=Path,default=Path('src/simulation/open-world/charlottetown/data.json'));a=p.parse_args()
    data=build(a.osm,a.route);a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(data,separators=(',',':'),ensure_ascii=False)+'\n')
    print(json.dumps({k:len(data[k]) for k in ['route','stations','roads','buildings','greens','parking','footways','trees','streetNodes']},indent=2))
if __name__=='__main__':main()
