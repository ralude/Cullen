# Guion de sesiones reales de navegación — 12.05.01

- **Estado:** preparado el 2026-09-18. **Sin ejecutar.** Este archivo no cierra nada: describe
  cómo se corre la medición que [12.05.01](./12.05-mantenibilidad-estructural.md) dejó suspendida.
- **Qué criterio cierra:** «Registrar sesiones reales de navegación de los mismos escenarios antes
  de refactorizar», el único punto pendiente de [12.05](./12.05-mantenibilidad-estructural.md) y
  uno de los dos del [gate de salida de la Fase 12](./README.md#gate-de-salida-en-modo-fiscal-simulado).
- **Revisiones:** BEFORE `b786844`, AFTER `1cab153`, las mismas que compara la
  [evidencia de radio de contexto](./12.05-evidencia-y-cierre.md).

## 1. Qué mide y qué no

Mide **navegación en frío**: cuántas búsquedas, cuántos archivos y qué profundidad necesita alguien
que no conoce el árbol para localizar dónde se hace un cambio y describirlo. No mide tiempo de
implementación, calidad del cambio ni ahorro de tokens.

Lo que hoy existe es una **shortlist estática** —archivos contados enteros, verificados ruta por
ruta— y así está declarada en el manifiesto. Esta sesión no la reemplaza: la contrasta. Si la
sesión no reproduce la reducción que la estática reporta, manda la sesión, y el cierre de 12.05
se corrige; no al revés.

## 2. Quién puede correrla

**No la puede correr quien hizo los cortes de 12.05.** Una sesión conducida por quien acaba de
pasar una sub-fase dentro de estos archivos mide memoria, no navegación.

| Operador | Admisible | Condición |
|---|---|---|
| Tercero humano sin trabajo previo en estos archivos | Sí | Es el caso ideal y el más caro |
| Contexto de agente nuevo, sin historial de esta fase | Sí | Declarar modelo, versión, fecha y herramientas disponibles; 12.05.08 es un *AI maintainability benchmark*, la vía está prevista por diseño |
| Quien capturó la baseline o ejecutó los cortes | No | Invalida la celda |

**Regla dura: un contexto = una celda.** Una celda es un escenario en una revisión. Son seis
escenarios por dos revisiones, o sea **doce sesiones independientes**. No se agrupan seis
escenarios en una sesión: comparten hubs, y a partir del segundo el operador ya no está en frío.
Como cada celda es independiente, el orden entre ellas da igual.

## 3. Aislamiento

El operador trabaja sobre el árbol como cualquier mantenedor, con dos excepciones.

**No puede abrir** `docs/cronograma/fase-12-optimizacion/**`. Ahí están las listas de archivos por
escenario, los hubs y la tabla de «qué archivo dejó de abrirse»: leer cualquiera de esos archivos
convierte la sesión en una lectura de la respuesta. Esto **no es opcional en el AFTER**, donde el
árbol de `1cab153` ya contiene las fichas que narran el refactor.

**Sí puede abrir** el resto del repositorio: `AGENTS.md` raíz y locales, `docs/architecture/`
—incluidos los ADR—, `docs/failure-scenarios/`, el README, el historial de git y el código.

Esa prohibición es una **desviación declarada** del comportamiento natural: un mantenedor real sí
leería el cronograma. Se registra como tal y no se presenta la sesión como una réplica perfecta de
la vida real.

## 4. Preparación

Dos copias independientes. **No se resetea el working tree del usuario.**

```bash
git worktree add ../cullen-before b786844
git worktree add ../cullen-after  1cab153
```

`pnpm install --frozen-lockfile` en cada copia solo si la sesión va a ejecutar checks. No hace
falta arrancar el nodo ni la terminal: la tarea termina en un plan de edición, no en código.

## 5. El enunciado que recibe el operador

Se le entrega **esto y nada más**: el bloque de instrucciones, un enunciado, y la ruta del
worktree. Ninguna lista de archivos, ningún nombre de hub, ninguna pista de dónde empezar.

> Trabajas sobre este checkout, que no conoces. Localiza dónde se hace el cambio descrito y
> descríbelo: qué archivos editarías, en qué punto de cada uno, qué pruebas tocarías y qué checks
> correrías. **No implementes el cambio.** No abras `docs/cronograma/fase-12-optimizacion/`.
> Registra tus búsquedas literales a medida que las haces.

| Escenario | Enunciado (literal del manifiesto) |
|---|---|
| `supplier` | Añadir un dato descriptivo opcional a Supplier, persistirlo y mostrarlo; sin cambiar identidad fiscal ni permisos. |
| `stock-item` | Ajustar una validación existente de StockItem al registrar un ajuste; conservar contrato, escala, costo y ownership. |
| `complete-sale` | Modificar la coordinación de CompleteSale preservando cobro atómico local y el rechazo auditable de stock. |
| `shift` | Modificar la precondición de cierre de Shift por ventas abiertas; revisar apertura para preservar el ciclo completo. |
| `report` | Añadir un campo derivable de datos existentes al reporte de inventario y su CSV, sin migración. |
| `sync-reference` | Extender una referencia de catálogo existente del productor al consumidor; conservar versión, deduplicación y ownership. |

## 6. Regla de parada

La sesión termina cuando el operador puede nombrar **cada archivo a editar, el punto dentro de
cada uno y la prueba que fallaría primero**. Tope: 40 pasos de herramienta o 45 minutos, lo que
ocurra antes.

Agotar el tope **no descarta la celda**: se registra como sesión incompleta con lo que alcanzó. Que
un escenario no se resuelva dentro del tope es exactamente el tipo de dato que esta medición busca.

## 7. Qué se registra

Por celda, un objeto con estos campos. Se cuenta cada ruta una vez; un import no se cuenta como
lectura íntegra.

| Campo | Contenido |
|---|---|
| `id` / `revision` | escenario y commit (`b786844` o `1cab153`) |
| `operator` | `human` o `agent`; si es agente, modelo, versión y herramientas |
| `date` | fecha de la sesión |
| `searches` | consultas de búsqueda **literales**, en orden |
| `filesOpened` | rutas abiertas, en orden de apertura |
| `linesRead` | rangos de línea efectivamente leídos por ruta |
| `maxHops` | saltos máximos desde el punto de entrada hasta el archivo dueño |
| `extraFileCause` | por cada archivo fuera de la shortlist, por qué se abrió |
| `editPlan` | archivos a editar, punto dentro de cada uno, pruebas tocadas |
| `checksProposed` | checks que el operador correría |
| `completedWithinCap` | `true` / `false` |
| `tokens` | solo si el operador es un agente y el instrumento es idéntico entre BEFORE y AFTER; si no, se omite, no se estima |

El resumen se publica como `navigation-sessions-b786844.json` y `navigation-sessions-1cab153.json`
junto a los manifiestos de esta carpeta. **La transcripción cruda no entra al árbol**, igual que
las trazas crudas de 12.01: se conserva aparte y se cita por su SHA-256.

## 8. Cómo se lee el resultado

- Cada escenario se compara **consigo mismo** entre revisiones. No se promedian los seis: una
  mejora grande en UI no puede tapar una regresión en sync.
- Los escenarios que empeoren se declaran, como ya se declararon los tres casos peores del
  benchmark estático.
- La afirmación de ahorro de tokens o de tiempo **solo se escribe si `tokens` existe en las doce
  celdas con el mismo instrumento**. Si no, el cierre sigue diciendo lo que dice hoy: superficie
  abierta, no ahorro.

El checkbox de 12.05.01 se marca cuando las doce celdas estén corridas y publicadas, con sus
desviaciones declaradas. Menos de doce celdas es evidencia parcial y se declara como tal.

## 9. Lo que este guion no cubre

**No cierra CA-12.01-01.** Ese criterio es otra cosa: exige que un tercero reproduzca la serie de
medición de rendimiento en la estación de referencia, con el arnés y los comandos de la
[línea base](./baseline-before.md). Navegación y rendimiento no se sustituyen.
