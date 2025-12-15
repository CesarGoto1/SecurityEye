// ==========================================
// MONITOREO CONTINUO - SecurityEye
// Adaptado de medicion.js para flujo continuo
// ==========================================

// ==========================================
// 1. VARIABLES GLOBALES Y REFERENCIAS
// ==========================================

const API_BASE = '';
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

// PDF.js state
let pdfDoc = null,
    pageNum = 1,
    pageRendering = false,
    pageNumPending = null;

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

// Variables para el flujo de recomendación IA
let pendingRedirectUrl = null;
let isRecommendationModalOpen = false;

// Referencias al nuevo modal de actividad
const activityModalElement = document.getElementById('activityModal');
const activityModal = new bootstrap.Modal(activityModalElement);
const activityModalBody = document.getElementById('activityModalBody');
const activityModalLabel = document.getElementById('activityModalLabel');


// Constantes y umbrales
const CALIBRATION_DURATION = 10;
const ALERT_COOLDOWN = 30;
const METRIC_PUSH_INTERVAL = 60;
let calibrationEARs = [];
let calibrationMARs = [];
let baselineEAR = 0;
let baselineMAR = 0;
let thresClose = 0.20;
let thresOpen = 0.25;
let thresYawn = 0.50;
let metricsLastSent = 0;

// Métricas de seguimiento
let blinkCounter = 0;
let incompleteBlinks = 0;
let accumulatedClosureTime = 0;
let measureFramesTotal = 0;
let measureFramesClosed = 0;
let isBlinking = false;
let minEarInBlink = 1.0;
let yawnCounter = 0;
let earValues = []; // Acumulador para EAR promedio
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
                if (blinkCountEl) blinkCountEl.textContent = blinkCounter;
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
                        if (yawnCountEl) yawnCountEl.textContent = yawnCounter;
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
            if (perclosEl) perclosEl.textContent = parseFloat(perclos.toFixed(1)) + '%';

            // -------------------------
            // DETECCIÓN DE FATIGA (alineada con medicion.js)
            // -------------------------
            const blinkRateMin = elapsed > 0 ? (blinkCounter / (elapsed / 60)) : 0;

            const pctIncompletos = blinkCounter > 0
                ? (incompleteBlinks / blinkCounter) * 100
                : 0;

            const avgVelocity = frameCount > 5
                ? parseFloat(((totalIrisDistance / frameCount) * 100).toFixed(4))
                : 0;

            let nivelFatiga = 0;
            if (perclos >= 28) nivelFatiga += 3;
            if (blinkRateMin <= 5) nivelFatiga += 3;
            if (pctIncompletos >= 20) nivelFatiga += 2;
            if (yawnCounter >= 1) nivelFatiga += 1;
            if (avgVelocity < 0.02) nivelFatiga += 1;
            if (accumulatedClosureTime >= 3) nivelFatiga += 1;

            // Mostrar alerta de fatiga (con cooldown)
            if (nivelFatiga >= 3 && (now - lastAlertTime) > ALERT_COOLDOWN) {
                mostrarAlertaFatiga();
                alertasCount++;
                if (alertsCountEl) alertsCountEl.textContent = alertasCount;
                lastAlertTime = now;

                // Guardar momento de fatiga
                momentosFatiga.push({
                    t: Math.round(elapsed),
                    reason: nivelFatiga >= 5 ? 'Fatiga severa' : 'Fatiga moderada'
                });
            }

            // -------------------------
            // GUARDAR MÉTRICAS CADA 60 SEGUNDOS
            // -------------------------
            if ((elapsed - metricsLastSent) >= METRIC_PUSH_INTERVAL) {
                metricsLastSent = elapsed;
                guardarMetricasContinuas({
                    tiempoTranscurrido: elapsed,
                    perclos,
                    blinkRateMin,
                    avgVelocity
                });
            }
        }
    }

    canvasCtx.restore();
});

// ==========================================
// 4. CONTROL DE CÁMARA
// ==========================================

function startCamera(isResuming = false) {
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
        if (statusOverlay) statusOverlay.classList.add('d-none');
        
        lastFrameTime = performance.now() / 1000;
        
        if (isResuming) {
            console.log("Reanudando sesión de monitoreo...");
            appState = 'MONITORING';
        } else {
            appState = 'CALIBRATING';
            startTime = performance.now() / 1000;
            lastBlinkTime = startTime;
            calibrationEARs = [];
            calibrationMARs = [];
            crearSesion();
            blinkCounter = 0;
            incompleteBlinks = 0;
            accumulatedClosureTime = 0;
            measureFramesTotal = 0;
            measureFramesClosed = 0;
            yawnCounter = 0;
            totalIrisDistance = 0;
            frameCount = 0;
            alertasCount = 0;
            momentosFatiga = [];
            metricsLastSent = 0;
            maxSinParpadeo = 0;
        }
    });
}

function pauseMonitoring() {
    console.log("Pausando monitoreo...");
    running = false;
    if (camera) camera.stop();
    statusText.textContent = "Monitoreo Pausado";
    startBtn.disabled = false;
    endSessionBtn.disabled = true;
}

function resumeMonitoring() {
    console.log("Reanudando monitoreo...");
    startCamera(true);
    startBtn.disabled = true;
    endSessionBtn.disabled = false;
    statusText.textContent = "Monitoreando...";
}

function completeStopMonitoring() {
    running = false;
    if (camera) camera.stop();
    statusOverlay.classList.add('d-none');
    appState = 'IDLE';
}
// ==========================================
// 5. GESTIÓN DE SESIONES
// ==========================================

async function crearSesion() {
    if (!sesionId || !currentActivityType) {
        console.error('Faltan datos de sesión');
        alert('Error: Sesión no válida');
        completeStopMonitoring(); // Usar la nueva función de parada completa
        return;
    }
    console.log('Usando sesión existente con ID:', sesionId);
}

async function guardarMetricasContinuas({ tiempoTranscurrido, perclos, blinkRateMin, avgVelocity }) {
    if (!sesionId) return;

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const activityType = currentActivityType;

    const ear_promedio = earValues.length > 0 ? earValues.reduce((a, b) => a + b, 0) / earValues.length : 0;
    earValues = []; 

    const sebr = blinkCounter;
    const pctIncompletos = sebr > 0 ? (incompleteBlinks / sebr) * 100 : 0;
    const esFatiga = perclos >= 15 || alertasCount >= 2;

    const payload = {
        sesion_id: sesionId,
        usuario_id: usuario.id,
        actividad: activityType,
        tiempo_total_seg: Math.round(tiempoTranscurrido),
        perclos: parseFloat(perclos.toFixed(2)),
        sebr: sebr,
        ear_promedio: parseFloat(ear_promedio.toFixed(4)),
        blink_rate_min: parseFloat(blinkRateMin.toFixed(2)),
        pct_incompletos: parseFloat(pctIncompletos.toFixed(2)),
        num_bostezos: yawnCounter,
        tiempo_cierre: parseFloat(accumulatedClosureTime.toFixed(2)),
        velocidad_ocular: parseFloat(avgVelocity.toFixed(4)),
        max_sin_parpadeo: Math.round(maxSinParpadeo),
        alertas: alertasCount,
        momentos_fatiga: momentosFatiga,
        es_fatiga: esFatiga
    };

    try {
        const response = await fetch(`${API_BASE}/save-fatigue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const data = await response.json();
            console.log("Respuesta de diagnóstico recibida:", JSON.stringify(data, null, 2));

            let diagnosisData = data.diagnostico;
            let diagnosis = null;

            if (diagnosisData) {
                if (Array.isArray(diagnosisData) && diagnosisData.length > 0) {
                    diagnosis = diagnosisData[0];
                } else if (typeof diagnosisData === 'object') {
                    diagnosis = diagnosisData;
                }
            }

            if (diagnosis) {
                const nivelFatigaLimpio = diagnosis.nivel_fatiga ? diagnosis.nivel_fatiga.trim() : '';

                if (nivelFatigaLimpio === 'Crítico' && diagnosis.instruccion_sugerida && !isRecommendationModalOpen) {
                    console.log('FATIGA CRÍTICA DETECTADA. Mostrando modal de recomendación...');
                    isRecommendationModalOpen = true;

                    const instruccionId = diagnosis.instruccion_sugerida;
                    pendingRedirectUrl = `/usuario/instruccion${instruccionId}.html?sesion_id=${sesionId}`;
                    
                    const reasonEl = document.getElementById('recommendationReason');
                    if (reasonEl && diagnosis.razon_recomendacion) {
                        reasonEl.textContent = diagnosis.razon_recomendacion;
                    }

                    const recommendationModal = new bootstrap.Modal(document.getElementById('recommendationModal'));
                    recommendationModal.show();
                } else if (nivelFatigaLimpio !== 'Crítico' || !diagnosis.instruccion_sugerida) {
                    console.log('Condición de fatiga crítica no cumplida. No se muestra modal.');
                }
            } else {
                console.log('La respuesta no contenía un diagnóstico válido en la clave "diagnostico".');
            }
        } else {
            console.warn('Error guardando métricas:', response.status, await response.text());
        }
    } catch (e) {
        console.error('Error al guardar métricas continuas:', e);
    }
}

async function finalizarSesion() {
    completeStopMonitoring(); // Usar la nueva función de parada completa
    endSessionBtn.disabled = true;
    mostrarModalKSS();
}

function mostrarModalKSS() {
    const kssModal = new bootstrap.Modal(document.getElementById('subjectiveModal'));
    kssModal.show();

    document.querySelectorAll('.kss-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const kssValue = e.currentTarget.dataset.kss;
            kssModal.hide();

            const usuario = JSON.parse(localStorage.getItem('usuario'));
            const activityType = currentActivityType;
            const tiempoTotal = Math.round((performance.now() / 1000) - startTime - (CALIBRATION_DURATION));
            const blinkRateMinFinal = tiempoTotal > 0 ? (blinkCounter / (tiempoTotal / 60)) : 0;
            const perclos = measureFramesTotal > 0 ? (measureFramesClosed / measureFramesTotal) * 100 : 0;
            const pctIncompletos = blinkCounter > 0 ? (incompleteBlinks / blinkCounter) * 100 : 0;
            const avgVelocity = frameCount > 5 ? parseFloat(((totalIrisDistance / frameCount) * 100).toFixed(4)) : 0;
            const esFatiga = perclos >= 15 || alertasCount >= 2 || parseInt(kssValue) >= 7;

            const payload = {
                sesion_id: sesionId,
                usuario_id: usuario.id,
                actividad: activityType,
                tiempo_total_seg: tiempoTotal,
                perclos: parseFloat(perclos.toFixed(2)),
                sebr: blinkCounter,
                blink_rate_min: parseFloat(blinkRateMinFinal.toFixed(2)),
                pct_incompletos: parseFloat(pctIncompletos.toFixed(2)),
                num_bostezos: yawnCounter,
                tiempo_cierre: parseFloat(accumulatedClosureTime.toFixed(2)),
                velocidad_ocular: parseFloat(avgVelocity.toFixed(4)),
                max_sin_parpadeo: Math.round(maxSinParpadeo),
                kss_final: parseInt(kssValue),
                alertas: alertasCount,
                momentos_fatiga: momentosFatiga,
                es_fatiga: esFatiga
            };

            console.log('Payload final:', payload);

            try {
                const response = await fetch(`${API_BASE}/save-fatigue`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    window.location.href = `/usuario/resumen.html?sesion_id=${sesionId}`;
                } else {
                    alert('Error al guardar la sesión final.');
                }
            } catch (e) {
                console.error('Error:', e);
                alert('No se pudo conectar al servidor para finalizar la sesión.');
            }
        };
    });
}

async function cargarYMostrarActividadEnModal(urlActividad, titulo, actividadData = {}) {
    console.log(`Cargando actividad: ${titulo} desde ${urlActividad}`);
    activityModalLabel.textContent = titulo;
    activityModalBody.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Cargando...</span></div></div>';
    activityModal.show();

    try {
        // Fetch el contenido HTML de la actividad
        const response = await fetch(urlActividad);
        if (!response.ok) throw new Error(`No se pudo cargar la actividad: ${urlActividad}`);
        const htmlContent = await response.text();

        // Extraer el body (o una parte específica) y el script del contenido
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        const activityBodyContent = doc.querySelector('.activity-card') || doc.body; // Coger .activity-card si existe, sino todo el body

        activityModalBody.innerHTML = activityBodyContent.innerHTML;

        // Ejecutar scripts dentro del contenido cargado
        const scripts = activityBodyContent.querySelectorAll('script');
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => {
                newScript.setAttribute(attr.name, attr.value);
            });
            newScript.textContent = oldScript.textContent;
            activityModalBody.appendChild(newScript);
        });

        // Pasar datos de la actividad al script inyectado si es necesario
        // Esto depende de cómo las actividades manejen sus datos
        if (window.initActivity) { // Si la actividad tiene una función de inicialización
            window.initActivity(actividadData);
        }

    } catch (error) {
        console.error('Error al cargar la actividad en el modal:', error);
        activityModalBody.innerHTML = `<p class="text-danger">Error al cargar la actividad: ${error.message}</p>`;
    }
}

function mostrarAlertaFatiga() {
    if (alertBanner && alertText) {
        alertBanner.classList.remove('d-none');
        alertText.textContent = 'Fatiga detectada - Se recomienda descanso';
        
        setTimeout(() => {
            alertBanner.classList.add('d-none');
        }, 5000);
    } else {
        console.log('Alerta de fatiga generada (Contador incrementado). El elemento visual #alertBanner no existe en el HTML.');
    }
}

async function abrirModalDescanso() {
    const modalEl = document.getElementById('breakActivityModal');
    if (!modalEl) {
        console.log('Modal de descanso no disponible; se omite.');
        return;
    }
    // Pausar monitoreo antes de abrir el modal
    pauseMonitoring();

    try {
        const response = await fetch('/actividades-descanso');
        const data = await response.json();
        const container = document.getElementById('breakActivitiesContainer');
        if (!container) return;
        container.innerHTML = '';
        data.actividades.forEach(act => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline-primary';
            btn.innerHTML = `<i class="bi bi-play-circle"></i> ${act.nombre} (${act.duracion_seg}s)`; // Usar duracion_seg
            // Modificar para abrir el modal de actividad genérico
            btn.onclick = () => {
                const breakModal = bootstrap.Modal.getInstance(modalEl);
                if (breakModal) breakModal.hide(); // Cerrar el modal de selección de descanso
                cargarYMostrarActividadEnModal(`/usuario/instruccion${act.id}.html`, act.nombre, act);
            };
            container.appendChild(btn);
        });
        const breakModal = new bootstrap.Modal(modalEl);
        breakModal.show();
    } catch (e) {
        console.error('Error cargando actividades:', e);
    }
}

async function realizarActividadDescanso(actividad) {
    console.log('Realizando:', actividad.nombre);
    
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
            if (response.ok) console.log('Actividad de descanso registrada en BD');
        } catch (e) {
            console.error('Error registrando descanso:', e);
        }
    }
    
    const modalEl = document.getElementById('breakActivityModal');
    const breakModal = modalEl ? bootstrap.Modal.getInstance(modalEl) : null;
    if (breakModal) breakModal.hide();
}

// Listener para cuando el modal de actividad se cierra
activityModalElement.addEventListener('hidden.bs.modal', () => {
    console.log('Modal de actividad cerrado. Reanudando monitoreo.');
    activityModalBody.innerHTML = ''; // Limpiar el contenido del modal
    resumeMonitoring(); // Reanudar el monitoreo
});




if (startBtn) startBtn.addEventListener('click', startCamera);
if (endSessionBtn) endSessionBtn.addEventListener('click', finalizarSesion);

document.getElementById('breakBtn1')?.addEventListener('click', () => abrirModalDescanso());
document.getElementById('breakBtn2')?.addEventListener('click', () => abrirModalDescanso());
document.getElementById('breakBtn3')?.addEventListener('click', () => abrirModalDescanso());

// ==========================================
// 7. INICIALIZACIÓN AL CARGAR
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    }

    const usuario = localStorage.getItem('usuario');
    if (!usuario) {
        window.location.href = '/login.html';
        return;
    }

    const resumeStateJSON = sessionStorage.getItem('resumeState');
    if (resumeStateJSON) {
        console.log("Detectado estado para reanudar sesión.");
        const resumeState = JSON.parse(resumeStateJSON);
        sessionStorage.removeItem('resumeState');
        sesionId = resumeState.sesion_id;
        currentActivityType = resumeState.tipo;
        currentResourceName = resumeState.nombre;
        currentResourceUrl = resumeState.url;
        const tipoTexto = currentActivityType === 'video' ? 'Video' : 'PDF';
        if(sessionInfoEl) sessionInfoEl.textContent = `${tipoTexto} - ${currentResourceName}`;
        cargarContenido(currentActivityType, currentResourceUrl, currentResourceName);
        startCamera(true);
    } else {
        console.log("Iniciando nueva sesión desde parámetros de URL.");
        const params = new URLSearchParams(window.location.search);
        sesionId = params.get('sesion_id');
        currentActivityType = params.get('tipo');
        currentResourceName = params.get('nombre');
        currentResourceUrl = params.get('url');
        
        if (currentActivityType === 'pdf' && !currentResourceUrl) {
            currentResourceUrl = sessionStorage.getItem('pdfDataUrl');
            sessionStorage.removeItem('pdfDataUrl'); 
        }

        if (!sesionId || !currentActivityType || !currentResourceName) {
            alert('Sesión no válida. Redirigiendo...');
            window.location.href = 'seleccionar_actividad.html';
            return;
        }

        const tipoTexto = currentActivityType === 'video' ? 'Video' : 'PDF';
        if(sessionInfoEl) sessionInfoEl.textContent = `${tipoTexto} - ${currentResourceName}`;
        cargarContenido(currentActivityType, currentResourceUrl, currentResourceName);
    }
});

// ==========================================
// 8. CARGAR CONTENIDO (VIDEO/PDF)
// ==========================================

function renderPage(num) {
    pageRendering = true;
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');
    const pageNumEl = document.getElementById('page-num');
    const container = canvas.parentElement;

    pdfDoc.getPage(num).then(page => {
        const desiredWidth = container.clientWidth;
        const viewportAtScale1 = page.getViewport({ scale: 1 });
        const scale = desiredWidth / viewportAtScale1.width;
        const viewport = page.getViewport({ scale: scale });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = { canvasContext: ctx, viewport: viewport };
        const renderTask = page.render(renderContext);

        renderTask.promise.then(() => {
            pageRendering = false;
            if (pageNumPending !== null) {
                renderPage(pageNumPending);
                pageNumPending = null;
            }
        });
    });

    pageNumEl.textContent = num;
}

function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
}

function onPrevPage() {
    if (pageNum <= 1) return;
    pageNum--;
    queueRenderPage(pageNum);
}

function onNextPage() {
    if (pageNum >= pdfDoc.numPages) return;
    pageNum++;
    queueRenderPage(pageNum);
}

function convertirYouTubeUrl(url) {
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/;
    const match = url.match(youtubeRegex);
    if (match && match[1]) return `https://www.youtube.com/embed/${match[1]}`;
    return url;
}

function cargarContenido(tipo, url, nombre) {
    console.log('Cargando contenido:', { tipo, url, nombre });
    contentContainer.innerHTML = '';
    const hasUrl = url && url.trim() !== '';

    if (tipo === 'video') {
        if (hasUrl) {
            const esYouTube = url.includes('youtube.com') || url.includes('youtu.be');
            if (esYouTube) {
                const iframe = document.createElement('iframe');
                iframe.src = convertirYouTubeUrl(url);
                iframe.style.width = '100%';
                iframe.style.height = '100%';
                iframe.style.border = 'none';
                iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
                iframe.allowFullscreen = true;
                contentContainer.appendChild(iframe);
            } else {
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
            contentContainer.innerHTML = `<div class="text-center text-white p-4"><i class="bi bi-film fs-1 d-block mb-2"></i><p class="mb-0">${nombre}</p><small class="text-muted">Sin archivo proporcionado</small></div>`;
        }
    } else if (tipo === 'pdf') {
        if (hasUrl) {
            contentContainer.innerHTML = `
                <div id="pdf-viewer" style="width: 100%; height: 100%; display: flex; flex-direction: column;">
                    <div id="pdf-controls" class="d-flex justify-content-center align-items-center p-2 bg-dark text-white gap-3">
                        <button id="prev-page" class="btn btn-secondary btn-sm"><i class="bi bi-arrow-left"></i></button>
                        <span>Página: <span id="page-num">0</span> / <span id="page-count">0</span></span>
                        <button id="next-page" class="btn btn-secondary btn-sm"><i class="bi bi-arrow-right"></i></button>
                    </div>
                    <div style="flex-grow: 1; overflow: auto; text-align: center;"><canvas id="pdf-canvas"></canvas></div>
                </div>`;
            document.getElementById('prev-page').addEventListener('click', onPrevPage);
            document.getElementById('next-page').addEventListener('click', onNextPage);
            pdfjsLib.getDocument(url).promise.then(pdfDoc_ => {
                pdfDoc = pdfDoc_;
                document.getElementById('page-count').textContent = pdfDoc.numPages;
                pageNum = 1;
                renderPage(pageNum);
            }).catch(err => {
                console.error('Error al cargar el PDF:', err);
                contentContainer.innerHTML = `<div class="text-center text-danger p-4"><i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i><p class="mb-0">Error al cargar el PDF.</p><small class="text-muted">${err.message}</small></div>`;
            });
        } else {
            contentContainer.innerHTML = `<div class="text-center text-white p-4"><i class="bi bi-file-earmark-pdf fs-1 d-block mb-2"></i><p class="mb-0">${nombre}</p><small class="text-muted">Sin archivo proporcionado</small></div>`;
        }
    }
}

// Exponer función para que las actividades inyectadas puedan cerrar el modal
window.closeActivityModal = () => {
    activityModal.hide();
};

// ==========================================
// 9. MANEJO DEL MODAL DE RECOMENDACIÓN
// ==========================================
const confirmBtn = document.getElementById('btnConfirmRecommendation');
const recommendationModalEl = document.getElementById('recommendationModal');

if (confirmBtn && recommendationModalEl) {
    confirmBtn.onclick = () => {
        if (pendingRedirectUrl) {
            pauseMonitoring(); // Pausar monitoreo antes de abrir el modal de actividad
            // Extraer ID de la instrucción de pendingRedirectUrl
            const instruccionIdMatch = pendingRedirectUrl.match(/instruccion(\d+)\.html/);
            const instruccionId = instruccionIdMatch ? instruccionIdMatch[1] : null;
            const instruccionName = `Instrucción ${instruccionId || 'Desconocida'}`; // Nombre genérico

            // Cerrar el modal de recomendación antes de abrir el de actividad
            const recommendationBsModal = bootstrap.Modal.getInstance(recommendationModalEl);
            if (recommendationBsModal) recommendationBsModal.hide();

            // Usar la nueva función para cargar la actividad en el modal
            cargarYMostrarActividadEnModal(pendingRedirectUrl, instruccionName);
        }
    };

    recommendationModalEl.addEventListener('hidden.bs.modal', () => {
        isRecommendationModalOpen = false;
        pendingRedirectUrl = null;
        console.log('Modal de recomendación cerrado.');
    });
}
