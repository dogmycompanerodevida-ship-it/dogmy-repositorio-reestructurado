// ======================================
// DOGMY - UTILIDADES COMPARTIDAS
// Las usan script.js (login y paseador), seguimiento.html (enlace
// publico para el cliente) y dueno.html.
// ======================================

// ---------- SEGURIDAD DE CONTRASEÑAS ----------
// Cada contraseña se guarda como hash SHA-256 + una "sal" (salt) unica por
// usuario, nunca en texto plano.
export function generarSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function hashContrasena(contrasena, salt) {
    const datos = new TextEncoder().encode(salt + ":" + contrasena);
    const hashBuffer = await crypto.subtle.digest("SHA-256", datos);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}
// Compara una contraseña ingresada contra lo guardado. Soporta cuentas
// viejas que aun tengan "contrasena" en texto plano (las va a "migrar"
// a hash automaticamente en el primer login exitoso, ver mas abajo).
export async function verificarContrasena(userData, contrasenaIngresada) {
    if (userData.contrasenaHash && userData.salt) {
        const hash = await hashContrasena(contrasenaIngresada, userData.salt);
        return hash === userData.contrasenaHash;
    }
    // Cuenta vieja sin cifrar todavia
    return userData.contrasena === contrasenaIngresada;
}


export function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

export function formatDistancia(metros) {
    if (metros < 1000) return metros.toFixed(0) + " m";
    return (metros / 1000).toFixed(2) + " km";
}

// El GPS nativo guarda cada punto con push() (por HTTP directo), lo que
// hace que "ubicaciones" quede como un OBJETO con llaves generadas por
// Firebase, no como una lista simple. El GPS del navegador (respaldo web)
// puede guardarlo como lista simple. Esta funcion siempre entrega una
// lista ordenada por tiempo, sin importar cual de los dos formatos venga,
// para que el resto del codigo no tenga que preocuparse por eso.
export function normalizarUbicaciones(ubicaciones) {
    if (!ubicaciones) return [];
    const puntos = Array.isArray(ubicaciones) ? ubicaciones.slice() : Object.values(ubicaciones);
    puntos.sort((a, b) => {
        const ta = a && a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b && b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return ta - tb;
    });
    return puntos.filter(u => u && typeof u.lat === "number" && typeof u.lon === "number");
}

// Calcula la distancia total sumando la distancia entre cada par de puntos
// consecutivos de la ruta. Se usa en vez de un campo "distancia" que se
// va acumulando en cada escritura, para que funcione igual sin importar
// si los puntos los guardo el GPS nativo (por HTTP directo) o el del
// navegador (por el SDK de Firebase) -- ambos guardan el mismo formato
// de puntos, asi que el calculo siempre da el mismo resultado real.
export function calcularDistanciaRuta(ubicaciones) {
    const puntos = normalizarUbicaciones(ubicaciones);
    let total = 0;
    for (let i = 1; i < puntos.length; i++) {
        const a = puntos[i - 1], b = puntos[i];
        total += haversine(a.lat, a.lon, b.lat, b.lon);
    }
    return total;
}


// Dibuja una "captura" simple del recorrido (la forma de la ruta, con
// punto de inicio en azul y punto final en rojo) y la devuelve como
// imagen (base64) para guardarla junto con las estadisticas del paseo.
// No es un mapa real con calles -- es un dibujo del trazo -- para no
// depender de servicios externos ni de conexion al generarla.
export function generarImagenRuta(ubicacionesRaw) {
    try {
        const puntos = normalizarUbicaciones(ubicacionesRaw).filter(p => p.lat != null && p.lon != null);
        if (puntos.length < 2) return null;
        const lats = puntos.map(p => p.lat);
        const lons = puntos.map(p => p.lon);
        let minLat = Math.min(...lats), maxLat = Math.max(...lats);
        let minLon = Math.min(...lons), maxLon = Math.max(...lons);
        if (maxLat - minLat < 0.00005) { maxLat += 0.00005; minLat -= 0.00005; }
        if (maxLon - minLon < 0.00005) { maxLon += 0.00005; minLon -= 0.00005; }
        const ancho = 400, alto = 300, margen = 40;
        const canvas = document.createElement("canvas");
        canvas.width = ancho; canvas.height = alto;
        const ctx = canvas.getContext("2d");

        // Fondo celeste suave, al estilo de las ilustraciones de rutas
        // de Google Maps.
        ctx.fillStyle = "#bfe3ec";
        ctx.fillRect(0, 0, ancho, alto);

        const escalarX = lon => margen + ((lon - minLon) / (maxLon - minLon)) * (ancho - margen * 2);
        const escalarY = lat => margen + (1 - (lat - minLat) / (maxLat - minLat)) * (alto - margen * 2);

        // Ruta en blanco, gruesa, como una "cinta" sobre el fondo celeste.
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 8;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        puntos.forEach((p, i) => {
            const x = escalarX(p.lon), y = escalarY(p.lat);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();

        const inicio = puntos[0], finP = puntos[puntos.length - 1];

        // Punto de inicio: circulo verde solido.
        const xInicio = escalarX(inicio.lon), yInicio = escalarY(inicio.lat);
        ctx.fillStyle = "#2e7d32";
        ctx.beginPath();
        ctx.arc(xInicio, yInicio, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Punto final: pin tipo "gota" roja, como los de Google Maps.
        const xFin = escalarX(finP.lon), yFin = escalarY(finP.lat);
        dibujarPinMapa(ctx, xFin, yFin, "#e53935");

        return canvas.toDataURL("image/jpeg", 0.7);
    } catch (e) {
        console.error("No se pudo generar la imagen de la ruta:", e);
        return null;
    }
}

// Dibuja un pin de mapa (forma de gota, con un circulo blanco adentro)
// con la punta apoyada en (x, y) -- igual al estilo clasico de marcador
// de Google Maps, usado para marcar el final del recorrido.
export function dibujarPinMapa(ctx, x, y, color) {
    const radio = 11;
    const altoPin = 30;
    ctx.save();
    ctx.translate(x, y - altoPin);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, radio, Math.PI * 0.15, Math.PI * 0.85, true);
    ctx.lineTo(0, altoPin);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, radio, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, radio * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}


export function formatTiempo(segundosTotales) {
    const h = Math.floor(segundosTotales / 3600);
    const m = Math.floor((segundosTotales % 3600) / 60);
    const s = segundosTotales % 60;
    return h.toString().padStart(2,"0") + ":" + m.toString().padStart(2,"0") + ":" + s.toString().padStart(2,"0");
}



// Devuelve solo los puntos del recorrido que se registraron a partir de
// cierto momento. Sirve para que cada perro tenga su PROPIA distancia y su
// PROPIA captura, contando desde que ese perro se sumo al paseo.
export function filtrarDesde(ubicaciones, inicioISO) {
    const puntos = normalizarUbicaciones(ubicaciones);
    if (!inicioISO) return puntos;
    const t0 = new Date(inicioISO).getTime();
    if (!Number.isFinite(t0)) return puntos;
    return puntos.filter(p => !p.timestamp || new Date(p.timestamp).getTime() >= t0 - 2000);
}

// Icono de bandera de un color dado (necesita Leaflet cargado en la pagina).
export function crearIconoBandera(color) {
    const svg = `<svg width="26" height="32" viewBox="0 0 26 32" xmlns="http://www.w3.org/2000/svg">
        <line x1="3" y1="1" x2="3" y2="30" stroke="#333" stroke-width="2"/>
        <path d="M3 3 L23 8 L3 14 Z" fill="${color}" stroke="#222" stroke-width="1"/>
    </svg>`;
    return window.L.divIcon({ html: svg, className: '', iconSize: [26, 32], iconAnchor: [3, 30] });
}

// Marcador del perrito caminando (estilo Uber)
export function crearIconoPerro() {
    return window.L.divIcon({
        html: '<div class="marcador-perro-caminando">🐕</div>',
        className: '', iconSize: [40, 40], iconAnchor: [20, 20]
    });
}

const EMOJI_EVENTO = { agua: "💧", popo: "💩", comida: "🍖", olfateo: "👃" };
const NOMBRE_EVENTO = { agua: "Agua", popo: "Popó", comida: "Comida", olfateo: "Olfateo" };

// Dibuja en el mapa los eventos (agua, popó, comida, olfateo) del recorrido.
// "capa" es un L.layerGroup que se limpia y se vuelve a llenar cada vez.
export function dibujarEventos(capa, ubicaciones) {
    capa.clearLayers();
    normalizarUbicaciones(ubicaciones).forEach(u => {
        if (!u.evento || !EMOJI_EVENTO[u.evento]) return;
        const icono = window.L.divIcon({
            html: '<div style="font-size:20px;background:rgba(255,255,255,.85);border-radius:50%;width:30px;height:30px;line-height:30px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.3);">' + EMOJI_EVENTO[u.evento] + '</div>',
            className: '', iconSize: [30, 30], iconAnchor: [15, 15]
        });
        window.L.marker([u.lat, u.lon], { icon: icono }).bindPopup(NOMBRE_EVENTO[u.evento]).addTo(capa);
    });
}

// Abre una imagen en pantalla completa, como un visor normal -- se cierra
// tocando la imagen o la X.
export function abrirImagenCompleta(src) {
    const capa = document.createElement("div");
    capa.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;";
    capa.onclick = () => capa.remove();
    const img = document.createElement("img");
    img.src = src;
    img.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;";
    const cerrar = document.createElement("div");
    cerrar.textContent = "✕";
    cerrar.style.cssText = "position:absolute;top:16px;right:20px;color:#fff;font-size:32px;line-height:1;";
    capa.appendChild(img);
    capa.appendChild(cerrar);
    document.body.appendChild(capa);
}

// Reduce una foto (archivo de la camara) a un tamaño razonable antes de
// guardarla en Firebase: las fotos originales del telefono pesan varios
// MB y harian lentisimo el enlace del cliente.
export function reducirImagen(archivo, maxLado, calidad) {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.onerror = () => reject(new Error("No se pudo leer la foto"));
        lector.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error("La foto no es valida"));
            img.onload = () => {
                const factor = Math.min(1, maxLado / Math.max(img.width, img.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * factor);
                canvas.height = Math.round(img.height * factor);
                canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/jpeg", calidad));
            };
            img.src = lector.result;
        };
        lector.readAsDataURL(archivo);
    });
}

// Formato legible de una hora
export function formatHora(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
}
