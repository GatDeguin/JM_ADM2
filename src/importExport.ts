import type { AppState, AuditEntry, Client, Material, Movement, Product, Purchase, Supplier } from './types';
import { audit, commitOperation, createMovement } from './engine';
import { csvEscape, fileDownload, nowISO, parseMl, safeJson, slug, toNumber, uid } from './utils';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if ((ch === ',' || ch === ';' || ch === '\t') && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  const headers = (rows[0] ?? []).map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] ?? '';
    });
    return obj;
  });
}

export function objectsToCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  const cols = headers ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const body = rows.map((row) => cols.map((h) => csvEscape(row[h])).join(';'));
  return [cols.map(csvEscape).join(';'), ...body].join('\n');
}

function lowerObject(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(row).forEach(([key, value]) => {
    out[key.trim().toLowerCase()] = value;
  });
  return out;
}

export type ImportDestination = 'clientes' | 'productos' | 'materiales' | 'proveedores' | 'compras';

export function applyImport(state: AppState, destination: ImportDestination, rows: Record<string, string>[]): { next: AppState; movements: Movement[]; auditEntries: AuditEntry[]; count: number; warnings: string[] } {
  const next = JSON.parse(JSON.stringify(state)) as AppState;
  const warnings: string[] = [];
  const movements: Movement[] = [];
  const auditEntries: AuditEntry[] = [];
  let count = 0;

  rows.forEach((original) => {
    const row = lowerObject(original);
    if (destination === 'clientes') {
      const id = row.id || row['id cliente'] || `cli-${slug(row.nombre || row.name || uid('cliente'))}`;
      const entity: Client = {
        id: id.startsWith('cli-') ? id : `cli-${id}`,
        name: row.nombre || row.name || 'Sin nombre',
        phone: row.telefono || row.teléfono || row.phone || '',
        email: row.mail || row.email || '',
        address: row.direccion || row.dirección || row.address || '',
        province: row.provincia || '',
        city: row.ciudad || row.localidad || '',
        segment: (row.segmento || row.segment || 'minorista') as Client['segment'],
        status: (row.status || row.estado || 'active').toLowerCase().startsWith('in') ? 'inactive' : 'active',
        notes: row.observaciones || row.notes || '',
        source: 'importación',
        lastPurchase: row.ultimacompra || row['fecha ultima compra'] || row['última compra'] || null
      };
      next.clients = next.clients.some((c) => c.id === entity.id) ? next.clients.map((c) => c.id === entity.id ? entity : c) : [...next.clients, entity];
      count += 1;
    }

    if (destination === 'productos') {
      const id = row.id || row.sku || `prod-${slug(row.nombre || row.producto || uid('producto'))}`;
      const name = row.nombre || row.producto || row.name || id;
      const size = row.tamaño || row.size || '';
      const entity: Product = {
        id,
        sku: row.sku || row.codigo || row.código || id,
        name,
        line: row.linea || row.línea || row.line || 'GENERAL',
        family: row.familia || row.family || 'OTRO',
        size,
        sizeMl: toNumber(row.sizeml, parseMl(size)),
        formulaId: row.formulaid || row.formula || null,
        stockMin: toNumber(row.stockmin || row['stock min'], 0),
        listPrice: toNumber(row.listprice || row.precio || row['precio de lista'], 0),
        costReference: toNumber(row.costreference || row.costo || row['costo referencia'], 0),
        shelfLifeMonths: toNumber(row.shelflifemonths || row.vencimiento || 24, 24),
        active: !(row.active || row.activo || 'true').toLowerCase().startsWith('false'),
        notes: row.notes || row.observaciones || ''
      };
      next.products = next.products.some((p) => p.id === entity.id) ? next.products.map((p) => p.id === entity.id ? entity : p) : [...next.products, entity];
      count += 1;
    }

    if (destination === 'materiales') {
      const id = row.id || `mat-${slug(row.nombre || row.material || uid('material'))}`;
      const entity: Material = {
        id,
        name: row.nombre || row.material || row.name || id,
        category: (row.categoria || row.categoría || row.category || 'materia prima') as Material['category'],
        unit: row.unidad || row.unit || 'u',
        stockMin: toNumber(row.stockmin || row['stock min'], 0),
        unitCost: toNumber(row.unitcost || row.costo || row['costo unitario'], 0),
        providerDefaultId: row.proveedor || row.providerdefaultid || null,
        active: !(row.active || row.activo || 'true').toLowerCase().startsWith('false'),
        notes: row.notes || row.observaciones || ''
      };
      next.materials = next.materials.some((m) => m.id === entity.id) ? next.materials.map((m) => m.id === entity.id ? entity : m) : [...next.materials, entity];
      count += 1;
    }

    if (destination === 'proveedores') {
      const id = row.id || `sup-${slug(row.nombre || row.name || uid('proveedor'))}`;
      const entity: Supplier = {
        id,
        name: row.nombre || row.name || id,
        address: row.direccion || row.dirección || row.address || '',
        contact: row.contacto || row.contact || '',
        phone: row.telefono || row.teléfono || row.phone || '',
        email: row.email || row.mail || '',
        notes: row.notes || row.observaciones || '',
        active: !(row.active || row.activo || 'true').toLowerCase().startsWith('false')
      };
      next.suppliers = next.suppliers.some((s) => s.id === entity.id) ? next.suppliers.map((s) => s.id === entity.id ? entity : s) : [...next.suppliers, entity];
      count += 1;
    }

    if (destination === 'compras') {
      const materialId = row.materialid || row.material || '';
      const supplierId = row.supplierid || row.proveedor || '';
      const material = next.materials.find((m) => m.id === materialId || m.name.toLowerCase() === materialId.toLowerCase());
      const supplier = next.suppliers.find((s) => s.id === supplierId || s.name.toLowerCase() === supplierId.toLowerCase());
      if (!material || !supplier) {
        warnings.push(`Compra omitida: falta material/proveedor (${materialId} / ${supplierId}).`);
        return;
      }
      const quantity = toNumber(row.cantidad || row.quantity, 0);
      const unitCost = toNumber(row.unitcost || row['costo unitario'] || row.costo, 0);
      if (quantity <= 0 || unitCost < 0) {
        warnings.push(`Compra omitida por cantidad/costo inválidos: ${material.name}.`);
        return;
      }
      const purchase: Purchase = {
        id: uid('pur'),
        date: row.fecha || row.date || new Date().toISOString().slice(0, 10),
        supplierId: supplier.id,
        materialId: material.id,
        materialName: material.name,
        lotNumber: row.lote || row.lotnumber || `IMP-${Date.now()}`,
        expiry: row.vencimiento || row.expiry || null,
        quantity,
        unit: material.unit,
        unitCost,
        total: quantity * unitCost,
        notes: row.notes || row.observaciones || 'Importación CSV'
      };
      next.purchases.push(purchase);
      next.materialLots.push({
        id: uid('mlt'), materialId: material.id, materialName: material.name, lotNumber: purchase.lotNumber, supplierId: supplier.id,
        receivedAt: purchase.date, expiry: purchase.expiry, status: 'liberado', location: 'Importación', qtyInitial: quantity, qtyAvailable: quantity, unitCost, source: 'importación'
      });
      movements.push(createMovement({ type: 'importación compra', entityType: 'purchase', entityId: purchase.id, item: material.name, quantity, unit: material.unit, value: purchase.total, reason: 'Importación CSV', sourceDocument: 'importador', lotNumber: purchase.lotNumber, user: next.settings.currentUser }));
      count += 1;
    }
  });

  auditEntries.push(audit({ entity: 'importador', entityId: destination, field: 'rows', before: 0, after: count, reason: 'Importación confirmada', origin: 'importación', user: next.settings.currentUser }));
  return { next: commitOperation(next, { patch: next, movements, auditEntries }), movements, auditEntries, count, warnings };
}

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function valueType(value: unknown): 'Number' | 'String' {
  return typeof value === 'number' && Number.isFinite(value) ? 'Number' : 'String';
}

function flatten(value: unknown): unknown {
  if (value == null) return '';
  if (typeof value === 'object') return safeJson(value);
  return value;
}

function sheetXml(name: string, rows: Record<string, unknown>[]): string {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const headerRow = `<Row>${headers.map((h) => `<Cell ss:StyleID="header"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`).join('')}</Row>`;
  const body = rows.map((row) => `<Row>${headers.map((h) => {
    const value = flatten(row[h]);
    return `<Cell><Data ss:Type="${valueType(value)}">${xmlEscape(value)}</Data></Cell>`;
  }).join('')}</Row>`).join('');
  return `<Worksheet ss:Name="${xmlEscape(name.slice(0, 31))}"><Table>${headerRow}${body}</Table></Worksheet>`;
}

export function buildExcelXml(state: AppState): string {
  const sheets: Array<[string, Record<string, unknown>[]]> = [
    ['productos', state.products as unknown as Record<string, unknown>[]],
    ['materias', state.materials as unknown as Record<string, unknown>[]],
    ['lotes PT', state.productLots as unknown as Record<string, unknown>[]],
    ['lotes MP', state.materialLots as unknown as Record<string, unknown>[]],
    ['compras', state.purchases as unknown as Record<string, unknown>[]],
    ['proveedores', state.suppliers as unknown as Record<string, unknown>[]],
    ['formulas', state.formulas as unknown as Record<string, unknown>[]],
    ['clientes', state.clients as unknown as Record<string, unknown>[]],
    ['precios', state.products.map((p) => ({ id: p.id, sku: p.sku, producto: p.name, costoReferencia: p.costReference, precioLista: p.listPrice, margen: p.listPrice - p.costReference, margenPct: p.listPrice ? (p.listPrice - p.costReference) / p.listPrice : 0 }))],
    ['combos', state.combos as unknown as Record<string, unknown>[]],
    ['ordenes', state.orders as unknown as Record<string, unknown>[]],
    ['ventas', state.sales as unknown as Record<string, unknown>[]],
    ['inventario', state.inventoryCounts as unknown as Record<string, unknown>[]],
    ['auditoria', state.auditLog as unknown as Record<string, unknown>[]],
    ['movimientos', state.movements as unknown as Record<string, unknown>[]]
  ];
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="header"><Font ss:Bold="1"/><Interior ss:Color="#D8C2A7" ss:Pattern="Solid"/></Style></Styles>
${sheets.map(([name, rows]) => sheetXml(name, rows)).join('\n')}
</Workbook>`;
}

export function exportFullExcel(state: AppState): void {
  fileDownload(`JM-Stock-Suite-${new Date().toISOString().slice(0, 10)}.xls`, buildExcelXml(state), 'application/vnd.ms-excel;charset=utf-8');
}

export function exportModuleCsv(state: AppState, module: string): void {
  const map: Record<string, Record<string, unknown>[]> = {
    productos: state.products as unknown as Record<string, unknown>[],
    materiales: state.materials as unknown as Record<string, unknown>[],
    clientes: state.clients as unknown as Record<string, unknown>[],
    proveedores: state.suppliers as unknown as Record<string, unknown>[],
    compras: state.purchases as unknown as Record<string, unknown>[],
    ventas: state.sales as unknown as Record<string, unknown>[],
    ordenes: state.orders as unknown as Record<string, unknown>[],
    movimientos: state.movements as unknown as Record<string, unknown>[],
    auditoria: state.auditLog as unknown as Record<string, unknown>[]
  };
  const rows = map[module] ?? [];
  fileDownload(`JM-${module}-${nowISO().slice(0, 10)}.csv`, objectsToCsv(rows), 'text/csv;charset=utf-8');
}

export function templateCsv(destination: ImportDestination): string {
  const templates: Record<ImportDestination, string[]> = {
    clientes: ['id', 'nombre', 'telefono', 'email', 'direccion', 'provincia', 'ciudad', 'segmento', 'status', 'observaciones'],
    productos: ['id', 'sku', 'nombre', 'linea', 'familia', 'tamaño', 'sizeMl', 'stockMin', 'precio', 'costo', 'activo', 'observaciones'],
    materiales: ['id', 'nombre', 'categoria', 'unidad', 'stockMin', 'costo unitario', 'proveedor', 'activo', 'observaciones'],
    proveedores: ['id', 'nombre', 'direccion', 'contacto', 'telefono', 'email', 'activo', 'observaciones'],
    compras: ['fecha', 'proveedor', 'material', 'cantidad', 'costo unitario', 'lote', 'vencimiento', 'observaciones']
  };
  return `${templates[destination].join(';')}\n`;
}
