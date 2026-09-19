# Anexo técnico

Este anexo **no es para el operador**. Es para quien administra la estación y necesita traducir lo
que una persona vio en pantalla a lo que el sistema registró.

Los capítulos del manual enlazan acá, pero ninguno depende de este anexo para resolverse: si la
respuesta solo está acá, el capítulo está incompleto.

---

## 1 · Qué vio el operador, qué registró el sistema

Correspondencia entre el mensaje en pantalla y el código que queda en los registros del nodo.

### Venta y cobro

| Lo que se lee en pantalla | Código |
|---|---|
| La venta ya no está disponible. | `SALE_NOT_FOUND` |
| El pago no coincide con el total de la venta. | `SALE_PAYMENT_TOTAL_MISMATCH` |
| La venta no puede modificarse en este estado. | `SALE_INVALID_STATE` |
| El método de pago no está habilitado. | `PAYMENT_METHOD_NOT_FOUND` |
| No encontramos ese producto. | `PRODUCT_NOT_FOUND` |

### Caja

| Lo que se lee en pantalla | Código |
|---|---|
| No hay un turno abierto para esta caja. | `SHIFT_NOT_FOUND` |
| La caja ya tiene un turno abierto. | `SHIFT_ALREADY_OPEN` |
| El turno no puede modificarse en este estado. | `SHIFT_INVALID_STATE` |
| La caja conserva ventas sin cerrar: cóbralas o anúlalas antes del arqueo. | `SHIFT_HAS_OPEN_SALES` |
| Cerrar un turno descuadrado sin la autorización para hacerlo | `FORBIDDEN` |

**Sobre esa última:** el cierre exige `cash.shift.close.difference` cuando lo declarado no
coincide con lo esperado en algún método, **y también cuando algún saldo esperado es negativo**.
El operador solo lee *No tienes autorización para esta operación* y no tiene cómo saber que el
motivo es la diferencia. Un saldo esperado negativo exige además un motivo explícito
(`SHIFT_NEGATIVE_EXPECTED_REASON_REQUIRED`).

### Inventario

| Lo que se lee en pantalla | Código |
|---|---|
| No encontramos el artículo de inventario. | `STOCK_ITEM_NOT_FOUND` |
| La existencia no alcanza para este ajuste. | `STOCK_INSUFFICIENT_BALANCE` |
| Escribe la cantidad como un número positivo. | `QUANTITY_INVALID_TEXT` |
| La cantidad tiene más decimales de los que admite la unidad. | `QUANTITY_SCALE_EXCEEDED` |
| Este artículo maneja lotes: indica el lote recibido. | `STOCK_BATCH_REQUIRED` |
| Este artículo no maneja lotes. | `STOCK_BATCH_NOT_ACCEPTED` |
| No encontramos ese lote en el artículo. | `STOCK_BATCH_NOT_FOUND` |

### Conteos

| Lo que se lee en pantalla | Código |
|---|---|
| No encontramos el conteo seleccionado. | `STOCK_COUNT_NOT_FOUND` |
| El conteo ya no admite nuevas líneas. | `STOCK_COUNT_NOT_OPEN` |
| El conteo debe estar cerrado antes de aprobarlo o rechazarlo. | `STOCK_COUNT_NOT_COUNTED` |
| Registra al menos una línea antes de cerrar el conteo. | `STOCK_COUNT_EMPTY` |
| La cantidad contada no puede ser negativa. | `STOCK_COUNT_LINE_QUANTITY_INVALID` |
| El rechazo exige un motivo. | `STOCK_COUNT_REJECTION_REASON_REQUIRED` |

### Proveedores

| Lo que se lee en pantalla | Código |
|---|---|
| No encontramos el proveedor seleccionado. | `SUPPLIER_NOT_FOUND` |
| El proveedor seleccionado no está activo para nuevas recepciones. | `SUPPLIER_NOT_ACTIVE` |
| Ya existe un proveedor con esa identificación fiscal. | `SUPPLIER_TAX_IDENTITY_CONFLICT` |
| La identificación fiscal no tiene un formato válido. | `SUPPLIER_TAX_IDENTITY_INVALID` |
| La identificación fiscal es obligatoria. | `SUPPLIER_TAX_IDENTITY_REQUIRED` |
| El país de la identificación fiscal no es válido. | `SUPPLIER_TAX_COUNTRY_INVALID` |
| El tipo de identificación fiscal no es válido. | `SUPPLIER_TAX_TYPE_INVALID` |
| La razón social del proveedor es obligatoria. | `SUPPLIER_LEGAL_NAME_REQUIRED` |
| No hay cambios que guardar en este proveedor. | `SUPPLIER_UPDATE_REQUIRED` |
| La corrección fiscal exige un motivo. | `SUPPLIER_CORRECTION_REASON_REQUIRED` |

### Identidad y acceso

| Lo que se lee en pantalla | Código |
|---|---|
| No tienes autorización para esta operación. | `FORBIDDEN` |
| La administración de identidad pertenece al coordinador de la tienda. | `IDENTITY_NOT_OWNED_BY_NODE` |
| El cambio dejaría al sistema sin ningún administrador activo. | `IDENTITY_LAST_ADMINISTRATOR` |
| No encontramos ese operador en este nodo. | `IDENTITY_OPERATOR_NOT_FOUND` |
| Ya existe un operador con ese código. | `IDENTITY_OPERATOR_CODE_TAKEN` |
| No encontramos el rol seleccionado. | `IDENTITY_ROLE_NOT_FOUND` |
| Ya existe un rol con ese código. | `IDENTITY_ROLE_CODE_TAKEN` |
| Ese permiso no existe en este nodo. | `IDENTITY_PERMISSION_UNKNOWN` |
| Revisa los datos: el motivo es obligatorio. | `IDENTITY_INPUT_INVALID` |
| Ese operador no tiene credencial en esta terminal. | `IDENTITY_CREDENTIAL_NOT_FOUND` |
| El código de enrolamiento no es válido. | `IDENTITY_ENROLLMENT_NOT_FOUND` |
| El código de enrolamiento venció: pide uno nuevo. | `IDENTITY_ENROLLMENT_EXPIRED` |
| Ese código ya se usó: pide uno nuevo. | `IDENTITY_ENROLLMENT_CONSUMED` |
| Ese código pertenece a otra terminal. | `IDENTITY_ENROLLMENT_NODE_MISMATCH` |
| Ese rol no se puede asignar mientras esté inactivo. | `USER_ROLE_NOT_ASSIGNABLE` |
| El nombre visible del operador es obligatorio. | `USER_DISPLAY_NAME_REQUIRED` |
| El código del rol no tiene un formato válido. | `ROLE_INVALID_CODE` |
| El nombre del rol es obligatorio. | `ROLE_NAME_REQUIRED` |
| El PIN debe tener entre 6 y 12 dígitos. | `AUTH_PIN_POLICY_VIOLATION` |
| Tu credencial está caducada: cambia tu PIN para continuar. | `AUTH_PIN_CHANGE_REQUIRED` |
| El PIN actual no es correcto. | `AUTHENTICATION_FAILED` |

### Configuración, tasas y fiscal

| Lo que se lee en pantalla | Código |
|---|---|
| No encontramos la sucursal seleccionada. | `BRANCH_NOT_FOUND` |
| El código de sucursal no es válido. | `BRANCH_CODE_INVALID` |
| Ya existe una sucursal con ese código. | `BRANCH_CODE_CONFLICT` |
| No hay cambios que guardar en esta sucursal. | `BRANCH_UPDATE_REQUIRED` |
| No encontramos el dispositivo seleccionado. | `DEVICE_NOT_FOUND` |
| El tipo de dispositivo no es válido. | `DEVICE_TYPE_INVALID` |
| El identificador del dispositivo es obligatorio. | `DEVICE_IDENTIFIER_REQUIRED` |
| No hay cambios que guardar en este dispositivo. | `DEVICE_UPDATE_REQUIRED` |
| El reporte fiscal simulado falló; revisa su estado. | `FISCAL_REPORT_FAILED` |
| No hay conexión con el nodo local. | `NETWORK_UNAVAILABLE` |
| No hay una tasa vigente registrada para ese par. | `CURRENCY_RATE_MISSING` |
| El límite de filas del histórico no es válido. | `CURRENCY_HISTORY_LIMIT_INVALID` |
| La moneda base y la cotizada deben ser distintas. | `EXCHANGE_RATE_INVALID_PAIR` |
| El código de moneda debe tener tres letras mayúsculas. | `EXCHANGE_RATE_INVALID_CURRENCY` |
| El valor de la tasa no es un entero positivo válido. | `EXCHANGE_RATE_INVALID_VALUE` |
| La escala de la tasa debe estar entre 0 y 8. | `EXCHANGE_RATE_INVALID_SCALE` |
| La fuente de la tasa es obligatoria. | `EXCHANGE_RATE_SOURCE_REQUIRED` |
| La vigencia hasta debe ser posterior a la vigencia desde. | `EXCHANGE_RATE_INVALID_VALIDITY` |

### Mensajes que no vienen del nodo

La pantalla valida algunas entradas antes de enviarlas. Estos avisos no llevan código de
seguimiento porque no hubo petición: nacen y mueren en la terminal.

| Lo que se lee en pantalla | Origen |
|---|---|
| La cantidad de decimales supera la escala configurada. | `MONEY_INPUT_SCALE` — la cantidad escrita excede la escala de la unidad del producto, o el importe la de la moneda |
| Escribe un valor decimal positivo con hasta 8 decimales. | `RATE_INPUT_INVALID` |
| Abre o selecciona un turno desde Caja antes de iniciar la venta. | `SHIFT_REQUIRED` |
| No pudimos completar la operación. Intenta nuevamente. | Cualquier otro fallo que no sea una respuesta del nodo |

### ⚠️ Cuando el operador ve un mensaje genérico

**«La operación no pudo completarse.»** es lo que la interfaz muestra cuando el nodo devuelve un
código para el que no tiene una frase propia. El operador no puede distinguir estos casos entre
sí: **el código de seguimiento del aviso es la única forma de identificarlos**.

Casos conocidos que caen acá y que un operador sí encuentra haciendo su trabajo:

| Situación real | Código que el nodo devuelve |
|---|---|
| Falta configurar la política de cobro y por eso no se puede completar la venta | `POLICY_NOT_CONFIGURED` |
| La estación no tiene su caja declarada | `CASH_REGISTER_NOT_FOUND` |
| El descuento de línea supera el tope configurado | `SALE_DISCOUNT_EXCEEDS_LIMIT` |
| La venta ya fue devuelta | `SALE_ALREADY_RETURNED` |
| Reintento con una clave de idempotencia distinta a la original | `IDEMPOTENCY_KEY_CONFLICT` |
| Se intentó escribir sobre un agregado de otro nodo | `AGGREGATE_OWNER_MISMATCH` |

Está registrado como hallazgo de 12B en
[`12b.09-cuando-algo-falla.md`](../../cronograma/fase-12b-manual-usuario/12b.09-cuando-algo-falla.md).
El manual no lo disimula: el [capítulo 6](./06-cuando-algo-falla.md#lo-que-el-manual-no-puede-resolver)
se lo dice al operador.

### Lo que el operador no ve: la venta que no pudo salir del inventario

Completar una venta asienta el cobro y descuenta la existencia **en la misma transacción**. Si esa
salida se rechaza por negocio —el producto no tiene artículo de inventario, o el saldo no
alcanza—, **la venta se conserva completada** y el rechazo queda auditado como
`SALE_STOCK_ISSUE_REJECTED`, con el código del error en `after.errorCode`. La pantalla no dice
nada: el cajero cobró y siguió.

Una falla de infraestructura sí propaga y revierte la transacción completa, según
[FS-004](../../failure-scenarios/FS-004-sqlite-busy-concurrency-conflict.md). El caso de la última
unidad vendida a la vez en dos cajas está en
[FS-005](../../failure-scenarios/FS-005-venta-concurrente-ultima-unidad.md).

**Cómo encontrarlos:** en **Reportes → Auditoría**, por su acción. El
[capítulo 2](./02-caja.md#qué-ocurre-al-completar) le dice al cajero que avise a depósito.

---

## 2 · Los tipos de movimiento del kardex

La tabla de movimientos de **Inventario** imprime estos valores **sin traducir**, y el operador
los ve tal cual. El [capítulo 3](./03-inventario.md#ver-el-movimiento-de-un-producto) los traduce
en el cuerpo porque no hay otra forma de que se entiendan.

| `type` | `direction` | Qué lo produce |
|---|---|---|
| `PURCHASE_RECEIPT` | `IN` | Recepción de compra, con o sin documento de origen |
| `SALE_ISSUE` | `OUT` | Venta completada en este nodo |
| `WASTE` | `OUT` | Merma registrada con motivo y referencia |
| `ADJUSTMENT_IN` | `IN` | Ajuste de entrada, aprobación de conteo con sobrante o reposición por devolución |
| `ADJUSTMENT_OUT` | `OUT` | Ajuste de salida o aprobación de conteo con faltante |

**Está registrado como hallazgo de interfaz:** la pantalla muestra identificadores internos a un
operador. Corregirlo pertenece a la fase dueña de la pantalla de inventario, no a 12B.

---

## 3 · El código de seguimiento

Cada respuesta de error del nodo lleva un identificador de correlación. En pantalla vive dentro
del aviso, en el desplegable **Código de seguimiento**.

Con él se encuentra la operación exacta en los registros técnicos del nodo. **No lo pidas por un
canal donde también viajen capturas con datos de clientes**: basta el código.

---

## 4 · Permisos y qué habilita cada uno

Los permisos son datos del sistema, no una lista fija del programa: la pantalla **Identidad →
Roles** muestra los que existen en ese nodo. Estos son los que la interfaz consulta hoy.

**El cuerpo del manual no nombra ninguno.** Describe la capacidad y remite a quien administra.

| Código | Qué habilita |
|---|---|
| `cash.shift.open` · `cash.shift.close` | Abrir y cerrar el turno de una caja |
| `cash.shift.close.difference` | Cerrar un turno cuyo arqueo no cuadra, o con un esperado negativo |
| `cash.shift.read` | Consultar el turno |
| `cash.movement.income` · `cash.movement.withdrawal` | Registrar ingresos y retiros de efectivo |
| `sale.apply_discount` | Aplicar un descuento de línea |
| `sale.void` | Anular una venta |
| `sale.return` | Devolver una venta completa |
| `sale.history.read` | Revisar la historia de una venta |
| `catalog.product.create` · `catalog.product.update` | Crear y modificar productos |
| `catalog.price.update` | Cambiar precios |
| `inventory.kardex.read` | Consultar existencia y movimientos |
| `inventory.purchase.receive` | Registrar una recepción simple |
| `inventory.adjust` · `inventory.waste.register` | Ajustar existencia y registrar merma |
| `inventory.count.perform` · `inventory.count.read` | Contar y consultar conteos |
| `inventory.count.approve` | Aprobar o rechazar un conteo |
| `purchase_receipt.start` · `purchase_receipt.complete` | Recepción documentada con costo |
| `purchase_receipt.read` · `purchase_receipt.reverse` | Consultar y reversar recepciones |
| `supplier.read` · `supplier.create` · `supplier.update` | Maestro de proveedores |
| `supplier.tax_identity.correct` | Corregir una identidad fiscal ya cargada |
| `config.cash_register.manage` | Crear las cajas de la terminal |
| `config.payment_method.manage` | Administrar métodos de pago |
| `config.tax.manage` | Políticas de descuento e IGTF |
| `config.branch.manage` · `config.device.manage` | Sucursales y dispositivos |
| `currency.rate.update` | Registrar una tasa de cambio |
| `fiscal.document.issue` | Emitir facturas y reportes X/Z simulados |
| `fiscal.reconcile` | Reconciliar una operación fiscal incierta |
| `identity.user.manage` · `identity.role.manage` | Operadores y roles |
| `identity.credential.reset` | Autorizar un enrolamiento nuevo |
| `reports.cash.read` · `reports.sales.read` · `reports.margin.read` · `reports.inventory.read` · `reports.audit.read` · `reports.fiscal.read` | Cada sección de Reportes, por separado |
| `sync.reception.review` | Revisar lo que llega de otros nodos |
| `sync.delivery.resume` | Reanudar una entrega agotada |
| `sync.discrepancy.resolve` | Resolver una discrepancia |
| `sync.node.manage` · `sync.reference.publish` | Administrar nodos y publicar referencias |

**Ocultar una pantalla no autoriza nada.** La navegación decide qué ofrecer; el nodo vuelve a
exigir el permiso en cada intento.

---

## 5 · Qué configurar para que una tarea sea posible

Cuando un operador no puede hacer algo, suele faltar una de estas:

| El operador no puede… | Configurar en |
|---|---|
| Abrir su turno | **Config. → Cajas de esta terminal**, en *esa* estación |
| Cobrar | **Config. → Métodos de pago** |
| Completar la venta | **Config. → Descuento máximo** e **IGTF** |
| Crear productos | **Config. → Categorías** y **Unidades** |
| Cobrar en otra moneda | **Tasas**, con una tasa vigente para el par |
| Pedir un reporte X o Z simulado | Arrancar la estación con `FISCAL_EXECUTION_TARGET=SIMULATOR` y `FISCAL_SIMULATED_REPORT_CONSENT=ALLOW_SIMULATED_X_AND_Z`; sin eso la sección no se renderiza |
| Entrar por primera vez | **Identidad → Enrolamiento de credencial** |
| Ver una pantalla | **Identidad → Roles**, agregando el permiso al rol |

---

## 6 · Runbooks

Lo que no se resuelve desde la interfaz:

- [Instalación de una estación](../instalacion-estacion.md)
- [Respaldo operativo](../respaldo-operativo.md)
- [Emisión de material LAN](../emision-material-lan.md)
- [Rotación de material protegido](../rotacion-material-protegido.md)
- [Pipeline de verificación](../pipeline-de-verificacion.md)
