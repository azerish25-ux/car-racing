src = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/showcase/showcase.mjs'
dst = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/lookdev/vegetation/festtrees.mjs'
s = open(src).read()
fn = r'''
/** Vegetation look-dev: festival countryside. Seeds the saved festival
 * progress with discovered events (IndexedDB, the app's own save), then fast
 * travels to each and shoots the chase view after the tiles stream in. */
async function festtrees() {
  const { festivalDefaultVehicle } = await import(pathToFileURL(join(repo, 'src/simulation/open-world/session.ts')).href);
  const targets = (process.env.FEST_TARGETS || 'thornwood-rally,valley-sprint,coast-trap').split(',');
  await toPaddock();
  await ensurePreset();
  await page.evaluate(
    ({ discovered, vehicle }) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('apex-formula', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('saved');
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction('saved', 'readwrite');
          tx.objectStore('saved').put({ version: 1, discovered, best: {}, vehicle }, 'festival:v1');
          tx.oncomplete = () => {
            r.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { discovered: targets, vehicle: festivalDefaultVehicle() },
  );
  log('session: festival trees, discovered', targets.join(','));
  await page.locator('#mode').selectOption('festival', { force: true });
  await click(page.getByRole('button', { name: /ENTER CIRCUIT/ }));
  await page.locator('#festMenu').waitFor({ state: 'attached', timeout: LONG });
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: LONG });
  log('festival loaded');
  await sleep(5000);
  const openMenu = async () => {
    await page.keyboard.press('Escape');
    await page.locator('#festMenu').waitFor({ state: 'visible' });
  };
  let i = 0;
  for (const id of targets) {
    i++;
    await attempt(`13-${i}`, async () => {
      if (!(await page.locator('#festMenu').isVisible())) await openMenu();
      const button = page.locator(`#festMenu [data-fest=travel][data-value="${id}"]`);
      if (!(await button.count())) throw new Error(`no travel button for ${id}`);
      await click(button);
      log(`travelling to ${id}`);
      await sleep(4000);
      await page.locator('#loading').waitFor({ state: 'hidden', timeout: LONG });
      await sleep(Number(process.env.FEST_SETTLE || 50000));
      await openMenu();
      await sleep(15000);
      await shoot('13', `festival-trees-${i}-${id}`, `festival fast travel to ${id}, chase camera, menu hidden for the capture`, { festival: true });
    });
  }
  await attempt('festival-exit', async () => {
    if (!(await page.locator('#festMenu').isVisible())) await openMenu();
    await click('#festMenu [data-fest=exit]');
    await waitState('menu', 5 * 60 * 1000);
  });
}
'''
anchor = 'const RUNS = { menu: menuShots, bikes, pack, truck, neon, hochwald, festival, valley, arena, kestrel };'
assert anchor in s
s = s.replace(anchor, fn + '\nconst RUNS = { menu: menuShots, bikes, pack, truck, neon, hochwald, festival, valley, arena, kestrel, festtrees };')
open(dst, 'w').write(s)
print('ok')
