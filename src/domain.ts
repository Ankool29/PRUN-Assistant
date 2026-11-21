export const FRESH_WINDOW_MS = 3 * 60 * 60_000
const CLOCK_SKEW_MS = 5 * 60_000

export function freshness(timestamp: string | null, now: number) {
  if (!timestamp) return 'unknown'
  const age = now - Date.parse(timestamp)
  if (!Number.isFinite(age) || age < -CLOCK_SKEW_MS) return 'unknown'
  return age <= FRESH_WINDOW_MS ? 'fresh' : 'stale'
}

export function spread(bid: number | null, ask: number | null) {
  return bid === null || ask === null ? null : ask - bid
}

export function throughput(quantity: number, durationMs: number) {
  return durationMs > 0 ? quantity * (3_600_000 / durationMs) : null
}

export function searchKey(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr').trim()
}

export function displayName(value: string) {
  const spaced = value.replace(/([a-z])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toLocaleUpperCase('fr') + spaced.slice(1)
}

const labels: Record<string, string> = {
  metals: 'Métaux', ores: 'Minerais', liquids: 'Liquides', gases: 'Gaz',
  elements: 'Éléments', minerals: 'Minéraux', 'construction parts': 'Pièces de construction',
  'construction materials': 'Matériaux de construction', chemicals: 'Produits chimiques',
  fuels: 'Carburants', plastics: 'Plastiques', textiles: 'Textiles',
  'agricultural products': 'Produits agricoles', alloys: 'Alliages',
  'construction prefabs': 'Préfabriqués de construction', 'consumable bundles': 'Lots de consommables',
  drones: 'Drones', 'electronic devices': 'Appareils électroniques', 'electronic parts': 'Pièces électroniques',
  'electronic pieces': 'Éléments électroniques', 'electronic systems': 'Systèmes électroniques',
  'energy systems': 'Systèmes énergétiques', infrastructure: 'Infrastructures', 'medical equipment': 'Matériel médical',
  'ship engines': 'Moteurs de vaisseau', 'ship kits': 'Kits de vaisseau', 'ship parts': 'Pièces de vaisseau',
  'ship shields': 'Boucliers de vaisseau', 'software components': 'Composants logiciels',
  'software systems': 'Systèmes logiciels', 'software tools': 'Outils logiciels',
  'unit prefabs': 'Unités préfabriquées', utility: 'Équipements utilitaires',
  'consumables (basic)': 'Consommables de base', 'consumables (luxury)': 'Consommables de luxe',
}
export const categoryLabel = (category: string) => labels[category] ?? displayName(category)

const quantityFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 })
export const numeric = (value: number | null) => value === null ? '—' : quantityFormat.format(value)

const timeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
export const formatTime = (date: string | number | null) => date === null ? '—' : `${timeFormat.format(new Date(date))} UTC`

export function formatPrice(value: number | null, decimals = 2) {
  const places = Math.min(decimals, 8)
  return value === null ? '—' : new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: places, maximumFractionDigits: places,
  }).format(value)
}

export function durationLabel(ms: number) {
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  if (!minutes) return `${numeric(ms / 1000)} s`
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`
}
