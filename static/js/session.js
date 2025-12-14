// ========================================================
// FUNCIÓN GLOBAL PARA CERRAR SESIÓN (admin y usuario)
// ========================================================
function cerrarSesion() {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = "/templates/login.html";
}

// ========================================================
// FUNCIÓN GLOBAL PARA PROTEGER RUTAS
// protegerRuta("admin")  → solo admin
// protegerRuta("usuario") → solo estudiante
// ========================================================
function protegerRuta(rolRequerido) {
    const usuarioStr = localStorage.getItem("usuario");

    if (!usuarioStr) {
        window.location.href = "/templates/login.html";
        return;
    }

    const usuario = JSON.parse(usuarioStr);

    // Protección para admin
    if (rolRequerido === "admin" && usuario.rol !== "admin") {
        alert("Acceso denegado. Solo administradores pueden acceder.");
        window.location.href = "/templates/usuario/index.html";
        return;
    }

    // Protección para usuario (bloquear admin)
    if (rolRequerido === "usuario" && usuario.rol === "admin") {
        alert("Los administradores no pueden acceder a esta sección.");
        window.location.href = "/templates/admin/index.html";
        return;
    }
}

// ========================================================
// OBTENER USUARIO GENERAL (si se necesita en tablas o UI)
// ========================================================
function obtenerUsuarioSimple() {
    const usuarioStr = localStorage.getItem("usuario");
    return usuarioStr ? JSON.parse(usuarioStr) : null;
}
