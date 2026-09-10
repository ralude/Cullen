# Defectos conocidos

Registro de defectos encontrados y **no** corregidos, con su reproducción y la fase dueña. Un
defecto sale de aquí cuando existe la corrección con su prueba, no cuando se explica.

Los defectos ya corregidos no se listan: viven en el historial y en la decisión normativa que los
resolvió.

## D-001 · La pantalla de venta no envía la tasa de cambio de un pago en otra moneda

- **Estado:** abierto desde el 2026-09-09.
- **Dueña:** Fase 9B (pantallas de operación). No bloquea `v0.1.0`.
- **Severidad:** el camino queda inalcanzable, no produce un importe incorrecto.

`RegisterMixedPayment` exige una tasa explícita cuando la moneda del pago difiere de la de la
venta —`EXCHANGE_RATE_REQUIRED`—, y el contrato
`POST /api/v1/sales/:saleId/payments` acepta `exchangeRateId` por pago. La pantalla
([`screens/sales.tsx`](../../apps/desktop/src/renderer/src/screens/sales.tsx), armado del lote de
pagos) nunca lo envía, y tampoco ofrece un control para elegir o confirmar la tasa.

**Reproducción:** configurar un método de pago en una moneda distinta a la de la venta y cobrar
con él. La petición falla con `EXCHANGE_RATE_REQUIRED`.

**Por qué no se corrigió con el defecto del IGTF:** habilitarlo destaparía **D-002**, que sí
produciría importes incorrectos. Los dos se corrigen juntos o ninguno.

Existe `GET /api/v1/currency/exchange-rates/current`, sin permiso requerido, de modo que la
corrección no necesita contrato nuevo: la pantalla resuelve la tasa vigente del par, la muestra
con su fuente y vigencia —como exige `AGENTS.md`— y envía su identificador.

## D-002 · El importe de un pago se interpreta con la escala de la moneda de venta

- **Estado:** abierto desde el 2026-09-09.
- **Dueña:** decisión de dominio pendiente; ver abajo.
- **Severidad:** latente. Hoy es inalcanzable porque **D-001** cierra el único camino que lo
  activa.

La pantalla de venta parsea **los dos** importes del lote con `scale`, que sale del campo «Escala
visible» y describe la **moneda de la venta**. Si el segundo método opera en otra moneda con otra
escala de unidad menor, el importe se convierte con el factor equivocado.

**La causa no está en la pantalla:** el sistema no tiene ninguna fuente de verdad para la escala
de unidad menor de una moneda. `PaymentMethod` no la modela, `PaymentMethodResponse` no la
publica, y el resto de las pantallas asume 2 —`screens/cash.tsx` la escribe literal y
`screens/catalog.tsx` la fija en una constante—.

Corregirlo de verdad exige decidir **dónde vive la escala de una moneda** y propagarla por el
dominio, el contrato y las pantallas. Eso es una decisión de dominio con su ADR, no un arreglo de
renderer, y no se toma dentro de una ventana de publicación.

**Mientras tanto:** con todas las monedas en escala 2 —lo que hoy siembra
`bootstrap-operations`— el defecto no se manifiesta.

## D-003 · La venta completada no se puede desplazar y su pie queda cortado

- **Estado:** abierto desde el 2026-09-10.
- **Dueña:** [rediseño de la pantalla de venta](./rediseno-pantalla-de-venta.md), posterior a
  `v0.1.0`. No bloquea la publicación.
- **Severidad:** deja «Devolver venta» fuera de alcance en una ventana de altura corriente. No
  produce importes incorrectos ni pierde evidencia: la devolución sigue existiendo en el nodo y
  la pantalla la ofrece, sólo que debajo del borde.

La pantalla de venta desactiva el desplazamiento **a propósito**, porque sus tres zonas —ticket,
catálogo y cobro— están dimensionadas para caber sin mover la página:

```css
/* apps/desktop/src/renderer/src/styles.css */
.sales-shell .workspace-content { min-height: 0; overflow: hidden; padding: 16px 18px; }
```

Al completar la venta, esa misma cáscara deja de mostrar las tres zonas y pasa a una sola columna
alta —importe, identificadores, documento fiscal y la acción sensible de devolver—. Esa columna
sí desborda, y el `overflow: hidden` la recorta sin dejar bajar.

**Reproducción:** completar una venta y emitir su factura en una ventana de ~1000 px de alto. El
bloque «Devolver venta» aparece mordido por el borde inferior y la rueda del ratón no mueve nada.

**Por qué entra con el rediseño y no antes:** la regla es correcta para el punto de venta y
equivocada para la vista posterior, así que la corrección es acotar el `overflow: hidden` a la
disposición de tres zonas en lugar de aplicarlo a la pantalla entera. El rediseño ya reordena
esa cáscara —barra de cobro a lo ancho y barra lateral contraíble—, y separar ahí las dos vistas
evita arreglar dos veces la misma cáscara.

## Cómo se relacionan

D-001 tapa a D-002. Corregir solo D-001 convertiría un camino bloqueado en uno que acepta
importes incorrectos, que es peor. La secuencia correcta es: decidir la escala de moneda (ADR),
propagarla, y recién entonces habilitar el pago en otra moneda con su tasa visible.

D-003 no se relaciona con ninguno de los dos: es de presentación, vive en una hoja de estilos y
se corrige sola.
