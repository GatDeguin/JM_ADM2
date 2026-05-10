import { formatDateAR, fromISODate, toISODateLocal } from './date';
export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export const todayISO = () => toISODateLocal(new Date());
export const nowISO = () => new Date().toISOString();

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function money(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value || 0);
}

export function qty(value: number, unit = ''): string {
  const formatted = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(value || 0);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function dateLabel(value?: string | null): string {
  return formatDateAR(value);
}

export function addMonths(date: string, months: number): string {
  const parsed = fromISODate(date);
  if (!parsed) return date;
  parsed.setMonth(parsed.getMonth() + months);
  return toISODateLocal(parsed);
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a.slice(0, 10)}T00:00:00`).getTime();
  const db = new Date(`${b.slice(0, 10)}T00:00:00`).getTime();
  return Math.round((db - da) / 86400000);
}

export function isExpired(expiry?: string | null, at = todayISO()): boolean {
  return Boolean(expiry && expiry < at);
}

export function isNearExpiry(expiry?: string | null, days = 45, at = todayISO()): boolean {
  if (!expiry) return false;
  const remaining = daysBetween(at, expiry);
  return remaining >= 0 && remaining <= days;
}

export function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function includesText(haystack: unknown, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

export function slug(value: unknown): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

export function parseMl(size: string): number {
  const txt = normalize(size).replace(/\s+/g, '').replace(',', '.');
  const ml = txt.match(/(\d+(?:\.\d+)?)ml/);
  if (ml) return Math.round(Number(ml[1]));
  const l = txt.match(/(\d+(?:\.\d+)?)(l|lt|lts)$/);
  if (l) return Math.round(Number(l[1]) * 1000);
  return 0;
}

export interface FileDownloadResult {
  ok: boolean;
  method: 'direct' | 'new_tab' | 'none';
  reason?: string;
}

export function fileDownload(filename: string, content: string | Blob, type = 'text/plain;charset=utf-8'): FileDownloadResult {
  try {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    let openedInNewTab = false;
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      const popup = window.open(url, '_blank', 'noopener,noreferrer');
      openedInNewTab = Boolean(popup);
      if (!openedInNewTab) {
        URL.revokeObjectURL(url);
        return { ok: false, method: 'none', reason: 'Descarga/popup bloqueado por el navegador.' };
      }
    }
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { ok: true, method: openedInNewTab ? 'new_tab' : 'direct' };
  } catch (error) {
    return { ok: false, method: 'none', reason: error instanceof Error ? error.message : 'Error desconocido al descargar archivo.' };
  }
}

export function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (/[,"\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sortBy<T>(rows: T[], key: keyof T | string, direction: 'asc' | 'desc'): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = String((a as Record<string, unknown>)[String(key)] ?? '').toLowerCase();
    const bv = String((b as Record<string, unknown>)[String(key)] ?? '').toLowerCase();
    const an = Number(av);
    const bn = Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn) && av !== '' && bv !== '') return (an - bn) * factor;
    return av.localeCompare(bv, 'es') * factor;
  });
}
