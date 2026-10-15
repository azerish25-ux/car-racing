const R = process.env.ROOT!;
const { liveRegistry } = await import(R + '/src/career/registry.ts');
const { disciplineTiers, tierVehicles, vehiclePrice, purchaseReasons } = await import(R + '/src/career/ladder.ts');
const reg = liveRegistry();
for (const d of ['circuit-cars', 'road-bikes']) {
  const tiers = disciplineTiers(reg, d);
  tiers.forEach((t: any, index: number) => {
    let prize: any = null;
    for (const n of tiers.slice(index + 1)) { prize = tierVehicles(reg, n).sort((a: any, b: any) => vehiclePrice(reg, a) - vehiclePrice(reg, b))[0]; if (prize) break; }
    console.log(d, t.id, '->', prize?.id ?? null, prize ? purchaseReasons(reg, prize).join('|') : '');
  });
}
