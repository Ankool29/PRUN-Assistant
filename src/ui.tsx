import type { ReactNode } from 'react'
import { freshness, numeric } from './domain.ts'
import type { Amount, Snapshot } from './data.ts'

export type IconName = 'grid' | 'market' | 'cube' | 'factory' | 'search' | 'chevron' | 'refresh' | 'clock' | 'layers' | 'scanner'

export function Icon({ name, size = 21 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    market: <><path d="M3 3v18h18M6 15l5-5 4 3 6-7"/><path d="M17 6h4v4"/></>,
    cube: <><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5m-9 5v8"/></>,
    factory: <><path d="M3 21V10l6 4V9l6 4V4h4l2 17H3Z"/><path d="M7 17h2m3 0h2m3 0h1"/></>,
    scanner: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></>,
    search: <><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/></>,
    chevron: <path d="m9 6 6 6-6 6"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 8a7 7 0 0 1 12-2l2 6m-16 0 2 6a7 7 0 0 0 12-2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

export function Status({ source, timestamp, now, short = false }: {
  source: Snapshot['source']; timestamp: string | null; now: number; short?: boolean
}) {
  const status = source === 'demo' ? 'demo' : freshness(timestamp, now)
  const full = { demo: 'Données fictives', fresh: 'Données FIO récentes', stale: 'Données FIO anciennes', unknown: 'Fraîcheur indéterminée' }
  const compact = { demo: 'Fictif', fresh: 'Récent', stale: 'Ancien', unknown: 'Indéterminé' }
  return <span className={`status ${status}`}><i aria-hidden="true"/>{(short ? compact : full)[status]}</span>
}

export function Search({ value, onChange, placeholder }: {
  value: string; onChange: (value: string) => void; placeholder: string
}) {
  return <label className="search">
    <Icon name="search" />
    <input type="search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} />
  </label>
}

export function SectionHead({ title, children }: { title: string; children: ReactNode }) {
  return <div className="page-heading"><h1>{title}</h1><p>{children}</p></div>
}

export function Empty({ children = 'Aucun résultat pour ces filtres.' }: { children?: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Amounts({ items }: { items: Amount[] }) {
  if (!items.length) return <span className="muted">—</span>
  return <ul className="amounts">{items.map((item, i) => <li key={`${item.ticker}-${i}`}><b>{numeric(item.quantity)}</b> {item.ticker}</li>)}</ul>
}

export const PAGE_SIZE = 24

export function ShowMore({ shown, total, more }: { shown: number; total: number; more: () => void }) {
  return <div className="pagination">
    <span>{numeric(Math.min(shown, total))} / {numeric(total)}</span>
    {shown < total && <button className="button secondary" onClick={more}>Afficher plus</button>}
  </div>
}
