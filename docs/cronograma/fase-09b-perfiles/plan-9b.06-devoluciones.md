# Plan de ejecución 9B.06: Devolución total y nota de crédito simulada

- **Sub-fase:** [9B.06 Devoluciones y notas de crédito](./9b.06-devoluciones.md)
- **Estado del plan:** Reabierto por prueba contractual roja
- **Decisiones:** [ADR-0017](../../architecture/adr/0017-politica-de-devolucion.md),
  [ADR-0016](../../architecture/adr/0016-metodo-de-costeo-y-margen.md) y
  [ADR-0021](../../architecture/adr/0021-mvp-referencia-no-certificado.md)
- **Disciplina:** Outside-in TDD (ADR-0007) y Ponytail `full`

## Resultado esperado

Registrar una devolución total contra una venta completada y su factura simulada, restaurar
el inventario con los lotes y costos originales, registrar el egreso en el turno abierto que
la procesa y emitir una `CREDIT_NOTE` recuperable mediante `FiscalPrinterFake`.

## Línea base comprobada

- `Sale` solo admite anularse en `DRAFT`; una venta `COMPLETED` es inmutable.
- El puerto fiscal, el dominio, SQLite y `FiscalPrinterFake` ya soportan `CREDIT_NOTE`, pero no
  existe un caso de uso que la vincule a una devolución.
- Las ventas guardan pagos y los movimientos de inventario de salida conservan la referencia
  de venta. 9B.04 añadirá su costo snapshot.
- Los patrones de `UnitOfWork`, idempotencia, ledger, outbox, auditoría y estado fiscal
  recuperable ya existen y deben reutilizarse.

## Decisiones de frontera

- `SaleReturn` es evidencia separada; no cambia el estado ni las líneas de la venta ni de la
  factura original. Solo se admite una devolución total efectiva por venta en este corte.
- `ReturnSale` exige `sale.return`, motivo, clave de idempotencia, venta `COMPLETED`, documento
  original `ISSUED`, un solo pago y un turno abierto en la estación que procesa el reintegro.
- El monto y la moneda provienen del pago original; el cliente no los elige. Los pagos mixtos
  se rechazan con código público estable y sin efectos durables.
- Cada línea repone el lote consumido y el costo snapshot original. Si la restitución no puede
  reconstruirse de forma inequívoca, la operación falla cerrada; no crea ajustes sueltos.
- La intención, caja, inventario, ledger, outbox, auditoría y estado fiscal inicial se guardan
  en una sola transacción. La llamada al fake conserva las transiciones de evidencia ya
  definidas; un fallo no repite efectos comerciales y queda recuperable/idempotente.
- La UI siempre presenta la nota como `SIMULACION` y nunca ofrece reapertura de turnos.

## Secuencia outside-in

1. Probar autorización, motivo, ownership, venta/documento originales y turno abierto.
2. Probar devolución total de una venta con pago único y restauración exacta de cantidad,
   lote, costo y movimiento de caja.
3. Probar rechazo explícito de pago mixto, venta no completada, documento no emitido y segunda
   devolución con otra intención.
4. Probar repetición con la misma clave de idempotencia y conflicto de fingerprint.
5. Probar rollback: ningún efecto parcial sobre devolución, caja, stock, ledger, outbox o
   auditoría.
6. Probar éxito, error retry-safe y evidencia ambigua del fake, verificando que la recuperación
   no duplique el reintegro ni la reposición.
7. Añadir dominio, caso de uso, permisos, puertos, migración, contratos, rutas y el control
   mínimo en la vista de supervisión.
8. Actualizar las fichas de `docs/failure-scenarios/` afectadas antes de cerrar la sub-fase.
9. Ejecutar las verificaciones del repositorio y actualizar el cronograma.

## Criterios de aceptación

- [x] ~~La devolución referencia venta y factura originales y no modifica ninguna de las dos.~~
- [x] ~~Caja, inventario, evidencia, ledger, outbox, auditoría e idempotencia no quedan parciales.~~
- [x] ~~Lote y costo se restauran desde snapshots originales.~~
- [x] ~~Los pagos mixtos y las segundas devoluciones se rechazan con códigos estables.~~
- [x] ~~La nota fake queda visible como `SIMULACION` y sus fallos son recuperables sin duplicar.~~
- [x] ~~Los escenarios de fallo reflejan garantía, retry, recuperación, observabilidad y pruebas.~~
- [x] ~~`pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.~~

## Corrección obligatoria antes de volver a cerrar

- [ ] Corregir el fixture para leer la línea desde la venta devuelta por `POST /items`.
- [ ] Comprobar cada respuesta preparatoria antes de consumir su payload.
- [ ] Demostrar que el endpoint de devolución se ejecuta, retorna nota `ISSUED` y reproduce la
  misma evidencia con la misma clave de idempotencia.
- [ ] Ejecutar la suite completa verde; la evidencia anterior de este criterio queda
  invalidada por el fallo reproducido el 2026-09-05.

Estas tareas son el corte 0 del
[plan correctivo de 9B](./plan-correcciones-auditoria-9b.md).

## Fuera de alcance

- Devolución parcial, sin comprobante, con pago mixto o fuera de una ventana comercial.
- Inspección, merma, devolución a proveedor y crédito a favor.
- Nota de crédito real, certificación fiscal y reapertura de turnos.
