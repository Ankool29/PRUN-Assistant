import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { Snapshot } from '../data.ts'
import { emptyNavigation, shipNavigationSchema } from './navigation.ts'

const tariffForm = z.object({
  emptyFixed: z.string(),
  loadedFixed: z.string(),
  loadedUnit: z.string(),
})
export const unknownTariffs = { emptyFixed: '', loadedFixed: '', loadedUnit: '' }
export type TariffForm = z.infer<typeof tariffForm>

const ship = z.object({
  id: z.number().int().positive().safe(),
  name: z.string().max(40),
  parking: z.string(),
  byCurrency: z.record(tariffForm),
  navigation: shipNavigationSchema.default(emptyNavigation),
})
const fleetSchema = z.object({ selected: z.number(), ships: z.array(ship).min(1) }).refine(fleet =>
  new Set(fleet.ships.map(item => item.id)).size === fleet.ships.length
  && fleet.ships.some(item => item.id === fleet.selected),
)
type Ship = z.infer<typeof ship>

function loadFleet(key: string, demo: boolean): z.infer<typeof fleetSchema> {
  try {
    const stored = localStorage.getItem(key)
    if (stored) return fleetSchema.parse(JSON.parse(stored))
  } catch {
    // Le scanner fonctionne aussi lorsque le navigateur bloque le stockage local.
  }
  return { selected: 1, ships: [{
    id: 1, name: demo ? 'Vaisseau de démonstration' : 'Vaisseau 1',
    parking: demo ? 'NC1' : '', navigation: emptyNavigation,
    byCurrency: demo ? { NCC: { emptyFixed: '40', loadedFixed: '20', loadedUnit: '1' } } : {},
  }] }
}

export function useShipProfiles(source: Snapshot['source']) {
  const key = `prun.scanner.ships.${source}.v1`
  const [fleet, setFleet] = useState(() => loadFleet(key, source === 'demo'))
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(fleet))
    } catch {
      // Les profils restent utilisables en mémoire.
    }
  }, [key, fleet])

  return {
    ships: fleet.ships,
    current: fleet.ships.find(item => item.id === fleet.selected)!,
    select: (id: number) => setFleet(previous => ({ ...previous, selected: id })),
    update: (edit: (current: Ship) => Ship) => setFleet(previous => ({
      ...previous, ships: previous.ships.map(item => item.id === previous.selected ? edit(item) : item),
    })),
    add: () => setFleet(previous => {
      const id = Math.max(...previous.ships.map(item => item.id)) + 1
      return { selected: id, ships: [...previous.ships, { id, name: `Vaisseau ${id}`, parking: '', byCurrency: {}, navigation: emptyNavigation }] }
    }),
  }
}
