# Rediseño de la pantalla de venta

- **Estado:** dirección aceptada el 2026-09-10; ejecución **posterior** a `v0.1.0`.
- **Origen:** exploración de tres direcciones sobre el sistema visual vigente.
- **Fuentes de diseño:** [`design/`](../../design) — `Main.dc.html` es la dirección elegida.
- **Índice:** [Cronograma maestro](./README.md).

## Por qué

La disposición de tres zonas —ticket, catálogo y cobro— no cabe en la ventana por
defecto. Los cortes responsive miden el **viewport**, pero lo que se estrecha es el área de
trabajo: a 1200 px de ventana quedan 888 px útiles después de la barra lateral (236) y el
padding (76), y las tres columnas exigen 330 + 300 + 320 más separaciones, unos 978 px.

## Dirección elegida: el cobro deja de ser columna

El cobro baja a una **barra de ancho completo** al pie del área de trabajo, y el espacio
queda para dos zonas: ticket y catálogo. Se descartaron dos alternativas: el cobro como
hoja que entra al pulsar «Cobrar» —un paso más en el gesto más repetido del día— y el
ticket dominante con el catálogo en cajón —el cajón tapa el ticket justo cuando hay que
comparar contra él—.

### Captura del cobro: se agrega un pago a la vez

El hueco de la dirección elegida era el pago mixto: con dos métodos, una barra de una fila
crece y empuja el área de trabajo a mitad de una venta. No se resuelve agrandando la barra
sino cambiando la captura.

Hoy la pantalla pide los dos importes a la vez. Pasa a **agregar un pago, recalcular el
resto y agregar el siguiente**, con cada pago como una ficha que se puede quitar. La fila de
fichas está siempre presente, con su vacío escrito, de modo que la altura de la barra no
cambia entre un método y varios.

**Esto no toca el dominio.** `Sale.registerPayments` acepta los pagos una sola vez
(`SALE_PAYMENTS_ALREADY_REGISTERED`); las fichas se acumulan en la pantalla y se envían
juntas como un lote al final. El invariante del lote exacto queda intacto.

## Lo que exige del nodo

`PaymentMethodResponse` gana la tasa que ese método cobra:

```
financialTransactionTaxBasisPoints: number   // 0 si el método no está gravado
```

`GET /api/v1/currency/payment-methods` ya es una lectura sin permiso que la pantalla de
venta consume, así que no hace falta endpoint ni permiso nuevo, y el dato llega donde la
interfaz lo necesita: la marca «+IGTF» es un campo del método, no una política que la
pantalla deba interpretar.

## Decisión pendiente de ADR

Con esa tasa la pantalla **etiqueta y sugiere**: muestra la marca y precarga el importe con
el impuesto incluido. Sugerir implica reimplementar la fórmula de
[ADR-0031](../architecture/adr/0031-base-del-igtf-en-pagos-mixtos.md) en un segundo lugar, y
[`operacion-diaria.md`](../operacion/operacion-diaria.md) declara que la pantalla nunca hace
aritmética de negocio.

Antes de escribir esa parte, ADR-0031 se enmienda para declarar que el renderer puede
producir una sugerencia **no autoritativa** a partir de la tasa publicada, y que el nodo
sigue siendo la única autoridad: recalcula y rechaza un lote que no cuadre. La enmienda
llega con una prueba que compara la sugerencia de la pantalla contra el cálculo del nodo,
para que las dos implementaciones no se separen en silencio.

## Alcance

- **Entra:** barra de cobro, captura de un pago a la vez, tasa por método, enmienda de
  ADR-0031 con su prueba, la barra lateral contraíble que devuelve los 236 px, y
  [D-003](./defectos-conocidos.md): acotar el `overflow: hidden` a la disposición de tres zonas
  para que la venta ya completada pueda desplazarse.
- **No entra:** cambios en el agregado `Sale`, en el protocolo de sincronización ni en la
  fiscalidad simulada.

## Secuencia

Después de publicar `v0.1.0`. El único pendiente del release son las capturas de la demo en
entorno limpio, y rehacer la pantalla antes las dejaría obsoletas a los dos días.
