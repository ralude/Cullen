# ADR-0021: MVP de referencia no certificado y defaults reemplazables

- Estado: **Aceptado**
- Fecha: 2026-09-04

## Contexto

La Fase 9B acumuló seis bloqueos directos porque decisiones comerciales, contables y
regulatorias se trataron como prerrequisitos de cualquier código. Eso impide avanzar aunque
el alcance aprobado del MVP ya dice que la fiscalidad es simulada y no certificada.

`AGENTS.md` exige no inventar reglas silenciosamente, pero no exige esperar validación legal
externa para una implementación que declara sus límites. Las decisiones reversibles pueden
tener un default explícito, pruebas y un punto de reemplazo.

## Decisión

1. El core, la UI genérica y `FiscalPrinterFake` se desarrollan como **referencia no
   certificada**. Toda capacidad fiscal simulada muestra `SIMULACION` y nunca declara emisión
   legal, compatibilidad de hardware ni autorización de un modelo.
2. Los defaults de 9B.04, 9B.05, 9B.06 y 9B.10 son decisiones de producto para el MVP, no
   interpretaciones normativas. Se pueden reemplazar mediante un ADR o una especificación de
   negocio posterior sin cambiar las fronteras del core.
3. La evidencia de fabricante, la interpretación tributaria, el protocolo, el firmware y la
   recuperación de un equipo real bloquean únicamente Fase 8 y los gates de piloto/producción.
   No bloquean la release open source de portafolio `v0.1.0`, que distribuye código fuente y una
   demostración explícita con `FiscalPrinterFake`, no un binario para operar en tienda.
4. 9B.08 se difiere: el modelo vigente conserva una existencia implícita por nodo hasta que
   exista una necesidad aprobada de varios almacenes.
5. 9B.12 se reduce a lectura de arqueos, autorización e historia de venta. Un turno cerrado
   permanece cerrado; la reapertura no forma parte del MVP.

## Defaults de referencia

- **Costeo:** promedio ponderado móvil, costo congelado en la recepción y conversión entre
  monedas solo con tasa explícita y snapshot. FIFO y revalorización son extensiones.
- **Cliente:** snapshot opcional por venta, sin agregado `Customer` ni historial reutilizable.
- **Devolución:** contra venta y documento fiscal originales, con permiso, motivo, idempotencia,
  auditoría y nota de crédito fake. Las variantes parciales, mixtas y comerciales se agregan
  cuando tengan un consumidor aprobado.
- **Configuración:** se administra lo que ya existe; la tasa del producto y las políticas
  versionadas se conservan. No se crea un catálogo general de alícuotas por anticipado.

## Invariantes que no se recortan

Dinero en enteros y moneda explícita, snapshots de hechos emitidos, documentos fiscales
inmutables, estados recuperables, autorización en el caso de uso, auditoría de operaciones
sensibles e idempotencia.

## Consecuencias

La Fase 9B puede abrir implementación por capacidades disponibles y entregar perfiles
parciales sin presentar cumplimiento legal. Las decisiones profesionales permanecen visibles
como brechas del perfil fiscal y se vuelven obligatorias al reanudar Fase 8 o antes de un
despliegue piloto/producción.

## Criterios de aceptación

- El cronograma ya no marca 9B.04, 9B.05, 9B.06, 9B.10 ni 9B.12 como bloqueadas por falta de
  validación externa.
- 9B.08 queda diferida con dueño y criterio de reapertura.
- Los perfiles indican qué parte está disponible y qué capacidad sigue diferida.
- Ninguna pantalla o driver fake declara emisión fiscal legal.
- El gate de Fase 8/piloto conserva la verificación profesional y de hardware.
