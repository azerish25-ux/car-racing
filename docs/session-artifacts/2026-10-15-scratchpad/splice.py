import sys
p = 'src/rendering/vehicle-bodies/body-sheet.ts'
s = open(p).read()
snippet = open(sys.argv[1]).read()
marker = """      caliperColor: 0x2b2d30,
      disc: 0,
    }),
  },
});
/** The sheet for a definition"""
assert s.count(marker) == 1, s.count(marker)
s = s.replace(marker, """      caliperColor: 0x2b2d30,
      disc: 0,
    }),
  },
""" + snippet + """});
/** The sheet for a definition""")
open(p, 'w').write(s)
print('spliced')
