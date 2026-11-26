import { test, expect } from '@playwright/test';
const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
test('departure choices appear in Trip costs and refresh the selected route, price and weather', async ({page}) => {
 await page.route('**/api/alerts',route=>route.fulfill({json:{incidents:[],feeds:[],fetchedAt:''}}));
 const requests:number[]=[];
 await page.route('**/api/fare',async route=>{
  const {horizon,pickup,dropoff}=route.request().postDataJSON();requests.push(horizon);
  const departure=new Date(Date.parse('2026-11-25T15:00:00Z')+horizon*3600000).toISOString();
  const hour={zoneId:pickup,zone:'Midtown Center',at:departure,fetchedAt:'2026-11-25T15:00:00Z',temperatureC:12-horizon,precipitationMm:horizon,snowfallCm:0,windKph:12,code:61,condition:'Light rain'};
  await route.fulfill({json:{total:20+horizon,maximum:20+horizon,planningMinimum:20+horizon,planningMaximum:25+horizon,
   departure,basis:'route',breakdown:[{label:'Initial charge',amount:3}],route:{miles:5,minutes:30,traffic:'departure-time'},
   weather:{state:'forecast',departure,source:'https://open-meteo.com/',pickup:hour,dropoff:{...hour,zoneId:dropoff,zone:'JFK Airport'}},
   weatherAdjustment:{state:'applied',source:'https://ops.fhwa.dot.gov/weather/roadimpact.htm',fareMinimum:22+horizon,fareMaximum:25+horizon,minutesMinimum:32,minutesMaximum:35},
  }});
 });
 await page.goto(baseUrl);
 await expect(page.getByRole('heading',{name:'Taxi demand forecast'})).toHaveCount(0);
 await expect(page.getByRole('group',{name:'Departure time'})).toHaveCount(0);
 await page.getByRole('button',{name:'Trip costs',exact:true}).click();
 await page.getByLabel('Pickup location',{exact:true}).selectOption('161');
 await page.getByLabel('Drop-off location',{exact:true}).selectOption('132');
 const total=page.locator('.trip-total');
 await expect(total).toContainText('$21.00');
 for(const hours of [1,3,6,12,24]){
  const button=page.getByRole('button',{name:`${hours} ${hours===1?'hour':'hours'} ahead`,exact:true});
  await button.click();await expect(button).toHaveAttribute('aria-pressed','true');
  await expect(total).toContainText(`$${20+hours}.00`);
  await expect(page.getByRole('heading',{name:'Weather at departure'})).toBeVisible();
  await expect(page.locator('.trip-weather')).toContainText(`Precipitation ${hours.toFixed(1)} mm`);
 }
 expect(requests).toEqual([1,3,6,12,24]);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 for(const hours of [1,3,6,12,24])await expect(page.getByRole('button',{name:`${hours} ${hours===1?'hour':'hours'} ahead`,exact:true})).toBeVisible();
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
