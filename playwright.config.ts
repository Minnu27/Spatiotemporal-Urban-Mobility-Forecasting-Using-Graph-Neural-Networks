import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'browser.spec.ts',use:{headless:true,launchOptions:{args:['--no-sandbox'],executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined}},timeout:60000,workers:1});
