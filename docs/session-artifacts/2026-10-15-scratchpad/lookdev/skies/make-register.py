import json, sys
sky = [
  # id, title, author, sha256, bytes, licence evidence
  ('kiara_5_noon', 'Kiara 5 Noon', 'Greg Zaal', '08bc520d5134275fd17b26cd89c99e448f173b6feb691df5bb4349550edcc179', 19484894, 'clear day, 51 degree sun, arid mountain valley'),
  ('goegap', 'Goegap', 'Greg Zaal', '837f41b5a1549ef83c9872a699a3f0e01ee62b22f86d742aaf783996e1e5095b', 18211054, 'clear day, 47 degree sun, desert'),
  ('quarry_02', 'Quarry 02', 'Sergej Majboroda', 'b80b332d216dd03f4e035bcc07d3ee9dfa73466a114e0e4a12ba9ff9b0ebe0bb', 18784177, 'fair-weather cumulus, 47 degree sun'),
  ('rural_landscape', 'Rural Landscape', 'Sergej Majboroda', '7545499c2d4e6a86aef04916915dc4eff2b8f09c3d9f7ea9aba0f6854587ceb9', 20765378, 'broken cloud, hazy, flat country'),
  ('waterbuck_trail', 'Waterbuck Trail', 'Greg Zaal', 'ea485e1aff4310fddee4914d215cbc616ebaa5541990c9817b6d5cd8d4954822', 18491795, 'overcast, low hills and a distant valley'),
  ('mud_road', 'Mud Road', 'Sergey Rudavin', '6b80064dbc9c30dd0c2aebdca7a3b6c74668f3143e62c74a6a4d8871a5db3ede', 18730577, 'overcast, flat farmland'),
  ('kloppenheim_01', 'Kloppenheim 01', 'Greg Zaal', '16c9ba54bd0d935d94b80c2e434cb75df0708ebaddac44d49e71435d5fd75b92', 16773397, 'low overcast and mist (rain)'),
  ('winter_lake_01', 'Winter Lake 01', 'Sergej Majboroda', '4ac9291cfd8fea936deab1558fc10353474c1923279be2a0fa23d6b5e82d666a', 15580533, 'bright winter overcast over a frozen lake and snow'),
  ('table_mountain_1', 'Table Mountain 1', 'Greg Zaal', '99d85e39ab4bf45aae623152cd32c5ff429afd01dcba0cf8c5485e510eee011d', 19819520, 'golden hour, 13 degree sun, broken cloud'),
  ('kiara_8_sunset', 'Kiara 8 Sunset', 'Greg Zaal', 'c2be48fb05747be571d9982aa9288ee3b680f47d59cbf5ca88ff93edd79b8f34', 19882439, 'sunset, clear, 4 degree sun'),
  ('syferfontein_0d_clear', 'Syferfontein 0d Clear', 'Greg Zaal', '4d281768a119700cfeed572d8773373bc861d04398716ed15dad323484ad0ebe', 18529114, 'dawn, clear, sun on the horizon'),
  ('kloppenheim_02', 'Kloppenheim 02', 'Greg Zaal', '82cfe5427b48ae583612cd1a3421d264de2963540d9890d5aee162c7f0cdd547', 23572957, 'night, clear, moonlit'),
  ('kloppenheim_04', 'Kloppenheim 04', 'Greg Zaal', 'fa490b123d248edb01733739aff7b2ba6822b69f3439c33bfff53c99bd912d4e', 22426254, 'night, fog lit by distant towns'),
]
sources = []
SKYLINE = {'rural_landscape': 7.5, 'winter_lake_01': 5.5}
for pid, title, author, sha, size, mood in sky:
  sources.append({
    'id': pid.replace('_', '-'),
    'kind': 'hdri',
    'title': title,
    'author': author,
    'licence': 'CC0-1.0',
    'attribution': f'"{title}" HDRI by {author}, Poly Haven (CC0 1.0)',
    'homepage': f'https://polyhaven.com/a/{pid}',
    'licenceEvidence': 'Poly Haven publishes every asset under CC0 1.0; the mirror archive\'s data.json and the bucket index HDRI_haven.json both state "license": "CC0 1.0".',
    'notes': mood,
    'files': [{
      'url': f'https://storage.googleapis.com/kubric-public/assets/HDRI_haven/{pid}.tar.gz',
      'sha256': sha,
      'bytes': size,
      'member': 'environment_4k.hdr',
    }],
    'recipe': {'type': 'hdri', 'clamp': 64, 'variants': [4096, 2048], 'quality': 88, 'skyline': SKYLINE.get(pid, 0)},
  })
base = 'https://raw.githubusercontent.com/google/filament/58fcec6e73ed90f8d4be8ad9ad570bc3f3a59a4d/third_party/textures/Sandy_gravel_01/'
sources.append({
  'id': 'sandy-gravel-01',
  'kind': 'texture',
  'title': 'Sandy Gravel 01',
  'author': 'cgbookcase',
  'licence': 'CC0-1.0',
  'attribution': '"Sandy Gravel 01" texture by cgbookcase (CC0 1.0)',
  'homepage': 'https://www.cgbookcase.com/',
  'licenceEvidence': 'cgbookcase publishes its textures under CC0 1.0; redistributed unchanged in the google/filament repository (third_party/textures, pinned commit).',
  'notes': 'gravel trap / run-off: 2 m tile; the normal map is DirectX (Y-down) and is converted to OpenGL (Y-up).',
  'files': [
    {'url': base + 'Sandy_gravel_01_Color.png', 'sha256': '9df633b03d5df6f27ea29a87fd85632f896f507bb1b6834ba40c0373b301ac68', 'bytes': 8588583, 'role': 'color'},
    {'url': base + 'Sandy_gravel_01_Normal.png', 'sha256': 'f59e85a679e9cf320763985920cec2a43f8c72840a88a8ee9c93d6fcff0eff3e', 'bytes': 10322105, 'role': 'normal'},
    {'url': base + 'Sandy_gravel_01_Roughness.png', 'sha256': '243562c526740942c5f838ed4bc9a79025027a160273b1751a4574b48655925e', 'bytes': 3884036, 'role': 'roughness'},
    {'url': base + 'Sandy_gravel_01_AO.png', 'sha256': '63ec791f69dc5ebb9f5fbdbdcf474203162724cca127871a0e96159bc04da17f', 'bytes': 1883678, 'role': 'ao'},
  ],
  'recipe': {'type': 'pbr', 'size': 1024, 'normal': 'dx', 'metres': 2},
})
reg = {
  'version': 1,
  'budgetBytes': 150 * 1024 * 1024,
  'note': 'Source register of every third-party asset the application ships. Edit this file, then run scripts/assets/build-third-party.ts; never hand-edit public/assets/third-party or src/rendering/assets/third-party-manifest.json.',
  'sources': sources,
}
json.dump(reg, open(sys.argv[1], 'w'), indent=2, ensure_ascii=False)
open(sys.argv[1], 'a').write('\n')
