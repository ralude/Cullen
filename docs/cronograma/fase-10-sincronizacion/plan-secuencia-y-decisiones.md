# Fase 10: secuencia restante y decisiones de activación

- Fecha: 2026-09-06.
- Estado: **planificación completada; ejecución parcial**.
- Implementación: 10.03 → 10.04 ya ejecuta los pasos remotos autoritativos de compra y conteo;
  falta devolución y cerrar la conciliación con cortes entre fronteras.
- Autoridad: [AGENTS.md](../../../AGENTS.md), arquitectura y ADRs aceptados.
- Decisión normativa: [ADR-0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md).

## Línea base comprobada

10.01 entrega el outbox con orden por agregado, generación de claim y recuperación local.
10.02 entrega once contratos, validación, clasificación de ACK y aislamiento `BLOCKED`.
`ReceiveSyncEvent` usa `SyncReceptionStore` y `AggregateAuthorityRegistry`, pero solo tiene
pruebas con receptor fake. `apps/server/src/runtime.ts` no compone el relay, el receptor ni
los consumidores de `SaleCompleted` para caja/inventario.

La recepción actual consulta el duplicado antes de comprobar ownership; la consulta de
autoridad queda fuera del manejo de indisponibilidad. La secuencia lectura/consulta/registro
no demuestra atomicidad concurrente. El catálogo declara `payloadTerminalField`, pero falta
registro confiable nodo/terminal. 10.03 debe cerrar esas fronteras al introducir red.

`ApplySaleCompletedToInventory` ya conserva movimientos idempotentes por evento/línea,
FEFO y stock no negativo, pero no discrepancias remotas. `ReturnSale` coordina efectos
atómicos locales; no puede ejecutarse en el coordinador para mutar el turno de un POS.

Los contratos existentes no bastan para reconstruir catálogo operativo ni restituir
inventario desde `SaleReturned.v1`. Faltan productores de integración de tasas, maestros,
inventario e identidad. Un `PUBLISHED` histórico no acredita entrega LAN.

## Secuencia aprobada de trabajo

1. **10.03, corte 0 — especificaciones de detalle.** Partir de ADR-0026 y cerrar DTOs,
   matriz productor/consumidor, transiciones de operaciones distribuidas, permisos y pruebas
   de aceptación. No quedan preguntas de negocio conocidas pendientes; una regla nueva que
   aparezca se consulta antes de implementarla.
2. **10.03, corte 1 — receptor durable.** Prueba outside-in, transacción de recepción,
   autoridad persistida, deduplicación, cuarentena y recuperación en SQLite real.
3. **10.03, corte 2 — transporte autenticado.** Endpoint técnico aislado, alta manual
   de nodos, alta delegada de agregados, límites y ACK posterior al commit.
4. **10.03, corte 3 — procesamiento y discrepancias.** Consumo recuperable y coordinación
   LAN de compras/conteos/devoluciones; costo congelado al vender, sin duplicar efectos.
5. **10.03, corte 4 — referencias y entrega por terminal.** Productores/contratos suficientes,
   bootstrap consistente, consumidores y progreso independiente por destino.
6. **Gate 10.03.** Suite completa, migraciones verificadas, CA-03 cumplidos y escenarios
   actualizados. Cerrar la sub-fase antes de empezar 10.04.
7. **10.04, cortes 1–4.** Worker y ciclo de vida; retry/reanudación; estados y antigüedad;
   pruebas con coordinador, dos terminales, cortes de LAN/Internet y reinicios.
8. **Gate Fase 10.** Cumplir CA-04 y todas las tareas del alcance LAN operativo, actualizar
   ambos índices y habilitar Fase 11. Una cola enviada no basta para el cierre.

Son cortes internos, no nuevas sub-fases. No se renumera ni se declara implementado trabajo
futuro. No se asignan duraciones sin descomponer los contratos del corte 0.
PostgreSQL, nube, varios almacenes, transferencias, web y hardware real conservan su fase.

## Registro de respuestas del 2026-09-06

Las respuestas se registran aquí como evidencia de planificación; su semántica normativa y
decisiones técnicas están en ADR-0026. No se deben mantener dos especificaciones independientes.

- **D1 — alcance:** LAN operativa completa. Incluye referencias, productores/consumidores,
  bootstrap y entrega a varias terminales dentro de 10.03–10.04.
- **D2 — primera activación:** nodos nuevos de prueba. La incorporación de tiendas con
  historia requiere gate propio; no resetear publicaciones ni fabricar eventos legacy.
- **D3 — confianza:** alta manual controlada, auditable y transporte autenticado/cifrado.
  ADR-0026 concreta certificados mutuos, registro confiable y API de operadores en loopback.
- **D4 — nuevos agregados:** alta automática limitada y auditable de agregados propios de
  terminales previamente autorizadas, anterior a la entrega comercial y sin reasignar dueños.
- **D5 — operaciones de stock:** conexión requerida para completar compras, aprobar conteos
  y procesar devoluciones; ventas offline. Si hay efectos iniciados y se corta la red,
  operación pendiente visible con recuperación sin duplicación.
- **D5, costo:** snapshot conocido al vender, con versión y ausencia de costo explícita;
  no sustituirlo por el promedio del coordinador cuando llega tarde el evento.
- **D6 — concesiones:** ocho horas desde emisión del coordinador; sesiones mantienen aparte
  30 minutos idle y ocho horas absolutas. No renovar permisos antiguos por recepción tardía.
- **D7 — distribución/aplicación:** decisión técnica derivada del alcance y ADR-0022:
  estado por evento/destino, payload único, bootstrap con corte y resultado v1 de custodia
  inmutable; progreso comercial consultado por separado.
- **D8 — agotamiento:** diez intentos por ciclo, backoff hasta 60 segundos y pausa durable;
  reanudación manual autorizada. Conservar la generación monotónica del claim.

## Gates de ejecución que permanecen

Estos puntos son trabajo planificado, no solicitudes de respuesta pendientes:

- **Antes de endpoints LAN:** provisión/rotación/revocación y registro de autoridad durables,
  autenticación probada, cohorte explícita y configuración que falle cerrado.
- **Antes de efectos comerciales LAN:** especificaciones por operación con orden de pasos,
  fingerprints, permisos, estados, compensaciones admisibles y fallos entre cada paso.
- **Antes de habilitar terminales:** bootstrap completo, contratos suficientes, referencias y
  concesiones utilizables; no presentar un conjunto parcial como listo para operar.
- **Antes del worker:** 10.03 cerrada, persistencia por destino y recuperación probadas.
- **Antes del piloto:** validación profesional/fiscal y política offline confirmada según
  los gates vigentes. Las ocho horas son la decisión del MVP de prueba, no certificación.
- **Antes de incorporar bases con historia:** plan específico de migración/conciliación,
  respaldo/restauración y disposición de eventos antiguos; no está incluido en esta activación.

## Cierre documental y validaciones

- [x] ~~Resolver D1–D3 con el usuario.~~
- [x] ~~Resolver D4–D6, coordinación interrumpida, costo y D8 con preguntas concretas.~~
- [x] ~~Registrar ADR-0026 y enlazar las decisiones normativas y escenarios afectados.~~
- [x] ~~Planificar 10.03 y 10.04 con cortes secuenciales y criterios verificables.~~
- [ ] Ejecutar la secuencia completa y cerrar los gates CA-03 y CA-04. CA-03-10 y el escenario
  11 de CA-04-09 siguen abiertos.

Verificación del árbol de trabajo el 2026-09-06: `pnpm install --frozen-lockfile` aprobado;
`pnpm test`: 667 pruebas en 124 archivos; `pnpm typecheck`: diez paquetes; `pnpm lint`
y `git diff --check` aprobados. Tests y typecheck se repitieron fuera del sandbox tras
fallos de acceso; allí pasaron. Esta entrega modifica documentación, no código de aplicación.
La suite valida la línea base, no las nuevas garantías LAN todavía sin implementar.

Planes detallados: [10.03](./plan-10.03-servidor-receptor.md) y
[10.04](./plan-10.04-offline-reconexion.md).

## Estado de la secuencia, 2026-09-07

El conjunto completo de referencias, los tres consumidores, el snapshot de costo, las
concesiones aplicadas en backend y la presentación en `apps/desktop` están implementados. La
coordinación conserva intención, estado por paso y consulta de progreso, y ya ejecuta compra
y conteo autoritativos. Devolución y los cortes de conciliación siguen abiertos; por eso los
gates 10.03 y Fase 10 permanecen abiertos.

De los gates de ejecución que permanecían:

- **Antes de endpoints LAN** y **antes de habilitar terminales** quedaron cumplidos y probados.
- **Antes de efectos comerciales LAN** sigue abierto para devolución y para los cortes entre
  cada frontera; compra y conteo ya respetan el orden aprobado sin segunda autoridad en el POS.
- **Antes del worker** no se respetó como gate secuencial: el worker está compuesto aunque
  10.03 continúa abierta. Debe revalidarse después de cerrar CA-03-10; su existencia actual no
  habilita Fase 11.
- **Antes del piloto** sigue abierto por definición: la validación profesional y fiscal no es
  trabajo de esta fase, y las ocho horas siguen siendo la decisión del MVP de prueba.
- **Antes de incorporar bases con historia** sigue abierto y conserva su plan específico de
  migración, conciliación y respaldo.

Una regla nueva apareció durante la implementación y quedó registrada en ADR-0026 antes de
cerrar esa unidad: un movimiento de caja no depende de su venta, porque pertenece al turno
del que la venta ya depende, y declararlo creaba un ciclo de espera.

Verificación de la auditoría del 2026-09-07: las 44 pruebas directamente relacionadas,
`pnpm typecheck` (diez paquetes), `pnpm lint` y `git diff --check` pasan. La suite completa
ejecutó 864 pruebas en 144 archivos: 863 pasaron y una regla ESLint agotó su timeout bajo
carga; al repetir el archivo aislado pasaron sus 6 pruebas. Falta una ejecución completa verde.
