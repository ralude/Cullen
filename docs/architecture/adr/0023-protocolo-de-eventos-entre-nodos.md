# ADR-0023: Protocolo de eventos entre nodos

- Estado: Aceptado
- Fecha: 2026-09-06
- Complementa: ADR-0005, ADR-0008, ADR-0009 y ADR-0022

## Contexto

ADR-0022 cerró las garantías locales de la cola de salida, pero dejó abiertos el contrato de
transporte, la compatibilidad, la deduplicación receptora, la verificación de ownership y el
aislamiento de contratos que no pueden entregarse. `BusinessEventV1` era una representación
interna sin validación de entrada no confiable, `EventPublisher` devolvía `void` y una
`contract_version` desconocida abortaba el claim completo, incluidos otros agregados.

Esta decisión fija el protocolo de 10.02. No abre conexiones, no publica endpoints y no aplica
efectos comerciales remotos: el receptor durable pertenece a 10.03 y la operación de
reconexión a 10.04.

## Decisión

### D1. Sobre JSON y catálogo explícito

`BusinessEventV1` sigue siendo la representación interna. El transporte usa un DTO
`SyncEnvelopeV1` con `protocolVersion` para el sobre, separado de `contractVersion` para el
payload de cada `eventType`, y conserva `eventId`, `aggregateId`, `aggregateType`,
`aggregateVersion`, `originNodeId`, `occurredAt`, `actorId` y `correlationId`.

`occurredAt` viaja como texto UTC canónico de `toISOString()`. Versiones, dinero, cantidades y
tasas son enteros seguros con su moneda o escala. No se aceptan `NaN`, infinitos, fracciones
donde se exige entero, fechas inválidas o no canónicas, conversiones silenciosas ni objetos de
dominio. Los IDs de evento y agregado siguen la política de generación de la aplicación; los
identificadores de nodo y terminal no se reinterpretan como UUID. No se regeneran IDs ni
timestamps al enviar.

El mapper de salida construye el DTO por campos permitidos: `status`, `attempts`, lease y
cualquier otro metadato del outbox no viaja.

El catálogo es una lista cerrada por `(eventType, contractVersion)` con los once tipos que el
outbox selecciona hoy: `ProductCreated`, `PriceChanged`, `SaleCompleted`, `SaleReturned`,
`ShiftOpened`, `CashMovementRegistered`, `ShiftClosed`, `FiscalDocumentIssued`,
`FiscalDocumentFailed`, `FiscalXReportIssued` y `FiscalZReportIssued`. Cada entrada declara su
agregado dueño, su dirección, el consumidor previsto y el validador de su payload. No hay
downgrade, upcaster genérico ni aceptación por un cast de TypeScript; un campo no declarado se
rechaza y un cambio de forma exige una versión publicada. Las variantes históricas
incompatibles se conservan y se aíslan.

La activación progresiva de 10.03 añade contratos nuevos sin reescribir esos once v1.
`PaymentMethodPublished.v1` distribuye el estado completo de un método desde el coordinador:
el código es identidad del agregado, `aggregateVersion` es su versión monotónica y el payload
contiene nombre, tipo, moneda y estado. Reentregar o recibir una versión atrasada no renueva ni
retrocede el maestro local.

Límites v1, fijados contra los payloads que los productores emiten hoy: 262 144 bytes por
sobre, 128 caracteres por identificador, 1 024 por texto libre, 500 elementos por arreglo y 6
niveles de anidamiento. Un hecho que los exceda se rechaza; nunca se recorta para que quepa.

Dirección: ventas, caja y fiscalidad viajan hacia el coordinador; el catálogo viaja desde el
coordinador hacia las terminales. Definir las dos direcciones no autoriza fan-out sobre el
estado de salida único de ADR-0022. Tasas, maestros, inventario e identidad quedan como
brechas de productores y contratos: no se agregan al outbox ni se declara sincronización
completa de referencias.

### D2. Ownership verificado y contexto independiente del payload

La frontera de aplicación recibe el evento y, por separado, la identidad de nodo autenticada y
la autoridad conocida del agregado. `actorId` es evidencia del hecho, no una credencial ni una
concesión de permisos; un `originNodeId` autodeclarado no prueba ownership.

Se comprueba que el emisor verificado coincide con `originNodeId`, que el payload —cuando
transporta origen o terminal— es coherente con él, y que el origen coincide con el dueño
conocido del agregado. La autoridad se consulta solo por `(aggregateType, aggregateId)`:
incluir el origen declarado permitiría que otro nodo fabricara un grupo nuevo para el mismo
agregado.

Se conservan los dueños de [12-sincronizacion-y-ownership.md](../12-sincronizacion-y-ownership.md):
venta, turno y fiscalidad en su terminal; catálogo, tasas e identidad en el coordinador;
`Branch`, `Device`, `PurchaseReceipt` y `StockCount` en su origen fijo. `SaleReturn` conserva
el origen validado por su flujo local y no se confunde con la venta que referencia. Una
referencia a un agregado ajeno no autoriza a escribirlo.

Sin autoridad verificable, el resultado es ownership sin resolver: no se adopta al primer
emisor como dueño. La única excepción es el catálogo, que exige la identidad verificada del
coordinador. `Device.branchId` no es un registro de confianza. Los reenvíos por intermediarios
requieren una decisión adicional; no se relaja la comprobación de origen para habilitarlos.

En 10.02 ese contexto se prueba con fakes. Construirlo desde el transporte autenticado y
persistir la evidencia de alta o bootstrap corresponde a 10.03.

### D3. Deduplicación, orden y dependencias entre agregados

El receptor deduplica globalmente por `eventId`. Una reentrega idéntica conserva el mismo
resultado durable y no repite efectos. El mismo ID con distinto tipo, versión, agregado,
origen, actor, correlación, fecha o payload es conflicto de identidad: no sobrescribe lo
recibido y no recibe ACK de duplicado. La comparación es estructural sobre el JSON validado,
independiente del orden de claves y sensible al orden de arrays, sin hashing criptográfico.

Esta deduplicación no usa el TTL de 30 días del `IdempotencyStore` de comandos. La identidad
del hecho se conserva mientras sea posible una reentrega; cualquier retención posterior exige
un horizonte de replay aprobado.

Se mantiene el orden de ADR-0022 —versión del agregado y desempate por `eventId`— sin exigir
versiones consecutivas ni usar el reloj como árbitro. No se impone unicidad remota de
agregado/versión: varios hechos distintos de la misma versión siguen siendo posibles. Un hecho
atrasado que no es duplicado se conserva para revisión sin retroceder una proyección y sin
declararse aplicado.

No se promete orden causal entre agregados. `SaleReturned` puede llegar antes de su venta, un
resultado fiscal antes de la referencia comercial y un movimiento de caja antes de la venta que
referencia. La falta de una dependencia no invalida el hecho: la recepción durable se separa de
la aplicación pendiente. Ningún contrato tiene todavía un consumidor remoto implementado;
transportar `SaleReturned.v1` no habilita repetir reintegros ni movimientos de inventario.

### D4. Confirmación y clasificación de fallos

El destino responde por evento con versión de protocolo, `eventId`, identidad del receptor y un
resultado discriminado: aceptación durable, duplicado durable, rechazo o fallo transitorio. El
ACK válido corresponde al evento y destino de la solicitud. Un éxito de transporte aislado, un
ACK mal formado o uno con otro ID o destino no confirma la entrega.

Solo una aceptación o un duplicado persistidos y compatibles permiten completar la publicación.
La aceptación significa custodia durable, no aplicación de todos los efectos comerciales. Si
falla el commit receptor no hay ACK. Una confirmación perdida conserva la reentrega del mismo
ID.

Los códigos se separan en cuatro grupos, con códigos estables y seguros:

- sobre o payload inválido, tipo desconocido, versión de sobre o de payload no soportada;
- emisor no autorizado, dueño distinto o autoridad sin resolver;
- mismo ID con contenido distinto;
- persistencia o red temporalmente indisponibles y confirmación ambigua.

Los tres primeros grupos son permanentes y no se reintentan a ciegas: se aíslan con
diagnóstico y conservan evidencia. El cuarto se reprograma. Un código recibido de otro nodo
solo se conserva si respeta la forma de código estable; en caso contrario la entrega se trata
como ambigua. La cuarentena remota pertenece a 10.03 y la política de backoff, máximos y
reanudación automática sigue en 10.04.

### D5. Aislamiento local sin perder el orden

`outbox_event` gana el estado durable `BLOCKED`. Una fila bloqueada conserva payload,
identidad y evidencia de intentos, deja de reclamarse y sigue impidiendo que avancen sus
sucesores, mientras otros agregados avanzan. No se crea otra cola ni se copia el evento, y una
fila bloqueada nunca pasa a `PUBLISHED` para desbloquear sucesores.

La detección ocurre en dos puntos, sin reinterpretar una versión desconocida como
`BusinessEventV1`:

- el adaptador aísla, antes de mapear, una fila cuya `contract_version` no puede
  materializarse, con `OUTBOX_CONTRACT_VERSION_UNSUPPORTED` y sin alterar `attempts`;
- el relay valida el sobre contra el catálogo de aplicación después de reclamar y, ante un
  contrato inentregable o un rechazo permanente del destino, bloquea comparando la generación
  del claim.

La migración `0027` reconstruye la tabla para admitir el estado nuevo conservando cada fila,
su estado, sus intentos y su evidencia. La reanudación operativa de una fila bloqueada, tras
corregir la compatibilidad, queda para 10.04.

## Consecuencias

- `EventPublisher` devuelve la confirmación cruda del destino y el relay la valida; un
  publisher que devuelva éxito vacío ya no completa la publicación.
- `OutboxStore` gana `markBlocked`, que exige `PROCESSING` y la generación vigente.
- Una `contract_version` desconocida deja de abortar el lote completo.
- El receptor de 10.03 hereda contratos, códigos y resultados ya probados con fakes; probar
  con un fake no demuestra deduplicación persistida ni sincronización operativa.
- Quedan como gates de activación documentados, sin bloquear 10.02: la cohorte inicial y el
  significado de los `PUBLISHED` históricos, la evidencia de alta y bootstrap de ownership, el
  bootstrap de catálogo y otras referencias, y la distribución a varias terminales, que
  requeriría estado por destino según ADR-0022.
- Los payloads actuales de `ProductCreated` y `SaleReturned` no bastan para un catálogo remoto
  operativo ni para repetir una restitución: son brechas registradas, no funciones entregadas.
