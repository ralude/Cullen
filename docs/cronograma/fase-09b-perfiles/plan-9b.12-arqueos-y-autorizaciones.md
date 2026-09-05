# Plan de ejecución 9B.12: Arqueos y autorizaciones

- **Sub-fase:** [9B.12 Arqueos y autorizaciones](./9b.12-arqueos-y-autorizaciones.md)
- **Estado del plan:** Bloqueado por decisiones del corte 3 correctivo
- **Decisión:** el turno cerrado permanece inmutable; la reapertura queda fuera del MVP.

## Resultado esperado

El jefe de cajas consulta turnos propios y ajenos con permiso, presenta esperado, declarado y
diferencia por método y moneda, y revisa anulaciones con la historia de la venta.

## Línea base comprobada

- `CloseShift` ya calcula y persiste diferencias en `shift_closing_balances`.
- `GetSaleHistory` existe y está exportado, pero no interpreta `SaleRecipientSet` ni las
  devoluciones, porque `SaleReturned` pertenece al agregado `SaleReturn`.
- Las lecturas vigentes no distinguen turno propio de ajeno por actor; `GetOpenShift` filtra
  terminal y nodo, mientras `Shift.openedBy` conserva el operador que lo abrió.
- Un `SALE_REFUND` puede dejar negativo el saldo esperado del turno actual cuando devuelve una
  venta de un turno anterior; esa semántica no está decidida ni probada.
- No existe transición `Shift.reopen`, por lo que no se añade una para resolver una regla fiscal
  que el MVP no pretende certificar.

## Default de referencia

- `cash.shift.read.any` permite consultar turnos ajenos y cerrados con límite de filas una vez
  aprobada la definición de pertenencia.
- `GetSaleHistory` exige un permiso de lectura de auditoría en el caso de uso.
- Un turno cerrado no admite movimientos nuevos ni edición. Una corrección posterior usa un
  nuevo turno o ajuste auditado.
- El renderer presenta los saldos persistidos; no recalcula negocio.

## Decisiones requeridas antes de implementar

1. Definir si “turno ajeno” significa `Shift.openedBy !== context.actorId` y cómo se trata un
   actor supervisor que abrió el turno.
2. Definir si un reintegro de una venta anterior puede producir esperado negativo en el turno
   actual, o si exige otro mecanismo compensatorio. Actualizar ADR-0017 y el escenario de fallo
   antes de codificar.

## Secuencia outside-in

1. Probar lectura autorizada y denegada de turnos ajenos y cerrados.
2. Publicar la historia de venta con autorización en aplicación, destinatario y devoluciones
   relacionadas.
3. Probar arqueo por método y moneda, incluyendo diferencias y el resultado aprobado para
   reintegros de períodos anteriores.
4. Probar que un turno cerrado rechaza nuevas operaciones y conserva su arqueo.
5. Publicar rutas y pantalla con controles derivados de permisos efectivos.

## Criterios de aceptación

- [ ] Consultar un turno ajeno exige `cash.shift.read.any`.
- [ ] La historia de venta no queda publicada sin autorización y muestra destinatario,
  anulaciones y devoluciones sin reescribir agregados.
- [ ] El arqueo se presenta sin cálculo en el renderer.
- [ ] El esperado negativo por devolución tiene semántica aprobada, prueba y observabilidad.
- [ ] Un turno cerrado permanece inmutable y su diferencia sigue consultable.
- [ ] Cada lectura sensible respeta límite y auditoría de acceso.
- [ ] `pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.

## Fuera de alcance

- Reapertura de turnos y cualquier reversión de un reporte Z.
- Crear o modificar devoluciones; la lectura de su evidencia sí forma parte de la historia.
- Sincronización de turnos entre nodos.
