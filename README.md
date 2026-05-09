# JM Stock Suite

Suite local-first para JM Hair Cosmetic. Construida en React + TypeScript + Vite, sin backend obligatorio y preparada para GitHub Pages.

## Qué incluye

- Persistencia principal en IndexedDB con backup espejo en localStorage.
- Backup JSON completo y restore JSON con confirmación.
- Exportación Excel multihoja compatible mediante XML Spreadsheet `.xls`.
- Importador CSV/JSON con preview y confirmación para clientes, productos, materiales, proveedores y compras.
- Stock de producto terminado, materias primas, envases, tapas y etiquetas por lote.
- Producción con fórmula, consumo FEFO de insumos, lote manual, vencimiento y costeo real.
- Ventas por orden con cliente activo obligatorio, múltiples líneas, combos, descuentos, pagos parciales, saldo/deuda y FEFO.
- Compras, proveedores, inventario físico, movimientos, auditoría, integridad, dashboard financiero, command palette y drawer lateral.
- Datos seed generados desde los archivos Excel adjuntos: clientes 2026, control de inventario/stock y ventas.

## Desarrollo

```bash
npm install
npm run dev
```

## Build productivo

```bash
npm run build
```

La salida estática queda en `dist/`. El proyecto está configurado con `base: './'` para funcionar en GitHub Pages incluso dentro de un subdirectorio.

## Despliegue en GitHub Pages

El repo ya incluye un workflow automático en `.github/workflows/deploy-pages.yml`.

1. Asegurarse de usar la rama `main` como rama de trabajo.
2. En GitHub, ir a **Settings → Pages → Build and deployment** y seleccionar **Source: GitHub Actions**.
3. Hacer push a `main` (o lanzar manualmente el workflow **Deploy to GitHub Pages** desde la pestaña Actions).
4. El workflow ejecuta `npm ci`, `npm run build` y publica `dist/` en Pages.

La app usa base dinámica de Vite: en local funciona con `./` y en GitHub Actions publica con `/JM_ADM2/`.

## Operación local-first

La base local se guarda en IndexedDB (`jm-stock-suite-db`) y mantiene un respaldo en localStorage. Para preservar datos entre navegadores/equipos, usar **Backup JSON completo** y **Restaurar backup JSON** desde el módulo Importar/Exportar.

## QA

El build fue verificado con:

```bash
npm run build
```

Además, el módulo Auditoría ejecuta tests internos de FEFO, validaciones, exportación, integridad y movimientos/auditoría.
