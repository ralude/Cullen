# Plan de ejecución 9.05: Pantalla de inventario

- **Sub-fase:** [9.05 Pantalla de inventario](./9.05-pantalla-inventario.md)
- **Estado del plan:** Ejecutado; lectura de lotes enriquecida
- **Prerrequisito:** [9.04 Pantalla de catálogo](./9.04-pantalla-catalogo.md)
- **Disciplina visual:** Ponytail `full`, limitada a presentación

## Resultado esperado

El operador selecciona un producto, consulta saldo y kardex y registra una
recepción, merma o ajuste autorizado. Toda variación de cantidad nace como un
movimiento append-only; la pantalla no ofrece una celda ni endpoint de edición

La ejecución amplió KardexDto con lotes, número de lote y vencimiento, serializó
las fechas en el contrato HTTP y mostró esos datos junto con el saldo y los
movimientos append-only.
directa del saldo.

## Línea base comprobada

- La API ya publica recepción, ajuste y kardex con filtros de lote, UTC y motivo.
- `GetKardex` deriva el saldo y ordena movimientos; `StockItem` aplica escala,
  lote, balance no negativo y FEFO en dominio.
- `StockItem` rehidrata lote y vencimiento, pero `KardexDto` solo expone
  `batchId`; por ello la tarea de mostrar lote y vencimiento no es posible con
  el contrato actual.
- Los permisos de recepción, merma y ajuste se validan en aplicación antes de
  cualquier efecto y auditoría.
- El listado de catálogo planificado en 9.04 puede ser el selector de producto;
  no se crea otro buscador duplicado.

## Cambio contractual mínimo

Enriquecer la respuesta de kardex con una colección inmutable de lotes
referenciados: `id`, `lotNumber` y `expiresAt` UTC o `null`. Los movimientos
conservan `batchId`; React resuelve solo la etiqueta de presentación. El caso de
uso obtiene esos datos del agregado ya cargado, sin una consulta SQL desde la
ruta ni una tabla paralela de saldos.

El cambio comienza en una prueba de `GetKardex`, continúa en DTO/schema
compartido y termina en la prueba contractual HTTP. Si se decide incrustar lote
en cada movimiento, debe documentarse antes para no publicar dos formas del
mismo dato.

## Decisiones de frontera

- Formatear cantidades escaladas como texto sin convertir a `float`; el parser
  inverso produce `{ quantityScaled, quantityScale }` y tiene pruebas de borde.
- Recepción captura proveedor, recepción, motivo y lote/vencimiento cuando el
  stock declara `tracksBatches`. La API continúa siendo la autoridad final.
- Merma siempre exige motivo y usa `WASTE`; ajustes distinguen
  `ADJUSTMENT_IN` y `ADJUSTMENT_OUT` y exigen referencia.
- Después de cada comando se vuelve a consultar el kardex. No se altera saldo o
  movimiento optimistamente.
- Filtros usan inputs nativos de fecha y texto; las fechas se convierten a
  límites UTC explícitos antes de llamar a la API.
- No crear edición, eliminación o corrección in-place de movimientos.

## Secuencia outside-in

1. Probar y publicar el enriquecimiento de lotes en aplicación, shared y HTTP.
2. Probar el cliente desktop para filtros, recepción y ajustes idempotentes.
3. Probar con la infraestructura de interacción aprobada en 9.02 el recorrido observable con
   producto sin stock, sin lotes y con lotes.
4. Implementar selector reutilizando la lectura de catálogo, resumen de saldo,
   filtros, tabla de movimientos y formularios de comando.
5. Probar denegación, escala inválida, lote requerido, stock insuficiente,
   conflicto idempotente y fallo de red.
6. Ejecutar pipeline y build; actualizar cronograma antes de 9.06.

## Criterios de aceptación

Verificados con kardex de lectura, recepción, ajustes, motivos obligatorios y
exposición de lote/vencimiento; no existe edición directa de cantidades.

- [ ] Saldo, unidad y escala proceden de `KardexDto` y no de una suma en React.
- [ ] Cada movimiento muestra dirección, cantidad, motivo, referencia y UTC.
- [ ] Para inventario por lotes se muestran número de lote y vencimiento cuando
  existen; nunca se presenta `batchId` como única información al operador.
- [ ] Recepción, merma y ajuste exigen todos los campos de evidencia del
  contrato y conservan una clave por intención/retry.
- [ ] La pantalla no contiene controles, método HTTP ni cliente para editar
  directamente saldo, lote o movimiento persistido.
- [ ] Un comando autorizado refresca el kardex; uno denegado o fallido no
  modifica la vista como si hubiera sido aceptado.
- [ ] Las pruebas cubren explícitamente la ausencia de edición directa.
- [ ] Lint, typecheck, tests y build quedan verdes.

## Fuera de alcance

- Corrección o borrado de movimientos históricos.
- Política definitiva de inventario global offline, reservada a Fase 10.
- Alertas de reposición, valoración, compras completas o optimización FEFO.
- Edición de productos desde la pantalla de inventario.
