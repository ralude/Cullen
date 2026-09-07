# FS-007: entrega outbox ambigua o interrumpida

## Respaldo actual

**Implementado y probado de extremo a extremo en la LAN.** `OutboxRelay` y
`DrizzleOutboxStore` conservan orden por agregado, generación de claim, retry y recuperación al
reabrir SQLite. Desde 10.02 el relay valida el sobre saliente contra el catálogo y solo acepta
un ACK durable correspondiente al evento y destino.

Desde el 2026-09-06 el estado de entrega es por `(eventId, destinationNodeId)`, el publisher
es un cliente HTTPS con autenticación mutua y el receptor conserva custodia durable con
deduplicación persistida. Está probado con coordinador y dos terminales sobre archivos SQLite
independientes: un ACK perdido tras el commit remoto se reentrega y el receptor responde
`DUPLICATE` sin duplicar efectos; un destino inalcanzable no bloquea la entrega a su vecino.
Al agotar el ciclo de diez envíos la fila queda `PAUSED` de forma durable y solo una
reanudación autorizada la vuelve a habilitar; reiniciar no abre otro ciclo.

## Riesgo

El proceso puede cerrarse después de confirmar el cambio de negocio, durante la publicación
o después de que el destino acepte el evento pero antes de guardar `PUBLISHED`. Una recuperación
incorrecta podría perder, adelantar o aplicar dos veces un hecho.

## Estado inicial

- El cambio relacional y su evento se confirmaron juntos en `outbox_event`.
- La fila está `PENDING` o `PROCESSING` con `attempts`, retry y lease durables.
- Cada `eventId` es estable y único.

## Trigger del fallo

- El publisher rechaza o interrumpe la entrega.
- El destino responde un ACK ambiguo, mal formado o de otro evento.
- Falla SQLite al guardar la confirmación.
- El proceso termina con un claim vigente.
- El lease vence y otra ejecución reclama la entrada.

## Comportamiento que NO debe ocurrir

- No borrar el payload ni marcar éxito ante un fallo del publisher.
- No adelantar una versión posterior del mismo agregado.
- No aceptar éxito o fallo de una generación de claim sustituida.
- No publicar mientras la transacción SQLite de claim está abierta.
- No registrar payload, PII, credenciales ni stack como error público.

## Comportamiento esperado

- Un fallo del publisher reprograma la misma fila con código seguro.
- Un fallo al confirmar se propaga como persistencia y deja el lease recuperable.
- Cada lote reclama como máximo una cabecera por agregado; otros agregados avanzan.
- Un evento se recupera solo después de vencer su lease y conserva el mismo `eventId`.
- Una versión contractual no soportada aísla esa fila con `BLOCKED` sin incrementar `attempts`
  ni abortar el lote de otros agregados.
- Un ACK ambiguo reprograma la fila con `SYNC_ACK_INVALID`; no confirma la entrega.

## Garantía/invariante del sistema

La cola no pierde un evento confirmado por el caso de uso y conserva orden por
`(originNodeId, aggregateType, aggregateId)`. La entrega es al menos una vez; no se promete
exactly-once en red.

## Retry semantics

La política definitiva quedó decidida el 2026-09-06 en
[ADR-0026, D6](../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md): diez
envíos por evento/destino y ciclo, backoff hasta 60 s, pausa durable y reanudación manual
autorizada. Su implementación y pruebas de agotamiento/reinicio pertenecen a 10.04. La
generación del claim sigue monotónica; ni reinicio ni reconexión reabren el ciclo agotado.
En múltiples terminales, cada destino conserva su estado/ACK independiente en 10.03.
Los bloqueos se muestran como atención y dejan evidencia auditable, sin payload en logs.

El backoff técnico actual crece exponencialmente desde un segundo y se limita a 60 segundos.
Todavía no implementa el agotamiento de ADR-0026: 10.04 agrega límites, clasificación y
operación manual. Una confirmación ambigua se recupera por lease y puede generar redelivery.

## Estrategia de recuperación

Reabrir SQLite sin resetear filas. `PENDING` vencido es elegible; `PROCESSING` se conserva hasta
que venza el lease. El nuevo claim incrementa `attempts` y vuelve inválidos los callbacks de la
generación anterior. El receptor deduplica el `eventId` en 10.03.

## Observabilidad

La fila conserva `eventId`, agregado, versión, nodo, intento, lease, siguiente retry,
`lastError` y fecha de publicación. Los códigos seguros son `EVENT_PUBLICATION_FAILED`,
`OUTBOX_CONTRACT_VERSION_UNSUPPORTED`, `SYNC_ACK_INVALID` y los errores de base definidos en el
catálogo. El aislamiento por incompatibilidad se describe en
[FS-008](./FS-008-contrato-sync-incompatible.md).

## Impacto al usuario/negocio

La operación local ya confirmada permanece válida. La sincronización puede retrasarse o
reentregar un evento; la visibilidad operativa de ese retraso llega en 10.04.

## Componentes involucrados

- `OutboxRelay` y puerto `OutboxStore`.
- `DrizzleOutboxStore`, `SqliteUnitOfWork` y `outbox_event`.
- `EventPublisher` y futuro receptor idempotente.

## Pruebas asociadas

- [`outbox-relay.test.ts`](../../packages/core/src/application/events/outbox-relay.test.ts):
  límite, publicación fuera de transacción, claim vigente y separación de fallos.
- [`outbox-store.test.ts`](../../packages/drivers/db/src/outbox-store.test.ts): orden, retry,
  relevo de claim, versión incompatible y recuperación real después de reabrir SQLite.
- [`unit-of-work.test.ts`](../../packages/drivers/db/src/unit-of-work.test.ts): rollback y
  mapeo seguro de errores SQLite.

## ADRs/documentos relacionados

- [ADR-0005](../architecture/adr/0005-eventos-outbox.md)
- [ADR-0009](../architecture/adr/0009-estado-relacional-ledger-outbox.md)
- [ADR-0022](../architecture/adr/0022-entrega-outbox-ordenada-y-recuperable.md)
- [ADR-0023](../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md)
- [Eventos](../architecture/03-eventos.md)
- [10.01 Sync queue](../cronograma/fase-10-sincronizacion/10.01-sync-queue.md)
- [FS-004](./FS-004-sqlite-busy-concurrency-conflict.md)
