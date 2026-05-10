import { useEffect, useMemo, useState } from 'react';
import type { AppState } from './types';
import { includesText, money, qty } from './utils';

export function LogoMark({ compact = false }: { compact?: boolean }) {
  const src = `${import.meta.env.BASE_URL}logo-jm.jpeg`;
  return (
    <div className={compact ? 'logo compact' : 'logo'}>
      <img src={src} alt="JM Hair Cosmetic" />
      {!compact && (
        <div>
          <strong>JM Stock Suite</strong>
          <span>Hair Cosmetic</span>
        </div>
      )}
    </div>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'good' | 'warn' | 'danger' | 'info' }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function KPI({ label, value, hint, tone = 'neutral' }: { label: string; value: string | number; hint?: string; tone?: 'neutral' | 'good' | 'warn' | 'danger' }) {
  return (
    <div className={`kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export function Modal({ title, children, onClose, footer, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; footer?: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </section>
    </div>
  );
}

export function ConfirmModal({ title, children, confirmLabel = 'Confirmar', danger = false, onCancel, onConfirm }: { title: string; children: React.ReactNode; confirmLabel?: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      wide
      footer={(
        <>
          <button className="ghost" onClick={onCancel}>Cancelar</button>
          <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</button>
        </>
      )}
    >
      {children}
    </Modal>
  );
}

export function Drawer({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  value?: (row: T) => string | number;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

type SmartTableMode = 'paged' | 'incremental';

export function SmartTable<T extends object>({ rows, columns, onRowClick, dense = false, maxRows, page = 1, pageSize = 50, onPageChange, mode = 'paged' }: { rows: T[]; columns: Column<T>[]; onRowClick?: (row: T) => void; dense?: boolean; maxRows?: number; page?: number; pageSize?: number; onPageChange?: (page: number, pageSize: number) => void; mode?: SmartTableMode }) {
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: columns[0]?.key ?? 'id', direction: 'asc' });
  const sortedRows = useMemo(() => {
    const column = columns.find((c) => c.key === sort.key);
    const getter = column?.value ?? ((row: T) => String((row as Record<string, unknown>)[sort.key] ?? ''));
    return [...rows].sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      const factor = sort.direction === 'asc' ? 1 : -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv), 'es') * factor;
    });
  }, [rows, columns, sort]);
  const limitedRows = typeof maxRows === 'number' ? sortedRows.slice(0, maxRows) : sortedRows;
  const safePageSize = Math.max(1, pageSize);
  const maxPage = Math.max(1, Math.ceil(limitedRows.length / safePageSize));
  const safePage = Math.min(Math.max(1, page), maxPage);
  useEffect(() => {
    if (!onPageChange) return;
    if (safePage !== page) onPageChange(safePage, safePageSize);
  }, [safePage, page, safePageSize, onPageChange]);
  const visible = useMemo(() => {
    if (mode === 'incremental') {
      return limitedRows.slice(0, safePage * safePageSize);
    }
    const start = (safePage - 1) * safePageSize;
    return limitedRows.slice(start, start + safePageSize);
  }, [limitedRows, mode, safePage, safePageSize]);
  const handlePageSize = (value: number) => onPageChange?.(1, value);
  return (
    <div className="table-wrap">
      <div className="table-meta">
        <small>Mostrando {visible.length.toLocaleString('es-AR')} de {limitedRows.length.toLocaleString('es-AR')} registros</small>
        {onPageChange && (
          <div className="table-controls">
            <label>Tamaño
              <select value={safePageSize} onChange={(event) => handlePageSize(Number(event.target.value))}>
                {[25, 50, 100, 250].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <button className="ghost" onClick={() => onPageChange(Math.max(1, safePage - 1), safePageSize)} disabled={safePage <= 1}>Anterior</button>
            <span>{mode === 'incremental' ? `Lote ${safePage}` : `Página ${safePage} de ${maxPage}`}</span>
            <button className="ghost" onClick={() => onPageChange(Math.min(maxPage, safePage + 1), safePageSize)} disabled={safePage >= maxPage}>{mode === 'incremental' ? 'Cargar más' : 'Siguiente'}</button>
          </div>
        )}
      </div>
      <table className={dense ? 'smart-table dense' : 'smart-table'}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className} onClick={() => column.sortable !== false && setSort((old) => ({ key: column.key, direction: old.key === column.key && old.direction === 'asc' ? 'desc' : 'asc' }))}>
                {column.header} {sort.key === column.key ? (sort.direction === 'asc' ? '↑' : '↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => (
            <tr key={String((row as Record<string, unknown>).id ?? index)} onClick={() => onRowClick?.(row)} className={onRowClick ? 'clickable' : ''}>
              {columns.map((column) => <td key={column.key} className={column.className}>{column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const width = Math.max(0, Math.min(100, value));
  return <div className="progress"><span style={{ width: `${width}%` }} /></div>;
}

interface PaletteItem {
  label: string;
  meta: string;
  action: () => void;
}

export function CommandPalette({ state, open, onClose, onNavigate, onOpenDrawer, onExport }: { state: AppState; open: boolean; onClose: () => void; onNavigate: (page: string) => void; onOpenDrawer: (type: string, id: string) => void; onExport: () => void }) {
  const [query, setQuery] = useState('');
  const items = useMemo<PaletteItem[]>(() => {
    const quick: PaletteItem[] = [
      { label: 'Crear venta', meta: 'Acción rápida', action: () => onNavigate('Ventas') },
      { label: 'Registrar producción', meta: 'Acción rápida', action: () => onNavigate('Producción') },
      { label: 'Registrar compra', meta: 'Acción rápida', action: () => onNavigate('Compras') },
      { label: 'Contar inventario', meta: 'Acción rápida', action: () => onNavigate('Inventario físico') },
      { label: 'Exportar suite', meta: 'Backup / Excel', action: onExport }
    ];
    const entities: PaletteItem[] = [
      ...state.products.slice(0, 500).map((p) => ({ label: p.name, meta: `Producto · ${p.sku}`, action: () => onOpenDrawer('product', p.id) })),
      ...state.clients.slice(0, 500).map((c) => ({ label: c.name, meta: `Cliente · ${c.city || c.province || c.segment}`, action: () => onOpenDrawer('client', c.id) })),
      ...state.productLots.slice(0, 300).map((l) => ({ label: l.lotNumber, meta: `Lote PT · ${l.productName}`, action: () => onOpenDrawer('productLot', l.id) })),
      ...state.materialLots.slice(0, 300).map((l) => ({ label: l.lotNumber, meta: `Lote MP · ${l.materialName}`, action: () => onOpenDrawer('materialLot', l.id) })),
      ...state.suppliers.map((s) => ({ label: s.name, meta: 'Proveedor', action: () => onOpenDrawer('supplier', s.id) })),
      ...state.orders.slice(-100).map((o) => ({ label: o.id, meta: `Orden · ${o.clientName} · ${money(o.total)}`, action: () => onOpenDrawer('order', o.id) }))
    ];
    const all = [...quick, ...entities];
    return query ? all.filter((item) => includesText(`${item.label} ${item.meta}`, query)).slice(0, 30) : all.slice(0, 20);
  }, [state, query, onNavigate, onOpenDrawer, onExport]);

  if (!open) return null;
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <section className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <input autoFocus placeholder="Buscar productos, clientes, lotes, proveedores u órdenes…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="palette-list">
          {items.map((item) => (
            <button key={`${item.meta}-${item.label}`} onClick={() => { item.action(); onClose(); }}>
              <strong>{item.label}</strong>
              <span>{item.meta}</span>
            </button>
          ))}
        </div>
        <small>⌘K / Ctrl+K para abrir · Esc para cerrar</small>
      </section>
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: string | number }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>;
}

export function StockTriple({ system, physical, available, unit = 'u' }: { system: number; physical: number | null; available: number; unit?: string }) {
  return (
    <div className="stock-triple">
      <span>Sistema <b>{qty(system, unit)}</b></span>
      <span>Físico <b>{physical == null ? '—' : qty(physical, unit)}</b></span>
      <span>Disponible <b>{qty(available, unit)}</b></span>
    </div>
  );
}
