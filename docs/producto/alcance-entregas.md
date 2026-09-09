# Alcance por nivel de entrega

Este documento separa el alcance técnico actual de las condiciones necesarias para operar y evolucionar el producto. No agrega funcionalidades a la fase vigente; define qué significa terminar cada nivel.

## 1. MVP técnico

Demuestra los flujos principales y las decisiones arquitectónicas en un entorno controlado.

Incluye:

- catálogo, moneda, ventas, caja e inventario básico;
- persistencia local por nodo;
- historial append-only, outbox, auditoría e idempotencia;
- impresora fiscal fake y pruebas de contrato; durante la suspensión aprobada de
  Fase 8, el MVP técnico se demuestra en modo fiscal simulado y no declara
  perfiles reales ni compatibilidad fiscal;
- UI para los flujos principales;
- prueba de sincronización entre una terminal autónoma y un nodo coordinador.

No garantiza todavía instalación desatendida, soporte remoto, actualización segura ni cumplimiento fiscal certificado.

### Release open source de portafolio v0.1

La [release v0.1](../cronograma/release-v0.1-portafolio/README.md) publica el código fuente y
una demostración reproducible del estado alcanzado después de Fase 11. Es un hito de
distribución anterior al cierre técnico completo del MVP y no agrega alcance funcional.

Para publicarla se requiere CI remoto verde, ejecución en un entorno Windows limpio,
documentación coherente, licencia y notas de release. La demostración utiliza
`FiscalPrinterFake`, mantiene visible el modo `SIMULACION` y no declara certificación,
compatibilidad con equipos fiscales reales ni aptitud para operar en una tienda.

La falta de equipos fiscales no bloquea esta publicación: Fase 8 y la sub-fase 12.04 siguen
suspendidas hasta disponer de hardware y evidencia oficial. Las sub-fases 12.01–12.03 se
ejecutan después de v0.1 para demostrar el objetivo técnico medido; 12.05 completa el gate de
Fase 12 antes de iniciar Fase 13. La v0.1 se distribuye como fuente; un instalador MSI sin
firma no forma parte de este hito.

## 2. Piloto en tienda

Valida el producto en una tienda y con hardware controlado.

Requiere:

- autenticación, autorización y auditoría aplicadas de extremo a extremo;
- política aprobada de inventario durante desconexiones;
- backup automático y restauración ensayada;
- recuperación después de reinicio, corte eléctrico y pérdida de LAN;
- dos perfiles fiscales validados por separado con fabricante/representante y
  una matriz explícita de modelo, firmware, protocolo o SDK e interfaz; una
  tienda piloto puede instalar uno de los perfiles aprobados sin tener ambos
  equipos simultáneamente;
- evidencia vigente de autorización por modelo, registro del integrador y revisión tributaria antes de operar;
- coexistencia ensayada con el DCTD y soporte autorizado de la topología instalada;
- instalación, actualización y rollback ensayados;
- matriz concreta de Windows, terminales y periféricos soportados;
- runbooks de caja, base de datos, red y dispositivo fiscal.

## 3. Producción soportada

Permite desplegar, actualizar, observar y dar soporte al producto de forma repetible.

Requiere:

- builds reproducibles y CI remoto obligatorio;
- ejecutables e instaladores firmados;
- migraciones verificadas durante upgrades;
- rotación, retención y exportación segura de logs y auditoría;
- diagnóstico remoto con consentimiento y redacción de datos sensibles;
- objetivos medidos de recuperación, disponibilidad y rendimiento;
- política de versiones compatibles y soporte;
- proceso repetible para agregar una tercera o posterior familia fiscal mediante
  protocolo oficial, adaptador independiente y calificación con hardware;
  ninguna marca se considera compatible por defecto.

## 4. Plataforma empresarial

Amplía la operación POS a capacidades administrativas y multi-sede.

Puede incluir, mediante fases futuras aprobadas:

- compras y proveedores completos;
- clientes y datos fiscales;
- reportes administrativos y financieros;
- consolidación y operación multi-sede;
- gobierno de catálogos, precios y promociones;
- integraciones contables, de pagos y analítica.

Estas capacidades no forman parte implícita del MVP. Cada una debe incorporarse con alcance, ADR cuando aplique y criterio de salida propio.

### Evolución aprobada el 2026-09-06

El [plan post-MVP](../cronograma/evolucion-post-mvp.md) incorpora, con implementación pendiente:

- Fase 13: varios almacenes por sucursal, migración conservadora y transferencias internas.
- Fase 14: API central Fastify y PostgreSQL alojados en la nube.
- Fase 15: sincronización de inventario confirmado desde SQLite local hacia la vista central.
- Fase 16: Web App interna de consulta con Next.js, Tailwind CSS y TanStack Query.
- Fase 16B: sistema de diseño propio de Cullen basado en shadcn/ui, integrado en la web.
- Fase 17: validación integral y despliegue gradual.

Zustand está autorizado para estado compartido de UI cuando se necesite. Por instrucción
expresa del usuario, Ponytail no aplica en Fases 16 y 16B: se exploran las dependencias
adecuadas para calidad de interfaz y eficiencia de implementación, con pruebas y fronteras
arquitectónicas conservadas. Estas fases no agregan comandos de stock desde la web,
almacén central independiente, transferencias entre sucursales ni portal público.

Esta evolución se ejecuta después del cierre técnico del MVP; su planificación no permite
adelantar código de fases futuras ni sustituye los gates de piloto y producción.

## Regla de avance

La publicación de v0.1 puede ocurrir después de Fase 11 cuando cumpla su gate propio. Este
hito no equivale al cierre técnico del MVP ni autoriza el inicio de Fase 13.

Con la [replanificación aprobada](../cronograma/replanificacion-fase-08-a-09.md),
completar las fases 0–7, 9–11 y las sub-fases 12.01–12.03 demuestra el MVP técnico únicamente en
modo fiscal simulado. La sub-fase 12.04 permanece suspendida junto con Fase 8 y no bloquea ese
cierre, porque solo puede medir una integración serial real y estable. 12.05 no amplía ese
alcance funcional, pero debe cerrar su gate de mantenibilidad antes de avanzar a Fase 13, de
acuerdo con el orden obligatorio del cronograma. La Fase 8 sigue siendo
obligatoria para habilitar el piloto:
debe reanudarse y completarse con sus dos perfiles exactos antes de cerrar el
gate operativo. El paso a piloto o producción depende además de los demás
gates; no se deduce únicamente de que las funcionalidades estén implementadas.
