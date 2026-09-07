# Plan de ejecución 10.02: Protocolo de eventos

- **Sub-fase:** [10.02 Protocolo de eventos](./10.02-protocolo-eventos.md).
- **Estado del plan:** Ejecutado el 2026-09-06; decisiones D1-D5 aceptadas en [ADR-0023](../../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md).
- **Prerrequisito:** [10.01](./10.01-sync-queue.md) completada el 2026-09-05, con ADR-0022 aceptado.
- **Disciplina:** Outside-in TDD; contratos explícitos sobre el outbox existente, sin dependencias nuevas.

## Resultado esperado y frontera de entrega

Definir y probar un protocolo JSON que transporte hechos versionados entre nodos: forma del
sobre, payloads admitidos, compatibilidad, identidad, ownership, resultados de recepción y
tratamiento de contratos que no pueden procesarse. La frontera observable de 10.02 será la
validación y preparación de eventos en aplicación, con contexto de nodo verificado y estado
receptor fake. El aislamiento del outbox local tendrá pruebas sobre SQLite real.

10.02 no abre conexiones, publica endpoints ni aplica efectos comerciales remotos. El
receptor durable, su autenticación y sus transacciones corresponden a 10.03; la ejecución
automática y la reconexión corresponden a 10.04. Probar decisiones con un fake no demuestra
deduplicación persistida ni sincronización operativa.

## Fuentes y orden de autoridad

Rigen [AGENTS.md](../../../AGENTS.md), arquitectura/ADRs y cronograma/especificación, en ese
orden. Este plan es documentación de la sub-fase, no un PRP ni una autorización para cambiar
invariantes. Las propuestas siguientes deben formalizarse y aprobarse antes del código.

Lecturas obligatorias para ejecutar:

- [Arquitectura](../../architecture/README.md), [capas](../../architecture/01-capas.md),
  [eventos](../../architecture/03-eventos.md), [casos de uso](../../architecture/06-casos-de-uso.md)
  y [ownership](../../architecture/12-sincronizacion-y-ownership.md).
- [Base de datos](../../architecture/08-base-de-datos.md), [logs](../../architecture/10-logs.md)
  y [errores](../../architecture/11-errores.md).
- ADR [0001](../../architecture/adr/0001-ddd-arquitectura-hexagonal.md),
  [0005](../../architecture/adr/0005-eventos-outbox.md),
  [0006](../../architecture/adr/0006-errores-logs-auditoria.md),
  [0007](../../architecture/adr/0007-outside-in-tdd.md),
  [0008](../../architecture/adr/0008-topologia-offline-por-nodo.md),
  [0009](../../architecture/adr/0009-estado-relacional-ledger-outbox.md),
  [0020](../../architecture/adr/0020-modelo-de-almacenes-y-transferencias.md) y
  [0022](../../architecture/adr/0022-entrega-outbox-ordenada-y-recuperable.md).
- [Escenarios de fallo](../../failure-scenarios/README.md),
  [FS-004](../../failure-scenarios/FS-004-sqlite-busy-concurrency-conflict.md),
  [FS-005](../../failure-scenarios/FS-005-venta-concurrente-ultima-unidad.md) y
  [FS-007](../../failure-scenarios/FS-007-entrega-outbox-ambigua.md).
- [Plan y cierre de 10.01](./plan-10.01-sync-queue.md),
  [10.03](./10.03-servidor-receptor.md) y [10.04](./10.04-offline-reconexion.md).

## Línea base comprobada

Inspección del árbol de trabajo que contiene el cierre de 10.01; se conservan sus cambios
locales. Al ejecutar se debe renovar esta lectura, sin suponer que un plan anterior describe
el código vigente.

1. [BusinessEventV1](../../../packages/core/src/application/events/business-event.ts) ya
   contiene identidad, tipo, `contractVersion: 1`, agregado, versión del agregado, origen,
   actor y correlación. `occurredAt` es `Date`, y `payload` es `JsonValue`, sin contrato
   discriminado por tipo. `toBusinessEvents` convierte value objects mediante un mapper
   genérico; eso no constituye validación de entrada no confiable.
2. [persistBusinessChange](../../../packages/core/src/application/events/persist-business-events.ts)
   selecciona tipos explícitos para el outbox. Actualmente selecciona once tipos:
   `ProductCreated`, `PriceChanged`, `SaleCompleted`, `SaleReturned`, `ShiftOpened`,
   `CashMovementRegistered`, `ShiftClosed`, `FiscalDocumentIssued`, `FiscalDocumentFailed`,
   `FiscalXReportIssued` y `FiscalZReportIssued`.
3. `SaleReturned` pertenece a **SaleReturn**, no a Sale; X/Z pertenecen a **FiscalDay**,
   no a FiscalDocument. Sus referencias a otros agregados no cambian esa identidad.
4. [SaleCompleted](../../../packages/core/src/domain/sales/sale-events.ts) transporta
   turno, terminal, totales, pagos e items con cantidades escaladas. Caja e inventario tienen
   parsers locales que validan solo su subconjunto; no sustituyen una validación completa de
   la entrada remota ni verifican toda la compatibilidad contractual en runtime.
5. [ProductCreated](../../../packages/core/src/domain/catalog/product-events.ts) incluye
   nombre, descripción, precio e impuesto, pero no barcode, categoría, unidad ni estado.
   `UpdateProduct` no publica un contrato que distribuya todos sus cambios. Por tanto, los
   eventos actuales no permiten prometer un catálogo remoto operativo completo.
6. [SaleReturned](../../../packages/core/src/domain/sales/sale-return.ts) incluye referencias,
   reintegro y número de líneas; no contiene las líneas/lotes/costos necesarios para repetir
   una restitución remota. No se debe inventar esa evidencia ni leer tablas de otro nodo.
7. [UpdateExchangeRate](../../../packages/core/src/application/currency/update-exchange-rate.ts)
   persiste tasa y auditoría sin outbox. `StockMovementRegistered` sigue como hecho de ledger;
   maestros e identidad tampoco quedan publicados por aparecer en la arquitectura. Una
   definición de contrato no equivale a un productor o una distribución implementados.
8. [DrizzleOutboxStore](../../../packages/drivers/db/src/outbox-store.ts) conserva el orden de
   ADR-0022, pero una `contract_version` distinta de 1 aborta **todo el claim** antes de aumentar
   intentos. No valida tipos/payloads y no tiene estado de aislamiento. El problema alcanza
   otros agregados del lote; debe probarse antes de cambiarlo.
9. [EventPublisher](../../../packages/core/src/application/ports/event-publisher.ts) devuelve
   `Promise<void>`. [OutboxRelay](../../../packages/core/src/application/events/outbox-relay.ts)
   trata cualquier excepción del publisher como `EVENT_PUBLICATION_FAILED` reintentable.
   No hay clasificación de rechazo permanente ni validación de ACK remoto.
10. [DrizzleBusinessEventStore](../../../packages/drivers/db/src/business-event-store.ts)
    devuelve `contractVersion: 1` al leer y su ledger tiene unicidad por agregado/versión.
    No reutilizar esa lectura para convertir historia incompatible ni esa tabla como inbox
    remoto. El ledger y la recepción tienen propósitos distintos.
11. [runtime.ts](../../../apps/server/src/runtime.ts) compone productores y outbox, pero no el
    relay ni los consumidores locales de SaleCompleted. Continúa la deuda de composición
    asignada a Fases 4/5/6; 10.02 no la resuelve conectando consumidores al destino de red.

## Decisiones propuestas antes de implementar

D1–D5 quedaron formalizadas y aceptadas en
[ADR-0023](../../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md), complementario de
ADR-0005/0008/0009/0022. Si alguna propuesta cambia el alcance aprobado, registrar la decisión antes
de ejecutar. Los defaults de simulación no autorizan inventar ownership o garantías durables.

### D1. Sobre JSON y catálogo explícito

Propuesta: conservar `BusinessEventV1` como representación interna y agregar un DTO de
integración con `protocolVersion: 1` para el sobre, separado de `contractVersion` para el
payload de cada `eventType`. Conservar `eventId`, `aggregateId`, `aggregateType`,
`aggregateVersion`, `originNodeId`, `occurredAt`, `actorId` y `correlationId`.

En el wire, `occurredAt` será texto UTC canónico producido por `toISOString()`. Las versiones
serán enteros positivos seguros; dinero, cantidades y tasas conservarán enteros seguros y
sus monedas/escalas. Validar estructura y contenido, sin aceptar `NaN`, infinitos, fracciones
en campos enteros, fechas inválidas, conversiones silenciosas ni objetos de dominio. Los IDs
de evento/agregado siguen la política de generación de la aplicación; los identificadores
de nodo/terminal no se reinterpretan todos como UUID. No regenerar IDs ni timestamps al enviar.

El mapper de salida construirá el DTO por campos permitidos: `attempts`, `status`, leases y
otros metadatos del outbox no viajan por usar un spread de la entrada reclamada.

Definir payloads y validadores concretos para los once tipos existentes, con fixtures
producidas por los casos de uso reales. Documentar campos requeridos, nulabilidad, signos,
escalas y relación tipo/agregado. No añadir campos obligatorios a v1 para acomodar un nuevo
consumidor ni completar filas antiguas consultando el estado comercial actual. Las variantes
históricas incompatibles se conservan y aíslan; un contrato nuevo requiere versión explícita.

Propuesta de compatibilidad: lista cerrada por `(eventType, contractVersion)`, sin downgrade,
upcasters genéricos ni aceptación por un cast de TypeScript. Rechazar campos no declarados en
un contrato conocido; un cambio de forma requiere una versión publicada. Antes del código,
fijar límites de bytes, textos, arrays y profundidad contra fixtures válidas y capacidades
reales de los productores. No recortar líneas o payloads para cumplir un límite ni asumir
que los límites de un comando HTTP coinciden con los de un evento generado.

El catálogo distinguirá dirección, origen autorizado, consumidor previsto y suficiencia:
ventas/caja/fiscal hacia el coordinador; catálogo desde el coordinador hacia terminales.
Definir las dos direcciones no autoriza fan-out sobre el estado de salida único de ADR-0022.
Tasas, maestros, inventario e identidad se registran como brechas de productores/contratos;
no se agregan silenciosamente al outbox ni se declara sincronización completa de referencias.

### D2. Ownership verificado y contexto independiente del payload

Propuesta: la frontera de aplicación recibe el evento y, por separado, identidad de nodo
autenticada y autoridad conocida del agregado. En 10.02 ese contexto se prueba con fakes;
10.03 debe construirlo desde el transporte verificado. `actorId` es evidencia del hecho,
no una credencial ni una concesión de permisos. `originNodeId` autodeclarado no prueba ownership.

Para la primera entrega directa, comprobar emisor contra `originNodeId` y contra el dueño
conocido por `(aggregateType, aggregateId)`. No indexar la autoridad incluyendo el origen
declarado: permitiría que otro nodo fabricara un grupo nuevo para el mismo agregado. Validar
también la coherencia de origen/terminal cuando el payload los contiene.

Conservar los dueños definidos en arquitectura: venta, turno y fiscalidad en su terminal;
catálogo/tasas/identidad en el coordinador; Branch, Device, PurchaseReceipt y StockCount en
su origen fijo. SaleReturn debe conservar el origen validado por su flujo local y no
confundirse con su venta de referencia. Una referencia a un agregado ajeno no autoriza a
escribirlo; aplicar SaleCompleted al inventario autoritativo es responsabilidad de un
consumidor del coordinador, no una escritura remota directa del StockItem.

**Ambigüedad a resolver antes de activar red:** no existe todavía una fuente de confianza para
el primer evento de un agregado desconocido, la identidad del coordinador o el vínculo entre
nodo y terminal. Propuesta segura: sin autoridad verificable devolver ownership sin resolver;
no adoptar al primer emisor como dueño. El ADR debe precisar la evidencia de alta/bootstrap
y el contexto mínimo; credenciales y persistencia de esa evidencia se implementan en 10.03.
`Device.branchId` no es un registro de confianza. Reenvíos por intermediarios requieren una
decisión adicional; no relajar la comprobación de origen para habilitarlos.

### D3. Deduplicación, orden y dependencias entre agregados

Propuesta: deduplicar globalmente por `eventId` en el receptor. Una reentrega idéntica conserva
el mismo resultado durable y no repite efectos. El mismo ID con distinto tipo, versión,
agregado, origen, actor, correlación, fecha o payload es conflicto de identidad; no sobrescribe
lo recibido ni recibe un ACK de duplicado. Comparar el contenido JSON validado de forma
estructural, independiente del orden de claves y sensible al orden de arrays; no depender
de `JSON.stringify` del objeto entrante ni introducir hashing criptográfico sin necesidad.

La deduplicación de eventos no usa el TTL de 30 días del IdempotencyStore de comandos. Para
el primer receptor, proponer conservar la identidad mientras sea posible una reentrega,
sin purga automática; cualquier retención posterior debe incluir un horizonte de replay
aprobado. En 10.02 se prueba la decisión con estado fake; unicidad concurrente, atomicidad,
reinicio y persistencia son criterios obligatorios de 10.03.

Mantener el orden de ADR-0022: versión del agregado y desempate por `eventId`, sin exigir
versiones consecutivas ni usar el reloj como árbitro. No imponer unicidad remota de
agregado/versión: el protocolo debe tolerar varios hechos de esa versión. Un hecho atrasado
no reconocido como duplicado se conserva para revisión, sin retroceder una proyección ni
declararlo aplicado; el ADR debe fijar ese resultado antes del receptor.

No prometer orden causal entre agregados. SaleReturned puede llegar antes de su venta;
un resultado fiscal puede preceder a la referencia comercial; un movimiento de caja puede
referenciar una venta aún no recibida. La falta de una dependencia no invalida el hecho:
separar recepción durable de aplicación pendiente. 10.03 persistirá ambos estados y la
recuperación correspondiente. Definir qué consumidor falta para cada contrato; transportar
SaleReturned.v1 no habilita por sí solo a repetir reintegros o movimientos de inventario.

### D4. Confirmación y clasificación de fallos

Propuesta: respuesta contractual por evento con versión de protocolo, `eventId`, identidad
del receptor y resultado discriminado: aceptación durable, duplicado durable, rechazo o
fallo transitorio. El ACK válido corresponde al evento y destino de la solicitud. Un éxito
HTTP aislado, un ACK mal formado o un ID/destino distinto no confirma la entrega.

Solo aceptación o duplicado **persistidos y compatibles** permiten completar la publicación.
La aceptación significa custodia durable, no aplicación de todos los efectos comerciales.
10.03 debe asegurar que la custodia confirmada tiene seguimiento recuperable de procesamiento;
si falla el commit, no hay ACK. Una confirmación perdida conserva la reentrega del mismo ID.

Separar, mediante códigos seguros a formalizar en el catálogo de errores:

- sobre/payload inválido, tipo desconocido o versión no soportada;
- emisor no autorizado, dueño distinto o autoridad sin resolver;
- mismo ID con contenido distinto y hecho fuera del orden admitido;
- persistencia/red temporalmente indisponibles y confirmación ambigua.

No convertir los primeros grupos en retry infinito. Un evento desconocido/incompatible se
aísla con diagnóstico y conserva evidencia; no recibe aceptación como si fuera procesable.
La cuarentena remota se implementa en 10.03 y su rechazo contractual bloquea la salida local.
Una entrada no autenticada no se guarda indiscriminadamente como payload comercial confiable.
La política de backoff, máximos y reanudación automática sigue en 10.04.

### D5. Aislamiento local mínimo sin perder el orden

Propuesta: completar en 10.02 el aislamiento de contratos locales inválidos/desconocidos,
como anticipa el cierre de 10.01. Extender la fila existente con un estado bloqueado durable
y código seguro, conservando payload, identidad y evidencia de intentos. Formalizar nombre
y transición en el ADR; no crear otra cola que copie el evento.

Una cabecera bloqueada sigue impidiendo adelantar su agregado, pero no se reclama una y otra
vez ni aborta el lote de otros agregados. La detección debe ocurrir sin reinterpretar una
versión desconocida como BusinessEventV1. Usar el contrato de aplicación desde el adaptador;
no introducir la lista de reglas de negocio dentro de SQL. Mantener selección acotada y
claims generacionales; una respuesta tardía no bloquea ni confirma una generación distinta.

Esta modificación requiere revisar la restricción actual de estados y crear, si corresponde,
una migración forward-only probada, conservando las filas históricas. No editar migraciones
aplicadas. Los eventos bloqueados no pasan a PUBLISHED para desbloquear sucesores. Su
reanudación operativa tras corregir compatibilidad queda para 10.04; este corte prueba que
la evidencia sobrevive a reinicio y puede ser diagnosticada sin exponer el payload.

## Historia inicial y condiciones para conectar el transporte

Antes de drenar una base existente deben quedar dispuestas estas decisiones de 10.02:

- Destino durable de la salida y significado de los PUBLISHED históricos. Conservarlos;
  nunca reinterpretar una publicación fake/local como entrega al coordinador.
- Cohorte inicial de eventos y evidencia de ownership para agregados cuya creación no está
  en el outbox. La primera versión entregable puede ser mayor que 1.
- Necesidad real de bootstrap de catálogo y otras referencias: los payloads actuales son
  insuficientes. Propuesta para validar el protocolo: fixtures y nodos de prueba provisionados
  explícitamente. No es una estrategia de migración de una tienda operativa.
- Distribución a varias terminales y eventuales entregas locales: requieren estado por
  destino/consumidor según ADR-0022. No encadenar caja/inventario con red para hacer que una
  caída de LAN detenga la operación local.

El ADR puede dejar el bootstrap operativo y el fan-out como gates de activación documentados,
sin bloquear las pruebas de contratos de 10.02. Debe asignar su resolución antes de habilitar
las rutas de 10.03 o el worker de 10.04 que dependan de ellos. Si se requiere ampliar contratos,
productores o distribución de referencias, actualizar el alcance con aprobación; no cerrar
Fase 10 alegando que una cola enviada equivale a referencias sincronizadas.

## Secuencia de ejecución outside-in

1. **Cerrar el contrato antes del código.** Renovar productores, payloads, migraciones y
   consumidores; formalizar y aprobar D1–D5, límites y criterios. Documentar cada gate aún
   diferido. No declarar una nueva regla de negocio como aprobada por estar en este plan.
2. **Pruebas rojas en la frontera de aplicación.** Validación/preparación de evento completo
   desde `unknown`, round-trip JSON, contexto de emisor/owner fake, duplicado/conflicto y
   resultados del receptor. Incluir fixtures reales de los once tipos y no solo un payload
   vacío de SaleCompleted. Los puertos nuevos se justifican por esa frontera observable.
3. **Contratos y validación mínima.** DTOs serializables y resultados en shared; mapeo,
   catálogo y políticas en core/application. Tipos públicos, sin importaciones internas entre
   paquetes ni dependencias externas en dominio. No crear un framework de schemas o versiones.
4. **Integración con la salida existente.** Probar primero que una cabecera incompatible
   bloquea hoy otros agregados; implementar D5, clasificación y transiciones condicionales.
   Conservar red fuera de UnitOfWork y no activar un publisher que devuelva éxito vacío.
5. **Pruebas del adaptador y de compatibilidad.** SQLite temporal, upgrade desde el esquema
   anterior, preservación de datos y cierre/reapertura con fila bloqueada. Caracterizar
   payloads emitidos por productores actuales contra los contratos; no ampliar un v1 para
   que una prueba pase. Renovar tests/fakes afectados por cambios de puertos.
6. **Documentación y cierre verificable.** Actualizar eventos/ownership/DB/errores según el
   ADR; actualizar FS-007 al cambiar el aislamiento y enlazar FS-004. Añadir escenario de
   incompatibilidad/ownership si no cabe claramente en la ficha existente, con garantías,
   retry, recuperación, observabilidad y pruebas. Mantener como brechas la recepción remota
   y FS-005 distribuido. Validar todo antes de tachar 10.02 y actualizar ambos índices.

Archivos previstos, sujetos al corte contractual aprobado:

- `packages/shared/src/`: contratos JSON de sincronización y export público; no lógica comercial.
- `packages/core/src/application/events/`: mapper/validación, reglas de protocolo, relay y tests.
- `packages/core/src/application/ports/`: solo firmas necesarias para autoridad/estado receptor
  fake, clasificación y transición del outbox; reutilizar puertos existentes cuando sirvan.
- `packages/drivers/db/src/outbox-store.ts`, sus pruebas y migración condicional para D5.
- Documentación normativa y de fallos enlazada arriba; cronograma de 10.02 e índices.

No se modifican `apps/server/src/runtime.ts`, rutas HTTP ni renderer para activar sincronización.
Los consumidores locales se caracterizan; solo se ajustan si un contrato aprobado lo exige,
sin cambiar sus efectos o resolver oportunistamente su composición pendiente.

## Criterios de aceptación propuestos

- [x] CA-01: los once tipos actuales tienen contrato verificable por tipo/versión y agregado
  correcto; fixtures de productores reales pasan, con limitaciones de consumo documentadas.
- [x] CA-02: el round-trip conserva identidad, UTC, actor, correlación, payload y precisión;
  no transporta estado, intentos ni lease del outbox.
- [x] CA-03: forma inválida, fecha inválida, números inseguros/fraccionarios donde se requieren
  enteros, límites excedidos y campos no declarados fallan con códigos estables sin coerción.
- [x] CA-04: tipo desconocido, versión de sobre incompatible y versión de payload incompatible
  producen resultados distinguibles; nunca se reinterpretan como v1 ni llegan al consumidor.
- [x] CA-05: reentrega idéntica devuelve el resultado previo sin efectos nuevos; cambiar el
  orden de claves no crea conflicto y cambiar cualquier dato inmutable sí lo produce.
- [x] CA-06: duplicados se resuelven por eventId, no por timestamp, idempotency key de comando
  o versión del agregado; varios hechos distintos de la misma versión siguen siendo posibles.
- [x] CA-07: se rechaza emisor distinto del origen y origen distinto del dueño conocido;
  agregar otro originNodeId no permite eludir el ownership del mismo agregado.
- [x] CA-08: falta de autoridad no adopta al primer emisor; catálogo exige coordinador
  verificado y los agregados de origen fijo conservan su dueño. No se confía en actorId como
  autorización ni en Device.branchId como identidad de red.
- [x] CA-09: versiones seleccionadas no contiguas son admisibles; hechos atrasados no hacen
  retroceder la proyección. Dependencias entre agregados se distinguen de payload inválido y
  recepción durable se distingue de aplicación comercial.
- [x] CA-10: solo una confirmación durable correspondiente a evento/destino permite éxito;
  ACK mal formado, rechazo, ID distinto, fallo de commit o confirmación perdida no lo permiten.
  En 10.02 se prueba el contrato con fake; el commit remoto se prueba en 10.03.
- [x] CA-11: contrato local incompatible se conserva bloqueado con código seguro; sus
  sucesores no avanzan y otros agregados sí. No hay retry ciego ni PUBLISHED ficticio.
- [x] CA-12: aislamiento y confirmación respetan la generación del claim; callbacks obsoletos
  no alteran el intento vigente. Se conserva la publicación fuera de la transacción.
- [x] CA-13: la migración necesaria conserva eventos/estados/intentos y el aislamiento
  sobrevive al cierre/reapertura; una falla revierte sin perder evidencia ni reescribir historia.
- [x] CA-14: diagnóstico por IDs técnicos, versión, correlación y código; sin payload, PII,
  credenciales o stack en errores públicos. El aislamiento no amplía la lista permitida de logs.
- [x] CA-15: arquitectura, ADR y escenarios distinguen garantías probadas, contratos fake y
  gates de activación; productores ausentes, bootstrap, fan-out y composición local no se
  presentan como resueltos. No hay réplica de tablas ni cambio de ownership silencioso.
- [x] CA-16: verificaciones completas aprobadas y evidencia registrada antes del cierre de
  10.02; no se avanza a 10.03 mientras queden tareas de implementación abiertas.

## Fuera de alcance

- Endpoint, cliente de red, autenticación entre nodos, inbox durable, cuarentena remota,
  deduplicación transaccional y discrepancias de inventario: implementación en 10.03.
- Worker, backoff definitivo, límites de reintentos, reanudación operativa de bloqueados,
  estados visibles, antigüedad de referencias y chaos tests de dos nodos: 10.04.
- Productores faltantes y snapshots de bootstrap: requieren disposición explícita de alcance;
  este plan detecta las brechas y no implementa un catálogo, tasas o identidad nuevos.
- Transferencias y varios almacenes de ADR-0020, cambio de dueño de Branch, hardware fiscal
  real, administración de identidad de Fase 11 y optimización de Fase 12.
- Reescritura o limpieza de ledger/outbox, reconstrucción de agregados desde eventos,
  broker, bus genérico, negociación dinámica, firmas o compresión especulativas.

## Verificación y estado de esta entrega

Ejecutado el 2026-09-06. La planificación de este archivo quedó cerrada con
[ADR-0023](../../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md) aceptado y
CA-01–CA-16 cubiertos por pruebas. La sub-fase 10.02 está completada; 10.03 y 10.04 siguen
pendientes.

Archivos entregados:

- `packages/shared/src/json.ts` y `packages/shared/src/sync/v1/events.contracts.ts`: tipo JSON
  compartido, comparación canónica, sobre, resultados, límites y códigos del protocolo.
- `packages/core/src/application/events/`: catálogo y validadores (`sync-contracts.ts`), mapper
  y validación del sobre (`sync-envelope.ts`), interpretación del ACK (`sync-ack.ts`), receptor
  de aplicación (`receive-sync-event.ts`) y relay con aislamiento (`outbox-relay.ts`).
- `packages/core/src/application/ports/`: `aggregate-authority-registry.ts`,
  `sync-reception-store.ts`, `event-publisher.ts` y `outbox-store.ts` con `markBlocked`.
- `packages/drivers/db/`: `outbox-store.ts`, migración `0027-outbox-blocked-contract.ts` y sus
  pruebas sobre SQLite real.
- Documentación: ADR-0023, `03-eventos.md`, `08-base-de-datos.md`, `11-errores.md`,
  `12-sincronizacion-y-ownership.md`, FS-007, FS-008 e índices de arquitectura, escenarios de
  fallo y cronograma.

Verificaciones ejecutadas fuera del sandbox:

- `pnpm install --frozen-lockfile`: aprobado, sin cambios de dependencias.
- `pnpm typecheck`: aprobado en los diez paquetes.
- `pnpm test`: 667 pruebas en 124 archivos aprobadas (603 en 121 antes de esta entrega).
- `pnpm lint` y `git diff --check`: aprobados.

Limitaciones reales de esta entrega:

- El receptor se prueba con estado fake: no hay unicidad concurrente, atomicidad ni
  persistencia de la deduplicación; eso es criterio obligatorio de 10.03.
- No hay endpoint, cliente de red ni autenticación entre nodos; el publisher sigue siendo fake
  y `runtime.ts` no compone el relay.
- La identidad verificada del coordinador y la evidencia de alta de ownership llegan como
  contexto fake; construirlas desde el transporte corresponde a 10.03.
- Ningún consumidor remoto está implementado y siguen sin productor las tasas, los maestros,
  el inventario y la identidad. Bootstrap de catálogo y fan-out quedan como gates de ADR-0023.
- Una fila `BLOCKED` no se reanuda automáticamente: la operación manual pertenece a 10.04.
