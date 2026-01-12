import asyncio
import httpx
import time
import random
import string
import os

# URL de tu servidor local
BASE_URL = "https://securityeye.onrender.com"

def generate_user(index):
    # Generar un correo único para evitar errores de duplicidad
    suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return {
        "nombre": f"StressUser{index}",
        "apellido": "Test",
        "correo": f"stress_{index}_{suffix}@test.com",
        "contrasena": "Password123!"
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
            "error": None
        }
    except Exception as e:
        return {
            "status": 0,
            "elapsed": time.time() - start_time,
            "error": str(e)
        }
async def main():
    print(f"--- PRUEBA DE ESTRÉS MASIVA: 100 REGISTROS SIMULTÁNEOS ---")
    print(f"Objetivo: {BASE_URL}/register")
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Lanzamos las 100 peticiones de golpe
        tasks = [register_user(client, i) for i in range(100)]
        
        start_global = time.time()
        print("Enviando 100 peticiones concurrentes...")
        results = await asyncio.gather(*tasks)
        total_time = time.time() - start_global

    # Análisis de resultados
    success = [r for r in results if r["status"] == 200]
    failures = [r for r in results if r["status"] != 200]
    
    print(f"\n--- RESULTADOS ---")
    print(f"Tiempo total de ejecución: {total_time:.2f} segundos")
    print(f"Registros exitosos: {len(success)}/100")
    print(f"Fallos: {len(failures)}/100")
    
    if success:
        avg_time = sum(r['elapsed'] for r in success) / len(success)
        print(f"Tiempo promedio por registro exitoso: {avg_time:.4f} segundos")
    
    if failures:
        print("\nDetalle de fallos (Primeros 3):")
        for i, f in enumerate(failures[:3]):
             print(f"Fallo {i+1}: Status={f['status']}, Error='{f['error']}'")

if __name__ == "__main__":
    asyncio.run(main())
