# Plan de ejecución 10.01: Cola persistente de sincronización

- **Sub-fase:** [10.01 Sync queue](./10.01-sync-queue.md).
- **Estado del plan:** Completado el 2026-09-05.
- **Prerrequisito de ejecución:** cumplido; [Fase 9B](../fase-09b-perfiles/README.md) cerrada y [cronograma maestro](../README.md) actualizado.
- **Disciplina:** Outside-in TDD, cambio mínimo sobre el outbox existente y SQLite con un único proceso dueño.

## Resultado esperado y límite de la entrega

Completar las garantías de la cola que ya existe: seleccionar eventos de integración sin
perderlos, conservar intentos y resultados, respetar el orden por agregado y recuperarse al
reabrir la base. La frontera observable será `OutboxRelay.runBatch` con `EventPublisher` fake
y el adaptador SQLite real. No hace falta otra cola ni otro paquete para demostrarlo.

10.01 entrega el mecanismo durable de salida preparado para conectarse al transporte. No
demuestra recepción remota, convergencia entre nodos ni efectos comerciales distribuidos.
La entrega es **al menos una vez**: una confirmación perdida puede provocar reentrega del
mismo `eventId`; el receptor idempotente se implementa en 10.03.

## Fuentes y coordinación con 9B

El orden de autoridad es [AGENTS.md](../../../AGENTS.md), arquitectura/ADRs y cronograma/plan.
Este documento no es un PRP. Sus criterios fueron aprobados para ejecución el 2026-09-05;
la semántica arquitectónica se formaliza en ADR-0022.

Lectura obligatoria antes de implementar:

- [Arquitectura](../../architecture/README.md), [capas](../../architecture/01-capas.md),
  [eventos](../../architecture/03-eventos.md) y [casos de uso](../../architecture/06-casos-de-uso.md).
- [Base de datos](../../architecture/08-base-de-datos.md), [logs](../../architecture/10-logs.md),
  [errores](../../architecture/11-errores.md) y [ownership](../../architecture/12-sincronizacion-y-ownership.md).
- ADRs [0003](../../architecture/adr/0003-sqlite-dinero-identificadores.md),
  [0005](../../architecture/adr/0005-eventos-outbox.md), [0006](../../architecture/adr/0006-errores-logs-auditoria.md),
  [0007](../../architecture/adr/0007-outside-in-tdd.md), [0008](../../architecture/adr/0008-topologia-offline-por-nodo.md)
  y [0009](../../architecture/adr/0009-estado-relacional-ledger-outbox.md).
- [Escenarios de fallo](../../failure-scenarios/README.md),
  [FS-004](../../failure-scenarios/FS-004-sqlite-busy-concurrency-conflict.md) y
  [FS-005](../../failure-scenarios/FS-005-venta-concurrente-ultima-unidad.md).
- [Gate correctivo de 9B](../fase-09b-perfiles/plan-correcciones-auditoria-9b.md), cierre efectivo
  de los perfiles 9B.14–9B.18 y [ADR-0020](../../architecture/adr/0020-modelo-de-almacenes-y-transferencias.md).

Antes de ejecutar 10.01 se releyó el cierre final de 9B y se renovó la línea base de
productores, consumidores y migraciones. Los diferimientos aprobados de 9B.08 y el traslado
de 9B.09 a 11.02 permanecen intactos.

## Línea base examinada

Inspección renovada sobre el árbol estabilizado después del cierre de 9B el 2026-09-05.

1. [BusinessEventV1](../../../packages/core/src/application/events/business-event.ts) ya contiene
   `eventId`, tipo, versión contractual, agregado, versión del agregado, nodo, actor,
   correlación y UTC. [persistBusinessChange](../../../packages/core/src/application/events/persist-business-events.ts)
   selecciona explícitamente los tipos destinados al outbox dentro de la transacción.
2. [OutboxStore](../../../packages/core/src/application/ports/outbox-store.ts) ya define
   `enqueue`, `claimAvailable`, `markPublished` y `markFailed`.
   [DrizzleOutboxStore](../../../packages/drivers/db/src/outbox-store.ts) y la
   [migración 0003](../../../packages/drivers/db/src/migrations/0003-outbox.ts) persisten
   `PENDING`, `PROCESSING`, `PUBLISHED`, intentos, siguiente intento, lease, error y publicación.
   La unicidad de `eventId` evita insertar dos filas para una reentrega idéntica.
3. [OutboxRelay](../../../packages/core/src/application/events/outbox-relay.ts) reclama en una
   transacción corta, publica fuera de ella y persiste el resultado en otra. Tiene lote 20,
   lease de 30 segundos y demora exponencial limitada a 60 segundos; **no** limita el número
   total de intentos ni distingue clases de error. Esos valores son implementación actual,
   no una política offline aprobada para producción.
4. La selección solo ordena por `createdAt`: puede reclamar varias versiones del mismo
   agregado y entregar una posterior mientras la anterior espera retry. `markPublished` y
   `markFailed` actualizan por `eventId`, sin comprobar qué intento posee la reclamación.
5. [outbox-store.test.ts](../../../packages/drivers/db/src/outbox-store.test.ts) tiene dos
   pruebas con `:memory:`: duplicado/reintento/publicación fuera de transacción y recuperación
   de lease vencido. No prueba cerrar y reabrir un archivo, orden por agregado ni resultados
   tardíos de un intento reemplazado.
6. [runtime.ts](../../../apps/server/src/runtime.ts) construye el store y lo inyecta en
   productores, pero no compone `OutboxRelay` ni los consumidores `ApplySaleCompletedToShift`
   y `ApplySaleCompletedToInventory`. La deuda está asignada a Fases 4/5/6 en el
   [registro de auditoría](../fase-11-seguridad/auditoria-puntos-clave-2026-09-04.md).
7. El outbox ya recibe, entre otros, `ProductCreated`, `PriceChanged`, `SaleCompleted`,
   `SaleReturned`, hechos de caja y resultados fiscales. No todos los hechos de ledger son
   contratos de integración: inventario, tasas y maestros necesitan revisar sus productores
   antes de prometer cobertura de sincronización. 10.01 no publica automáticamente el ledger.
8. 9B incorpora ownership de origen fijo para `Branch`, `Device`, `PurchaseReceipt` y
   `StockCount`. `Device.branchId` opcional no define pertenencia de nodo a sucursal ni destino
   de red. El plan conserva esos límites y no cambia propietarios para poder enviar eventos.

## Propuesta mínima y decisiones previas

### 1. Reutilizar el outbox; precisar a qué entrega pertenece su estado

Propuesta: ampliar el store y relay existentes para una única salida, sin tabla `sync_queue`
que copie payloads, bus genérico, broker, suscripciones dinámicas ni dependencia adicional.
`PUBLISHED` significa confirmación durable del destino de ese publisher, nunca simplemente
que se llamó a un consumidor o que se escribió en un socket.

Antes de cambiar esta semántica, registrar un ADR que complemente ADR-0005/0009 con el destino
de la entrega, el orden y la recuperación descritos aquí. Su número se asigna después de 9B;
este plan no reserva números ni modifica una decisión aceptada.

**Condición de diseño:** una sola columna de estado no prueba dos entregas independientes.
Si al cerrar 9B se conecta un relay local de caja/inventario, no se puede usar su `PUBLISHED`
como confirmación del coordinador, ni encadenar red y efectos locales de modo que una caída
de LAN bloquee estos últimos. En ese caso el ADR debe definir estado durable por destino o
consumidor, conservando un solo payload; revisar el alcance antes de implementar. No se
crea esa infraestructura por anticipación mientras solo se prueba una salida.

Conservar las filas históricas y sus estados. No reiniciar intentos ni convertir los
`PUBLISHED` existentes en evidencia remota. La política de envío inicial de historia y el
destino coordinador son decisiones previas a activar transporte en 10.02–10.03; sin ellas
no se debe drenar una base operativa. La falta de composición local sigue con sus dueños
Fases 4/5/6 y exige una disposición explícita antes de conectar esta salida en producción.

### 2. Orden por agregado y selección acotada

Propuesta: seleccionar solo la menor versión no publicada de cada grupo
`(originNodeId, aggregateType, aggregateId)`. Si esa cabecera está en espera de retry o tiene
lease vigente, ninguna versión posterior del grupo es elegible; otros agregados sí avanzan.
Reclamar como máximo un evento por agregado en cada lote evita adelantar sucesores si falla
su predecesor. Entre cabeceras usar un orden determinista, con desempate por ID, y límite
entero positivo acotado en la frontera de aplicación.

No exigir versiones contiguas en el outbox: solo se publican hechos seleccionados. Por
ejemplo, las versiones 5 y 9 pueden ser las únicas de integración. Sí exigir que 5 se
confirme antes de seleccionar 9; el reloj o `occurredAt` no sustituyen a `aggregateVersion`.
No se ofrece orden causal entre agregados distintos: una devolución o un documento fiscal
pueden depender de hechos de otro agregado; esos contratos corresponden a 10.02/10.03.

### 3. Identificar el intento y recuperar sin borrar evidencia

Propuesta: usar el contador durable `attempts` como generación de reclamación. Cada claim
atómico lo incrementa; las confirmaciones y fallos deben comparar `eventId`, estado
`PROCESSING` y generación reclamada. Una respuesta de una generación sustituida no cambia
el nuevo intento ni revive un evento publicado. El contrato debe informar si la transición
se aplicó, para no reportar un éxito local falso.

Antes de publicar una entrada cuyo lease pudo vencer esperando en el lote, revalidar su
reclamación; el vencimiento durante una publicación puede producir duplicados y se resuelve
por identidad del evento, no prometiendo exclusión física de la red. La prueba de relevo
debe simular callbacks intercalados en un mismo proceso: no abrir SQLite desde dos servidores.

Conservar `nextAttemptAt` y lease en UTC mediante `Clock`. No resetear todo `PROCESSING` al
arrancar: recuperar al vencer su lease. Diferenciar fallo del publisher de fallo al guardar
la confirmación; este último puede dejar entrega ambigua y debe conservar el evento para
recuperación. No convertir cualquier fallo de SQLite en un supuesto fallo de red.

10.01 persiste programación e intentos y prueba ciclos explícitos acotados de `runBatch`.
No activa un bucle automático ni decide agotamiento, cuarentena remota o reanudación manual:
la clasificación contractual pertenece a 10.02 y la política de backoff/límite a 10.04.
El retry existente debe caracterizarse como tal, sin presentarlo como política definitiva
ni agregar reintentos ciegos para errores permanentes o de integridad.

## Secuencia de ejecución outside-in

1. **Entrada y contrato.** Confirmar cierre de 9B, renovar esta línea base y formalizar el ADR
   anterior y sus criterios antes del código. Revalidar consumidores, tipos de integración,
   significado de estados históricos y última migración. Si hay cambio de alcance, registrarlo.
2. **Pruebas rojas en aplicación.** Agregar pruebas de `OutboxRelay.runBatch` con store,
   publisher y reloj fake para selección/publicación, fallos, llamadas solapadas y resultados
   tardíos. La red nunca debe ejecutarse dentro de `UnitOfWork`; no introducir rutas HTTP
   para poder probar un caso de uso técnico.
3. **Puertos y relay.** Extender únicamente los contratos existentes para la generación del
   claim y resultado condicional. Separar las fronteras de fallo y actualizar los fakes
   afectados por la firma. Conservar exports públicos y evitar refactors de consumidores.
4. **Adaptador SQLite.** Probar e implementar selección de cabeceras y actualizaciones
   condicionales dentro de `BEGIN IMMEDIATE`. Consultar elegibilidad en SQL sin cargar toda
   la cola en memoria. Reusar columnas existentes; solo crear una migración forward-only
   si una restricción necesaria lo exige, con pruebas de upgrade y rollback. No editar 0003
   ni reservar ahora el número siguiente a las migraciones de 9B.
5. **Recuperación integrada.** Crear una base temporal en archivo, producir un evento mediante
   un caso de uso existente, cerrar el handle, reabrir y ejecutar el relay con publisher fake.
   Inyectar fallos antes/después de claim, publicación y confirmación; comprobar evento,
   intentos y estado durable, además de ausencia de efectos duplicados en el fake idempotente.
6. **Documentación y cierre.** Actualizar arquitectura de eventos/DB/ownership según el ADR;
   crear una ficha de fallo de cola con las secciones del índice de escenarios y enlazar
   FS-004. FS-005 conserva las brechas de inventario distribuido. Ejecutar las verificaciones,
   conservar evidencia y solo entonces tachar tareas y actualizar los READMEs y el índice
   maestro. No arrancar 10.02 antes de cerrar 10.01.

Archivos previstos: `core/application/events/outbox-relay.ts`,
`core/application/ports/outbox-store.ts`, sus pruebas/fakes y exports afectados;
`drivers/db/src/outbox-store.ts`, `outbox-store.test.ts` y una prueba de recuperación en disco.
Esquema/migraciones son condicionales. Los prefijos completos son `packages/`.
`apps/server/src/runtime.ts` se vuelve a inspeccionar al integrar transporte; no se activa
en 10.01 un publisher de éxito vacío que marque como entregados los eventos reales.

## Criterios de aceptación propuestos

- [x] CA-01: repetir el enqueue del mismo evento conserva una fila, identidad y estado;
  un evento `PUBLISHED` no vuelve a ser seleccionado por una repetición idéntica.
- [x] CA-02: rollback del cambio de negocio no deja evento entregable; commit seguido de
  cierre/reapertura conserva el evento y sus metadatos sin reconstruir tablas desde el ledger.
- [x] CA-03: solo se reclaman pendientes vencidos o leases expirados; antes de su vencimiento
  no se recuperan. El incremento de intentos se confirma junto con el claim.
- [x] CA-04: una cabecera bloqueada impide adelantar su agregado; otros agregados avanzan.
  Versiones no contiguas y timestamps iguales/invertidos conservan el orden por versión.
- [x] CA-05: la selección respeta el límite válido, desempata de forma determinista y nunca
  coloca dos versiones del mismo agregado en el lote reclamado.
- [x] CA-06: un intento sustituido no confirma ni reprograma la generación vigente;
  dos ejecuciones intercaladas no obtienen la misma reclamación vigente.
- [x] CA-07: si una entrada vence esperando en un lote, no se publica bajo un claim obsoleto.
  La posible reentrega durante una llamada lenta conserva el mismo `eventId`.
- [x] CA-08: el publisher observa siempre ausencia de transacción SQLite abierta. Su fallo
  transitorio probado persiste intento, código seguro y fecha de retry, sin borrar payload.
- [x] CA-09: aceptación por el publisher seguida de fallo al confirmar deja recuperación
  posible; tras reinicio hay reentrega idéntica y el fake receptor idempotente aplica una vez.
- [x] CA-10: un error de claim/confirmación se mantiene distinguible de un error del publisher;
  no produce éxito falso ni cambios parciales. Probar rollback y recuperación del lease.
- [x] CA-11: reabrir el archivo preserva `PENDING`, `PROCESSING` y `PUBLISHED`, sus intentos
  y tiempos. No resetea trabajo vigente ni reenvía publicaciones ya confirmadas.
- [x] CA-12: payload, versión contractual, nodo de origen, actor y correlación permanecen
  intactos. No reinterpretar como v1 una fila incompatible: su rechazo seguro debe probarse;
  el esquema de compatibilidad y aislamiento completo se define en 10.02.
- [x] CA-13: diagnóstico por IDs, intento, transición y código; sin payload comercial, PII,
  credenciales ni stack en errores públicos, conforme a la lista permitida de logs.
- [x] CA-14: pruebas de aplicación y SQLite, suite completa y typecheck pasan; documentación
  distingue garantías probadas de las pendientes en protocolo, receptor y operación offline.

## Fuera de alcance y entregas posteriores

- **10.02:** transporte serializable/versionado, catálogo de integración y compatibilidad,
  reglas de ownership en el receptor, dependencias entre agregados y política de historia inicial.
- **10.03:** endpoint del coordinador, autenticación de transporte, ACK tras persistencia,
  deduplicación receptora y discrepancias auditables. Un fake no certifica estas garantías.
- **10.04:** worker periódico/reconexión, timeout de transporte y política completa de
  backoff/agotamiento, estados visibles y antigüedad de referencias, pruebas de dos nodos offline.
- No incorporar transferencias ni varios almacenes: ADR-0020 requiere un caso aprobado y
  una sub-fase específica. Tampoco decidir relación nodo/sucursal ni cambiar ownership de Branch.
- Sin administración de identidad de Fase 11, hardware fiscal real de Fase 8, limpieza de
  historia, métricas de rendimiento o paralelismo de optimización de Fase 12.

## Verificación de cierre

- `pnpm install --frozen-lockfile`: aprobado; los 11 proyectos ya estaban actualizados.
- `pnpm pipeline`: aprobado el 2026-09-05; lint y typecheck verdes en los diez paquetes
  seleccionados, con 603 pruebas aprobadas en 121 archivos.
- `git diff --check`: aprobado.
- Pruebas focalizadas: 7 de `OutboxRelay` y 7 de `DrizzleOutboxStore`, incluidas selección
  ordenada, callbacks sustituidos, contrato incompatible y reapertura de SQLite.
- El transporte de red, el receptor remoto, la deduplicación persistida y el worker periódico
  siguen pendientes en 10.02–10.04.
