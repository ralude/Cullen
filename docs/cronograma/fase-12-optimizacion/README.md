# Fase 12: Optimización

- **Estado:** En ejecución. 12.01 cerrada el 2026-09-16 con línea base, márgenes, presupuestos de
  regresión y priorización de hotspots; queda pendiente que un tercero reproduzca la serie
  (CA-12.01-01). 12.02 cerrada el 2026-09-16 sin cambios productivos: la medición no encontró
  sobrecarga en el camino renderer–nodo. 12.03 cerrada el 2026-09-17 con cuatro cortes
  —catálogo, kardex y reconstrucción del inventario con ADR-0032, más guardado sin cambio
  productivo— y su
  [campaña A/B](./12.03-evidencia-y-cierre.md) sobre estación aislada, que confirma los tres
  primeros por dos órdenes de magnitud con los controles quietos. Sigue 12.05, la última, con cinco cortes entregados y
  su [benchmark de radio de contexto](./12.05-evidencia-y-cierre.md) publicado: los seis escenarios
  abren entre 13,7 % y 32,8 % menos superficie sin ganar un solo salto. Le falta un solo punto: las sesiones reales de
  navegación, que no las puede correr quien hizo los cortes.
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

Revisado el 2026-09-17 sobre `ded0fba`, con los checks repetidos ese mismo día después de
corregir el gate de aislamiento del arnés. **Tres puntos cumplidos, tres abiertos**, y los tres
abiertos están abiertos por razones distintas.

- [ ] 12.01, 12.02, 12.03 y 12.05 están cerradas con evidencia reproducible.
  12.02 y 12.03 sí. **12.01 espera que un tercero reproduzca su serie** (CA-12.01-01) y **12.05,
  las sesiones reales de navegación**: ninguno lo puede cerrar quien hizo el trabajo, por
  definición en el primer caso y por honestidad de la medición en el segundo.
- [x] Cada cambio conservado cumple su presupuesto y no introduce regresiones funcionales,
  arquitectónicas, de seguridad ni de recuperación.
  Los tres cortes de 12.03 superan su margen por dos órdenes de magnitud con los controles
  quietos ([campaña A/B](./12.03-evidencia-y-cierre.md)); los seis de 12.05 no cambian
  comportamiento y sus fronteras quedaron protegidas con fixtures negativos y positivos.
- [x] Los hotspots que no se modificaron tienen decisión explícita y no quedan como promesa
  implícita.
  Identidad por petición, reportes, recorrido de `product_barcodes`, borrado de hijos de la venta
  y el guardado sobre historia profunda, cada uno con su razón medida; los diez grupos del runtime
  que no se extrajeron, con su tabla de acoplamiento; y los reportes de la UI, sin corte por
  decisión.
- [ ] Lint, typecheck, suite completa, builds y pruebas focalizadas aplicables están verdes.
  Revisado el 2026-09-17. `pnpm lint` y `pnpm typecheck` en verde; `pnpm build:artifacts` en verde
  en la verificación anterior. La suite marca **1.360 de 1.362** y los dos fallos son tiempos de
  espera agotados dentro de la corrida paralela: [D-005](../defectos-conocidos.md) en la primera
  prueba de fronteras y [D-007](../defectos-conocidos.md) en el almacén de claves. Aislados, los
  dos archivos pasan en menos de cuatro segundos. El fallo del gate de aislamiento del arnés que
  antes ocupaba este punto quedó corregido: la decisión vive en `stationIsBusy` y se prueba con
  casos deterministas. El lint dejó de recorrer las skills instaladas desde fuera, que nunca
  fueron código de este repositorio. Ninguno de los dos fallos restantes es una regresión de esta
  fase, y el punto no se marca verde mientras el comando no lo esté.
- [x] Cronograma, alcance y evidencia identifican los commits medidos y distinguen el cierre
  simulado de 12.04 suspendida.
- [ ] El cronograma habilita Fase 13 únicamente después de verificar este gate.
  No se habilita: quedan los tres puntos de arriba.

Al reanudar Fase 8, 12.04 adquiere su propio cierre por perfil fiscal y no reinterpreta las
mediciones simuladas como evidencia de hardware.

## Fuera de alcance

- Nuevas capacidades funcionales, Fases 13–17 o trabajo de piloto.
- Certificación fiscal, selección de fabricante o publicación de un instalador sin firma.
- Objetivos de producción no sustentados por hardware y carga representativos.
- Refactors oportunistas, límites de líneas, reescrituras generales o modernización de stack.
