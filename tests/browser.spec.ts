import { test, expect } from '@playwright/test';
const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const forecastFixture = {
 mode: 'historical', model: 'Residual Graph (OD + correlation)', issuedAt: '2025-02-07T23:00:00-05:00',
 historySource: 'Held-out observations', message: 'Historical replay',
 rows: [1,3,6,12,24].flatMap(horizon => [161,132].map(zoneId => ({
  zoneId, horizon, value: zoneId === 161 ? horizon * 10 : 0,
 }))),
};

test('all five horizons render independently of alerts, follow the zone and export dated results', async ({page}) => {
 let releaseAlerts!: () => void;
 const alertsReady = new Promise<void>(resolve => { releaseAlerts = resolve; });
 await page.route('**/api/alerts', async route => {
  await alertsReady;
  await route.fulfill({json:{incidents:[],feeds:[],fetchedAt:'2026-11-25T23:00:00Z'}});
 });
 await page.route('**/api/forecast', route => route.fulfill({json:forecastFixture}));
 await page.goto(baseUrl);
 const panel = page.getByRole('region',{name:'Taxi demand forecast'});
 // The alerts request is deliberately pending: it must not block forecast results.
 await expect(panel.getByRole('status')).toContainText('10 predicted pickups', {timeout:10000});
 releaseAlerts();
 const controls = panel.getByRole('group',{name:'Forecast ahead'});
 for (const horizon of [1,3,6,12,24]) {
  const button = controls.getByRole('button',{name:`${horizon} ${horizon === 1 ? 'hour' : 'hours'}`,exact:true});
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed','true');
  await expect(panel.getByRole('status')).toContainText(`${horizon * 10} predicted pickups`);
 }
 await expect(panel.getByRole('status')).toContainText('Feb 8, 2025, 11:00 PM EST');
 await expect(panel).toContainText('not a forecast for today');
 const downloadReady = page.waitForEvent('download');
 await panel.getByRole('button',{name:'Export forecast'}).click();
 const download = await downloadReady;
 const {readFile} = await import('node:fs/promises');
 const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
 expect(exported.mode).toBe('historical');
 expect(exported.predictions.map((row:{horizon:number})=>row.horizon)).toEqual([1,3,6,12,24]);
 expect(exported.predictions[4]).toEqual({horizon:24,targetHour:'2025-02-09T04:00:00.000Z',pickups:240});
 await page.getByLabel('Choose taxi zone').selectOption('132');
 await expect(panel.getByLabel('Forecast taxi zone')).toHaveValue('132');
 await expect(panel.getByRole('status')).toContainText('0 predicted pickups');
});

test('missing horizons are unavailable and mobile controls fit the viewport', async ({page}) => {
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/alerts',route=>route.fulfill({json:{incidents:[],feeds:[],fetchedAt:''}}));
 await page.route('**/api/forecast',route=>route.fulfill({json:{...forecastFixture,mode:'live',issuedAt:new Date().toISOString(),rows:forecastFixture.rows.filter(row=>row.horizon===1)}}));
 await page.goto(baseUrl);
 const panel=page.getByRole('region',{name:'Taxi demand forecast'});
 await expect(panel.getByRole('status')).toContainText('10 predicted pickups');
 await panel.getByRole('button',{name:'24 hours',exact:true}).click();
 await expect(panel.getByRole('status')).toHaveText('Forecast unavailable for this zone and horizon.');
 await expect(panel).toContainText('Forecast based on recent observed demand.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 for (const hours of [1,3,6,12,24]) await expect(panel.getByRole('button',{name:`${hours} ${hours===1?'hour':'hours'}`,exact:true})).toBeVisible();
});

test('dashboard navigation, map selection, research, fares and source chat',async({page})=>{
 await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'));await expect(page.getByRole('heading',{name:'The city, connected.'})).toBeVisible();
 await page.getByLabel('Choose taxi zone').selectOption('132');await expect(page.getByText('Queens',{exact:true}).last()).toBeVisible();
 await page.getByRole('button',{name:'Research',exact:true}).click();await expect(page.getByRole('heading',{name:'Model comparison'})).toBeVisible();await expect(page.getByText('3.528',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Trip costs',exact:true}).click();await page.getByLabel('Pickup location').selectOption('132');
 await page.getByLabel('Drop-off location').selectOption('161');
 await expect(page.getByRole('combobox')).toHaveCount(2);
 await expect(page.getByText('JFK–Manhattan flat fare',{exact:true})).toBeVisible();
 await expect(page.getByText('$70.00',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Which model performed best?'}).click();await page.getByRole('button',{name:'Send question'}).click();await expect(page.getByText('Retrieved source excerpts',{exact:true})).toBeVisible({timeout:30000});await expect(page.getByRole('link',{name:/Model comparison: best saved results/})).toBeVisible();
 await page.getByRole('button',{name:'Disruptions',exact:false}).first().click();await expect(page.getByRole('heading',{name:'Official disruption reports'})).toBeVisible();
});
test('mobile layout fits viewport and navigation works',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Toggle navigation'}).click();await page.getByRole('button',{name:'Research',exact:true}).click();await expect(page.getByRole('heading',{name:'Graph diagnostics'})).toBeVisible();
});
