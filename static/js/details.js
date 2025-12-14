// =====================================================
// DETAILS.JS – DETALLE DE UNA SESIÓN (MODELO CONTINUO)
// =====================================================

// Obtener ID desde la URL
const params = new URLSearchParams(window.location.search);
const sesionId = params.get("sesion");

if (!sesionId) {
    alert("ID de sesión no proporcionado.");
    window.location.href = "index.html";
}

// =====================================================
// Cargar datos de la sesión
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const resp = await fetch(`http://localhost:8000/sesiones/${sesionId}`);

        if (!resp.ok) {
            throw new Error("Error al obtener los datos de la sesión");
        }

        const datos = await resp.json();

        if (datos.error) {
            alert("Sesión no encontrada.");
            return;
        }

        // Renderizar información general
        renderInfoGeneral(datos);
        
        // Renderizar gráficos de métricas continuas
        renderGraficos(datos);
        
        // Renderizar estado de fatiga
        renderEstado(datos.es_fatiga);

        // Renderizar timeline de alertas (si existe momentos_fatiga)
        if (datos.momentos_fatiga) {
            renderTimelineAlertas(datos.momentos_fatiga);
        }

    } catch (err) {
        console.error(err);
        alert("Error cargando los detalles de la sesión.");
    }
});

// =====================================================
// Información general de la sesión
// =====================================================
function renderInfoGeneral(datos) {
    const duracion = datos.total_segundos 
        ? `${Math.floor(datos.total_segundos / 60)}:${(datos.total_segundos % 60).toString().padStart(2, '0')}` 
        : 'N/A';
    
    document.getElementById('infoActividad').textContent = datos.tipo_actividad || 'N/A';
    document.getElementById('infoDuracion').textContent = duracion;
    document.getElementById('infoAlertas').textContent = datos.alertas || 0;
    document.getElementById('infoKSS').textContent = datos.kss_final || 'N/A';
}

// =====================================================
// Gráficos de métricas continuas
// =====================================================
function renderGraficos(d) {
    const colorPrincipal = "#3A7D8E";
    const colorAlerta = "#FF6B6B";

    // PERCLOS (fatiga ocular)
    new Chart(document.getElementById("chartPerclos"), {
        type: "bar",
        data: {
            labels: ["PERCLOS"],
            datasets: [{
                label: "PERCLOS (%)",
                data: [d.perclos || 0],
                backgroundColor: d.perclos > 15 ? colorAlerta : colorPrincipal,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.parsed.y}%`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        callback: (value) => value + '%'
                    }
                }
            }
        }
    });

    // FRECUENCIA DE PARPADEO
    new Chart(document.getElementById("chartParpadeos"), {
        type: "bar",
        data: {
            labels: ["Blink Rate"],
            datasets: [{
                label: "Parpadeos/min",
                data: [d.blink_rate_min || 0],
                backgroundColor: colorPrincipal,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });

    // VELOCIDAD OCULAR
    new Chart(document.getElementById("chartVelocidad"), {
        type: "bar",
        data: {
            labels: ["Velocidad Ocular"],
            datasets: [{
                label: "Velocidad",
                data: [d.velocidad_ocular || 0],
                backgroundColor: "#A3D9D5",
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });

    // KSS (Nivel subjetivo)
    new Chart(document.getElementById("chartKSS"), {
        type: "bar",
        data: {
            labels: ["KSS"],
            datasets: [{
                label: "KSS (1-9)",
                data: [d.kss_final || 0],
                backgroundColor: d.kss_final >= 7 ? colorAlerta : colorPrincipal,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 9,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// =====================================================
// Estado de fatiga
// =====================================================
function renderEstado(esFatiga) {
    const box = document.getElementById("estadoFatiga");

    if (esFatiga) {
        box.className = "alert alert-danger";
        box.innerHTML = '<strong><i class="fas fa-exclamation-triangle me-2"></i>Fatiga detectada</strong> durante la sesión de monitoreo.';
    } else {
        box.className = "alert alert-success";
        box.innerHTML = '<strong><i class="fas fa-check-circle me-2"></i>Estado normal</strong> - No se detectó fatiga significativa.';
    }
}

// =====================================================
// Timeline de alertas
// =====================================================
function renderTimelineAlertas(momentos) {
    const container = document.getElementById('timelineAlertas');
    if (!container) return;

    if (!momentos || momentos.length === 0) {
        container.innerHTML = '<p class="text-muted">No se registraron alertas durante esta sesión.</p>';
        return;
    }

    let html = '<div class="timeline">';
    momentos.forEach((momento, index) => {
        const minutos = Math.floor(momento.t / 60);
        const segundos = momento.t % 60;
        const tiempo = `${minutos}:${segundos.toString().padStart(2, '0')}`;
        
        html += `
            <div class="timeline-item">
                <div class="timeline-badge bg-danger">
                    <i class="fas fa-exclamation"></i>
                </div>
                <div class="timeline-content">
                    <p class="mb-1"><strong>${tiempo}</strong></p>
                    <p class="text-muted mb-0">${momento.reason || 'Fatiga detectada'}</p>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    container.innerHTML = html;
}
