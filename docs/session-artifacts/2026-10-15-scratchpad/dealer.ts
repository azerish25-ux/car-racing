const W = process.argv[2];
const { newCareer } = await import(`${W}/career/save.ts`);
const { buyVehicle } = await import(`${W}/career/economy.ts`);
const { disciplineEvents } = await import(`${W}/career/ladder.ts`);
const { liveRegistry, disciplineStatus } = await import(`${W}/career/registry.ts`);
const { careerHub } = await import(`${W}/ui/career-hub.ts`);
const reg = liveRegistry();
let save = newCareer(); save.credits = 60000;
const html = careerHub(save, reg, { page: 'dealership', discipline: 'circuit-cars' });
for (const id of ['rcx6', 'rl2', 'eh3']) {
  const m = html.match(new RegExp(`<article class="career-vehicle" data-vehicle="${id}">.*?</article>`));
  console.log(m?.[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}
save = buyVehicle(save, reg, 'rcx6');
console.log('bought rcx6; credits', save.credits, 'off-road status', disciplineStatus(reg, 'off-road').state);
console.log('open off-road events', disciplineEvents(reg, save, 'off-road').filter((e) => e.status === 'open').length);
