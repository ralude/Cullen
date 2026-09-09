# Emisión del material TLS de la LAN

Cubre la emisión inicial del material con el que coordinador y terminales se autentican
mutuamente, y el alta de una terminal nueva. La **rotación** de material ya emitido está en
[rotación de material protegido](./rotacion-material-protegido.md).

El transporte LAN exige autenticación mutua y falla cerrado ante material incompleto
([ADR-0026](../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md)); su rotación
la fija [ADR-0029 D9](../architecture/adr/0029-proteccion-de-datos-en-reposo.md). La API de
operadores nunca se expone en LAN: esto sólo habilita el listener técnico de sincronización.

## Autoridad interna

El MVP emite con una **autoridad interna propia**, suficiente para un piloto de una tienda. Si la
instalación tiene una PKI corporativa, emite con ella y usa este documento sólo como referencia
de los atributos que el nodo exige; el resto del procedimiento —sellado y configuración— es el
mismo. La elección de PKI para un despliegue real sigue abierta en el
[gate de piloto](../cronograma/gate-piloto-release.md).

La clave de la autoridad es el secreto más valioso de la LAN: quien la tiene puede emitir un
nodo. No vive en ninguna estación en operación.

## 1. Emitir

En una máquina administrativa, con `openssl` disponible y en un directorio con ACL restringida:

```powershell
& "C:\Program Files\Cullen\runtime\node.exe" `
  "C:\Program Files\Cullen\server\generate-lan-material.js" `
  --out D:\material-lan --days 825 `
  coordinator=192.168.1.10,coordinador.tienda.local `
  terminal-01=192.168.1.21 `
  terminal-02=192.168.1.22
```

Desde el repositorio, el equivalente es
`pnpm --filter @supermarket/server generate-lan-material -- --out ...`.

Produce `ca.key`, `ca.pem` y, por nodo, `<nombre>.key` y `<nombre>.pem`. Cada nodo lleva su
propia clave: comprometer una terminal no compromete la LAN. Cada certificado sirve a las dos
puntas del mTLS, porque un nodo escucha y entrega con la misma identidad.

Los nombres del `--out` son los que la otra punta exigirá: usa la **IP de LAN fija** con la que
el nodo será alcanzado, y el hostname sólo si el DNS de la tienda lo resuelve de forma estable.

**Guarda `ca.key` fuera de las estaciones**, en el medio que la tienda use para secretos. Se
necesita para dar de alta terminales nuevas y para rotar.

## 2. Sellar en cada nodo

El material sale en claro. La clave que lo protege vive en el almacén del nodo que lo usará y no
viaja, así que el sellado es **local en cada estación**. El arranque rechaza el texto claro con
`SECRET_MATERIAL_NOT_SEALED`.

En cada máquina, copia sólo lo suyo —su `.key`, su `.pem` y `ca.pem`— a un directorio
administrativo temporal y séllalo con `openSecretVault`, `loadFileProtection` y
`FileProtection.seal` del driver de seguridad, como describe el paso 2 de
[rotación de material protegido](./rotacion-material-protegido.md). Deja los archivos sellados
en `%ProgramData%\Cullen\keys\lan\`.

Nunca pases el material por argumentos de línea de comandos, logs, correo ni el renderer.

## 3. Configurar

En `%ProgramData%\Cullen\node.env`, apunta las rutas `SYNC_*_TLS_*_PATH` **a los archivos
sellados**. El coordinador declara su listener; cada terminal declara su coordinador. La
plantilla `packaging/wix/config/node.env.example` tiene ambos bloques.

## 4. Verificar

Arranca primero el coordinador y luego cada terminal. Confirma en el diagnóstico de
sincronización que un hecho de prueba llega a **aplicación**, no sólo a ACK de custodia: un ACK
confirma que el coordinador se hizo cargo del evento, no que lo aplicó.

## 5. Borrar el material en claro

Elimina el directorio temporal de cada estación y el `--out` de la máquina administrativa con el
mecanismo seguro aprobado por operaciones. Conserva sólo los archivos sellados, `ca.key` en su
custodia y el registro del cambio.

## Alta de una terminal nueva

Emite sólo para ella, reutilizando la autoridad existente:

```powershell
generate-lan-material.js --out D:\material-lan --days 825 terminal-03=192.168.1.23
```

Repite los pasos 2 a 5 en esa estación. El coordinador ya confía en la autoridad, así que no hay
que tocarlo. Registrar el nodo en el registro confiable de sincronización es un paso aparte, de
la administración del nodo, no de este procedimiento.

## Lo que este procedimiento no automatiza

La distribución del material a cada estación, su custodia y el reemplazo coordinado de
certificados vigentes. El reemplazo corta la LAN si se hace a medias y tiene su propio runbook
con la dependencia de confianza explícita: [rotación de material protegido](./rotacion-material-protegido.md).
