# V0.1.03: Documentación de portafolio

- **Release:** [v0.1 de portafolio](./README.md).
- **Estado:** ~~Cerrada~~ el 2026-09-10 sobre `fce95e6`.
- **Entrada:** ~~[V0.1.02](./2-demo-en-entorno-limpio.md) cerrada~~.

## Objetivo

Presentar el proyecto con evidencia suficiente para que una persona técnica entienda el problema,
la arquitectura, el recorrido demostrable y sus límites sin leer todo el repositorio.

## Tareas

- [x] Reescribir el bloque «Estado del proyecto» del README desde el commit candidato y enlazar el
  cronograma sin duplicar como vigentes cifras históricas.
- [x] Incorporar las capturas verificadas de la demo y un recorrido breve de las capacidades
  principales; evitar imágenes con PIN, tokens, rutas de claves o datos reales.
- [x] Mantener un quickstart único, probado en V0.1.02, y separar claramente ejecución de
  desarrollo, build y operación simulada.
- [x] Publicar limitaciones: referencia no certificada, `FiscalPrinterFake`, sin soporte de
  modelos reales, sin piloto y sin promesa de uso comercial.
- [x] Añadir `CONTRIBUTING.md` con instalación, checks y reglas de commits, y `SECURITY.md` con un
  canal privado de reporte que no invite a publicar secretos en issues.
- [x] Preparar notas de versión con capacidades, arquitectura destacada, limitaciones conocidas y
  roadmap posterior a `v0.1.0`.

## Criterio de salida

README, quickstart, capturas, licencia, contribución, seguridad y release notes describen el mismo
commit y el mismo alcance. Los enlaces funcionan y el texto no transforma simulación en
certificación.

## Lo entregado

- **README.** «Estado del proyecto» se reescribió desde el commit candidato: fases con su estado
  real, `v0.1.0` como hito de publicación, Fase 12 y Fase 12B como trabajo posterior, y el
  paquete pre-piloto identificado como lo que es. Las métricas —1.282 pruebas en 198 archivos,
  31 ADR, 44 migraciones— salen del commit publicado, no del historial, y se recontaron cuando la
  demo movió el candidato. La declaración honesta de alcance
  y el gate de piloto abierto quedan en el cuerpo, no en una nota al pie.
- **Quickstart único**, el de «Cómo ejecutarlo», con los tres pasos implícitos que
  [V0.1.02](./2-demo-en-entorno-limpio.md) encontró ya corregidos: `openssl` como requisito, el
  TTY que exige la provisión del administrador y `pnpm install --frozen-lockfile` como forma
  reproducible. La instalación de una estación real y sus runbooks quedan en su propia subsección,
  separados del árbol de trabajo.
- **[`CONTRIBUTING.md`](../../../CONTRIBUTING.md)**: entorno, checks obligatorios, forma de
  trabajar un cambio, convenciones de commit y lo que no entra, incluido el rótulo `SIMULACION`,
  que no se retira ni se atenúa.
- **[`SECURITY.md`](../../../SECURITY.md)**: canal privado de GitHub —nunca un issue público—, qué
  incluir, qué nunca pegar en un reporte, qué esperar de un proyecto sin SLA, y los tres límites
  ya declarados: la base SQLite sin cifrar de ADR-0029 D7.1, el MSI sin firmar y la fiscalidad
  simulada.
- **[Notas de `v0.1.0`](./notas-v0.1.0.md)** en borrador: capacidades entregadas, lo
  arquitectónicamente destacable, verificación, siete limitaciones conocidas y el trabajo
  posterior.
- **Licencia** Apache 2.0 ya publicada en [`LICENSE`](../../../LICENSE).

## Las capturas

Seis de las siete que produjo el recorrido de V0.1.02 están en
[«El recorrido, en seis pantallas»](../../../README.md#el-recorrido-en-seis-pantallas), en
`docs/capturas/`: ingreso, inicio, venta, factura simulada, kardex y auditoría. Cada una lleva
un pie que dice qué garantía enseña, no qué pantalla es. La séptima queda como evidencia de la
etapa anterior.

Se revisaron antes de entrar al repositorio, porque una vez empujadas viven en el historial de
git: sin PIN, sin token, sin cookie, sin ruta de material protegido y sin ningún dato real —los
dos RIF que aparecen están inventados y el catálogo es la seed de ejemplo—, con `SIMULACIÓN`
visible en todas. Pesan 892 KB en total.

Las cifras del README se recontaron sobre el commit publicado: **1.282 pruebas en 198 archivos**,
donde antes decía 1.236 en 192. ADR y migraciones ya coincidían.

## Fuera de alcance

Marketing comercial, soporte garantizado, SLA, manual fiscal de tienda o documentación de una
impresora que todavía no fue seleccionada y calificada.
