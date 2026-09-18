# Cronograma del Proyecto

Este directorio es la fuente única de verdad para el avance por fases. Cada fase tiene un README explicativo y un archivo independiente por sub-fase.

## Estado actual

| Fase | Nombre | Estado |
|---:|---|---|
| 0 | Arquitectura | ~~Completada~~ |
| 1 | Infraestructura | ~~Completada~~ |
| 2 | Codigo de negocio | ~~Completada~~ |
| 3 | Persistencia | ~~Completada~~ |
| 4 | Ledger, outbox y auditoria | ~~Completada~~ |
| 5 | Caja operativa | ~~Completada~~ |
| 6 | Inventario operativo | ~~Completada~~ |
| 7 | Driver fiscal fake | ~~Completada~~ |
| 8 | Integracion serial | Suspendida por dependencia externa |
| 9 | UI | ~~Completada~~ |
| 9B | Perfiles operativos | ~~Completada para el MVP técnico 2026-09-05~~; 9B.08 transferida a Fase 13 y 9B.09 trasladada a Fase 11 |
| 10 | Sincronizacion | ~~Completada~~ |
| 11 | ~~[Seguridad](./fase-11-seguridad/README.md)~~ | Entregada el 2026-09-08; la [auditoría de cierre del 2026-09-09](./fase-11-seguridad/auditoria-cierre-2026-09-09.md) corrigió sus trece hallazgos. El gate de tienda conserva sus requisitos propios, sin bloquear el release open source |
| 12 | [Optimización](./fase-12-optimizacion/README.md) | En ejecución. 12.01, 12.02 y 12.03 cerradas; 12.05 entregó sus cortes y su benchmark y espera su último punto. Dos puntos del gate siguen abiertos (ver abajo). 12.04 suspendida con Fase 8 |
| 12B | [Manual de usuario no técnico](./fase-12b-manual-usuario/README.md) | Planificada el 2026-09-09 después de `v0.1.0`; fase documental, no bloquea ni depende de Fase 12 |
| 13 | [Almacenes por sucursal](./fase-13-almacenes/README.md) | Planificada; post-MVP, sin iniciar |
| 14 | [Plataforma central PostgreSQL](./fase-14-plataforma-central/README.md) | Planificada; post-MVP, sin iniciar |
| 15 | [Sincronización SQLite–PostgreSQL](./fase-15-sincronizacion-cloud/README.md) | Planificada; post-MVP, sin iniciar |
| 16 | [Web App interna Next.js](./fase-16-web-app/README.md) | Planificada; post-MVP, sin iniciar |
| 16B | [Sistema de diseño propio](./fase-16b-sistema-diseno/README.md) | Planificada; post-MVP, sin iniciar |
| 17 | [Validación y despliegue gradual](./fase-17-validacion-despliegue/README.md) | Planificada; post-MVP, sin iniciar |

**Último hito:** el [release open source `v0.1.0`](./release-v0.1-portafolio/README.md) se
publicó el 2026-09-10 sobre `b23394d` —código fuente y demo reproducible en `SIMULACION`, sin
hardware fiscal y sin adjuntar el MSI sin firma— tras recorrer sus cinco etapas: alcance, CI
remoto, demo limpia, documentación y publicación.

[V0.1.00](./release-v0.1-portafolio/0-alcance-y-verdad.md) cerró el 2026-09-09.
[V0.1.01](./release-v0.1-portafolio/1-ci-reproducible.md) cerró el mismo día: el pipeline corre
en GitHub Actions sobre `windows-latest` y su primer run sobre `main` terminó verde.
[V0.1.02](./release-v0.1-portafolio/2-demo-en-entorno-limpio.md) cerró el 2026-09-10 con el
recorrido completo sobre un clon limpio; entre las dos sesiones corrigió siete pasos implícitos y
defectos que solo una estación limpia podía destapar, entre ellos el binario de Electron que
`pnpm install` dejó de traer.
[V0.1.03](./release-v0.1-portafolio/3-documentacion-portafolio.md) publicó las capturas en el
README, además de contribución, seguridad y notas de versión.
[V0.1.04](./release-v0.1-portafolio/4-publicacion.md) etiquetó `v0.1.0` y lo verificó clonando
desde el tag.

**Hito actual:** [Fase 12](./fase-12-optimizacion/README.md), habilitada por ese release, en su
[sub-fase 12.05](./fase-12-optimizacion/12.05-mantenibilidad-estructural.md), la última: 12.03
cerró el 2026-09-17 y 12.05 entregó sus cinco cortes y su benchmark.

**Lo que falta para cerrar la Fase 12** —y con ella habilitar la Fase 13— son dos puntos, y
ninguno lo puede cerrar quien hizo el trabajo:

| Punto | Dónde está declarado | Por qué sigue abierto |
|---|---|---|
| Un tercero reproduce la serie de 12.01 desde un checkout limpio | [CA-12.01-01](./fase-12-optimizacion/12.01-profiler-baseline.md) | Por definición: nadie distinto de quien la capturó la ha reproducido |
| Sesiones reales de navegación de los seis escenarios de 12.05 | [12.05.01](./fase-12-optimizacion/12.05-mantenibilidad-estructural.md) | Quien acaba de trabajar dentro de esos archivos mide memoria, no navegación en frío |

El resto del [gate de salida](./fase-12-optimizacion/README.md#gate-de-salida-en-modo-fiscal-simulado)
está cumplido: presupuestos, hotspots no tocados con decisión escrita, checks verdes el 2026-09-17
y la distinción entre el cierre simulado y 12.04 suspendida. 12.04 queda exceptuada mientras
conserve la suspensión de Fase 8.

## Historia y decisiones

Este archivo declara **en qué estado está** cada fase. Lo demás vive al lado:

- [Historial de cierre por fase](./historial.md) — el relato de cada fase completada, con las
  cifras vigentes el día que cerró. Se movió acá el 2026-09-18 sin editar un párrafo.
- [Adaptaciones aprobadas al plan](./adaptaciones-aprobadas.md) — qué módulo entra en qué fase,
  qué se divide y qué se difiere. Se lee antes de asignar trabajo a una fase.
- [Bitácora de avance](./bitacora.md) — registro fechado de lo que se cerró, se corrigió o se
  auditó. No gobierna nada: es memoria de cómo se llegó hasta acá.
- [Defectos conocidos](./defectos-conocidos.md) — lo que se encontró y no se corrigió.

El detalle de una fase vive en su propio README, y el de una sub-fase en su ficha. Este índice no
los repite.

## Fases

### MVP técnico

- [~~Fase 0 - Arquitectura~~](./fase-00-arquitectura/README.md)
- [~~Fase 1 - Infraestructura~~](./fase-01-infraestructura/README.md)
- [~~Fase 2 - Codigo de negocio~~](./fase-02-dominio/README.md)
- [~~Fase 3 - Persistencia~~](./fase-03-persistencia/README.md)
- [~~Fase 4 - Ledger, outbox y auditoria~~](./fase-04-event-store/README.md)
- [~~Fase 5 - Caja~~](./fase-05-caja/README.md)
- [~~Fase 6 - Inventario~~](./fase-06-inventario/README.md)
- [~~Fase 7 - Driver fiscal fake~~](./fase-07-driver-fiscal-fake/README.md)
- [Fase 8 - Integracion serial](./fase-08-integracion-serial/README.md) — suspendida por
  dependencia externa
- [~~Fase 9 - UI~~](./fase-09-ui/README.md)
- [~~Fase 9B - Perfiles operativos~~](./fase-09b-perfiles/README.md)
- [~~Fase 10 - Sincronizacion~~](./fase-10-sincronizacion/README.md)
- [~~Fase 11 - Seguridad~~](./fase-11-seguridad/README.md)
- [Fase 12 - Optimizacion](./fase-12-optimizacion/README.md) — **en ejecución**
- [Fase 12B - Manual de usuario no técnico](./fase-12b-manual-usuario/README.md) — documental,
  no bloquea ni depende de la Fase 12

### Post-MVP

Aprobadas y planificadas en la [evolución post-MVP](./evolucion-post-mvp.md); ninguna iniciada.
Ninguna comienza antes del gate de salida de la Fase 12.

- [Fase 13 - Almacenes por sucursal](./fase-13-almacenes/README.md)
- [Fase 14 - Plataforma central PostgreSQL](./fase-14-plataforma-central/README.md)
- [Fase 15 - Sincronización SQLite–PostgreSQL](./fase-15-sincronizacion-cloud/README.md)
- [Fase 16 - Web App interna Next.js](./fase-16-web-app/README.md)
- [Fase 16B - Sistema de diseño propio](./fase-16b-sistema-diseno/README.md)
- [Fase 17 - Validación y despliegue gradual](./fase-17-validacion-despliegue/README.md)

## Reglas de seguimiento

1. Toda tarea terminada se marca como `- [x] ~~tarea~~` en su archivo de sub-fase.
2. Cuando todas las tareas de una sub-fase terminan, se marca su estado como `Completada` y se tacha el enlace en el README de la fase.
3. Cuando todas las sub-fases terminan, se tacha la fase en este índice y se avanza la fase actual.
4. Cada cambio de código o configuración debe indicar la fase y sub-fase que modifica.
5. No se trabaja en una fase futura mientras la fase actual tenga tareas abiertas, salvo una decisión documentada.
6. Las tareas completadas se conservan tachadas; no se eliminan del historial del cronograma.
7. El relato de una fase cerrada se conserva en [el historial](./historial.md); este índice guarda
   su estado, no su narración.

## Documentos transversales

- [Release open source `v0.1.0`](./release-v0.1-portafolio/README.md) — cinco etapas secuenciales
  para alcance, CI, demo limpia, documentación y publicación del código fuente en GitHub. No
  exige hardware fiscal y no adjunta un MSI sin firma. Publicado el 2026-09-10.

- [Paquete de trabajo pre-piloto](./pre-piloto/README.md) — abierto el 2026-09-09 con
  [ADR-0030](../architecture/adr/0030-empaquetado-y-runtime-del-nodo.md). Entrega empaquetado del
  nodo como servicio de Windows, respaldo operativo y emisión de material TLS de LAN. No es una
  fase, no renumera nada y no cierra el gate de piloto. Sus tres planes están entregados; la firma
  de ejecutables y la validación del MSI en hardware de tienda siguen abiertas.

- [Evolución post-MVP: almacenes, nube y consulta web](./evolucion-post-mvp.md) — aprobada
  el 2026-09-06; secuencia 13 → 14 → 15 → 16 → 16B → 17 después del cierre técnico del MVP.
  Next.js, Tailwind y TanStack Query en 16; sistema propio basado en shadcn/ui en 16B;
  Zustand para estado UI cuando corresponda. Ponytail no aplica en 16 ni 16B.
  La planificación no cambia la fase activa ni declara implementación.

- [Rediseño de la pantalla de venta](./rediseno-pantalla-de-venta.md) — dirección aceptada el
  2026-09-10. Su requisito previo está entregado con la enmienda del 2026-09-11 a ADR-0031; el
  resto sigue pendiente y no toca el agregado `Sale`.

- [Replanificación de Fase 8 a Fase 9](./replanificacion-fase-08-a-09.md)
- [Replanificación: inserción de Fase 9B](./replanificacion-fase-09b.md)
- [Estrategia de testing](./testing.md)
- [CI/CD local y lo que el pipeline remoto no cubre](./ci-cd.md)
- [Hito de cierre arquitectonico](./hito-cierre-arquitectonico.md)
- [Gate de seguridad antes de UI operativa](./gate-seguridad-pre-ui.md)
- [Gate de piloto en tienda](./gate-piloto-release.md)
- [Alcance por nivel de entrega](../producto/alcance-entregas.md)
