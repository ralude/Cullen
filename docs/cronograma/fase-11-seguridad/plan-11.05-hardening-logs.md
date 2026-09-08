# Plan de ejecución 11.05: hardening de logs y observabilidad segura

- Fecha: 2026-09-07.
- Estado: **planificado, sin iniciar**. El corte 0 está adelantado como prerrequisito de 11.02
  según la [secuencia de Fase 11](./plan-secuencia-y-decisiones.md); los cortes 1–4 cierran la
  fase.
- Especificación: [11.05 Hardening de logs](./11.05-hardening-logs.md).
- Deuda de origen: [auditoría 2026-09-04](./auditoria-puntos-clave-2026-09-04.md), puntos 1
  (observabilidad, no corrección), 2 (evidencia del costo), 5 y 8.
- ADR aplicable: [0006](../../architecture/adr/0006-errores-logs-auditoria.md), aceptado.

## Objetivo y prerrequisitos

Que los logs técnicos sirvan para diagnosticar sin filtrar secretos, que la auditoría de negocio
siga siendo la única fuente de evidencia, y que un efecto derivado que no ocurrió sea visible en
lugar de silencioso.

Leer antes de implementar: AGENTS.md y el `AGENTS.md` de `apps/server`; ADR-0005, ADR-0006,
ADR-0009, ADR-0022 y ADR-0026; los escenarios de fallo que gobiernen el recorrido venta → caja →
inventario.

Antes de escribir código: nada bloquea el corte 0. Los cortes 1–4 se ejecutan al final de la
fase porque correlacionan lo que 11.02, 11.03 y 11.04 producen.

## Línea base comprobada

Verificada sobre el árbol del 2026-09-07.

- **El driver de logging está vacío.** `packages/drivers/logging/src/index.ts` es `export {}`.
  Todo el logging vive hoy en la configuración de Pino de `apps/server/src/app.ts`.
- **La redacción cubre tres cabeceras.** `apps/server/src/app.ts:298` redacta
  `req.headers.authorization`, `req.headers.cookie` y `res.headers.set-cookie`. No hay redacción
  de cuerpos ni de campos anidados.
- **Los cuerpos no se registran hoy, pero nada lo impide.** `disableRequestLogging: true` y el
  hook `onResponse` emiten un objeto curado con servicio, módulo, correlation ID, terminal,
  actor, operación, estado y código de error. En cambio, el manejador global registra
  `{ err: error }` completo para un fallo no previsto (`app.ts:337`): la cadena de `cause` de un
  error de infraestructura puede arrastrar datos de entrada.
- **La correlación básica ya existe.** Un `x-correlation-id` válido se reutiliza y si no se
  genera uno; viaja en la respuesta y en el `ExecutionContext`, y de ahí a la auditoría
  (`AuditEntry.correlationId`).
- **La auditoría de negocio es append-only y tiene su lectura autorizada** (`reports.audit.read`,
  cerrada en Fase 9).
- **La observabilidad de sincronización ya está resuelta y no se rehace.** `GetSyncStatus`
  publica los cinco estados, la conectividad como dato separado, pendientes de entrega y de
  aplicación, pausas, bloqueos, discrepancias abiertas y la antigüedad de catálogo, tasa,
  concesiones y disponibilidad; `apps/desktop` lo presenta. Se cerró en 10.04.
- **La mitad de inventario del punto 1 sigue abierta.** `CompleteSale` ya asienta el cobro en el
  turno dentro de la misma transacción, pero la salida de inventario derivada de
  `SaleCompleted` no está compuesta en `apps/server/src/runtime.ts`. Una venta `COMPLETED` puede
  no tener su salida aplicada y **hoy nada lo hace visible**.

## Corte 0: redacción, adelantado antes de 11.02

Corte pequeño y aislado. Existe antes de que 11.02 introduzca endpoints que transportan un PIN
en un cuerpo distinto al de login.

1. Prueba primero: un PIN, un token, un hash de credencial, una clave y un número de tarjeta
   presentes en la entrada de una petición fallida no aparecen en ninguna línea de log. La
   prueba captura la salida del logger, no inspecciona el código.
2. Ampliar la redacción a cuerpos y a `cause` anidado, por nombre de campo y no por posición.
   Un campo nuevo con un nombre conocido queda redactado sin tocar la configuración.
3. El manejador global deja de registrar el error crudo: registra tipo, código estable, mensaje
   seguro y la cadena de causas ya redactada. El stack se conserva para diagnóstico local pero
   nunca sale al cliente, como ya hace `sendProblem`.
4. Dar contenido a `packages/drivers/logging` con la configuración de redacción reutilizable, en
   lugar de mantenerla incrustada en `apps/server`. Es el paquete que existe para esto y hoy no
   exporta nada.

## Corte 1: logs técnicos y auditoría separados y verificables

1. Fijar por prueba la separación que ADR-0006 declara: un log técnico puede rotarse y perderse;
   una entrada de auditoría no. Nada que sea evidencia de negocio se registra solo en el log.
2. Un formato estable para los campos transversales —servicio, módulo, correlation ID, actor,
   terminal, nodo, operación, código de error— que ya existe parcialmente en el hook
   `onResponse` y en el `onError` del worker de sincronización, hoy escritos por separado.
3. Los errores públicos conservan códigos estables y mensajes seguros. Ya es cierto en
   `sendProblem`; el corte lo fija como garantía probada y no como práctica.

## Corte 2: correlación del recorrido venta → caja → inventario

1. Asociar correlation ID, actor, terminal, nodo y referencia comercial a lo largo del
   recorrido, de modo que una venta se pueda seguir desde la petición HTTP hasta el movimiento
   de turno, la salida de inventario, el ledger y el outbox.
2. La auditoría append-only sigue siendo la fuente de evidencia. El log correlaciona; no
   sustituye.
3. Conservar evidencia auditable del costo usado en la salida, según pide el punto 2 de la
   auditoría. **No** se decide aquí la fórmula contable: eso es 9B.04 y ADR-0016.
4. La lectura correlacionada se expone por la API local autenticada y con permiso, como el resto
   de las lecturas de diagnóstico. El renderer solo presenta datos serializables.

## Corte 3: efectos derivados faltantes y entrega, visibles

Este corte hace visible el problema. **No** implementa los consumidores: eso pertenece a las
Fases 4, 5 y 6.

1. Detectar y publicar una venta `COMPLETED` cuya salida de inventario todavía no se aplicó, con
   su antigüedad. Es la mitad abierta del punto 1 de la auditoría y hoy no tiene ninguna señal.
2. Publicar métricas o eventos de diagnóstico del outbox: pendientes por destino, intentos,
   estado del lease, siguiente intento por backoff, pausas y bloqueos. Buena parte del dato ya
   existe en el store de outbox y en `GetSyncStatus`; el corte lo expone como diagnóstico, sin
   duplicar la lectura operativa.
3. Ninguna de estas salidas incluye secretos, material de transporte ni datos completos de pago.
4. Un `COMPLETED` sin efectos derivados queda como atención operativa visible, no como un log
   que nadie lee. La corrección del efecto se reporta a su fase propietaria.

## Corte 4: discrepancias y antigüedad de la sincronización offline

1. Verificar que lo que 10.04 ya publica cubre el criterio de esta sub-fase: discrepancias
   abiertas, antigüedad de referencias, `null` como nunca recibido y vigencia vencida informada
   como vencida. Si lo cubre, se declara cubierto y se enlaza; no se reimplementa.
2. Cerrar únicamente lo que falte, que a priori es la antigüedad del recorrido comercial local
   —no de las referencias remotas— y su presentación como diagnóstico.
3. La política de resolución de discrepancias pertenece a la Fase 10 y no se toca.

## Criterios de aceptación

- [ ] CA-11.05-01: PIN, token, hash de credencial, clave y número de tarjeta no aparecen en
  ninguna línea de log, incluidos cuerpos y cadenas de `cause`; hay prueba que captura la salida
  real del logger.
- [ ] CA-11.05-02: el manejador global no registra el error crudo y ningún error público expone
  stack trace, ruta de archivo ni configuración.
- [ ] CA-11.05-03: `packages/drivers/logging` exporta la configuración de redacción reutilizable
  y `apps/server` la consume, en lugar de declararla en línea.
- [ ] CA-11.05-04: existe prueba de que ninguna evidencia de negocio depende solo del log
  técnico; la auditoría append-only conserva lo que el log puede perder.
- [ ] CA-11.05-05: los campos transversales tienen un formato estable y compartido entre HTTP,
  worker de sincronización y errores.
- [ ] CA-11.05-06: una venta se puede seguir por correlation ID desde la petición hasta el
  movimiento de turno, la salida de inventario, el ledger, el outbox y la auditoría.
- [ ] CA-11.05-07: el costo usado en una salida queda auditable, sin decidir la fórmula
  contable.
- [ ] CA-11.05-08: una venta `COMPLETED` sin su salida de inventario aplicada es visible con su
  antigüedad como atención operativa.
- [ ] CA-11.05-09: el diagnóstico de outbox publica pendientes, intentos, lease, backoff, pausas
  y bloqueos por destino, sin secretos ni datos completos de pago.
- [ ] CA-11.05-10: las discrepancias y la antigüedad de la sincronización quedan cubiertas —por
  lo que 10.04 ya publica o por lo que este corte añada—, con la brecha declarada si queda
  alguna.
- [ ] CA-11.05-11: `pnpm lint`, `pnpm typecheck` y `pnpm test` verdes; la especificación 11.05,
  el registro de auditoría y el cronograma reflejan lo entregado y lo que sigue abierto en otra
  fase.

## Superficies y límites

Configuración de redacción y formato en `packages/drivers/logging`; composición del logger y
manejadores en `apps/server`; lecturas de diagnóstico en aplicación, expuestas por la API local
autenticada; presentación en `apps/desktop`.

Fuera de alcance: componer el consumidor de inventario de `SaleCompleted`, que es de la Fase 6 y
ADR-0026; corregir el redondeo de costo, que es de 9B.04; la política de resolución de
discrepancias, que es de la Fase 10; el benchmark de crecimiento de la historia de inventario,
que es de la Fase 12; y cualquier reemplazo de la auditoría append-only por logs. Un log no es
evidencia de negocio.
