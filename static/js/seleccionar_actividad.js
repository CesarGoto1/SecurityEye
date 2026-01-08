const API_BASE = '';

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnIniciar');

  // Iniciar sesión solo para PDF
  btn.addEventListener('click', async () => {
    const tipo = 'pdf'; // Forzado a PDF
    const usuarioId = JSON.parse(localStorage.getItem('usuario'))?.id;
    
    if (!usuarioId) {
      alert('No se encontró usuario en sesión.');
      return;
    }

    // Obtener datos del formulario PDF
    const nombre = document.getElementById('pdfNombre').value.trim();
    const url = document.getElementById('pdfUrl').value.trim();
    const file = document.getElementById('pdfFile').files[0];

    if (!nombre) {
      alert('Por favor ingresa un nombre para el documento.');
      return;
    }
    
    if (!url && !file) {
      alert('Por favor selecciona un archivo o ingresa una URL.');
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

      // Gestionar recurso (Archivo o URL)
      let resourceUrl = url;
      if (file && !url) {
        // Leer PDF como DataURL y guardar en sessionStorage
        try {
          const fileDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(new Error('No se pudo leer el archivo.'));
            reader.readAsDataURL(file);
          });
          sessionStorage.setItem('pdfDataUrl', fileDataUrl);
          resourceUrl = ''; // URL vacía para que lea del storage en la siguiente pág
        } catch (fileError) {
          console.error(fileError);
          alert(fileError.message);
          return;
        }
      }

      // Redirigir a monitoreo con parámetros
      const params = new URLSearchParams({
        sesion_id: sesionId,
        tipo: tipo,
        nombre: nombre,
      });

      if (resourceUrl) {
        params.append('url', resourceUrl);
      }

      window.location.href = `monitoreo.html?${params.toString()}`;

    } catch (e) {
      console.error('Error:', e);
      alert('No se pudo iniciar la sesión: ' + e.message);
    }
  });
});