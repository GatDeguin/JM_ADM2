export type LotStatus = 'liberado' | 'cuarentena' | 'bloqueado' | 'rechazado' | 'vencido' | 'agotado';
export type ClientStatus = 'active' | 'inactive';
export type ClientSegment = 'minorista' | 'mayorista' | 'distribuidor' | 'revendedor' | 'otro';
export type MaterialCategory = 'materia prima' | 'envase' | 'tapa' | 'etiqueta' | 'insumo' | 'otro';
export type OrderStatus = 'borrador' | 'confirmada' | 'preparada' | 'despachada' | 'entregada' | 'cancelada' | 'ok';
export type PaymentMethod = 'efectivo' | 'transferencia' | 'Mercado Pago' | 'tarjeta' | 'cuenta corriente' | 'canje' | 'seña';
export type ItemType = 'product' | 'material';
export type Origin = 'manual' | 'importación' | 'venta' | 'producción' | 'compra' | 'ajuste' | 'integridad';

export interface Product {
  id: string;
  sku: string;
  name: string;
  line: string;
  family: string;
  size: string;
  sizeMl: number;
  formulaId?: string | null;
  stockMin: number;
  listPrice: number;
  costReference: number;
  shelfLifeMonths: number;
  active: boolean;
  notes: string;
}

export interface Material {
  id: string;
  name: string;
  category: MaterialCategory;
  unit: string;
  stockMin: number;
  unitCost: number;
  providerDefaultId?: string | null;
  active: boolean;
  notes: string;
}

export interface FormulaIngredient {
  materialId: string;
  materialName: string;
  qty: number;
  unit: string;
  order: number;
  tolerance?: number | null;
}

export interface Formula {
  id: string;
  name: string;
  productId?: string | null;
  batchSizeMl: number;
  revision: string;
  active: boolean;
  ingredients: FormulaIngredient[];
}

export interface LotUsage {
  lotId: string;
  lotNumber: string;
  qty: number;
  unitCost?: number;
  expiry?: string | null;
  itemId?: string;
  itemName?: string;
}

export interface CostBreakdown {
  materials: number;
  packaging: number;
  labor: number;
  indirect: number;
  total: number;
}

export interface MaterialsUsedLine {
  materialId: string;
  materialName: string;
  qty: number;
  unit: string;
  lotsUsed: LotUsage[];
  cost: number;
  category?: MaterialCategory | string;
}

export interface ProductLot {
  id: string;
  productId: string;
  productName: string;
  lotNumber: string;
  producedAt: string;
  expiry: string;
  status: LotStatus;
  location: string;
  qtyInitial: number;
  qtyAvailable: number;
  unitCost: number;
  formulaId?: string | null;
  source: string;
  costBreakdown: CostBreakdown;
  materialsUsed: MaterialsUsedLine[];
}

export interface MaterialLot {
  id: string;
  materialId: string;
  materialName: string;
  lotNumber: string;
  supplierId: string;
  receivedAt: string;
  expiry?: string | null;
  status: LotStatus;
  location: string;
  qtyInitial: number;
  qtyAvailable: number;
  unitCost: number;
  source: string;
}

export interface Supplier {
  id: string;
  name: string;
  address: string;
  contact: string;
  phone: string;
  email: string;
  notes: string;
  active: boolean;
}

export interface Purchase {
  id: string;
  date: string;
  supplierId: string;
  materialId: string;
  materialName: string;
  lotNumber: string;
  expiry?: string | null;
  quantity: number;
  unit: string;
  unitCost: number;
  total: number;
  notes: string;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  province: string;
  city: string;
  segment: ClientSegment;
  status: ClientStatus;
  notes: string;
  source: string;
  lastPurchase?: string | null;
}

export interface Order {
  id: string;
  date: string;
  clientId: string;
  clientName: string;
  status: OrderStatus;
  lineCount: number;
  quantity: number;
  subtotal: number;
  lineDiscountTotal: number;
  orderDiscountPct: number;
  orderDiscountAmount: number;
  orderDiscountTotal: number;
  total: number;
  cogs: number;
  grossMargin: number;
  paymentMethod: PaymentMethod | string;
  amountPaid: number;
  balance: number;
  notes: string;
}

export interface Sale {
  id: string;
  orderId: string;
  date: string;
  clientId: string;
  clientName: string;
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  listPrice: number;
  discountPct: number;
  discountAmount: number;
  orderDiscountAllocated: number;
  total: number;
  cogs: number;
  lotsUsed: LotUsage[];
  source: string;
  status: string;
  affectsStock: boolean;
  parentCombo?: string | null;
  notes: string;
}

export interface ComboComponent {
  productId: string;
  qty: number;
}

export interface Combo {
  id: string;
  name: string;
  price: number;
  active: boolean;
  components: ComboComponent[];
}

export interface InventoryCount {
  id: string;
  date: string;
  itemType: ItemType;
  itemId: string;
  itemName: string;
  systemQty: number;
  countedQty: number;
  difference: number;
  reason: string;
  user: string;
  notes: string;
}

export interface Movement {
  id: string;
  date: string;
  user: string;
  type: string;
  entityType: string;
  entityId: string;
  item: string;
  qty: number;
  unit: string;
  value: number;
  reason: string;
  sourceDocument: string;
  lotNumber: string;
  notes: string;
}

export interface AuditEntry {
  id: string;
  date: string;
  user: string;
  module: string;
  entityId: string;
  field: string;
  before: string;
  after: string;
  reason: string;
  origin: Origin;
}

export interface Settings {
  currentUser: string;
  directEditLocked: boolean;
  allowNegative: boolean;
  consumePackaging: boolean;
  labor5L: number;
  indirect5L: number;
  labelYield: number;
  alertExpiryDays: number;
  expiryPolicies: Record<string, number>;
}

export interface PhysicalSnapshot {
  qty: number;
  date: string;
  user: string;
  reason: string;
}

export interface AppState {
  schemaVersion: number;
  products: Product[];
  materials: Material[];
  formulas: Formula[];
  productLots: ProductLot[];
  materialLots: MaterialLot[];
  suppliers: Supplier[];
  purchases: Purchase[];
  clients: Client[];
  orders: Order[];
  sales: Sale[];
  combos: Combo[];
  inventoryCounts: InventoryCount[];
  movements: Movement[];
  auditLog: AuditEntry[];
  settings: Settings;
  physicalSnapshots: Record<string, PhysicalSnapshot>;
}

export interface StockSnapshot {
  system: number;
  physical: number | null;
  available: number;
  reserved: number;
  status: 'ok' | 'low' | 'none' | 'negative';
}

export interface Issue {
  id: string;
  severity: 'crítico' | 'atención' | 'info';
  control: string;
  detail: string;
  systemValue: string | number;
  expectedValue: string | number;
  recommendation: string;
  module?: string;
}

export interface OperationResult<T = AppState> {
  ok: boolean;
  data?: T;
  errors: string[];
  warnings: string[];
  movements: Movement[];
  auditEntries: AuditEntry[];
  summary?: Record<string, unknown>;
}

export interface SaleDraftLine {
  id: string;
  productId?: string;
  comboId?: string;
  label: string;
  quantity: number;
  price: number;
  listPrice: number;
  discountPct: number;
  discountAmount: number;
  notes: string;
}

export interface SaleDraft {
  date: string;
  clientId: string;
  lines: SaleDraftLine[];
  orderDiscountPct: number;
  orderDiscountAmount: number;
  paymentMethod: PaymentMethod | string;
  amountPaid: number;
  notes: string;
}

export interface PurchaseDraft {
  date: string;
  supplierId: string;
  materialId: string;
  quantity: number;
  unitCost: number;
  lotNumber: string;
  expiry?: string | null;
  notes: string;
  location?: string;
}

export interface ProductionDraft {
  productId: string;
  units: number;
  lotNumber: string;
  producedAt: string;
  expiry: string;
  location: string;
  formulaId?: string | null;
  overrideExpiredOrBlocked?: boolean;
  notes: string;
}

export interface InventoryDraft {
  date: string;
  itemType: ItemType;
  itemId: string;
  countedQty: number;
  reason: string;
  notes: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}
