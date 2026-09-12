# Perfil de crecimiento — Fase 12.01

Serie del 2026-09-11 sobre `227f270`, perfil `crecimiento`, warm-up 2 y muestra 10, en la estación
que describe el [manifiesto](./performance-manifest.json). El estado y la aceptación viven en
[12.01](./12.01-profiler-baseline.md); el protocolo y los márgenes de ruido, en el
[piloto](./piloto-de-ruido.md).

La [auditoría de Fase 11](../fase-11-seguridad/auditoria-puntos-clave-2026-09-04.md#9-crecimiento-de-la-historia-de-inventario)
dejó registrado un **riesgo sin benchmark**: el repositorio carga todos los movimientos y
`StockItem.restore` los reejecuta. Su criterio era «medir con volumen representativo y fijar un
umbral antes de introducir snapshots, índices o cambios de modelo». Este perfil lo mide.

## El riesgo, medido

| Profundidad | Filas crudas | Rehidratar el agregado | Kardex |
|---:|---:|---:|---:|
| 100 | 0,151 ms | 1,06 ms | 2,22 ms |
| 1.000 | 1,356 ms | 33,9 ms | 39,3 ms |
| 10.000 | 13,41 ms | **2.840 ms** | **2.803 ms** |

Leer la historia cruda **crece lineal**: ×10 de datos, ×10 de tiempo —0,151 → 1,356 → 13,41—.
Rehidratar el agregado **crece cuadrático**: ×32 y luego ×84 por cada ×10 de datos.

Con 10.000 movimientos, la consulta cuesta 13 ms y el reejecutado ~2.830: **el 99,5 % del tiempo
no es SQLite, es el agregado**. Eso reorienta el trabajo. La auditoría asignó el riesgo a «Fase 12»
sin más; la medición dice que no se arregla con un índice ni con pragmas —12.03—, sino decidiendo
qué hace `StockItem.restore` con una historia larga, que es una decisión de dominio.

Un kardex de 2,8 segundos es, además, una espera que un operador nota.

## Hallazgo aparte: un techo al guardar

Guardar **~9.000 movimientos nuevos en un solo `save`** desborda la pila:
`RangeError: Maximum call stack size exceeded` dentro de `mergeQueries` de Drizzle, que arma un
`INSERT` con una fila por movimiento y recurre por fila. Medido por bisección el 2026-09-11:
8.000 pasa, 9.000 desborda.

No es el mismo problema que el anterior y no se sabe todavía si algún camino de producto produce
un lote así —una recepción o un conteo muy grandes serían los candidatos—. Queda registrado con su
reproducción para que 12.03 decida; el arnés lo rodea guardando por tramos de 1.000, porque lo que
mide es la profundidad de la historia y no el tamaño del lote que la escribe.

## Lo habitual, para comparar

La misma serie sobre el perfil habitual, que no tiene historia profunda:

| Escenario | Mediana |
|---|---:|
| `node-cold-start` | 341,9 ms |
| `catalog-list` (200 productos) | 65,1 ms |
| `sale-journey` | 12,3 ms |
| `catalog-barcode` | 1,33 ms |

## Lo que sigue sin medir

De los seis escenarios obligatorios, dos siguen sin instrumentar: el **ingreso y shell** —exige
conductor de GUI— y el **ciclo LAN** —exige dos nodos con material TLS—. Del escenario 5 se mide
el kardex; los reportes de ventas e inventario con filtros y paginación no.

Ninguna de estas cifras es un presupuesto. Un presupuesto dice qué es aceptable para operar y
exige una expectativa de uso documentada: eso es 12.01.06, y con dos escenarios sin instrumentar
no se declara todavía.
