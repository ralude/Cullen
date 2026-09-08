# FS-005: venta concurrente de la última unidad

## Respaldo actual

**Implementado en el ledger autoritativo de un nodo; sin garantía global
offline.** `StockItem` deriva saldo de movimientos append-only, rechaza salidas
que excedan disponibilidad y aplica `SaleCompleted.v1` de forma idempotente.
ADR-0008 y la especificación de ownership reconocen que dos terminales
desconectadas no pueden garantizar simultáneamente stock global no negativo.

Desde el 2026-09-07 el nodo que es autoridad de inventario —standalone o
coordinador sobre sus propias ventas— aplica esa salida en la misma transacción
que completa la venta, con el promedio ponderado local vigente (ADR-0016). Una
terminal con coordinador no la aplica: su hecho lo consume el nodo autoritativo
al recibirlo. La composición local que faltaba en Fases 4/5/6 queda cubierta
para la salida por venta.

## Riesgo

### Precisión LAN: coordinador y diagnóstico operativo implementados

[ADR-0026, D3–D4](../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md)
conserva la venta offline y concreta discrepancia única por evento/consumidor si no puede
aplicarse la venta completa. Su resolución requiere evidencia de aplicación, permiso y motivo;
no hay reintento ciego por falta de stock.

Desde el 2026-09-06 esa semántica está implementada y probada en el coordinador: dos ventas
offline de la última unidad conservan ambas su validez, el saldo autoritativo no queda
negativo, se registra **una** discrepancia `STOCK_INSUFFICIENT` por evento y consumidor en
`sync_discrepancy`, y solo evidencia de aplicación permite cerrarla. La prueba usa dos
terminales con SQLite independiente y transporte real.

Desde 11.05 la UI distingue rechazo local, entrega pendiente, aplicación remota pendiente o
desconocida y discrepancia, con antigüedad y evidencia durable; un ACK de custodia no se muestra
como aplicación. `SaleCompleted.v2` transporta el snapshot de costo conocido por el origen y el
coordinador lo aplica solo si procede de su autoridad; un hecho v1 conserva costo desconocido.
La brecha estructural permanece: desconectados, los nodos no prometen stock global simultáneo.

### Fallo de disponibilidad

Dos ventas intentan consumir la última unidad. Si ambas deciden sobre el mismo
snapshot sin coordinación, pueden crear stock negativo, perder un movimiento o
dar al negocio una promesa falsa de disponibilidad global.

## Estado inicial

- El `StockItem` autoritativo deriva saldo `1` de sus movimientos persistidos.
- Cada venta completada publica un `SaleCompleted.v2` con `eventId`, línea,
  producto, cantidad escalada y snapshot de costo; un consumidor sigue aceptando v1 con costo
  desconocido.
- El repositorio procesa movimientos dentro de un `UnitOfWork` del nodo owner.

## Trigger del fallo

Llegan dos eventos o solicitudes de salida para una unidad del mismo producto
antes de que ambos consumidores hayan observado el resultado definitivo del
otro. En offline, pueden originarse en terminales con proyecciones locales
iguales pero desactualizadas.

## Comportamiento que NO debe ocurrir

- No mutar un campo de saldo ni aceptar un movimiento que deje saldo o lote
  negativo en el agregado autoritativo.
- No sobrescribir movimientos mediante last-write-wins.
- No aplicar dos veces la misma venta/línea redelivered.
- No declarar que la venta comercial se revierte automáticamente por un rechazo
  posterior de inventario: esa atomicidad entre agregados no está definida.
- No prometer stock global no negativo durante desconexión.

## Comportamiento esperado

- En procesamiento secuencial del nodo autoritativo, la primera salida válida
  consume la unidad y la siguiente reevaluación recibe `STOCK_INSUFFICIENT`.
- Una redelivery idéntica se reconoce por referencia
  `eventId:itemId` y no agrega movimientos; una carga distinta bajo la misma
  referencia produce `STOCK_SALE_ISSUE_CONFLICT`.
- El commit conserva juntos movimientos, ledger y auditoría; un error revierte
  la unidad de trabajo.
- En el nodo autoritativo, un rechazo de negocio de la salida —`STOCK_ITEM_NOT_FOUND`
  o saldo insuficiente— conserva la venta completada y su cobro ya asentado en
  el turno, y deja auditoría `SALE_STOCK_ISSUE_REJECTED` con la venta y el
  código. Una falla de infraestructura sí revierte la unidad de trabajo, según
  [FS-004](./FS-004-sqlite-busy-concurrency-conflict.md).
- Si la segunda venta nació offline y ya es comercialmente válida, el
  coordinador no inventa stock: registra una discrepancia operativa auditable
  para resolución humana según la política arquitectónica actual.

## Garantía/invariante del sistema

El ledger autoritativo de `StockItem` no acepta una salida que deje saldo o
saldo por lote negativo. Los movimientos son append-only y la reentrega de una
misma venta/línea es idempotente.

La garantía no cubre disponibilidad global simultánea entre nodos desconectados.
Tampoco existe una prueba dedicada que dispare dos ejecuciones realmente
concurrentes sobre la última unidad; el orden/fairness de solicitudes concurrentes
no debe asumirse como contrato vigente.

## Retry semantics

- `STOCK_INSUFFICIENT` es una decisión de dominio sobre el estado leído; no se
  reintenta automáticamente esperando que desaparezca.
- La redelivery idéntica de `SaleCompleted.v1` es segura e idempotente.
- Un conflicto de referencia requiere intervención o corrección del productor,
  no un retry ciego.
- Un error `DATABASE_BUSY` sigue las reglas de [FS-004](./FS-004-sqlite-busy-concurrency-conflict.md).

## Estrategia de recuperación

- Releer el `StockItem` desde tablas relacionales y reevaluar disponibilidad en
  una nueva unidad de trabajo.
- Conservar la venta completada y registrar la discrepancia si el movimiento
  consolidado no puede aplicarse por stock negativo.
- Resolver humanamente o mediante la política definitiva de Fase 10.
- Antes del piloto se debe elegir entre reconciliación posterior, cupos/reservas
  por terminal o bloqueo offline para productos sensibles.

## Observabilidad

- Código `STOCK_INSUFFICIENT` o `STOCK_SALE_ISSUE_CONFLICT` con correlación,
  venta, línea, producto, terminal y nodo.
- Ledger `StockMovementRegistered` para la salida ganadora.
- Auditoría `SALE_STOCK_ISSUED` con saldo antes/después, venta y línea, o
  `SALE_STOCK_ISSUE_REJECTED` con la venta y el código cuando la salida no pudo
  aplicarse y la venta se conservó.
- Diagnóstico autenticado por correlación con ledger, outbox, intentos, lease, backoff y
  auditoría; solo expone campos allowlist y la evidencia de costo aprobada.
- La discrepancia offline es auditable y visible como `ATTENTION_REQUIRED`; la política de
  resolución permanece en Fase 10.

## Impacto al usuario/negocio

En un nodo conectado, una de las dos salidas no puede aplicarse por falta de
stock. En offline, ambas ventas pueden conservar validez comercial y generar una
discrepancia que requiere resolución. La UI debe mostrar antigüedad de la
proyección y no presentar disponibilidad local como garantía global.

## Componentes involucrados

- `Sale` y evento de integración `SaleCompleted.v1`.
- `ApplySaleCompletedToInventory`.
- `StockItem`, asignación FEFO y movimientos append-only.
- `DrizzleStockItemRepository`, `SqliteUnitOfWork`, ledger y auditoría.
- Nodo coordinador, sincronización y UI de diagnóstico operativo.

## Pruebas asociadas

- [`inventory.test.ts`](../../packages/core/src/application/inventory/inventory.test.ts):
  `applies SaleCompleted with FEFO and ignores an identical redelivery`.
- [`stock-item.test.ts`](../../packages/core/src/domain/inventory/stock-item.test.ts):
  invariantes de saldo no negativo, lote y movimientos.
- [`repositories.test.ts`](../../packages/drivers/db/src/repositories.test.ts):
  persistencia y rehidratación de movimientos append-only.
- [`complete-sale.test.ts`](../../packages/core/src/application/sales/complete-sale.test.ts):
  `issues the sold stock in the same transaction that completes the sale` y
  `keeps the completed sale and audits the rejection when stock cannot be issued`.
- [`sales.contract.test.ts`](../../apps/server/src/routes/sales.contract.test.ts):
  `issues the sold stock when the node owns the inventory` y
  `keeps the completed sale when the sold product has no stock item`.
- [`sale-cash-effect.integration.test.ts`](../../packages/drivers/db/src/sale-cash-effect.integration.test.ts):
  correlación completa de venta, caja, inventario, ledger, outbox, auditoría y costo.
- [`sync-diagnostics.contract.test.ts`](../../apps/server/src/routes/sync-diagnostics.contract.test.ts):
  diagnóstico allowlist sin payloads de pago.
- Brecha explícita: falta una prueba integrada con dos consumos distintos sobre
  saldo `1` y la prueba de discrepancia multi-terminal pertenece a Fase 10.

## ADRs/documentos relacionados

- [Agregados](../architecture/05-agregados.md)
- [Eventos](../architecture/03-eventos.md)
- [Sincronización y ownership](../architecture/12-sincronizacion-y-ownership.md)
- [ADR-0005](../architecture/adr/0005-eventos-outbox.md)
- [ADR-0008](../architecture/adr/0008-topologia-offline-por-nodo.md)
- [ADR-0009](../architecture/adr/0009-estado-relacional-ledger-outbox.md)
- [6.03 Venta y salida](../cronograma/fase-06-inventario/6.03-venta-salida.md)
- [Fase 10 Sincronización](../cronograma/fase-10-sincronizacion/README.md)
