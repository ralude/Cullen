# 4 · Administración

Este capítulo es para quien administra el comercio: la persona que decide cómo cobra la tienda,
qué operadores existen y con qué tasa se convierte. No hace falta ser administrador de sistemas.

**Cada pantalla de este capítulo puede detener la operación si queda mal configurada.** Por eso
cada tarea dice qué se rompe si falta.

---

## Lo primero: el orden

Una base recién instalada **no puede vender todavía**. Este es el orden mínimo, y lo que falla si
te saltas un paso:

| Orden | Qué configurar | Qué falla si falta |
|---|---|---|
| 1 | **Categorías** y **Unidades** | No se pueden crear productos |
| 2 | Al menos una **caja** en esta terminal | El cajero no puede abrir su turno |
| 3 | Los **Métodos de pago** | Se puede abrir el turno, pero no cobrar |
| 4 | El **Descuento máximo** y el **IGTF** | El cobro se rechaza al completar la venta |
| 5 | Al menos un **operador** con su **rol** | No hay quien trabaje |
| 6 | Una **tasa** vigente, si vas a cobrar en otra moneda | No se puede convertir |

Si un cajero te dice que no puede abrir turno o que no puede cobrar, la respuesta casi siempre
está en esta lista.

---

# Configuración operativa

## Cómo llegar

Grupo **Administración** → **Config.** Atajo: **Alt+0**.

## Qué ves

> 📷 **Captura pendiente** — `11-configuracion.png`.
> *Texto alternativo previsto:* «Pantalla Configuración operativa con sus paneles en orden:
> Categorías, Unidades, Cajas de esta terminal, Métodos de pago, Descuento máximo, IGTF ·
> SIMULACIÓN, Sucursales y Dispositivos declarados.»

## Categorías y unidades

Las **Categorías** agrupan los productos. Las **Unidades** dicen cómo se mide cada uno y con
cuántos **Decimales**: *unidades* con cero decimales, *kilogramos* con tres.

**Los decimales importan más de lo que parece.** Si la unidad admite cero decimales, nadie podrá
recibir ni vender 2,5 de ese producto — la aplicación lo rechaza. Piénsalo al crearla: cambiarlo
después, con movimientos ya registrados, es incómodo.

Para cada una: escribe su **Código** y su **Nombre**, y pulsa **Guardar categoría** o **Guardar
unidad**.

## Cajas de esta terminal

**Una caja pertenece a la terminal donde se declara.** No es una lista compartida: la caja que
creas acá es la caja de *esta* computadora.

Si la declaras en la estación equivocada, el cajero de la otra no la verá y no podrá abrir turno.
La solución es crearla en la estación correcta; la sobrante queda sin uso.

## Métodos de pago

Cada método tiene un **Tipo**: **Efectivo**, **Tarjeta**, **Transferencia**, **Pago móvil** u
**Otro**.

**El efectivo se trata distinto en el arqueo.** Al cerrar el turno, el cajero declara el efectivo
que contó, y el sistema lo compara con lo que esperaba. Lo cobrado con tarjeta o transferencia no
entra en esa cuenta, porque no está en la gaveta. Si marcas como *efectivo* un método que no lo
es, las diferencias de arqueo dejarán de tener sentido.

Escribe el nombre y el tipo, y pulsa **Guardar método**.

## Descuento máximo

El tope que un cajero puede descontar **en una línea**, en por ciento. Admite decimales: `12,5`.

Cuando el cajero intenta pasarse, la venta rechaza el descuento. Él verá un mensaje genérico
—está anotado como [hallazgo](./06-cuando-algo-falla.md#lo-que-el-manual-no-puede-resolver)—, así
que conviene que el equipo sepa cuál es el tope.

## El impuesto sobre ciertos medios de pago (IGTF)

> **Este sistema opera en modo simulado.** Las facturas, notas y reportes X y Z que emite son
> ejercicios de práctica: no tienen validez fiscal ni legal, aunque se vean como los de verdad. La
> aplicación lo dice en pantalla con el rótulo **SIMULACIÓN**, y ese rótulo no se puede quitar.

Se configuran tres cosas:

- el **Porcentaje**;
- los **Métodos** sobre los que recae, separados por coma;
- las **Monedas** alcanzadas, separadas por coma.

Se cobra dentro del importe entregado con un método gravado: el cajero no lo calcula, la
aplicación lo agrega sola y el ticket lo muestra aparte.

Para guardarlo hay que marcar **Confirmo el alcance y la nueva vigencia** y pulsar **Publicar
versión**. Se publica una versión nueva; las ventas anteriores conservan la que tenían.

## Sucursales y dispositivos

Las **Sucursales** representan los locales del comercio. Los **Dispositivos declarados** son los
equipos de esta estación.

> **Declarar una impresora fiscal no habilita la emisión real.** La pantalla misma lo dice. En
> esta versión, el documento lo produce un simulador, sin importar qué equipo declares.

---

# Tasas de cambio

## Para qué sirve

Registrar cuánto vale una moneda en términos de otra, para que se pueda cobrar en más de una.

## Cómo llegar

Grupo **Administración** → **Tasas**. Atajo: **Alt+9**.

## Qué ves

> 📷 **Captura pendiente** — `12-tasas.png`.
> *Texto alternativo previsto:* «Pantalla Tasas de cambio con el selector del par de monedas, la
> tasa vigente con su fuente y antigüedad, el histórico local y el panel de sugerencia externa
> marcado como PROPUESTA.»

## Paso a paso

### Ver la tasa vigente

Elige la moneda **Base** y la **Cotizada**. La pantalla muestra el **Valor**, la **Fuente**, desde
y hasta cuándo rige, la **Antigüedad local** y quién la registró.

### Cargar una tasa

1. En **Confirmar una tasa**, escribe el **Valor decimal**.
2. Indica **Vigente desde**. **Vigente hasta** es opcional: déjalo vacío si rige hasta que cargues
   otra.
3. Escribe el **Motivo**.
4. Confirma.

### La sugerencia externa

El sistema puede consultar una fuente externa y traer un valor. Aparece bajo **Sugerencia externa,
todavía no aplicada**, con el rótulo **PROPUESTA · no es la tasa vigente**.

**Una sugerencia no es una tasa.** No se aplica sola y no afecta ninguna venta mientras esté ahí.
Es una propuesta que tú confirmas o descartas:

- **Usar en el formulario** la copia abajo, para que la revises y la confirmes tú.
- **Descartar** la quita.

**Por qué el sistema nunca la toma solo:** una tasa equivocada no se nota en el momento; se nota
al cierre, cuando todo lo cobrado en esa moneda está mal convertido. Que una persona la confirme
es lo que deja a alguien respondiendo por ese número.

### Qué ve el cajero

Nada de esto. El cajero elige un medio de pago en otra moneda y la aplicación convierte con la
tasa vigente **en ese momento**. Esa tasa queda guardada dentro de la venta: si mañana la cambias,
las ventas de hoy no cambian.

## Qué pasa si sale mal

- **«No hay una tasa vigente registrada para ese par.»** — Nadie cargó una. Hazlo ahora; sin ella
  no se puede cobrar en esa moneda.
- **«La moneda base y la cotizada deben ser distintas.»**
- **«El código de moneda debe tener tres letras mayúsculas.»** — `USD`, `VES`.
- **«La vigencia hasta debe ser posterior a la vigencia desde.»**
- **«Escribe un valor decimal positivo con hasta 8 decimales.»**

---

# Identidad — operadores y roles

## Para qué sirve

Dar de alta a las personas que van a trabajar, decidir qué puede hacer cada una y entregarles su
acceso.

## Cómo llegar

Grupo **Administración** → **Identidad**. Atajo: **Alt+i** —con la letra *i*, no un número—.

## Qué ves

> 📷 **Captura pendiente** — `13-identidad.png`.
> *Texto alternativo previsto:* «Pantalla Operadores y roles con el panel de enrolamiento de
> credencial, la tabla de operadores con su código, nombre, acceso local y estado, y debajo la
> lista de roles con sus permisos.»

## Si la pantalla dice que la administración pertenece al coordinador

En una tienda con varias estaciones, **los operadores se administran en una sola**: la que la
tienda designó como coordinador. Si estás en otra, verás ese aviso.

No es un error ni algo que se pueda forzar. Ve a la estación coordinadora para dar de alta o
modificar personas. Lo que sí puedes hacer desde acá es **autorizar el enrolamiento** de alguien
que ya existe, para que active su credencial en esta terminal.

## Paso a paso

### Dar de alta un operador

1. Pulsa **Nuevo operador**.
2. Escribe el **Código de operador** —corto, el que la persona escribirá al entrar— y su **Nombre
   visible**.
3. Elige sus **Roles iniciales**.
4. Escribe el **Motivo**. El campo sugiere los habituales: *Ingreso de personal nuevo*,
   *Cobertura de vacante*.
5. Pulsa **Crear operador**.

La persona ya existe, pero **todavía no puede entrar**: le falta su credencial en la terminal
donde va a trabajar. Sigue en [entregar el acceso](#entregar-el-acceso-enrolamiento).

### Roles

Un **rol** es un conjunto de tareas habilitadas —«abrir y cerrar turnos», «cambiar precios», «ver
los cierres»—, que se asigna a una o más personas. Es más fácil de mantener que habilitar tareas
persona por persona: si cambia lo que hace un cargo, cambias el rol y cambia para todos.

1. Pulsa **Nuevo rol**.
2. Escribe su **Código** y su **Nombre**.
3. Marca sus **Permisos** en la lista.
4. Escribe el **Motivo** y pulsa **Crear rol**.

La lista de permisos es la lista de capacidades del sistema. Si dudas qué hace una, mira el
[anexo técnico](./anexo-tecnico.md).

**Lo que cambia para la persona se ve la próxima vez que entre.** Si está trabajando en ese
momento, tiene que salir y volver a entrar.

### Entregar el acceso (enrolamiento)

Un operador nuevo no tiene PIN. Tú se lo habilitas, pero **no se lo pones tú**: se lo pone él.

1. En **Enrolamiento de credencial**, elige el operador.
2. Escribe el **Motivo** y pulsa **Autorizar enrolamiento**.
3. Entrégale el código que aparece. Es de **un solo uso** y **caduca**.
4. La persona lo usa en la pantalla de ingreso de su terminal, con **Usar código de
   enrolamiento**, y elige su PIN ahí.

**Por qué caduca:** un código anotado y olvidado es una llave abierta. Si venció, emite otro; no
cuesta nada.

En la tabla de operadores, la columna **Acceso local** te dice en qué punto está cada uno:

| Lo que dice | Qué significa |
|---|---|
| **Credencial activa en esta terminal** | Puede entrar acá con su PIN |
| **Debe cambiar el PIN al ingresar** | Entrará, pero lo primero será cambiarlo |
| **Sin credencial local · requiere enrolamiento** | Falta entregarle un código |
| **Concedido por el coordinador · requiere enrolamiento** | El coordinador lo autorizó; falta que lo active acá |

### Restablecer un PIN olvidado

**No puedes ver el PIN de nadie, ni recuperarlo.** Nadie puede: se guarda de forma que no se puede
leer, ni siquiera desde dentro del sistema.

Lo que haces es autorizar un enrolamiento nuevo, igual que arriba. La persona elige un PIN nuevo y
el anterior deja de servir.

### Desactivar un operador

**Desactivar operador** deja a esa persona sin poder entrar. No se borra: todo lo que hizo se
conserva con su nombre, porque el historial de la tienda tiene que seguir siendo legible.

**Lo que no se puede deshacer:** desactivar al último administrador activo. El sistema lo rechaza
—quedaría una tienda que nadie puede administrar—.

### Qué queda registrado

Cada alta, cada cambio de rol, cada enrolamiento y cada desactivación quedan registrados con quién
lo hizo, cuándo, sobre quién y con qué motivo. Se consulta desde
[Reportes](./05-supervision-y-gerencia.md).

Por eso el **Motivo** es obligatorio en todas estas acciones: dentro de seis meses, «¿por qué esta
persona tiene este acceso?» tiene que poder responderse.

## Qué pasa si sale mal

- **«La administración de identidad pertenece al coordinador de la tienda.»** — Ve a la estación
  coordinadora.
- **«El cambio dejaría al sistema sin ningún administrador activo.»** — Nombra otro administrador
  antes.
- **«Ya existe un operador con ese código.»** — Búscalo; puede estar inactivo.
- **«Ese rol no se puede asignar mientras esté inactivo.»** — Actívalo primero.
- **«Revisa los datos: el motivo es obligatorio.»**
- **«El código de enrolamiento venció: pide uno nuevo.»** — Emite otro.
