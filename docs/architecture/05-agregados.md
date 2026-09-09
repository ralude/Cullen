# 05. Agregados

Un agregado es una frontera de consistencia. Solo su raíz se carga y modifica desde fuera. Las transacciones que cambian invariantes deben quedar dentro de esa frontera.

## Agregados previstos

| Agregado raíz | Responsabilidad | Invariantes principales |
|---|---|---|
| `Sale` | Venta, líneas y pagos | total consistente; no completar sin pago suficiente; estado válido |
| `FiscalDocument` | Documento fiscal y líneas | inmutable una vez emitido; corrección por nota fiscal |
| `Product` | Producto, códigos, precio vigente e historial de precios | barcode activo único; unidad válida; precio no negativo; cambios de precio append-only |
| `StockItem` | Stock, lotes y movimientos | saldo derivado; stock y saldo por lote no negativos |
| `Shift` | Turno y movimientos de caja | un turno abierto por caja; arqueo trazable |
| `PurchaseOrder` | Orden y recepción | recepción acumulada no supera cantidad ordenada |
| `Supplier` | Identidad y estado del proveedor | identidad fiscal única; código inmutable; sin borrado histórico |
| `PurchaseReceipt` | Evidencia de compra recibida | snapshot, líneas, cantidades y costos inmutables al completar |
| `User` | Identidad y concesiones | roles activos, asignables y sin duplicados; sin credenciales en Fase 2 |

El agregado `Product` contiene barcodes, precio vigente e historial append-only.
Los códigos activos también se comprueban globalmente mediante el puerto del
repositorio antes de guardar; la restricción transaccional definitiva pertenece
a la persistencia de Fase 3. `Category` y `UnitOfMeasure` se validan como
configuración externa del agregado, mientras el producto conserva la referencia
de categoría y el código/escala de unidad usados por su snapshot.

## Agregado `Sale`

Es la frontera principal del MVP. Contiene líneas con snapshot de descripción, precio, impuesto y cantidad, además de pagos registrados.

Debe garantizar:

- total de líneas, descuentos, impuestos e IGTF calculado de forma determinista;
- precio de snapshot neto de IVA; descuento porcentual por línea antes del IVA y redondeo por línea;
- pago mixto con monedas y métodos permitidos;
- lote de pagos exacto, con tasa explícita y snapshot del método cuando corresponda;
- transición ordenada de `DRAFT` a `COMPLETED`;
- no modificar una venta completada;
- anulación únicamente de `DRAFT`, con autorización y motivo;
- emisión de eventos solo por hechos válidos.

El IGTF no se codifica como una constante del agregado: la aplicación recibe una
política versionada que determina elegibilidad y tasa. La base es la **porción
comercial que el método gravado salda**, no el importe entregado: el impuesto
viaja dentro de ese importe y se separa de él, según
[ADR-0031](./adr/0031-base-del-igtf-en-pagos-mixtos.md). Registrar el lote de
pagos congela líneas y descuentos.

## Agregado `Shift`

`Shift` es la raíz del ciclo de caja. `CashRegister` representa la caja
configurada y `CashMovement` pertenece al turno. El agregado garantiza:

- ownership único por terminal y nodo;
- estado `OPEN` o `CLOSED` y ausencia de movimientos después del cierre;
- fondos iniciales, ingresos y retiros manuales como movimientos inmutables;
- montos positivos, motivo y actor obligatorios;
- retiros que no superan el saldo de su moneda y método;
- balances independientes por moneda y método, sin conversiones implícitas;
- arqueo con snapshots de esperado, declarado y diferencia;
- eventos versionados `ShiftOpened`, `CashMovementRegistered` y `ShiftClosed`.

En Fase 2, la regla de un turno abierto por caja se consulta mediante
`ShiftRepository`. La restricción transaccional se añade con SQLite. Los
movimientos derivados de ventas, auditoría y autorización de diferencias
pertenecen a la Fase 5.

## Agregado `User`

`User` conserva roles configurables y deriva sus permisos efectivos sin copiar
concesiones. Un usuario inactivo, un rol inactivo o un permiso inactivo siempre
deniega la operación. Solo se asignan roles y permisos marcados como
asignables, y no se permiten duplicados por identidad o código. Contraseñas,
PIN, tokens, sesiones y cifrado pertenecen a la Fase 11.

## Agregado `StockItem`

`StockItem` inicia con saldo cero y solo cambia mediante movimientos
append-only. Cada movimiento usa la escala configurada del producto, conserva
actor, motivo, referencia y timestamp, y deriva la dirección de uno de estos
tipos: recepción de compra, salida de venta, merma, ajuste positivo o ajuste
negativo. Las salidas nunca pueden dejar saldo negativo.

Cuando `tracksBatches` está activo, todo movimiento exige un lote registrado y
la disponibilidad se valida por lote. Sin esa marca, no se aceptan lotes. La
selección FEFO, el consumo idempotente de ventas, el kardex y la reconciliación
offline pertenecen a la Fase 6.

El artículo se crea en la primera recepción del producto: la aplicación genera
su ID y toma unidad y escala del producto del catálogo; un producto que el
catálogo no conoce no puede recibirse. Una vez creado, el artículo conserva esa
configuración aunque el catálogo cambie después, porque su historia de
movimientos ya está escrita en esa escala. `tracksBatches` se fija en esa
primera recepción según traiga lote o no: el catálogo todavía no modela ese
atributo y esta sub-fase no lo inventa; queda declarado como brecha para la
configuración de datos maestros de 9B.10.

## Agregado `StockCount`

`StockCount` (9B.07) es una raíz separada del módulo `inventory`, distinta de
`StockItem`: documenta el conteo físico y sus líneas contadas, pero no muta
existencia por sí misma. Su ciclo de vida es `OPEN -> COUNTED -> APPROVED` o
`OPEN -> COUNTED -> REJECTED`; un conteo `APPROVED` o `REJECTED` es inmutable.

Mientras está `OPEN`, cada línea registrada reemplaza en memoria a la anterior
del mismo artículo/lote — es estado de borrador, no evidencia cerrada, y así lo
refleja la persistencia: solo entonces se resincroniza físicamente la tabla de
líneas. Al cerrar, la aplicación calcula la diferencia de cada línea contra el
saldo vigente del `StockItem` correspondiente (`balance` o `balanceForBatch`
según trackee lotes) y el dominio **congela** esas diferencias — no se
recalculan después contra el saldo del momento de aprobar. Esa evidencia
congelada nunca se borra ni se reescribe.

Aprobar un conteo cerrado coordina ambas raíces por puertos dentro de una sola
`UnitOfWork`: por cada línea con diferencia distinta de cero se registra un
movimiento `ADJUSTMENT_IN` o `ADJUSTMENT_OUT` sobre el `StockItem`
correspondiente, referenciando el conteo; o se aprueba todo el conteo con sus
ajustes, o no se confirma nada. Rechazar un conteo cerrado no produce ningún
efecto de inventario.

El alcance del conteo es exactamente la lista de líneas registradas: un
producto no incluido no se toca ni se interpreta como saldo cero. Registrar
una línea es una acción rutinaria de alta frecuencia y no exige motivo, igual
que agregar un artículo a una venta; abrir, cerrar, aprobar y rechazar sí lo
exigen, por ser transiciones de estado del documento.

## Agregado `Supplier`

`Supplier` es una raíz del módulo `purchasing`. Su ID técnico y código humano
son inmutables; la identidad fiscal no funciona como clave primaria y es única
por país, tipo y valor normalizado. Solo `ACTIVE` participa en operaciones
nuevas. `BLOCKED` e `INACTIVE` permanecen consultables, y no existe borrado
físico de historia. Los cambios sensibles y la corrección privilegiada de
identidad se auditan conforme ADR-0019.

La identidad fiscal admite `RIF` en Venezuela —una letra soportada seguida de
nueve dígitos, sin checksum mientras no exista fuente oficial verificable— y la
identidad genérica `TAX_ID` en el resto de los países, sin validadores
específicos. Los estados se distinguen: `BLOCKED` es una suspensión temporal
reversible y `INACTIVE` una relación retirada que sale de los selectores
operativos; ambos conservan la historia y toda operación con efectos durables
revalida `ACTIVE` dentro de su transacción. La dirección fiscal es opcional en el
maestro, se guarda como país más línea y nunca se persiste a medias; la regla que
la exige antes de completar una recepción venezolana con factura o guía de
despacho se implementa con `PurchaseReceipt` en 9B.04.

`PurchaseReceipt` será una raíz separada cuando 9B.04 incorpore costo. El caso de
uso coordinará su confirmación con el movimiento de `StockItem` mediante puertos
y una sola unidad de trabajo; no se crea en 9B.03 una recepción completada sin
costo.

## Agregados `Branch` y `Device`

`Branch` (9B.11) es un maestro simple: código humano inmutable elegido por el
administrador, nombre editable y estado `ACTIVE`/`INACTIVE` sin borrado físico,
con el mismo patrón de auditoría que `Supplier`. Es dato maestro y etiqueta de
pertenencia — no decide autoridad de escritura, no enruta operaciones y no
participa en ninguna resolución de conflictos, que siguen siendo de Fase 10.

`Device` (9B.11) es raíz independiente que declara un aparato asignado a una
estación (`terminalId`), con tipo inmutable de una lista cerrada
(`FISCAL_PRINTER`, `BARCODE_SCANNER`, `SCALE`, `CASH_DRAWER`), identificador
editable y estado propio. Puede etiquetar opcionalmente una `branchId`, que se
puede reasignar o retirar mediante `update`. Declarar un dispositivo, incluida
una impresora fiscal, es inventario administrativo puro: no habilita ninguna
capacidad real ni cambia el modo fiscal que expone `capabilities`.

**Decisión de alcance deliberadamente no tomada aquí:** la relación entre un
nodo y su sucursal (si un nodo pertenece a exactamente una sucursal o si una
sucursal agrupa varios nodos) no está definida. `Device.branchId` es una
etiqueta opcional por dispositivo, no una declaración de topología del nodo;
extenderla a "la estación declara su sucursal" exige esa decisión, ausente del
plan de 9B.11 y no inventada aquí.

## Agregado `FiscalDocument`

Su estado de impresión se persiste por separado del contenido inmutable del documento. Un error de comunicación no debe crear silenciosamente un segundo documento.

## Consistencia entre agregados

Una venta no debe modificar directamente el agregado `Shift` o `StockItem`. El caso de uso coordina transacciones y eventos según la política definida. Si el flujo requiere atomicidad multiagregado, se debe documentar como una decisión específica y probarla con SQLite.

## Ownership entre nodos

Cada agregado tiene un único nodo con autoridad de escritura. Una venta, turno o documento fiscal pertenece a su terminal de origen; otro nodo solo consume sus eventos o proyecciones. Catálogo y configuración se originan en el coordinador de tienda. La matriz completa y la política de inventario offline están en [12. Sincronización y ownership](./12-sincronizacion-y-ownership.md).

## Fase 0

No se implementan agregados funcionales. Se fijan sus límites para evitar que la primera implementación convierta las tablas en el modelo de dominio.
