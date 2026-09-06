# Plan de ejecución 9B.17: Perfil Administrador

- **Sub-fase:** [9B.17 Perfil Administrador](./9b.17-perfil-administrador.md)
- **Estado del plan:** ~~Implementado y cerrado 2026-09-05~~
- **Base:** 9B.10, 9B.11, ADR-0013 y
  [ADR-0021](../../architecture/adr/0021-mvp-referencia-no-certificado.md)
- **Disciplina:** Outside-in TDD (ADR-0007) y Ponytail `full`

## Resultado esperado

Reunir configuración operativa, sucursales, dispositivos, tasas y auditoría en un workspace
administrativo. Toda mutación conserva historia y la UI distingue con claridad la simulación
de una integración fiscal real.

## Línea base comprobada

- Sucursales y dispositivos ya tienen dominio, persistencia, contratos, rutas y una pantalla
  de configuración con permisos efectivos.
- Tasas de cambio y reportes de auditoría ya tienen pantallas y contratos separados.
- 9B.10 administrará maestros y políticas existentes; no existe un catálogo global de
  alícuotas ni debe crearse para componer este perfil.
- La creación de usuarios y roles volvió a 11.02. Hasta entonces solo existe el administrador
  provisionado por CLI.

## Decisiones de composición

- El workspace agrega rutas existentes; no crea un agregado “Administrator”, un backend BFF ni
  una jerarquía nueva de permisos.
- Cada sección y botón usa el permiso de su contrato. Auditoría conserva el alcance y columnas
  de ADR-0013; no expone `beforeState`/`afterState` al renderer.
- Todo cambio sensible presenta alcance, vigencia y confirmación; el servidor vuelve a validar,
  versionar y auditar. Ninguna pantalla reescribe ventas, documentos o políticas históricas.
- Dispositivos son declaraciones administrativas. Crear `FISCAL_PRINTER` no habilita hardware
  ni cambia `fiscalMode`, que sigue visible como `SIMULATION`.
- Secretos, credenciales y parámetros físicos de drivers quedan fuera hasta sus fases.

## Secuencia de implementación

1. Completar 9B.10 y probar sus permisos, versionado, inmutabilidad histórica y auditoría.
2. Componer configuración, sucursales, dispositivos, tasas y auditoría mediante las rutas y
   componentes existentes.
3. Probar que cada sección desaparece o queda solo lectura según permisos efectivos.
4. Probar confirmaciones de configuración sensible y que el cambio no altera hechos previos.
5. Probar que declarar dispositivos no cambia capabilities ni ofrece prueba física.
6. Mantener usuarios/roles ausentes hasta 11.02 y mostrar el modo `SIMULACION` sin ambigüedad.
7. Ejecutar verificaciones y actualizar cronograma.

## Criterios de aceptación

- [x] ~~El workspace compone capacidades existentes sin duplicar reglas ni estado.~~
- [x] ~~Toda mutación se autoriza en aplicación, es auditable y conserva historia.~~
- [x] ~~Auditoría respeta filtros, límite y redacción de ADR-0013.~~
- [x] ~~Ningún dispositivo declarado habilita una integración real.~~
- [x] ~~No se simula administración de identidad antes de 11.02.~~
- [x] ~~No se añaden secretos, drivers reales ni catálogo fiscal especulativo.~~
- [x] ~~`pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.~~ 591 pruebas / 120 archivos.

## Fuera de alcance

- Usuarios, roles, PIN, revocación de sesiones y cifrado de secretos de Fase 11.
- Configuración o prueba de hardware real de Fase 8.
- Distribución de maestros y autoridad multi-nodo de Fase 10.
