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

1. Ejecutar `npm run build`.
2. Publicar el contenido de `dist/` en GitHub Pages, o configurar una GitHub Action que ejecute el build y despliegue esa carpeta.
3. No se requiere servidor ni backend.

## Operación local-first

La base local se guarda en IndexedDB (`jm-stock-suite-db`) y mantiene un respaldo en localStorage. Para preservar datos entre navegadores/equipos, usar **Backup JSON completo** y **Restaurar backup JSON** desde el módulo Importar/Exportar.

## QA

El build fue verificado con:

```bash
npm run build
```

Además, el módulo Auditoría ejecuta tests internos de FEFO, validaciones, exportación, integridad y movimientos/auditoría.
