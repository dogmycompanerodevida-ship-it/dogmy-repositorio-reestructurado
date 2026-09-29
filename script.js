// ======================================
// DOGMY 9.0 - PASEADORES + ENLACE/QR DE SEGUIMIENTO PARA EL CLIENTE
// --------------------------------------
// Ya no hay panel de administrador ni cuentas de cliente. Solo el
// paseador tiene cuenta (se registra solo, con su correo). Cada vez que
// inicia un paseo con un perro se genera un enlace/QR unico que el
// paseador le manda al dueño; ese enlace abre seguimiento.html, sin login,
// y deja de servir cuando el perro es entregado.
// ======================================

import { db } from "./firebase-config.js";
import {
    ref, onValue, set, push, update, get, query, orderByChild, equalTo
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import {
    generarSalt, hashContrasena, verificarContrasena,
    normalizarUbicaciones, calcularDistanciaRuta, filtrarDesde,
    formatDistancia, formatTiempo, generarImagenRuta,
    crearIconoBandera, crearIconoPerro, dibujarEventos,
    abrirImagenCompleta, reducirImagen
} from "./utils.js";

// ---------- CONFIGURACION ----------
// Direccion web publica donde esta alojado seguimiento.html (la misma de
// tu sitio web de DogMy, SIN la palabra "seguimiento.html" al final).
// Ejemplo: "https://dogmy.netlify.app"
// Dentro de la app instalada este dato es obligatorio (la app no vive en
// internet, asi que no puede adivinar la direccion). En la version web se
// usa automaticamente la direccion del propio sitio.
const URL_SEGUIMIENTO = "";

function urlBaseSeguimiento() {
    if (URL_SEGUIMIENTO) return URL_SEGUIMIENTO.replace(/\/+$/, "");
    const esWeb = /^https?:$/.test(location.protocol) &&
                  location.hostname !== "localhost" && location.hostname !== "127.0.0.1";
    if (esWeb) return location.href.replace(/[^/]*$/, "").replace(/\/+$/, "");
    return "";
}

function esc(texto) {
    return String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const dormir = ms => new Promise(r => setTimeout(r, ms));

// ======================================
// LOGIN Y REGISTRO (index.html)
// ======================================
const btnIngresar = document.getElementById("btnIngresar");
if (btnIngresar) {
    const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    window.mostrarPanel = function (cual) {
        document.getElementById("panelLogin").style.display = cual === "registro" ? "none" : "block";
        document.getElementById("panelRegistro").style.display = cual === "registro" ? "block" : "none";
    };

    async function buscarUsuario(usuario) {
        let snap = await get(query(ref(db, "usuarios"), orderByChild("usuario"), equalTo(usuario)));
        const minus = usuario.toLowerCase();
        if (!snap.exists() && minus !== usuario) {
            snap = await get(query(ref(db, "usuarios"), orderByChild("usuario"), equalTo(minus)));
        }
        return snap;
    }

    function entrar(uid, userData) {
        localStorage.setItem("dogmy_uid", uid);
        localStorage.setItem("dogmy_tipo", "paseador");
        localStorage.setItem("dogmy_usuario", userData.usuario);
        window.location.href = "paseador.html";
    }

    btnIngresar.addEventListener("click", async function () {
        const usuario = document.getElementById("usuario").value.trim();
        const contrasena = document.getElementById("contrasena").value.trim();
        if (!usuario || !contrasena) { alert("Escribe tu correo y tu contraseña."); return; }
        try {
            const snapshot = await buscarUsuario(usuario);
            if (!snapshot.exists()) { alert("Correo o contraseña incorrectos."); return; }
            const data = snapshot.val();
            const uid = Object.keys(data)[0];
            const userData = data[uid];
            if (!(await verificarContrasena(userData, contrasena))) {
                alert("Correo o contraseña incorrectos.");
                return;
            }
            if (userData.tipo !== "paseador") {
                alert("Esta versión de DogMy es solo para paseadores. Crea tu cuenta con tu correo para empezar.");
                return;
            }
            // Cuentas viejas con contraseña sin cifrar: se cifran ahora.
            if (!userData.contrasenaHash) {
                const salt = generarSalt();
                const contrasenaHash = await hashContrasena(contrasena, salt);
                await update(ref(db, "usuarios/" + uid), { contrasenaHash, salt, contrasena: null });
            }
            entrar(uid, userData);
        } catch (error) {
            console.error("Error en login:", error);
            alert("Error de conexión. Verifica tu internet.");
        }
    });

    document.getElementById("btnRegistrar").addEventListener("click", async function () {
        const boton = this;
        const nombre = document.getElementById("regNombre").value.trim();
        const correo = document.getElementById("regCorreo").value.trim().toLowerCase();
        const pass1 = document.getElementById("regContrasena").value;
        const pass2 = document.getElementById("regContrasena2").value;

        if (!nombre) { alert("Escribe tu nombre."); return; }
        if (!EMAIL_OK.test(correo)) { alert("Escribe un correo válido (ej: tunombre@gmail.com)."); return; }
        if (pass1.length < 6) { alert("La contraseña debe tener al menos 6 caracteres."); return; }
        if (pass1 !== pass2) { alert("Las contraseñas no coinciden."); return; }

        boton.disabled = true;
        try {
            const existente = await buscarUsuario(correo);
            if (existente.exists()) {
                alert("Ese correo ya está registrado. Inicia sesión.");
                return;
            }
            const salt = generarSalt();
            const contrasenaHash = await hashContrasena(pass1, salt);
            const nuevoRef = push(ref(db, "usuarios"));
            const datos = {
                nombre, usuario: correo, contrasenaHash, salt,
                tipo: "paseador", telefono: "",
                fechaRegistro: new Date().toISOString(),
                activo: false, lat: null, lon: null, paseoActualId: null
            };
            await set(nuevoRef, datos);
            entrar(nuevoRef.key, datos);
        } catch (error) {
            console.error("Error registrando:", error);
            alert("No se pudo crear la cuenta. Verifica tu internet.");
        } finally {
            boton.disabled = false;
        }
    });
}

// ======================================
// CERRAR SESION
// ======================================
window.cerrarSesion = function () {
    if (window.__paseoEnCurso &&
        !confirm("Tienes un paseo en curso. Si cierras sesión el GPS puede dejar de registrar. ¿Cerrar sesión de todos modos?")) {
        return;
    }
    localStorage.removeItem("dogmy_uid");
    localStorage.removeItem("dogmy_tipo");
    localStorage.removeItem("dogmy_usuario");
    window.location.href = "index.html";
};

// ======================================
// PANEL DEL PASEADOR (paseador.html)
// ======================================
const nombrePaseadorEl = document.getElementById("nombrePaseador");
if (nombrePaseadorEl) {
    const uidGuardado = localStorage.getItem("dogmy_uid");
    if (!uidGuardado) window.location.replace("index.html");
    else iniciarPanelPaseador(uidGuardado);
}

function iniciarPanelPaseador(uid) {
    // ----- elementos de la pantalla -----
    const estado = document.getElementById("estado");
    const cronometroBox = document.getElementById("cronometroBox");
    const cronometroDisplay = document.getElementById("cronometro");
    const eventosBox = document.getElementById("eventosBox");
    const distanciaBox = document.getElementById("distanciaBox");
    const btnFinalizar = document.getElementById("btnFinalizarPaseo");
    const mapaBox = document.getElementById("mapaPropioBox");

    // ----- estado del panel -----
    let usuarioActual = null;
    let misPerros = {};              // perros del paseador: perroId -> datos
    let paseoIdActual = null;
    let paseoActual = null;
    let cancelarEscuchaPaseo = null;
    let ocupado = false;

    let mapa = null, capaRuta = null, capaEventos = null, capaBanderas = null, capaFinal = null;
    let marcadorPerro = null;
    let wakeLock = null;
    let watcherNativoId = null, watchIdGPS = null, intervaloGPS = null;
    let paseoIdGpsIniciado = null;

    // ---------- helpers de paseo ----------
    function entradasDelPaseo() {
        return Object.entries((paseoActual && paseoActual.perros) || {});
    }
    function entradasActivas() {
        return entradasDelPaseo().filter(([, p]) => p.estado !== "entregado");
    }
    function perroIdDeEntrada(clave, entrada) {
        return entrada.perroId || clave;
    }

    // ---------- SESION / USUARIO ----------
    onValue(ref(db, "usuarios/" + uid), snap => {
        const data = snap.val();
        if (!data || data.tipo !== "paseador") {
            localStorage.clear();
            window.location.replace("index.html");
            return;
        }
        usuarioActual = data;
        nombrePaseadorEl.textContent = "Hola, " + data.nombre;

        const fotoEl = document.getElementById("fotoPerfilPaseador");
        if (fotoEl) {
            if (data.fotoPerfil) { fotoEl.src = data.fotoPerfil; fotoEl.style.display = "block"; }
            else fotoEl.style.display = "none";
        }

        if (data.activo && data.paseoActualId) {
            if (paseoIdActual !== data.paseoActualId) escucharPaseo(data.paseoActualId);
            // El GPS se arranca UNA sola vez por paseo (no en cada
            // actualizacion de ubicacion, eso lo reiniciaba sin parar).
            if (paseoIdGpsIniciado !== data.paseoActualId) {
                paseoIdGpsIniciado = data.paseoActualId;
                iniciarGPSAutomatico(uid, data.paseoActualId);
            }
        } else if (paseoIdActual || paseoIdGpsIniciado) {
            terminarLocalmente();
        }
        pintarEstado();
    });

    // Perros del paseador (sus "predilectos")
    onValue(query(ref(db, "perros"), orderByChild("paseadorId"), equalTo(uid)), snap => {
        misPerros = snap.val() || {};
        pintarListas();
    });

    function escucharPaseo(paseoId) {
        if (cancelarEscuchaPaseo) cancelarEscuchaPaseo();
        paseoIdActual = paseoId;
        cancelarEscuchaPaseo = onValue(ref(db, "paseos/" + paseoId), snap => {
            paseoActual = snap.val();
            pintarPaseo();
        });
    }

    function terminarLocalmente() {
        if (cancelarEscuchaPaseo) { cancelarEscuchaPaseo(); cancelarEscuchaPaseo = null; }
        paseoIdActual = null;
        paseoActual = null;
        paseoIdGpsIniciado = null;
        detenerGPS();
        destruirMapa();
        pintarListas();
    }

    function pintarEstado() {
        const activo = !!(usuarioActual && usuarioActual.activo && usuarioActual.paseoActualId);
        window.__paseoEnCurso = activo;
        if (activo) {
            estado.innerHTML = "🟡 Paseo en curso";
            estado.className = "en-curso";
            cronometroBox.style.display = "block";
            eventosBox.style.display = "grid";
            distanciaBox.style.display = "block";
            btnFinalizar.style.display = "block";
            requestWakeLock();
        } else {
            estado.innerHTML = "🟢 Disponible";
            estado.className = "disponible";
            cronometroBox.style.display = "none";
            eventosBox.style.display = "none";
            distanciaBox.style.display = "none";
            btnFinalizar.style.display = "none";
            releaseWakeLock();
        }
    }

    function pintarPaseo() {
        if (paseoActual && paseoActual.inicio) cronometroDisplay.dataset.inicio = paseoActual.inicio;
        dibujarMapa();
        pintarListas();
    }

    // ---------- CRONOMETROS (un solo temporizador para todos) ----------
    setInterval(() => {
        document.querySelectorAll("[data-inicio]").forEach(el => {
            const diff = Math.floor((Date.now() - new Date(el.dataset.inicio).getTime()) / 1000);
            el.textContent = (el.dataset.prefijo || "") + formatTiempo(diff >= 0 ? diff : 0);
        });
    }, 1000);

    // ---------- MAPA ----------
    function asegurarMapa() {
        mapaBox.style.display = "block";
        if (mapa) return;
        mapa = window.L.map("mapaPropioBox").setView([19.4326, -99.1332], 15);
        window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap"
        }).addTo(mapa);
        capaRuta = window.L.layerGroup().addTo(mapa);
        capaEventos = window.L.layerGroup().addTo(mapa);
        capaBanderas = window.L.layerGroup().addTo(mapa);
        capaFinal = window.L.layerGroup().addTo(mapa);
        setTimeout(() => mapa && mapa.invalidateSize(), 200);
    }

    function destruirMapa() {
        if (mapa) { mapa.remove(); mapa = null; }
        marcadorPerro = null;
        mapaBox.style.display = "none";
        mapaBox.innerHTML = "";
    }

    function dibujarMapa() {
        if (!paseoActual) return;
        asegurarMapa();
        const ubs = normalizarUbicaciones(paseoActual.ubicaciones);
        capaRuta.clearLayers();
        capaBanderas.clearLayers();
        if (ubs.length === 0) return;

        window.L.marker([ubs[0].lat, ubs[0].lon], { icon: crearIconoBandera("#1565c0") })
            .addTo(capaBanderas).bindPopup("🔵 Aquí iniciaste el paseo");
        window.L.polyline(ubs.map(u => [u.lat, u.lon]), { color: "red", weight: 4 }).addTo(capaRuta);
        dibujarEventos(capaEventos, ubs);

        entradasDelPaseo().forEach(([, p]) => {
            if (p.estado === "entregado" && p.finLat != null && p.finLon != null) {
                window.L.marker([p.finLat, p.finLon], { icon: crearIconoBandera("#c62828") })
                    .addTo(capaBanderas).bindPopup("🚩 Aquí se entregó a " + esc(p.nombre));
            }
        });

        const ultimo = ubs[ubs.length - 1];
        if (marcadorPerro) capaRuta.removeLayer(marcadorPerro);
        marcadorPerro = window.L.marker([ultimo.lat, ultimo.lon], { icon: crearIconoPerro() }).addTo(capaRuta);
        mapa.setView([ultimo.lat, ultimo.lon]);

        const txt = distanciaBox.querySelector("p");
        if (txt) txt.innerHTML = "📏 Distancia: <b>" + formatDistancia(calcularDistanciaRuta(ubs)) + "</b>";
    }

    // Bandera roja provisional en el punto donde se toco "Finalizar"
    function marcarBanderaFinal() {
        if (!mapa || !marcadorPerro) return;
        capaFinal.clearLayers();
        const pos = marcadorPerro.getLatLng();
        window.L.marker([pos.lat, pos.lng], { icon: crearIconoBandera("#c62828") })
            .addTo(capaFinal).bindPopup("🚩 Aquí finalizaste el paseo").openPopup();
    }

    // ---------- PANTALLA SIEMPRE ENCENDIDA ----------
    async function requestWakeLock() {
        try {
            if ("wakeLock" in navigator && !wakeLock) {
                wakeLock = await navigator.wakeLock.request("screen");
                wakeLock.addEventListener("release", () => { wakeLock = null; });
            }
        } catch (err) { console.log("Wake Lock no disponible:", err); }
    }
    function releaseWakeLock() {
        if (wakeLock) { wakeLock.release(); wakeLock = null; }
    }
    document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible" && window.__paseoEnCurso && usuarioActual) {
            requestWakeLock();
            if (usuarioActual.paseoActualId) {
                await iniciarGPSAutomatico(uid, usuarioActual.paseoActualId);
            }
        }
    });

    // ---------- GPS ----------
    async function guardarUbicacionGPS(paseadorId, paseoId, lat, lon) {
        await update(ref(db, "usuarios/" + paseadorId), { lat, lon });
        await push(ref(db, "paseos/" + paseoId + "/ubicaciones"), {
            lat, lon, timestamp: new Date().toISOString(), evento: null
        });
    }

    async function iniciarGPSAutomatico(paseadorId, paseoId) {
        await detenerGPS();

        // App instalada: GPS nativo (sigue con la pantalla apagada)
        if (window.DogMyNativo && window.DogMyNativo.disponible()) {
            try {
                await window.DogMyNativo.pedirExencionBateria();
                watcherNativoId = await window.DogMyNativo.iniciarGPS(paseadorId, paseoId, null);
                return;
            } catch (err) {
                console.error("No se pudo iniciar el GPS nativo, usando el del navegador:", err);
            }
        }

        // Respaldo (version web)
        if (!navigator.geolocation) return;
        watchIdGPS = navigator.geolocation.watchPosition(
            pos => guardarUbicacionGPS(paseadorId, paseoId, pos.coords.latitude, pos.coords.longitude),
            error => console.log("GPS error:", error),
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
    }

    async function detenerGPS() {
        if (watcherNativoId && window.DogMyNativo) {
            const idAEliminar = watcherNativoId;
            watcherNativoId = null;
            try {
                // Se espera a que Android confirme que quito el watcher
                // viejo antes de permitir uno nuevo (evita la carrera que
                // apagaba el GPS a partir del segundo paseo).
                await window.DogMyNativo.detenerGPS(idAEliminar);
            } catch (e) { console.error("Error deteniendo el GPS nativo:", e); }
        }
        if (watchIdGPS !== null) { navigator.geolocation.clearWatch(watchIdGPS); watchIdGPS = null; }
        if (intervaloGPS) { clearInterval(intervaloGPS); intervaloGPS = null; }
    }

    // Aviso destacado antes de pedir ubicacion en segundo plano (Google
    // Play exige que la persona lo lea y lo acepte de forma explicita).
    function confirmarUbicacion() {
        if (localStorage.getItem("dogmy_aviso_ubicacion") === "1") return Promise.resolve(true);
        return new Promise(resolve => {
            const capa = document.createElement("div");
            capa.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;";
            capa.innerHTML = `
                <div style="background:#fff;border-radius:16px;padding:22px;max-width:380px;text-align:left;">
                    <h3 style="color:#2e7d32;margin:0 0 10px 0;">📍 Uso de tu ubicación</h3>
                    <p style="font-size:14px;color:#333;line-height:1.5;">
                        DogMy usa la ubicación de tu teléfono <b>también cuando la app está cerrada o en segundo plano</b>,
                        únicamente mientras tienes un paseo en curso, para registrar el recorrido y
                        mostrárselo en vivo al dueño del perro mediante el enlace que tú le envías.
                        La ubicación deja de registrarse cuando termina el paseo.
                    </p>
                    <button id="avisoAceptar" style="margin-top:14px;">Entiendo y acepto</button>
                    <button id="avisoCancelar" style="margin-top:8px;background:#9e9e9e;">Ahora no</button>
                </div>`;
            document.body.appendChild(capa);
            capa.querySelector("#avisoAceptar").onclick = () => {
                localStorage.setItem("dogmy_aviso_ubicacion", "1");
                capa.remove(); resolve(true);
            };
            capa.querySelector("#avisoCancelar").onclick = () => { capa.remove(); resolve(false); };
        });
    }

    // ---------- LISTAS DE PERROS ----------
    function pintarListas() {
        const dispEl = document.getElementById("listaPerrosDisponibles");
        const paseoEl = document.getElementById("listaPerrosEnPaseo");
        if (!dispEl || !paseoEl) return;

        const activas = entradasActivas();
        const idsActivos = new Set(activas.map(([k, p]) => perroIdDeEntrada(k, p)));
        const activoPaseo = !!(usuarioActual && usuarioActual.activo && usuarioActual.paseoActualId);

        // Predilectos disponibles
        const disponibles = Object.entries(misPerros)
            .filter(([id, p]) => p.guardado !== false && !idsActivos.has(id))
            .sort((a, b) => String(a[1].nombre).localeCompare(String(b[1].nombre)));

        if (disponibles.length === 0) {
            dispEl.innerHTML = '<p class="vacio">Aún no tienes perros guardados. Agrega uno abajo ⬇️</p>';
        } else {
            dispEl.innerHTML = "";
            disponibles.forEach(([id, p]) => {
                const div = document.createElement("div");
                div.className = "perro-compacto";
                div.innerHTML = `
                    <p class="nombre">🐕 ${esc(p.nombre)} ${p.raza ? '<span class="raza">(' + esc(p.raza) + ')</span>' : ""}</p>
                    <button onclick="iniciarPaseoConPerro('${id}')" style="background:${activoPaseo ? "#ff9800" : "#2e7d32"};">
                        ${activoPaseo ? "➕ Agregar al paseo" : "🐶 Iniciar paseo"}</button>
                    <button onclick="quitarPredilecto('${id}')" class="btn-chico">🗑️ Quitar de mi lista</button>`;
                dispEl.appendChild(div);
            });
        }

        // En mi paseo
        if (activas.length === 0) {
            paseoEl.innerHTML = '<p class="vacio">Ninguno</p>';
        } else {
            paseoEl.innerHTML = "";
            activas.forEach(([clave, p]) => {
                const div = document.createElement("div");
                div.className = "perro-compacto";
                div.style.borderColor = "#ff9800";
                div.innerHTML = `
                    <p class="nombre">🐕 ${esc(p.nombre)} ${p.raza ? '<span class="raza">(' + esc(p.raza) + ')</span>' : ""}</p>
                    <p class="crono-perro" data-inicio="${esc(p.inicio)}" data-prefijo="⏱️ ">⏱️ 00:00:00</p>
                    <button onclick="verEnlace('${clave}')" style="background:#2196f3;">📲 QR / enlace para el dueño</button>
                    <button onclick="tomarFotoPerro('${clave}')" style="background:#9c27b0;">📷 Foto de este perro</button>
                    <button onclick="entregarPerro('${clave}')" style="background:#d32f2f;">✅ Entregar (terminar)</button>`;
                paseoEl.appendChild(div);
            });
        }
    }

    // ---------- INICIAR / AGREGAR PERRO AL PASEO ----------
    async function agregarPerroAlPaseo(perroId, datos) {
        if (ocupado) return;
        ocupado = true;
        try {
            const ahora = new Date().toISOString();
            const entrada = { perroId, nombre: datos.nombre, raza: datos.raza || "", inicio: ahora, estado: "activo" };
            const hayPaseo = usuarioActual && usuarioActual.activo && usuarioActual.paseoActualId;

            if (!hayPaseo) {
                if (!(await confirmarUbicacion())) return;
                const paseoRef = push(ref(db, "paseos"));
                const claveEntrada = push(ref(db, "paseos/" + paseoRef.key + "/perros")).key;
                const fotoChica = usuarioActual.fotoPerfil && usuarioActual.fotoPerfil.length < 200000
                    ? usuarioActual.fotoPerfil : null;
                await set(paseoRef, {
                    paseadorId: uid,
                    paseadorNombre: usuarioActual.nombre,
                    paseadorFoto: fotoChica,
                    perros: { [claveEntrada]: entrada },
                    inicio: ahora, fin: null, estado: "activo", distancia: 0
                });
                await update(ref(db, "usuarios/" + uid), {
                    activo: true, paseoActualId: paseoRef.key, lat: null, lon: null
                });
                mostrarEnlace(paseoRef.key, claveEntrada, entrada.nombre);
            } else {
                const paseoId = usuarioActual.paseoActualId;
                const claveEntrada = push(ref(db, "paseos/" + paseoId + "/perros")).key;
                await update(ref(db, "paseos/" + paseoId + "/perros/" + claveEntrada), entrada);
                mostrarEnlace(paseoId, claveEntrada, entrada.nombre);
            }
        } catch (err) {
            console.error(err);
            alert("No se pudo iniciar el paseo: " + err.message);
        } finally {
            ocupado = false;
        }
    }

    window.iniciarPaseoConPerro = function (perroId) {
        const p = misPerros[perroId];
        if (p) agregarPerroAlPaseo(perroId, p);
    };

    window.iniciarPaseoNuevoPerro = async function () {
        const nombre = document.getElementById("nuevoPerroNombre").value.trim();
        const raza = document.getElementById("nuevoPerroRaza").value.trim();
        const guardar = document.getElementById("nuevoPerroGuardar").checked;
        if (!nombre) { alert("Escribe el nombre del cachorro."); return; }
        try {
            const nuevo = push(ref(db, "perros"));
            await set(nuevo, {
                nombre, raza, paseadorId: uid, guardado: guardar,
                fechaAlta: new Date().toISOString()
            });
            document.getElementById("nuevoPerroNombre").value = "";
            document.getElementById("nuevoPerroRaza").value = "";
            await agregarPerroAlPaseo(nuevo.key, { nombre, raza });
        } catch (err) {
            console.error(err);
            alert("No se pudo guardar el cachorro: " + err.message);
        }
    };

    window.quitarPredilecto = async function (perroId) {
        const p = misPerros[perroId];
        if (!p || !confirm("¿Quitar a " + p.nombre + " de tu lista? (su historial se conserva)")) return;
        await update(ref(db, "perros/" + perroId), { guardado: false });
    };

    // ---------- ENLACE / QR PARA EL CLIENTE ----------
    function mostrarEnlace(paseoId, claveEntrada, nombrePerro) {
        const base = urlBaseSeguimiento();
        const capa = document.createElement("div");
        capa.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9997;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;";

        if (!base) {
            capa.innerHTML = `
                <div style="background:#fff;border-radius:16px;padding:22px;max-width:380px;text-align:center;">
                    <h3 style="color:#c62828;margin-bottom:10px;">Falta configurar la dirección</h3>
                    <p style="font-size:14px;color:#333;line-height:1.5;">El paseo de <b>${esc(nombrePerro)}</b> ya inició,
                    pero la app todavía no sabe cuál es la dirección web de seguimiento
                    (dato <code>URL_SEGUIMIENTO</code> en script.js).</p>
                    <button id="enlaceCerrar" style="margin-top:14px;">Entendido</button>
                </div>`;
            document.body.appendChild(capa);
            capa.querySelector("#enlaceCerrar").onclick = () => capa.remove();
            return;
        }

        const enlace = base + "/seguimiento.html?p=" + encodeURIComponent(paseoId) + "&d=" + encodeURIComponent(claveEntrada);
        let imgQR = "";
        try {
            const qr = window.qrcode(0, "M");
            qr.addData(enlace);
            qr.make();
            imgQR = qr.createDataURL(6, 8);
        } catch (e) { console.error("No se pudo crear el QR:", e); }

        const mensaje = "🐕 Sigue en vivo el paseo de " + nombrePerro + " con DogMy: " + enlace;
        capa.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:20px;max-width:380px;width:100%;text-align:center;">
                <h3 style="color:#2e7d32;margin-bottom:4px;">🐕 Paseo de ${esc(nombrePerro)}</h3>
                <p style="font-size:13px;color:#666;margin-bottom:10px;">Muéstrale este QR al dueño o mándale el enlace:</p>
                ${imgQR ? '<img src="' + imgQR + '" alt="QR" style="width:230px;height:230px;image-rendering:pixelated;border:1px solid #ddd;border-radius:8px;">' : ""}
                <input id="enlaceTexto" readonly value="${esc(enlace)}" style="width:100%;margin-top:10px;padding:8px;font-size:12px;border:1px solid #ccc;border-radius:8px;">
                <a href="https://wa.me/?text=${encodeURIComponent(mensaje)}" target="_blank" rel="noopener"
                   style="display:block;margin-top:10px;padding:13px;background:#25d366;color:#fff;border-radius:12px;font-weight:bold;text-decoration:none;">💬 Enviar por WhatsApp</a>
                <button id="enlaceCopiar" style="margin-top:8px;background:#2196f3;">📋 Copiar enlace</button>
                <button id="enlaceCerrar" style="margin-top:8px;background:#9e9e9e;">Cerrar</button>
                <p style="font-size:11px;color:#888;margin-top:10px;">El enlace deja de servir cuando entregues al cachorro.</p>
            </div>`;
        document.body.appendChild(capa);
        capa.querySelector("#enlaceCerrar").onclick = () => capa.remove();
        capa.querySelector("#enlaceCopiar").onclick = async () => {
            try {
                await navigator.clipboard.writeText(enlace);
            } catch (e) {
                const campo = capa.querySelector("#enlaceTexto");
                campo.select(); document.execCommand("copy");
            }
            alert("Enlace copiado ✅");
        };
    }

    window.verEnlace = function (claveEntrada) {
        const p = paseoActual && paseoActual.perros && paseoActual.perros[claveEntrada];
        if (p && paseoIdActual) mostrarEnlace(paseoIdActual, claveEntrada, p.nombre);
    };

    // ---------- ESTADISTICAS ----------
    async function guardarEstadisticas(perroId, item) {
        const statsRef = ref(db, "estadisticas/" + perroId);
        const s = (await get(statsRef)).val() || {};
        await update(statsRef, {
            totalPaseos: (s.totalPaseos || 0) + 1,
            totalMinutos: (s.totalMinutos || 0) + item.minutos,
            totalMetros: (s.totalMetros || 0) + item.metros,
            ultimoPaseo: item.fecha
        });
        const clave = item.fecha.split("T")[0] + "_" + Date.now();
        await set(ref(db, "estadisticas/" + perroId + "/historial/" + clave), item);
    }

    // ---------- ENTREGAR UN PERRO ----------
    // Guarda SU recorrido (desde que se sumo al paseo), SU captura y SUS
    // estadisticas. Al final marca la entrada como "entregado", que es lo
    // que hace caducar el enlace del cliente.
    async function entregarEntrada(paseoId, paseo, clave) {
        const entrada = paseo.perros[clave];
        const ahora = new Date().toISOString();
        const todos = normalizarUbicaciones(paseo.ubicaciones);
        const suyos = filtrarDesde(paseo.ubicaciones, entrada.inicio);
        const metros = calcularDistanciaRuta(suyos);
        let minutos = Math.round((Date.now() - new Date(entrada.inicio).getTime()) / 60000);
        if (!Number.isFinite(minutos) || minutos < 1) minutos = 1;
        const imagenRuta = generarImagenRuta(suyos);
        const ultimo = todos.length ? todos[todos.length - 1] : null;

        try {
            await guardarEstadisticas(perroIdDeEntrada(clave, entrada), {
                minutos, metros, fecha: ahora, paseoId, imagenRuta: imagenRuta || null
            });
        } catch (e) { console.error("Error guardando estadisticas:", e); }

        await update(ref(db, "paseos/" + paseoId + "/perros/" + clave), {
            estado: "entregado", fin: ahora, distancia: metros, minutos,
            imagenRuta: imagenRuta || null,
            finLat: ultimo ? ultimo.lat : null, finLon: ultimo ? ultimo.lon : null
        });
        return metros;
    }

    async function cerrarPaseo(paseoId, paseo) {
        if (paseo) {
            await update(ref(db, "paseos/" + paseoId), {
                fin: new Date().toISOString(), estado: "completado",
                distancia: calcularDistanciaRuta(paseo.ubicaciones)
            });
        }
        await update(ref(db, "usuarios/" + uid), { activo: false, paseoActualId: null, lat: null, lon: null });
    }

    window.entregarPerro = async function (clave) {
        if (ocupado || !paseoActual || !paseoIdActual) return;
        const entrada = paseoActual.perros && paseoActual.perros[clave];
        if (!entrada || !confirm("¿Entregar a " + entrada.nombre + "? Su enlace dejará de funcionar.")) return;
        ocupado = true;
        try {
            const paseoId = paseoIdActual;
            const paseo = (await get(ref(db, "paseos/" + paseoId))).val() || paseoActual;
            await entregarEntrada(paseoId, paseo, clave);
            const quedan = Object.entries(paseo.perros).filter(([k, p]) => k !== clave && p.estado !== "entregado");
            if (quedan.length === 0) {
                await cerrarPaseo(paseoId, paseo);
                alert(entrada.nombre + " entregado. Ya no quedan perros: paseo finalizado.");
            } else {
                alert(entrada.nombre + " entregado ✅ El GPS sigue activo para los demás.");
            }
        } catch (err) {
            console.error(err);
            alert("No se pudo entregar: " + err.message);
        } finally {
            ocupado = false;
        }
    };

    window.finalizarPaseoCompleto = async function () {
        if (ocupado) return;
        if (!confirm("¿Finalizar el paseo y entregar a todos los perros que siguen contigo?")) return;
        ocupado = true;
        const textoOriginal = btnFinalizar.textContent;
        try {
            const paseoId = paseoIdActual || (usuarioActual && usuarioActual.paseoActualId);
            if (!paseoId) return;

            marcarBanderaFinal();
            btnFinalizar.disabled = true;
            btnFinalizar.textContent = "⏳ Guardando último tramo (5s)...";
            await dormir(5000); // el GPS sigue registrando unos segundos mas

            const paseo = (await get(ref(db, "paseos/" + paseoId))).val();
            if (paseo && paseo.perros) {
                for (const [clave, p] of Object.entries(paseo.perros)) {
                    if (p.estado !== "entregado") await entregarEntrada(paseoId, paseo, clave);
                }
            }
            await cerrarPaseo(paseoId, paseo);
            alert("Paseo finalizado. Los recorridos quedaron guardados ✅");
        } catch (err) {
            console.error("Error finalizando paseo:", err);
            alert("Hubo un error, pero se liberará tu estado de todos modos: " + err.message);
            try {
                await update(ref(db, "usuarios/" + uid), { activo: false, paseoActualId: null, lat: null, lon: null });
            } catch (e2) { console.error(e2); }
        } finally {
            btnFinalizar.disabled = false;
            btnFinalizar.textContent = textoOriginal;
            ocupado = false;
        }
    };

    // ---------- EVENTOS DURANTE EL PASEO ----------
    window.marcarEvento = async function (tipo) {
        if (!paseoIdActual) { alert("No hay paseo activo."); return; }
        const nombres = { agua: "💧 Agua", popo: "💩 Popó", comida: "🍖 Comida", olfateo: "👃 Olfateo" };
        const ubs = normalizarUbicaciones(paseoActual && paseoActual.ubicaciones);
        const guardar = async (lat, lon) => {
            await push(ref(db, "paseos/" + paseoIdActual + "/ubicaciones"), {
                lat, lon, timestamp: new Date().toISOString(), evento: tipo
            });
            alert("Evento guardado: " + nombres[tipo]);
        };
        if (ubs.length) {
            const u = ubs[ubs.length - 1];
            await guardar(u.lat, u.lon);
        } else if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => guardar(pos.coords.latitude, pos.coords.longitude),
                () => alert("Todavía no hay ubicación para marcar el evento.")
            );
        }
    };

    // ---------- FOTOS ----------
    function elegirFoto(camara, alTerminar) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.capture = camara;
        input.onchange = e => { if (e.target.files[0]) alTerminar(e.target.files[0]); };
        input.click();
    }

    window.tomarFotoPerfil = function () {
        elegirFoto("user", async archivo => {
            try {
                const imagen = await reducirImagen(archivo, 320, 0.8);
                await update(ref(db, "usuarios/" + uid), { fotoPerfil: imagen });
                alert("✅ Foto de perfil actualizada.");
            } catch (err) { alert("Error guardando la foto: " + err.message); }
        });
    };

    // Foto de UN perro: se guarda ligada a su enlace, asi que solo la ve
    // el dueño de ese perro en su enlace de seguimiento.
    window.tomarFotoPerro = function (clave) {
        if (!paseoIdActual) { alert("No hay paseo activo para asociar la foto."); return; }
        elegirFoto("environment", async archivo => {
            try {
                const imagen = await reducirImagen(archivo, 1000, 0.72);
                await push(ref(db, "fotosPaseo/" + paseoIdActual + "/" + clave), {
                    imagen, fecha: new Date().toISOString()
                });
                alert("📷 Foto enviada. El dueño ya puede verla en su enlace.");
            } catch (err) {
                console.error(err);
                alert("Error subiendo la foto: " + err.message);
            }
        });
    };

    // ---------- GALERIA DE RECORRIDOS ----------
    const btnGaleria = document.getElementById("btnGaleriaRecorridos");
    if (btnGaleria) {
        btnGaleria.addEventListener("click", async () => {
            const box = document.getElementById("galeriaRecorridosBox");
            box.style.display = box.style.display === "none" ? "block" : "none";
            if (box.style.display === "none") return;
            box.innerHTML = "<p style='text-align:center;padding:20px;'>Cargando recorridos...</p>";
            try {
                const lista = [];
                await Promise.all(Object.entries(misPerros).map(async ([id, perro]) => {
                    const h = (await get(ref(db, "estadisticas/" + id + "/historial"))).val();
                    Object.values(h || {}).forEach(item => {
                        if (item.imagenRuta) lista.push({ ...item, nombrePerro: perro.nombre });
                    });
                }));
                lista.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
                if (lista.length === 0) {
                    box.innerHTML = '<p style="text-align:center;padding:20px;">No hay recorridos guardados aún.</p>';
                    return;
                }
                box.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px;">' +
                    lista.map((r, i) => `
                    <div style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1);">
                        <img data-i="${i}" src="${r.imagenRuta}" style="width:100%;height:120px;object-fit:cover;cursor:pointer;">
                        <p style="font-size:11px;padding:8px;margin:0;color:#666;">
                            🐶 ${esc(r.nombrePerro)}<br>
                            📏 ${((r.metros || 0) / 1000).toFixed(2)}km en ${r.minutos || 0}min<br>
                            🕒 ${new Date(r.fecha).toLocaleString()}
                        </p>
                    </div>`).join("") + "</div>";
                box.querySelectorAll("img[data-i]").forEach(img => {
                    img.onclick = () => abrirImagenCompleta(img.src);
                });
            } catch (err) {
                console.error(err);
                box.innerHTML = '<p style="text-align:center;padding:20px;color:#c62828;">No se pudo cargar (revisa tu conexión).</p>';
            }
        });
    }
}
