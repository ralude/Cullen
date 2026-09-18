# 3 · Inventario

Tres pantallas: **Inventario**, donde ves y mueves la existencia; **Proveedores**, el maestro de
a quién le compras; y **Conteos**, para contar estantes y corregir con control.

---

# Inventario

## Para qué sirve

Saber cuánto hay de un producto, ver todo lo que entró y salió, registrar la mercancía que llega y
corregir la existencia cuando el estante no coincide con el sistema.

## Cuándo la vas a usar

Cuando llega mercancía, cuando algo no cuadra, y cuando alguien pregunta «¿cuántos quedan?».

## Cómo llegar

Grupo **Inventario** → **Inventario**. Atajo: **Alt+5**.

## Qué ves

> 📷 **Captura pendiente** — `08-inventario.png`.
> *Texto alternativo previsto:* «Pantalla Inventario con el listado de artículos y vencimientos
> arriba, el buscador de producto, y abajo el kardex del producto consultado: saldo actual, lotes
> y la tabla de movimientos con fecha, tipo, dirección, cantidad y motivo.»

Arriba, **Artículos y vencimientos de este nodo**: lo que hay en esta tienda, con su lote y su
fecha de vencimiento.

Cuando eliges un producto, abajo aparece su **Saldo actual** —el número grande—, sus **Lotes y
vencimientos**, y la tabla de movimientos.

## Paso a paso

### Ver el movimiento de un producto

1. Busca el producto en el selector, por **Nombre o barcode**.
2. Elige las fechas **Desde** y **Hasta** si quieres acotar. Se muestran hasta 100 líneas.
3. Consulta.

Esa tabla es el **kardex**: cada entrada y cada salida, en orden, con su fecha, su tipo, su
cantidad y su motivo.

**Nada de eso se puede editar ni borrar.** El saldo no es un número guardado en algún sitio: sale
siempre de sumar los movimientos. Por eso, corregir un error se hace agregando un movimiento que
lo compensa, nunca borrando el anterior. Es lo que permite que dentro de seis meses se pueda
reconstruir qué pasó.

Si el producto nunca tuvo existencia, verás que **todavía no tiene existencia registrada**: la
primera recepción crea su artículo de inventario con la unidad del catálogo.

### Registrar una compra

Hay dos formas, y no son equivalentes.

**Registrar compra** — la simple. Para cuando solo necesitas que la mercancía entre a la
existencia.

1. Busca el proveedor por **Código, nombre o RIF** y elígelo. Tiene que estar **activo**.
2. Escribe la **Cantidad**.
3. Escribe el número de **Recibo**.
4. Si el producto maneja lotes, escribe el **Lote** y su **Vencimiento**.
5. Escribe el **Motivo** y confirma.

**Compra con documento y costo** — la documentada. Para cuando la compra tiene una factura o una
guía detrás y quieres que el costo quede registrado.

1. Elige el proveedor.
2. Elige el tipo de documento: **Factura** o **Guía de despacho**, y escribe su número.
3. Escribe la **Cantidad** y el **Costo** unitario, con su moneda.
4. Lote y vencimiento, si corresponde.
5. Escribe el **Motivo** y confirma.

> **Por qué el costo importa aunque tú no veas el margen.** Con cada recepción documentada, el
> sistema recalcula cuánto le cuesta a la tienda ese producto, promediando lo viejo y lo nuevo.
> De ahí sale el margen que ve gerencia. Si registras una compra sin costo cuando sí lo tenías, ese
> cálculo queda incompleto y nadie lo nota hasta que el reporte de margen no cuadra.

No tienes que decirle al sistema la unidad ni la escala del producto: las resuelve del catálogo.

### Ajustar una existencia

Úsalo cuando el estante y el sistema no coinciden y sabes por qué.

1. Elige el **Tipo**: **Merma** —producto dañado, vencido o perdido—, **Ajuste entrada** o
   **Ajuste salida**.
2. Escribe la **Cantidad**.
3. Escribe la **Referencia**.
4. Escribe el **Motivo**. El campo te sugiere los habituales: *Merma por daño*, *Producto
   vencido*, *Diferencia de conteo*, *Consumo interno*, *Robo o pérdida*.
5. Pulsa **Registrar ajuste**.

**Cuándo es legítimo:** cuando conoces la causa. Si no la conoces —el estante no cuadra y no sabes
por qué—, lo correcto es un [conteo](#conteos-físicos), no un ajuste: el conteo deja que un
supervisor revise antes de tocar nada.

**Un ajuste sin costo declarado deja incompleta la valoración del artículo.** El producto entra o
sale de la existencia, pero lo que la tienda cree que vale su inventario queda a medias. Por eso
las entradas de mercancía comprada van por recepción, no por ajuste.

## Qué pasa si sale mal

- **«Este artículo maneja lotes: indica el lote recibido.»** — Ese producto exige lote. Míralo en
  el documento del proveedor.
- **«Este artículo no maneja lotes.»** — Al revés: deja el campo vacío.
- **«La existencia no alcanza para este ajuste.»** — Estás sacando más de lo que hay registrado.
  Cuenta otra vez; puede que falte registrar una entrada anterior.
- **«El proveedor seleccionado no está activo para nuevas recepciones.»** — Está inactivo o
  bloqueado. Habla con quien administra proveedores.
- **«La cantidad tiene más decimales de los que admite la unidad.»** — Si la unidad es *unidades*,
  no puedes recibir 2,5.
- **El producto no aparece en el buscador** — Puede estar inactivo en el catálogo, o no existir.
  Míralo en **Catálogo** (**Alt+4**).

---

# Proveedores

## Para qué sirve

El registro de a quién le compras: su razón social, su identificación fiscal y su estado.

## Cuándo la vas a usar

Cuando llega mercancía de alguien nuevo, o cuando una identificación fiscal está mal cargada.

## Cómo llegar

Grupo **Inventario** → **Proveedores**. Atajo: **Alt+6**.

## Qué ves

> 📷 **Captura pendiente** — `09-proveedores.png`.
> *Texto alternativo previsto:* «Pantalla Proveedores con el filtro por estado, el listado de
> proveedores y la ficha del proveedor seleccionado con su identidad fiscal y sus datos
> comerciales.»

Arriba, un filtro: **Todos**, **Activos**, **Inactivos**, **Bloqueados**.

## Paso a paso

### Dar de alta un proveedor

1. Pulsa **Nuevo proveedor**.
2. Escribe la **Razón social** —el nombre legal, el que aparece en su factura—.
3. Escribe la **Identidad fiscal**: el país y el número, en el formato `J-12345678-9`.
4. Escribe el **Motivo**.
5. Confirma.

El sistema guarda la identificación **normalizada**: sin guiones ni espacios, siempre igual. Así
no terminas con el mismo proveedor cargado tres veces de tres formas distintas.

### Corregir una identidad fiscal

Esto **no** se hace editando la ficha como el resto de los datos. Hay una sección aparte,
**Corrección privilegiada**, y pide su propio motivo.

**Por qué se trata distinto:** la identificación fiscal es lo que ata todas las compras a ese
proveedor. Cambiarla afecta documentos ya emitidos, así que se hace con más ceremonia y queda
registrado como lo que es: una corrección, no una edición.

### Cambiar el estado

Un proveedor **inactivo** o **bloqueado** no admite recepciones nuevas. Todo lo que ya se le
compró se conserva íntegro: el historial no se borra nunca. Desactivar no es eliminar.

## Qué pasa si sale mal

- **«Ya existe un proveedor con esa identificación fiscal.»** — Ya está cargado. Búscalo con el
  filtro **Todos**: puede estar inactivo.
- **«La identificación fiscal no tiene un formato válido.»** — Revisa el formato.
- **«La razón social del proveedor es obligatoria.»** — Falta el nombre legal.
- **«No hay cambios que guardar en este proveedor.»** — No modificaste nada.
- **«La corrección fiscal exige un motivo.»** — Escribe por qué corriges.

---

# Conteos físicos

## Para qué sirve

Contar lo que hay de verdad en los estantes y compararlo con el sistema, para corregir con control
en vez de a mano.

## Cuándo la vas a usar

En los inventarios periódicos, y cuando sospechas que un pasillo entero no cuadra.

## Cómo llegar

Grupo **Inventario** → **Conteos**. Atajo: **Alt+7**.

## En qué se diferencia de un ajuste

| | Ajuste | Conteo |
|---|---|---|
| Cuándo | Sabes qué pasó | No sabes qué pasó, o son muchos productos |
| Quién decide | Tú, en el momento | Tú cuentas; un supervisor aprueba |
| Cuándo cambia la existencia | Al instante | Solo cuando se aprueba |

## Qué ves

> 📷 **Captura pendiente** — `10-conteos.png`.
> *Texto alternativo previsto:* «Pantalla Conteos físicos con el filtro por estado, la lista de
> conteos y el detalle del conteo seleccionado con sus líneas y la tabla de diferencias.»

El filtro de estados dice en qué punto está cada conteo: **Abiertos**, **Cerrados, pendientes de
aprobación**, **Aprobados**, **Rechazados**.

## Paso a paso

### Contar

1. Abre un conteo.
2. Por cada producto: elígelo en **Producto/artículo**, indica el **Lote** si lo maneja, y escribe
   en **Contado** lo que contaste de verdad.
3. Pulsa **Registrar línea**.

Puedes irte y volver: el conteo queda abierto hasta que lo cierres.

### Cerrar el conteo

Cuando terminaste de contar, pulsa **Cerrar conteo**.

En ese momento aparecen las **Diferencias congeladas al cerrar**: **Esperado**, **Contado**,
**Diferencia**, por cada línea.

> **Congeladas** significa que esos números ya no cambian, aunque después entre o salga mercancía.
> Son la foto del momento en que contaste. Si se recalcularan solas, la diferencia que tu
> supervisor revisa el lunes no sería la que tú viste el viernes.

### Aprobar o rechazar

Lo hace un supervisor, no quien contó. En **Decisión del supervisor**:

- **Aprobar** — la existencia se corrige para que coincida con lo contado, y queda el movimiento
  en el kardex de cada producto con su motivo.
- **Rechazar** — no se toca nada, y hay que escribir por qué.

Hasta que alguien decida, la existencia **no cambia**. Ese es justamente el punto.

### Si contaste mal

- **El conteo sigue abierto:** vuelve a registrar la línea con la cantidad correcta.
- **Ya lo cerraste:** no se reabre. Dile a tu supervisor que lo rechace y abre uno nuevo. Es más
  lento a propósito: un conteo que se puede editar después de cerrado no sirve para controlar
  nada.

## Qué pasa si sale mal

- **«El conteo ya no admite nuevas líneas.»** — Está cerrado. Abre uno nuevo.
- **«Registra al menos una línea antes de cerrar el conteo.»** — Un conteo vacío no se cierra.
- **«El conteo debe estar cerrado antes de aprobarlo o rechazarlo.»** — Ciérralo primero.
- **«La cantidad contada no puede ser negativa.»** — Si no había nada, escribe cero.
- **«El rechazo exige un motivo.»** — Escribe por qué.
- **No ves Decisión del supervisor** — Aprobar conteos no está habilitado para tu usuario. Es lo
  esperado si tú eres quien cuenta.
