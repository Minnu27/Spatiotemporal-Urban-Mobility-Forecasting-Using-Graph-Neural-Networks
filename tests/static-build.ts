import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { Page } from '@playwright/test';
import { calculateQuote, findTrip, quoteInput } from '../lib/trip-fare';

// Hydrate the production HTML and real JS/CSS bundles without starting a server.
// APIs are fixtures: these checks verify UI behavior, not external provider uptime.
export async function installStaticBuild(page: Page, origin: string) {
  const root = resolve('.next');
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/alerts') return route.fulfill({json:{incidents:[],feeds:[],fetchedAt:''}});
      if (url.pathname === '/api/forecast') return route.fulfill({json:{mode:'unavailable',rows:[],message:'Browser test fixture'}});
      if (url.pathname === '/api/arrivals') return route.fulfill({json:{state:'unavailable',arrivals:[],feedTimes:[]}});
      if (url.pathname === '/api/account') return route.fulfill({json:{configured:false,authenticated:false}});
      if (url.pathname === '/api/fare') {
        const input = quoteInput.parse(route.request().postDataJSON());
        const trip = findTrip(input.pickup,input.dropoff);
        if (!trip) return route.fulfill({status:400,json:{error:'Invalid test route'}});
        const quote = calculateQuote(input,trip,null,Date.parse('2026-11-25T15:00:00Z'));
        return route.fulfill({json:{...quote,planningMinimum:quote.total,planningMaximum:quote.maximum,
          weather:{state:'unavailable',pickup:null,dropoff:null},
          weatherAdjustment:{state:'unavailable',source:'https://ops.fhwa.dot.gov/weather/roadimpact.htm'},
        }});
      }
      return route.fulfill({status:503,json:{error:'Not configured in this browser test'}});
    }
    const relative = url.pathname.startsWith('/_next/static/')
      ? url.pathname.replace('/_next/','')
      : url.pathname === '/' ? 'server/app/index.html'
      : url.pathname === '/workspace' ? 'server/app/workspace.html' : '';
    const path = resolve(root,relative);
    if (!relative || !path.startsWith(root+sep)) return route.fulfill({status:404,body:'Not found'});
    try {
      const types:Record<string,string> = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json'};
      return route.fulfill({body:await readFile(path),contentType:types[extname(path)]||'application/octet-stream'});
    } catch { return route.fulfill({status:404,body:'Missing build asset'}); }
  });
}
