# 11. Errores

## Jerarquía

```text
AppError
├── DomainError
├── ApplicationError
└── InfrastructureError
```

Todos los errores públicos tienen código estable, mensaje seguro y detalles opcionales validados.

## Categorías

| Categoría | Ejemplos |
|---|---|
| Dominio | `SALE_INVALID_STATE`, `SHIFT_INVALID_STATE`, `CASH_WITHDRAWAL_INSUFFICIENT_FUNDS`, `USER_ROLE_NOT_ASSIGNABLE`, `STOCK_INSUFFICIENT`, `STOCK_QUANTITY_SCALE_MISMATCH`, `FISCAL_COMMIT_EVIDENCE_REQUIRED`, `FISCAL_FAILURE_EVIDENCE_INVALID`, `FISCAL_TERMINAL_FAILURE_EVIDENCE_REQUIRED` |
| Aplicación | `RESOURCE_NOT_FOUND`, `SHIFT_NOT_FOUND`, `CASH_REGISTER_NOT_FOUND`, `SALE_HISTORY_NOT_FOUND`, `IDEMPOTENCY_KEY_CONFLICT`, `FISCAL_RECONCILIATION_INCONCLUSIVE`, `OUTBOX_BATCH_LIMIT_INVALID`, `SYNC_ENVELOPE_INVALID`, `SYNC_PROTOCOL_VERSION_UNSUPPORTED`, `SYNC_EVENT_TYPE_UNKNOWN`, `SYNC_CONTRACT_VERSION_UNSUPPORTED`, `SYNC_AGGREGATE_TYPE_MISMATCH`, `SYNC_PAYLOAD_INVALID`, `SYNC_SENDER_NOT_AUTHORIZED`, `SYNC_AGGREGATE_OWNER_UNRESOLVED`, `SYNC_EVENT_IDENTITY_CONFLICT`, `SYNC_RECEIVER_UNAVAILABLE`, `SYNC_ACK_INVALID`, `SYNC_NODE_NOT_TRUSTED`, `SYNC_NODE_IDENTITY_MISMATCH`, `SYNC_NODE_REVOKED`, `SYNC_NODE_CREDENTIAL_EXPIRED`, `SYNC_NODE_STORE_MISMATCH`, `SYNC_NODE_ROLE_INVALID`, `SYNC_RECEIVER_NOT_ACTIVE`, `SYNC_NODE_ALREADY_REGISTERED`, `SYNC_NODE_CREDENTIAL_IN_USE`, `SYNC_NODE_NOT_FOUND`, `SYNC_NODE_ALREADY_REVOKED`, `SYNC_AUTHORITY_REQUEST_INVALID`, `SYNC_AUTHORITY_TYPE_NOT_DELEGATED`, `SYNC_AUTHORITY_CONFLICT`, `SYNC_INBOX_BATCH_LIMIT_INVALID`, `SYNC_DISCREPANCY_NOT_FOUND`, `SYNC_DISCREPANCY_ALREADY_RESOLVED`, `SYNC_DISCREPANCY_NOT_APPLIED`, `SYNC_DELIVERY_NOT_PAUSED`, `SYNC_LISTENER_CONFIGURATION_INCOMPLETE`, `SYNC_CLIENT_CONFIGURATION_INCOMPLETE`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT` |
| Infraestructura | `DATABASE_BUSY`, `DATABASE_CONSTRAINT_VIOLATION`, `DATABASE_TRANSACTION_REQUIRED`, `DATABASE_CONCURRENCY_CONFLICT`, `DATABASE_MIGRATION_FAILED`, `DATABASE_MIGRATION_MISMATCH`, `DATABASE_FISCAL_EVIDENCE_INVALID`, `DATABASE_FISCAL_TRANSITION_SEQUENCE_INVALID`, `OUTBOX_CONTRACT_VERSION_UNSUPPORTED`, `SYNC_DELIVERY_FAILED`, `SYNC_DELIVERY_TIMEOUT`, `SYNC_ACK_NOT_CONTRACTUAL`, `SYNC_ACK_UNREADABLE`, `SYNC_ACK_TOO_LARGE`, `SYNC_ENVELOPE_TOO_LARGE`, `FISCAL_REPORT_IDENTITY_CONFLICT`, `FISCAL_PRINTER_NAK`, `FISCAL_PRINTER_PAPER_END`, `FISCAL_PRINTER_MEMORY_FULL`, `FISCAL_PRINTER_BUSY`, `FISCAL_PRINTER_TIMEOUT`, `FISCAL_PRINTER_CRC_ERROR`, `FISCAL_PRINTER_PORT_CLOSED`, `NETWORK_UNAVAILABLE` |

Los códigos `SYNC_*` son el vocabulario del protocolo entre nodos
([ADR-0023](./adr/0023-protocolo-de-eventos-entre-nodos.md)). Los nueve primeros describen un
rechazo permanente y no se reintentan a ciegas; `SYNC_RECEIVER_UNAVAILABLE` y
`SYNC_ACK_INVALID` describen indisponibilidad temporal o confirmación ambigua y sí se
reprograman. Un código recibido de otro nodo solo se conserva si respeta la forma de código
estable; en caso contrario la entrega se trata como ambigua y no se registra su texto.

`DATABASE_FISCAL_EVIDENCE_INVALID` cubre evidencia incompleta, combinaciones
imposibles y contradicciones entre el snapshot fiscal y su estado persistido.
`DATABASE_FISCAL_TRANSITION_SEQUENCE_INVALID` cubre versiones faltantes,
desordenadas o cuya versión máxima no coincide con el agregado.

## Fronteras

HTTP debe responder `application/problem+json` sin stack traces. IPC debe devolver un envelope serializable. WebSocket no debe filtrar detalles internos.

La UI traduce `code` a un mensaje en español. El código es el contrato; el texto no debe ser usado para lógica.

## Política de reintentos

- Reintentar solo errores transitorios y con límite.
- No reintentar una operación fiscal si puede duplicar un documento sin reconciliación.
- Un `UNKNOWN` en efecto, compromiso o entrega bloquea retry y exige
  reconciliacion; `REJECTED` tampoco implica `NOT_APPLIED` salvo confirmación
  autoritativa del perfil.
- En el adaptador real, dispatch, efecto del comando, compromiso fiscal y
  entrega impresa se conservan separados. `dispatchState = NOT_STARTED` solo
  describe un intento que el adaptador no inició; en serial exige no haber
  invocado `write()`. Una consulta posterior puede confirmar `NOT_APPLIED`,
  pero no cambiar la historia del dispatch ni convertir su respuesta en la del
  comando original.
- Un rechazo permanente del protocolo de sincronización no se reintenta: la fila se aísla en `BLOCKED` y conserva su evidencia.
- `SQLITE_BUSY` puede reintentarse con backoff corto.
- La pérdida de red se maneja en el cliente con reconexión e idempotencia.

## Observabilidad

Cada error debe incluir `correlationId` en logs. El stack trace queda solo en el log técnico protegido, nunca en la respuesta al usuario.

## Política LAN

[ADR-0026](./adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) fija diez intentos de
entrega por evento/destino y ciclo, backoff hasta 60 s y pausa durable con reanudación manual
autorizada. La generación de claim no se resetea. Agotamiento y `BLOCKED` no equivalen a
entrega ni se eliminan al reiniciar. Esa política está implementada desde el 2026-09-06.

Los códigos `SYNC_NODE_*` describen la confianza del transporte y todos son rechazos
permanentes de esa solicitud: el emisor no reintenta hasta corregir su provisión.
`SYNC_AUTHORITY_*` cubren el alta delegada de un agregado creado sin conexión; un conflicto
con un dueño registrado nunca reasigna autoridad. `SYNC_DISCREPANCY_*` y
`SYNC_DELIVERY_NOT_PAUSED` pertenecen a las acciones humanas de revisión, que exigen permiso
y motivo. `SYNC_LISTENER_*` y `SYNC_CLIENT_*` señalan una configuración incompleta y abortan
el arranque en lugar de degradar el transporte.

El mapeo HTTP del transporte técnico es estable: 200 para aceptación o duplicado, 422 para un
rechazo permanente, 503 para indisponibilidad y `application/problem+json` sin identidad de
evento para cualquier fallo de transporte, que por contrato no puede leerse como ACK.
Los códigos de infraestructura `SYNC_DELIVERY_*` y `SYNC_ACK_*` los produce el cliente y el
relay los trata como entrega no confirmada, conservando la reentrega del mismo `eventId`.

Una operación comercial LAN con efectos iniciados y resultado parcial/desconocido permanece
pendiente de conciliación; no recibe éxito global ni se cancela por timeout. La recuperación
consulta evidencia conforme FS-011 y no habilita retry fiscal ciego.

## Fase 0

`AppError` y `Result` se implementan como primitivas compartidas. El catálogo completo de códigos y los mapeadores HTTP/IPC se implementarán junto con los casos de uso.
