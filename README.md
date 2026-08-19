# Apollo Flight Operations Workspace — Web Edition

---

## 🇬🇧 ENGLISH

Web version (Flask + HTML/JS) of the flight operations control panel, designed to be accessed via browser on Android phones (or any device on the local network) while retaining the original UDP network architecture.

### ⚠️ Prerequisites & Configuration (Before Launch)

Before running the telemetry suite, you must configure the connection with **Reentry - An Orbital Simulator**:

1. **Simulator Configuration (*Reentry*):**
   * Open *Reentry - An Orbital Simulator*.
   * Go to settings and **enable Data Export**.
   * **Enable UDP access**.

2. **IP Address Configuration (`APOLLO_DEST_IP`):**
   * Open `demos/Apollo WebFinal/app.py` in a text editor.
   * Update `APOLLO_DEST_IP` (or the `DEST_IP` variable):
     * Use `127.0.0.1` if running Flask on the **same PC** as *Reentry*.
     * Use the specific local IP address if Flask runs on a **separate PC/Server** on your network.

3. **Reentry Export File Paths (`MISSION_FILE`, `AGC_FILE`, `LGC_FILE`):**
   * *Reentry* generates JSON telemetry files (`missionTiming.json`, `outputAGC.json`, `outputLGC.json`) inside your user profile directory (typically located at `%USERPROFILE%\AppData\LocalLow\Wilhelmsen Studios\Reentry\Apollo\` or `Documents\Wilhelmsen Studios\Reentry\Apollo\`).
   * In `app.py`, update the file path variables (or set the environment variables `APOLLO_MISSION_FILE`, `APOLLO_AGC_FILE`, and `APOLLO_LGC_FILE`) to match the exact location of the export folder on your machine.

---

### 🚀 Quick Start Guide

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
