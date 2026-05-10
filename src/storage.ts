import type { AppState, Settings } from './types';
import { seedState } from './data/seed';
import { clone, nowISO } from './utils';

const DB_NAME = 'jm-stock-suite-db';
const DB_VERSION = 1;
const STORE_NAME = 'suite';
const STATE_KEY = 'state';
const LS_KEY = 'jm-stock-suite:last-backup';
const SCHEMA_VERSION = 1;

const defaultSettings: Settings = {
  currentUser: 'JM Admin',
  directEditLocked: true,
  allowNegative: false,
  consumePackaging: true,
  labor5L: 5454.55,
  indirect5L: 4545.45,
  labelYield: 1,
  alertExpiryDays: 45,
  expiryPolicies: {
    SHAMPOO: 24,
    ACEITE: 18,
    MUESTRA: 6,
    DEFAULT: 24
  }
};

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no está disponible en este navegador.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB.'));
  });
}

function getFromDB(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function setInDB(db: IDBDatabase, state: AppState): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(state, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function migrateState(raw: unknown): AppState {
  const base = clone(seedState);
  const incoming = (raw && typeof raw === 'object') ? raw as Partial<AppState> : {};
  const state: AppState = {
    ...base,
    ...incoming,
    schemaVersion: SCHEMA_VERSION,
    products: Array.isArray(incoming.products) ? incoming.products : base.products,
    materials: Array.isArray(incoming.materials) ? incoming.materials : base.materials,
    formulas: Array.isArray(incoming.formulas) ? incoming.formulas : base.formulas,
    productLots: Array.isArray(incoming.productLots) ? incoming.productLots : base.productLots,
    materialLots: Array.isArray(incoming.materialLots) ? incoming.materialLots : base.materialLots,
    suppliers: Array.isArray(incoming.suppliers) ? incoming.suppliers : base.suppliers,
    purchases: Array.isArray(incoming.purchases) ? incoming.purchases : base.purchases,
    clients: Array.isArray(incoming.clients) ? incoming.clients : base.clients,
    orders: Array.isArray(incoming.orders) ? incoming.orders : base.orders,
    sales: Array.isArray(incoming.sales) ? incoming.sales : base.sales,
    combos: Array.isArray(incoming.combos) ? incoming.combos : base.combos,
    inventoryCounts: Array.isArray(incoming.inventoryCounts) ? incoming.inventoryCounts : base.inventoryCounts,
    movements: Array.isArray(incoming.movements) ? incoming.movements : base.movements,
    auditLog: Array.isArray(incoming.auditLog) ? incoming.auditLog : base.auditLog,
    importExportLog: Array.isArray(incoming.importExportLog) ? incoming.importExportLog : base.importExportLog,
    settings: { ...defaultSettings, ...(incoming.settings ?? {}) },
    physicalSnapshots: incoming.physicalSnapshots ?? {}
  };
  return state;
}

export async function loadState(): Promise<AppState> {
  try {
    const db = await openDB();
    const data = await getFromDB(db);
    db.close();
    if (data) return migrateState(data);
  } catch (error) {
    console.warn('IndexedDB load fallback:', error);
  }
  try {
    const ls = localStorage.getItem(LS_KEY);
    if (ls) return migrateState(JSON.parse(ls));
  } catch (error) {
    console.warn('localStorage load fallback:', error);
  }
  const state = migrateState(seedState);
  state.auditLog = [
    ...state.auditLog,
    {
      id: `aud-first-${Date.now()}`,
      date: nowISO(),
      user: state.settings.currentUser,
      module: 'sistema',
      entityId: 'init',
      field: 'state',
      before: '',
      after: 'Seed inicial cargado',
      reason: 'Primera apertura de JM Stock Suite',
      origin: 'integridad'
    }
  ];
  return state;
}

export async function saveState(state: AppState): Promise<void> {
  const migrated = migrateState(state);
  try {
    const db = await openDB();
    await setInDB(db, migrated);
    db.close();
  } catch (error) {
    console.warn('IndexedDB save fallback:', error);
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(migrated));
  } catch (error) {
    console.warn('No se pudo guardar backup en localStorage:', error);
  }
}

export function exportBackup(state: AppState): string {
  return JSON.stringify({ ...migrateState(state), exportedAt: nowISO(), app: 'JM Stock Suite' }, null, 2);
}

export function restoreBackup(file: File): Promise<AppState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result ?? '{}'));
        resolve(migrateState(raw));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo.'));
    reader.readAsText(file, 'utf-8');
  });
}

export function freshSeedState(): AppState {
  return migrateState(seedState);
}
