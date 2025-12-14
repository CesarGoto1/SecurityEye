// ==========================================
// HISTORIAL.JS - Historial de sesiones
// ==========================================

// ==========================================
// 1. VARIABLES GLOBALES
// ==========================================

let historialData = [];
let usuarioData = null;

// ==========================================
// 2. CARGAR DATOS AL INICIAR
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    // Protección de ruta
    const usuarioStr = localStorage.getItem('usuario');
    if (!usuarioStr) {
        window.location.href = '/templates/login.html';
        return;
    }

    usuarioData = JSON.parse(usuarioStr);
    document.getElementById('userName').textContent = 
        `${usuarioData.nombre} ${usuarioData.apellido}`;

    try {
        await cargarHistorial();
        calcularEstadisticas();
    } catch (e) {
        console.error('Error cargando historial:', e);
        alert('Error al cargar historial');
    }
});

// ==========================================
// 3. CARGAR HISTORIAL DE SESIONES
// ==========================================

async function cargarHistorial() {
    try {
        const response = await fetch('http://localhost:8000/get-user-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario_id: usuarioData.id })
        });

        if (!response.ok) throw new Error('Error en servidor');

        const data = await response.json();

        if (data.empty || !data.historial || data.historial.length === 0) {
            document.getElementById('emptyState').classList.remove('d-none');
            document.getElementById('sessionsContent').classList.add('d-none');
            return;
        }

        historialData = data.historial;
        document.getElementById('emptyState').classList.add('d-none');
        document.getElementById('sessionsContent').classList.remove('d-none');

        llenarTabla();

    } catch (e) {
        console.error('Error:', e);
        throw e;
    }
}

// ==========================================
// 4. LLENAR TABLA DE SESIONES
// ==========================================

function llenarTabla() {
    const tbody = document.getElementById('sessionsList');
    tbody.innerHTML = '';

    historialData.forEach((sesion, index) => {
        // `sesion.fecha` ya viene formateada desde el backend (TO_CHAR)
        const fecha = sesion.fecha || '-';
        const actividad = sesion.tipo_actividad === 'pdf' ? 'PDF' : 'Video';
        
        // Convertir segundos a mm:ss
        const minutos = Math.floor(sesion.total_segundos / 60);
        const segundos = sesion.total_segundos % 60;
        const duracion = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        const alertas = sesion.alertas || 0;
        const fatigaEstado = sesion.es_fatiga 
            ? '<span class="badge bg-danger">Fatiga</span>'
            : '<span class="badge bg-success">Normal</span>';

        const botonDetalles = `
            <button class="btn btn-sm btn-outline-primary" 
                    onclick="abrirDetalles(${sesion.sesion_id})">
                <i class="bi bi-eye"></i> Ver
            </button>
        `;

        const row = `
            <tr>
                <td>${index + 1}</td>
                <td>${fecha}</td>
                <td>${actividad}</td>
                <td>${duracion}</td>
                <td><span class="badge bg-warning text-dark">${alertas}</span></td>
                <td>${fatigaEstado}</td>
                <td>${botonDetalles}</td>
            </tr>
        `;

        tbody.innerHTML += row;
    });
}

// ==========================================
// 5. CALCULAR ESTADÍSTICAS
// ==========================================

function calcularEstadisticas() {
    if (!historialData || historialData.length === 0) return;

    // Total de sesiones
    document.getElementById('totalSessions').textContent = historialData.length;

    // Tiempo total
    let tiempoTotal = 0;
    historialData.forEach(s => {
        tiempoTotal += s.total_segundos || 0;
    });

    const horas = Math.floor(tiempoTotal / 3600);
    const minutos = Math.floor((tiempoTotal % 3600) / 60);
    const tiempoFormato = horas > 0 
        ? `${horas}h ${minutos}m`
        : `${minutos}m`;
    document.getElementById('totalTime').textContent = tiempoFormato;

    // Fatiga promedio
    let sumFatiga = 0;
    let contFatiga = 0;
    historialData.forEach(s => {
        if (s.perclos !== null && s.perclos !== undefined) {
            sumFatiga += parseFloat(s.perclos);
            contFatiga++;
        }
    });
    const fatigaPromedio = contFatiga > 0 ? (sumFatiga / contFatiga).toFixed(1) : '0.0';
    document.getElementById('avgFatigue').textContent = fatigaPromedio + '%';

    // Alertas totales
    let totalAlertas = 0;
    historialData.forEach(s => {
        totalAlertas += s.alertas || 0;
    });
    document.getElementById('totalAlerts').textContent = totalAlertas;
}

// ==========================================
// 6. ABRIR DETALLES EN MODAL
// ==========================================

async function abrirDetalles(sesionId) {
    try {
        const response = await fetch(`http://localhost:8000/sesiones/${sesionId}`);
        if (!response.ok) throw new Error('No se encontró sesión');

        const sesion = await response.json();
        const modalContent = document.getElementById('modalContent');

        // Construir contenido del modal
        // momentos_fatiga ya viene como objeto desde el backend (JSONB)
        let momentos = [];
        if (sesion.momentos_fatiga) {
            if (typeof sesion.momentos_fatiga === 'string') {
                try {
                    momentos = JSON.parse(sesion.momentos_fatiga);
                } catch (e) {
                    console.warn('Error parseando momentos_fatiga:', e);
                    momentos = [];
                }
            } else if (Array.isArray(sesion.momentos_fatiga)) {
                momentos = sesion.momentos_fatiga;
            }
        }
        const fecha = new Date(sesion.fecha_inicio).toLocaleString('es-ES');
        const actividad = sesion.tipo_actividad === 'pdf' ? 'PDF de lectura' : 'Video educativo';
        const estado = sesion.es_fatiga 
            ? '<span class="badge bg-danger">FATIGA DETECTADA</span>'
            : '<span class="badge bg-success">ESTADO NORMAL</span>';

        const minutos = Math.floor(sesion.total_segundos / 60);
        const segundos = sesion.total_segundos % 60;
        const duracion = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        let momentosHTML = '';
        if (momentos.length > 0) {
            momentosHTML = `
                <hr>
                <h6 class="fw-bold mb-3">Momentos de fatiga detectados:</h6>
                <div class="list-group list-group-sm">
            `;
            momentos.forEach((m, i) => {
                const t_min = Math.floor(m.t / 60);
                const t_seg = m.t % 60;
                const t_str = `${String(t_min).padStart(2, '0')}:${String(t_seg).padStart(2, '0')}`;
                momentosHTML += `
                    <div class="list-group-item">
                        <small class="text-muted">${t_str}</small> - ${m.reason}
                    </div>
                `;
            });
            momentosHTML += '</div>';
        } else {
            momentosHTML = '<p class="text-muted text-center small">Sin momentos críticos detectados</p>';
        }

        modalContent.innerHTML = `
            <div class="row mb-3">
                <div class="col-6">
                    <strong class="text-muted d-block small">Fecha</strong>
                    <span>${fecha}</span>
                </div>
                <div class="col-6">
                    <strong class="text-muted d-block small">Actividad</strong>
                    <span>${actividad}</span>
                </div>
            </div>

            <div class="row mb-3">
                <div class="col-6">
                    <strong class="text-muted d-block small">Duración</strong>
                    <span>${duracion}</span>
                </div>
                <div class="col-6">
                    <strong class="text-muted d-block small">Estado</strong>
                    ${estado}
                </div>
            </div>

            <div class="row mb-3">
                <div class="col-6">
                    <strong class="text-muted d-block small">Fatiga (PERCLOS)</strong>
                    <span>${sesion.perclos ? sesion.perclos.toFixed(1) : 'N/A'}%</span>
                </div>
                <div class="col-6">
                    <strong class="text-muted d-block small">Parpadeos</strong>
                    <span>${sesion.sebr || 0}</span>
                </div>
            </div>

            <div class="row mb-3">
                <div class="col-6">
                    <strong class="text-muted d-block small">Bostezos</strong>
                    <span>${sesion.num_bostezos || 0}</span>
                </div>
                <div class="col-6">
                    <strong class="text-muted d-block small">Alertas</strong>
                    <span class="badge bg-warning text-dark">${sesion.alertas || 0}</span>
                </div>
            </div>

            ${momentosHTML}
        `;

        // Configurar link a resumen completo
        document.getElementById('viewResumenLink').href = 
            `/templates/usuario/resumen.html?sesion_id=${sesionId}`;

        // Mostrar modal
        const modal = new bootstrap.Modal(document.getElementById('detailModal'));
        modal.show();

    } catch (e) {
        console.error('Error cargando detalles:', e);
        alert('Error al cargar detalles de sesión');
    }
}

// ==========================================
// 7. CERRAR SESIÓN
// ==========================================

function cerrarSesion() {
    localStorage.removeItem('usuario');
    localStorage.removeItem('token');
    window.location.href = '/templates/login.html';
}
