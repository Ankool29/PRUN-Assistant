import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { FRESH_WINDOW_MS, freshness, spread, throughput, formatPrice, searchKey } from '../src/domain.ts'

test('écart, prix absents et prix nul', () => {
  assert.equal(spread(10, 12.5), 2.5)
  assert.equal(spread(12, 10), -2)
  assert.equal(spread(null, 3), null)
  assert.equal(spread(0, 0), 0)
  assert.equal(formatPrice(null), '—')
  assert.match(formatPrice(0), /^0,00$/)
})

test('débit nominal en unités par heure', () => {
  assert.equal(throughput(2, 28_800_000), 0.25)
  assert.equal(throughput(0, 3_600_000), 0)
  assert.equal(throughput(3, 0), null)
})

test('frontière de fraîcheur, horodatages absents et horloges divergentes', () => {
  const timestamp = '2026-11-21T10:00:00.000Z'
  const ms = Date.parse(timestamp)
  assert.equal(freshness(timestamp, ms + FRESH_WINDOW_MS), 'fresh')
  assert.equal(freshness(timestamp, ms + FRESH_WINDOW_MS + 1), 'stale')
  assert.equal(freshness(timestamp, ms - 60 * 60_000), 'unknown')
  assert.equal(freshness('invalide', ms), 'unknown')
  assert.equal(freshness(null, ms), 'unknown')
  assert.equal(searchKey(' Éléments  '), 'elements')
})

test('les instantanés distribués ont des sources distinctes', () => {
  const fio = JSON.parse(readFileSync(new URL('../public/data/fio.json', import.meta.url), 'utf8'))
  const demo = JSON.parse(readFileSync(new URL('../data/demo.json', import.meta.url), 'utf8'))
  assert.equal(fio.source, 'fio')
  assert.equal(demo.source, 'demo')
  assert.ok(Number.isFinite(Date.parse(fio.collectedAt)))
  assert.equal(demo.collectedAt, null)
  assert.ok(demo.markets.every(row => row.observedAt === null))
  assert.ok(fio.markets.some(row => row.buys.length || row.sells.length))
})

test('horodatages FIO UTC, décalages et fraction de seconde déterministes', async () => {
  const { quoteTime } = await import('../src/quoteTime.ts')
  const instant = Date.UTC(2026, 10, 21, 19, 31, 22, 922)
  for (const timestamp of ['2026-11-21T19:31:22.922765Z', '2026-11-21T20:31:22.922+01:00',
    '2026-11-21T14:31:22.922-0500', '2026-11-21T19:31:22.922+00:00']) {
    assert.equal(quoteTime(timestamp), instant)
    assert.equal(freshness(timestamp, instant + FRESH_WINDOW_MS), 'fresh')
    assert.equal(freshness(timestamp, instant + FRESH_WINDOW_MS + 1), 'stale')
  }
  for (const invalid of [undefined, null, instant, '2026-11-21', '2026-11-21T19:31:22',
    '2026-02-29T00:00:00Z', '2026-11-21T24:00:00Z', '2026-11-21T19:31:22+10:60', '2026-11-21T19:31:22Z\n']) {
    assert.equal(quoteTime(invalid), null)
  }
  assert.equal(freshness('2026-11-21T19:31:22.922Z', instant - 5 * 60_000 - 1), 'unknown')
})
