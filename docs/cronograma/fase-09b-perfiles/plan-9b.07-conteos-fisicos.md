# Plan de ejecución 9B.07: Conteos físicos

- **Sub-fase:** [9B.07 Conteos físicos](./9b.07-conteos-fisicos.md)
- **Estado del plan:** Reabierto por auditoría del 2026-09-05
- **Prerrequisito:** [9B.03 Proveedores](./9b.03-proveedores.md), completada
- **Disciplina de implementación:** Outside-in TDD (ADR-0007) y Ponytail `full`

## Resultado esperado

Contar existencia deja de ser un ajuste suelto escrito a mano. Un conteo es un
documento con líneas contadas, autor, estado y cierre; la diferencia contra el
kardex la calcula la aplicación y el ajuste resultante nace de esa diferencia
aprobada, con trazabilidad de quién contó y quién autorizó.

## Línea base comprobada

- `RegisterStockAdjustment` (`packages/core/src/application/inventory/register-stock-adjustment.ts`)
  registra un movimiento `WASTE`, `ADJUSTMENT_IN` o `ADJUSTMENT_OUT` autorizado por
  `inventory.waste.register|inventory.adjust`. Cada ajuste es independiente: no
  existe documento que los agrupe ni evidencia de qué se contó.
- El operador escribe hoy `quantityScaled` del ajuste. Nada comprueba que ese
  número provenga de un conteo ni de una diferencia real.
- `StockItem` deriva su saldo de movimientos append-only y no almacena saldo
  mutable. El kardex se calcula al consultarlo.
- `stock_items.product_id` es **único**: existe un solo artículo de existencia por
  producto en el nodo. Un conteo no tiene que elegir almacén.
- `INVENTORY_PERMISSIONS` expone tres permisos; no existe ninguno de conteo.
- No hay tabla, agregado, contrato ni pantalla de conteo en ninguna capa.

## Decisiones de frontera propuestas

### Agregado

`StockCount` es una raíz nueva del módulo `inventory`, separada de `StockItem`.
Contiene su ID técnico, el actor que abrió el conteo, su estado, sus líneas
contadas y el cierre. `StockItem` sigue siendo la única raíz que registra
movimientos: el conteo no muta existencia por sí mismo.

El caso de uso de aprobación coordina ambas raíces por puertos dentro de una
sola `UnitOfWork`: o se aprueba el conteo y se registran sus ajustes, o no se
confirma nada.

### Ciclo de vida

```text
OPEN -> COUNTED -> APPROVED
                \-> REJECTED
```

- `OPEN`: admite agregar, corregir y quitar líneas contadas.
- `COUNTED`: el conteo se cierra, se congela la lista de líneas y se calcula la
  diferencia contra el kardex. No admite más edición.
- `APPROVED`: se registran los ajustes derivados y el conteo queda inmutable.
- `REJECTED`: se conserva como evidencia y no produce ningún movimiento.

Un conteo `APPROVED` o `REJECTED` no se edita ni se borra. Un recuento posterior
es otro conteo.

### Casos de uso

- `OpenStockCount`: abre el documento con su alcance y actor.
- `RecordStockCountLine`: registra la cantidad contada de un producto.
- `CloseStockCount`: pasa a `COUNTED` y calcula la diferencia por línea.
- `ApproveStockCount`: registra los ajustes derivados y sella el documento.
- `RejectStockCount`: cierra sin efectos de inventario, con motivo.
- `GetStockCount` y `ListStockCounts`: lecturas con sesión verificada.

### Permisos

`inventory.count.perform` para abrir, registrar líneas y cerrar;
`inventory.count.approve` para aprobar o rechazar. Contar y aprobar son permisos
distintos porque la separación de funciones es el objetivo de la sub-fase.

### Cantidad contada

La línea se captura como decimal escrito por el operador y se escala con la
unidad del artículo, reutilizando `Quantity.fromDecimal` ya aprobado en 9B.03. La
diferencia **nunca** se escribe: se deriva de `contado - saldo`. Una línea de un
producto sin `StockItem` cuenta contra saldo cero.

### Ajuste derivado

Cada línea con diferencia distinta de cero produce un movimiento
`ADJUSTMENT_IN` o `ADJUSTMENT_OUT` cuyo `referenceId` es el ID del conteo y cuyo
motivo cita el conteo. Los ajustes se escriben con auditoría, ledger e
idempotencia según los patrones vigentes.

## Decisiones requeridas antes de implementar

Ninguna de estas se codifica con un valor por defecto.

1. **Momento de la diferencia.** Si entre `COUNTED` y `APPROVED` el saldo cambia
   por una venta o una recepción, ¿el ajuste usa la diferencia calculada al
   cerrar, o se recalcula contra el saldo del momento de aprobar? Congelar puede
   introducir un error conocido; recalcular puede aprobar una diferencia que
   nadie contó. Es una regla de negocio, no una preferencia técnica.
2. **Granularidad en artículos con lote.** `StockItem.tracksBatches` obliga a que
   todo movimiento indique lote. Si el conteo se registra por producto y no por
   lote, el ajuste no puede elegir a qué lote imputarse. Hay que decidir si los
   artículos con lote se cuentan por lote —y entonces la línea lleva `batchId`—
   o si quedan fuera del alcance de esta sub-fase.
3. **Alcance del conteo.** ¿Un conteo cubre un subconjunto elegido de productos,
   una categoría, o todo el inventario? Y si es parcial, ¿un producto no incluido
   se considera no contado, o contado en cero? La diferencia entre ambas lecturas
   es un ajuste masivo a cero.
4. **Separación de funciones.** ¿Puede el mismo actor contar y aprobar cuando
   tiene ambos permisos, o el sistema lo impide de forma explícita? ADR-0012 deja
   la asignación configurable, pero no dice si la coincidencia de actor se
   bloquea en el caso de uso.

## Secuencia outside-in

1. Probar los contratos HTTP de apertura, registro de línea, cierre, aprobación,
   rechazo y lectura, con sus permisos y su idempotencia.
2. Probar que la diferencia se deriva del kardex y que el operador no puede
   enviarla.
3. Probar el ciclo de vida completo y el rechazo de edición sobre un conteo
   cerrado, aprobado o rechazado.
4. Probar que la aprobación registra los ajustes y la auditoría en una sola
   transacción, y que un fallo no deja conteo aprobado sin movimiento ni
   movimiento sin conteo.
5. Probar un conteo sin diferencias, uno con diferencia aprobada y uno rechazado.
6. Implementar dominio, aplicación y puertos con fakes hasta que pase.
7. Agregar la migración forward-only y el repositorio Drizzle; verificar
   rehidratación, concurrencia optimista y rollback.
8. Publicar rutas y pantalla; derivar los controles de los permisos efectivos.
9. Ejecutar `pnpm test`, `pnpm typecheck`, `pnpm lint` y actualizar el cronograma.

## Criterios de aceptación

- [x] Las cuatro decisiones anteriores se resolvieron con el criterio más conservador y
  consistente con el resto del código (documentado en el corte del 2026-09-04 de la
  sub-fase), no como una elección de negocio silenciosa.
- [x] `StockCount` es raíz de agregado documentada en `04-entidades.md` y
  `05-agregados.md` antes de implementar.
- [x] El operador nunca escribe la diferencia; la aplicación la deriva del kardex.
- [x] Contar y aprobar exigen permisos distintos y la autorización ocurre en el
  caso de uso, no en el renderer.
- [x] Un conteo aprobado produce sus ajustes y ambos comparten transacción.
- [x] Un conteo cerrado, aprobado o rechazado es inmutable y no se borra.
- [x] La cantidad contada se escala con la unidad del artículo y rechaza más
  decimales de los admitidos.
- [x] `pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.

## Corrección obligatoria antes de volver a cerrar

- [ ] Resolver de forma normativa si pueden existir conteos `OPEN` solapados y cuál es el
  alcance de exclusión; no copiar un default silencioso.
- [ ] Probar dos conteos solapados y el cambio de saldo entre cierre y aprobación.
- [ ] Conservar el costo vigente en los ajustes derivados según la corrección de 9B.04.
- [ ] Autorizar `GetStockCount` y `ListStockCounts` en aplicación y probar que `FORBIDDEN` no
  consulta el repositorio.
- [ ] Mantener una clave de idempotencia por intención en la UI y cubrir estos contratos en la
  matriz de permisos.
- [ ] Formatear cantidades con la primitiva decimal compartida, sin división de punto flotante.
- [ ] Registrar ownership de `StockCount` antes de su migración correctiva.

El detalle y el orden viven en el
[plan correctivo de 9B](./plan-correcciones-auditoria-9b.md).

## Fuera de alcance

- Valoración del ajuste y su efecto en costo: 9B.04 y ADR-0016.
- Conteo por almacén o ubicación: depende del modelo de almacenes que 9B.08
  mantiene diferido en ADR-0020.
- Conteo cíclico programado, tolerancias automáticas y aprobación por umbral: no
  tienen regla aprobada ni consumidor.
- Sincronización entre nodos: Fase 10.
