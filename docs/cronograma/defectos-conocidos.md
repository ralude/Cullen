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

## D-005 · La prueba de frontera del renderer agota su tiempo dentro de la suite completa

**Observado:** 2026-09-17, durante la verificación de cierre de 12.03.

`tests/eslint-boundaries.test.ts` → «renderer import boundary › rejects @supermarket/core» falló
con `Test timed out in 5000ms` en tres de cuatro corridas de `pnpm test`, incluida una con la
estación completamente libre. Es siempre el **primer** caso del archivo; los otros diez pasan.
Corrido aislado, el archivo entero pasa en 2,9 s y ese caso tarda 1,6 s.

**Reproducción:** con la suite completa, donde 202 archivos corren en paralelo. Aisladamente no
reproduce.

**Hipótesis, sin confirmar:** el primer caso paga el arranque en frío de ESLint —construir la
configuración del repositorio y cargar el parser de TypeScript— dentro del tiempo de espera por
omisión de 5 s, que el resto de los casos ya no paga porque reutilizan ese trabajo. Con los
trabajadores de vitest compitiendo, ese arranque se pasa del límite.

**Por qué no se corrigió aquí:** es ajeno al alcance de 12.03, que no toca fronteras ni
configuración de lint, y la suite de la revisión anterior —`17e1238`, sin ninguno de estos
cambios— también falla en esta estación, allí con dos pruebas del arnés. El fallo no lo
introdujeron los cortes. La corrección probable es declarar un tiempo de espera propio para ese
archivo, como ya hacen las pruebas lentas del arnés, pero eso es una decisión de quien atienda la
fragilidad de la suite y no un efecto lateral de una optimización.

## D-006 · La prueba del gate de aislamiento falla cuando la estación está libre

**Observado:** 2026-09-17, verificando el corte de persistencia de 12.05.03 con la máquina ya
desocupada para la campaña A/B de 12.03.

`apps/server/perf/measure.test.ts` → «aborta una serie que la estación no puede medir aislada»
falló con `expected true to be false`. La prueba corre el arnés con `--max-load 0` y espera
`PERF_STATION_BUSY`; el arnés aborta cuando la ocupación **supera** el límite, así que con la
estación al 0 % la comparación `0 > 0` es falsa, la serie corre y la prueba no encuentra el
fallo que esperaba.

**Reproducción:** con la estación realmente desocupada. Con cualquier carga de fondo —que es la
condición habitual de una máquina de trabajo— la prueba pasa. También falló el mismo día en la
revisión `17e1238`, sin ninguno de los cambios de 12.03 ni de 12.05.

**Causa, verificada:** la prueba supone que la estación nunca marca exactamente 0 %, y `--max-load`
no admite un valor que exprese «aborta siempre», porque su mínimo es 0. El gate en sí funciona:
es su prueba la que no puede forzarlo de forma determinista.

**Por qué no se corrigió aquí:** el arnés pertenece a 12.01 y el corte que la destapó es de
persistencia. La corrección no es subir un número: exige decidir cómo se fuerza el gate en una
prueba —un umbral que signifique «siempre», una carga inyectada o una comprobación del cálculo
en vez de la corrida entera—, y eso es trabajo de quien atienda el arnés. Queda registrado para
que nadie lea este fallo como una regresión del código de negocio.

## Cómo se relacionan

D-001 tapa a D-002. Corregir solo D-001 convertiría un camino bloqueado en uno que acepta
importes incorrectos, que es peor. La secuencia correcta es: decidir la escala de moneda (ADR),
propagarla, y recién entonces habilitar el pago en otra moneda con su tasa visible.
