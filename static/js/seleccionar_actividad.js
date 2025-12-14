const API_BASE = 'http://127.0.0.1:8000';

document.addEventListener('DOMContentLoaded', () => {
  const tipoSel = document.getElementById('tipoActividad');
  const videoInputs = document.getElementById('videoInputs');
  const pdfInputs = document.getElementById('pdfInputs');
  const btn = document.getElementById('btnIniciar');

  // Cambiar inputs según tipo de actividad
  tipoSel.addEventListener('change', () => {
    const t = tipoSel.value;
    if (t === 'video') {
      videoInputs.classList.remove('d-none');
      pdfInputs.classList.add('d-none');
    } else {
      videoInputs.classList.add('d-none');
      pdfInputs.classList.remove('d-none');
    }
  });

  // Iniciar sesión
  btn.addEventListener('click', async () => {
    const tipo = tipoSel.value;
    const usuarioId = JSON.parse(localStorage.getItem('usuario'))?.id;
    
    if (!usuarioId) {
      alert('No se encontró usuario en sesión.');
      return;
    }

    // Obtener datos según tipo
    let nombre, url, file;
    if (tipo === 'video') {
      nombre = document.getElementById('fuenteNombre').value.trim();
      url = document.getElementById('fuenteUrl').value.trim();
      file = document.getElementById('fuenteFile').files[0];
    } else {
      nombre = document.getElementById('pdfNombre').value.trim();
      url = document.getElementById('pdfUrl').value.trim();
      file = document.getElementById('pdfFile').files[0];
    }

    if (!nombre) {
      alert('Por favor ingresa un nombre para el recurso.');
      return;
    }

    try {
      // Crear sesión en backend
      const resp = await fetch(`${API_BASE}/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          usuario_id: usuarioId, 
          tipo_actividad: tipo, 
          fuente: nombre 
        })
      });

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.detail || 'Error creando sesión');
      }

      const data = await resp.json();
      const sesionId = data.sesion_id;

      // Si hay archivo local, crear URL temporal
      let resourceUrl = url;
      if (file && !url) {
        resourceUrl = URL.createObjectURL(file);
      }

      // Redirigir a monitoreo con parámetros
      const params = new URLSearchParams({
        sesion_id: sesionId,
        tipo: tipo,
        nombre: nombre,
        url: resourceUrl || ''
      });

      window.location.href = `monitoreo.html?${params.toString()}`;

    } catch (e) {
      console.error('Error:', e);
      alert('No se pudo iniciar la sesión: ' + e.message);
    }
  });
});