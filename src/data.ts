import { staticDataUrl } from './staticData.ts'
import { z } from 'zod'
import demoData from '../data/demo.json'

const number = z.number().finite().nonnegative()
const integer = number.int().safe()
const date = z.string().datetime({ offset: true })
const text = z.string().min(1)
const amount = z.object({ ticker: text, quantity: integer })
const order = z.object({ price: number, quantity: integer.nullable() })

export const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.enum(['fio', 'demo']),
  collectedAt: date.nullable(),
  materials: z.array(z.object({ ticker: text, name: text, category: text, weight: number, volume: number })).nonempty(),
  exchanges: z.array(z.object({ code: text, name: text, station: text, currency: text, decimals: integer })).nonempty(),
  markets: z.array(z.object({
    ticker: text, exchange: text, currency: text, observedAt: date.nullable(),
    lastTradeAtMs: integer.max(8.64e15).nullable(),
    bid: number.nullable(), ask: number.nullable(), last: number.nullable(), average: number.nullable(),
    marketMakerBuy: number.nullable(), marketMakerSell: number.nullable(),
    supply: integer, demand: integer, buys: z.array(order), sells: z.array(order),
  })).nonempty(),
  buildings: z.array(z.object({
    ticker: text, name: text, expertise: text.nullable(), area: number, construction: z.array(amount),
    workforce: z.object({ pioneers: integer, settlers: integer, technicians: integer, engineers: integer, scientists: integer }),
  })).nonempty(),
  recipes: z.array(z.object({
    id: text, name: text, building: text, durationMs: integer.positive(),
    inputs: z.array(amount), outputs: z.array(amount),
  })).nonempty(),
}).superRefine((value, context) => {
  if (value.source === 'fio' && (!value.collectedAt || value.markets.some(row => !row.observedAt))) {
    context.addIssue({ code: 'custom', message: 'Horodatage FIO absent' })
  }
})

export type Snapshot = z.infer<typeof snapshotSchema>
export type Market = Snapshot['markets'][number]
export type Recipe = Snapshot['recipes'][number]
export type Amount = Recipe['inputs'][number]
export type Exchange = Snapshot['exchanges'][number]
export type Order = Market['buys'][number]
export const demo = snapshotSchema.parse(demoData)

export async function loadFio(signal: AbortSignal): Promise<Snapshot> {
  const response = await fetch(staticDataUrl('fio.json'), { signal, cache: 'no-cache' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const snapshot = snapshotSchema.parse(await response.json())
  if (snapshot.source !== 'fio') throw new Error('Source FIO attendue')
  return snapshot
}
