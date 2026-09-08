# Fase 12: Optimizacion

- **Estado:** Pendiente; 12.04 suspendida junto con Fase 8 y excluida del cierre del MVP técnico
  en modo fiscal simulado
- **Indice:** [Cronograma](../README.md)

## Proposito

Optimizar solo con mediciones reproducibles y despues de completar funcionalidad y confiabilidad.

## Sub-fases

- [12.01 Baseline](./12.01-profiler-baseline.md)
- [12.02 IPC](./12.02-ipc.md)
- [12.03 SQLite](./12.03-sqlite.md)
- [12.04 Serial](./12.04-serial.md) — **suspendida por dependencia de Fase 8**

## Restriccion

No optimizar prematuramente. Toda mejora debe incluir medicion antes y despues.

Mientras la Fase 8 permanezca suspendida, la Fase 12 ejecuta únicamente 12.01–12.03. La 12.04
no se reemplaza con mediciones del `FiscalPrinterFake`, porque no existe todavía parser, cola,
CRC ni transporte fiscal real que optimizar. Este diferimiento no bloquea el cierre del MVP
técnico en modo fiscal simulado.

## Criterio de salida

Para el MVP técnico en modo fiscal simulado, CPU, RAM, IPC y SQLite cumplen objetivos medidos
sin regresiones funcionales. Serial se incorpora al criterio de salida cuando Fase 8 se reanude
y entregue un contrato y una implementación reales y estables.
