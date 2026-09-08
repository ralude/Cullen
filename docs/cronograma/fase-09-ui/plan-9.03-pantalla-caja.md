# Plan de ejecución 9.03: Pantalla de caja

- **Sub-fase:** [9.03 Pantalla de caja](./9.03-pantalla-caja.md)
- **Estado del plan:** Ejecutado; configuración visible y recuperación implementadas
- **Prerrequisito:** [9.02 Pantalla de venta](./9.02-pantalla-venta.md)
- **Disciplina visual:** Ponytail `full`, limitada a presentación

## Resultado esperado

La pantalla recupera el turno de la caja asignada, permite abrirlo, registra
ingresos o retiros con motivo y ejecuta el cierre con balances declarados. Los
saldos esperados y las diferencias definitivas proceden del servidor.

## Línea base comprobada

- La API publica apertura, consulta de turno abierto por `cashRegisterId`,
  movimiento y cierre; las mutaciones son idempotentes.
- `ShiftResponse` ya incluye movimientos, saldos esperados y balances de cierre
  con diferencias enteras por método y moneda.
- Los casos de uso autorizan apertura, ingreso, retiro, cierre y cierre con
  diferencia antes de persistir o auditar.
- La sesión no expone permisos al renderer y no debe hacerlo para convertir la
  UI en frontera de autorización.
- No existe una fuente HTTP confiable para la caja asignada ni una query de
  métodos de pago habilitados.

## Decisiones de frontera

- Resolver la caja desde configuración confiable del servidor y exponer solo
  su identidad operativa necesaria mediante un contrato compartido de estación.
  No aceptar `terminalId` u `originNodeId` enviados por React.
- Consultar el turno al entrar a la pantalla y después de cada mutación. Un
  `SHIFT_NOT_FOUND` representa el estado cerrado disponible para apertura, no
  un fallo genérico.
- Abrir con un lote de fondos iniciales. Registrar cada ingreso o retiro como
  una intención separada con motivo obligatorio y clave persistida durante
  resultado incierto.
- Mostrar saldos esperados desde `ShiftResponse`. Para el arqueo, capturar
  balances declarados y enviar el lote completo; las diferencias oficiales se
  muestran solo desde la respuesta de `CloseShift`.
- No ocultar la autorización en React: un control puede expresar la intención,
  pero el servidor decide y `FORBIDDEN` se presenta de forma traducible.
- No agregar una abstracción genérica de formularios ni una tabla reutilizable
  antes de que otra pantalla demuestre la misma necesidad.

## Decisiones aplicadas antes de implementar

Hasta que exista un endpoint de provisión de estación, la pantalla exige de
forma visible la caja y el código de método configurados por el operador
responsable; no usa valores internos silenciosos. La diferencia de cierre se
muestra exactamente como la devuelve la API, porque el contrato vigente no
recibe un motivo adicional.

1. Aprobar cómo se configura y provisiona el `cashRegisterId` de cada estación.
2. Publicar una lectura autenticada de métodos de pago activos con código,
   nombre, tipo y moneda; escribir códigos internos a mano no cumple el flujo.
3. Definir si el cierre exige un motivo cuando existe diferencia. El contrato
   actual no lo recibe, aunque las reglas generales exigen motivo en operaciones
   sensibles; no se añadirá silenciosamente desde la UI.

## Resultado de ejecución

La pantalla implementa apertura, recuperación del turno, ingresos, retiros,
arqueo y cierre con enteros, motivos e idempotencia. El recorrido de renderer
se verifica junto con el flujo de 9.02 mediante Vitest.

## Secuencia outside-in

1. Cerrar configuración de estación, métodos de pago y motivo de diferencia.
2. Crear primero los contratos y queries de lectura que falten, con pruebas de
   sesión, ownership y respuesta real sobre SQLite temporal.
3. Reutilizar la infraestructura de interacción del renderer aprobada en 9.02;
   no configurar un runner por pantalla.
4. Probar el cliente HTTP y el recorrido de pantalla: sin turno, abierto, con
   movimientos, arqueo y cerrado.
5. Implementar formularios nativos y tablas de lectura compactas.
6. Probar `FORBIDDEN`, retiro sin fondos, conflicto idempotente, error de red y
   cierre con diferencia autorizado/no autorizado.
7. Ejecutar pipeline y build; actualizar cronograma y avanzar a 9.04 solo al
   quedar verde.

## Criterios de aceptación

Verificados en la pantalla y en la suite completa: apertura, recuperación,
ingresos, retiros, arqueo, cierre, balances oficiales y manejo traducible de
errores. La configuración de caja y método queda visible y fail-closed hasta
que exista provisión remota de estación.

- [ ] La pantalla identifica la caja desde configuración confiable y recupera
  su turno abierto sin pedir IDs técnicos al operador.
- [ ] Los fondos iniciales, ingresos y retiros viajan como enteros con moneda.
- [ ] Ingreso y retiro exigen un motivo no vacío y no reutilizan una clave de
  idempotencia para intenciones distintas.
- [ ] Los saldos esperados se muestran sin recalcular reglas de caja en React.
- [ ] Las diferencias mostradas después del cierre son exactamente las de
  `ShiftResponse.closingBalances`.
- [ ] `FORBIDDEN`, fondos insuficientes y conflictos tienen mensaje en español
  y `correlationId` disponible.
- [ ] Una prueba de interacción cubre apertura, ambos tipos de movimiento,
  arqueo y cierre.
- [ ] El renderer no importa dominio, aplicación, DB, Node ni Electron.
- [ ] Lint, typecheck, tests y build quedan verdes.

## Fuera de alcance

- Reportes históricos de caja y auditoría, que pertenecen a 9.06.
- Reapertura o corrección de un turno cerrado.
- Sincronización de turnos entre nodos.
- Cálculos alternativos de saldos o diferencias en el cliente.
