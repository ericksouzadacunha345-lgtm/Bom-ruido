/*
 * Exemplo de envio de uma leitura S10/ESP32 para o Bom Ruido.
 *
 * IMPORTANTE: readDbFromS10() é um ponto de integração. Substitua a leitura
 * de exemplo pela fórmula/calibração do sensor de ruído realmente instalado.
 */
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "SUA_REDE";
const char* WIFI_PASSWORD = "SUA_SENHA_WIFI";
const char* SERVER_URL = "https://SEU-DOMINIO/api/s10/ingest";
const char* S10_KEY = "SUA_S10_DEVICE_KEY";
const char* SENSOR_ID = "S10-01";
const char* ROOM_NAME = "Bili";
const char* DEVICE_ID = "esp32-s10-01";

float readDbFromS10() {
  // TODO: substituir pela leitura/calibração do hardware real.
  // Retorne dB já calibrado (0..200).
  return 0.0f;
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(3000);
    return;
  }

  float db = readDbFromS10();
  if (!(db >= 0.0f && db <= 200.0f)) {
    delay(2000);
    return;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-s10-key", S10_KEY);

  String body = String("{\"sensor\":\"") + SENSOR_ID +
                "\",\"sala\":\"" + ROOM_NAME +
                "\",\"db\":" + String(db, 1) +
                ",\"deviceId\":\"" + DEVICE_ID + "\"}";

  int code = http.POST(body);
  Serial.printf("POST /api/s10/ingest -> HTTP %d\n", code);
  http.end();

  delay(3000);
}
