# FS-011: operación comercial LAN interrumpida

## Respaldo actual

**Decidido, pendiente de implementación e integración.**
[ADR-0026, D3](../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) aprueba
conexión inicial para compras, aprobación de conteos y devoluciones, e intención pendiente
de conciliación ante interrupción. Hoy los flujos existentes son locales; no hay pruebas
de coordinación comercial entre dos SQLite. 10.03 especifica e implementa los pasos y
10.04 prueba su interrupción en una LAN con nodos independientes.

## Riesgo

Un timeout después de un efecto local o remoto puede aparentar fracaso y provocar otra
operación, duplicando stock, reintegro o nota. También puede aparentar éxito aunque falte
un efecto obligatorio en el nodo dueño.

## Estado inicial

Operador autorizado, terminal y coordinador de la misma tienda registrados, referencias
utilizables e intención con ID/fingerprint estable. Cada agregado tiene dueño único y
cada archivo SQLite lo abre exclusivamente su servidor. En devolución se conserva venta,
turno actual, método de pago original y evidencia de lote/costo de la salida autoritativa.

## Trigger del fallo

Se pierde LAN o termina un proceso después de persistir la intención, durante un paso,
después de un commit y antes de su ACK, o después de algunos efectos y antes del cierre
global. Una dependencia puede no estar aplicada, incluida una venta con discrepancia de stock.

## Comportamiento prohibido

- Repetir la intención con otro ID por timeout, duplicar un reintegro o reimprimir por sync.
- Declarar éxito global sin evidencia de los efectos obligatorios o cancelar por ausencia de ACK.
- Compensar un efecto desconocido, modificar historia o inventar lote/costo/stock.
- Mantener una transacción SQLite abierta esperando red o escribir el agregado del otro nodo.
- Convertir un permiso vencido en una nueva concesión para iniciar otra operación.

## Comportamiento esperado

Conservar la intención antes de cualquier efecto. Cada paso confirma efecto y evidencia
idempotente en su nodo; el otro consulta ese resultado tras una respuesta perdida. Mientras
falte evidencia, mostrar pendiente de conciliación con pasos confirmados y pendientes.

Una devolución no restituye antes de conocer la salida original aplicada y su costo/lote.
La falta de esa evidencia mantiene dependencia/revisión; no produce una restitución inferida.
Reintegro y fiscalidad siguen en el origen. La coordinación no sustituye la máquina de
estados fiscales ni habilita emisión legal.

## Garantía e invariantes

Garantía objetivo aceptada: cada efecto corresponde a una intención/paso durable y puede
reconciliarse sin duplicación; no se promete commit atómico entre dos bases. Standalone
mantiene la atomicidad local vigente de FS-006 y de los documentos de compra/conteo.

**Brecha:** faltan contratos concretos, estados y pruebas de caída en cada frontera. Esta
ficha no acredita que la garantía distribuida exista hoy ni permite activar esos flujos.

## Retry

Redelivery del mismo paso consulta/reutiliza su resultado. Red transitoria sigue la política
acotada de ADR-0026; agotamiento requiere reanudación autorizada. Un rechazo comercial
definitivo con efectos previos exige revisión; no se reintenta a ciegas. Fiscalidad conserva
las reglas de evidencia de [09-estados-fiscales.md](../architecture/09-estados-fiscales.md).

## Recuperación

Al reconectar/reiniciar, recuperar intenciones pendientes desde tablas relacionales y consultar
los nodos dueños. Completar pasos idempotentes solo con evidencia suficiente. La recuperación
de una intención comprometida no crea otra operación ni prolonga permisos; acciones humanas
de revisión/compensación requieren permiso vigente y motivo. Compensaciones concretas se
especifican antes de implementar cada flujo y conservan historia append-only.

## Observabilidad

Auditoría con intención, paso, actor, terminal, nodo, UTC, motivo y correlación; diagnóstico
técnico por IDs y códigos seguros. La lectura muestra avance comercial y estado fiscal
por separado. No copiar payload, PII, credenciales o texto remoto arbitrario a los logs.
Los códigos normativos se definen en [11-errores.md](../architecture/11-errores.md).

## Impacto operativo

El operador ve una operación pendiente y puede consultar su recuperación. No se le pide
repetir cobro/reintegro ni crear otro documento. Las nuevas ventas siguen el modo offline
permitido; una intención incierta no se presenta como completada ni desaparece al reiniciar.

## Componentes

Casos de uso de compra, conteo, devolución, caja e inventario; coordinación de aplicación;
puertos de intención/resultado; drivers DB/transporte; outbox/inbox, auditoría, API local,
renderer y `FiscalPrinterFake`.

## Pruebas requeridas

- Caída antes/después de cada commit y antes/después de cada ACK de cada flujo.
- Reinicio de ambos nodos, reentrega y dos solicitudes de la misma intención.
- Mismo ID con fingerprint diferente, nodo ajeno y permiso vencido.
- Devolución antes de salida aplicada y venta con discrepancia; no restituir stock inventado.
- Costo cambiado entre venta y recepción; conservar snapshot y costo desconocido explícito.
- Pendiente visible, recuperación autorizada y ausencia de doble stock/reintegro/impresión.

Son criterios de [10.03](../cronograma/fase-10-sincronizacion/plan-10.03-servidor-receptor.md)
y [10.04](../cronograma/fase-10-sincronizacion/plan-10.04-offline-reconexion.md), todavía sin cobertura.

## Documentos relacionados

[ADR-0026](../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md),
[FS-004](./FS-004-sqlite-busy-concurrency-conflict.md),
[FS-005](./FS-005-venta-concurrente-ultima-unidad.md),
[FS-006](./FS-006-devolucion-nota-credito-simulada.md),
[FS-007](./FS-007-entrega-outbox-ambigua.md) y
[FS-008](./FS-008-contrato-sync-incompatible.md).
