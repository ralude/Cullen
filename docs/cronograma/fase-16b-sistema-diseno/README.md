# Fase 16B: Sistema de diseño propio de Cullen

- **Estado:** Planificada y aprobada como alcance post-MVP; ejecución pendiente.
- **Aprobación:** 2026-09-06.
- **Índice:** [Cronograma maestro](../README.md).
- **Plan transversal:** [Evolución post-MVP](../evolucion-post-mvp.md).
- **Entrada:** Fase 16 cerrada; pantallas y recorridos de consulta disponibles.

## Propósito

Crear y adoptar un sistema de diseño propio basado en shadcn/ui, con identidad, componentes y gobierno.

## Sub-fases

- [16B.01 Identidad visual y tokens](./16b.01-identidad-y-tokens.md) — pendiente.
- [16B.02 Biblioteca de componentes y patrones](./16b.02-biblioteca-componentes.md) — pendiente.
- [16B.03 Documentación visual y pruebas](./16b.03-documentacion-y-pruebas.md) — pendiente.
- [16B.04 Adopción integral en la Web App](./16b.04-adopcion-web.md) — pendiente.

## Disciplina de ejecución

Las sub-fases se ejecutan en el orden listado. Cada implementación parte de criterios
aprobados y pruebas observables según [ADR-0007](../../architecture/adr/0007-outside-in-tdd.md).
La planificación no declara tareas implementadas. Al cerrar cada sub-fase se registran
evidencias y se ejecutan `pnpm test` y `pnpm typecheck`, además de las pruebas específicas.

**Ponytail NO aplica a esta fase.** La elección de dependencias prioriza calidad de UX,
accesibilidad, diseño y eficiencia de implementación conforme
[ADR-0025](../../architecture/adr/0025-web-nextjs-y-sistema-de-diseno.md).

## Criterio de salida

La web usa la biblioteca propia, sus tokens y patrones; sus componentes están documentados y verificados.

## Fuera de alcance

Rediseño del desktop, reglas de inventario dentro de UI, portal público y nuevas operaciones de negocio.

