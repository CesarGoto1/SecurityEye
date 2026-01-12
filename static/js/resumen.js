// ==========================================
// RESUMEN.JS - Página de análisis post-sesión (Con Gráficos)
// ==========================================

// ==========================================
// 1. VARIABLES GLOBALES
// ==========================================

let sesionId = null;
let sesionData = null;

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

        // Llenar información de sesión básica
        const fecha = new Date(sesionData.fecha_inicio).toLocaleDateString('es-ES');
        document.getElementById('sessionDate').textContent = fecha;

        // Convertir segundos a formato mm:ss
        const minutos = Math.floor(sesionData.total_segundos / 60);
        const segundos = sesionData.total_segundos % 60;
        document.getElementById('summaryDuration').textContent = 
            `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        document.getElementById('summaryAlerts').textContent = sesionData.alertas || 0;
        
        // Estado General Simplificado
        const estadoFatiga = sesionData.es_fatiga ? 'FATIGA DETECTADA' : 'ESTADO NORMAL';
        const colorEstado = sesionData.es_fatiga ? 'danger' : 'success';
        const icono = sesionData.es_fatiga ? '<i class="bi bi-exclamation-triangle-fill me-2"></i>' : '<i class="bi bi-check-circle-fill me-2"></i>';
        
        document.getElementById('metricFatigueState').innerHTML = 
            `<span class="badge bg-${colorEstado} fs-6 p-2">${icono}${estadoFatiga}</span>`;


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

                // 2. Análisis Biométrico (Simplificado o filtrado si es necesario)
                const bioList = document.getElementById('aiBiometricAnalysis');
                bioList.innerHTML = '';
                if (diag.analisis_biometrico) {
                    for (const [key, value] of Object.entries(diag.analisis_biometrico)) {
                        const li = document.createElement('li');
                        li.className = "mb-2 small";
                        li.style.cssText = "color: #444 !important;"; 
                        li.innerHTML = `<strong style="color: #000 !important; text-transform: capitalize;">${key.replace('_', ' ')}:</strong> ${value}`;
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
// 4. CONSTRUIR GRÁFICOS
// ==========================================

function construirGraficos() {
    if (!sesionData) return;

    // --- GRÁFICO 1: EVOLUCIÓN DE FATIGA ---
    const ctxFatigue = document.getElementById('fatigueChart').getContext('2d');
    const perclosFinal = sesionData.perclos ? Number(sesionData.perclos) : 0;
    
    // Simular puntos de datos para la curva (Inicio -> Medio -> Final)
    // En un sistema real, usaríamos timestamps de mediciones
    const dataPoints = [
        Math.max(0, perclosFinal - 10), // Inicio (estimado más bajo)
        Math.max(0, perclosFinal - 5),  // Medio
        perclosFinal * 0.9,
        perclosFinal                    // Valor final real
    ];

    new Chart(ctxFatigue, {
        type: 'line',
        data: {
            labels: ['Inicio', 'Progreso', 'Progreso', 'Final'],
            datasets: [{
                label: 'Nivel de Fatiga (%)',
                data: dataPoints,
                borderColor: '#3A7D8E',
                backgroundColor: 'rgba(58, 125, 142, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#3A7D8E'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'Fatiga: ' + context.parsed.y.toFixed(1) + '%';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100, // PERCLOS va de 0 a 100
                    grid: { borderDash: [5, 5] },
                    ticks: { callback: function(value) { return value + '%' } }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });

    // --- GRÁFICO 2: DISTRIBUCIÓN DE ALERTAS ---
    const ctxAlerts = document.getElementById('alertsChart').getContext('2d');
    let momentos = [];
    
    // Parseo seguro de momentos_fatiga
    if (sesionData.momentos_fatiga) {
        if (typeof sesionData.momentos_fatiga === 'string') {
            try { momentos = JSON.parse(sesionData.momentos_fatiga); } catch {}
        } else if (Array.isArray(sesionData.momentos_fatiga)) {
            momentos = sesionData.momentos_fatiga;
        }
    }

    // Contar razones de alertas
    const counts = {};
    if (momentos.length > 0) {
        momentos.forEach(m => {
            const r = m.reason || 'Fatiga General';
            counts[r] = (counts[r] || 0) + 1;
        });
    } else {
        counts['Sin Alertas'] = 1;
    }

    const labels = Object.keys(counts);
    const dataValues = Object.values(counts);
    
    // Colores para el gráfico de dona
    const backgroundColors = momentos.length > 0 
        ? ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF']
        : ['#e9ecef']; // Gris si no hay alertas

    new Chart(ctxAlerts, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: backgroundColors,
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { usePointStyle: true, boxWidth: 8, padding: 15 }
                },
                tooltip: {
                    enabled: momentos.length > 0 // Desactivar tooltip si es placeholder
                }
            }
        }
    });
}