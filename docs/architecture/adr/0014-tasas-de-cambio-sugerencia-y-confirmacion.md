# ADR-0014: Tasas de cambio — histórico, sugerencia externa y confirmación humana

- Estado: Aceptado (parcial; ver Decisión diferida)
- Fecha: 2026-09-04

## Contexto

La sub-fase 9.07 necesita que el operador consulte la tasa vigente y su
histórico, registre una tasa manual y revise una sugerencia externa antes de
confirmarla. El plan de 9.07 exige cerrar seis decisiones antes de implementar.
Las decisiones 1 y 2 (fuente externa concreta, sus credenciales, términos de
uso y los pares que cada tienda gestiona) son decisiones comerciales y de
proveedor que no se pueden inferir del código ni del dominio existente; este
ADR no las resuelve. Las decisiones 3 a 6 son de ingeniería, ya implícitas en
el código existente (`ExchangeRate`, `UpdateExchangeRate`,
`ExchangeRateHistoryRepository`, `ExchangeRateProvider`) o consistentes con
ADR-0012, y este ADR las ratifica explícitamente para poder construir el
histórico, la sugerencia y la pantalla sin inventar reglas de negocio.

## Decisión

### Vigencia al confirmar (decisión 3)

Se mantiene el comportamiento ya implementado en `ExchangeRate` y
`ExchangeRateRepository.findCurrentByPair`: la tasa vigente para un instante es
la de `validFrom` más reciente cuyo `validUntil` es nulo o posterior a ese
instante. Confirmar una tasa nueva no cierra automáticamente una tasa anterior
con `validUntil` abierto; ambas quedan persistidas y la más reciente por
`validFrom` gana en caso de solape. Esta es una brecha conocida, no una
regla oculta: si el negocio necesita cerrar ventanas solapadas, requiere un
comando explícito futuro, no una inferencia silenciosa en 9.07.

### Alcance del histórico (decisión 4)

`GetExchangeRateHistory` exige siempre el par (`baseCurrency`, `quoteCurrency`)
y acepta un límite opcional entre 1 y 500, con 100 por defecto
(`CURRENCY_HISTORY_LIMIT_INVALID` fuera de ese rango). El orden es
descendente por `validFrom` y, en empate, por `id`, para ser determinista. No
se agrega paginación por cursor en el MVP: un límite fijo y acotado por
petición es suficiente y evita exponer un histórico sin cota.

### Permiso de lectura (decisión 5)

Consultar la tasa vigente, el histórico y la sugerencia externa exige sesión
verificada y ningún permiso adicional, igual que las demás lecturas de
catálogo y moneda fijadas en ADR-0012. Solo `UpdateExchangeRate` exige
`currency.rate.update`. Ocultar el formulario de confirmación en React nunca
sustituye esa autorización: el servidor la exige de nuevo en cada intento.

### Timeout y reintentos (decisión 6)

El proveedor de sugerencias usa un timeout configurable
(`EXCHANGE_RATE_PROVIDER_TIMEOUT_MS`, 5000 ms por defecto) y no reintenta
automáticamente: una falla de red, timeout o respuesta inválida devuelve un
error controlado en el primer intento. El único reintento posible es una nueva
acción humana explícita (el botón "Actualizar sugerencia" en la pantalla). El
driver nunca reintenta un registro o confirmación; esas siempre requieren
`UpdateExchangeRate` con motivo y clave de idempotencia por intención.

### Mecanismo de sugerencia y confirmación

`GetSuggestedExchangeRate` es una lectura pura: delega en el puerto
`ExchangeRateProvider` y no persiste nada. La UI copia los valores visibles de
la sugerencia (fuente, valor, escala, vigencia sugerida) al mismo formulario de
carga manual; no existe un segundo comando de persistencia. Confirmar siempre
ejecuta `UpdateExchangeRate`; editar cualquier campo del formulario antes de
confirmar convierte la acción en una confirmación de los datos editados.
Rechazar o descartar la sugerencia solo limpia estado local de React y no
produce ninguna escritura, auditoría o evento.

## Decisión diferida (decisiones 1 y 2)

La fuente externa concreta (proveedor, credenciales, términos de uso), los
pares que cada tienda gestiona y si existe más de una tasa (oficial, paralela,
comercial) siguen sin aprobar. Esto no es una omisión de ingeniería: requiere
una decisión de negocio y, si aplica, un acuerdo con el proveedor, que este ADR
no puede sustituir.

Mientras tanto, el mecanismo se mantiene deliberadamente agnóstico de
proveedor: `HttpExchangeRateProvider` no traduce el formato propietario de un
proveedor elegido informalmente. Define su propio contrato JSON neutral (par,
`rateValue`/`rateScale` o `rate` decimal, `source`, `observedAt`,
`validFrom`/`validUntil` opcionales) y solo se activa si el operador del nodo
configura `EXCHANGE_RATE_PROVIDER_URL` apuntando a un endpoint que hable ese
contrato. Sin esa variable, `UnavailableExchangeRateProvider` responde
`EXCHANGE_RATE_PROVIDER_NOT_CONFIGURED` sin tocar SQLite ni la red: la ausencia
de proveedor nunca bloquea la tasa vigente ni la carga manual.

Aprobar un proveedor concreto más adelante es una decisión operativa (URL,
fuente, credenciales fuera del repositorio) más, si su formato difiere del
contrato neutral, un adaptador delgado adicional; no exige cambiar dominio,
aplicación ni esta ADR salvo que cambie una de las reglas ya fijadas arriba.

## Consecuencias

- El histórico y la sugerencia quedan disponibles sin exponer un endpoint sin
  cota ni requerir un permiso que no existía.
- La ausencia de proveedor aprobado es visible y segura (falla cerrado), nunca
  una fuente "provisional" presentada como productiva.
- Ninguna sugerencia puede convertirse en tasa vigente sin pasar por
  `UpdateExchangeRate`, con motivo, autorización e idempotencia.
- La elección real de proveedor queda pendiente de aprobación de negocio y no
  bloquea el resto de 9.07: tasa vigente, histórico y carga manual operan hoy
  sin ella.

## Distribución LAN aprobada el 2026-09-06

Cada par confirmado forma una secuencia monotónica independiente. El agregado de integración
usa `aggregateType = ExchangeRate`, `aggregateId = BASE/QUOTE` y una versión persistida que
avanza en cada confirmación del par. `ExchangeRateUpdated.v1` transporta el registro inmutable
completo: identidad, par, valor entero, escala, fuente, vigencia y actor que lo confirmó.

La terminal conserva esos registros en su repositorio local y aplica solo versiones posteriores
del par; no confirma sugerencias externas ni escribe una segunda autoridad. El bootstrap publica
en orden de versión todas las tasas no vencidas en el instante del corte —incluidas las vigentes,
las futuras y cualquier ventana todavía aplicable— y excluye filas cuyo `validUntil` ya terminó.
Así preserva la selección temporal de este ADR sin copiar histórico vencido ilimitado.
