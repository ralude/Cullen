# Plan de ejecución 9B.13: KPIs de gerencia

- **Sub-fase:** [9B.13 KPIs de gerencia](./9b.13-kpis-de-gerencia.md)
- **Estado del plan:** ~~Implementado y cerrado 2026-09-05~~. El reporte de margen
  (`reports.margin.read`) netea descuentos y devoluciones, exige período UTC válido con cota en
  SQL, deriva `quantitySoldScaled` sin costo, separa escalas incompatibles y normaliza
  `currencyCode` a mayúsculas en la frontera. `reports.sales.read` y `reports.inventory.read`
  quedaron construidos sobre esa base (`GetSalesReport` / `GetInventoryReport` +
  `DrizzleSalesReportRepository` / `DrizzleInventoryReportRepository` + contratos + rutas +
  panel del renderer con exportación CSV visible).
- **Decisiones:** [ADR-0013](../../architecture/adr/0013-reportes-operativos-de-lectura.md),
  [ADR-0016](../../architecture/adr/0016-metodo-de-costeo-y-margen.md) y
  [ADR-0021](../../architecture/adr/0021-mvp-referencia-no-certificado.md)
- **Disciplina:** Outside-in TDD (ADR-0007) y Ponytail `full`

## Resultado esperado

Publicar un resumen acotado de ventas completadas e inventario del nodo, con ingreso neto,
devoluciones, costo de ventas y margen fiables. Cada cifra declara período, moneda y alcance;
React no recalcula reglas de negocio.

## Línea base comprobada

- Los reportes actuales cubren cierres, auditoría y fiscalidad con permisos, límites 100/500 y
  exportación CSV local.
- No existen `reports.sales.read` ni `reports.inventory.read`; `reports.margin.read`, su caso de
  uso y su adaptador SQLite sí existen.
- 9B.04 persiste costos de salida y 9B.06 persiste devoluciones, pero ambas se reabrieron: un
  ajuste sin costo puede inutilizar la valoración y la prueba contractual de devolución muere
  antes de invocar `POST /return`.
- El margen actual usa ingreso bruto sin descuentos ni devoluciones, suma cantidades solo en
  filas con costo y materializa filas sin `LIMIT` SQL antes de recortarlas en memoria.
- No hay librería de gráficos ni hace falta añadirla para entregar las lecturas.

## Contrato mínimo de indicadores

- **Ventas:** cantidad de ventas `COMPLETED`, cantidad de líneas y total vendido por moneda en
  un período UTC. No se suman cantidades de unidades o escalas distintas. Ventas `DRAFT` y
  `VOIDED` no cuentan.
- **Inventario:** existencia actual por producto/lote, productos sin existencia y lotes
  vencidos o próximos a vencer según una fecha de corte explícita.
- **Margen:** ingreso neto después de descuentos y devoluciones, costo de ventas neto de las
  reposiciones y margen absoluto por moneda. No se publica porcentaje cuando el denominador es
  cero.
- **Devoluciones:** se muestran por separado con cantidad e importe, permiten derivar venta
  neta y revierten costo usando sus snapshots. La venta original permanece inmutable.

No se denomina “rotación” a ninguna cifra en este corte: su fórmula, ventana y denominador no
están especificados. Agregarla exige criterios de aceptación propios, no bloquea estos KPIs.

## Decisiones de frontera

- Se añaden casos de uso de lectura y puertos especializados, no acceso SQL desde rutas ni un
  motor genérico de reportes.
- Ventas exige `reports.sales.read`, inventario `reports.inventory.read` y margen
  `reports.margin.read`; se autoriza antes de consultar.
- Toda consulta de KPIs recibe `from` y `to` UTC explícitos, además de límite recortado en
  aplicación. El adaptador agrega y limita en SQL; no materializa tablas completas. La
  semántica y la separación de monedas pertenecen a aplicación. Esta exigencia aplica a los
  KPIs de 9B.13; no cambia los filtros opcionales de los tres reportes originales de ADR-0013.
- `currencyCode` se normaliza a mayúsculas en la frontera o se rechaza con error estable.
- La exportación reutiliza el CSV visible de ADR-0013: no vuelve a consultar ni agrega datos.

## Secuencia outside-in

1. Probar cada permiso y demostrar que `FORBIDDEN` no ejecuta el repositorio.
2. Probar rechazo de período ausente/inválido, límites, estados excluidos y dos monedas
   separadas.
3. Probar inventario actual con lotes, vencimientos y corte UTC.
4. Publicar contratos, adaptadores SQLite, rutas y tarjetas/listados mínimos.
5. Cerrar A1/A2 de 9B.04 y probar costo estable tras saldo cero, merma, ajuste y conteo.
6. Probar ingreso neto con descuentos y devoluciones, reverso de costo por snapshot y venta
   original inmutable.
7. Probar que cantidad vendida proviene de líneas de venta aunque falte costo y que nunca suma
   escalas incompatibles.
8. Probar que la consulta agregada lleva cota SQL y que moneda minúscula se normaliza o rechaza.
9. Probar exportación desde la proyección visible y neutralización CSV ya existente.
10. Ejecutar verificaciones y actualizar el cronograma en cada entrega incremental.

## Criterios de aceptación

- [x] ~~Ventas e inventario funcionan independientemente de 9B.04.~~ `GetSalesReport` agrega
  líneas de venta; `GetInventoryReport` deriva saldo de movimientos; ninguno depende del costo.
- [x] ~~Cada lectura autoriza en aplicación y siempre consulta con cota.~~ `reports.sales.read`
  / `reports.inventory.read` autorizan antes de consultar (prueba `queries === []` en denegación)
  y aplican `resolveRowLimit`; la agregación y el `limit` ocurren en SQL.
- [x] ~~Monedas y períodos explícitos y válidos; sin conversiones implícitas ni filtros
  sensibles a casing.~~ `from`/`to` (o `asOf`) obligatorios y validados (`REPORT_PERIOD_INVALID`);
  `currencyCode` se normaliza a mayúsculas en la frontera y el contrato rechaza `^[A-Z]{3}$`.
- [x] ~~Margen usa ingreso neto de descuentos/devoluciones y costo histórico estable.~~ Ver
  Corte 4 del plan correctivo.
- [x] ~~`quantitySoldScaled` no depende del costo y no mezcla escalas.~~ `sale_group` separado
  de `cost_group`, ambos agrupan por `quantity_scale`.
- [x] ~~El renderer presenta los valores recibidos y reutiliza la exportación existente.~~
  Paneles «Ventas» e «Inventario» en `reports.tsx` con `downloadCsv` visible.
- [x] ~~No se añade dependencia de visualización ni abstracción genérica de BI.~~ Solo tablas
  y CSV.
- [x] ~~`pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.~~ 580 pruebas / 119 archivos.

## Fuera de alcance

- Rotación sin fórmula aprobada, proyecciones, metas, alertas y comparativos multi-sucursal.
- Cubos, data warehouse, dashboards configurables y optimización de Fase 12.
- Consolidación y ownership multi-nodo de Fase 10.
