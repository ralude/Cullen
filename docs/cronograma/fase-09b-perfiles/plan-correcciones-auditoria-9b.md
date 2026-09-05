# Plan correctivo de la Fase 9B antes de continuar

- **Estado:** Gate abierto y bloqueante
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

### Corte 0 — Restaurar la línea base

- [ ] Corregir el fixture contractual para obtener la línea desde la venta devuelta por
  `POST /items` y comprobar los estados de cada paso preparatorio.
- [ ] Demostrar que `POST /api/v1/sales/:saleId/return` sí se ejecuta, devuelve
  `creditNoteStatus: "ISSUED"` y reproduce exactamente la misma evidencia con la misma clave.
- [ ] Ejecutar la suite completa. No comienza otro corte mientras `pnpm test` esté rojo.

### Corte 1 — Recuperar el invariante de costo y la recepción

- [ ] Actualizar ADR-0016 antes de implementar para decidir cómo persiste la moneda de
  valoración de `StockItem`, incluso con saldo cero, y cómo se representa historia sin costo
  conocida. No se infiere la moneda desde `averageUnitCost`.
- [ ] Probar que un conteo, merma o ajuste sin costo nuevo no elimina para siempre un costo
  histórico conocido ni permite mezclar monedas de valoración.
- [ ] Definir una migración forward-only: solo hace backfill cuando el dato se deriva sin
  ambigüedad; cualquier historia indeterminada queda explícita y no se inventa.
- [ ] Resolver el duplicado de número de control como
  `PURCHASE_RECEIPT_SOURCE_DUPLICATED`, antes de depender del error interno de SQLite.
- [ ] Evitar que un `DRAFT` abandonado cree `StockItem` o lote durable; esos efectos se
  confirman al completar dentro de la `UnitOfWork`.
- [ ] Validar `receipt.reverse()` antes de registrar movimientos compensatorios y conservar el
  rollback transaccional.
- [ ] Aplicar la decisión de ownership a `PurchaseReceipt` y probar su round-trip y rechazo de
  escritura desde un nodo no dueño, si la decisión exige persistirlo.

### Corte 2 — Cerrar autorización, intención y concurrencia

- [ ] Autorizar en aplicación todas las lecturas de sucursales, dispositivos, proveedores,
  recepciones y conteos, además de las lecturas de turno/kardex que consuman 9B.12/9B.13. Una
  denegación no consulta el repositorio.
- [ ] Ampliar la matriz contractual de permisos a configuración, conteos y devoluciones.
- [ ] Exigir unicidad del identificador de dispositivo con regla de dominio/aplicación y
  restricción de base de datos coherentes.
- [ ] Capturar el motivo del operador para cambios sensibles; el renderer no fabrica textos de
  auditoría.
- [ ] Mantener una clave de idempotencia por intención de formulario durante doble clic,
  timeout y reintento; generar otra solo al iniciar una intención nueva.
- [ ] Resolver y documentar antes de implementar si se permite más de un conteo `OPEN` sobre
  el mismo alcance. La prueba debe cubrir conteos solapados y cambios de saldo entre cierre y
  aprobación.
- [ ] Formatear cantidades con las primitivas decimales existentes, sin `float`, y usar los
  tipos reales de Electron para que `typecheck` vuelva a verificar `webPreferences`.
- [ ] Aplicar la decisión de ownership a `StockCount`, `Branch` y `Device`, con pruebas de
  persistencia o derivación explícita según corresponda.

### Corte 3 — Hacer explícita la semántica de arqueo e historia

- [ ] Definir “turno ajeno” con una regla aprobada; `cash.shift.read.any` no se implementa hasta
  decidir si la pertenencia se deriva de `Shift.openedBy`.
- [ ] Definir en ADR-0017 y en el escenario de fallo correspondiente si un reintegro puede
  producir saldo esperado negativo en el turno actual y cómo se presenta/recupera.
- [ ] Incorporar devolución y cambios de destinatario a la historia consultable de la venta,
  aunque la devolución viva en el agregado `SaleReturn`.
- [ ] Probar autorización, límite y auditoría de acceso antes de publicar las lecturas.

### Corte 4 — Corregir y completar KPIs

- [ ] Calcular ingreso neto descontando descuentos de línea.
- [ ] Exponer devoluciones por separado y restarlas de venta neta y costo mediante sus
  snapshots, sin reescribir la venta original.
- [ ] Exigir `from` y `to` UTC válidos y aplicar la cota en SQL sobre la agregación; no se
  materializan tablas completas para recortar en memoria.
- [ ] Derivar `quantitySoldScaled` de líneas vendidas aunque falte costo y rechazar o separar
  escalas incompatibles antes de sumarlas.
- [ ] Normalizar `currencyCode` a mayúsculas en la frontera o rechazar minúsculas de forma
  estable; el filtro no puede devolver vacío por diferencia de casing.
- [ ] Implementar después las lecturas nuevas `reports.sales.read` y
  `reports.inventory.read` sobre esta base corregida.

## Decisiones que bloquean implementación

1. **Costo y moneda de valoración (A1/A2):** ampliar ADR-0016 con atributo persistido,
   transición desde historia previa y comportamiento de ajustes sin costo.
2. **Conteos solapados (M5):** fijar el alcance de exclusión y la respuesta ante concurrencia.
3. **Reintegro y saldo esperado negativo (M6):** ampliar ADR-0017 y el escenario de fallo.
4. **Ownership de agregados (M8):** registrar en ADR-0008 o en
   `12-sincronizacion-y-ownership.md` quién es dueño de `PurchaseReceipt`, `StockCount`,
   `Branch` y `Device`, cómo se representa y cómo se valida, antes de agregar otra migración
   sobre ellos. Resolver esta identidad no autoriza sincronización de Fase 10.

## Trazabilidad de hallazgos

- **B1:** corte 0, dueño 9B.06.
- **A1, A2, M7, M10 y L4:** corte 1, dueño 9B.04; A1 también corrige la interacción con 9B.07.
- **M2, M3, M4, M5, M8, M9, L1, L2 y L3:** corte 2, con tareas repartidas entre la base
  transversal, 9B.07, 9B.10 y 9B.11.
- **M6 y la historia incompleta:** corte 3, dueño 9B.12 con datos de 9B.06.
- **A3, A4, A5, M1 y L5:** corte 4, dueño 9B.13.

## Criterio de salida del gate

- [ ] Las cuatro decisiones bloqueantes están aceptadas en sus fuentes normativas.
- [ ] Cada hallazgo tiene una prueba observable que falla antes de su corrección y pasa después.
- [ ] Las migraciones nuevas se prueban sobre SQLite temporal y no modifican migraciones
  aplicadas.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` y `git diff --check` quedan verdes.
- [ ] Las sub-fases reabiertas actualizan su corte de implementación y solo entonces vuelven a
  marcarse como completadas.

## Fuera de alcance

- Sincronización, resolución multi-nodo y distribución de datos de Fase 10.
- Certificación fiscal o hardware real de Fase 8.
- Optimización general de Fase 12; la cota de consultas es parte del contrato correcto.
