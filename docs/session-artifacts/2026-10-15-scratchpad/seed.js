new Promise((resolve, reject) => {
  const r = indexedDB.open('apex-formula', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('saved');
  r.onsuccess = () => {
    const db = r.result;
    const tx = db.transaction('saved', 'readwrite');
    tx.objectStore('saved').put(
      {
        version: 1,
        discovered: [
          'coast-to-summit', 'grand-loop', 'port-ilse-loop', 'kestrel-circuit', 'valley-sprint', 'thornwood-rally',
          'ridge-trap', 'coast-trap', 'pass-zone', 'plateau-zone', 'hairpin-drift', 'quarry-drift', 'runway-showcase',
        ],
        best: {},
        vehicle: 'gt10m',
      },
      'festival:v1',
    );
    tx.oncomplete = () => resolve('seeded');
    tx.onerror = () => reject(tx.error);
  };
  r.onerror = () => reject(r.error);
})
