# Plan de ejecución 9B.04: Costo de compra y margen

- **Sub-fase:** [9B.04 Costo de compra y margen](./9b.04-costo-y-margen.md)
- **Estado del plan:** Reabierto por auditoría del 2026-09-05
- **Decisiones:** [ADR-0016](../../architecture/adr/0016-metodo-de-costeo-y-margen.md),
  [ADR-0019](../../architecture/adr/0019-proveedores-y-recepciones-de-compra.md) y
  [ADR-0021](../../architecture/adr/0021-mvp-referencia-no-certificado.md)
- **Disciplina:** Outside-in TDD (ADR-0007) y Ponytail `full`

## Resultado esperado

Completar una recepción de compra durable con proveedor, documento de origen, líneas y costos
inmutables; registrar en la misma transacción sus movimientos de inventario y mantener un
promedio ponderado móvil por producto y nodo. El margen se publica como lectura autorizada y
acotada, calculada fuera del renderer.

## Línea base comprobada

- `ReceivePurchase` valida un proveedor `ACTIVE`, crea el `StockItem` cuando hace falta y
  registra un movimiento `PURCHASE_RECEIPT` con idempotencia, ledger y auditoría.
- `receiptId` todavía es una referencia suministrada por el cliente; no existe el agregado,
  repositorio ni tabla `PurchaseReceipt`.
- `StockMovement` conserva cantidad y referencia, pero no costo. Tampoco existe valoración de
  salida ni lectura de margen.
- `Supplier` y su dirección fiscal ya existen. ADR-0019 reservó para esta sub-fase el snapshot,
  documento de origen, unicidad y ciclo `DRAFT -> COMPLETED -> REVERSED`.

## Decisiones de frontera

### Recepción y valoración

- `PurchaseReceipt` es una raíz separada de `StockItem`. La aplicación genera su ID; el número
  del proveedor nunca funciona como ID técnico.
- La primera entrega crea el borrador y lo completa mediante comandos explícitos. Completar
  exige proveedor `ACTIVE`, documento `INVOICE` o `DELIVERY_NOTE`, líneas no vacías, costo
  unitario en enteros, moneda y fecha efectiva UTC.
- Para un documento venezolano, la dirección fiscal del proveedor es obligatoria al completar,
  como fija ADR-0019. La unicidad se comprueba con la clave allí aprobada.
- Cada recepción recalcula el promedio ponderado móvil con aritmética entera y una política de
  redondeo única probada. Si la moneda de compra difiere de la moneda de valoración local, el
  comando exige el snapshot completo de una tasa existente; no consulta una tasa implícita.
- El movimiento de entrada guarda el costo aplicado. Una salida de venta guarda el costo
  vigente en ese instante. Una devolución o reverso usa el snapshot del movimiento original.
- Revertir conserva la recepción original, crea movimientos compensatorios, exige permiso,
  motivo e idempotencia y falla sin efectos parciales si viola stock no negativo.

### Lectura de margen

- Se añade `reports.margin.read`. La autorización ocurre antes de consultar el repositorio.
- El resultado separa monedas; no suma importes incompatibles ni aplica una tasa actual a
  hechos históricos.
- El margen de una línea es ingreso neto menos costo de salida congelado. La lectura recibe
  período UTC y el límite 100/500 de ADR-0013; el renderer solo presenta y exporta la
  proyección recibida.

## Secuencia outside-in

1. Probar creación, corrección de borrador y finalización autorizada de una recepción.
2. Probar proveedor/documento requeridos, unicidad, snapshot histórico y rechazo de costo o
   moneda inválidos.
3. Probar dos recepciones a costos distintos y el promedio resultante sin punto flotante.
4. Probar conversión con snapshot de tasa y rechazo cuando la tasa falta o no corresponde.
5. Probar que completar confirma recepción, valoración, stock, ledger, outbox, auditoría e
   idempotencia en una sola `UnitOfWork`, incluido rollback.
6. Probar salida de venta con costo congelado y reverso compensatorio con el costo original.
7. Probar la lectura de margen autorizada, denegada, vacía, por período, por moneda y con límite.
8. Agregar dominio, casos de uso, puertos, contratos, migración forward-only, repositorios,
   rutas y la mínima UI de recepción/margen que satisfaga esas pruebas.
9. Actualizar arquitectura y escenarios de fallo si la implementación cambia una garantía
   transaccional o de recuperación, y ejecutar las verificaciones del repositorio.

## Criterios de aceptación

- [x] Una recepción `COMPLETED` es durable e inmutable y conserva todos sus snapshots.
- [x] La recepción y sus efectos se confirman atómicamente e idempotentemente.
- [x] El promedio ponderado y sus redondeos usan solo enteros y tienen pruebas de invariantes.
- [x] Las salidas, devoluciones y reversos conservan el costo histórico que les corresponde.
- [x] El margen requiere `reports.margin.read`, respeta el límite y no se calcula en React.
- [x] No se modifica una migración aplicada; la nueva migración está probada sobre SQLite temporal.
- [x] `pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.

## Corrección obligatoria antes de volver a cerrar

Este corte se ejecuta como parte del
[plan correctivo de 9B](./plan-correcciones-auditoria-9b.md). Los criterios anteriores
conservan la evidencia de la entrega original, pero el criterio de costeo quedó invalidado.

- [ ] Ampliar ADR-0016 con una moneda de valoración persistida que no desaparezca cuando el
  saldo llegue a cero ni dependa de que toda la historia tenga costo.
- [ ] Definir y probar el tratamiento de ajustes/conteos sin costo y de filas históricas
  anteriores a la migración 0019, sin backfill inventado.
- [ ] Probar que una recepción posterior no mezcla monedas y que `inventoryValue` sigue
  disponible después de merma, ajuste y conteo cuando existe costo conocido.
- [ ] Traducir la colisión por número de control al código estable
  `PURCHASE_RECEIPT_SOURCE_DUPLICATED`.
- [ ] Crear artículos y lotes durables al completar la recepción, no al guardar un borrador
  que puede abandonarse.
- [ ] Validar el estado del reverso antes de preparar movimientos compensatorios.
- [ ] Registrar ownership de `PurchaseReceipt` antes de agregar la migración correctiva.
- [ ] Restaurar `pnpm test`, `pnpm typecheck` y `pnpm lint` verdes.

## Fuera de alcance

- FIFO, costo estándar, revalorización y contabilidad certificada.
- Órdenes de compra, cuentas por pagar y devoluciones a proveedor.
- Costeo consolidado multi-nodo, sincronización y optimización de consultas.
