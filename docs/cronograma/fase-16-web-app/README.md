# Fase 16: Web App interna con Next.js

- **Estado:** Planificada y aprobada como alcance post-MVP; ejecución pendiente.
- **Aprobación:** 2026-09-06.
- **Índice:** [Cronograma maestro](../README.md).
- **Plan transversal:** [Evolución post-MVP](../evolucion-post-mvp.md).
- **Entrada:** Fase 15 cerrada; identidad y permisos cloud de Fase 14 disponibles.

## Propósito

Entregar una experiencia interna de consulta de inventario por sucursal y almacén con Next.js.

## Sub-fases

- [16.01 Experiencia de usuario y selección del stack](./16.01-experiencia-y-stack.md) — pendiente.
- [16.02 Sesión, consultas y estado de interfaz](./16.02-sesion-y-estado.md) — pendiente.
- [16.03 Pantallas de consulta de inventario](./16.03-consulta-inventario.md) — pendiente.
- [16.04 Calidad y entrega funcional de la web](./16.04-calidad-web.md) — pendiente.

## Disciplina de ejecución

Las sub-fases se ejecutan en el orden listado. Cada implementación parte de criterios
aprobados y pruebas observables según [ADR-0007](../../architecture/adr/0007-outside-in-tdd.md).
La planificación no declara tareas implementadas. Al cerrar cada sub-fase se registran
evidencias y se ejecutan `pnpm test` y `pnpm typecheck`, además de las pruebas específicas.

**Ponytail NO aplica a esta fase.** La elección de dependencias prioriza calidad de UX,
accesibilidad, diseño y eficiencia de implementación conforme
[ADR-0025](../../architecture/adr/0025-web-nextjs-y-sistema-de-diseno.md).

## Criterio de salida

La web funciona en los dispositivos aprobados, autoriza cada consulta y comunica frescura y cobertura de sus datos.

## Fuera de alcance

Comandos de stock, portal público, POS web offline y sistema de diseño definitivo (Fase 16B).

