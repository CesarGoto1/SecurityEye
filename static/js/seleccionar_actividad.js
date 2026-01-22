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

    if (!youtubeUrl) {
        alert('Por favor, introduce una URL de YouTube.');
        return;
    }

    if (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be')) {
      alert('Por favor, introduce una URL de YouTube válida.');
      return;
    }
    
    const tipo = 'youtube';
    const nombre = 'Video de YouTube';

    try {
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

      const params = new URLSearchParams({
        sesion_id: sesionId,
        tipo: tipo,
        nombre: nombre,
        url: youtubeUrl
      });

      window.location.href = `monitoreo.html?${params.toString()}`;

    } catch (e) {
      console.error('Error:', e);
      alert('No se pudo iniciar la sesión: ' + e.message);
    }
  });
});