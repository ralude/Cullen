# Operación diaria

Recorrido de una jornada completa en una terminal Cullen: abrir la caja, vender, cobrar,
facturar, cerrar con arqueo y leer el inventario. Está escrito para quien opera la aplicación,
no para quien la programa.

El sistema opera con un **driver fiscal simulado** rotulado como `SIMULACIÓN` en toda la
interfaz. No es cumplimiento normativo; la integración con impresoras fiscales reales está
suspendida por dependencia externa.

## Antes del primer día

Una base nueva no trae usuarios, cajas ni políticas. Los pasos de arranque —administrador
inicial, configuración operativa y catálogo de ejemplo— están en
[el README](../../README.md#cómo-ejecutarlo). Sin la configuración operativa, abrir un turno
falla con `CASH_REGISTER_NOT_FOUND` y cobrar con `POLICY_NOT_CONFIGURED`.

Cada pantalla tiene un atajo `Alt` + su número, visible en la barra lateral.

## 1. Ingresar

Código de operador y PIN. La sesión queda en una cookie local del nodo.

La navegación muestra **solo las pantallas que los permisos de la sesión alcanzan**. Si una
pantalla no aparece, no es un error de la aplicación: ese perfil no la tiene concedida. El
servidor vuelve a verificar cada acción, así que ocultar una pantalla nunca sustituye la
autorización.

## 2. Abrir la caja — `Alt+3`

Selecciona la caja asignada a la estación y el método de efectivo, declara el fondo inicial y
pulsa **Abrir turno**. La estación recuerda su caja; el turno abierto lo resuelve el nodo cada
vez, así que no queda ningún turno "pegado" tras un cierre.

Requiere `cash.shift.open`. Durante la jornada, esta misma pantalla registra ingresos y retiros
de efectivo con su motivo (`cash.movement.income`, `cash.movement.withdrawal`).

Si el nodo no tiene ninguna caja, la pantalla lo dice y remite a **Configuración**, donde se
registra con `config.cash_register.manage`. La caja pertenece a la terminal que la declara.

## 3. Vender — `Alt+2`

La pantalla de Venta toma el turno abierto de la caja de la estación y lo muestra como
`Caja 1 · turno abierto 09:14`. Si dice que no hay turno abierto, vuelve al paso 2.

1. **Iniciar venta** abre el carrito.
2. Escanea o escribe el **barcode** y la cantidad. La cantidad se valida contra la unidad del
   producto: entera para unidades, decimal para productos pesados.
3. Opcional: adjunta el **receptor fiscal** (RIF y nombre). Una venta anónima es válida.
4. Opcional: **descuento de línea** en puntos base, con motivo, si el perfil tiene
   `sale.apply_discount`. El tope lo fija la política de descuento configurada.
5. **Registrar lote de pagos**: hasta dos métodos. La pantalla sugiere el saldo pendiente.
6. **Completar venta**.

Todos los totales, impuestos y el IGTF los calcula el nodo. La pantalla nunca hace aritmética de
negocio, y el botón de completar explica siempre por qué está deshabilitado: falta una línea,
falta cobrar o el pago supera el total.

Al completar, en la misma transacción, el cobro se asienta en el turno y **la existencia
vendida sale del inventario**. Si el producto no tiene artículo de inventario o su saldo no
alcanza, la venta se conserva igual —el cliente ya pagó— y el rechazo queda auditado como
`SALE_STOCK_ISSUE_REJECTED`; ver
[FS-005](../failure-scenarios/FS-005-venta-concurrente-ultima-unidad.md).

## 4. Facturar — `Alt+2`, sobre la venta completada

**Emitir factura** genera el documento fiscal simulado y muestra su número. Es un paso propio y
no parte de completar la venta: si el dispositivo fiscal fallara, no puede revertirse un cobro
que ya está en el turno, y el documento conserva su reintento y su evidencia.

Requiere `fiscal.document.issue`. **La devolución depende de este paso**: la nota de crédito se
deriva del contenido de la factura, así que una venta sin facturar no se puede devolver.

## 5. Anular o devolver

- **Anular** (`sale.void`) aplica a la venta en curso, con motivo y confirmación en pantalla.
- **Devolver** (`sale.return`) es una devolución total de una venta ya completada **y
  facturada**: emite la nota de crédito, repone la existencia con su lote y su costo originales
  y registra el reintegro en el turno de origen.

Ambas quedan auditadas con actor, terminal, momento y motivo.

## 6. Cerrar la caja — `Alt+3`

Declara el saldo contado y el motivo del cierre, y pulsa **Cerrar turno**. La pantalla muestra
esperado, declarado y diferencia por método.

Dos reglas que conviene conocer antes de intentarlo:

- **Una venta sin cerrar bloquea el arqueo** (`SHIFT_HAS_OPEN_SALES`). Su cobro solo entra al
  turno al completarla, y con el turno cerrado ya no habría dónde asentarlo: cóbrala o anúlala
  primero.
- **Cerrar con diferencia exige un permiso aparte** (`cash.shift.close.difference`). Un cajero
  sin él puede cerrar un turno cuadrado, pero no uno descuadrado.

## 7. Inventario y kardex — `Alt+5`

Esta pantalla responde a "cuánto hay" y "de dónde salió".

- **Existencia del nodo** lista los artículos con su lote, unidad, saldo y vencimiento. Cada
  fila tiene **Ver kardex**.
- **Consultar kardex** busca el producto por nombre o barcode y muestra su saldo actual, sus
  lotes y el detalle de movimientos, con filtros por lote, fechas, motivo y límite de filas.
  Requiere `inventory.kardex.read`.

El kardex es un registro **append-only**: nada se edita ni se borra, y el saldo siempre se
deriva de sus movimientos. Sus cinco tipos:

| Tipo | Dirección | Qué lo produce |
|---|---|---|
| `PURCHASE_RECEIPT` | Entrada | Recepción de compra, con o sin documento de origen |
| `SALE_ISSUE` | Salida | Venta completada en este nodo |
| `WASTE` | Salida | Merma registrada con motivo y referencia |
| `ADJUSTMENT_IN` | Entrada | Ajuste de entrada, aprobación de conteo o reposición por devolución |
| `ADJUSTMENT_OUT` | Salida | Ajuste de salida o aprobación de conteo con faltante |

Un producto sin existencia todavía no tiene kardex: la pantalla lo dice, y la primera recepción
crea su artículo de inventario con la unidad del catálogo.

### Recibir mercancía

Necesita un **proveedor activo** (pantalla Proveedores, `Alt+6`). Elige el producto, el
proveedor, el recibo, la cantidad, el lote si aplica y el motivo.

Hay dos formas:

- **Registrar recepción** (`inventory.purchase.receive`): declara qué entró, sin costo.
- **Completar recepción documentada** (`purchase_receipt.start` y `purchase_receipt.complete`):
  añade documento de origen y costo unitario; el nodo calcula la valoración y el promedio
  ponderado que después alimenta el margen.

### Ajustes y conteos

Los ajustes autorizados —merma, entrada, salida— exigen motivo y referencia
(`inventory.waste.register`, `inventory.adjust`). Los conteos físicos viven en `Alt+7`: se abre
un conteo, se registran las líneas eligiendo el producto por nombre, se cierra para congelar las
diferencias y un segundo perfil lo aprueba (`inventory.count.approve`), lo que genera el ajuste
correspondiente.

## 8. Cierres y reportes — `Alt+8`

Declara el período en UTC y consulta. Cada reporte exporta a CSV lo que hay en pantalla, salvo
el de operaciones fiscales.

| Reporte | Qué responde |
|---|---|
| Cierres de caja | Turnos del período, con sus diferencias por método |
| Auditoría | Operaciones sensibles con actor, acción, entidad y motivo |
| Operaciones fiscales | Documentos emitidos y estados recuperables |
| Ventas | Ventas completadas por moneda |
| Margen | Ingreso, costo y margen por producto |
| Inventario | Existencia por artículo y lote a una fecha de corte |

**Consultar arqueo** revisa un turno concreto: tras consultar el período, el turno se elige de
la lista por su jornada. **Revisar historia** muestra la vida de una venta versión por versión.

Los reportes fiscales **X y Z** solo aparecen si el nodo arrancó con el consentimiento de
simulación declarado (`FISCAL_EXECUTION_TARGET=SIMULATOR` y
`FISCAL_SIMULATED_REPORT_CONSENT=ALLOW_SIMULATED_X_AND_Z`).

## Qué hacer cuando algo falla

- **Sin conexión con el nodo**: la barra superior lo indica y la pantalla ofrece **Reintentar**;
  no reintenta sola. Los datos no se pierden: el nodo local es su dueño.
- **Un botón deshabilitado** siempre explica su causa junto a él. Es la vía prevista para
  entender qué falta.
- **Un error con código y correlación**: ese identificador de correlación es lo que permite
  encontrar la operación en la auditoría y en los registros del nodo. Anótalo antes de
  reintentar.
- **Reintentar una acción no la duplica**: cada intención lleva su clave de idempotencia, así
  que un doble clic o un reintento tras un timeout devuelven el mismo resultado, no dos ventas.

## Documentos relacionados

- [Catálogo de ejemplo](./seed-de-catalogo-de-ejemplo.md): qué siembra la seed y qué no.
- [Escenarios de fallo](../failure-scenarios/README.md): qué garantiza el sistema cuando algo se
  interrumpe a mitad de una operación.
- [Alcance por entrega](../producto/alcance-entregas.md).
