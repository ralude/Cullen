# Fase 11: Seguridad

- **Estado:** Habilitada el 2026-09-07 al cerrar la Fase 10; **planificada el 2026-09-07**. En
  ejecución desde el 2026-09-08: entregados el corte 0 de 11.05 —redacción de logs técnicos— y
  la 11.02 completa —autorización auditable, administración de identidad, enrolamiento local de
  credenciales, contratos, pantalla y pruebas de separación real— (corte mínimo 11.01–11.03
  adelantado y completado). 11.04 quedó desbloqueada al aceptarse ADR-0029; su implementación
  sigue pendiente
- **Indice:** [Cronograma](../README.md)
- **Plan de fase:** [secuencia restante y decisiones de activación](./plan-secuencia-y-decisiones.md)

## Proposito

Aplicar identidad, autorizacion, proteccion de datos y observabilidad segura.

Las sub-fases 11.01 a 11.03 tienen un corte minimo obligatorio antes de la Fase 9 mediante el [gate de seguridad antes de UI operativa](../gate-seguridad-pre-ui.md). La Fase 11 completa politicas, cifrado y hardening sin posponer las fronteras basicas de seguridad.

La auditoría focal del 2026-09-04 quedó registrada en
[auditoria-puntos-clave-2026-09-04.md](./auditoria-puntos-clave-2026-09-04.md).
El registro asigna cada deuda a su fase propietaria y reserva para Fase 11 los
fixes de identidad, transporte, protección de datos y observabilidad. No convierte
la Fase 11 en dueña de caja, inventario, costeo o sincronización.

La 11.02 recupero el 2026-09-04 la administracion de identidad —alta de usuarios, creacion de
roles y asignacion de permisos desde la interfaz— que la Fase 9B habia adelantado como
sub-fase 9B.09. La Fase 11 vuelve a ser la unica duena de identidad y autorizacion; la
[replanificacion de Fase 9B](../replanificacion-fase-09b.md) conserva la decision.

## Sub-fases

- [11.01 Autenticacion](./11.01-autenticacion.md) — corte mínimo completado; sin ampliaciones
  planificadas para esta fase.
- [11.02 Roles y permisos](./11.02-roles-permisos.md) —
  [plan](./plan-11.02-roles-permisos.md); completada el 2026-09-08
- [11.03 JWT y sesiones](./11.03-jwt-sesiones.md) —
  [plan](./plan-11.03-jwt-sesiones.md)
- [11.04 Encriptacion](./11.04-encriptacion.md) —
  [plan](./plan-11.04-encriptacion.md); desbloqueada el 2026-09-08 por
  [ADR-0029](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md), sin implementación
- [11.05 Hardening de logs](./11.05-hardening-logs.md) —
  [plan](./plan-11.05-hardening-logs.md); corte 0 de redacción entregado el 2026-09-08

## Orden de ejecución

El [plan de fase](./plan-secuencia-y-decisiones.md) fija la secuencia: corte 0 de redacción de
11.05 adelantado —entregado el 2026-09-08—, luego 11.02, 11.03, 11.04 y los cortes restantes
de 11.05. El orden responde a dependencias reales, no a la numeración. D1–D5 quedaron cerradas el
2026-09-08 por [ADR-0027](../../architecture/adr/0027-administracion-de-identidad.md) y el
enrolamiento de credenciales que declaraba pendiente por
[ADR-0028](../../architecture/adr/0028-enrolamiento-local-de-credenciales.md); D7–D9 quedaron
cerradas el mismo día por
[ADR-0029](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md), de modo que 11.04 ya
no espera decisiones sino implementación.
D6 recoge el loopback obligatorio de `apps/server/AGENTS.md` y ADR-0026, y no bloquea la
validación del host en 11.03. Los cortes independientes conservan sus prerrequisitos explícitos.

## Criterio de salida

Las operaciones sensibles exigen identidad, permiso, auditoria y redaccion de secretos.
