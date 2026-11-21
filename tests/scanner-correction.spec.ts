import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const snapshot = JSON.parse(readFileSync(new URL('../public/data/fio.json', import.meta.url), 'utf8'))

async function installBooks(page: Page) {
  const now = new Date()
  const observedAt = now.toISOString()
  const localTime = new Date(now.getTime() + 3600_000).toISOString().replace('Z', '+01:00')
  const old = new Date(now.getTime() - 4 * 3600_000).toISOString()
  const tuples = [
    ['AI1', 'AIC', observedAt, 80, 70],
    ['CI1', 'CIS', localTime, 100, 90],
    ['CI2', 'CIS', observedAt, 220, 200],
    ['NC1', 'NCC', old, 50, 400],
    ['NC2', 'NCC', '2026-11-21T19:31:22', 55, 450],
    ['IC1', 'ICA', undefined, 60, 500],
  ] as const
  const markets = tuples.map(([exchange, currency, time, ask, bid]) => ({
    ...snapshot.markets.find(row => row.ticker === 'AL' && row.exchange === exchange),
    ticker: 'AL', exchange, currency, observedAt: time, bid, ask, average: null, last: null,
    buys: [{ price: bid, quantity: 20 }], sells: [{ price: ask, quantity: 20 }],
  }))
  await page.route('**/data/fio.json', route => route.fulfill({
    json: { ...snapshot, markets, collectedAt: now.toISOString() },
  }))
  await page.goto('./#scanner')
  await page.getByRole('combobox', { name: 'Marché de stationnement' }).selectOption('AI1')
  await page.getByRole('button', { name: 'Toutes les bourses' }).tap()
}

test('écarts CIS sans conversion AIC et étapes distinctes jusqu’au capital en devise locale', async ({ page }) => {
  await installBooks(page)
  await page.getByText(/Diagnostic ·/).tap()
  const stages = page.getByLabel('Comparaisons franchissant chaque filtre')
  await expect(stages.getByText('Comparaisons de matériaux', { exact: true }).locator('..')).toHaveText(/30/)
  await expect(stages.getByText('Deux carnets récents', { exact: true }).locator('..')).toHaveText(/6/)
  await expect(stages.getByText('Prix comparables dans une même devise', { exact: true }).locator('..')).toHaveText(/2/)
  await expect(stages.getByText('Soumises au calcul commercial', { exact: true }).locator('..')).toHaveText(/0/)
  await page.getByRole('button', { name: 'Voir les prix bruts' }).tap()
  const raw = page.getByRole('region', { name: 'Écarts de prix bruts' })
  await raw.getByRole('combobox', { name: 'Filtrer les prix bruts' }).selectOption('native')
  const pair = raw.locator('details').filter({ has: page.getByText('CI1 vers CI2', { exact: true }) })
  await pair.locator('summary').tap()
  await expect(pair.getByText('100,00 CIS', { exact: true }).first()).toBeVisible()
  await expect(pair.getByText(/Marge de marché locale après frais/)).toBeVisible()
  await pair.getByRole('button', { name: 'Évaluer en CIS' }).tap()
  const capital = page.getByRole('spinbutton', { name: 'Capital (CIS)' })
  await expect(capital).toHaveValue('')
  await capital.fill('100000')
  await expect(stages.getByText('Soumises au calcul commercial', { exact: true }).locator('..')).toHaveText(/2/)
  await expect(stages.getByText('Net affichable, positif ou déficitaire', { exact: true }).locator('..')).toHaveText(/0/)
  await expect(page.getByRole('region', { name: 'Opportunités à vérifier' }).getByText('CI1 vers CI2', { exact: true })).toBeVisible()
})

test('devises distinctes et dates absentes restent consultables, le change saisi est mémorisé', async ({ page }) => {
  await installBooks(page)
  const raw = page.getByRole('region', { name: 'Écarts de prix bruts' })
  const filter = raw.getByRole('combobox', { name: 'Filtrer les prix bruts' })
  await filter.selectOption('fx')
  const mixed = raw.locator('details').filter({ has: page.getByText('AI1 vers CI2', { exact: true }) })
  await mixed.locator('summary').tap()
  await expect(mixed.getByText('80,00 AIC', { exact: true })).toBeVisible()
  await expect(mixed.getByText('200,00 CIS', { exact: true })).toBeVisible()
  await expect(mixed.getByText(/Écart monétaire et bénéfice net indéterminés/)).toBeVisible()
  await filter.selectOption('old')
  const unknown = raw.locator('details').filter({ has: page.getByText('CI1 vers NC2', { exact: true }) })
  await unknown.locator('summary').tap()
  await expect(unknown.getByText('Indéterminé', { exact: true })).toBeVisible()
  await expect(unknown.getByText(/Comparaison financière suspendue/)).toBeVisible()

  await page.getByText(/Taux de change APEX ·/).tap()
  await page.getByRole('spinbutton', { name: '1 CIS en AIC' }).fill('1.25')
  await page.reload()
  await page.getByText(/Taux de change APEX ·/).tap()
  await expect(page.getByRole('spinbutton', { name: '1 CIS en AIC' })).toHaveValue('1.25')
})
