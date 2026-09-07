# ADR-0026: LAN operativa y recuperación entre nodos

- Estado: **Aceptado para el MVP de referencia no certificado; implementado parcialmente al
  2026-09-07**. D1, D2 y D4–D6 están implementadas y probadas. D3 tiene intención durable,
  estado por paso, restricción de enlace y consulta de progreso. Compra, conteo y devolución ya
  tienen efectos remotos autoritativos; la conciliación completa entre fronteras sigue abierta.
  La compensación explícita de un rechazo definitivo con efectos previos conserva además un
  gate propio.
- Fecha: 2026-09-06.
- Complementa: ADR-0008, 0011, 0012, 0016, 0017, 0019, 0022 y 0023.
- Ejecución: Fase 10, secuencia 10.03 → 10.04. No habilita piloto ni producción.

## Contexto y aprobación

10.01 y 10.02 completaron cola y protocolo, pero dejaron gates de confianza, bootstrap,
consumo y distribución de referencias. El usuario confirmó en la planificación de Fase 10:

1. LAN operativa completa, incluidos contratos/productores faltantes y varias terminales.
2. Primera activación con nodos nuevos de prueba; bases de tiendas existentes requieren
   un gate independiente de migración y conciliación.
3. Alta manual controlada y auditable de confianza, con transporte autenticado y cifrado.
4. Alta automática auditable de agregados propios de terminales previamente autorizadas.
5. Conexión al coordinador para completar compras, aprobar conteos y procesar devoluciones;
   las ventas conservan operación offline.
6. Operaciones interrumpidas con efectos iniciados quedan pendientes de conciliación,
   visibles y recuperables sin repetir efectos.
7. Concesiones offline de 8 horas desde su última emisión por el coordinador.
8. Costo conocido al vender como snapshot versionado, con ausencia de costo explícita.
9. Diez intentos de entrega por ciclo, pausas crecientes hasta 60 segundos y pausa durable
   con reanudación manual autorizada al agotarse.

Las decisiones técnicas siguientes concretan esas respuestas dentro de AGENTS.md. Sus
pruebas y contratos detallados se entregan en 10.03–10.04.

El 2026-09-06 se implementaron y probaron: el registro confiable de nodos y su alta/revocación
auditadas, el transporte HTTPS con autenticación mutua, el alta delegada de agregados propios,
la custodia durable con deduplicación y cuarentena, la aplicación recuperable del inventario
autoritativo con discrepancia única, la entrega con estado por destino, la política de retry
con pausa durable y reanudación autorizada, y las referencias de catálogo, métodos de pago,
políticas operativas y tasas confirmadas.

El 2026-09-07 se completaron concesiones de operador y disponibilidad informativa como
referencias del conjunto cerrado; los consumidores de caja, fiscalidad y ventas como
consolidación de solo lectura del coordinador; la infraestructura genérica de intención y
resultado por paso; y el contrato que transporta el snapshot de costo, `SaleCompleted.v2`, con
la v1 intacta y aceptada.

D3 no está cerrada: compra transporta `PurchaseReceiptCompleted.v1`, conteo
`StockCountApproved.v1` y devolución `SaleReturned.v2`; los tres aplican su movimiento
autoritativo sin escribir stock en el POS. La devolución obtiene antes la salida aplicada por
la lectura autenticada `GET /sync/v1/sale-issues/:eventId` y el coordinador la revalida contra
sus movimientos `SALE_ISSUE`. `SaleReturned.v1` conserva intacto su consumo comercial y no
restituye stock. Siguen abiertos los cortes de conciliación entre cada frontera concreta. La
**compensación explícita** de un rechazo definitivo tampoco está implementada; una operación
rechazada queda `NEEDS_REVIEW` con la evidencia disponible.

## D1. Topología, confianza y alta

Cada tienda de prueba tiene un coordinador y terminales registradas explícitamente. Un nodo
pertenece a una tienda en este corte; el registro confiable mapea nodo, terminal, coordinador
y tienda. `Branch.originNodeId` sigue fijo; `Device.branchId` no acredita pertenencia ni autoridad.

El transporte técnico usa HTTPS con autenticación mutua y certificados provisionados
manualmente, vinculados al registro de nodos. Verificar cadena/identidad/vigencia y revocación
en ambos extremos; no descubrir confianza a partir del primer certificado presentado. La
provisión, renovación y revocación dejan actor, terminal, UTC y motivo; las claves se protegen
mediante acceso local restringido y nunca llegan al renderer, eventos comerciales o logs.

Solo el listener técnico de sincronización se expone en LAN, dentro del proceso servidor
dueño de SQLite. Las rutas de operadores conservan loopback y sesiones de ADR-0011. Este
mínimo seguro pertenece a la activación de 10.03; no completa el cifrado en reposo ni el
hardening general de 11.03–11.05.

Para agregados nuevos, la terminal conserva evidencia durable de creación y solicita su alta
al reconectar por una operación técnica separada del evento comercial. La autorización
preexistente del nodo delega esa alta solo para los tipos de su competencia: ventas,
devoluciones, recepciones de compra, conteos, turnos y documentos/jornadas fiscales. Cada
documento conserva su origen fijo conforme su flujo aprobado. No concede catálogo, tasas o
stock ajenos.

El coordinador valida identidad, tipo, terminal y evidencia de creación, registra dueño único
por `(aggregateType, aggregateId)` y devuelve el mismo resultado en reentrega idéntica.
Contradicción con un dueño/evidencia registrados no reasigna autoridad. Registrar el agregado
no valida su contenido comercial. Sin alta válida, el evento sigue rechazado por autoridad
sin resolver; no se adopta el primer emisor del evento. Probar altas creadas después del
bootstrap, no solo fixtures con IDs conocidos. La evidencia no elimina el riesgo de un nodo
autorizado comprometido; no se presenta como prueba criptográfica de que la operación ocurrió.

## D2. Custodia, aplicación y distribución

La recepción autentica y autoriza antes de devolver incluso un duplicado. Deduplicación,
resultado de custodia y seguimiento pendiente se confirman juntos en SQLite. El ACK v1
conserva su resultado de recepción inmutable; una lectura separada informa el progreso
comercial. No se añade un estado aplicado al contrato v1 ya publicado.

El consumidor confirma efecto y progreso juntos cuando comparten DB; si se interrumpe,
la recuperación verifica idempotencia antes de repetir. La dependencia recibida no equivale
a dependencia aplicada. Hechos atrasados se conservan para revisión sin retroceder proyecciones.

Una salida a varias terminales requiere estado durable por `(eventId, destinationNodeId)`:
claim, generación, intento, retry y resultado independientes; el payload se conserva una vez.
Un ACK no confirma otros destinos ni consumidores locales. Retirar un destino no transforma
pendientes en publicados. No reenviar un evento de otra terminal cambiando su origen.

Catálogo, tasas confirmadas, configuración necesaria, concesiones y disponibilidad tienen
contratos suficientes y productores transaccionales. Las terminales aplican referencias por
versiones y leen proyecciones; no escriben maestros del coordinador. Bootstrap usa contratos
de aplicación versionados, corte consistente y progreso reanudable, seguido de cambios
posteriores al corte. No copia tablas ni activa un conjunto parcial de referencias.

Los once contratos v1 permanecen válidos. Datos faltantes exigen contrato o versión nueva
con fixtures reales; no ampliar v1, completar historia consultando el estado actual ni
reinterpretar `PUBLISHED` históricos. El cambio de coordinador y la restauración de una
copia anterior requieren reconciliación explícita antes de activar entregas.

## D3. Operaciones locales y coordinación de stock

Ventas, turnos y fiscalidad pertenecen a su terminal. El stock autoritativo pertenece al
coordinador; el POS conserva disponibilidad informativa, que no se suma al saldo de tienda.
La venta puede completarse offline y conserva validez si su consumo posterior genera una
discrepancia. La composición de caja local no espera al publisher de red.

En LAN, completar compras, aprobar conteos y procesar devoluciones requiere conexión al
coordinador. Los borradores y registros de conteo pueden conservarse localmente. Otras
mutaciones directas de stock se ejecutan en el coordinador; el POS no escribe una segunda
autoridad local. `PurchaseReceipt` y `StockCount` mantienen su nodo de origen; esta decisión
restringe la confirmación offline de efectos, no transfiere su ownership.

Estar conectado no permite una transacción que abarque dos SQLite. Cada operación distribuida
conserva intención y resultado por paso, con ID/fingerprint estable, actor, terminal, UTC,
motivo, dueño y referencias. Sus pasos se implementan como casos de uso concretos, sin un
motor genérico de flujos ni transacciones de base abiertas mientras se espera red.

Antes del primer efecto se registra la intención durable en el origen. Cada nodo confirma
solo sus efectos y evidencia en su transacción, deduplicando por operación/paso. Se valida
permiso antes de iniciar efectos nuevos. Recuperar un efecto ya comprometido concilia esa
misma intención; no extiende concesiones ni crea otra operación comercial tras expirar permisos.
Las lecturas/acciones humanas de recuperación sí requieren autorización vigente.

Sin evidencia de todos los efectos obligatorios, la operación muestra **pendiente de
conciliación**, nunca éxito global ni cancelación por timeout. La recuperación consulta
resultados durables y completa pasos idempotentes; un rechazo definitivo con efectos previos
exige revisión y, cuando corresponda, una compensación explícita auditada. No reescribir
historia, reembolsar dos veces ni compensar automáticamente un efecto desconocido.

Para devoluciones, el reintegro mantiene el método original y el turno actual del origen;
la restitución conserva lotes y costo de la salida original del coordinador. Si esa salida
no está aplicada o está en discrepancia, no inventar una restitución: esperar o resolver
la dependencia. La nota sigue el flujo fiscal recuperable local y conserva `SIMULACION`;
un reenvío de sync no emite ni reimprime. El estado comercial de coordinación y el estado
fiscal son distintos y ambos deben ser visibles.

Esta decisión complementa la atomicidad de ADR-0017, ADR-0019 y los conteos **solo en LAN**:
hay transacciones locales y recuperación de la intención distribuida, no commit atómico
global. En standalone se conserva la atomicidad existente dentro de una sola DB.

### Corte contractual local-first de 10.03

El 2026-09-07 se aprobó el flujo local-first basado en hechos. Las tres operaciones siguen
esta secuencia, sin mantener una transacción abierta durante red:

1. el origen valida permiso, registra la intención durable y comprueba que el coordinador es
   alcanzable antes del primer efecto;
2. una sola transacción local confirma el documento —y, en la devolución, caja y estado
   fiscal inicial—, el ledger, un único hecho de integración y el paso `LOCAL_EFFECT`;
3. el POS **no** escribe movimientos en `StockItem`; el outbox entrega ese mismo `eventId` al
   coordinador con política al menos una vez;
4. `INVENTORY_AUTHORITY` valida la evidencia y confirma en una transacción el movimiento
   autoritativo, su auditoría, la disponibilidad publicada y el progreso del inbox;
5. el origen consulta la aplicación de ese `eventId` y solo entonces confirma
   `COORDINATOR_EFFECT`. Un estado remoto de discrepancia lleva la intención a
   `NEEDS_REVIEW`; un timeout o estado desconocido permanece `PENDING_RECONCILIATION`.

El hecho que prueba `LOCAL_EFFECT` es exclusivamente el hecho de integración que solicita el
efecto autoritativo, no los eventos locales de `StockMovementRegistered` ni una publicación
de disponibilidad. Un duplicado conserva el mismo `eventId`, fingerprint y referencias.

Los contratos y efectos mínimos son:

- `PurchaseReceiptCompleted.v1`: identifica la recepción y transporta por línea producto,
  unidad/escala, cantidad, política y evidencia de lote, costo de valoración y moneda. La
  terminal completa `PurchaseReceipt` sin crear movimientos locales; el coordinador resuelve
  o crea su `StockItem`/lote y registra una entrada por `eventId + lineId`.
- `StockCountApproved.v1`: transporta las diferencias **congeladas al cerrar** —esperado,
  contado y delta— junto con las identidades autoritativas de artículo/lote y la versión de
  disponibilidad observada. El coordinador aplica exactamente el delta con signo por
  `eventId + lineId`; no recalcula lo contado contra un saldo posterior. Para que el POS no
  lea `stock_items`, `StockAvailabilityPublished.v2` distribuye artículo, política de lotes y
  saldos/identidades por lote como referencia informativa versionada.
- `SaleReturned.v2`: conserva intacta la v1 comercial y añade el `eventId` de
  `SaleCompleted` más las líneas de restitución obtenidas de la salida ya aplicada por el
  coordinador: artículo, lote, cantidad y costo original —incluido `null` explícito—. La
  consulta de esa evidencia ocurre después de registrar la intención y antes de efectos
  locales, fuera de una transacción SQLite. El coordinador vuelve a validarla contra sus
  movimientos `SALE_ISSUE` y registra la restitución una vez por `eventId + lineId`. Si la
  salida aún no está aplicada o está en discrepancia, no se crea devolución local ni stock.

En standalone no se publican estos pasos remotos y se conserva la transacción local existente.
La compensación posterior a un rechazo definitivo no se automatiza: requiere un caso de uso
explícito, permiso, motivo y nueva evidencia append-only.

## D4. Costo y discrepancia de inventario

La venta offline congela el costo unitario conocido por la terminal al vender, con moneda,
versión, fuente y fecha del snapshot autoritativo del que procede. Se valida esa procedencia
contra historia de referencias; no se acepta un costo inventado por el renderer. La ausencia
de costo se representa con `null`, no cero ni promedio obtenido posteriormente.

El margen conserva ese snapshot aunque lleguen compras antes de aplicar la salida. El
contrato nuevo transporta evidencia suficiente; un v1 sin ella no se completa desde el
promedio actual. La salida sincronizada conserva el costo aprobado y la devolución lo
reutiliza; es una excepción explícita al consumo del promedio vigente durante la aplicación
local de ADR-0016. No cambia el promedio ponderado de recepciones, la moneda de escritura
única ni revaloriza salidas históricas. Los casos sin costo continúan visibles como tales.

Se conserva el consumo de inventario por venta completa en una transacción del coordinador.
Si una línea impide aplicar el conjunto, no se confirma una parte: se registra una
discrepancia única por evento y consumidor, con las líneas/causas necesarias para resolverla.
La venta sigue válida; stock/lotes no quedan negativos ni se inventan entradas de ajuste.

La discrepancia abierta requiere permiso y motivo para reintentar tras corregir la causa.
Solo evidencia de aplicación permite marcarla resuelta. Un simple reconocimiento no borra
la obligación de inventario. La resolución conserva historia; una nueva reentrega no abre
otra discrepancia ni duplica movimientos. Un fallo temporal tiene retry acotado; falta de
stock no se reintenta esperando que desaparezca por sí sola.

## D5. Concesiones y estado offline

El coordinador emite concesiones versionadas con vencimiento a las 8 horas de emisión.
Reentregar una concesión no renueva su vigencia. Vencida, se deniegan nuevas sesiones y
acciones protegidas hasta obtener una concesión nueva, incluso con una sesión aún existente.
Las sesiones mantienen además 30 minutos idle y 8 horas absolutas de ADR-0011.

La revocación se aplica cuando el nodo la recibe; no se promete revocación global inmediata
durante un corte. No sincronizar PINs, tokens, sesiones o secretos en eventos comerciales.
La provisión local de credenciales para los nodos nuevos permanece controlada; la interfaz
de administración de usuarios/roles sigue en 11.02. Probar versión, expiración y retroceso
del reloj: reiniciar o atrasar el reloj no debe ampliar la concesión.

Catálogo, tasas, concesiones y disponibilidad muestran su versión, fuente, vigencia y último
snapshot completo recibido. Una tasa debe cumplir la vigencia ya definida por moneda;
esta decisión no autoriza tasas vencidas ni inventa un TTL del catálogo.

`OFFLINE`, `CONNECTING`, `SYNCING`, `SYNCED` y `ATTENTION_REQUIRED` conservan la semántica
de arquitectura. Atención prevalece en el rótulo general y conectividad se muestra aparte.
`SYNCED` requiere un ciclo verificado, bootstrap/referencias utilizables y ausencia de
pendientes conocidos de entrega/aplicación; mostrar timestamp y no prometer actualidad global.

## D6. Retry y reanudación

Diez intentos efectivos de entrega por evento/destino y ciclo; backoff exponencial con base
1 s y tope 60 s, con jitter acotado al tope. La selección de una fila que no llega a enviarse
por desconexión conocida no consume el presupuesto de envío, aunque el claim conserve su
generación. Estos parámetros técnicos son reemplazables con configuración validada.

Al agotar el ciclo: pausa durable y `ATTENTION_REQUIRED`. Reconectar o reiniciar no abre
otro ciclo ni resetea intentos. Se pueden comprobar conexiones sin reenviar el evento pausado.
Reanudación manual con permiso, motivo y auditoría tras revalidar la causa; `attempts` sigue
siendo una generación monotónica, separada del presupuesto del ciclo cuando sea necesario.

`BLOCKED` contractual/ownership no se reintenta a ciegas ni se marca publicado para saltarlo.
Reanudar conserva ID/payload; un cambio contractual requiere versión publicada, no editar
un hecho. Los fallos de aplicación después de custodia se recuperan en el receptor sin
obligar al emisor a deshacer un ACK válido. La política no habilita retry fiscal ciego.

## Verificación y límites

Los criterios CA-03 y CA-04 de los planes de Fase 10 requieren transporte real, SQLite por
nodo, entrega a dos terminales, alta de agregados creados offline, ACK perdido, corte de
bootstrap, discrepancias y caída entre cada paso comercial. Los escenarios de transporte,
custodia, referencias y reconciliación genérica están probados con tres archivos SQLite
independientes, listeners reales y autenticación mutua. Compra, conteo y devolución prueban su
aplicación positiva por transporte real, incluida la lectura autenticada de la salida aplicada;
**las caídas entre cada frontera concreta siguen abiertas**. FS-011 conserva esa brecha
explícita.

Las especificaciones de detalle del corte 0 quedaron completas. Durante su implementación
aparecieron dos correcciones que esta decisión recoge: `CashMovementRegistered` deja de
declarar `Sale` como dependencia —un movimiento de caja es un hecho del turno que referencia
una venta, y la venta depende de ese mismo turno, de modo que declararlo creaba un ciclo—, y un
cierre de turno que llega antes que su apertura espera en lugar de descartarse en silencio.

No se adelantan Fase 11, almacenes, nube, transferencias o hardware real mientras D3 siga
abierta.
