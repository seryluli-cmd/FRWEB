// ============================================================
// Conexión a Firebase — carga del SDK, autenticación anónima, y el
// primer chequeo/siembra del documento config/socios.
// ============================================================
import { state, LS_CONFIG_KEY, LS_SOCIOS_CACHE, LS_COLAB_CACHE, CATEGORIAS_GASTOS_DEFAULT } from "./state.js";

// El SDK de Firebase se importa de forma DINÁMICA (recién cuando hace
// falta conectar) para que la app nunca quede colgada en "Cargando…"
// si la red está lenta o falla al abrir la app.
const FB_VERSION = "10.12.2";

export async function loadFirebaseSdk() {
  if (state.fbSdk) return state.fbSdk;
  let appMod, authMod, fsMod, stMod;
  try {
    [appMod, authMod, fsMod, stMod] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`),
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-storage.js`)
    ]);
  } catch (e) {
    console.error("Error cargando SDK de Firebase:", e);
    throw new Error("No se pudo conectar a internet para cargar Firebase. Revisá tu conexión e intentá de nuevo.");
  }
  state.fbSdk = {
    initializeApp: appMod.initializeApp,
    getApps: appMod.getApps,
    deleteApp: appMod.deleteApp,
    getAuth: authMod.getAuth,
    signInAnonymously: authMod.signInAnonymously,
    onAuthStateChanged: authMod.onAuthStateChanged,
    getFirestore: fsMod.getFirestore,
    collection: fsMod.collection,
    addDoc: fsMod.addDoc,
    deleteDoc: fsMod.deleteDoc,
    onSnapshot: fsMod.onSnapshot,
    query: fsMod.query,
    orderBy: fsMod.orderBy,
    where: fsMod.where,
    doc: fsMod.doc,
    getDoc: fsMod.getDoc,
    getDocs: fsMod.getDocs,
    setDoc: fsMod.setDoc,
    updateDoc: fsMod.updateDoc,
    increment: fsMod.increment,
    deleteField: fsMod.deleteField,
    arrayUnion: fsMod.arrayUnion,
    arrayRemove: fsMod.arrayRemove,
    serverTimestamp: fsMod.serverTimestamp,
    enableIndexedDbPersistence: fsMod.enableIndexedDbPersistence,
    getStorage: stMod.getStorage,
    ref: stMod.ref,
    uploadBytes: stMod.uploadBytes,
    getDownloadURL: stMod.getDownloadURL,
    deleteObject: stMod.deleteObject
  };
  return state.fbSdk;
}

// Convierte categorías del formato viejo {nombre, soloAdmin} (privacidad
// por categoría, commit 3273b8c, reemplazado horas después por el checkbox
// "Gasto Admin" por gasto — ver "Rediseñar gastos privados" en README) a
// simples nombres. Documentos de Firestore que quedaron con ese formato
// antes del rediseño llegan acá tal cual; filtra cualquier entrada que no
// se pueda recuperar.
export function normalizarCategoriasGastos(raw) {
  return raw
    .map(c => typeof c === "string" ? c : (c && typeof c.nombre === "string" ? c.nombre : null))
    .filter(Boolean);
}

export async function initFirebase(config) {
  const sdk = await loadFirebaseSdk();

  // Si un intento anterior (en esta misma carga de página) ya inicializó
  // Firebase y falló más adelante (ej. clave inválida), hay que limpiar
  // esa app antes de reintentar, o Firebase tira "app/duplicate-app".
  const existing = sdk.getApps();
  if (existing.length) {
    await Promise.all(existing.map(a => sdk.deleteApp(a).catch(() => {})));
  }

  state.fbApp = sdk.initializeApp(config);
  state.auth = sdk.getAuth(state.fbApp);
  state.db = sdk.getFirestore(state.fbApp);
  state.storage = sdk.getStorage(state.fbApp);
  try {
    await sdk.enableIndexedDbPersistence(state.db);
  } catch (e) {
    // persistence puede fallar en pestañas múltiples o navegadores viejos; no es crítico
    console.warn("Persistencia offline no disponible:", e.message);
  }
  await new Promise((resolve, reject) => {
    sdk.signInAnonymously(state.auth).catch(reject);
    sdk.onAuthStateChanged(state.auth, (user) => {
      if (user) resolve(user);
    });
  });
}

// onBoot se llama al final, una vez que config/socios ya está cargado (o
// recién creado) en `state` — hoy dispara bootApp(), que sigue en app.js y
// arranca los listeners de todas las pantallas. Un callback en vez de
// importar bootApp acá evita una dependencia circular firebase.js↔app.js.
export async function connectAndBoot(config, namesFromInput, colabFromInput, onBoot) {
  await initFirebase(config);
  const sdk = state.fbSdk;

  const socioDocRef = sdk.doc(state.db, "config", "socios");
  const snap = await sdk.getDoc(socioDocRef);

  if (snap.exists() && Array.isArray(snap.data().socios) && snap.data().socios.length > 0) {
    const data = snap.data();
    state.socios = data.socios;
    state.colaboradores = Array.isArray(data.colaboradores) ? data.colaboradores : [];
    state.admins = Array.isArray(data.admins) ? data.admins : [];
    state.pins = data.pins && typeof data.pins === "object" ? data.pins : {};
    state.claveMaestraAdmin = typeof data.claveMaestraAdmin === "string" ? data.claveMaestraAdmin : "";
    if (Array.isArray(data.categoriasGastos)) {
      state.categoriasGastos = normalizarCategoriasGastos(data.categoriasGastos);
      if (data.categoriasGastos.some(c => typeof c !== "string")) {
        // Quedó guardado en el formato viejo {nombre, soloAdmin} — se
        // reescribe ya corregido para que no vuelva a pasar.
        await sdk.updateDoc(socioDocRef, { categoriasGastos: state.categoriasGastos }).catch(() => {});
      }
    } else {
      // Instalación de antes de que existiera este campo — se siembra una
      // sola vez con el default, para que quede persistido en Firestore.
      state.categoriasGastosSembrado = true;
      state.categoriasGastos = CATEGORIAS_GASTOS_DEFAULT;
      await sdk.updateDoc(socioDocRef, { categoriasGastos: state.categoriasGastos }).catch(() => {});
    }
  } else {
    if (!namesFromInput || namesFromInput.some(n => !n.trim())) {
      throw new Error("Completá tu nombre.");
    }
    state.socios = namesFromInput.map(n => n.trim());
    state.colaboradores = (colabFromInput || []).map(n => n.trim()).filter(Boolean);
    state.admins = [];
    state.pins = {};
    state.claveMaestraAdmin = "llavez";
    state.categoriasGastos = CATEGORIAS_GASTOS_DEFAULT;
    state.categoriasGastosSembrado = true;
    await sdk.setDoc(socioDocRef, { socios: state.socios, colaboradores: state.colaboradores, admins: state.admins, pins: state.pins, claveMaestraAdmin: state.claveMaestraAdmin, categoriasGastos: state.categoriasGastos });
  }

  localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(config));
  localStorage.setItem(LS_SOCIOS_CACHE, JSON.stringify(state.socios));
  localStorage.setItem(LS_COLAB_CACHE, JSON.stringify(state.colaboradores));

  onBoot();
}
