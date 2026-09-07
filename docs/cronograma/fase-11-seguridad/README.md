# Fase 11: Seguridad

- **Estado:** Habilitada el 2026-09-07 al cerrar la Fase 10; sin iniciar (corte mínimo
  11.01–11.03 adelantado y completado)
- **Indice:** [Cronograma](../README.md)

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

- [11.01 Autenticacion](./11.01-autenticacion.md)
- [11.02 Roles y permisos](./11.02-roles-permisos.md)
- [11.03 JWT y sesiones](./11.03-jwt-sesiones.md)
- [11.04 Encriptacion](./11.04-encriptacion.md)
- [11.05 Hardening de logs](./11.05-hardening-logs.md)

## Criterio de salida

Las operaciones sensibles exigen identidad, permiso, auditoria y redaccion de secretos.
