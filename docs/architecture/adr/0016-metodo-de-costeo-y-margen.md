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
5. Persistir en `StockItem` la moneda de valoración desde el primer movimiento con costo.
   La moneda no cambia cuando el saldo llega a cero. Un costo en otra moneda se rechaza; la
   conversión, cuando aplique, debe ocurrir antes de registrar el movimiento y conservar su
   snapshot explícito.
6. Un movimiento operativo sin costo nuevo (`SALE_ISSUE`, merma o ajuste) toma el promedio
   vigente cuando el saldo tiene valoración conocida. Si no existe un promedio conocido, el
   movimiento conserva costo nulo y la valoración permanece indeterminada hasta que el saldo
   vuelva a cero. Una entrada valorada posterior a ese punto inicia un cálculo recuperable.
7. La migración desde historia previa solo fija la moneda cuando todos los movimientos con
   costo de un artículo usan un único código. Una historia con monedas distintas conserva
   moneda nula y requiere corrección explícita; no se inventa una conversión.

## Alternativas diferidas

FIFO por capas, costo estándar, revalorización posterior, moneda de reporte dinámica y
variaciones contables quedan como extensiones. Se incorporan solo con un consumidor concreto,
criterios de salida y un ADR que cambie explícitamente el default.

## Invariantes

- Dinero en unidades menores enteras más código de moneda; nunca `float`.
- Cada conversión usa una tasa explícita, fuente y vigencia.
- Una recepción completada conserva costos, moneda y snapshots.
- La moneda de valoración de un artículo es estable, incluso con saldo cero.
- La ausencia histórica de costo se representa con `null`; no equivale a costo cero.
- Una corrección crea movimientos compensatorios; no edita historia.
- La valoración es transaccional, auditable e idempotente.

## Consecuencias

9B.04 puede implementar `PurchaseReceipt`, costo y margen sin afirmar que el método elegido es
el aplicable a una contabilidad externa. El perfil fiscal/contable de un despliegue puede
reemplazar la estrategia sin cambiar el contrato del dominio.
