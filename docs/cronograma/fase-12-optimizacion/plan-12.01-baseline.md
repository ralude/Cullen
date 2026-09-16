# Plan de ejecución de 12.01

Fecha: 2026-09-12. Gobiernan [12.01](./12.01-profiler-baseline.md),
[el orden de Fase 12](./README.md), [ADR-0007](../../architecture/adr/0007-outside-in-tdd.md)
y los `AGENTS.md` de cada responsabilidad. Este plan organiza la ejecución; el estado de la
subfase y sus criterios de aceptación se conservan en 12.01.

## Línea base inspeccionada

HEAD `ee65cc3`, con los checkpoints `227f270` y `ee65cc3` de medición. Existen cambios locales
en el arnés, el manifiesto y el informe de crecimiento que agregan reportes y 300 ventas de
preparación. Se incorporan al primer corte porque el usuario autorizó continuar este trabajo;
se revisan y validan antes de consolidarlos.

La cobertura pendiente es mayor que los dos escenarios enteramente ausentes: el arranque
mide migración y composición del nodo, pero falta Electron; la jornada deja fuera la apertura
de caja y la emisión fiscal simulada. Ingreso/shell y ciclo LAN siguen sin instrumento.
CPU, memoria, bytes y tamaño de SQLite tampoco están registrados por el arnés actual.

## Cortes y criterios verificables

1. **Integridad del arnés y cierre del trabajo local.** Probar primero el comando público:
   opciones inválidas y escenarios inexistentes abortan sin publicar una serie; cada lectura
   declara y comprueba sus datos; el período comercial contiene las ventas sembradas aunque
   cambie el día de ejecución; una muestra menor de 30 no publica p90. Identificar revisión,
   cambios pendientes, protocolo y alcance real. Revisar los resultados locales ya publicados:
   los reportes proceden de una muestra de 3, no de la serie de historia de 10. Incorporar el
   corte solo después de lint, typecheck, pruebas de arnés y suite global verdes.
2. **Completar la jornada simulada.** Apertura de caja y emisión desde la venta completada,
   sin duplicar reglas monetarias. Verificar estado fiscal `ISSUED`, modo `SIMULATION`,
   asiento en turno y salida de stock; conservar separadas preparación y operación medida.
3. **Arranque e ingreso reales.** Conductor reproducible del build Electron y del nodo en
   loopback, con perfil aislado y sin secretos en trazas. Medir carga hasta formulario de
   ingreso, envío hasta shell autorizado y recuperación de sesión. Separar primera instalación
   (migraciones), nuevo proceso con base existente y ejecución caliente. Las pruebas jsdom
   verifican comportamiento, pero no representan rendimiento de Chromium.
4. **Ciclo LAN.** Reutilizar la composición existente de las pruebas, extrayendo infraestructura
   solo si tiene un consumidor concreto. Dos nodos temporales con mTLS, outbox durable, ACK
   posterior al commit, aplicación y reconexión verificadas. Medir entrega y aplicación por
   separado; un ACK por sí solo no completa el escenario. Leer las normas LAN y FS aplicables
   antes de implementar este corte.
5. **Métricas y nuevo piloto.** Registrar CPU, RSS/pico, tamaño de base y tráfico donde aplique;
   separar el costo del instrumento. Una invocación por escenario/proceso. Ejecutar tres series
   independientes, con muestras declaradas, sobre los perfiles finalmente acordados. Cambiar
   datos, transporte o protocolo abre una nueva serie; los márgenes históricos no se heredan
   como si fueran equivalentes.
6. **BEFORE y presupuestos.** Desde un commit limpio, capturar los seis escenarios completos,
   conservar los crudos ignorados y versionar un resumen reproducible. Fijar límites por
   escenario a partir de una expectativa de uso acordada y de la variación observada.
7. **Priorización y cierre.** Asignar los problemas demostrados a 12.02, 12.03 o 12.05 y
   justificar los casos sin intervención. Verificar los seis criterios de 12.01 y actualizar
   el cronograma al cerrarlos. Todavía no se ejecutan optimizaciones productivas.

## Decisión de uso — resuelta el 2026-09-16

El repositorio describía una estación de desarrollo y perfiles sintéticos, pero no una carga
operativa objetivo. La decisión se tomó: **los presupuestos se fijan sobre la estación de
desarrollo**, para comparar commits entre sí. No representan una tienda concreta y no certifican
capacidad de piloto ni de producción. Los perfiles vigentes se conservan; las profundidades
100/1.000/10.000 siguen sirviendo para caracterizar crecimiento y siguen sin equivaler a una
tienda representativa.

Cuando exista una operación objetivo hará falta tamaño de catálogo, cajas simultáneas, volumen de
ventas/historia y hardware previsto: será otro dataset, otra serie y otros presupuestos, nunca una
reinterpretación de estos. El registro normativo de ésta y las otras tres decisiones vive en
[12.01](./12.01-profiler-baseline.md#decisiones-de-alcance--2026-09-16).

## Checkpoints

- `fix(perf): validate reproducible report measurements` para el primer corte.
- Instrumentos de jornada, desktop y LAN en hitos independientes, cada uno con sus pruebas.
- `docs(perf): record phase 12 baseline and budgets` únicamente al completar evidencia y
  decisiones. Cada checkpoint revisa diff, valida y stagea rutas explícitas.

## Verificación

Las pruebas del arnés comprueban resultados y rechazos, sin umbrales de tiempo. Los pilotos
corren después de las suites, sin competir con ellas. Para código: `pnpm lint`,
`pnpm typecheck`, `pnpm test`; para cada nueva frontera, además su prueba arquitectónica.
Los builds y las pruebas E2E afectadas acompañan los cortes desktop/LAN. No se publica como
BEFORE una corrida de humo, una serie incompleta o una revisión con cambios pendientes.
