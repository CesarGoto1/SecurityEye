// ==========================================
// RESUMEN.JS - Página de análisis post-sesión
// ==========================================

// ==========================================
// 1. VARIABLES GLOBALES
// ==========================================

let sesionId = null;
let sesionData = null;
let diagnosisData = null;

// ==========================================
// 2. CARGAR DATOS AL INICIAR
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    // Protección de ruta
    const usuario = localStorage.getItem('usuario');
    if (!usuario) {
        window.location.href = '/login.html';
        return;
    }

    // Obtener sesion_id de URL
    const urlParams = new URLSearchParams(window.location.search);
    sesionId = urlParams.get('sesion_id');

    if (!sesionId) {
        console.error('No session ID provided');
        window.location.href = '/usuario/index.html';
        return;
    }

    try {
        await cargarDatosSesion();
        construirGraficos();
    } catch (e) {
        console.error('Error cargando resumen:', e);
        document.getElementById('diagnosisContent').innerHTML = 
            '<p class="text-danger">Error cargando datos de sesión</p>';
    }
});

// ==========================================
// 3. CARGAR DATOS DE SESIÓN
// ==========================================

async function cargarDatosSesion() {
    try {
        const response = await fetch('/sesiones/' + sesionId);
        if (!response.ok) throw new Error('No se encontró la sesión');

        sesionData = await response.json();

        // Llenar información de sesión
        const fecha = new Date(sesionData.fecha_inicio).toLocaleDateString('es-ES');
        document.getElementById('sessionDate').textContent = fecha;

        // Convertir segundos a formato mm:ss
        const minutos = Math.floor(sesionData.total_segundos / 60);
        const segundos = sesionData.total_segundos % 60;
        document.getElementById('summaryDuration').textContent = 
            `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        document.getElementById('summaryAlerts').textContent = sesionData.alertas || 0;
        const perclosVal = sesionData.perclos !== null && sesionData.perclos !== undefined
            ? Number(sesionData.perclos)
            : 0;
        document.getElementById('summaryPerclos').textContent = `${perclosVal.toFixed(1)}%`;
        document.getElementById('summaryKSS').textContent = 
            sesionData.kss_final || '-';

        // Métricas detalladas
        document.getElementById('metricBlink').textContent = 
            (sesionData.sebr || 0) + ' parpadeos';
        document.getElementById('metricYawns').textContent = 
            sesionData.num_bostezos || 0;
        document.getElementById('metricMaxNoBlinkTime').textContent = 
            sesionData.max_sin_parpadeo || 0;
        document.getElementById('metricEyeVelocity').textContent = 
            (sesionData.velocidad_ocular ? sesionData.velocidad_ocular.toFixed(2) : 0) + ' px/s';

        // Info de sesión
        document.getElementById('metricActivity').textContent = 
            sesionData.tipo_actividad === 'pdf' ? 'PDF de lectura' : 'Video educativo';
        
        const estadoFatiga = sesionData.es_fatiga ? 'FATIGA DETECTADA' : 'ESTADO NORMAL';
        const colorEstado = sesionData.es_fatiga ? 'danger' : 'success';
        document.getElementById('metricFatigueState').innerHTML = 
            `<span class="badge bg-${colorEstado}">${estadoFatiga}</span>`;

        // Momentos críticos
        if (sesionData.momentos_fatiga) {
            if (typeof sesionData.momentos_fatiga === 'string') {
                try { 
                    sesionData.momentos_fatiga = JSON.parse(sesionData.momentos_fatiga); 
                } catch { 
                    sesionData.momentos_fatiga = []; 
                }
            } else if (!Array.isArray(sesionData.momentos_fatiga)) {
                console.warn('momentos_fatiga no es un array ni un string JSON válido:', sesionData.momentos_fatiga);
                sesionData.momentos_fatiga = [];
            }
        } else {
            sesionData.momentos_fatiga = []; // Ensure it's always an array for consistency
        }
        
        document.getElementById('metricCriticalMoments').textContent = 
            sesionData.momentos_fatiga.length;

        // Timeline de alertas
        construirTimelineAlertas(sesionData.momentos_fatiga);

        // --- RENDERIZAR DIAGNÓSTICO IA ---
        if (sesionData.diagnostico_json) {
            try {
                let diag = sesionData.diagnostico_json;
                if (typeof diag === 'string') {
                    diag = JSON.parse(diag);
                }

                // Mostrar sección
                document.getElementById('aiDiagnosisSection').style.display = 'block';

                // 1. Diagnóstico General
                document.getElementById('aiGeneralDiagnosis').textContent = 
                    diag.diagnostico_general || "No disponible.";

                // 2. Análisis Biométrico
                const bioList = document.getElementById('aiBiometricAnalysis');
                bioList.innerHTML = '';
                if (diag.analisis_biometrico) {
                    for (const [key, value] of Object.entries(diag.analisis_biometrico)) {
                        const li = document.createElement('li');
                        li.className = "mb-2 text-muted small";
                        li.innerHTML = `<strong class="text-dark text-capitalize">${key.replace('_', ' ')}:</strong> ${value}`;
                        bioList.appendChild(li);
                    }
                }

                // 3. Prescripción Médica
                if (diag.prescripcion_medica) {
                    document.getElementById('aiPrescribedActivity').textContent = 
                        diag.prescripcion_medica.nombre_actividad || "Descanso General";
                    
                    document.getElementById('aiPrescriptionReason').textContent = 
                        diag.prescripcion_medica.justificacion_cientifica || "";

                    const btnPresc = document.getElementById('btnStartPrescribed');
                    const actId = diag.prescripcion_medica.instruccion_id;
                    if (actId) {
                        btnPresc.href = `/usuario/instruccion${actId}.html?sesion_id=${sesionId}`;
                        btnPresc.classList.remove('disabled');
                    } else {
                        btnPresc.classList.add('disabled');
                    }
                }

                // 4. Recomendaciones
                const recContainer = document.getElementById('aiRecommendations');
                recContainer.innerHTML = '';
                if (diag.recomendaciones_adicionales && Array.isArray(diag.recomendaciones_adicionales)) {
                    diag.recomendaciones_adicionales.forEach(rec => {
                        const span = document.createElement('span');
                        span.className = "badge bg-success bg-opacity-25 text-success border border-success fw-normal";
                        span.textContent = rec;
                        recContainer.appendChild(span);
                    });
                }

            } catch (err) {
                console.error("Error parseando diagnóstico IA:", err);
            }
        }

    } catch (e) {
        console.error('Error cargando sesión:', e);
        throw e;
    }
}



// ==========================================
// 5. CONSTRUIR GRÁFICOS
// ==========================================

function construirGraficos() {
    if (!sesionData) return;

    // Gráfico de evolución de fatiga (simulado con datos actuales)
    const fatigueCtx = document.getElementById('fatigueChart').getContext('2d');
    new Chart(fatigueCtx, {
        type: 'line',
        data: {
            labels: ['Inicio', 'Mitad', 'Final'],
            datasets: [{
                label: 'Nivel PERCLOS (%)',
                data: [
                    sesionData.perclos * 0.6,
                    sesionData.perclos * 0.8,
                    sesionData.perclos
                ],
                borderColor: '#3A7D8E',
                backgroundColor: 'rgba(163, 217, 213, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 5,
                pointBackgroundColor: '#3A7D8E'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100
                }
            }
        }
    });

    // Gráfico de alertas (si hay datos de momentos)
    const momentos = sesionData.momentos_fatiga || [];
    const alertsCtx = document.getElementById('alertsChart').getContext('2d');
    
    const alertReasons = {};
    momentos.forEach(m => {
        const reason = m.reason || 'Fatiga';
        alertReasons[reason] = (alertReasons[reason] || 0) + 1;
    });

    new Chart(alertsCtx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(alertReasons),
            datasets: [{
                data: Object.values(alertReasons),
                backgroundColor: [
                    'rgba(220, 53, 69, 0.6)',
                    'rgba(255, 193, 7, 0.6)',
                    'rgba(76, 175, 80, 0.6)',
                    'rgba(58, 125, 142, 0.6)'
                ],
                borderColor: [
                    '#dc3545',
                    '#ffc107',
                    '#4cab50',
                    '#3a7d8e'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// ==========================================
// 6. CONSTRUIR TIMELINE DE ALERTAS
// ==========================================

function construirTimelineAlertas(momentos) {
    const timeline = document.getElementById('alertsTimeline');

    if (!momentos || momentos.length === 0) {
        timeline.innerHTML = '<div class="no-alerts">No se detectaron momentos críticos</div>';
        return;
    }

    timeline.innerHTML = '';
    momentos.forEach((m, index) => {
        const minutos = Math.floor(m.t / 60);
        const segundos = m.t % 60;
        const tiempo = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        const alertItem = document.createElement('div');
        alertItem.className = 'alert-item';
        alertItem.innerHTML = `
            <div>
                <div class="time">
                    <i class="bi bi-clock"></i> ${tiempo}
                </div>
                <div class="reason">${m.reason || 'Fatiga detectada'}</div>
            </div>
            <span class="badge bg-warning text-dark">#${index + 1}</span>
        `;
        timeline.appendChild(alertItem);
    });
}

// ==========================================
// 7. FUNCIONES AUXILIARES
// ==========================================



// Actualizar fecha de sesión en tiempo real
function actualizarFechaActual() {
    const ahora = new Date().toLocaleString('es-ES');
    document.getElementById('sessionDate').textContent = ahora;
}

// Exportar resumen como PDF (función futura)
function exportarPDF() {
    console.log('Exportar PDF no implementado aún');
}