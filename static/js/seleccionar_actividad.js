const API_BASE = '';

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnIniciar');

  btn.addEventListener('click', async () => {
    const usuarioId = JSON.parse(localStorage.getItem('usuario'))?.id;
    if (!usuarioId) {
      alert('No se encontró usuario en sesión.');
      return;
    }

    const youtubeUrl = document.getElementById('youtubeUrl').value.trim();
    let tipo, nombre, url, file, fuente;

    if (youtubeUrl) {
      // --- LÓGICA PARA YOUTUBE ---
      if (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be')) {
        alert('Por favor, introduce una URL de YouTube válida.');
        return;
      }
      tipo = 'youtube';
      nombre = 'Video de YouTube';
      url = youtubeUrl;
      fuente = nombre;
      file = null; // No hay archivo para YouTube
    } else {
      // --- LÓGICA EXISTENTE PARA PDF ---
      tipo = 'pdf';
      nombre = document.getElementById('pdfNombre').value.trim();
      url = document.getElementById('pdfUrl').value.trim();
      file = document.getElementById('pdfFile').files[0];
      fuente = nombre;

      if (!nombre) {
        alert('Por favor ingresa un nombre para el documento.');
        return;
      }
      if (!url && !file) {
        alert('Por favor selecciona un archivo PDF o ingresa una URL.');
        return;
      }
    }

    try {
      // --- LÓGICA COMÚN (Crear sesión y redirigir) ---
      const resp = await fetch(`${API_BASE}/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          usuario_id: usuarioId, 
          tipo_actividad: tipo, 
          fuente: fuente 
        })
      });

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.detail || 'Error creando sesión');
      }

      const data = await resp.json();
      const sesionId = data.sesion_id;

      let resourceUrl = url;
      if (file) { // La gestión de archivos solo se aplica a PDF
        try {
          const fileDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(new Error('No se pudo leer el archivo.'));
            reader.readAsDataURL(file);
          });
          sessionStorage.setItem('pdfDataUrl', fileDataUrl);
          resourceUrl = ''; 
        } catch (fileError) {
          console.error(fileError);
          alert(fileError.message);
          return;
        }
      }

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