# Cómo contribuir

Gracias por el interés. Cullen es un **MVP de referencia no certificado**: el código se publica
para leerlo, ejecutarlo y discutirlo, no como producto listo para una tienda. Antes de proponer un
cambio conviene saber cómo está gobernado el repositorio, porque las reglas son estrictas a
propósito.

## Antes de escribir código

1. Lee [`AGENTS.md`](./AGENTS.md). Es la fuente única de reglas: fronteras entre capas,
   invariantes de dinero y auditoría, convenciones de nombres y política de commits.
2. Lee el `AGENTS.md` más cercano a la zona que vas a tocar. El mapa de instrucciones locales
   —`packages/core`, `packages/drivers/db`, `apps/server`, `apps/desktop`— está al principio del
   archivo raíz; las locales complementan al global sin repetirlo.
3. Consulta [`docs/architecture/`](./docs/architecture/README.md) y el ADR que gobierne la
   responsabilidad afectada.
4. El [cronograma](./docs/cronograma/README.md) es la única fuente de verdad del avance. Una
   funcionalidad nueva pertenece a una fase; no se adelanta una fase con tareas abiertas.

Si el comportamiento que necesitas no está especificado, **declara la ambigüedad** en el issue en
vez de inventar la regla de negocio. Un cambio que altera arquitectura, invariantes de datos o
semántica de fallos necesita su ADR antes del código.

## Preparar el entorno

Los requisitos y el porqué de cada uno están en la sección «Cómo ejecutarlo» del
[README](./README.md#cómo-ejecutarlo): Node.js 20.6+ (probado en 24.18), pnpm 11, `openssl`
alcanzable en el `PATH` y una terminal interactiva.

```bash
pnpm install --frozen-lockfile
pnpm pipeline          # lint + typecheck + suite completa
```

## Checks obligatorios

Un cambio funcional no está terminado si introduce fallos conocidos:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build:artifacts   # si tocas composición, build o empaquetado
```

El mismo pipeline corre en
[GitHub Actions sobre `windows-latest`](./.github/workflows/pipeline.yml); las versiones con las
que se reproduce están en
[el pipeline de verificación](./docs/operacion/pipeline-de-verificacion.md). Si un fallo previo no
está relacionado con tu cambio, documéntalo y no amplíes el alcance para arreglarlo.

## Cómo trabajar el cambio

- **Outside-in:** para comportamiento nuevo, primero la prueba observable, después la
  implementación mínima. Cada invariante que toques necesita su prueba.
- **Cambio mínimo:** sin dependencias, abstracciones, compatibilidad, optimización ni refactors
  oportunistas que el alcance no exija y documente.
- **Reutiliza** contratos, puertos y patrones que ya existen antes de crear otros.
- **Identificadores en inglés**, documentación y mensajes de negocio en español. Casos de uso en
  verbo + sustantivo (`CompleteSale`); errores con códigos estables (`SALE_INVALID_STATE`).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), en imperativo, con scope cuando
aporte contexto:

```
feat(sync): expose synchronization status
fix(inventory): preserve adjustment idempotency
docs(cronograma): register enrollment UX findings
```

Cada commit es atómico y corresponde a un hito verificable —una capacidad, una migración, un
bloque de pruebas, un criterio de aceptación—, no a un archivo ni a un rato de trabajo. Evita
`update stuff`, `refactor` o `wip`. Antes de cada commit revisa `git status`, `git diff` y
`git diff --cached`, y stagea con rutas explícitas.

## Pull requests

- Una PR por hito. Explica **qué garantiza** el cambio, no solo qué archivos toca.
- Enlaza la sub-fase del cronograma, el ADR o el escenario de fallo que lo gobierna.
- Incluye la salida de los checks que ejecutaste.
- Si el cambio altera una garantía crítica, actualiza en la misma PR el
  [escenario de fallo](./docs/failure-scenarios/README.md) aplicable.

## Lo que no entra

- Nada que presente la simulación fiscal como certificación, cumplimiento o aptitud para operar
  en una tienda. El rótulo `SIMULACION` no se retira ni se atenúa.
- Perfiles de impresoras fiscales reales: dependen de la Fase 8, suspendida por falta de hardware,
  protocolo del fabricante y laboratorio.
- PINs, contraseñas, tokens, claves, certificados privados, respaldos, contenido de `.data` o
  datos de una persona o un comercio real, en el código, en las pruebas, en los logs o en una
  captura.
- Dinero, tasas o cantidades facturables en `float`.

## Seguridad

Una vulnerabilidad **no** se reporta como issue público. El procedimiento está en
[`SECURITY.md`](./SECURITY.md).

## Licencia

Al contribuir aceptas que tu aporte se publique bajo la
[Licencia Apache 2.0](./LICENSE), la misma del proyecto.
