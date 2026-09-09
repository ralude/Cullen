# V0.1.04: Publicación

- **Release:** [v0.1 de portafolio](./README.md).
- **Estado:** Pendiente.
- **Entrada:** V0.1.03 cerrada.

## Objetivo

Publicar un tag y un release de GitHub reproducibles, y verificar que el resultado público se
puede consumir desde cero.

## Tareas

- [ ] Seleccionar el commit candidato sin cambios pendientes y confirmar que versiones y notas
  declaran `0.1.0`.
- [ ] Ejecutar el workflow remoto completo sobre el candidato y conservar sus enlaces como
  evidencia del release.
- [ ] Revisar el diff desde el último hito, confirmar licencia y ausencia de secretos, `.data`,
  respaldos, claves, certificados privados o artefactos locales.
- [ ] Crear el tag anotado `v0.1.0` y el release de GitHub con notas y archivos fuente generados
  por la plataforma; no adjuntar el MSI sin firma.
- [ ] Clonar desde el tag publicado en un directorio nuevo y repetir instalación, build y el
  tramo mínimo del quickstart.
- [ ] Marcar este hito como completado en el cronograma solo después de la verificación pública y
  enlazar el release inmutable.

## Criterio de salida

El tag, las notas, el código descargable, la documentación y los checks remotos identifican el
mismo commit. Un tercero puede reproducir el build y la demo simulada sin equipos fiscales.

## Después del release

Fase 12 se habilita como siguiente trabajo técnico. Los defectos de `v0.1.x` pueden corregirse
sin adelantar fases futuras; nuevas capacidades siguen el cronograma y sus fuentes normativas.
