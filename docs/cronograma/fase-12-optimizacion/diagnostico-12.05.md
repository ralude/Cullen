# Diagnóstico inicial de radio de contexto

Inspección del 2026-09-08 sobre `a73dd33`, working tree inicialmente limpio. Este informe
precede a cualquier refactor de 12.05. Estado, aceptación y commits se mantienen únicamente
en [12.05](./12.05-mantenibilidad-estructural.md); listas de medición en el
[manifiesto](./context-radius-baseline.json). Las propuestas son hipótesis comprobables.

## A. Hotspots y evidencia

Las líneas son aproximaciones del archivo completo, incluidas líneas vacías y comentarios.
No son umbrales de calidad ni estimaciones de tokens.

- **P0 — `packages/drivers/db/src/repositories.ts`, 831 líneas.** Nueve clases de catálogo,
  moneda, caja, ventas e inventario comparten imports de entidades, tablas, Drizzle, conexión
  y unidad de trabajo. No necesitan compartir ownership por estar en el mismo driver.
  Consumidores: export público `index.ts`, `catalog-read-repository.ts`,
  `product-snapshot-provider.ts`, `catalog-reference-source.ts` y tests de repositorios,
  caja, ventas y sync. Un cambio de mapeo de stock cae en el mismo archivo que rehidrata ventas
  y caja. Propuesta: grupos físicos por contexto, exports estables e imports internos al dueño.
  Riesgo bajo/moderado: reubicar el helper `read`, preservar traducción de errores y transacción.
  Retorno alto esperado: excluir siete/ocho clases ajenas de una lectura local; no se promete
  reducir la cantidad de archivos del escenario.

- **P1 — `apps/server/src/runtime.ts`, 651 líneas.** Crea DB, seguridad, repositorios,
  instancias fiscales, aplicación comercial, reportes y consumidores LAN. Importa core y
  drivers públicos, además de enlaces de sync. Consumidores directos: `index.ts`,
  `bootstrap-admin.ts`, `testing.ts` y contract tests mediante runtime/testing.
  `ServerDependencies` ya agrupa capacidades: hay una frontera semántica utilizable.
  Propuesta: funciones explícitas por grupo, primero proveedores/reportes, con parámetros
  concretos. Riesgo moderado/alto al llegar a ventas/fiscal/sync: el emisor fiscal se comparte,
  caja se une a la transacción de venta y stock depende del rol del nodo. Retorno alto esperado
  para cableado local; la composición entre contextos sigue siendo trabajo transversal.

- **P1 — `apps/server/src/app.ts`, 365 líneas, hallazgo adicional.** Mezcla contrato
  `ServerDependencies`, helpers de autenticación/errores y registro de rutas/Fastify.
  Las rutas de proveedores/reportes, entre otras, importan valores y tipos desde este archivo,
  mientras este importa sus registradores. Es una dependencia de ida y vuelta observable,
  no evidencia de un fallo de inicialización. Separar runtime sin examinarla dejaría un hub.
  Propuesta: evaluar contrato y helpers HTTP independientes del registro, solo con consumidores
  reales. Riesgo moderado: manejo uniforme de identidad y errores. Retorno: que una ruta no
  necesite inspeccionar el arranque completo; evitar otro barrel con el mismo problema.

- **P1 — `apps/desktop/src/renderer/src/api-client.ts`, 591 líneas.** Transporte HTTP,
  contratos de todas las features, métodos planos, error y conversión de cantidades comparten
  archivo. Importa contratos públicos shared; no importa DB. Lo consumen `App`, screens,
  `screens/shared.tsx`, selector de productos y mocks/tests. `OperationApi` exige el conjunto
  de operaciones mediante `Required`, aunque una pantalla solo use unas pocas.
  Propuesta: transporte común pequeño y grupos semánticos, con tipos acotados por consumidor.
  Riesgo moderado: migración de mocks, métodos opcionales y pantalla que cruza compras/inventario.
  Retorno alto esperado en descubribilidad y cambios de transporte por feature; separar sin
  acotar `ScreenProps` dejaría parte del radio intacto.

- **P2 — `apps/desktop/src/renderer/src/App.tsx`, 557 líneas.** Navegación, atajos,
  recuperación de sesión, formularios de login, boundary y shell conviven. Importa React,
  contratos compartidos, API y pantallas; lo consumen entrada renderer y tests App/E2E.
  Ya existen `AppView`, `loadInitialState` y funciones puras de navegación: no parte de cero.
  Propuesta: navegación primero si facilita una tarea aislada; no extraer un hook por cada
  efecto. Riesgo moderado por sesión y listeners. Retorno posible para rutas/permisos,
  menor para bootstrapping que necesita conocer las piezas de todos modos.

- **P2 — `apps/desktop/src/renderer/src/screens/inventory.tsx`, 380 líneas.** Kardex,
  ajustes y recepción comparten estados y feedback; la recepción tiene proveedor, documento,
  moneda, costo, lote y finalización propios. Importa contratos de purchasing e inventory,
  API y selector; llega al shell por exports de pantallas. Propuesta: aislar el flujo de
  recepción completo, no secciones arbitrarias. Riesgo moderado por refresco del kardex y
  selección compartida. Retorno: modificar compras sin leer estado de consulta/ajuste.
  No existe aquí una pantalla `purchasing.tsx` que deba dividirse mecánicamente.

- **P2 — `screens/reports.tsx`, 435 líneas, y DB `reporting-repositories.ts`, 428 líneas.**
  La UI ya tiene componentes locales CashClosures, Audit, Fiscal, Sales, Margin e Inventory;
  comparten período, permisos, consultas y CSV. El driver implementa puertos de reporting y
  queries sobre datos de lectura; lo componen runtime y lo prueba reporting-repositories.test.
  Propuesta: ensayar la tarea de un campo antes de separar por reporte. Riesgo moderado de
  duplicar filtros/CSV o dispersar queries; retorno aún no demostrado. La lectura transversal
  del reporte es parte de su responsabilidad, no justificación automática de extracción.

## B. Qué conservaría

- **NO TOUCH — instrucciones.** Root tiene 123 líneas y las cuatro zonas ya tienen
  `AGENTS.md` propios con responsabilidad, imports, fuentes, tests y pitfalls.
  `c39f43c` hizo esa localización; `ef76527` añadió checkpoints semánticos. No recrear esa
  mejora ni atribuir su beneficio a 12.05. Actualizar solo rutas que cambien en futuros cortes.
- **NO TOUCH — `packages/drivers/db/src/schema.ts`, 666 líneas.** Registro central sin
  imports de repositorios; `connection.ts` importa el namespace y los drivers tablas concretas.
  Las FKs incluyen purchaseReceipts → suppliers y saleReturns → sales/fiscalDocuments/shifts,
  además de líneas de devolución → stockItems/batches. Son dependencias que una separación
  debe seguir haciendo visibles; no desaparecen moviendo tablas. No se ha demostrado ahorro
  frente a buscar el símbolo en un único archivo. Mantener las migraciones forward-only.
- **NO TOUCH — repositorios ya propios.** Supplier (108 líneas), purchase receipt, sale return,
  stock count, branch y device ya están separados. No crear niveles de carpetas por simetría.
  La clase base local `SupplierCommand` existe: no se amplía a framework universal ni se
  elimina oportunistamente dentro de la separación de persistencia.
- **NO TOUCH — venta y caja UI.** `screens/sales.tsx` tiene 369 líneas y `cash.tsx` 192;
  cada una presenta su flujo. Tamaño insuficiente como evidencia de fragmentación necesaria.
- **NO TOUCH — worker/transporte sync.** `sync-worker.ts` coordina ciclos y cierre;
  `lan-client.ts` configura conexión, el driver security implementa transporte,
  aplicación define consumidores/puertos y DB custodia/proyecta. Esa transversalidad es
  inherente. Se puede extraer su composición, conservando estas fronteras y su recuperación.
  No se ocultan cruces legítimos venta/caja/inventario ni contratos de referencias.

## C. Baseline y procedimiento

Los escenarios son ensayos de impacto, no solicitudes de nuevas reglas de negocio. Sus listas
de producción y tests están en JSON para repetirlas sin copiar otra tabla de rutas. Son
shortlists razonadas, no cierre transitivo de imports ni sesiones de ingeniería observadas.
`contexts` cuenta responsabilidades de negocio directamente revisadas; paquetes y capas no
se cuentan como bounded contexts. Autorización, Money/Quantity, UnitOfWork, exports y helpers
pueden requerir lecturas adicionales según el cambio concreto: registrarlas en el ensayo real.

Resultados iniciales, producción / tests candidatos / contextos / ediciones estimadas
(incluidos tests) / puntos de composición a editar / superficie íntegra de producción:

- Supplier: **13 / 5 / 1 / 7–10 / 0 / 4.177 líneas**. Nuevo campo podría exigir migración;
  no hace falta cambiar constructores si el contrato de dependencias permanece igual.
- StockItem: **8 / 4 / 1 / 2–4 / 0 / 2.163 líneas**. Cambio de validación existente,
  no alta de una nueva capacidad ni mutación de esquema.
- CompleteSale: **13 / 5 / 3 / 3–5 / 1 / 3.135 líneas**. El cruce caja/inventario es real;
  runtime debe inspeccionarse para conservar modo standalone/LAN.
- Apertura/cierre de Shift: **12 / 5 / 3 / 2–4 / 0 / 2.595 líneas**. El probe de ventas
  abiertas y los métodos de pago explican los contextos sales/currency además de cash.
- Campo del reporte de inventario: **13 / 4 / 2 / 5–8 / 0 / 4.179 líneas**. El DTO llega a
  dos pantallas; preservar consumidores de overview y exportación CSV.
- Referencia de catálogo en sync: **12 / 5 / 2 / 4–7 / 0 / 4.722 líneas**. La publicación,
  contrato y proyección requieren revisión; transporte/worker no cambian por añadir un dato.

Estas superficies suman archivos completos, no líneas realmente leídas. La reducción útil
sería excluir implementaciones hermanas de esos archivos, aunque el número de archivos suba.
No hay AFTER: no se ejecutaron refactors ni se midieron tokens. Confianza media en rutas de
entrada y baja en ediciones estimadas hasta concretar el cambio. Los tests son candidatos
iniciales, no una promesa de cobertura exhaustiva ni sustituto del mínimo global.

Carga documental separada: root y cada AGENTS local tocado (core, DB, server y desktop cuando
aplique), plan de fase y norma de la responsabilidad. Supplier: ADR-0019; StockItem:
08-base-de-datos y especificación de inventario; CompleteSale: FS-005 y ADR-0026; Shift:
especificación de caja; reportes: ADR-0013; sync: ADR-0022/0023/0026 y escenario de fallo
pertinente. No cargar todos esos documentos para todas las tareas. La revisión inicial de
arquitectura es más amplia que una futura modificación local.

Desde la raíz, este comando PowerShell verifica rutas y reconstruye conteos/superficie
en el checkout correspondiente. Para BEFORE usar `a73dd33` en una copia independiente con
este manifiesto; no resetear el working tree del usuario. Para AFTER conservar las mismas
tareas, actualizar rutas al dueño nuevo y guardar ambas revisiones, sin sobrescribir BEFORE.

```powershell
$baseline = Get-Content docs/cronograma/fase-12-optimizacion/context-radius-baseline.json -Raw | ConvertFrom-Json
foreach ($task in $baseline.tasks) {
  $lines = 0
  foreach ($path in @($task.inspect) + @($task.tests)) {
    if (!(Test-Path -LiteralPath $path)) { throw "Ruta ausente: $path" }
  }
  foreach ($path in $task.inspect) { $lines += (Get-Content -LiteralPath $path).Count }
  '{0}: producción={1}; tests={2}; contextos={3}; superficie={4}' -f `
    $task.id, $task.inspect.Count, $task.tests.Count, $task.contexts.Count, $lines
}
```

La sesión real añadirá búsquedas, archivos/secciones abiertos, saltos máximos hasta el dueño,
ediciones efectivas y checks ejecutados. Comparar cada tarea consigo misma; no promediar una
gran mejora de UI para esconder una regresión de sync. Revalidar la baseline tras Fase 11.

## D. Orden y evidencia histórica

P0: baseline y persistencia base. P1: runtime con su contrato HTTP y API desktop. P2:
navegación, recepción y reportes solo tras ensayo. NO TOUCH: áreas justificadas arriba.
El [plan de commits](./12.05-mantenibilidad-estructural.md#orden-validación-y-commits) detalla
los hitos. No hay un commit de instrucciones ficticio ni un refactor global de cien archivos.

Historia revisada: `c39f43c` (AGENTS locales), `ef76527` (checkpoints), `7937df1` (cobro en
turno), `285f473` (cierre con ventas abiertas), `f03403c` (stock al completar venta),
`49dde47` (emisión fiscal), `8dcf1e6` (alta de cajas) y `71d96ae` (E2E real de venta y tests).
En sync: `74182b3`, `bd8877e`, `3d677c5` y `03b1a73` muestran conciliación y efectos LAN.
Estos cambios explican dependencias actuales; su cantidad de archivos no demuestra por sí
sola mala modularidad. `1898823` y cronograma mantienen el gate de Fase 11.
