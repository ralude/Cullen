# Fase 12: Optimización

- **Estado:** Planificada después del release `v0.1.0`; ejecución pendiente.
- **Entrada:** [V0.1.04 — Publicación](../release-v0.1-portafolio/4-publicacion.md) cerrada.
- **Excepción:** 12.04 permanece suspendida con Fase 8 y no bloquea el cierre en modo simulado.
- **Índice:** [Cronograma maestro](../README.md).

## Propósito

Mejorar rendimiento y mantenibilidad únicamente donde una medición reproducible demuestre un
problema o riesgo de crecimiento. La fase conserva el comportamiento entregado, las fronteras
arquitectónicas y las garantías de seguridad; no sirve para añadir funcionalidades ni para
reescribir componentes porque parezcan grandes.

## Secuencia obligatoria

1. [12.01 — Baseline y presupuestos](./12.01-profiler-baseline.md): fija entorno, datos,
   escenarios, ruido, métricas y objetivos BEFORE.
2. [12.02 — Comunicación entre procesos](./12.02-ipc.md): mide el camino renderer–nodo y solo
   interviene sobre sobrecarga demostrada. El negocio continúa por HTTP/Fastify.
3. [12.03 — Rendimiento y crecimiento de SQLite](./12.03-sqlite.md): caracteriza consultas,
   locks e historia de inventario y optimiza sin romper transacciones.
4. [12.05 — Mantenibilidad estructural](./12.05-mantenibilidad-estructural.md): reduce radio de
   contexto con comportamiento preservado y repite su benchmark estático/observado.

[12.04 — Integración fiscal real](./12.04-serial.md) es una rama suspendida. Solo se reanuda
cuando Fase 8 entregue perfiles exactos, contratos estables y laboratorio HIL; el
`FiscalPrinterFake` nunca sustituye esa entrada.

No se ejecutan 12.02, 12.03 y 12.05 en paralelo: cada una debe medir sobre el cierre de la
anterior para que un cambio de transporte, persistencia o estructura no invalide el diagnóstico
siguiente. 12.05 refresca su baseline histórica al llegar a su gate. Fase 13 no comienza hasta
cerrar 12.01, 12.02, 12.03 y 12.05; 12.04 queda exceptuada únicamente mientras conserve la
suspensión normativa de Fase 8.

## Regla de optimización

Cada corte sigue el mismo ciclo:

1. escenario y necesidad observables;
2. medición BEFORE identificada por commit y entorno;
3. presupuesto y margen de ruido declarados antes del cambio;
4. prueba que preserve comportamiento e invariantes;
5. implementación mínima sobre el componente responsable;
6. medición AFTER con el mismo protocolo;
7. aceptación, descarte o reversión según la evidencia.

Un cambio que no supera el ruido, traslada el costo a otro recurso o degrada un escenario fuera
de presupuesto no se conserva como optimización. Si todos los presupuestos se cumplen, una
sub-fase puede cerrar sin cambios productivos; el resultado válido es la evidencia, no la
cantidad de código modificado.

## Decisiones que se fijan en 12.01

- Equipo Windows de referencia y descripción completa de su entorno.
- Perfil reproducible de datos para uso habitual y crecimiento.
- Warm-up, muestra, estadísticos y tolerancia de variación por escenario.
- Presupuestos de arranque, CPU, memoria, latencia, throughput y tamaño donde apliquen.
- Formato y ubicación de manifiestos, resultados resumidos y trazas crudas ignoradas.

Estas decisiones se obtienen de un piloto de medición; no se completan ahora con cifras
arbitrarias. Una máquina de referencia permite comparar commits, pero no certifica por sí sola
capacidad de piloto o producción.

## Garantías transversales

- Dinero, tasas y cantidades conservan representación exacta; optimizar no autoriza `float`.
- No cambian ownership, idempotencia, auditoría, orden de eventos ni límites transaccionales.
- Renderer no recibe Node, SQLite, hardware, tokens ni secretos; el negocio no migra a IPC.
- Trazas no incluyen PIN, cookies, claves, certificados privados, payload comercial ni PII.
- No se agrega una dependencia, caché, batch, índice, snapshot o abstracción sin que el hotspot
  y la comparación BEFORE/AFTER justifiquen su costo.
- Un cambio de arquitectura, persistencia durable o semántica de fallo se detiene hasta contar
  con ADR, migración y actualización del escenario aplicable.
- `SIMULACION` permanece visible y ninguna medición con el fake se presenta como fiscal real.

## Gate de salida en modo fiscal simulado

- [ ] 12.01, 12.02, 12.03 y 12.05 están cerradas con evidencia reproducible.
- [ ] Cada cambio conservado cumple su presupuesto y no introduce regresiones funcionales,
  arquitectónicas, de seguridad ni de recuperación.
- [ ] Los hotspots que no se modificaron tienen decisión explícita y no quedan como promesa
  implícita.
- [ ] Lint, typecheck, suite completa, builds y pruebas focalizadas aplicables están verdes.
- [ ] Cronograma, alcance y evidencia identifican los commits medidos y distinguen el cierre
  simulado de 12.04 suspendida.
- [ ] El cronograma habilita Fase 13 únicamente después de verificar este gate.

Al reanudar Fase 8, 12.04 adquiere su propio cierre por perfil fiscal y no reinterpreta las
mediciones simuladas como evidencia de hardware.

## Fuera de alcance

- Nuevas capacidades funcionales, Fases 13–17 o trabajo de piloto.
- Certificación fiscal, selección de fabricante o publicación de un instalador sin firma.
- Objetivos de producción no sustentados por hardware y carga representativos.
- Refactors oportunistas, límites de líneas, reescrituras generales o modernización de stack.
