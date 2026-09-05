# Plan de ejecución 9B.11: Sucursales y dispositivos

- **Sub-fase:** [9B.11 Sucursales y dispositivos](./9b.11-sucursales-y-dispositivos.md)
- **Estado del plan:** Reabierto por auditoría del 2026-09-05; conserva el alcance recortado
- **Prerrequisito:** [9B.10 Configuración operativa](./9b.10-configuracion-operativa.md),
  cuyos patrones de administración se reutilizan
- **Disciplina de implementación:** Outside-in TDD (ADR-0007) y Ponytail `full`

## Resultado esperado

La estación declara a qué sucursal pertenece y qué dispositivos tiene asignados.
Esa declaración es dato maestro y etiqueta de pertenencia: no habilita hardware
real ni sincronización entre nodos.

## Línea base comprobada

- **No existe el concepto de sucursal** en dominio, aplicación, persistencia,
  contratos ni UI. Ninguna tabla la referencia.
- `cash_registers` existe y se siembra en `apps/server/src/bootstrap-operations.ts`.
  `CashRegisterRepository` solo lee.
- La identidad de terminal y nodo proviene del archivo local protegido que fija
  ADR-0011 (`apps/server/supermarket-node.sqlite.owner`), y viaja en
  `ExecutionContext` como `terminalId` y `originNodeId`. `shifts`,
  `cash_movements`, `audit_log` y los agregados fiscales ya la guardan.
- **No existe inventario de dispositivos.** El modo fiscal se expone por
  `capabilities` y hoy siempre es `SIMULATION` sobre `FiscalPrinterFake`, porque
  la Fase 8 está suspendida.
- No existe ningún permiso `config.branch.manage` ni `config.device.manage`.

## Decisiones de frontera propuestas

### Sucursal

`Branch` es un maestro con ID técnico, código humano estable, nombre, estado
`ACTIVE`/`INACTIVE` y timestamps UTC, siguiendo el patrón ya probado en
`Supplier`: código inmutable, sin borrado físico, cambios auditados.

La sucursal **etiqueta**; no gobierna. No decide autoridad de escritura, no
enruta operaciones y no participa en ninguna resolución de conflictos: eso es
Fase 10 y `docs/architecture/12-sincronizacion-y-ownership.md`.

### Dispositivo

`Device` es la declaración de un aparato asignado a una estación: tipo,
identificador declarado, estado y estación a la que pertenece. Es un inventario
administrativo, no un driver.

Declarar una impresora fiscal **no** habilita capacidad fiscal: mientras la Fase
8 siga suspendida, la declaración se rotula visiblemente `SIMULACIÓN` y
`capabilities` sigue reportando `FiscalPrinterFake`. Una prueba debe demostrar
que declarar un dispositivo no cambia el modo fiscal.

### Casos de uso y permisos

`CreateBranch`, `UpdateBranch`, `ChangeBranchStatus`, `GetBranch`,
`ListBranches` con `config.branch.manage`; `DeclareDevice`, `UpdateDevice`,
`ChangeDeviceStatus`, `ListDevices` con `config.device.manage`. Las lecturas
exigen sesión verificada, como el resto de los maestros.

### Persistencia

Migración forward-only con las tablas `branches` y `devices`, unicidad de código
de sucursal e identificador de dispositivo por estación, y protección contra
borrado físico mediante trigger, igual que `suppliers`.

## Decisiones requeridas antes de implementar

1. **Relación entre sucursal y nodo.** ¿Un nodo pertenece a exactamente una
   sucursal, o una sucursal agrupa varios nodos? De la respuesta depende dónde
   vive la pertenencia: si es del nodo, la sucursal se declara una vez en la
   identidad local; si es de la caja o de la estación, se asigna por registro. Y
   define si `Branch` es un maestro local o un dato de referencia que la Fase 10
   distribuye.
2. **Retroactividad de la etiqueta.** Existen turnos, ventas, movimientos y
   documentos fiscales ya persistidos sin sucursal. ¿La sucursal se agrega solo
   hacia adelante —la historia previa queda sin etiqueta— o la migración asigna
   una sucursal por defecto a todo lo existente? Etiquetar hacia atrás inventa un
   hecho que nadie declaró.
3. **Catálogo de tipos de dispositivo.** ¿Qué tipos se admiten en v1 —impresora
   fiscal, lector de código de barras, balanza, gaveta— y es una lista cerrada
   validada en dominio o un texto libre? Una lista cerrada exige saber qué
   tipos existen antes de implementarla.

## Secuencia outside-in

1. Probar los contratos HTTP de sucursal y dispositivo con sus permisos e
   idempotencia.
2. Probar el ciclo de estado y la ausencia de borrado físico.
3. Probar que declarar una impresora fiscal no altera `capabilities` ni habilita
   emisión: el modo sigue en `SIMULACION`.
4. Probar la evidencia de auditoría de cada cambio.
5. Implementar dominio, aplicación y puertos con fakes hasta que pase.
6. Agregar la migración forward-only y los repositorios Drizzle; verificar
   unicidad, concurrencia y rehidratación.
7. Publicar rutas y la pantalla de administración, con el rótulo `SIMULACIÓN`
   visible en todo dispositivo fiscal declarado.
8. Ejecutar `pnpm test`, `pnpm typecheck`, `pnpm lint` y actualizar el cronograma.

## Criterios de aceptación

- [x] La decisión 1 (relación nodo↔sucursal) sigue sin resolver; en vez de bloquear la
  sub-fase completa por ella, se recortó el alcance explícitamente (ver el corte de la
  sub-fase del 2026-09-04) a lo que no depende de esa decisión. La decisión 2 (retroactividad)
  no aplicó, al no haber datos históricos que retroetiquetar. La decisión 3 (catálogo de
  tipos) se resolvió con la lista cerrada que el propio texto de la sub-fase ejemplificaba.
- [x] `Branch` y `Device` están documentados en `04-entidades.md` y
  `05-agregados.md` antes de implementar.
- [x] El código de sucursal es inmutable y no existe borrado físico.
- [x] Declarar un dispositivo no habilita ninguna capacidad fiscal real y hay
  prueba que lo demuestra.
- [x] La sucursal no participa en ninguna decisión de autoridad de escritura ni
  de sincronización.
- [x] Cada cambio deja auditoría con actor, momento y motivo.
- [x] `pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.

## Corrección obligatoria antes de volver a cerrar

- [ ] Autorizar `GetBranch`, `ListBranches` y `ListDevices` en aplicación; una denegación no
  toca el repositorio.
- [ ] Definir la unicidad de dispositivos en dominio/aplicación y respaldarla con una
  restricción SQLite coherente y migración forward-only.
- [ ] Pedir al operador el motivo de cambios de estado y conservarlo en auditoría.
- [ ] Mantener la misma clave de idempotencia durante reintentos de una intención de UI.
- [ ] Incluir configuración en la matriz de permisos contractuales.
- [ ] Resolver ownership de `Branch` y `Device` sin adelantar sincronización de Fase 10.

Estas tareas alimentan primero la línea base de 9B.10 y pertenecen al
[plan correctivo de 9B](./plan-correcciones-auditoria-9b.md).

## Fuera de alcance

- Autoridad de escritura multi-nodo, distribución de datos de referencia y
  resolución de conflictos: Fase 10.
- Drivers, descubrimiento y prueba de hardware real: Fase 8, suspendida.
- Inventario por sucursal: depende del modelo de almacenes que 9B.08 mantiene
  diferido en ADR-0020.
- Identidad de terminal y nodo: ya la fija ADR-0011 y no se reabre.
