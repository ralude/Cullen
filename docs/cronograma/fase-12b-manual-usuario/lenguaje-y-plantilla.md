# Lenguaje, plantilla y glosario del manual — 12B.02

- **Fase:** [12B — Manual de usuario no técnico](./README.md)
- **Gobierna:** [12B.02](./12b.02-lenguaje-y-plantilla.md). Fijado el 2026-09-18.
- **Se apoya en:** el [inventario de interfaz](./inventario-de-interfaz.json), que dice qué
  vocabulario usa la aplicación realmente.

Este documento se decide una vez y no se renegocia por capítulo. Si un capítulo necesita romper
una regla de acá, lo que se cambia es este documento, no el capítulo.

## 1. Quién lee el manual

Una persona que atiende una caja o administra una tienda. Sabe de su trabajo; no sabe —ni tiene
por qué— qué es una migración, un permiso, un nodo o un evento. Nunca ha visto el repositorio y no
lo va a ver.

De ahí salen tres consecuencias que valen más que cualquier regla de estilo:

- **Si algo solo se entiende sabiendo cómo está construido el sistema, está mal explicado.**
- **El lector llega con un problema**, no con ganas de leer. Cada capítulo tiene que resolverlo en
  la primera pantalla de texto.
- **El lector no puede arreglar el sistema.** Puede reintentar, puede llamar a quien administra, y
  puede anotar un código. El manual no le pide más que eso.

## 2. Plantilla de capítulo

Seis partes, en este orden, sin excepciones y sin agregar otras:

```markdown
# <Nombre de la pantalla, el mismo de la barra lateral>

## Para qué sirve
Dos o tres frases. Qué resuelve, en el lenguaje de la tienda.

## Cuándo la vas a usar
Situaciones concretas del día. Si una tarea la hace otra persona, se dice acá.

## Cómo llegar
Grupo de la barra lateral, nombre de la entrada y atajo. Y qué hacer si no aparece.

## Qué ves
La captura, con su texto alternativo, y un recorrido por las secciones en el orden
en que están en pantalla.

## Paso a paso
Una tarea por bloque, con pasos numerados. Una acción por paso.

## Qué pasa si sale mal
Los avisos que esa pantalla puede mostrar, en lenguaje corriente, y qué hacer con cada uno.
```

**«Qué pasa si sale mal» no es opcional ni se resuelve con «contacta al administrador».** Cada
mensaje que la pantalla puede mostrar aparece con lo que el lector puede hacer al respecto.

## 3. Registro y tiempo verbal

| Regla | Sí | No |
|---|---|---|
| Instrucciones en imperativo, tuteando | «Escanea el producto.» | «El operador deberá escanear el producto.» |
| Una acción por paso | «1. Escribe el fondo inicial. 2. Pulsa **Abrir turno**.» | «Escribe el fondo y pulsa Abrir turno, luego verifica…» |
| Frases cortas | «El turno queda abierto.» | «Una vez completado el proceso, el turno pasará a encontrarse en estado abierto.» |
| Voz activa, sujeto visible | «La caja guarda el movimiento.» | «El movimiento es guardado.» |
| Sin condicional de cortesía | «Pulsa **Guardar PIN**.» | «Debería usted pulsar…» |

Sin «simplemente», «basta con», «solo tienes que». Si fuera tan fácil, el lector no estaría
leyendo esa página.

## 4. Cómo se nombra lo que está en pantalla

- Un elemento se nombra con **el texto exacto que el usuario lee, en negrita**: **Abrir turno**,
  **Motivo**, **Declarar efectivo para cerrar**. Nunca el nombre del componente ni el del campo
  interno.
- Si el texto de la pantalla cambia, se cambia en el manual en el mismo hito. El
  [inventario](./inventario-de-interfaz.json) es la lista contra la que se comprueba.
- Las teclas van en su forma literal: **Alt+2**, **Enter**.
- Una pantalla se nombra por su etiqueta de la barra lateral —**Venta**, **Caja**, **Config.**—,
  no por el título del área de trabajo, que es más largo.
- Los importes se escriben como la aplicación los muestra, con coma decimal.

## 5. Cómo se explica un permiso sin nombrarlo

**Nunca se imprime un código de permiso en el cuerpo del manual.** Se describe la capacidad y se
remite a quien administra:

> Si no ves **Caja** en la barra lateral, tu usuario no tiene habilitado abrir y cerrar el turno.
> Pídeselo a quien administra la estación.

No: «requiere el permiso `cash.shift.open`». Ese dato vive en el
[anexo técnico](#7-anexo-técnico), y el cuerpo enlaza al anexo, no lo transcribe.

La forma estándar tiene tres partes: **qué no ves** → **qué capacidad falta, en palabras** → **a
quién pedírsela**. Se usa igual en los tres casos en que ocurre: una entrada ausente de la barra,
un botón deshabilitado y un aviso de autorización al abrir una pantalla.

## 6. Advertencia fiscal estándar

El mismo texto, palabra por palabra, en todo capítulo donde aparezca un documento o un reporte
fiscal. No se abrevia, no se parafrasea y no se pone solo una vez al principio del manual:

> **Este sistema opera en modo simulado.** Las facturas, notas y reportes X y Z que emite son
> ejercicios de práctica: no tienen validez fiscal ni legal, aunque se vean como los de verdad. La
> aplicación lo dice en pantalla con el rótulo **SIMULACIÓN**, y ese rótulo no se puede quitar.

Va inmediatamente antes del paso a paso de la tarea, no al final del capítulo.

La impresión fiscal con un equipo real **no existe todavía**. Donde el lector podría esperarla, el
manual lo dice así: «Esta versión no imprime en una impresora fiscal real.» Sin fecha, sin
promesa y sin «próximamente».

## 7. Anexo técnico

Al final del manual, en un archivo aparte. **El cuerpo enlaza; nunca transcribe.**

Se traslada allí:

- los **códigos de permiso** y la capacidad que concede cada uno;
- los **códigos de error** que el nodo devuelve, con la frase que el manual usa para cada uno y
  qué significa;
- los **nombres de las pantallas de configuración** que un administrador debe tocar para que una
  tarea del cuerpo sea posible —caja asignada, métodos de pago, política de descuento, IGTF;
- el **código de seguimiento** de un fallo: dónde encontrarlo y para qué sirve.

El enlace desde el cuerpo se escribe como una salida, no como una interrupción: «Quien administra
la estación encontrará el detalle en el [anexo técnico].» Nunca a mitad de un paso.

## 8. Glosario

Reglas: cada término se explica **en lo que le cambia al lector**, no en cómo está implementado.
Ninguna definición usa otro término del glosario sin que ese también esté definido. Ninguna dice
«base de datos», «registro», «tabla» ni «evento».

| Término | Qué significa en el manual |
|---|---|
| **Turno** | El período de trabajo de una caja: se abre con un fondo inicial, se registran las ventas y los movimientos de efectivo, y se cierra contando lo que hay. Mientras no haya un turno abierto, esa caja no puede vender. |
| **Arqueo** | Contar el efectivo real que hay en la caja al cerrar el turno, y anotarlo. |
| **Diferencia de arqueo** | Lo que sobra o falta entre el efectivo que el sistema esperaba y el que se contó. No impide cerrar: queda anotada para que alguien la revise. |
| **Existencia** | Cuánto hay de un producto en esta tienda, ahora. |
| **Kardex** | El historial de un producto: cada entrada y cada salida, en orden, con su fecha y su motivo. No se edita ni se borra; el saldo sale siempre de sumar esos movimientos. |
| **Ajuste** | Corregir la existencia de un producto cuando lo que hay en el estante no coincide con lo que el sistema dice. Siempre pide un motivo. |
| **Merma** | Un ajuste de salida por producto perdido, dañado o vencido. |
| **Conteo** | Contar físicamente lo que hay de varios productos para compararlo con el sistema. Se abre, se registran las cantidades contadas y se cierra; las diferencias quedan congeladas hasta que un supervisor las aprueba o las rechaza. |
| **Recepción** | Registrar la mercancía que llegó de un proveedor, con su documento y su costo, para que entre a la existencia. |
| **Lote** | Un grupo de unidades del mismo producto que llegaron juntas y comparten vencimiento. |
| **Vencimiento** | La fecha hasta la que un lote se puede vender. |
| **Tasa** | Cuánto vale una moneda en términos de otra, en una fecha. La tasa que usa una venta es la que estaba vigente cuando se hizo, y no cambia después. |
| **Moneda de la venta** | La moneda en la que se calcula el total de esa venta. Se puede cobrar en otra, pero el total se fija en esta. |
| **IGTF** | Un impuesto que se cobra sobre los pagos hechos con ciertos métodos y monedas. La aplicación lo calcula sola, con el porcentaje que tenga configurado la tienda. |
| **Receptor fiscal** | Los datos de la persona o empresa a nombre de quien se emite la factura. |
| **Nota de crédito** | El documento que deja sin efecto una venta ya facturada. No se borra la venta: se emite un documento que la corrige. |
| **Reporte X** | Un resumen de lo vendido en el turno que se puede pedir sin cerrar nada. No cierra el día. |
| **Reporte Z** | El cierre del día fiscal. Una vez hecho, ese día queda cerrado. |
| **Credencial** | Tu forma de entrar: tu código de operador y tu PIN. El PIN solo lo conoces tú y nunca sale de esta terminal. |
| **Código de enrolamiento** | Un código de un solo uso que te entrega quien administra para que crees tu PIN la primera vez. Después de usarlo, deja de servir. |
| **Nodo** | La aplicación que corre en esta estación y guarda su información. Cada estación tiene el suyo y sigue funcionando aunque se caiga la red. |
| **Coordinador** | El nodo que la tienda designó para reunir lo que las demás estaciones registran. |
| **Sincronización** | El envío de lo que esta estación registró hacia el coordinador. Ocurre sola; si la red se cae, lo pendiente se guarda y se entrega cuando vuelve. Nada se pierde y nada se cobra dos veces. |
| **Código de seguimiento** | Un identificador que aparece cuando algo falla. No te dice qué pasó, pero permite que quien administra encuentre exactamente esa operación. Anótalo antes de cerrar el aviso. |

**Cinco términos que el manual no usa nunca**, aunque aparezcan en pantalla o en la conversación
del equipo: *idempotencia*, *outbox*, *agregado*, *ownership*, *ledger*. Si una explicación los
necesita, la explicación está mal orientada.

## 9. Qué hace comparable a dos capítulos

Esta sub-fase se acepta si dos capítulos escritos por separado se leen igual. En concreto:

- mismas seis secciones, en el mismo orden, con los mismos títulos;
- pasos numerados de una sola acción, de una línea o dos;
- cada elemento de la interfaz en negrita y con su texto literal;
- ningún código de permiso ni de error en el cuerpo;
- la advertencia fiscal, donde corresponda, con el mismo texto exacto;
- ninguna definición de glosario repetida dentro del capítulo: se enlaza.

Una revisión de estilo posterior no debería reescribir un capítulo entero para uniformarlo. Si lo
tiene que hacer, esta sub-fase quedó incompleta y se corrige acá, no en el capítulo.
