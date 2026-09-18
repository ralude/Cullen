# Defectos conocidos

Registro de defectos encontrados y **no** corregidos, con su reproducción y la fase dueña. Un
defecto sale de aquí cuando existe la corrección con su prueba, no cuando se explica.

Los defectos ya corregidos no se listan: viven en el historial y en la decisión normativa que los
resolvió. Los números tampoco se reutilizan: un hueco en la serie significa un defecto corregido,
y cualquier referencia anterior conserva lo que decía.

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

## D-003 · Una venta que cobró IGTF no puede emitir su factura

- **Estado:** abierto desde el 2026-09-12.
- **Dueña:** decisión normativa pendiente —cómo representa el IGTF un documento fiscal—; ver
  abajo. No la toma 12.01, que solo lo encontró al instrumentar la jornada.
- **Severidad:** deja inalcanzable el cierre de la venta gravada —factura y, con ella,
  devolución—; no produce importes incorrectos.

`IssueSaleInvoice` deriva el contenido de la venta: las líneas salen de los snapshots congelados
y `totalMinorUnits` de `sale.total`, que por [ADR-0031](../architecture/adr/0031-base-del-igtf-en-pagos-mixtos.md)
es `commercialTotal + IGTF`. `FiscalDocument` exige que la suma de líneas, el total y la suma de
pagos sean el mismo entero. Con IGTF mayor que cero la suma de líneas es la porción comercial y
el total la incluye gravada: el invariante no puede cumplirse y la emisión aborta.

La causa no es la traducción sino el contenido: `FiscalDocumentContent` no tiene dónde declarar
el IGTF —ni campo propio ni línea—, así que el contrato genérico
`POST /api/v1/fiscal/documents` está igual de bloqueado.

**Reproducción:** activar la política de IGTF (3% sobre `CARD_USD`/`USD`), abrir una venta,
agregar una línea, cobrarla mitad en efectivo y mitad con el método gravado —el importe con
tarjeta incluye su IGTF, como fija ADR-0031—, completarla y emitir:

```
POST /api/v1/sales/:saleId/fiscal-document  →  400 FISCAL_TOTALS_INCONSISTENT
```

**Alcance real:** la pantalla de venta emite la factura al completar
([`api-client.ts`](../../apps/desktop/src/renderer/src/api-client.ts), `issueSaleInvoice`), y
`ReturnSale` exige el documento `('INVOICE', saleId)` en estado `ISSUED`, de modo que una venta
gravada tampoco puede devolverse. Sin política de IGTF configurada el defecto no se manifiesta:
`bootstrap-operations` solo la activa con `--igtf-basis-points` mayor que cero.

**Por qué no se corrigió aquí:** decidir si el IGTF viaja como campo del documento, como línea o
de otra forma cambia el contenido fiscal, el protocolo del dispositivo y la nota de crédito que
se deriva de él. Es una decisión normativa con su ADR, no un ajuste del emisor, y 12.01 tiene
fuera de alcance cambiar contratos. Mientras tanto la jornada medida cobra con dos métodos no
gravados y lo declara: ver [12.01](./fase-12-optimizacion/12.01-profiler-baseline.md).

## D-004 · Una prueba E2E de LAN falla de forma intermitente bajo carga

**Observado:** 2026-09-16, durante la validación del corte de aislamiento de 12.01.

`src/sync/lan-sync.e2e.test.ts` → «corta entre cada paso de compra, conteo y devolución y recupera
la misma intención» falló una vez con `expected 'PENDING' to be 'PUBLISHED'`. La misma prueba había
pasado minutos antes dentro de la suite completa, y corrida aislada pasó junto a las otras dieciséis
de su archivo.

**Reproducción:** no determinista. Se observó con la suite completa en paralelo y la estación
ocupada por otras aplicaciones. Aisladamente no reproduce.

**Hipótesis, sin confirmar:** el paso espera que una entrega alcance `PUBLISHED` y la lectura ocurre
antes de que el relay complete su reintento; bajo contención de CPU el margen se agota. No se
instrumentó para confirmarlo: eso es trabajo de quien atienda el defecto.

**Por qué no se corrigió aquí:** es ajeno al alcance del corte que lo destapó —12.01 no toca código
de sincronización— y ajustar una espera de prueba sin entender la causa puede esconder un defecto
real de reintento. Queda registrado para que nadie lo lea como un fallo introducido por las
mediciones ni como una prueba estable.

## D-005 · Seis situaciones frecuentes muestran un mensaje genérico al operador

- **Estado:** abierto desde el 2026-09-18.
- **Fase dueña:** producto —el mapa de mensajes del renderer—. 12B lo encontró y lo documenta; no
  lo corrige, porque es una fase documental.

**Observado:** 2026-09-18, al escribir el capítulo de fallos del manual de usuario (12B.09).

El mapa de mensajes del renderer (`apps/desktop/src/renderer/src/screens/shared.tsx`) no tiene
entrada para seis códigos que el nodo sí devuelve, así que el operador lee
«La operación no pudo completarse.» y no puede distinguir entre ellos:

| Situación que vive el operador | Código sin frase |
|---|---|
| Falta la política de cobro y la venta no se puede completar | `POLICY_NOT_CONFIGURED` |
| La estación no tiene su caja declarada | `CASH_REGISTER_NOT_FOUND` |
| El descuento de línea supera el tope configurado | `SALE_DISCOUNT_EXCEEDS_LIMIT` |
| La venta ya fue devuelta | `SALE_ALREADY_RETURNED` |
| Reintento con una clave de idempotencia distinta | `IDEMPOTENCY_KEY_CONFLICT` |
| Escritura sobre un agregado de otro nodo | `AGGREGATE_OWNER_MISMATCH` |

**Por qué importa:** las tres primeras son las más frecuentes en una instalación nueva. Un cajero
que no puede cobrar no tiene forma de saber si falta configuración, si su descuento se pasó del
tope o si hay otra cosa; solo le queda el código de seguimiento.

**Reproducción:** completar una venta en una base sin política de IGTF configurada; o aplicar un
descuento por encima del tope.

**Por qué no se corrigió aquí:** 12B es documental y no toca código de producto. La corrección son
seis entradas en el mapa de mensajes, con su prueba. El manual declara el vacío en vez de
disimularlo, en
[«Lo que el manual no puede resolver»](../operacion/manual-usuario/06-cuando-algo-falla.md#lo-que-el-manual-no-puede-resolver).

## Cómo se relacionan

D-001 tapa a D-002. Corregir solo D-001 convertiría un camino bloqueado en uno que acepta
importes incorrectos, que es peor. La secuencia correcta es: decidir la escala de moneda (ADR),
propagarla, y recién entonces habilitar el pago en otra moneda con su tasa visible.
