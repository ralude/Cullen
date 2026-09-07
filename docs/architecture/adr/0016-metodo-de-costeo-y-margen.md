# ADR-0016: Método de costeo de inventario y cálculo del margen

- Estado: **Aceptado para MVP técnico no certificado**
- Fecha: 2026-09-04
- Alcance: default de referencia reemplazable; no es una conclusión contable ni legal.

## Contexto

El inventario todavía no persiste costo de compra. La vista de margen necesita una forma
determinista de valorar recepciones y salidas, pero no necesita bloquear el resto del MVP ni
esperar una auditoría contable externa para implementar el contrato.

## Decisión para el MVP

1. Usar **promedio ponderado móvil** por producto y nodo. Cada recepción recalcula el costo
   unitario con enteros y cada salida toma el promedio vigente.
2. Congelar el costo en la recepción. Una tasa nueva no revaloriza hechos ya recibidos; una
   conversión entre monedas exige tasa, fuente, vigencia y snapshot explícitos.
3. Valorar una devolución o reverso con el costo snapshot del movimiento original. Si una
   operación futura necesita otra política, añade una estrategia reemplazable y sus pruebas.
4. Persistir el costo de la recepción como evidencia inmutable y calcular el margen en
   aplicación, nunca en el renderer.
5. Persistir en `StockItem` la moneda de valoración (`valuationCurrencyCode`) como atributo
   **de escritura única**: la única transición admitida es `null → CÓDIGO`. Nunca
   `CÓDIGO → otro código` ni `CÓDIGO → null`. Una vez fijada, es inmutable aunque el saldo
   llegue a cero y aunque el artículo deje de tener movimientos con costo. Un costo en otra
   moneda se rechaza; la conversión, cuando aplique, ocurre antes de registrar el movimiento y
   conserva su snapshot explícito. Esta monotonía es más fuerte que "la moneda no cambia con
   saldo cero" y la reemplaza: no depende del saldo.
6. Un movimiento operativo sin costo nuevo (`SALE_ISSUE`, merma o ajuste) toma el promedio
   vigente cuando el saldo tiene valoración conocida. Si no existe un promedio conocido, el
   movimiento conserva costo nulo y la valoración permanece indeterminada. Una entrada valorada
   posterior fija `valuationCurrencyCode` (transición `null → CÓDIGO`) e inicia un cálculo
   recuperable de promedio.
   - Un artículo con historia sin costo que **nunca vuelve a recibir una entrada valorada**
     queda sin valoración de forma permanente. El Corte 4 ya asume ese caso: deriva
     `quantitySoldScaled` aunque falte costo y el margen de ese artículo queda mudo. Se acepta
     ese riesgo de forma explícita (ver Consecuencias) en lugar de resolverlo con un parche
     silencioso.
   - La salida deliberada a ese estado es una **valoración inicial administrativa** —un ajuste
     con costo y moneda, autorizado y auditado, que fija el promedio y la moneda de un artículo
     sin esperar una recepción—. Queda como extensión diferida (ver Alternativas diferidas), no
     se implementa en este corte.
7. La migración desde historia previa solo fija la moneda cuando todos los movimientos con
   costo de un artículo usan un único código. Una historia con monedas distintas conserva
   moneda nula y requiere corrección explícita; no se inventa una conversión.

## Alternativas diferidas

FIFO por capas, costo estándar, revalorización posterior, moneda de reporte dinámica,
**valoración inicial administrativa** (ajuste con costo que fija promedio y moneda sin
recepción) y variaciones contables quedan como extensiones. Se incorporan solo con un
consumidor concreto, criterios de salida y un ADR que cambie explícitamente el default.

## Complemento LAN del 2026-09-06

[ADR-0026, D4](./0026-lan-operativa-y-recuperacion-entre-nodos.md) fija para ventas offline
el snapshot de costo conocido al vender, con versión/fuente y `null` explícito cuando falta.
La salida sincronizada y el margen no sustituyen ese costo por el promedio al recibir el
evento. La devolución conserva el de la salida original. Es una precisión para el flujo
LAN todavía pendiente de implementación; no cambia recepción ponderada, moneda de escritura
única ni revaloriza historia existente.

## Invariantes

- Dinero en unidades menores enteras más código de moneda; nunca `float`.
- Cada conversión usa una tasa explícita, fuente y vigencia.
- Una recepción completada conserva costos, moneda y snapshots.
- La moneda de valoración de un artículo es de escritura única: `null → CÓDIGO` y nada más,
  con independencia del saldo. Un trigger de base de datos y la regla de aplicación son
  coherentes.
- La ausencia histórica de costo se representa con `null`; no equivale a costo cero.
- Una corrección crea movimientos compensatorios; no edita historia.
- La valoración es transaccional, auditable e idempotente.

## Consecuencias

9B.04 puede implementar `PurchaseReceipt`, costo y margen sin afirmar que el método elegido es
el aplicable a una contabilidad externa. El perfil fiscal/contable de un despliegue puede
reemplazar la estrategia sin cambiar el contrato del dominio.

Riesgo aceptado: un artículo cuya historia nunca tuvo costo y que no vuelve a recibir una
entrada valorada queda sin moneda de valoración de forma permanente y su margen es mudo en los
KPIs. El Corte 4 lo tolera derivando cantidades sin costo. La corrección no urgente es la
valoración inicial administrativa diferida; hasta entonces, el KPI de margen expone esos
artículos como "sin costo" y no como margen cero.
