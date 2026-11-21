import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const snapshot = JSON.parse(readFileSync(new URL('../public/data/fio.json', import.meta.url), 'utf8'))

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  )
}

test('navigation tactile, catalogue FIO et carnet sur le sous-chemin Pages', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible()
  await expect(page.getByText('Collecte du', { exact: false }).first()).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Navigation principale' })
  for (const link of await nav.getByRole('link').all()) {
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  }
  await nav.getByRole('link', { name: 'Marchés' }).tap()
  await expect(page.getByRole('heading', { name: 'Marchés' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Bourse' })).toHaveValue('AI1')
  await page.getByRole('searchbox').fill('aluminium')
  await page.locator('.market-record').filter({ has: page.getByText('AL', { exact: true }) }).locator('summary').tap()
  await expect(page.getByRole('heading', { name: 'Carnet d’ordres', exact: false })).toBeVisible()
  await expect(page.getByText('Dernière transaction')).toBeVisible()
  await expectNoOverflow(page)
  await nav.getByRole('link', { name: 'Matériaux' }).tap()
  await page.getByRole('searchbox').fill('aluminium')
  await expect(page.getByText('AL', { exact: true })).toBeVisible()
  await expectNoOverflow(page)
  await nav.getByRole('link', { name: 'Production' }).tap()
  await page.getByRole('button', { name: 'Bâtiments' }).tap()
  await page.getByRole('searchbox').fill('RIG')
  await page.locator('.record summary').first().tap()
  await expect(page.getByRole('heading', { name: 'Construction' })).toBeVisible()
  await expectNoOverflow(page)
})

test('première panne, absence de substitution, démo explicite et reprise', async ({ page }) => {
  let unavailable = true
  await page.route('**/data/fio.json', route => unavailable ? route.abort('failed') : route.continue())
  await page.goto('./#marches')
  await expect(page.getByText('Données FIO indisponibles.')).toBeVisible()
  await expect(page.getByText('Données fictives', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Démo' }).tap()
  await expect(page.getByText('Données fictives', { exact: true })).toBeVisible()
  await page.getByRole('searchbox').fill('eau')
  const row = page.locator('.market-record')
  await expect(row).toHaveCount(1)
  await expect(row.getByText('—', { exact: true }).first()).toBeVisible()
  await row.locator('summary').tap()
  await expect(page.getByText('Aucun ordre publié.')).toBeVisible()
  await page.getByRole('button', { name: 'Données FIO' }).tap()
  unavailable = false
  await page.getByRole('button', { name: 'Réessayer' }).tap()
  await expect(page.getByRole('combobox', { name: 'Bourse' })).toBeVisible()
  await expect(page.getByText('Données fictives', { exact: true })).toHaveCount(0)
})

test('une panne de rafraîchissement conserve un instantané FIO ancien', async ({ page }) => {
  let unavailable = false
  await page.route('**/data/fio.json', route => unavailable ? route.fulfill({ status: 503 })
    : route.fulfill({ json: { ...snapshot, collectedAt: '2020-01-01T00:00:00Z' } }))
  await page.goto('./')
  await expect(page.getByText('Données FIO anciennes', { exact: true })).toBeVisible()
  unavailable = true
  await page.getByRole('button', { name: 'Actualiser' }).tap()
  await expect(page.getByText('Actualisation impossible. Instantané précédent affiché.')).toBeVisible()
  await expect(page.getByText('Données FIO anciennes', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Antares Station/ })).toBeVisible()
})

test('une réponse de démonstration à la place du flux FIO est rejetée', async ({ page }) => {
  await page.route('**/data/fio.json', route => route.fulfill({ json: { ...snapshot, source: 'demo' } }))
  await page.goto('./')
  await expect(page.getByText('Données FIO indisponibles.')).toBeVisible()
  await expect(page.getByText('Données fictives', { exact: true })).toHaveCount(0)
})
