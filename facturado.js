// ============================================================
// Facturado / Cierre de Turno — carga de cajas por turno, detección de
// turnos faltantes, foto opcional del cierre, exportar CSV.
// ============================================================
import { state } from "./state.js";
import {
  $, $$, showToast, escapeHtml, fechaDeRegistro, fechaLocalISO, fechaLimiteHistorial, mesLabel,
  money, parseMoneyInput, formatMoneyValue, socioInitial, setSyncOffline, conTimeout, downloadCSV,
  TURNOS, turnoLabelParaFecha, turnoActual, turnoVencimiento, turnosDelMes, fechaParaTurno
} from "./utils.js";
import { payerColorVar } from "./identidad.js";

export function facturacionesDelNegocio() {
  return state.facturaciones.filter(f => f.negocio === state.negocioActual);
}

// onCambio se llama después de cada snapshot con datos nuevos — hoy
// dispara renderResumen(), que todavía vive en app.js (mismo patrón que
// listenGastos() en gastos.js, ver ese comentario).
export function listenFacturacion(onCambio) {
  const q = state.fbSdk.query(
    state.fbSdk.collection(state.db, "facturacion"),
    state.fbSdk.where("fecha", ">=", fechaLimiteHistorial()),
    state.fbSdk.orderBy("fecha", "desc")
  );
  state.fbSdk.onSnapshot(q, (snapshot) => {
    state.facturaciones = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFacturado();
    if (onCambio) onCambio();
    setSyncOffline(false);
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

// Fila de un cierre YA cargado (id real en Firestore).
function renderCierreItem(f) {
  const fecha = fechaDeRegistro(f);
  const fotoBtn = f.fotoUrl
    ? `<button type="button" class="foto-link" data-url="${escapeHtml(f.fotoUrl)}" aria-label="Ver foto del cierre">📷</button>`
    : "";
  const adminBtns = state.esAdmin
    ? `<button type="button" class="icon-btn cierre-edit-btn" data-id="${f.id}" aria-label="Editar cierre">✏️</button>
       <button type="button" class="icon-btn danger cierre-delete-btn" data-id="${f.id}" aria-label="Borrar cierre">🗑️</button>`
    : "";
  const turnoLabel = turnoLabelParaFecha(fecha, f.turno);

  // "creadoEn" es la hora REAL en que se guardó el cierre (a diferencia
  // de "fecha", que es solo el día elegido, guardado siempre al
  // mediodía — ver saveCierre). Los cierres de antes de este cambio no
  // tienen "creadoEn", por eso el chequeo: en esos casos no se muestra
  // ninguna hora en vez de mostrar una incorrecta.
  const horaCarga = f.creadoEn && f.creadoEn.toDate
    ? f.creadoEn.toDate().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;

  const li = document.createElement("li");
  li.className = "expense-item";
  // Acá los íconos se quedan en la misma fila que el texto (a diferencia
  // de Gastos) — el texto de un cierre es corto y no necesita el ancho
  // extra, así que no hacía falta separarlos en .expense-item-actions.
  li.innerHTML = `
    <div class="expense-item-top">
      <div class="avatar" style="background:${payerColorVar(f.registradoPor)}">${socioInitial(f.registradoPor)}</div>
      <div class="info">
        <div class="desc">${turnoLabel ? escapeHtml(turnoLabel) + " — " : ""}${fecha.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "short" })}</div>
        <div class="meta">Cargado por ${escapeHtml(f.registradoPor || "?")}${horaCarga ? " a las " + horaCarga : ""}</div>
      </div>
      <div class="amount">${money(f.importe)}</div>
      ${fotoBtn}
      ${adminBtns}
    </div>
  `;
  return li;
}

// Fila de un turno del mes en curso ya vencido (ver turnosDelMesActual)
// que todavía no tiene cierre cargado. El botón "Cargar" abre el modal de
// Nuevo cierre con esa fecha y turno ya preseleccionados — cualquiera puede
// tocarlo (admin o colaborador), igual que cualquiera puede cargar un cierre
// nuevo con el +.
function renderCierreFaltante(fecha, turno) {
  const li = document.createElement("li");
  li.className = "expense-item expense-item-faltante";
  li.innerHTML = `
    <div class="expense-item-top">
      <div class="info">
        <div class="desc falta-desc">⚠️ CAJA NO CARGADA</div>
        <div class="meta">${escapeHtml(turnoLabelParaFecha(fecha, turno))} — ${fecha.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "short" })}</div>
      </div>
      <button type="button" class="btn-secondary btn-cargar-faltante" data-fecha="${fechaLocalISO(fecha)}" data-turno="${turno}">Cargar</button>
    </div>
  `;
  return li;
}

// Fecha base del mes elegido en la pantalla de Facturado (ver
// facturadoMesOffset) — mismo patrón que gastosFechaBase().
function facturadoFechaBase() {
  const d = new Date();
  d.setDate(1); // evita saltos raros de mes al sumar/restar meses
  d.setMonth(d.getMonth() + state.facturadoMesOffset);
  return d;
}

// Antes la grilla de turnos era siempre la del mes en curso, y todo el
// historial de meses anteriores se listaba entero debajo, sin agrupar —
// con el tiempo se iba acumulando y quedaba todo mezclado. Ahora, igual
// que Gastos, se navega un mes a la vez (con flechas ‹ ›), y la grilla de
// "caja no cargada" se recalcula para el mes que se esté mirando.
export function renderFacturado() {
  const list = $("#facturado-list");
  const empty = $("#facturado-empty");
  list.innerHTML = "";

  const items = facturacionesDelNegocio();
  const now = new Date();

  // "Hoy" es siempre el día real, sin importar qué mes se esté navegando.
  let totalHoy = 0;
  const turnosHoy = new Set();
  items.forEach(f => {
    const fecha = fechaDeRegistro(f);
    if (fecha.toDateString() === now.toDateString()) {
      totalHoy += Number(f.importe) || 0;
      if (TURNOS.includes(f.turno)) turnosHoy.add(f.turno);
    }
  });

  const base = facturadoFechaBase();
  const targetMonth = base.getMonth();
  const targetYear = base.getFullYear();
  $("#facturado-mes-label").textContent = mesLabel(base);
  const esMesActual = targetMonth === now.getMonth() && targetYear === now.getFullYear();
  $("#btn-facturado-mes-siguiente").disabled = esMesActual;

  const itemsMes = items.filter(f => {
    const fecha = fechaDeRegistro(f);
    return fecha.getMonth() === targetMonth && fecha.getFullYear() === targetYear;
  });
  const totalMes = itemsMes.reduce((sum, f) => sum + (Number(f.importe) || 0), 0);

  // Mapa "año-mes-día-turno" -> cierre real, para cruzarlo contra la
  // grilla de turnos esperados del mes y saber cuáles faltan.
  const porSlot = new Map();
  itemsMes.forEach(f => {
    const fecha = fechaDeRegistro(f);
    porSlot.set(`${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}-${f.turno}`, f);
  });

  // Grilla del mes elegido: día 1 hasta hoy (o hasta fin de mes si ya
  // pasó), más reciente primero, y dentro de cada día en orden Mañana →
  // Tarde → Noche. Cada slot ya vencido sale como cierre real o faltante.
  const porDia = new Map(); // "año-mes-día" -> { fecha, turnos: [{turno, real}] }
  turnosDelMes(base).forEach(({ fecha, turno }) => {
    const diaKey = `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}`;
    if (!porDia.has(diaKey)) porDia.set(diaKey, { fecha, turnos: [] });
    porDia.get(diaKey).turnos.push({ turno, real: porSlot.get(`${diaKey}-${turno}`) || null });
  });
  const diasDelMes = Array.from(porDia.values()).sort((a, b) => b.fecha - a.fecha);

  const idsEnGrilla = new Set();
  diasDelMes.forEach(dia => dia.turnos.forEach(t => { if (t.real) idsEnGrilla.add(t.real.id); }));

  // Cierres del mes que no encajaron en la grilla (ej. turno con valor
  // no estándar por datos viejos) — se listan igual, para no perderlos.
  const restoDelMes = itemsMes
    .filter(f => !idsEnGrilla.has(f.id))
    .slice()
    .sort((a, b) => fechaDeRegistro(b) - fechaDeRegistro(a));

  diasDelMes.forEach(dia => {
    dia.turnos.forEach(({ turno, real }) => {
      if (real) {
        list.appendChild(renderCierreItem(real));
      } else if (turnoVencimiento(dia.fecha, turno) <= now) {
        list.appendChild(renderCierreFaltante(dia.fecha, turno));
      }
      // si no venció y no hay cierre real, todavía está en curso: no se muestra nada.
    });
  });
  restoDelMes.forEach(f => list.appendChild(renderCierreItem(f)));

  empty.classList.toggle("hidden", list.children.length > 0);

  $("#facturado-total-mes-wrap").classList.toggle("hidden", !state.esAdmin);
  $("#facturado-total-mes").textContent = money(totalMes);
  $("#facturado-total-hoy").textContent = money(totalHoy);
  $("#facturado-turnos-hoy").textContent = `${turnosHoy.size} de ${TURNOS.length} turnos cargados`;
}

// Chips de "¿Quién lo cargó?" en el modal de Facturado.
export function renderPagadorChipsFacturado() {
  const wrap = $("#pagador-options-fact");
  wrap.innerHTML = "";
  state.socios.concat(state.colaboradores).forEach((nombre) => {
    const chip = document.createElement("div");
    chip.className = "pagador-chip";
    chip.textContent = nombre;
    chip.style.setProperty("--chip-color", payerColorVar(nombre));
    chip.addEventListener("click", () => {
      state.selectedRegistrador = nombre;
      wrap.querySelectorAll(".pagador-chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
    });
    wrap.appendChild(chip);
  });
}

export function exportFacturacionCSV() {
  const rows = [["Fecha", "Importe", "Registrado por"]];
  facturacionesDelNegocio()
    .slice()
    .sort((a, b) => fechaDeRegistro(a) - fechaDeRegistro(b))
    .forEach(f => {
      rows.push([
        fechaDeRegistro(f).toLocaleDateString("es-AR"),
        Number(f.importe) || 0,
        f.registradoPor || ""
      ]);
    });
  downloadCSV(`facturacion-${state.negocioActual}-${fechaLocalISO(new Date())}.csv`, rows);
}

export function resetFotoFieldFact() {
  state.selectedFotoFacturadoBlob = null;
  $("#input-foto-fact").value = "";
  $("#foto-preview-wrap-fact").classList.add("hidden");
  $("#foto-btns-row-fact").classList.remove("hidden");
}

export function setDefaultFechaFact() {
  $("#input-fecha-fact").value = fechaLocalISO(fechaParaTurno(turnoActual()));
}

// Sincroniza qué chip de turno queda marcado como seleccionado según
// selectedTurno. Se llama al abrir el modal y cada vez que se cambia la
// fecha a mano.
export function actualizarChipsTurnoPorFecha() {
  $$("#turno-options .pagador-chip").forEach(c => c.classList.toggle("selected", c.dataset.turno === state.selectedTurno));
}

// Sin argumento: alta de un cierre nuevo (usa el turno/fecha "actuales").
// Con un cierre existente: edición (solo admin, ver botón ✏️ en
// renderFacturado). Con "preset" ({fecha, turno}): alta de un cierre para
// una caja marcada como faltante — ver botón "Cargar" en
// renderCierreFaltante, cualquiera puede usarlo en cualquier momento.
// Cálculo cruzado Total/Efectivo/Digital: se pueden completar 2
// cualquiera de los 3 campos y el que falta se calcula solo (mismo
// patrón que GESTIONEGOCIOS). facturadoUltimosEditados guarda, en
// orden, los últimos 2 campos que se tipearon A MANO (no los que ya se
// autocompletaron) — con esos 2 se sabe cuál es el tercero a calcular.
// Se reinicia cada vez que se abre el modal (ver openModalFacturado()).

const FACTURADO_CAMPO_ID = {
  total: "input-importe-fact",
  efectivo: "input-efectivo-fact",
  digital: "input-digital-fact",
};

export function registrarEdicionManualFacturado(campo) {
  state.facturadoUltimosEditados = state.facturadoUltimosEditados.filter(c => c !== campo);
  state.facturadoUltimosEditados.push(campo);
  if (state.facturadoUltimosEditados.length > 2) state.facturadoUltimosEditados.shift();
  calcularCampoFaltanteFacturado();
}

function calcularCampoFaltanteFacturado() {
  if (state.facturadoUltimosEditados.length < 2) return; // todavía no hay 2 campos como para deducir el tercero
  const valores = {
    total: parseMoneyInput($("#input-importe-fact").value),
    efectivo: parseMoneyInput($("#input-efectivo-fact").value),
    digital: parseMoneyInput($("#input-digital-fact").value),
  };
  const [a, b] = state.facturadoUltimosEditados;
  if (!Number.isFinite(valores[a]) || !Number.isFinite(valores[b])) return;

  const faltante = ["total", "efectivo", "digital"].find(c => c !== a && c !== b);
  const resultado = faltante === "total" ? valores.efectivo + valores.digital
    : faltante === "efectivo" ? valores.total - valores.digital
    : valores.total - valores.efectivo;

  // Se muestra el resultado tal cual, incluso si da negativo (ej.
  // pusiste más Efectivo que Total) — así se nota el error a simple
  // vista en vez de desaparecer solo; saveCierre() lo bloquea al guardar.
  $("#" + FACTURADO_CAMPO_ID[faltante]).value = formatMoneyValue(Math.round(resultado * 100) / 100);
}

export function openModalFacturado(cierre, preset) {
  state.editingCierreId = cierre ? cierre.id : null;
  // Mismo criterio que en Nuevo gasto (ver openModal): un cierre nuevo
  // queda a nombre de quien está identificado en este celular, sin
  // preguntar. Al editar uno existente sí se puede reasignar.
  state.selectedRegistrador = cierre ? cierre.registradoPor : state.usuarioActual;
  state.selectedTurno = cierre ? (cierre.turno || null) : (preset ? preset.turno : turnoActual());

  $("#input-importe-fact").value = cierre ? formatMoneyValue(cierre.importe) : "";
  // Cierres cargados ANTES de que existiera el desglose Efectivo/Digital
  // no tienen esos campos guardados — quedan en blanco para que se
  // completen de nuevo (no se puede inventar cómo se repartía antes).
  $("#input-efectivo-fact").value = cierre && cierre.efectivo != null ? formatMoneyValue(cierre.efectivo) : "";
  $("#input-digital-fact").value = cierre && cierre.digital != null ? formatMoneyValue(cierre.digital) : "";
  state.facturadoUltimosEditados = [];
  if (cierre) {
    $("#input-fecha-fact").value = fechaLocalISO(fechaDeRegistro(cierre));
  } else if (preset) {
    $("#input-fecha-fact").value = preset.fecha;
  } else {
    setDefaultFechaFact();
  }

  $("#modal-fact-title").textContent = cierre ? "Editar cierre" : "Nuevo cierre";
  $("#btn-save-facturado").textContent = cierre ? "Guardar cambios" : "Guardar";
  $("#campo-pagador-fact").classList.toggle("hidden", !cierre);
  $$("#pagador-options-fact .pagador-chip").forEach(c => c.classList.toggle("selected", c.textContent === state.selectedRegistrador));
  actualizarChipsTurnoPorFecha();
  resetFotoFieldFact(); // editar un cierre no toca su foto salvo que se elija una nueva
  $("#modal-fact-error").classList.add("hidden");
  $("#modal-add-facturado").classList.add("active");
  setTimeout(() => $("#input-importe-fact").focus(), 150);
}

export function closeModalFacturado() {
  $("#modal-add-facturado").classList.remove("active");
  state.editingCierreId = null;
}

export async function saveCierre() {
  const totalStr = $("#input-importe-fact").value.trim();
  const efectivoStr = $("#input-efectivo-fact").value.trim();
  const digitalStr = $("#input-digital-fact").value.trim();
  const importe = parseMoneyInput(totalStr);
  const efectivo = parseMoneyInput(efectivoStr);
  const digital = parseMoneyInput(digitalStr);
  const fechaStr = $("#input-fecha-fact").value;
  const errEl = $("#modal-fact-error");

  // Los 3 campos se autocompletan entre sí (ver calcularCampoFaltanteFacturado)
  // pero igual hay que exigir que terminen los 3 con un valor antes de
  // guardar (ej. si se borra uno a mano después de que se completó solo).
  if (totalStr === "") {
    errEl.textContent = "Falta llenar el Total.";
    errEl.classList.remove("hidden");
    return;
  }
  if (efectivoStr === "") {
    errEl.textContent = "Falta llenar el Efectivo.";
    errEl.classList.remove("hidden");
    return;
  }
  if (digitalStr === "") {
    errEl.textContent = "Falta llenar el Digital.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!importe || importe <= 0) {
    errEl.textContent = "Ingresá un importe válido.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!Number.isFinite(efectivo) || !Number.isFinite(digital) || efectivo < 0 || digital < 0) {
    errEl.textContent = "Efectivo y Digital tienen que ser números válidos (0 o más).";
    errEl.classList.remove("hidden");
    return;
  }
  // Por las dudas se hayan tipeado los 3 campos a mano sin dejar que se
  // autocompletara ninguno: se valida que sumen el total antes de
  // guardar, en vez de confiar ciegamente en el cálculo cruzado.
  if (Math.abs(efectivo + digital - importe) > 0.01) {
    errEl.textContent = "Efectivo + Digital no coincide con el Total. Revisá los montos.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!state.selectedTurno) {
    errEl.textContent = "Elegí el turno.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!state.selectedRegistrador) {
    errEl.textContent = "Elegí quién lo cargó.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("#btn-save-facturado");
  const isEdit = !!state.editingCierreId;
  btn.disabled = true;
  btn.textContent = state.selectedFotoFacturadoBlob ? "Subiendo foto…" : "Guardando…";

  try {
    // Mismo criterio que saveGasto(): si la foto falla o tarda demasiado,
    // el cierre se guarda igual sin ella — mejor un cierre sin foto que
    // un cierre perdido.
    let fotoUrl = null, fotoPath = null, fotoFallo = false;
    if (state.selectedFotoFacturadoBlob) {
      try {
        fotoPath = `cierres/${state.negocioActual}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const storageRef = state.fbSdk.ref(state.storage, fotoPath);
        const TIMEOUT_MSG = "La subida de la foto tardó demasiado.";
        await conTimeout(
          state.fbSdk.uploadBytes(storageRef, state.selectedFotoFacturadoBlob, { contentType: "image/jpeg" }),
          25000,
          TIMEOUT_MSG
        );
        fotoUrl = await conTimeout(state.fbSdk.getDownloadURL(storageRef), 15000, TIMEOUT_MSG);
      } catch (fotoErr) {
        console.error("No se pudo subir la foto, se guarda el cierre sin ella:", fotoErr);
        fotoFallo = true;
        fotoPath = null;
      }
      btn.textContent = "Guardando…";
    }

    const data = {
      importe,
      efectivo,
      digital,
      turno: state.selectedTurno,
      registradoPor: state.selectedRegistrador,
      negocio: state.negocioActual,
      fecha: fechaStr ? new Date(fechaStr + "T12:00:00") : state.fbSdk.serverTimestamp()
    };
    // Solo se tocan fotoUrl/fotoPath si se eligió una foto nueva — al
    // editar, updateDoc no toca los campos que no se le pasan, así que la
    // foto existente queda intacta si no se cambia.
    if (fotoUrl) {
      data.fotoUrl = fotoUrl;
      data.fotoPath = fotoPath;
    }
    if (isEdit) {
      await state.fbSdk.updateDoc(state.fbSdk.doc(state.db, "facturacion", state.editingCierreId), data);
    } else {
      data.creadoEn = state.fbSdk.serverTimestamp();
      await state.fbSdk.addDoc(state.fbSdk.collection(state.db, "facturacion"), data);
    }
    closeModalFacturado();
    if (fotoFallo) {
      showToast(isEdit ? "Cierre actualizado, pero no se pudo subir la foto ⚠️" : "Cierre guardado sin la foto (no se pudo subir) ⚠️");
    } else {
      showToast(isEdit ? "Cierre actualizado ✅" : "Cierre guardado ✅");
    }
  } catch (e) {
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? "Guardar cambios" : "Guardar";
  }
}

// Solo accesible desde el botón 🗑️ (esAdmin). Borra también la foto en
// Storage si tenía una (mismo criterio que deleteGasto).
export async function deleteCierre(id) {
  if (!confirm("¿Borrar este cierre? No se puede deshacer.")) return;
  const cierre = state.facturaciones.find(x => x.id === id);
  try {
    if (cierre && cierre.fotoPath) {
      try {
        await state.fbSdk.deleteObject(state.fbSdk.ref(state.storage, cierre.fotoPath));
      } catch (e) {
        console.warn("No se pudo borrar la foto del cierre:", e.message);
      }
    }
    await state.fbSdk.deleteDoc(state.fbSdk.doc(state.db, "facturacion", id));
    showToast("Cierre borrado");
  } catch (e) {
    console.error(e);
    showToast("No se pudo borrar. Revisá tu conexión.");
  }
}
