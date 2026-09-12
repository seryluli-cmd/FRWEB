# Gestion FR

PWA en JavaScript vanilla (sin build, sin frameworks) para que **Gestion FR**
⌨️ registre gastos, facturación diaria y un checklist de ideas/metas del
negocio. La usa el dueño (admin) y sus colaboradores desde el celular como app
instalada (Firestore la mantiene sincronizada entre todos los dispositivos en
tiempo real, con soporte offline).

Es una app de un solo dueño y un solo negocio: no hay reparto de gastos
entre socios ni selección de negocio — se identifica con PIN y entra
directo a la sección que necesita.

## Stack

- **Sin build ni npm.** HTML/CSS/JS servidos tal cual.
- **Firebase** (cargado por CDN): Firestore (tiempo real), Auth anónima
  (solo para que las reglas exijan `request.auth != null`), Storage (fotos
  de facturas, comprimidas en el navegador antes de subir).
- **Service worker** ([service-worker.js](service-worker.js)) — app shell
  offline, estrategia **red primero, caché como respaldo** (cualquier
  deploy nuevo se ve solo, sin quedar pegado a una versión vieja).
- **manifest.json** — "Agregar a pantalla de inicio" como app nativa.

## Archivos

| Archivo | Contenido |
|---|---|
| [index.html](index.html) | Todas las pantallas y modales del DOM. Un solo archivo, se muestra/oculta con clases `.screen`/`.active`. |
| [app.js](app.js) | Toda la lógica: estado en memoria, Firebase, render, event listeners. |
| [styles.css](styles.css) | Variables CSS (`:root`) para tema claro/oscuro automático. |
| [manifest.json](manifest.json) / [service-worker.js](service-worker.js) | Configuración PWA. |
| [icons/](icons/) | Íconos de la app (192/512/maskable). |

## Modelo de datos (Firestore)

⚠️ **`gastos` y `facturacion` no se traen completos**: `listenGastos()` /
`listenFacturacion()` en app.js filtran con `where("fecha", ">=", ...)` a
los últimos `HISTORIAL_MESES_CARGADOS` (12) meses, no todo el historial
desde el principio — así el tiempo de carga, la memoria del celular y las
lecturas facturadas por Firestore no crecen sin límite a medida que pasan
los meses de uso real. La navegación mes a mes de Gastos/Facturado/Resumen
(`gastosMesOffset` y afines) queda cubierta de sobra por esta ventana; ir
más atrás de los 12 meses todavía no está resuelto (haría falta una
consulta puntual a ese mes bajo demanda, no implementada). Las demás
colecciones (`ideas`, `reportes`, `inversion`, `logins`) sí se traen
completas: son listas acotadas por naturaleza (no un registro por
transacción diaria), no crecen de la misma forma.

- **`config/socios`** (un solo documento) —
  `{ socios: [string], colaboradores: string[], admins: string[], pins: { [nombre]: "1234" }, categoriasGastos: [{ nombre, soloAdmin }] }`.
  `socios` tiene un único nombre (vos, el dueño) y `admins` siempre lo
  incluye — no hay checkbox de admin en el setup porque no hace falta
  elegir. El campo `colaboradores` se puede editar después desde Ajustes.
- **`gastos`** — `{ importe, descripcion, categoria, pagadoPor, negocio, fecha, creadoEn, nota?, faltaAbonar?, formaPago?, montoEfectivo?, montoDigital?, fotos? }`.
  `fotos` es una lista de hasta 5 `{url, path}` (una factura puede tener
  varias hojas) — único lugar que la lee es `fotosDeGasto(g)`, que también
  entiende el formato viejo de una sola foto (`fotoUrl`/`fotoPath`, gastos
  cargados antes de este cambio) sin necesidad de migrarlos: se pasan solos
  al formato nuevo la próxima vez que se editan y guardan.
  `categoria` es una de: Kiosko, Bebidas, Panchos, Art Limpieza, Servicios,
  Alquiler, Mantenimiento Gral, Sueldos, Otros, Gastos Fijos (opciones fijas
  en el `<select>` de `index.html`, no se guardan en Firestore). Es un gasto
  más de la misma colección — `Gastos Fijos` no tiene esquema aparte, solo
  permisos distintos (ver "Identidad y permisos" abajo).
- **`facturacion`** — `{ importe, turno, registradoPor, negocio, fecha, creadoEn }`.
  `turno` es `"mañana"` | `"tarde"` | `"noche"` (constante `TURNOS` en app.js) —
  todos los días de la semana, domingo incluido, son 3 turnos por día, cada
  uno carga su propia caja como un cierre separado. `turnoActual()` propone
  el turno según la hora (mañana 06-14, tarde 14-22, noche 22-06) al abrir
  "Nuevo cierre", pero se puede cambiar a mano. La pantalla de Facturado
  suma los de **hoy** aparte (`facturado-total-hoy` / `facturado-turnos-hoy`,
  "X de 3 turnos cargados") además del total del mes. El **Resumen mensual**
  también tiene una sección "Facturado por día y turno" que agrupa los
  cierres del mes por día calendario y muestra el total de cada turno
  dentro de ese día.
- **Detección de cajas faltantes** (`turnosDelMesActual()` / `turnoVencimiento()`
  en app.js): la lista de "Cierre de Turno" arma la grilla completa del mes
  en curso (día 1 a hoy, orden Mañana → Tarde → Noche, más reciente
  primero). Cualquier turno cuya ventana + los 40 min de gracia ya pasaron
  y todavía no tiene cierre cargado aparece como fila roja "⚠️ CAJA NO
  CARGADA" con un botón **Cargar** — lo puede usar cualquiera (admin o
  colaborador) en cualquier momento, abre "Nuevo cierre" con esa fecha/turno
  ya preseleccionados. Un turno todavía en curso (no venció) simplemente no
  se muestra hasta que se cargue o venza. Esto no se reconstruye para
  meses anteriores a hoy — ahí la lista sigue mostrando solo lo real, sin
  grilla de faltantes.
- **`ideas`** — `{ texto, estado, votos, propuestoPor, creadoEn }`. `estado`
  es `"pendiente"` o `"concretada"`; `votos` es un array de nombres (🔥,
  toggle libre). Pendientes ordenadas por cantidad de votos. Cualquiera
  crea/vota/tilda; solo el admin borra.
- **`inversion`** — `{ monto, registradoPor, creadoEn }`. Historial de
  "Inversión Recuperada": cada doc guarda el monto **total acumulado** que
  Sergio (el inversor) lleva recuperado del negocio a esa fecha — no un
  incremento. Lo que se muestra como "recuperado hasta ahora" es el `monto`
  del doc más reciente (`inversionActual()` en app.js); la meta fija
  ($55.000.000, `INVERSION_META` en app.js) no se guarda en Firestore. Los
  montos de esta pantalla se muestran con el sufijo "Millones" (ver
  renderInversion en app.js) — es solo texto agregado al valor ya
  formateado por `money()`, no una conversión de unidades.
  Pantalla exclusiva: ver "Identidad y permisos" abajo.
- **`reportes`** — misma estructura y mecánica que `ideas` (ver arriba),
  pero para "Reportes de Mantenimiento" 🔨: `{ texto, estado, votos,
  propuestoPor, resueltoPor?, creadoEn }` con `estado` `"pendiente"` o
  `"resuelto"` (en vez de `"concretada"`, para que tenga sentido con "se
  arregló"). `resueltoPor` solo existe mientras está resuelto — se guarda
  con quién lo tildó (`toggleReporteEstado()`) y se borra si se reabre; la
  tarjeta muestra "Reportado por X" y, si corresponde, "Resuelto por Y"
  debajo. Es una sección aparte, debajo de "Caja de IDEAS" en `SECCIONES`
  (`renderSeccionCards()`), con su propia colección de Firestore — no
  comparte datos con `ideas`. Ver `renderReportes()` / `reporteCard()` /
  `listenReportes()` en app.js.
- **Storage**: fotos de gastos en `recibos/{negocio}/{timestamp}_{random}.jpg`,
  se borran solas a los 4 meses (el gasto nunca se borra, solo la foto). Las
  fotos de Cierre de Turno van en `cierres/{negocio}/{...}.jpg` (mismo
  patrón — ver `saveCierre()`) pero **no** entran en la limpieza automática
  de 4 meses (`limpiarFotosVencidas()` solo mira `gastos`) ni en la pantalla
  "Fotos guardadas" (solo lista fotos de gastos) — quedan en Storage
  indefinidamente salvo que se borre el cierre entero.

## Identidad y permisos (PIN + admin)

Cada persona se identifica con su nombre + un PIN de 4 dígitos (una vez por
celular, se recuerda hasta usar "Cambiar de usuario" en Ajustes). El admin
(vos) ve botones ✏️/🗑️ para editar y borrar gastos/cierres; los colaboradores
solo cargan y ven.

Además, tres vistas con totales mensuales/históricos o gastos privados son
**solo para el admin** (los colaboradores no las ven en absoluto, ni la
tarjeta para entrar):
- La sección **"Resumen mensual"** (`soloAdmin` en `SECCIONES`, dentro de
  `renderSeccionCards()`) — no aparece como tarjeta para colaboradores.
- La sección **"Gastos S/Admin"** (ver más abajo) — mismo mecanismo.
- El bloque **"Facturado este mes"** dentro de "Cierre de Turno"
  (`#facturado-total-mes-wrap`, ocultado en `renderFacturado()` según
  `esAdmin`) — los colaboradores solo ven el total de "Hoy".

**Categorías de gasto editables**: la lista de categorías (Kiosko, Bebidas,
Alquiler, etc.) no está hardcodeada — vive en Firestore
(`config/socios`, campo `categoriasGastos`, array de `{ nombre, soloAdmin }`)
y los admin la editan desde Ajustes → "Categorías de gastos" (crear, borrar,
marcar/desmarcar 🔒 "Privada"). `CATEGORIAS_GASTOS_DEFAULT` en app.js es la
semilla con la que arranca una instalación nueva (y con la que se completa
una vieja que todavía no tenía el campo, ver `listenSocios()`).

Las categorías marcadas **soloAdmin** (por default: Alquiler, Sueldos,
Gastos Fijos — alquiler, sueldos fijos, etc. que el dueño no quiere que vean
los colaboradores) solo pueden cargarse y verse siendo admin: el `<select>`
de categoría (`renderCategoriaOptions()`) no ofrece esas opciones a
colaboradores, y esos gastos se filtran de la lista y el total de la
pantalla "Gastos" (`renderGastos()`) y del CSV exportado
(`exportGastosCSV()`) cuando `!esAdmin` — ver `categoriaEsPrivada()`. Para
cargarlos/verlos rápido sin scrollear entre los gastos públicos, tienen su
propia pantalla **"Gastos S/Admin"** (`renderGastosAdmin()`, misma
colección `gastos`, mismo formulario/edición/foto que la pantalla común,
filtrado a categorías privadas) — no reemplaza la lista común: un admin que
entra a "Gastos" sigue viendo también los privados mezclados, igual que
siempre. En **Resumen mensual** (ya `soloAdmin`, ver arriba) no se filtran —
entran en el total y en la rentabilidad como cualquier otro gasto, y
aparecen como una categoría más en el desglose.

⚠️ Este ocultamiento es solo de pantalla, igual que el PIN (ver más abajo)
— no hay reglas de seguridad de Firestore en este repo, así que un
colaborador que abra las herramientas de desarrollador del navegador
podría leer igual los datos "privados" directo de la red.

Aparte de `esAdmin`, hay un permiso independiente por **nombre exacto**
(no depende de ser admin ni socio) para la pantalla **"Inversión
Recuperada"** — la primera tarjeta de `screen-seccion`, arriba de Gastos:
solo aparece para `usuarioActual === "Sergio"` o `"Pola"`
(`puedeVerInversion()` en app.js); del resto no la ve ni sabe que existe.
Adentro, solo Sergio puede cargar una actualización o borrar una del
historial (`puedeCargarInversion()`) — Pola solo mira. Mismo patrón que
usa el "Historial de logeos" en Ajustes (visible solo si
`usuarioActual === "Sergio"`).

⚠️ **No es una capa de seguridad real** — cualquier dispositivo con la
`firebaseConfig` puede leer/escribir todo en Firestore sin pasar por el PIN
de la app. Sirve para identificar quién usa cada celular, no para proteger
los datos de alguien mal intencionado con la config.

## Navegación de pantallas

```
screen-quien-sos (identificarte con PIN)
  └─ screen-seccion (auto-entra directo, un solo negocio — elegir
       Inversión Recuperada* / Gastos / Facturado / Resumen mensual /
       Gastos S/Admin*** / Caja de IDEAS / Reportes de Mantenimiento)
       ├─ screen-inversion (*solo Sergio y Pola, ver "Identidad y permisos")
       ├─ screen-app       (tabs: Gastos, Balance**, Ajustes)
       ├─ screen-facturado
       ├─ screen-resumen
       ├─ screen-gastos-admin (***solo admin, ver "Identidad y permisos")
       ├─ screen-ideas
       └─ screen-mantenimiento
screen-negocio (queda casi sin uso con un solo negocio — solo se ve si
  algún día se agrega un segundo negocio a NEGOCIOS)
screen-ajustes → screen-fotos (fotos guardadas)
```
\*\* la pestaña Balance está oculta por default (un solo dueño = balance
siempre trivial); reaparecería sola si `socios.length` pasa a ser > 1.

En `screen-seccion` hay además un botón circular ⚙️ (`#btn-ajustes-shortcut`,
fondo blanco fijo, esquina superior derecha) que salta directo a la pestaña
Ajustes (`switchTab("ajustes")` + `showScreen("screen-app")`), sin pasar por
Gastos primero — mismo patrón que usa `btn-back-to-ajustes` desde "Fotos
guardadas".

## Tema (Auto / Claro / Oscuro)

Ajustes → "Tema" deja elegir entre **Auto** (default, sigue el modo del
sistema operativo), **Claro** y **Oscuro** — estos dos últimos quedan fijos
en ese celular sin importar la configuración del teléfono. Se guarda en
`localStorage` (`gn_theme`) y se aplica poniendo/sacando el atributo
`data-theme` en `<html>` (`seleccionarTema()` en app.js), que es lo que lee
`styles.css`: el bloque `:root[data-theme="dark"]` fuerza oscuro y el
`:not([data-theme="light"])` dentro de `@media (prefers-color-scheme: dark)`
deja que "Claro" (`data-theme="light"`) le gane al sistema. `index.html`
tiene un script inline al principio del `<head>` que aplica el tema guardado
antes de que cargue `styles.css`, para no mostrar un parpadeo del tema del
sistema seguido del elegido. No depende de ninguna API nativa de iOS/Android,
así que funciona igual en ambos.

⚠️ Ojo con este punto si se toca la navegación: como `goToNegocioOrHome()`
saltea `screen-negocio` de una, **Ideas y Mantenimiento necesitan su propio
acceso directo en `screen-seccion`** (ver `SECCIONES` en
`renderSeccionCards()`) — si se sacan de ahí sin dejar otro camino, quedan
con código andando pero inalcanzables desde la UI.

## Exportar datos (CSV)

Ajustes → "Exportar datos" baja gastos y facturación como `.csv` (se abre
en Excel/Sheets), armado en el navegador con un `Blob`, sin librerías.

## Cómo probarlo en local

```bash
npx serve .
# o, si no hay Node instalado:
python -m http.server 5178
```

## Configurar Firebase

La config de Firebase de este negocio (proyecto `frkioskos`) ya viene
incluida en el código (`DEFAULT_FIREBASE_CONFIG` en app.js) — por eso al
abrir la app por primera vez en un celular nuevo no hay que pegar nada,
`attemptReconnect()` la usa sola y entra directo a "¿Quién sos?". La
pantalla de pegar `firebaseConfig` (`screen-setup`) sigue existiendo como
respaldo manual (botón "Configurar de nuevo" si falla la conexión) y para
el caso de arrancar un negocio distinto desde cero:

1. Crear un proyecto nuevo y gratis en `console.firebase.google.com`
   (nunca reusar un proyecto de Firebase que ya esté en uso por otra app).
2. Agregar una app "Web" y copiar el objeto `firebaseConfig`.
3. Activar **Firestore Database** (modo producción) y **Authentication →
   Anonymous**.
4. En Firestore → Reglas: `allow read, write: if request.auth != null;`
5. Activar **Storage** si se van a subir fotos de facturas (requiere plan
   Blaze — tiene cuota gratis amplia).
6. Pegar el `firebaseConfig` nuevo en la pantalla de configuración inicial
   (o reemplazar `DEFAULT_FIREBASE_CONFIG` en app.js si va a ser el
   default para todos los dispositivos).

## Estado del repo

Repositorio git con remoto en GitHub (`seryluli-cmd/FRWEB`). El deploy es
automático: Netlify está conectado a este repo y publica solo con cada
push a `master` — no hace falta generar ni subir ningún `.zip` a mano.
