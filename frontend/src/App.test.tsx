import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Dashboard } from './types'

const dashboard: Dashboard = {
  generatedAt: '2026-08-26T06:00:00Z',
  metrics: { totalUnits: 51, inventoryValueCents: 657900, lowStockItems: 0, movementsToday: 0 },
  locations: [
    { id: 'loc-north', code: 'NTH-01', name: 'North warehouse' },
    { id: 'loc-retail', code: 'RTL-03', name: 'Retail floor' },
  ],
  items: [{
    id: 'prd-lamp', sku: 'LMP-ARC-01', name: 'Arc task lamp', unit: 'units',
    reorderPoint: 30, unitCostCents: 12900, totalQuantity: 51, status: 'healthy',
    balances: [
      { locationId: 'loc-north', quantity: 42, version: 1 },
      { locationId: 'loc-retail', quantity: 9, version: 1 },
    ],
  }],
  movements: [],
  cycleCounts: [],
}

describe('Stockroom Ledger', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(dashboard), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the inventory snapshot', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: /every unit/i })).toBeInTheDocument()
    expect(screen.getByText('Arc task lamp')).toBeInTheDocument()
    expect(screen.getAllByText('51')).toHaveLength(2)
  })

  it('submits a versioned movement with an idempotency key', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(dashboard), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ movement: {}, replayed: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(dashboard), { status: 200 }))
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /every unit/i })
    await user.click(screen.getByRole('button', { name: /new movement/i }))
    await user.clear(screen.getByLabelText('Quantity'))
    await user.type(screen.getByLabelText('Quantity'), '4')
    await user.click(screen.getByRole('button', { name: /commit movement/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const request = fetchMock.mock.calls[1][1] as RequestInit
    expect((request.headers as Record<string, string>)['Idempotency-Key']).toContain('00000000')
    expect(JSON.parse(request.body as string)).toMatchObject({
      kind: 'transfer', quantity: 4, expectedSourceVersion: 1, expectedDestinationVersion: 1,
    })
  })

  it('submits an audited cycle count with the loaded revision', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(dashboard), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cycleCount: {}, replayed: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(dashboard), { status: 200 }))
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /every unit/i })
    await user.click(screen.getByRole('button', { name: /reconcile count/i }))
    await user.clear(screen.getByLabelText('Counted quantity'))
    await user.type(screen.getByLabelText('Counted quantity'), '40')
    await user.click(screen.getByRole('button', { name: /commit count/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const request = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(request.body as string)).toMatchObject({
      productId: 'prd-lamp', locationId: 'loc-north', countedQuantity: 40, expectedVersion: 1,
    })
  })
})
