# Piloto de ruido del protocolo 3 — Fase 12.01

Tres series sobre `52cf353`, el 2026-09-16, sin cambios pendientes, en la estación descrita por el
[manifiesto](./performance-manifest.json). Este informe **reemplaza** al
[piloto del protocolo 1](./piloto-de-ruido.md), que se conserva como historia. El estado y la
aceptación viven en [12.01](./12.01-profiler-baseline.md).

Lo que el piloto tenía que responder sigue siendo **cuánto se mueve solo** cada escenario. La
respuesta llegó con un hallazgo que cambió el protocolo antes de poder darla.

## El protocolo 2 no medía el código que el nodo ejecuta

Las dos primeras corridas de este piloto dieron derivas imposibles de usar. Con el warm-up fijo de
5 que fijaba el protocolo 2:

| Escenario | Deriva entre series | Mediana |
|---|---:|---|
| `lan-delivery` | 188,2 % | bimodal, 10 ms o 27–30 ms |
| `catalog-barcode` | 71,6 % | 1,0 – 1,7 ms |
| `cash-shift-open` | 50,3 % | 2,1 – 3,2 ms |
| `lan-application` | 49,8 % | 1,6 – 2,6 ms |

La primera hipótesis —interferencia externa, porque la corrida inicial compartió la estación con
otros comandos— **se refutó**: repetido con la máquina en silencio total, `catalog-barcode` derivó
71,6 % en lugar de 28,6 %, y `lan-delivery` 188,2 % en lugar de 61,0 %. El aislamiento no era el
problema.

El indicio que lo resolvió estaba en los datos: `catalog-barcode` medía 0,82 ms con 0,4 % de deriva
en el perfil **crecimiento** y 1,0–1,7 ms con 71,6 % en **habitual**, siendo el mismo código sobre
un catálogo casi idéntico. La diferencia es que el perfil de crecimiento siembra durante unos 14
segundos antes de medir. Ese sembrado calentaba V8 por accidente; el perfil habitual, que siembra
en un segundo, entraba a la muestra con el código todavía sin optimizar.

Verificado subiendo el warm-up:

| Escenario | Warm-up 5 | Calentado | Mediana caliente |
|---|---:|---:|---|
| `catalog-barcode` | 71,6 % | **3,3 %** | 0,888 ms |
| `lan-delivery` | 188,2 % | **6,7 %** | 10,8 ms |
| `lan-application` | 49,8 % | **9,2 %** | 1,9 ms |
| `cash-shift-open` | 50,3 % | 14,6 % | 1,85 ms |

El warm-up insuficiente no sólo dispersaba: **sesgaba las medianas al alza**. Un BEFORE tomado así
habría fijado presupuestos contra un nodo más lento que el real, y cualquier optimización posterior
habría competido contra una cifra inventada.

## El warm-up que el protocolo 3 fija

Un warm-up fijo alto no resuelve nada: 200 repeticiones cuestan 0,18 s en `catalog-barcode` y unos
diez minutos en `kardex-10k`. Cada escenario calienta hasta agotar **lo primero de dos topes** —200
repeticiones o 1.000 ms acumulados del camino medido—, con un piso de 5. Las repeticiones
consumidas se publican con cada serie, así que el protocolo sigue siendo reproducible aunque el
número no sea el mismo en todos.

Lo que eligió por sí solo, idéntico en las tres series salvo donde se indica:

| Escenario | Warm-up |
|---|---:|
| `catalog-barcode`, `cash-shift-open`, `report-sales`, `stock-rows-100/1k`, `stock-rehydrate-100`, `kardex-100` | 200 |
| `report-inventory` (crecimiento) | 132–136 |
| `lan-cycle` | 56–84 |
| `stock-rows-10k` | 76–78 |
| `sale-journey` | 48–51 |
| `stock-rehydrate-1k`, `kardex-1k` | 26–31 |
| `catalog-list` | 17–18 |
| `node-startup`, `login-and-shell`, `stock-rehydrate-10k`, `kardex-10k` | 5 (piso) |

Los escenarios caros se quedan en el piso, que es lo que ya hacían; los de microsegundos agotan el
tope de repeticiones. Ninguno alarga la serie más de lo que su propio costo justifica.

## Los márgenes

Toda la deriva cae ahora bajo 12,3 %, contra un rango de 0,3 % a 188 % en el protocolo 2. El
estadístico comparable sigue siendo la **mediana de la serie**, y el margen es el **doble de la
deriva entre tres series**. Los 31 márgenes viven en el
[manifiesto](./performance-manifest.json); los extremos:

| Escenario | Medianas por serie (ms) | Deriva | Margen |
|---|---|---:|---:|
| `sale-journey` | 15,727 · 15,663 · 15,713 | 0,4 % | 1 % |
| `kardex-1k` | 32,764 · 32,553 · 32,558 | 0,7 % | 2 % |
| `kardex-100` | 1,540 · 1,544 · 1,533 | 0,7 % | 2 % |
| `report-sales` | 1,061 · 1,068 · 1,073 | 1,1 % | 3 % |
| `node-hot-health` | 7,960 · 7,809 · 7,859 | 1,9 % | 4 % |
| `lan-delivery` | 9,866 · 9,610 · 9,734 | 2,6 % | 6 % |
| … | | | |
| `catalog-list` (crecimiento) | 56,376 · 55,201 · 60,004 | 8,5 % | 18 % |
| `stock-rehydrate-10k` | 2730,6 · 2975,7 · 2766,3 | 8,9 % | 18 % |
| `login-to-shell` (crecimiento) | 50,861 · 46,937 · 52,020 | 10,0 % | 20 % |
| `session-recovery` (crecimiento) | 41,167 · 38,742 · 36,386 | 12,3 % | 25 % |

Son **márgenes de ruido, no presupuestos**. Un presupuesto dice qué es aceptable para operar; eso
es 12.01.06, y su expectativa de uso ya está decidida: la estación de desarrollo, que compara
commits y no certifica tienda.

## Lo que la línea base ya deja ver

Tres observaciones que 12.01.07 deberá atender o descartar explícitamente, ninguna declarada aquí
como compromiso:

- **Rehidratar 10.000 movimientos cuesta 2,73–2,98 s**, contra 12,4 ms de leer sus filas crudas. El
  99,6 % no es SQLite: es el agregado reejecutando su historia. Confirmado con deriva del 8,9 % y
  un IQR interno de 1,6–2,8 %, así que el número es sólido. Es el riesgo que la auditoría de Fase
  11 dejó sin benchmark, y no se corrige con un índice —ver [perfil de crecimiento](./perfil-de-crecimiento.md).
- **La terminal descarga 1,08 MB por loopback** en cada arranque medido: el renderer compilado.
- **`catalog-list` cuesta 54–60 ms** con 200 productos, unas sesenta veces la búsqueda por barcode
  y más de tres veces la jornada de venta completa.

## Reproducirlo

```bash
pnpm --filter @supermarket/server perf -- --sample 30
pnpm --filter @supermarket/server perf -- --profile crecimiento --sample 10
```

Omitir `--warmup` selecciona el warm-up proporcional del protocolo 3. Cada corrida escribe en
`.perf/<serie>/` las observaciones individuales, el resumen y los recursos; ese directorio está
ignorado. A Git entran el manifiesto y este informe, no las trazas.
