import math, sys
def trace(path, heading=0):
    x=z=0.0; phi=math.radians(heading); pts=[(0.0,0.0,0.0)]; d=0.0; segs=[]
    for seg in path:
        start=d
        if seg[0]=='S':
            L=seg[1]; n=max(2,int(L/2))
            for i in range(n):
                x+=math.cos(phi)*L/n; z+=math.sin(phi)*L/n; d+=L/n; pts.append((x,z,d))
        else:
            r,t=seg[1],seg[2]; L=r*abs(math.radians(t)); n=max(4,int(L/1.5))
            for i in range(n):
                phi+=math.radians(t)/n; x+=math.cos(phi)*L/n; z+=math.sin(phi)*L/n; d+=L/n; pts.append((x,z,d))
        segs.append((seg, start, d))
    return pts, segs, (x,z), sum(s[2] for s in path if s[0]=='A'), d
def report(name, path, heading=0, width=5, barrier=3, winding=1):
    pts, segs, end, turn, L = trace(path, heading)
    worst=1e9; wa=None
    for i in range(0,len(pts),2):
        for j in range(i+1,len(pts),2):
            ds=abs(pts[j][2]-pts[i][2]); ds=min(ds, L-ds)
            dd=math.hypot(pts[i][0]-pts[j][0], pts[i][1]-pts[j][1])
            if ds < max(150, 4*dd): continue
            if dd < worst: worst=dd; wa=(round(pts[i][2]),round(pts[j][2]))
    xs=[p[0] for p in pts]; zs=[p[1] for p in pts]
    print(f"{name}: L={L:.0f} end=({end[0]:.1f},{end[1]:.1f}) turn={turn} (target {winding*360}) minSep={worst:.1f} at {wa} need>{2*(width+barrier):.1f} bbox={max(xs)-min(xs):.0f}x{max(zs)-min(zs):.0f}")
    for seg, a, b in segs: print(f"   {seg}  {a:.0f}-{b:.0f}")
if __name__=='__main__':
    exec(open(sys.argv[1]).read())
