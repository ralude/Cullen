# Historial de cierre por fase

Relato de cierre de las fases ya completadas, conservado íntegro desde el
[cronograma maestro](./README.md), que dejó de alojarlo el 2026-09-18 para volver a ser un índice
de estado. **No se editó ningún párrafo al moverlo:** lo que dice cada uno es lo que se escribió
el día que esa fase cerró, con las cifras de prueba vigentes en esa fecha.

Este documento es histórico. El estado actual vive en el
[cronograma](./README.md) y el detalle de cada fase en su propio README. La regla 6 del
seguimiento —las tareas completadas se conservan y no se eliminan del historial— se cumple acá.


Durante la ventana de publicación se corrigió la base del IGTF en pagos mixtos, que era
recursiva y dejaba el cobro con dos métodos sin ningún importe deducible
([ADR-0031](../architecture/adr/0031-base-del-igtf-en-pagos-mixtos.md)); los defectos que esa
revisión y la demo destaparon sin corregir quedan en
[defectos conocidos](./defectos-conocidos.md).
Fase 11 entregó sus cinco sub-fases y la
[auditoría de cierre del 2026-09-09](./fase-11-seguridad/auditoria-cierre-2026-09-09.md) corrigió
trece hallazgos, cada uno con su prueba. En la verificación local del 2026-09-09 aprobaron
`pnpm lint`, `pnpm typecheck`, `pnpm test` —1.212 de 1.212 pruebas en 191 archivos— y
`pnpm build:artifacts`. Las tres pruebas de `generate-lan-material.test.ts` que antes quedaban
sin completar la emisión TLS pasan cuando el intérprete alcanza `openssl` en su `PATH`; el
diagnóstico anterior atribuía al host una carencia que era del entorno de ejecución. Ese mismo
pipeline ya corre en un runner remoto, y no solo en la máquina del autor.

Fase 12 comienza después de publicar `v0.1.0`: 12.01–12.03 y 12.05 preparan una versión
posterior; 12.04 continúa suspendida con Fase 8. La
[Fase 12B](./fase-12b-manual-usuario/README.md), planificada el 2026-09-09, también espera al
release: entrega el manual de usuario no técnico que cubre las doce pantallas de la navegación
más el ingreso, el cambio de PIN y el enrolamiento. Es documental, no depende de Fase 12 ni la
bloquea, y absorbe [`operacion-diaria.md`](../operacion/operacion-diaria.md), que queda como
redirección al cerrarse. Sus tres decisiones de alcance —una captura por pantalla, absorción de
la guía anterior y ejecución posterior al release— quedaron fijadas el 2026-09-09 en su README.

El [rediseño de la pantalla de venta](./rediseno-pantalla-de-venta.md), cuya dirección se
aceptó el 2026-09-10, baja el cobro a una barra de ancho completo, captura un pago a la vez y
publica la tasa de IGTF por método. Su requisito previo ya está entregado: la
[enmienda del 2026-09-11 a ADR-0031](../architecture/adr/0031-base-del-igtf-en-pagos-mixtos.md#enmienda-2026-09-11-la-pantalla-puede-sugerir-el-importe-gravado)
autoriza a la pantalla a precargar el importe gravado como sugerencia no autoritativa, con la
primitiva compartida `TaxRate.includeIn` en lugar de una segunda fórmula, y fija el redondeo
único sobre la base gravada agregada. El resto del rediseño sigue pendiente y no toca el
agregado `Sale`.

El release de portafolio no habilita una tienda: el
[gate de piloto](./gate-piloto-release.md) conserva sus requisitos de hardware, fabricante,
laboratorio y operación real.
Desde el 2026-09-09 corre en paralelo el [paquete pre-piloto](./pre-piloto/README.md), que **no
es una fase**: entrega capacidad de despliegue que el gate de piloto ya exigía —empaquetado del
nodo, respaldo operativo y material TLS de LAN— sin reabrir la Fase 11 ni adelantar la 12.
**Fase 10, completada el 2026-09-07:** 10.01 entregó el outbox
durable ordenado por agregado con claims generacionales; 10.02 el protocolo de eventos de
[ADR-0023](../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md); 10.03 el servidor
receptor y la base operativa LAN; y 10.04 la operación offline con reconexión.

El cierre incluye: registro confiable de nodos con alta y revocación auditadas; transporte
HTTPS con autenticación mutua en un listener técnico separado; custodia durable con
deduplicación, cuarentena y ACK posterior al commit; tres consumidores compuestos —inventario
autoritativo, referencias y consolidación comercial—; el conjunto cerrado de referencias con
catálogo, categorías, unidades, métodos de pago, políticas operativas, tasas confirmadas,
concesiones de operador y disponibilidad informativa; el costo conocido al vender con
`SaleCompleted.v2`; la infraestructura durable de intención, paso y consulta de progreso; y el
estado visible con la antigüedad real de cada referencia; los efectos remotos autoritativos de
compra, conteo y devolución con su conciliación de `APPLIED`, `DISCREPANCY` y estados
desconocidos; los once escenarios de corte; y la interacción automatizada de la pantalla de
sincronización sobre `jsdom`. Migraciones 0028–0042.

Verificación de cierre: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`,
`pnpm test` (915 pruebas en 150 archivos, verdes) y `git diff --check` aprobados. Quedan fuera
del alcance cerrado la compensación explícita de un rechazo definitivo, que conserva un gate
separado, la administración de usuarios y roles de 11.02, las tiendas con historia y cualquier
piloto o producción; el hardware fiscal sigue siendo fake y toda representación conserva
`SIMULACION`.

El 2026-09-06 se planificó la secuencia restante **10.03 → 10.04** en el
[registro de decisiones y gates](./fase-10-sincronizacion/plan-secuencia-y-decisiones.md),
con planes de [receptor LAN](./fase-10-sincronizacion/plan-10.03-servidor-receptor.md) y
[operación offline/reconexión](./fase-10-sincronizacion/plan-10.04-offline-reconexion.md).
El usuario confirmó LAN operativa completa, nodos nuevos de prueba y alta manual auditable
de confianza. La planificación incorpora las brechas de referencias, bootstrap y entrega
por terminal de ADR-0023. Esa planificación se ejecutó completa, incluido el flujo remoto de D3
que la auditoría del 2026-09-07 había reabierto.
Las preguntas de negocio se resolvieron en la misma sesión y quedaron en
[ADR-0026](../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md), aceptado para
el MVP de prueba: operaciones de stock conectadas con conciliación recuperable, concesiones
de ocho horas, snapshot de costo al vender y diez intentos por ciclo con reanudación manual.

El
[plan correctivo de la auditoría del 2026-09-05](./fase-09b-perfiles/plan-correcciones-auditoria-9b.md)
quedó **cerrado el 2026-09-05** (Cortes 0-4). La auditoría había reabierto 9B.04, 9B.06, 9B.07
y 9B.11 y bloqueado 9B.12/9B.13 por decisiones pendientes.

Resultado del gate (580 pruebas / 119 archivos verdes; `typecheck`, `lint`, `git diff --check`
limpios):

- **Corte 0:** persistencia de `originNodeId` completada (migración `0026-aggregate-origin-node`,
  backfill solo desde la auditoría de creación, triggers de obligatoriedad e inmutabilidad).
- **Decisiones bloqueantes aceptadas:** ADR-0016 (moneda de valoración de escritura única +
  riesgo de margen mudo aceptado y «valoración inicial administrativa» diferida); M5 (un conteo
  `OPEN` por nodo; diferencia congelada aplicada como delta con signo); ADR-0017 punto 8 /
  FS-006 (reintegro por método original; esperado negativo exige motivo y autorización de
  supervisor al cierre, `SHIFT_NEGATIVE_EXPECTED_REASON_REQUIRED`, implementado en
  `CloseShift`); M8 (`originNodeId` como nodo de origen fijo e inmutable para `Branch`,
  `Device`, `StockCount`, `PurchaseReceipt`).
- **Corte 1:** invariante de costo, `PURCHASE_RECEIPT_SOURCE_DUPLICATED`, `DRAFT` sin efectos
  durables, `reverse()` validado antes de compensar, ownership de recepción.
- **Corte 2:** autorización en aplicación de todas las lecturas (incl. `GetKardex` con
  `inventory.kardex.read`), matriz de permisos ampliada, unicidad de identificador de
  dispositivo (app + índice `0024`), motivo del operador e idempotencia por intención en el
  renderer, `OPEN` único por nodo, `formatScaledDecimal` sin `float`, tipos reales de Electron.
- **Corte 3:** `GetSaleHistory` pliega devolución y cambio de destinatario, autoriza con
  `sale.history.read` y acota versiones; cierre con esperado negativo; "turno ajeno" definido
  como `Shift.openedBy !== actor`.
- **Corte 4:** margen neto de descuentos y devoluciones, período UTC válido con cota en SQL,
  `quantitySoldScaled` derivado sin costo, escalas incompatibles separadas, `currencyCode`
  normalizado a mayúsculas en la frontera.

Tras cerrar el gate se completaron **9B.12** (lectura de arqueo `GetShift` con pertenencia por
`Shift.openedBy` y `cash.shift.read.any`; `GET /api/v1/sales/:saleId/history` con
`sale.history.read`) y **9B.13** (`reports.sales.read` y `reports.inventory.read` con
adaptadores SQLite acotados, rutas y panel del renderer con exportación CSV; margen ya
corregido en el Corte 4). El 2026-09-05 se completaron **9B.10** y los perfiles
**9B.14-9B.18**, que ensamblan pantallas y controles a partir de permisos efectivos. Único diferido: el caso de uso de
corrección administrativa de `originNodeId`, solo si una migración real produce una fila sin
resolver.

9B.11 - Sucursales y dispositivos se marcó **completada** el 2026-09-04, con alcance recortado
(ver más abajo). 9B.07 - Conteos físicos quedó **completada** el 2026-09-04. 9B.03 -
Proveedores quedó **completada** el 2026-09-04. Su
[plan](./fase-09b-perfiles/plan-9b.03-proveedores.md) detectó que el snapshot de una recepción
`COMPLETED` exige costos de 9B.04 y que la arquitectura aún no reconocía `Supplier` ni
`PurchaseReceipt` como raíces. [ADR-0019](../architecture/adr/0019-proveedores-y-recepciones-de-compra.md)
implementó el maestro `Supplier` y reservó la recepción completa para 9B.04. La sub-fase
entregó el maestro persistido y auditado, la pantalla administrativa con controles derivados
de los permisos efectivos, la recepción sin datos técnicos escritos por el renderer y, en su
corte de cierre, las reglas fiscales aprobadas por el negocio: RIF venezolano estructural sin
checksum, identidad genérica `TAX_ID` fuera de Venezuela, dirección fiscal estructurada y
semántica diferenciada de `BLOCKED` e `INACTIVE`.

9B.07 - Conteos físicos entregó `StockCount` como raíz separada de `StockItem`, con ciclo de
vida `OPEN -> COUNTED -> APPROVED|REJECTED`: `CloseStockCount` congela la diferencia de cada
línea contra el saldo vigente y `ApproveStockCount` la usa para registrar los ajustes
derivados, coordinando ambas raíces dentro de una sola `UnitOfWork`. Su
[plan](./fase-09b-perfiles/plan-9b.07-conteos-fisicos.md) dejó cuatro decisiones abiertas que
se resolvieron con el criterio más conservador y consistente con el código existente —
diferencia congelada al cierre, granularidad por lote impuesta por la invariante ya vigente de
`StockItem`, alcance del conteo limitado a las líneas registradas y separación de funciones
solo por asignación de permiso — documentadas en el corte de la sub-fase para que el negocio
las confirme o las corrija. No requirió ADR porque ninguna es una regla fiscal, contable o
legal: son decisiones de diseño reversibles.

9B.11 - Sucursales y dispositivos entregó `Branch` (maestro con código elegido por el
administrador, no generado por secuencia) y `Device` (raíz con tipo inmutable de lista
cerrada, identificador editable y `branchId` opcional). Su
[plan](./fase-09b-perfiles/plan-9b.11-sucursales-y-dispositivos.md) dejó abierta la relación
entre un nodo y su sucursal (¿un nodo pertenece a una sola sucursal, o una sucursal agrupa
varios nodos?); en vez de bloquear la sub-fase completa por esa pregunta no resuelta, se
recortó el alcance a lo que no depende de ella: administrar sucursales y etiquetar
opcionalmente qué dispositivo pertenece a cuál, sin que la estación declare su propia
sucursal como identidad de nodo. Una prueba de contrato demuestra que declarar una impresora
fiscal no altera `GET /api/v1/system/capabilities`, que sigue reportando `SIMULATION`.

El mismo 2026-09-04 se corrigió una excepción arquitectónica que el ADR-0012 dejó pendiente:
`OperationalPolicyWriter` (activación de las políticas versionadas de IGTF y descuento
máximo) vivía solo en `packages/drivers/db`, sin puerto en `core/application`. Se movió el
puerto a `core/application/ports` y `SqliteOperationalPolicyWriter` pasó a implementarlo; sin
cambio de comportamiento, `pnpm test` completo quedó verde en ese corte. Esto dejó lista la base para
que 9B.10 publique sus casos de uso de administración fiscal sin nueva cirugía.

La Fase 9B no tiene un gate legal global, pero desde el 2026-09-05 sí tiene un gate técnico
correctivo. 9B.04, 9B.05 y 9B.10 usan los defaults de referencia de ADR-0016, ADR-0018,
ADR-0017 y ADR-0021; 9B.12 queda acotada a lecturas, arqueos e historia, sin reapertura, y espera
las decisiones del corte 3. 9B.08 queda diferida por ADR-0020. Los perfiles 9B.14-9B.18 se
ensamblan solo después de cerrar el gate, según las capacidades disponibles.
Todas las sub-fases activas de 9B tienen ahora un plan de ejecución enlazado desde el índice de
la fase. 9B.08 conserva su plan de diferimiento y 9B.09 queda excluida por haber sido retirada.

La fundación de 9B (9B.00 permisos efectivos, 9B.01 renderer y 9B.02 datos maestros) y las
sub-fases 9B.03, 9B.06, 9B.07 y 9B.11 se marcaron completadas el 2026-09-04. La auditoría del
2026-09-05 reabrió 9B.06, 9B.07 y 9B.11, además de 9B.04. 9B.06 dejó la devolución
total simulada con restauración de inventario, reintegro en el turno, nota recuperable y
auditoría, sin declarar cumplimiento fiscal. La Fase 9 cerró sus sub-fases y
la Fase 8 permanece suspendida: su validación de hardware y cumplimiento solo es requisito del
piloto o la producción. La Fase 10 cerró sus cuatro sub-fases el 2026-09-07.

## Notas movidas desde el índice

Entradas que el cronograma maestro alojaba en «Documentos transversales» y que dejaron de
pertenecer ahí. Se conservan con su redacción original y su fecha.

- **Fase 12.05 — Mantenibilidad estructural y eficiencia de contexto**, añadida el 2026-09-08 con
  diagnóstico de hubs y baseline estática reproducible: «Con la Fase 11 entregada el 2026-09-08 la
  ejecución queda desbloqueada, pero no cambia la fase activa ni el gate fiscal y no se inician
  refactors.» Esa última frase quedó superada el 2026-09-17, cuando 12.05 entregó sus cinco cortes
  y su benchmark. La sub-fase se sigue desde
  [su ficha](./fase-12-optimizacion/12.05-mantenibilidad-estructural.md) y desde el
  [README de la Fase 12](./fase-12-optimizacion/README.md), no desde el índice.
