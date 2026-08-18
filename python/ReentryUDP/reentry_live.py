import socket
import json
import time
import os

# --- CONFIGURAZIONE ---
# Porta 8052 è quella solitamente usata per la telemetria in uscita
UDP_IP = "127.0.0.1"
UDP_PORT = 8052 

# Creazione del socket UDP
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

try:
    sock.bind((UDP_IP, UDP_PORT))
    print(f"✅ Monitor avviato sulla porta {UDP_PORT}")
except Exception as e:
    print(f"❌ Errore: Impossibile legarsi alla porta {UDP_PORT}. Forse è già in uso?")
    exit()

print("🛰️ In attesa di dati dalla capsula... (Assicurati di essere in missione)")

while True:
    try:
        # Riceviamo i dati (buffer di 65535 byte per sicurezza)
        data, addr = sock.recvfrom(65535)
        
        # Decodifichiamo il JSON ricevuto dal simulatore
        packet = json.loads(data.decode('utf-8'))
        
        # Pulizia console per vederlo bene (opzionale)
        # os.system('cls' if os.name == 'nt' else 'clear')
        
        print(f"\n--- TELEMETRIA RICEVUTA ({time.strftime('%H:%M:%S')}) ---")
        
        # Stampiamo i dati della 'BARACCA' (Posizione, Carburante, Assetto)
        # Se vuoi vedere TUTTO, togli l'IF e lascia solo il print
        for key, value in packet.items():
            k_low = key.lower()
            # Filtro per le cose più importanti del CSM/LEM
            if any(x in k_low for x in ["lat", "lon", "alt", "fuel", "oxy", "pres", "vel", "pitch", "roll", "yaw"]):
                print(f"{key:35} : {value}")
                
    except json.JSONDecodeError:
        print("Ricevuto pacchetto non valido (non JSON)")
    except KeyboardInterrupt:
        print("\nChiusura...")
        break
    except Exception as e:
        print(f"Errore: {e}")