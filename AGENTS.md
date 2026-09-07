# Reglas globales para agentes

## Responsabilidad

Este repositorio implementa Cullen, una plataforma empresarial para supermercados con operación
standalone y LAN. Estas reglas aplican a todo el árbol. Antes de modificar una zona, lee también
el `AGENTS.md` más cercano: las instrucciones locales complementan este archivo sin repetirlo.

Mapa de instrucciones locales:

- [`packages/core/AGENTS.md`](./packages/core/AGENTS.md): dominio, aplicación, puertos e invariantes.
- [`packages/drivers/db/AGENTS.md`](./packages/drivers/db/AGENTS.md): SQLite, Drizzle, repositorios y migraciones.
- [`apps/server/AGENTS.md`](./apps/server/AGENTS.md): composición, Fastify, HTTP y sincronización LAN.
- [`apps/desktop/AGENTS.md`](./apps/desktop/AGENTS.md): Electron, preload, renderer y React.

## Fuentes de verdad

Orden de autoridad:

1. este archivo y los `AGENTS.md` locales aplicables;
2. ADRs aceptados y [`docs/architecture/`](./docs/architecture/README.md);
3. [`docs/cronograma/`](./docs/cronograma/README.md) y la especificación de la subfase;
4. `PRPs/`, que son artefactos de ejecución y nunca amplían el alcance aprobado.

Para una funcionalidad no trivial, lee solo la especificación, arquitectura, ADR y escenario de
fallo que gobiernen la responsabilidad tocada. No inventes reglas de negocio: si el comportamiento
no está especificado, declara la ambigüedad. Define o actualiza criterios de aceptación antes de
implementar, cubre cada invariante con pruebas y no cambies una especificación aprobada para hacer
pasar tests.

El estado y el orden de fases viven únicamente en el cronograma. No adelantes una fase con tareas
abiertas ni presentes como certificado el MVP de referencia. Cambios de arquitectura, invariantes
de datos o semántica de fallos requieren la decisión normativa correspondiente.

## Fronteras universales

- Las dependencias apuntan hacia dentro: `apps` compone adaptadores; `drivers` implementa puertos;
  `core/application` coordina casos de uso; `core/domain` conserva invariantes; `shared` contiene
  contratos y primitivas transversales.
- Consume otros paquetes mediante sus exports públicos; no importes sus archivos internos.
- Las rutas, controladores y adaptadores traducen entrada/salida y delegan; no contienen reglas de
  negocio.
- Cada agregado tiene un único nodo dueño. La sincronización transporta eventos, no tablas, y no
  resuelve escrituras concurrentes con last-write-wins.
- Las tablas relacionales son la fuente operativa; ledger append-only y outbox conservan historia
  y entrega, sin convertir el sistema en event sourcing.

## Invariantes universales

- Dinero, tasas, impuestos y cantidades facturables nunca usan `float`: conserva enteros, moneda o
  escala. Toda conversión requiere tasa, fuente y vigencia explícitas.
- Genera IDs con UUIDv7 o ULID desde la aplicación y persiste tiempos en UTC.
- Los eventos nombran hechos en pasado, son inmutables y sus consumidores son idempotentes.
- Un documento fiscal emitido es inmutable; una corrección usa el mecanismo fiscal previsto y los
  estados fiscales deben ser persistibles y recuperables.
- Toda operación sensible identifica actor, terminal, timestamp y motivo.
- No registres PINs, contraseñas, tokens, claves ni tarjetas completas. Los errores públicos usan
  códigos estables, mensajes seguros y nunca exponen stack traces.

## Trabajo seguro y acotado

- Antes de editar, revisa `git status`, el diff existente y las reglas aplicables. Los cambios que
  ya están en el working tree pertenecen al usuario u otro agente: presérvalos y no los reviertas,
  sobrescribas ni incluyas sin una razón explícita.
- Haz el cambio mínimo del alcance solicitado. No agregues dependencias, abstracciones,
  compatibilidad, optimización ni refactors oportunistas sin una necesidad concreta y documentada.
- Para comportamiento nuevo, trabaja outside-in: prueba observable primero, implementación mínima
  después. Reutiliza contratos, puertos y patrones existentes.
- Si cambia una garantía crítica, actualiza en el mismo hito el escenario aplicable de
  [`docs/failure-scenarios/`](./docs/failure-scenarios/README.md); enlaza la fuente normativa y
  declara cualquier brecha sin presentarla como vigente.
- Actualiza cronograma, documentación o ADR solo cuando cambie el estado, contrato o decisión que
  gobiernan.

## Commits semánticos y handoff

En trabajos largos o multi-etapa, crea un commit cuando exista un hito semánticamente completo y
verificable: una capacidad, migración, bloque de pruebas, integración UI, refactor local o criterio
de aceptación independiente. No hagas commits por archivo, cantidad de líneas o tiempo transcurrido,
ni esperes necesariamente al final de una tarea grande.

Antes de cada commit:

1. revisa `git status` y `git diff`;
2. ejecuta lint relevante, typecheck, tests directamente relacionados y tests arquitectónicos si
   cambian fronteras;
3. confirma que el hito no introduce fallos conocidos y que cualquier fallo previo no relacionado
   está documentado;
4. stagea únicamente archivos o hunks del hito con rutas explícitas; no uses `git add -A` a ciegas;
5. revisa `git diff --cached` y verifica que no incluya trabajo ajeno.

Usa Conventional Commits y describe el resultado en imperativo, con scope cuando aporte contexto:
`feat(sync): expose synchronization status`, `fix(inventory): preserve adjustment idempotency`,
`refactor(agents): localize repository instructions`. Evita `changes`, `update stuff`, `refactor` o
`wip`. Mantén cada commit atómico y no mezcles cambios no relacionados.

Los commits son checkpoints de handoff entre agentes. Un agente nuevo debe poder reconstruir lo
completado con `git log --oneline`, `git show <commit>` y el diff pendiente, sin depender del historial
del chat. Si una sesión puede interrumpirse, deja un checkpoint limpio cuando el hito ya sea válido.
Si el bloque aún no funciona o no pasó sus checks, conserva el working tree intacto y describe el
estado pendiente; no crees un commit roto solo para guardar progreso.

## Validación global

Ejecuta primero los checks directamente relacionados y expande solo si la dependencia real lo
exige. La validación mínima de un cambio funcional es:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Para cambios documentales, ejecuta lint, verificaciones de rutas/diff y los checks específicos que
existan; no corras suites costosas sin una razón técnica. Un cambio no está terminado si introduce
fallos conocidos. Si hay un fallo previo no relacionado, documéntalo y no amplíes el alcance.

## Convenciones

- Identificadores de código en inglés; documentación y mensajes de negocio en español.
- Casos de uso en verbo + sustantivo (`CompleteSale`) y errores con códigos estables
  (`SALE_INVALID_STATE`).
- Cambios pequeños y localizados. Mantén las fronteras internas de `core` explícitas y revisables.
