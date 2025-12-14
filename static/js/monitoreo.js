// ==========================================
// MONITOREO CONTINUO - SecurityEye
// Adaptado de medicion.js para flujo continuo
// ==========================================

// ==========================================
// 1. VARIABLES GLOBALES Y REFERENCIAS
// ==========================================

const API_BASE = 'http://127.0.0.1:8000';
const videoElement = document.getElementById('videoElement');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const startBtn = document.getElementById('startBtn');
const endSessionBtn = document.getElementById('endSessionBtn');
const statusOverlay = document.getElementById('statusOverlay');
const statusText = document.getElementById('statusText');
const alertBanner = document.getElementById('alertBanner');
const alertText = document.getElementById('alertText');

// Metric displays
const blinkCountEl = document.getElementById('blinkCount');
const yawnCountEl = document.getElementById('yawnCount');
const timerEl = document.getElementById('timerCount');
const perclosEl = document.getElementById('perclosDisplay');
const alertsCountEl = document.getElementById('alertsCount');

// Contenido
const contentContainer = document.getElementById('contentContainer');
const sessionInfoEl = document.getElementById('sessionInfo');

// Estado global y variables
let appState = 'IDLE';
let running = false;
let camera = null;
let startTime = 0;
let lastFrameTime = 0;
let sesionId = null;
let lastBlinkTime = 0;
let currentActivityType = null;
let currentResourceUrl = null;
let currentResourceName = null;

// Constantes y umbrales
const CALIBRATION_DURATION = 10;
const ALERT_COOLDOWN = 30;
let calibrationEARs = [];
let calibrationMARs = [];
let baselineEAR = 0;
let baselineMAR = 0;
let thresClose = 0.20;
let thresOpen = 0.25;
let thresYawn = 0.50;

// Métricas de seguimiento
let blinkCounter = 0;
let incompleteBlinks = 0;
let accumulatedClosureTime = 0;
let measureFramesTotal = 0;
let measureFramesClosed = 0;
let isBlinking = false;
let minEarInBlink = 1.0;
let yawnCounter = 0;
let isYawning = false;
let yawnStartTime = 0;
const MIN_YAWN_TIME = 1.5;
let prevIrisPos = null;
let totalIrisDistance = 0;
let frameCount = 0;
const LEFT_IRIS_CENTER = 468;

// Seguimiento de alertas
let lastAlertTime = 0;
let momentosFatiga = [];
let alertasCount = 0;
let maxSinParpadeo = 0;

// ==========================================
// 2. FUNCIONES MATEMÁTICAS
// ==========================================

function distanciaPx(p1, p2, w, h) {
    const dx = (p1.x - p2.x) * w;
    const dy = (p1.y - p2.y) * h;
    return Math.hypot(dx, dy);
}

function calcularEAR(lm, w, h) {
    const l_v1 = distanciaPx(lm[160], lm[144], w, h);
    const l_v2 = distanciaPx(lm[158], lm[153], w, h);
    const l_h  = distanciaPx(lm[33],  lm[133], w, h);
    const ear_l = (l_v1 + l_v2) / (2.0 * l_h);

    const r_v1 = distanciaPx(lm[385], lm[380], w, h);
    const r_v2 = distanciaPx(lm[387], lm[373], w, h);
    const r_h  = distanciaPx(lm[362], lm[263], w, h);
    const ear_r = (r_v1 + r_v2) / (2.0 * r_h);

    return (ear_l + ear_r) / 2.0;
}

function calcularMAR(lm, w, h) {
    const v1 = distanciaPx(lm[13], lm[14], w, h);
    const v2 = distanciaPx(lm[81], lm[178], w, h);
    const v3 = distanciaPx(lm[311], lm[402], w, h);
    const vertical = (v1 + v2 + v3) / 3.0;
    const horizontal = distanciaPx(lm[61], lm[291], w, h);
    return horizontal > 0 ? vertical / horizontal : 0;
}

// ==========================================
// 3. CONFIGURACIÓN MEDIAPIPE
// ==========================================

const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});

faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

faceMesh.onResults((results) => {
    if (!running) return;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    const now = performance.now() / 1000;
    const deltaTime = now - lastFrameTime;
    lastFrameTime = now;

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const lm = results.multiFaceLandmarks[0];
        const w = canvasElement.width;
        const h = canvasElement.height;

        const currentEAR = calcularEAR(lm, w, h);
        const currentMAR = calcularMAR(lm, w, h);
        const currentIrisPos = { x: lm[LEFT_IRIS_CENTER].x, y: lm[LEFT_IRIS_CENTER].y };

        // ======================================
        // ESTADOS DEL SISTEMA
        // ======================================

        if (appState === 'IDLE') {
            statusText.textContent = "Listo para iniciar";

        } else if (appState === 'CALIBRATING') {
            const elapsed = now - startTime;
            statusText.textContent = `CALIBRANDO (${Math.ceil(CALIBRATION_DURATION - elapsed)}s)`;

            calibrationEARs.push(currentEAR);
            calibrationMARs.push(currentMAR);

            if (elapsed >= CALIBRATION_DURATION) {
                baselineEAR = calibrationEARs.reduce((a, b) => a + b, 0) / calibrationEARs.length;
                baselineMAR = calibrationMARs.reduce((a, b) => a + b, 0) / calibrationMARs.length;

                thresClose = baselineEAR * 0.55;
                thresOpen = baselineEAR * 0.85;
                thresYawn = Math.max(0.5, baselineMAR + 0.30);

                appState = 'MONITORING';
                startTime = now;
                lastBlinkTime = now;

                blinkCounter = 0;
                incompleteBlinks = 0;
                accumulatedClosureTime = 0;
                measureFramesClosed = 0;
                measureFramesTotal = 0;
                yawnCounter = 0;
                totalIrisDistance = 0;
                frameCount = 0;
                alertasCount = 0;
                momentosFatiga = [];
            }

        } else if (appState === 'MONITORING') {

            const elapsed = now - startTime;
            const minutes = Math.floor(elapsed / 60);
            const seconds = Math.floor(elapsed % 60);
            timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

            measureFramesTotal++;

            // -------------------------
            // DETECCIÓN DE PARPADEO
            // -------------------------
            if (currentEAR < thresClose) {
                if (!isBlinking) {
                    isBlinking = true;
                    minEarInBlink = currentEAR;
                } else {
                    if (currentEAR < minEarInBlink) minEarInBlink = currentEAR;
                }

                measureFramesClosed++;
                accumulatedClosureTime += deltaTime;

            } else if (currentEAR > thresOpen && isBlinking) {

                blinkCounter++;
                blinkCountEl.textContent = blinkCounter;
                lastBlinkTime = now;

                if (minEarInBlink > (thresClose * 0.7)) {
                    incompleteBlinks++;
                }

                isBlinking = false;
            }

            // -------------------------
            // MÁXIMO SIN PARPADEAR
            // -------------------------
            const sinParpadeo = now - lastBlinkTime;
            if (sinParpadeo > maxSinParpadeo) {
                maxSinParpadeo = sinParpadeo;
                // maxWithoutBlinkEl removido - no existe en HTML
            }

            // -------------------------
            // DETECCIÓN DE BOSTEZO
            // -------------------------
            if (currentMAR > thresYawn) {
                if (!isYawning) {
                    isYawning = true;
                    yawnStartTime = now;
                }
            } else {
                if (isYawning) {
                    const dur = now - yawnStartTime;
                    if (dur > MIN_YAWN_TIME) {
                        yawnCounter++;
                        yawnCountEl.textContent = yawnCounter;
                    }
                }
                isYawning = false;
            }

            // -------------------------
            // VELOCIDAD SACÁDICA
            // -------------------------
            if (prevIrisPos) {
                const dist = Math.hypot(
                    currentIrisPos.x - prevIrisPos.x,
                    currentIrisPos.y - prevIrisPos.y
                );
                totalIrisDistance += dist;
                frameCount++;
            }
            prevIrisPos = currentIrisPos;

            // -------------------------
            // CÁLCULO DE PERCLOS
            // -------------------------
            const perclos = measureFramesTotal > 0
                ? (measureFramesClosed / measureFramesTotal) * 100
                : 0;
            perclosEl.textContent = parseFloat(perclos.toFixed(1)) + '%';

            // -------------------------
            // DETECCIÓN DE FATIGA EN TIEMPO REAL
            // -------------------------
            const pctIncompletos = blinkCounter > 0
                ? (incompleteBlinks / blinkCounter) * 100
                : 0;

            const avgVelocity = frameCount > 5
                ? parseFloat(((totalIrisDistance / frameCount) * 100).toFixed(4))
                : 0;

            let nivelFatiga = 0;
            if (perclos >= 28) nivelFatiga += 3;
            if (blinkCounter <= 5 && measureFramesTotal > 60) nivelFatiga += 3;
            if (pctIncompletos >= 20) nivelFatiga += 2;
            if (yawnCounter >= 1) nivelFatiga += 1;
            if (avgVelocity < 0.02) nivelFatiga += 1;
            if (accumulatedClosureTime >= 3) nivelFatiga += 1;
            if (maxSinParpadeo >= 10) nivelFatiga += 2;

            // Mostrar alerta de fatiga (con cooldown)
            if (nivelFatiga >= 3 && (now - lastAlertTime) > ALERT_COOLDOWN) {
                mostrarAlertaFatiga();
                alertasCount++;
                alertsCountEl.textContent = alertasCount;
                lastAlertTime = now;

                // Guardar momento de fatiga
                momentosFatiga.push({
                    t: Math.round(elapsed),
                    reason: nivelFatiga >= 5 ? 'Fatiga severa' : 'Fatiga moderada'
                });

                // Abrir modal para actividad de descanso
                abrirModalDescanso();
            }

            // -------------------------
            // GUARDAR MÉTRICAS CADA 5 SEGUNDOS
            // -------------------------
        }
    }

    canvasCtx.restore();
});

// ==========================================
// 4. CONTROL DE CÁMARA
// ==========================================

function startCamera() {
    if (!camera) {
        camera = new Camera(videoElement, {
            onFrame: async () => {
                await faceMesh.send({ image: videoElement });
            },
            width: 640,
            height: 480
        });
    }

    camera.start().then(() => {
        running = true;
        startBtn.disabled = true;
        endSessionBtn.disabled = false;
        statusOverlay.classList.remove('d-none');
        appState = 'CALIBRATING';
        startTime = performance.now() / 1000;
        lastFrameTime = startTime;

        calibrationEARs = [];
        calibrationMARs = [];

        crearSesion();
    });
}

function stopCamera() {
    running = false;
    if (camera) camera.stop();
    statusOverlay.classList.add('d-none');
    appState = 'IDLE';
}

// ==========================================
// 5. GESTIÓN DE SESIONES
// ==========================================

async function crearSesion() {
    // La sesión ya fue creada en seleccionar_actividad.js
    // Solo verificamos que tengamos los datos necesarios
    if (!sesionId || !currentActivityType) {
        console.error('Faltan datos de sesión');
        alert('Error: Sesión no válida');
        stopCamera();
        return;
    }
    console.log('Usando sesión existente con ID:', sesionId);
}

async function guardarMetricasContinuas(tiempoTranscurrido, perclos, blinkRate, velocidadOcular) {
    if (!sesionId) return;

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const activityType = currentActivityType;

    // Calcular % de parpadeos incompletos
    const pctIncompletos = blinkRate > 0 ? (incompleteBlinks / blinkRate) * 100 : 0;
    
    // Detectar fatiga (basado en PERCLOS y alertas)
    const esFatiga = perclos >= 15 || alertasCount >= 2;

    const payload = {
        sesion_id: sesionId,
        usuario_id: usuario.id,
        actividad: activityType,
        tiempo_total_seg: Math.round(tiempoTranscurrido),
        perclos: parseFloat(perclos.toFixed(2)),
        sebr: blinkRate,
        blink_rate_min: blinkRate > 0 ? parseFloat((blinkRate / (tiempoTranscurrido / 60)).toFixed(2)) : 0,
        pct_incompletos: parseFloat(pctIncompletos.toFixed(2)),
        num_bostezos: yawnCounter,
        tiempo_cierre: parseFloat(accumulatedClosureTime.toFixed(2)),
        velocidad_ocular: parseFloat(velocidadOcular.toFixed(4)),
        max_sin_parpadeo: Math.round(maxSinParpadeo),
        alertas: alertasCount,
        momentos_fatiga: momentosFatiga,
        nivel_subjetivo: 0, // Se establecerá al final con KSS
        es_fatiga: esFatiga
    };

    try {
        const response = await fetch('http://localhost:8000/save-fatigue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.warn('Error guardando métricas:', response.status);
        }
    } catch (e) {
        console.error('Error al guardar métricas continuas:', e);
    }
}

async function finalizarSesion() {
    stopCamera();
    endSessionBtn.disabled = true;

    // Obtener KSS subjetivo
    mostrarModalKSS();
}

function mostrarModalKSS() {
    const kssModal = new bootstrap.Modal(document.getElementById('subjectiveModal'));
    kssModal.show();

    // Configurar botones KSS
    document.querySelectorAll('.kss-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const kssValue = e.currentTarget.dataset.kss;
            kssModal.hide();

            // Guardar medición final
            const usuario = JSON.parse(localStorage.getItem('usuario'));
            const activityType = currentActivityType;
            const tiempoTotal = Math.round((performance.now() / 1000) - startTime - (CALIBRATION_DURATION));

            const perclos = measureFramesTotal > 0
                ? (measureFramesClosed / measureFramesTotal) * 100
                : 0;

            const pctIncompletos = blinkCounter > 0
                ? (incompleteBlinks / blinkCounter) * 100
                : 0;

            const avgVelocity = frameCount > 5
                ? parseFloat(((totalIrisDistance / frameCount) * 100).toFixed(4))
                : 0;

            // Detectar fatiga basado en umbrales
            const esFatiga = perclos >= 15 || alertasCount >= 2 || parseInt(kssValue) >= 7;

            const payload = {
                sesion_id: sesionId,
                usuario_id: usuario.id,
                actividad: activityType,
                tiempo_total_seg: tiempoTotal,
                perclos: parseFloat(perclos.toFixed(2)),
                sebr: blinkCounter,
                blink_rate_min: blinkCounter > 0 ? parseFloat((blinkCounter / (tiempoTotal / 60)).toFixed(2)) : 0,
                pct_incompletos: parseFloat(pctIncompletos.toFixed(2)),
                num_bostezos: yawnCounter,
                tiempo_cierre: parseFloat(accumulatedClosureTime.toFixed(2)),
                velocidad_ocular: parseFloat(avgVelocity.toFixed(4)),
                max_sin_parpadeo: Math.round(maxSinParpadeo),
                nivel_subjetivo: parseInt(kssValue),
                alertas: alertasCount,
                momentos_fatiga: momentosFatiga,
                es_fatiga: esFatiga
            };

            console.log('Payload final:', payload);

            try {
                const response = await fetch('http://localhost:8000/save-fatigue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    // Redirigir a resumen (ruta estática)
                    window.location.href = `/templates/usuario/resumen.html?sesion_id=${sesionId}`;
                } else {
                    alert('Error al guardar sesión');
                }
            } catch (e) {
                console.error('Error:', e);
                alert('No se pudo conectar al servidor');
            }
        };
    });
}

function mostrarAlertaFatiga() {
    alertBanner.classList.remove('d-none');
    alertText.textContent = 'Fatiga detectada - Se recomienda descanso';
    
    // Auto-ocultar después de 5 segundos
    setTimeout(() => {
        alertBanner.classList.add('d-none');
    }, 5000);
}

async function abrirModalDescanso() {
    try {
        const response = await fetch('http://localhost:8000/actividades-descanso');
        const data = await response.json();

        const container = document.getElementById('breakActivitiesContainer');
        container.innerHTML = '';

        data.actividades.forEach(act => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline-primary';
            btn.innerHTML = `<i class="bi bi-play-circle"></i> ${act.nombre} (${act.duracion}s)`;
            btn.onclick = () => realizarActividadDescanso(act);
            container.appendChild(btn);
        });

        const breakModal = new bootstrap.Modal(document.getElementById('breakActivityModal'));
        breakModal.show();
    } catch (e) {
        console.error('Error cargando actividades:', e);
    }
}

async function realizarActividadDescanso(actividad) {
    console.log('Realizando:', actividad.nombre);
    
    // Registrar en base de datos
    if (sesionId) {
        try {
            const response = await fetch(`${API_BASE}/registrar-descanso`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sesion_id: sesionId,
                    actividad_id: actividad.id,
                    actividad_nombre: actividad.nombre,
                    duracion_seg: actividad.duracion_seg
                })
            });
            
            if (response.ok) {
                console.log('Actividad de descanso registrada en BD');
            }
        } catch (e) {
            console.error('Error registrando descanso:', e);
        }
    }
    
    // Cerrar modal
    const breakModal = bootstrap.Modal.getInstance(document.getElementById('breakActivityModal'));
    breakModal.hide();
}

// ==========================================
// 6. EVENT LISTENERS
// ==========================================

if (startBtn) startBtn.addEventListener('click', startCamera);
if (endSessionBtn) endSessionBtn.addEventListener('click', finalizarSesion);

// Botones de actividades de descanso
document.getElementById('breakBtn1')?.addEventListener('click', () => abrirModalDescanso());
document.getElementById('breakBtn2')?.addEventListener('click', () => abrirModalDescanso());
document.getElementById('breakBtn3')?.addEventListener('click', () => abrirModalDescanso());

// ==========================================
// 7. INICIALIZACIÓN AL CARGAR
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // Protección de ruta
    const usuario = localStorage.getItem('usuario');
    if (!usuario) {
        window.location.href = '/templates/login.html';
        return;
    }

    // Leer parámetros de URL
    const params = new URLSearchParams(window.location.search);
    sesionId = params.get('sesion_id');
    currentActivityType = params.get('tipo');
    currentResourceName = params.get('nombre');
    currentResourceUrl = params.get('url');
    
    console.log('Parámetros de URL recibidos:', {
        sesionId,
        currentActivityType,
        currentResourceName,
        currentResourceUrl
    });

    if (!sesionId || !currentActivityType || !currentResourceName) {
        alert('Sesión no válida. Redirigiendo...');
        window.location.href = 'seleccionar_actividad.html';
        return;
    }

    // Mostrar información de sesión
    const tipoTexto = currentActivityType === 'video' ? 'Video' : 'PDF';
    sessionInfoEl.textContent = `${tipoTexto} - ${currentResourceName}`;

    // Cargar contenido en el panel
    cargarContenido(currentActivityType, currentResourceUrl, currentResourceName);
});

// ==========================================
// 8. CARGAR CONTENIDO (VIDEO/PDF)
// ==========================================

// Helper: Convertir URL de YouTube a formato embed
function convertirYouTubeUrl(url) {
    // Detectar URLs de YouTube
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/;
    const match = url.match(youtubeRegex);
    
    if (match && match[1]) {
        const videoId = match[1];
        return `https://www.youtube.com/embed/${videoId}`;
    }
    
    return url; // Si no es YouTube, devolver URL original
}

function cargarContenido(tipo, url, nombre) {
    console.log('Cargando contenido:', { tipo, url, nombre });
    contentContainer.innerHTML = '';

    // Verificar si hay URL válida (no vacía ni null)
    const hasUrl = url && url.trim() !== '';
    console.log('Tiene URL válida:', hasUrl);

    if (tipo === 'video') {
        if (hasUrl) {
            console.log('Creando elemento video con URL:', url);
            
            // Detectar si es URL de YouTube o externa
            const esYouTube = url.includes('youtube.com') || url.includes('youtu.be');
            const esUrlExterna = url.startsWith('http://') || url.startsWith('https://');
            const esArchivoLocal = url.startsWith('blob:');
            
            if (esYouTube) {
                // YouTube requiere iframe con URL embed
                const embedUrl = convertirYouTubeUrl(url);
                console.log('URL de YouTube convertida a embed:', embedUrl);
                const iframe = document.createElement('iframe');
                iframe.src = embedUrl;
                iframe.style.width = '100%';
                iframe.style.height = '100%';
                iframe.style.border = 'none';
                iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
                iframe.allowFullscreen = true;
                contentContainer.appendChild(iframe);
            } else if (esUrlExterna && !esArchivoLocal) {
                // Otras URLs externas también usar iframe por seguridad
                console.log('URL externa, usando iframe');
                const iframe = document.createElement('iframe');
                iframe.src = url;
                iframe.style.width = '100%';
                iframe.style.height = '100%';
                iframe.style.border = 'none';
                iframe.allow = 'autoplay';
                contentContainer.appendChild(iframe);
            } else {
                // Archivos locales (blob:) usar <video>
                console.log('Archivo local, usando elemento video');
                const videoEl = document.createElement('video');
                videoEl.src = url;
                videoEl.controls = true;
                videoEl.autoplay = false;
                videoEl.style.width = '100%';
                videoEl.style.height = '100%';
                videoEl.style.objectFit = 'contain';
                contentContainer.appendChild(videoEl);
            }
        } else {
            console.warn('No se proporcionó URL para el video');
            contentContainer.innerHTML = `<div class="text-center text-white p-4">
                <i class="bi bi-film fs-1 d-block mb-2"></i>
                <p class="mb-0">${nombre}</p>
                <small class="text-muted">Sin archivo proporcionado</small>
            </div>`;
        }
    } else if (tipo === 'pdf') {
        if (hasUrl) {
            console.log('Creando iframe para PDF con URL:', url);
            const iframe = document.createElement('iframe');
            iframe.src = url;
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            contentContainer.appendChild(iframe);
        } else {
            console.warn('No se proporcionó URL para el PDF');
            contentContainer.innerHTML = `<div class="text-center text-white p-4">
                <i class="bi bi-file-earmark-pdf fs-1 d-block mb-2"></i>
                <p class="mb-0">${nombre}</p>
                <small class="text-muted">Sin archivo proporcionado</small>
            </div>`;
        }
    }
}
