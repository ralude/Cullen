# Plan de ejecución 9.04: Pantalla de catálogo

- **Sub-fase:** [9.04 Pantalla de catálogo](./9.04-pantalla-catalogo.md)
- **Estado del plan:** Ejecutado; queries de lectura publicadas
- **Prerrequisito:** [9.03 Pantalla de caja](./9.03-pantalla-caja.md)
- **Disciplina visual:** Ponytail `full`, limitada a presentación

## Resultado esperado

El operador consulta el catálogo, busca un producto por barcode y, cuando la
aplicación lo autoriza, crea o actualiza producto y precio. La pantalla muestra
el historial real de precios sin consultar SQLite ni reconstruirlo desde eventos.

La ejecución añadió ListProducts y GetPriceHistory como casos de uso de lectura,
su adaptador Drizzle y los contratos GET autenticados. El renderer conserva
todas las mutaciones detrás de claves de idempotencia y traduce permisos por
ProblemDetails.

## Línea base comprobada

- Ya existen comandos HTTP para crear/actualizar producto y actualizar precio,
  además de la búsqueda exacta por barcode.
- `ProductResponse` contiene el snapshot comercial, unidad, barcodes, precio,
  impuesto, estado y versión.
- `product_price_history` existe y `Product` se rehidrata con su historia, pero
  el puerto público solo permite buscar por ID o barcode.
- No existen contratos para listar productos, leer historia ni listar categorías
  y unidades activas requeridas por el formulario.
- Los permisos estables de mutación ya están fijados por ADR-0012; las lecturas
  solo requieren sesión.

## Contratos de lectura a publicar primero

- `GET /api/v1/catalog/products`: listado real de productos, sin filtros o
  paginación especulativos en este corte.
- `GET /api/v1/catalog/products/:productId/price-history`: historia completa,
  ordenada de más reciente a más antigua, con precio, moneda, UTC, actor y
  motivo ya redactado por su contrato.
- `GET /api/v1/catalog/references`: categorías y unidades activas necesarias
  para capturar `categoryId` y `unitCode` sin pedir códigos desconocidos.

Cada endpoint tendrá un query de aplicación y un puerto de lectura explícito.
El adaptador Drizzle puede leer las tablas dueñas del módulo; la ruta Fastify
solo valida y delega. No se amplía `ProductRepository` con búsquedas de UI si un
read model pequeño expresa mejor la consulta.

## Decisiones de frontera

- El listado inicial muestra todos los productos. Se añade paginación solo
  cuando exista un requisito o volumen medido; Fase 12 sigue siendo dueña de
  optimización.
- La búsqueda por barcode continúa siendo exacta y usa su contrato existente.
  No se inventa búsqueda difusa ni autocompletado.
- Crear y editar usan controles nativos y envían IDs/códigos elegidos desde las
  referencias activas; no duplican validación de catálogo como regla decisoria.
- Precio se modifica únicamente por `UpdatePrice`, nunca dentro de
  `UpdateProduct`; motivo y clave de idempotencia son obligatorios.
- La UI muestra unidades menores formateadas, puntos base como porcentaje y UTC
  como fecha local, conservando los valores originales al enviar comandos.
- Una mutación exitosa vuelve a cargar producto, listado e historia desde la
  API. Una denegación no actualiza optimistamente la vista.

## Secuencia outside-in

1. Escribir criterios y pruebas contractuales fallidas de las tres lecturas.
2. Crear queries/puertos de aplicación y adaptadores Drizzle con pruebas sobre
   SQLite temporal, incluida historia ordenada y referencias inactivas ocultas.
3. Registrar rutas autenticadas y probar que no requieren permisos de mutación.
4. Ampliar el cliente desktop y probar listado, barcode, creación, edición,
   precio, historial y denegación.
5. Reutilizar la infraestructura de interacción aprobada en 9.02 e implementar una pantalla en dos
   áreas: selección/listado y detalle/formulario.
6. Ejecutar pipeline y build; documentar el contrato y actualizar cronograma.

## Criterios de aceptación

Verificados con lecturas autenticadas de listado, búsqueda e historial, y con
formularios de alta/actualización que delegan autorización y persistencia en la
API.

- [ ] El listado devuelve productos persistidos y no una colección ficticia.
- [ ] La búsqueda exacta por barcode muestra el producto o `PRODUCT_NOT_FOUND`.
- [ ] Categoría y unidad se eligen desde referencias activas obtenidas por HTTP.
- [ ] Crear y actualizar producto usan exclusivamente sus comandos publicados.
- [ ] Actualizar precio exige precio, moneda y motivo y refresca la historia.
- [ ] La historia aparece en orden definido y conserva moneda, actor, UTC y
  motivo sin leer `product_price_history` desde React.
- [ ] Una sesión sin permiso recibe `FORBIDDEN` y no presenta éxito optimista.
- [ ] Pruebas de aplicación, adapter, contrato HTTP y recorrido de pantalla
  cubren las lecturas y mutaciones.
- [ ] Lint, typecheck, tests y build quedan verdes.

## Fuera de alcance

- CRUD de categorías y unidades.
- Importación masiva, imágenes, promociones o búsqueda difusa.
- Paginación, índices de búsqueda o caché sin necesidad medida.
- Edición directa de snapshots ya usados por ventas.
