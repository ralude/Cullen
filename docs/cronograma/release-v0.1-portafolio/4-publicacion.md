# V0.1.04: Publicación

- **Release:** [v0.1 de portafolio](./README.md).
- **Estado:** ~~Cerrada~~ el 2026-09-10.
- **Entrada:** ~~[V0.1.03](./3-documentacion-portafolio.md) cerrada~~.
- **Publicado:** [`v0.1.0`](https://github.com/ralude/Cullen/releases/tag/v0.1.0) sobre `b23394d`.

## Objetivo

Publicar un tag y un release de GitHub reproducibles, y verificar que el resultado público se
puede consumir desde cero.

## Tareas

- [x] Seleccionar el commit candidato sin cambios pendientes y confirmar que versiones y notas
  declaran `0.1.0`.
- [x] Ejecutar el workflow remoto completo sobre el candidato y conservar sus enlaces como
  evidencia del release.
- [x] Revisar el diff desde el último hito, confirmar licencia y ausencia de secretos, `.data`,
  respaldos, claves, certificados privados o artefactos locales.
- [x] Crear el tag anotado `v0.1.0` y el release de GitHub con notas y archivos fuente generados
  por la plataforma; no adjuntar el MSI sin firma.
- [x] Clonar desde el tag publicado en un directorio nuevo y repetir instalación, build y el
  tramo mínimo del quickstart.
- [x] Marcar este hito como completado en el cronograma solo después de la verificación pública y
  enlazar el release inmutable.

## Criterio de salida

El tag, las notas, el código descargable, la documentación y los checks remotos identifican el
mismo commit. Un tercero puede reproducir el build y la demo simulada sin equipos fiscales.

## Lo publicado

| | |
| --- | --- |
| Commit | `b23394d` |
| Tag anotado | [`v0.1.0`](https://github.com/ralude/Cullen/releases/tag/v0.1.0) |
| Workflow remoto sobre el commit etiquetado | [run 34525139665](https://github.com/ralude/Cullen/actions/runs/34525139665), verde |
| Adjuntos | los fuentes que genera GitHub. **Sin MSI**: se construye sin firmar |
| Licencia | Apache 2.0 |

Las versiones declaran `0.1.0` en la raíz y en los cuatro paquetes publicables. La revisión previa
no encontró `.data`, respaldos, claves, certificados ni bases versionadas; los dos únicos archivos
de configuración del árbol —`development.env` y `node-identity.development.json`— contienen rutas
y dos identificadores, sin secretos.

El cuerpo del release son las [notas de `v0.1.0`](./notas-v0.1.0.md) con sus enlaces reescritos a
rutas absolutas fijadas al tag, para que no dependan del árbol de trabajo de quien las lea.

## La verificación pública

Clon nuevo **desde el tag**, no desde `main`:

| Paso | Resultado |
| --- | --- |
| `git clone --branch v0.1.0` | resuelve a `b23394d`, el mismo commit que verificó el CI |
| `pnpm install --frozen-lockfile` | instala sin modificar el lockfile |
| `pnpm pipeline` | 1.282 pruebas en 198 archivos, verdes |
| `pnpm build:artifacts` | servidor y escritorio compilan |

Con esto, el tag, las notas, el código descargable, la documentación y los checks remotos
identifican el mismo commit, que es lo que pedía el criterio de salida.

## Después del release

Fase 12 se habilita como siguiente trabajo técnico. Los defectos de `v0.1.x` pueden corregirse
sin adelantar fases futuras; nuevas capacidades siguen el cronograma y sus fuentes normativas.
