# Plan de ejecución 10.04: operación offline y reconexión

- Fecha: 2026-09-06.
- Estado: **en progreso**. Cortes 1–3 implementados; corte 4 abierto en el escenario 11 y en
  los gates que dependen del cierre de 10.03.
- Decisiones: [secuencia y registro D1–D8](./plan-secuencia-y-decisiones.md).
- ADR: [ADR-0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md), aceptado.
- Alcance: LAN operativa del MVP de referencia no certificado; no sincronización cloud.

## Objetivo y prerrequisitos

Completar ventas localmente durante un corte de LAN y entregar después sus hechos con
recuperación y estado visible. No declarar sincronización completa cuando solo se consiguió
contactar al coordinador o vaciar la salida local.

Leer AGENTS.md; arquitectura 03, 06, 07, 08, 10–12; ADR-0007, 0008, 0011, 0016, 0017,
0022, 0023 y el ADR complementario aceptado en 10.03; FS-004–FS-008 y los contratos de UI.

Antes de implementar: 10.03 cerrada; D6 y D8 especificadas conforme ADR-0026; destinos, bootstrap y autoridad
provisionados; pruebas de recepción durable, discrepancias y referencias aprobadas. No usar
un receptor fake para declarar este gate cumplido.

## Corte 1: cliente y ciclo de vida

1. Prueba outside-in de una venta completa sin coordinador: mantiene negocio, caja local,
   snapshots, ledger y salida durable según los contratos aprobados. No introduce llamadas
   de red en el caso de uso ni mantiene transacciones abiertas durante envío.
2. Implementar `EventPublisher` como adaptador de transporte verificado. Un timeout,
   respuesta truncada, ACK mal formado, otro evento o receptor equivocado no confirma entrega.
   No seguir redirecciones que cambien el destino confiable ni degradar a HTTP inseguro.
3. Componer el relay en el proceso Fastify dueño de SQLite. Un solo ciclo activo por worker;
   evitar ejecuciones solapadas por timers. Lotes acotados y claims durables por destino
   conforme 10.03; las llamadas de red quedan fuera de `UnitOfWork`.
4. Arranque: cargar configuración y retomar progreso, sin resetear `PROCESSING`, generación,
   pausa o bloqueos. Cierre: detener nuevos claims y cancelar/esperar operaciones acotadas
   antes de cerrar DB; una terminación forzada se recupera por lease.
5. Verificar plazo de request/lease con el lote real: el lease puede vencer mientras se
   procesa otro evento del lote. Revalidar antes del envío y probar ACKs tardíos; no asumir
   que un timeout individual menor que el lease resuelve todo el lote.

## Corte 2: retry y recuperación operativa

Aplicar D8/ADR-0026 con reloj controlable: diez envíos por evento/destino y ciclo,
base de 1 s, tope de 60 s con jitter y pausa durable con reanudación manual autorizada.
Distinguir indisponibilidad de red,
fallo de persistencia, rechazo permanente, incompatibilidad y agotamiento. El backoff actual
1–60 s es la base técnica; el límite por ciclo y la reanudación están decididos, pero aún
no implementados por 10.01.

- Persistir siguiente intento y estado de pausa para que reiniciar no eluda el presupuesto.
- Mantener `attempts` monotónico como generación del claim. Un nuevo ciclo no vuelve a
  habilitar respuestas de generaciones anteriores.
- Pausar entrega ante desconexión conocida sin agotar en ráfaga todos los eventos. Las
  comprobaciones de conexión no confirman eventos ni convierten el nodo en `SYNCED`.
- Un evento `BLOCKED` no se reenvía automáticamente hasta corregir su causa. Reanudación
  mediante caso de uso autorizado, actor/terminal/UTC/motivo y auditoría; conserva payload,
  identidad e historia. No editar un v1 para hacerlo aceptable ni marcarlo `PUBLISHED`.
- Si cambió compatibilidad o autoridad, revalidar antes de reanudar. Una resolución ausente
  mantiene el bloqueo. No hay botón de «descartar y continuar» que pierda el hecho.
- Fallos por dependencia comercial se recuperan en el receptor; no obligan al emisor a
  repetir un evento del que el coordinador ya asumió custodia.

## Corte 3: estado y antigüedad visibles

Exponer lecturas de aplicación por la API local autenticada; React solo presenta datos
serializables. Aplicar permisos en backend para inspección y reanudación. Mantener los
secretos de transporte fuera de IPC y renderer.

Conservar los estados de arquitectura, con semántica observable:

- `OFFLINE`: destino configurado no alcanzable; conservar último éxito, pendientes y alertas.
- `CONNECTING`: intento de establecer una conexión confiable, sin promesa de entrega.
- `SYNCING`: existe transferencia/bootstrap o aplicación pendiente conocida.
- `SYNCED`: último ciclo verificado sin trabajo pendiente conocido, bootstrap completo y
  referencias requeridas vigentes. Mostrar su fecha; no promete que nunca llegarán nuevos hechos.
- `ATTENTION_REQUIRED`: incompatibilidad, identidad no resuelta, agotamiento, discrepancia o
  concesión vencida que exige intervención. Mostrar además conectividad, para que una caída
  no oculte una discrepancia. Sin destino configurado, mostrar esa condición explícita.

Definir en el contrato de lectura la evidencia de cada estado. Según ADR-0026, atención
prevalece sobre el rótulo general, mientras conectividad permanece como dato separado.
La custodia remota y la aplicación se consultan por separado: un ACK no demuestra aplicación.

Mostrar por catálogo, tasa y concesiones: fuente, versión, vigencia cuando aplique, último
snapshot completo recibido y antigüedad. No actualizar esos timestamps por un ping, un
reintento fallido o un ACK de otro tipo. `null` significa nunca recibido; una tasa vencida no
se habilita porque el nodo volvió a conectarse.

Para disponibilidad mostrar la antigüedad de la proyección y su carácter informativo. No
sumarla al saldo del coordinador ni prometer reserva global. Aplicar restricciones de D5/D6
en casos de uso; la UI explica la causa y conserva el trabajo recuperable cuando una
operación requiere conexión, referencia o autorización vigente.

Las concesiones expiran ocho horas después de su emisión por el coordinador; recibirlas
tarde no amplía esa ventana. Probar expiración también con sesión local aún válida y
retroceso del reloj, sin sustituir los límites de sesión de ADR-0011.

## Corte 4: pruebas de cortes y reinicios

Usar coordinador y dos POS con archivos SQLite e identidades independientes, cada archivo
abierto solo por su servidor. Fastify `inject` prueba contratos, pero no sustituye pruebas
con listeners reales y pérdida de conexión. Reloj/fallos controlados evitan esperas largas
y resultados dependientes del tiempo de pared.

Escenarios mínimos:

1. Cortar LAN antes de completar una venta; confirmar localmente, reiniciar POS y reconectar.
   Custodia y efectos correspondientes aparecen una vez sin cambiar snapshots comerciales.
2. Cortar después del commit remoto y antes del ACK; repetir el mismo ID tras reinicio de
   ambos extremos. Verificar deduplicación durable y ausencia de efectos duplicados.
3. Caída antes del commit remoto y fallo al guardar ACK local: distinguir ambos y recuperar
   leases/generaciones, sin confirmación ficticia ni pérdida de historia.
4. Detener al consumidor tras adquirir custodia y durante su aplicación: retomar trabajo sin
   duplicar efecto, manteniendo discrepancias y dependencias.
5. Mantener una terminal desconectada mientras otra recibe nuevas referencias; después
   reconectar la primera. Verificar progreso independiente y bootstrap/cambios ordenados.
6. Dos POS venden la última unidad offline. Conservar ambas ventas y resolver una sola
   discrepancia auditable conforme FS-005/D5, sin stock negativo ni reversión comercial automática.
7. Entregar devolución antes de su referencia, evento atrasado, contrato incompatible y un
   mismo ID alterado. Distinguir espera, revisión, cuarentena y rechazo sin retry ciego.
8. Revocar un nodo, presentar terminal ajena, vencer la concesión del operador y recibir su
   nueva versión/revocación al reconectar. Verificar backend y explicación visible.
9. Agotar retry, reiniciar y reanudar autorizadamente. Rechazar una reanudación sin permiso
   y un ACK tardío de un ciclo anterior. Otras entregas elegibles siguen avanzando.
10. Cortar solo Internet conservando LAN: la entrega a tienda sigue funcionando. Cortar LAN
    conservando Internet: la operación local sigue y la cola espera al coordinador.
11. Cortar entre cada paso de compra, aprobación de conteo y devolución coordinadas;
    conservar pendiente visible y recuperar la misma intención conforme FS-011. Cambiar
    el costo del coordinador entre venta offline y recepción no modifica su snapshot.

El escenario 11 usa los hechos normativos de ADR-0026 D3, no eventos locales elegidos por
conveniencia. En cada flujo debe probar: intención sin efecto, commit local antes de entrega,
commit remoto antes de ACK, reinicio de ambos nodos, reentrega del mismo `eventId`, consulta
de aplicación y discrepancia definitiva que deja `NEEDS_REVIEW`. Para devolución se añade la
frontera previa de consulta de la salida original: si falta, no hay reintegro, nota ni
restitución; después del commit local, sync nunca vuelve a imprimir.

No simular pérdida de red borrando eventos ni deshabilitando la validación del transporte.
Hardware fiscal continúa fake y toda representación fiscal mantiene `SIMULACION`.

## Criterios de aceptación

- [ ] CA-04-01: 10.03 y D6/D8 están cerradas antes de iniciar implementación. D6/D8 están
  cerradas; 10.03 sigue abierta en CA-03-10.
- [x] ~~CA-04-02~~: venta offline completa con persistencia local; la ruta no espera al destino.
- [x] ~~CA-04-03~~: worker único, lotes acotados, arranque/cierre y recuperación de claims probados;
  no hay llamadas de red en transacciones SQLite.
- [x] ~~CA-04-04~~: únicamente un ACK contractual del destino correcto confirma entrega; pérdida,
  ambigüedad y callbacks obsoletos conservan entrega al menos una vez sin duplicar efectos.
- [x] ~~CA-04-05~~: backoff, límite por ciclo, pausa y generación sobreviven al reinicio;
  reanudación mantiene identidad, conserva evidencia y exige permiso/motivo.
- [x] ~~CA-04-06~~: los cinco estados reflejan evidencia durable; conectividad y atención pueden
  verse simultáneamente; una salida vacía no es suficiente para declarar `SYNCED`.
- [x] ~~CA-04-07~~: antigüedad/versión/vigencia reales de catálogo, tasa, concesiones e inventario;
  dato ausente o vencido no se presenta como vigente.
- [x] ~~CA-04-08~~: concesiones vencidas/revocadas y restricciones LAN de D5 se aplican en backend;
  sesiones conservan ADR-0011 y no se comparten credenciales por eventos.
- [ ] CA-04-09: los once escenarios se prueban con SQLite independiente, transporte real donde
  corresponda y fallos reproducibles; Internet y LAN se distinguen. La consulta de progreso
  real está probada, pero no los pasos remotos concretos del escenario 11.
- [x] ~~CA-04-10~~: referencias llegan a dos terminales sin confundir ACKs; no se duplica inventario
  del coordinador al sumar proyecciones POS ni se omiten efectos locales de caja.
- [ ] CA-04-11: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `pnpm lint`
  y `git diff --check` aprobados; interacción UI automatizada donde exista infraestructura y
  verificación manual documentada donde no la haya, sin afirmar cobertura DOM inexistente.
- [ ] CA-04-12: escenarios de fallo e índices actualizados con evidencia; 10.03/10.04 se
  tachan solo al cumplir el alcance, y Fase 11 permanece pendiente hasta ese cierre.

## Superficies y límites

Cliente de transporte en drivers; worker y ciclo de vida en composición de `apps/server`;
retry/reanudación/lecturas en aplicación; persistencia en driver DB; contratos en shared;
estado visible en `apps/desktop`. Reutilizar exports públicos, permisos, reloj y auditoría.

No migrar tiendas existentes, cambiar coordinador automáticamente, habilitar nube o hardware
real, añadir reservas de stock no aprobadas, administrar roles de 11.02 ni optimizar capacidad
de Fase 12. El resultado habilita el siguiente trabajo del cronograma, no un piloto certificado.

## Estado de implementación, 2026-09-06

Implementado y probado:

- **Corte 1.** `HttpsSyncEventPublisher` entrega sobre HTTPS con autenticación mutua y
  TLS 1.3, sin seguir redirecciones ni degradar a HTTP inseguro, y devuelve el cuerpo crudo
  para que el relay decida: un timeout, una respuesta no contractual o un
  `application/problem+json` nunca confirman entrega. `SyncWorker` compone un ciclo por
  destino en el proceso dueño de SQLite, mantiene un solo ciclo activo, revalida el lease
  antes de cada envío y espera el ciclo en curso al cerrar; una terminación forzada se
  recupera por lease sin resetear estado.
- **Corte 2.** Diez envíos por evento y destino dentro de un ciclo, backoff de 1 s con tope de
  60 s y jitter acotado, pausa durable al agotarse y reanudación manual autorizada con
  permiso, motivo y auditoría. `attempts` conserva su generación monotónica y `cycle_attempts`
  lleva el presupuesto por separado; reiniciar no abre otro ciclo ni resetea intentos. Un
  `BLOCKED` contractual no se reintenta por esta vía.
- **Corte 3, lectura.** `GetSyncStatus` deriva los cinco estados de evidencia durable, informa
  la conectividad observada aparte y separa pendientes de entrega, pendientes de aplicación,
  pausas, bloqueos y discrepancias abiertas. `ATTENTION_REQUIRED` prevalece sobre el rótulo
  general y una salida vacía no basta para declarar `SYNCED`.
- **Corte 4, parcial.** Seis escenarios automatizados con coordinador y dos terminales, tres
  archivos SQLite independientes y transporte real: corte antes de entregar y reconexión;
  ACK perdido tras el commit remoto; ACK de una terminal que no confirma a la otra ni la
  bloquea; dos ventas de la última unidad con discrepancia única y sin stock negativo;
  agotamiento, reinicio y reanudación autorizada; agregado creado sin conexión rechazado
  hasta su alta delegada.

## Continuación del 2026-09-07

Avances implementados y probados:

- **Antigüedad de referencias.** `GetSyncStatus` informa fuente, versión, vigencia y antigüedad
  de catálogo, tasa, concesiones y disponibilidad. `null` significa **nunca recibida**, no
  vacía, y una vigencia terminada se informa como vencida: reconectarse no la habilita. Una
  concesión vencida eleva el estado general a `ATTENTION_REQUIRED`.
- **Concesiones offline.** El coordinador emite `OperatorGrantPublished.v1` con ocho horas de
  vigencia y las reemite en cada ciclo cuando queda menos de la mitad de la ventana. En la
  terminal, una concesión vencida o revocada deniega la sesión nueva —aunque el PIN sea
  correcto—, invalida la sesión viva y deniega las acciones protegidas, **además** de los
  límites idle y absoluto de ADR-0011. La vigencia se evalúa contra el instante durable más
  alto que el nodo observó, de modo que atrasar el reloj del equipo no la amplía.
- **Restricciones LAN de D5.** Completar una compra, aprobar un conteo y procesar una
  devolución exigen enlace con el coordinador antes del primer efecto y fallan sin tocar nada;
  un nodo standalone conserva su atomicidad local. Compra y conteo ya aplican el efecto remoto;
  devolución sigue abierta.
- **Presentación.** `apps/desktop` muestra los cinco estados con su significado, la
  conectividad como dato separado, las pendientes de entrega, aplicación, pausa, bloqueo y
  discrepancia, la antigüedad de cada referencia y las operaciones distribuidas pendientes de
  conciliación con el estado de cada paso.
- **Escenarios añadidos.** Se automatizaron el corte de Internet distinguido del corte de LAN,
  la detención del consumidor a mitad de aplicación, la llegada de una devolución antes de su
  venta y la conciliación genérica por transporte real contra
  `GET /sync/v1/applications/:eventId`. Compra y conteo prueban la aplicación positiva por
  transporte real; los cortes entre sus fronteras y el flujo remoto de devolución siguen pendientes.

Sigue **abierto** en esta sub-fase y no debe presentarse como disponible:

- El escenario 11 completo: devolución remota y cortes/reinicios entre cada paso real de compra,
  conteo y devolución.
- La **compensación explícita** de un rechazo definitivo con efectos previos ya comprometidos:
  la operación queda `NEEDS_REVIEW` con la evidencia de cada paso y se resuelve con los casos
  de uso existentes, no con un paso automático.
- Las **acciones** de reanudación de entregas y de resolución de discrepancias siguen
  disponibles solo por la API local autenticada; la interfaz las **muestra** pero no las
  ejecuta.
- La cobertura de UI es de **render estático**: no hay infraestructura de interacción DOM en
  este repositorio y no se afirma una cobertura que no existe.

### Verificación de la auditoría del 2026-09-07

Las 44 pruebas directamente relacionadas pasan; `pnpm typecheck` (diez paquetes), `pnpm lint`
y `git diff --check` pasan. La suite completa ejecutó 864 pruebas en 144 archivos: 863 pasaron
y una regla ESLint agotó su timeout bajo carga; sus 6 pruebas pasan al ejecutar el archivo
aislado. Los escenarios LAN existentes usan tres SQLite independientes, listeners reales y
autenticación mutua.
