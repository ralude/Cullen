# 10.03, corte 0: distribución de referencias operativas

- Fecha: 2026-09-06.
- Estado: **especificación aprobada e implementada el 2026-09-06** en cinco pasos.
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
