import os
import logging
from fastapi import FastAPI, HTTPException
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import json

import psycopg2
from psycopg2 import pool, extras
import bcrypt

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
    actividad: str  # 'pdf' | 'video'
    sebr: int
    blink_rate_min: float
    perclos: float
    pct_incompletos: float
    tiempo_cierre: float
    num_bostezos: int
    velocidad_ocular: float
    nivel_subjetivo: int
    es_fatiga: bool
    tiempo_total_seg: int
    max_sin_parpadeo: int
    alertas: int
    momentos_fatiga: list = []

class ActividadDescanso(BaseModel):
    id: int
    nombre: str
    duracion_seg: int
    instrucciones: str

class DashboardRequest(BaseModel):
    usuario_id: int

class DetailRequest(BaseModel):
    sesion_id: int

# --- BASE DE DATOS ---
@app.on_event("startup")
def startup():
    try:
        db_config = {
            "host": os.getenv("DB_HOST", "127.0.0.1"),
            "port": int(os.getenv("DB_PORT", "5432")),
            "database": os.getenv("DB_NAME", "pry_lectura1"),
            "user": os.getenv("DB_USER", "postgres"),
            "password": os.getenv("DB_PASS", "123"),
        }
        app.state.db_pool = pool.SimpleConnectionPool(1, 10, **db_config)
        log.info("Conexión a base de datos establecida.")
    except Exception as e:
        log.exception("Error conectando a PostgreSQL")
        raise e

@app.on_event("shutdown")
def shutdown():
    db_pool = getattr(app.state, "db_pool", None)
    if db_pool:
        db_pool.closeall()

def _get_conn_from_pool():
    db_pool = getattr(app.state, "db_pool", None)
    if not db_pool:
        raise HTTPException(status_code=500, detail="Conexión BD no disponible")
    return db_pool.getconn()

def _put_conn_back(conn):
    db_pool = getattr(app.state, "db_pool", None)
    if db_pool:
        db_pool.putconn(conn)

# --- ENDPOINTS AUTH ---
@app.post("/register")
def register_user(data: Register):
    conn = None
    cur = None
    try:
        conn = _get_conn_from_pool()
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)

        # Verificar correo único
        cur.execute("SELECT 1 FROM usuarios WHERE correo = %s", (data.correo,))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="El correo ya está registrado")

        # Hash de contraseña
        hashed_pw = bcrypt.hashpw(data.contrasena.encode("utf-8"), bcrypt.gensalt())

        cur.execute(
            """
            INSERT INTO usuarios (nombre, apellido, correo, contrasena, rol_id)
            VALUES (%s, %s, %s, %s, 2) RETURNING id
            """,
            (data.nombre, data.apellido, data.correo, hashed_pw.decode("utf-8")),
        )
        conn.commit()
        return {"mensaje": "Usuario registrado correctamente"}
    except Exception:
        log.exception("Error en /register") # Loguear el traceback completo
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Error servidor")
    finally:
        if conn:
            _put_conn_back(conn)

@app.post("/login")
def login_user(data: Login):
    conn = None
    try:
        conn = _get_conn_from_pool()
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)

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

        if not user or not bcrypt.checkpw(
            data.contrasena.encode("utf-8"), user["contrasena"].encode("utf-8")
        ):
            raise HTTPException(status_code=401, detail="Credenciales incorrectas")

        cur.execute("UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = %s", (user["id"],))
        conn.commit()

        # Normalizar el nombre del rol para que coincida con el frontend
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
        if conn:
            conn.rollback()
        raise
    except Exception:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Error interno")
    finally:
        if conn:
            _put_conn_back(conn)

# --- ENDPOINTS DATOS ---
@app.post("/create-session")
async def create_session(data: dict):
    """
    Crea una nueva sesión de monitoreo continuo.
    Input: {usuario_id, tipo_actividad, fuente (opcional)}
    Output: {sesion_id}
    """
    conn = None
    try:
        usuario_id = data.get('usuario_id')
        tipo_actividad = data.get('tipo_actividad')  # 'pdf' | 'video'
        fuente = data.get('fuente', '')

        if not usuario_id or not tipo_actividad:
            raise HTTPException(status_code=400, detail="Faltan parámetros: usuario_id y tipo_actividad")

        conn = _get_conn_from_pool()
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)

        # Insertar nueva sesión
        cur.execute(
            """
            INSERT INTO sesiones (usuario_id, tipo_actividad, fuente, fecha_inicio)
            VALUES (%s, %s, %s, NOW())
            RETURNING id
            """,
            (usuario_id, tipo_actividad, fuente)
        )
        sesion = cur.fetchone()
        conn.commit()

        return {"sesion_id": sesion['id']}

    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        log.exception("Error creando sesión")
        raise HTTPException(status_code=500, detail=f"Error creando sesión: {str(e)}")
    finally:
        if conn:
            _put_conn_back(conn)

@app.post("/save-fatigue")
async def save_fatigue(data: FatigueResult):
    conn = None
    mensaje_ui = None
    diagnostico_ia = None
    
    try:
        conn = _get_conn_from_pool()
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)

        # Usar la sesión proporcionada; si no viene, buscar la más reciente abierta
        if data.sesion_id:
            sesion_id = data.sesion_id
        else:
            cur.execute("SELECT id FROM sesiones WHERE usuario_id = %s AND fecha_fin IS NULL ORDER BY id DESC LIMIT 1", (data.usuario_id,))
            row = cur.fetchone()
            if row:
                sesion_id = row["id"]
            else:
                cur.execute("INSERT INTO sesiones (usuario_id, fecha_inicio) VALUES (%s, NOW()) RETURNING id", (data.usuario_id,))
                sesion_id = cur.fetchone()["id"]

        # Guardar medición continua (sin etapa inicial/final)
        estado_txt = "FATIGA" if data.es_fatiga else "NORMAL"
        nivel_val = 1 if data.es_fatiga else 0
        momentos_json = json.dumps(data.momentos_fatiga) if data.momentos_fatiga else None

        query = """
            INSERT INTO mediciones (
                sesion_id, actividad, parpadeos, blink_rate_min, perclos, pct_incompletos,
                tiempo_cierre, num_bostezos, velocidad_ocular,
                nivel_subjetivo, nivel_fatiga, estado_fatiga, max_sin_parpadeo, alertas, momentos_fatiga
            ) VALUES (
                %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
        """
        cur.execute(query, (
            sesion_id,
            data.actividad, data.sebr, data.blink_rate_min, data.perclos, 
            data.pct_incompletos, data.tiempo_cierre, data.num_bostezos, data.velocidad_ocular,
            data.nivel_subjetivo, nivel_val, estado_txt, data.max_sin_parpadeo, data.alertas, momentos_json,
        ))

        # Actualizar sesión con resumen final
        cur.execute(
            """UPDATE sesiones SET fecha_fin = NOW(), total_segundos = %s, alertas = %s, 
               kss_final = %s, es_fatiga = %s WHERE id = %s""",
            (data.tiempo_total_seg, data.alertas, data.nivel_subjetivo, data.es_fatiga, sesion_id)
        )

        # Obtener sesión_id para diagnóstico
        cur.execute(
            "SELECT id FROM sesiones WHERE id = %s",
            (sesion_id,)
        )
        sesion_row = cur.fetchone()
        sesion_id = sesion_row["id"] if sesion_row else None
            


        # --- Llamada a N8N para diagnóstico ---
        try:
            n8n_webhook_url = os.getenv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/fatigue")
            if n8n_webhook_url:
                payload_to_n8n = {
                    "usuario_id": data.usuario_id,
                    "sesion_id": sesion_id,
                    "actividad": data.actividad,
                    "perclos": float(data.perclos),
                    "sebr": data.sebr,
                    "blink_rate_min": float(data.blink_rate_min),
                    "pct_incompletos": float(data.pct_incompletos),
                    "num_bostezos": data.num_bostezos,
                    "tiempo_cierre": float(data.tiempo_cierre),
                    "velocidad_ocular": float(data.velocidad_ocular),
                    "nivel_subjetivo": data.nivel_subjetivo,
                    "es_fatiga": data.es_fatiga,
                    "tiempo_total_seg": data.tiempo_total_seg,
                    "max_sin_parpadeo": data.max_sin_parpadeo,
                    "alertas": data.alertas,
                    "momentos_fatiga": data.momentos_fatiga
                }
                
                log.info(f"Enviando payload a N8N: {json.dumps(payload_to_n8n, indent=2)}")
                
                async with httpx.AsyncClient() as client:
                    response = await client.post(n8n_webhook_url, json=payload_to_n8n, timeout=60)
                    response.raise_for_status()
                    responseData = response.json()
                    diagnostico_ia = responseData[0]['json'] if isinstance(responseData, list) and responseData and 'json' in responseData[0] else responseData

                if diagnostico_ia and sesion_id:
                    cur.execute(
                        "INSERT INTO diagnosticos_ia (sesion_id, diagnostico_json) VALUES (%s, %s) ON CONFLICT (sesion_id) DO UPDATE SET diagnostico_json = EXCLUDED.diagnostico_json",
                        (sesion_id, json.dumps(diagnostico_ia))
                    )
        except Exception as e:
            log.error(f"Error al contactar N8N: {e}")

        conn.commit()
        
        return {
            "mensaje": "Sesión guardada exitosamente",
            "sesion_id": sesion_id,
            "diagnostico_detallado_ia": diagnostico_ia
        }

    except Exception as e:
        if conn: conn.rollback()
        log.exception("Error en save_fatigue")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: _put_conn_back(conn)

# --- ENDPOINT: HISTORIAL DIRECTO DE BD ---
@app.post("/get-user-history")
def get_user_history(data: DashboardRequest):
    conn = None
    try:
        conn = _get_conn_from_pool()
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)

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

        # Calcular promedios de sesiones continuas
        sesiones_unicas = {h["sesion_id"]: h for h in historial}.values()

        def _to_float(val):
            try:
                return float(val) if val is not None else 0.0
            except Exception:
                return 0.0

        def _to_int(val):
            try:
                return int(val) if val is not None else 0
            except Exception:
                return 0

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
    finally:
        if conn:
            _put_conn_back(conn)

# --- NUEVOS ENDPOINTS PARA SESIONES CONTINUAS ---
@app.get("/actividades-descanso")
def get_actividades_descanso():
    """Retorna las 3 actividades de descanso predefinidas"""
    actividades = [
        {"id": 1, "nombre": "20-20-20", "duracion_seg": 20, "instrucciones": "Mira algo a 6m por 20 segundos"},
        {"id": 2, "nombre": "Ejercicio ocular", "duracion_seg": 30, "instrucciones": "Realiza círculos con los ojos 10 veces"},
        {"id": 3, "nombre": "Descanso", "duracion_seg": 60, "instrucciones": "Cierra los ojos y respira profundo"}
    ]
    return {"actividades": actividades}

class RegistroDescanso(BaseModel):
    sesion_id: int
    actividad_id: int
    actividad_nombre: str
    duracion_seg: int

@app.post("/registrar-descanso")
def registrar_actividad_descanso(data: RegistroDescanso):
    """Registra que el usuario realizó una actividad de descanso durante la sesión"""
    conn = None
    try:
        conn = _get_conn_from_pool()
        cur = conn.cursor()
        
        # Guardar la actividad dentro de sesiones.resumen como array JSON
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
        conn.commit()
        
        log.info(f"Actividad de descanso registrada: {data.actividad_nombre} en sesión {data.sesion_id}")
        return {"mensaje": "Actividad de descanso registrada", "exito": True}
        
    except Exception as e:
        if conn: conn.rollback()
        log.exception("Error registrando actividad de descanso")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: _put_conn_back(conn)

@app.post("/end-session/{sesion_id}")
def end_session(sesion_id: int):
    """Finalizar una sesión manualmente"""
    conn = None
    try:
        conn = _get_conn_from_pool()
        cur = conn.cursor()
        cur.execute(
            "UPDATE sesiones SET fecha_fin = NOW() WHERE id = %s AND fecha_fin IS NULL",
            (sesion_id,)
        )
        conn.commit()
        return {"mensaje": "Sesión finalizada"}
    except Exception as e:
        if conn: conn.rollback()
        log.exception("Error end_session")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: _put_conn_back(conn)

@app.get("/sesiones/{sesion_id}")
def get_sesion_details(sesion_id: int):
    """Obtener detalles de una sesión continua"""
    conn = None
    try:
        conn = _get_conn_from_pool()
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)
        
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
        log.exception("Error get_sesion_details")
        return {"error": str(e)}
    finally:
        if conn: _put_conn_back(conn)


# --- ENDPOINT: OBTENER O CREAR DIAGNÓSTICO IA ---
@app.post("/get-or-create-diagnosis")
async def get_or_create_diagnosis(data: DetailRequest):
    conn = None
    try:
        conn = _get_conn_from_pool()
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)

        # 1. Verificar si ya existe un diagnóstico
        cur.execute("SELECT diagnostico_json FROM diagnosticos_ia WHERE sesion_id = %s", (data.sesion_id,))
        existing_diagnosis = cur.fetchone()
        if existing_diagnosis and existing_diagnosis['diagnostico_json']:
            log.info(f"Devolviendo diagnóstico existente para sesion_id: {data.sesion_id}")
            return existing_diagnosis['diagnostico_json']

        # 2. Flujo continuo: tomar la medición más reciente de la sesión (sin etapas)
        log.info(f"Generando diagnóstico para sesión continua: {data.sesion_id}")
        query = """
            SELECT 
                s.usuario_id,
                m.perclos,
                m.parpadeos AS sebr,
                m.pct_incompletos,
                m.tiempo_cierre,
                m.num_bostezos,
                m.velocidad_ocular,
                m.nivel_subjetivo,
                m.alertas
            FROM mediciones m
            JOIN sesiones s ON m.sesion_id = s.id
            WHERE m.sesion_id = %s
            ORDER BY m.fecha DESC
            LIMIT 1
        """
        cur.execute(query, (data.sesion_id,))
        measurement = cur.fetchone()

        if not measurement:
            raise HTTPException(status_code=404, detail="Sin mediciones para esta sesión continua.")

        # 3. Generar diagnóstico simple local basado en umbrales
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
        if score >= 7:
            severidad = 'ALTA'
        elif score >= 4:
            severidad = 'MODERADA'

        diagnostico_generado = {
            "diagnostico_general": "Fatiga detectada" if score >= 3 else "Estado normal",
            "severidad_fatiga_final": severidad,
            "recomendaciones_generales": [
                "Aplica la regla 20-20-20",
                "Parpadea conscientemente cada 20s",
                "Toma un descanso de 2-3 minutos"
            ]
        }

        # 4. Guardar diagnóstico generado
        cur.execute(
            "INSERT INTO diagnosticos_ia (sesion_id, diagnostico_json) VALUES (%s, %s) ON CONFLICT (sesion_id) DO UPDATE SET diagnostico_json = EXCLUDED.diagnostico_json",
            (data.sesion_id, json.dumps(diagnostico_generado))
        )
        conn.commit()
        log.info(f"Diagnóstico para sesion_id: {data.sesion_id} guardado en la BD.")

        return diagnostico_generado

    except HTTPException:
        if conn: conn.rollback()
        raise
    except Exception as e:
        if conn: conn.rollback()
        log.exception("Error crítico en get_or_create_diagnosis")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            _put_conn_back(conn)


# --- ENDPOINT: DETALLE PARA GRÁFICOS ---
@app.post("/get-session-details")
def get_session_details(data: DetailRequest):
    conn = None
    try:
        conn = _get_conn_from_pool()
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)

        cur.execute(
            """
            SELECT
                etapa,
                perclos,
                parpadeos,
                velocidad_ocular,
                num_bostezos,
                nivel_subjetivo,
                estado_fatiga
            FROM mediciones
            WHERE sesion_id = %s
            """,
            (data.sesion_id,),
        )
        filas = cur.fetchall()

        datos = {}
        for fila in filas:
            datos[fila["etapa"]] = fila

        return datos
    except Exception as e:
        log.exception("Error detalle")
        return {"error": str(e)}
    finally:
        if conn:
            _put_conn_back(conn)

from fastapi import FastAPI
from psycopg2 import extras

@app.get("/admin/all-sessions")
def admin_all_sessions():
    conn = None
    try:
        conn = _get_conn_from_pool()
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)

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

        sesiones = cur.fetchall()

        return {"ok": True, "sesiones": sesiones}

    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        if conn:
            _put_conn_back(conn)

