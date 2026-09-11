# ADR-0031: Base del IGTF en pagos mixtos

- Estado: **Aceptado**; **enmendado el 2026-09-11** (ver [Enmienda](#enmienda-2026-09-11-la-pantalla-puede-sugerir-el-importe-gravado)).
- Fecha: 2026-09-09
- Reemplaza el cálculo implícito que `RegisterMixedPayment` traía desde la sub-fase 2.04.

## Contexto

`RegisterMixedPayment` calculaba el IGTF aplicando la tasa **sobre el importe entregado** con los
métodos elegibles, y `Sale.registerPayments` exige que el lote de pagos iguale exactamente
`commercialTotal + IGTF`. Las dos reglas juntas son circulares: el importe entregado tiene que
incluir un impuesto que se calcula sobre ese mismo importe.

En una venta de 100,00 con IGTF del 3% sobre tarjeta, un cobro mitad y mitad se comporta así:

| Entregado | Resultado |
| --- | --- |
| 50,00 efectivo + 50,00 tarjeta | `SALE_PAYMENT_TOTAL_MISMATCH` |
| 50,00 efectivo + 51,50 tarjeta («sumo el 3%») | `SALE_PAYMENT_TOTAL_MISMATCH` |
| 50,00 efectivo + 51,51 … 51,54 tarjeta | `SALE_PAYMENT_TOTAL_MISMATCH` |
| 50,00 efectivo + **51,55** tarjeta | aceptado |

El único importe aceptable era el punto fijo de `X = 5000 + redondeo(0,03·X)`. Ninguna regla que
un cajero pueda aplicar lo produce.

Los dos casos que sí funcionaban lo hacían por accidente. Si toda la venta se pagaba con el método
gravado, un recorte —`min(entregado, commercialTotal)`— eliminaba la circularidad; si ningún
método era elegible, el impuesto era cero. Todo lo intermedio, que es precisamente el pago mixto,
quedaba inalcanzable.

Además, la implementación contradecía su propia especificación:
[`docs/operacion/operacion-diaria.md`](../../operacion/operacion-diaria.md) declara que «todos los
totales, impuestos y el IGTF los calcula el nodo» y que «la pantalla nunca hace aritmética de
negocio», mientras el nodo exigía un lote que solo podía construirse resolviendo la ecuación en el
cliente.

## Decisión

1. **El IGTF viaja dentro del importe entregado con el método gravado.** Quien entrega 51,50 con
   tarjeta liquida 50,00 de la venta y 1,50 de impuesto. La base es la porción comercial que ese
   método salda, no el bruto entregado.
2. El nodo obtiene el impuesto con `TaxRate.extractFrom`, que separa el porcentaje ya contenido en
   un bruto: `base = redondeo(bruto · 10000 / (10000 + puntos base))` y `impuesto = bruto − base`.
   Restar en lugar de aplicar la tasa dos veces garantiza que `base + impuesto` reconstruya el
   bruto **exactamente**; un impuesto incluido nunca descuadra una unidad menor.
3. **Se elimina el recorte a `commercialTotal`.** Existía solo para tapar la circularidad. Sin
   ella, entregar de más se rechaza por sí solo con `SALE_PAYMENT_TOTAL_MISMATCH`, que es la
   garantía que corresponde.
4. La regla del cajero queda derivable en un paso: **el importe que se cobra con un método gravado
   incluye su IGTF**, y el resto de los métodos cubren la porción comercial que falta. No hay
   punto fijo que resolver.
5. Todo lo anterior conserva enteros y moneda explícita. El impuesto sigue siendo `SIMULACION` y
   esta decisión **no** interpreta la norma tributaria venezolana: fija la aritmética del MVP de
   referencia, dentro de [ADR-0021](./0021-mvp-referencia-no-certificado.md).

## Alternativas descartadas

- **Que el cliente declare la base de cada pago.** Más explícito, pero cambia el contrato HTTP
  público y la pantalla para resolver un problema que es aritmético.
- **Una consulta previa al nodo que devuelva lo que se cobra con cada método.** Mantendría literal
  el «la pantalla nunca hace aritmética de negocio», a costa de un contrato nuevo y un viaje más
  por cobro. Queda disponible si la interacción lo pide más adelante.

## Consecuencias

- Un cobro mixto con un método gravado es realizable por primera vez.
- El impuesto almacenado cambia de significado para lotes ya registrados: antes era la tasa sobre
  el bruto; ahora es la porción contenida en él. No hay migración de datos porque el importe
  entregado y el total de la venta no cambian, y una venta completada es inmutable.
- El redondeo puede dejar una unidad menor de diferencia cuando el cajero elige la porción
  comercial en vez del importe cobrado. La pantalla sigue sugiriendo el saldo pendiente y el nodo
  sigue siendo la autoridad: un lote descuadrado se rechaza con su código estable.

## Criterios de aceptación

- [x] `TaxRate.extractFrom` separa el impuesto contenido y `base + impuesto` reconstruye el bruto
      para todo importe.
- [x] Una venta cobrada mitad en efectivo y mitad más IGTF con tarjeta se registra, y el impuesto
      es la tasa sobre la porción comercial.
- [x] Cobrar toda la venta con el método gravado y cobrarla toda en efectivo conservan su
      resultado anterior.
- [x] Un lote que no cubre la venta más su impuesto, o que entrega de más, se rechaza con
      `SALE_PAYMENT_TOTAL_MISMATCH`.

## Enmienda 2026-09-11: la pantalla puede sugerir el importe gravado

- Estado: **Aceptada**
- Origen: [rediseño de la pantalla de venta](../../cronograma/rediseno-pantalla-de-venta.md),
  cuya dirección se aceptó el 2026-09-10 y declara esta enmienda como requisito previo.

### Contexto

La decisión de 2026-09-09 dejó la regla del cajero derivable en un paso, pero no dijo quién la
ejecuta. El rediseño publica la tasa por método y precarga el importe con el impuesto incluido:
eso es producir un importe que hasta ahora solo el nodo sabía construir, mientras
[`operacion-diaria.md`](../../operacion/operacion-diaria.md) declara que «la pantalla nunca hace
aritmética de negocio». Sin una decisión explícita quedarían dos salidas malas: contradecir esa
regla en silencio, o copiar la fórmula del nodo en el renderer y dejar que las dos se separen.

### Decisión

1. **La pantalla puede precargar una sugerencia no autoritativa.** Al capturar un pago con un
   método gravado, propone el bruto que ya incluye el impuesto. La sugerencia es siempre
   editable, no decide si el lote es válido y no habilita ni bloquea el cobro.
2. **No es una segunda implementación.** El renderer ya depende de `@supermarket/shared`, donde
   vive la aritmética de dinero. La sugerencia usa `TaxRate.includeIn(base)`, inversa exacta de
   `extractFrom`, y no reimplementa la fórmula: las dos direcciones son la misma primitiva y no
   pueden separarse. El renderer sigue sin importar `@supermarket/core`, drivers ni Node.
3. **La tasa la publica el nodo por método.** `PaymentMethodResponse` gana
   `financialTransactionTaxBasisPoints`, que vale la tasa de la política cuando el código del
   método está en `eligiblePaymentMethodCodes` **y** su moneda en `eligibleCurrencies`, y `0` en
   cualquier otro caso. La pantalla no lee la política ni sus listas: recibe un número por método
   y lo usa. Ese campo llega con el rediseño, no con esta enmienda.
4. **La sugerencia se calcula sobre la base gravada agregada, no pago por pago.** El nodo extrae
   el impuesto de la **suma** de lo entregado con métodos elegibles, de modo que en todo el cobro
   ocurre un solo redondeo. Redondear cada pago por separado puede exceder el total en una unidad
   menor: una venta de 1,00 cobrada 0,50 y 0,50 con dos métodos gravados al 3% da 0,52 + 0,52 =
   1,04 por pago —rechazado— y 1,03 en agregado —aceptado—. Con un único método gravado en el
   lote, que es el caso corriente, ambas formas coinciden.
5. **El nodo sigue siendo la única autoridad.** Recalcula el impuesto con `extractFrom` sobre el
   lote recibido y rechaza con `SALE_PAYMENT_TOTAL_MISMATCH` lo que no cuadre. Una sugerencia
   equivocada produce un rechazo visible; nunca un importe aceptado en silencio.
6. **Se precisa la regla de `operacion-diaria.md`**, que no cambia de fondo: la pantalla no
   determina totales, impuestos ni validez. Precargar un importe que el cajero puede corregir y
   el nodo verifica es sugerir, no decidir, y es lo que la pantalla ya hacía con el saldo
   pendiente.

### Alternativas descartadas

- **Cobrar el importe neto y dejar que el nodo agregue el impuesto.** Cambiaría el significado
  del lote que `Sale.registerPayments` recibe y la decisión de 2026-09-09 que lo fija.
- **Pedir al nodo el bruto de cada método antes de capturar.** Es la consulta previa que la
  decisión original ya había dejado disponible; sigue costando un contrato nuevo y un viaje por
  pago, ahora en el gesto más repetido del día. Queda disponible si la interacción lo pide.
- **Duplicar la fórmula en el renderer con una prueba que compare ambas.** Una prueba detecta la
  divergencia después de escribirla; compartir la primitiva la hace imposible.

### Consecuencias

- La captura de un pago a la vez del rediseño se vuelve realizable sin que el cajero calcule nada.
- `TaxRate` gana una operación pública que el nodo no necesitaba: la usa el renderer, y el nodo la
  conserva como inversa documentada de `extractFrom`.
- El caso de dos métodos gravados en un mismo lote queda declarado, con su regla y su prueba, en
  lugar de aparecer como un rechazo inexplicable en caja.
- Esta enmienda no toca el agregado `Sale`, el contrato de pagos ni la fiscalidad simulada, que
  sigue siendo `SIMULACION` dentro de [ADR-0021](./0021-mvp-referencia-no-certificado.md).

### Criterios de aceptación

- [x] CA-E1: `TaxRate.includeIn` devuelve la base más su impuesto, y `extractFrom` lo revierte
      exactamente para todo importe: el impuesto extraído del bruto sugerido es el mismo que se
      incluyó, y el bruto menos ese impuesto reconstruye la base.
- [x] CA-E2: un lote construido con la sugerencia agregada lo acepta `RegisterMixedPayment`, y el
      impuesto que el nodo calcula coincide con el que la sugerencia incluyó.
- [x] CA-E3: un lote con dos pagos gravados redondeados por separado se rechaza con
      `SALE_PAYMENT_TOTAL_MISMATCH`; la prueba fija la razón de la regla agregada.
- [x] CA-E4: `PaymentMethodResponse` publica `financialTransactionTaxBasisPoints` derivado de la
      política, y la pantalla no lee las listas de elegibilidad. Un nodo sin política activa
      publica `0` en todos los métodos; un fallo de almacenamiento no se disfraza de método no
      gravado.
- [x] CA-E5: la sugerencia de la pantalla es editable y un importe corregido a mano llega al nodo
      sin alterar. La pantalla marca «+IGTF», precarga el bruto al elegir el método y no sugiere
      nada cuando el método liquida en otra moneda, porque convertir exige una tasa explícita que
      todavía no envía (D-001).
