# ADR-0020: Modelo de almacenes y transferencias de existencia

- Estado: **Aceptado con alcance diferido**
- Fecha: 2026-09-04
- Precisado para evolución post-MVP por: [ADR-0024](./0024-inventario-multi-almacen-y-consolidacion-cloud.md), 2026-09-06.

## Contexto

`stock_items.product_id` es único y el nodo actual gobierna una sola existencia por producto.
Agregar varios almacenes cambiaría la identidad de un agregado con movimientos persistidos,
además de exigir una regla de despacho, kardex y tránsito.

## Decisión

El MVP conserva **un almacén implícito por nodo**. 9B.08 se marca diferida y no agrega tablas,
migraciones, permisos ni transferencias simuladas. Si una necesidad real exige varios almacenes,
se abrirá una subfase con migración forward-only, ownership, despacho, kardex y recuperación
definidos antes de tocar `StockItem`.

La asignación inicial de transferencias entre sucursales o nodos a Fase 10 queda reemplazada
por la disposición de ADR-0024: evolución futura sin fase asignada y fuera de las fases 13–17
aprobadas. Fase 10 conserva sincronización terminal/coordinador. Dos ajustes independientes
no sustituyen una transferencia porque perderían la trazabilidad.

## Invariantes conservadas

- Un movimiento mantiene producto, lote, actor, motivo, referencia e idempotencia.
- Ninguna recepción, venta, conteo o ajuste necesita conocer un almacén inexistente.
- No se hace migración destructiva ni se reinterpretan movimientos históricos.

## Criterio para reabrir el alcance

Un caso de uso real de múltiples ubicaciones, un dueño de la decisión operativa y pruebas de
consistencia multi-almacén. Hasta entonces, el diferimiento es la implementación mínima.

El 2026-09-06 se aprobó ese caso para varios almacenes por sucursal y se asignó a
[Fase 13](../../cronograma/fase-13-almacenes/README.md), posterior al MVP. Las decisiones
operativas, la migración y las pruebas siguen pendientes; el alcance vigente del MVP y el
estado histórico diferido de 9B.08 se conservan.
