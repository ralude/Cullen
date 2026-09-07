# @supermarket/driver-db

Driver de persistencia para SQLite y Drizzle. Aisla `better-sqlite3`, verifica los pragmas requeridos y administra migraciones forward-only.

## Uso actual

`openDatabase(path)` devuelve la conexion SQLite, el cliente Drizzle y una funcion `close`. La configuracion aplica y verifica WAL, foreign keys, busy timeout y synchronous NORMAL. Para archivos reales tambien adquiere un lock de ownership single-writer, recupera locks de procesos terminados y lo libera al cerrar.

La base `:memory:` se admite para pruebas; SQLite no puede usar WAL en memoria, por lo que esa verificacion se omite solo para ese path.

`migrateDatabase(path, options)` registra checksums en `schema_migrations`. Para bases existentes crea primero un respaldo consistente en `backupDirectory`, valida integridad y claves foraneas, y restaura ese archivo si la migracion o la validacion de arranque falla. La retencion predeterminada es de cinco respaldos. El rollback operativo siempre usa el respaldo; las migraciones aplicadas no se revierten con scripts `down`.

## Repositorios y transacciones

Los adaptadores Drizzle implementan los puertos publicos de configuracion, tasas, productos, ventas, turnos e inventario. Toda escritura debe ejecutarse mediante `SqliteUnitOfWork`; los repositorios rechazan escrituras fuera de `BEGIN IMMEDIATE -> guardar -> COMMIT` y traducen fallas SQLite a `InfrastructureError` estable.

Las consultas rehidratan agregados sin regenerar eventos de dominio. Los estados finales de ventas y turnos son inmutables y los snapshots comerciales permanecen asociados a la venta.

La Fase 5 completa apertura, movimientos manuales, consumo idempotente de `SaleCompleted.v1`, arqueo y cierre. Los movimientos y balances son append-only o inmutables, y cada cambio sensible confirma estado relacional, ledger, outbox y auditoria en una transaccion.

La Fase 6 agrega `stock_items`, lotes y movimientos append-only. No persiste un saldo mutable: el repositorio rehidrata `StockItem` y el agregado deriva existencias desde su historial.

La Fase 7 agrega documentos fiscales, lineas, pagos, transiciones, jornadas y reportes. Los estados emitidos y las jornadas cerradas son inmutables por restricciones de base de datos; la integracion de recuperacion se prueba cerrando y reabriendo SQLite antes de reconciliar con el dispositivo fake.

## Limites actuales

La Fase 4 agrega ledger append-only, outbox reintentable, auditoria redactada e idempotencia durable. `SaleCompleted.v1` es el primer evento de integracion. Desde 10.01, el relay entrega al menos una vez, reclama una cabecera por agregado en orden de versión, protege cada transición con la generación durable del claim y recupera leases vencidos después de reabrir SQLite. Desde 10.02, la migración `0027` agrega el estado `BLOCKED`: una fila cuya `contract_version` no puede materializarse, o cuyo contrato el relay no puede entregar, se aisla conservando payload, identidad e intentos, deja de reclamarse y bloquea solo a sus sucesores. Desde 10.03 el estado de entrega vive en `sync_delivery`, con claim, generacion, presupuesto de ciclo, pausa y resultado independientes por `(event_id, destination_node_id)`; `outbox_event` conserva el payload una sola vez y deja de ser autoridad de entrega. Las migraciones `0028`-`0030` agregan la recepcion durable (`sync_inbox_event`, `sync_inbox_work`, `sync_aggregate_authority`, `sync_quarantine`), el registro confiable de nodos (`sync_node`) y las discrepancias de aplicacion (`sync_discrepancy`). Custodia, autoridad y discrepancias son inmutables por trigger y no admiten borrado. La migración `0034` versiona `payment_methods` para publicar y proyectar ese maestro sin retrocesos. La migración `0035` asigna una secuencia monotónica por par a `exchange_rates`; su proyección conserva cada tasa como fila inmutable. Las políticas operativas reutilizan sus tablas append-only: la proyección desactiva la versión anterior e inserta la publicada sin editar historia.

`GetSaleHistory` lee `business_event` por version y no reemplaza la fuente de verdad relacional. La persistencia de identidad se incorpora en la fase definida por el cronograma.

Solo el proceso Fastify/servidor debe abrir el archivo SQLite. El renderer y Electron no acceden directamente a la base.

El uso del driver dentro de un proceso Electron requerira revisar el rebuild de ABI nativa durante el empaquetado standalone. Esta fase ejecuta el driver bajo Node.
