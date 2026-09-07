# FS-008: contrato de sincronización incompatible u ownership no autorizado

## Respaldo actual

**Implementado y probado con transporte autenticado real.** Los contratos, la validación desde
`unknown`, la verificación de ownership, la deduplicación y los resultados del receptor están
probados con fixtures de los productores reales. El aislamiento durable de la salida está
probado sobre SQLite real.

Desde el 2026-09-06 la recepción es durable: custodia inmutable, cuarentena con identidad
propia que no sobrescribe un evento legítimo del mismo ID, y verificación de identidad,
origen declarado, terminal y autoridad **antes** de consultar el duplicado. El transporte usa
HTTPS con autenticación mutua contra un registro confiable de nodos, y el alta de un agregado
creado sin conexión es una operación técnica separada del evento comercial. La reanudación de
una fila pausada existe como caso de uso autorizado; una fila `BLOCKED` por contrato u
ownership no se reintenta por esa vía.

## Riesgo

Quedan como **garantías objetivo**, no cobertura vigente: el fallo de persistencia del propio
registro de confianza y la revalidación de compatibilidad antes de reanudar un contrato que
cambió. Evidencia y cuarentena sobreviven al reinicio sin exponer secretos.

Un nodo puede emitir un hecho que el destino no puede interpretar —tipo desconocido, versión de
sobre o de payload incompatible, campo no declarado, número inseguro— o un hecho sobre un
agregado que no le pertenece. Aceptarlo produciría datos comerciales no confiables; reintentarlo
sin límite ocuparía la salida para siempre y bloquearía hechos válidos de otros agregados.

## Estado inicial

- La fila existe en `outbox_event` con su payload, identidad e intentos durables.
- El catálogo declara una lista cerrada por `(eventType, contractVersion)`.
- La autoridad del agregado se conoce, o está explícitamente sin resolver.

## Trigger del fallo

- Una fila persistida tiene una `contract_version` que no puede materializarse.
- Un contrato local no está en el catálogo o su payload no cumple el validador.
- El emisor verificado no coincide con `originNodeId`, o el origen no es el dueño conocido.
- No existe autoridad registrada para el agregado.
- El destino responde un rechazo permanente con código estable.

## Comportamiento que NO debe ocurrir

- No reinterpretar una versión desconocida como `BusinessEventV1` ni como contrato v1.
- No adoptar al primer emisor como dueño de un agregado sin autoridad conocida.
- No aceptar ownership porque el evento declare otro `originNodeId` o porque `actorId` exista.
- No marcar `PUBLISHED` una fila bloqueada para desbloquear a sus sucesores.
- No reintentar a ciegas un rechazo permanente ni descartar el evento en silencio.
- No registrar payload, PII, credenciales, stack ni texto libre remoto como error público.

## Comportamiento esperado

- El adaptador aísla, antes de mapear, la fila cuya `contract_version` no soporta, con
  `OUTBOX_CONTRACT_VERSION_UNSUPPORTED` y sin alterar `attempts`; el resto del lote avanza.
- El relay valida el sobre contra el catálogo después de reclamar y bloquea comparando la
  generación del claim, con el código del rechazo.
- La fila bloqueada conserva payload, identidad, intentos y último error, deja de reclamarse y
  sigue impidiendo que avancen sus sucesores del mismo agregado.
- El receptor distingue sobre inválido, tipo desconocido, versión incompatible, emisor no
  autorizado, autoridad sin resolver y conflicto de identidad mediante códigos distintos.
- Una dependencia ausente entre agregados no invalida el hecho: se acepta con custodia durable
  y aplicación pendiente.

## Garantía/invariante del sistema

Un hecho que no puede entregarse ni interpretarse se conserva y se aísla con diagnóstico; no se
pierde, no se altera y no adelanta a sus sucesores. La autoridad de escritura de un agregado no
cambia por lo que declare un evento entrante.

## Retry semantics

Los rechazos permanentes —sobre o payload inválido, tipo desconocido, versión incompatible,
emisor no autorizado, autoridad sin resolver, conflicto de identidad— no se reintentan. La
indisponibilidad del receptor y la confirmación ambigua sí se reprograman con el backoff técnico
descrito en [FS-007](./FS-007-entrega-outbox-ambigua.md). Los límites definitivos y la operación
manual pertenecen a 10.04.

## Estrategia de recuperación

El estado `BLOCKED` sobrevive al cierre y reapertura de SQLite; la migración `0027` conserva las
filas históricas y sus intentos. Corregir la compatibilidad exige publicar una versión nueva del
contrato o desbloquear la fila mediante la operación que define 10.04. El MVP no reanuda una
fila bloqueada de forma automática y no reescribe su payload.

## Observabilidad

La fila conserva `eventId`, agregado, versión, nodo, intento y `last_error`. El receptor
responde con `protocolVersion`, `eventId`, identidad del receptor, estado y código. Solo se
registran identificadores técnicos, versión, correlación y código estable: nunca el payload ni
texto libre recibido de otro nodo.

## Impacto al usuario/negocio

La operación local ya confirmada permanece válida y otros agregados siguen sincronizando. El
agregado afectado deja de propagarse hasta que se corrija el contrato o la autoridad, lo que
exige intervención humana; su visibilidad operativa llega en 10.04.

## Componentes involucrados

- Catálogo `SYNC_EVENT_CONTRACTS_V1`, `validateSyncEnvelope` y `toSyncEnvelope`.
- `ReceiveSyncEvent`, puertos `AggregateAuthorityRegistry` y `SyncReceptionStore`.
- `OutboxRelay`, `interpretSyncAck` y `OutboxStore.markBlocked`.
- `DrizzleOutboxStore`, `outbox_event` y la migración `0027`.

## Pruebas asociadas

- [`sync-contracts.test.ts`](../../packages/core/src/application/events/sync-contracts.test.ts):
  fixtures de los once tipos emitidos por los productores reales y sus dependencias.
- [`sync-envelope.test.ts`](../../packages/core/src/application/events/sync-envelope.test.ts):
  round-trip, forma inválida, límites y versiones distinguibles.
- [`receive-sync-event.test.ts`](../../packages/core/src/application/events/receive-sync-event.test.ts):
  duplicado, conflicto de identidad, ownership, dependencias y fallo del estado receptor.
- [`outbox-relay.test.ts`](../../packages/core/src/application/events/outbox-relay.test.ts):
  aislamiento por contrato, validación de ACK y clasificación de rechazos.
- [`outbox-store.test.ts`](../../packages/drivers/db/src/outbox-store.test.ts): aislamiento
  durable, sucesores bloqueados, generación del claim y upgrade del esquema.

## Brechas conocidas

- No hay receptor durable, autenticación entre nodos ni cuarentena remota: llegan en 10.03.
- La evidencia de alta y bootstrap de ownership, y la identidad verificada del coordinador,
  se prueban con fakes y deben construirse desde el transporte en 10.03.
- Ningún consumidor remoto está implementado; transportar un contrato no aplica sus efectos.

## ADRs/documentos relacionados

- [ADR-0022](../architecture/adr/0022-entrega-outbox-ordenada-y-recuperable.md)
- [ADR-0023](../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md)
- [Eventos](../architecture/03-eventos.md)
- [Sincronización y ownership](../architecture/12-sincronizacion-y-ownership.md)
- [Errores](../architecture/11-errores.md)
- [FS-004](./FS-004-sqlite-busy-concurrency-conflict.md)
- [FS-007](./FS-007-entrega-outbox-ambigua.md)
- [10.02 Protocolo de eventos](../cronograma/fase-10-sincronizacion/10.02-protocolo-eventos.md)
