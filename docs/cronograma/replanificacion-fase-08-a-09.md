# Replanificación: suspensión de Fase 8 y avance a Fase 9

- **Fecha de decisión:** 2026-09-01
- **Estado:** Aprobada
- **Fase suspendida:** Fase 8 - Integración serial fiscal
- **Fase activa:** Fase 9 - UI
- **Motivo:** no se dispone del hardware fiscal oficial, el manual o protocolo
  vigente entregado por el fabricante, los binarios autorizados ni un
  laboratorio controlado para ejecutar los gates y pruebas HIL.

## Decisión

Se suspende la Fase 8 sin declararla completada y se habilita el avance a la
Fase 9. Esta excepción aplica la regla 5 del cronograma: las tareas abiertas de
8.00 y de las sub-fases 8.01–8.09 se conservan, junto con todo el trabajo ya
cerrado, y vuelven a ser obligatorias cuando estén disponibles las dependencias
externas.

La entrada a Fase 9 no omite el gate de seguridad pre-UI. El primer trabajo
activo es el corte mínimo de 11.01–11.03 definido en
[`gate-seguridad-pre-ui.md`](./gate-seguridad-pre-ui.md); solo después puede
comenzar 9.00.

## Límites mientras Fase 8 esté suspendida

- La composición fiscal usa exclusivamente `FiscalPrinterFake` y debe
  identificarse de forma visible y observable como **SIMULACIÓN**.
- La UI no puede afirmar que una factura, nota, reporte X o cierre Z fue emitido
  legalmente por un dispositivo fiscal real.
- No se agrega SerialPort, un codec de proveedor, un SDK/DLL fiscal ni una
  detección de hardware a producción.
- Las acciones X/Z simuladas permanecen detrás del consentimiento explícito ya
  definido para suites y entornos de simulación.
- No se inventan parámetros, comandos, checksums, estados, campos fiscales o
  garantías de recuperación a partir de fuentes no oficiales.
- El trabajo de UI debe conservar los puertos y contratos actuales para que un
  driver real pueda sustituir al fake sin introducir reglas de proveedor en el
  renderer, las rutas HTTP, el dominio o los casos de uso.

## Condición para reanudar Fase 8

La Fase 8 se reanuda desde 8.00 cuando exista, para el perfil correspondiente:

- canal formal con fabricante o representante autorizado;
- protocolo, manual o SDK vigente y su matriz de modelo/firmware/interfaz;
- registro y evidencia regulatoria requeridos;
- hardware autorizado o simulador oficial, más un laboratorio Windows
  controlado;
- capacidad de ejecutar el spike nativo, pruebas contractuales y HIL sin usar
  un equipo de producción.

## Efecto sobre los niveles de entrega

Las fases 9–12 pueden completar un **MVP técnico en modo fiscal simulado**. Mientras Fase 8 esté
suspendida, 12.04 también queda suspendida y fuera del criterio de cierre de ese MVP: no existe
una implementación serial real que medir u optimizar y el fake no la sustituye. Esta
replanificación no habilita piloto, producción ni una declaración de
compatibilidad fiscal real. Antes del gate de piloto y release deben reanudarse
y completarse la Fase 8, sus dos perfiles exactos y toda la evidencia exigida
por su criterio de salida.
