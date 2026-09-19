# 5 · Supervisión y gerencia

Dos pantallas: **Reportes**, para revisar lo que pasó; y **Sync**, para saber si lo que ves está
al día.

---

# Reportes y cierres

## Para qué sirve

Revisar los cierres de caja y sus diferencias, ver qué se vendió y con qué margen, consultar qué
hizo cada persona, y emitir los reportes X y Z.

## Cuándo la vas a usar

Al cerrar el día, cuando una caja no cuadra, y cuando gerencia pregunta cómo fue la semana.

## Cómo llegar

Grupo **Supervisión y gerencia** → **Reportes**. Atajo: **Alt+8**.

## Qué ves

> 📷 **Captura pendiente** — `14-reportes.png`.
> *Texto alternativo previsto:* «Pantalla Reportes y cierres con el panel Período consultado
> arriba —los botones Hoy, Ayer, Últimos 7 días y Este mes, y los campos Desde, Hasta, Caja y
> Filas— y, debajo, las secciones de cierres de caja, auditoría, operaciones fiscales, ventas por
> moneda, margen por producto y existencia por artículo, con su botón de exportar salvo la
> fiscal.»

## Primero: el período

**Todo lo que veas depende del período de arriba.** Antes de leer cualquier número, fija:

- **Desde** y **Hasta**;
- **Caja**, si quieres una sola —opcional—;
- **Filas**, hasta 500.

Si un reporte sale vacío, lo primero que hay que revisar es el período.

**Los cuatro botones de arriba te ahorran escribir las fechas:** **Hoy**, **Ayer**, **Últimos 7
días** y **Este mes**. El que esté aplicado se ve marcado. Después pulsa **Consultar reportes**.

### El día es el de la tienda, no el de Greenwich

Las fechas que escribes son **el día del calendario de esta estación**: si pides el 18, el reporte
va del 18 a las 00:00 al 18 a las 23:59 según el reloj de la tienda. Y las horas que la pantalla
muestra —la apertura de un turno, el momento de una operación auditada— están escritas también en
esa hora, no en ninguna otra.

**No tienes que sumar ni restar horas.** Lo que lees es la hora a la que pasó, tal como la viviste.

Por debajo, la estación guarda cada momento en una referencia universal, para que dos estaciones
puedan compararse; pero eso es asunto suyo y no se te aparece en pantalla.

## Las secciones

Casi todas tienen su botón **Exportar CSV visible**, que descarga exactamente lo que estás viendo,
para abrirlo en una hoja de cálculo. **La excepción es operaciones fiscales**, que no se exporta:
se consulta en pantalla.

**Cada sección se consulta por separado.** Si una falla, muestra su propio error y las demás
siguen funcionando. No hay un estado «la pantalla falló».

### Cierres de caja y diferencias

Un turno por fila, con lo **Esperado**, lo **Declarado** y la **Diferencia**.

**Qué mirar cuando hay diferencia:** primero, si el cajero escribió un motivo. Después, los
movimientos de efectivo de ese turno: un retiro a caja fuerte sin registrar aparece como
faltante. Una diferencia repetida en la misma persona o la misma caja importa más que una grande
y aislada.

### Consultar el arqueo de un turno

Elige un turno del período y pulsa **Consultar arqueo** para ver ese cierre en detalle.

### Revisar la historia de una venta

Pega el identificador que muestra la pantalla de Venta al cerrar y pulsa **Revisar historia**.
Muestra por qué estados pasó esa venta. Útil cuando un cliente reclama y hay que reconstruir qué
ocurrió.

### Ventas completadas por moneda

Lo vendido, agrupado por la moneda de cada venta.

**Suma** las ventas completadas del período. **No suma** las ventas a medias ni las anuladas. Una
venta devuelta sigue apareciendo: la devolución es un documento aparte, no un borrado.

### Ingreso, costo y margen por producto

Por producto: cuánto ingresó, cuánto costó y la diferencia.

El **costo** sale de las recepciones documentadas, promediando lo que la tienda pagó. Por eso
**un producto puede aparecer sin costo**: si entró por una recepción simple o por un ajuste sin
costo, nadie le dijo al sistema cuánto valía. No es un error del reporte; es información que
faltó al registrar. Está explicado en el [capítulo 3](./03-inventario.md#registrar-una-compra).

### Existencia por artículo y lote

La existencia a la fecha de corte, con su lote.

**En qué se diferencia de la misma consulta en Inventario:** acá la ves a una fecha, exportable y
junto al resto de los reportes, para cerrar un período. En **Inventario** la ves ahora, para
trabajar. La de acá es la de **este nodo**: si la tienda tiene varias estaciones, es lo que esta
conoce.

### Auditoría de operaciones sensibles

Cada operación delicada con su **Actor**, su **Acción**, la **Entidad** afectada, el **Motivo** y
el **Terminal**.

Sirve para responder «¿quién hizo esto y por qué?»: un descuento fuera de lo común, un cambio de
precio, una devolución, un cambio de permisos.

**Lo que no muestra:** el contenido de la operación. Registra *que* algo cambió, no *a qué*
cambió. Si necesitas el detalle, está en la pantalla de esa operación.

### Operaciones fiscales y estados recuperables

Los documentos fiscales del período y en qué estado quedó cada uno.

**Una operación incierta** es una que se envió y no se sabe si llegó: la impresión no confirmó, o
la respuesta se cortó a medias. El sistema **no la repite solo**, a propósito: reintentar a ciegas
es lo que produce dos documentos por una misma venta.

**Qué se espera de un supervisor:** revisar el caso, comprobar si el documento existe, y
resolverlo con quien administra la estación. Mientras tanto, la venta y su cobro están firmes; lo
único en duda es el documento.

### Reportes X y Z

> **Este sistema opera en modo simulado.** Las facturas, notas y reportes X y Z que emite son
> ejercicios de práctica: no tienen validez fiscal ni legal, aunque se vean como los de verdad. La
> aplicación lo dice en pantalla con el rótulo **SIMULACIÓN**, y ese rótulo no se puede quitar.

- **Reporte X** — un resumen de lo vendido hasta ese momento. **No cierra nada**; puedes pedir
  todos los que quieras durante el día.
- **Reporte Z** — el cierre del día fiscal. **Una vez emitido, ese día queda cerrado.**

Para emitir cualquiera de los dos hay que marcar **Confirmo que ejecutaré una simulación y que su
resultado no es un cierre fiscal legal** y pulsar **Solicitar X simulado** o **Solicitar Z
simulado**.

**Si esta sección no aparece**, no es que te falte autorización: la estación se arrancó sin
habilitar los reportes simulados. Lo puedes confirmar en **Inicio**, en **Estado de la estación**,
donde dice si los **Reportes X/Z** están habilitados. Lo cambia quien administra, al arrancar la
estación.

### Estado de sincronización del nodo

Un resumen rápido de si esta estación está al día. El detalle está en la pantalla siguiente.

## Qué pasa si sale mal

- **Una sección dice «Sin … en el período consultado»** — No hay datos en ese rango. Revisa las
  fechas: **Hasta** tiene que incluir el día que buscas, y un turno que abrió ayer y cerró hoy
  aparece en el día en que cerró.
- **«La venta no tiene versiones consultables.»** — Ese identificador no corresponde a una venta
  con historia, o está mal copiado.
- **«El reporte fiscal simulado falló; revisa su estado.»** — Mira la sección de operaciones
  fiscales para ver en qué quedó. **No lo repitas sin mirar.**

---

# Sincronización entre nodos

## Para qué sirve

Saber si lo que esta estación registró ya llegó al coordinador, y qué está esperando.

## Cuándo la vas a usar

Cuando un número no coincide entre dos estaciones, cuando hubo un corte de red, y cuando quieras
confirmar que lo de hoy ya está arriba.

## Cómo llegar

Grupo **Supervisión y gerencia** → **Sync**. Atajo: **Alt+s** —con la letra *s*—.

## Primero: cómo funciona esto

Cada caja vende **por su cuenta**. No le pide permiso a nadie para cobrar, y por eso sigue
funcionando aunque la red se caiga. Después le cuenta al **coordinador** lo que hizo.

De ahí sale lo único que hay que entender de esta pantalla: **puede haber un retraso entre lo que
se ve en una caja y lo que ve el coordinador**. Ese retraso es normal, no es un error, y no
significa que algo se haya perdido. Lo pendiente se guarda y se entrega cuando la red vuelve; y
aunque se entregue dos veces, no se cuenta dos veces.

## Qué ves

> 📷 **Captura pendiente** — `15-sync.png`.
> *Texto alternativo previsto:* «Pantalla Sincronización entre nodos con el nodo consultado, el
> estado del enlace, la tabla de entregas hacia el destino con sus intentos y próximo intento, y
> los paneles de antigüedad de referencias y operaciones pendientes.»

## Las secciones

### Nodo consultado

Qué estación estás mirando. Escribe el destino —normalmente el coordinador— y consulta.

### Estado del enlace

| Lo que dice | Qué significa |
|---|---|
| **Al día** | El último ciclo no dejó nada pendiente |
| **Sincronizando** | Hay algo en camino ahora mismo |
| **Conectando** | Intentando conectar; todavía no promete entrega |
| **Sin contacto** | El destino no respondió en el último ciclo. **La operación local continúa** |
| **Requiere atención** | Hay algo que una persona tiene que resolver |

**Sin contacto no es una emergencia.** Se puede seguir vendiendo con normalidad. Se vuelve un
problema si dura: un turno entero sin contacto ya merece un aviso.

**Quedarse sin LAN no es lo mismo que quedarse sin Internet.** Sin LAN, esta estación no alcanza
al coordinador: lo de hoy no sube, pero todo lo local sigue. Sin Internet, lo que se pierde son
los servicios de afuera —como la sugerencia de tasa—, y la sincronización entre estaciones sigue
funcionando. La pantalla distingue las dos cosas; si dice **Sin contacto**, el problema es de la
red de la tienda.

### Ventas completadas que requieren atención

Ventas que se cobraron bien pero cuyo efecto quedó en duda. Cada una dice por qué está ahí:
entrega pendiente, entrega pausada, aplicación remota sin confirmar, discrepancia abierta.

**Qué se espera del supervisor:** no hace falta tocar nada de inmediato — la mayoría se resuelve
sola cuando vuelve la red. Si una lleva horas ahí, o dice **Discrepancia abierta**, hay que
escalarla a quien administra.

### Entregas hacia el destino

Una fila por hecho pendiente, con su **Estado** —En cola, Enviando, Entregada, Bloqueada, En
pausa—, sus **Intentos** y su **Próximo intento**.

**Léelo como «cuándo lo va a volver a intentar».** No hay que hacer nada para que reintente: lo
hace solo, espaciando los intentos.

**Si los intentos se agotaron**, la entrega queda **Bloqueada** o **En pausa** y deja de
reintentar sola. Ahí sí hace falta una persona: escálalo, no lo dejes esperando.

### Recorrido de una operación

Pega el identificador de un fallo y sigue por dónde pasó: qué se registró, qué se envió, qué
confirmó el destino. Sirve para responder «¿dónde se quedó esto?» sin conjeturas.

### Antigüedad de lo recibido

Qué tan viejo es lo que esta estación recibió del coordinador: la tasa de cambio, las concesiones
de operador, la disponibilidad.

**Un dato viejo no es un error**: si nada cambió, no hay nada que enviar. Preocúpate cuando diga
**Nunca recibida**, o cuando una referencia aparezca **Vencida**.

**Una referencia vencida no se rehabilita porque el nodo vuelva a conectarse.** Hay que registrar
una nueva. Con la tasa vencida no se puede convertir; con las concesiones vencidas no se abren
sesiones nuevas.

### Pendientes de conciliación

Casos donde el sistema **prefiere detenerse antes que adivinar**: dos versiones de un mismo hecho
que no coinciden, o un efecto que no puede darse por aplicado ni por fallido.

No se resuelven solos y no se resuelven desde esta pantalla. Los resuelve quien administra la
estación, con los runbooks de operación. Lo que a ti te toca es verlos y avisar.

## Qué pasa si sale mal

- **«Esta sesión no tiene permiso para revisar la recepción.»** — Puedes ver el envío pero no lo
  que llega. Pide el acceso si lo necesitas.
- **«Consulta un destino para ver su estado.»** — No has consultado todavía. Escribe el destino.
- **«Sin entregas materializadas para este destino.»** — No hay nada pendiente. Es la buena
  noticia.
- **No hay conexión con el nodo local** — Este es distinto y más grave: no falla la red de la
  tienda, falla el programa de *esta* estación. Avisa a quien administra.
