import re, sys
path = sys.argv[1]
text = open(path).read()
objs = re.split(r'\n\s*ObjectBegin ', text)
for chunk in objs[1:]:
    name = chunk.split('\n', 1)[0]
    body = chunk.split('ObjectEnd', 1)[0]
    plys = re.findall(r'"string filename" "(geometry/[^"]+\.ply)"', body)
    texs = sorted(set(re.findall(r'"textures/([^"]+)"', body)))
    print(name, len(plys), plys[:3], '...', plys[-1:] if plys else '')
    print('   tex:', texs[:14])
