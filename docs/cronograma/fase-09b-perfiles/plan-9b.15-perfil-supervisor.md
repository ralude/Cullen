# Plan de ejecución 9B.15: Perfil Jefe de cajas

- **Sub-fase:** [9B.15 Perfil Jefe de cajas](./9b.15-perfil-supervisor.md)
- **Estado del plan:** Bloqueado hasta volver a cerrar 9B.06 y completar 9B.12
- **Base:** [ADR-0015](../../architecture/adr/0015-permisos-efectivos-en-la-sesion.md) y
  [plan 9B.12](./plan-9b.12-arqueos-y-autorizaciones.md)
- **Disciplina:** Outside-in TDD (ADR-0007) y Ponytail `full`

## Resultado esperado

Extender el workspace de cajero con consulta de turnos, arqueos, historia de venta y acciones
sensibles autorizadas, sin duplicar pantallas ni reabrir turnos cerrados.

## Línea base comprobada

- Descuento, anulación y cierre con diferencia ya tienen permisos en aplicación y motivo.
- `shift_closing_balances` ya conserva esperado, declarado y diferencia; 9B.12 publicará su
  lectura y la historia de venta con autorización.
- La navegación actual combina pantallas por módulo y ya evalúa permisos efectivos.
- La devolución no existe todavía; 9B.06 la añadirá con `sale.return` y nota fake.

## Decisiones de composición

- El supervisor recibe la unión de capacidades; no existe una copia “supervisor” de venta o
  caja ni comprobaciones de `roleCode` en React.
- Las lecturas de varias cajas usan `cash.shift.read.any`, filtros y límites de aplicación. El
  renderer presenta el arqueo persistido y no lo recalcula.
- Descuento, anulación, cierre con diferencia y devolución exigen sus permisos individuales y
  motivo. Una acción ausente no se muestra como si estuviera disponible.
- La historia de venta sirve de evidencia de revisión y usa el permiso decidido en 9B.12.
- Un turno cerrado permanece cerrado. No se implementa reapertura, override fiscal ni edición
  de arqueos.

## Secuencia de implementación

1. Componer sobre el workspace de 9B.14 y probar la unión de permisos sin duplicados.
2. Integrar listado/detalle de turnos y arqueos de 9B.12 con filtros y límites.
3. Reunir las acciones sensibles existentes y probar permiso, motivo y auditoría para cada una.
4. Publicar la historia de venta y probar denegación antes de consultar el ledger.
5. Integrar `sale.return` cuando 9B.06 esté completa, sin bloquear el resto de la vista.
6. Probar estados vacíos, errores recuperables y ausencia de controles de reapertura.
7. Ejecutar verificaciones y actualizar cronograma.

## Criterios de aceptación

- [ ] El supervisor reutiliza el flujo del cajero y ve una sola instancia de cada capacidad.
- [ ] Turnos ajenos y arqueos requieren `cash.shift.read.any` y consultas acotadas.
- [ ] Cada acción sensible comprueba permiso y motivo en aplicación y deja auditoría.
- [ ] La historia de venta no se publica a cualquier sesión válida.
- [ ] La devolución aparece solo cuando 9B.06 existe y el permiso está concedido.
- [ ] No hay reapertura ni modificación de cierres previos.
- [ ] `pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.

## Fuera de alcance

- Asignación de cajas o estructura organizativa de supervisión.
- Reapertura de turno, reversión de Z y fiscalidad real.
- KPIs de gerencia y administración de identidad.
