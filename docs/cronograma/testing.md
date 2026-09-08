# Estrategia de Testing

La piramide de pruebas prioriza reglas de dominio rapidas y deterministas, y agrega infraestructura real antes de las pruebas end-to-end.

## Niveles

1. **Unit:** todo el dominio sin SQLite, Electron, Fastify ni hardware. Incluye IVA, descuentos, totales, estados de venta, caja, inventario y permisos.
2. **Integration:** SQLite real sobre bases temporales. No se usan mocks para guardar, leer o actualizar ventas y agregados persistidos.
3. **Contract:** cada comando y puerto verifica su contrato. El protocolo fiscal cubre `OPEN`, `ITEM`, `PAYMENT` y `CLOSE`.
4. **Simulation:** impresora virtual con ACK, NAK, sin papel, memoria llena, busy, timeout, CRC y puerto cerrado.
5. **E2E:** flujo automatizado desde la aplicación React montada, mediante
   `fetch` contra un listener Fastify real y con efectos verificados en SQLite
   real. `app.inject`, un `fetch` simulado o un `DesktopApi` mock son pruebas de
   contrato o interacción, no E2E. Electron solo se incorpora cuando el flujo
   dependa de una frontera nativa que deba validarse.
6. **Chaos:** fallos de sistema operativo, USB, red, Electron y cierre fiscal.

## Reglas por fase

- Fase 2: unit tests outside-in para cada caso de uso y unit tests del dominio.
- Fase 3: integration tests con SQLite real y transacciones reales.
- Fase 4: pruebas de append-only, outbox, idempotencia y proyeccion de historial sin rehidratar el estado operativo.
- Fases 5 y 6: flujos integrados auditados de caja e inventario.
- Fase 7: contract tests semanticos y simulacion determinista del puerto fiscal
  fake.
- Fase 8: suites contractuales del puerto sobre simuladores/fakes controlados y
  sin controles exclusivos del fake fiscal, vectores dorados de bytes por
  protocolo, SerialPortMock/fake de transporte, reconciliacion por evidencia y
  una suite hardware-in-the-loop separada por modelo y firmware. El
  consentimiento de X/Z simulados nunca habilita X/Z en hardware.
- Fase 9: pruebas de interacción de venta, caja, catálogo e inventario, más un
  E2E real del camino crítico de venta: ingreso, turno abierto, escaneo, cobro y
  cierre persistido.
- Fase 10: deduplicacion, ownership por agregado, reconexion y discrepancias de inventario.

## Escenarios de chaos testing

- Apagar Windows durante una venta.
- Desconectar USB mientras se imprime.
- Eliminar Internet mientras sincroniza.
- Cerrar Electron con una factura abierta.
- Reiniciar el equipo durante el cierre Z.

Cada escenario debe definir estado inicial, fallo inyectado, estado esperado recuperable y evidencia de que no se duplicaron efectos.

## Matriz minima de la Fase 8

- El parser recibe cada trama en todos sus cortes posibles, varias tramas en un
  chunk, ruido, truncamiento, overflow, checksum invalido y respuesta tardia.
- El transporte cubre puerto ocupado, backpressure, timeout por etapa,
  desconexion, reconexion con epoch nuevo y cierre mientras hay trabajo.
- Factura, nota, X y Z fallan antes, durante y despues de la escritura y de la
  respuesta; solo evidencia autoritativa permite retry.
- El barrido de arranque recupera documentos y reportes o mantiene el
  dispositivo bloqueado sin reproducir tramas.
- Cada uno de los dos manifiestos se valida con su hardware fiscal y la misma
  aplicación empaquetada en Windows limpio; también con simulador oficial
  cuando el fabricante disponga de uno.
- La prueba HIL verifica contenido/totales del documento, impresion incompleta,
  presupuesto de cierres Z y coexistencia con el DCTD.
- Los resultados registran por perfil proveedor, modelo, firmware, protocolo o
  SDK, interfaz, runtime y version de SerialPort cuando aplique; una combinacion
  no probada queda fuera de la matriz soportada.
