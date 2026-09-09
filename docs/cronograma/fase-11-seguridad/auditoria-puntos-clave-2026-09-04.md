# Registro de auditoría focal — 2026-09-04

- **Fase relacionada:** Fase 11 - Seguridad y fases propietarias de cada capacidad
- **Estado:** Seguimiento actualizado el 2026-09-08; conserva abiertas solo las deudas que no
  tienen evidencia de cierre
- **Alcance:** revisión selectiva de composición, persistencia, dominio, desktop,
  cronograma y pruebas. No es una auditoría exhaustiva del árbol ni una
  certificación de seguridad o fiscalidad.

## Resultado ejecutivo

La base arquitectónica conserva una dirección correcta: el dominio está separado
de la infraestructura, el dinero usa enteros y `BigInt` intermedio, las tasas son
explícitas, las sesiones son revocables y existen transacciones, ledger,
idempotencia y estados fiscales recuperables.

La principal brecha es de composición: los componentes individuales tienen
pruebas, pero el recorrido real de una venta todavía no conecta todos sus efectos.
La Fase 11 debe cerrar las garantías de identidad, transporte, protección de
datos y observabilidad alrededor de esos recorridos; no debe absorber reglas de
caja, inventario, costeo o sincronización que tienen otro dueño.

## Evidencia de la auditoría

- `pnpm test`: 542 pruebas aprobadas en 115 archivos.
- `pnpm lint`: aprobado.
- `pnpm typecheck`: falló en `@supermarket/core`. Se observaron diagnósticos por
  el doble de prueba fiscal sin `findByReference` y por `ReturnSale` (mapper no
  exportado y `cashRegisterId` ausente en la entrada). La ejecución se detuvo en
  ese paquete; no se presenta como un inventario completo de errores.
- Reproducción focal HTTP + SQLite temporal: una venta de USD 29,00 respondió
  `200 / COMPLETED`, el turno quedó con cero movimientos y el evento
  `SaleCompleted` quedó `PENDING` con cero intentos. El archivo de prueba temporal
  fue retirado y no se abrió la base operativa.
- Reproducción del costeo en memoria: entradas de 100 y 101 centavos, salida de
  las dos unidades, existencia cero y valor -1; una entrada posterior de 100
  centavos queda con promedio 99.

Revalidación del 2026-09-08: `pnpm pipeline` aprobó lint, typecheck y 1.182 pruebas en 186
archivos. Esta cifra actualiza la salud transversal; no altera la evidencia histórica de la
ejecución del 2026-09-04.

## Deudas asignadas por fase

### 1. Venta completada sin efectos derivados

- **Clasificación:** defecto comprobado de integración.
- **Evidencia al 2026-09-04:** `apps/server/src/runtime.ts:206` compone `CompleteSale` con
  outbox; no compone el relay ni los consumidores de caja e inventario.
  `apps/server/src/routes/sales.ts:125` devuelve la venta después del caso de
  uso. Los consumidores existen en `core`, pero la composición del servidor no
  los ejecuta.
- **Dueño del fix:** Fase 4 (outbox), Fase 5 (movimiento derivado de caja) y
  Fase 6 (salida derivada de inventario). La Fase 11.05 debe exigir la
  observabilidad de la entrega y del atraso, no implementar esos consumidores.
- **Criterio futuro:** una prueba HTTP con SQLite debe demostrar venta completada,
  movimiento de turno, salida de inventario, ledger, auditoría y outbox; debe
  repetir el caso tras reinicio y cubrir idempotencia. Un `COMPLETED` sin sus
  efectos derivados debe quedar visible como atención operativa.
- **Estado al 2026-09-08:** cerrado. La composición local de caja e inventario y la
  observabilidad de rechazos y atrasos están cubiertas.
  `CompleteSale` compone `ApplySaleCompletedToShift` y asienta el cobro en el
  turno dentro de la misma transacción que completa la venta: el `Shift`
  pertenece a la terminal de origen
  ([12-sincronizacion-y-ownership](../../architecture/12-sincronizacion-y-ownership.md)),
  así que es una escritura local del mismo nodo y no una entrega. Un turno
  cerrado, ajeno o inexistente revierte la venta entera.
  `packages/drivers/db/src/sale-cash-effect.integration.test.ts` lo demuestra
  sobre SQLite con movimiento, saldo, ledger, outbox, auditoría e idempotencia.
  El cierre de turno exige además que no queden ventas en `DRAFT`
  (`SHIFT_HAS_OPEN_SALES`, 409). Desde el 2026-09-07, `runtime.ts` también compone
  `ApplySaleCompletedToInventory` para standalone y ventas propias del coordinador, dentro
  de la transacción de `CompleteSale`. Un rechazo de negocio conserva la venta y registra
  `SALE_STOCK_ISSUE_REJECTED`; un fallo de infraestructura revierte según FS-004.
  Las terminales entregan el hecho al `InventoryAuthorityConsumer` del coordinador conforme
  a [ADR-0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md).
  [FS-005](../../failure-scenarios/FS-005-venta-concurrente-ultima-unidad.md) enlaza las pruebas
  de aplicación local y rechazo. `GetOperationalDiagnostics`, su adaptador SQLite, contrato
  local autenticado y pantalla presentan esa evidencia y el atraso remoto sin confundir
  ausencia de stock local en el POS con una salida faltante en el coordinador. La traza
  allowlist une ledger, outbox y auditoría sin exponer payloads de pago.
- **Escenarios relacionados:** [FS-005](../../failure-scenarios/FS-005-venta-concurrente-ultima-unidad.md)
  y [ADR-0005](../../architecture/adr/0005-eventos-outbox.md).

### 2. Redondeo del costo y residuo al agotar existencia

- **Clasificación:** defecto en trabajo local de 9B.04, no en una entrega cerrada.
- **Evidencia:** `packages/core/src/domain/inventory/stock-item.ts:85` calcula
  el valor a partir de movimientos y redondea el promedio; la salida congela ese
  promedio en `packages/core/src/application/inventory/apply-sale-completed-to-inventory.ts:76`.
- **Dueño del fix:** 9B.04, con el método de costeo de
  [ADR-0016](../../architecture/adr/0016-metodo-de-costeo-y-margen.md).
- **Criterio futuro:** decidir cómo absorber el residuo de unidades menores y
  probar que vender toda la existencia no deja valor negativo ni contamina la
  siguiente recepción o el margen.
- **Relación con Fase 11:** 11.05 debe conservar evidencia auditable del costo
  usado; no debe decidir la fórmula contable.
- **Estado al 2026-09-08:** la evidencia quedó cerrada en `SALE_STOCK_ISSUED` y en la lectura
  correlacionada —importe menor, moneda y fuente—. El defecto contable de residuo sigue abierto
  en 9B.04 y no fue reinterpretado por 11.05.
- **Precisión del 2026-09-09:** el
  [análisis del residuo](../fase-09b-perfiles/analisis-residuo-costeo.md) reprodujo el caso sobre
  el árbol actual. La contaminación de la valoración ya no ocurre —una entrada posterior de 100
  deja promedio 100, no 99—; lo que queda abierto es que una salida de más de una unidad que
  agota la existencia descarta el residuo, sobrevalorando el COGS de ese ciclo en menos de media
  unidad menor por unidad de la línea. La deuda sigue siendo de 9B.04.

### 3. Contratos TypeScript sin consolidar

- **Clasificación:** verificación fallida durante una consolidación en curso.
- **Evidencia:** `pnpm typecheck` falla en las referencias descritas en este
  documento. Los tests pueden pasar porque Vitest transpila los archivos sin
  actuar como sustituto del chequeo de tipos.
- **Dueño del fix:** la subfase que introdujo la devolución y el contrato fiscal
  en el working tree; el pipeline transversal debe permanecer como criterio de
  cierre de cada subfase.
- **Criterio futuro:** `pnpm pipeline` verde antes de marcar una subfase como
  completada. Añadir los dobles de prueba a los puertos completos y mantener
  DTOs, mappers e inputs sincronizados.
- **Relación con Fase 11:** 11.02 debe incluir pruebas de autorización de las
  operaciones nuevas una vez que sus contratos estén consolidados.
- **Estado al 2026-09-08:** cerrado. El pipeline completo está verde y la prueba genérica de
  permisos recorre todos los contratos autenticados publicados.

### 4. Estación instalada y arranque seguro

- **Clasificación:** deuda conocida de empaquetado y despliegue.
- **Evidencia:** `apps/desktop/src/main/index.ts:27` usa `loadFile` en producción;
  el cliente usa rutas `/api`, cuyo proxy está en Vite, y el proceso principal
  no inicia ni supervisa Fastify.
- **Dueño del fix:** empaquetado de desktop y arranque del servidor; el control
  de transporte pertenece a 11.03.
- **Criterio futuro:** instalación reproducible que inicie Electron y su servidor,
  autentique, ejecute una operación y se recupere tras reinicio sin depender de
  Vite ni de un terminal manual.
- **Referencia:** la deuda ya está reconocida en el cronograma maestro, cerca de
  la subfase 9.08.

### 5. Migraciones con respaldo en el arranque real

- **Clasificación:** brecha de integración de persistencia.
- **Evidencia:** `apps/server/src/runtime.ts:83` llama `applyMigrations`;
  `packages/drivers/db/src/migrations.ts:249` ofrece `migrateDatabase` con
  respaldo, validación y restauración.
- **Dueño del fix:** persistencia y gate de piloto. 11.04 debe cubrir la
  protección de la base, los respaldos y las claves; no debe duplicar el driver.
- **Criterio futuro:** el procedimiento que arranca una base real debe usar la
  ruta segura, validar integridad y demostrar restauración después de una
  migración fallida. El gate de piloto también exige backup automático y ensayo
  de recuperación.
- **Estado al 2026-09-08:** cerrado para actualizaciones. El composition root usa migración con
  respaldo AES-256-GCM, valida, restaura y aborta ante fallo; verifica ACL del directorio y
  conserva claves anteriores referenciadas durante la rotación. El backup operativo periódico
  independiente de actualizaciones continúa abierto en el gate de piloto.
- **Estado al 2026-09-09:** el backup operativo periódico y su ensayo de restauración quedaron
  entregados por el [paquete pre-piloto](../pre-piloto/plan-respaldo-operativo.md), y el
  instalador que aplica la ACL está definido en `packaging/`. Siguen abiertos en el gate: la
  firma del instalable, su validación en una estación real y el ensayo de restauración sobre esa
  máquina.

### 6. Transporte, host y cookie de sesión

- **Clasificación:** riesgo condicionado de 11.03.
- **Evidencia:** `apps/server/src/index.ts:5` acepta cualquier `SERVER_HOST`; la
  composición HTTP no impone TLS y la cookie de sesión no incluye `Secure`.
  El default loopback hace que no haya evidencia de exposición actual.
- **Dueño del fix:** 11.03.
- **Criterio futuro:** rechazar hosts no loopback mientras no exista una
  composición LAN segura, o activar un modo LAN con transporte autenticado,
  política de cookie adecuada y pruebas de configuración insegura. El arranque
  local debe conservar el límite de nodo y terminal derivado del servidor.
- **Estado al 2026-09-08:** cerrado para el servidor local. `SERVER_HOST` no loopback aborta,
  la cookie se deriva en una fuente única y las pruebas fijan suplantación, configuración
  insegura y aislamiento de sesión entre bases/nodos. El arranque empaquetado permanece como
  deuda separada del punto 4.
- **Estado al 2026-09-09:** el arranque empaquetado quedó cubierto por el
  [paquete pre-piloto](../pre-piloto/plan-empaquetado-nodo.md), sobre el bundle real y sin proxy
  de Vite. Cierra también el punto 4 salvo por el instalador sin firmar y su validación en una
  estación de tienda, que siguen abiertos en el gate.

### 7. Identidad de operadores y separación de responsabilidades

- **Clasificación:** alcance pendiente explícito de 11.02.
- **Evidencia:** solo existe el administrador inicial provisionado por CLI;
  todavía no se pueden dar de alta cajeros ni administrar roles desde la UI.
- **Dueño del fix:** 11.02.
- **Criterio futuro:** alta, cambio de rol, desactivación y bloqueo de autoexclusión
  del último administrador, con permisos efectivos y auditoría. Las pantallas de
  9B no deben presentarse como separación real hasta cerrar este punto.
- **Estado al 2026-09-08:** cerrado por 11.02, incluida la contención multiproceso del último
  administrador sobre SQLite real, enrolamiento local, revocación de sesiones y pantalla.

### 8. Inventario offline y sincronización futura

- **Clasificación:** riesgo de evolución de Fase 10, reconocido por la arquitectura.
- **Evidencia:** el MVP conserva un almacén implícito por nodo y la autoridad
  futura queda en el coordinador. Dos terminales desconectadas pueden vender la
  misma última unidad; la política de reconciliación, cupos o bloqueo sigue
  abierta en [ownership](../../architecture/12-sincronizacion-y-ownership.md).
- **Dueño del fix:** Fase 10.
- **Criterio futuro:** elegir una política operativa, definir ownership,
  deduplicación, discrepancias y recuperación, y probarla con dos nodos. 11.03
  debe proteger el transporte y 11.05 debe hacer visible la antigüedad,
  discrepancia y estado de sincronización.
- **Estado al 2026-09-08:** cerrado para el MVP de referencia por ADR-0026, Fase 10 y 11.05:
  ownership, deduplicación, discrepancias, recuperación, antigüedad y atención visible están
  implementados. Se conserva explícitamente la ausencia de garantía de stock global durante
  desconexión; no es una promesa pendiente oculta.

### 9. Crecimiento de la historia de inventario

- **Clasificación:** riesgo sin benchmark.
- **Evidencia:** el repositorio carga todos los movimientos y `StockItem.restore`
  los reejecuta; las búsquedas de duplicados y recálculos se repiten sobre la
  historia.
- **Dueño del fix:** Fase 12.
- **Criterio futuro:** medir con volumen representativo y fijar un umbral de
  latencia antes de introducir snapshots, índices o cambios de modelo.

## Regla de seguimiento

Este registro se actualiza cuando un fix cambie el estado durable, el retry, la
idempotencia, el ownership, la autorización, la redacción, el backup o la prueba
que sustenta una garantía. Si cambia una decisión de arquitectura o de negocio,
primero se actualiza el ADR o la especificación correspondiente. Una tarea no se
marca completada aquí por tener una prueba unitaria: debe cumplir el criterio
end-to-end de su fase propietaria.
