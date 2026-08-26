export type MovementKind = 'receipt' | 'dispatch' | 'transfer'
export type StockStatus = 'healthy' | 'low' | 'out'

export interface Location {
  id: string
  code: string
  name: string
}

export interface LocationBalance {
  locationId: string
  quantity: number
  version: number
}

export interface InventoryItem {
  id: string
  sku: string
  name: string
  unit: string
  reorderPoint: number
  unitCostCents: number
  totalQuantity: number
  status: StockStatus
  balances: LocationBalance[]
}

export interface Movement {
  id: string
  kind: MovementKind
  productId: string
  productName: string
  fromLocationId: string | null
  fromLocationName: string | null
  toLocationId: string | null
  toLocationName: string | null
  quantity: number
  reason: string
  actor: string
  createdAt: string
}

export interface CycleCount {
  id: string
  productId: string
  productName: string
  locationId: string
  locationName: string
  previousQuantity: number
  countedQuantity: number
  variance: number
  reason: string
  actor: string
  createdAt: string
}

export interface Dashboard {
  generatedAt: string
  metrics: {
    totalUnits: number
    inventoryValueCents: number
    lowStockItems: number
    movementsToday: number
  }
  locations: Location[]
  items: InventoryItem[]
  movements: Movement[]
  cycleCounts: CycleCount[]
}

export interface MovementCommand {
  kind: MovementKind
  productId: string
  fromLocationId: string | null
  toLocationId: string | null
  quantity: number
  reason: string
  actor: string
  expectedSourceVersion: number | null
  expectedDestinationVersion: number | null
}

export interface CycleCountCommand {
  productId: string
  locationId: string
  countedQuantity: number
  reason: string
  actor: string
  expectedVersion: number
}
