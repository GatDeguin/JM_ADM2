import type {
  AppState,
  AuditEntry,
  Client,
  Combo,
  InventoryCount,
  InventoryDraft,
  Issue,
  LotUsage,
  Material,
  MaterialLot,
  MaterialsUsedLine,
  Movement,
  OperationResult,
  Order,
  Product,
  ProductLot,
  ProductionDraft,
  Purchase,
  PurchaseDraft,
  Sale,
  SaleDraft,
  SaleDraftLine,
  StockSnapshot
} from './types';
import { addMonths, clone, isExpired, isNearExpiry, money, nowISO, safeJson, todayISO, uid } from './utils';

const countableStatuses = new Set(['liberado', 'cuarentena', 'bloqueado', 'vencido', 'agotado']);
const packagingCategories = new Set(['envase', 'tapa', 'etiqueta']);

interface MovementInput {
  type: string;
  entityType: string;
  entityId: string;
  item: string;
  quantity: number;
  unit: string;
  value?: number;
  reason: string;
  sourceDocument: string;
  lotNumber?: string;
  notes?: string;
  user?: string;
  date?: string;
}

interface AuditInput {
  entity: string;
  entityId: string;
  field: string;
  before: unknown;
  after: unknown;
  reason: string;
  origin: AuditEntry['origin'];
  user?: string;
  date?: string;
}

export function createMovement(input: MovementInput): Movement {
  return {
    id: uid('mov'),
    date: input.date ?? nowISO(),
    user: input.user ?? 'JM Admin',
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    item: input.item,
    qty: Number(input.quantity) || 0,
    unit: input.unit,
    value: Number(input.value) || 0,
    reason: input.reason,
    sourceDocument: input.sourceDocument,
    lotNumber: input.lotNumber ?? '',
    notes: input.notes ?? ''
  };
}

export function audit(input: AuditInput): AuditEntry {
  return {
    id: uid('aud'),
    date: input.date ?? nowISO(),
    user: input.user ?? 'JM Admin',
    module: input.entity,
    entityId: input.entityId,
    field: input.field,
    before: typeof input.before === 'string' ? input.before : safeJson(input.before),
    after: typeof input.after === 'string' ? input.after : safeJson(input.after),
    reason: input.reason,
    origin: input.origin
  };
}

export function commitOperation(
  state: AppState,
  payload: { patch: Partial<AppState>; movements: Movement[]; auditEntries: AuditEntry[] }
): AppState {
  return {
    ...state,
    ...payload.patch,
    movements: [...state.movements, ...payload.movements],
    auditLog: [...state.auditLog, ...payload.auditEntries]
  };
}

export function activeProductLots(state: AppState, productId: string, at = todayISO()): ProductLot[] {
  return state.productLots
    .filter((lot) => lot.productId === productId && lot.qtyAvailable > 0 && lot.status === 'liberado' && !isExpired(lot.expiry, at))
    .sort((a, b) => `${a.expiry || '9999-12-31'}-${a.lotNumber}`.localeCompare(`${b.expiry || '9999-12-31'}-${b.lotNumber}`));
}

export function activeMaterialLots(state: AppState, materialId: string, at = todayISO()): MaterialLot[] {
  return state.materialLots
    .filter((lot) => lot.materialId === materialId && lot.qtyAvailable > 0 && lot.status === 'liberado' && !isExpired(lot.expiry, at))
    .sort((a, b) => `${a.expiry || '9999-12-31'}-${a.lotNumber}`.localeCompare(`${b.expiry || '9999-12-31'}-${b.lotNumber}`));
}

export function productStock(state: AppState, productId: string): StockSnapshot {
  const product = state.products.find((p) => p.id === productId);
  const system = state.productLots
    .filter((lot) => lot.productId === productId && countableStatuses.has(lot.status))
    .reduce((sum, lot) => sum + lot.qtyAvailable, 0);
  const available = activeProductLots(state, productId).reduce((sum, lot) => sum + lot.qtyAvailable, 0);
  const physical = state.physicalSnapshots[`product:${productId}`]?.qty ?? null;
  const status = system < 0 ? 'negative' : available <= 0 ? 'none' : product && available <= product.stockMin ? 'low' : 'ok';
  return { system, available, physical, reserved: 0, status };
}

export function materialStock(state: AppState, materialId: string): StockSnapshot {
  const material = state.materials.find((m) => m.id === materialId);
  const system = state.materialLots
    .filter((lot) => lot.materialId === materialId && countableStatuses.has(lot.status))
    .reduce((sum, lot) => sum + lot.qtyAvailable, 0);
  const available = activeMaterialLots(state, materialId).reduce((sum, lot) => sum + lot.qtyAvailable, 0);
  const physical = state.physicalSnapshots[`material:${materialId}`]?.qty ?? null;
  const status = system < 0 ? 'negative' : available <= 0 ? 'none' : material && available <= material.stockMin ? 'low' : 'ok';
  return { system, available, physical, reserved: 0, status };
}

function planConsumeProductLots(lots: ProductLot[], productId: string, requested: number, at: string, allowNegative: boolean): { lotsUsed: LotUsage[]; cogs: number; missing: number; warnings: string[] } {
  let remaining = Math.max(0, requested);
  const lotsUsed: LotUsage[] = [];
  const warnings: string[] = [];
  let cogs = 0;
  const candidates = lots
    .filter((lot) => lot.productId === productId && lot.qtyAvailable > 0 && lot.status === 'liberado' && !isExpired(lot.expiry, at))
    .sort((a, b) => `${a.expiry || '9999-12-31'}-${a.lotNumber}`.localeCompare(`${b.expiry || '9999-12-31'}-${b.lotNumber}`));
  for (const lot of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.qtyAvailable);
    lot.qtyAvailable = Number((lot.qtyAvailable - take).toFixed(6));
    if (lot.qtyAvailable <= 0) lot.status = 'agotado';
    lotsUsed.push({ lotId: lot.id, lotNumber: lot.lotNumber, qty: take, unitCost: lot.unitCost, expiry: lot.expiry, itemId: productId, itemName: lot.productName });
    cogs += take * lot.unitCost;
    remaining = Number((remaining - take).toFixed(6));
    if (isNearExpiry(lot.expiry, 45, at)) warnings.push(`${lot.productName} lote ${lot.lotNumber} vence el ${lot.expiry}.`);
  }
  if (remaining > 0 && allowNegative) {
    lotsUsed.push({ lotId: 'NEGATIVE', lotNumber: 'SIN-STOCK', qty: remaining, unitCost: 0, expiry: null, itemId: productId });
    warnings.push(`Se registró faltante permitido por configuración: ${remaining}.`);
    remaining = 0;
  }
  return { lotsUsed, cogs, missing: remaining, warnings };
}

function planConsumeMaterialLots(lots: MaterialLot[], materialId: string, requested: number, at: string, allowNegative: boolean): { lotsUsed: LotUsage[]; cost: number; missing: number; warnings: string[] } {
  let remaining = Math.max(0, requested);
  const lotsUsed: LotUsage[] = [];
  const warnings: string[] = [];
  let cost = 0;
  const candidates = lots
    .filter((lot) => lot.materialId === materialId && lot.qtyAvailable > 0 && lot.status === 'liberado' && !isExpired(lot.expiry, at))
    .sort((a, b) => `${a.expiry || '9999-12-31'}-${a.lotNumber}`.localeCompare(`${b.expiry || '9999-12-31'}-${b.lotNumber}`));
  for (const lot of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.qtyAvailable);
    lot.qtyAvailable = Number((lot.qtyAvailable - take).toFixed(6));
    if (lot.qtyAvailable <= 0) lot.status = 'agotado';
    lotsUsed.push({ lotId: lot.id, lotNumber: lot.lotNumber, qty: take, unitCost: lot.unitCost, expiry: lot.expiry, itemId: materialId, itemName: lot.materialName });
    cost += take * lot.unitCost;
    remaining = Number((remaining - take).toFixed(6));
    if (isNearExpiry(lot.expiry, 45, at)) warnings.push(`${lot.materialName} lote ${lot.lotNumber} vence el ${lot.expiry}.`);
  }
  if (remaining > 0 && allowNegative) {
    lotsUsed.push({ lotId: 'NEGATIVE', lotNumber: 'SIN-STOCK-MP', qty: remaining, unitCost: 0, expiry: null, itemId: materialId });
    warnings.push(`Faltante de insumo permitido por configuración: ${remaining}.`);
    remaining = 0;
  }
  return { lotsUsed, cost, missing: remaining, warnings };
}

function lineNet(line: SaleDraftLine): { gross: number; discount: number; net: number } {
  const gross = Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.price) || 0);
  const discount = Math.min(gross, Math.max(0, gross * (Number(line.discountPct) || 0) / 100) + Math.max(0, Number(line.discountAmount) || 0));
  return { gross, discount, net: gross - discount };
}

function expandSaleLine(state: AppState, line: SaleDraftLine): Array<{ productId: string; productName: string; quantity: number; parentCombo?: string | null; affectsStock: boolean; listPrice: number; weight: number }> {
  if (line.comboId) {
    const combo = state.combos.find((c) => c.id === line.comboId);
    if (!combo || combo.components.length === 0) {
      return [{ productId: 'legacy-no-sku', productName: combo?.name ?? line.label, quantity: line.quantity, parentCombo: combo?.name ?? line.label, affectsStock: false, listPrice: line.price, weight: 1 }];
    }
    return combo.components.map((component) => {
      const product = state.products.find((p) => p.id === component.productId);
      return {
        productId: component.productId,
        productName: product?.name ?? component.productId,
        quantity: component.qty * line.quantity,
        parentCombo: combo.name,
        affectsStock: true,
        listPrice: product?.listPrice || product?.costReference || 1,
        weight: Math.max(0.0001, (product?.listPrice || product?.costReference || 1) * component.qty)
      };
    });
  }
  const product = state.products.find((p) => p.id === line.productId);
  return [{ productId: line.productId ?? '', productName: product?.name ?? line.label, quantity: line.quantity, parentCombo: null, affectsStock: true, listPrice: product?.listPrice ?? line.listPrice, weight: Math.max(0.0001, (product?.listPrice ?? line.price) * line.quantity) }];
}

export function previewSale(state: AppState, draft: SaleDraft): OperationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const client = state.clients.find((c) => c.id === draft.clientId);
  if (!draft.clientId) errors.push('Cliente obligatorio.');
  if (draft.clientId && !client) errors.push('Cliente inexistente.');
  if (client && client.status !== 'active') errors.push('El cliente debe estar activo.');
  if (!draft.lines.length) errors.push('El carrito no puede estar vacío.');

  const subtotal = draft.lines.reduce((sum, line) => sum + lineNet(line).gross, 0);
  const lineDiscountTotal = draft.lines.reduce((sum, line) => sum + lineNet(line).discount, 0);
  const afterLineDiscount = subtotal - lineDiscountTotal;
  const orderDiscountTotal = Math.min(afterLineDiscount, Math.max(0, afterLineDiscount * (Number(draft.orderDiscountPct) || 0) / 100) + Math.max(0, Number(draft.orderDiscountAmount) || 0));
  const total = Math.max(0, afterLineDiscount - orderDiscountTotal);
  const balance = Math.max(0, total - Math.max(0, Number(draft.amountPaid) || 0));
  if (total < 0) errors.push('Los descuentos no pueden dejar total negativo.');

  const shadowLots = clone(state.productLots);
  const actualLines: Array<{ baseLine: SaleDraftLine; productId: string; productName: string; quantity: number; total: number; orderDiscountAllocated: number; cogs: number; lotsUsed: LotUsage[]; parentCombo?: string | null; affectsStock: boolean; listPrice: number }> = [];
  let cogs = 0;

  for (const line of draft.lines) {
    if ((Number(line.quantity) || 0) <= 0) errors.push(`Cantidad inválida en ${line.label}.`);
    if ((Number(line.price) || 0) < 0) errors.push(`Precio inválido en ${line.label}.`);
    const amounts = lineNet(line);
    const orderShare = afterLineDiscount > 0 ? orderDiscountTotal * (amounts.net / afterLineDiscount) : 0;
    const components = expandSaleLine(state, line);
    const totalWeight = components.reduce((sum, item) => sum + item.weight, 0) || 1;
    for (const component of components) {
      const product = state.products.find((p) => p.id === component.productId);
      if (component.affectsStock && !product) errors.push(`Producto inválido en línea ${line.label}.`);
      if (component.affectsStock && product && !product.active) warnings.push(`${product.name} está inactivo.`);
      const allocation = component.weight / totalWeight;
      const allocatedTotal = Math.max(0, (amounts.net - orderShare) * allocation);
      let lotsUsed: LotUsage[] = [];
      let lineCogs = 0;
      if (component.affectsStock && component.productId) {
        const plan = planConsumeProductLots(shadowLots, component.productId, component.quantity, draft.date, state.settings.allowNegative);
        lotsUsed = plan.lotsUsed;
        lineCogs = plan.cogs;
        cogs += plan.cogs;
        warnings.push(...plan.warnings);
        if (plan.missing > 0) errors.push(`Stock insuficiente para ${component.productName}. Faltan ${plan.missing}.`);
        if (!product?.listPrice) warnings.push(`${component.productName} no tiene precio activo/lista cargado.`);
      }
      actualLines.push({
        baseLine: line,
        productId: component.productId,
        productName: component.productName,
        quantity: component.quantity,
        total: allocatedTotal,
        orderDiscountAllocated: orderShare * allocation,
        cogs: lineCogs,
        lotsUsed,
        parentCombo: component.parentCombo,
        affectsStock: component.affectsStock,
        listPrice: component.listPrice
      });
    }
  }

  const grossMargin = total - cogs;
  return {
    ok: errors.length === 0,
    errors,
    warnings: Array.from(new Set(warnings)),
    movements: [],
    auditEntries: [],
    summary: {
      client,
      subtotal,
      lineDiscountTotal,
      orderDiscountPct: draft.orderDiscountPct,
      orderDiscountAmount: draft.orderDiscountAmount,
      orderDiscountTotal,
      total,
      amountPaid: draft.amountPaid,
      balance,
      cogs,
      grossMargin,
      actualLines,
      stockLots: actualLines.flatMap((l) => l.lotsUsed.map((lot) => ({ ...lot, productName: l.productName })))
    }
  };
}

export function closeSale(state: AppState, draft: SaleDraft): OperationResult<AppState> {
  const preview = previewSale(state, draft);
  if (!preview.ok || !preview.summary) return { ...preview, data: undefined };
  const summary = preview.summary as Record<string, unknown>;
  const client = summary.client as Client;
  const actualLines = summary.actualLines as Array<{ baseLine: SaleDraftLine; productId: string; productName: string; quantity: number; total: number; orderDiscountAllocated: number; cogs: number; lotsUsed: LotUsage[]; parentCombo?: string | null; affectsStock: boolean; listPrice: number }>;
  const next = clone(state);
  const orderId = uid('ord');
  const movements: Movement[] = [];
  const auditEntries: AuditEntry[] = [];

  const sales: Sale[] = [];
  for (const item of actualLines) {
    const applied = item.affectsStock ? planConsumeProductLots(next.productLots, item.productId, item.quantity, draft.date, next.settings.allowNegative) : { lotsUsed: [], cogs: 0 };
    const lotsUsed = item.affectsStock ? applied.lotsUsed : [];
    const cogsLine = item.affectsStock ? applied.cogs : 0;
    const sale: Sale = {
      id: uid('sale'),
      orderId,
      date: draft.date,
      clientId: client.id,
      clientName: client.name,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      price: item.baseLine.price,
      listPrice: item.listPrice,
      discountPct: item.baseLine.discountPct,
      discountAmount: item.baseLine.discountAmount,
      orderDiscountAllocated: item.orderDiscountAllocated,
      total: item.total,
      cogs: cogsLine,
      lotsUsed,
      source: 'venta',
      status: 'ok',
      affectsStock: item.affectsStock,
      parentCombo: item.parentCombo ?? null,
      notes: item.baseLine.notes
    };
    sales.push(sale);
    if (item.affectsStock) {
      movements.push(createMovement({
        type: 'venta',
        entityType: 'sale',
        entityId: sale.id,
        item: item.productName,
        quantity: -item.quantity,
        unit: 'u',
        value: cogsLine,
        reason: `Venta a ${client.name}`,
        sourceDocument: orderId,
        lotNumber: lotsUsed.map((l) => l.lotNumber).join(', '),
        user: next.settings.currentUser
      }));
    }
  }

  const order: Order = {
    id: orderId,
    date: draft.date,
    clientId: client.id,
    clientName: client.name,
    status: 'ok',
    lineCount: draft.lines.length,
    quantity: draft.lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: Number(summary.subtotal) || 0,
    lineDiscountTotal: Number(summary.lineDiscountTotal) || 0,
    orderDiscountPct: draft.orderDiscountPct,
    orderDiscountAmount: draft.orderDiscountAmount,
    orderDiscountTotal: Number(summary.orderDiscountTotal) || 0,
    total: Number(summary.total) || 0,
    cogs: sales.reduce((sum, sale) => sum + sale.cogs, 0),
    grossMargin: (Number(summary.total) || 0) - sales.reduce((sum, sale) => sum + sale.cogs, 0),
    paymentMethod: draft.paymentMethod,
    amountPaid: Math.max(0, draft.amountPaid || 0),
    balance: Number(summary.balance) || 0,
    notes: draft.notes
  };

  const clientIndex = next.clients.findIndex((c) => c.id === client.id);
  if (clientIndex >= 0) next.clients[clientIndex] = { ...next.clients[clientIndex], lastPurchase: draft.date };
  next.orders.push(order);
  next.sales.push(...sales);

  auditEntries.push(audit({
    entity: 'ventas',
    entityId: order.id,
    field: 'orden',
    before: '',
    after: { total: order.total, balance: order.balance, lines: sales.length },
    reason: 'Cierre de venta confirmado',
    origin: 'venta',
    user: next.settings.currentUser
  }));

  return {
    ok: true,
    data: commitOperation(next, { patch: next, movements, auditEntries }),
    errors: [],
    warnings: preview.warnings,
    movements,
    auditEntries,
    summary: { ...summary, order, sales }
  };
}

export function suggestedExpiryForProduct(state: AppState, productId: string, producedAt: string): string {
  const product = state.products.find((p) => p.id === productId);
  const linePolicy = product ? state.settings.expiryPolicies[product.family] ?? state.settings.expiryPolicies[product.line] : undefined;
  const months = product?.shelfLifeMonths || linePolicy || state.settings.expiryPolicies.DEFAULT || 24;
  return addMonths(producedAt, months);
}

export function previewProduction(state: AppState, draft: ProductionDraft): OperationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const product = state.products.find((p) => p.id === draft.productId);
  if (!draft.productId || !product) errors.push('Producto obligatorio y válido.');
  const formulaId = draft.formulaId || product?.formulaId || null;
  const formula = state.formulas.find((f) => f.id === formulaId);
  if (!formulaId || !formula) errors.push('Fórmula válida obligatoria.');
  if (formula && formula.ingredients.length === 0) errors.push('La fórmula debe tener al menos un insumo.');
  if (!draft.units || draft.units <= 0) errors.push('Unidades > 0 obligatorias.');
  if (!draft.lotNumber.trim()) errors.push('Número de lote obligatorio.');
  if (product && draft.lotNumber && state.productLots.some((lot) => lot.productId === product.id && lot.lotNumber.trim().toLowerCase() === draft.lotNumber.trim().toLowerCase())) errors.push('El lote ya existe para el producto.');
  if (!draft.producedAt) errors.push('Fecha de producción obligatoria.');
  if (!draft.expiry) errors.push('Vencimiento obligatorio.');
  if (draft.producedAt && draft.expiry && draft.expiry <= draft.producedAt) errors.push('El vencimiento debe ser posterior a producción.');

  const shadowLots = clone(state.materialLots);
  const materialsUsed: MaterialsUsedLine[] = [];
  let materialsCost = 0;
  let packagingCost = 0;
  const totalMl = (product?.sizeMl || 0) * (draft.units || 0);
  const scale = formula && formula.batchSizeMl > 0 ? totalMl / formula.batchSizeMl : 0;
  if (product && !product.sizeMl) warnings.push('El producto no tiene sizeMl; el consumo de fórmula puede quedar en cero.');

  if (formula && product) {
    for (const ingredient of formula.ingredients) {
      const material = state.materials.find((m) => m.id === ingredient.materialId);
      if (!material) {
        errors.push(`Insumo inexistente en fórmula: ${ingredient.materialName}.`);
        continue;
      }
      const isPackaging = packagingCategories.has(material.category);
      if (isPackaging && !state.settings.consumePackaging) continue;
      const needed = Number((ingredient.qty * scale).toFixed(6));
      const plan = planConsumeMaterialLots(shadowLots, material.id, needed, draft.producedAt, state.settings.allowNegative);
      warnings.push(...plan.warnings);
      if (plan.missing > 0) errors.push(`Stock insuficiente de ${material.name}. Faltan ${plan.missing} ${material.unit}.`);
      if (isPackaging) packagingCost += plan.cost;
      else materialsCost += plan.cost;
      materialsUsed.push({
        materialId: material.id,
        materialName: material.name,
        qty: needed,
        unit: material.unit,
        lotsUsed: plan.lotsUsed,
        cost: plan.cost,
        category: material.category
      });
    }
  }
  const labor = state.settings.labor5L * scale;
  const indirect = state.settings.indirect5L * scale;
  const totalCost = materialsCost + packagingCost + labor + indirect;
  const unitCost = draft.units > 0 ? totalCost / draft.units : 0;

  return {
    ok: errors.length === 0,
    errors,
    warnings: Array.from(new Set(warnings)),
    movements: [],
    auditEntries: [],
    summary: { product, formula, scale, materialsUsed, costBreakdown: { materials: materialsCost, packaging: packagingCost, labor, indirect, total: totalCost }, unitCost }
  };
}

export function registerProduction(state: AppState, draft: ProductionDraft): OperationResult<AppState> {
  const preview = previewProduction(state, draft);
  if (!preview.ok || !preview.summary) return { ...preview, data: undefined };
  const next = clone(state);
  const product = next.products.find((p) => p.id === draft.productId) as Product;
  const formula = next.formulas.find((f) => f.id === (draft.formulaId || product.formulaId))!;
  const materialsUsedPreview = (preview.summary.materialsUsed as MaterialsUsedLine[]);
  const movements: Movement[] = [];
  const auditEntries: AuditEntry[] = [];
  const materialsUsed: MaterialsUsedLine[] = [];

  for (const line of materialsUsedPreview) {
    const plan = planConsumeMaterialLots(next.materialLots, line.materialId, line.qty, draft.producedAt, next.settings.allowNegative);
    const material = next.materials.find((m) => m.id === line.materialId);
    materialsUsed.push({ ...line, lotsUsed: plan.lotsUsed, cost: plan.cost });
    movements.push(createMovement({
      type: 'consumo producción',
      entityType: 'production',
      entityId: draft.lotNumber,
      item: line.materialName,
      quantity: -line.qty,
      unit: line.unit,
      value: plan.cost,
      reason: `Producción ${product.name}`,
      sourceDocument: draft.lotNumber,
      lotNumber: plan.lotsUsed.map((l) => l.lotNumber).join(', '),
      user: next.settings.currentUser,
      notes: material?.category ?? ''
    }));
  }
  const materialCost = materialsUsed.filter((line) => !packagingCategories.has(String(line.category))).reduce((sum, line) => sum + line.cost, 0);
  const packagingCost = materialsUsed.filter((line) => packagingCategories.has(String(line.category))).reduce((sum, line) => sum + line.cost, 0);
  const scale = Number(preview.summary.scale) || 0;
  const labor = next.settings.labor5L * scale;
  const indirect = next.settings.indirect5L * scale;
  const total = materialCost + packagingCost + labor + indirect;
  const unitCost = draft.units > 0 ? total / draft.units : 0;
  const lot: ProductLot = {
    id: uid('plt'),
    productId: product.id,
    productName: product.name,
    lotNumber: draft.lotNumber.trim(),
    producedAt: draft.producedAt,
    expiry: draft.expiry,
    status: 'liberado',
    location: draft.location || 'Depósito principal',
    qtyInitial: draft.units,
    qtyAvailable: draft.units,
    unitCost,
    formulaId: formula.id,
    source: 'producción',
    costBreakdown: { materials: materialCost, packaging: packagingCost, labor, indirect, total },
    materialsUsed
  };
  next.productLots.push(lot);
  movements.push(createMovement({
    type: 'producción',
    entityType: 'productLot',
    entityId: lot.id,
    item: product.name,
    quantity: draft.units,
    unit: 'u',
    value: total,
    reason: 'Alta de lote producido',
    sourceDocument: draft.lotNumber,
    lotNumber: draft.lotNumber,
    user: next.settings.currentUser
  }));
  auditEntries.push(audit({ entity: 'producción', entityId: lot.id, field: 'lote', before: '', after: lot, reason: 'Producción confirmada', origin: 'producción', user: next.settings.currentUser }));
  return { ok: true, data: commitOperation(next, { patch: next, movements, auditEntries }), errors: [], warnings: preview.warnings, movements, auditEntries, summary: { ...preview.summary, productLot: lot } };
}

export function validatePurchase(state: AppState, draft: PurchaseDraft): string[] {
  const errors: string[] = [];
  if (!draft.supplierId || !state.suppliers.some((s) => s.id === draft.supplierId && s.active)) errors.push('Proveedor obligatorio y activo.');
  if (!draft.materialId || !state.materials.some((m) => m.id === draft.materialId && m.active)) errors.push('Material obligatorio y activo.');
  if (!draft.date) errors.push('Fecha obligatoria.');
  if (!draft.quantity || draft.quantity <= 0) errors.push('Cantidad > 0 obligatoria.');
  if (draft.unitCost < 0) errors.push('Costo unitario debe ser >= 0.');
  if (draft.expiry && draft.expiry <= draft.date) errors.push('El vencimiento debe ser posterior a la fecha de compra.');
  return errors;
}

export function previewPurchase(state: AppState, draft: PurchaseDraft): OperationResult {
  const errors = validatePurchase(state, draft);
  const warnings: string[] = [];
  if (!draft.lotNumber.trim()) warnings.push('Se recomienda cargar lote proveedor.');
  const supplier = state.suppliers.find((s) => s.id === draft.supplierId);
  const material = state.materials.find((m) => m.id === draft.materialId);
  return { ok: errors.length === 0, errors, warnings, movements: [], auditEntries: [], summary: { supplier, material, total: draft.quantity * draft.unitCost } };
}

export function registerPurchase(state: AppState, draft: PurchaseDraft): OperationResult<AppState> {
  const preview = previewPurchase(state, draft);
  if (!preview.ok || !preview.summary) return { ...preview, data: undefined };
  const next = clone(state);
  const material = next.materials.find((m) => m.id === draft.materialId)!;
  const purchase: Purchase = {
    id: uid('pur'),
    date: draft.date,
    supplierId: draft.supplierId,
    materialId: material.id,
    materialName: material.name,
    lotNumber: draft.lotNumber.trim() || `COMPRA-${Date.now()}`,
    expiry: draft.expiry || null,
    quantity: draft.quantity,
    unit: material.unit,
    unitCost: draft.unitCost,
    total: draft.quantity * draft.unitCost,
    notes: draft.notes
  };
  const lot: MaterialLot = {
    id: uid('mlt'),
    materialId: material.id,
    materialName: material.name,
    lotNumber: purchase.lotNumber,
    supplierId: draft.supplierId,
    receivedAt: draft.date,
    expiry: draft.expiry || null,
    status: 'liberado',
    location: draft.location || 'Depósito MP',
    qtyInitial: draft.quantity,
    qtyAvailable: draft.quantity,
    unitCost: draft.unitCost,
    source: 'compra'
  };
  const beforeCost = material.unitCost;
  const currentQty = materialStock(next, material.id).system;
  material.unitCost = currentQty + draft.quantity > 0 ? ((beforeCost * currentQty) + (draft.unitCost * draft.quantity)) / (currentQty + draft.quantity) : draft.unitCost;
  next.purchases.push(purchase);
  next.materialLots.push(lot);
  const movements = [createMovement({ type: 'compra', entityType: 'purchase', entityId: purchase.id, item: material.name, quantity: draft.quantity, unit: material.unit, value: purchase.total, reason: 'Registro de compra', sourceDocument: purchase.id, lotNumber: lot.lotNumber, user: next.settings.currentUser })];
  const auditEntries = [audit({ entity: 'compras', entityId: purchase.id, field: 'compra', before: '', after: purchase, reason: 'Compra confirmada', origin: 'compra', user: next.settings.currentUser })];
  if (beforeCost !== material.unitCost) auditEntries.push(audit({ entity: 'materials', entityId: material.id, field: 'unitCost', before: beforeCost, after: material.unitCost, reason: 'Promedio ponderado por compra', origin: 'compra', user: next.settings.currentUser }));
  return { ok: true, data: commitOperation(next, { patch: next, movements, auditEntries }), errors: [], warnings: preview.warnings, movements, auditEntries, summary: { purchase, lot } };
}

function consumeAdjustmentProductLots(lots: ProductLot[], productId: string, qty: number): LotUsage[] {
  let remaining = qty;
  const used: LotUsage[] = [];
  const candidates = lots.filter((lot) => lot.productId === productId && lot.qtyAvailable > 0 && lot.status !== 'rechazado').sort((a, b) => `${a.expiry || '9999-12-31'}-${a.lotNumber}`.localeCompare(`${b.expiry || '9999-12-31'}-${b.lotNumber}`));
  for (const lot of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.qtyAvailable);
    lot.qtyAvailable = Number((lot.qtyAvailable - take).toFixed(6));
    if (lot.qtyAvailable <= 0) lot.status = 'agotado';
    used.push({ lotId: lot.id, lotNumber: lot.lotNumber, qty: take, unitCost: lot.unitCost, expiry: lot.expiry, itemId: productId, itemName: lot.productName });
    remaining -= take;
  }
  return used;
}

function consumeAdjustmentMaterialLots(lots: MaterialLot[], materialId: string, qty: number): LotUsage[] {
  let remaining = qty;
  const used: LotUsage[] = [];
  const candidates = lots.filter((lot) => lot.materialId === materialId && lot.qtyAvailable > 0 && lot.status !== 'rechazado').sort((a, b) => `${a.expiry || '9999-12-31'}-${a.lotNumber}`.localeCompare(`${b.expiry || '9999-12-31'}-${b.lotNumber}`));
  for (const lot of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.qtyAvailable);
    lot.qtyAvailable = Number((lot.qtyAvailable - take).toFixed(6));
    if (lot.qtyAvailable <= 0) lot.status = 'agotado';
    used.push({ lotId: lot.id, lotNumber: lot.lotNumber, qty: take, unitCost: lot.unitCost, expiry: lot.expiry, itemId: materialId, itemName: lot.materialName });
    remaining -= take;
  }
  return used;
}

export function previewInventoryCount(state: AppState, draft: InventoryDraft): OperationResult {
  const errors: string[] = [];
  const item = draft.itemType === 'product' ? state.products.find((p) => p.id === draft.itemId) : state.materials.find((m) => m.id === draft.itemId);
  if (!draft.itemId || !item) errors.push('Ítem obligatorio y válido.');
  if (draft.countedQty < 0) errors.push('Cantidad contada >= 0 obligatoria.');
  if (!draft.reason.trim()) errors.push('Motivo obligatorio.');
  const stock = draft.itemType === 'product' ? productStock(state, draft.itemId) : materialStock(state, draft.itemId);
  const difference = draft.countedQty - stock.system;
  return { ok: errors.length === 0, errors, warnings: [], movements: [], auditEntries: [], summary: { item, systemQty: stock.system, countedQty: draft.countedQty, difference } };
}

export function applyInventoryCount(state: AppState, draft: InventoryDraft): OperationResult<AppState> {
  const preview = previewInventoryCount(state, draft);
  if (!preview.ok || !preview.summary) return { ...preview, data: undefined };
  const next = clone(state);
  const item = draft.itemType === 'product' ? next.products.find((p) => p.id === draft.itemId)! : next.materials.find((m) => m.id === draft.itemId)!;
  const systemQty = Number(preview.summary.systemQty) || 0;
  const difference = Number(preview.summary.difference) || 0;
  const count: InventoryCount = {
    id: uid('cnt'),
    date: draft.date,
    itemType: draft.itemType,
    itemId: draft.itemId,
    itemName: item.name,
    systemQty,
    countedQty: draft.countedQty,
    difference,
    reason: draft.reason,
    user: next.settings.currentUser,
    notes: draft.notes
  };
  next.inventoryCounts.push(count);
  next.physicalSnapshots[`${draft.itemType}:${draft.itemId}`] = { qty: draft.countedQty, date: draft.date, user: next.settings.currentUser, reason: draft.reason };
  let lotNumber = '';
  if (difference > 0) {
    if (draft.itemType === 'product') {
      const product = item as Product;
      const lot: ProductLot = { id: uid('plt'), productId: product.id, productName: product.name, lotNumber: `AJUSTE-${count.id}`, producedAt: draft.date, expiry: addMonths(draft.date, product.shelfLifeMonths || 24), status: 'liberado', location: 'Ajuste inventario', qtyInitial: difference, qtyAvailable: difference, unitCost: product.costReference, formulaId: product.formulaId ?? null, source: 'ajuste', costBreakdown: { materials: 0, packaging: 0, labor: 0, indirect: 0, total: product.costReference * difference }, materialsUsed: [] };
      next.productLots.push(lot);
      lotNumber = lot.lotNumber;
    } else {
      const material = item as Material;
      const lot: MaterialLot = { id: uid('mlt'), materialId: material.id, materialName: material.name, lotNumber: `AJUSTE-${count.id}`, supplierId: material.providerDefaultId || 'sup-default', receivedAt: draft.date, expiry: null, status: 'liberado', location: 'Ajuste inventario', qtyInitial: difference, qtyAvailable: difference, unitCost: material.unitCost, source: 'ajuste' };
      next.materialLots.push(lot);
      lotNumber = lot.lotNumber;
    }
  } else if (difference < 0) {
    const used = draft.itemType === 'product' ? consumeAdjustmentProductLots(next.productLots, draft.itemId, Math.abs(difference)) : consumeAdjustmentMaterialLots(next.materialLots, draft.itemId, Math.abs(difference));
    lotNumber = used.map((u) => u.lotNumber).join(', ');
  }
  const movements = [createMovement({ type: 'ajuste inventario', entityType: 'inventoryCount', entityId: count.id, item: item.name, quantity: difference, unit: draft.itemType === 'product' ? 'u' : (item as Material).unit, value: 0, reason: draft.reason, sourceDocument: count.id, lotNumber, user: next.settings.currentUser, notes: draft.notes })];
  const auditEntries = [audit({ entity: 'inventario', entityId: count.id, field: 'stock', before: systemQty, after: draft.countedQty, reason: draft.reason, origin: 'ajuste', user: next.settings.currentUser })];
  return { ok: true, data: commitOperation(next, { patch: next, movements, auditEntries }), errors: [], warnings: [], movements, auditEntries, summary: { count, difference } };
}

export function runIntegrityChecks(state: AppState): Issue[] {
  const issues: Issue[] = [];
  const today = todayISO();
  const productIds = new Set(state.products.map((p) => p.id));
  const materialIds = new Set(state.materials.map((m) => m.id));
  const clientIds = new Set(state.clients.map((c) => c.id));
  const formulaIds = new Set(state.formulas.map((f) => f.id));

  for (const product of state.products) {
    const stock = productStock(state, product.id);
    if (product.active && stock.available <= product.stockMin) issues.push({ id: uid('iss'), severity: stock.available <= 0 ? 'crítico' : 'atención', control: 'Stock mínimo PT', detail: product.name, systemValue: stock.available, expectedValue: `>${product.stockMin}`, recommendation: 'Producir, ajustar inventario o revisar lotes bloqueados.', module: 'Productos' });
    if (product.active && product.listPrice <= 0) issues.push({ id: uid('iss'), severity: 'atención', control: 'Precio activo', detail: product.name, systemValue: product.listPrice, expectedValue: '> 0', recommendation: 'Completar precio de lista.', module: 'Costos' });
    if (product.formulaId && !formulaIds.has(product.formulaId)) issues.push({ id: uid('iss'), severity: 'crítico', control: 'Fórmula de producto', detail: product.name, systemValue: product.formulaId, expectedValue: 'Fórmula existente', recommendation: 'Asignar fórmula válida.', module: 'Fórmulas' });
    if (product.listPrice > 0 && product.costReference > 0 && (product.listPrice - product.costReference) / product.listPrice < 0.25) issues.push({ id: uid('iss'), severity: 'info', control: 'Margen bajo', detail: product.name, systemValue: money(product.listPrice - product.costReference), expectedValue: 'Margen > 25%', recommendation: 'Revisar precio o costo.', module: 'Costos' });
  }

  for (const material of state.materials) {
    const stock = materialStock(state, material.id);
    if (material.active && stock.available <= material.stockMin) issues.push({ id: uid('iss'), severity: stock.available <= 0 ? 'crítico' : 'atención', control: 'Stock mínimo MP', detail: material.name, systemValue: stock.available, expectedValue: `>${material.stockMin}`, recommendation: 'Comprar o ajustar stock.', module: 'Materiales' });
  }

  for (const lot of state.productLots) {
    if (lot.qtyAvailable < 0) issues.push({ id: uid('iss'), severity: 'crítico', control: 'Stock negativo lote PT', detail: `${lot.productName} ${lot.lotNumber}`, systemValue: lot.qtyAvailable, expectedValue: '>= 0', recommendation: 'Reparar seguro o ajustar inventario.', module: 'Lotes' });
    if (lot.status === 'liberado' && lot.qtyAvailable > 0 && isExpired(lot.expiry, today)) issues.push({ id: uid('iss'), severity: 'crítico', control: 'Lote PT vencido disponible', detail: `${lot.productName} ${lot.lotNumber}`, systemValue: lot.expiry, expectedValue: 'No vencido', recommendation: 'Bloquear, retirar o ajustar.', module: 'Lotes' });
  }
  for (const lot of state.materialLots) {
    if (lot.qtyAvailable < 0) issues.push({ id: uid('iss'), severity: 'crítico', control: 'Stock negativo lote MP', detail: `${lot.materialName} ${lot.lotNumber}`, systemValue: lot.qtyAvailable, expectedValue: '>= 0', recommendation: 'Reparar seguro o ajustar inventario.', module: 'Lotes' });
    if (lot.status === 'liberado' && lot.qtyAvailable > 0 && lot.expiry && isExpired(lot.expiry, today)) issues.push({ id: uid('iss'), severity: 'crítico', control: 'Lote MP vencido disponible', detail: `${lot.materialName} ${lot.lotNumber}`, systemValue: lot.expiry, expectedValue: 'No vencido', recommendation: 'Bloquear o ajustar.', module: 'Lotes' });
  }

  for (const formula of state.formulas) {
    for (const ingredient of formula.ingredients) {
      if (!materialIds.has(ingredient.materialId)) issues.push({ id: uid('iss'), severity: 'crítico', control: 'Insumo de fórmula', detail: `${formula.name}: ${ingredient.materialName}`, systemValue: ingredient.materialId, expectedValue: 'Material existente', recommendation: 'Corregir fórmula.', module: 'Fórmulas' });
    }
  }

  const salesByOrder = new Map<string, number>();
  for (const sale of state.sales) {
    salesByOrder.set(sale.orderId, (salesByOrder.get(sale.orderId) ?? 0) + sale.total);
    if (sale.affectsStock && !productIds.has(sale.productId)) issues.push({ id: uid('iss'), severity: 'crítico', control: 'Venta con producto válido', detail: sale.productName, systemValue: sale.productId, expectedValue: 'Producto existente', recommendation: 'Corregir venta importada o mapear SKU.', module: 'Ventas' });
    if (!clientIds.has(sale.clientId)) issues.push({ id: uid('iss'), severity: 'atención', control: 'Venta con cliente válido', detail: sale.clientName, systemValue: sale.clientId, expectedValue: 'Cliente existente', recommendation: 'Crear cliente o corregir ID.', module: 'Clientes' });
  }
  for (const order of state.orders) {
    const lineTotal = salesByOrder.get(order.id) ?? 0;
    if (Math.abs(lineTotal - order.total) > 0.05) issues.push({ id: uid('iss'), severity: 'atención', control: 'Orden total = suma líneas', detail: order.id, systemValue: order.total, expectedValue: lineTotal.toFixed(2), recommendation: 'Revisar descuentos o importación.', module: 'Ventas' });
    if (order.balance > 0) issues.push({ id: uid('iss'), severity: 'info', control: 'Cliente con deuda', detail: `${order.clientName} / ${order.id}`, systemValue: order.balance, expectedValue: 0, recommendation: 'Registrar pago o seguimiento.', module: 'Clientes' });
  }
  return issues;
}

export function safeRepairState(state: AppState): OperationResult<AppState> {
  const next = clone(state);
  const auditEntries: AuditEntry[] = [];
  const today = todayISO();
  let changed = 0;
  for (const lot of next.productLots) {
    const before = lot.status;
    if (lot.qtyAvailable <= 0 && lot.status !== 'agotado') lot.status = 'agotado';
    if (lot.status === 'liberado' && lot.qtyAvailable > 0 && isExpired(lot.expiry, today)) lot.status = 'vencido';
    if (before !== lot.status) {
      changed += 1;
      auditEntries.push(audit({ entity: 'integridad', entityId: lot.id, field: 'status', before, after: lot.status, reason: 'Reparar seguro', origin: 'integridad', user: next.settings.currentUser }));
    }
  }
  for (const lot of next.materialLots) {
    const before = lot.status;
    if (lot.qtyAvailable <= 0 && lot.status !== 'agotado') lot.status = 'agotado';
    if (lot.status === 'liberado' && lot.qtyAvailable > 0 && lot.expiry && isExpired(lot.expiry, today)) lot.status = 'vencido';
    if (before !== lot.status) {
      changed += 1;
      auditEntries.push(audit({ entity: 'integridad', entityId: lot.id, field: 'status', before, after: lot.status, reason: 'Reparar seguro', origin: 'integridad', user: next.settings.currentUser }));
    }
  }
  return { ok: true, data: commitOperation(next, { patch: next, movements: [], auditEntries }), errors: [], warnings: [], movements: [], auditEntries, summary: { changed } };
}

export function dashboardMetrics(state: AppState) {
  const productValue = state.productLots.filter((l) => l.qtyAvailable > 0 && l.status !== 'rechazado').reduce((sum, lot) => sum + lot.qtyAvailable * lot.unitCost, 0);
  const materialValue = state.materialLots.filter((l) => l.qtyAvailable > 0 && l.status !== 'rechazado').reduce((sum, lot) => sum + lot.qtyAvailable * lot.unitCost, 0);
  const revenue = state.orders.filter((o) => o.status !== 'cancelada').reduce((sum, order) => sum + order.total, 0);
  const cogs = state.orders.filter((o) => o.status !== 'cancelada').reduce((sum, order) => sum + order.cogs, 0);
  const debt = state.orders.filter((o) => o.status !== 'cancelada').reduce((sum, order) => sum + order.balance, 0);
  const month = todayISO().slice(0, 7);
  const monthlyRevenue = state.orders.filter((o) => o.date.startsWith(month) && o.status !== 'cancelada').reduce((sum, order) => sum + order.total, 0);
  const expiringLots = [...state.productLots, ...state.materialLots].filter((lot) => lot.qtyAvailable > 0 && lot.status === 'liberado' && isNearExpiry(lot.expiry, state.settings.alertExpiryDays)).length;
  const lowProducts = state.products.filter((p) => p.active && productStock(state, p.id).available <= p.stockMin).length;
  const lowMaterials = state.materials.filter((m) => m.active && materialStock(state, m.id).available <= m.stockMin).length;
  const issues = runIntegrityChecks(state);
  const critical = issues.filter((i) => i.severity === 'crítico').length;
  const score = Math.max(0, Math.round(100 - critical * 8 - issues.filter((i) => i.severity === 'atención').length * 2));
  return { productValue, materialValue, inventoryValue: productValue + materialValue, revenue, monthlyRevenue, cogs, grossMargin: revenue - cogs, debt, expiringLots, lowProducts, lowMaterials, issueCount: issues.length, critical, score };
}

export function profitabilityByLine(state: AppState): Array<{ line: string; revenue: number; cost: number; margin: number; pct: number }> {
  const map = new Map<string, { line: string; revenue: number; cost: number }>();
  for (const sale of state.sales) {
    const product = state.products.find((p) => p.id === sale.productId);
    const line = product?.line || sale.parentCombo || 'Importado';
    const row = map.get(line) ?? { line, revenue: 0, cost: 0 };
    row.revenue += sale.total;
    row.cost += sale.cogs;
    map.set(line, row);
  }
  return [...map.values()].map((row) => ({ ...row, margin: row.revenue - row.cost, pct: row.revenue > 0 ? (row.revenue - row.cost) / row.revenue : 0 })).sort((a, b) => b.revenue - a.revenue);
}

export function clientMetrics(state: AppState, clientId: string) {
  const orders = state.orders.filter((o) => o.clientId === clientId && o.status !== 'cancelada');
  const sales = state.sales.filter((s) => s.clientId === clientId);
  const total = orders.reduce((sum, order) => sum + order.total, 0);
  const debt = orders.reduce((sum, order) => sum + order.balance, 0);
  const counts = new Map<string, { name: string; qty: number }>();
  for (const sale of sales) {
    const row = counts.get(sale.productId) ?? { name: sale.productName, qty: 0 };
    row.qty += sale.quantity;
    counts.set(sale.productId, row);
  }
  return { total, debt, orderCount: orders.length, averageTicket: orders.length ? total / orders.length : 0, lastPurchase: (() => { const dates = orders.map((o) => o.date).sort(); return dates.length ? dates[dates.length - 1] : null; })(), favoriteProducts: [...counts.values()].sort((a, b) => b.qty - a.qty).slice(0, 5), orders, sales };
}

export function supplierPriceHistory(state: AppState, supplierId: string) {
  return state.purchases.filter((p) => p.supplierId === supplierId).map((p) => ({ material: p.materialName, supplierId: p.supplierId, date: p.date, unitCost: p.unitCost })).sort((a, b) => b.date.localeCompare(a.date));
}

export function traceProductLot(state: AppState, lotId: string) {
  const lot = state.productLots.find((l) => l.id === lotId);
  if (!lot) return null;
  const sales = state.sales.filter((sale) => sale.lotsUsed.some((used) => used.lotId === lot.id));
  const clients = sales.map((sale) => state.clients.find((c) => c.id === sale.clientId)).filter(Boolean) as Client[];
  const suppliers = lot.materialsUsed.flatMap((line) => line.lotsUsed.map((used) => state.materialLots.find((ml) => ml.id === used.lotId)?.supplierId)).filter(Boolean);
  return { lot, sales, clients, supplierIds: Array.from(new Set(suppliers)) };
}

export function traceMaterialLot(state: AppState, lotId: string) {
  const lot = state.materialLots.find((l) => l.id === lotId);
  if (!lot) return null;
  const productLots = state.productLots.filter((pl) => pl.materialsUsed.some((mu) => mu.lotsUsed.some((used) => used.lotId === lot.id)));
  const sales = state.sales.filter((sale) => productLots.some((pl) => sale.lotsUsed.some((used) => used.lotId === pl.id)));
  const clients = sales.map((sale) => state.clients.find((c) => c.id === sale.clientId)).filter(Boolean) as Client[];
  return { lot, productLots, sales, clients };
}

export function addOrUpdateEntity<T extends { id: string }>(rows: T[], entity: T): T[] {
  const exists = rows.some((row) => row.id === entity.id);
  return exists ? rows.map((row) => row.id === entity.id ? entity : row) : [...rows, entity];
}

export function validateClientForSale(client?: Client): string | null {
  if (!client) return 'Cliente obligatorio.';
  if (client.status !== 'active') return 'No se puede vender a un cliente inactivo.';
  return null;
}

export function comboStockSummary(state: AppState, combo: Combo): StockSnapshot {
  if (!combo.components.length) return { system: 0, physical: null, available: 0, reserved: 0, status: 'none' };
  const possible = combo.components.map((c) => Math.floor(productStock(state, c.productId).available / Math.max(1, c.qty)));
  const available = Math.min(...possible);
  return { system: available, physical: null, available, reserved: 0, status: available <= 0 ? 'none' : 'ok' };
}
