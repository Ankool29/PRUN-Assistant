import { defineConfig, devices } from '@playwright/test'

const port = 4175
const prefix = process.env.PRUN_TEST_PREFIX ?? '/PRUN-Assistant/'
const hostedUrl = process.env.PRUN_TEST_URL
const baseURL = hostedUrl ?? `http://127.0.0.1:${port}${prefix}`
const portrait = devices['Pixel 7']
const landscape = devices['Pixel 7 landscape']

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
    { name: 'Android portrait', use: portrait },
    { name: 'Android paysage', use: landscape },
  ],
  webServer: hostedUrl ? undefined : {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort --base ${prefix}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
