import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const snapshot = JSON.parse(readFileSync(new URL('../public/data/fio.json', import.meta.url), 'utf8'))

test('diagnostic et tarification SFC sur Android, du bénéfice inconnu au déficit puis au net calculé', async ({ page }) => {
  const now = new Date().toISOString()
  function market(ticker: string, exchange: string, buys: unknown[], sells: unknown[]) {
    const source = snapshot.markets.find(row => row.ticker === ticker && row.exchange === exchange)
    return { ...source, ticker, exchange, currency: 'CIS', buys, sells, observedAt: now, average: null, last: null }
  }
  const markets = [
    market('AL', 'CI2', [], [{ price: 100, quantity: 10 }]),
    market('AL', 'CI1', [{ price: 200, quantity: 10 }], []),
    market('SF', 'CI2', [], [{ price: 3, quantity: 5 }, { price: 4, quantity: 5 }]),
    market('FF', 'CI2', [], [{ price: 10, quantity: 4 }]),
  ]
  await page.route('**/data/fio.json', route => route.fulfill({ json: { ...snapshot, markets, collectedAt: now } }))
  await page.goto('./#scanner')
  await page.getByRole('combobox', { name: 'Marché de stationnement' }).selectOption('CI2')
  await page.getByRole('searchbox').fill('aluminium')
  await page.getByRole('combobox', { name: 'Bourse de revente' }).selectOption('CI1')

  const verification = page.getByRole('region', { name: 'Opportunités à vérifier' })
  await verification.locator('summary').tap()
  await expect(verification.getByText('970,00 CIS', { exact: true })).toBeVisible()
  await expect(verification.getByText(/Bénéfice net indéterminé/)).toBeVisible()
  await expect(verification.getByText(/Relevé SFC chargé absent/)).toBeVisible()
  await expect(verification.getByText(/10 sauts/).first()).toBeVisible()
  await page.getByText(/Diagnostic ·/).tap()
  await expect(page.getByText('Transport à vérifier', { exact: false })).toBeVisible()

  await page.getByText('Frais, transport, quantités et change', { exact: true }).tap()
  const fixedCost = page.getByRole('spinbutton', { name: 'Trajet chargé, montant fixe (CIS)' })
  await fixedCost.fill('1000')
  await page.getByRole('spinbutton', { name: 'Trajet chargé, par unité (CIS)' }).fill('0')
  const deficit = page.getByRole('region', { name: 'Opportunités déficitaires' })
  await expect(deficit.getByText('-30,00 CIS', { exact: true })).toBeVisible()
  await fixedCost.fill('')

  await page.getByText(/Navigation et carburant ·/).tap()
  await page.getByRole('textbox', { name: 'Moteur STL' }).fill('Moteur de test')
  await page.getByRole('textbox', { name: 'Moteur ou réacteur FTL' }).fill('Réacteur de test')
  for (const [name, value] of [
    ['Masse à vide (t)', '500'], ['Capacité de fret restante (t)', '1000'],
    ['Capacité de fret restante (m³)', '1000'], ['Réservoir SF (unités)', '100'],
    ['Réservoir FF (unités)', '100'], ['Quantité du fret (0 à vide)', '10'],
    ['Durée SFC (minutes)', '120'], ['Carburant SF (unités)', '10'],
    ['Carburant FF (unités)', '4'], ['Distance FTL SFC (pc, facultatif)', '71'],
    ['Autres frais et péages', '11'],
  ]) await page.getByRole('spinbutton', { name, exact: true }).fill(value)
  await page.getByRole('combobox', { name: 'Arrivée du relevé' }).selectOption('CI1')
  await page.getByRole('textbox', { name: 'Ticker du fret' }).fill('AL')
  await page.getByRole('button', { name: 'Enregistrer le relevé SFC' }).tap()
  const profitable = page.getByRole('region', { name: 'Opportunités depuis mon marché' })
  await profitable.locator('summary').tap()
  await expect(profitable.getByText('883,25 CIS', { exact: true }).first()).toBeVisible()
  await expect(profitable.getByText(/Durée cumulée SFC · 120 min/)).toBeVisible()
  await expect(profitable.getByText(/10 SF · 35,35 CIS/)).toBeVisible()
  await expect(profitable.getByText(/4 FF · 40,40 CIS/)).toBeVisible()
  await expect(profitable.getByText(/71 pc FTL/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
})
