import { useState } from 'react'
import type { Snapshot } from '../data.ts'
import { categoryLabel, displayName, numeric, searchKey } from '../domain.ts'
import { Empty, PAGE_SIZE, Search, SectionHead, ShowMore } from '../ui.tsx'

export function Materials({ data }: { data: Snapshot }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const categories = [...new Set(data.materials.map(item => item.category))]
    .sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), 'fr'))
  const term = searchKey(query)
  const materials = data.materials.filter(item => (!category || item.category === category) &&
    searchKey(`${item.ticker} ${displayName(item.name)} ${categoryLabel(item.category)}`).includes(term))
  return <>
    <SectionHead title="Matériaux">Recherchez une ressource, sa catégorie et ses dimensions dans le jeu.</SectionHead>
    <div className="filters">
      <label className="field"><span>Catégorie</span><select value={category} onChange={event => {setCategory(event.target.value); setLimit(PAGE_SIZE)}}>
        <option value="">Toutes les catégories</option>
        {categories.map(value => <option key={value} value={value}>{categoryLabel(value)}</option>)}
      </select></label>
      <Search value={query} onChange={value => {setQuery(value); setLimit(PAGE_SIZE)}} placeholder="Rechercher un matériau"/>
    </div>
    {materials.length ? <ul className="records material-list">{materials.slice(0, limit).map(item => <li className="record material" key={item.ticker}>
      <div className="record-label"><span className="ticker">{item.ticker}</span><div><strong>{displayName(item.name)}</strong><small>{categoryLabel(item.category)}</small></div></div>
      <div className="record-prices"><span><small>Masse</small><b>{numeric(item.weight)} t</b></span><span><small>Volume</small><b>{numeric(item.volume)} m³</b></span></div>
    </li>)}</ul> : <Empty/>}
    <ShowMore shown={limit} total={materials.length} more={() => setLimit(limit + PAGE_SIZE)}/>
  </>
}
