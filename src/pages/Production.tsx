import { useState } from 'react'
import type { Recipe, Snapshot } from '../data.ts'
import { displayName, durationLabel, numeric, searchKey, throughput } from '../domain.ts'
import { Amounts, Empty, Icon, PAGE_SIZE, Search, SectionHead, ShowMore } from '../ui.tsx'

const specialties: Record<string, string> = {
  AGRICULTURE: 'Agriculture', CHEMISTRY: 'Chimie', CONSTRUCTION: 'Construction',
  ELECTRONICS: 'Électronique', FOOD_INDUSTRIES: 'Industrie alimentaire', FUEL_REFINING: 'Raffinage',
  MANUFACTURING: 'Fabrication', METALLURGY: 'Métallurgie', RESOURCE_EXTRACTION: 'Extraction',
}

function BuildingDetails({ building }: { building: Snapshot['buildings'][number] }) {
  const labels = { pioneers: 'Pionniers', settlers: 'Colons', technicians: 'Techniciens', engineers: 'Ingénieurs', scientists: 'Scientifiques' }
  return <details className="record">
    <summary><span className="record-label"><span className="ticker">{building.ticker}</span><strong>{displayName(building.name)}</strong></span>
      <span className="muted">{numeric(building.area)} de surface</span>
    </summary>
    <div className="record-body">
      {building.expertise && <p className="muted">{specialties[building.expertise] ?? building.expertise}</p>}
      <h3>Construction</h3><Amounts items={building.construction}/>
      <h3>Main-d’œuvre</h3>
      <dl className="facts">{Object.entries(building.workforce).map(([key, count]) => <div key={key}><dt>{labels[key as keyof typeof labels]}</dt><dd>{numeric(count)}</dd></div>)}</dl>
    </div>
  </details>
}

function RecipeDetails({ recipe, names }: { recipe: Recipe; names: Map<string, string> }) {
  const title = recipe.outputs.length ? recipe.outputs.map(item => displayName(names.get(item.ticker) ?? item.ticker)).join(' / ')
    : 'Recette sans flux détaillé'
  return <details className="record">
    <summary><span className="record-label"><span className="ticker">{recipe.building}</span><strong>{title}</strong></span>
      <span className="time"><Icon name="clock" size={16}/>{durationLabel(recipe.durationMs)}</span>
    </summary>
    <div className="record-body">
      <p className="mono muted recipe-id">{recipe.id}</p>
      {!recipe.inputs.length && !recipe.outputs.length && <p>FIO ne fournit aucun flux pour cette recette. Pour certaines extractions, le rendement dépend du site.</p>}
      <div className="recipe-flow">
        <div><h3>Intrants</h3><Amounts items={recipe.inputs}/></div>
        <div><h3>Extrants</h3><Amounts items={recipe.outputs}/></div>
      </div>
      {!!recipe.outputs.length && <div className="recipe-rate"><h3>Production nominale par heure</h3>
        <ul className="amounts">{recipe.outputs.map((item, i) => <li key={i}><b>{numeric(throughput(item.quantity, recipe.durationMs))}</b> {item.ticker}/h</li>)}</ul>
      </div>}
    </div>
  </details>
}

export function Production({ data }: { data: Snapshot }) {
  const [building, setBuilding] = useState('')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'recipes' | 'buildings'>('recipes')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const term = searchKey(query)
  const names = new Map(data.materials.map(item => [item.ticker, item.name]))
  const buildings = data.buildings.filter(item => searchKey(`${item.ticker} ${displayName(item.name)}`).includes(term))
  const recipes = data.recipes.filter(item => (!building || item.building === building) &&
    searchKey([item.id, item.name, ...item.inputs.concat(item.outputs).map(part => displayName(names.get(part.ticker) ?? ''))].join(' ')).includes(term))
  const total = view === 'recipes' ? recipes.length : buildings.length
  return <>
    <SectionHead title="Production">Consultez les bâtiments, les recettes et leurs débits nominaux.</SectionHead>
    <div className="switch" role="group" aria-label="Catalogue de production">
      <button aria-pressed={view === 'recipes'} onClick={() => {setView('recipes'); setQuery(''); setLimit(PAGE_SIZE)}}>Recettes</button>
      <button aria-pressed={view === 'buildings'} onClick={() => {setView('buildings'); setQuery(''); setLimit(PAGE_SIZE)}}>Bâtiments</button>
    </div>
    <div className="filters">
      {view === 'recipes' && <label className="field"><span>Bâtiment</span><select value={building} onChange={event => {setBuilding(event.target.value); setLimit(PAGE_SIZE)}}>
        <option value="">Tous les bâtiments</option>
        {data.buildings.map(item => <option key={item.ticker} value={item.ticker}>{item.ticker} · {displayName(item.name)}</option>)}
      </select></label>}
      <Search value={query} onChange={value => {setQuery(value); setLimit(PAGE_SIZE)}} placeholder={view === 'recipes' ? 'Rechercher une recette' : 'Rechercher un bâtiment'}/>
    </div>
    {total ? <div className="records">{view === 'recipes'
      ? recipes.slice(0, limit).map(item => <RecipeDetails key={item.id} recipe={item} names={names}/>)
      : buildings.slice(0, limit).map(item => <BuildingDetails key={item.ticker} building={item}/>)}</div> : <Empty/>}
    <ShowMore shown={limit} total={total} more={() => setLimit(limit + PAGE_SIZE)}/>
  </>
}
