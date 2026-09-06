# FS-006: devolución y nota de crédito simulada

## Riesgo

Una devolución de una venta ya cobrada puede duplicar el reintegro, dejar el
stock o la caja a medias, o aparentar una emisión fiscal legal cuando el nodo
solo usa el driver fake.

## Estado inicial

- La venta está `COMPLETED`, pertenece al terminal y nodo que procesan la devolución y tiene un único pago.
- La factura original existe y está `ISSUED`; sus líneas y los movimientos `SALE_ISSUE` son inmutables.
- Existe un turno `OPEN` actual para la caja de la venta en la estación que procesa el reintegro;
  el artículo de stock puede explicar cada lote y cantidad vendida.

## Trigger del fallo

El operador autorizado solicita una devolución total con motivo y clave de
idempotencia. La persistencia puede fallar antes del commit o el fake puede
fallar después de guardar la intención y sus efectos comerciales.

## Comportamiento prohibido

- No modificar ni borrar la venta o la factura original.
- No aceptar pagos mixtos, una segunda devolución, un turno cerrado o una restitución ambigua.
- No confirmar caja, stock, auditoría o nota de crédito por separado.
- No reimprimir ciegamente una nota en `PRINTING` o `ERROR` ni mostrarla como fiscal real.

## Comportamiento esperado

- Una transacción guarda `SaleReturn`, movimientos `ADJUSTMENT_IN` con el lote y costo originales,
  `SALE_REFUND`, la nota `CREDIT_NOTE` en `PENDING`, ledger, outbox, auditoría e idempotencia.
- El fake intenta la nota después del commit. En éxito pasa a `ISSUED` con número simulado;
  en fallo conserva evidencia y el estado recuperable sin repetir caja ni inventario.
- La misma intención devuelve el mismo resultado; otra intención para la venta recibe
  `SALE_ALREADY_RETURNED`.

## Garantía/invariante del sistema

La devolución total es una raíz inmutable separada. El saldo de stock y el esperado del
turno se revierten una sola vez y el documento fiscal conserva su máquina de estados.
La simulación se rotula en la respuesta y en la UI; no constituye certificación legal.
El reintegro sale por el **método de pago original** de la venta devuelta (nunca convertido a
efectivo). Si el turno actual no recibió fondos suficientes por ese método, `SALE_REFUND`
conserva un esperado negativo. El arqueo no lo corrige ni lo atribuye al turno cerrado de la
venta: muestra el signo y calcula la diferencia contra el efectivo o saldo realmente declarado.
En `CASH_*` el negativo es salida física de gaveta; en tarjeta o transferencia queda como
partida pendiente de conciliación con el procesador. Cerrar un turno con esperado negativo en
cualquier método exige motivo y autorización de supervisor registrados en el arqueo; sin ese
reconocimiento el cierre se rechaza. Esa validación de cierre la implementa 9B.12 (Corte 3 del
plan correctivo).

## Retry semantics

- Repetir la clave con el mismo fingerprint es idempotente.
- Repetir después de `PRINTING` o `ERROR` devuelve `FISCAL_RECONCILIATION_REQUIRED` y exige
  reconciliar el documento antes de una nueva acción.
- `SALE_RETURN_STOCK_NOT_RESTORABLE`, `SALE_RETURN_MIXED_PAYMENT_UNSUPPORTED` y
  `SALE_ALREADY_RETURNED` son decisiones de negocio y no tienen retry automático.
- `DATABASE_BUSY` sigue [FS-004](./FS-004-sqlite-busy-concurrency-conflict.md).

## Estrategia de recuperación

Consultar `SaleReturn` y el documento por sus IDs. Reconciliar el estado fiscal mediante el
flujo existente y volver a leer la evidencia antes de actuar. No reabrir el turno ni crear un
ajuste de stock suelto para compensar una devolución incompleta.

## Observabilidad

La operación registra actor, terminal, nodo, correlación, motivo y `SALE_RETURNED` en auditoría.
El ledger conserva `SaleReturned`, los movimientos de stock y la transición fiscal; la respuesta
expone el estado y número de la nota con la marca `SIMULACION`.

## Impacto

Una devolución válida restaura exactamente la cantidad vendida y reduce el esperado del turno.
Un error fiscal posterior deja la operación comercial durable, pero bloquea la repetición ciega y
requiere intervención de reconciliación.

## Componentes involucrados

- `ReturnSale` y `SaleReturn`.
- `DrizzleSaleReturnRepository`, ventas, turnos, stock y documentos fiscales.
- `SqliteUnitOfWork`, ledger, outbox, auditoría, idempotencia y `FiscalPrinterFake`.
- Contrato HTTP `POST /api/v1/sales/:saleId/return` y pantalla de ventas.

## Pruebas

- `packages/core/src/application/sales/return-sale.test.ts`: devolución total, repetición idempotente y rechazo de pago mixto.
- `packages/core/src/domain/sales/sale-return.test.ts`: inmutabilidad, motivo, líneas y evento.
- `packages/drivers/db/src/migrations.test.ts`: migración 0021, tablas y rollback.
- `apps/server/src/routes/sales.contract.test.ts`: validación del contrato y motivo obligatorio.

## Documentos relacionados

- [ADR-0017 Política de devolución](../architecture/adr/0017-politica-de-devolucion.md)
- [Estados fiscales](../architecture/09-estados-fiscales.md)
- [Eventos](../architecture/03-eventos.md)
- [Errores](../architecture/11-errores.md)
- [Sub-fase 9B.06](../cronograma/fase-09b-perfiles/9b.06-devoluciones.md)
