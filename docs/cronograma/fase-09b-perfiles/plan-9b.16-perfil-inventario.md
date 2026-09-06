# Plan de ejecución 9B.16: Perfil Inventario

- **Sub-fase:** [9B.16 Perfil Inventario](./9b.16-perfil-inventario.md)
- **Estado del plan:** ~~Implementado y cerrado 2026-09-05~~
- **Base:** 9B.03 completada; 9B.04 y 9B.07 están reabiertas; 9B.08 permanece
  diferida por [ADR-0020](../../architecture/adr/0020-modelo-de-almacenes-y-transferencias.md)
- **Disciplina:** Outside-in TDD (ADR-0007) y Ponytail `full`

## Resultado esperado

Ofrecer un workspace de inventario para consultar existencia y kardex, recibir compras,
registrar ajustes, ejecutar conteos y administrar proveedores, todo sobre la existencia única
del nodo y sin acceso a caja o venta.

## Línea base comprobada

- Ya existen recepción, ajuste y kardex por producto; proveedores y conteos físicos están
  implementados, pero costo, autorización y concurrencia tienen correcciones pendientes.
- La pantalla actual exige buscar primero un producto para ver su kardex; no existe una lectura
  operativa paginada de existencias como punto de entrada.
- `StockItem` ya contiene lotes, vencimientos y movimientos append-only.
- `stock_items.product_id` representa una existencia por producto y nodo. 9B.08 no puede
  añadirse sin cambiar esa identidad y está diferida.

## Decisiones de composición

- Se añade una lectura acotada de existencias del nodo solo si la UI no puede resolverla con
  las lecturas actuales; no se crea un agregado ni repositorio paralelo.
- Listado y kardex admiten búsqueda, lote, período y límite. La aplicación fija y recorta la
  cota; React no descarga todo para filtrar.
- Recepción, ajuste y conteo conservan sus documentos/referencias y motivos. La recepción
  durable y los costos se incorporan desde 9B.04 cuando esa sub-fase esté lista.
- Las secciones se derivan de permisos de inventario, conteo y proveedor. El rol no se
  inspecciona ni se codifica en el renderer.
- La UI dice “existencia del nodo”; no muestra almacenes ni botones de transferencia.

## Secuencia de implementación

1. Probar la composición exacta de secciones para combinaciones de permisos.
2. Probar la lectura acotada de existencias y kardex con búsqueda, lotes, vencimientos y orden
   estable; añadir el mínimo contrato/puerto/ruta si falta.
3. Reutilizar las pantallas de proveedor y conteo sin duplicar estado ni cliente HTTP.
4. Probar el recorrido proveedor activo → recepción → kardex → conteo → aprobación/ajuste.
5. Integrar documento y costo de 9B.04 sin cambiar la semántica de conteos o kardex.
6. Probar que no aparecen caja, venta ni transferencias sin los permisos/capacidades
   correspondientes.
7. Ejecutar verificaciones y actualizar cronograma.

## Criterios de aceptación

- [x] ~~La existencia del nodo es el punto de entrada y muestra lotes/vencimientos cuando aplican.~~
- [x] ~~Listado y kardex están acotados y filtrados en servidor/aplicación.~~
- [x] ~~Recepción, ajuste y conteo conservan referencia, motivo, actor y UTC.~~
- [x] ~~Proveedores y conteos se reutilizan; no existen pantallas o repositorios duplicados.~~
- [x] ~~No se ofrece almacén ni transferencia mientras 9B.08 siga diferida.~~
- [x] ~~Caja y venta no aparecen por pertenecer a otro conjunto de permisos.~~
- [x] ~~`pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.~~ 591 pruebas / 120 archivos.

## Fuera de alcance

- Multi-almacén, transferencias, sincronización y ownership entre nodos.
- Compras por orden, cuentas por pagar y planificación de abastecimiento.
- Optimización anticipada del kardex o índices sin medición de Fase 12.
