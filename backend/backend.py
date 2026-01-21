import os
import logging
from fastapi import FastAPI, HTTPException, Depends
from starlette.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import httpx
import json
import urllib.parse
import hashlib
import psycopg2
from psycopg2 import pool, extras

# Configuración de logs
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("uvicorn.error")

app = FastAPI()

# --- CONFIGURACIÓN CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SERVIR ARCHIVOS ESTÁTICOS ---
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", include_in_schema=False)
def serve_root_index():
    return FileResponse("templates/index.html")

@app.get("/{page}.html", include_in_schema=False)
def serve_root_pages(page: str):
    file_path = f"templates/{page}.html"
    if os.path.exists(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="Page not found")

@app.get("/usuario/{page:path}", include_in_schema=False)
def serve_usuario_pages(page: str):
    file_path = f"templates/usuario/{page}"
    if not os.path.exists(file_path) or os.path.isdir(file_path):
        index_path = os.path.join(file_path, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
    elif os.path.exists(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="Page not found")

@app.get("/admin/{page:path}", include_in_schema=False)
def serve_admin_pages(page: str):
    file_path = f"templates/admin/{page}"
    if not os.path.exists(file_path) or os.path.isdir(file_path):
        index_path = os.path.join(file_path, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
    elif os.path.exists(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="Page not found")


# --- MODELOS DE DATOS ---
class Login(BaseModel):
    correo: str
    contrasena: str

class Register(BaseModel):
    nombre: str
    apellido: str
    correo: str
    contrasena: str

class FatigueResult(BaseModel):
    sesion_id: int | None = None
    usuario_id: int
    actividad: str
    sebr: int
    blink_rate_min: float
    perclos: float
    ear_promedio: float | None = None
    pct_incompletos: float
    tiempo_cierre: float
    num_bostezos: int
    velocidad_ocular: float
    es_fatiga: bool
    tiempo_total_seg: int
    max_sin_parpadeo: int
    alertas: int
    momentos_fatiga: list = []
    kss_final: int | None = None

class ActividadDescanso(BaseModel):
    id: int
    nombre: str
    duracion_seg: int
    instrucciones: str

class DashboardRequest(BaseModel):
    usuario_id: int

class DetailRequest(BaseModel):
    sesion_id: int
    
class RegistroDescanso(BaseModel):
    sesion_id: int
    actividad_id: int
    actividad_nombre: str
    duracion_seg: int

# --- BASE DE DATOS Y DEPENDENCIAS ---
@app.on_event("startup")
def startup():
    try:
        # Priorizar DATABASE_URL si está presente (formato Render)
        database_url = os.getenv("DATABASE_URL")
        if database_url:
            parsed_url = urllib.parse.urlparse(database_url)
            db_config = {
                "host": parsed_url.hostname,
                "port": parsed_url.port or 5432,
                "database": parsed_url.path.strip("/"),
                "user": parsed_url.username,
                "password": parsed_url.password,
            }
        else:
            raise ValueError("DATABASE_URL environment variable is not set. Database connection cannot be established.")
        
        # SimpleConnectionPool es thread-safe
        app.state.db_pool = pool.SimpleConnectionPool(1, 20, **db_config)
        log.info("Conexión a base de datos establecida.")
    except Exception as e:
        log.exception("Error conectando a PostgreSQL")
        raise e

@app.on_event("shutdown")
def shutdown():
    db_pool = getattr(app.state, "db_pool", None)
    if db_pool:
        db_pool.closeall()

# INYECCIÓN DE DEPENDENCIA (NUEVO)
# Maneja automáticamente el ciclo de vida de la conexión para cada request
def get_db():
    db_pool = getattr(app.state, "db_pool", None)
    if not db_pool:
        raise HTTPException(status_code=500, detail="Conexión BD no disponible")
    
    conn = db_pool.getconn()
    try:
        # Configurar zona horaria por conexión
        with conn.cursor() as cur:
            cur.execute("SET TIME ZONE 'America/Guayaquil'")
        yield conn
    except Exception:
        # Si ocurre un error no manejado, hacemos rollback por seguridad
        conn.rollback()
        raise
    finally:
        # Devolver conexión al pool siempre
        db_pool.putconn(conn)


# --- ENDPOINTS AUTH ---
# Nota: Quitamos 'async' para que corran en ThreadPool (mejor para psycopg2)

@app.post("/register")
def register_user(data: Register, db = Depends(get_db)):
    try:
        cur = db.cursor(cursor_factory=extras.RealDictCursor)

        # Verificar correo único
        cur.execute("SELECT 1 FROM usuarios WHERE correo = %s", (data.correo,))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="El correo ya está registrado")

        # Hash de contraseña
        hashed_pw = hashlib.sha256(data.contrasena.encode("utf-8")).hexdigest()

        cur.execute(
            """
            INSERT INTO usuarios (nombre, apellido, correo, contrasena, rol_id)
            VALUES (%s, %s, %s, %s, 2) RETURNING id
            """,
            (data.nombre, data.apellido, data.correo, hashed_pw),
        )
        db.commit()
        return {"mensaje": "Usuario registrado correctamente"}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        log.exception("Error en /register")
        db.rollback()
        raise HTTPException(status_code=500, detail="Error servidor")

@app.post("/login")
def login_user(data: Login, db = Depends(get_db)):
    try:
        cur = db.cursor(cursor_factory=extras.RealDictCursor)

        cur.execute(
            """
            SELECT u.id, u.nombre, u.apellido, u.correo, u.contrasena,
                   r.nombre AS rol_nombre, u.rol_id
            FROM usuarios u
            LEFT JOIN roles r ON r.id = u.rol_id
            WHERE correo = %s
            """,
            (data.correo,),
        )
        user = cur.fetchone()

        # Verificar contraseña
        input_pw_hash = hashlib.sha256(data.contrasena.encode("utf-8")).hexdigest()

        if not user or user["contrasena"] != input_pw_hash:
            raise HTTPException(status_code=401, detail="Credenciales incorrectas")

        cur.execute("UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = %s", (user["id"],))
        db.commit()

        rol_normalizado = "admin" if user["rol_nombre"] == "Administrador" else "usuario"

        return {
            "mensaje": "Login exitoso",
            "usuario": {
                "id": user["id"],
                "nombre": user["nombre"],
                "apellido": user["apellido"],
                "rol": rol_normalizado,
            },
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error interno")

# --- ENDPOINTS DATOS ---

@app.post("/create-session")
def create_session(data: dict, db = Depends(get_db)):
    """
    Crea una nueva sesión de monitoreo continuo.
    """
    try:
        usuario_id = data.get('usuario_id')
        tipo_actividad = data.get('tipo_actividad')
        fuente = data.get('fuente', '')

        if not usuario_id or not tipo_actividad:
            raise HTTPException(status_code=400, detail="Faltan parámetros: usuario_id y tipo_actividad")

        cur = db.cursor(cursor_factory=extras.RealDictCursor)

        cur.execute(
            """
            INSERT INTO sesiones (usuario_id, tipo_actividad, fuente, fecha_inicio)
            VALUES (%s, %s, %s, NOW())
            RETURNING id
            """,
            (usuario_id, tipo_actividad, fuente)
        )
        sesion = cur.fetchone()
        db.commit()

        return {"sesion_id": sesion['id']}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        log.exception("Error creando sesión")
        raise HTTPException(status_code=500, detail=f"Error creando sesión: {str(e)}")

@app.post("/save-fatigue")
def save_fatigue(data: FatigueResult, db = Depends(get_db)):
    """
    Guarda el resultado final y consulta N8N.
    Se ha cambiado a 'def' (síncrono) para evitar bloqueos del event loop por psycopg2.
    La llamada a N8N se hace con httpx.Client (síncrono) dentro de este hilo.
    """
    diagnostico_ia = None
    payload_to_n8n = {}
    
    try:
        cur = db.cursor(cursor_factory=extras.RealDictCursor)

        sesion_id = data.sesion_id
        if not sesion_id:
            # Fallback
            cur.execute("SELECT id FROM sesiones WHERE usuario_id = %s AND fecha_fin IS NULL ORDER BY id DESC LIMIT 1", (data.usuario_id,))
            row = cur.fetchone()
            if row:
                sesion_id = row["id"]
            else:
                raise HTTPException(status_code=404, detail="No se encontró una sesión activa para finalizar.")

        # 1. Guardar medición ÚNICA
        estado_txt = "FATIGA" if data.es_fatiga else "NORMAL"
        nivel_val = 1 if data.es_fatiga else 0
        momentos_json = json.dumps(data.momentos_fatiga) if data.momentos_fatiga else None

        query = """
            INSERT INTO mediciones (
                sesion_id, actividad, parpadeos, blink_rate_min, perclos, ear_promedio, pct_incompletos,
                tiempo_cierre, num_bostezos, velocidad_ocular,
                nivel_fatiga, estado_fatiga, max_sin_parpadeo, alertas, momentos_fatiga, nivel_subjetivo, fecha
            ) VALUES ( %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW() )
        """
        cur.execute(query, (
            sesion_id, data.actividad, data.sebr, data.blink_rate_min, data.perclos, data.ear_promedio,
            data.pct_incompletos, data.tiempo_cierre, data.num_bostezos, data.velocidad_ocular,
            nivel_val, estado_txt, data.max_sin_parpadeo, data.alertas, momentos_json, data.kss_final
        ))


        # 2. Llamada a N8N (Síncrona ahora, para correr en el ThreadPool)
        payload_to_n8n = {}
        try:
            n8n_webhook_url = os.getenv("N8N_WEBHOOK_URL", "https://drteneguznay.app.n8n.cloud/webhook/visual-fatigue-diagnosis")
            log.info("--- INICIO LLAMADA A N8N (SYNC) ---")

            if n8n_webhook_url:
                # Asegurarse de que todos los valores sean del tipo correcto (int, float, etc.)
                resumen_sesion_payload = {
                    "tiempo_total_seg": int(data.tiempo_total_seg or 0),
                    "perclos": float(data.perclos or 0.0),
                    "sebr": int(data.sebr or 0),
                    "blink_rate_min": float(data.blink_rate_min or 0.0),
                    "pct_incompletos": float(data.pct_incompletos or 0.0),
                    "num_bostezos": int(data.num_bostezos or 0),
                    "velocidad_ocular": float(data.velocidad_ocular or 0.0),
                    "alertas_totales": int(data.alertas or 0),
                }
                # El KSS solo se envía si tiene un valor válido (mayor que 0)
                if data.kss_final is not None and data.kss_final > 0:
                    resumen_sesion_payload["kss_final"] = int(data.kss_final)
                
                payload_to_n8n = {"resumen_sesion": resumen_sesion_payload}
                log.info(f"Payload enviado a N8N: {json.dumps(payload_to_n8n)}")

                # Usamos Client síncrono
                with httpx.Client() as client:
                    response = client.post(n8n_webhook_url, json=payload_to_n8n, timeout=60)
                    log.info(f"N8N Status Code: {response.status_code}")
                    log.info(f"N8N Response Content: {response.text}")
                    response.raise_for_status()
                    responseData = response.json()
                    log.info(f"N8N Parsed JSON: {responseData}")

                    diagnostico_ia = None
                    if isinstance(responseData, list) and responseData:
                        if isinstance(responseData[0], dict) and 'json' in responseData[0]:
                            diagnostico_ia = responseData[0]['json']
                        elif isinstance(responseData[0], dict):
                            diagnostico_ia = responseData[0]

                    if diagnostico_ia is None:
                        diagnostico_ia = responseData

                if diagnostico_ia and sesion_id:
                    try:
                        diagnostico_json = json.dumps(diagnostico_ia)
                        cur.execute(
                            "INSERT INTO diagnosticos_ia (sesion_id, diagnostico_json) VALUES (%s, %s) ON CONFLICT (sesion_id) DO UPDATE SET diagnostico_json = EXCLUDED.diagnostico_json",
                            (sesion_id, diagnostico_json)
                        )
                        log.info("Diagnóstico IA guardado.")
                    except (TypeError, ValueError) as e:
                        log.error(f"Error serializando diagnostico_ia: {e}")
                        log.error(f"Tipo de diagnostico_ia: {type(diagnostico_ia)}, Contenido: {diagnostico_ia}")

        except httpx.HTTPStatusError as e:
            log.error(f"!!! ERROR HTTP LLAMADA N8N: {e}")
            log.error(f"--- N8N ERROR RESPONSE BODY: {e.response.text} ---")
        except Exception as e:
            log.exception(f"!!! ERROR INESPERADO LLAMADA N8N: {e}")
            # No fallamos la request principal si N8N falla, solo logueamos
        # 3. Cerrar Sesión en BD
        # El usuario ha clarificado que 'resumen' debe guardar los datos de la sesión, no el diagnóstico.
        summary_json = json.dumps(payload_to_n8n.get("resumen_sesion")) if payload_to_n8n.get("resumen_sesion") else None
        cur.execute(
            """
            UPDATE sesiones 
            SET total_segundos = %s, 
                alertas = %s, 
                kss_final = %s,
                es_fatiga = %s,
                resumen = %s,
                fecha_fin = NOW()
            WHERE id = %s
            """,
            (data.tiempo_total_seg, data.alertas, data.kss_final, data.es_fatiga, summary_json, sesion_id)
        )

        db.commit()
        
        return {
            "mensaje": "Sesión finalizada y guardada correctamente",
            "sesion_id": sesion_id,
            "diagnostico": diagnostico_ia
        }

    except Exception as e:
        db.rollback()
        log.exception("Error en save_fatigue")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/get-user-history")
def get_user_history(data: DashboardRequest, db = Depends(get_db)):
    try:
        cur = db.cursor(cursor_factory=extras.RealDictCursor)

        query = """
            SELECT
                s.id as sesion_id,
                TO_CHAR(s.fecha_inicio, 'DD/MM/YYYY HH24:MI') as fecha,
                s.tipo_actividad,
                s.total_segundos,
                s.alertas,
                s.es_fatiga,
                m.perclos,
                m.velocidad_ocular,
                m.num_bostezos,
                m.blink_rate_min,
                dia.diagnostico_json
            FROM sesiones s
            LEFT JOIN mediciones m ON m.sesion_id = s.id
            LEFT JOIN diagnosticos_ia dia ON dia.sesion_id = s.id
            WHERE s.usuario_id = %s AND s.fecha_fin IS NOT NULL
            ORDER BY s.fecha_inicio DESC
        """
        cur.execute(query, (data.usuario_id,))
        historial = cur.fetchall()

        if not historial:
            return {"empty": True}

        # Deduplicar sesiones (aunque la query ya debería traer 1 por 1 si la estructura es correcta, 
        # mantenemos lógica original por seguridad)
        sesiones_unicas = {h["sesion_id"]: h for h in historial}.values()

        def _to_float(val):
            try: return float(val) if val is not None else 0.0
            except: return 0.0

        def _to_int(val):
            try: return int(val) if val is not None else 0
            except: return 0

        avg_perclos = (
            sum(_to_float(s.get("perclos")) for s in sesiones_unicas) / len(sesiones_unicas)
        ) if sesiones_unicas else 0
        total_alertas = sum(_to_int(s.get("alertas")) for s in sesiones_unicas)
        total_tiempo = sum(_to_int(s.get("total_segundos")) for s in sesiones_unicas)
        
        promedios = {
            "perclos_avg": round(avg_perclos, 1),
            "alertas_total": total_alertas,
            "tiempo_total_min": round(total_tiempo / 60, 1) if total_tiempo else 0,
        }

        return {"empty": False, "historial": list(sesiones_unicas), "promedios": promedios}
    except Exception as e:
        log.exception("Error historial")
        return {"error": str(e)}

@app.get("/actividades-descanso")
def get_actividades_descanso():
    actividades = [
        {"id": 1, "nombre": "20-20-20", "duracion_seg": 20, "instrucciones": "Mira algo a 6m por 20 segundos"},
        {"id": 2, "nombre": "Ejercicio ocular", "duracion_seg": 30, "instrucciones": "Realiza círculos con los ojos 10 veces"},
        {"id": 3, "nombre": "Descanso", "duracion_seg": 60, "instrucciones": "Cierra los ojos y respira profundo"}
    ]
    return {"actividades": actividades}

@app.post("/registrar-descanso")
def registrar_actividad_descanso(data: RegistroDescanso, db = Depends(get_db)):
    try:
        cur = db.cursor()
        cur.execute(
            """
            UPDATE sesiones
            SET resumen = COALESCE(resumen, '[]'::jsonb) || jsonb_build_array(
                jsonb_build_object(
                    'tipo', 'descanso',
                    'actividad_id', %s,
                    'actividad', %s,
                    'duracion_seg', %s,
                    'timestamp', NOW()
                )
            )
            WHERE id = %s
            """,
            (data.actividad_id, data.actividad_nombre, data.duracion_seg, data.sesion_id)
        )
        db.commit()
        log.info(f"Descanso registrado: {data.actividad_nombre} sesión {data.sesion_id}")
        return {"mensaje": "Actividad de descanso registrada", "exito": True}
    except Exception as e:
        db.rollback()
        log.exception("Error registrando descanso")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/end-session/{sesion_id}")
def end_session(sesion_id: int, db = Depends(get_db)):
    try:
        cur = db.cursor()
        cur.execute(
            "UPDATE sesiones SET fecha_fin = NOW() WHERE id = %s AND fecha_fin IS NULL",
            (sesion_id,)
        )
        db.commit()
        return {"mensaje": "Sesión finalizada"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/sesiones/{sesion_id}")
def get_sesion_details(sesion_id: int, db = Depends(get_db)):
    try:
        cur = db.cursor(cursor_factory=extras.RealDictCursor)
        cur.execute(
            """
            SELECT 
                s.id, s.usuario_id, s.tipo_actividad, s.total_segundos, s.alertas, 
                s.kss_final, s.es_fatiga, s.fecha_inicio, s.fecha_fin,
                m.perclos, m.velocidad_ocular, m.num_bostezos, m.blink_rate_min,
                m.parpadeos, m.max_sin_parpadeo, m.momentos_fatiga,
                dia.diagnostico_json
            FROM sesiones s
            LEFT JOIN LATERAL (
                SELECT perclos, velocidad_ocular, num_bostezos, blink_rate_min,
                       parpadeos, max_sin_parpadeo, momentos_fatiga
                FROM mediciones m2
                WHERE m2.sesion_id = s.id
                ORDER BY m2.fecha DESC
                LIMIT 1
            ) m ON TRUE
            LEFT JOIN diagnosticos_ia dia ON dia.sesion_id = s.id
            WHERE s.id = %s
            """,
            (sesion_id,)
        )
        resultado = cur.fetchone()
        return resultado if resultado else {"error": "Sesión no encontrada"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/get-or-create-diagnosis")
def get_or_create_diagnosis(data: DetailRequest, db = Depends(get_db)):
    try:
        cur = db.cursor(cursor_factory=extras.RealDictCursor)

        # 1. Verificar si existe
        cur.execute("SELECT diagnostico_json FROM diagnosticos_ia WHERE sesion_id = %s", (data.sesion_id,))
        existing_diagnosis = cur.fetchone()
        if existing_diagnosis and existing_diagnosis['diagnostico_json']:
            return existing_diagnosis['diagnostico_json']

        # 2. Obtener datos
        query = """
            SELECT 
                s.usuario_id, m.perclos, m.parpadeos AS sebr, m.pct_incompletos,
                m.tiempo_cierre, m.num_bostezos, m.velocidad_ocular,
                m.nivel_subjetivo, m.alertas
            FROM mediciones m
            JOIN sesiones s ON m.sesion_id = s.id
            WHERE m.sesion_id = %s
            ORDER BY m.fecha DESC
            LIMIT 1
        """
        cur.execute(query, (data.sesion_id,))
        measurement = cur.fetchone()

        if not measurement:
            raise HTTPException(status_code=404, detail="Sin mediciones.")

        # 3. Diagnóstico simple local
        perclos = float(measurement.get('perclos') or 0)
        sebr = float(measurement.get('sebr') or 0)
        pct_inc = float(measurement.get('pct_incompletos') or 0)
        tiempo_cierre = float(measurement.get('tiempo_cierre') or 0)
        num_bostezos = float(measurement.get('num_bostezos') or 0)
        vel = float(measurement.get('velocidad_ocular') or 0)
        kss = int(measurement.get('nivel_subjetivo') or 0)
        alertas = int(measurement.get('alertas') or 0)

        score = 0
        if perclos >= 28: score += 3
        if sebr <= 5: score += 3
        if pct_inc >= 20: score += 2
        if tiempo_cierre >= 0.4: score += 1
        if num_bostezos >= 1: score += 1
        if vel < 0.02: score += 1
        if kss >= 7: score += 1
        if alertas >= 2: score += 2

        severidad = 'NORMAL'
        if score >= 7: severidad = 'ALTA'
        elif score >= 4: severidad = 'MODERADA'

        diagnostico_generado = {
            "diagnostico_general": "Fatiga detectada" if score >= 3 else "Estado normal",
            "severidad_fatiga_final": severidad,
            "recomendaciones_generales": [
                "Aplica la regla 20-20-20",
                "Parpadea conscientemente",
                "Toma un descanso"
            ]
        }

        # 4. Guardar
        cur.execute(
            "INSERT INTO diagnosticos_ia (sesion_id, diagnostico_json) VALUES (%s, %s) ON CONFLICT (sesion_id) DO UPDATE SET diagnostico_json = EXCLUDED.diagnostico_json",
            (data.sesion_id, json.dumps(diagnostico_generado))
        )
        db.commit()

        return diagnostico_generado

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        log.exception("Error en get_or_create_diagnosis")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/get-session-details")
def get_session_details(data: DetailRequest, db = Depends(get_db)):
    try:
        cur = db.cursor(cursor_factory=extras.RealDictCursor)
        cur.execute("SELECT etapa, perclos, parpadeos, velocidad_ocular, num_bostezos, nivel_subjetivo, estado_fatiga FROM mediciones WHERE sesion_id = %s", (data.sesion_id,))
        filas = cur.fetchall()
        datos = {fila["etapa"]: fila for fila in filas} # Nota: 'etapa' no existe en lógica continua, pero se mantiene por compatibilidad
        return datos
    except Exception as e:
        return {"error": str(e)}

@app.get("/admin/all-sessions")
def admin_all_sessions(db = Depends(get_db)):
    try:
        cur = db.cursor(cursor_factory=extras.RealDictCursor)
        cur.execute("""
            SELECT 
                s.id AS sesion_id,
                CONCAT(u.nombre, ' ', u.apellido) AS estudiante,
                TO_CHAR(s.fecha_inicio, 'DD/MM/YYYY HH24:MI') AS fecha,
                s.tipo_actividad,
                s.total_segundos,
                s.alertas,
                s.es_fatiga,
                m.perclos,
                m.velocidad_ocular,
                m.num_bostezos
            FROM sesiones s
            JOIN usuarios u ON u.id = s.usuario_id
            LEFT JOIN mediciones m ON m.sesion_id = s.id
            WHERE s.fecha_fin IS NOT NULL
            ORDER BY s.fecha_inicio DESC
        """)
        return {"ok": True, "sesiones": cur.fetchall()}
    except Exception as e:
        return {"ok": False, "error": str(e)}