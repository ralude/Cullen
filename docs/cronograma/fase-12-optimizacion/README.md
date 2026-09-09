# Fase 12: Optimizacion

- **Estado:** Pendiente después del release `v0.1.0`; 12.04 suspendida junto con Fase 8
- **Indice:** [Cronograma](../README.md)

## Proposito

Optimizar solo con mediciones reproducibles y despues de completar funcionalidad y confiabilidad.

## Sub-fases

- [12.01 Baseline](./12.01-profiler-baseline.md)
- [12.02 IPC](./12.02-ipc.md)
- [12.03 SQLite](./12.03-sqlite.md)
- [12.04 Serial](./12.04-serial.md) — **suspendida por dependencia de Fase 8**
- [12.05 Mantenibilidad estructural y eficiencia de contexto](./12.05-mantenibilidad-estructural.md)
  — planificada; diagnóstico y baseline estática del 2026-09-08, implementación pendiente

## Restriccion

No optimizar prematuramente. Toda mejora debe incluir medicion antes y despues.

El [release `v0.1.0` de portafolio](../release-v0.1-portafolio/README.md) no espera esta fase:
publica la capacidad funcional ya entregada y demostrada en modo fiscal simulado. Después del
release, las mediciones de rendimiento abarcan 12.01–12.03. La 12.04 no se reemplaza con
mediciones del `FiscalPrinterFake`, porque no existe todavía parser, cola, CRC ni transporte
fiscal real que optimizar.

12.05 añade optimización del radio de contexto, independiente de CPU/RAM y del hardware
fiscal. Se ejecuta tras habilitar Fase 12, sin adelantar las tareas abiertas de Fase 11.
Su diagnóstico inicial permite planificar; no equivale a un refactor completado. No modifica
retroactivamente el alcance del MVP simulado definido por 12.01–12.03.

## Criterio de salida

Para el MVP técnico en modo fiscal simulado, CPU, RAM, IPC y SQLite cumplen objetivos medidos
sin regresiones funcionales. Serial se incorpora al criterio de salida cuando Fase 8 se reanude
y entregue un contrato y una implementación reales y estables.

El cierre de 12.05 exige además una comparación reproducible de mantenibilidad según sus
propios criterios, conservando comportamiento, dependencias explícitas y límites protegidos.
