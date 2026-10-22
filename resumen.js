// ============================================================
// Resumen mensual y Balance — vistas calculadas sobre gastos/facturación
// ya guardados, no tocan ni mueven ningún dato.
// ============================================================
import { state } from "./state.js";
import { $, escapeHtml, fechaDeRegistro, fechaBaseMes, mesLabel, money, parseMoneyInput, formatMoneyValue, showToast, socioColorVar, TURNOS, turnoLabelParaFecha, setSyncOffline } from "./utils.js";
import { payerColorVar } from "./identidad.js";
import { gastosDelNegocio, formaPagoLabel } from "./gastos.js";
import { facturacionesDelNegocio } from "./facturado.js";

// ---------- Caja Inicio ----------
// Fondo con el que arrancó el mes (vuelto/cambio para operar) — un dato
// aparte de gastos/facturación, que el admin carga a mano una vez por mes.
// Colección chica (un doc por mes, id "YYYY-MM"), se trae completa igual
// que ideas/reportes/inversion (ver README), no filtrada por fecha.
function mesKeyDe(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function cajaInicioDelMes(key) {
  const doc = state.cajaInicio.find(c => c.id === key);
  return doc ? Number(doc.monto) || 0 : 0;
}

export function listenCajaInicio() {
  state.fbSdk.onSnapshot(state.fbSdk.collection(state.db, "cajaInicio"), (snapshot) => {
    state.cajaInicio = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.negocioActual) renderResumen();
    setSyncOffline(false);
  }, (err) => {
    console.error(err);
    setSyncOffline(true);
  });
}

export function abrirModalCajaInicio() {
  if (!state.esAdmin) return;
  const base = fechaBaseMes(state.resumenMesOffset);
  const actual = cajaInicioDelMes(mesKeyDe(base));
  $("#caja-inicio-modal-mes").textContent = mesLabel(base);
  $("#input-caja-inicio").value = actual ? formatMoneyValue(actual) : "";
  $("#modal-caja-inicio-error").classList.add("hidden");
  $("#modal-caja-inicio").classList.add("active");
  setTimeout(() => $("#input-caja-inicio").focus(), 150);
}

export function cerrarModalCajaInicio() {
  $("#modal-caja-inicio").classList.remove("active");
}

export async function guardarCajaInicio() {
  const monto = parseMoneyInput($("#input-caja-inicio").value);
  const errEl = $("#modal-caja-inicio-error");
  if (!Number.isFinite(monto) || monto < 0) {
    errEl.textContent = "Ingresá un monto válido.";
    errEl.classList.remove("hidden");
    return;
  }
  const key = mesKeyDe(fechaBaseMes(state.resumenMesOffset));
  const btn = $("#btn-guardar-caja-inicio");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await state.fbSdk.setDoc(state.fbSdk.doc(state.db, "cajaInicio", key), {
      monto,
      registradoPor: state.usuarioActual,
      actualizadoEn: state.fbSdk.serverTimestamp()
    });
    cerrarModalCajaInicio();
    showToast("Caja Inicio guardada ✅");
  } catch (e) {
    errEl.textContent = "No se pudo guardar. Revisá tu conexión.";
    errEl.classList.remove("hidden");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
}

// ---------- Render: Resumen mensual ----------

// Categoría con la que cuenta un gasto en "Gastos por categoría" — único
// lugar que lo decide (un gasto sin categoría cae en "Otros"), así el monto
// de la tarjeta y el detalle desplegado nunca se desfasan.
function categoriaDe(g) {
  return g.categoria || "Otros";
}

// Detalle de una categoría desplegada: todos sus gastos del mes (los mismos
// que suman en el monto de la tarjeta, incluidos los "Solo admin" — esta
// pantalla ya es solo para admin), del más reciente al más antiguo. Solo
// lectura: editar/borrar sigue siendo desde la pantalla Gastos.
function detalleCategoriaHtml(gastos) {
  const filas = gastos
    .slice()
    .sort((a, b) => fechaDeRegistro(b) - fechaDeRegistro(a))
    .map(g => {
      const meta = [
        fechaDeRegistro(g).toLocaleDateString("es-AR", { day: "2-digit", month: "short" }),
        `Pagó ${escapeHtml(g.pagadoPor || "?")}`,
        formaPagoLabel(g),
        g.faltaAbonar ? "⚠️ Falta abonar" : "",
        g.soloAdmin ? "🔒 Solo admin" : ""
      ].filter(Boolean).join(" · ");
      return `
        <div class="categoria-gasto">
          <div class="categoria-gasto-top">
            <span class="categoria-gasto-desc">${escapeHtml(g.descripcion || "Sin descripción")}</span>
            <span class="categoria-gasto-importe">${money(g.importe)}</span>
          </div>
          <div class="categoria-gasto-meta">${meta}</div>
        </div>`;
    })
    .join("");
  return `
    <div class="categoria-detalle">
      <div class="categoria-detalle-count">${gastos.length === 1 ? "1 gasto" : `${gastos.length} gastos`}</div>
      ${filas}
    </div>`;
}

// Muestra, para el mes elegido (navegable con ‹ ›), el total de Facturado
// y el total de Gastos por separado — sin restar uno del otro. No borra ni
// mueve ningún dato: es solo una vista calculada sobre lo que ya está
// guardado en Firestore.
export function renderResumen() {
  const base = fechaBaseMes(state.resumenMesOffset);
  const targetMonth = base.getMonth();
  const targetYear = base.getFullYear();

  $("#resumen-mes-label").textContent = mesLabel(base);

  const now = new Date();
  const esMesActual = targetMonth === now.getMonth() && targetYear === now.getFullYear();
  $("#btn-mes-siguiente").disabled = esMesActual;

  // Caja Inicio: informativo, no entra en ningún cálculo de gastos/rentabilidad de abajo.
  $("#resumen-caja-inicio").textContent = money(cajaInicioDelMes(mesKeyDe(base)));
  $("#btn-editar-caja-inicio").classList.toggle("hidden", !state.esAdmin);

  const gastosMes = gastosDelNegocio().filter(g => {
    const f = fechaDeRegistro(g);
    return f.getMonth() === targetMonth && f.getFullYear() === targetYear;
  });
  const factMes = facturacionesDelNegocio().filter(f => {
    const d = fechaDeRegistro(f);
    return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
  });

  const totalGastos = gastosMes.reduce((sum, g) => sum + (Number(g.importe) || 0), 0);
  const totalFact = factMes.reduce((sum, f) => sum + (Number(f.importe) || 0), 0);
  // Cierres cargados ANTES del desglose Efectivo/Digital no tienen esos
  // campos — no suman acá (por eso Efectivo+Digital puede no coincidir
  // exactamente con el Total Facturado en meses con cierres viejos).
  const totalEfectivo = factMes.reduce((sum, f) => sum + (Number(f.efectivo) || 0), 0);
  const totalDigital = factMes.reduce((sum, f) => sum + (Number(f.digital) || 0), 0);

  $("#resumen-total-facturado").textContent = money(totalFact);
  $("#resumen-cant-facturado").textContent = factMes.length === 1 ? "1 cierre cargado" : `${factMes.length} cierres cargados`;
  $("#resumen-total-efectivo").textContent = money(totalEfectivo);
  $("#resumen-total-digital").textContent = money(totalDigital);
  const maxEfectDigital = Math.max(1, totalEfectivo, totalDigital);
  $("#resumen-bar-efectivo").style.width = Math.round((totalEfectivo / maxEfectDigital) * 100) + "%";
  $("#resumen-bar-digital").style.width = Math.round((totalDigital / maxEfectDigital) * 100) + "%";
  $("#resumen-total-gastos").textContent = money(totalGastos);
  $("#resumen-cant-gastos").textContent = gastosMes.length === 1 ? "1 gasto cargado" : `${gastosMes.length} gastos cargados`;

  // Rentabilidad = Total Facturado - Gastos del mes. En rojo si da negativo
  // (se gastó más de lo que entró), en verde si da positivo o cero. money()
  // siempre recibe un valor positivo — el signo se antepone a mano para que
  // quede "-$1.234" y no el "$-1.234" que da toLocaleString con negativos.
  const rentabilidad = totalFact - totalGastos;
  const rentabilidadEl = $("#resumen-rentabilidad");
  rentabilidadEl.textContent = (rentabilidad < 0 ? "-" : "") + money(Math.abs(rentabilidad));
  rentabilidadEl.style.color = rentabilidad < 0 ? "var(--critical)" : "var(--good)";

  // Mismo desglose Efectivo/Digital que Facturado, pero para Gastos —
  // usa el campo "formaPago" de cada gasto (ver openModal/saveGasto).
  // Gastos sin ese campo (cargados antes de que existiera) cuentan como
  // Efectivo, igual que en la lista de Gastos (ver formaPagoLabel()).
  let totalGastosEfectivo = 0, totalGastosDigital = 0;
  gastosMes.forEach(g => {
    const importe = Number(g.importe) || 0;
    if (g.formaPago === "digital") {
      totalGastosDigital += importe;
    } else if (g.formaPago === "mixto") {
      totalGastosEfectivo += Number(g.montoEfectivo) || 0;
      totalGastosDigital += Number(g.montoDigital) || 0;
    } else {
      totalGastosEfectivo += importe;
    }
  });
  $("#resumen-gastos-efectivo").textContent = money(totalGastosEfectivo);
  $("#resumen-gastos-digital").textContent = money(totalGastosDigital);
  const maxGastosEfectDigital = Math.max(1, totalGastosEfectivo, totalGastosDigital);
  $("#resumen-gastos-bar-efectivo").style.width = Math.round((totalGastosEfectivo / maxGastosEfectDigital) * 100) + "%";
  $("#resumen-gastos-bar-digital").style.width = Math.round((totalGastosDigital / maxGastosEfectDigital) * 100) + "%";

  // Agrupa los cierres del mes por día calendario, y dentro de cada día
  // por turno — para ver de un vistazo cuánto se trabajó cada día y cómo
  // se repartió entre Mañana/Tarde/Noche.
  const porDiaMap = new Map();
  factMes.forEach(f => {
    const d = fechaDeRegistro(f);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!porDiaMap.has(key)) {
      porDiaMap.set(key, { fecha: d, total: 0, turnos: { "mañana": 0, "tarde": 0, "noche": 0 } });
    }
    const entry = porDiaMap.get(key);
    const importe = Number(f.importe) || 0;
    entry.total += importe;
    if (TURNOS.includes(f.turno)) entry.turnos[f.turno] += importe;
  });
  const dias = Array.from(porDiaMap.values()).sort((a, b) => b.fecha - a.fecha);

  const diaWrap = $("#resumen-por-dia");
  const diaEmptyEl = $("#resumen-por-dia-empty");
  diaWrap.innerHTML = "";
  if (!dias.length) {
    diaEmptyEl.classList.remove("hidden");
  } else {
    diaEmptyEl.classList.add("hidden");
    dias.forEach(dia => {
      const esHoy = dia.fecha.toDateString() === now.toDateString();
      const card = document.createElement("div");
      card.className = "socio-total-card";
      const turnosHtml = TURNOS.map(t =>
        `<span>${turnoLabelParaFecha(dia.fecha, t)}: ${money(dia.turnos[t])}</span>`
      ).join("");
      card.innerHTML = `
        <div class="socio-total-row">
          <div class="socio-total-name">${esHoy ? "Hoy" : dia.fecha.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" })}</div>
          <div class="socio-total-amount">${money(dia.total)}</div>
        </div>
        <div class="resumen-turnos-row">${turnosHtml}</div>
      `;
      diaWrap.appendChild(card);
    });
  }

  const porCategoria = {};
  gastosMes.forEach(g => {
    const cat = categoriaDe(g);
    porCategoria[cat] = (porCategoria[cat] || 0) + (Number(g.importe) || 0);
  });
  const categorias = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);

  const wrap = $("#resumen-categorias");
  const emptyEl = $("#resumen-categorias-empty");
  wrap.innerHTML = "";
  if (!categorias.length) {
    emptyEl.classList.remove("hidden");
  } else {
    emptyEl.classList.add("hidden");
    const maxVal = Math.max(1, ...categorias.map(c => c[1]));
    categorias.forEach(([cat, val]) => {
      const pct = Math.round((val / maxVal) * 100);
      const abierta = state.resumenCategoriasAbiertas.has(cat);
      const card = document.createElement("div");
      card.className = "socio-total-card";
      // Nombre + monto + barra son un botón que despliega/pliega el detalle
      // de gastos de esa categoría (ver detalleCategoriaHtml).
      card.innerHTML = `
        <button type="button" class="categoria-toggle" aria-expanded="${abierta}">
          <span class="socio-total-row">
            <span class="socio-total-name"><span class="categoria-flecha" aria-hidden="true">${abierta ? "▾" : "▸"}</span>${escapeHtml(cat)}</span>
            <span class="socio-total-amount">${money(val)}</span>
          </span>
          <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:var(--text-muted)"></span></span>
        </button>
        ${abierta ? detalleCategoriaHtml(gastosMes.filter(g => categoriaDe(g) === cat)) : ""}
      `;
      card.querySelector(".categoria-toggle").addEventListener("click", () => {
        if (state.resumenCategoriasAbiertas.has(cat)) state.resumenCategoriasAbiertas.delete(cat);
        else state.resumenCategoriasAbiertas.add(cat);
        renderResumen();
      });
      wrap.appendChild(card);
    });
  }
}

// ---------- Render: Comparar meses (solo admin) ----------

// Variación porcentual contra el mes anterior, como texto corto con flecha
// ("▲ 12%" / "▼ 8%"). Vacío si el mes anterior no tiene nada con qué comparar.
function variacionHtml(actual, anterior, subeEsBueno) {
  if (!anterior) return "";
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  if (pct === 0) return `<span class="comparar-var">= 0%</span>`;
  const bueno = (pct > 0) === subeEsBueno;
  return `<span class="comparar-var" style="color:var(--${bueno ? "good" : "critical"})">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%</span>`;
}

// Un bloque por mes con datos (de los meses que ya trae el historial cargado
// de Firestore), del más reciente al más antiguo: Efectivo, Digital, la suma
// de los dos y Gastos totales. Usa las mismas cuentas que Resumen mensual —
// el total facturado es la suma de los importes de los cierres, igual que
// allá, así que ambas pantallas siempre muestran el mismo número.
export function renderComparar() {
  const wrap = $("#comparar-meses");
  if (!wrap || !state.esAdmin) return;

  const meses = new Map();
  const mesDe = (item) => {
    const d = fechaDeRegistro(item);
    const key = d.getFullYear() * 12 + d.getMonth();
    if (!meses.has(key)) {
      meses.set(key, { fecha: new Date(d.getFullYear(), d.getMonth(), 1), efectivo: 0, digital: 0, total: 0, gastos: 0 });
    }
    return meses.get(key);
  };
  facturacionesDelNegocio().forEach(f => {
    const m = mesDe(f);
    m.efectivo += Number(f.efectivo) || 0;
    m.digital += Number(f.digital) || 0;
    m.total += Number(f.importe) || 0;
  });
  gastosDelNegocio().forEach(g => { mesDe(g).gastos += Number(g.importe) || 0; });

  const lista = Array.from(meses.entries()).sort((a, b) => b[0] - a[0]);
  wrap.innerHTML = "";
  $("#comparar-empty").classList.toggle("hidden", lista.length > 0);
  const maxVal = Math.max(1, ...lista.map(([, m]) => Math.max(m.total, m.gastos)));

  lista.forEach(([key, m]) => {
    const prev = meses.get(key - 1);
    // Cierres cargados antes del desglose Efectivo/Digital no tienen esos
    // campos: el total sí los cuenta, pero Efectivo+Digital queda más bajo.
    const sinDesglose = m.total - (m.efectivo + m.digital) > 0.5;
    const card = document.createElement("div");
    card.className = "socio-total-card";
    card.innerHTML = `
      <div class="socio-total-row">
        <div class="socio-total-name">${mesLabel(m.fecha)}</div>
      </div>
      <div class="comparar-fila"><span><span class="socio-dot" style="background:var(--good)"></span> Efectivo</span><b>${money(m.efectivo)}</b></div>
      <div class="comparar-fila"><span><span class="socio-dot" style="background:var(--series-1)"></span> Digital</span><b>${money(m.digital)}</b></div>
      <div class="comparar-fila comparar-fila-total"><span>Efectivo + Digital</span><b>${money(m.total)}${variacionHtml(m.total, prev && prev.total, true)}</b></div>
      ${sinDesglose ? `<div class="comparar-nota">Hay cierres viejos sin desglose Efectivo/Digital.</div>` : ""}
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((m.total / maxVal) * 100)}%;background:var(--good)"></div></div>
      <div class="comparar-fila comparar-fila-gastos"><span>🧾 Gastos totales</span><b>${money(m.gastos)}${variacionHtml(m.gastos, prev && prev.gastos, false)}</b></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((m.gastos / maxVal) * 100)}%;background:var(--text-muted)"></div></div>
    `;
    wrap.appendChild(card);
  });
}

// ---------- Render: Balance ----------
export function renderBalance() {
  if (!state.socios.length) return;

  const gastosNegocio = gastosDelNegocio();
  const total = gastosNegocio.reduce((sum, g) => sum + (Number(g.importe) || 0), 0);
  $("#total-historico").textContent = money(total);

  const porSocio = state.socios.map(() => 0);
  gastosNegocio.forEach(g => {
    const idx = state.socios.indexOf(g.pagadoPor);
    if (idx !== -1) porSocio[idx] += Number(g.importe) || 0;
  });

  const maxPorSocio = Math.max(1, ...porSocio);
  const totalesEl = $("#socios-totales");
  totalesEl.innerHTML = "";
  state.socios.forEach((nombre, idx) => {
    const pct = Math.round((porSocio[idx] / maxPorSocio) * 100);
    const card = document.createElement("div");
    card.className = "socio-total-card";
    card.innerHTML = `
      <div class="socio-total-row">
        <div class="socio-total-name">
          <span class="socio-dot" style="background:${socioColorVar(idx)}"></span>
          ${escapeHtml(nombre)}
        </div>
        <div class="socio-total-amount">${money(porSocio[idx])}</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${socioColorVar(idx)}"></div></div>
    `;
    totalesEl.appendChild(card);
  });

  // Deudas: cada socio "debería" haber puesto total/n
  const fairShare = total / state.socios.length;
  const balances = state.socios.map((nombre, idx) => ({
    nombre, idx, balance: porSocio[idx] - fairShare
  }));

  const settlements = computeSettlements(balances);
  const settlementsEl = $("#settlements");
  settlementsEl.innerHTML = "";

  if (!total) {
    settlementsEl.innerHTML = `<p class="settlements-empty">Todavía no hay gastos para calcular.</p>`;
  } else if (!settlements.length) {
    settlementsEl.innerHTML = `<p class="settlements-empty">✅ Las cuentas están parejas entre los 3.</p>`;
  } else {
    settlements.forEach(s => {
      const item = document.createElement("div");
      item.className = "settlement-item";
      item.innerHTML = `
        <b>${escapeHtml(s.from)}</b>
        <span class="arrow">le debe a</span>
        <b>${escapeHtml(s.to)}</b>
        <span class="amt">${money(s.amount)}</span>
      `;
      settlementsEl.appendChild(item);
    });
  }

  renderColaboradoresTotales();
}

// Pagos hechos por colaboradores (ej. la encargada): se muestran a modo
// informativo, pero NUNCA entran en el cálculo de "quién le debe a quién"
// entre los socios.
function renderColaboradoresTotales() {
  const section = $("#colaboradores-section");
  if (!state.colaboradores.length) {
    section.classList.add("hidden");
    return;
  }

  const porColaborador = state.colaboradores.map(() => 0);
  gastosDelNegocio().forEach(g => {
    const idx = state.colaboradores.indexOf(g.pagadoPor);
    if (idx !== -1) porColaborador[idx] += Number(g.importe) || 0;
  });

  const total = porColaborador.reduce((a, b) => a + b, 0);
  if (!total) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  const maxVal = Math.max(1, ...porColaborador);
  const wrap = $("#colaboradores-totales");
  wrap.innerHTML = "";
  state.colaboradores.forEach((nombre, idx) => {
    const pct = Math.round((porColaborador[idx] / maxVal) * 100);
    if (!porColaborador[idx]) return;
    const card = document.createElement("div");
    card.className = "socio-total-card";
    card.innerHTML = `
      <div class="socio-total-row">
        <div class="socio-total-name">
          <span class="socio-dot" style="background:${payerColorVar(nombre)}"></span>
          ${escapeHtml(nombre)}
        </div>
        <div class="socio-total-amount">${money(porColaborador[idx])}</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${payerColorVar(nombre)}"></div></div>
    `;
    wrap.appendChild(card);
  });
}

// Algoritmo simple de liquidación de deudas (minimiza transacciones)
function computeSettlements(balances) {
  const debtors = balances.filter(b => b.balance < -0.01).map(b => ({ ...b, balance: -b.balance }));
  const creditors = balances.filter(b => b.balance > 0.01).map(b => ({ ...b }));
  debtors.sort((a, b) => b.balance - a.balance);
  creditors.sort((a, b) => b.balance - a.balance);

  const result = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i], c = creditors[j];
    const amount = Math.min(d.balance, c.balance);
    if (amount > 0.01) {
      result.push({ from: d.nombre, to: c.nombre, amount });
    }
    d.balance -= amount;
    c.balance -= amount;
    if (d.balance <= 0.01) i++;
    if (c.balance <= 0.01) j++;
  }
  return result;
}
