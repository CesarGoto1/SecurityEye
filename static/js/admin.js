// ========================================================
//  PROTEGER RUTA SOLO ADMIN
// ========================================================
protegerRuta("admin");

const userLog = obtenerUsuarioSimple();
console.log("Admin logueado:", userLog);

// Elementos del DOM
const tabla = document.getElementById("tablaUsuarios");
const totalEstudiantesEl = document.getElementById("totalEstudiantes");
const fatigaInicialPromEl = document.getElementById("fatigaInicialProm");
const reduccionPromEl = document.getElementById("reduccionProm");

// NOTA: Sistema actualizado a monitoreo CONTINUO (no inicial/final)

let graficoFatiga = null;
let graficoReduccion = null;

// ========================================================
//  Cargar sesiones globales del backend
// ========================================================
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const resp = await fetch("http://localhost:8000/admin/all-sessions");
        const data = await resp.json();

        if (!data.ok) {
            console.error(data.error);
            alert("No se pudieron cargar los datos.");
            return;
        }

        console.log("Sesiones recibidas:", data);
        llenarTabla(data.sesiones);
        llenarMetricas(data.sesiones);
        generarGraficos(data.sesiones);

    } catch (err) {
        console.error(err);
        alert("Error al conectar con el servidor.");
    }
});

// ========================================================
//  Llenar tabla de usuarios (CONTINUO)
// ========================================================
function llenarTabla(sesiones) {
    tabla.innerHTML = "";

    sesiones.forEach((s, idx) => {
        const fatigaStatus = s.es_fatiga 
            ? '<span class="badge bg-danger">Fatiga</span>' 
            : '<span class="badge bg-success">Normal</span>';
        
        const duracionMin = Math.floor(s.total_segundos / 60);
        const duracionSeg = s.total_segundos % 60;
        const duracion = `${String(duracionMin).padStart(2, '0')}:${String(duracionSeg).padStart(2, '0')}`;

        tabla.innerHTML += `
            <tr>
                <td>${idx + 1}</td>
                <td>${s.estudiante}</td>
                <td>${s.fecha}</td>
                <td>${s.tipo_actividad === 'pdf' ? 'PDF' : 'Video'}</td>
                <td>${duracion}</td>
                <td><span class="badge bg-warning text-dark">${s.alertas || 0}</span></td>
                <td>${fatigaStatus}</td>
                <td>
                    <button class="btn btn-outline-primary btn-sm"
                        onclick="verDetalle(${s.sesion_id})">
                        <i class="bi bi-eye"></i> Ver
                    </button>
                </td>
            </tr>
        `;
    });
}

// ========================================================
//  Acción para ver detalle
// ========================================================
function verDetalle(id) {
    window.location.href = `details.html?sesion=${id}`;
}

// ========================================================
//  Cálculo de métricas globales (CONTINUO)
// ========================================================
function llenarMetricas(sesiones) {
    const estudiantesUnicos = new Set(sesiones.map(s => s.estudiante));
    totalEstudiantesEl.textContent = estudiantesUnicos.size;

    // Promedio de fatiga continua (PERCLOS)
    const perclosValues = sesiones.filter(s => s.perclos !== null && s.perclos !== undefined)
                                   .map(s => parseFloat(s.perclos));
    const avgPerclos = promedio(perclosValues);

    // Promedio de alertas
    const avgAlertas = promedio(sesiones.map(s => s.alertas || 0));

    fatigaInicialPromEl.textContent = avgPerclos.toFixed(1) + "%";
    reduccionPromEl.textContent = Math.round(avgAlertas);
}

function promedio(arr) {
    if (arr.length === 0) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

// ========================================================
//  Gráficos globales (CONTINUO)
// ========================================================
function generarGraficos(sesiones) {
    const perclosValues = sesiones.filter(s => s.perclos !== null && s.perclos !== undefined)
                                   .map(s => parseFloat(s.perclos));
    const promedioPerclos = promedio(perclosValues);

    const etiquetasSesiones = sesiones.map((s, i) => `#${i+1} ${s.estudiante}`);
    const alertasPerSesion = sesiones.map(s => s.alertas || 0);
    const perclosPorSesion = sesiones.map(s => parseFloat(s.perclos || 0));

    // --- Gráfico 1: Fatiga Continua (PERCLOS) ---
    const ctx1 = document.getElementById("graficoFatiga").getContext("2d");

    if (graficoFatiga) graficoFatiga.destroy();

    graficoFatiga = new Chart(ctx1, {
        type: "bar",
        data: {
            labels: ["Promedio de Fatiga"],
            datasets: [{
                label: "PERCLOS (%)",
                data: [promedioPerclos],
                backgroundColor: ["#3A7D8E"]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { 
                y: { 
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        callback: (value) => value + "%"
                    }
                }
            }
        }
    });

    // --- Gráfico 2: Alertas por sesión ---
    const ctx2 = document.getElementById("graficoReduccion").getContext("2d");

    if (graficoReduccion) graficoReduccion.destroy();

    graficoReduccion = new Chart(ctx2, {
        type: "bar",
        data: {
            labels: etiquetasSesiones,
            datasets: [{
                label: "Alertas de Fatiga",
                data: alertasPerSesion,
                backgroundColor: alertasPerSesion.map(val => val > 0 ? "#E74C3C" : "#27AE60")
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}
