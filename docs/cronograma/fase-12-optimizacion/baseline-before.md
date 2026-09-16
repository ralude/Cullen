# Línea base BEFORE — Fase 12.01

Tres series sobre `17e1238`, el 2026-09-16, sin cambios pendientes, protocolo 3, en la estación
descrita por el [manifiesto](./performance-manifest.json). Los márgenes provienen del
[piloto del protocolo 3](./piloto-de-ruido-protocolo-3.md) recalculados sobre estas series. El
estado y la aceptación viven en [12.01](./12.01-profiler-baseline.md).

Ésta es la referencia contra la que 12.02, 12.03 y 12.05 comparan. **No es un presupuesto**: no
dice qué es aceptable para operar, sólo qué cuesta hoy. Los presupuestos son 12.01.06.

## Los valores

Mediana de las medianas de tres series, en milisegundos. El margen es lo que un cambio debe superar
dentro de una misma campaña para considerarse mejora o regresión en vez de fluctuación.

| Escenario | Mediana (ms) | Margen |
|---|---:|---:|
| `kardex-10k@crecimiento` | 2.663,254 | 5 % |
| `stock-rehydrate-10k@crecimiento` | 2.639,156 | 5 % |
| `node-first-install` | 611,418 | 5 % |
| `node-existing-start` | 503,479 | 5 % |
| `desktop-to-login@habitual` | 287,349 | 5 % |
| `desktop-to-login@crecimiento` | 287,134 | 9 % |
| `catalog-list@habitual` | 54,079 | 5 % |
| `catalog-list@crecimiento` | 52,503 | 10 % |
| `login-to-shell@habitual` | 46,998 | 17 % |
| `login-to-shell@crecimiento` | 46,962 | 18 % |
| `session-recovery@habitual` | 36,980 | 5 % |
| `session-recovery@crecimiento` | 35,842 | 19 % |
| `kardex-1k@crecimiento` | 31,696 | 5 % |
| `stock-rehydrate-1k@crecimiento` | 30,632 | 5 % |
| `sale-journey@crecimiento` | 18,171 | 5 % |
| `sale-journey@habitual` | 15,234 | 5 % |
| `stock-rows-10k@crecimiento` | 12,110 | 6 % |
| `lan-delivery` | 9,652 | 6 % |
| `node-hot-health` | 7,683 | 5 % |
| `report-inventory@crecimiento` | 7,683 | 7 % |
| `report-inventory@habitual` | 3,721 | 5 % |
| `cash-shift-open@habitual` | 1,727 | 8 % |
| `cash-shift-open@crecimiento` | 1,659 | 18 % |
| `lan-application` | 1,609 | 5 % |
| `kardex-100@crecimiento` | 1,534 | 5 % |
| `stock-rows-1k@crecimiento` | 1,160 | 5 % |
| `report-sales@crecimiento` | 1,034 | 5 % |
| `catalog-barcode@habitual` | 0,876 | 9 % |
| `stock-rehydrate-100@crecimiento` | 0,798 | 5 % |
| `catalog-barcode@crecimiento` | 0,790 | 8 % |
| `stock-rows-100@crecimiento` | 0,147 | 7 % |

`node-*` y `lan-*` no llevan sufijo de perfil: construyen su propio dataset y no dependen del
perfil comercial. Recursos, tráfico y tamaños de base acompañan cada serie en `.perf/`, ignorado.

## Cómo se compara un AFTER

**BEFORE y AFTER se miden en la misma campaña**, alternando entre el commit viejo y el nuevo sobre
la misma estación y en la misma sesión. No se compara un AFTER de mañana contra la tabla de arriba
para validar una mejora.

La razón es medida, no teórica. Las medianas del piloto y de este BEFORE, con **código idéntico**,
difieren mucho más que los márgenes que cada campaña calcula para sí misma:

| Escenario | Piloto | BEFORE | Diferencia | Margen |
|---|---:|---:|---:|---:|
| `desktop-to-login` | 332,5 | 287,3 | 13,6 % | 5 % |
| `stock-rehydrate-10k` | 2.957,0 | 2.639,2 | 10,8 % | 5 % |
| `kardex-10k` | 2.900,8 | 2.663,3 | 8,2 % | 5 % |
| `node-first-install` | 651,9 | 611,4 | 6,2 % | 5 % |
| `catalog-list` | 54,7 | 54,1 | 1,1 % | 5 % |

Tres series consecutivas comparten el estado de la máquina: miden la estabilidad de un momento, no
la de dos momentos distintos. Esta tabla queda como referencia histórica y como detector de
regresiones grandes, no como el número contra el que se valida una mejora del 5 %.

El piso de 5 % en los márgenes existe por la misma razón: `sale-journey` derivó 0,4 % entre las
tres series del piloto, y un margen del 1 % habría exigido que toda mejora superara el propio error
de medición.

## Incidencias observadas

La tercera serie del perfil habitual tuvo una **corrida de Electron degradada**: `desktop-to-login`
marcó 660,6 ms contra 288,0 y 289,0 de las otras dos, con `session-recovery` (46,99 ms) y
`login-to-shell` arrastrados. En la tanda de crecimiento, el mismo escenario fue estable en las tres
series. `stock-rows-100` marcó 0,243 ms contra 0,145 en la tercera serie de crecimiento.

Esos cuatro escenarios se volvieron a medir en tres series propias, y **son esas las que se
publican**: `desktop-to-login` 287,349 · 287,419 · 285,023 (deriva 0,8 %), `session-recovery`
36,980 · 37,036 · 36,544 (1,3 %), `stock-rows-100` 0,147 · 0,149 · 0,144 (3,4 %). La serie
degradada no se borra ni se descarta a posteriori de su propia serie: queda declarada aquí, porque
el escenario Electron tiene una modalidad de arranque lento que puede reaparecer.

Dos capturas anteriores del BEFORE **no se publicaron**. La primera salió con su tercera serie un
50 % más lenta —`catalog-list` de 55 a 85 ms— porque la estación tenía navegadores y aplicaciones
Chromium abiertas; se detectó comparando medianas a mano, y de ahí salió la guarda de aislamiento
que ahora aborta una serie que no puede medirse aislada. La segunda abortó por un falso positivo de
esa misma guarda, que leía la ocupación mientras los procesos de la tanda anterior aún se liberaban.

## Lo que la línea base deja ver

Tres observaciones para 12.01.07, que deberá atenderlas o descartarlas explícitamente:

- **Rehidratar 10.000 movimientos cuesta 2,64 s** contra 12,1 ms de leer sus filas crudas: el
  99,5 % no es SQLite, es el agregado reejecutando su historia. Es el riesgo que la auditoría de
  Fase 11 dejó sin benchmark; ver [perfil de crecimiento](./perfil-de-crecimiento.md).
- **La terminal descarga 1,08 MB por loopback** en cada arranque medido, el renderer compilado.
- **`catalog-list` cuesta 54 ms** con 200 productos: sesenta veces la búsqueda por barcode y más de
  tres veces la jornada de venta completa.

## Reproducirlo

```bash
pnpm --filter @supermarket/server perf -- --sample 30
pnpm --filter @supermarket/server perf -- --profile crecimiento --sample 10
```

La estación debe estar libre: el arnés aborta con `PERF_STATION_BUSY` si la ocupación supera el
15 % tras esperar a que se asiente.
