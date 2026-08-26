import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronRight,
  PackagePlus,
  ScanLine,
  Search,
  X,
} from 'lucide-react'
import { fetchDashboard, submitCycleCount, submitMovement } from './lib/api'
import type { CycleCountCommand, Dashboard, InventoryItem, MovementCommand, MovementKind } from './types'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const timestamp = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function balanceFor(item: InventoryItem, locationId: string) {
  return item.balances.find((balance) => balance.locationId === locationId)
}

function movementIcon(kind: MovementKind) {
  if (kind === 'receipt') return <ArrowDownLeft aria-hidden="true" />
  if (kind === 'dispatch') return <ArrowUpRight aria-hidden="true" />
  return <ArrowLeftRight aria-hidden="true" />
}

interface MovementPanelProps {
  dashboard: Dashboard
  onClose: () => void
  onSaved: () => Promise<void>
}

function MovementPanel({ dashboard, onClose, onSaved }: MovementPanelProps) {
  const [kind, setKind] = useState<MovementKind>('transfer')
  const [productId, setProductId] = useState(dashboard.items[0]?.id ?? '')
  const [fromLocationId, setFromLocationId] = useState(dashboard.locations[0]?.id ?? '')
  const [toLocationId, setToLocationId] = useState(dashboard.locations[1]?.id ?? '')
  const [quantity, setQuantity] = useState(6)
  const [reason, setReason] = useState('Rebalance available stock')
  const [actor, setActor] = useState('Hassan Ak')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const item = dashboard.items.find((entry) => entry.id === productId)
  const source = item ? balanceFor(item, fromLocationId) : undefined
  const destination = item ? balanceFor(item, toLocationId) : undefined

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    const command: MovementCommand = {
      kind,
      productId,
      fromLocationId: kind === 'receipt' ? null : fromLocationId,
      toLocationId: kind === 'dispatch' ? null : toLocationId,
      quantity,
      reason,
      actor,
      expectedSourceVersion: kind === 'receipt' ? null : source?.version ?? null,
      expectedDestinationVersion: kind === 'dispatch' ? null : destination?.version ?? null,
    }
    try {
      await submitMovement(command)
      await onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Movement could not be saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <aside className="movement-panel" aria-labelledby="movement-title">
        <header className="panel-header">
          <div><span className="eyebrow">Transaction desk / 01</span><h2 id="movement-title">Record movement</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close movement panel"><X /></button>
        </header>
        <form onSubmit={save}>
          <fieldset className="kind-switcher">
            <legend>Movement type</legend>
            {(['receipt', 'dispatch', 'transfer'] as const).map((value) => (
              <button className={kind === value ? 'active' : ''} type="button" key={value} onClick={() => setKind(value)}>{value}</button>
            ))}
          </fieldset>
          <label>Product<select value={productId} onChange={(event) => setProductId(event.target.value)}>{dashboard.items.map((entry) => <option value={entry.id} key={entry.id}>{entry.sku} — {entry.name}</option>)}</select></label>
          <div className="route-fields">
            {kind !== 'receipt' ? <label>Source<select value={fromLocationId} onChange={(event) => setFromLocationId(event.target.value)}>{dashboard.locations.map((location) => <option value={location.id} key={location.id}>{location.code} — {location.name}</option>)}</select><small>{source?.quantity ?? 0} units available · revision {source?.version ?? '—'}</small></label> : null}
            {kind !== 'dispatch' ? <label>Destination<select value={toLocationId} onChange={(event) => setToLocationId(event.target.value)}>{dashboard.locations.map((location) => <option value={location.id} key={location.id}>{location.code} — {location.name}</option>)}</select><small>{destination?.quantity ?? 0} units on hand · revision {destination?.version ?? '—'}</small></label> : null}
          </div>
          <label>Quantity<input type="number" min="1" max="1000000" required value={quantity} onChange={(event) => setQuantity(event.target.valueAsNumber)} /></label>
          <label>Reason<input required minLength={3} maxLength={180} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <label>Recorded by<input required minLength={2} maxLength={80} value={actor} onChange={(event) => setActor(event.target.value)} /></label>
          <div className="transaction-note"><Check aria-hidden="true" /><p>This movement is committed atomically. Inventory revisions prevent a stale screen from overwriting newer stock.</p></div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="panel-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="commit-button" type="submit" disabled={saving}>{saving ? 'Committing…' : 'Commit movement'}<ChevronRight /></button></div>
        </form>
      </aside>
    </div>
  )
}

function CountPanel({ dashboard, onClose, onSaved }: MovementPanelProps) {
  const initialProduct = dashboard.items[0]
  const initialLocationId = dashboard.locations[0]?.id ?? ''
  const [productId, setProductId] = useState(initialProduct?.id ?? '')
  const [locationId, setLocationId] = useState(initialLocationId)
  const [countedQuantity, setCountedQuantity] = useState(
    initialProduct ? balanceFor(initialProduct, initialLocationId)?.quantity ?? 0 : 0,
  )
  const [reason, setReason] = useState('Scheduled cycle count')
  const [actor, setActor] = useState('Hassan Ak')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const item = dashboard.items.find((entry) => entry.id === productId)
  const balance = item ? balanceFor(item, locationId) : undefined

  const chooseProduct = (nextProductId: string) => {
    setProductId(nextProductId)
    const nextProduct = dashboard.items.find((entry) => entry.id === nextProductId)
    setCountedQuantity(nextProduct ? balanceFor(nextProduct, locationId)?.quantity ?? 0 : 0)
  }

  const chooseLocation = (nextLocationId: string) => {
    setLocationId(nextLocationId)
    setCountedQuantity(item ? balanceFor(item, nextLocationId)?.quantity ?? 0 : 0)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!balance) {
      setError('This product does not have a balance at the selected location')
      return
    }
    setError('')
    setSaving(true)
    const command: CycleCountCommand = {
      productId,
      locationId,
      countedQuantity,
      reason,
      actor,
      expectedVersion: balance.version,
    }
    try {
      await submitCycleCount(command)
      await onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cycle count could not be saved')
    } finally {
      setSaving(false)
    }
  }

  const variance = countedQuantity - (balance?.quantity ?? 0)
  return (
    <div className="panel-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <aside className="movement-panel" aria-labelledby="count-title">
        <header className="panel-header">
          <div><span className="eyebrow">Control desk / 02</span><h2 id="count-title">Reconcile count</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close count panel"><X /></button>
        </header>
        <form onSubmit={save}>
          <label>Product<select value={productId} onChange={(event) => chooseProduct(event.target.value)}>{dashboard.items.map((entry) => <option value={entry.id} key={entry.id}>{entry.sku} — {entry.name}</option>)}</select></label>
          <label>Location<select value={locationId} onChange={(event) => chooseLocation(event.target.value)}>{dashboard.locations.map((location) => <option value={location.id} key={location.id}>{location.code} — {location.name}</option>)}</select><small>System quantity {balance?.quantity ?? 0} · revision {balance?.version ?? '—'}</small></label>
          <label>Counted quantity<input type="number" min="0" max="1000000" required value={countedQuantity} onChange={(event) => setCountedQuantity(event.target.valueAsNumber)} /></label>
          <div className={`variance-preview ${variance < 0 ? 'negative' : variance > 0 ? 'positive' : ''}`}><span>Variance</span><strong>{variance > 0 ? '+' : ''}{variance}</strong><small>{balance?.quantity ?? 0} expected → {countedQuantity} counted</small></div>
          <label>Reason<input required minLength={3} maxLength={180} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <label>Counted by<input required minLength={2} maxLength={80} value={actor} onChange={(event) => setActor(event.target.value)} /></label>
          <div className="transaction-note"><Check aria-hidden="true" /><p>The count and balance revision commit together. The previous quantity and signed variance remain in the audit trail.</p></div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="panel-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="commit-button" type="submit" disabled={saving}>{saving ? 'Reconciling…' : 'Commit count'}<ChevronRight /></button></div>
        </form>
      </aside>
    </div>
  )
}

export default function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'low'>('all')
  const [panel, setPanel] = useState<'movement' | 'count' | null>(null)
  const [error, setError] = useState('')

  const load = async (signal?: AbortSignal) => {
    try {
      setDashboard(await fetchDashboard(signal))
      setError('')
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setError(caught instanceof Error ? caught.message : 'Dashboard could not be loaded')
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const hydrate = async () => {
      try {
        setDashboard(await fetchDashboard(controller.signal))
        setError('')
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        setError(caught instanceof Error ? caught.message : 'Dashboard could not be loaded')
      }
    }
    void hydrate()
    return () => controller.abort()
  }, [])

  const visibleItems = useMemo(() => {
    if (!dashboard) return []
    const normalized = query.trim().toLowerCase()
    return dashboard.items.filter((item) => {
      const matchesQuery = !normalized || `${item.sku} ${item.name}`.toLowerCase().includes(normalized)
      const matchesStatus = status === 'all' || item.status !== 'healthy'
      return matchesQuery && matchesStatus
    })
  }, [dashboard, query, status])

  const activity = useMemo(() => {
    if (!dashboard) return []
    return [
      ...dashboard.movements.map((entry) => ({ type: 'movement' as const, createdAt: entry.createdAt, entry })),
      ...dashboard.cycleCounts.map((entry) => ({ type: 'count' as const, createdAt: entry.createdAt, entry })),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 40)
  }, [dashboard])

  if (!dashboard) {
    return <main className="loading-state"><Boxes aria-hidden="true" /><h1>Stockroom Ledger</h1><p>{error || 'Reading the inventory ledger…'}</p><button type="button" onClick={() => void load()}>Retry</button></main>
  }

  const healthy = dashboard.items.length - dashboard.metrics.lowStockItems
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Stockroom Ledger home"><span className="brand-grid" aria-hidden="true"><i /><i /><i /><i /></span><strong>Stockroom<br />Ledger</strong></a>
        <div className="topbar-meta"><span><i /> ledger online</span><a href="/docs" target="_blank">API reference ↗</a><a href="https://github.com/kyan9400/stockroom-ledger" target="_blank" rel="noreferrer">Source ↗</a></div>
      </header>
      <div className="sandbox-banner" role="note"><strong>Public sandbox</strong><span>Seeded demo data can reset when the Vercel instance scales down. The Docker deployment uses durable storage.</span></div>

      <main>
        <section className="manifest">
          <div className="manifest-copy"><span className="eyebrow">Inventory operations / live ledger</span><h1>Every unit.<br /><em>Accounted for.</em></h1><p>Receive, dispatch, transfer, and reconcile stock with transactional guarantees and a complete control trail.</p><div className="manifest-actions"><button className="manifest-action" type="button" onClick={() => setPanel('movement')}><PackagePlus />New movement</button><button className="manifest-action secondary" type="button" onClick={() => setPanel('count')}><ScanLine />Reconcile count</button></div></div>
          <div className="manifest-number"><strong>{dashboard.metrics.totalUnits}</strong><span>units on hand<br />across {dashboard.items.length} tracked SKUs</span><div className="barcode" aria-hidden="true" /></div>
          <dl className="metric-rack"><div><dt>Inventory value</dt><dd>{money.format(dashboard.metrics.inventoryValueCents / 100)}</dd></div><div><dt>Stock health</dt><dd>{healthy}/{dashboard.items.length}</dd><small>SKUs above reorder point</small></div><div className={dashboard.metrics.lowStockItems ? 'warning' : ''}><dt>Requires action</dt><dd>{dashboard.metrics.lowStockItems}</dd><small>low-stock lines</small></div></dl>
        </section>

        <section className="workspace">
          <div className="inventory-area" id="inventory">
            <header className="section-head"><div><span className="section-index">01</span><div><span className="eyebrow">Current position</span><h2>Inventory by location</h2></div></div><p>Snapshot {timestamp.format(new Date(dashboard.generatedAt))}</p></header>
            <div className="inventory-tools"><label className="search-field"><Search aria-hidden="true" /><span className="visually-hidden">Search inventory</span><input placeholder="Search SKU or product" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="status-filter" aria-label="Stock filter"><button type="button" className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>All stock</button><button type="button" className={status === 'low' ? 'active' : ''} onClick={() => setStatus('low')}>Needs action</button></div></div>
            <div className="inventory-table" role="table" aria-label="Inventory balances">
              <div className="inventory-row table-heading" role="row"><span role="columnheader">Product</span>{dashboard.locations.map((location) => <span role="columnheader" key={location.id}>{location.code}</span>)}<span role="columnheader">Total / state</span></div>
              {visibleItems.map((item, index) => <div className="inventory-row" role="row" key={item.id}><div className="product-cell" role="cell"><span className="row-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.name}</strong><small>{item.sku} · reorder at {item.reorderPoint}</small></div></div>{dashboard.locations.map((location) => { const balance = balanceFor(item, location.id); return <div className="balance-cell" role="cell" key={location.id}><strong>{balance?.quantity ?? 0}</strong><small>rev {balance?.version ?? '—'}</small></div> })}<div className={`total-cell ${item.status}`} role="cell"><strong>{item.totalQuantity}</strong><span>{item.status === 'healthy' ? 'in range' : item.status === 'low' ? 'reorder' : 'out'}</span></div></div>)}
              {!visibleItems.length ? <p className="no-results">No inventory lines match this view.</p> : null}
            </div>
          </div>

          <aside className="ledger-area" aria-labelledby="ledger-title">
            <header className="ledger-head"><span className="section-index">02</span><div><span className="eyebrow">Immutable trail</span><h2 id="ledger-title">Control ledger</h2></div><span className="ledger-count">{activity.length}</span></header>
            <div className="movement-list">{activity.length ? activity.map((activityItem) => activityItem.type === 'movement' ? <article className="movement" key={activityItem.entry.id}><div className={`movement-icon ${activityItem.entry.kind}`}>{movementIcon(activityItem.entry.kind)}</div><div><header><strong>{activityItem.entry.productName}</strong><time dateTime={activityItem.entry.createdAt}>{timestamp.format(new Date(activityItem.entry.createdAt))}</time></header><p><b>{activityItem.entry.quantity}</b> units · {activityItem.entry.fromLocationName ? `${activityItem.entry.fromLocationName} → ` : ''}{activityItem.entry.toLocationName ?? 'dispatched'}</p><small>{activityItem.entry.reason} · {activityItem.entry.actor}</small></div></article> : <article className="movement" key={activityItem.entry.id}><div className="movement-icon count"><ScanLine aria-hidden="true" /></div><div><header><strong>{activityItem.entry.productName}</strong><time dateTime={activityItem.entry.createdAt}>{timestamp.format(new Date(activityItem.entry.createdAt))}</time></header><p><b>{activityItem.entry.variance > 0 ? '+' : ''}{activityItem.entry.variance}</b> variance · {activityItem.entry.locationName}</p><small>{activityItem.entry.previousQuantity} expected → {activityItem.entry.countedQuantity} counted · {activityItem.entry.actor}</small></div></article>) : <div className="empty-ledger"><ArrowLeftRight /><strong>No activity yet</strong><p>The first committed movement or count will appear here.</p></div>}</div>
            <footer><span>Atomic writes</span><span>Idempotent API</span><span>Version checks</span><span>Audited counts</span></footer>
          </aside>
        </section>
      </main>
      {error ? <div className="global-error" role="alert">{error}</div> : null}
      {panel === 'movement' ? <MovementPanel dashboard={dashboard} onClose={() => setPanel(null)} onSaved={() => load()} /> : null}
      {panel === 'count' ? <CountPanel dashboard={dashboard} onClose={() => setPanel(null)} onSaved={() => load()} /> : null}
    </div>
  )
}
