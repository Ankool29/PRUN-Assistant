import { defineConfig, devices } from '@playwright/test'

const port = 4175
const baseURL = `http://127.0.0.1:${port}/PRUN-Assistant/`
const device = devices['iPhone 13']

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.PRUN_CHROMIUM_EXECUTABLE },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'Téléphone portrait', use: { ...device, defaultBrowserType: 'chromium' } },
    { name: 'Téléphone paysage', use: { ...device, defaultBrowserType: 'chromium', viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } } },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort --base /PRUN-Assistant/`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
