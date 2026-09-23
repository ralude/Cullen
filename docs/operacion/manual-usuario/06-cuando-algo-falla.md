# 6 · Cuando algo no sale como esperabas

Este es el capítulo que se lee con prisa, así que está hecho para buscar, no para leer de corrido.

## Lo primero que conviene saber

**Cuando la aplicación no te deja seguir, casi nunca está rota.** Está diseñada para detenerse
ante una situación que no puede resolver sola, en vez de continuar y arriesgarse a cobrar dos
veces, perder un pago o inventar una existencia.

Para ti eso se ve como una pantalla que te frena. Es incómodo, y es a propósito: lo que se detiene
se puede retomar; lo que se cobra dos veces hay que devolverlo.

## Volver a intentarlo no duplica nada

Esto vale la pena saberlo antes que cualquier otra cosa, porque es el miedo más común: **un doble
clic no cobra dos veces.**

Cada acción que envías —abrir el turno, agregar una línea, cobrar, registrar un movimiento— viaja
marcada como *ese* intento en particular. Si el botón parece no responder y lo pulsas otra vez, o
si la pantalla se queda pensando y le das a **Reintentar**, la estación reconoce que es el mismo
intento y te devuelve el mismo resultado. No se crea una segunda venta.

**La excepción es la factura**, y es distinta por una razón concreta: ahí no estás reintentando el
mismo envío, estás pidiendo un documento nuevo. Por eso tiene su propia sección
[más abajo](#cuando-una-operación-queda-incierta) y por eso ahí la regla se invierte: no la pidas
otra vez sin mirar.

---

## Cada aviso, qué hacer

Cada entrada tiene la misma forma: **qué viste** → **qué pasó** → **qué hacer ahora** → **a quién
avisar si se repite**.

### No hay turno abierto

> «No hay un turno abierto para esta caja.» · «Esta estación no tiene un turno abierto.» · «Abre o
> selecciona un turno desde Caja antes de iniciar la venta.»

**Qué pasó:** no se puede vender sin un turno abierto, porque no habría dónde asentar el dinero.

**Qué hacer:** ve a **Caja** (**Alt+3**), elige la caja y el **Método de efectivo**, escribe el
fondo inicial y pulsa **Abrir turno**. Vuelve a **Venta** (**Alt+2**).

**Si se repite:** si al abrir dice que ya hay un turno abierto y en Venta dice que no hay,
avísale a tu supervisor: puede ser que el turno esté en otra caja.

### La estación no tiene caja

> El campo **Caja asignada** está vacío y no hay nada que elegir.

**Qué pasó:** esta terminal no tiene ninguna caja declarada. Las cajas pertenecen a la terminal
donde se crean.

**Qué hacer:** nada que puedas resolver tú. **No inventes un nombre de caja.**

**A quién avisar:** a quien administra, para que la cree desde **Config.**, *en esta estación*.

### La tasa del dólar no es de hoy

> En **Caja**: «Tasa USD/VES del …», «No hay tasa USD/VES registrada» o «No se pudo comprobar la
> tasa USD/VES». En **Venta**, bajo el total: «Sin tasa USD/VES».

**Qué pasó:** la tasa con la que la estación calcula los bolívares empezó a regir un día anterior,
no hay ninguna cargada, o la estación no logró consultarla.

**Qué hacer:** puedes abrir el turno y vender igual; el aviso no bloquea nada. Un fin de semana o
un feriado es normal que siga la tasa del último día hábil. Si es un día de semana y el BCV ya
publicó la nueva, no des el equivalente en bolívares con la tasa vieja.

**A quién avisar:** a quien administra, para que la registre en **Tasas**
([capítulo 4](./04-administracion.md)).

### No se puede cobrar en bolívares

> Bajo el importe: «No hay tasa USD/VES: no se puede cobrar en VES.» o «No se pudo consultar la
> tasa USD/VES…». Al completar: «La tasa con que se capturó el pago ya no rige: quita el pago y
> agrégalo de nuevo.»

**Qué pasó:** un pago en bolívares necesita la tasa vigente. O no hay ninguna registrada, o la
estación no pudo consultarla, o la tasa cambió entre el momento en que agregaste el pago y el
cobro.

**Qué hacer:** si falta la tasa, cobra con un medio en dólares o espera a que la registren. Si
cambió, pulsa la **×** del pago en bolívares y agrégalo otra vez: el importe se recalcula con la
tasa nueva. Nada se cobró todavía.

**A quién avisar:** a quien administra, si no hay tasa del día.

### No se puede cobrar porque falta configurar algo

> Un mensaje genérico —«La operación no pudo completarse.»— justo al completar la venta, con todo
> lo demás aparentemente bien.

**Qué pasó:** lo más probable es que falte una política de cobro sin la cual la venta no puede
cerrarse: los métodos de pago, el tope de descuento o el impuesto sobre ciertos medios.

**Qué hacer:** anota el **Código de seguimiento** del aviso —está en el desplegable— y avisa. La
venta sigue abierta; no la pierdes.

**A quién avisar:** a quien administra. Lo resuelve en **Config.**, y está en el
[capítulo 4](./04-administracion.md#lo-primero-el-orden).

### El descuento supera el tope

> Un mensaje genérico al aplicar un descuento de línea.

**Qué pasó:** el porcentaje que pusiste supera el máximo que la tienda permite por línea.

**Qué hacer:** aplica un descuento dentro del tope. Si de verdad hace falta uno mayor, tiene que
autorizarlo quien pueda hacerlo.

**A quién avisar:** a tu supervisor, si el caso se repite y el tope quedó corto para la operación
real.

### No alcanza la existencia

> «La existencia no alcanza para este ajuste.»

**Qué pasó:** estás sacando más de lo que el sistema tiene registrado.

**Qué hacer:** cuenta otra vez. Si en el estante hay más de lo que dice el sistema, falta
registrar una entrada: revisa si la última recepción se cargó.

**A quién avisar:** a depósito. Si pasa seguido con el mismo producto, conviene un
[conteo](./03-inventario.md#conteos-físicos).

### Hay ventas sin cerrar y no se puede cerrar el turno

> «La caja conserva ventas sin cerrar: cóbralas o anúlalas antes del arqueo.»

**Qué pasó:** quedó una venta a medias.

**Qué hacer:** ve a **Venta**, y complétala o anúlala. Después vuelve a cerrar el turno.

### La sesión venció o el PIN no entra

> «El PIN actual no es correcto.» · «Tu credencial está caducada: cambia tu PIN para continuar.»

**Qué pasó:** o el PIN está mal escrito, o quien administra lo caducó.

**Qué hacer:** si es lo segundo, la aplicación te lleva directo a cambiarlo; hazlo y sigue. Si es
lo primero, escríbelo de nuevo con calma —los campos se borran después de cada intento, a
propósito—.

**A quién avisar:** si no logras entrar, a quien administra, para que te habilite un enrolamiento
nuevo. **Nunca uses el usuario de otra persona**: todo lo que se haga queda a nombre de quien
está conectado.

### El nodo no responde

> «No pudimos conectar con el nodo» · «Sin conexión con el nodo» en la barra superior · «No hay
> conexión con el nodo local.»

**Qué pasó:** el programa que guarda los datos de **esta** estación no está respondiendo. No es la
red de la tienda: es esta computadora.

**Qué hacer:** pulsa **Reintentar**. No podrás vender mientras dure. Lo que ya registraste está
guardado.

**A quién avisar:** a quien administra, de inmediato. Hay que arrancar el servicio de la estación.

### La impresión fiscal no confirmó

Tiene su propia sección, [más abajo](#cuando-una-operación-queda-incierta).

### La devolución ya no procede

> «La venta no puede modificarse en este estado.» · Un mensaje genérico al registrar una
> devolución.

**Qué pasó:** o la venta ya fue devuelta —solo se devuelve una vez—, o todavía no tiene factura
emitida. La nota de crédito se deriva de la factura: sin ella no hay de qué derivarla.

**Qué hacer:** si falta la factura, emítela primero en el resumen de la venta. Si ya fue devuelta,
no hay nada más que hacer por esa vía.

**A quién avisar:** a tu supervisor, si el cliente sigue reclamando.

### Un producto no aparece

> «No encontramos ese producto.»

**Qué pasó:** el código no está en el catálogo, o el producto está inactivo.

**Qué hacer:** búscalo por nombre en el panel de catálogo. Si tampoco aparece, míralo en
**Catálogo** (**Alt+4**).

**A quién avisar:** a quien administra el catálogo, para darlo de alta o reactivarlo.

---

## Cuando una operación queda incierta

Vale la pena leer esto con calma **antes** de que pase.

A veces emites una factura y la aplicación no te confirma nada: se queda esperando, o muestra un
estado que no entiendes. No sabes si el documento se emitió o no.

**Lo peor que puedes hacer es volver a intentarlo varias veces.** Si el documento sí se había
emitido, cada reintento produce otro, y después hay que anular documentos fiscales que nunca
debieron existir.

**Qué hace el sistema por ti:** guarda evidencia de cada paso —qué se envió, qué respondió el
equipo, qué quedó impreso— precisamente para que nadie tenga que adivinar. Ante una situación
ambigua, se bloquea y pide que una persona la resuelva. Eso que ves como «no me deja» es la
protección funcionando.

**Qué hacer tú:**

1. **No reintentes.**
2. Anota la hora, el identificador de la venta y el **Código de seguimiento** si aparece.
3. Avisa a tu supervisor.
4. Sigue atendiendo. **El cobro ya está asentado en tu turno**: lo único en duda es el documento.

**Quién lo resuelve:** quien administra la estación, revisando la evidencia que quedó guardada. Lo
verá en **Reportes**, en
[operaciones fiscales y estados recuperables](./05-supervision-y-gerencia.md#operaciones-fiscales-y-estados-recuperables).

---

## Trabajar sin conexión

Si la barra superior dice **Servidor conectado** pero **Sync** dice **Sin contacto**, la estación
funciona y lo que falta es el enlace con el coordinador.

**Lo que puedes hacer con normalidad:** abrir turno, vender, cobrar, emitir facturas, registrar
movimientos de efectivo, recibir mercancía, ajustar existencia, cerrar el turno con arqueo.
Absolutamente todo lo del día a día.

**Lo que no:** ver datos actualizados de otras estaciones, y usar servicios de afuera como la
sugerencia de tasa. Si la **tasa de cambio** que esta estación tiene guardada está **vencida**, no
se puede cobrar en esa moneda hasta que alguien registre una nueva.

**Lo que pasa cuando vuelve la red:** lo pendiente se entrega solo, en orden. No tienes que hacer
nada, y nada se pierde ni se cuenta dos veces.

**Cuándo avisar:** si el corte dura más que un turno, o si al volver la conexión **Sync** sigue
diciendo **Requiere atención**.

---

## Antes de pedir ayuda

Reúne esto. Con estos cinco datos, quien administra encuentra el caso en minutos:

1. **En qué pantalla** estabas.
2. **La hora**, aproximada.
3. **Qué caja** y qué terminal.
4. **Con qué usuario** estabas conectado.
5. **Qué estabas intentando hacer**, y el **Código de seguimiento** si el aviso mostraba uno.

El **Código de seguimiento** está dentro del aviso de error, en el desplegable del mismo nombre.
Ábrelo y cópialo antes de descartar el aviso.

> ### Qué no enviar nunca
>
> - **Tu PIN, ni el de nadie.** Nadie legítimo te lo va a pedir: quien administra puede darte uno
>   nuevo sin conocer el anterior.
> - **Capturas con datos de clientes**: nombres, identificaciones, direcciones.
> - **Claves, códigos de enrolamiento sin usar ni archivos de configuración.**

---

## Lo que el manual no puede resolver

Anotado con honestidad, para que no te sorprenda:

**Algunas situaciones muestran un mensaje genérico.** Cuando la aplicación no tiene una frase
propia para lo que pasó, dice **«La operación no pudo completarse.»** Hoy ocurre al menos en
cuatro casos que sí te vas a encontrar: falta una política de cobro configurada, el descuento
supera el tope, la estación no tiene su caja declarada, y una devolución que ya no procede.

En todos, el **Código de seguimiento** es lo que permite identificar el caso. Está registrado como
algo a mejorar; mientras tanto, anótalo y avisa.

---

## Para quien administra

Lo que no le corresponde resolver a un operador está en los runbooks:

- [Instalación de una estación](../instalacion-estacion.md)
- [Respaldo operativo](../respaldo-operativo.md)
- [Emisión de material LAN](../emision-material-lan.md)
- [Rotación de material protegido](../rotacion-material-protegido.md)

La correspondencia entre lo que ve el operador y lo que registra el sistema está en el
[anexo técnico](./anexo-tecnico.md).
