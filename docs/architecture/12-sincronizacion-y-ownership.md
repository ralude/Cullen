# 12. Sincronización y ownership

## Topología

Cada terminal POS es un nodo operativo autónomo: ejecuta Fastify y abre exclusivamente su SQLite local. El nodo coordinador de tienda recibe eventos, distribuye configuración y mantiene proyecciones consolidadas. Una pérdida de LAN no impide terminar una venta local que cumpla la política offline.

Esta topología conserva la regla single-writer: cada archivo SQLite tiene un único proceso servidor propietario. La sincronización transporta eventos de integración; nunca replica tablas ni permite que dos nodos escriban el mismo agregado.

## Ownership inicial

| Agregado o dato | Autoridad de escritura | Operación offline | Política de conflicto |
|---|---|---|---|
| `Sale` | terminal donde se inició | completar localmente | un solo dueño; venta completada inmutable; deduplicar por `eventId` e idempotency key |
| `Shift` y movimientos de caja | terminal/caja de origen | operar localmente | no editar desde otro nodo; consolidar mediante eventos |
| `FiscalDocument` | terminal y dispositivo fiscal asociados | emitir/reconciliar localmente | nunca reemitir por timeout; recuperar estado del dispositivo |
| `Product`, precios e impuestos | nodo coordinador de tienda | leer snapshot local versionado | aplicar versiones ordenadas; no usar last-write-wins |
| tasas de cambio | nodo coordinador tras confirmación humana | usar última tasa vigente local | conservar fuente, vigencia y versión; no aplicar sugerencias automáticamente |
| usuarios, roles y permisos | nodo coordinador de tienda | usar concesiones cacheadas según política de expiración | permisos con códigos estables y roles configurables; revocaciones se aplican al sincronizar; la política definitiva se cierra antes del piloto |
| inventario (`StockItem`) | ledger autoritativo del nodo coordinador | vender contra una proyección local | movimientos append-only y saldo derivado; una desconexión no garantiza stock global; registrar discrepancia si el movimiento no puede aplicarse |
| `PurchaseReceipt` y `StockCount` | nodo donde se crean | completar el documento localmente | el nodo de origen es inmutable y otro nodo rechaza comandos de escritura |
| `Branch` | nodo coordinador de tienda; en standalone, el nodo local cumple ese rol | editar en el coordinador | distribuir versiones ordenadas; otro nodo solo consume la referencia |
| `Device` | nodo que declara el dispositivo | administrar el inventario local del equipo | `terminalId` es asignación operativa; `originNodeId` conserva la autoridad de escritura |
| reportes | proyecciones de lectura | consultar último estado sincronizado | reconstruir la proyección desde eventos idempotentes |

Las filas anteriores a esta decisión recuperan `originNodeId` únicamente desde su entrada de
auditoría de creación. Si esa evidencia no existe, el ownership queda sin resolver y cualquier
mutación se rechaza hasta una corrección administrativa explícita; la migración no inventa un nodo.

## Política inicial de inventario offline

El MVP acepta que dos terminales desconectadas no pueden garantizar simultáneamente stock global no negativo. La terminal usa una proyección informativa y la venta conserva su validez comercial. El nodo coordinador intenta registrar el movimiento; si la regla de stock no negativo lo impide, crea una discrepancia operativa auditable para resolución humana.

Antes del piloto se debe elegir y probar una política definitiva:

- mantener la reconciliación posterior;
- asignar cupos o reservas de stock por terminal;
- bloquear offline la venta de productos configurados como sensibles.

## Reglas del protocolo

- Todo evento incluye `eventId`, `aggregateId`, `aggregateType`, `aggregateVersion`, `originNodeId`, `occurredAt` y versión de contrato.
- El receptor deduplica por `eventId` y conserva el orden por agregado cuando sea requerido.
- Un comando se dirige al nodo dueño del agregado; no se resuelve concurrencia mediante last-write-wins.
- Los eventos desconocidos o incompatibles se aíslan para diagnóstico; no se descartan silenciosamente.
- La confirmación de entrega ocurre solo después de persistir el evento recibido.

## Operación degradada visible

La UI distingue `OFFLINE`, `CONNECTING`, `SYNCING`, `SYNCED` y `ATTENTION_REQUIRED`. Debe mostrar la antigüedad de catálogo, tasa y permisos cacheados, además de las discrepancias que requieran intervención.
