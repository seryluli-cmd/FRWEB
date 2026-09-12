// ============================================================
// Utilidades genéricas — funciones puras o de DOM/formato que NO leen ni
// escriben el estado compartido de la app (ver state.js). Primer paso de
// la separación de app.js en módulos: todo lo de acá es autocontenido a
// propósito, así se pudo mover sin tocar ninguna otra parte del código.
// ============================================================

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

export function showScreen(id) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  $("#" + id).classList.add("active");
}

// ---------- Plata ----------
export function money(n) {
  const v = Number(n) || 0;
  return "$" + v.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Inputs de plata (Importe, Efectivo, Digital, Cierre): se muestran con
// punto de miles mientras se tipea (ej. "100.000"), igual que money() ya
// las muestra una vez guardadas — así se nota de un vistazo si faltó o
// sobró un cero. Por eso estos campos son type="text" en el HTML en vez
// de type="number" (que no puede mostrar el punto de miles: lo
// interpretaría como separador decimal). parseMoneyInput()/
// formatMoneyValue() traducen entre el string que ve el usuario (miles con
// ".", decimal con "," — estilo es-AR, igual que money()) y el number con
// el que trabaja el resto del código.
export function parseMoneyInput(str) {
  if (str == null) return NaN;
  const limpio = String(str).trim().replace(/\./g, "").replace(",", ".");
  return limpio === "" ? NaN : parseFloat(limpio);
}

export function formatMoneyValue(n) {
  return Number.isFinite(n) ? n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "";
}

// Filtra lo que se tipea (solo dígitos y una coma decimal) y agrega los
// puntos de miles a medida que se escribe — con "input" (cada tecla), a
// propósito distinto del cálculo cruzado entre campos (calcularCampoMixto
// Faltante / calcularCampoFaltanteFacturado), que va con "change" para no
// calcular a medio tipear. Acá sí tiene que ser instantáneo: si no, el
// punto de miles no se vería mientras se escribe.
export function formatMoneyInputMientrasTipea(e) {
  const el = e.target;
  const cursorAlFinal = el.selectionEnd === el.value.length;
  const comaIdx = el.value.indexOf(",");
  let enteros = (comaIdx === -1 ? el.value : el.value.slice(0, comaIdx)).replace(/\D/g, "");
  const decimales = comaIdx === -1 ? "" : "," + el.value.slice(comaIdx + 1).replace(/\D/g, "").slice(0, 2);
  enteros = enteros.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  el.value = enteros + decimales;
  if (cursorAlFinal) el.setSelectionRange(el.value.length, el.value.length);
}

export function wireMoneyInput(id) {
  $(id).addEventListener("input", formatMoneyInputMientrasTipea);
}

// ---------- Fechas y turnos ----------
export const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
export function mesLabel(date) {
  return `${MESES[date.getMonth()]} ${date.getFullYear()}`;
}
export function fechaDeRegistro(item) {
  return item.fecha && item.fecha.toDate ? item.fecha.toDate() : new Date(item.fecha || Date.now());
}

// Arma un texto "YYYY-MM-DD" (el formato que usa <input type="date">) con
// el año/mes/día LOCALES del dispositivo. A propósito NO se usa
// date.toISOString() para esto: ese método convierte a UTC primero, y
// como Argentina está 3 horas atrás, entre las ~21:00 y la medianoche
// hora local ya es "mañana" en UTC — toISOString() se adelantaba un día
// justo en esas horas (pasaba tanto al cargar un Gasto como un Cierre).
export function fechaLocalISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Ventana de historial que se trae de Firestore para gastos/facturación —
// antes se traía TODO desde el primer día, lo cual iba a ir pesando cada
// vez más (más lecturas facturadas, más tiempo de sincronización, más
// memoria en el celular) a medida que se acumulen meses de uso real. 12
// meses cubre de sobra la navegación mes a mes que ya existe en Gastos/
// Facturado/Resumen (ver gastosMesOffset y afines) sin traer años de
// historia que casi nunca se consultan. Si en algún momento hace falta
// mirar más atrás de esta ventana, ese es un paso aparte (cargar ese mes
// puntual bajo demanda) — no está resuelto todavía.
const HISTORIAL_MESES_CARGADOS = 12;
export function fechaLimiteHistorial() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - (HISTORIAL_MESES_CARGADOS - 1));
  return d;
}

export const TURNOS = ["mañana", "tarde", "noche"];
export const TURNO_LABEL = { "mañana": "Mañana", "tarde": "Tarde", "noche": "Noche" };

// Mañana 06-14, Tarde 14-22, Noche 22-06 (cruza medianoche) — con 40 min de
// gracia: quien cierra el turno anterior tarda un rato en cargarlo, así que
// el turno saliente sigue siendo "el actual" hasta 40 min después de su
// hora nominal de cierre (ej: a las 6:20 todavía propone "noche", no
// "mañana", porque lo más probable es que estén cerrando la noche).
// Domingo es un día como cualquier otro: los mismos 3 turnos, sin excepción.
const TURNO_GRACIA_MIN = 40;

export function turnoLabelParaFecha(fecha, turno) {
  return TURNO_LABEL[turno] || turno;
}

export function turnoActual() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  // > (no >=): a los 40 min exactos todavía es el turno saliente cerrando,
  // recién al minuto 41 se considera empezado el turno siguiente.
  if (mins > 6 * 60 + TURNO_GRACIA_MIN && mins <= 14 * 60 + TURNO_GRACIA_MIN) return "mañana";
  if (mins > 14 * 60 + TURNO_GRACIA_MIN && mins <= 22 * 60 + TURNO_GRACIA_MIN) return "tarde";
  return "noche";
}

// Momento exacto en que un turno de un día calendario dado queda vencido
// (fin de su ventana + los mismos TURNO_GRACIA_MIN de arriba) — se usa para
// saber si YA debería estar cargado o todavía puede estar en curso. Noche
// cruza medianoche, por eso vence a las 06:xx del día SIGUIENTE al que
// arrancó (mismo criterio que fechaParaTurno()).
export function turnoVencimiento(diaBase, turno) {
  const d = new Date(diaBase);
  d.setHours(0, 0, 0, 0);
  if (turno === "mañana") {
    d.setHours(14, TURNO_GRACIA_MIN, 0, 0);
    return d;
  }
  if (turno === "tarde") { d.setHours(22, TURNO_GRACIA_MIN, 0, 0); return d; }
  d.setDate(d.getDate() + 1);
  d.setHours(6, TURNO_GRACIA_MIN, 0, 0);
  return d;
}

// Los turnos de cada día del MES EN CURSO, de día 1 a hoy — el mes
// completo, sin filtrar todavía por si cada turno ya venció. Todos los
// días (incluido domingo) tienen los mismos 3 turnos. Quien arma la
// grilla (renderFacturado) decide caso por caso: con cierre
// real, se muestra tal cual (haya vencido o no su ventana); sin cierre
// real, recién se marca "faltante" si turnoVencimiento() ya pasó — así un
// cierre cargado apenas termina el turno (antes de la gracia) aparece en su
// lugar normal, en vez de quedar afuera de la grilla. No se extiende a
// meses anteriores: ahí ya no tiene sentido reconstruir la grilla
// retroactivamente.
// slots de un mes dado (base = cualquier fecha de ese mes). Si es el mes en
// curso, llega hasta hoy; si es un mes ya cerrado, llega hasta su último día
// — así la detección de "caja no cargada" también funciona navegando atrás.
export function turnosDelMes(base) {
  const now = new Date();
  const esMesActual = base.getMonth() === now.getMonth() && base.getFullYear() === now.getFullYear();
  const dia = new Date(base.getFullYear(), base.getMonth(), 1);
  const fin = esMesActual ? now : new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const slots = [];
  while (dia <= fin) {
    TURNOS.forEach(turno => slots.push({ fecha: new Date(dia), turno }));
    dia.setDate(dia.getDate() + 1);
  }
  return slots;
}

// Fecha "natural" (de calendario) de un turno, para proponerla por
// defecto. Noche es especial porque cruza la medianoche: si todavía no
// arrancó la Noche de HOY, el turno Noche más reciente es el de ANOCHE
// (arrancó ayer) — recién a partir de esa hora pasa a ser el de esta
// noche. Sin este ajuste, cerrar el turno Noche después de medianoche
// quedaba fechado al día (y a veces al MES) siguiente, en vez del día en
// que realmente arrancó. La Noche arranca a las 22hs.
export function fechaParaTurno(turno) {
  const hoy = new Date();
  if (turno === "noche" && hoy.getHours() < 22) {
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    return ayer;
  }
  return hoy;
}

// ---------- Colores ----------
const SERIES_VARS = ["--series-1", "--series-2", "--series-3"];
export function socioColorVar(index) {
  return `var(${SERIES_VARS[index % SERIES_VARS.length]})`;
}

// Color de identidad estable por nombre: un hash simple del string a un
// matiz HSL. Así cada colaborador tiene siempre el mismo color (no cambia
// si se reordena el array), sin depender de una paleta fija de 3 colores.
export function colorDesdeNombre(name) {
  let hash = 0;
  const str = name || "";
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 55%, 45%)`;
}

export function socioInitial(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

export function setSyncOffline(isOffline) {
  $$(".sync-dot").forEach(d => d.classList.toggle("offline", isOffline));
}

export function votosDe(idea) {
  return Array.isArray(idea.votos) ? idea.votos : [];
}

// ---------- Otros ----------
// Todo texto que viene de Firestore (descripción, nombres) pasa por acá antes
// de insertarse con innerHTML, para evitar XSS. Cualquier campo de texto
// nuevo que se agregue a un template debe escaparse igual.
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

export function downloadCSV(filename, rows) {
  const csv = rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
  // BOM al principio para que Excel detecte UTF-8 y no rompa los acentos.
  const BOM = String.fromCharCode(0xFEFF);
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Si Storage no responde (bucket no activado, reglas, red que ni siquiera
// llega a fallar), uploadBytes/getDownloadURL pueden quedar la promesa
// colgada para siempre — el botón "Subiendo foto…" no volvía nunca y no
// había forma de reintentar. Este timeout garantiza que siempre termine.
export function conTimeout(promise, ms, mensajeTimeout) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(mensajeTimeout)), ms))
  ]);
}

// Redimensiona y comprime la foto en el navegador antes de subirla, para que
// no pese varios MB (como sale de la cámara) sino unos cientos de KB.
export function compressImage(file, maxDim = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) resolve(blob);
        else reject(new Error("No se pudo procesar la imagen."));
      }, "image/jpeg", quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };
    img.src = url;
  });
}

export function parseFirebaseConfig(raw) {
  if (!raw || !raw.trim()) throw new Error("Pegá la configuración de Firebase.");
  let block = raw;
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
    block = raw.slice(braceStart, braceEnd + 1);
  }
  const config = {};
  const re = /["']?([A-Za-z0-9_]+)["']?\s*:\s*["']([^"']*)["']/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    config[m[1]] = m[2];
  }
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  const missing = required.filter(k => !config[k]);
  if (missing.length) {
    throw new Error("Faltan datos en la configuración: " + missing.join(", "));
  }
  return config;
}
