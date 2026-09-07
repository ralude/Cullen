# 03. Eventos

## Tipos

### Eventos de dominio

Representan hechos ocurridos dentro de un agregado. Son inmutables y se crean dentro del dominio. Se despachan después de persistir el agregado.

Ejemplos: `SaleCompleted`, `PaymentRegistered`, `PriceChanged`, `ShiftClosed`.

### Eventos de integración

Son contratos entre módulos, procesos o estaciones. Se serializan, versionan y persisten en `outbox_event` dentro de la misma transacción que el cambio de negocio.

Ejemplos: `FiscalDocumentRequested.v1`, `FiscalDocumentIssued.v1`, `ExchangeRateUpdated.v1`.

### Ledger de hechos de negocio

Conserva hechos seleccionados de forma append-only para explicar el historial y construir proyecciones. No es la fuente de verdad operativa y no necesita contener todo lo requerido para rehidratar un agregado.

## Convenciones

- Nombre en pasado, orientado a hechos.
- Payload mínimo: IDs, versión, timestamp y datos necesarios para el consumidor.
- `eventId` único e idempotente.
- `aggregateId`, `aggregateType` y `occurredAt` obligatorios.
- Versionado explícito (`v1`) para contratos publicados.
- Los handlers deben tolerar reentrega.
- No se usan eventos como sustituto de comandos: un evento nunca significa "haz esto".

## Catálogo inicial

| Módulo | Evento |
|---|---|
| `catalog` | `ProductCreated`, `PriceChanged` |
| `currency` | `ExchangeRateUpdated` |
| `cash` | `ShiftOpened`, `ShiftClosed`, `CashMovementRegistered` |
| `sales` | `SaleStarted`, `SaleItemAdded`, `SaleItemRemoved`, `DiscountApplied`, `PaymentRegistered`, `SaleCompleted`, `SaleVoided` |
| `fiscal` | `FiscalDocumentIssued`, `FiscalDocumentFailed`, `FiscalXReportIssued`, `FiscalZReportIssued` |
| `inventory` | `StockMovementRegistered` |

En `cash`, `ShiftOpened` conserva el fondo inicial, `CashMovementRegistered`
explica cada ingreso, retiro manual o pago derivado de una venta y `ShiftClosed`
congela saldo esperado, conteo declarado y diferencia por moneda y método.
Desde la Fase 6, `SaleCompleted.v1` incluye turno, terminal y snapshots primitivos
de sus pagos e items. Caja e inventario lo consumen de forma idempotente sin leer
tablas de ventas.

Desde la Fase 6, `StockMovementRegistered` explica en el ledger cada recepcion,
salida de venta, merma o ajuste persistido en `StockItem`. Todavia no es un evento
de integracion: la publicacion para consolidacion entre nodos se define en la Fase 10.

## Flujo de publicación

```text
Caso de uso
  -> agregado registra evento de dominio
  -> transacción persiste agregado relacional + ledger + outbox cuando corresponda
  -> relay publica evento de integración
  -> consumidor procesa con idempotencia
```

No se debe publicar un evento externo antes del commit. Si el proceso falla después del commit, el relay reintenta desde el outbox.

Desde la Fase 4, `BusinessEventV1` es el sobre persistido: separa el payload del dominio y conserva version contractual, agregado, version, nodo de origen, correlacion, actor y UTC. Los value objects se convierten explicitamente a primitivas JSON.

`business_event` es append-only y ordena por version del agregado. `SaleCompleted.v1` es el primer contrato seleccionado para `outbox_event`. El relay reclama con lease en una transacción corta, publica fuera de ella y persiste la confirmación o el retry en otra. Desde 10.01, cada claim incrementa `attempts` como generación y toda transición compara esa generación para ignorar callbacks sustituidos.

La entrega del outbox es al menos una vez y mantiene orden por
`(originNodeId, aggregateType, aggregateId)`: solo la menor versión no publicada de cada
agregado es elegible y un lote contiene como máximo una de sus entradas. `eventId` desempata
dos hechos de la misma versión. Una cabecera con retry futuro o lease vigente bloquea solo a
sus sucesores. `PUBLISHED` representa confirmación durable del publisher configurado, según
[ADR-0022](./adr/0022-entrega-outbox-ordenada-y-recuperable.md).

Las tablas relacionales son la fuente de verdad del estado actual. `business_event`, `outbox_event` y `audit_log` tienen finalidades distintas y no se sustituyen entre sí. `GetSaleHistory` proyecta una vista por version desde el ledger, pero nunca rehidrata `Sale` para operacion.

## Protocolo de sincronización entre nodos

Desde 10.02, `SyncEnvelopeV1` es el sobre de transporte. `protocolVersion` versiona el sobre
y `contractVersion` versiona el payload de cada `eventType`; `occurredAt` viaja como texto UTC
canónico. El mapper construye el sobre por campos permitidos, así que `status`, `attempts` y el
lease de `outbox_event` no viajan.

El catálogo es una lista cerrada por `(eventType, contractVersion)` de los tipos que algún
productor real emite. Cada entrada declara su agregado dueño, su dirección —ventas, caja y
fiscalidad hacia el coordinador; catálogo y referencias desde el coordinador— y el validador
de su payload.
Un campo no declarado, un número inseguro o fraccionario donde se exige entero, una fecha no
canónica o un límite excedido se rechazan sin coerción. Un tipo desconocido y una versión
incompatible producen resultados distinguibles y nunca se reinterpretan como v1.

El receptor deduplica por `eventId` comparando el contenido validado de forma estructural. Una
reentrega idéntica devuelve el resultado previo; el mismo ID con otro contenido es conflicto de
identidad. La aceptación significa custodia durable, no aplicación comercial: una dependencia
ausente entre agregados o un hecho atrasado se conservan con aplicación pendiente y no
retroceden una proyección.

Desde 10.03 la custodia es durable y el trabajo de aplicación se confirma en su misma
transacción. Cada contrato declara qué consumidores reciben trabajo al aceptarlo:
`SaleCompleted.v1` declara `INVENTORY_AUTHORITY`, ya implementado, y las tres publicaciones de
referencia declaran `CATALOG_REFERENCE`, que proyecta el catálogo local de la terminal.
Los demás contratos declaran una lista vacía y sus hechos conservan custodia sin aplicación,
en lugar de presentarse como aplicados. El consumidor comprueba que la dependencia
esté **aplicada**, no solo recibida, y una falta de stock conserva la venta y abre una
discrepancia única por evento y consumidor.

La publicación local solo se completa con una aceptación o un duplicado durables cuyo ACK
corresponde al evento y destino de la solicitud. Un contrato local que el catálogo no puede
entregar, o un rechazo permanente del destino, dejan la fila en `BLOCKED`: conserva payload,
identidad e intentos, no se reclama de nuevo y sigue bloqueando solo a sus sucesores.

Inventario e identidad siguen sin productor de integración, y el payload de
`SaleReturned` no basta para repetir una restitución. El catálogo remoto y las tasas confirmadas
sí tienen productor desde 10.03, con contratos propios de estado completo. Las brechas restantes están registradas
en [ADR-0023](./adr/0023-protocolo-de-eventos-entre-nodos.md); no son funciones entregadas.

## Fase 0

No se implementó un bus, relay ni handler de negocio durante Fase 0.

## Evolución LAN en Fase 10

[ADR-0026](./adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) asigna a 10.03 los
productores/consumidores faltantes, bootstrap por contratos y entrega por destino con payload
único. El ACK v1 conserva el resultado de custodia; el progreso comercial usa otra lectura.

La **entrega por destino** está implementada: el estado vive en `sync_delivery`, con claim,
generación, presupuesto de ciclo y resultado independientes por `(eventId, destinationNodeId)`,
y el payload se conserva una sola vez en `outbox_event`. Un ACK de una terminal no confirma a
otra y retirar un destino no convierte pendientes en publicados.

El **catálogo operativo** ya se distribuye: `CategoryPublished.v1`, `UnitOfMeasurePublished.v1`
y `ProductPublished.v1` transportan el estado vigente completo del maestro y se ordenan por
`aggregateVersion`, no por un campo del payload. `ProductCreated.v1` y `PriceChanged.v1`
conservan su definición y su lugar en el ledger, pero dejaron de seleccionarse para la salida:
sus payloads no bastan para construir el catálogo de una terminal.

El **corte inicial** usa esos mismos contratos: no hay un mecanismo de carga aparte, y el
solapamiento entre el corte y los cambios posteriores lo resuelve la regla de versión del
consumidor. `PaymentMethodPublished.v1`, `DiscountPolicyPublished.v1` y
`FinancialTransactionTaxPolicyPublished.v1` aplican el mismo mecanismo con versión monotónica.
`ExchangeRateUpdated.v1` añade la confirmación humana completa, ordenada por versión del par;
el bootstrap excluye historia vencida y conserva tasas vigentes o futuras. Las **referencias
restantes** —concesiones y disponibilidad— y el **snapshot
de costo offline** siguen sin publicarse. Los once v1 originales
permanecen intactos: mientras `SaleCompleted` no transporte el costo del origen, la
salida sincronizada se registra con costo desconocido y no se completa con el promedio del
receptor. No se reescribe ningún v1 ni se declaran implementadas estas capacidades.

Las operaciones distribuidas de compra/conteo/devolución usan intenciones y pasos recuperables
de aplicación. No convierten los eventos comerciales en comandos ni ejecutan de nuevo caja
o fiscalidad al recibir un hecho remoto; véase FS-011.
