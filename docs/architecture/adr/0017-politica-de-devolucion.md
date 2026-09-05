# ADR-0017: Política de devolución y nota de crédito simulada

- Estado: **Aceptado para MVP técnico no certificado**
- Fecha: 2026-09-04
- Alcance: flujo mínimo de referencia; las reglas comerciales y fiscales locales son perfiles
  reemplazables.

## Contexto

Una venta `COMPLETED` es inmutable y hoy no tiene reversión. El MVP sí necesita probar el
recorrido de devolución, caja, inventario y fiscalidad fake, pero no necesita certificar una
nota de crédito real para avanzar.

## Decisión para el MVP

1. La devolución referencia una venta completada y su documento fiscal original. No se acepta
   un `referenceId` genérico.
2. La primera entrega admite devolución total. La devolución parcial queda como extensión
   cuando exista un consumidor que necesite cantidades por línea.
3. La operación exige permiso `sale.return`, motivo no vacío, idempotencia por intención,
   auditoría y una sola transacción para sus efectos de caja e inventario.
4. El reintegro se imputa al turno abierto que procesa la devolución; nunca reabre ni edita un
   turno cerrado. Pagos mixtos se rechazan explícitamente en el primer corte hasta definir una
   política de distribución.
5. La reposición referencia el lote original cuando existe. Disposiciones comerciales como
   merma o inspección se dejan fuera del primer corte y no se simulan con ajustes sueltos.
6. La nota se emite mediante `FiscalPrinterFake`, con `SIMULACION` visible y sin declarar
   emisión legal o compatibilidad de hardware.
7. Un reintegro puede dejar negativo el saldo esperado del método en el turno que lo procesa
   cuando ese turno no cobró fondos suficientes antes de devolverlos. El valor negativo se
   conserva como evidencia real de salida de caja; no se trunca a cero ni se carga al turno
   histórico. En el arqueo, un declarado no negativo se compara contra ese esperado y la
   diferencia explica los fondos que debieron aportarse para pagar el reintegro.

## Extensiones diferidas

Ventana configurable, devolución parcial, reintegro de pagos mixtos, devolución sin
comprobante, disposición de merma, consolidación de notas y políticas fiscales específicas
pertenecen a perfiles posteriores. Una integración real debe mapearlas contra la evidencia y
el proveedor que correspondan.

## Invariantes

- Un documento emitido no se edita; se corrige mediante un documento compensatorio.
- Caja, inventario, ledger, outbox y estado fiscal se confirman juntos o no se confirman.
- Toda acción sensible deja actor, terminal, nodo, UTC y motivo.
- Un fallo de impresión simulada conserva un estado recuperable e idempotente.
- El saldo esperado puede ser negativo por reintegros y debe mostrarse con su signo.

## Consecuencias

9B.06 y la parte de revisión del perfil Supervisor pueden avanzar sin reapertura de turnos ni
validación fiscal profesional. La certificación real sigue siendo un gate de Fase 8/piloto.
