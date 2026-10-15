p='src/simulation/offroad/venues.ts'
s=open(p).read()
rep = {
"p.jump({ name: 'RIDGE TABLE', kind: 'tabletop', at: at(2, 22), height: 2.0, face: 28, gap: 12, landing: 26 });":
"p.jump({ name: 'RIDGE TABLE', kind: 'tabletop', at: at(2, 22), height: 2.0, face: 28, gap: 11, landing: 22 });",
"p.jump({ name: 'BARN DOUBLE', kind: 'double', at: at(4, 14), height: 2.1, face: 29, gap: 16, landing: 26 });":
"p.jump({ name: 'BARN DOUBLE', kind: 'double', at: at(4, 14), height: 2.1, face: 29, gap: 15, landingHeight: 2.3, landing: 23 });",
"p.jump({ name: 'SKY TRIPLE', kind: 'triple', at: at(8, 78), height: 1.8, face: 31, gap: 19, landing: 27 });":
"p.jump({ name: 'SKY TRIPLE', kind: 'triple', at: at(8, 78), height: 1.8, face: 31, gap: 18, landingHeight: 2.0, landing: 24 });",
"p.jump({ name: 'SUMMIT TABLE', kind: 'tabletop', at: at(10, 18), height: 2.5, face: 30, gap: 14, landing: 27 });":
"p.jump({ name: 'SUMMIT TABLE', kind: 'tabletop', at: at(10, 18), height: 2.4, face: 29, gap: 13, landing: 23 });",
"p.jump({ name: 'VALLEY DOUBLE', kind: 'double', at: at(10, 68), height: 2.0, face: 29, gap: 15, landing: 26 });":
"p.jump({ name: 'VALLEY DOUBLE', kind: 'double', at: at(10, 68), height: 2.0, face: 28, gap: 14, landingHeight: 2.2, landing: 23 });",
"p.jump({ name: 'TRIPLE', kind: 'triple', at: at(2, 14), height: 1.6, face: 32, gap: 18, landing: 28 });":
"p.jump({ name: 'TRIPLE', kind: 'triple', at: at(2, 14), height: 1.6, face: 31, gap: 17, landingHeight: 1.8, landing: 24 });",
"p.jump({ name: 'LANE DOUBLE', kind: 'double', at: at(2, 50), height: 1.5, face: 30, gap: 12, landing: 26 });":
"p.jump({ name: 'LANE DOUBLE', kind: 'double', at: at(2, 50), height: 1.5, face: 29, gap: 11, landingHeight: 1.7, landing: 23 });",
"p.jump({ name: 'TABLETOP', kind: 'tabletop', at: at(6, 14), height: 1.8, face: 30, gap: 9, landing: 26 });":
"p.jump({ name: 'TABLETOP', kind: 'tabletop', at: at(6, 14), height: 1.8, face: 29, gap: 9, landing: 22 });",
"p.jump({ name: 'FINISH TRIPLE', kind: 'triple', at: at(6, 78), height: 1.7, face: 32, gap: 19, landing: 28 });":
"p.jump({ name: 'FINISH TRIPLE', kind: 'triple', at: at(6, 78), height: 1.7, face: 31, gap: 17, landingHeight: 1.9, landing: 24 });",
}
for a,b in rep.items():
    assert a in s, a
    s=s.replace(a,b)
open(p,'w').write(s)
p='scratch-jump.ts'
s=open(p).read()
s=s.replace("bike.place(track, j.start - 25, 0);","bike.place(track, j.start - Number(process.argv[5] ?? 12), 0);")
open(p,'w').write(s)
