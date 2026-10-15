import sys
for path in sys.argv[1:]:
    with open(path, 'rb') as f:
        head = f.read(1024)
    end = head.find(b'end_header')
    print(path.split('/')[-1])
    print(head[:end].decode('ascii', 'replace'))
    print('---')
