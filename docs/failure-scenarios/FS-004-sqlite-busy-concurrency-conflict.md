# FS-004: SQLite busy o conflicto de concurrencia

## Respaldo actual

**Implementado con cobertura parcial.** SQLite usa WAL, `busy_timeout = 5000`,
ownership por archivo y `BEGIN IMMEDIATE`; `SqliteUnitOfWork` revierte ante error
y mapea `SQLITE_BUSY/LOCKED` a `DATABASE_BUSY`. Repositorios versionados rechazan
escrituras obsoletas con `DATABASE_CONCURRENCY_CONFLICT`. No existe todavía una
política común implementada de backoff/retry en la frontera de aplicación.

Desde 10.03 la recepción entre nodos traduce cualquier fallo de su transacción a
`SYNC_RECEIVER_UNAVAILABLE`, que el emisor reprograma: una base ocupada nunca produce un ACK
de aceptación. `sync-reception.integration.test.ts` fuerza un segundo writer con
`BEGIN IMMEDIATE` y comprueba que inbox y trabajo permanecen vacíos.

## Riesgo

Dos operaciones compiten por el writer o una escritura usa una versión obsoleta.
Un manejo incorrecto puede dejar cambios parciales, sobrescribir un estado más
nuevo o duplicar efectos al reintentar toda la solicitud sin idempotencia.

## Estado inicial

- Un único proceso servidor posee el archivo SQLite del nodo.
- Los pragmas requeridos fueron aplicados y verificados.
- La escritura entra mediante `SqliteUnitOfWork`; los repositorios rechazan
  escrituras fuera de una transacción activa.

## Trigger del fallo

- SQLite devuelve `SQLITE_BUSY` o `SQLITE_LOCKED` al adquirir/usar el writer.
- El agregado que se intenta guardar no avanza exactamente desde la versión
  persistida y el repositorio lanza `DATABASE_CONCURRENCY_CONFLICT`.

## Comportamiento que NO debe ocurrir

- No confirmar una parte de agregado, ledger, outbox, auditoría o idempotencia.
- No ocultar el conflicto mediante last-write-wins.
- No abrir el mismo archivo desde renderer ni desde otro servidor.
- No reintentar indefinidamente ni reutilizar una operación no idempotente sin
  volver a leer el estado.
- No devolver detalles SQLite o stack traces al cliente.

## Comportamiento esperado

- `SqliteUnitOfWork` ejecuta rollback si la transacción sigue activa.
- El error se expone mediante código estable: `DATABASE_BUSY` para lock temporal
  o `DATABASE_CONCURRENCY_CONFLICT` para versión obsoleta.
- El estado relacional y sus escritores transversales permanecen atómicos.
- Ante conflicto de versión, el llamador debe releer el agregado y reevaluar el
  comando; no sobrescribir la versión ganadora.
- La persistencia fiscal rechaza una historia cuya secuencia no sea contigua o
  cuya versión máxima no coincida con el snapshot. El upgrade aborta y conserva
  el respaldo si detecta esa corrupción o una transición X/Z en otra jornada.

## Garantía/invariante del sistema

Una transacción de negocio confirma todos sus cambios o ninguno. Los agregados
versionados no aceptan una versión obsoleta y cada SQLite tiene un único proceso
owner. No se usa last-write-wins.

Para documentos y jornadas fiscales, la continuidad completa de la historia se
comprueba al migrar, rehidratar y guardar. También se exige que el estado de la
última transición coincida con el snapshot del documento o reporte. No se
rellena una transición faltante ni se corrige su jornada por inferencia.

No se afirma que toda operación disponga hoy de versión optimista: ventas,
turnos y persistencia fiscal sí la aplican; `StockItem` se apoya actualmente en
el writer único, transacción inmediata y movimientos append-only.

## Retry semantics

- `DATABASE_BUSY` es transitorio y la arquitectura permite backoff corto y
  acotado; la implementación común de ese backoff es una brecha actual.
- `DATABASE_CONCURRENCY_CONFLICT` no se reintenta sobre el objeto obsoleto: se
  relee estado y se vuelve a validar la intención.
- Un retry externo requiere idempotency key cuando el caso de uso la define.
- Errores de restricción no se tratan como busy.

## Estrategia de recuperación

- Dejar que `busy_timeout` resuelva contención breve.
- Tras `DATABASE_BUSY`, responder sin cambios parciales y permitir retry acotado
  desde una frontera idempotente.
- Tras conflicto, releer la fuente relacional de verdad y devolver conflicto o
  recalcular mediante el caso de uso.
- Si otro proceso posee el archivo, fallar con el lock de nodo; no competir por
  el mismo SQLite.

## Observabilidad

- Log técnico estructurado con `DATABASE_BUSY` o
  `DATABASE_CONCURRENCY_CONFLICT`, operación, agregado, `correlationId`, terminal
  y nodo; stack solo en log protegido.
- No registrar SQL sensible ni exponer la causa interna al cliente.
- Medición de frecuencia y latencia de locks pertenece a observabilidad y a la
  optimización de Fase 12; no cambia las garantías actuales.

## Impacto al usuario/negocio

La operación puede pedir reintento o informar que el estado cambió. No debe
aparecer como éxito si hubo rollback ni duplicar una venta, movimiento o
documento. Los mensajes finales de UI siguen pendientes de Fase 9.

## Componentes involucrados

- `openDatabase`, lock de ownership y pragmas SQLite.
- `SqliteUnitOfWork` y mapeo de errores.
- Repositorios Drizzle y versiones de agregados.
- Casos de uso, idempotencia, ledger, outbox y auditoría.
- Frontera HTTP/IPC que mapeará el código seguro.

## Pruebas asociadas

- [`connection.test.ts`](../../packages/drivers/db/src/connection.test.ts):
  verifica pragmas y ownership del archivo.
- [`unit-of-work.test.ts`](../../packages/drivers/db/src/unit-of-work.test.ts):
  commit, rollback, transacción obligatoria y error estable de restricción.
- [`sync-reception.integration.test.ts`](../../packages/drivers/db/src/sync-reception.integration.test.ts):
  fuerza `SQLITE_BUSY` en la recepción, obtiene indisponibilidad reintentable y verifica que no
  exista custodia ni trabajo parcial.
- [`repositories.test.ts`](../../packages/drivers/db/src/repositories.test.ts):
  persistencia dentro de transacción y rechazo de escritura fuera de ella.
- [`fiscal-document-repository.test.ts`](../../packages/drivers/db/src/fiscal-document-repository.test.ts)
  y [`fiscal-day-repository.test.ts`](../../packages/drivers/db/src/fiscal-day-repository.test.ts):
  secuencia/versionado fiscal, rechazo al rehidratar historia incompleta y
  rollback de transiciones inválidas.
- [`migrations.test.ts`](../../packages/drivers/db/src/migrations.test.ts):
  rollback de DDL/DML/guards y aborto de 0012 ante secuencia incompleta o
  transición de reporte cruzada.
- Brecha explícita: no hay una política común de backoff para todos los casos de uso ni una
  prueba uniforme de versión obsoleta para todos los repositorios. El receptor sync sí cubre
  el lock y delega el reintento acotado al emisor.

## ADRs/documentos relacionados

- [Base de datos](../architecture/08-base-de-datos.md)
- [Errores](../architecture/11-errores.md)
- [Sincronización y ownership](../architecture/12-sincronizacion-y-ownership.md)
- [ADR-0003](../architecture/adr/0003-sqlite-dinero-identificadores.md)
- [ADR-0008](../architecture/adr/0008-topologia-offline-por-nodo.md)
- [ADR-0009](../architecture/adr/0009-estado-relacional-ledger-outbox.md)
- [FS-007](./FS-007-entrega-outbox-ambigua.md)
- [3.01 Conexión SQLite](../cronograma/fase-03-persistencia/3.01-conexion-sqlite.md)
- [3.03 Repositorios](../cronograma/fase-03-persistencia/3.03-repositorios.md)
