import { test, expect } from '@playwright/test';
test('dashboard navigation, map selection, research, fares and source chat',async({page})=>{
 await page.goto('http://127.0.0.1:3000');await expect(page.getByRole('heading',{name:'The city, connected.'})).toBeVisible();
 await page.getByLabel('Choose taxi zone').selectOption('132');await expect(page.getByText('Queens',{exact:true}).last()).toBeVisible();
 await page.getByRole('button',{name:'Research',exact:true}).click();await expect(page.getByRole('heading',{name:'Model comparison'})).toBeVisible();await expect(page.getByText('3.528',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Trip costs',exact:true}).click();await expect(page.getByText('$24.25',{exact:true})).toBeVisible();
 await page.getByLabel('Slow or stopped minutes').fill('10');await expect(page.getByText('$27.75',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Which model performed best?'}).click();await page.getByRole('button',{name:'Send question'}).click();await expect(page.getByText('Retrieved source excerpts',{exact:true})).toBeVisible({timeout:30000});
 await page.getByRole('button',{name:'Disruptions',exact:false}).first().click();await expect(page.getByRole('heading',{name:'Official disruption reports'})).toBeVisible();
});
test('mobile layout fits viewport and navigation works',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:3000');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Toggle navigation'}).click();await page.getByRole('button',{name:'Research',exact:true}).click();await expect(page.getByRole('heading',{name:'Graph diagnostics'})).toBeVisible();
});
