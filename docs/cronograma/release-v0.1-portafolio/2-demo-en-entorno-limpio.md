# V0.1.02: Demo en entorno limpio

- **Release:** [v0.1 de portafolio](./README.md).
- **Estado:** Pendiente.
- **Entrada:** V0.1.01 cerrada.

## Objetivo

Demostrar que otra persona puede ejecutar Cullen desde un clon limpio en Windows y completar el
recorrido principal sin hardware fiscal.

## Tareas

- [ ] Preparar una VM o estación Windows limpia sin reutilizar `.data`, dependencias globales ni
  secretos de desarrollo.
- [ ] Seguir únicamente el README: clonar, instalar con lockfile, preparar el perímetro de datos,
  provisionar el administrador y cargar configuración operativa y catálogo de ejemplo.
- [ ] Arrancar servidor y desktop y comprobar ingreso, enrolamiento de credencial y recuperación
  de sesión.
- [ ] Completar una jornada demostrable: abrir caja, vender, emitir documento simulado, consultar
  kardex/reportes y cerrar caja.
- [ ] Reiniciar los procesos y verificar que la operación persiste y que las pantallas continúan
  identificando la fiscalidad como `SIMULACION`.
- [ ] Registrar comandos, tiempos aproximados, incidencias y evidencia visual sin datos sensibles.

## Criterio de salida

El golden path se completa siguiendo documentación pública, sin conocimiento del historial del
chat, sin modificar el código y sin conectar impresoras fiscales. Cualquier paso implícito se
corrige en la documentación antes de continuar.

## Evidencia requerida

Commit probado, versión de Windows/Node/pnpm, salida del pipeline, guion ejecutado y capturas del
inicio de sesión, venta, documento simulado, inventario y reportes.
