# 2 · Caja

Tres pantallas: **Caja**, donde empieza y termina tu jornada; **Venta**, donde pasas el día; y
**Catálogo**, para consultar precios.

El orden importa. **Sin un turno abierto no se puede vender**, así que este capítulo empieza por
la caja aunque tú vayas a pasar más tiempo en la venta.

---

# Caja

## Para qué sirve

Abrir tu turno al empezar, registrar el efectivo que entra o sale durante el día, y cerrar
contando lo que hay.

## Cuándo la vas a usar

Al empezar tu jornada, cada vez que saques o metas efectivo por algo que no es una venta, y al
terminar.

## Cómo llegar

Grupo **Caja** → **Caja**. Atajo: **Alt+3**.

## Qué ves

> 📷 **Captura pendiente** — `05-caja.png`.
> *Texto alternativo previsto:* «Pantalla Operación de caja con el panel Abrir caja, que contiene
> el selector de caja asignada y el campo Fondo inicial, y los botones Abrir turno y Consultar
> turno.»

Arriba, una nota recuerda que todo lo que registres se envía al turno dueño de esa caja y que las
diferencias quedan visibles para que alguien las autorice.

## Paso a paso

### Abrir el turno

1. Elige la **Caja asignada** de esta estación.
2. Escribe el **Fondo inicial**: el efectivo con el que arrancas.
3. Pulsa **Abrir turno**.

Queda a la vista el panel **Turno abierto**, con su identificador corto y la cuenta de
movimientos. Desde ahí ya puedes ir a **Venta**.

Si vuelves más tarde y quieres ver el turno en curso, pulsa **Consultar turno**.

> **Si la estación no tiene ninguna caja asignada**, el campo aparece vacío y en blanco. Las cajas
> las crea quien administra, desde **Config.**, y pertenecen a la terminal donde se declaran. No
> inventes un nombre: pídele que la cree en *esta* estación. Está en el
> [capítulo 4](./04-administracion.md).

### Registrar un ingreso o un retiro

Úsalo cuando el efectivo de la caja cambia por algo que no es una venta: un vuelto que trajiste,
un pago al proveedor del agua, un retiro a la caja fuerte.

1. En **Registrar movimiento**, elige el **Tipo**: **Ingreso** o **Retiro**.
2. Elige el **Método de efectivo**.
3. Escribe el **Importe**.
4. Escribe el **Motivo**.
5. Pulsa **Registrar movimiento**.

**El motivo es obligatorio, siempre.** No es burocracia: al cerrar el turno, la diferencia entre
lo que el sistema esperaba y lo que contaste se explica con esos motivos. Sin ellos, una
diferencia legítima parece un faltante.

### Cerrar el turno con arqueo

1. Cuenta el efectivo que hay realmente en la caja.
2. En **Declarar efectivo para cerrar**, escribe el **Saldo declarado**.
3. Escribe el **Motivo**.
4. Pulsa **Cerrar turno**.

La pantalla muestra tres números: **Esperado** —lo que el sistema calculó—, **Declarado** —lo que
contaste— y **Diferencia**.

**Una diferencia no impide cerrar.** Queda registrada con tu nombre y tu motivo, y tu supervisor
la revisa desde [Reportes](./05-supervision-y-gerencia.md). Lo que sí importa es que declares lo
que contaste de verdad: cuadrar el número a mano esconde el problema en vez de resolverlo.

## Qué pasa si sale mal

- **«La caja conserva ventas sin cerrar: cóbralas o anúlalas antes del arqueo.»** — Hay una venta
  a medias. Vuelve a **Venta**, y complétala o anúlala. Después cierra.
- **«La caja ya tiene un turno abierto.»** — Alguien ya lo abrió, quizá en el turno anterior.
  Pulsa **Consultar turno** para verlo.
- **«No hay un turno abierto para esta caja.»** — Ábrelo antes de seguir.
- **«El turno no puede modificarse en este estado.»** — Ya está cerrado. Un turno cerrado no se
  reabre; se abre uno nuevo.

---

# Venta

## Para qué sirve

Cobrar. Armar el ticket, aplicar descuentos si te corresponde, recibir el pago en uno o varios
medios y completar la venta.

## Cuándo la vas a usar

Todo el día, con un cliente delante. Por eso esta pantalla tiene lo importante siempre a la vista
y el botón principal siempre te dice qué falta.

## Cómo llegar

Grupo **Caja** → **Venta**. Atajo: **Alt+2**.

## Qué ves

> 📷 **Captura pendiente** — `06-venta.png`.
> *Texto alternativo previsto:* «Pantalla Punto de venta con una venta en curso: a la izquierda el
> ticket con sus líneas, a la derecha el catálogo de productos, y abajo la barra de cobro con el
> total a cobrar, los métodos de pago y el botón Completar venta.»

La pantalla tiene tres zonas:

- **01 · Ticket** — a la izquierda: lo que el cliente lleva.
- **02 · Catálogo** — a la derecha: para buscar un producto cuyo código no puedes leer.
- **La barra de cobro** — abajo, de lado a lado: el total, los medios de pago y el botón principal.

## Paso a paso

### Abrir el carrito

1. Comprueba el aviso del turno. Si dice **Esta estación no tiene un turno abierto**, ve a
   **Caja** (**Alt+3**), ábrelo y vuelve.
2. Confirma la **Moneda de venta**.
3. Pulsa **Iniciar venta**.

### Agregar productos

**Con el lector:** el cursor ya está en el campo del código. Pasa el producto por el lector; la
línea se agrega sola. También puedes escribir el código y pulsar **Enter**.

**Buscando por nombre:** escribe en **Buscar por nombre o barcode**, en el panel del catálogo, y
elige el producto de la lista.

### Corregir el ticket

- **Cambiar la cantidad**: escribe la nueva en la columna **Cant.** de esa línea.
- **Quitar una línea**: usa el botón de la propia línea.
- **Aplicar un descuento**: pulsa **Descuento de línea**, elige la **Línea**, escribe el
  porcentaje y el **Motivo**, y confirma. Queda registrado con tu nombre.

> **El descuento tiene un tope** que fija la administración de la tienda. Si lo superas, la venta
> no lo acepta. Si de verdad hace falta un descuento mayor, tiene que autorizarlo quien pueda
> hacerlo.

### Leer el total

En la barra de abajo, **Total a cobrar** es el número grande. Debajo, en letra pequeña, su
composición: **Subtotal**, **IVA** e **IGTF**.

El **IGTF** solo aparece con un importe cuando pagas con un medio que lo lleva. Esos medios están
marcados con **+IGTF** en su etiqueta. No lo calculas tú: lo hace la estación.

### Cobrar

**Con un solo medio de pago:**

1. Pulsa el medio de pago que corresponda.
2. Escribe el **Importe**, o pulsa **Resto** para que ponga lo que falta.
3. Pulsa **Cobrar y completar**.

**Con varios medios (pago mixto):**

1. Elige el primer medio y escribe su importe.
2. Pulsa **Agregar pago**. La línea aparece en la fila de pagos.
3. Repite con los demás medios. **Resto** te pone siempre lo que queda.
4. Cuando el saldo esté cubierto, pulsa **Completar venta**.

Bajo el botón, una línea te dice siempre en qué punto estás: **Falta cobrar…** o **Cobro
cubierto**. Si el medio elegido lleva IGTF, esa línea te dice también cuánto hay que recibir con
ese medio, impuesto incluido.

**El botón principal nunca miente:** si está deshabilitado, el texto de arriba explica por qué
—falta cobrar, el pago supera el total, o no hay ninguna línea—.

**Cobrar en otra moneda:** elige el medio de pago de esa moneda. La conversión usa la tasa vigente
en ese momento, y esa tasa queda guardada con la venta: si mañana cambia, esta venta no cambia.

### Emitir la factura

Al completar, la pantalla muestra el resumen de la venta y, debajo, **Emitir factura**.

> **Este sistema opera en modo simulado.** Las facturas, notas y reportes X y Z que emite son
> ejercicios de práctica: no tienen validez fiscal ni legal, aunque se vean como los de verdad. La
> aplicación lo dice en pantalla con el rótulo **SIMULACIÓN**, y ese rótulo no se puede quitar.

1. Si el cliente pide la factura a su nombre, pulsa **Receptor fiscal** *antes* de emitirla,
   escribe el **País** y la **Identificación** —el nombre y la dirección son opcionales— y pulsa
   **Adjuntar receptor**. Si te equivocaste, **Quitar receptor**.
2. Pulsa **Emitir factura**.

Verás el número del documento y su estado.

**Por qué facturar es un paso aparte y no ocurre solo al completar:** si el dispositivo fiscal
fallara, no se puede deshacer un cobro que ya quedó asentado en tu turno. Separarlo permite
reintentar la factura sin tocar el dinero.

Una venta sin receptor es válida en simulación: no hace falta pedirle los datos a todo el mundo.

### Anular y devolver

Son cosas distintas:

- **Anular** es para una venta **que todavía no has completado**. Pulsa **Anular venta**, escribe
  el motivo y confirma. No hubo cobro, no hubo movimiento de existencia.
- **Devolver** es para una venta **ya completada y facturada**. Devuelve el producto a la
  existencia y registra el reintegro del dinero en el turno donde se cobró.

Para devolver:

1. En el resumen de la venta completada, busca **Devolver venta completa**.
2. Si la venta aún no tiene factura, emítela primero: la nota de crédito se deriva de ese
   documento y sin él la devolución no procede.
3. Escribe el **Motivo**.
4. Pulsa **Registrar devolución**.

Se emite una **nota de crédito** y la venta queda devuelta. **Solo está disponible como devolución
total**: no se devuelven artículos sueltos de una venta.

Ninguna de las dos se deshace. Ambas quedan registradas con tu nombre y tu motivo.

### Si la impresión no responde

Puede pasar que emitas la factura y la aplicación no te confirme nada, o que quede en un estado
que no entiendes.

**No vuelvas a emitirla una y otra vez.** La estación guarda evidencia de lo que pasó
precisamente para que nadie tenga que adivinar, y un reintento a ciegas es lo que produce dos
documentos por una venta. Anota la hora y el identificador de la venta, avisa a tu supervisor, y
sigue atendiendo: el cobro ya está asentado en tu turno. Está explicado con calma en el
[capítulo 6](./06-cuando-algo-falla.md#cuando-una-operación-queda-incierta).

## Qué pasa si sale mal

- **«Esta estación no tiene un turno abierto.»** — Ve a **Caja** (**Alt+3**) y ábrelo.
- **«El catálogo no respondió. Puedes seguir usando el lector.»** — Solo falló el panel de
  búsqueda. El lector sigue funcionando. Pulsa **Reintentar** cuando puedas.
- **«No encontramos ese producto.»** — El código no está en el catálogo, o el producto está
  inactivo. Búscalo por nombre; si tampoco aparece, avisa a quien administra el catálogo.
- **«El pago no coincide con el total de la venta.»** — Revisa los pagos agregados: sobra o falta.
- **«La venta no puede modificarse en este estado.»** — Ya está completada o anulada. Pulsa
  **Iniciar otra venta**.
- **«El método de pago no está habilitado.»** — Ese medio no está configurado en esta tienda.
- **«La existencia no alcanza…»** — No hay suficiente producto registrado. Avisa a depósito.

---

# Catálogo

## Para qué sirve

Consultar un producto: su precio, su unidad, sus códigos y cómo ha cambiado de precio. Si tu
perfil lo permite, también cambiarlo o crear un producto nuevo.

## Cuándo la vas a usar

Cuando un cliente pregunta un precio, cuando un código no lee, o cuando hay que actualizar
precios.

## Cómo llegar

Grupo **Caja** → **Catálogo**. Atajo: **Alt+4**.

## Qué ves

> 📷 **Captura pendiente** — `07-catalogo.png`.
> *Texto alternativo previsto:* «Pantalla Catálogo con el buscador por nombre o barcode, la lista
> de productos con su precio, y a la derecha la ficha del producto seleccionado con su historial
> de precio.»

## Paso a paso

### Buscar un producto

- **Por código:** escribe el código en **Nombre o barcode** y pulsa **Abrir ficha por barcode**.
- **Por nombre:** escribe parte del nombre y pulsa **Buscar en el catálogo**. Luego, **Ver ficha**
  en la fila que buscabas.

La ficha muestra el nombre, la descripción, la **Unidad**, los **Barcode**, el **Estado** —activo
o inactivo— y el **Historial de precio**.

### Actualizar un precio

1. Abre la ficha del producto.
2. Escribe el nuevo **Precio**.
3. Escribe el **Motivo**.
4. Pulsa **Actualizar precio**.

**Por qué se pide un motivo:** ningún precio cambia sin dejar rastro. El historial conserva qué
precio hubo, desde cuándo, quién lo cambió y por qué. Así, cuando alguien pregunte por qué un
producto se vendió a otro precio la semana pasada, la respuesta está en la ficha y no en la
memoria de nadie.

Si el botón está deshabilitado, tu usuario no tiene habilitado cambiar precios.

## Qué pasa si sale mal

- **«No encontramos ese producto.»** — Revisa el código, o busca por nombre.
- **«Sin registros.»** en el historial — El producto nunca cambió de precio desde que se creó.
- El botón **Actualizar precio** o **Nuevo producto** deshabilitado — Tu usuario no tiene esa
  tarea habilitada. Pídesela a quien administra.
