# Piloto de ruido del protocolo 1 — Fase 12.01

> **Superado.** Este informe describe el primer piloto y se conserva como historia. El vigente es
> el [piloto del protocolo 3](./piloto-de-ruido-protocolo-3.md), que demostró que el warm-up fijo
> de 5 usado aquí no medía el código ya optimizado: sus márgenes no se heredan.

Tres series sobre `163548c`, el 2026-09-11, en la estación descrita por el
[manifiesto](./performance-manifest.json). Este informe precede a cualquier serie BEFORE y a
cualquier optimización. El estado, la aceptación y los commits viven únicamente en
[12.01](./12.01-profiler-baseline.md).

Lo que el piloto tenía que responder no es «cuánto tarda» sino **cuánto se mueve solo**: sin esa
cifra, cualquier presupuesto posterior sería un porcentaje inventado.

## Lo medido

Cuatro escenarios instrumentados, warm-up 5 y muestra 30 por serie, cada uno sobre su propia base
recién migrada con 200 productos:

| Escenario | Mediana por serie (ms) | Deriva entre series | IQR dentro de serie |
|---|---|---:|---:|
| `node-cold-start` | 331,2 · 328,4 · 329,4 | 0,9 % | 3,4 – 4,7 % |
| `catalog-barcode` | 1,055 · 1,122 · 1,117 | 6,0 % | 30,7 – 41,0 % |
| `catalog-list` | 58,8 · 60,4 · 57,2 | 5,4 % | 9,7 – 12,1 % |
| `sale-journey` | 12,10 · 11,96 · 12,15 | 1,6 % | 22,3 – 35,4 % |

## La decisión que el piloto cambió

El manifiesto nació diciendo que el margen de ruido sería **el IQR relativo de cada escenario**.
El piloto demuestra que esa elección era mala: en los escenarios de pocos milisegundos el IQR
llega al 41 %, porque la dispersión de observaciones individuales está dominada por el recolector
de basura y el planificador, mientras la **mediana entre series apenas se mueve** —1,6 % en la
jornada de venta—. Un margen del 41 % habría exigido mejoras absurdas para reconocer cualquier
optimización real.

El protocolo queda así: **el estadístico comparable es la mediana de la serie, y el margen es el
doble de la deriva observada entre tres series.**

| Escenario | Margen de ruido |
|---|---:|
| `node-cold-start` | 2 % |
| `catalog-barcode` | 12 % |
| `catalog-list` | 11 % |
| `sale-journey` | 4 % |

Son **márgenes de ruido, no presupuestos**. Un presupuesto dice qué es aceptable para operar y
exige una expectativa de uso documentada; eso es 12.01.06 y no se decide aquí.

## Una observación que no es todavía una prioridad

`catalog-list` cuesta unos 59 ms con 200 productos: cincuenta veces la búsqueda por barcode y casi
cinco veces la jornada de venta completa. Es el candidato visible a hotspot, pero priorizar es
12.01.07 y exige el perfil de crecimiento que 12.01.02 no ha construido. Queda anotado como
hipótesis comprobable, no como compromiso.

## Lo que todavía no se mide, y qué haría falta

Tres de los seis escenarios obligatorios no están instrumentados. No se presentan como cubiertos:

- **Escenario 2 — ingreso y shell autorizado.** Exige montar el renderer y recuperar la sesión.
  Necesita el conductor de GUI que la revisión de la pantalla de venta construyó a mano; sin
  capturarlo como herramienta, cada medición lo redescubre.
- **Escenario 5 — kardex y reportes con historia.** Exige el perfil de datos con inventario en
  varios tamaños controlados, que es justamente 12.01.02.
- **Escenario 6 — ciclo LAN.** Exige dos nodos con material TLS emitido; se instrumenta
  reutilizando el arnés de las pruebas de sincronización.

Y dos límites del arnés, declarados para que nadie los lea como cobertura:

- Las peticiones entran por `app.inject`: se mide enrutado, validación, aplicación y SQLite, **no
  el socket**.
- El arranque frío mide el nodo, no Electron: migrar una base vacía, componer el runtime y dejar
  Fastify listo. La mitad de escritorio del escenario 1 sigue sin medir.

## Reproducirlo

```bash
pnpm --filter @supermarket/server perf
pnpm --filter @supermarket/server perf -- --scenario sale-journey --sample 10
```

Cada corrida escribe en `.perf/<serie>/` las observaciones individuales y el resumen. Ese
directorio está ignorado: a Git entran el manifiesto y este informe, no las trazas.
