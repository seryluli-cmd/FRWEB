// ============================================================
// Estado compartido de la app — variables que varias pantallas leen Y
// reescriben (gastos, usuarioActual, db, etc.). Van agrupadas en un solo
// objeto `state` en vez de sueltas: un módulo ES no puede reasignar una
// variable importada de otro archivo (solo mutar sus propiedades), así
// que en vez de `gastos = [...]` en cada módulo, ahora es `state.gastos =
// [...]` — mismo comportamiento, pero compartible entre archivos.
// Los `const` de acá abajo (config fija, nunca se reasignan) SÍ se pueden
// importar sueltos, sin pasar por `state`.
// ============================================================

// Config de Firebase de este negocio (proyecto "frkioskos") — es la misma
// para todos los dispositivos (vos, Pola, colaboradores), así que viene
// incluida de una vez y nadie tiene que pegarla a mano en el primer
// inicio (ver attemptReconnect). Si algún día hace falta cambiar de
// proyecto, alcanza con reemplazar este objeto.
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBE5i2QK0HD2bKQ-ctfYycam9QC_McmxNs",
  authDomain: "frkioskos.firebaseapp.com",
  projectId: "frkioskos",
  storageBucket: "frkioskos.firebasestorage.app",
  messagingSenderId: "493900046824",
  appId: "1:493900046824:web:c007a2e4577e8e4b06c45d"
};
export const LS_CONFIG_KEY = "gn_firebaseConfig";
export const LS_SOCIOS_CACHE = "gn_socios_cache";
export const LS_COLAB_CACHE = "gn_colaboradores_cache";
export const LS_USER_KEY = "gn_current_user"; // quién está identificado en este celular
export const LS_THEME_KEY = "gn_theme"; // "auto" (default, sigue el sistema) | "light" | "dark"
export const NEUTRAL_VAR = "var(--text-muted)";

// Un solo negocio acá. Si algún día se suma un segundo negocio, alcanza con
// agregar otro objeto acá — el resto del código ya soporta N negocios; lo
// único que cambia es que goToNegocioOrHome() deja de saltear la pantalla
// de elegir negocio en cuanto el array tiene más de un elemento.
export const NEGOCIOS = [
  { id: "gestionfr", nombre: "Gestion FR", emoji: "⌨️", color: "var(--series-1)" }
];

// Cifra fija que pidió Sergio (el inversor) para "Inversión Recuperada" —
// el total a recuperar del negocio. No hay pantalla para editarla porque
// es un dato del acuerdo, no algo que cambie desde la operación diaria.
export const INVERSION_META = 55000000;

// Categorías de gasto: lista editable por los admin desde Ajustes →
// "Categorías de gastos" (ver renderAjustesCategorias) — simples nombres,
// sin ninguna noción de privacidad acá (eso ahora es por gasto individual,
// ver `soloAdmin` en el gasto más abajo, no en la categoría). Se guardan
// en Firestore (config/socios, campo categoriasGastos) para que los admin
// puedan crear/borrar una categoría sin tocar código — ver listenSocios().
// CATEGORIAS_GASTOS_DEFAULT es la semilla para instalaciones viejas que
// todavía no tienen ese campo.
export const CATEGORIAS_GASTOS_DEFAULT = [
  "Kiosko", "Bebidas", "Panchos", "Art Limpieza", "Servicios",
  "Alquiler", "Mantenimiento Gral", "Sueldos", "Otros"
];

export const MAX_FOTOS_GASTO = 5; // una factura de varias hojas puede necesitar más de una foto — ver fotosDeGasto()
export const FOTO_RETENCION_DIAS = 120; // ~4 meses — pasado esto, se borra sola la foto (no el gasto)

export const state = {
  fbSdk: null, // { initializeApp, getAuth, signInAnonymously, onAuthStateChanged, getFirestore, ... }
  fbApp: null, auth: null, db: null, storage: null,

  categoriasGastos: CATEGORIAS_GASTOS_DEFAULT,
  categoriasGastosSembrado: false, // evita reescribir el default más de una vez por sesión

  fotosGastoModal: [], // fotos del gasto que se está cargando/editando, en el orden del modal — cada una { tipo:"existente", url, path } (ya estaba guardada) o { tipo:"nueva", blob, previewUrl } (recién elegida, falta subir)
  fotosGastoABorrar: [], // paths de Storage de fotos existentes que se sacaron en este modal — se borran recién si se confirma "Guardar" (cancelar el modal no borra nada)
  selectedFotoFacturadoBlob: null, // foto comprimida, lista para subir (modal de Cierre de Turno — sigue siendo una sola, no forma parte de este cambio)
  fotosLimpiezaHecha: false,

  socios: [],           // ["Sergio"] — el/los dueño(s), entran en el reparto (acá siempre 1)
  colaboradores: [],    // ["Encargada"] — pueden pagar/cargar, NO entran en el reparto
  admins: [],           // subconjunto de nombres (normalmente socios) con permiso para editar/borrar
  pins: {},             // { "Sergio": "1234", ... } — PIN fijo de 4 dígitos por persona (ver README: no es seguridad real, solo identificación)
  claveMaestraAdmin: "", // clave compartida entre los admins, solo para CREAR su PIN la primera vez
                          // en un celular nuevo (ver openPinModal/confirmPinModal) — evita que cualquiera
                          // tocando el nombre de un admin por primera vez se autoasigne ese PIN sin saberla.
                          // Si no está configurada (vacía), no se pide — no es seguridad real, ver README.

  gastos: [],           // TODOS los gastos — [{id, importe, descripcion, categoria, pagadoPor, fecha, negocio}]
  facturaciones: [],    // TODOS los cierres diarios — [{id, importe, registradoPor, fecha, negocio}]
  ideas: [],            // Ideas de mejora — [{id, texto, estado, propuestoPor, creadoEn}]
  reportes: [],         // Reportes de mantenimiento — [{id, texto, estado, propuestoPor, votos, creadoEn}]
  inversiones: [],      // Historial de "Inversión Recuperada" — [{id, monto, registradoPor, creadoEn}]. `monto` es el TOTAL acumulado a esa fecha, no un incremento.

  negocioActual: null,  // "gestionfr" (siempre — acá hay un solo negocio)
  seccionActual: null,  // "gastos" | "facturado" | "resumen"
  selectedPagador: null,
  selectedRegistrador: null,
  selectedTurno: null, // "mañana" | "tarde" | "noche" — turno del cierre que se está cargando

  resumenMesOffset: 0,  // 0 = mes actual, -1 = mes anterior, etc. (Resumen mensual)
  gastosMesOffset: 0,   // ídem, para la pantalla de Gastos — se reinicia a 0 cada vez que se entra
  facturadoMesOffset: 0, // ídem, para la pantalla de Facturado/Cierre de turno
  gastosAdminMesOffset: 0, // ídem, para la pantalla de Gastos S/Admin

  pendingFirebaseConfig: null, // config guardada entre el paso 1 y 2 del setup inicial
  usuarioActual: null,  // nombre con el que se identificó este celular (ver resumeSession)
  esAdmin: false,       // usuarioActual ∈ admins

  editingGastoId: null,      // id del gasto que se está editando en el modal, o null si es uno nuevo
  selectedFormaPago: "efectivo", // "efectivo" | "digital" | "mixto" — elegido en el modal de gasto
  mixtoUltimoEditado: null,  // "efectivo" | "digital" | null — cuál de los 2 campos del desglose se tipeó a mano por última vez (el otro se recalcula solo)
  editingCierreId: null,     // id del cierre que se está editando en el modal, o null si es uno nuevo

  pinFlowNombre: null,  // nombre para el que está abierto el modal de PIN
  pinFlowMode: null,    // "create" (todavía no tiene PIN) | "verify" (ya tiene uno)

  visorFotosLista: [],
  visorFotosIndex: 0,

  facturadoUltimosEditados: [],
  deferredInstallPrompt: null,
};
