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
4b. El reintegro se devuelve **por el método de pago original de la venta**. Como el primer
   corte solo admite devolución total de una venta sin pago mixto, ese método es único y
   determinado. No se convierte a efectivo ni se elige método libremente.
4c. Un saldo esperado negativo puede producirse en **cualquier** método (efectivo o no), porque
   el reintegro sigue al método original. La diferencia de significado se registra en el
   arqueo, no se evita:
   - En `CASH_*` el esperado negativo es dinero que salió de una gaveta que no lo tenía; el
     conteo físico lo explica directamente.
   - En tarjeta o transferencia no hay gaveta: el esperado negativo queda como partida
     pendiente de conciliación contra el procesador o el banco, no como faltante de conteo.
5. La reposición referencia el lote original cuando existe. Disposiciones comerciales como
   merma o inspección se dejan fuera del primer corte y no se simulan con ajustes sueltos.
6. La nota se emite mediante `FiscalPrinterFake`, con `SIMULACION` visible y sin declarar
   emisión legal o compatibilidad de hardware.
7. Un reintegro puede dejar negativo el saldo esperado del método en el turno que lo procesa
   cuando ese turno no cobró fondos suficientes antes de devolverlos. El valor negativo se
   conserva como evidencia real de salida de caja; no se trunca a cero ni se carga al turno
   histórico. En el arqueo, un declarado no negativo se compara contra ese esperado y la
   diferencia explica los fondos que debieron aportarse para pagar el reintegro.
8. Un saldo esperado negativo **no bloquea** el cierre del turno, pero exige **reconocimiento
   explícito**: el cierre registra un motivo y una autorización de supervisor
   (`cash.shift.close.negative-expected` o el permiso de autorización vigente) para cada método
   cuyo esperado sea menor que cero. Es la única señal auditable de que salió efectivo o fondos
   que ese turno nunca recibió. Sin ese reconocimiento el cierre se rechaza.

## Extensiones diferidas

Ventana configurable, devolución parcial, reintegro de pagos mixtos, devolución sin
comprobante, disposición de merma, consolidación de notas y políticas fiscales específicas
pertenecen a perfiles posteriores. Una integración real debe mapearlas contra la evidencia y
el proveedor que correspondan.

## Complemento LAN del 2026-09-06

[ADR-0026, D3](./0026-lan-operativa-y-recuperacion-entre-nodos.md) conserva esta atomicidad
en standalone y define para LAN conexión inicial obligatoria, transacciones por nodo e
intención pendiente de conciliación si se interrumpe el flujo. No promete commit global
entre caja del POS e inventario del coordinador. Mantiene turno/método original, lote/costo,
documentos inmutables y fiscalidad recuperable. La intención y la consulta de progreso están
implementadas, pero falta el paso que restituye el stock autoritativo del coordinador y su
orden respecto del reintegro y la nota. [FS-011](../../failure-scenarios/FS-011-operacion-lan-interrumpida.md)
describe esa brecha, mientras FS-006 conserva la garantía local.

## Invariantes

- Un documento emitido no se edita; se corrige mediante un documento compensatorio.
- En standalone, caja, inventario, ledger, outbox y estado fiscal se confirman juntos o
  no se confirman. La coordinación LAN no se habilita hasta especificar y probar el paso remoto
  autoritativo conforme ADR-0026; no se promete una transacción entre dos SQLite.
- Toda acción sensible deja actor, terminal, nodo, UTC y motivo.
- Un fallo de impresión simulada conserva un estado recuperable e idempotente.
- El saldo esperado puede ser negativo por reintegros y debe mostrarse con su signo.
- El reintegro usa el método de pago original de la venta devuelta.
- Cerrar un turno con esperado negativo requiere motivo y autorización de supervisor; no se
  cierra en silencio.

## Consecuencias

9B.06 y la parte de revisión del perfil Supervisor pueden avanzar sin reapertura de turnos ni
validación fiscal profesional. La certificación real sigue siendo un gate de Fase 8/piloto.

El reconocimiento de esperado negativo al cierre (punto 8) lo implementa 9B.12 en el Corte 3
del plan correctivo, junto con la semántica de arqueo; 9B.06 solo garantiza que el reintegro
sigue el método original y que el negativo se conserva con su signo.
