# Plan: confirmación de pago móvil e integración con Cashea

- **Tipo:** plan de ejecución. No amplía el alcance que apruebe la
  [spec](./spec-pagos-multiples.md).
- **Estado:** **propuesta**, 2026-09-23. Ninguna etapa iniciada.
- **Paquete:** [Pagos en caja](./README.md).

## Qué se sabe de afuera

Investigado el 2026-09-23 en las fuentes públicas enlazadas al final. Lo que no aparece en ellas
se marca como **desconocido**, no se supone.

### Pago móvil

- El cliente transfiere desde su banco al teléfono y RIF del comercio; el comercio recibe una
  **referencia** —su longitud varía por banco—, el banco emisor, el teléfono y la cédula
  del pagador. En tienda se concilia comúnmente por los últimos 4 o 6 dígitos.
- La verificación automática existe por dos vías:
  - **API bancaria directa.** Mercantil publica un producto de «Búsqueda de pagos móviles»
    (Tpago: C2P, P2C, vuelto) que exige un `ClientID` entregado por el banco. Su contrato no es
    legible sin cuenta en el portal: **desconocido**.
  - **Agregadores.** Pabilo expone `POST /userbankpayment/{userBankId}/betaserio` con
    `bank_reference`, `amount`, `dni_pagador`, `phone_pagador`, `bank_origin` y `fecha_pago`.
    Los campos obligatorios varían por banco: Mercantil solo admite la búsqueda `MOVIL_PAY` con
    todos los datos del pagador, mientras Banesco o BDV aceptan la búsqueda `GENERIC` solo con
    referencia. Una segunda consulta del mismo pago responde `is_new: false`, lo que sirve de
    control de doble uso. Cuesta un crédito por verificación nueva.
  - Otros servicios (VerificaPago) leen SMS o notificaciones del teléfono del comercio. No son
    una fuente bancaria y no se consideran autoridad.
- **Vuelto por C2P** —el comercio envía bolívares al teléfono del cliente— solo lo pueden emitir
  cuentas jurídicas con el servicio contratado. Queda fuera del plan (ver DA-2 de la spec).

### Cashea

- «Compra ahora, paga después». El cliente paga en caja una **inicial** —del 60 % en nivel 1 al
  40 % en niveles altos, y hasta 20 % en promociones— con **cualquier medio de pago del
  comercio**. El resto lo paga a Cashea en cuotas cada 14 días.
- **Flujo en tienda física:** cada caja tiene un **QR dinámico propio**; el cliente lo escanea
  con su app. La orden es temporal, **expira a los 10 minutos** en punto de venta y su monto
  solo puede cambiarse antes de pagar la inicial. Después de la inicial, el comercio solo puede
  asociarle **número de factura y medio de pago**. El comercio opera desde el «Portal Web de
  Aliados» (roles Administrador y Cajero).
- **Liquidación:** Cashea adelanta semanalmente las cuotas al comercio. Costos publicados:
  activación de 50 USD + IVA, servicio tecnológico del 2 % o 5 % por venta y tarifa de adelanto
  del 2 % al 4 %. La moneda y el día de la liquidación: **desconocidos**.
- **Integración:** Cashea declara **obligatoria** la integración con el sistema administrativo,
  pero **no publica su API**: la entrega tras la afiliación, con una etapa de pruebas.
- **Anulación y devolución:** la orden solo se anula antes de la inicial. Después «no se pueden
  anular facturas»: se emite nota de crédito y se sube al portal. Los cambios se admiten antes
  de la primera cuota o dentro de 14 días desde la inicial.
- **Reglas comerciales:** compra mínima de 25 USD o su equivalente a tasa BCV, y **prohibido
  cobrar más caro con Cashea** que con otro medio.

## Cómo encaja en Cullen

### Pago móvil confirmado

Un pago móvil es un `Payment` corriente de un método `MOBILE_PAYMENT` en VES. Lo que se agrega
es **evidencia**: una referencia y un estado de confirmación que el nodo guarda con el pago.

```
PaymentReference            // value object, dominio de ventas
  value: string             // dígitos declarados; sin datos personales
  issuerBankCode: string|null   // código de 4 dígitos del banco emisor
  confirmation: DECLARED | VERIFIED
  verificationId: string|null   // registro de verificación consumido, si VERIFIED
```

- **Nivel manual (sin red externa):** el cajero escribe la referencia y el banco emisor; el pago
  queda `DECLARED`. Es el piso: funciona en `SIMULACION`, sin internet y sin contrato bancario.
- **Nivel verificado:** antes del cobro, `VerifyMobilePayment` consulta un puerto
  `MobilePaymentVerifier` y persiste un registro de verificación con importe, fecha y
  referencia. `RegisterMixedPayment` recibe su `verificationId`, comprueba que esté verificado,
  que el importe coincida con la ficha y que no se haya consumido, y lo consume en la misma
  transacción que el pago.
- **Control de doble uso:** una referencia verificada —banco emisor + referencia + fecha— solo
  puede saldar un pago. Una referencia declarada repetida se **advierte**, no se bloquea, porque
  sin fuente bancaria dos referencias cortas pueden coincidir legítimamente.
- **Sin conectividad:** el verificador aplica timeout sin reintento automático, igual que el
  proveedor de tasas ([ADR-0014](../../architecture/adr/0014-tasas-de-cambio-sugerencia-y-confirmacion.md)).
  Si falla, el cajero puede registrar el pago como `DECLARED` con permiso y motivo, y la
  conciliación posterior lo resuelve. Nunca se acepta como `VERIFIED` un pago no confirmado.

### Cashea

Cashea no es un medio de cobro del cliente en caja sino un **financiador**: salda la porción de
la venta que el cliente no paga hoy. En Cullen es un pago más del lote.

```
Venta 100,00 USD, cliente en nivel 1 (inicial 60 %)
  ficha 1  Efectivo USD          40,00
  ficha 2  Pago móvil VES        20,00 USD equiv.  (ref. 123456, VERIFIED)
  ficha 3  Cashea                40,00           (ref. orden Cashea)
  lote = 100,00 = commercialTotal  → Sale.registerPayments
```

- El lote exacto no cambia: la inicial se captura con los métodos de siempre y Cashea salda el
  resto. El agregado `Sale` no aprende qué es un financiamiento.
- La **referencia** del pago Cashea es el identificador de la orden. La factura emitida es lo
  que el comercio asocia después en Cashea.
- Cashea **no entra al arqueo** como efectivo esperado: es una cuenta por cobrar al financiador.
  Hoy `Shift.expectedBalances` acumula todo método y el cierre lo compara con lo declarado, así
  que el método Cashea exige excluirse o arquearse contra el reporte del portal (decisión DC-3).
- Sin API (hoy), el cajero opera el portal de aliados y escribe en Cullen el número de orden: el
  pago queda `DECLARED`. Con API, un adaptador del puerto `ThirdPartyFinancingProvider` crea la
  orden por el saldo pendiente, espera la confirmación de la inicial y devuelve la orden
  confirmada; el pago queda `VERIFIED`.

## Decisiones abiertas

| # | Pregunta | Propuesta por defecto | Decide |
|---|---|---|---|
| DC-1 | ¿La referencia es obligatoria por método? | Atributo `referencePolicy` (`NONE`, `OPTIONAL`, `REQUIRED`) del método de pago, configurado por administración y publicado por el nodo; la pantalla no lo deduce del `kind` | ADR-0034 |
| DC-2 | ¿Se guarda teléfono y cédula del pagador? | **No**: bastan referencia, banco emisor, importe y fecha. El verificador los recibe en memoria y no se persisten ni se registran en logs ([ADR-0006](../../architecture/adr/0006-errores-logs-auditoria.md), [ADR-0029](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md)) | ADR-0034 |
| DC-3 | ¿Cómo se arquea un método de financiador? | Nuevo atributo del método `settlement: DRAWER | EXTERNAL`; los `EXTERNAL` se informan en el cierre pero no exigen declaración | ADR-0035 |
| DC-4 | ¿Cashea necesita un `kind` propio? | No en la primera entrega: `OTHER` + `settlement: EXTERNAL`. Un `kind` nuevo cambia el enum del evento `PaymentMethodPublished` y exige versión de contrato ([ADR-0023](../../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md)) | ADR-0035 |
| DC-5 | ¿La porción Cashea paga IGTF? | Consulta tributaria. Por defecto no elegible: basta con no incluirla en `eligiblePaymentMethodCodes` | Asesoría |
| DC-6 | ¿Quién es autoridad de unicidad de una referencia verificada en LAN? | El nodo que cobra; dos cajas del mismo comercio pueden consumir la misma referencia antes de sincronizar. El agregador responde `is_new: false` a la segunda consulta y actúa como control externo | ADR-0034 y escenario FS-012 |
| DC-7 | ¿Qué proveedor de verificación? | Un único adaptador detrás del puerto; banco directo o agregador lo decide el comercio con su contrato. El plan no elige proveedor | Negocio |

## Etapas

Cada etapa cierra con su prueba observable y un commit semántico. Ninguna empieza sin la
decisión que la habilita.

### E0 · Decisiones normativas

- [ ] ADR-0033: escala de unidad menor de una moneda (cierra D-002; spec DA-1).
- [ ] ADR-0034: referencia y confirmación de pagos (DC-1, DC-2, DC-6), con el escenario
      **FS-012 · verificación de pago móvil con resultado desconocido**.
- [ ] ADR-0035: financiamiento de terceros y liquidación externa (DC-3, DC-4), con el escenario
      **FS-013 · orden de financiador confirmada sin venta registrada**, y su inverso.
- [ ] Decisión fiscal que cierra D-003, si el comercio activa IGTF.
- [ ] Decisión escrita que ubica el paquete en el cronograma.

### E1 · Cobro multimoneda (spec B1)

- [ ] CA-PM-01 a CA-PM-04. Cierra D-001 y D-002 juntos y los retira de
      [defectos conocidos](../defectos-conocidos.md).

### E2 · Referencia de pago declarada

- [ ] `PaymentReference` en dominio; `Payment` la acepta opcional y el método exige lo que dice
      su `referencePolicy`.
- [ ] Migración `0045` agrega las columnas a `sale_payments`; las ventas existentes quedan sin
      referencia.
- [ ] `RegisterSalePaymentsRequest` y `SaleResponse` ganan `reference` opcional; el evento de
      venta completada la transporta como campo **opcional nuevo**, compatible con consumidores
      anteriores.
- [ ] La ficha pide la referencia cuando el método la exige y la muestra al registrar.
- [ ] Reporte de pagos por referencia para conciliación manual contra el estado de cuenta.

### E3 · Verificación de pago móvil

- [ ] Puerto `MobilePaymentVerifier` en `core/application/ports`, adaptador fake determinista y
      adaptador real en `packages/drivers` para el proveedor elegido (DC-7).
- [ ] Caso de uso `VerifyMobilePayment` con permiso propio y auditoría (actor, terminal, motivo).
- [ ] `RegisterMixedPayment` consume la verificación en la misma transacción; una verificación
      consumida o de importe distinto se rechaza con código estable.
- [ ] Credencial del proveedor custodiada según ADR-0029; nunca en logs.
- [ ] Botón «Confirmar pago» en la ficha, con estados *verificando*, *confirmado*,
      *no encontrado* y *sin conexión — registrar como declarado*.
- [ ] Pruebas de FS-012: timeout, respuesta tardía después del registro manual y referencia ya
      consumida en otra caja.

### E4 · Devolución de venta mixta (spec B3)

- [ ] CA-PM-06 con la regla que apruebe DA-3. Requisito de Cashea: su devolución exige nota de
      crédito, y una venta con Cashea siempre es mixta.

### E5 · Cashea manual

- [ ] Método `CASHEA` con `settlement: EXTERNAL` y referencia obligatoria.
- [ ] La pantalla advierte si el total es menor que la compra mínima publicada; la regla vive
      en configuración, no en el código, porque es comercial y puede cambiar.
- [ ] El cierre de turno informa el saldo Cashea sin exigir declaración (DC-3).
- [ ] Reporte de ventas Cashea por período con referencia de orden y número de factura, para
      conciliar contra el CSV del portal de aliados.
- [ ] Manual de usuario: sección de cobro con Cashea en el
      [capítulo de caja](../../operacion/manual-usuario/README.md).

### E6 · Cashea integrado

Bloqueada por dependencia externa —afiliación y documentación técnica—, como la
[Fase 8](../fase-08-integracion-serial/README.md).

- [ ] Puerto `ThirdPartyFinancingProvider`: crear orden por el saldo, consultar estado, asociar
      factura, registrar nota de crédito.
- [ ] La orden se crea al pulsar «Cobrar con Cashea» por el **saldo pendiente**, que solo puede
      cambiar antes de la inicial: agregar o quitar líneas después exige cancelar la orden.
- [ ] Expiración de 10 minutos visible en la ficha; una orden expirada nunca salda un pago.
- [ ] La factura emitida se asocia a la orden después de `IssueSaleInvoice`, mediante outbox:
      si Cashea no responde, la venta no se revierte y la asociación se reintenta.
- [ ] Pruebas de FS-013 contra un adaptador fake: orden confirmada y caja caída, venta
      registrada y orden expirada, asociación de factura rechazada.

## Riesgos

- **Contrato de Cashea desconocido.** E6 puede cambiar de forma cuando llegue la documentación.
  Por eso E5 no depende de ella y el puerto se define por lo que Cullen necesita, no por la API.
- **Proveedor de verificación con costo por consulta.** Cada verificación nueva consume crédito;
  el botón es explícito y no consulta en cada tecla.
- **Datos personales del pagador.** DC-2 los deja fuera de la base. Si negocio los exige, cambia
  la clasificación de datos de ADR-0029.
- **Paridad de precio.** Cashea prohíbe recargos: ningún método puede aplicar un precio
  distinto. Cullen no tiene recargos por método hoy y el plan no los introduce.

## Fuentes

Consultadas el 2026-09-23.

- [Cashea — Comercios](https://www.cashea.app/comercios)
- [Cashea — ¿Cómo funciona Cashea para comercios?](https://www.cashea.app/preguntas-frecuentes/c/como-funciona-cashea-para-comercios)
- [Cashea — Vender con Cashea](https://www.cashea.app/preguntas-frecuentes/c/vender-con-cashea)
- [Cashea — Cashea en mi establecimiento](https://www.cashea.app/preguntas-frecuentes/c/cashea-en-mi-establecimiento)
- [Cashea — Órdenes, facturas y cambios](https://www.cashea.app/preguntas-frecuentes/c/ordenes-facturas-y-cambios)
- [Cashea — Portal web de aliados](https://www.cashea.app/preguntas-frecuentes/c/portal-web-de-aliados)
- [Mercantil — Búsquedas de pagos móviles](https://apiportal.mercantilbanco.com/mercantil-banco/produccion/product/21013)
- [Pabilo — Verificar pagos](https://pabilo.app/docs/verify-payments)
- [Pabilo — Campos por banco](https://pabilo.app/docs/verify-fields)
- [Pabilo — Vuelto C2P](https://pabilo.app/docs/transaction-change)
- [VerificaPago](https://www.verificapago.com/)
