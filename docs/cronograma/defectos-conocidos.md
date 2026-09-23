# Defectos conocidos

Registro de defectos encontrados y **no** corregidos, con su reproducción y la fase dueña. Un
defecto sale de aquí cuando existe la corrección con su prueba, no cuando se explica.

Los defectos ya corregidos no se listan: viven en el historial y en la decisión normativa que los
resolvió. Los números tampoco se reutilizan: un hueco en la serie significa un defecto corregido,
y cualquier referencia anterior conserva lo que decía.

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

**Alcance medido — 2026-09-18.** Los seis de arriba son los que 12B encontró **operando**. Un
barrido de los contratos de `packages/shared/src/http/v1` contra el mapa del renderer mide el
tamaño real: de **152 códigos de error declarados, 90 no tienen frase propia**. No todos alcanzan
a un operador —muchos son validaciones que la pantalla impide, o códigos de administración de
nodos—, pero **la devolución completa está sin traducir**:
`SALE_RETURN_MIXED_PAYMENT_UNSUPPORTED`, `SALE_RETURN_DOCUMENT_NOT_ISSUED`,
`SALE_RETURN_REASON_REQUIRED`, `SALE_RETURN_STOCK_NOT_RESTORABLE` y `SHIFT_NOT_OPEN`.

La corrección no es «seis entradas» sino una decisión sobre qué códigos merecen frase; la lista
medida está en el acopio de
[12B.10](./fase-12b-manual-usuario/12b.10-absorcion-y-verificacion.md#acopio-de-hallazgos-de-interfaz--2026-09-18).

## D-006 · El kardex muestra identificadores internos al operador

- **Estado:** abierto desde el 2026-09-18.
- **Fase dueña:** Fase 9B (pantallas de operación).
- **Pantalla:** Inventario (`Alt+5`), tabla de movimientos.
- **Severidad:** no produce datos incorrectos; deja ilegible la pantalla que responde «de dónde
  salió esto».

La tabla imprime `movement.type` y `movement.direction` crudos
(`apps/desktop/src/renderer/src/screens/inventory.tsx`, columnas **Tipo** y **Dirección**), de modo
que quien recibe mercancía lee `PURCHASE_RECEIPT`, `SALE_ISSUE`, `WASTE`, `ADJUSTMENT_IN`,
`ADJUSTMENT_OUT`, `IN` y `OUT` en inglés y sin traducir.

**Reproducción:** consultar el kardex de cualquier producto con movimientos.

**Por qué no se corrigió aquí:** 12B es documental. El
[capítulo 3](../operacion/manual-usuario/03-inventario.md#ver-el-movimiento-de-un-producto)
traduce las siete palabras en el cuerpo —única forma de que se entiendan— y declara que están sin
traducir, en vez de fingir que el operador las reconoce.

## D-007 · El campo de descuento pide puntos base bajo una etiqueta que dice «Porcentaje»

- **Estado:** abierto desde el 2026-09-18.
- **Fase dueña:** Fase 9B (pantallas de operación).
- **Pantalla:** Venta (`Alt+2`), diálogo **Descuento de línea**.
- **Severidad:** produce un descuento cien veces menor que el pretendido, sin aviso.

El campo se rotula **Porcentaje (puntos base)** y envía el valor tal cual
(`screens/sales.tsx`: `basisPoints: Number(discountBasisPoints)`, `min="1" max="10000"`). Un cajero
que escriba `10` creyendo dar 10 % aplica 0,10 %. El valor es válido, la venta lo acepta y nada
señala el error: el total apenas se mueve.

**Reproducción:** aplicar un descuento de línea escribiendo `10` y leer el total.

**Lo que agrava el caso:** `percentToBasisPoints` ya existe en
`screens/shared.tsx` y hace exactamente esa conversión; el diálogo no la usa.

**Por qué no se corrigió aquí:** cambiar qué acepta un campo cambia comportamiento observable, que
es lo que 12B tiene fuera de alcance. El
[capítulo 2](../operacion/manual-usuario/02-caja.md#corregir-el-ticket) enseña la conversión con
una tabla, que es lo mejor que puede hacer un manual.

## D-008 · Cerrar un turno descuadrado se rechaza sin decir que la causa es la diferencia

- **Estado:** abierto desde el 2026-09-18.
- **Fase dueña:** decisión compartida —el nodo necesita un código propio y el renderer su frase—.
- **Pantalla:** Caja (`Alt+3`), **Declarar efectivo para cerrar**.
- **Severidad:** el cajero no sabe qué le falta, y el camino de salida —forzar el saldo declarado—
  es justamente el que corrompe el arqueo.

`CloseShift` exige `cash.shift.close.difference` cuando lo declarado no coincide con lo esperado en
algún método, o cuando algún saldo esperado es negativo, y rechaza con `FORBIDDEN`
(`packages/core/src/application/cash/close-shift.ts`). El operador lee **No tienes autorización
para esta operación**, la misma frase que para cualquier otro permiso: nada nombra la diferencia.

**Reproducción:** con un usuario sin `cash.shift.close.difference`, abrir un turno, registrar una
venta en efectivo y cerrar declarando un saldo distinto del esperado.

**Por qué importa más de lo que parece:** la salida obvia para el cajero es escribir el saldo que
cuadra. Eso convierte un descuadre visible y auditado en uno invisible.

**Por qué no se corrigió aquí:** exige un código de error nuevo en el nodo, no solo una frase. El
[capítulo 2](../operacion/manual-usuario/02-caja.md#cerrar-el-turno-con-arqueo) advierte de la
situación y le dice al cajero que no fuerce el número.

## D-009 · Una venta cobrada con más de un método de pago no se puede devolver

- **Estado:** abierto desde el 2026-09-18.
- **Fase dueña:** Fase 9B para la frase; la limitación en sí es una decisión de alcance sin
  declarar.
- **Pantalla:** Venta (`Alt+2`), **Devolver venta completa**.
- **Severidad:** deja sin salida una devolución legítima, con un mensaje que no la explica.

`ReturnSale` rechaza con `SALE_RETURN_MIXED_PAYMENT_UNSUPPORTED` —«A sale settled with more than
one payment cannot be returned in this release»— toda venta con más de un pago
(`packages/core/src/application/sales/return-sale.ts`). El código no está en el mapa de mensajes,
así que el operador lee «La operación no pudo completarse.» y no tiene forma de saber que la causa
es el pago mixto.

**Reproducción:** completar una venta cobrada con dos métodos, emitir su factura e intentar
devolverla.

**Lo que hay que decidir, no solo traducir:** el mensaje dice «in this release», pero ninguna
decisión documentada declara esa limitación ni su plazo. Mientras eso no exista, el manual no
puede decirle al operador si es temporal o definitiva, así que hoy no lo menciona.

## D-010 · Dos contratos declaran un código de error que su ruta no emite

- **Estado:** abierto desde el 2026-09-18.
- **Fase dueña:** contratos compartidos (`packages/shared/src/http/v1`).
- **Severidad:** no afecta al operador; engaña a quien escriba un cliente o un mapa de mensajes
  leyendo el contrato.

| Contrato | Declara | El código que la ruta emite de verdad |
|---|---|---|
| `applySaleDiscountContract` | `DISCOUNT_EXCEEDS_POLICY` | `SALE_DISCOUNT_EXCEEDS_LIMIT` (`domain/sales/sale.ts`) |
| `addSaleItemContract` | `QUANTITY_SCALE_MISMATCH` | `SALE_ITEM_QUANTITY_SCALE_MISMATCH` (`domain/sales/sale-item.ts`) |

`DISCOUNT_EXCEEDS_POLICY` **no aparece en ninguna otra parte del árbol**: nada lo lanza.
`QUANTITY_SCALE_MISMATCH` sí existe, pero lo lanza la aritmética de `Quantity`, no la validación de
la línea de venta. Las rutas propagan `error.code` sin traducir
(`apps/server/src/routes/sales.ts`), de modo que lo que llega al cliente es el código del dominio.

**Reproducción:** aplicar un descuento por encima del tope y leer el `code` de la respuesta.

**Cómo se encontró:** al construir la correspondencia mensaje↔código del anexo del manual, que se
verificó contra el dominio y no contra el contrato.
