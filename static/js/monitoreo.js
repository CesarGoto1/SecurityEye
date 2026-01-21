// ==========================================
// MONITOREO CONTINUO - SecurityEye
// Adaptado para lectura de PDF y guardado único al final
// ==========================================

// ==========================================
// 1. VARIABLES GLOBALES Y REFERENCIAS
// ==========================================

const API_BASE = '';
const videoElement = document.getElementById('videoElement'); // Webcam
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
let currentActivityType = 'pdf'; // Solo PDF
let currentResourceUrl = null;
let currentResourceName = null;

// Variables para el flujo de recomendación IA
let pendingRedirectUrl = null;
let isRecommendationModalOpen = false;

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
let earValues = []; 
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
        
        // Guardamos EAR para promedio
        earValues.push(currentEAR);

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
                // Se eliminó metricsLastSent
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
            // DETECCIÓN DE FATIGA (local para alertas)
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

                // Guardar momento de fatiga para el reporte final
                momentosFatiga.push({
                    t: Math.round(elapsed),
                    reason: nivelFatiga >= 5 ? 'Fatiga severa' : 'Fatiga moderada'
                });
            }

            // **IMPORTANTE**: Se eliminó el guardado periódico de métricas.
            // Ahora se acumulan y se envían solo al finalizar.
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
            maxSinParpadeo = 0;
            earValues = [];
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
    if (!sesionId) {
        console.error('Falta ID de sesión');
        alert('Error: Sesión no válida');
        completeStopMonitoring();
        return;
    }
    console.log('Usando sesión existente con ID:', sesionId);
}

// Se eliminó guardarMetricasContinuas

async function finalizarSesion() {
    completeStopMonitoring();
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
            const activityType = 'pdf';
            
            // Cálculos finales totales
            const tiempoTotal = Math.round((performance.now() / 1000) - startTime - (CALIBRATION_DURATION));
            const blinkRateMinFinal = tiempoTotal > 0 ? (blinkCounter / (tiempoTotal / 60)) : 0;
            const perclos = measureFramesTotal > 0 ? (measureFramesClosed / measureFramesTotal) * 100 : 0;
            const pctIncompletos = blinkCounter > 0 ? (incompleteBlinks / blinkCounter) * 100 : 0;
            const avgVelocity = frameCount > 5 ? parseFloat(((totalIrisDistance / frameCount) * 100).toFixed(4)) : 0;
            const earPromedio = earValues.length > 0 ? earValues.reduce((a, b) => a + b, 0) / earValues.length : 0;
            
            // Estado de fatiga final
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
                ear_promedio: parseFloat(earPromedio.toFixed(4)),
                max_sin_parpadeo: Math.round(maxSinParpadeo),
                kss_final: parseInt(kssValue),
                alertas: alertasCount,
                momentos_fatiga: momentosFatiga,
                es_fatiga: esFatiga
            };

            // Mostrar spinner o mensaje de carga si se desea (opcional)
            console.log("Enviando datos finales y solicitando diagnóstico IA...");

            try {
                // Esta llamada ahora es ÚNICA y dispara el diagnóstico IA en el backend
                const response = await fetch(`${API_BASE}/save-fatigue`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    const data = await response.json();
                    console.log("Sesión finalizada. Diagnóstico:", data.diagnostico);
                    window.location.href = `/usuario/resumen.html?sesion_id=${sesionId}`;
                } else {
                    const err = await response.text();
                    console.error("Error backend:", err);
                    alert('Error al guardar la sesión final: ' + err);
                }
            } catch (e) {
                console.error('Error:', e);
                alert('No se pudo conectar al servidor para finalizar la sesión.');
            }
        };
    });
}

function mostrarAlertaFatiga() {
    if (alertBanner && alertText) {
        alertBanner.classList.remove('d-none');
        alertText.textContent = 'Fatiga detectada - Se recomienda descanso';
        
        setTimeout(() => {
            alertBanner.classList.add('d-none');
        }, 5000);
    }
}

async function abrirModalDescanso() {
    const modalEl = document.getElementById('breakActivityModal');
    if (!modalEl) {
        return;
    }
    // Pausar monitoreo antes de abrir el modal de selección
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
            btn.innerHTML = `<i class="bi bi-play-circle"></i> ${act.nombre} (${act.duracion_seg}s)`;
            
            // Lógica de redirección al hacer click en un descanso
            btn.onclick = () => {
                const breakModal = bootstrap.Modal.getInstance(modalEl);
                if (breakModal) breakModal.hide();
                
                // Redirigir directamente a la página de la instrucción
                window.location.href = `/usuario/instruccion${act.id}.html?sesion_id=${sesionId}`;
            };
            container.appendChild(btn);
        });
        const breakModal = new bootstrap.Modal(modalEl);
        breakModal.show();
    } catch (e) {
        console.error('Error cargando actividades:', e);
    }
}

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

    const params = new URLSearchParams(window.location.search);
    sesionId = params.get('sesion_id');
    currentResourceName = params.get('nombre');
    currentResourceUrl = params.get('url');
    
    // Para PDFs locales que no tienen URL directamente en el input
    if (!currentResourceUrl) {
        currentResourceUrl = sessionStorage.getItem('pdfDataUrl');
        sessionStorage.removeItem('pdfDataUrl'); 
    }

    if (!sesionId || !currentResourceName) {
        alert('Sesión no válida. Redirigiendo...');
        window.location.href = 'seleccionar_actividad.html';
        return;
    }

    if(sessionInfoEl) sessionInfoEl.textContent = `Lectura - ${currentResourceName}`;
    
    // Forzamos carga PDF
    cargarContenidoPDF(currentResourceUrl, currentResourceName);
});

// ==========================================
// 8. CARGAR CONTENIDO (SOLO PDF)
// ==========================================

async function cargarContenidoPDF(url, nombre) {
    console.log('Cargando PDF en modo scroll:', { url, nombre });
    contentContainer.innerHTML = '';
    const hasUrl = url && url.trim() !== '';

    if (hasUrl) {
        // 1. Mostrar un spinner de carga y crear contenedor
        contentContainer.innerHTML = `
            <div id="pdf-viewer-scroll" style="width: 100%; height: 100%; overflow-y: auto; text-align: center;">
                <div class="text-center my-5">
                    <div class="spinner-border text-light" role="status">
                        <span class="visually-hidden">Cargando PDF...</span>
                    </div>
                    <p class="text-white-50 mt-2">Cargando documento...</p>
                </div>
                <div id="pdf-pages-container" class="d-flex flex-column align-items-center py-3" style="visibility: hidden;"></div>
            </div>`;
        
        const pagesContainer = document.getElementById('pdf-pages-container');
        const loadingIndicator = contentContainer.querySelector('.text-center.my-5');

        try {
            const loadingTask = pdfjsLib.getDocument(url);
            const pdfDoc = await loadingTask.promise;
            
            // Ocultar spinner y mostrar contenedor de páginas
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            pagesContainer.style.visibility = 'visible';

            // 2. Renderizar todas las páginas secuencialmente
            for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                const page = await pdfDoc.getPage(pageNum);
                
                const canvas = document.createElement('canvas');
                canvas.className = 'pdf-page-canvas mb-3 shadow-sm';
                pagesContainer.appendChild(canvas);
                
                const desiredWidth = pagesContainer.clientWidth * 0.98;
                const viewportAtScale1 = page.getViewport({ scale: 1 });
                const scale = desiredWidth / viewportAtScale1.width;
                const viewport = page.getViewport({ scale: scale });
                
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                
                const ctx = canvas.getContext('2d');
                const renderContext = {
                    canvasContext: ctx,
                    viewport: viewport
                };
                
                // Renderizar y esperar a que termine antes de pasar a la siguiente
                await page.render(renderContext).promise;
            }

        } catch (err) {
            console.error('Error al cargar el PDF:', err);
            contentContainer.innerHTML = `<div class="text-center text-danger p-4"><i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i><p class="mb-0">Error al cargar el PDF.</p><small class="text-muted">${err.message}</small></div>`;
        }
    } else {
        contentContainer.innerHTML = `<div class="text-center text-white p-4"><i class="bi bi-file-earmark-pdf fs-1 d-block mb-2"></i><p class="mb-0">${nombre}</p><small class="text-muted">Sin archivo proporcionado</small></div>`;
    }
}

// ==========================================
// 9. MANEJO DEL MODAL DE RECOMENDACIÓN
// ==========================================
const confirmBtn = document.getElementById('btnConfirmRecommendation');
const recommendationModalEl = document.getElementById('recommendationModal');

if (confirmBtn && recommendationModalEl) {
    confirmBtn.onclick = () => {
        if (pendingRedirectUrl) {
            completeStopMonitoring();
            window.location.href = pendingRedirectUrl;
        }
    };

    recommendationModalEl.addEventListener('hidden.bs.modal', () => {
        isRecommendationModalOpen = false;
        pendingRedirectUrl = null;
    });
}