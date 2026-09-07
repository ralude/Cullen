# FS-010: transferencia interna interrumpida

## Respaldo actual

**Brecha post-MVP; ciclo operativo pendiente de decisión en 13.01.** Se aprobó el alcance
multi-almacén, pero no se implementó una transferencia ni se decidió si su recepción será
inmediata o separada. Esta ficha no define estados de dominio ni reglas de faltantes.

## Riesgo

Una salida sin entrada trazable, una recepción repetida o una cancelación incorrecta pueden
perder o duplicar existencia al mover mercancía entre almacenes de la misma sucursal.

## Estado inicial

Existencias por almacén bajo el mismo coordinador y una intención de traslado identificable.
El saldo y el lote de origen deben cumplir las invariantes aprobadas.

## Trigger del fallo

Reinicio durante una transición, doble confirmación, recepción tardía, traslado concurrente,
stock insuficiente o diferencia física entre lo despachado y lo recibido.

## Comportamiento prohibido

- Representar el traslado con ajustes independientes sin identidad/correlación común.
- Recibir dos veces una cantidad por reintentar la misma intención.
- Dar por disponible mercancía aún en tránsito o borrar evidencia para cancelar.
- Dejar cambios parciales de una transición cuyo estado no se confirmó.
- Permitir que un nodo distinto del dueño escriba los mismos agregados.

## Comportamiento esperado

Cada transición confirma estado, movimientos, auditoría e idempotencia de forma atómica.
Si el ciclo aprobado es inmediato, salida y entrada se confirman juntas. Si separa despacho
y recepción, representa el tránsito y su recuperación; parcialidad, faltantes y compensación
obedecen la especificación que debe aprobarse, no defaults de esta ficha.

## Garantía requerida

Conservación de cantidad entre origen, tránsito y destino, con cualquier pérdida/reverso
explícitamente resuelto y auditado según política. Un retry no agrega efectos.
**Todavía no implementada ni probada.**

## Retry

Reusar la identidad de intención y devolver el resultado confirmado. Los conflictos de
versión o falta de stock no se reintentan a ciegas; la clasificación y códigos se definen en
13.01 siguiendo el catálogo de errores existente.

## Recuperación

Reabrir el estado relacional confirmado después del reinicio. Una transición fallida revierte
su transacción. Un traslado despachado pendiente conserva evidencia y sigue el caso de uso
aprobado de recepción o resolución; no se corrige mediante SQL manual.

## Observabilidad

Referencia de traslado, almacenes, actor, nodo, timestamps, motivo y cantidades/lotes.
Distinguir transición fallida de traslado pendiente de recepción.

## Impacto operativo

La mercancía afectada puede permanecer fuera de disponibilidad hasta resolver el traslado.
El tratamiento de otras ventas/conteos se fija en la especificación operativa de Fase 13.

## Componentes afectados

Agregados de inventario/transferencia, casos de uso, UnitOfWork SQLite, idempotencia, auditoría,
kardex y pantallas locales. La proyección cloud se valida posteriormente en Fase 15.

## Pruebas pendientes

- [ ] Conservación de cantidad y lote con el ciclo aprobado.
- [ ] Fallo antes/después del commit de cada transición.
- [ ] Reentrega de intención y recepción concurrente.
- [ ] Falta de stock y coexistencia con conteos/ventas.
- [ ] Parcialidad, faltantes o cancelación según la política que se apruebe.
- [ ] Reapertura de SQLite y recuperación sin edición de historia.

## Documentos relacionados

- [ADR-0024](../architecture/adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md).
- [13.01: decisiones operativas](../cronograma/fase-13-almacenes/13.01-modelo-y-decisiones.md).
- [13.04: transferencias internas](../cronograma/fase-13-almacenes/13.04-transferencias-internas.md).
- [FS-004](./FS-004-sqlite-busy-concurrency-conflict.md).
- [Errores](../architecture/11-errores.md).
