# ADR-0031: Base del IGTF en pagos mixtos

- Estado: **Aceptado**
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
