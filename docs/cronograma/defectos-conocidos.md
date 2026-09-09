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

## Cómo se relacionan

D-001 tapa a D-002. Corregir solo D-001 convertiría un camino bloqueado en uno que acepta
importes incorrectos, que es peor. La secuencia correcta es: decidir la escala de moneda (ADR),
propagarla, y recién entonces habilitar el pago en otra moneda con su tasa visible.
