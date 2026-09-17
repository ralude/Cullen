# ADR-0032: Reconstrucción de `StockItem` en tiempo lineal

- Estado: **Aceptado**
- Fecha: 2026-09-17
- Origen: gate de modelo de
  [12.03.06](../../cronograma/fase-12-optimizacion/12.03-sqlite.md), abierto por la
  [caracterización de SQLite](../../cronograma/fase-12-optimizacion/12.03-caracterizacion.md).

## Contexto

Rehidratar un `StockItem` de 10.000 movimientos cuesta **2,64 s**. La medición de 12.03 descartó
que sea un problema de persistencia: son **tres sentencias**, las tres resueltas por índice, y
**13 ms dentro de SQLite**. Leer esas mismas 10.000 filas crudas cuesta 20 ms. El resto —más del
99 %— es el agregado reconstruyéndose.

El costo crece de forma cuadrática: **0,798 ms → 30,632 ms → 2.639,156 ms** por cada ×10 de
historia, es decir ×38 y luego ×86. La causa está en `appendMovement`, que `restore` ejecuta una
vez por movimiento y que recorre entera la historia ya acumulada:

- busca por `id` el movimiento que va a agregar, para detectar duplicados;
- comprueba que ningún movimiento anterior tenga el mismo `eventId`;
- cuando el movimiento trae costo, arma el conjunto de monedas históricas para decidir la moneda
  de valoración;
- cuando el movimiento es una salida, calcula el saldo disponible;
- cuando el movimiento no trae costo y puede heredarlo, calcula el costo promedio, que a su vez
  recorre la historia.

Cada una de esas comprobaciones es correcta y ninguna es negociable: son las invariantes del
inventario. Lo que no es necesario es **recalcularlas desde cero en cada paso**.

La consecuencia no es sólo del kardex, que 12.03 ya sacó del agregado con un camino de lectura:
vender un producto con historia profunda rehidrata su `StockItem` por el mismo camino, así que la
caja hereda la curva.

## Decisión

1. **`StockItem` mantiene, mientras acumula movimientos, las estructuras que hoy recalcula.**
   Índices de `id` y de `eventId` para detectar duplicados, el conjunto de monedas de costo
   conocidas, y saldos acumulados —total y por lote— que avanzan con cada movimiento. La
   reconstrucción pasa de cuadrática a lineal.
2. **No cambia ninguna regla.** Los mismos códigos de error, en el mismo orden y ante las mismas
   condiciones: `STOCK_MOVEMENT_DUPLICATE`, `STOCK_MOVEMENT_EVENT_DUPLICATE`,
   `STOCK_SALE_ISSUE_CONFLICT`, `STOCK_COST_CURRENCY_MISMATCH`,
   `STOCK_COST_CURRENCY_UNDETERMINED`, `STOCK_INSUFFICIENT` y los de lote. El costo promedio, el
   valor del inventario y el saldo conservan su aritmética exacta sobre enteros y moneda.
3. **No cambia el esquema, ni el contrato de los puertos, ni la historia.** No hay migración, no
   hay snapshot durable, no se compacta ni se borra un movimiento. `stock_movements` sigue siendo
   la fuente y `restore` sigue recibiendo la historia completa.
4. **El agregado sigue siendo el único camino de escritura.** Esta decisión no autoriza a resolver
   una escritura por consulta ni a mover una invariante de inventario a SQL.
5. **El resultado se mide con el protocolo de 12.03**, en la misma campaña y estación. Si la
   medición no mejora por encima del margen de ruido, el cambio se revierte: es una optimización,
   y una optimización que no se nota no se conserva.

## Alternativas descartadas

- **Snapshot durable de saldo y costo por artículo.** Elimina el costo a cualquier profundidad,
  pero agrega una autoridad durable nueva, su migración forward-only, su reconstrucción ante
  divergencia y un escenario de fallo propio. Es una respuesta desproporcionada mientras el
  crecimiento lineal quepa en presupuesto, y sigue disponible si un día no cabe.
- **Rehidratación acotada a una ventana de movimientos.** Cambia el contrato de `restore` y obliga
  a revisar toda operación que hoy asume historia completa —costeo promedio, saldo por lote,
  detección de duplicados—. Cambia garantías para ganar velocidad.
- **Aceptar la curva y documentar un límite operativo.** Deja a la caja con un riesgo conocido y
  sin respuesta, cuando la respuesta no exige cambiar ni el modelo ni los datos.

## Consecuencias

- La reconstrucción queda lineal, no gratuita: una historia diez veces mayor seguirá costando
  aproximadamente diez veces más. El límite práctico se corre, no desaparece, y si aparece una
  profundidad que no quepa en presupuesto, la decisión a revisar es el snapshot durable.
- El agregado pasa a tener estado derivado que debe mantenerse coherente con sus movimientos. Ese
  es el riesgo real del cambio, y por eso las pruebas de inventario existentes —duplicados,
  conflicto de venta, monedas mezcladas, saldo insuficiente, lotes— son la red que lo sujeta: no
  se relaja ninguna.
- `inventoryValue` y `averageUnitCost` conservan su recorrido cuando se los pide desde fuera; lo
  que deja de recorrerse es la reconstrucción.

## Criterios de aceptación

- [x] CA-0032-01: reconstruir una historia diez veces mayor cuesta aproximadamente diez veces más,
      no cien; medido con el protocolo de 12.03 sobre `stock-rehydrate-100/1k/10k`.
- [x] CA-0032-02: los códigos de error del inventario, su orden y sus condiciones no cambian, y la
      suite de inventario pasa sin modificar una sola expectativa de comportamiento.
- [x] CA-0032-03: saldo, saldo por lote, valor de inventario y costo promedio devuelven
      exactamente lo mismo antes y después, incluidos los casos de costo desconocido y de saldo
      que vuelve a cero.
- [x] CA-0032-04: no hay migración, cambio de esquema ni cambio en los exports públicos de `core`.
- [x] CA-0032-05: la venta de un producto con historia profunda hereda la mejora. El escenario que
      la mide es `stock-rehydrate`, que ejercita la misma llamada del repositorio que hace la
      venta; el arnés no tiene una jornada sobre historia profunda y no se inventó una para esta
      decisión.

## Verificación

Serie instrumentada del 2026-09-17, misma estación y mismos parámetros antes y después, sobre
`253b3d6` y `ca8dbd2`:

| Profundidad | Antes | Después | Crecimiento después |
|---:|---:|---:|---:|
| 100 | 3,181 ms | 2,197 ms | — |
| 1.000 | 56,281 ms | 6,325 ms | ×2,9 |
| 10.000 | 4.459,584 ms | 69,074 ms | ×10,9 |

La curva deja de ser cuadrática: ×10 de historia cuesta ×11, no ×79. **Falta la serie limpia**
—sin instrumento y con la estación aislada— que el protocolo de 12.01 exige para publicar un
AFTER comparable con la línea base; la estación del autor no bajó del límite de carga. 12.03 no
cierra sin ella.
