# 10.03, corte 0: distribución de referencias operativas

- Fecha: 2026-09-06.
- Estado: **especificación aprobada e implementada**; el conjunto cerrado quedó completo el
  2026-09-07 con concesiones, disponibilidad, costo y los consumidores comerciales.
- Autoridad: [AGENTS.md](../../../AGENTS.md),
  [ADR-0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) y
  [ADR-0023](../../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md).
- Predecesor: [plan 10.03](./plan-10.03-servidor-receptor.md), cortes 1–3 ya implementados.

Este documento cierra el contrato antes del código, como exige el corte 0. Cubre el mecanismo
común de distribución y el **vertical de catálogo**, que se implementa primero. El resto del
conjunto cerrado reutiliza el mismo mecanismo en cortes posteriores y no se declara listo aquí.

## Decisiones de alcance del 2026-09-06

1. **Conjunto cerrado, mínimo operativo:** catálogo con precios e impuestos, categorías,
   unidades de medida, métodos de pago, políticas operativas, tasas confirmadas, concesiones y
   disponibilidad informativa. **Proveedores, sucursales y dispositivos quedan fuera** de esta
   activación: sus flujos LAN no existen y una referencia sin consumidor real no se distribuye.
2. **Dirección push:** el coordinador publica en su salida y entrega a cada terminal. Cada
   terminal expone su propio listener técnico de LAN. Reutiliza `sync_delivery`, los claims y
   el ACK por destino ya implementados; no se añade un mecanismo de consulta paralelo.
3. **Contrato de estado completo versionado:** cada publicación transporta el estado vigente
   del agregado con su versión. El consumidor hace un upsert idempotente y descarta versiones
   atrasadas. El bootstrap usa el mismo contrato, así que no hay dos mecanismos ni hueco entre
   el corte inicial y los cambios posteriores.
4. **Categorías y unidades son referencias propias**, y el producto las declara como
   dependencia. El receptor ya espera a que una dependencia esté **aplicada**, no solo recibida.

## Mecanismo común

### Identidad, dirección y confianza

Cada publicación es un hecho del agregado de referencia: `aggregateType` y `aggregateId` son
los del maestro, y `aggregateVersion` es su versión en el coordinador. El payload **no** repite
esa versión: duplicarla permitiría que las dos copias se separaran, igual que con la escala de
cantidad. El orden y la idempotencia se resuelven con el sobre, que ya se valida. La dirección del
contrato es `COORDINATOR_TO_TERMINAL`.

La terminal receptora acepta estos contratos desde la identidad verificada del coordinador de
su tienda aunque no exista autoridad registrada para el agregado; esa regla ya está
implementada en `resolveOwnership` y no se amplía. El coordinador nunca acepta una referencia
entrante: un POS no muta el maestro aunque conserve permisos locales de administrador.

Para entregar hacia una terminal, el coordinador necesita su dirección de red. Se añade al
registro confiable en lugar de a una configuración paralela: `sync_node` gana `address_host` y
`address_port`, opcionales, y un nodo sin dirección simplemente no es destino de entrega.
Retirar la dirección detiene nuevas entregas y **no** convierte pendientes en publicados.

### Orden, aplicación e idempotencia

La salida ya entrega una cabecera por agregado en orden de versión, así que el consumidor
recibe las publicaciones de un mismo maestro en orden. Aun así el consumidor no confía en el
orden: aplica **solo si `version` es mayor que la versión local**, y una publicación atrasada
se conserva sin retroceder la proyección. Una reentrega idéntica no cambia nada.

El consumidor escribe la proyección local mediante un puerto propio de aplicación de
referencias. **No** invoca `CreateProduct`, `UpdateProduct`, `UpdatePrice`, `SaveCategory` ni
`SaveUnit`: esos casos de uso exigen permiso humano, escriben auditoría y emiten hechos, y
reutilizarlos haría que la terminal reenviara el catálogo del coordinador como si fuera propio.
La escritura de la proyección no encola nada en la salida local de la terminal.

### Versión de los maestros

`Product` ya tiene versión, pero solo la incrementa `changePrice`. Los maestros `Category` y
`UnitOfMeasure` no tienen versión alguna. Sin una versión monotónica por agregado, dos cambios
consecutivos producirían publicaciones indistinguibles y el consumidor descartaría la segunda.

Por eso el corte incluye:

- `Product.updateDetails` incrementa la versión del agregado, igual que `changePrice`.
- `categories` y `units_of_measure` ganan una columna `version` monotónica, que arranca en `1`
  y se incrementa en cada guardado del maestro.

### Bootstrap

El corte inicial **es el mismo contrato**. Un caso de uso de publicación enumera, dentro de una
transacción de lectura del coordinador, el estado vigente de cada agregado de la referencia y
encola una publicación por agregado con su versión actual. El progreso por destino lo lleva
`sync_delivery`; interrumpir el bootstrap deja publicaciones pendientes que el worker retoma.

Un cambio ocurrido durante el corte se entrega después como publicación normal, y la regla
`version >` del consumidor resuelve el solapamiento: no hay huecos, no hay orden especial y una
carga parcial nunca se presenta como catálogo completo. La terminal declara la referencia
**utilizable** solo cuando no le quedan publicaciones pendientes de ese tipo.

### Lo que no cambia

Los once contratos v1 permanecen intactos en el catálogo cerrado y en el ledger, con sus
fixtures. `ProductCreated.v1` y `PriceChanged.v1` **dejan de seleccionarse** para la salida de
integración porque el catálogo operativo se distribuye con el contrato nuevo; siguen
registrándose en `business_event` como historia local. No se reescribe ningún v1 ni se
reinterpreta una publicación histórica.

Como cada referencia estrena un `eventType` nuevo en su versión 1, el catálogo sigue indexado
por tipo y `BusinessEventV1.contractVersion` conserva su literal `1`.

## Contratos del vertical de catálogo

Los tres se necesitan juntos: sin categorías y unidades aplicadas, la dependencia del producto
nunca se satisface y su publicación esperaría indefinidamente.

### `CategoryPublished.v1`

| Campo | Tipo | Notas |
|---|---|---|
| `name` | `text` | nombre vigente |
| `isActive` | `enum ACTIVE \| INACTIVE` | una desactivación es un cambio, no un borrado |

- `aggregateType`: `Category`. Sin dependencias. Consumidor: `CATALOG_REFERENCE`.

### `UnitOfMeasurePublished.v1`

| Campo | Tipo | Notas |
|---|---|---|
| `code` | `identifier` | código de negocio, mayúsculas |
| `name` | `text` | |
| `quantityScale` | `integer >= 0` | escala con la que se interpretan las cantidades |
| `isActive` | `enum ACTIVE \| INACTIVE` | |

- `aggregateType`: `UnitOfMeasure`. Sin dependencias. Consumidor: `CATALOG_REFERENCE`.

### `ProductPublished.v1`

| Campo | Tipo | Notas |
|---|---|---|
| `name`, `description` | `text` | |
| `categoryId` | `identifier` | dependencia `Category` |
| `unitId` | `identifier` | dependencia `UnitOfMeasure` |
| `unitCode` | `identifier` | código con el que el POS presenta la unidad |
| `barcodes` | `array` de `{ barcodeId, code, isActive }` | conjunto vigente completo, no un delta |
| `price` | `money` | precio vigente |
| `taxRate` | `taxRate` | |
| `isActive` | `enum ACTIVE \| INACTIVE` | |

- `aggregateType`: `Product`. Consumidor: `CATALOG_REFERENCE`.
- **No** transporta `quantityScale`: pertenece a la unidad, y duplicarlo invita a que las dos
  copias se separen. La dependencia garantiza que la unidad esté aplicada antes que el producto.
- **No** transporta historia de precios: el histórico es del coordinador y el POS no lo necesita
  para vender. `PriceChanged.v1` conserva ese hecho en el ledger local del coordinador. En la
  terminal, la proyección conserva **una** fila de precio publicado para poder rehidratar el
  producto; en consecuencia `GetPriceHistory` en una terminal muestra solo el precio vigente y
  no es el histórico autoritativo.

## Productores

Un cambio autoritativo y su publicación se confirman juntos, en la transacción del caso de uso:

| Caso de uso | Publica |
|---|---|
| `CreateProduct` | `ProductPublished.v1` |
| `UpdateProduct` | `ProductPublished.v1` |
| `UpdatePrice` | `ProductPublished.v1` |
| `SaveCategory` | `CategoryPublished.v1` |
| `SaveUnit` | `UnitOfMeasurePublished.v1` |

La publicación es un hecho de integración derivado del estado del agregado después de la
mutación, no un evento de dominio: el dominio no carga con una preocupación de distribución.
`persistBusinessChange` acepta publicaciones adicionales ya construidas junto a los eventos de
dominio, y las encola en la misma transacción.

`UpdateProduct` hoy no recibe `BusinessEventStore` ni `OutboxStore` y por eso no produce ningún
hecho; el corte se los compone.

## Consumidor `CATALOG_REFERENCE`

Escribe la proyección local de la terminal con un upsert por `aggregateId`, condicionado a
`version` mayor que la local. Aplica altas, cambios y desactivaciones. Confirma su efecto y su
marca de progreso en la misma transacción, como el consumidor de inventario.

Una desactivación conserva la fila y su historia local; no borra el producto ni sus ventas.

## Criterios de aceptación del vertical

- [x] ~~CA-REF-01~~: los tres contratos validan sus payloads reales y rechazan campos no
      declarados, sin ampliar ningún v1 existente.
- [x] ~~CA-REF-02~~: crear, modificar, cambiar precio y desactivar un producto producen exactamente
      una publicación cada uno, confirmada en la misma transacción que el cambio autoritativo.
- [x] ~~CA-REF-03~~: el consumidor aplica alta, cambio y desactivación; una reentrega idéntica no
      cambia la proyección y una publicación atrasada no la retrocede.
- [x] ~~CA-REF-04~~: un producto entregado antes que su categoría o su unidad espera a que la
      dependencia esté aplicada, y se aplica al resolverse sin intervención.
- [x] ~~CA-REF-05~~: el bootstrap interrumpido y reanudado deja la proyección completa y sin
      duplicados; un cambio ocurrido durante el corte se aplica una sola vez.
- [x] ~~CA-REF-06~~: con dos terminales, una desconectada no bloquea a la otra y al reconectar
      recibe el mismo estado sin huecos.
- [x] ~~CA-REF-07~~: la terminal no reenvía el catálogo recibido por su salida local, y el
      coordinador rechaza una publicación de catálogo entrante desde un POS.
- [x] ~~CA-REF-08~~: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `pnpm lint` y
      `git diff --check` aprobados, con documentación e índices actualizados.

## Estado de implementación

**Paso 1 completado el 2026-09-06:** los tres contratos existen en el catálogo cerrado, con
consumidor `CATALOG_REFERENCE` declarado y dependencias del producto sobre `Category` y
`UnitOfMeasure`. Sus payloads se validan contra publicaciones construidas desde los mismos
agregados que usarán los productores, no contra literales de prueba. Los constructores viven en
`application/catalog/reference-publications.ts` y son la pieza que el paso 2 compone dentro de
los casos de uso; hasta entonces ningún caso de uso los emite todavía.

**Paso 2 completado el 2026-09-06:** `Product.updateDetails` avanza la versión del agregado, y
`categories` y `units_of_measure` ganan una versión monotónica (migración `0032`) que el propio
`insert ... on conflict` incrementa y devuelve, con triggers que impiden que retroceda. Las dos
rutas de escritura de cada maestro comparten esa versión. `CreateProduct`, `UpdateProduct`,
`UpdatePrice`, `SaveCategory` y `SaveUnit` encolan su publicación en la transacción del comando;
`ProductCreated.v1` y `PriceChanged.v1` dejaron de seleccionarse para la salida y siguen en el
ledger. `persistBusinessChange` acepta publicaciones derivadas, que van a la salida y **no** al
ledger. Cubre CA-REF-02.

**Paso 3 completado el 2026-09-06:** el puerto `CatalogReferenceProjection` y su adaptador
SQLite escriben las mismas tablas que el POS lee para vender, por una ruta propia que no invoca
los casos de uso de administración, no escribe auditoría de un actor humano y no encola nada en
la salida local. Cada aplicación está condicionada en SQL a que la versión publicada sea mayor
que la local, así que una publicación atrasada devuelve `STALE` sin retroceder la proyección.
El consumidor `CATALOG_REFERENCE` toma la versión del sobre, traduce el estado a la proyección
y trata una forma inesperada como incompatibilidad permanente. Cubre CA-REF-03 y CA-REF-04.

**Paso 4 completado el 2026-09-06:** `sync_node` lleva `address_host` y `address_port`
(migración `0033`), con triggers que exigen host y puerto juntos. Los destinos se resuelven
**en cada ciclo** desde el registro confiable, así que un alta, una revocación o un cambio de
dirección no esperan a un reinicio; el worker toma un proveedor de destinos en vez de una lista
fija. Cada terminal expone su propio listener técnico y aplica lo recibido en su proyección. El
coordinador reutiliza su identidad de transporte y las autoridades que ya acepta como cliente,
sin variables de entorno nuevas. El alta delegada de agregados queda además cerrada al
coordinador: existe para agregados propios de una terminal. Cubre CA-REF-06 y CA-REF-07.

**Paso 5 completado el 2026-09-06:** `PublishCatalogBootstrap` lee el catálogo vigente y encola
sus publicaciones **en la misma transacción**, así que el corte es consistente y una
interrupción antes del commit no deja publicaciones parciales. Después del commit, el progreso
vive en `sync_delivery` y el worker lo retoma. Repetir el corte es seguro: transporta el mismo
estado y el consumidor descarta lo que no sea posterior. La lectura de estado añade
`referencesUsable`, que exige cero publicaciones pendientes **y** al menos una aplicada, de modo
que una terminal a la que nunca se le publicó el catálogo no queda `SYNCED` por tener la cola
vacía. Cubre CA-REF-05 y cierra CA-REF-01 a CA-REF-08.

## Secuencia de implementación

1. ~~Contratos nuevos y su validación, con fixtures de los productores reales.~~ **Hecho.**
2. ~~Versión monotónica de `Product.updateDetails`, `categories` y `units_of_measure`;
   productores y retirada de `ProductCreated.v1` y `PriceChanged.v1` de la selección de
   salida.~~ **Hecho.**
3. ~~Puerto y adaptador de proyección de referencias, consumidor `CATALOG_REFERENCE`.~~ **Hecho.**
4. ~~Dirección de entrega en el registro confiable, listener de la terminal y composición.~~
   **Hecho.**
5. ~~Bootstrap y pruebas de extremo a extremo con dos terminales.~~ **Hecho.**

## Fuera del vertical inicial de catálogo

Concesiones y disponibilidad informativa reutilizarán este mecanismo en cortes siguientes.
Las tasas confirmadas ya se incorporaron en el vertical descrito más abajo. Mientras no se
entregue el conjunto cerrado restante, la terminal no puede declararse lista para operar y
10.03 sigue abierta.

## Corte siguiente: métodos de pago

El primer vertical posterior al catálogo distribuye `PaymentMethodPublished.v1`. La identidad
del agregado es el código normalizado del método (`aggregateType = PaymentMethod` y
`aggregateId = code`); `aggregateVersion` es monotónica y persistida, y el payload de estado
completo contiene exactamente `name`, `kind`, `currencyCode` e `isActive`. El coordinador es
la única autoridad y cada terminal lo aplica mediante el mismo consumidor de referencias, sin
invocar `SavePaymentMethod`, sin auditoría humana local y sin reenviar el hecho.

Criterios antes de continuar con políticas:

- [x] ~~Guardar o desactivar un método confirma su versión y publicación en la misma
  transacción.~~
- [x] ~~Una publicación atrasada no retrocede nombre, tipo, moneda ni estado.~~
- [x] ~~El bootstrap incluye todos los métodos, activos e inactivos, y una interrupción antes
  del commit no deja un corte parcial.~~
- [x] ~~El contrato se valida contra la publicación construida por el productor real y no
  altera las fixtures v1 ya publicadas.~~

**Implementado el 2026-09-06:** migración `0034`, productor en `SavePaymentMethod`, contrato
cerrado, consumidor/proyección SQLite, bootstrap y prueba LAN con una terminal nueva. El
consumidor reutiliza la ruta transaccional de referencias y no crea una segunda cola.

## Corte siguiente: políticas operativas

Las políticas ya tienen dos secuencias append-only independientes. Se publican como
`DiscountPolicyPublished.v1` y `FinancialTransactionTaxPolicyPublished.v1`, ambos con
`aggregateType = OperationalPolicy`; el `aggregateId` es respectivamente `DISCOUNT` y
`FINANCIAL_TRANSACTION_TAX`, y `aggregateVersion` conserva la versión persistida de cada
secuencia. El payload contiene `policyId` y la configuración completa: máximo de descuento, o
tasa más listas normalizadas de métodos y monedas elegibles. La fecha del sobre es la vigencia
de la copia proyectada; los metadatos humanos y motivos no se replican como configuración.

Criterios antes de continuar con tasas:

- [x] ~~Solo una activación nueva publica; repetir exactamente la configuración no crea versión
  ni evento.~~
- [x] ~~Aplicar una versión nueva desactiva la copia local anterior en la misma transacción; una
  versión igual o atrasada no cambia la política vigente.~~
- [x] ~~El bootstrap publica cero o una política activa de cada tipo y conserva atomicidad.~~
- [x] ~~Los proveedores que usan venta y descuento leen la política proyectada sin defaults y la
  terminal no reenvía la referencia recibida.~~

**Implementado el 2026-09-06:** ambos comandos de activación publican únicamente una versión
nueva dentro de su unidad de trabajo. El consumidor conserva el ledger append-only local,
desactiva la política anterior y aplica solo versiones posteriores. El corte inicial enumera
como máximo una política activa por tipo y las pruebas LAN verifican que los proveedores reales
de descuento e IGTF leen la copia proyectada en una terminal nueva, sin outbox local.

## Corte siguiente: tasas confirmadas

Decisión aprobada por el usuario el 2026-09-06: cada par es una secuencia monotónica con
`aggregateType = ExchangeRate`, `aggregateId = BASE/QUOTE` y versión persistida. Cada
confirmación humana publica `ExchangeRateUpdated.v1` con el registro inmutable completo; una
sugerencia externa nunca se publica ni se aplica automáticamente.

El bootstrap entrega por par y en orden todas las tasas cuyo `validUntil` no haya terminado al
instante del corte. Esto incluye la tasa vigente, tasas futuras y ventanas anteriores todavía
aplicables según ADR-0014, pero excluye el histórico vencido. La terminal conserva las filas y
usa el mismo `GetCurrentExchangeRate`; no cierra ventanas ni inventa un TTL.

Criterios antes de continuar con concesiones:

- [x] ~~Confirmar una tasa asigna la siguiente versión del par y encola exactamente una publicación
  dentro de la misma transacción; consultar o descartar una sugerencia no publica nada.~~
- [x] ~~La terminal aplica cada versión una vez, conserva fuente y vigencia, y una versión igual o
  atrasada no cambia ni duplica su repositorio local.~~
- [x] ~~El bootstrap incluye tasas no vencidas en orden de par/versión, excluye el histórico vencido
  y no deja publicaciones parciales si se interrumpe antes del commit.~~
- [x] ~~Una terminal nueva selecciona con el repositorio real la misma tasa vigente del coordinador
  después del corte y no reenvía las tasas recibidas.~~

**Implementado el 2026-09-06:** la migración `0035` asigna una versión monotónica por par e
impide modificarla. `UpdateExchangeRate` publica `ExchangeRateUpdated.v1` en la transacción
que persiste la confirmación humana; las sugerencias continúan siendo solo lectura. La
proyección conserva cada fila inmutable, omite versiones atrasadas y el bootstrap ordena las
tasas no vencidas. La prueba LAN confirma que una terminal nueva obtiene la misma tasa vigente
que el coordinador, conserva la futura, excluye la vencida y no genera outbox local.

## Corte siguiente: concesiones de operador

Cierra la parte de D5/ADR-0026 que faltaba especificar. El coordinador es la autoridad de
autorización de la LAN: publica lo que cada operador **puede hacer**, con vencimiento, y la
terminal lo aplica. Las credenciales no viajan.

### Qué es una concesión y qué no

Una concesión transporta identidad de operador y su conjunto de autorización vigente. **No**
transporta PIN, hash de PIN, token, sesión ni ningún secreto: ADR-0026 lo prohíbe
explícitamente y la provisión local de credenciales sigue siendo controlada por nodo. Tampoco
sustituye la administración de usuarios y roles, que pertenece a 11.02.

Recibir una concesión no crea una sesión ni la renueva. Las sesiones conservan los 30 minutos
idle y las 8 horas absolutas de ADR-0011, que se aplican **además** de la vigencia de la
concesión y no se sustituyen por ella.

### `OperatorGrantPublished.v1`

| Campo | Tipo | Notas |
|---|---|---|
| `operatorCode` | `identifier` | código de operador normalizado en mayúsculas |
| `displayName` | `text` | nombre visible |
| `roleCodes` | `array` de `identifier` | conjunto vigente completo, ordenado |
| `permissionCodes` | `array` de `identifier` | conjunto vigente completo, ordenado |
| `isActive` | `enum ACTIVE \| INACTIVE` | una revocación es un cambio, no un borrado |
| `expiresAt` | `text` | instante UTC en que la concesión deja de servir |

- `aggregateType`: `OperatorGrant`; `aggregateId`: el `userId` del operador en el coordinador.
- Dirección `COORDINATOR_TO_TERMINAL`. Consumidor: `CATALOG_REFERENCE`, la misma ruta
  transaccional de referencias. Sin dependencias.
- El payload **no** repite el instante de emisión: es `occurredAt` del sobre, que ya es
  inmutable. `expiresAt` sí viaja explícito porque es la declaración de vigencia del
  coordinador, no un cálculo de la terminal.

### Vigencia, versión y renovación

`identity_users.authorization_version` no sirve como `aggregateVersion`: una renovación de la
misma autorización no la cambiaría y el consumidor descartaría la publicación por atrasada.
Por eso el coordinador lleva una **versión propia de concesión** por operador
(`identity_operator_grant_version`, migración `0036`), monotónica, que avanza en cada emisión
—incluida una renovación con el mismo conjunto de permisos— y que un trigger impide retroceder.

La vigencia es de ocho horas desde la emisión del coordinador, conforme D6. La terminal aplica
`expiresAt`, pero nunca acepta una ventana mayor que la política: si el coordinador declarase
un `expiresAt` posterior a `occurredAt + 8 h`, la terminal lo recorta a ese tope. Un
`expiresAt` que no sea posterior a `occurredAt` es una incompatibilidad permanente.

Reentregar una concesión **no** renueva nada: su `expiresAt` es parte del hecho inmutable.
Reiniciar la terminal o atrasar el reloj tampoco amplía la ventana, porque la comparación es
contra el instante declarado y no contra un contador local.

Mientras hay LAN, el coordinador reemite las concesiones al comenzar cada ciclo de entrega
cuando a la vigente le queda menos de la mitad de su ventana. Así una terminal conectada
siempre tiene concesión fresca y, al cortarse la LAN, conserva hasta ocho horas de operación.
Reemitir sin cambios sigue siendo una publicación nueva con versión nueva; no es un delta.

### Aplicación en la terminal

La proyección `identity_operator_grant` conserva, por `userId`: código, nombre, roles,
permisos, estado, versión, `expiresAt`, nodo emisor e instante de aplicación. Se aplica por
la misma ruta de referencias: no invoca casos de uso de administración, no escribe auditoría
de un actor humano y no encola nada en la salida local.

La concesión **gobierna cuando existe**. Un nodo standalone que nunca recibió concesiones
conserva su autorización local intacta, porque no hay coordinador que la emita; en cuanto el
coordinador publica la concesión de un operador, esa concesión pasa a ser la autoridad de sus
permisos en esa terminal. Concretamente:

- Autenticar: con concesión ausente se conserva el comportamiento local. Con concesión
  presente pero vencida o `INACTIVE` **no** se abre sesión, aunque el PIN sea correcto. El
  código de error es distinto del fallo de autenticación y solo se devuelve **después** de
  verificar el PIN, de modo que no revela la existencia de un operador.
- Autorizar una acción protegida: la concesión debe estar vigente y contener el permiso. Una
  concesión vencida deniega aunque la sesión siga viva, conforme D5.
- Verificar sesión: una concesión vencida o revocada invalida la sesión existente.

La revocación se aplica cuando el nodo la recibe. No se promete revocación global inmediata
durante un corte; ese límite es el que ya declara ADR-0026 y la UI lo muestra como antigüedad.

### Bootstrap

`PublishOperatorGrants` enumera los operadores del coordinador dentro de la transacción de
lectura y encola una publicación por operador con la versión siguiente y la vigencia calculada
desde el reloj del caso de uso. Incluye operadores inactivos como `INACTIVE`: una terminal que
nunca supo de un operador desactivado no puede aplicar su revocación. El corte inicial y la
renovación son el mismo caso de uso y el mismo contrato.

### Criterios antes de continuar con disponibilidad

- [x] ~~Emitir una concesión asigna la versión siguiente del operador y encola exactamente una
  publicación en la misma transacción; los permisos viajan sin credenciales.~~
- [x] ~~La terminal aplica la concesión, descarta una versión atrasada y recorta un `expiresAt`
  que exceda las ocho horas de la emisión.~~
- [x] ~~Una concesión vencida deniega sesión nueva y acción protegida aunque la sesión local
  siga dentro de sus límites de ADR-0011; atrasar el reloj no amplía la ventana.~~
- [x] ~~Una concesión `INACTIVE` deniega igual que una vencida y conserva la fila con su
  historia; el bootstrap incluye operadores activos e inactivos.~~

**Implementado el 2026-09-07:** migración `0036` con la versión monotónica de concesión por
operador y la proyección `identity_operator_grant`; `PublishOperatorGrants` como productor y
como renovación programada del worker; consumidor por la ruta de referencias; y aplicación de
la vigencia en autenticación, verificación de sesión y autorización. La vigencia se evalúa
contra el instante durable más alto observado por el nodo, de modo que atrasar el reloj del
equipo no amplía una concesión.

## Corte siguiente: disponibilidad informativa

Último elemento del conjunto cerrado. Es la única referencia que **no** es un maestro: es una
proyección de un saldo que cambia constantemente, y por eso su contrato declara de forma
explícita qué no promete.

### Qué promete y qué no

El stock autoritativo pertenece al coordinador (ADR-0026 D3). La terminal recibe el saldo
observado para poder informar al operador, y nada más:

- **No** se suma al saldo del coordinador ni a ningún otro nodo. Vive en una tabla propia de
  proyección, separada de `stock_items`, precisamente para que no exista la ruta que permitiría
  sumarlos por accidente.
- **No** reserva ni compromete existencias: dos terminales pueden vender la última unidad y esa
  situación se resuelve como discrepancia, conforme D4 y FS-005.
- **No** habilita ni bloquea la venta. Una venta offline sigue siendo válida.
- Se presenta siempre con su antigüedad. Sin publicación aplicada el dato es `null`, que
  significa **desconocido**, no cero.

### `StockAvailabilityPublished.v1`

| Campo | Tipo | Notas |
|---|---|---|
| `quantityScaled` | `integer >= 0` | saldo observado en el coordinador |
| `quantityScale` | `integer >= 0` | escala con la que se interpreta `quantityScaled` |

- `aggregateType`: `StockAvailability`; `aggregateId`: el `productId`, que es la identidad que
  la terminal ya conoce. `aggregateVersion` es el número de movimientos del ítem de stock en el
  coordinador más uno, que ya es monotónico por ítem y no necesita una columna nueva; el `+ 1`
  solo respeta que el sobre exige una versión positiva.
- Dependencia: `Product`. Un saldo de un producto que la terminal no conoce no es utilizable,
  así que espera a que su producto esté aplicado.
- Dirección `COORDINATOR_TO_TERMINAL`. Consumidor: `CATALOG_REFERENCE`.
- El payload no transporta código de unidad: la unidad pertenece al producto y duplicarla
  invitaría a que las dos copias se separaran, igual que en el vertical de catálogo.

### Productor

Cada caso de uso del coordinador que registra movimientos publica la disponibilidad de los
ítems que tocó, en la misma transacción que el cambio autoritativo: recepción de compra,
ajuste, aprobación de conteo y la aplicación del `SaleCompleted` recibido de una terminal. La
publicación se deriva del estado del ítem **después** de la mutación.

Un evento por ítem y por cambio; no se agrupa un saldo global de tienda ni se publica un
delta. Si el mismo ciclo produce dos cambios del mismo ítem, ambos se publican y la regla de
versión del consumidor deja vigente el último.

### Bootstrap

El corte inicial enumera los ítems de stock vigentes y publica el saldo de cada uno con su
versión actual, dentro de la misma transacción de lectura que el resto del corte. Un ítem sin
movimientos publica saldo cero con versión uno: es un saldo conocido, distinto de la ausencia
de publicación.

### Criterios de cierre del conjunto

- [x] ~~Recepción, ajuste, conteo aprobado y venta sincronizada publican exactamente una
  disponibilidad por ítem afectado, en la transacción del cambio.~~
- [x] ~~La terminal proyecta el saldo en una tabla propia, con su versión y antigüedad; una
  publicación atrasada no lo retrocede y una reentrega no lo duplica.~~
- [x] ~~La proyección no altera `stock_items` ni participa en ningún saldo local, y una
  disponibilidad nunca impide completar una venta offline.~~
- [x] ~~El bootstrap publica el saldo de todos los ítems, incluido el saldo cero con versión uno, y una
  interrupción antes del commit no deja un corte parcial.~~

**Implementado el 2026-09-07:** contrato con dependencia de `Product`, productor en los cuatro
caminos de movimiento del coordinador —recepción, ajuste, conteo aprobado y venta
sincronizada—, proyección `stock_availability_reference` con versión y antigüedad, y bootstrap
incluido en el corte inicial. Con esto el conjunto cerrado del corte 0 queda completo.

## Costo conocido al vender

Cierra D4 de ADR-0026. El costo es lo único del stock que la venta necesita congelar, y
viaja por dos piezas: la disponibilidad lo publica y `SaleCompleted.v2` lo devuelve.

### Quién publica el costo

`StockAvailabilityPublished.v1` transporta, junto al saldo, un `unitCost` de tipo `money`
**anulable**. Es el promedio ponderado vigente del ítem en el coordinador. `null` significa
costo desconocido —sin saldo, sin moneda de valuación o sin costos históricos— y nunca cero.

La procedencia del snapshot no necesita campos nuevos: es `originNodeId` del sobre, su versión
es `aggregateVersion` y su fecha es `occurredAt`. La terminal proyecta esos tres junto al
costo, de modo que puede devolverlos intactos al vender.

### Cuándo se congela

Al **agregar la línea**, en el mismo instante y por la misma razón que el precio y el
impuesto: `ProductSnapshot` gana un `costSnapshot` anulable. Una compra posterior del
coordinador no revaloriza esa línea, ni siquiera si llega antes de aplicar la salida.

El costo procede de la proyección de disponibilidad; en un nodo standalone, del promedio
ponderado de su propio inventario, con ese nodo como procedencia. Nunca llega desde el
renderer: el caso de uso lo obtiene de su propio nodo y el contrato HTTP no lo acepta.

### `SaleCompleted.v2`

La v1 **permanece intacta y válida**, con sus fixtures, y el catálogo pasa a indexarse por
`(eventType, contractVersion)`: un emisor que todavía publique v1 sigue siendo aceptado y sus
líneas se aplican con costo desconocido. Un tipo conocido en una versión que el receptor no
publica se rechaza como versión incompatible, no como tipo desconocido.

La v2 añade a cada línea `costSnapshot`, un objeto anulable con `unitCost`, `version`,
`source` y `observedAt`.

### Qué valida el receptor

El coordinador acepta el costo transportado **solo si su `source` es el nodo que reconoce
como autoridad de costo**, que es él mismo: un snapshot con otra procedencia se ignora y la
salida queda con costo desconocido, visible como tal. La venta sigue siendo válida en ambos
casos; el costo no es una condición de aplicación.

No se completa una salida antigua con el promedio del momento de recepción, no se convierte
un costo ausente en cero y no se revaloriza ninguna salida histórica.

### Criterios

- [x] ~~La terminal congela el costo publicado por su coordinador, con versión, procedencia y
  fecha; sin disponibilidad publicada usa su promedio local y sin evidencia queda en `null`.~~
- [x] ~~El coordinador aplica el costo recibido y no su promedio vigente, aunque haya comprado
  más caro entre la venta y su recepción.~~
- [x] ~~Un costo con procedencia ajena no se acepta y no se sustituye por el promedio local.~~
- [x] ~~Un hecho `SaleCompleted.v1` sigue siendo aceptado y se aplica con costo desconocido.~~

**Implementado el 2026-09-07:** migración `0037` con el snapshot por línea de venta y el costo
en la disponibilidad proyectada; `ProductSnapshot` congela el costo al agregar la línea;
`SaleCompleted.v2` lo transporta y la v1 permanece intacta y aceptada; el receptor solo acepta
un costo cuya procedencia es su autoridad de costo.

## Consumidores de ventas, caja y fiscalidad en el coordinador

Último consumidor pendiente del corte 3. Los ocho contratos restantes tenían custodia sin
aplicación: sus hechos quedaban recibidos y explícitamente **no** aplicados.

### Qué hace y qué no

El coordinador consolida para **leer**. No importa los agregados operativos de la terminal ni
vuelve a ejecutar sus efectos:

- **No** invoca `CompleteSale`, `ReturnSale`, apertura o cierre de turno, ni la impresora. Un
  hecho remoto nunca emite ni reimprime un documento fiscal.
- **No** escribe en `sales`, `shifts`, `cash_movements` ni `fiscal_documents`: esas tablas son
  de los agregados que el coordinador posee, y mezclarlas duplicaría totales.
- **No** crea la caja ni el turno de la terminal en el coordinador: la autoridad de esos
  agregados sigue siendo la terminal, conforme ADR-0026 D3.

Escribe cuatro proyecciones propias, con el prefijo `sync_`, que existen solo para consultar
lo que ocurrió en las terminales.

### Contratos y proyecciones

| Contrato | Proyección | Identidad |
|---|---|---|
| `SaleCompleted.v1` y `.v2` | `sync_sale_projection` | `saleId` |
| `SaleReturned.v1` | marca la devolución sobre la venta proyectada | `saleId` |
| `ShiftOpened.v1`, `ShiftClosed.v1` | `sync_shift_projection` | `shiftId` |
| `CashMovementRegistered.v1` | `sync_cash_movement_projection` | `movementId` |
| `FiscalDocumentIssued.v1`, `FiscalDocumentFailed.v1` | `sync_fiscal_projection` | `documentId` |
| `FiscalXReportIssued.v1`, `FiscalZReportIssued.v1` | `sync_fiscal_projection` | `reportId` |

Cada fila conserva la terminal y el nodo de origen del hecho: la consolidación no mezcla lo
que hizo cada terminal, y el coordinador no aparece como autor de una venta ajena.

`SaleReturned` declara `Sale` como dependencia, así que una devolución que llegue antes que su
venta espera a que esté aplicada en lugar de crear una venta fantasma.

### Idempotencia

Cada proyección es un upsert por la identidad del agregado, condicionado a que el hecho sea
posterior: una reentrega no duplica filas ni totales, y un hecho atrasado no retrocede la
proyección. La marca de devolución no borra la venta ni cambia sus totales originales.

Una representación fiscal proyectada conserva su rótulo `SIMULACION`, como el original.

### Criterios

- [x] ~~Los ocho contratos declaran consumidor implementado y su hecho pasa a `APPLIED`.~~
- [x] ~~Reentregar cualquiera de ellos no duplica filas ni totales de la proyección.~~
- [x] ~~Una devolución entregada antes que su venta espera y se aplica al resolverse.~~
- [x] ~~El coordinador no escribe `sales`, `shifts`, `cash_movements` ni `fiscal_documents` al
  aplicar un hecho remoto, y no emite ni reimprime ningún documento fiscal.~~

**Implementado el 2026-09-07:** migración `0039` con las cuatro proyecciones `sync_*`,
consumidor `COMMERCIAL_PROJECTION` compuesto en el coordinador y pruebas de idempotencia,
dependencia y aislamiento respecto de las tablas operativas.

Dos correcciones aparecieron al darles consumidor y quedan registradas aquí porque cambian
una decisión previa:

- `CashMovementRegistered` **deja de declarar `Sale` como dependencia**. Un movimiento de caja
  es un hecho del turno que referencia una venta, y la venta depende de ese mismo turno:
  declararlo creaba un ciclo en el que ambos esperaban indefinidamente. La referencia sigue
  viajando en el payload y se proyecta tal cual.
- Un cierre de turno que llega antes que su apertura **ya no se descarta en silencio**: informa
  que falta la apertura y espera, en lugar de darse por proyectado y perder el cierre.
