# Spec: pagos múltiples en la pantalla de venta

- **Tipo:** especificación.
- **Estado:** **propuesta**, 2026-09-23. Sin aprobar; no autoriza implementación.
- **Paquete:** [Pagos en caja](./README.md).
- **Gobierna:** [ADR-0021](../../architecture/adr/0021-mvp-referencia-no-certificado.md),
  [ADR-0031 y su enmienda](../../architecture/adr/0031-base-del-igtf-en-pagos-mixtos.md),
  [rediseño de la pantalla de venta](../rediseno-pantalla-de-venta.md),
  [defectos conocidos](../defectos-conocidos.md) D-001, D-002 y D-003.

## Resumen

La pantalla de venta **ya cobra con varios métodos**: el rediseño del 2026-09-11 entregó la
captura por fichas. Lo que falta no es la mecánica de agregar pagos sino que el lote que un
cajero venezolano arma todos los días —dólares en efectivo más bolívares por pago móvil— sea
cobrable, verificable y reversible. Esta spec fija lo que ya se garantiza, nombra las cuatro
brechas y define los criterios que las cierran.

## Lo que ya existe (verificado sobre el código)

| Pieza | Dónde | Garantía |
|---|---|---|
| Captura de un pago a la vez, con fichas removibles | [`screens/sales.tsx`](../../../apps/desktop/src/renderer/src/screens/sales.tsx) (`CapturedTender`, `addTender`, `settle`) | La altura de la barra no cambia entre uno y varios métodos |
| Lote único y exacto | `Sale.registerPayments` en [`sale.ts`](../../../packages/core/src/domain/sales/sale.ts) | Se registra una sola vez (`SALE_PAYMENTS_ALREADY_REGISTERED`); suma distinta a `commercialTotal + IGTF` → `SALE_PAYMENT_TOTAL_MISMATCH` |
| Conversión con tasa explícita | [`register-mixed-payment.ts`](../../../packages/core/src/application/sales/register-mixed-payment.ts) | Pago en otra moneda sin `exchangeRateId` → `EXCHANGE_RATE_REQUIRED` |
| IGTF sobre la base gravada agregada | ADR-0031 y enmienda | Un solo redondeo por lote; la pantalla sugiere con `TaxRate.includeIn` y el nodo decide |
| Idempotencia del cobro | `executeIdempotentCommand` + clave de intención en la pantalla | Reenviar el mismo lote no duplica pagos |
| Impacto en caja por método | `ApplySaleCompletedToShift`, `Shift.expectedBalances` | Cada método acumula su saldo esperado y se arquea por separado |

## Brechas

### B1 · El lote multimoneda no es cobrable (D-001 + D-002) — cerrada el 2026-09-23

La pantalla nunca envía `exchangeRateId` y parsea todos los importes con la escala de la moneda
de venta. D-001 y D-002 deben cerrarse **juntos**: habilitar la tasa sin resolver la escala
produce importes incorrectos.

- **Decisión normativa:** [ADR-0033](../../architecture/adr/0033-escala-de-unidad-menor-por-moneda.md),
  aceptado el 2026-09-23: registro ISO compartido y una sola conversión para nodo y pantalla.
- **No requiere contrato nuevo** para la tasa: `GET /api/v1/currency/exchange-rates/current` ya
  existe sin permiso.

### B2 · Una venta con IGTF no puede facturarse (D-003)

Mientras `FiscalDocumentContent` no tenga dónde declarar el IGTF, cualquier lote con un método
gravado deja la venta sin factura y, por arrastre, sin devolución. Es una decisión normativa
fiscal ya registrada; esta spec solo la declara como **dependencia** de un cobro mixto completo.

### B3 · Una venta cobrada con varios métodos no puede devolverse

[`return-sale.ts`](../../../packages/core/src/application/sales/return-sale.ts) rechaza con
`SALE_RETURN_MIXED_PAYMENT_UNSUPPORTED` toda venta con más de un pago y reembolsa siempre
`sale.payments[0]`. Cobrar mixto es hoy un camino sin vuelta.

### B4 · Un pago no conserva su referencia

`Payment` guarda método, importe, conversión y autor, pero **no la referencia** del pago
(número de pago móvil, lote del punto, orden de un financiador). Sin ella no hay conciliación
bancaria, ni control de referencias repetidas, ni puente con Cashea. Es la base del
[plan](./plan-pago-movil-y-cashea.md) y se especifica allí.

## Decisiones abiertas

Ninguna se resuelve en el código. Cada una necesita responsable de negocio y, cuando lo indica,
ADR.

| # | Pregunta | Por qué importa | Propuesta por defecto |
|---|---|---|---|
| DA-1 | ¿Dónde vive la escala de unidad menor de una moneda? | Cierra D-002 | **Resuelta** por ADR-0033: registro ISO compartido en `@supermarket/shared` |
| DA-2 | ¿Se da **vuelto**? Hoy el lote debe ser exacto: quien entrega 20 USD por 17,50 no tiene cómo registrarlo | En Venezuela el vuelto suele darse en otra moneda o por pago móvil | Fuera de esta spec; el cajero registra lo que se queda la venta. Si se aprueba, el vuelto es un pago de salida explícito, no un sobrepago tolerado |
| DA-3 | ¿Cómo se reparte el reembolso de una venta mixta? | Cierra B3 | Proporcional por método en la moneda original de cada pago, con la tasa del cobro y no la del día; el cajero puede elegir reembolsar todo en un método solo con permiso y motivo |
| DA-4 | ¿Cuántos pagos admite un lote? | Evita lotes absurdos y protege la factura | Sin límite nuevo en dominio; la pantalla no impone uno |

## Criterios de aceptación

Cada criterio se cubre con una prueba outside-in antes de implementarse
([ADR-0007](../../architecture/adr/0007-outside-in-tdd.md)).

- [x] ~~**CA-PM-01** Una venta en USD se cobra con efectivo USD y pago móvil VES: la pantalla
      muestra la tasa vigente del par con su fuente y vigencia, envía su `exchangeRateId` y el
      nodo registra el lote. La ficha VES se muestra en VES y su equivalente en la moneda de venta.~~
- [x] ~~**CA-PM-02** Cada importe se parsea con la escala de **su** moneda, no con la de la venta
      (D-002). Una prueba con dos monedas de escala distinta fija la conversión.~~
- [x] ~~**CA-PM-03** Si no hay tasa vigente para el par, la ficha no se puede agregar y el mensaje
      lo dice; nunca se envía un lote que el nodo rechazará con `EXCHANGE_RATE_REQUIRED`.~~
- [x] ~~**CA-PM-04** El saldo pendiente se recalcula en la moneda de venta después de cada ficha
      y la sugerencia del siguiente pago se expresa en la moneda del método elegido.~~
- [ ] **CA-PM-05** La pantalla sigue sin decidir validez: un lote descuadrado llega al nodo y se
      rechaza con `SALE_PAYMENT_TOTAL_MISMATCH` visible, sin aceptación silenciosa.
- [ ] **CA-PM-06** Una venta cobrada con dos o más métodos se devuelve según DA-3; el reembolso
      impacta el saldo esperado de cada método en el turno y la suma devuelta coincide con la
      nota de crédito.
- [ ] **CA-PM-07** Con IGTF activo, una venta mixta gravada se factura y se devuelve (depende
      de la decisión que cierra D-003).
- [ ] **CA-PM-08** El arqueo del turno muestra un saldo esperado por método y moneda que
      coincide con la suma de las fichas registradas.

## Fuera de alcance

- Cambiar la regla del lote exacto de `Sale.registerPayments`.
- Interpretar la norma tributaria venezolana: el IGTF sigue siendo `SIMULACION`
  ([ADR-0021](../../architecture/adr/0021-mvp-referencia-no-certificado.md)).
- Referencia, verificación y financiamiento de terceros: viven en el
  [plan](./plan-pago-movil-y-cashea.md).

## Escenarios de fallo a actualizar

Ninguno cambia con B1–B3 salvo que DA-3 introduzca reembolsos en varios métodos dentro de una
transacción: en ese caso se revisa [FS-006](../../failure-scenarios/FS-006-devolucion-nota-credito-simulada.md).
