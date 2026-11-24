import { test, expect } from '@playwright/test';
test('dashboard navigation, map selection, research, fares and source chat',async({page})=>{
 await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'));await expect(page.getByRole('heading',{name:'The city, connected.'})).toBeVisible();
 await page.getByLabel('Choose taxi zone').selectOption('132');await expect(page.getByText('Queens',{exact:true}).last()).toBeVisible();
 await page.getByRole('button',{name:'Research',exact:true}).click();await expect(page.getByRole('heading',{name:'Model comparison'})).toBeVisible();await expect(page.getByText('3.528',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Trip costs',exact:true}).click();await page.getByLabel('Pickup location').selectOption('132');
 await page.getByLabel('Drop-off location').selectOption('161');
 await expect(page.getByLabel('Leave in').locator('option')).toHaveText(['1 hour','3 hours','6 hours','12 hours','24 hours']);
 await page.getByLabel('Leave in').selectOption('24');
 await page.getByRole('button',{name:'Estimate fare',exact:true}).click();
 await expect(page.getByText('JFK–Manhattan flat fare',{exact:true})).toBeVisible();
 await expect(page.getByText('$70.00',{exact:true})).toBeVisible();
 await page.getByLabel('Leave in').selectOption('12');
 await expect(page.getByText('$70.00',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Which model performed best?'}).click();await page.getByRole('button',{name:'Send question'}).click();await expect(page.getByText('Retrieved source excerpts',{exact:true})).toBeVisible({timeout:30000});await expect(page.getByRole('link',{name:/Model comparison: best saved results/})).toBeVisible();
 await page.getByRole('button',{name:'Disruptions',exact:false}).first().click();await expect(page.getByRole('heading',{name:'Official disruption reports'})).toBeVisible();
});
test('mobile layout fits viewport and navigation works',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Toggle navigation'}).click();await page.getByRole('button',{name:'Research',exact:true}).click();await expect(page.getByRole('heading',{name:'Graph diagnostics'})).toBeVisible();
});
