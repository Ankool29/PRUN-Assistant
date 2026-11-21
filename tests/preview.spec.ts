import { expect, test } from '@playwright/test'

test('lien direct vers le scanner, ressources Vite et instantanés FIO au même sous-chemin', async ({ page, baseURL }) => {
  const expectedFio = new URL('data/fio.json', baseURL).href
  const expectedHistory = new URL('data/history.json', baseURL).href
  const marketResponse = page.waitForResponse(response => response.url() === expectedFio)
  await page.goto('./#scanner')

  const response = await marketResponse
  expect(response.ok()).toBeTruthy()
  const market = await response.json()
  expect(market.source).toBe('fio')
  expect(market.markets.length).toBeGreaterThan(0)
  expect(Number.isFinite(Date.parse(market.collectedAt))).toBeTruthy()
  const age = Date.now() - Date.parse(market.collectedAt)
  const freshness = age < -5 * 60_000 ? 'Fraîcheur indéterminée'
    : age <= 3 * 3600_000 ? 'Données FIO récentes' : 'Données FIO anciennes'
  await expect(page.getByRole('status').getByText(freshness)).toBeVisible()
  await expect(page.getByRole('status').getByText(/Collecte du .* UTC/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Scanner commercial' })).toBeVisible()

  const historyResponse = page.waitForResponse(result => result.url() === expectedHistory)
  await page.getByRole('button', { name: 'Spéculation' }).tap()
  const result = await historyResponse
  expect(result.ok()).toBeTruthy()
  const history = await result.json()
  expect(history.source).toBe('fio')
  expect(history.marketCollectedAt).toBe(market.collectedAt)
  await expect(page.getByText(/Historique collecté le .* UTC/)).toBeVisible()
  await expect(page.getByText('Données fictives', { exact: true })).toHaveCount(0)

  const assets = await page.locator('script[type="module"], link[rel="stylesheet"]').evaluateAll(elements =>
    elements.map(element => element instanceof HTMLScriptElement ? element.src : (element as HTMLLinkElement).href),
  )
  expect(assets.length).toBeGreaterThanOrEqual(2)
  expect(assets.every(asset => asset.startsWith(new URL('assets/', baseURL).href))).toBeTruthy()
})
