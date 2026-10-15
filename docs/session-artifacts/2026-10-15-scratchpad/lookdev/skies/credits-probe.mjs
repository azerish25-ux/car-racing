// Open the paddock menu, open CREDITS & LICENCES with the keyboard, screenshot, close with Escape.
import { createRequire } from 'node:module';
const repo = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1';
const need = createRequire(repo + '/package.json');
const { chromium } = need('@playwright/test');
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: false,
  args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForSelector('#menu:not([hidden])', { timeout: 15 * 60 * 1000 });
const button = page.locator('#menu .menu-actions button[data-action="credits"]');
await button.focus();
await page.keyboard.press('Enter');
await page.waitForSelector('#modal[open] #creditsList');
const info = await page.evaluate(() => ({
  focused: document.activeElement?.id,
  items: document.querySelectorAll('#creditsList li').length,
  text: document.querySelector('#creditsList li')?.textContent,
}));
console.log(JSON.stringify(info));
await page.keyboard.press('PageDown');
await page.screenshot({ path: out });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
console.log('modal open after Escape:', await page.evaluate(() => document.querySelector('#modal')?.open));
console.log('errors', JSON.stringify(errors));
await browser.close();
