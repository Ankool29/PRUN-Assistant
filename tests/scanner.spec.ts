import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const snapshot = JSON.parse(readFileSync(new URL('../public/data/fio.json', import.meta.url), 'utf8'))
const history = JSON.parse(readFileSync(new URL('../public/data/history.json', import.meta.url), 'utf8'))
const dayMs = 86_400_000

test('arbitrage tactile, capital et séparation de la vente future', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Démo' }).tap()
  await page.getByRole('link', { name: 'Scanner commercial' }).tap()
  await expect(page.getByRole('heading', { name: 'Scanner commercial' })).toBeVisible()
  await expect(page.getByText('Données fictives', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Bourse d’achat' }).selectOption('NC1')
  await page.getByRole('combobox', { name: 'Bourse de revente' }).selectOption('NC2')
  await page.getByRole('searchbox').fill('aluminium')
  await page.locator('.scanner-record summary').tap()
  await expect(page.getByRole('heading', { name: 'Vente aux ordres d’achat observés' })).toBeVisible()
  await expect(page.getByRole('row', { name: /14.*1.185,00.*1.350,00/ })).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Capital (NCC)' }).fill('50')
  await expect(page.getByText('Aucun trajet rentable', { exact: false })).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Capital (NCC)' }).fill('100000')
  await page.getByRole('combobox', { name: 'Mode de revente' }).selectOption('limit')
  await page.getByRole('spinbutton', { name: 'Prix limite unitaire (NCC)' }).fill('1550')
  await page.locator('.scanner-record summary').tap()
  await expect(page.getByRole('heading', { name: 'Vente future par ordre limite' })).toBeVisible()
  await expect(page.getByText('Le délai et la quantité exécutée sont inconnus.', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
})

test('scénarios fictifs, références et classement', async ({ page }) => {
  await page.goto('./#scanner')
  await page.getByRole('button', { name: 'Démo' }).tap()
  await page.getByRole('button', { name: 'Spéculation' }).tap()
  await expect(page.getByText('Séries historiques fictives.')).toBeVisible()
  await page.getByRole('combobox', { name: 'Classement' }).selectOption('risk')
  await page.locator('.scanner-record summary').first().tap()
  await expect(page.getByRole('heading', { name: /Référence historique/ })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Pessimiste' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Neutre' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Optimiste' })).toBeVisible()
  await expect(page.locator('details[open]').getByText('Une revente peut ne pas s’exécuter', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
})

test('historique à la demande, erreur et série insuffisante explicites', async ({ page }) => {
  const collectedAt = new Date().toISOString()
  await page.route('**/data/fio.json', route => route.fulfill({ json: { ...snapshot, collectedAt } }))
  await page.route('**/data/history.json', route => route.fulfill({ json: { ...history, series: [], failed: [] } }))
  let offline = true
  await page.route('https://rest.fnar.net/exchange/cxpc/AL.AI1/**', route =>
    offline ? route.abort('failed') : route.fulfill({ json: [{
      Interval: 'DAY_ONE', DateEpochMs: Math.floor(Date.now() / dayMs) * dayMs - dayMs,
      Open: 1000, Close: 1100, Low: 950, High: 1110, Volume: 5500, Traded: 5,
    }], headers: { 'access-control-allow-origin': '*' } }),
  )
  await page.goto('./#scanner')
  await page.getByRole('button', { name: 'Spéculation' }).tap()
  await page.getByRole('combobox', { name: 'Bourse', exact: true }).selectOption('AI1')
  await page.getByRole('searchbox').fill('AL')
  const load = page.getByRole('button', { name: 'Charger l’historique de AL.AI1' })
  await load.tap()
  await expect(page.getByText('Historique FIO indisponible pour AL.AI1.')).toBeVisible()
  offline = false
  await load.tap()
  await expect(page.getByText('Historique AL.AI1 chargé directement depuis FIO.')).toBeVisible()
  await page.getByText('Historiques insuffisants', { exact: true }).tap()
  await expect(page.getByText('Moins de 14 jours négociés.', { exact: false })).toBeVisible()
})

test('un instantané FIO ancien bloque les deux classements', async ({ page }) => {
  await page.route('**/data/fio.json', route => route.fulfill({ json: { ...snapshot, collectedAt: '2020-01-01T00:00:00Z' } }))
  await page.goto('./#scanner')
  await expect(page.getByText('Instantané FIO ancien', { exact: false })).toBeVisible()
  await expect(page.locator('.scanner-record')).toHaveCount(0)
  await page.getByRole('button', { name: 'Spéculation' }).tap()
  await expect(page.getByText('Instantané FIO ancien', { exact: false })).toBeVisible()
  await expect(page.locator('.scanner-record')).toHaveCount(0)
})
