import asyncio
import httpx
import time
import random
import string
import statistics

# URL de tu servidor local o producción
BASE_URL = "https://securityeye.onrender.com"

# Variables de la Prueba según el Artículo
N_USUARIOS = 100       # N (Usuarios concurrentes)
TIMEOUT_SECONDS = 120.0

def generate_user(index):
    """
    Genera datos de usuario únicos para la prueba de esfuerzo.
    """
    suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return {
        "nombre": f"StressUser_{index}",
        "apellido": "Test",
        "correo": f"stress_{index}_{suffix}@test.com",
        "contrasena": "Password123!",
        "metadata_carga": "x" * 500  # Carga de datos (D) ligera para el registro
    }

async def register_user(client, index):
    user_data = generate_user(index)
    start_time = time.time()
    try:
        response = await client.post(f"{BASE_URL}/register", json=user_data)
        elapsed = time.time() - start_time
        return {
            "status": response.status_code,
            "elapsed": elapsed,
            "success": response.status_code in [200, 201]
        }
    except Exception as e:
        return {
            "status": 0,
            "elapsed": time.time() - start_time,
            "success": False,
            "error": str(e)
        }

async def main():
    print(f"--- PRUEBA DE ESFUERZO: REGISTRO DE USUARIOS ---")
    print(f"Objetivo: Evaluar estabilidad del sistema (N={N_USUARIOS})")
    print(f"Endpoint: {BASE_URL}/register")
    
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        # Lanzamos las 100 peticiones de golpe para forzar el límite operacional
        tasks = [register_user(client, i) for i in range(N_USUARIOS)]
        
        start_global = time.time()
        print(f"Enviando {N_USUARIOS} registros concurrentes...")
        results = await asyncio.gather(*tasks)
        total_time = time.time() - start_global

    # Análisis de Resultados
    success_count = sum(1 for r in results if r["success"])
    times = [r["elapsed"] for r in results]
    integrity = (success_count / N_USUARIOS) * 100
    
    print("\n" + "="*40)
    print(f"RESULTADOS DE CARGA (REGISTRO)")
    print("-" * 40)
    print(f"Total Intentos (N):     {N_USUARIOS}")
    print(f"Registros Exitosos:     {success_count}")
    print(f"Integridad de Datos:    {integrity:.1f}%")
    print(f"Tiempo Respuesta Prom:  {statistics.mean(times):.4f}s")
    print(f"Tiempo Procesamiento Max:{max(times):.4f}s")
    print(f"Tiempo Total Ejecución: {total_time:.2f}s")
    print("="*40)

if __name__ == "__main__":
    asyncio.run(main())
