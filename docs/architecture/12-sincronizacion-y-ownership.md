# 12. Sincronización y ownership

## Topología

Cada terminal POS es un nodo operativo autónomo: ejecuta Fastify y abre exclusivamente su SQLite local. El nodo coordinador de tienda recibe eventos, distribuye configuración y mantiene proyecciones consolidadas. Una pérdida de LAN no impide terminar una venta local que cumpla la política offline.

Esta topología conserva la regla single-writer: cada archivo SQLite tiene un único proceso servidor propietario. La sincronización transporta eventos de integración; nunca replica tablas ni permite que dos nodos escriban el mismo agregado.

## Ownership inicial

| Agregado o dato | Autoridad de escritura | Operación offline | Política de conflicto |
|---|---|---|---|
| `Sale` | terminal donde se inició | completar localmente | un solo dueño; venta completada inmutable; deduplicar por `eventId` e idempotency key |
| `Shift` y movimientos de caja | terminal/caja de origen | operar localmente | no editar desde otro nodo; consolidar mediante eventos |
| `FiscalDocument` | terminal y dispositivo fiscal asociados | emitir/reconciliar localmente | nunca reemitir por timeout; recuperar estado del dispositivo |
| `Product`, precios e impuestos | nodo coordinador de tienda | leer snapshot local versionado | aplicar versiones ordenadas; no usar last-write-wins |
| tasas de cambio | nodo coordinador tras confirmación humana | usar última tasa vigente local | conservar fuente, vigencia y versión; no aplicar sugerencias automáticamente |
| usuarios, roles y permisos | nodo coordinador de tienda | usar concesiones cacheadas según política de expiración | permisos con códigos estables y roles configurables; revocaciones se aplican al sincronizar; la política definitiva se cierra antes del piloto |
| inventario (`StockItem`) | ledger autoritativo del nodo coordinador | vender contra una proyección local | movimientos append-only y saldo derivado; una desconexión no garantiza stock global; registrar discrepancia si el movimiento no puede aplicarse |
| `PurchaseReceipt` y `StockCount` | nodo donde se crean | completar el documento localmente | el nodo de origen es inmutable y otro nodo rechaza comandos de escritura |
| `Branch` | nodo de origen fijo (`originNodeId`), registrado al crear | editar en el nodo de origen | `originNodeId` es inmutable; otro nodo solo consume la referencia; distribuir versiones ordenadas |
| `Device` | nodo que declara el dispositivo (`originNodeId`) | administrar el inventario local del equipo | `terminalId` es asignación operativa; `originNodeId` conserva la autoridad de escritura y es inmutable |
| reportes | proyecciones de lectura | consultar último estado sincronizado | reconstruir la proyección desde eventos idempotentes |

Para los cuatro agregados con `originNodeId` (`Branch`, `Device`, `StockCount`,
`PurchaseReceipt`) la autoridad de escritura del MVP es el **nodo de origen fijo**, no un rol
resuelto dinámicamente. En un despliegue standalone el nodo local es el origen y coincide con
el coordinador. Cuando la Fase 10 introduzca un coordinador de tienda, revisar si `Branch` (y
solo `Branch`) debe pasar a autoridad por rol; ese cambio es una decisión explícita de Fase 10,
no un supuesto de este documento. Hasta entonces, doc y migración `0026` dicen lo mismo: origen
fijo derivado de la creación.

Reglas de la columna `originNodeId`:

- Una fila nueva **siempre** se inserta con `originNodeId` no nulo (regla de dominio y trigger
  `*_origin_node_required`). No hay ruta de alta que produzca ownership sin resolver.
- Las filas anteriores a esta decisión recuperan `originNodeId` únicamente desde su entrada de
  auditoría de creación. Si esa evidencia no existe, la fila queda con `originNodeId` nulo, el
  ownership está **sin resolver** y toda mutación se rechaza (`AGGREGATE_OWNER_UNRESOLVED`).
- El trigger `*_origin_node_immutable` bloquea `valor → otro valor` y `valor → null`; ninguna
  ruta de escritura —repositorio o SQL directo— puede mutar un ownership ya resuelto. La
  migración no inventa un nodo.
- La transición `null → valor` (recuperar una fila de historia sin resolver) requeriría un
  **caso de uso de corrección administrativa** con motivo y auditoría. El MVP no lo implementa
  porque no genera filas sin resolver; se añade solo si una migración real produce una.

## Política inicial de inventario offline

### Alcance LAN implementado entre el 2026-09-06 y el 2026-09-07

[ADR-0026](./adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) concreta la activación de
10.03–10.04 para nodos nuevos de prueba. Conserva origen fijo de `Branch`, `Device`,
`PurchaseReceipt` y `StockCount`; un registro confiable separado asigna nodo/terminal/tienda.
La revisión de autoridad de `Branch` queda resuelta conservando su dueño de origen.

En LAN, completar compras, aprobar conteos y procesar devoluciones requiere coordinador
conectado; si una operación iniciada pierde red, conserva intención pendiente de conciliación
y efectos idempotentes por nodo. Esta precisión restringe la confirmación offline de documentos
de la matriz anterior; no cambia su dueño ni promete una transacción entre dos SQLite.
Las ventas siguen offline con snapshot de costo conocido al vender y disponibilidad informativa.

Las concesiones duran ocho horas desde emisión del coordinador y no se renuevan por recepción
tardía. Los límites locales de sesión de ADR-0011 se aplican además. El ADR fija confianza
manual, alta delegada de agregados, entrega por destino y reanudación manual tras agotamiento.

De ese corte están **implementados y probados**: el registro confiable de nodos con alta y
revocación auditadas, el transporte técnico HTTPS con autenticación mutua expuesto solo en el
listener de LAN, la custodia durable con deduplicación y cuarentena, el alta delegada de
agregados propios creados sin conexión, la aplicación recuperable del inventario autoritativo
con discrepancia única, el estado de entrega por `(eventId, destinationNodeId)` y la política
de retry con pausa durable y reanudación autorizada. El conjunto cerrado de referencias tiene
contratos de estado completo, productores transaccionales, corte inicial y proyección local:
catálogo, métodos de pago, políticas operativas, tasas confirmadas, concesiones de operador y
disponibilidad informativa.

También están implementados los consumidores de caja, fiscalidad y ventas como proyecciones de
solo lectura; la vigencia de ocho horas de las concesiones; `SaleCompleted.v2` con el costo
conocido en el origen; y la infraestructura durable de intención, pasos y consulta de progreso.
Los efectos remotos autoritativos de compra, conteo y devolución siguen pendientes: el POS no
puede sustituirlos escribiendo una segunda autoridad local. Un rechazo definitivo después de
efectos previos queda `NEEDS_REVIEW`; su compensación explícita tampoco está automatizada.

### Política de discrepancia

El MVP acepta que dos terminales desconectadas no pueden garantizar simultáneamente stock global no negativo. La terminal usa una proyección informativa y la venta conserva su validez comercial. El nodo coordinador intenta registrar el movimiento; si la regla de stock no negativo lo impide, crea una discrepancia operativa auditable para resolución humana.

Antes del piloto se debe elegir y probar una política definitiva:

- mantener la reconciliación posterior;
- asignar cupos o reservas de stock por terminal;
- bloquear offline la venta de productos configurados como sensibles.

## Reglas del protocolo

- Todo evento incluye `eventId`, `aggregateId`, `aggregateType`, `aggregateVersion`, `originNodeId`, `occurredAt` y versión de contrato.
- El sobre versiona el transporte (`protocolVersion`) por separado del payload (`contractVersion`), según [ADR-0023](./adr/0023-protocolo-de-eventos-entre-nodos.md).
- La autoridad se consulta solo por `(aggregateType, aggregateId)`; un `originNodeId` autodeclarado no prueba ownership y `actorId` no es una credencial.
- Sin autoridad verificable el ownership queda **sin resolver** y el hecho se rechaza: no se adopta al primer emisor como dueño. El catálogo exige la identidad verificada del coordinador.
- Una referencia a un agregado ajeno no autoriza a escribirlo: aplicar `SaleCompleted` al inventario autoritativo es trabajo de un consumidor del coordinador, no una escritura remota del `StockItem`.
- El receptor deduplica por `eventId` y conserva el orden por agregado cuando sea requerido.
- Un comando se dirige al nodo dueño del agregado; no se resuelve concurrencia mediante last-write-wins.
- Los eventos desconocidos o incompatibles se aíslan para diagnóstico; no se descartan silenciosamente. En la salida local ese aislamiento es el estado durable `BLOCKED`, que bloquea solo a los sucesores del mismo agregado.
- La confirmación de entrega ocurre solo después de persistir el evento recibido, y el ACK debe corresponder al evento y destino de la solicitud. Un éxito de transporte o un ACK mal formado no confirma la entrega.
- No se promete orden causal entre agregados: recepción durable y aplicación comercial son estados distintos.
- La salida local es al menos una vez: un ACK perdido permite reentregar el mismo `eventId`.
- El relay selecciona una sola cabecera por agregado y usa la generación durable del claim;
  una respuesta tardía no altera una reclamación posterior.
- La identidad del emisor la fija el transporte, no el cuerpo: proviene del certificado
  presentado en el handshake y se resuelve contra el registro confiable. Se verifica en cada
  solicitud, también en una reentrega: conocer un `eventId` no autoriza a consultar su ACK.
- El estado de entrega es por `(eventId, destinationNodeId)`. Un ACK de una terminal no
  confirma a otra, retirar un destino no convierte pendientes en publicados y el payload se
  conserva una sola vez.
- Un fallo de transporte responde `application/problem+json` sin identidad de evento y por
  contrato no puede interpretarse como confirmación, ni siquiera con un estado 2xx.
- Recibir una dependencia no es haberla aplicado: el consumidor comprueba la condición real
  antes de aplicar el hecho que la referencia.
- El costo de una salida sincronizada es el snapshot conocido por el origen al vender. Un
  contrato sin esa evidencia deja el costo desconocido y visible como tal; no se completa con
  el promedio vigente del nodo receptor.
- Una referencia se distribuye como estado vigente completo del maestro y se aplica solo si su
  versión es mayor que la local. La terminal la escribe en una proyección propia: no ejecuta
  los casos de uso de administración ni reenvía por su salida el catálogo que recibió.

## Operación degradada visible

La UI distingue `OFFLINE`, `CONNECTING`, `SYNCING`, `SYNCED` y `ATTENTION_REQUIRED`. Debe mostrar la antigüedad de catálogo, tasa y permisos cacheados, además de las discrepancias que requieran intervención.

La lectura de aplicación que deriva esos estados existe desde el 2026-09-06 y se expone en la
API local autenticada. `ATTENTION_REQUIRED` prevalece en el rótulo general mientras la
conectividad se informa aparte, de modo que una caída no oculte una discrepancia. `SYNCED`
exige un ciclo verificado sin pendientes conocidos de entrega ni de aplicación: una salida
vacía o un intento de conexión no bastan. Desde el cierre de 10.04, `apps/desktop` presenta la
antigüedad de catálogo, tasa, concesiones y disponibilidad, además de las operaciones
coordinadas pendientes. Reanudar entregas y resolver discrepancias sigue disponible solo por
la API local autenticada.

## Consolidación cloud futura

La [evolución post-MVP](../cronograma/evolucion-post-mvp.md) y
[ADR-0024](./adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md) mantienen la autoridad
de inventario en el coordinador local y agregan PostgreSQL como proyección central por
sucursal/almacén. No cambian la matriz de ownership vigente ni implementan hoy un salto cloud.

Antes de ese salto se especifican asignación confiable nodo/sucursal, correspondencias de
producto, contratos de inventario confirmado, procedencia de eventos, corte inicial y entrega
por destino. Un ACK de tienda no confirma nube. Los reenvíos se resuelven conforme ADR-0023,
sin sustituir el origen de un evento. La web distingue recepción y aplicación, conserva la
antigüedad de la fuente y nunca suma las proyecciones POS al saldo del coordinador.
