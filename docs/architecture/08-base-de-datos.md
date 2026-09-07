# 08. Base de datos

## Decisiones

- SQLite como base local por nodo servidor.
- Drizzle como ORM y capa de mapeo.
- `better-sqlite3` como driver inicial por su operación síncrona y predecible en un proceso local.
- WAL para permitir lecturas concurrentes durante escrituras.
- Solo el proceso Fastify/servidor abre el archivo de base de datos.
- Cada archivo adquiere un lock de ownership del nodo; otro proceso que use el driver no puede abrirlo hasta que el dueño cierre o el proceso deje de existir.
- Las tablas relacionales de agregados son la fuente de verdad del estado operativo; el ledger no se usa para rehidratar agregados al arrancar.

## Pragmas requeridos

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

La configuración se ejecuta y verifica al abrir la conexión.

## Convenciones de almacenamiento

| Dato | Representación |
|---|---|
| IDs | `TEXT`, UUIDv7 o ULID generado por la aplicación |
| Dinero | entero en unidades menores + `currency_code` |
| Tasas | entero escalado o decimal textual, nunca `float` |
| Cantidades | entero escalado según unidad de medida |
| Tiempo | epoch milliseconds UTC |
| JSON | texto validado en la frontera |
| Borrado | evitar hard delete en datos auditables; usar estado o `deleted_at` |

## Tablas transversales

- `business_event`: hechos seleccionados append-only para historia y proyecciones.
- `outbox_event`: eventos pendientes, intentos, lease, estado y error de publicación. Desde
  10.01, `attempts` también identifica la generación del claim; confirmar o reprogramar exige
  que el evento siga `PROCESSING` bajo esa generación.
  Desde 10.02 el estado admite `BLOCKED` (migración `0027`): aísla de forma durable un contrato
  incompatible o rechazado sin borrar payload, identidad ni intentos. Una fila bloqueada no se
  reclama de nuevo, sigue bloqueando a sus sucesores y nunca pasa a `PUBLISHED`.
- `sync_delivery`: estado de entrega por `(event_id, destination_node_id)` desde 10.03
  (migración `0031`). Conserva claim, generación (`attempts`), presupuesto del ciclo
  (`cycle_attempts`), retry, pausa y resultado independientes por destino; el payload sigue en
  `outbox_event`, que deja de ser autoridad de entrega y solo resume los destinos ya
  materializados. Un `PUBLISHED` histórico local no se reinterpreta como entrega LAN: la
  migración no rellena filas.
- `sync_node`: registro confiable de nodos de la LAN (migración `0029`). Mapea nodo, tienda,
  rol y terminal, y conserva la huella SHA-256 del certificado provisionado; ninguna clave
  privada llega a la base. Desde la migración `0033` guarda además dónde escucha el nodo
  (`address_host` y `address_port`, exigidos juntos por trigger): la dirección vive junto a la
  confianza, así que retirarla detiene entregas nuevas sin tocar configuración y sin convertir
  pendientes en publicados. La identidad es inmutable por trigger y una revocación conserva la
  fila con su actor y motivo.
- `sync_inbox_event`: custodia durable del receptor (migración `0028`), inmutable y sin
  borrado. Su clave primaria arbitra dos entregas concurrentes del mismo `eventId`.
- `sync_inbox_work`: trabajo de aplicación pendiente por `(event_id, consumer)`, confirmado en
  la misma transacción que la custodia; `attempts` es la generación de su claim.
- `sync_aggregate_authority`: dueño único e inmutable por `(aggregate_type, aggregate_id)`,
  con la fuente del alta (`MANUAL` o `DELEGATED`) y una huella acotada de su evidencia.
- `sync_quarantine`: entradas autenticadas incompatibles, con identidad propia para no
  sobrescribir un evento legítimo con el mismo ID. Guarda emisor, código y tamaño; nunca el
  cuerpo recibido.
- `sync_discrepancy`: una discrepancia por `(event_id, consumer)` (migración `0030`), con
  evidencia inmutable, sin borrado y con cierre auditado que exige aplicación previa.
- `categories` y `units_of_measure`: desde 10.03 llevan `version` monotónica (migración
  `0032`). La incrementa el propio guardado del maestro y un trigger impide que retroceda:
  ordena la distribución de esas referencias hacia las terminales.
- `audit_log`: actor, acción, entidad, cambios, terminal y timestamp.
- `idempotency_key`: resultado asociado a una solicitud repetible.
- `operational_policy_versions` y sus tablas de detalle: versiones locales
  explícitas de descuento e IGTF, con una sola versión activa por tipo, actor,
  motivo y vigencia; no contienen defaults.
- `schema_migrations`: administrada por la herramienta de migración.

## Transacciones

Los cambios de un caso de uso se ejecutan dentro de una transacción. El agregado, los hechos de ledger, la auditoría, la idempotencia y el outbox que correspondan se confirman juntos.

En Fase 4, los comandos de venta componen `UnitOfWork` con los escritores transversales. `CompleteSale` confirma venta, ledger, outbox y resultado idempotente en un solo commit. Las anulaciones y overrides confirman auditoria junto al cambio de venta.

En 9.00, todas las mutaciones HTTP de venta conservan su resultado idempotente
en el mismo commit. Los proveedores de descuento e IGTF leen únicamente la
versión activa de SQLite y fallan con `POLICY_NOT_CONFIGURED` cuando no existe;
la API nunca completa esa ausencia con valores recibidos del cliente.

`business_event` y `audit_log` usan triggers que rechazan `UPDATE` y `DELETE`. `outbox_event`
permite cambios condicionales de estado para entrega y recupera `PROCESSING` solo al vencer su
lease; no resetea la cola al arrancar. `idempotency_key` conserva solo resultados completados
hasta su expiracion.

En la Fase 3, `SqliteUnitOfWork` ejecuta `BEGIN IMMEDIATE -> guardar -> COMMIT` y revierte ante cualquier error. Los repositorios Drizzle rechazan escrituras sin una transaccion activa. Una venta completada o anulada y un turno cerrado son inmutables; las versiones obsoletas se rechazan.

La lectura relacional rehidrata agregados sin regenerar eventos de dominio históricos. Los snapshots comerciales de una venta se almacenan junto a la venta y no dependen de la configuracion vigente del catalogo.

En fiscal, las transiciones nuevas se persisten por versión del agregado y las
restricciones rechazan IDs de evento reutilizados, secuencias incompletas y una
transición de reporte asociada a otra jornada. Líneas y pagos se cargan antes de
la primera transición dentro de la creación transaccional y quedan sellados
después. La evidencia de operación se almacena como un snapshot de cuatro
columnas todas nulas o todas presentes y semánticamente coherentes. Los guards
relacionan además el snapshot con el estado fiscal destino; la rehidratación
vuelve a comprobar tanto esa relación como la continuidad de versiones y que la
última transición de cada operación coincida con su snapshot. Una
migración aborta ante historia legacy corrupta que no pueda reparar sin
adivinar, mientras que estados legacy falsamente terminales se reabren con una
transición correctiva append-only.

No se permite una transacción abierta durante una llamada de hardware o red. La impresión debe usar un estado persistido y un mecanismo de reconciliación.

## Migraciones y respaldo

- Migraciones forward-only versionadas en el repositorio.
- Las migraciones se prueban sobre una base temporal antes de arrancar producción.
- Backups automáticos con snapshot consistente y rotación.
- Restauración probada periódicamente, no solo creación de backups.
- `schema_migrations` conserva version, nombre, checksum y momento de aplicacion. Un checksum distinto detiene el arranque.
- Antes de migrar una base existente se valida un respaldo consistente; ante una falla de migracion o validacion se restaura ese archivo. No existen scripts `down` destructivos.

## Fase 0

No se crean tablas de negocio ni migraciones. El scaffold solo prepara el lugar para el esquema Drizzle de la Fase 1.

## Persistencia LAN

La evolución LAN de [ADR-0026](./adr/0026-lan-operativa-y-recuperacion-entre-nodos.md), previa
al salto cloud, requiere inbox, autoridad, progreso de aplicación, entrega por destino e
intenciones de coordinación durables en 10.03. Cada paso confirma sus efectos en una sola
SQLite; no existe commit global entre archivos ni red dentro de `UnitOfWork`.

Las migraciones `0028`–`0031` crearon inbox, autoridad, cuarentena, trabajo de aplicación,
discrepancias y entrega por destino. Las **intenciones de coordinación** de compras, conteos y
devoluciones siguen sin tabla ni migración porque su flujo no está implementado; no existen por
esta decisión documental.

La migración `0034` agrega la versión monotónica de `payment_methods`; las filas existentes
comienzan en versión 1 y el trigger impide retrocesos. El cambio autoritativo incrementa la
versión en la misma transacción que encola `PaymentMethodPublished.v1`.

## PostgreSQL central post-MVP

[ADR-0024](./adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md) aprueba PostgreSQL
como almacenamiento de referencias y proyecciones centrales en Fases 14–15. SQLite conserva
el estado operativo local. Esta decisión futura no crea esquema, driver ni migraciones hoy.
El inventario central recibe contratos de aplicación, no una réplica de archivos o tablas.
La [Fase 14](../cronograma/fase-14-plataforma-central/README.md) debe probar persistencia,
precisión de agregaciones, autorización y restauración; la carga inicial y sus cortes son
responsabilidad de [Fase 15](../cronograma/fase-15-sincronizacion-cloud/README.md).
