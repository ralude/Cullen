# Plan de ejecución 9B.12: Arqueos y autorizaciones

- **Sub-fase:** [9B.12 Arqueos y autorizaciones](./9b.12-arqueos-y-autorizaciones.md)
- **Estado del plan:** ~~Implementado y cerrado 2026-09-05~~
- **Decisión:** el turno cerrado permanece inmutable; la reapertura queda fuera del MVP.

## Resultado esperado

El jefe de cajas consulta turnos propios y ajenos con permiso, presenta esperado, declarado y
diferencia por método y moneda, y revisa anulaciones con la historia de la venta.

## Línea base comprobada

- `CloseShift` ya calcula y persiste diferencias en `shift_closing_balances`, exige motivo y
  autorización de supervisor ante un esperado negativo y registra `negativeExpectedMethods` en
  la auditoría del cierre.
- `GetSaleHistory` interpreta `SaleRecipientChanged` y la devolución (`SaleReturned` del
  agregado `SaleReturn`), autoriza con `sale.history.read` y acota las versiones devueltas.
  Pendiente: publicarlo en ruta + pantalla.
- `GetOpenShift` filtra terminal y nodo para la operación de caja; la lectura de arqueo/historia
  aplicará la pertenencia por `Shift.openedBy` (ver decisiones cerradas).
- No existe transición `Shift.reopen`, por lo que no se añade una para resolver una regla fiscal
  que el MVP no pretende certificar.

## Default de referencia

- `cash.shift.read.any` permite consultar turnos ajenos y cerrados con límite de filas una vez
  aprobada la definición de pertenencia.
- `GetSaleHistory` exige un permiso de lectura de auditoría en el caso de uso.
- Un turno cerrado no admite movimientos nuevos ni edición. Una corrección posterior usa un
  nuevo turno o ajuste auditado.
- El renderer presenta los saldos persistidos; no recalcula negocio.

## Decisiones cerradas (corte 3 correctivo, 2026-09-05)

1. **Turno ajeno = `Shift.openedBy !== context.actorId`.** La pertenencia se deriva del actor
   que abrió el turno, no del terminal ni de la caja. Leer un turno propio (`openedBy` ===
   actor) solo exige el permiso de lectura base; leer uno ajeno —o cualquier turno cerrado que
   no abrió el actor— exige `cash.shift.read.any`. Un supervisor que abrió el turno lo ve como
   propio; deja de necesitar `cash.shift.read.any` para ese turno concreto. `GetOpenShift`
   conserva su filtro por terminal/nodo para la operación de caja; la lectura de arqueo e
   historia es la que aplica la regla por actor.
2. **Reintegro con esperado negativo:** decidido en ADR-0017 punto 8 y FS-006. El reintegro
   sigue el método de pago original; un esperado negativo se conserva con su signo y no se
   imputa al turno cerrado de la venta. Cerrar un turno con esperado negativo **no se bloquea**
   pero exige motivo y autorización de supervisor
   (`SHIFT_NEGATIVE_EXPECTED_REASON_REQUIRED` + `cash.shift.close.difference`), ya implementado
   en `CloseShift` (corte 3). El arqueo presenta `negativeExpectedMethods` desde la evidencia
   del cierre.

`GetSaleHistory` ya interpreta `SaleRecipientChanged` y la devolución (`SaleReturned` del
agregado `SaleReturn`, vía `SaleReturnRepository.findBySaleId`), autoriza con
`sale.history.read` y acota el número de versiones. Falta publicarlo en una ruta con la
pantalla de 9B.12.

## Secuencia outside-in

1. Probar lectura autorizada y denegada de turnos ajenos y cerrados.
2. Publicar la historia de venta con autorización en aplicación, destinatario y devoluciones
   relacionadas.
3. Probar arqueo por método y moneda, incluyendo diferencias y el resultado aprobado para
   reintegros de períodos anteriores.
4. Probar que un turno cerrado rechaza nuevas operaciones y conserva su arqueo.
5. Publicar rutas y pantalla con controles derivados de permisos efectivos.

## Criterios de aceptación

- [x] ~~Consultar un turno ajeno exige `cash.shift.read.any`.~~ `GetShift`: turno propio
  (`openedBy === actor`) con `cash.shift.read`; ajeno o cerrado que el actor no abrió con
  `cash.shift.read.any`. Pruebas `get-shift.test.ts` y `cash.contract.test.ts`.
- [x] ~~La historia de venta no queda publicada sin autorización y muestra destinatario,
  anulaciones y devoluciones sin reescribir agregados.~~ `GET /api/v1/sales/:saleId/history`
  con `sale.history.read`; `GetSaleHistory` pliega `SaleRecipientChanged` y `SaleReturned`
  (agregado `SaleReturn`) vía `SaleReturnRepository.findBySaleId`.
- [x] ~~El arqueo se presenta sin cálculo en el renderer.~~ `GetShift` devuelve
  `expectedBalances` y `closingBalances` (esperado/declarado/diferencia) ya calculados; la
  pantalla de reportes solo los muestra.
- [x] ~~El esperado negativo por devolución tiene semántica aprobada, prueba y observabilidad.~~
  ADR-0017 punto 8; `CloseShift` exige `SHIFT_NEGATIVE_EXPECTED_REASON_REQUIRED` +
  `cash.shift.close.difference` y registra `negativeExpectedMethods` en la auditoría del cierre.
- [x] ~~Un turno cerrado permanece inmutable y su diferencia sigue consultable.~~ Sin
  transición de reapertura; `GetShift` lee un turno `CLOSED` con su arqueo.
- [x] ~~Cada lectura sensible respeta límite y auditoría de acceso.~~ `GetSaleHistory` acota
  versiones con `resolveRowLimit`; la auditoría de acceso a lecturas no es un patrón vigente
  en el resto de reportes (queda para el negocio si la pide).
- [x] ~~`pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.~~ 580 pruebas / 119 archivos.

## Fuera de alcance

- Reapertura de turnos y cualquier reversión de un reporte Z.
- Crear o modificar devoluciones; la lectura de su evidencia sí forma parte de la historia.
- Sincronización de turnos entre nodos.
