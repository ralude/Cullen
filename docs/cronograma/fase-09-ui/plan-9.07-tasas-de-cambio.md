# Plan de ejecución 9.07: Tasas de cambio

- **Sub-fase:** [9.07 Tasas de cambio](./9.07-tasas-de-cambio.md)
- **Estado del plan:** Ejecutado; decisiones de ingeniería cerradas en ADR-0014.
  La fuente externa concreta (decisiones 1-2) queda deliberadamente diferida:
  ver Brechas conservadas.
- **Prerrequisito:** [9.06 Reportes y cierres](./9.06-pantalla-reportes.md)
- **Disciplina visual:** Ponytail `full`, limitada a presentación
- **Ownership:** nodo coordinador tras confirmación humana; distribución en Fase 10

## Resultado esperado

El operador consulta la tasa local vigente y su histórico, registra una tasa
manual autorizada o solicita una sugerencia externa. La sugerencia es una
propuesta efímera: aceptarla exige una confirmación humana explícita y ejecuta
el comando existente `UpdateExchangeRate`; rechazarla no persiste nada. Un
fallo de red solo afecta la sugerencia y nunca impide consultar o registrar una
tasa local.

## Línea base comprobada

- Dominio ya modela `ExchangeRate` inmutable con par de monedas, entero
  escalado, fuente, vigencia y actor registrador; no admite `float`.
- Aplicación ya publica `UpdateExchangeRate`, `GetCurrentExchangeRate` y
  `CalculateMixedPaymentTotals`, y el comando de actualización autoriza
  `currency.rate.update`, conserva idempotencia y escribe auditoría.
- SQLite persiste el histórico y el repositorio puede guardar, buscar por ID y
  elegir la tasa vigente más reciente de un par. No existe una query pública
  para listar el histórico.
- HTTP ya expone tasa vigente, registro manual y cálculo de pagos mixtos. A
  diferencia de lo indicado antes en 9.07, 9.00 no publicó contratos de
  histórico ni de sugerencia.
- El renderer solo contiene el destino de navegación de 9.07; no existe cliente
  ni pantalla operativa de tasas.
- ADR-0012 permite leer la tasa vigente con sesión y exige
  `currency.rate.update` para persistir cambios. ADR-0008 reserva al coordinador
  la autoridad de tasas confirmadas y deja su distribución para Fase 10.

## Decisiones aplicadas

Aprobadas el 2026-09-04 en
[ADR-0014](../../architecture/adr/0014-tasas-de-cambio-sugerencia-y-confirmacion.md):

3. Vigencia al confirmar: se mantiene `validFrom` más reciente como criterio de
   vigencia; no se cierran automáticamente ventanas abiertas solapadas. Es una
   brecha conocida y documentada, no una regla oculta.
4. Alcance del histórico: par obligatorio, límite opcional entre 1 y 500 (100
   por defecto), orden descendente por `validFrom` y, en empate, por `id`. Sin
   paginación por cursor en el MVP.
5. Permiso de lectura: tasa vigente, histórico y sugerencia exigen solo sesión
   verificada, igual que las demás lecturas de moneda de ADR-0012. Solo
   `UpdateExchangeRate` exige `currency.rate.update`.
6. Timeout y reintentos: timeout configurable (5000 ms por defecto), cero
   reintentos automáticos. El único reintento posible es una acción humana
   explícita ("Actualizar sugerencia"); ninguno persiste ni confirma una tasa
   por sí mismo.

### Decisión diferida (1 y 2)

La fuente externa concreta (proveedor, credenciales, términos de uso) y los
pares que cada tienda gestiona siguen sin aprobar: son decisiones de negocio y,
si aplica, de un acuerdo con el proveedor, que este plan no puede sustituir. El
mecanismo se mantiene agnóstico de proveedor mediante un contrato JSON neutral
propio (`HttpExchangeRateProvider`) activado solo si el nodo configura
`EXCHANGE_RATE_PROVIDER_URL`; sin esa variable,
`UnavailableExchangeRateProvider` falla cerrado con
`EXCHANGE_RATE_PROVIDER_NOT_CONFIGURED` sin tocar SQLite ni la red. Esto no
bloquea el resto de 9.07: tasa vigente, histórico y carga manual operan hoy sin
un proveedor aprobado.

## Contratos de aplicación

### Histórico local

Agregar una query `GetExchangeRateHistory` y un puerto de lectura con par y
filtros aprobados. La salida reutiliza la representación exacta de
`ExchangeRateDto`, incluye fuente y vigencia y se ordena de forma determinista.
La query lee SQLite local; no llama al proveedor externo ni reconstruye datos
desde `business_event`.

### Sugerencia externa

Definir `ExchangeRateProvider` en `core/application` y
`GetSuggestedExchangeRate` como una lectura. Su DTO mínimo contiene par,
`rateValue`, `rateScale`, fuente identificable, instante observado y, solo si
la fuente lo respalda, vigencia sugerida. No contiene un ID de tasa persistida
ni afirma que la propuesta esté activa.

El puerto devuelve un error controlado y seguro ante timeout, red no disponible,
respuesta inválida o par no soportado. La aplicación valida forma, par, entero
escalado y metadatos antes de entregar la propuesta a HTTP. Claves y respuestas
crudas quedan dentro del driver y no llegan a logs, contratos ni renderer.

### Confirmación humana

No crear un segundo comando de persistencia. La UI copia los valores visibles
de la sugerencia a un formulario revisable y, tras una confirmación explícita,
llama a `UpdateExchangeRate` con motivo y una clave de idempotencia por
intención. El servidor vuelve a autorizar y el agregado crea una nueva entrada
histórica. Editar cualquier valor convierte la acción en una confirmación de
los datos editados, nunca en una aceptación silenciosa de la respuesta externa.

Rechazar o descartar la sugerencia limpia la propuesta local y produce cero
escrituras, auditoría u outbox. Refrescar una sugerencia tampoco registra tasas.

## Contratos HTTP a publicar

- `GET /api/v1/currency/exchange-rates`: histórico local autenticado con los
  filtros y cota que se aprueben.
- `GET /api/v1/currency/exchange-rates/suggestion`: sugerencia autenticada para
  un par; nunca modifica estado y traduce fallos del proveedor a Problem
  Details estable.
- Conservar `GET /api/v1/currency/exchange-rates/current` para la tasa local
  vigente y `POST /api/v1/currency/exchange-rates` como única escritura.

Los contratos viven en `packages/shared`; Fastify autentica, valida y delega.
Las rutas no leen SQLite, no consumen directamente el proveedor y no aceptan
valores decimales de punto flotante.

## Driver externo y composición

Crear `packages/drivers/exchange-rate` solo después de aprobar una fuente. El
adaptador traduce su formato al DTO neutral del puerto, usa configuración del
servidor para URL y credenciales, aplica timeout y valida la respuesta completa.
Las pruebas usan un servidor o transporte simulado: la suite determinista no
depende de Internet ni de datos variables del proveedor.

El driver se compone en `apps/server`, nunca en React ni Electron preload. Su
ausencia o indisponibilidad deja operativas las lecturas SQLite y la carga
manual. No se añade caché externa: la única tasa utilizable por ventas sigue
siendo una entrada local confirmada.

## Pantalla React

- Mostrar por separado `Tasa vigente`, `Histórico local`, `Carga manual` y
  `Sugerencia externa` para distinguir hechos persistidos de propuestas.
- Presentar par, valor escalado formateado sin perder precisión, fuente y
  vigencia. Conservar enteros y escala originales al enviar el comando.
- Permitir revisar, confirmar o rechazar la sugerencia; no seleccionar ni
  confirmar automáticamente al cargar la pantalla.
- Ante `NETWORK_UNAVAILABLE` o timeout, mantener visibles la tasa local y el
  formulario manual y explicar que solo la sugerencia está indisponible.
- Tras una actualización exitosa, volver a consultar vigente e histórico. Una
  denegación o error no altera optimistamente la vista.
- Mostrar la antigüedad real disponible de la tasa local. El estado de
  sincronización y antigüedad distribuida sigue perteneciendo a Fase 10.

## Secuencia outside-in ejecutada

1. Cerrar y documentar las decisiones de ingeniería (ADR-0014); diferir
   explícitamente la elección de proveedor.
2. Escribir pruebas de aplicación para histórico y sugerencia (límite
   acotado, propagación de fallos, cero puertos de escritura).
3. Reutilizar el puerto de histórico y el adapter Drizzle existentes
   (`DrizzleExchangeRateRepository.findHistoryByPair`), ya con orden y filtros
   deterministas sobre SQLite temporal.
4. Publicar el contrato HTTP faltante y sus pruebas: histórico, sugerencia,
   sesión, límite fuera de rango y fallo cerrado sin proveedor configurado.
5. Reutilizar el driver `HttpExchangeRateProvider`/`UnavailableExchangeRateProvider`
   ya compuesto en el servidor con transporte simulado en sus propias pruebas.
6. Extraer la lógica de lectura/sugerencia/confirmación del cliente desktop a
   funciones puras testeables y cubrirlas con pruebas de interacción y
   transporte HTTP simulado en Vitest.
7. Implementar la pantalla con el shell y CSS existentes, sin design system ni
   estado global especulativo.
8. Ejecutar pipeline y build; actualizar 9.07, el README de Fase 9 y el índice
   maestro.

## Criterios de aceptación

Ejecutado. La tasa vigente, el histórico y la sugerencia consultan SQLite y el
proveedor configurado a través de casos de uso autorizados; confirmar siempre
pasa por `UpdateExchangeRate`.

- [x] ~~La tasa vigente y el histórico proceden de SQLite local mediante queries
  de aplicación y contratos compartidos, no de datos mock ni SQL en rutas.~~
- [x] ~~Cada tasa visible conserva par, entero escalado, escala, fuente y vigencia
  sin usar `float` para transportar, calcular o confirmar el valor.~~
- [x] ~~Solicitar, refrescar, rechazar o fallar una sugerencia produce cero
  escrituras en `exchange_rates`, auditoría, ledger e idempotencia.~~
- [x] ~~La sugerencia nunca se muestra como vigente, oficial o aplicada y no se
  confirma sin una acción humana explícita.~~
- [x] ~~Confirmar usa exclusivamente `UpdateExchangeRate`, exige motivo,
  idempotencia y `currency.rate.update`, y crea una entrada histórica auditable.~~
- [x] ~~Un replay con la misma intención devuelve el mismo resultado y un payload
  distinto con la misma clave produce `IDEMPOTENCY_KEY_CONFLICT` (comportamiento
  ya cubierto por `executeIdempotentCommand`, reutilizado sin cambios).~~
- [x] ~~Timeout, red caída, respuesta inválida y par no soportado producen códigos
  seguros; ninguno oculta ni invalida la última tasa local vigente.~~
- [x] ~~Sin conexión externa se puede consultar la tasa local y completar una
  carga manual autorizada.~~
- [x] ~~Ninguna credencial, body externo crudo o dato excluido aparece en logs,
  Problem Details o renderer.~~
- [x] ~~Las pruebas de interacción cubren tasa vigente, histórico, carga manual,
  confirmación, rechazo, denegación y fallo offline de la sugerencia a nivel de
  las funciones puras del cliente que orquestan cada flujo.~~
- [x] ~~Lint, typecheck, tests y build quedan verdes.~~

## Brechas conservadas

- Sin proveedor externo aprobado, la sugerencia responde
  `EXCHANGE_RATE_PROVIDER_NOT_CONFIGURED` de forma segura; elegir un proveedor
  real de negocio queda pendiente de una decisión posterior (ver Decisión
  diferida).
- Estas coberturas son pruebas de interacción con transporte HTTP simulado. El
  gate E2E real de Fase 9 está documentado en 9.02.
- Vigencia solapada: confirmar una tasa no cierra automáticamente una anterior
  con `validUntil` abierto (comportamiento documentado en ADR-0014, no una
  omisión).

## Fuera de alcance

- Aplicar automáticamente una tasa sugerida o programar actualizaciones en
  segundo plano.
- Sincronizar tasas entre nodos, mostrar estado distribuido o resolver
  conflictos de versiones; pertenece a Fase 10.
- Elegir una fuente regulatoria sin evidencia primaria y aprobación del negocio.
- Promedios, arbitraje entre proveedores, predicción, alertas o gráficos.
- Introducir secretos en renderer, Electron IPC o archivos versionados.
