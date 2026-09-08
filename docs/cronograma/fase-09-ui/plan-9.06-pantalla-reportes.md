# Plan de ejecución 9.06: Reportes y cierres

- **Sub-fase:** [9.06 Reportes y cierres](./9.06-pantalla-reportes.md)
- **Estado del plan:** Ejecutado; decisiones cerradas en ADR-0013
- **Prerrequisito:** [9.05 Pantalla de inventario](./9.05-pantalla-inventario.md)
- **Disciplina visual:** Ponytail `full`, limitada a presentación
- **Modo fiscal permitido:** `SIMULACION` mediante `FiscalPrinterFake`

## Resultado esperado

La pantalla consulta proyecciones autorizadas de caja, auditoría y estado
fiscal. Las consultas y exportaciones no modifican agregados. X/Z aparecen en
un área separada de acciones simuladas, con capability, consentimiento por
request, motivo e idempotencia; nunca se confunden con una consulta ni con un
cierre ejecutado por hardware fiscal real.

## Línea base comprobada

- 9.00 trasladó a 9.06 las lecturas de caja, auditoría y estado fiscal; todavía
  no existen casos de uso, puertos ni contratos para ellas.
- SQLite contiene turnos/balances, `audit_log`, documentos, jornadas, reportes
  y transiciones fiscales suficientes para read models locales.
- La capability informa `simulatedReportsEnabled`; las rutas X/Z solo existen
  con ambas opciones confiables de arranque y exigen consentimiento exacto,
  sesión, permiso e idempotencia.
- Existe consulta de un documento fiscal por ID y repositorios internos de
  recuperables, pero no una vista agregada para operación.
- Fase 10 no ha implementado una fuente de estado de sincronización. 9.06 no
  puede publicar un contador o estado ficticio.

## Queries a definir antes de la UI

- `GetCashClosureReport`: turnos cerrados con período UTC, caja, operador,
  saldos esperados/declarados y diferencias por método/moneda.
- `GetAuditReport`: entradas redactadas por período, actor, acción y entidad,
  sin exponer secretos ni PII excluida por `10-logs.md`.
- `GetFiscalOperationsReport`: documentos y reportes con estado, intentos,
  error público, evidencia neutral y señal de intervención/reconciliación,
  siempre con `fiscalMode: "SIMULATION"`.

Cada query usa un puerto de lectura propio y un adapter Drizzle. La autorización
se ejecuta en aplicación antes de leer. Las rutas no consultan tablas, no
reconstruyen agregados y no deciden qué estados son recuperables.

## Separación entre consulta y comando

- Entrar a Reportes ejecuta solo queries.
- X/Z vive en una sección titulada `Acciones fiscales simuladas`, no en la tabla
  de reportes históricos.
- La sección solo se renderiza cuando
  `simulatedReportsEnabled === true`; ocultarla no sustituye permiso ni guard.
- Antes de cada X/Z, el operador introduce jornada, fecha de negocio y motivo y
  confirma literalmente que ejecutará una simulación. El request incluye
  `ALLOW_SIMULATED_X_AND_Z` y una clave por intención.
- La respuesta se rotula `Resultado del simulador`; nunca `cierre fiscal real`,
  `emitido legalmente` ni `impreso`.
- Consultar, exportar o refrescar jamás llama a X/Z.

## Exportación mínima

La primera versión exporta CSV en el renderer a partir de la proyección ya
autorizada y visible, usando `Blob`, URL temporal y escape CSV probado. No usa
Node, Electron IPC ni una dependencia. No incluye campos ocultos o evidencia
completa que la tabla no autorice. Si la exportación requiere un permiso o
registro de auditoría distinto de la lectura, debe convertirse en comando o
endpoint servidor antes de implementar; no se simula ese control en React.

## Sincronización pendiente

Mostrar un estado honesto y estático: `Sincronización: pendiente de Fase 10`.
No inventar `SYNCED`, antigüedad, conteos o fecha de última sincronización. La
sección se sustituirá por la proyección real en Fase 10.

## Decisiones aplicadas

Aprobadas el 2026-09-03 en
[ADR-0013](../../architecture/adr/0013-reportes-operativos-de-lectura.md):

1. Permisos estables `reports.cash.read`, `reports.audit.read` y
   `reports.fiscal.read`, autorizados en aplicación antes de leer y añadidos al
   administrador inicial.
2. Filtros de período UTC opcionales por reporte; el límite de filas no es
   opcional: 100 por defecto, 500 como máximo, recortado en aplicación. El orden
   es descendente por el instante del hecho —cierre cuando existe, apertura en un
   turno abierto—. La auditoría no proyecta `beforeState` ni `afterState`.
3. Exportar no exige permiso ni auditoría propios: el CSV se genera en el
   renderer desde la proyección ya autorizada y visible. Si más adelante se exige
   rastrear la extracción, deja de ser local y pasa a ser una operación de
   aplicación autorizada.
4. La jornada y la fecha de negocio de X/Z se capturan manualmente. La ausencia
   de una lectura de jornada actual queda registrada como brecha de la API.

## Secuencia outside-in

1. Cerrar permisos, alcance, exportación y fuente de jornada; actualizar las
   especificaciones normativas o ADR si cambia una decisión existente.
2. Escribir pruebas de aplicación de autorización previa a toda lectura.
3. Implementar read models y adapters Drizzle con filtros UTC, orden estable y
   redacción; probarlos sobre SQLite temporal.
4. Publicar contratos HTTP y pruebas de éxito, sesión, permiso y ausencia de
   datos sensibles.
5. Probar cliente y recorrido de consulta/exportación sin comandos reutilizando
   la infraestructura de interacción aprobada en 9.02.
6. Probar por separado visibilidad y ejecución X/Z con capability, confirmación,
   permiso, consentimiento e idempotencia.
7. Implementar presentación semántica y CSS existente, ejecutar pipeline/build
   y actualizar el cronograma sin declarar Fase 9 completa: 9.07 seguirá abierta.

## Criterios de aceptación

Ejecutado. Las tres proyecciones consultan SQLite mediante casos de uso
autorizados y contratos compartidos, la exportación CSV cubre lo visible y X/Z
permanece separado detrás de capability, confirmación y consentimiento.

- [x] ~~Las tres proyecciones provienen de SQLite mediante queries de aplicación
  autorizadas y contratos compartidos; no de SQL en rutas ni datos mock.~~
- [x] ~~Una denegación ocurre antes de leer datos sensibles y devuelve
  `FORBIDDEN` sin filtrar contenido.~~
- [x] ~~Caja muestra cierres y diferencias por método/moneda sin recalcularlos.~~
- [x] ~~Auditoría conserva actor, acción, entidad, motivo, terminal y UTC con la
  redacción normativa.~~
- [x] ~~Fiscalidad muestra estados y errores recuperables como `SIMULACION` y no
  promete compatibilidad o validez legal.~~
- [x] ~~Consultar, refrescar y exportar producen cero llamada a X/Z.~~
- [x] ~~X/Z no es visible sin capability y no se ejecuta sin confirmación y
  consentimiento exactos; la API vuelve a validar sesión y permiso.~~
- [x] ~~El CSV contiene solo columnas autorizadas, escapa fórmulas/celdas y revoca
  la URL temporal después de iniciar la descarga.~~
- [x] ~~Sin una proyección de Fase 10 se muestra únicamente el estado pendiente,
  sin datos ficticios.~~
- [x] ~~Las pruebas de interacción cubren consulta, denegación, exportación y
  guard X/Z simulado.~~
- [x] ~~Lint, typecheck, tests y build quedan verdes.~~

## Brechas conservadas

- La API no publica una lectura de jornada fiscal actual; X/Z sigue dependiendo
  de una captura manual verificada por el servidor.
- Estas coberturas son de interacción del renderer con transporte HTTP
  simulado. El gate E2E real de Fase 9 está documentado en 9.02.
- La sincronización permanece como estado estático hasta la Fase 10.

## Fuera de alcance

- Sincronización real, indicadores `SYNCED` o consolidación multi-nodo.
- Fiscalidad real, HIL, SerialPort o certificación de fabricante.
- BI, gráficos, PDF, diseñador de reportes o consultas arbitrarias.
- Reconciliación automática de documentos/reportes desde esta pantalla.
