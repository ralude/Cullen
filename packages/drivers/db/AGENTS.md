# Reglas de `packages/drivers/db`

## Responsabilidad

Este paquete implementa con SQLite/Drizzle los puertos de persistencia de aplicación: conexión,
repositorios, unidad de trabajo, migraciones, ledger, outbox, auditoría y proyecciones.

## Dependencias permitidas

- Puede depender de `@supermarket/core` y `@supermarket/shared` para implementar contratos.
- Drizzle y `better-sqlite3` quedan encapsulados aquí.
- Dependencias a otro driver se limitan a tests de integración explícitos; no crees acoplamiento
  productivo entre adaptadores.

## Dependencias prohibidas

- No pongas reglas de negocio ni autorización en repositorios o SQL.
- No expongas tipos de Drizzle/SQLite a `core` o `apps`.
- No abras una segunda autoridad de escritura para el mismo archivo SQLite.

## Fuentes de verdad

Lee [`docs/architecture/08-base-de-datos.md`](../../../docs/architecture/08-base-de-datos.md) y
`docs/architecture/adr/0003-sqlite-dinero-identificadores.md`. Para ledger/outbox/sync, añade
`docs/architecture/03-eventos.md`, `docs/architecture/adr/0005-eventos-outbox.md`,
`docs/architecture/adr/0009-estado-relacional-ledger-outbox.md`,
`docs/architecture/adr/0022-entrega-outbox-ordenada-y-recuperable.md` y el ADR del flujo afectado.
Para semántica crítica de recuperación, lee el escenario en `docs/failure-scenarios/`.

## Flujo habitual

- Toda escritura requiere una `UnitOfWork`; no anides transacciones. Mantén fuera de la transacción
  llamadas de red o hardware.
- Conserva estado de negocio, eventos seleccionados, outbox y auditoría en la misma transacción
  cuando el contrato lo exija.
- Implementa idempotencia con restricciones/índices y comparación del contenido pertinente; no
  dependas solo de un check previo en memoria.
- Las migraciones son forward-only: añade la siguiente versión, regístrala en `src/migrations.ts` y no
  reescribas una ya aplicada. Prueba base nueva, upgrade, fallo/rollback y reapertura cuando aplique.
- Serializa value objects a primitivas exactas; conserva enteros, moneda, escala y UTC sin coerción.
- Mapea errores SQLite a códigos de infraestructura seguros; no filtres SQL, paths ni stacks.

## Validación

```bash
pnpm --filter @supermarket/driver-db typecheck
pnpm --filter @supermarket/driver-db test
```

Aplica además la validación global del root. Ejecuta `src/migrations.test.ts` para cualquier cambio
de esquema/migración y la prueba de integración del repositorio o flujo afectado.

## Errores comunes

- Leer o escribir tablas de otro módulo para saltarse un puerto.
- Confirmar efectos y progreso en transacciones distintas cuando deben recuperarse juntos.
- Usar una migración como parche destructivo o inventar datos históricos sin evidencia.
