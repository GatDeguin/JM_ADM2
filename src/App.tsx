import { useEffect, useMemo, useState } from 'react';
import type { AppState, Client, Combo, Formula, InventoryDraft, Material, Product, ProductionDraft, PurchaseDraft, SaleDraft, SaleDraftLine, Supplier } from './types';
import { Badge, CommandPalette, ConfirmModal, Drawer, EmptyState, Field, KPI, LogoMark, MiniStat, Modal, ProgressBar, SmartTable, StockTriple } from './components';
import { applyImport, buildExcelXml, exportFullExcel, exportModuleCsv, ImportDestination, parseCsv, rowsToObjects, templateCsv } from './importExport';
import { exportBackup, freshSeedState, loadState, restoreBackup, saveState } from './storage';
import { addOrUpdateEntity, audit, clientMetrics, closeSale, comboStockSummary, commitOperation, createMovement, dashboardMetrics, materialStock, previewInventoryCount, previewProduction, previewPurchase, previewSale, productStock, profitabilityByLine, registerProduction, registerPurchase, runIntegrityChecks, safeRepairState, suggestedExpiryForProduct, supplierPriceHistory, traceMaterialLot, traceProductLot, applyInventoryCount } from './engine';
import { addMonths, dateLabel, fileDownload, includesText, money, nowISO, parseMl, qty, slug, todayISO, toNumber, uid } from './utils';
import { runInternalTests } from './tests';

const pages = ['Dashboard', 'Ventas', 'Producción', 'Compras', 'Inventario físico', 'Productos', 'Materiales', 'Fórmulas', 'Lotes', 'Clientes', 'Proveedores', 'Costos', 'Combos', 'Movimientos', 'Auditoría', 'Integridad', 'Importar/Exportar', 'Ajustes'];
const paymentMethods = ['efectivo', 'transferencia', 'Mercado Pago', 'tarjeta', 'cuenta corriente', 'canje', 'seña'];
const countReasons = ['conteo físico', 'rotura', 'vencimiento', 'error de carga', 'devolución', 'muestra', 'uso interno'];

interface DrawerState { type: string; id: string }
interface PendingConfirm { title: string; body: React.ReactNode; label?: string; danger?: boolean; onConfirm: () => void }
interface Toast { text: string; tone: 'good' | 'warn' | 'danger' | 'info' }

function useDebouncedSave(state: AppState | null, enabled: boolean, notify: (toast: Toast) => void) {
  useEffect(() => {
    if (!state || !enabled) return undefined;
    const handle = window.setTimeout(() => {
      saveState(state).catch(() => notify({ text: 'No se pudo guardar en IndexedDB. Se conserva fallback local si el navegador lo permite.', tone: 'warn' }));
    }, 450);
    return () => window.clearTimeout(handle);
  }, [state, enabled, notify]);
}

function Section({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="page-section">
      <header className="section-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

function ErrorList({ errors, warnings }: { errors: string[]; warnings?: string[] }) {
  if (!errors.length && !warnings?.length) return null;
  return (
    <div className="validation-box">
      {errors.map((error) => <div key={error} className="danger-line">● {error}</div>)}
      {warnings?.map((warning) => <div key={warning} className="warn-line">● {warning}</div>)}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState('Dashboard');
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = (nextToast: Toast) => {
    setToast(nextToast);
    window.setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    loadState().then((loadedState) => {
      setState(loadedState);
      setLoaded(true);
    });
  }, []);

  useDebouncedSave(state, loaded, notify);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setDrawer(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const applyState = (next: AppState, message: string, tone: Toast['tone'] = 'good') => {
    setState(next);
    notify({ text: message, tone });
  };

  if (!state) {
    return (
      <main className="loading-screen">
        <LogoMark />
        <div className="loader" />
        <p>Cargando base local IndexedDB…</p>
      </main>
    );
  }

  const openDrawer = (type: string, id: string) => setDrawer({ type, id });
  const exportSuite = () => exportFullExcel(state);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <LogoMark />
        <nav>
          {pages.map((item) => <button key={item} className={page === item ? 'active' : ''} onClick={() => setPage(item)}>{item}</button>)}
        </nav>
        <button className="command-button" onClick={() => setPaletteOpen(true)}>⌘K Command palette</button>
      </aside>
      <main className="workspace">
        <TopBar state={state} onExport={exportSuite} onBackup={() => fileDownload(`JM-Stock-Backup-${todayISO()}.json`, exportBackup(state), 'application/json;charset=utf-8')} />
        {renderPage(page, state, applyState, setPendingConfirm, openDrawer, setPage)}
      </main>
      {drawer && <EntityDrawer state={state} drawer={drawer} onClose={() => setDrawer(null)} onOpenDrawer={openDrawer} />}
      {pendingConfirm && (
        <ConfirmModal title={pendingConfirm.title} confirmLabel={pendingConfirm.label} danger={pendingConfirm.danger} onCancel={() => setPendingConfirm(null)} onConfirm={() => { const action = pendingConfirm.onConfirm; setPendingConfirm(null); action(); }}>
          {pendingConfirm.body}
        </ConfirmModal>
      )}
      <CommandPalette state={state} open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={setPage} onOpenDrawer={openDrawer} onExport={exportSuite} />
      {toast && <div className={`toast ${toast.tone}`}>{toast.text}</div>}
    </div>
  );
}

function TopBar({ state, onExport, onBackup }: { state: AppState; onExport: () => void; onBackup: () => void }) {
  const metrics = dashboardMetrics(state);
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">Local-first · IndexedDB · GitHub Pages ready</span>
        <strong>Operación JM Hair Cosmetic</strong>
      </div>
      <div className="topbar-actions">
        <Badge label={`Salud ${metrics.score}%`} tone={metrics.critical ? 'danger' : metrics.score < 80 ? 'warn' : 'good'} />
        <button className="ghost" onClick={onBackup}>Backup JSON</button>
        <button className="primary" onClick={onExport}>Exportar Excel</button>
      </div>
    </header>
  );
}

function renderPage(page: string, state: AppState, applyState: (state: AppState, message: string, tone?: Toast['tone']) => void, setPendingConfirm: (confirm: PendingConfirm | null) => void, openDrawer: (type: string, id: string) => void, setPage: (page: string) => void) {
  const common = { state, applyState, setPendingConfirm, openDrawer, setPage };
  switch (page) {
    case 'Ventas': return <SalesPage {...common} />;
    case 'Producción': return <ProductionPage {...common} />;
    case 'Compras': return <PurchasePage {...common} />;
    case 'Inventario físico': return <InventoryPage {...common} />;
    case 'Productos': return <ProductsPage {...common} />;
    case 'Materiales': return <MaterialsPage {...common} />;
    case 'Fórmulas': return <FormulasPage {...common} />;
    case 'Lotes': return <LotsPage {...common} />;
    case 'Clientes': return <ClientsPage {...common} />;
    case 'Proveedores': return <SuppliersPage {...common} />;
    case 'Costos': return <CostsPage {...common} />;
    case 'Combos': return <CombosPage {...common} />;
    case 'Movimientos': return <MovementsPage {...common} />;
    case 'Auditoría': return <AuditPage {...common} />;
    case 'Integridad': return <IntegrityPage {...common} />;
    case 'Importar/Exportar': return <ImportExportPage {...common} />;
    case 'Ajustes': return <SettingsPage {...common} />;
    default: return <DashboardPage {...common} />;
  }
}

function DashboardPage({ state, openDrawer, setPage }: PageProps) {
  const metrics = dashboardMetrics(state);
  const lineProfit = profitabilityByLine(state).slice(0, 8);
  const issues = runIntegrityChecks(state);
  const lastMovements = state.movements.slice(-8).reverse();
  const lastOrders = state.orders.slice(-8).reverse();
  const expiring = [
    ...state.productLots.filter((l) => l.qtyAvailable > 0 && l.status === 'liberado').map((l) => ({ id: l.id, type: 'productLot', name: l.productName, lot: l.lotNumber, expiry: l.expiry })),
    ...state.materialLots.filter((l) => l.qtyAvailable > 0 && l.status === 'liberado').map((l) => ({ id: l.id, type: 'materialLot', name: l.materialName, lot: l.lotNumber, expiry: l.expiry || '' }))
  ].filter((l) => l.expiry && l.expiry >= todayISO()).sort((a, b) => a.expiry.localeCompare(b.expiry)).slice(0, 8);
  return (
    <Section title="Dashboard financiero y operativo" subtitle="Valor de inventario, facturación, margen, deuda, alertas, vencimientos y salud operativa.">
      <div className="kpi-grid">
        <KPI label="Inventario total" value={money(metrics.inventoryValue)} hint="PT + MP/envases" />
        <KPI label="Producto terminado" value={money(metrics.productValue)} />
        <KPI label="MP / packaging" value={money(metrics.materialValue)} />
        <KPI label="Facturación total" value={money(metrics.revenue)} tone="good" />
        <KPI label="Facturación mensual" value={money(metrics.monthlyRevenue)} />
        <KPI label="Margen bruto" value={money(metrics.grossMargin)} tone={metrics.grossMargin >= 0 ? 'good' : 'danger'} />
        <KPI label="Deuda clientes" value={money(metrics.debt)} tone={metrics.debt > 0 ? 'warn' : 'good'} />
        <KPI label="Salud operativa" value={`${metrics.score}%`} hint={`${metrics.issueCount} controles`} tone={metrics.critical ? 'danger' : metrics.score < 80 ? 'warn' : 'good'} />
      </div>
      <div className="grid two">
        <div className="card">
          <header className="card-head"><h3>Rentabilidad por línea</h3><button className="ghost" onClick={() => setPage('Costos')}>Ver costos</button></header>
          <SmartTable rows={lineProfit} dense columns={[
            { key: 'line', header: 'Línea' },
            { key: 'revenue', header: 'Facturación', value: (r) => r.revenue, render: (r) => money(r.revenue) },
            { key: 'cost', header: 'Costo', value: (r) => r.cost, render: (r) => money(r.cost) },
            { key: 'margin', header: 'Margen', value: (r) => r.margin, render: (r) => money(r.margin) },
            { key: 'pct', header: '%', value: (r) => r.pct, render: (r) => `${Math.round(r.pct * 100)}%` }
          ]} />
        </div>
        <div className="card">
          <header className="card-head"><h3>Alertas prioritarias</h3><button className="ghost" onClick={() => setPage('Integridad')}>Abrir integridad</button></header>
          <div className="issue-list compact">
            {issues.slice(0, 8).map((issue) => <div key={issue.id} className="issue-row"><Badge label={issue.severity} tone={issue.severity === 'crítico' ? 'danger' : issue.severity === 'atención' ? 'warn' : 'info'} /><span>{issue.control}</span><small>{issue.detail}</small></div>)}
            {!issues.length && <EmptyState title="Sin alertas" text="Los controles principales están limpios." />}
          </div>
        </div>
      </div>
      <div className="grid three">
        <div className="card">
          <h3>Vencimientos próximos</h3>
          {expiring.map((lot) => <button className="list-button" key={`${lot.type}-${lot.id}`} onClick={() => openDrawer(lot.type, lot.id)}><strong>{lot.name}</strong><span>{lot.lot} · {dateLabel(lot.expiry)}</span></button>)}
          {!expiring.length && <EmptyState title="Sin vencimientos inmediatos" text="No hay lotes liberados próximos a vencer." />}
        </div>
        <div className="card">
          <h3>Últimas órdenes</h3>
          {lastOrders.map((order) => <button className="list-button" key={order.id} onClick={() => openDrawer('order', order.id)}><strong>{order.clientName}</strong><span>{dateLabel(order.date)} · {money(order.total)}</span></button>)}
        </div>
        <div className="card">
          <h3>Últimos movimientos</h3>
          {lastMovements.map((mov) => <div className="movement-line" key={mov.id}><strong>{mov.type}</strong><span>{mov.item}</span><em>{qty(mov.qty, mov.unit)}</em></div>)}
        </div>
      </div>
    </Section>
  );
}

interface PageProps {
  state: AppState;
  applyState: (state: AppState, message: string, tone?: Toast['tone']) => void;
  setPendingConfirm: (confirm: PendingConfirm | null) => void;
  openDrawer: (type: string, id: string) => void;
  setPage: (page: string) => void;
}

function SalesPage({ state, applyState, setPendingConfirm, openDrawer }: PageProps) {
  const [draft, setDraft] = useState<SaleDraft>({ date: todayISO(), clientId: '', lines: [], orderDiscountPct: 0, orderDiscountAmount: 0, paymentMethod: 'efectivo', amountPaid: 0, notes: '' });
  const [mode, setMode] = useState<'product' | 'combo'>('product');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedCombo, setSelectedCombo] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [linePrice, setLinePrice] = useState(0);
  const [lineDiscountPct, setLineDiscountPct] = useState(0);
  const [lineDiscountAmount, setLineDiscountAmount] = useState(0);
  const [duplicate, setDuplicate] = useState<SaleDraftLine | null>(null);
  const preview = useMemo(() => previewSale(state, draft), [state, draft]);
  const activeClients = state.clients.filter((c) => c.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const products = state.products.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const combos = state.combos.filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  useEffect(() => {
    if (mode === 'product') {
      const product = state.products.find((p) => p.id === selectedProduct);
      setLinePrice(product?.listPrice || 0);
    } else {
      const combo = state.combos.find((c) => c.id === selectedCombo);
      setLinePrice(combo?.price || 0);
    }
  }, [mode, selectedProduct, selectedCombo, state.products, state.combos]);

  const pushLine = (line: SaleDraftLine, merge: boolean) => {
    setDraft((old) => {
      const duplicateIndex = old.lines.findIndex((item) => (line.productId && item.productId === line.productId && !item.comboId) || (line.comboId && item.comboId === line.comboId));
      if (merge && duplicateIndex >= 0) {
        const lines = [...old.lines];
        lines[duplicateIndex] = { ...lines[duplicateIndex], quantity: lines[duplicateIndex].quantity + line.quantity };
        return { ...old, lines };
      }
      return { ...old, lines: [...old.lines, line] };
    });
  };

  const addLine = () => {
    const product = state.products.find((p) => p.id === selectedProduct);
    const combo = state.combos.find((c) => c.id === selectedCombo);
    const line: SaleDraftLine | null = mode === 'product' && product ? { id: uid('line'), productId: product.id, label: product.name, quantity, price: linePrice || product.listPrice, listPrice: product.listPrice, discountPct: lineDiscountPct, discountAmount: lineDiscountAmount, notes: '' } : mode === 'combo' && combo ? { id: uid('line'), comboId: combo.id, label: combo.name, quantity, price: linePrice || combo.price, listPrice: combo.price, discountPct: lineDiscountPct, discountAmount: lineDiscountAmount, notes: '' } : null;
    if (!line) return;
    const hasDuplicate = draft.lines.some((item) => (line.productId && item.productId === line.productId && !item.comboId) || (line.comboId && item.comboId === line.comboId));
    if (hasDuplicate) setDuplicate(line);
    else pushLine(line, false);
  };

  const confirmSale = () => {
    const currentPreview = previewSale(state, draft);
    if (!currentPreview.ok) return;
    setPendingConfirm({
      title: 'Confirmar cierre de venta',
      label: 'Cerrar venta',
      body: <SaleConfirmation preview={currentPreview} draft={draft} />,
      onConfirm: () => {
        const result = closeSale(state, draft);
        if (result.ok && result.data) {
          applyState(result.data, `Venta cerrada. Orden ${(result.summary?.order as { id: string })?.id ?? ''}`);
          setDraft({ date: todayISO(), clientId: '', lines: [], orderDiscountPct: 0, orderDiscountAmount: 0, paymentMethod: 'efectivo', amountPaid: 0, notes: '' });
        }
      }
    });
  };

  return (
    <Section title="Ventas" subtitle="Orden con cliente activo, carrito multilínea, descuentos, pagos parciales, deuda y descuento FEFO.">
      <div className="grid two sale-layout">
        <div className="card form-card">
          <div className="form-grid two-cols">
            <Field label="Cliente activo">
              <select value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}>
                <option value="">Seleccionar cliente…</option>
                {activeClients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.city}</option>)}
              </select>
            </Field>
            <Field label="Fecha">
              <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </Field>
          </div>
          <div className="line-builder">
            <div className="segmented">
              <button className={mode === 'product' ? 'active' : ''} onClick={() => setMode('product')}>Producto</button>
              <button className={mode === 'combo' ? 'active' : ''} onClick={() => setMode('combo')}>Combo / promo</button>
            </div>
            {mode === 'product' ? (
              <Field label="Producto">
                <select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
                  <option value="">Seleccionar producto…</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} · stock {qty(productStock(state, product.id).available)}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Combo">
                <select value={selectedCombo} onChange={(e) => setSelectedCombo(e.target.value)}>
                  <option value="">Seleccionar combo…</option>
                  {combos.map((combo) => <option key={combo.id} value={combo.id}>{combo.name} · {money(combo.price)} · stock {qty(comboStockSummary(state, combo).available)}</option>)}
                </select>
              </Field>
            )}
            <div className="form-grid four-cols">
              <Field label="Cantidad"><input type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(toNumber(e.target.value, 1))} /></Field>
              <Field label="Precio"><input type="number" min="0" step="0.01" value={linePrice} onChange={(e) => setLinePrice(toNumber(e.target.value))} /></Field>
              <Field label="Desc. %"><input type="number" min="0" step="0.01" value={lineDiscountPct} onChange={(e) => setLineDiscountPct(toNumber(e.target.value))} /></Field>
              <Field label="Desc. $"><input type="number" min="0" step="0.01" value={lineDiscountAmount} onChange={(e) => setLineDiscountAmount(toNumber(e.target.value))} /></Field>
            </div>
            <button className="primary" onClick={addLine}>Agregar línea</button>
          </div>
          <div className="cart">
            <header className="card-head"><h3>Carrito</h3><span>{draft.lines.length} líneas</span></header>
            {draft.lines.length ? (
              <SmartTable rows={draft.lines} dense columns={[
                { key: 'label', header: 'Producto / combo' },
                { key: 'quantity', header: 'Cant.', value: (r) => r.quantity, render: (r) => qty(r.quantity) },
                { key: 'price', header: 'Precio', value: (r) => r.price, render: (r) => money(r.price) },
                { key: 'discountPct', header: 'Desc.', render: (r) => `${r.discountPct}% + ${money(r.discountAmount)}` },
                { key: 'remove', header: '', render: (r) => <button className="ghost danger-text" onClick={(event) => { event.stopPropagation(); setDraft({ ...draft, lines: draft.lines.filter((line) => line.id !== r.id) }); }}>Quitar</button> }
              ]} />
            ) : <EmptyState title="Carrito vacío" text="Agregá productos o combos para preparar la orden." />}
          </div>
        </div>
        <div className="card sticky-card">
          <h3>Resumen de orden</h3>
          <div className="form-grid two-cols">
            <Field label="Desc. general %"><input type="number" min="0" value={draft.orderDiscountPct} onChange={(e) => setDraft({ ...draft, orderDiscountPct: toNumber(e.target.value) })} /></Field>
            <Field label="Desc. general $"><input type="number" min="0" value={draft.orderDiscountAmount} onChange={(e) => setDraft({ ...draft, orderDiscountAmount: toNumber(e.target.value) })} /></Field>
            <Field label="Método de pago"><select value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })}>{paymentMethods.map((m) => <option key={m}>{m}</option>)}</select></Field>
            <Field label="Monto pagado"><input type="number" min="0" value={draft.amountPaid} onChange={(e) => setDraft({ ...draft, amountPaid: toNumber(e.target.value) })} /></Field>
          </div>
          <Field label="Observaciones"><textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          <ErrorList errors={preview.errors} warnings={preview.warnings} />
          <div className="totals">
            <span>Subtotal <b>{money(Number(preview.summary?.subtotal) || 0)}</b></span>
            <span>Descuentos <b>{money((Number(preview.summary?.lineDiscountTotal) || 0) + (Number(preview.summary?.orderDiscountTotal) || 0))}</b></span>
            <span>Total <b>{money(Number(preview.summary?.total) || 0)}</b></span>
            <span>COGS estimado <b>{money(Number(preview.summary?.cogs) || 0)}</b></span>
            <span>Margen <b>{money(Number(preview.summary?.grossMargin) || 0)}</b></span>
            <span>Saldo/deuda <b>{money(Number(preview.summary?.balance) || 0)}</b></span>
          </div>
          <button className="primary wide-button" disabled={!preview.ok} onClick={confirmSale}>Cerrar venta</button>
          {draft.clientId && <button className="ghost wide-button" onClick={() => openDrawer('client', draft.clientId)}>Ver ficha cliente</button>}
        </div>
      </div>
      {duplicate && (
        <Modal title="Producto duplicado en carrito" onClose={() => setDuplicate(null)} footer={<><button className="ghost" onClick={() => { pushLine(duplicate, false); setDuplicate(null); }}>Agregar línea separada</button><button className="primary" onClick={() => { pushLine(duplicate, true); setDuplicate(null); }}>Sumar cantidad</button></>}>
          <p>Ya existe una línea para <b>{duplicate.label}</b>. Elegí cómo querés registrarla.</p>
        </Modal>
      )}
    </Section>
  );
}

function SaleConfirmation({ preview, draft }: { preview: ReturnType<typeof previewSale>; draft: SaleDraft }) {
  const summary = preview.summary as Record<string, unknown> | undefined;
  const client = summary?.client as Client | undefined;
  const stockLots = (summary?.stockLots as Array<{ productName: string; lotNumber: string; qty: number; expiry?: string }>) ?? [];
  return (
    <div className="confirm-grid">
      <MiniStat label="Cliente" value={client?.name ?? '—'} />
      <MiniStat label="Subtotal" value={money(Number(summary?.subtotal) || 0)} />
      <MiniStat label="Descuentos" value={money((Number(summary?.lineDiscountTotal) || 0) + (Number(summary?.orderDiscountTotal) || 0))} />
      <MiniStat label="Total" value={money(Number(summary?.total) || 0)} />
      <MiniStat label="Pago" value={money(draft.amountPaid)} />
      <MiniStat label="Saldo" value={money(Number(summary?.balance) || 0)} />
      <MiniStat label="Margen estimado" value={money(Number(summary?.grossMargin) || 0)} />
      <div className="full-span">
        <h4>Stock a descontar por FEFO</h4>
        <SmartTable rows={stockLots} dense columns={[{ key: 'productName', header: 'Producto' }, { key: 'lotNumber', header: 'Lote' }, { key: 'qty', header: 'Cantidad', render: (r) => qty(r.qty) }, { key: 'expiry', header: 'Vence', render: (r) => dateLabel(r.expiry) }]} />
      </div>
      <ErrorList errors={preview.errors} warnings={preview.warnings} />
    </div>
  );
}

function ProductionPage({ state, applyState, setPendingConfirm, openDrawer }: PageProps) {
  const first = state.products.find((p) => p.active && p.formulaId);
  const [draft, setDraft] = useState<ProductionDraft>({ productId: first?.id ?? '', units: 1, lotNumber: '', producedAt: todayISO(), expiry: first ? suggestedExpiryForProduct(state, first.id, todayISO()) : addMonths(todayISO(), 24), location: 'Depósito principal', formulaId: first?.formulaId ?? null, notes: '' });
  const product = state.products.find((p) => p.id === draft.productId);
  const formulas = state.formulas.filter((f) => f.active && (!product?.id || !f.productId || f.productId === product.id || f.id === product.formulaId));
  const preview = useMemo(() => previewProduction(state, draft), [state, draft]);

  useEffect(() => {
    const prod = state.products.find((p) => p.id === draft.productId);
    if (prod) setDraft((old) => ({ ...old, formulaId: prod.formulaId ?? old.formulaId, expiry: suggestedExpiryForProduct(state, prod.id, old.producedAt) }));
  }, [draft.productId]);

  const confirm = () => {
    if (!preview.ok) return;
    setPendingConfirm({
      title: 'Confirmar producción',
      label: 'Registrar producción',
      body: <ProductionConfirmation preview={preview} draft={draft} />,
      onConfirm: () => {
        const result = registerProduction(state, draft);
        if (result.ok && result.data) {
          applyState(result.data, `Producción registrada: ${draft.lotNumber}`);
          setDraft({ ...draft, lotNumber: '', units: 1 });
        }
      }
    });
  };

  return (
    <Section title="Producción" subtitle="Genera lote terminado, consume materias/envases/tapas/etiquetas por FEFO y calcula costo real.">
      <div className="grid two">
        <div className="card form-card">
          <div className="form-grid two-cols">
            <Field label="Producto">
              <select value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })}>
                <option value="">Seleccionar producto…</option>
                {state.products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name} · {p.size}</option>)}
              </select>
            </Field>
            <Field label="Fórmula">
              <select value={draft.formulaId ?? ''} onChange={(e) => setDraft({ ...draft, formulaId: e.target.value })}>
                <option value="">Seleccionar fórmula…</option>
                {formulas.map((f) => <option key={f.id} value={f.id}>{f.name} · {f.revision}</option>)}
              </select>
            </Field>
            <Field label="Unidades a producir"><input type="number" min="0" step="1" value={draft.units} onChange={(e) => setDraft({ ...draft, units: toNumber(e.target.value) })} /></Field>
            <Field label="Número de lote"><input value={draft.lotNumber} onChange={(e) => setDraft({ ...draft, lotNumber: e.target.value })} placeholder="Ej. JM-CH-2405" /></Field>
            <Field label="Fecha producción"><input type="date" value={draft.producedAt} onChange={(e) => setDraft({ ...draft, producedAt: e.target.value, expiry: product ? suggestedExpiryForProduct(state, product.id, e.target.value) : draft.expiry })} /></Field>
            <Field label="Vencimiento"><input type="date" value={draft.expiry} onChange={(e) => setDraft({ ...draft, expiry: e.target.value })} /></Field>
            <Field label="Ubicación"><input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></Field>
          </div>
          <Field label="Notas"><textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          <ErrorList errors={preview.errors} warnings={preview.warnings} />
          <button className="primary wide-button" disabled={!preview.ok} onClick={confirm}>Registrar producción</button>
          {draft.productId && <button className="ghost wide-button" onClick={() => openDrawer('product', draft.productId)}>Ver ficha producto</button>}
        </div>
        <div className="card sticky-card">
          <h3>Precosteo del lote</h3>
          <div className="totals">
            <span>Materia prima <b>{money(Number((preview.summary?.costBreakdown as { materials?: number })?.materials) || 0)}</b></span>
            <span>Packaging <b>{money(Number((preview.summary?.costBreakdown as { packaging?: number })?.packaging) || 0)}</b></span>
            <span>Mano de obra <b>{money(Number((preview.summary?.costBreakdown as { labor?: number })?.labor) || 0)}</b></span>
            <span>Indirectos <b>{money(Number((preview.summary?.costBreakdown as { indirect?: number })?.indirect) || 0)}</b></span>
            <span>Total lote <b>{money(Number((preview.summary?.costBreakdown as { total?: number })?.total) || 0)}</b></span>
            <span>Costo unitario <b>{money(Number(preview.summary?.unitCost) || 0)}</b></span>
          </div>
          <h4>Consumo sugerido FEFO</h4>
          <SmartTable rows={((preview.summary?.materialsUsed as unknown[]) ?? []) as Array<{ materialName: string; qty: number; unit: string; cost: number; lotsUsed: unknown[] }>} dense maxRows={12} columns={[
            { key: 'materialName', header: 'Insumo' },
            { key: 'qty', header: 'Cantidad', render: (r) => qty(r.qty, r.unit) },
            { key: 'cost', header: 'Costo', render: (r) => money(r.cost) },
            { key: 'lots', header: 'Lotes', render: (r) => r.lotsUsed.length }
          ]} />
        </div>
      </div>
    </Section>
  );
}

function ProductionConfirmation({ preview, draft }: { preview: ReturnType<typeof previewProduction>; draft: ProductionDraft }) {
  const summary = preview.summary as Record<string, unknown> | undefined;
  const product = summary?.product as Product | undefined;
  const formula = summary?.formula as Formula | undefined;
  const materialsUsed = ((summary?.materialsUsed as unknown[]) ?? []) as Array<{ materialName: string; qty: number; unit: string; cost: number; lotsUsed: Array<{ lotNumber: string; qty: number }> }>;
  const costs = summary?.costBreakdown as { materials?: number; packaging?: number; labor?: number; indirect?: number; total?: number } | undefined;
  return (
    <div className="confirm-grid">
      <MiniStat label="Producto" value={product?.name ?? '—'} />
      <MiniStat label="Unidades" value={qty(draft.units)} />
      <MiniStat label="Lote" value={draft.lotNumber} />
      <MiniStat label="Vencimiento" value={dateLabel(draft.expiry)} />
      <MiniStat label="Fórmula" value={formula?.name ?? '—'} />
      <MiniStat label="Costo total" value={money(costs?.total ?? 0)} />
      <MiniStat label="Costo unitario" value={money(Number(summary?.unitCost) || 0)} />
      <MiniStat label="MP + Packaging" value={`${money((costs?.materials ?? 0) + (costs?.packaging ?? 0))}`} />
      <div className="full-span"><SmartTable rows={materialsUsed} dense columns={[{ key: 'materialName', header: 'Insumo' }, { key: 'qty', header: 'Cantidad', render: (r) => qty(r.qty, r.unit) }, { key: 'cost', header: 'Costo', render: (r) => money(r.cost) }, { key: 'lots', header: 'Lotes FEFO', render: (r) => r.lotsUsed.map((l) => `${l.lotNumber} (${qty(l.qty)})`).join(', ') }]} /></div>
      <ErrorList errors={preview.errors} warnings={preview.warnings} />
    </div>
  );
}

function PurchasePage({ state, applyState, setPendingConfirm, openDrawer }: PageProps) {
  const [draft, setDraft] = useState<PurchaseDraft>({ date: todayISO(), supplierId: state.suppliers.find((s) => s.active)?.id ?? '', materialId: state.materials.find((m) => m.active)?.id ?? '', quantity: 0, unitCost: 0, lotNumber: '', expiry: '', notes: '', location: 'Depósito MP' });
  const preview = useMemo(() => previewPurchase(state, draft), [state, draft]);
  const material = state.materials.find((m) => m.id === draft.materialId);
  useEffect(() => {
    const mat = state.materials.find((m) => m.id === draft.materialId);
    if (mat) setDraft((old) => ({ ...old, unitCost: mat.unitCost }));
  }, [draft.materialId]);

  const confirm = () => {
    if (!preview.ok) return;
    setPendingConfirm({
      title: 'Confirmar compra',
      label: 'Registrar compra',
      body: <PurchaseConfirmation preview={preview} draft={draft} />,
      onConfirm: () => {
        const result = registerPurchase(state, draft);
        if (result.ok && result.data) {
          applyState(result.data, 'Compra registrada y lote MP creado.');
          setDraft({ ...draft, quantity: 0, lotNumber: '', notes: '' });
        }
      }
    });
  };

  return (
    <Section title="Compras y proveedores" subtitle="Registra compras, crea lotes de MP/envases/tapas/etiquetas, actualiza costo promedio y auditoría.">
      <div className="grid two">
        <div className="card form-card">
          <div className="form-grid two-cols">
            <Field label="Proveedor">
              <select value={draft.supplierId} onChange={(e) => setDraft({ ...draft, supplierId: e.target.value })}>
                <option value="">Seleccionar proveedor…</option>
                {state.suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Material / envase / tapa / etiqueta">
              <select value={draft.materialId} onChange={(e) => setDraft({ ...draft, materialId: e.target.value })}>
                <option value="">Seleccionar material…</option>
                {state.materials.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.category}</option>)}
              </select>
            </Field>
            <Field label="Fecha"><input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
            <Field label={`Cantidad ${material?.unit ? `(${material.unit})` : ''}`}><input type="number" min="0" step="0.01" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: toNumber(e.target.value) })} /></Field>
            <Field label="Costo unitario"><input type="number" min="0" step="0.0001" value={draft.unitCost} onChange={(e) => setDraft({ ...draft, unitCost: toNumber(e.target.value) })} /></Field>
            <Field label="Lote proveedor"><input value={draft.lotNumber} onChange={(e) => setDraft({ ...draft, lotNumber: e.target.value })} /></Field>
            <Field label="Vencimiento"><input type="date" value={draft.expiry ?? ''} onChange={(e) => setDraft({ ...draft, expiry: e.target.value })} /></Field>
            <Field label="Ubicación"><input value={draft.location ?? ''} onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></Field>
          </div>
          <Field label="Notas"><textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          <ErrorList errors={preview.errors} warnings={preview.warnings} />
          <button className="primary wide-button" disabled={!preview.ok} onClick={confirm}>Registrar compra</button>
        </div>
        <div className="card sticky-card">
          <h3>Resumen compra</h3>
          <div className="totals">
            <span>Proveedor <b>{state.suppliers.find((s) => s.id === draft.supplierId)?.name ?? '—'}</b></span>
            <span>Material <b>{material?.name ?? '—'}</b></span>
            <span>Cantidad <b>{qty(draft.quantity, material?.unit)}</b></span>
            <span>Costo unitario <b>{money(draft.unitCost)}</b></span>
            <span>Total <b>{money(draft.quantity * draft.unitCost)}</b></span>
          </div>
          {draft.supplierId && <button className="ghost wide-button" onClick={() => openDrawer('supplier', draft.supplierId)}>Ver proveedor</button>}
        </div>
      </div>
    </Section>
  );
}

function PurchaseConfirmation({ preview, draft }: { preview: ReturnType<typeof previewPurchase>; draft: PurchaseDraft }) {
  const summary = preview.summary as Record<string, unknown> | undefined;
  const supplier = summary?.supplier as Supplier | undefined;
  const material = summary?.material as Material | undefined;
  return (
    <div className="confirm-grid">
      <MiniStat label="Proveedor" value={supplier?.name ?? '—'} />
      <MiniStat label="Material" value={material?.name ?? '—'} />
      <MiniStat label="Cantidad" value={qty(draft.quantity, material?.unit)} />
      <MiniStat label="Costo unitario" value={money(draft.unitCost)} />
      <MiniStat label="Total" value={money(Number(summary?.total) || 0)} />
      <MiniStat label="Lote" value={draft.lotNumber || 'Sin lote proveedor'} />
      <MiniStat label="Vencimiento" value={dateLabel(draft.expiry)} />
      <ErrorList errors={preview.errors} warnings={preview.warnings} />
    </div>
  );
}

function InventoryPage({ state, applyState, setPendingConfirm }: PageProps) {
  const firstProduct = state.products[0];
  const [draft, setDraft] = useState<InventoryDraft>({ date: todayISO(), itemType: 'product', itemId: firstProduct?.id ?? '', countedQty: 0, reason: 'conteo físico', notes: '' });
  const item = draft.itemType === 'product' ? state.products.find((p) => p.id === draft.itemId) : state.materials.find((m) => m.id === draft.itemId);
  const preview = useMemo(() => previewInventoryCount(state, draft), [state, draft]);
  useEffect(() => {
    const list = draft.itemType === 'product' ? state.products : state.materials;
    const selected = list[0];
    setDraft((old) => ({ ...old, itemId: selected?.id ?? '', countedQty: 0 }));
  }, [draft.itemType]);

  const confirm = () => {
    if (!preview.ok) return;
    setPendingConfirm({
      title: 'Confirmar ajuste de inventario',
      label: 'Aplicar conteo',
      body: <InventoryConfirmation preview={preview} draft={draft} itemName={item?.name ?? ''} />,
      onConfirm: () => {
        const result = applyInventoryCount(state, draft);
        if (result.ok && result.data) applyState(result.data, 'Conteo aplicado con movimiento y auditoría.');
      }
    });
  };

  return (
    <Section title="Inventario físico" subtitle="Conteo, motivo obligatorio, ajuste de lotes, movimiento y auditoría.">
      <div className="grid two">
        <div className="card form-card">
          <div className="form-grid two-cols">
            <Field label="Tipo"><select value={draft.itemType} onChange={(e) => setDraft({ ...draft, itemType: e.target.value as InventoryDraft['itemType'] })}><option value="product">Producto terminado</option><option value="material">Material / insumo</option></select></Field>
            <Field label="Ítem"><select value={draft.itemId} onChange={(e) => setDraft({ ...draft, itemId: e.target.value })}>{(draft.itemType === 'product' ? state.products : state.materials).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            <Field label="Fecha"><input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
            <Field label="Stock contado"><input type="number" min="0" step="0.01" value={draft.countedQty} onChange={(e) => setDraft({ ...draft, countedQty: toNumber(e.target.value) })} /></Field>
            <Field label="Motivo"><select value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })}>{countReasons.map((r) => <option key={r}>{r}</option>)}</select></Field>
          </div>
          <Field label="Nota / evidencia textual"><textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          <ErrorList errors={preview.errors} warnings={preview.warnings} />
          <button className="primary wide-button" disabled={!preview.ok} onClick={confirm}>Aplicar conteo / ajuste</button>
        </div>
        <div className="card sticky-card">
          <h3>Stock actual</h3>
          {item ? <StockTriple system={Number(preview.summary?.systemQty) || 0} physical={(draft.itemType === 'product' ? state.physicalSnapshots[`product:${draft.itemId}`]?.qty : state.physicalSnapshots[`material:${draft.itemId}`]?.qty) ?? null} available={draft.itemType === 'product' ? productStock(state, draft.itemId).available : materialStock(state, draft.itemId).available} unit={draft.itemType === 'product' ? 'u' : (item as Material).unit} /> : null}
          <div className="totals"><span>Diferencia <b>{qty(Number(preview.summary?.difference) || 0, draft.itemType === 'product' ? 'u' : (item as Material | undefined)?.unit)}</b></span></div>
        </div>
      </div>
    </Section>
  );
}

function InventoryConfirmation({ preview, draft, itemName }: { preview: ReturnType<typeof previewInventoryCount>; draft: InventoryDraft; itemName: string }) {
  return (
    <div className="confirm-grid">
      <MiniStat label="Ítem" value={itemName} />
      <MiniStat label="Stock sistema" value={qty(Number(preview.summary?.systemQty) || 0)} />
      <MiniStat label="Contado" value={qty(draft.countedQty)} />
      <MiniStat label="Diferencia" value={qty(Number(preview.summary?.difference) || 0)} />
      <MiniStat label="Motivo" value={draft.reason} />
      <MiniStat label="Fecha" value={dateLabel(draft.date)} />
    </div>
  );
}

function ProductsPage({ state, applyState, openDrawer }: PageProps) {
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ sku: '', name: '', line: '', family: '', size: '', stockMin: 0, listPrice: 0, costReference: 0 });
  const rows = state.products.filter((p) => includesText(`${p.sku} ${p.name} ${p.line} ${p.family}`, query));
  const save = () => {
    if (!form.name.trim()) return;
    const product: Product = { id: form.sku || uid('prod'), sku: form.sku || uid('sku'), name: form.name, line: form.line || 'GENERAL', family: form.family || 'OTRO', size: form.size, sizeMl: parseMl(form.size), formulaId: null, stockMin: form.stockMin, listPrice: form.listPrice, costReference: form.costReference, shelfLifeMonths: 24, active: true, notes: '' };
    const auditEntries = [audit({ entity: 'products', entityId: product.id, field: 'alta', before: '', after: product, reason: 'Alta manual producto', origin: 'manual', user: state.settings.currentUser })];
    const next = commitOperation(state, { patch: { products: addOrUpdateEntity(state.products, product) }, movements: [], auditEntries });
    applyState(next, 'Producto guardado.');
    setForm({ sku: '', name: '', line: '', family: '', size: '', stockMin: 0, listPrice: 0, costReference: 0 });
  };
  return (
    <Section title="Productos terminados" subtitle="Ficha de producto con stock sistema/físico/disponible, lotes, fórmula, costo, precio y margen.">
      <div className="card form-card compact-form">
        <div className="form-grid eight-cols">
          <Field label="SKU"><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
          <Field label="Nombre"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Línea"><input value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} /></Field>
          <Field label="Familia"><input value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })} /></Field>
          <Field label="Tamaño"><input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} /></Field>
          <Field label="Stock min"><input type="number" value={form.stockMin} onChange={(e) => setForm({ ...form, stockMin: toNumber(e.target.value) })} /></Field>
          <Field label="Precio"><input type="number" value={form.listPrice} onChange={(e) => setForm({ ...form, listPrice: toNumber(e.target.value) })} /></Field>
          <button className="primary align-end" onClick={save}>Guardar</button>
        </div>
      </div>
      <div className="card">
        <header className="card-head"><input className="search" placeholder="Buscar producto…" value={query} onChange={(e) => setQuery(e.target.value)} /><button className="ghost" onClick={() => exportModuleCsv(state, 'productos')}>Exportar CSV</button></header>
        <SmartTable rows={rows} onRowClick={(p) => openDrawer('product', p.id)} columns={[
          { key: 'sku', header: 'SKU' }, { key: 'name', header: 'Producto' }, { key: 'line', header: 'Línea' }, { key: 'size', header: 'Tamaño' },
          { key: 'stock', header: 'Stock', value: (p) => productStock(state, p.id).available, render: (p) => <StockTriple system={productStock(state, p.id).system} physical={productStock(state, p.id).physical} available={productStock(state, p.id).available} /> },
          { key: 'price', header: 'Precio', value: (p) => p.listPrice, render: (p) => money(p.listPrice) },
          { key: 'margin', header: 'Margen', value: (p) => p.listPrice - p.costReference, render: (p) => money(p.listPrice - p.costReference) },
          { key: 'active', header: 'Estado', render: (p) => <Badge label={p.active ? 'activo' : 'inactivo'} tone={p.active ? 'good' : 'neutral'} /> }
        ]} />
      </div>
    </Section>
  );
}

function MaterialsPage({ state, applyState, openDrawer }: PageProps) {
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ name: '', category: 'materia prima', unit: 'ml', stockMin: 0, unitCost: 0 });
  const rows = state.materials.filter((m) => includesText(`${m.name} ${m.category} ${m.unit}`, query));
  const save = () => {
    if (!form.name.trim()) return;
    const material: Material = { id: `mat-${slug(form.name)}-${Date.now().toString(36)}`, name: form.name, category: form.category as Material['category'], unit: form.unit, stockMin: form.stockMin, unitCost: form.unitCost, providerDefaultId: null, active: true, notes: '' };
    const auditEntries = [audit({ entity: 'materials', entityId: material.id, field: 'alta', before: '', after: material, reason: 'Alta manual material', origin: 'manual', user: state.settings.currentUser })];
    const next = commitOperation(state, { patch: { materials: addOrUpdateEntity(state.materials, material) }, movements: [], auditEntries });
    applyState(next, 'Material guardado.');
    setForm({ name: '', category: 'materia prima', unit: 'ml', stockMin: 0, unitCost: 0 });
  };
  return (
    <Section title="Materias primas, envases, tapas y etiquetas" subtitle="Stock sistema/físico/disponible por lote, costo unitario y mínimos.">
      <div className="card form-card compact-form"><div className="form-grid six-cols">
        <Field label="Nombre"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Categoría"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{['materia prima', 'envase', 'tapa', 'etiqueta', 'insumo', 'otro'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Unidad"><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
        <Field label="Stock min"><input type="number" value={form.stockMin} onChange={(e) => setForm({ ...form, stockMin: toNumber(e.target.value) })} /></Field>
        <Field label="Costo"><input type="number" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: toNumber(e.target.value) })} /></Field>
        <button className="primary align-end" onClick={save}>Guardar</button>
      </div></div>
      <div className="card">
        <header className="card-head"><input className="search" placeholder="Buscar material…" value={query} onChange={(e) => setQuery(e.target.value)} /><button className="ghost" onClick={() => exportModuleCsv(state, 'materiales')}>Exportar CSV</button></header>
        <SmartTable rows={rows} onRowClick={(m) => openDrawer('material', m.id)} columns={[
          { key: 'name', header: 'Material' }, { key: 'category', header: 'Categoría' }, { key: 'unit', header: 'Unidad' },
          { key: 'stock', header: 'Stock', value: (m) => materialStock(state, m.id).available, render: (m) => <StockTriple system={materialStock(state, m.id).system} physical={materialStock(state, m.id).physical} available={materialStock(state, m.id).available} unit={m.unit} /> },
          { key: 'unitCost', header: 'Costo unitario', value: (m) => m.unitCost, render: (m) => money(m.unitCost) },
          { key: 'active', header: 'Estado', render: (m) => <Badge label={m.active ? 'activo' : 'inactivo'} tone={m.active ? 'good' : 'neutral'} /> }
        ]} />
      </div>
    </Section>
  );
}

function ClientsPage({ state, applyState, openDrawer }: PageProps) {
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '', province: '', city: '', segment: 'minorista' });
  const rows = state.clients.filter((c) => includesText(`${c.name} ${c.phone} ${c.city} ${c.province} ${c.segment}`, query));
  const save = () => {
    if (!form.name.trim()) return;
    const client: Client = { id: uid('cli'), name: form.name, phone: form.phone, email: form.email, address: '', province: form.province, city: form.city, segment: form.segment as Client['segment'], status: 'active', notes: '', source: 'manual', lastPurchase: null };
    const auditEntries = [audit({ entity: 'clients', entityId: client.id, field: 'alta', before: '', after: client, reason: 'Alta manual cliente', origin: 'manual', user: state.settings.currentUser })];
    applyState(commitOperation(state, { patch: { clients: [...state.clients, client] }, movements: [], auditEntries }), 'Cliente guardado.');
    setForm({ name: '', phone: '', email: '', province: '', city: '', segment: 'minorista' });
  };
  const toggle = (client: Client) => {
    const updated = { ...client, status: client.status === 'active' ? 'inactive' : 'active' } as Client;
    const auditEntries = [audit({ entity: 'clients', entityId: client.id, field: 'status', before: client.status, after: updated.status, reason: 'Cambio manual estado cliente', origin: 'manual', user: state.settings.currentUser })];
    applyState(commitOperation(state, { patch: { clients: state.clients.map((c) => c.id === client.id ? updated : c) }, movements: [], auditEntries }), 'Estado de cliente actualizado.');
  };
  return (
    <Section title="Clientes" subtitle="Alta, edición, deuda, ticket promedio, productos favoritos, última compra e historial.">
      <div className="card form-card compact-form"><div className="form-grid seven-cols">
        <Field label="Nombre"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Teléfono"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Provincia"><input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} /></Field>
        <Field label="Ciudad"><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
        <Field label="Segmento"><select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>{['minorista', 'mayorista', 'distribuidor', 'revendedor', 'otro'].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <button className="primary align-end" onClick={save}>Guardar</button>
      </div></div>
      <div className="card">
        <header className="card-head"><input className="search" placeholder="Buscar cliente…" value={query} onChange={(e) => setQuery(e.target.value)} /><button className="ghost" onClick={() => exportModuleCsv(state, 'clientes')}>Exportar CSV</button></header>
        <SmartTable rows={rows} onRowClick={(c) => openDrawer('client', c.id)} columns={[
          { key: 'name', header: 'Cliente' }, { key: 'phone', header: 'Teléfono' }, { key: 'city', header: 'Ciudad' }, { key: 'province', header: 'Provincia' }, { key: 'segment', header: 'Segmento' },
          { key: 'lastPurchase', header: 'Última compra', render: (c) => dateLabel(c.lastPurchase) },
          { key: 'status', header: 'Estado', render: (c) => <button className="ghost" onClick={(event) => { event.stopPropagation(); toggle(c); }}><Badge label={c.status} tone={c.status === 'active' ? 'good' : 'neutral'} /></button> }
        ]} />
      </div>
    </Section>
  );
}

function SuppliersPage({ state, applyState, openDrawer }: PageProps) {
  const [form, setForm] = useState({ name: '', contact: '', phone: '', email: '', address: '' });
  const save = () => {
    if (!form.name.trim()) return;
    const supplier: Supplier = { id: uid('sup'), name: form.name, contact: form.contact, phone: form.phone, email: form.email, address: form.address, notes: '', active: true };
    const auditEntries = [audit({ entity: 'suppliers', entityId: supplier.id, field: 'alta', before: '', after: supplier, reason: 'Alta manual proveedor', origin: 'manual', user: state.settings.currentUser })];
    applyState(commitOperation(state, { patch: { suppliers: [...state.suppliers, supplier] }, movements: [], auditEntries }), 'Proveedor guardado.');
    setForm({ name: '', contact: '', phone: '', email: '', address: '' });
  };
  return (
    <Section title="Proveedores" subtitle="Datos, historial de compras, insumos comprados y costo histórico por proveedor.">
      <div className="card form-card compact-form"><div className="form-grid six-cols">
        <Field label="Nombre"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Contacto"><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
        <Field label="Teléfono"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Dirección"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <button className="primary align-end" onClick={save}>Guardar</button>
      </div></div>
      <div className="card">
        <header className="card-head"><h3>Listado de proveedores</h3><button className="ghost" onClick={() => exportModuleCsv(state, 'proveedores')}>Exportar CSV</button></header>
        <SmartTable rows={state.suppliers} onRowClick={(s) => openDrawer('supplier', s.id)} columns={[{ key: 'name', header: 'Proveedor' }, { key: 'contact', header: 'Contacto' }, { key: 'phone', header: 'Teléfono' }, { key: 'email', header: 'Email' }, { key: 'active', header: 'Estado', render: (s) => <Badge label={s.active ? 'activo' : 'inactivo'} tone={s.active ? 'good' : 'neutral'} /> }]} />
      </div>
    </Section>
  );
}

function FormulasPage({ state, openDrawer }: PageProps) {
  const [query, setQuery] = useState('');
  const rows = state.formulas.filter((f) => includesText(`${f.name} ${f.revision}`, query));
  return (
    <Section title="Fórmulas" subtitle="Revisiones, ingredientes, tolerancias, batch size y asociación a producto.">
      <div className="card">
        <header className="card-head"><input className="search" placeholder="Buscar fórmula…" value={query} onChange={(e) => setQuery(e.target.value)} /><button className="ghost" onClick={() => exportFullExcel(state)}>Exportar suite</button></header>
        <SmartTable rows={rows} onRowClick={(f) => f.productId && openDrawer('product', f.productId)} columns={[
          { key: 'name', header: 'Fórmula' }, { key: 'revision', header: 'Revisión' }, { key: 'batchSizeMl', header: 'Batch', render: (f) => qty(f.batchSizeMl, 'ml') },
          { key: 'ingredients', header: 'Insumos', render: (f) => f.ingredients.length }, { key: 'active', header: 'Estado', render: (f) => <Badge label={f.active ? 'activa' : 'inactiva'} tone={f.active ? 'good' : 'neutral'} /> }
        ]} />
      </div>
    </Section>
  );
}

function LotsPage({ state, applyState, openDrawer }: PageProps) {
  const [tab, setTab] = useState<'pt' | 'mp'>('pt');
  const [query, setQuery] = useState('');
  const updateProductLotStatus = (id: string, status: ProductLotStatus) => {
    const lot = state.productLots.find((l) => l.id === id);
    if (!lot) return;
    const auditEntries = [audit({ entity: 'productLots', entityId: id, field: 'status', before: lot.status, after: status, reason: 'Cambio manual estado lote', origin: 'manual', user: state.settings.currentUser })];
    applyState(commitOperation(state, { patch: { productLots: state.productLots.map((l) => l.id === id ? { ...l, status } : l) }, movements: [], auditEntries }), 'Estado de lote actualizado.');
  };
  type ProductLotStatus = AppState['productLots'][number]['status'];
  const rowsPT = state.productLots.filter((l) => includesText(`${l.productName} ${l.lotNumber} ${l.status}`, query));
  const rowsMP = state.materialLots.filter((l) => includesText(`${l.materialName} ${l.lotNumber} ${l.status}`, query));
  return (
    <Section title="Lotes y FEFO" subtitle="Lotes PT/MP, vencimientos, estados, ubicaciones, bloqueo y trazabilidad.">
      <div className="card">
        <header className="card-head"><div className="segmented"><button className={tab === 'pt' ? 'active' : ''} onClick={() => setTab('pt')}>Producto terminado</button><button className={tab === 'mp' ? 'active' : ''} onClick={() => setTab('mp')}>MP / packaging</button></div><input className="search" placeholder="Buscar lote…" value={query} onChange={(e) => setQuery(e.target.value)} /></header>
        {tab === 'pt' ? <SmartTable rows={rowsPT} onRowClick={(l) => openDrawer('productLot', l.id)} columns={[
          { key: 'productName', header: 'Producto' }, { key: 'lotNumber', header: 'Lote' }, { key: 'expiry', header: 'Vence', render: (l) => dateLabel(l.expiry) }, { key: 'qtyAvailable', header: 'Disponible', render: (l) => qty(l.qtyAvailable) }, { key: 'unitCost', header: 'Costo/u', render: (l) => money(l.unitCost) }, { key: 'location', header: 'Ubicación' }, { key: 'status', header: 'Estado', render: (l) => <select value={l.status} onClick={(e) => e.stopPropagation()} onChange={(e) => updateProductLotStatus(l.id, e.target.value as ProductLotStatus)}>{['liberado', 'cuarentena', 'bloqueado', 'rechazado', 'vencido', 'agotado'].map((s) => <option key={s}>{s}</option>)}</select> }
        ]} /> : <SmartTable rows={rowsMP} onRowClick={(l) => openDrawer('materialLot', l.id)} columns={[
          { key: 'materialName', header: 'Material' }, { key: 'lotNumber', header: 'Lote' }, { key: 'expiry', header: 'Vence', render: (l) => dateLabel(l.expiry) }, { key: 'qtyAvailable', header: 'Disponible', render: (l) => qty(l.qtyAvailable, state.materials.find((m) => m.id === l.materialId)?.unit) }, { key: 'unitCost', header: 'Costo/u', render: (l) => money(l.unitCost) }, { key: 'location', header: 'Ubicación' }, { key: 'status', header: 'Estado', render: (l) => <Badge label={l.status} tone={l.status === 'liberado' ? 'good' : l.status === 'bloqueado' || l.status === 'vencido' ? 'danger' : 'warn'} /> }
        ]} />}
      </div>
    </Section>
  );
}

function CostsPage({ state, applyState }: PageProps) {
  const updateProductPrice = (product: Product, field: 'listPrice' | 'costReference', value: number) => {
    const updated = { ...product, [field]: value };
    const auditEntries = [audit({ entity: 'prices', entityId: product.id, field, before: product[field], after: value, reason: 'Edición auditada de precio/costo', origin: 'manual', user: state.settings.currentUser })];
    applyState(commitOperation(state, { patch: { products: state.products.map((p) => p.id === product.id ? updated : p) }, movements: [], auditEntries }), 'Precio/costo actualizado.');
  };
  const lineProfit = profitabilityByLine(state);
  return (
    <Section title="Costos, precios y rentabilidad" subtitle="Costo por lote/producto, lista de precios, valor de stock y rentabilidad por línea.">
      <div className="grid two">
        <div className="card"><h3>Rentabilidad por línea</h3><SmartTable rows={lineProfit} dense columns={[{ key: 'line', header: 'Línea' }, { key: 'revenue', header: 'Facturación', render: (r) => money(r.revenue) }, { key: 'cost', header: 'Costo', render: (r) => money(r.cost) }, { key: 'margin', header: 'Margen', render: (r) => money(r.margin) }, { key: 'pct', header: '%', render: (r) => `${Math.round(r.pct * 100)}%` }]} /></div>
        <div className="card"><h3>Valor de stock por lote</h3><SmartTable rows={state.productLots.filter((l) => l.qtyAvailable > 0).slice(0, 15)} dense columns={[{ key: 'productName', header: 'Producto' }, { key: 'lotNumber', header: 'Lote' }, { key: 'qtyAvailable', header: 'Qty', render: (r) => qty(r.qtyAvailable) }, { key: 'value', header: 'Valor', render: (r) => money(r.qtyAvailable * r.unitCost) }]} /></div>
      </div>
      <div className="card"><header className="card-head"><h3>Lista de precios auditada</h3><button className="ghost" onClick={() => exportModuleCsv(state, 'productos')}>Exportar precios</button></header><SmartTable rows={state.products.filter((p) => p.active)} columns={[{ key: 'sku', header: 'SKU' }, { key: 'name', header: 'Producto' }, { key: 'costReference', header: 'Costo ref.', render: (p) => <input className="inline-input" type="number" defaultValue={p.costReference} onBlur={(e) => updateProductPrice(p, 'costReference', toNumber(e.target.value))} /> }, { key: 'listPrice', header: 'Precio lista', render: (p) => <input className="inline-input" type="number" defaultValue={p.listPrice} onBlur={(e) => updateProductPrice(p, 'listPrice', toNumber(e.target.value))} /> }, { key: 'margin', header: 'Margen', render: (p) => money(p.listPrice - p.costReference) }, { key: 'pct', header: '%', render: (p) => p.listPrice ? `${Math.round(((p.listPrice - p.costReference) / p.listPrice) * 100)}%` : '—' }]} /></div>
    </Section>
  );
}

function CombosPage({ state, applyState }: PageProps) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [components, setComponents] = useState<Array<{ productId: string; qty: number }>>([]);
  const [componentProduct, setComponentProduct] = useState(state.products.find((p) => p.active)?.id ?? '');
  const [componentQty, setComponentQty] = useState(1);
  const addComponent = () => {
    if (!componentProduct || componentQty <= 0) return;
    setComponents((old) => [...old, { productId: componentProduct, qty: componentQty }]);
  };
  const save = () => {
    if (!name.trim()) return;
    const combo: Combo = { id: uid('combo'), name, price, active: true, components };
    const auditEntries = [audit({ entity: 'combos', entityId: combo.id, field: 'alta', before: '', after: combo, reason: 'Alta manual combo', origin: 'manual', user: state.settings.currentUser })];
    applyState(commitOperation(state, { patch: { combos: [...state.combos, combo] }, movements: [], auditEntries }), 'Combo guardado.');
    setName(''); setPrice(0); setComponents([]);
  };
  return (
    <Section title="Combos y promos" subtitle="Box, promos y combos que explotan internamente a SKUs reales para descontar stock.">
      <div className="grid two">
        <div className="card form-card">
          <Field label="Nombre combo"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Precio"><input type="number" value={price} onChange={(e) => setPrice(toNumber(e.target.value))} /></Field>
          <div className="form-grid three-cols"><Field label="Producto componente"><select value={componentProduct} onChange={(e) => setComponentProduct(e.target.value)}>{state.products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Cantidad"><input type="number" value={componentQty} onChange={(e) => setComponentQty(toNumber(e.target.value))} /></Field><button className="ghost align-end" onClick={addComponent}>Agregar componente</button></div>
          <SmartTable rows={components.map((c, index) => ({ id: `${c.productId}-${index}`, ...c, name: state.products.find((p) => p.id === c.productId)?.name ?? c.productId }))} dense columns={[{ key: 'name', header: 'Producto' }, { key: 'qty', header: 'Cantidad' }]} />
          <button className="primary wide-button" onClick={save}>Guardar combo</button>
        </div>
        <div className="card"><h3>Combos activos</h3><SmartTable rows={state.combos} columns={[{ key: 'name', header: 'Combo' }, { key: 'price', header: 'Precio', render: (c) => money(c.price) }, { key: 'components', header: 'Componentes', render: (c) => c.components.length }, { key: 'stock', header: 'Stock posible', render: (c) => qty(comboStockSummary(state, c).available) }, { key: 'active', header: 'Estado', render: (c) => <Badge label={c.active ? 'activo' : 'inactivo'} tone={c.active ? 'good' : 'neutral'} /> }]} /></div>
      </div>
    </Section>
  );
}

function MovementsPage({ state }: PageProps) {
  return (
    <Section title="Movimientos" subtitle="Histórico completo de tipo, entidad, ítem, cantidad, valor, usuario, documento, lote y motivo." actions={<button className="ghost" onClick={() => exportModuleCsv(state, 'movimientos')}>Exportar CSV</button>}>
      <div className="card"><SmartTable rows={state.movements.slice().reverse()} columns={[{ key: 'date', header: 'Fecha', render: (m) => dateLabel(m.date) }, { key: 'type', header: 'Tipo' }, { key: 'item', header: 'Ítem' }, { key: 'qty', header: 'Cantidad', render: (m) => qty(m.qty, m.unit) }, { key: 'value', header: 'Valor', render: (m) => money(m.value) }, { key: 'user', header: 'Usuario' }, { key: 'sourceDocument', header: 'Documento' }, { key: 'lotNumber', header: 'Lote' }, { key: 'reason', header: 'Motivo' }]} /></div>
    </Section>
  );
}

function AuditPage({ state }: PageProps) {
  const issues = runIntegrityChecks(state);
  const tests = runInternalTests(state);
  return (
    <Section title="Auditoría y QA" subtitle="Score operativo, issues, bitácora auditada y pruebas internas." actions={<button className="ghost" onClick={() => exportModuleCsv(state, 'auditoria')}>Exportar auditoría</button>}>
      <div className="kpi-grid"><KPI label="Críticos" value={issues.filter((i) => i.severity === 'crítico').length} tone="danger" /><KPI label="Atención" value={issues.filter((i) => i.severity === 'atención').length} tone="warn" /><KPI label="Info" value={issues.filter((i) => i.severity === 'info').length} /><KPI label="Tests OK" value={`${tests.filter((t) => t.passed).length}/${tests.length}`} tone={tests.every((t) => t.passed) ? 'good' : 'warn'} /></div>
      <div className="grid two"><div className="card"><h3>Tests internos</h3>{tests.map((t) => <div className="test-row" key={t.name}><Badge label={t.passed ? 'OK' : 'Falla'} tone={t.passed ? 'good' : 'danger'} /><strong>{t.name}</strong><span>{t.detail}</span></div>)}</div><div className="card"><h3>Audit log</h3><SmartTable rows={state.auditLog.slice().reverse()} dense maxRows={40} columns={[{ key: 'date', header: 'Fecha', render: (a) => dateLabel(a.date) }, { key: 'module', header: 'Módulo' }, { key: 'entityId', header: 'Entidad' }, { key: 'field', header: 'Campo' }, { key: 'origin', header: 'Origen' }, { key: 'reason', header: 'Motivo' }]} /></div></div>
    </Section>
  );
}

function IntegrityPage({ state, applyState, setPendingConfirm, setPage }: PageProps) {
  const issues = runIntegrityChecks(state);
  const repair = () => {
    setPendingConfirm({ title: 'Reparar integridad seguro', label: 'Reparar seguro', body: <p>Se recalcularán estados de lotes agotados/vencidos desde los lotes existentes y se registrará auditoría. No se eliminarán datos.</p>, onConfirm: () => { const result = safeRepairState(state); if (result.ok && result.data) applyState(result.data, `Reparación segura aplicada: ${Number(result.summary?.changed) || 0} cambios.`); } });
  };
  return (
    <Section title="Integridad" subtitle="Controles de stock, ventas, órdenes, fórmulas, precios, vencimientos, negativos, margen y deuda." actions={<button className="primary" onClick={repair}>Reparar seguro</button>}>
      <div className="card"><SmartTable rows={issues} columns={[{ key: 'severity', header: 'Severidad', render: (i) => <Badge label={i.severity} tone={i.severity === 'crítico' ? 'danger' : i.severity === 'atención' ? 'warn' : 'info'} /> }, { key: 'control', header: 'Control' }, { key: 'detail', header: 'Detalle' }, { key: 'systemValue', header: 'Sistema' }, { key: 'expectedValue', header: 'Esperado' }, { key: 'recommendation', header: 'Acción recomendada' }, { key: 'module', header: 'Ir', render: (i) => i.module ? <button className="ghost" onClick={() => setPage(i.module ?? 'Dashboard')}>{i.module}</button> : '—' }]} /></div>
    </Section>
  );
}

function ImportExportPage({ state, applyState, setPendingConfirm }: PageProps) {
  const [destination, setDestination] = useState<ImportDestination>('clientes');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const handleFile = (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      if (file.name.toLowerCase().endsWith('.json')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed?.schemaVersion || parsed?.products || parsed?.clients) {
            setPendingConfirm({ title: 'Restaurar backup JSON', label: 'Restaurar backup', danger: true, body: <p>Esto reemplazará la base local actual por el backup seleccionado. Antes de continuar, exportá un backup si necesitás conservar el estado actual.</p>, onConfirm: () => { restoreBackup(file).then((restored) => applyState(restored, 'Backup restaurado.')); } });
            return;
          }
          const arr = Array.isArray(parsed) ? parsed : [];
          setRows(arr.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v ?? '')]))));
        } catch {
          setRows([]);
        }
      } else {
        setRows(rowsToObjects(parseCsv(text)));
      }
    };
    reader.readAsText(file, 'utf-8');
  };
  const apply = () => {
    setPendingConfirm({ title: 'Confirmar importación', label: 'Importar', body: <div><p>Destino: <b>{destination}</b></p><p>Archivo: <b>{fileName}</b></p><p>Filas a aplicar: <b>{rows.length}</b></p></div>, onConfirm: () => { const result = applyImport(state, destination, rows); applyState(result.next, `Importación aplicada: ${result.count} filas.${result.warnings.length ? ` ${result.warnings.length} advertencias.` : ''}`, result.warnings.length ? 'warn' : 'good'); setRows([]); } });
  };
  return (
    <Section title="Importar / Exportar" subtitle="CSV/JSON con preview, confirmación, backup completo y Excel multihoja compatible.">
      <div className="grid two">
        <div className="card form-card">
          <Field label="Destino"><select value={destination} onChange={(e) => setDestination(e.target.value as ImportDestination)}>{['clientes', 'productos', 'materiales', 'proveedores', 'compras'].map((d) => <option key={d}>{d}</option>)}</select></Field>
          <Field label="Archivo CSV o JSON"><input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => handleFile(e.target.files?.[0])} /></Field>
          <div className="button-row"><button className="ghost" onClick={() => fileDownload(`plantilla-${destination}.csv`, templateCsv(destination), 'text/csv;charset=utf-8')}>Descargar plantilla</button><button className="primary" disabled={!rows.length} onClick={apply}>Importar con confirmación</button></div>
          <h3>Preview</h3>
          {rows.length ? <SmartTable rows={rows.map((r, i) => ({ id: String(i), ...r }))} dense maxRows={10} columns={Object.keys(rows[0] ?? {}).slice(0, 8).map((key) => ({ key, header: key }))} /> : <EmptyState title="Sin archivo" text="Cargá un CSV/JSON para ver la previsualización antes de aplicar." />}
        </div>
        <div className="card"><h3>Exportación</h3><div className="export-grid"><button className="primary" onClick={() => fileDownload(`JM-Stock-Backup-${todayISO()}.json`, exportBackup(state), 'application/json;charset=utf-8')}>Backup JSON completo</button><button className="primary" onClick={() => exportFullExcel(state)}>Excel completo multihoja</button><button className="ghost" onClick={() => fileDownload(`JM-Stock-Suite-${todayISO()}.xls`, buildExcelXml(state), 'application/vnd.ms-excel;charset=utf-8')}>Descargar .xls XML</button><button className="ghost" onClick={() => exportModuleCsv(state, 'ventas')}>Ventas CSV</button><button className="ghost" onClick={() => exportModuleCsv(state, 'productos')}>Productos CSV</button><button className="ghost" onClick={() => exportModuleCsv(state, 'clientes')}>Clientes CSV</button></div></div>
      </div>
    </Section>
  );
}

function SettingsPage({ state, applyState, setPendingConfirm }: PageProps) {
  const [settings, setSettings] = useState(state.settings);
  const save = () => {
    const auditEntries = [audit({ entity: 'settings', entityId: 'settings', field: 'settings', before: state.settings, after: settings, reason: 'Actualización de ajustes', origin: 'manual', user: state.settings.currentUser })];
    applyState(commitOperation(state, { patch: { settings }, movements: [], auditEntries }), 'Ajustes guardados.');
  };
  const reset = () => setPendingConfirm({ title: 'Restaurar seed inicial', label: 'Restaurar', danger: true, body: <p>Esto reemplazará todos los datos locales por el seed generado desde los Excel adjuntos. Exportá backup antes si necesitás conservar datos actuales.</p>, onConfirm: () => applyState(freshSeedState(), 'Seed inicial restaurado.', 'warn') });
  return (
    <Section title="Ajustes" subtitle="Usuarios, bloqueo de edición directa, negativos, costos fijos, vencimientos y políticas.">
      <div className="card form-card"><div className="form-grid four-cols"><Field label="Usuario actual"><input value={settings.currentUser} onChange={(e) => setSettings({ ...settings, currentUser: e.target.value })} /></Field><Field label="Bloquear edición directa"><select value={settings.directEditLocked ? 'true' : 'false'} onChange={(e) => setSettings({ ...settings, directEditLocked: e.target.value === 'true' })}><option value="true">Sí</option><option value="false">No</option></select></Field><Field label="Permitir negativo"><select value={settings.allowNegative ? 'true' : 'false'} onChange={(e) => setSettings({ ...settings, allowNegative: e.target.value === 'true' })}><option value="false">No</option><option value="true">Sí</option></select></Field><Field label="Consumir packaging"><select value={settings.consumePackaging ? 'true' : 'false'} onChange={(e) => setSettings({ ...settings, consumePackaging: e.target.value === 'true' })}><option value="true">Sí</option><option value="false">No</option></select></Field><Field label="Mano obra 5L"><input type="number" value={settings.labor5L} onChange={(e) => setSettings({ ...settings, labor5L: toNumber(e.target.value) })} /></Field><Field label="Indirectos 5L"><input type="number" value={settings.indirect5L} onChange={(e) => setSettings({ ...settings, indirect5L: toNumber(e.target.value) })} /></Field><Field label="Yield etiqueta"><input type="number" value={settings.labelYield} onChange={(e) => setSettings({ ...settings, labelYield: toNumber(e.target.value) })} /></Field><Field label="Alerta vencimiento días"><input type="number" value={settings.alertExpiryDays} onChange={(e) => setSettings({ ...settings, alertExpiryDays: toNumber(e.target.value) })} /></Field></div><div className="button-row"><button className="primary" onClick={save}>Guardar ajustes</button><button className="danger" onClick={reset}>Restaurar seed</button></div></div>
    </Section>
  );
}

function EntityDrawer({ state, drawer, onClose, onOpenDrawer }: { state: AppState; drawer: DrawerState; onClose: () => void; onOpenDrawer: (type: string, id: string) => void }) {
  if (drawer.type === 'product') {
    const product = state.products.find((p) => p.id === drawer.id);
    if (!product) return null;
    const stock = productStock(state, product.id);
    const lots = state.productLots.filter((l) => l.productId === product.id);
    const sales = state.sales.filter((s) => s.productId === product.id).slice(-20).reverse();
    const formula = state.formulas.find((f) => f.id === product.formulaId);
    return <Drawer title={product.name} onClose={onClose}><StockTriple system={stock.system} physical={stock.physical} available={stock.available} /><div className="drawer-grid"><MiniStat label="SKU" value={product.sku} /><MiniStat label="Línea" value={product.line} /><MiniStat label="Precio" value={money(product.listPrice)} /><MiniStat label="Costo ref." value={money(product.costReference)} /><MiniStat label="Margen" value={money(product.listPrice - product.costReference)} /></div><h3>Lotes</h3><SmartTable rows={lots} dense columns={[{ key: 'lotNumber', header: 'Lote' }, { key: 'expiry', header: 'Vence', render: (l) => dateLabel(l.expiry) }, { key: 'qtyAvailable', header: 'Disp.', render: (l) => qty(l.qtyAvailable) }, { key: 'status', header: 'Estado' }]} onRowClick={(l) => onOpenDrawer('productLot', l.id)} /><h3>Fórmula</h3>{formula ? <SmartTable rows={formula.ingredients} dense maxRows={12} columns={[{ key: 'materialName', header: 'Insumo' }, { key: 'qty', header: 'Cantidad', render: (i) => qty(i.qty, i.unit) }]} /> : <EmptyState title="Sin fórmula" text="Asigná una fórmula para costeo y consumo automático." />}<h3>Ventas relacionadas</h3><SmartTable rows={sales} dense columns={[{ key: 'date', header: 'Fecha', render: (s) => dateLabel(s.date) }, { key: 'clientName', header: 'Cliente' }, { key: 'quantity', header: 'Cant.', render: (s) => qty(s.quantity) }, { key: 'total', header: 'Total', render: (s) => money(s.total) }]} /></Drawer>;
  }
  if (drawer.type === 'material') {
    const material = state.materials.find((m) => m.id === drawer.id);
    if (!material) return null;
    const stock = materialStock(state, material.id);
    const lots = state.materialLots.filter((l) => l.materialId === material.id);
    const purchases = state.purchases.filter((p) => p.materialId === material.id).slice(-20).reverse();
    return <Drawer title={material.name} onClose={onClose}><StockTriple system={stock.system} physical={stock.physical} available={stock.available} unit={material.unit} /><div className="drawer-grid"><MiniStat label="Categoría" value={material.category} /><MiniStat label="Unidad" value={material.unit} /><MiniStat label="Costo" value={money(material.unitCost)} /><MiniStat label="Stock min" value={qty(material.stockMin, material.unit)} /></div><h3>Lotes</h3><SmartTable rows={lots} dense columns={[{ key: 'lotNumber', header: 'Lote' }, { key: 'expiry', header: 'Vence', render: (l) => dateLabel(l.expiry) }, { key: 'qtyAvailable', header: 'Disp.', render: (l) => qty(l.qtyAvailable, material.unit) }, { key: 'status', header: 'Estado' }]} onRowClick={(l) => onOpenDrawer('materialLot', l.id)} /><h3>Compras</h3><SmartTable rows={purchases} dense columns={[{ key: 'date', header: 'Fecha', render: (p) => dateLabel(p.date) }, { key: 'quantity', header: 'Cantidad', render: (p) => qty(p.quantity, p.unit) }, { key: 'unitCost', header: 'Costo/u', render: (p) => money(p.unitCost) }]} /></Drawer>;
  }
  if (drawer.type === 'client') {
    const client = state.clients.find((c) => c.id === drawer.id);
    if (!client) return null;
    const metrics = clientMetrics(state, client.id);
    return <Drawer title={client.name} onClose={onClose}><div className="drawer-grid"><MiniStat label="Teléfono" value={client.phone || '—'} /><MiniStat label="Email" value={client.email || '—'} /><MiniStat label="Ciudad" value={client.city || '—'} /><MiniStat label="Segmento" value={client.segment} /><MiniStat label="Total comprado" value={money(metrics.total)} /><MiniStat label="Órdenes" value={metrics.orderCount} /><MiniStat label="Ticket promedio" value={money(metrics.averageTicket)} /><MiniStat label="Deuda" value={money(metrics.debt)} /></div><h3>Productos favoritos</h3>{metrics.favoriteProducts.map((p) => <div className="movement-line" key={p.name}><strong>{p.name}</strong><em>{qty(p.qty)}</em></div>)}<h3>Historial</h3><SmartTable rows={metrics.orders} dense columns={[{ key: 'date', header: 'Fecha', render: (o) => dateLabel(o.date) }, { key: 'total', header: 'Total', render: (o) => money(o.total) }, { key: 'balance', header: 'Saldo', render: (o) => money(o.balance) }, { key: 'status', header: 'Estado' }]} /></Drawer>;
  }
  if (drawer.type === 'productLot') {
    const traced = traceProductLot(state, drawer.id);
    if (!traced) return null;
    const { lot, sales, clients, supplierIds } = traced;
    return <Drawer title={`${lot.productName} · ${lot.lotNumber}`} onClose={onClose}><div className="drawer-grid"><MiniStat label="Vence" value={dateLabel(lot.expiry)} /><MiniStat label="Disponible" value={qty(lot.qtyAvailable)} /><MiniStat label="Costo/u" value={money(lot.unitCost)} /><MiniStat label="Estado" value={lot.status} /><MiniStat label="Ubicación" value={lot.location} /><MiniStat label="Proveedores MP" value={supplierIds.length} /></div><h3>MP usadas</h3><SmartTable rows={lot.materialsUsed} dense columns={[{ key: 'materialName', header: 'Insumo' }, { key: 'qty', header: 'Cantidad', render: (m) => qty(m.qty, m.unit) }, { key: 'cost', header: 'Costo', render: (m) => money(m.cost) }, { key: 'lots', header: 'Lotes MP', render: (m) => m.lotsUsed.map((l) => l.lotNumber).join(', ') }]} /><h3>Clientes alcanzados</h3>{clients.map((c) => <button className="list-button" key={c.id} onClick={() => onOpenDrawer('client', c.id)}><strong>{c.name}</strong><span>{c.city}</span></button>)}<h3>Ventas relacionadas</h3><SmartTable rows={sales} dense columns={[{ key: 'date', header: 'Fecha', render: (s) => dateLabel(s.date) }, { key: 'clientName', header: 'Cliente' }, { key: 'quantity', header: 'Cant.', render: (s) => qty(s.quantity) }]} /></Drawer>;
  }
  if (drawer.type === 'materialLot') {
    const traced = traceMaterialLot(state, drawer.id);
    if (!traced) return null;
    const { lot, productLots, clients } = traced;
    const supplier = state.suppliers.find((s) => s.id === lot.supplierId);
    return <Drawer title={`${lot.materialName} · ${lot.lotNumber}`} onClose={onClose}><div className="drawer-grid"><MiniStat label="Proveedor" value={supplier?.name ?? '—'} /><MiniStat label="Recibido" value={dateLabel(lot.receivedAt)} /><MiniStat label="Vence" value={dateLabel(lot.expiry)} /><MiniStat label="Disponible" value={qty(lot.qtyAvailable)} /><MiniStat label="Costo/u" value={money(lot.unitCost)} /><MiniStat label="Estado" value={lot.status} /></div><h3>Producciones donde se usó</h3><SmartTable rows={productLots} dense columns={[{ key: 'productName', header: 'Producto' }, { key: 'lotNumber', header: 'Lote PT' }, { key: 'producedAt', header: 'Producción', render: (l) => dateLabel(l.producedAt) }]} onRowClick={(l) => onOpenDrawer('productLot', l.id)} /><h3>Clientes alcanzados indirectamente</h3>{clients.map((c) => <button className="list-button" key={c.id} onClick={() => onOpenDrawer('client', c.id)}><strong>{c.name}</strong><span>{c.city}</span></button>)}</Drawer>;
  }
  if (drawer.type === 'supplier') {
    const supplier = state.suppliers.find((s) => s.id === drawer.id);
    if (!supplier) return null;
    const purchases = state.purchases.filter((p) => p.supplierId === supplier.id).slice(-30).reverse();
    const history = supplierPriceHistory(state, supplier.id).slice(0, 30);
    return <Drawer title={supplier.name} onClose={onClose}><div className="drawer-grid"><MiniStat label="Contacto" value={supplier.contact || '—'} /><MiniStat label="Teléfono" value={supplier.phone || '—'} /><MiniStat label="Email" value={supplier.email || '—'} /><MiniStat label="Compras" value={purchases.length} /></div><h3>Historial de compras</h3><SmartTable rows={purchases} dense columns={[{ key: 'date', header: 'Fecha', render: (p) => dateLabel(p.date) }, { key: 'materialName', header: 'Insumo' }, { key: 'quantity', header: 'Cantidad', render: (p) => qty(p.quantity, p.unit) }, { key: 'total', header: 'Total', render: (p) => money(p.total) }]} /><h3>Historial de precio</h3><SmartTable rows={history.map((h, i) => ({ id: String(i), ...h }))} dense columns={[{ key: 'material', header: 'Insumo' }, { key: 'date', header: 'Fecha', render: (h) => dateLabel(h.date) }, { key: 'unitCost', header: 'Costo unitario', render: (h) => money(h.unitCost) }]} /></Drawer>;
  }
  if (drawer.type === 'order') {
    const order = state.orders.find((o) => o.id === drawer.id);
    if (!order) return null;
    const sales = state.sales.filter((s) => s.orderId === order.id);
    return <Drawer title={`Orden ${order.id}`} onClose={onClose}><div className="drawer-grid"><MiniStat label="Cliente" value={order.clientName} /><MiniStat label="Fecha" value={dateLabel(order.date)} /><MiniStat label="Total" value={money(order.total)} /><MiniStat label="Pagado" value={money(order.amountPaid)} /><MiniStat label="Saldo" value={money(order.balance)} /><MiniStat label="Margen" value={money(order.grossMargin)} /></div><SmartTable rows={sales} dense columns={[{ key: 'productName', header: 'Producto' }, { key: 'quantity', header: 'Cant.', render: (s) => qty(s.quantity) }, { key: 'total', header: 'Total', render: (s) => money(s.total) }, { key: 'lots', header: 'Lotes', render: (s) => s.lotsUsed.map((l) => l.lotNumber).join(', ') }]} /></Drawer>;
  }
  return null;
}
