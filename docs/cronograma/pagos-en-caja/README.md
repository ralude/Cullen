# Pagos en caja: métodos múltiples, pago móvil confirmado y Cashea

- **Estado:** **propuesta**, abierta el 2026-09-23. Avanza en paralelo con la Fase 12B por la
  [excepción a la regla 5](../adaptaciones-aprobadas.md) aprobada ese mismo día, con sus
  condiciones. Ninguna etapa está iniciada; las que llevan código esperan su decisión de E0.
- **Índice:** [Cronograma maestro](../README.md).

## Documentos

| Documento | Tipo | Contenido |
|---|---|---|
| [Especificación: pagos múltiples en la pantalla de venta](./spec-pagos-multiples.md) | **Spec** | Lo que ya existe, las cuatro brechas que impiden el cobro mixto real en una tienda venezolana y los criterios de aceptación para cerrarlas |
| [Plan: confirmación de pago móvil e integración con Cashea](./plan-pago-movil-y-cashea.md) | Plan | Seis etapas sobre la spec: referencia de pago, verificación bancaria, devolución mixta y financiamiento de terceros |

## Por qué es un paquete y no una fase

Lo mismo que el [paquete pre-piloto](../pre-piloto/README.md): no renumera nada y no cambia el
estado de ninguna fase. Lo que sí cambia son **contratos e invariantes** —el `Payment` gana una
referencia, el evento de venta gana un campo, un método puede quedar fuera del arqueo—, y por
eso cada etapa nombra la decisión normativa que la habilita antes de tocar código.

## Qué hace falta para ejecutarlo

1. ~~Una decisión escrita que lo ubique en el cronograma.~~ Resuelta con la excepción del
   2026-09-23. Sigue en pie la recomendación de tratar las etapas E1 a E3 como requisito del
   [gate de piloto](../gate-piloto-release.md): una tienda venezolana cobra a diario en dólares
   en efectivo y en bolívares por pago móvil, y hoy ese lote no es cobrable (D-001, D-002).
2. Un responsable de negocio que apruebe las decisiones marcadas **abiertas** en la spec y en
   el plan. Ninguna de ellas se resuelve en el código.
3. Para Cashea, la afiliación del comercio: su integración técnica no es pública y se entrega
   después de aprobado el contrato.
