/*
 * PIEVI - firmware da bancada (ESP32 DevKit 30 pinos) - contrato MQTT v1.
 *
 * O ESP32 decide e aciona sozinho (pievi_core.h). O MQTT so reporta e recebe pedidos (pievi_v1.h).
 * Contrato: docs/contrato-mqtt-v1.md, protocol/mqtt/v1/schema.json e exemplos.
 *
 * Arduino IDE / arduino-cli:
 *   - Placa: "ESP32 Dev Module" (pacote esp32 da Espressif 3.x).
 *   - Bibliotecas: ArduinoJson (v7), DHT sensor library + Adafruit Unified Sensor, OneWire, DallasTemperature.
 *   - MQTT: cliente nativo do ESP-IDF (mqtt_client.h), ja incluso no pacote esp32. Nao usa PubSubClient (so QoS 0).
 *   - Copie secrets.example.h para secrets.h (ou rode firmware/tools/gerar-secrets.ps1). secrets.h nao vai para o Git.
 *
 * Serial 115200: status | cal seco | cal agua | cal manual <seco> <agua> | cal limpar | payloads on|off | reiniciar
 */
#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_sntp.h>
#include <esp_task_wdt.h>
#include <mqtt_client.h>
#if __has_include(<esp_crt_bundle.h>)
#include <esp_crt_bundle.h>
#define PIEVI_HAS_CRT_BUNDLE 1
#endif

#include "pievi_core.h"
#include "pievi_v1.h"
#include "secrets.h"

#define FW_VERSION "pievi-esp32-v1.0.0"

// ----------------------------------------------------------------------------- pinos (CONFERIR com a montagem)
// Confirmado na bancada (20/11/2026): a bomba de IRRIGACAO esta no GPIO27 (na montagem ela e chamada de "bomba 2");
// a de ASPERSAO/nevoa no GPIO26. No contrato v1 e no app: B1 = irrigacao, B2 = nevoa.
// O teste_bancada_v2 usava outra numeracao (IN1/IN2); vale o mapa abaixo.
static const int PIN_B1 = 27;     // K2 -> bomba de IRRIGACAO / gotejamento (B1 no app; "bomba 2" na montagem)
static const int PIN_B2 = 26;     // K1 -> bomba de NEVOA / aspersao (B2 no app)
static const int PIN_SOLO = 34;   // HD-38 (AO), ADC1, somente entrada
static const int PIN_DHT = 16;    // DHT22 DATA (RX2) + 10k para 3V3
static const int PIN_DS18 = 4;    // DS18B20 DATA + 4,7k para 3V3
static const int PIN_BOIA = 19;   // INPUT_PULLUP: 1 = nivel baixo/circuito aberto (LOW no contrato), 0 = com agua
static const bool RELE_ATIVO_BAIXO = true;

static const uint32_t SAMPLE_MS = 2500;   // DHT22: no maximo 0,5 Hz

using namespace pievi;
static Preferences prefs;
static DHT dht(PIN_DHT, DHT22);
static OneWire oneWire(PIN_DS18);
static DallasTemperature ds18(&oneWire);
static Controller* ctrl = nullptr;
static v1::Link* link1 = nullptr;

// ----------------------------------------------------------------------------- MQTT (esp-mqtt)
static esp_mqtt_client_handle_t mqttClient = nullptr;
static volatile bool evConnected = false, evDisconnected = false, mqttUp = false;
static QueueHandle_t rxQueue;           // String* com "topico\npayload", copiado no task do MQTT
static String rxTopic, rxBody;          // remontagem de fragmentos (so no task do MQTT)
static String willTopic, willBody;      // precisam existir enquanto o cliente existir
static uint32_t mqttRetryAt = 0, mqttBackoff = 2000;
static volatile bool clockSynced = false;

static bool mqttPublish(const String& topic, const String& body, bool retain) {
  if (!mqttClient || !mqttUp) return false;
  return esp_mqtt_client_enqueue(mqttClient, topic.c_str(), body.c_str(), body.length(), 1, retain ? 1 : 0, true) >= 0;
}

static void onMqttEvent(void*, esp_event_base_t, int32_t id, void* data) {
  auto* e = static_cast<esp_mqtt_event_handle_t>(data);
  switch ((esp_mqtt_event_id_t)id) {
    case MQTT_EVENT_CONNECTED: evConnected = true; break;
    case MQTT_EVENT_DISCONNECTED: evDisconnected = true; break;
    case MQTT_EVENT_DATA: {
      if (e->current_data_offset == 0) { rxTopic = String(e->topic, e->topic_len); rxBody = ""; rxBody.reserve(e->total_data_len); }
      if (e->total_data_len > 16384) return;   // acima do perfil de bancada: descarta
      rxBody.concat(e->data, e->data_len);
      if (e->current_data_offset + e->data_len >= e->total_data_len) {
        auto* msg = new String(rxTopic + "\n" + rxBody);
        if (xQueueSend(rxQueue, &msg, 0) != pdTRUE) delete msg;
      }
      break;
    }
    case MQTT_EVENT_ERROR:
      if (e->error_handle && e->error_handle->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED)
        Serial.printf("[MQTT] conexao recusada pelo broker (codigo %d): confira usuario/senha/client ID\n", e->error_handle->connect_return_code);
      break;
    default: break;
  }
}

static void mqttStop() {
  if (!mqttClient) return;
  mqttUp = false; link1->onDisconnected();
  esp_mqtt_client_stop(mqttClient); esp_mqtt_client_destroy(mqttClient); mqttClient = nullptr;
}

static void mqttStart() {
  link1->newConnection();   // cada conexao tem connectionId novo; o Last Will offline e montado com ele
  willTopic = link1->topic("presence"); willBody = link1->presence(false);
  esp_mqtt_client_config_t cfg = {};
  cfg.broker.address.uri = MQTT_URI;
#if defined(MQTT_CA_CERT)
  cfg.broker.verification.certificate = MQTT_CA_CERT;
#elif defined(PIEVI_HAS_CRT_BUNDLE)
  if (!strncmp(MQTT_URI, "mqtts://", 8)) cfg.broker.verification.crt_bundle_attach = esp_crt_bundle_attach;
#endif
  cfg.credentials.username = MQTT_USERNAME;
  cfg.credentials.authentication.password = MQTT_PASSWORD;
  cfg.credentials.client_id = MQTT_CLIENT_ID;
  cfg.session.protocol_ver = MQTT_PROTOCOL_V_3_1_1;
  cfg.session.keepalive = 30;
  cfg.session.disable_clean_session = false;   // cleanSession=true: sem fila de comandos durante desconexao
  cfg.session.last_will.topic = willTopic.c_str();
  cfg.session.last_will.msg = willBody.c_str();
  cfg.session.last_will.msg_len = (int)willBody.length();
  cfg.session.last_will.qos = 1;
  cfg.session.last_will.retain = 1;
  cfg.network.disable_auto_reconnect = true;   // reconexao feita aqui, para renovar connectionId e Last Will
  cfg.network.timeout_ms = 10000;
  cfg.buffer.size = 8192; cfg.buffer.out_size = 8192;
  mqttClient = esp_mqtt_client_init(&cfg);
  if (!mqttClient) { Serial.println("[MQTT] falha ao criar cliente"); return; }
  esp_mqtt_client_register_event(mqttClient, MQTT_EVENT_ANY, onMqttEvent, nullptr);
  Serial.printf("[MQTT] conectando a %s como %s (conexao %s)\n", MQTT_URI, MQTT_CLIENT_ID, link1->connectionId().c_str());
  esp_mqtt_client_start(mqttClient);
}

static void netLoop() {
  const uint32_t now = millis();
  if (evConnected) {
    evConnected = false; mqttUp = true; mqttBackoff = 2000;
    for (const char* ch : {"commands", "sync", "receipts"}) esp_mqtt_client_subscribe(mqttClient, link1->topic(ch).c_str(), 1);
    Serial.println("[MQTT] conectado; assinando commands/sync/receipts e publicando presenca");
    link1->onConnected();
  }
  if (evDisconnected) {
    evDisconnected = false; Serial.println("[MQTT] desconectado");
    mqttStop(); mqttRetryAt = now + mqttBackoff; mqttBackoff = std::min<uint32_t>(mqttBackoff * 2, 30000);
  }
  if (WiFi.status() != WL_CONNECTED) { if (mqttClient) mqttStop(); return; }
  if (!mqttClient && (int32_t)(now - mqttRetryAt) >= 0) {
    mqttStart();
    mqttRetryAt = now + 20000;   // se nao conectar nem desconectar, recria depois de 20 s
  } else if (mqttClient && !mqttUp && (int32_t)(now - mqttRetryAt) >= 0) {
    Serial.println("[MQTT] sem resposta do broker: recriando cliente");
    mqttStop(); mqttRetryAt = now + mqttBackoff; mqttBackoff = std::min<uint32_t>(mqttBackoff * 2, 30000);
  }
}

static void processIncoming() {
  String* msg;
  while (xQueueReceive(rxQueue, &msg, 0) == pdTRUE) {
    const int nl = msg->indexOf('\n');
    const String topic = msg->substring(0, nl), body = msg->substring(nl + 1);
    delete msg;
    if (link1->debugPayloads) Serial.printf("<< %s %s\n", topic.c_str(), body.c_str());
    link1->handleIncoming(topic, body);
  }
}

// ----------------------------------------------------------------------------- relogio
static void onTimeSync(struct timeval*) { clockSynced = true; }
static bool clockReliable() { return clockSynced && time(nullptr) > 1767225600; }   // NTP ok e depois de 2026-01-01

// ----------------------------------------------------------------------------- sensores e reles
static void relay(int pin, bool on) { digitalWrite(pin, (on == RELE_ATIVO_BAIXO) ? LOW : HIGH); }
static bool dsHave = false; static int lastAdcRaw = -1;

static Inputs readInputs(bool sample) {
  Inputs in; in.nowMs = v1::monoMs(); in.clockReliable = clockReliable(); in.epoch = in.clockReliable ? (int64_t)time(nullptr) : 0;
  in.floatLow = digitalRead(PIN_BOIA) == HIGH;   // circuito aberto tambem = baixo (fail-safe)
  if (!sample) return in;
  in.hasSample = true;
  float t = dht.readTemperature(), h = dht.readHumidity();
  in.dhtOk = !std::isnan(t) && !std::isnan(h); in.airT = t; in.airRH = h;
  if (dsHave) { float r = ds18.getTempCByIndex(0); in.dsOk = r != DEVICE_DISCONNECTED_C; in.rootT = r; }   // o nucleo descarta -127 e 85
  ds18.requestTemperatures(); dsHave = true;   // conversao assincrona: le na proxima amostra
  long acc = 0; int ok = 0;
  for (int i = 0; i < 8; i++) { int v = analogRead(PIN_SOLO); if (v >= 0) { acc += v; ok++; } }
  lastAdcRaw = ok ? (int)(acc / ok) : -1; in.soilAdc = lastAdcRaw;
  return in;
}

// ----------------------------------------------------------------------------- serial
static void printStatus() {
  Serial.printf("[STATUS] boot=%u bootId=%s conexao=%s wifi=%s ip=%s mqtt=%s hora=%s cfg=v%d fila=%u descartadas=%u\n",
    link1->bootNumber(), link1->bootId().c_str(), link1->connectionId().c_str(), WiFi.status() == WL_CONNECTED ? "ok" : "off",
    WiFi.localIP().toString().c_str(), mqttUp ? "ok" : "off", clockReliable() ? "confiavel" : "SEM HORA",
    link1->activeConfigVersion(), (unsigned)link1->pendingCount(), (unsigned)link1->droppedMessages());
  Serial.printf("[STATUS] B1=%s %s %s | B2=%s %s %s | nivel=%s\n",
    ctrl->pumpOn(Pump::B1) ? "LIGADA" : "desligada", modeName(ctrl->mode(Pump::B1)), v1::pumpFsm(*ctrl, Pump::B1),
    ctrl->pumpOn(Pump::B2) ? "LIGADA" : "desligada", modeName(ctrl->mode(Pump::B2)), v1::pumpFsm(*ctrl, Pump::B2), ctrl->levelLow() ? "BAIXO" : "OK");
  Serial.printf("[STATUS] ar=%.1fC/%.1f%% (%s) substrato=%.1fC (%s) solo=%.1f%% adc=%d (%s, cal=%s seco=%d agua=%d)\n",
    ctrl->airT(), ctrl->airRH(), ctrl->dhtReliable() ? "ok" : "invalido", ctrl->rootT(), ctrl->rootReliable() ? "ok" : "invalido",
    ctrl->soilPct(), lastAdcRaw, ctrl->soilReliable() ? "ok" : "invalido", link1->calibrationId().length() ? link1->calibrationId().c_str() : "nenhuma",
    link1->calDry(), link1->calWater());
}
static int calDryCandidate = -1, calWaterCandidate = -1;
static void tryCalibrate() {
  if (calDryCandidate < 0 || calWaterCandidate < 0) { Serial.println("[CAL] falta a outra leitura (seco e agua)"); return; }
  if (abs(calDryCandidate - calWaterCandidate) < 200) { Serial.println("[CAL] seco e agua muito proximos (< 200): refaca as leituras"); return; }
  if (link1->calibrate(calDryCandidate, calWaterCandidate)) Serial.printf("[CAL] calibracao salva: seco=%d agua=%d id=%s\n", calDryCandidate, calWaterCandidate, link1->calibrationId().c_str());
  calDryCandidate = calWaterCandidate = -1;
}
static void serialCommands() {
  if (!Serial.available()) return;
  String s = Serial.readStringUntil('\n'); s.trim(); s.toLowerCase();
  if (s == "status") printStatus();
  else if (s == "cal seco" || s == "cal agua") {
    if (lastAdcRaw < 0) { Serial.println("[CAL] sem leitura do solo ainda"); return; }
    if (s == "cal seco") calDryCandidate = lastAdcRaw; else calWaterCandidate = lastAdcRaw;
    Serial.printf("[CAL] %s = %d\n", s.c_str() + 4, lastAdcRaw); if (calDryCandidate >= 0 && calWaterCandidate >= 0) tryCalibrate();
  } else if (s.startsWith("cal manual ")) {
    int a = -1, b = -1; if (sscanf(s.c_str() + 11, "%d %d", &a, &b) == 2) { calDryCandidate = a; calWaterCandidate = b; tryCalibrate(); }
    else Serial.println("uso: cal manual <adc_seco> <adc_agua>");
  } else if (s == "cal limpar") { link1->clearCalibration(); Serial.println("[CAL] calibracao removida: solo nao confiavel"); }
  else if (s == "payloads on" || s == "payloads off") { link1->debugPayloads = s.endsWith("on"); Serial.printf("[DEBUG] payloads %s\n", link1->debugPayloads ? "on" : "off"); }
  else if (s == "reiniciar") { Serial.println("[BOOT] reiniciando (reles sobem desligados; NVS preservada)"); delay(100); ESP.restart(); }
  else if (s.length()) Serial.println("comandos: status | cal seco | cal agua | cal manual <seco> <agua> | cal limpar | payloads on|off | reiniciar");
}

static const char* resetReasonText() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power-on"; case ESP_RST_SW: return "software"; case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: case ESP_RST_TASK_WDT: case ESP_RST_WDT: return "watchdog"; case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_DEEPSLEEP: return "deep-sleep"; default: return "desconhecido";
  }
}

// ----------------------------------------------------------------------------- setup / loop
void setup() {
  // 1) reles desligados ANTES de qualquer outra coisa (nivel inativo ja no pino antes de virar saida)
  digitalWrite(PIN_B1, RELE_ATIVO_BAIXO ? HIGH : LOW); pinMode(PIN_B1, OUTPUT);
  digitalWrite(PIN_B2, RELE_ATIVO_BAIXO ? HIGH : LOW); pinMode(PIN_B2, OUTPUT);
  Serial.begin(115200); Serial.setTimeout(50); delay(200);
  Serial.printf("\n[BOOT] PIEVI %s, device %s, reset=%s\n", FW_VERSION, DEVICE_ID, resetReasonText());

  pinMode(PIN_BOIA, INPUT_PULLUP); analogReadResolution(12); analogSetPinAttenuation(PIN_SOLO, ADC_11db);
  dht.begin(); ds18.begin(); ds18.setWaitForConversion(false); ds18.setResolution(12);
  Serial.printf("[BOOT] DS18B20 encontrados: %d\n", ds18.getDeviceCount());

  // 2) NVS: bootNumber incrementado e salvo ANTES da operacao (namespace proprio do v1)
  prefs.begin("pievi-v1", false);
  const uint32_t bootNumber = prefs.getUInt("bootNumber", 0) + 1; prefs.putUInt("bootNumber", bootNumber);
  ctrl = new Controller(bootNumber, -180);   // America/Sao_Paulo = UTC-3 (sem horario de verao)
  link1 = new v1::Link(*ctrl, prefs, {DEVICE_ID, FW_VERSION}, mqttPublish);
  link1->begin(bootNumber);
  ctrl->reportReboot(resetReasonText());
  Serial.printf("[BOOT] bootNumber=%u bootId=%s\n", bootNumber, link1->bootId().c_str());

  // 3) rede e relogio
  rxQueue = xQueueCreate(16, sizeof(String*));
  WiFi.mode(WIFI_STA); WiFi.setSleep(false); WiFi.setAutoReconnect(true); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  sntp_set_time_sync_notification_cb(onTimeSync);
  configTime(0, 0, "pool.ntp.org", "time.google.com", "a.st1.ntp.br");

  // watchdog: se o laco travar por 15 s, reinicia (os reles sobem desligados)
  esp_task_wdt_config_t wc = {.timeout_ms = 15000, .idle_core_mask = 0, .trigger_panic = true};
  if (esp_task_wdt_reconfigure(&wc) != ESP_OK) esp_task_wdt_init(&wc);
  esp_task_wdt_add(NULL);
}

void loop() {
  esp_task_wdt_reset();
  static uint32_t lastSample = 0, lastWifiLog = 0; static bool lastClock = false; static wl_status_t lastWifi = WL_IDLE_STATUS;
  const uint32_t now = millis();

  const wl_status_t ws = WiFi.status();
  if (ws != lastWifi) { lastWifi = ws; if (ws == WL_CONNECTED) Serial.printf("[WiFi] conectado a %s, IP %s, RSSI %d\n", WIFI_SSID, WiFi.localIP().toString().c_str(), WiFi.RSSI()); else Serial.printf("[WiFi] status %d\n", (int)ws); }
  else if (ws != WL_CONNECTED && now - lastWifiLog > 15000) { lastWifiLog = now; Serial.printf("[WiFi] tentando %s...\n", WIFI_SSID); }

  netLoop();
  serialCommands();

  const bool clock = clockReliable();
  link1->setClock(clock);
  if (clock != lastClock) {
    Serial.printf("[HORA] %s\n", clock ? "UTC confiavel (NTP)" : "SEM hora confiavel");
    if (!clock) for (Pump p : {Pump::B1, Pump::B2}) if (ctrl->mode(p) != Mode::AUTO) ctrl->forceAuto(p, "Hora nao confiavel: modo manual encerrado.");
    lastClock = clock;
  }

  processIncoming();   // comandos validados pelo link antes de chegar ao nucleo

  const bool sample = now - lastSample >= SAMPLE_MS; if (sample) lastSample = now;
  ctrl->tick(readInputs(sample));
  relay(PIN_B1, ctrl->pumpOn(Pump::B1)); relay(PIN_B2, ctrl->pumpOn(Pump::B2));   // saida logo apos a decisao

  link1->afterTick(lastAdcRaw);
  delay(20);
}
