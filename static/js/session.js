// ========================================================
// FUNCIÓN GLOBAL PARA CERRAR SESIÓN (admin y usuario)
// ========================================================
function cerrarSesion() {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = "/login.html";
}

// ========================================================
// FUNCIÓN GLOBAL PARA PROTEGER RUTAS
// protegerRuta("usuario") → solo estudiante
// ========================================================
function protegerRuta(rolRequerido) {
    const usuarioStr = localStorage.getItem("usuario");

    if (!usuarioStr) {
        window.location.href = "/login.html";
        return;
    }

    const usuario = JSON.parse(usuarioStr);

    // This function can be simplified further if there are no roles anymore
    // but for now, we keep the structure.
}

// ========================================================
// OBTENER USUARIO GENERAL (si se necesita en tablas o UI)
// ========================================================
function obtenerUsuarioSimple() {
    const usuarioStr = localStorage.getItem("usuario");
    return usuarioStr ? JSON.parse(usuarioStr) : null;
}
