# ADR-0025: Web interna Next.js y sistema de diseño de Cullen

- **Estado:** Aceptado para Fases 16 y 16B post-MVP; implementación pendiente.
- **Fecha:** 2026-09-06.
- **Complementa:** ADR-0001, ADR-0002 y ADR-0024.
- **Aprobación:** el usuario exige Next.js, excluye Ponytail de la fase web y autoriza una
  Fase 16B para un sistema de diseño propio basado en shadcn/ui.
- **Plan:** [Evolución post-MVP](../../cronograma/evolucion-post-mvp.md).

## Decisión

La Web App interna se implementará con **Next.js App Router, React y TypeScript**.
Next.js pertenece a presentación web. Fastify central conserva contratos HTTP de negocio
y autorización en aplicación; Server Components, Route Handlers o una capa BFF solo adaptan
sesión/transporte. No contienen reglas de inventario ni acceden directamente a PostgreSQL.
El desktop continúa con su stack y alcance existentes.

La Fase 16 entrega consultas funcionales con **Tailwind CSS y shadcn/ui** como base visual.
La Fase 16B entrega el **sistema de diseño propio de Cullen**, basado en esos componentes,
con identidad, tokens, patrones, documentación y adopción en todas las pantallas de Fase 16.
16B depende de 16; el cierre de 16 no exige una biblioteca futura todavía inexistente.

## Política explícita de herramientas

**Ponytail NO aplica a Fase 16 ni Fase 16B.** No se limita la exploración de UI ni se rechazan
dependencias útiles por una preferencia de minimalismo. Se autorizan las necesarias para
calidad visual, accesibilidad, interacción, pruebas y eficiencia de implementación.

Las decisiones adicionales se justifican con un caso real, compatibilidad, mantenimiento,
licencia, experiencia de usuario y medición cuando corresponda. No se instalan hoy ni se
fijan versiones que podrían quedar obsoletas antes de ejecutar la fase. El estudio inicial
y los candidatos están en [16.01](../../cronograma/fase-16-web-app/16.01-experiencia-y-stack.md).
Esta excepción no elimina las fronteras arquitectónicas ni las verificaciones del proyecto.

## Responsabilidad de cada herramienta

- **Next.js:** rutas, layouts, renderizado y separación servidor/cliente. La composición
  SSR puede precargar consultas autorizadas; las interacciones usan Client Components.
- **Tailwind CSS:** estilos y tokens; en 16B se centralizan sus valores y semántica.
- **shadcn/ui:** componentes editables como base de la biblioteca propia; se mantiene su
  procedencia y los avisos/licencias de código y dependencias incorporados.
- **TanStack Query:** estado remoto de consulta, claves, caché, revalidación, cancelación,
  errores y prefetch/hidratación cuando corresponda.
- **Zustand:** estado compartido exclusivamente de interfaz cuando sea necesario, como
  preferencias o paneles. No almacena otra copia autoritativa del inventario, credenciales
  ni decisiones de autorización.
- **URL:** búsqueda, filtros y paginación que deben sobrevivir recarga o enlace compartido.
  No se mantienen tres fuentes independientes para el mismo filtro.
- **Herramientas complementarias:** se evalúan TanStack Table, documentación visual,
  pruebas de navegador, accesibilidad y otras dependencias contra las necesidades de UI.

## Aislamiento y frescura

Un QueryClient usado durante SSR se aísla por solicitud. Un store Zustand que participe en
renderizado de servidor tampoco es un singleton compartido entre usuarios. La hidratación
tiene datos iniciales coherentes y no serializa secretos.

Las claves de consulta incluyen el contexto autorizado y todos los filtros relevantes.
Cambiar de usuario, cerrar sesión o perder permisos cancela peticiones y elimina datos
sensibles cacheados. Next.js/CDN no comparten respuestas personalizadas entre sesiones.
La API revalida permisos; ocultar un selector o una ruta no constituye autorización.

La hora de refetch del navegador no sustituye el punto de aplicación del inventario en
PostgreSQL. La UI muestra la antigüedad de origen y pendientes de cada sucursal. TanStack
Query no es la cola durable de sincronización de Fase 15. La web no promete funcionar como
POS offline ni realiza mutaciones optimistas de existencias.

## Sistema de diseño propio

La propiedad buscada es identidad visual, código y gobierno del sistema Cullen: tokens
semánticos, tipografía, densidad, temas, estados de interacción y catálogo de componentes.
No es solo cambiar el color de shadcn/ui. La biblioteca tendrá exports públicos, ejemplos,
pruebas y una política de cambios; los componentes visuales reciben datos y acciones por
props, sin incorporar consultas de inventario ni stores de negocio.

La Fase 16B integra la biblioteca en la web y verifica consistencia, teclado, foco, contraste,
responsive y estados vacíos/error/carga. Extenderla al desktop requiere otro alcance aprobado.

## Fuentes oficiales consultadas el 2026-09-06

Las fuentes respaldan los mecanismos de las herramientas; su combinación y sus límites
en Cullen son decisiones de este ADR.

- [Next.js: Server y Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).
- [Tailwind: variables de tema](https://tailwindcss.com/docs/theme).
- [shadcn/ui: componentes y código personalizable](https://ui.shadcn.com/docs).
- [TanStack Query: SSR avanzado con App Router](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr).
- [Zustand: integración con Next.js y aislamiento de stores](https://zustand.docs.pmnd.rs/learn/guides/nextjs).

