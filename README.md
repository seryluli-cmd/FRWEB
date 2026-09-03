# Gestion FR

PWA en JavaScript vanilla (sin build, sin frameworks) para que **Gestion FR**
⌨️ registre gastos, facturación diaria y un checklist de ideas/metas del
negocio. La usa el dueño (admin) y sus empleados desde el celular como app
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

- **`config/socios`** (un solo documento) —
  `{ socios: [string], colaboradores: string[], admins: string[], pins: { [nombre]: "1234" } }`.
  `socios` tiene un único nombre (vos, el dueño) y `admins` siempre lo
  incluye — no hay checkbox de admin en el setup porque no hace falta
  elegir. `colaboradores` (empleados) se puede editar después desde Ajustes.
- **`gastos`** — `{ importe, descripcion, categoria, pagadoPor, negocio, fecha, creadoEn, fotoUrl?, fotoPath? }`.
  `categoria` es una de: Kiosko, Bebidas, Panchos, Art Limpieza, Servicios,
  Alquiler, Mantenimiento Gral, Otros (opciones fijas en el `<select>` de
  `index.html`, no se guardan en Firestore).
- **`facturacion`** — `{ importe, turno, registradoPor, negocio, fecha, creadoEn }`.
  `turno` es `"mañana"` | `"tarde"` | `"noche"` (constante `TURNOS` en app.js) —
  de lunes a sábado son 3 turnos por día, cada uno carga su propia caja como
  un cierre separado. `turnoActual()` propone el turno según la hora (mañana
  06-14, tarde 14-22, noche 22-06) al abrir "Nuevo cierre", pero se puede
  cambiar a mano. La pantalla de Facturado suma los de **hoy** aparte
  (`facturado-total-hoy` / `facturado-turnos-hoy`, "X de 3 turnos cargados")
  además del total del mes. El **Resumen mensual** también tiene una
  sección "Facturado por día y turno" que agrupa los cierres del mes por
  día calendario y muestra el total de cada turno dentro de ese día.
  ⚠️ **Excepción: los domingos son distintos** (`esDiaDomingo()` en app.js) —
  ese día solo hay 2 turnos de 12hs en vez de 3, y se muestran con etiquetas
  propias en vez de "Mañana"/"Noche" (ver `turnoLabelParaFecha()`): valor
  `"mañana"` en Firestore se muestra como **"Domingo T1"** (06-18, absorbe
  lo que sería "Tarde", que no existe ese día — el chip se oculta solo en
  el modal según la fecha elegida) y valor `"noche"` se muestra como
  **"Domingo T2"** (18-06 del lunes). El dato guardado sigue siendo
  `"mañana"`/`"noche"` como cualquier otro día — lo único que cambia es la
  etiqueta y el horario. El sábado a la noche sigue siendo el turno normal
  22-06 (termina el domingo a la mañana), eso no cambia.
- **Detección de cajas faltantes** (`turnosDelMesActual()` / `turnoVencimiento()`
  en app.js): la lista de "Cierre de Turno" arma la grilla completa del mes
  en curso (día 1 a hoy, orden Mañana → Tarde → Noche, más reciente
  primero). Cualquier turno cuya ventana + los 40 min de gracia ya pasaron
  y todavía no tiene cierre cargado aparece como fila roja "⚠️ CAJA NO
  CARGADA" con un botón **Cargar** — lo puede usar cualquiera (admin o
  empleado) en cualquier momento, abre "Nuevo cierre" con esa fecha/turno
  ya preseleccionados. Un turno todavía en curso (no venció) simplemente no
  se muestra hasta que se cargue o venza. Esto no se reconstruye para
  meses anteriores a hoy — ahí la lista sigue mostrando solo lo real, sin
  grilla de faltantes.
- **`ideas`** — `{ texto, estado, votos, propuestoPor, creadoEn }`. `estado`
  es `"pendiente"` o `"concretada"`; `votos` es un array de nombres (🔥,
  toggle libre). Pendientes ordenadas por cantidad de votos. Cualquiera
  crea/vota/tilda; solo el admin borra.
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
(vos) ve botones ✏️/🗑️ para editar y borrar gastos/cierres; los empleados
solo cargan y ven.

Además, dos vistas con totales mensuales/históricos son **solo para el
admin** (los empleados no las ven en absoluto, ni la tarjeta para entrar):
- La sección **"Resumen mensual"** (`soloAdmin` en `SECCIONES`, dentro de
  `renderSeccionCards()`) — no aparece como tarjeta para empleados.
- El bloque **"Facturado este mes"** dentro de "Cierre de Turno"
  (`#facturado-total-mes-wrap`, ocultado en `renderFacturado()` según
  `esAdmin`) — los empleados solo ven el total de "Hoy".

⚠️ **No es una capa de seguridad real** — cualquier dispositivo con la
`firebaseConfig` puede leer/escribir todo en Firestore sin pasar por el PIN
de la app. Sirve para identificar quién usa cada celular, no para proteger
los datos de alguien mal intencionado con la config.

## Navegación de pantallas

```
screen-quien-sos (identificarte con PIN)
  └─ screen-seccion (auto-entra directo, un solo negocio — elegir
       Gastos / Facturado / Resumen mensual / Caja de IDEAS)
       ├─ screen-app       (tabs: Gastos, Balance*, Ajustes)
       ├─ screen-facturado
       ├─ screen-resumen
       ├─ screen-ideas
       └─ screen-mantenimiento
screen-negocio (queda casi sin uso con un solo negocio — solo se ve si
  algún día se agrega un segundo negocio a NEGOCIOS)
screen-ajustes → screen-fotos (fotos guardadas)
```
\* la pestaña Balance está oculta por default (un solo dueño = balance
siempre trivial); reaparecería sola si `socios.length` pasa a ser > 1.

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

1. Crear un proyecto nuevo y gratis en `console.firebase.google.com`
   (nunca reusar un proyecto de Firebase que ya esté en uso por otra app).
2. Agregar una app "Web" y copiar el objeto `firebaseConfig`.
3. Activar **Firestore Database** (modo producción) y **Authentication →
   Anonymous**.
4. En Firestore → Reglas: `allow read, write: if request.auth != null;`
5. Activar **Storage** si se van a subir fotos de facturas (requiere plan
   Blaze — tiene cuota gratis amplia).
6. Al abrir la app por primera vez, pegar el `firebaseConfig` en la
   pantalla de configuración inicial.

## Estado del repo

Repositorio git local, sin remoto configurado todavía. El flujo de deploy
es manual: se genera un `.zip` de la carpeta (sin `.git`) y se sube a mano
al hosting.
