# Plan de ejecución: respaldo operativo

- Fecha: 2026-09-09.
- Estado: **entregado el 2026-09-09**; falta ejecutar el ensayo en una estación real.
- Decisión: [ADR-0030 D7](../../architecture/adr/0030-empaquetado-y-runtime-del-nodo.md), que
  amplía [ADR-0029 D8](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md).
- Deuda de origen: ítem «automatizar backup y ensayar restauración» del
  [gate de piloto](../gate-piloto-release.md), que ADR-0029 D8 delegó explícitamente aquí.

## Línea base verificada

El driver sabía respaldar —vacuum, validación, sellado y retención— pero sólo dentro de
`migrateDatabase`, y esa rutina era privada del módulo de migraciones. Un nodo que no se
actualizara nunca no producía una sola copia. La restauración existía como recuperación de una
migración fallida, no como procedimiento invocable.

## Cortes

1. **Primitivas reutilizables.** `createDatabaseBackup` y `pruneDatabaseBackups` salen a
   `packages/drivers/db/src/backup.ts` y se exportan. `migrateDatabase` las compone con la
   política que ya tenía: sin cambio de comportamiento.
2. **Cadencia y CLI.** El servicio toma la copia diaria a una hora local declarada desde el
   proceso dueño de SQLite, y publica una semanal cada siete días duplicando el artefacto ya
   sellado. El CLI cubre la copia a petición y la restauración, con el servicio detenido.
3. **Ensayo automatizado.** Destruye el archivo operativo y restaura desde el respaldo sellado.

## Decisiones tomadas

- **Familias separadas.** Las copias operativas viven en `backups/operational/` con prefijos
  propios, para que la retención de migración (cinco, ADR-0029 D8) y la operativa (siete diarias
  y cuatro semanales) no se borren entre sí.
- **La semanal duplica la diaria** en vez de tomar un segundo `vacuum into`: mismo instante,
  mitad de trabajo.
- **Sin tarea programada de Windows.** Una herramienta externa que abra la base reclama su
  propiedad y choca con `DATABASE_NODE_LOCKED`. La cadencia vive en el servicio y el CLI exige el
  servicio detenido, igual que la rotación de material protegido.
- **La política inválida aborta el arranque**, no la noche que toca correr.

## Criterios de aceptación

Evidencia: `apps/server/src/operational-backup.integration.test.ts`.

- [x] CA-PP-10: el nodo produce copias periódicas sin intervención y sin depender de una
  actualización.
- [x] CA-PP-11: las copias van cifradas con la clave del nodo y el artefacto no contiene código
  de operador, hash de credencial ni datos de negocio legibles.
- [x] CA-PP-12: la retención operativa no borra respaldos de migración, y viceversa.
- [x] CA-PP-13: existe un ensayo automatizado que borra el archivo operativo, restaura desde el
  respaldo sellado y verifica integridad, integridad referencial y conteos de filas.
- [x] CA-PP-14: existe un CLI para la copia a petición y la restauración, y una restauración que
  no pasa su verificación termina con código estable sin dejar el nodo operando.
- [x] CA-PP-15: existe un runbook con cadencia, retención, destino y el ensayo paso a paso
  ([respaldo operativo](../../operacion/respaldo-operativo.md)).
- [ ] CA-PP-16: el ensayo se ejecuta en una estación real antes del piloto. **Abierto**: exige la
  máquina y su almacén de claves.
- [x] CA-PP-17: `pnpm lint`, `pnpm typecheck` y `pnpm test` verdes.

## Fuera de alcance y límites declarados

Una copia diaria deja una ventana de hasta 24 horas de operaciones; reducirla o replicar fuera de
la tienda es una decisión de despliegue que el MVP no toma. La cadencia depende de que el
servicio esté corriendo a esa hora. Perder el almacén de claves del nodo vuelve irrecuperables
los respaldos cifrados, por decisión expresa de ADR-0029 D7.3.
