<div align="center">

# Cullen

**Plataforma de punto de venta e inventario para supermercados, construida offline-first.**

Electron · React · Fastify · SQLite · TypeScript · DDD + Arquitectura Hexagonal

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-582%20passing-2ea44f)](#calidad-verificable)
[![ADRs](https://img.shields.io/badge/ADRs-21-blue)](./docs/architecture/adr)
[![License](https://img.shields.io/badge/license-Apache%202.0-lightgrey)](./LICENSE)

</div>

---

> **TL;DR (English)** — Offline-first POS and inventory platform for supermarkets. TypeScript
> monorepo built with tactical DDD and hexagonal architecture: pure domain, use-case layer with
> ports, swappable adapters. 582 tests, 21 ADRs, 26 forward-only migrations, architecture
> boundaries enforced by ESLint. Handles integer money arithmetic, multi-currency, crash-recoverable
> fiscal state, idempotent commands, optimistic concurrency and per-node aggregate ownership.
> Detailed docs are in Spanish.

---

## El problema

El comercio minorista venezolano opera con condiciones que rompen los supuestos de un POS
convencional:

| Restricción real | Consecuencia técnica |
|---|---|
| Múltiples monedas simultáneas con tasas volátiles | El dinero no puede ser `float` ni asumir una moneda única; cada conversión exige tasa, fuente y vigencia explícitas |
| Conectividad intermitente | Cada terminal debe operar autónoma y reconciliar después, sin *last-write-wins* |
| Impresoras fiscales que fallan a mitad de una operación | El estado fiscal debe ser persistente y recuperable tras un reinicio, sin reimprimir a ciegas |
| Auditoría comercial y fiscal obligatoria | Toda operación sensible necesita actor, terminal, nodo, UTC y motivo |

Cullen es mi respuesta de ingeniería a ese problema: un MVP funcional que trata esas
restricciones como invariantes de diseño, no como casos borde.

---

## Lo técnicamente interesante

Estos son los problemas que resolví y que considero representativos de mi trabajo.

<details open>
<summary><b>💰 Dinero entero, nunca punto flotante</b></summary>

`Money` almacena unidades menores enteras + código de moneda, y opera internamente con `BigInt`
para que multiplicar por cantidad o porcentaje no pierda precisión ni desborde silenciosamente.
`Quantity` aplica el mismo criterio a cantidades escaladas (kg, litros, unidades). Sumar dos
`Money` de monedas distintas es un error de dominio, no un bug de producción.

</details>

<details>
<summary><b>🔌 Estado fiscal recuperable en cuatro ejes independientes</b></summary>

Cuando una impresora fiscal deja de responder, "no sé qué pasó" no es un estado aceptable. Cada
documento persiste evidencia en cuatro ejes ortogonales —despacho, efecto del comando,
*commit* fiscal e impresión— de modo que un *timeout* nunca se confunde con un rechazo. La
recuperación es determinista y **fail-closed**: ante evidencia ambigua el sistema bloquea la
repetición y exige reconciliación explícita.

</details>

<details>
<summary><b>🌐 Ownership por nodo, sin last-write-wins</b></summary>

Cada agregado tiene un único nodo dueño (`originNodeId`), inmutable desde su creación y
respaldado por *triggers* de base de datos. Un nodo que no es dueño rechaza el comando de
escritura en la capa de aplicación (`AGGREGATE_OWNER_MISMATCH`); si el ownership no puede
resolverse, toda mutación se rechaza en lugar de adivinar. Es la base para la sincronización
LAN sin resolución de conflictos ad hoc.

</details>

<details>
<summary><b>🔁 Idempotencia por intención, no por reintento</b></summary>

Cada comando de negocio se ejecuta dentro de `executeIdempotentCommand`: misma clave +
mismo *fingerprint* devuelve exactamente la misma respuesta; misma clave con distinto contenido
falla con `IDEMPOTENCY_KEY_CONFLICT`. El renderer mantiene una clave **por intención de
formulario**, de modo que doble clic, *timeout* y reintento comparten clave, pero una intención
nueva genera otra.

</details>

<details>
<summary><b>🧾 Contratos HTTP verificados contra los casos de uso</b></summary>

Cada endpoint declara su permiso en un contrato compartido entre servidor y renderer. Una prueba
recorre la matriz completa y **falla si el permiso declarado se desvía del que el caso de uso
realmente exige** — el tipo de deriva silenciosa que hace que la UI ofrezca acciones que el
servidor rechaza. El renderer deriva su navegación y sus botones de los permisos efectivos de la
sesión, no de suposiciones.

</details>

<details>
<summary><b>🛡️ Invariantes defendidos en dos capas</b></summary>

Las reglas viven en el dominio, pero las críticas tienen además un respaldo en SQLite: **95
triggers** que impiden borrado físico de historia, mutación de evidencia inmutable, ownership
sin resolver o identificadores duplicados. Si una ruta de escritura futura olvida la regla, la
base de datos la detiene.

</details>

<details>
<summary><b>📐 Fronteras arquitectónicas que el linter hace cumplir</b></summary>

El grafo de dependencias no es una convención documentada: `eslint.config.js` lo impone con
`no-restricted-imports` por capa. `core/domain` no puede importar Fastify, Drizzle, Electron ni
React — y el build falla si alguien lo intenta.

</details>

---

## Calidad verificable

| | |
|---|---:|
| Pruebas (Vitest, todas en verde) | **582** en 119 archivos |
| Código de producción / código de prueba | 30.7k / 15.9k líneas |
| Casos de uso en la capa de aplicación | 85 |
| Endpoints HTTP versionados y contratados | 63 |
| Permisos granulares | 40 |
| Migraciones forward-only (con checksum SHA-256) | 26 |
| Registros de decisión arquitectónica (ADR) | 21 |
| Escenarios de fallo documentados | 7 |
| Triggers de invariante en SQLite | 95 |

```bash
pnpm pipeline    # lint + typecheck + 582 pruebas
```

El pipeline corre en local sin asumir plataforma remota. TypeScript va en modo estricto con
`exactOptionalPropertyTypes`, y las migraciones se prueban sobre SQLite temporal, incluyendo el
*backfill* de datos históricos.

---

## Arquitectura

DDD táctico + arquitectura hexagonal. La dependencia apunta siempre hacia adentro:

```
┌─────────────────────────────────────────────────────────────┐
│  apps/desktop (Electron + React)   apps/server (Fastify)    │  Composición y transporte
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  packages/drivers/*  db · fiscal · security · exchange-rate │  Adaptadores (implementan puertos)
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  core/application   casos de uso · DTOs · puertos           │  Orquestación
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  core/domain    entidades · agregados · value objects       │  Reglas de negocio puras
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  packages/shared     Money · Quantity · Result · contratos  │  Primitivas transversales
└─────────────────────────────────────────────────────────────┘
```

**Reglas no negociables:** el dominio no conoce frameworks; los adaptadores no contienen reglas
de negocio; las rutas y componentes React solo adaptan entrada/salida; una integración fiscal
nueva se agrega como driver sin tocar dominio ni casos de uso.

### Contextos delimitados

`sales` · `cash` · `inventory` · `catalog` · `purchasing` · `currency` · `fiscal` · `identity` · `config`

Los módulos se comunican por contratos y eventos de dominio en pasado (`SaleCompleted`,
`StockMovementRegistered`, `SaleReturned`), nunca leyendo tablas ajenas. Las tablas relacionales
son la fuente de verdad operativa; un *ledger* append-only conserva la historia y un *outbox*
garantiza la entrega — sin event sourcing completo, que sería complejidad no justificada para
este alcance.

---

## Stack

| Capa | Tecnología | Por qué |
|---|---|---|
| Escritorio | Electron 44 + React 19 | Terminal POS instalable con acceso a hardware local |
| API / LAN | Fastify | Cada terminal expone su propio nodo HTTP; el negocio viaja por HTTP, no por IPC |
| Persistencia | SQLite + Drizzle ORM | Autonomía offline real, un solo archivo por nodo, *single-writer* |
| Lenguaje | TypeScript (estricto) | Un solo lenguaje de dominio a UI, invariantes en el sistema de tipos |
| Pruebas | Vitest | Outside-in TDD ([ADR-0007](./docs/architecture/adr/0007-outside-in-tdd.md)) |
| Monorepo | pnpm workspaces | Fronteras de paquete explícitas y verificables |

---

## Cómo ejecutarlo

```bash
pnpm install

# Verificación completa
pnpm pipeline

# 1. Administrador inicial. Pide código, nombre y PIN en el terminal.
pnpm --filter @supermarket/server bootstrap-admin:dev

# 2. Configuración operativa: caja, métodos de pago y políticas. Sin esto no hay
#    turno ni cobro. Ningún valor fiscal tiene default: se declaran al ejecutarlo.
pnpm --filter @supermarket/server bootstrap-operations:dev -- \
  --database ./supermarket-node.sqlite --currency USD \
  --discount-max-basis-points 1500 --igtf-basis-points 300 \
  --igtf-payment-methods CARD --igtf-currencies USD

# 3. Catálogo de ejemplo para probar (opcional). Las tres opciones son obligatorias:
pnpm --filter @supermarket/server seed:products \
  --database ./supermarket-node.sqlite --currency USD --tax-rate-basis-points 1600

# 4. Nodo servidor (Fastify + SQLite)
pnpm --filter @supermarket/server dev

# 5. Terminal de escritorio (Electron + React)
pnpm --filter @supermarket/desktop dev
```

Los pasos 2 y 3 escriben en la base y exigen que el servidor **no** esté corriendo: SQLite admite
un solo proceso dueño por nodo y, con el nodo activo, fallan con `DATABASE_NODE_LOCKED`.
Autenticarse no basta para operar: sin el paso 2, abrir un turno falla con
`CASH_REGISTER_NOT_FOUND` y cobrar con `POLICY_NOT_CONFIGURED`.

Qué siembra ese catálogo, por qué se puede repetir y qué **no** hace —existencias, usuarios ni
distribución automática a las terminales— está en
[la guía de la seed](./docs/operacion/seed-de-catalogo-de-ejemplo.md). El recorrido completo de
una jornada —abrir caja, vender, facturar, cerrar con arqueo y leer el kardex— está en
[la guía de operación diaria](./docs/operacion/operacion-diaria.md).

Requiere Node.js 20.6+ (los scripts usan `--env-file` e `--import`; probado en Node 24) y pnpm 11.

---

## Estado del proyecto

Desarrollo por fases con cronograma versionado.

| Fases | Alcance | Estado |
|---|---|---|
| 0 – 7 | Arquitectura, infraestructura, dominio, persistencia, ledger/outbox, caja, inventario, driver fiscal simulado | ✅ Completadas |
| 8 | Integración serial con impresoras fiscales reales | ⏸️ Suspendida (dependencia externa) |
| 9 · 9B | Interfaz de operación y capacidades de negocio (costos, devoluciones, conteos, proveedores, KPIs, arqueos) | ✅ Capacidades completas · restan los perfiles de usuario |
| 10 – 12 | Sincronización LAN, hardening de seguridad, optimización medida | ⏳ Pendientes |

> **Declaración honesta de alcance:** este es un **MVP de referencia no certificado**. La
> integración con impresoras fiscales reales (Fase 8) está **suspendida por dependencia externa**
> —hardware, protocolo del fabricante y laboratorio de certificación— y el sistema opera con un
> driver fiscal simulado explícitamente rotulado como `SIMULACIÓN`. No se presenta como
> cumplimiento normativo.

Prefiero declarar ese límite antes que insinuar una capacidad que no puedo demostrar. El
[cronograma](./docs/cronograma/README.md) documenta cada fase, sus decisiones y sus deudas
abiertas.

### Cómo trabajo: un caso concreto

"Terminado" solo cuenta si sobrevive a una auditoría. En septiembre de 2026 revisé el código
contra los criterios de aceptación que yo mismo había marcado como cumplidos, y no cuadraban:
una prueba contractual estaba en rojo, un ajuste de inventario sin costo podía borrar en silencio
la valoración histórica de un artículo, varias lecturas autorizaban en la ruta pero no en la capa
de aplicación, y el ownership por nodo no se estaba persistiendo.

En lugar de seguir sumando funcionalidad sobre una base falsa, congelé el avance con un
[gate correctivo bloqueante](./docs/cronograma/fase-09b-perfiles/plan-correcciones-auditoria-9b.md):
cinco cortes en orden obligatorio, cuatro decisiones normativas que debían quedar aceptadas en su
ADR **antes** de escribir código, y una regla simple — ningún corte empieza con la suite en rojo.

El gate se cerró completo. Cada hallazgo terminó con una prueba observable que falla antes de la
corrección y pasa después, y las decisiones quedaron escritas en
[ADR-0016](./docs/architecture/adr/0016-metodo-de-costeo-y-margen.md),
[ADR-0017](./docs/architecture/adr/0017-politica-de-devolucion.md) y
[`12-sincronizacion-y-ownership.md`](./docs/architecture/12-sincronizacion-y-ownership.md) para
que la próxima persona sepa por qué el sistema hace lo que hace.

---

## Mapa del repositorio

```
apps/
  desktop/          Electron + React (renderer, preload, main)
  server/           Fastify: rutas, composición de dependencias, bootstrap
packages/
  shared/           Money, Quantity, Result, errores y contratos HTTP v1
  core/
    src/domain/     entidades, agregados, value objects y eventos — sin dependencias externas
    src/application/casos de uso, DTOs y puertos
  drivers/
    db/             SQLite + Drizzle: repositorios, migraciones, unit of work, auditoría
    fiscal/         puerto fiscal + implementación simulada con evidencia recuperable
    security/       hashing de PIN (scrypt), tokens de sesión, identidad de nodo, UUIDv7
    exchange-rate/  proveedor externo de tasas (sugiere; un humano confirma)
    hardware/       reservado para scanner y báscula — aún sin implementación
    logging/        reservado — hoy la auditoría vive en el driver `db`
docs/
  architecture/     arquitectura por responsabilidad + 21 ADRs
  cronograma/       fases, sub-fases, planes y decisiones
  failure-scenarios/semántica de fallo de operaciones críticas
  producto/         alcance por nivel de entrega
```

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/architecture/README.md`](./docs/architecture/README.md) | Arquitectura por responsabilidad: capas, módulos, agregados, eventos, errores |
| [`docs/architecture/adr/`](./docs/architecture/adr) | 21 decisiones arquitectónicas con contexto, alternativas y consecuencias |
| [`docs/cronograma/README.md`](./docs/cronograma/README.md) | Estado por fase y registro de replanificaciones |
| [`docs/failure-scenarios/`](./docs/failure-scenarios/README.md) | Qué garantiza el sistema cuando algo falla a mitad de una operación |
| [`docs/operacion/operacion-diaria.md`](./docs/operacion/operacion-diaria.md) | Recorrido de una jornada: abrir caja, vender, facturar, cerrar con arqueo y leer el kardex |
| [`AGENTS.md`](./AGENTS.md) | Reglas operativas del proyecto — fuente única para colaboradores humanos y agentes de IA |

---

<div align="center">

<!-- TODO: completa tu nombre y la URL real de tu perfil antes de publicar -->
**Gerardo** · [LinkedIn](https://www.linkedin.com/in/TU-PERFIL) · Apache 2.0

*Proyecto personal. Abierto a conversaciones sobre arquitectura de software, sistemas offline-first y desarrollo de producto.*

</div>
