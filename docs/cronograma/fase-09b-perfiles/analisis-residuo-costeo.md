# Análisis: residuo de redondeo del costeo (9B.04)

- **Sub-fase dueña:** [9B.04 Costo de compra y margen](./9b.04-costo-y-margen.md)
- **Decisión vigente:** [ADR-0016](../../architecture/adr/0016-metodo-de-costeo-y-margen.md),
  default de referencia reemplazable
- **Estado:** análisis y recomendación; **no cambia la fórmula**. Cambiarla exige un ADR que
  enmiende ADR-0016.
- **Fecha:** 2026-09-09
- **Origen:** punto 2 del [registro de auditoría 2026-09-04](../fase-11-seguridad/auditoria-puntos-clave-2026-09-04.md).
  11.05 sólo agregó evidencia auditable del costo usado; no tocó el cálculo.

## Qué se midió

El punto 2 de la auditoría describía «entradas de 100 y 101 centavos, salida de las dos
unidades, existencia cero y valor -1; una entrada posterior de 100 centavos queda con promedio
99». Parte de eso ya no ocurre: `StockItem.inventoryValue` reinicia el valor a cero cuando el
saldo llega a cero, así que una entrada posterior de 100 deja promedio **100**, no 99. La
contaminación de la valoración está cerrada.

Lo que sigue abierto se reprodujo sobre el árbol actual
(`packages/core/src/domain/inventory/stock-item.ts`), con estos cuatro casos:

| Caso | Compras | Salidas | COGS registrado | Compra real | Diferencia |
| --- | --- | --- | --- | ---: | ---: |
| A | 1×100, 1×101 | una de 2 unidades (agota) | 202 | 201 | **+1** |
| B | 3×100, 3×101 | seis de 1 unidad (agota) | 603 | 603 | 0 |
| C | 1×100, 1×101, 1×100 | una de 2 y luego una de 1 (agota) | 301 | 301 | 0 |
| D | tras el caso A, entrada de 100 | — | promedio 100 | — | 0 |

## Mecanismo

`averageUnitCost` divide el valor entre el saldo con redondeo *half away from zero*
(`Money.divideByQuantity`, `packages/shared/src/money.ts:111`). Ese promedio redondeado se
congela como `unit_cost` del movimiento de salida
(`stock-item.ts:208`), y el reporte de margen suma esos snapshots.

- **Mientras queda saldo, el residuo se autocorrige.** Lo que se redondeó de más o de menos se
  queda en `inventoryValue` y ajusta el promedio de la salida siguiente (casos B y C). No
  acumula.
- **El residuo se pierde sólo cuando una salida de más de una unidad agota la existencia.** El
  costo redondeado se multiplica por la cantidad de esa línea, y el sobrante —el `-1` del caso
  A— lo descarta el reinicio a cero de `inventoryValue`. Es el único caso en que la suma de COGS
  del ciclo no coincide con la compra.

## Alcance real

- **Cota:** menos de media unidad menor por unidad de la línea que agota, es decir menos de
  `cantidad / 2` unidades menores por ciclo de agotamiento y artículo. Con céntimos y líneas
  típicas, céntimos.
- **Frecuencia:** sólo en la venta que deja la existencia en cero, y sólo si el valor no divide
  exacto entre el saldo.
- **Qué afecta:** el COGS y el margen del período en que ocurre. **No** afecta la valoración de
  inventario —no queda existencia que valorar—, ni el precio, ni el impuesto, ni el documento
  fiscal, ni la devolución, que usa el snapshot del movimiento original.
- **Qué no es:** no es un error de punto flotante ni una pérdida de dinero real. Es una
  diferencia de imputación entre el costo comprado y el costo llevado a resultado.

## Opciones

### 1. El residuo lo absorbe la línea que agota — *recomendada*

Cuando una salida deja el saldo en cero, valorarla por el **valor restante** en lugar del
promedio redondeado multiplicado por la cantidad. Es la única situación en que hoy se pierde el
residuo, y la corrección es exacta por construcción: la suma de COGS del ciclo pasa a ser
idéntica a la compra, siempre.

- **Alcance:** una rama en `StockItem.appendMovement` y su prueba; sin migración, sin cambio de
  esquema, sin cambio de contratos ni de reportes.
- **Costo:** el `unit_cost` de esa línea puede diferir en menos de una unidad menor del promedio
  vigente. Es el precio de que el total cuadre, y es lo que hace cualquier costeo por promedio
  al cerrar una capa.
- **Riesgo:** bajo. No cambia el método —sigue siendo promedio ponderado móvil—, sólo cierra su
  último paso.

### 2. Costo interno con mayor precisión

Guardar `unit_cost` con escala adicional y redondear sólo al presentar.

- **Alcance:** migración de `stock_movements.unit_cost` y de las lecturas de costo y margen;
  revisión de todo uso de `Money` en valoración.
- **Reduce** el residuo pero **no lo elimina**: sigue habiendo una división con redondeo, sólo
  que a una escala más fina.
- Vale la pena si algún día se necesita precisión sub-céntimo por otra razón; no como remedio de
  esto.

### 3. Movimiento de ajuste por el residuo

Registrar el sobrante como un ajuste de inventario propio.

- Deja rastro contable explícito, que es lo que un perfil contable externo podría exigir.
- **Alcance:** tipo de movimiento nuevo, migración de la tabla por su `check`, y reglas de quién
  lo autoriza. Desproporcionado para céntimos, y ADR-0016 pide no inventar reglas contables.

### 4. FIFO por capas

Elimina el promedio y con él su redondeo. Ya está **diferido** en ADR-0016 como extensión con su
propio ADR; no es la respuesta a esta deuda.

## Recomendación

Adoptar la **opción 1** cuando exista un consumidor concreto que lo pida —un cierre contable, una
auditoría externa, un perfil fiscal—. Hasta entonces la deuda puede seguir declarada: está
acotada a céntimos por ciclo de agotamiento, no acumula en la valoración y ADR-0016 ya la
registra como riesgo aceptado de un default reemplazable.

Lo que **no** debe hacerse es cerrarla en silencio. La corrección cambia un valor persistido y
auditable —el costo congelado de una salida—, así que necesita un ADR que enmiende ADR-0016, sus
criterios de aceptación en 9B.04 y una prueba que fije la invariante «la suma de COGS de un ciclo
de agotamiento es igual a la compra valorada de ese ciclo». No pertenece a la Fase 11: 11.05
conserva evidencia del costo usado y no decide la fórmula contable.
