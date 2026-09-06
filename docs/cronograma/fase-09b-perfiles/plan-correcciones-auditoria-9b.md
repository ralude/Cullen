# Plan correctivo de la Fase 9B antes de continuar

- **Estado:** ~~Gate abierto y bloqueante~~ → **CERRADO 2026-09-05** (Cortes 0-4)
- **Origen:** Auditoría técnica del 2026-09-05
- **Alcance:** Corregir la línea base y los criterios invalidados de 9B.04, 9B.06, 9B.07,
  9B.10, 9B.11, 9B.12 y 9B.13 antes de ensamblar perfiles.
- **Disciplina:** Outside-in TDD (ADR-0007), migraciones forward-only y cambios mínimos.

## Motivo del gate

La prueba contractual de devolución
`apps/server/src/routes/sales.contract.test.ts` falla antes de invocar el endpoint que debía
probar. La ejecución focal del 2026-09-05 confirmó 1 fallo y 6 pruebas aprobadas: la respuesta
de `POST /api/v1/sales/:saleId/items` es una venta completa, pero el fixture la interpreta como
una línea y entrega `productId` indefinido a `StockItem.create`.

El pipeline completo confirmó `pnpm lint` y `pnpm typecheck` verdes, seguido de 116 archivos y
549 pruebas aprobadas con ese único archivo/prueba en rojo. La línea base no vuelve a declararse
verde hasta que el mismo pipeline termine con código cero.

La auditoría también encontró invariantes de costo, autorización, idempotencia, concurrencia y
ownership que contradicen criterios ya marcados como cumplidos. Las tareas terminadas se
conservan como historia, pero las sub-fases afectadas vuelven a estado de corrección.

## Orden obligatorio de corrección

### Corte 0 — Restaurar la línea base — ~~CERRADO 2026-09-05~~

- [x] ~~Corregir el fixture contractual para obtener la línea desde la venta devuelta por
  `POST /items` y comprobar los estados de cada paso preparatorio.~~ `sales.contract.test.ts`
  toma la línea con `itemResponse.json<SaleResponse>().items[0]` tras verificar cada paso.
- [x] ~~Demostrar que `POST /api/v1/sales/:saleId/return` sí se ejecuta, devuelve
  `creditNoteStatus: "ISSUED"` y reproduce exactamente la misma evidencia con la misma clave.~~
  Prueba «returns a completed sale through SQLite and replays the same evidence».
- [x] ~~Ejecutar la suite completa. No comienza otro corte mientras `pnpm test` esté rojo.~~
  `pnpm test` 559/559, `pnpm typecheck`, `pnpm lint` y `git diff --check` verdes el 2026-09-05,
  tras completar la persistencia de `originNodeId` (migración `0026-aggregate-origin-node`) que
  la sesión previa había dejado a medias.

### Corte 1 — Recuperar el invariante de costo y la recepción — ~~CERRADO 2026-09-05~~

- [x] ~~Actualizar ADR-0016 antes de implementar para decidir cómo persiste la moneda de
  valoración de `StockItem`, incluso con saldo cero, y cómo se representa historia sin costo
  conocida.~~ `valuationCurrencyCode` de escritura única, no inferida de `averageUnitCost`.
- [x] ~~Probar que un conteo, merma o ajuste sin costo nuevo no elimina para siempre un costo
  histórico conocido ni permite mezclar monedas de valoración.~~ `stock-item.test.ts`: «keeps
  valuation through costless operational movements», «keeps the valuation currency at zero
  balance and rejects a different currency», «recovers valuation after unknown-cost history is
  fully exhausted».
- [x] ~~Definir una migración forward-only: solo hace backfill cuando el dato se deriva sin
  ambigüedad; cualquier historia indeterminada queda explícita y no se inventa.~~ Migración
  `0022` (`count(distinct) = 1`) con prueba «backfills stock valuation currency only from
  unambiguous cost history».
- [x] ~~Resolver el duplicado de número de control como `PURCHASE_RECEIPT_SOURCE_DUPLICATED`,
  antes de depender del error interno de SQLite.~~ `CompletePurchaseReceipt` con
  `findCompletedBySource` / `findCompletedByControlNumber`; prueba «returns the stable
  duplicate-source error for a repeated control number».
- [x] ~~Evitar que un `DRAFT` abandonado cree `StockItem` o lote durable; esos efectos se
  confirman al completar dentro de la `UnitOfWork`.~~ `StartPurchaseReceipt` solo persiste la
  recepción; unidad, escala y lote viajan como evidencia en la línea (migración `0023`).
  Prueba: `expect(stockItems.values.size).toBe(0)` tras iniciar el borrador.
- [x] ~~Validar `receipt.reverse()` antes de registrar movimientos compensatorios y conservar
  el rollback transaccional.~~ `receipt.assertCanReverse(...)` se invoca antes del bucle de
  compensación; prueba «reverses a completed receipt ... and blocks it when stock was already
  sold».
- [x] ~~Aplicar la decisión de ownership a `PurchaseReceipt` y probar su round-trip y rechazo de
  escritura desde un nodo no dueño.~~ `originNodeId` persistido (migración `0026`), repo
  rechaza `AGGREGATE_OWNER_MISMATCH` / `AGGREGATE_OWNER_UNRESOLVED`; prueba «rejects completing
  or reversing a receipt from a node that does not own it».

### Corte 2 — Cerrar autorización, intención y concurrencia — ~~CERRADO 2026-09-05~~

- [x] ~~Autorizar en aplicación todas las lecturas de sucursales, dispositivos, proveedores,
  recepciones y conteos, además de las lecturas de turno/kardex.~~ `GetBranch`/`ListBranches`,
  `ListDevices`, `GetSupplier`/`ListSuppliers`, `GetPurchaseReceipt`, `GetStockCount`/
  `ListStockCounts` y ahora `GetKardex` (`inventory.kardex.read`) autorizan antes de tocar el
  repositorio; prueba «denies reading the kardex without the kardex read permission»
  (`repositoryTouched === false`).
- [x] ~~Ampliar la matriz contractual de permisos a configuración, conteos y devoluciones.~~
  `permission-contracts.test.ts` cubre conteos, configuración (branch/device), devolución
  (`returnSaleContract`), proveedores, recepciones y `getKardexContract`.
- [x] ~~Exigir unicidad del identificador de dispositivo con regla de aplicación y restricción
  de base de datos coherentes.~~ `DeclareDevice`/`UpdateDevice` consultan `findByIdentifier`
  (`DEVICE_IDENTIFIER_CONFLICT`); migración `0024` crea `devices_identifier_unique` sobre
  `upper(identifier)`. Pruebas en `config-use-cases.test.ts` (aplicación) y
  `device-repository.test.ts` (índice único case-insensitive con el guard bypasseado).
- [x] ~~Capturar el motivo del operador para cambios sensibles; el renderer no fabrica textos
  de auditoría.~~ `config.tsx` y `stock-counts.tsx` envían el motivo escrito por el operador.
- [x] ~~Mantener una clave de idempotencia por intención de formulario durante doble clic,
  timeout y reintento; generar otra solo al iniciar una intención nueva.~~ `stock-counts.tsx`
  mantiene `intentKeys` por intención y solo regenera al cambiar la intención.
- [x] ~~Resolver y documentar si se permite más de un conteo `OPEN` sobre el mismo alcance.~~
  Decisión 2: uno por nodo (ver arriba).
- [x] ~~Prueba: un movimiento de stock entre `COUNTED` y `APPROVED` produce saldo final =
  contado + movimientos posteriores (delta con signo).~~ `stock-count-use-cases.test.ts`
  «applies the frozen difference as a signed delta over movements booked after the close».
- [x] ~~Prueba del `OPEN` único por nodo a nivel de contrato HTTP.~~
  `stock-counts.contract.test.ts` «rejects opening a second count while one is already open on
  the node» → `409 STOCK_COUNT_ALREADY_OPEN`.
- [x] ~~Formatear cantidades con las primitivas decimales existentes, sin `float`, y usar los
  tipos reales de Electron para que `typecheck` verifique `webPreferences`.~~
  `formatScaledDecimal` usa aritmética entera/cadena; se eliminó el stub `electron.d.ts` y
  `main/index.ts` importa `electron@44.1.0` real, verificado por `pnpm typecheck`.
- [x] ~~Aplicar la decisión de ownership a `StockCount`, `Branch` y `Device`, con pruebas de
  persistencia.~~ `originNodeId` persistido (migración `0026`); round-trip y rechazo de nodo
  ajeno en `branch-repository.test.ts`, `device-repository.test.ts`,
  `stock-count-repository.test.ts` y `config-use-cases.test.ts`.

**Diferido (sin dato que lo requiera):** el caso de uso de corrección administrativa
`originNodeId` (`null → valor`). El MVP no tiene filas sin resolver: toda alta escribe
`originNodeId` (regla de dominio + trigger `*_origin_node_required`) y los triggers
`*_origin_node_immutable` bloquean `valor → otro` y `valor → null`. Ninguna ruta de escritura
—repo o SQL— puede crear ni mutar un ownership sin resolver. Cuando una migración real produzca
una fila `null`, se añade el caso de uso con motivo y auditoría; hasta entonces el invariante
queda fail-closed y no se construye maquinaria especulativa (AGENTS.md §8).

### Corte 3 — Hacer explícita la semántica de arqueo e historia — ~~CERRADO 2026-09-05~~

- [x] ~~Definir “turno ajeno” con una regla aprobada.~~ `Shift.openedBy !== context.actorId`:
  leer un turno propio exige el permiso base; leer uno ajeno o cerrado que el actor no abrió
  exige `cash.shift.read.any`. Registrado en `plan-9b.12-arqueos-y-autorizaciones.md`; la
  publicación de las rutas de lectura de arqueo es trabajo de 9B.12.
- [x] ~~Definir en ADR-0017 y en el escenario de fallo si un reintegro puede producir saldo
  esperado negativo y cómo se presenta/recupera.~~ ADR-0017 punto 8 + FS-006: no se bloquea el
  cierre, pero exige motivo y autorización de supervisor. Implementado en `CloseShift`
  (`SHIFT_NEGATIVE_EXPECTED_REASON_REQUIRED` + `cash.shift.close.difference`), que registra
  `negativeExpectedMethods` en la auditoría del cierre; prueba «requires an explicit reason and
  supervisor authorization to close with a negative expected balance».
- [x] ~~Incorporar devolución y cambios de destinatario a la historia consultable de la venta,
  aunque la devolución viva en el agregado `SaleReturn`.~~ `GetSaleHistory` pliega
  `SaleRecipientChanged` y `SaleReturned` (vía `SaleReturnRepository.findBySaleId`); prueba
  «folds the recipient change and the return into the sale history».
- [x] ~~Probar autorización, límite y auditoría de acceso antes de publicar las lecturas.~~
  `GetSaleHistory` autoriza con `sale.history.read` antes de tocar el event store y acota las
  versiones con `resolveRowLimit`; pruebas «denies the read without the history permission» y
  «bounds the number of returned versions». La auditoría de acceso a lecturas no es un patrón
  vigente en el resto de reportes; queda para 9B.12/9B.13 si el negocio la pide al publicar.

### Corte 4 — Corregir y completar KPIs — ~~CERRADO 2026-09-05~~

- [x] ~~Calcular ingreso neto descontando descuentos de línea.~~ La CTE de
  `DrizzleMarginReportRepository` calcula `gross - discount` por línea; prueba «aggregates
  margin ... discountMinorUnits: 40, revenueMinorUnits: 560».
- [x] ~~Exponer devoluciones por separado y restarlas de venta neta y costo mediante sus
  snapshots, sin reescribir la venta original.~~ Campos `quantityReturnedScaled`,
  `returnRevenueMinorUnits`, `returnCostMinorUnits` desde `sale_returns` / `sale_return_lines`;
  misma prueba cubre la devolución total que deja `marginMinorUnits: 0`.
- [x] ~~Exigir `from` y `to` UTC válidos y aplicar la cota en SQL sobre la agregación.~~
  `GetMarginReport` rechaza `REPORT_PERIOD_INVALID` (fecha inválida o `from > to`); la CTE
  filtra `between @from and @to` dentro de SQL. Pruebas «rejects a margin report with an
  invalid or unordered UTC period» y el filtro de período fuera de rango → `[]`.
- [x] ~~Derivar `quantitySoldScaled` de líneas vendidas aunque falte costo y separar escalas
  incompatibles antes de sumarlas.~~ `sale_group` es independiente de `cost_group`; ambas
  agrupan por `quantity_scale`. Prueba «derives quantity sold without a frozen cost and keeps
  incompatible scales apart» (`costMinorUnits: null`, filas separadas por escala).
- [x] ~~Normalizar `currencyCode` a mayúsculas en la frontera.~~ `GetMarginReport` hace
  `trim().toUpperCase()` del filtro antes de llamar al repositorio; prueba «normalizes the
  margin currency filter to upper case at the boundary».
- [x] ~~Implementar las lecturas nuevas `reports.sales.read` y `reports.inventory.read` sobre
  esta base corregida.~~ `GetSalesReport` / `GetInventoryReport` + `DrizzleSalesReportRepository`
  / `DrizzleInventoryReportRepository` + contratos + rutas + panel del renderer. Pruebas:
  `reporting.test.ts` (autorización y cota), `reporting-repositories.test.ts` (agregación en
  SQL, escalas separadas, saldo derivado hasta el corte), `reports.contract.test.ts`
  (proyección de extremo a extremo, 401/403).

## Decisiones que bloquean implementación

1. **Costo y moneda de valoración (A1/A2):** ~~aceptada 2026-09-05~~. ADR-0016 fija
   `valuationCurrencyCode` como atributo de **escritura única** (`null → CÓDIGO`, nunca otra
   transición), independiente del saldo, con trigger y regla de aplicación coherentes. La
   migración `0022` solo fija moneda cuando la historia es inequívoca (`count(distinct) = 1`).
   Un artículo sin costo que nunca vuelve a recibir entrada valorada queda mudo en el KPI de
   margen: riesgo **aceptado explícitamente** en Consecuencias; su salida es la «valoración
   inicial administrativa» diferida (Alternativas diferidas de ADR-0016).
2. **Conteos solapados (M5):** ~~aceptada 2026-09-05~~. Un `OPEN` por nodo, verificado en
   aplicación dentro de la transacción (`STOCK_COUNT_ALREADY_OPEN`) con índice parcial de
   respaldo. Motivo: todavía no hay almacenes; cuando entre ADR-0020 el índice pasa a
   compuesto por almacén. El riesgo real es el cambio de saldo entre `COUNTED` y `APPROVED`:
   la diferencia congelada se aplica como **delta con signo** (`ADJUSTMENT_IN/OUT`), de modo
   que el saldo final = contado + movimientos posteriores al cierre, **no** saldo = contado.
   `ApproveStockCount` ya lo hace; falta la prueba explícita (Corte 2) y registrar el saldo al
   aprobar para que la deriva sea visible.
3. **Reintegro y saldo esperado negativo (M6):** ~~aceptada 2026-09-05~~. ADR-0017 y FS-006:
   el reintegro sale por el **método de pago original** de la venta (nunca convertido a
   efectivo); un esperado negativo puede darse en cualquier método y se conserva con su signo;
   en `CASH_*` es salida de gaveta, en tarjeta/transferencia es partida pendiente de
   conciliación. Cerrar un turno con esperado negativo **no se bloquea** pero exige motivo y
   autorización de supervisor registrados en el arqueo; sin ese reconocimiento el cierre se
   rechaza. Implementación del cierre: 9B.12, Corte 3.
4. **Ownership de agregados (M8):** ~~aceptada 2026-09-05~~. `12-sincronizacion-y-ownership.md`
   fija **nodo de origen fijo** (`originNodeId`) para `Branch`, `Device`, `StockCount` y
   `PurchaseReceipt`, registrado al crear, inmutable (`valor → otro` y `valor → null`
   bloqueados por trigger). La migración `0026` hace backfill solo desde la auditoría de
   creación; sin evidencia queda nulo y toda mutación se rechaza
   (`AGGREGATE_OWNER_UNRESOLVED`). Una fila nueva nunca se inserta con nulo (regla de dominio +
   trigger `*_origin_node_required`). La única transición `null → valor` es una corrección
   administrativa con motivo y auditoría: **caso de uso pendiente en el Corte 2** (y en el
   Corte 1 para `PurchaseReceipt`). Si la Fase 10 introduce un coordinador, revisar entonces
   si `Branch` pasa a autoridad por rol. Resolver esta identidad no autoriza sincronización de
   Fase 10.

## Trazabilidad de hallazgos

- **B1:** corte 0, dueño 9B.06.
- **A1, A2, M7, M10 y L4:** corte 1, dueño 9B.04; A1 también corrige la interacción con 9B.07.
- **M2, M3, M4, M5, M8, M9, L1, L2 y L3:** corte 2, con tareas repartidas entre la base
  transversal, 9B.07, 9B.10 y 9B.11.
- **M6 y la historia incompleta:** corte 3, dueño 9B.12 con datos de 9B.06.
- **A3, A4, A5, M1 y L5:** corte 4, dueño 9B.13.

## Criterio de salida del gate

- [x] ~~Las cuatro decisiones bloqueantes están aceptadas en sus fuentes normativas.~~
  ADR-0016 (moneda de valoración), M5 (conteo `OPEN` por nodo + delta con signo), ADR-0017
  punto 8 + FS-006 (esperado negativo), `12-sincronizacion-y-ownership.md` (ownership fijo).
- [x] ~~Cada hallazgo tiene una prueba observable que falla antes de su corrección y pasa
  después.~~ Ver cada corte; el único pendiente es capacidad nueva de 9B.13, no un hallazgo.
- [x] ~~Las migraciones nuevas se prueban sobre SQLite temporal y no modifican migraciones
  aplicadas.~~ `0022`–`0026` con pruebas en `migrations.test.ts`; ninguna edita una migración
  ya aplicada.
- [x] ~~`pnpm test`, `pnpm typecheck`, `pnpm lint` y `git diff --check` quedan verdes.~~
  571 pruebas / 118 archivos verdes el 2026-09-05.
- [x] ~~Las sub-fases reabiertas actualizan su corte de implementación y solo entonces vuelven a
  marcarse como completadas.~~ 9B.04, 9B.06, 9B.07, 9B.11, 9B.12 y 9B.13 quedan `Completada`.

**Gate cerrado el 2026-09-05.** 9B.12 (`GetShift` con pertenencia por `Shift.openedBy` +
`cash.shift.read.any`, `GET /sales/:id/history`) y 9B.13 (`reports.sales.read` /
`reports.inventory.read` + panel del renderer) construidos sobre la base corregida. Único
diferido: el caso de uso de corrección administrativa de `originNodeId`, solo si una migración
real produce una fila sin resolver.

## Fuera de alcance

- Sincronización, resolución multi-nodo y distribución de datos de Fase 10.
- Certificación fiscal o hardware real de Fase 8.
- Optimización general de Fase 12; la cota de consultas es parte del contrato correcto.
