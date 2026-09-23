# ADR-0033: Escala de unidad menor por moneda en un registro compartido

- Estado: **Aceptado**
- Fecha: 2026-09-23
- Origen: [D-002](../../cronograma/defectos-conocidos.md) y la etapa E1 de
  [Pagos en caja](../../cronograma/pagos-en-caja/plan-pago-movil-y-cashea.md). La decisión la
  eligió el usuario entre tres alternativas el mismo día.

## Contexto

Un importe se guarda en **unidades menores enteras** (`Money`, ADR-0003), pero el sistema no sabe
cuántas unidades menores tiene la unidad mayor de cada moneda. Tres consecuencias:

1. **La pantalla de venta** parsea todos los importes del lote con la escala del campo «Escala
   visible», que describe la moneda de la venta. Un pago en otra moneda con otro exponente se
   leería con el factor equivocado (D-002).
2. **`CurrencyConverter`** multiplica las unidades menores por la tasa y cambia la etiqueta de
   moneda. Eso solo es correcto si las dos monedas tienen el mismo exponente. Convertir 1,00 USD a
   una moneda sin decimales a tasa 900 daría 90.000 unidades en lugar de 900.
3. **El convertidor usa `Quantity`**, que admite escala hasta 6, mientras `ExchangeRate` admite
   hasta 8. Una tasa con 7 u 8 decimales hace fallar la conversión con `QUANTITY_INVALID_SCALE`.

La entidad `Currency` del dominio ya tiene `minorUnitExponent`, pero nada la persiste, la publica
ni la consulta. Hoy nada falla porque todas las monedas en uso —USD y VES— tienen dos decimales.

## Decisión

1. **Registro compartido.** `@supermarket/shared` publica la lista cerrada de monedas soportadas
   con su exponente ISO 4217:

   | Código | Exponente | Por qué está |
   |---|---:|---|
   | USD | 2 | Moneda de venta habitual |
   | VES | 2 | Bolívar, moneda de cobro local |
   | EUR | 2 | Divisa que se recibe en efectivo |
   | COP | 2 | Peso colombiano, frecuente en zona de frontera |
   | CLP | 0 | Moneda sin decimales: fija la conversión entre exponentes distintos |

   El nodo y el renderer leen **la misma tabla**. No hay una segunda copia que pueda separarse,
   por el mismo criterio de la enmienda de ADR-0031.

2. **Conversión con un solo redondeo.** `Money.convertAtRate` convierte con la tasa, su escala y
   la diferencia de exponentes en una sola división entera, con el redondeo half-up comercial
   que ya usa `Money`. Si la tasa es `r = rateValue / 10^rateScale`, un importe en la moneda base
   con exponente `eb` pasa a la moneda cotizada con exponente `eq` como:

   ```
   cotizada = redondeo(base · rateValue · 10^eq / (10^rateScale · 10^eb))
   base     = redondeo(cotizada · 10^rateScale · 10^eb / (rateValue · 10^eq))
   ```

   `CurrencyConverter` conserva la verificación de vigencia y delega la aritmética en ese
   método. La pantalla usa el mismo método para sus sugerencias y equivalentes. Al no pasar por
   `Quantity`, la conversión acepta las ocho posiciones decimales que `ExchangeRate` ya permite.

3. **Rechazo explícito.** Una moneda fuera del registro se rechaza con `CURRENCY_UNSUPPORTED`
   donde entra al sistema: al iniciar una venta, registrar una tasa, dar de alta un método de
   pago y convertir. **No** se valida al rehidratar: una venta, un pago o una tasa ya guardados
   se siguen leyendo aunque su moneda no esté en la lista, porque un documento cerrado no deja
   de existir por un cambio de configuración.

4. **La escala de la venta sale de su moneda.** La pantalla deja de pedir «Escala visible»:
   cada importe se parsea y se muestra con el exponente de **su** moneda.

5. **La entidad `Currency` no es fuente de verdad.** No tiene consumidores y queda como está. Si
   alguna vez se persiste, su exponente debe coincidir con el registro, y un ADR nuevo decide
   cuál manda.

## Alternativas descartadas

- **Moneda persistida y configurable, con evento LAN.** Más flexible: agregar una moneda no
  requeriría una versión nueva. Pero exige tabla, migración, contrato, pantalla de
  administración y un evento de sincronización versionado, varias veces más trabajo antes de
  poder cobrar en bolívares, para un caso —una moneda nueva— que ocurre muy rara vez.
- **Invariante de dos decimales para toda moneda.** Lo más barato y suficiente para USD, VES,
  EUR y COP. Se descartó porque deja implícita la fórmula del convertidor, que seguiría siendo
  incorrecta para cualquier moneda sin decimales, y porque no hay forma de probar la conversión
  entre exponentes distintos si todos valen lo mismo.

## Consecuencias

- **Agregar una moneda requiere una versión nueva** del sistema: una fila en el registro y sus
  pruebas. Es deliberado: el exponente es un dato que no debe cambiar en caliente.
- Un **nodo con datos en una moneda no soportada** los sigue leyendo, pero no puede iniciar
  ventas, registrar tasas ni convertir en ella hasta que la moneda entre al registro.
- Un **evento LAN** que publique un método o una tasa en una moneda no soportada llega a una
  terminal que no puede usarlo en un cobro. El consumidor lo aplica igual, porque rehidratar no
  valida, y el rechazo ocurre al intentar cobrar.
- **Pagar en una moneda más gruesa que la de la venta** —por ejemplo una venta en VES pagada en
  USD— puede no tener un importe exacto: un centavo de dólar equivale a varios céntimos de
  bolívar. El nodo rechaza el lote descuadrado con `SALE_PAYMENT_TOTAL_MISMATCH` y el caso
  necesita el vuelto (DA-2 de la [spec](../../cronograma/pagos-en-caja/spec-pagos-multiples.md)).
  En el caso corriente, una venta en USD pagada en VES, siempre hay un importe exacto: con tasas
  mayores que 1, convertir de ida y vuelta devuelve la misma cifra.
- El resultado de la conversión **no cambia** para USD y VES, que tienen el mismo exponente: los
  pagos ya registrados y sus pruebas siguen valiendo.

## Criterios de aceptación

- [x] ~~CA-33-01: el registro devuelve el exponente de cada moneda soportada y rechaza cualquier
      otra con `CURRENCY_UNSUPPORTED`.~~
- [x] ~~CA-33-02: `Money.convertAtRate` da el mismo resultado que el convertidor anterior entre
      monedas del mismo exponente, en ambos sentidos del par.~~
- [x] ~~CA-33-03: entre exponentes distintos (USD ↔ CLP) la conversión respeta la unidad mayor:
      1,00 USD a 900 son 900 CLP, y 900 CLP son 1,00 USD.~~
- [x] ~~CA-33-04: una tasa con 8 decimales convierte sin error.~~
- [x] ~~CA-33-05: iniciar una venta, registrar una tasa o dar de alta un método en una moneda fuera
      del registro devuelve `CURRENCY_UNSUPPORTED`. Una venta guardada en una moneda no soportada
      se sigue leyendo.~~
