import type { AppState, TestResult } from './types';
import { applyImport, buildExcelXml, parseCsv, rowsToObjects } from './importExport';
import { clone, sortBy, todayISO } from './utils';
import { applyInventoryCount, closeSale, previewProduction, previewPurchase, previewSale, productStock, registerProduction, runIntegrityChecks } from './engine';

function result(name: string, passed: boolean, detail: string): TestResult {
  return { name, passed, detail };
}

export function runInternalTests(state: AppState): TestResult[] {
  const tests: TestResult[] = [];

  const sorted = sortBy([{ name: 'b' }, { name: 'a' }], 'name', 'asc');
  const activeClient = state.clients.find((c) => c.status === 'active');
  const stockedProduct = state.products.find((p) => p.active && productStock(state, p.id).available > 0);
  tests.push(result('ordenamiento asc/desc', sorted[0]?.name === 'a', 'sortBy mantiene una única función de ordenamiento reusable.'));

  const excel = buildExcelXml(state);
  tests.push(result('export incluye ventas/lotes', excel.includes('ventas') && excel.includes('lotes PT') && excel.includes('lotes MP'), 'Exportación XML Spreadsheet contiene hojas clave.'));

  if (activeClient && stockedProduct) {
    const saleDraft = { date: todayISO(), clientId: activeClient.id, lines: [{ id: 't1', productId: stockedProduct.id, label: stockedProduct.name, quantity: 1, price: stockedProduct.listPrice || 1, listPrice: stockedProduct.listPrice || 1, discountPct: 0, discountAmount: 0, notes: '' }], orderDiscountPct: 0, orderDiscountAmount: 0, paymentMethod: 'efectivo', amountPaid: stockedProduct.listPrice || 1, notes: '' };
    const preview = previewSale(state, saleDraft);
    tests.push(result('FEFO consume lotes disponibles', preview.ok && Boolean((preview.summary?.stockLots as unknown[])?.length), 'La vista previa asigna lotes FEFO antes de cerrar.'));
  } else {
    tests.push(result('FEFO consume lotes disponibles', false, 'No hay cliente activo y producto con stock para ejecutar test.'));
  }

  const inactiveClient = clone(state.clients[0]);
  if (inactiveClient) {
    inactiveClient.status = 'inactive';
    const testState = clone(state);
    testState.clients = [inactiveClient, ...testState.clients.slice(1)];
    const saleDraft = { date: todayISO(), clientId: inactiveClient.id, lines: [], orderDiscountPct: 0, orderDiscountAmount: 0, paymentMethod: 'efectivo', amountPaid: 0, notes: '' };
    const preview = previewSale(testState, saleDraft);
    tests.push(result('venta requiere cliente activo', preview.errors.some((e) => e.includes('activo')), preview.errors.join(' | ')));
  }

  const prod = state.products.find((p) => p.formulaId);
  if (prod) {
    const invalidProd = previewProduction(state, { productId: prod.id, units: 0, lotNumber: '', producedAt: todayISO(), expiry: '', location: '', formulaId: prod.formulaId, notes: '' });
    tests.push(result('validación producción bloquea lote/unidades/vencimiento', invalidProd.errors.length >= 3, invalidProd.errors.join(' | ')));
  }

  const material = state.materials[0];
  const supplier = state.suppliers[0];
  if (material && supplier) {
    const purchaseErrors = previewPurchase(state, { date: todayISO(), supplierId: '', materialId: material.id, quantity: 0, unitCost: -1, lotNumber: '', expiry: '', notes: '' });
    tests.push(result('compra requiere proveedor/cantidad/costo', purchaseErrors.errors.length >= 3, purchaseErrors.errors.join(' | ')));
  }

  const integrityState = clone(state);
  if (integrityState.productLots[0]) integrityState.productLots[0].qtyAvailable = -1;
  tests.push(result('integridad detecta stock negativo', runIntegrityChecks(integrityState).some((i) => i.control.includes('negativo')), 'Se inyectó lote negativo y fue detectado.'));

  const countProduct = state.products.find((p) => p.active);
  if (countProduct) {
    const countResult = applyInventoryCount(state, { date: todayISO(), itemType: 'product', itemId: countProduct.id, countedQty: Math.max(0, productStock(state, countProduct.id).system), reason: 'conteo físico', notes: 'test' });
    tests.push(result('conteo genera movimiento y auditoría', countResult.ok && countResult.movements.length === 1 && countResult.auditEntries.length === 1, 'applyInventoryCount devuelve movimiento y auditoría.'));
  }

  const formulaProduct = state.products.find((p) => p.formulaId && p.sizeMl > 0);
  if (formulaProduct) {
    const prodPreview = previewProduction(state, { productId: formulaProduct.id, units: 1, lotNumber: `TEST-${Date.now()}`, producedAt: todayISO(), expiry: '2099-12-31', location: 'QA', formulaId: formulaProduct.formulaId, notes: '' });
    tests.push(result('consumo de producción numérico', prodPreview.ok || prodPreview.errors.some((e) => e.includes('Stock insuficiente')), 'La producción calcula consumos y valida disponibilidad.'));
  }

  if (activeClient && stockedProduct) {
    const draft = { date: todayISO(), clientId: activeClient.id, lines: [{ id: 't2', productId: stockedProduct.id, label: stockedProduct.name, quantity: 1, price: stockedProduct.listPrice || 1, listPrice: stockedProduct.listPrice || 1, discountPct: 0, discountAmount: 0, notes: '' }], orderDiscountPct: 0, orderDiscountAmount: 0, paymentMethod: 'efectivo', amountPaid: stockedProduct.listPrice || 1, notes: 'test' };
    const closed = closeSale(state, draft);
    tests.push(result('cierre de venta registra movimiento/auditoría', closed.ok && closed.movements.length > 0 && closed.auditEntries.length > 0, closed.errors.join(' | ') || 'OK'));
  }

  if (supplier && material) {
    tests.push(result('funciones QA disponibles', Boolean(registerProduction) && Boolean(previewPurchase), 'Los motores centrales están importables para pruebas unitarias futuras.'));
  }

  const supplierCsvHeaders = 'Nombre;Persona de contacto;Teléfono;E-mail;Dirección\nProveedor Uno;Ana Pérez;11-2222-3333;ana@proveedor.com;Calle 123';
  const supplierRows = rowsToObjects(parseCsv(supplierCsvHeaders));
  const importedSuppliers = applyImport(clone(state), 'proveedores', supplierRows);
  const supplierA = importedSuppliers.next.suppliers.find((s) => s.name === 'Proveedor Uno');
  tests.push(result(
    'importador proveedores mapea alias de contacto/teléfono/email',
    Boolean(supplierA && supplierA.contact === 'Ana Pérez' && supplierA.phone === '11-2222-3333' && supplierA.email === 'ana@proveedor.com'),
    supplierA ? `${supplierA.contact} | ${supplierA.phone} | ${supplierA.email}` : 'Proveedor no encontrado'
  ));

  const supplierCsvDelimited = 'name,contact,phone,email,address\nProveedor Dos,"Luis|María","11-4444-5555;11-6666-7777","compras@proveedor.com,ventas@proveedor.com","Av. Siempre Viva 742"';
  const supplierRowsDelimited = rowsToObjects(parseCsv(supplierCsvDelimited));
  const importedDelimited = applyImport(clone(state), 'proveedores', supplierRowsDelimited);
  const supplierB = importedDelimited.next.suppliers.find((s) => s.name === 'Proveedor Dos');
  tests.push(result(
    'importador proveedores conserva campos correctos con separadores',
    Boolean(supplierB && supplierB.contact === 'Luis|María' && supplierB.phone === '11-4444-5555;11-6666-7777' && supplierB.email === 'compras@proveedor.com,ventas@proveedor.com'),
    supplierB ? `${supplierB.contact} | ${supplierB.phone} | ${supplierB.email}` : 'Proveedor no encontrado'
  ));
  tests.push(result(
    'importador proveedores emite warning por múltiples valores',
    importedDelimited.warnings.some((warning) => warning.includes('múltiples valores')),
    importedDelimited.warnings.join(' | ') || 'Sin warnings'
  ));

  return tests;
}
