# Plan de ejecución 9B.18: Perfil Gerencia

- **Sub-fase:** [9B.18 Perfil Gerencia](./9b.18-perfil-gerencia.md)
- **Estado del plan:** ~~Implementado y cerrado 2026-09-05~~
- **Base:** [ADR-0013](../../architecture/adr/0013-reportes-operativos-de-lectura.md),
  [ADR-0015](../../architecture/adr/0015-permisos-efectivos-en-la-sesion.md) y
  [plan 9B.13](./plan-9b.13-kpis-de-gerencia.md)
- **Disciplina:** Outside-in para lecturas y autorización; Ponytail `full`

## Resultado esperado

Entregar una vista estrictamente de lectura con reportes y KPIs de ventas e inventario; costo
y margen se incorporan después de corregir 9B.04 y 9B.13. Ninguna acción de gerencia modifica
agregados.

## Línea base comprobada

- La pantalla de reportes ya consulta cierres, auditoría y fiscalidad con permisos propios,
  límites y CSV local.
- La navegación ya puede ocultar una pantalla cuando no existe ninguna lectura autorizada.
- 9B.13 añadirá lecturas de ventas/inventario y corregirá el margen existente para netear
  descuentos/devoluciones con período y cota SQL.
- El renderer no dispone ni necesita una librería de dashboard para presentar números,
  períodos y listados.

## Decisiones de composición

- La vista se construye exclusivamente con contratos `GET` autorizados. No recibe botones de
  anulación, devolución, ajuste, precio, política ni configuración.
- La separación se deriva de permisos efectivos; no se ocultan comandos que el servidor sí
  concedió ni se usa `roleCode === 'MANAGER'`.
- Cada tarjeta muestra período UTC, moneda, alcance del nodo y si el resultado fue recortado o
  si una capacidad aún no existe. No suma monedas ni completa datos ausentes.
- El margen aparece solo con `reports.margin.read` y 9B.04 completa. Auditoría mantiene las
  columnas redactadas de ADR-0013.
- La exportación usa exactamente la proyección visible y neutralización CSV existente.

## Secuencia de implementación

1. Componer reportes actuales y el primer corte de ventas/inventario de 9B.13.
2. Probar acceso con cada permiso de lectura y ausencia total de comandos.
3. Probar períodos vacíos, múltiples monedas, límite máximo y señal de resultado recortado.
4. Integrar margen y devoluciones solo después de volver a cerrar 9B.04, 9B.06 y 9B.13.
5. Probar CSV desde los datos visibles, sin una segunda consulta.
6. Verificar teclado, estados de carga/error y rótulo `SIMULACION` en información fiscal.
7. Ejecutar verificaciones y actualizar cronograma.

## Criterios de aceptación

- [x] ~~La vista solo contiene lecturas concedidas por permisos efectivos.~~
- [x] ~~Ninguna acción visible ni llamada del cliente modifica un agregado.~~
- [x] ~~Período, moneda, nodo y límite son visibles junto a cada resultado.~~
- [x] ~~Margen no se muestra como cero ni estimado cuando 9B.04 no está disponible.~~ 9B.04 está
  cerrada y el panel solo se consulta con `reports.margin.read`.
- [x] ~~La exportación no vuelve a consultar ni amplía la proyección autorizada.~~
- [x] ~~No se añade una dependencia de gráficos ni un motor de dashboard.~~
- [x] ~~`pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.~~ 591 pruebas / 120 archivos.

## Fuera de alcance

- Operación de caja, inventario, catálogo, devoluciones y configuración.
- Metas, alertas, pronósticos y análisis ad hoc.
- Consolidación multi-sucursal/nodo y optimización de Fases 10 y 12.
