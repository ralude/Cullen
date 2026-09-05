# Plan de ejecución 9B.14: Perfil Cajero

- **Sub-fase:** [9B.14 Perfil Cajero](./9b.14-perfil-cajero.md)
- **Estado del plan:** Bloqueado por el plan correctivo previo a perfiles
- **Base:** [ADR-0015](../../architecture/adr/0015-permisos-efectivos-en-la-sesion.md)
- **Disciplina:** Outside-in para comportamiento; los componentes puramente presentacionales
  no requieren TDD (ADR-0007). Ponytail `full`.

## Resultado esperado

Un operador con permisos de cajero abre su turno local, vende y cobra por teclado, consulta
precio/existencia y cierra su turno sin recibir herramientas de catálogo, inventario o
supervisión.

## Línea base comprobada

- El renderer ya tiene pantallas separadas de venta, caja, catálogo e inventario, navegación
  por hash, atajos `Alt+0..9` y controles derivados de `permissionCodes`.
- La venta ya permite escanear, agregar, cobrar y completar; la caja permite abrir, mover y
  cerrar. Aún se presentan como módulos técnicos separados.
- Las lecturas de productos y kardex requieren sesión, mientras los comandos privilegiados
  declaran su permiso en contratos compartidos.
- Solo existe el rol administrador sembrado hasta 11.02; esta sub-fase compone permisos, no
  administra roles ni prueba una asignación inexistente.

## Decisiones de composición

- No se crea un “modo cajero” ni una segunda autorización. Se define un workspace a partir de
  capacidades cuyo contrato ya permite la sesión; cada comando vuelve a autorizar en servidor.
- La caja de trabajo es la configurada para la terminal y su turno abierto. Ver turnos ajenos
  se reserva a `cash.shift.read.any` cuando 9B.12 lo publique.
- Se reutilizan componentes y cliente HTTP actuales. Las consultas de precio/existencia son
  de solo lectura; no exponen alta, precio, recepción, ajuste o conteo sin permiso.
- 9B.05 agrega el receptor opcional sin impedir ventas anónimas. Su ausencia no bloquea el
  primer corte del workspace.
- El recorrido principal debe funcionar con foco visible, Enter/Escape y atajos documentados;
  no se añade una dependencia de routing ni un design system.

## Secuencia de implementación

1. Definir con pruebas puras la composición de secciones y acciones a partir de permisos.
2. Probar que los contratos de comando gobiernan botones y que una URL manual no ofrece una
   acción no autorizada.
3. Cubrir el recorrido observable abrir turno → escanear/agregar → cobrar → completar → volver
   listo para otra venta → cerrar turno.
4. Completar foco, orden de tabulación, Enter/Escape, mensajes de error y recuperación sin
   perder la venta.
5. Añadir receptor opcional cuando 9B.05 esté disponible.
6. Verificar con teclado y lector simulado; documentar cualquier interacción DOM que no pueda
   automatizarse con el entorno actual en vez de añadir `jsdom` solo por esta sub-fase.
7. Ejecutar verificaciones y actualizar cronograma.

## Criterios de aceptación

- [ ] El workspace muestra solo lecturas y comandos permitidos por los contratos.
- [ ] El recorrido principal de caja y venta se completa sin ratón.
- [ ] No se puede consultar ni operar el turno de otra estación desde este perfil.
- [ ] Errores preservan el estado útil y devuelven el foco a una acción recuperable.
- [ ] El receptor sigue opcional y toda fiscalidad visible dice `SIMULACION`.
- [ ] No hay lógica de negocio ni permisos duplicados a mano en React.
- [ ] `pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.

## Fuera de alcance

- Administración de roles, personalización de layout y preferencias por operador.
- Supervisión de varias cajas, devoluciones y reportes gerenciales.
- Hardware real de scanner, balanza, gaveta o impresora fiscal.
