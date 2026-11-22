// PIEVI MQTT v1 - camada de protocolo do ESP32 (docs/contrato-mqtt-v1.md + protocol/mqtt/v1/).
// Converte o nucleo (pievi_core.h) para o vocabulario v1 e cuida de: envelope e IDs, fila com recibos,
// sync, comandos (alvo/prazo/duplicidade), configuracao versionada, eventos e estado completo.
// Nao toca em GPIO: as saidas so mudam pelo nucleo, chamado no loop principal.
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_random.h>
#include <esp_timer.h>
#include <sys/time.h>
#include <cmath>
#include <vector>

#include "pievi_core.h"
#include "pievi_time.h"

namespace v1 {
using namespace pievi;

// ------------------------------------------------------------------------------------------- utilidades
inline String uuid4() {
  uint8_t b[16]; esp_fill_random(b, sizeof b);
  b[6] = (b[6] & 0x0F) | 0x40; b[8] = (b[8] & 0x3F) | 0x80;
  char s[37]; snprintf(s, sizeof s, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
  return String(s);
}
inline bool isUuid(const char* s) {
  if (!s || strlen(s) != 36) return false;
  for (int i = 0; i < 36; i++) { char c = s[i]; bool dash = i == 8 || i == 13 || i == 18 || i == 23;
    if (dash ? c != '-' : !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false; }
  return true;
}
inline int64_t monoMs() { return esp_timer_get_time() / 1000; }   // 64 bits: nao volta a zero
inline int64_t epochMs() { struct timeval tv; gettimeofday(&tv, nullptr); return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000; }
/** "YYYY-MM-DDTHH:mm:ss(.sss)?Z" -> ms UTC, ou -1. */
inline int64_t isoToMs(const char* s) {
  if (!s) return -1; size_t n = strlen(s); if (n < 20 || s[n - 1] != 'Z') return -1;
  int64_t sec = isoToEpoch(s); if (sec < 0) return -1;
  int ms = 0; if (s[19] == '.') { if (n != 24) return -1; ms = atoi(s + 20); } else if (n != 20) return -1;
  return sec * 1000 + ms;
}
inline String isoFromSec(int64_t sec) { return String(epochToIso(sec).c_str()); }
inline uint32_t fnv1a(const char* d, size_t n) { uint32_t h = 2166136261u; for (size_t i = 0; i < n; i++) { h ^= (uint8_t)d[i]; h *= 16777619u; } return h; }
/** Numero com uma casa decimal, escrito literalmente (evita 28.399999 no JSON).
 *  Template: recebe o proxy do campo (d["x"]) para que null tambem CRIE a chave. */
template <typename V> inline void setNum1(V v, float x) {
  if (!std::isfinite(x)) { v.set(nullptr); return; }
  char b[16]; snprintf(b, sizeof b, "%.1f", roundf(x * 10) / 10); if (!strcmp(b, "-0.0")) strcpy(b, "0.0");
  v.set(serialized(String(b)));
}
inline int hhmmToMin(const char* s) {
  if (!s || strlen(s) != 5 || s[2] != ':') return -1;
  int h = (s[0] - '0') * 10 + (s[1] - '0'), m = (s[3] - '0') * 10 + (s[4] - '0');
  return (h >= 0 && h < 24 && m >= 0 && m < 60) ? h * 60 + m : -1;
}

// ------------------------------------------------------------------------------------------- traducao do nucleo
inline const char* pumpFsm(const Controller& c, Pump p) {
  if (c.mode(p) != Mode::AUTO) return modeName(c.mode(p));
  const bool on = c.pumpOn(p);
  if (p == Pump::B1) switch (c.irrState()) {
    case IrrState::IRRIGANDO: return "RUNNING";
    case IrrState::COOLDOWN: return on ? "RUNNING" : "PAUSED";
    case IrrState::BLOQUEIO_AGUA: return "BLOCKED";
    case IrrState::FALHA_IRRIG: return "FAULT";
    case IrrState::SEM_SENSOR_SOLO: return on ? "RUNNING" : "BLOCKED";
    default: return on ? "RUNNING" : "IDLE";
  }
  switch (c.mistState()) {
    case MistState::NEBULIZANDO: return "RUNNING";
    case MistState::PAUSA: return on ? "RUNNING" : "PAUSED";
    case MistState::EMERGENCIA_CALOR: return on ? "RUNNING" : "PAUSED";
    case MistState::BLOQUEIO_AGUA: return "BLOCKED";
    case MistState::FALHA_NEVOA: return "FAULT";
    case MistState::SEM_DHT: return "BLOCKED";
    default: return on ? "RUNNING" : "IDLE";
  }
}
inline const char* blockedReason(const Controller& c, Pump p) {
  if (c.mode(p) != Mode::AUTO) return nullptr;
  if (p == Pump::B1) {
    if (c.irrState() == IrrState::BLOQUEIO_AGUA) return "Nivel de agua baixo ou boia em circuito aberto.";
    if (c.irrState() == IrrState::SEM_SENSOR_SOLO && !c.pumpOn(p)) return c.calibrated() ? "Sensor de solo invalido; agenda de reserva ativa." : "Solo sem calibracao; agenda de reserva ativa.";
  } else {
    if (c.mistState() == MistState::BLOQUEIO_AGUA) return "Nivel de agua baixo ou boia em circuito aberto.";
    if (c.mistState() == MistState::SEM_DHT) return "DHT22 sem leitura valida.";
  }
  return nullptr;
}
inline const char* faultCode(const Controller& c, Pump p) {
  if (c.mode(p) != Mode::AUTO) return nullptr;
  if (p == Pump::B1 && c.irrState() == IrrState::FALHA_IRRIG) return "IRRIG_FALHA";
  if (p == Pump::B2 && c.mistState() == MistState::FALHA_NEVOA) return "NEVOA_FALHA";
  return nullptr;
}
/** Nome de estado do nucleo (portugues) -> vocabulario v1 de FSM de bomba. */
inline const char* fsmWord(const std::string& s) {
  if (s == "IRRIGANDO" || s == "NEBULIZANDO") return "RUNNING";
  if (s == "COOLDOWN" || s == "PAUSA" || s == "EMERGENCIA_CALOR") return "PAUSED";
  if (s == "BLOQUEIO_AGUA" || s == "SEM_SENSOR_SOLO" || s == "SEM_DHT") return "BLOCKED";
  if (s == "FALHA_IRRIG" || s == "FALHA_NEVOA") return "FAULT";
  return "IDLE";
}

// ------------------------------------------------------------------------------------------- link
enum Channel : uint8_t { CH_TELEMETRY, CH_STATE, CH_EVENTS, CH_ACKS };
static const char* const kChannelName[] = {"telemetry", "state", "events", "acks"};

/** Saida MQTT fornecida pelo .ino (cliente esp-mqtt). Retorna false se nao foi possivel enfileirar. */
using PublishFn = bool (*)(const String& topic, const String& body, bool retain);

struct Settings { const char* deviceId; const char* firmwareVersion; };

class Link {
 public:
  Link(Controller& c, Preferences& nvs, Settings s, PublishFn pub) : c_(c), nvs_(nvs), s_(s), pub_(pub) {
    base_ = String("pievi/v1/devices/") + s.deviceId + "/";
  }

  // ---- boot / sessao
  void begin(uint32_t bootNumber) {
    bootNumber_ = bootNumber; bootId_ = uuid4(); connectionId_ = uuid4();
    loadCalibration(); loadConfig();
  }
  const String& bootId() const { return bootId_; }
  uint32_t bootNumber() const { return bootNumber_; }
  const String& connectionId() const { return connectionId_; }
  String topic(const char* ch) const { return base_ + ch; }
  /** Novo connectionId para a proxima conexao MQTT; o .ino monta o Last Will com ele. */
  const String& newConnection() { connectionId_ = uuid4(); return connectionId_; }
  String presence(bool online) const {
    JsonDocument d; d["schemaVersion"] = 1; d["type"] = "presence"; d["deviceId"] = s_.deviceId;
    d["bootId"] = bootId_; d["bootNumber"] = bootNumber_; d["connectionId"] = connectionId_; d["online"] = online;
    String out; serializeJson(d, out); return out;
  }
  void setClock(bool reliable) { clockReliable_ = reliable; }
  bool clockReliable() const { return clockReliable_; }
  int activeConfigVersion() const { return cfgVersion_; }
  uint32_t droppedMessages() const { return dropped_; }
  size_t pendingCount() const { return pending_.size(); }
  String calibrationId() const { return calId_; }

  /** Chamado pelo .ino logo apos CONNACK + assinaturas: presenca online, calibracao, estado e telemetria. */
  void onConnected() {
    connected_ = true;
    pub_(topic("presence"), presence(true), true);
    if (calId_.length()) sendCalibration();
    publishState(nullptr); publishTelemetry();
    for (auto& p : pending_) p.lastSent = 0;     // reenvia pendencias (mesmo conteudo e IDs)
  }
  void onDisconnected() { connected_ = false; }

  // ---- entrada MQTT (ja copiada para o loop principal)
  void handleIncoming(const String& t, const String& body) {
    if (t == topic("receipts")) onReceipt(body);
    else if (t == topic("sync")) onSync(body);
    else if (t == topic("commands")) onCommand(body);
  }

  // ---- ciclo do loop: depois de Controller::tick()
  void afterTick(int adcRaw) {
    adcRaw_ = adcRaw;
    trackManualTimers();
    translateEvents();
    const String sig = stateSignature();
    const uint32_t now = millis();
    if (sig != lastSig_ && now - lastStateMs_ >= 300) publishState(nullptr);
    if (now - lastStateMs_ >= kPeriodMs) publishState(nullptr);
    // Heartbeat de 10 s (contrato: ate 15 s) + envio antecipado quando a leitura muda de forma perceptivel.
    // Mudanca do nivel de agua sai na hora: e a informacao que libera/bloqueia as bombas no app.
    if (now - lastTelemetryMs_ >= kPeriodMs || (now - lastTelemetryMs_ >= kMinTelemetryGapMs && telemetryChanged()) || c_.levelLow() != lastTel_.low) publishTelemetry();
    flush();
  }

  // ---- calibracao (comandos seriais do .ino)
  bool calibrate(int adcDry, int adcWater) {
    if (adcDry < 0 || adcDry > 4095 || adcWater < 0 || adcWater > 4095 || adcDry == adcWater) return false;
    String id = uuid4();
    nvs_.putString("calId", id); nvs_.putInt("calDry", adcDry); nvs_.putInt("calWater", adcWater);
    calId_ = id; calDry_ = adcDry; calWater_ = adcWater; c_.setCalibration(adcDry, adcWater);
    sendCalibration();   // antes da primeira amostra que usa esta calibracao
    return true;
  }
  void clearCalibration() { nvs_.remove("calId"); calId_ = ""; c_.clearCalibration(); }
  int calDry() const { return calDry_; }
  int calWater() const { return calWater_; }

  bool debugPayloads = true;   // imprime na serial todo payload publicado (sem segredos)

 private:
  static constexpr uint32_t kPeriodMs = 10000, kResendMs = 5000, kMinTelemetryGapMs = 3000;   // API no Railway grava em ~1 s
  // Ultima telemetria publicada, para detectar mudanca perceptivel.
  struct LastTelemetry { bool dht = false, root = false, soil = false, low = true; float t = NAN, rh = NAN, rootT = NAN, soilPct = NAN; } lastTel_;
  static bool moved(float a, float b, float eps) { return std::isfinite(a) != std::isfinite(b) || (std::isfinite(a) && std::fabs(a - b) >= eps); }
  bool telemetryChanged() const {
    const bool dht = c_.dhtReliable(), root = c_.rootReliable(), soil = c_.soilReliable() && calId_.length();
    if (dht != lastTel_.dht || root != lastTel_.root || soil != lastTel_.soil || c_.levelLow() != lastTel_.low) return true;
    return (dht && (moved(c_.airT(), lastTel_.t, 0.5f) || moved(c_.airRH(), lastTel_.rh, 2.0f))) ||
           (root && moved(c_.rootT(), lastTel_.rootT, 0.5f)) || (soil && moved(c_.soilPct(), lastTel_.soilPct, 2.0f));
  }
  static constexpr size_t kMaxQueued = 32, kMaxQueuedBytes = 65536;

  struct Pending { String id; Channel ch; String body; uint32_t lastSent; };
  struct Known { String id; uint32_t hash; size_t len; String status; String reason; int applied; };
  struct AlertRec { std::string coreEpisode; String id; String code; int pump; String severity; String startedAt; String detail; };
  struct CycleRec { bool open = false; String id, source, commandId, reason, startedAt; int64_t startMono = 0; float t = NAN, rh = NAN, soil = NAN; };

  Controller& c_; Preferences& nvs_; Settings s_; PublishFn pub_; String base_;
  String bootId_, connectionId_; uint32_t bootNumber_ = 1; uint32_t sequence_ = 0;
  bool connected_ = false, clockReliable_ = false;
  std::vector<Pending> pending_; uint32_t dropped_ = 0;
  std::vector<Known> known_;
  std::vector<AlertRec> alerts_; CycleRec cycles_[2];
  int64_t manualStartSec_[2] = {0, 0}, manualEndSec_[2] = {0, 0}; Mode lastMode_[2] = {Mode::AUTO, Mode::AUTO};
  String calId_; int calDry_ = -1, calWater_ = -1; int adcRaw_ = -1;
  int cfgVersion_ = 0; String cfgJson_;
  String lastSig_; uint32_t lastStateMs_ = 0, lastTelemetryMs_ = 0;

  // ---------------------------------------------------------------- envelope e fila
  void envelope(JsonDocument& d, const char* type) {
    const uint32_t seq = ++sequence_;
    d["schemaVersion"] = 1; d["type"] = type; d["deviceId"] = s_.deviceId;
    d["bootId"] = bootId_; d["bootNumber"] = bootNumber_; d["connectionId"] = connectionId_;
    d["sequence"] = seq; d["messageId"] = bootId_ + ":" + String(seq);
    d["uptimeMs"] = (int64_t)monoMs(); d["clockReliable"] = clockReliable_;
    if (clockReliable_) d["occurredAt"] = isoFromSec(epochMs() / 1000); else d["occurredAt"] = nullptr;
  }
  String nowIsoOrEmpty() const { return clockReliable_ ? isoFromSec(epochMs() / 1000) : String(); }
  template <typename V> static void setIsoOrNull(V v, const String& iso) { if (iso.length()) v.set(iso); else v.set(nullptr); }

  void send(Channel ch, JsonDocument& d) {
    Pending p; p.id = d["messageId"].as<String>(); p.ch = ch; serializeJson(d, p.body); p.lastSent = 0;
    if (ch == CH_TELEMETRY || ch == CH_STATE)   // estado/telemetria: so a pendencia mais recente de cada topico
      for (size_t i = 0; i < pending_.size();) { if (pending_[i].ch == ch) pending_.erase(pending_.begin() + i); else i++; }
    pending_.push_back(p);
    for (;;) {   // eventos/ACKs: ate 32 mensagens ou 64 KiB; descarta a mais antiga
      size_t n = 0, bytes = 0; int oldest = -1;
      for (size_t i = 0; i < pending_.size(); i++) { bytes += pending_[i].body.length();
        if (pending_[i].ch == CH_EVENTS || pending_[i].ch == CH_ACKS) { n++; if (oldest < 0) oldest = (int)i; } }
      if ((n <= kMaxQueued && bytes <= kMaxQueuedBytes) || oldest < 0) break;
      pending_.erase(pending_.begin() + oldest); dropped_++;
    }
    flush();
  }
  void flush() {
    if (!connected_) return;
    const uint32_t now = millis();
    // Estado novo primeiro; depois o restante da fila, na ordem original (IDs e conexao de origem preservados).
    for (int pass = 0; pass < 2; pass++) for (auto& p : pending_) {
      if ((pass == 0) != (p.ch == CH_STATE)) continue;
      if (p.lastSent && now - p.lastSent < kResendMs) continue;
      const String t = topic(kChannelName[p.ch]);
      if (!pub_(t, p.body, false)) return;
      if (debugPayloads) Serial.printf(">> %s %s\n", t.c_str(), p.body.c_str());
      p.lastSent = now ? now : 1;
    }
  }

  // ---------------------------------------------------------------- recibos e sync
  void onReceipt(const String& body) {
    JsonDocument d; if (deserializeJson(d, body)) return;
    if (strcmp(d["type"] | "", "receipt") || strcmp(d["deviceId"] | "", s_.deviceId)) return;
    if (bootId_ != (d["sourceBootId"] | "")) return;              // recibo de outro boot: ignorar
    const char* src = d["sourceMessageId"] | ""; const char* st = d["status"] | "";
    for (size_t i = 0; i < pending_.size(); i++) if (pending_[i].id == src) {
      if (!strcmp(st, "stored") || !strcmp(st, "duplicate") || !strcmp(st, "rejected")) {
        if (!strcmp(st, "rejected")) Serial.printf("[RECIBO] mensagem %s REJEITADA pela API: %s\n", src, d["reason"] | "(sem motivo)");
        pending_.erase(pending_.begin() + i);
      }
      return;
    }
  }
  void onSync(const String& body) {
    JsonDocument d; if (deserializeJson(d, body)) return;
    if (strcmp(d["type"] | "", "sync") || strcmp(d["deviceId"] | "", s_.deviceId) || !isUuid(d["syncId"] | "")) return;
    const int64_t exp = isoToMs(d["expiresAt"] | "");
    if (clockReliable_ && (exp < 0 || epochMs() > exp)) { Serial.println("[SYNC] desafio vencido: ignorado"); return; }
    String syncId = d["syncId"].as<String>();
    Serial.printf("[SYNC] respondendo %s\n", syncId.c_str());
    publishState(&syncId);   // sync nunca atua uma saida
    publishTelemetry();
  }

  // ---------------------------------------------------------------- comandos
  Known* findKnown(const String& id) { for (auto& k : known_) if (k.id == id) return &k; return nullptr; }
  void remember(const String& id, uint32_t h, size_t len, const String& st, const String& reason, int applied) {
    Known* k = findKnown(id);
    if (!k) { if (known_.size() >= 48) known_.erase(known_.begin()); known_.push_back({id, h, len, st, reason, applied}); return; }
    k->status = st; k->reason = reason; k->applied = applied;
  }
  void sendAck(const String& id, const char* status, const String& reason, int applied) {
    JsonDocument d; envelope(d, "ack");
    d["commandId"] = id; d["status"] = status;
    if (reason.length()) d["reason"] = reason; else d["reason"] = nullptr;
    if (applied > 0 && !strcmp(status, "completed")) d["appliedConfigVersion"] = applied; else d["appliedConfigVersion"] = nullptr;
    send(CH_ACKS, d);
  }
  void reject(const String& id, uint32_t h, size_t len, const char* why) {
    Serial.printf("[CMD] %s recusado: %s\n", id.c_str(), why);
    remember(id, h, len, "rejected", why, 0); sendAck(id, "rejected", why, 0);
  }
  static bool validCommandId(const char* s) {
    size_t n = s ? strlen(s) : 0; if (n < 8 || n > 100) return false;
    for (size_t i = 0; i < n; i++) { char c = s[i]; if (!isalnum((unsigned char)c) && c != ':' && c != '_' && c != '-') return false; }
    return true;
  }
  void onCommand(const String& body) {
    JsonDocument d;
    if (deserializeJson(d, body)) { Serial.println("[CMD] JSON invalido: descartado"); return; }
    if (strcmp(d["type"] | "", "command") || strcmp(d["deviceId"] | "", s_.deviceId) || (int)(d["schemaVersion"] | 0) != 1) { Serial.println("[CMD] envelope invalido: descartado"); return; }
    const char* cid = d["commandId"] | "";
    if (!validCommandId(cid)) { Serial.println("[CMD] commandId invalido: descartado"); return; }
    const String id(cid); const uint32_t h = fnv1a(body.c_str(), body.length());
    if (Known* k = findKnown(id)) {   // repeticao: informa o resultado conhecido, sem atuar de novo
      if (k->hash == h && k->len == body.length()) { Serial.printf("[CMD] %s repetido: %s\n", cid, k->status.c_str()); sendAck(id, k->status.c_str(), k->reason, k->applied); }
      else { Serial.printf("[CMD] %s reutilizado com outro conteudo\n", cid); sendAck(id, "rejected", "commandId reutilizado com outro conteudo.", 0); }
      return;
    }
    if (bootId_ != (d["targetBootId"] | "") || (uint32_t)(d["targetBootNumber"] | 0) != bootNumber_ || connectionId_ != (d["targetConnectionId"] | ""))
      return reject(id, h, body.length(), "Alvo de boot/conexao diferente.");
    if (!clockReliable_) return reject(id, h, body.length(), "ESP sem hora confiavel: comando recusado.");
    const int64_t created = isoToMs(d["createdAt"] | ""), expires = isoToMs(d["expiresAt"] | "");
    if (created < 0 || expires <= created || expires - created > 10000) return reject(id, h, body.length(), "Validade do comando invalida.");
    if (epochMs() > expires) return reject(id, h, body.length(), "Comando vencido.");
    if (d["supervisionConfirmed"].is<bool>() == false) return reject(id, h, body.length(), "supervisionConfirmed ausente.");
    const char* action = d["action"] | "";
    if (!strcmp(action, "APPLY_CONFIG")) return applyConfig(id, h, body.length(), d);

    const char* pid = d["pumpId"] | "";
    Pump pump; if (!strcmp(pid, "B1")) pump = Pump::B1; else if (!strcmp(pid, "B2")) pump = Pump::B2; else return reject(id, h, body.length(), "pumpId invalido.");
    const bool hasDur = d["durationSeconds"].is<int>(); const int dur = d["durationSeconds"] | 0;
    const bool sup = d["supervisionConfirmed"] | false;
    Command c; c.id = cid; c.pump = pump; c.supervisionConfirmed = sup;
    c.createdAt = created / 1000; c.expiresAt = (expires + 999) / 1000;
    if (!strcmp(action, "MANUAL_ON")) { if (!hasDur || dur < 1 || dur > (pump == Pump::B1 ? 300 : 60)) return reject(id, h, body.length(), "Duracao manual fora do limite da bomba."); c.action = Action::ManualOn; c.durationS = dur; }
    else if (!strcmp(action, "MANUAL_OFF")) { if (!hasDur || dur != 3600) return reject(id, h, body.length(), "MANUAL_OFF exige 3600 s."); c.action = Action::ManualOff; c.durationS = dur; }
    else if (!strcmp(action, "TEST")) { if (!hasDur || dur != 10) return reject(id, h, body.length(), "TEST exige 10 s."); c.action = Action::Test; c.durationS = 10; }
    else if (!strcmp(action, "AUTO")) { if (!d["durationSeconds"].isNull()) return reject(id, h, body.length(), "AUTO nao aceita duracao."); c.action = Action::Auto; }
    else if (!strcmp(action, "RESET_FAULT")) { if (!d["durationSeconds"].isNull()) return reject(id, h, body.length(), "RESET_FAULT nao aceita duracao."); c.action = Action::ResetFault; }
    else if (!strcmp(action, "IGNORE_FLOAT")) return reject(id, h, body.length(), "IGNORE_FLOAT nao habilitado neste firmware de bancada.");
    else return reject(id, h, body.length(), "Acao desconhecida.");
    if (sup) return reject(id, h, body.length(), "supervisionConfirmed so e valido para IGNORE_FLOAT.");
    Serial.printf("[CMD] %s %s %s dur=%d\n", cid, pid, action, c.durationS);
    remember(id, h, body.length(), "accepted", "", 0);   // o resultado final vem dos ACKs do nucleo
    c_.handleCommand(c);
  }

  // ---------------------------------------------------------------- configuracao versionada
  static bool readConfig(JsonObjectConst o, Config& out, String& why) {
    static const char* const kKeys[] = {"soilMinPercent", "soilMaxPercent", "irrigationMaxSeconds", "irrigationCooldownMinutes", "irrigationMaxCyclesPerDay",
      "fogTemperatureOnC", "fogHysteresisC", "fogHumidityMinPercent", "fogHumidityBlockPercent", "fogPulseSeconds", "fogPauseSeconds",
      "emergencyTemperatureC", "rootAlertTemperatureC", "manualIrrigationSeconds", "manualFogSeconds",
      "lowWaterBlocksPumps", "irrigationWindowEnabled", "irrigationWindowStart", "irrigationWindowEnd", "irrigationSchedule"};
    if (o.isNull()) { why = "config ausente."; return false; }
    for (JsonPairConst kv : o) { bool ok = false; for (const char* k : kKeys) if (!strcmp(kv.key().c_str(), k)) ok = true;
      if (!ok) { why = String("campo desconhecido: ") + kv.key().c_str(); return false; } }
    for (const char* k : kKeys) if (!o[k].is<JsonVariantConst>() || o[k].isNull()) { why = String("campo ausente: ") + k; return false; }
    auto num = [&](const char* k, float& dst) { if (!o[k].is<float>()) { why = String(k) + " deve ser numero."; return false; } dst = o[k].as<float>(); return true; };
    auto integer = [&](const char* k, int& dst) { if (!o[k].is<int>()) { why = String(k) + " deve ser inteiro."; return false; } dst = o[k].as<int>(); return true; };
    Config c; int pause = 0;
    if (!num("soilMinPercent", c.soloMin) || !num("soilMaxPercent", c.soloMax) || !integer("irrigationMaxSeconds", c.irrigMaxS) ||
        !integer("irrigationCooldownMinutes", c.cooldownIrrigMin) || !integer("irrigationMaxCyclesPerDay", c.irrigMaxCiclosDia) ||
        !num("fogTemperatureOnC", c.tempNevoaOn) || !num("fogHysteresisC", c.histereseNevoa) || !num("fogHumidityMinPercent", c.urMinNevoa) ||
        !num("fogHumidityBlockPercent", c.urTravaNevoa) || !integer("fogPulseSeconds", c.pulsoNevoaS) || !integer("fogPauseSeconds", pause) ||
        !num("emergencyTemperatureC", c.tempEmergencia) || !num("rootAlertTemperatureC", c.tempRaizAlerta) ||
        !integer("manualIrrigationSeconds", c.manualIrrigS) || !integer("manualFogSeconds", c.manualNevoaS)) return false;
    if (pause < 60 || pause > 1800 || pause % 60) { why = "fogPauseSeconds deve ser multiplo de 60 entre 60 e 1800."; return false; }
    c.pausaNevoaMin = pause / 60;
    if (!o["lowWaterBlocksPumps"].is<bool>() || !o["irrigationWindowEnabled"].is<bool>()) { why = "campos booleanos invalidos."; return false; }
    c.bloquearSemAgua = o["lowWaterBlocksPumps"].as<bool>(); c.janelaAtiva = o["irrigationWindowEnabled"].as<bool>();
    c.janelaInicioMin = hhmmToMin(o["irrigationWindowStart"] | ""); c.janelaFimMin = hhmmToMin(o["irrigationWindowEnd"] | "");
    if (c.janelaInicioMin < 0 || c.janelaFimMin < 0) { why = "janela deve usar HH:mm."; return false; }
    JsonArrayConst a = o["irrigationSchedule"].as<JsonArrayConst>();
    if (a.isNull() || a.size() > (size_t)Config::kMaxSlots) { why = "agenda invalida (ate 24 horarios)."; return false; }
    c.nAgenda = 0;
    for (JsonObjectConst row : a) {
      if (row.isNull() || row.size() != 3 || !row["time"].is<const char*>() || !row["durationSeconds"].is<int>() || !row["enabled"].is<bool>()) { why = "horario de reserva invalido."; return false; }
      Slot& s = c.agenda[c.nAgenda++]; s.minuteOfDay = hhmmToMin(row["time"]); s.durationS = row["durationSeconds"]; s.enabled = row["enabled"];
    }
    std::string w; if (!c.validate(&w)) { why = w.c_str(); return false; }
    out = c; return true;
  }
  void applyConfig(const String& id, uint32_t h, size_t len, JsonDocument& d) {
    if (!d["pumpId"].isNull() || !d["durationSeconds"].isNull()) return reject(id, h, len, "APPLY_CONFIG nao usa pumpId/duracao.");
    if (strcmp(d["timeZone"] | "", "America/Sao_Paulo")) return reject(id, h, len, "timeZone deve ser America/Sao_Paulo.");
    if (!d["configVersion"].is<int>() || d["configVersion"].as<int>() < 1) return reject(id, h, len, "configVersion invalida.");
    const int version = d["configVersion"].as<int>();
    String cfgJson; serializeJson(d["config"], cfgJson);
    if (version < cfgVersion_) return reject(id, h, len, "Versao de configuracao anterior a aplicada.");
    if (version == cfgVersion_) {
      if (cfgJson != cfgJson_) return reject(id, h, len, "Mesma versao com conteudo diferente.");
      remember(id, h, len, "completed", "Configuracao ja aplicada.", version); sendAck(id, "completed", "Configuracao ja aplicada.", version); return;
    }
    Config c; String why;
    if (!readConfig(d["config"].as<JsonObjectConst>(), c, why)) return reject(id, h, len, (String("Configuracao recusada: ") + why).c_str());
    c.version = version;
    String blob = String("{\"configVersion\":") + version + ",\"config\":" + cfgJson + "}";
    if (nvs_.putString("cfg", blob) != blob.length()) return reject(id, h, len, "Falha ao salvar configuracao na NVS.");
    if (!c_.setConfig(c)) return reject(id, h, len, "Controlador recusou a configuracao.");
    cfgVersion_ = version; cfgJson_ = cfgJson;
    Serial.printf("[CFG] versao %d aplicada e salva na NVS\n", version);
    remember(id, h, len, "completed", "", version); sendAck(id, "completed", "", version);
    publishState(nullptr);
  }
  void loadConfig() {
    String blob = nvs_.getString("cfg", "");
    if (!blob.length()) { cfgVersion_ = 0; Serial.println("[CFG] sem configuracao do app: versao 0 (padroes de fabrica)"); return; }
    JsonDocument d; Config c; String why;
    if (deserializeJson(d, blob) || !d["configVersion"].is<int>() || !readConfig(d["config"].as<JsonObjectConst>(), c, why)) {
      cfgVersion_ = 0; c_.reportConfigInvalid("configuracao salva invalida: usando padroes"); Serial.println("[CFG] configuracao da NVS invalida"); return;
    }
    c.version = d["configVersion"].as<int>(); c_.setConfig(c);
    cfgVersion_ = c.version; serializeJson(d["config"], cfgJson_);
    Serial.printf("[CFG] versao %d carregada da NVS\n", cfgVersion_);
  }
  void loadCalibration() {
    calId_ = nvs_.getString("calId", ""); calDry_ = nvs_.getInt("calDry", -1); calWater_ = nvs_.getInt("calWater", -1);
    if (calId_.length() && isUuid(calId_.c_str()) && c_.setCalibration(calDry_, calWater_)) Serial.printf("[CAL] %s seco=%d agua=%d\n", calId_.c_str(), calDry_, calWater_);
    else { calId_ = ""; Serial.println("[CAL] solo sem calibracao: use 'cal seco' e 'cal agua' na serial"); }
  }
  void sendCalibration() {
    JsonDocument d; envelope(d, "event");
    d["eventType"] = "calibration"; d["calibrationId"] = calId_; d["adcDry"] = calDry_; d["adcWater"] = calWater_;
    send(CH_EVENTS, d);
  }

  // ---------------------------------------------------------------- eventos do nucleo -> v1
  void measurements(JsonObject m) {
    if (c_.dhtReliable()) { setNum1(m["airTemperatureC"], c_.airT()); setNum1(m["airHumidityPercent"], c_.airRH()); }
    else { m["airTemperatureC"] = nullptr; m["airHumidityPercent"] = nullptr; }
    if (c_.soilReliable()) setNum1(m["soilMoisturePercent"], c_.soilPct()); else m["soilMoisturePercent"] = nullptr;
  }
  void measurementsFrom(JsonObject m, float t, float rh, float soil) { setNum1(m["airTemperatureC"], t); setNum1(m["airHumidityPercent"], rh); setNum1(m["soilMoisturePercent"], soil); }
  static const char* cycleSource(const std::string& origin, bool hasCmd) {
    if (origin == "manual") return hasCmd ? "manual" : "auto";
    if (origin == "teste") return hasCmd ? "test" : "auto";   // pulso de teste automatico da nevoa nao tem comando
    if (origin == "fallback") return "fallback";
    if (origin == "emergencia") return "emergency";
    return "auto";
  }
  static const char* cycleReason(const char* src, Pump p) {
    if (!strcmp(src, "manual")) return "Pedido manual do app.";
    if (!strcmp(src, "test")) return "Teste de bomba pedido pelo app.";
    if (!strcmp(src, "fallback")) return "Agenda de reserva (solo sem leitura valida).";
    if (!strcmp(src, "emergency")) return "Emergencia de calor.";
    return p == Pump::B1 ? "Automacao: solo abaixo do minimo." : "Automacao: temperatura alta ou umidade baixa.";
  }
  void translateEvents() {
    for (const Event& e : c_.takeEvents()) {
      switch (e.type) {
        case Event::Ack: {
          const String id(e.commandId.c_str()); String reason(e.reason.c_str());
          if (e.status == "rejected" && !reason.length()) reason = "Recusado pelo controlador.";
          if (e.status == "completed" && !reason.length()) reason = "Tempo do comando concluido.";
          if (Known* k = findKnown(id)) { k->status = e.status.c_str(); k->reason = reason; }
          Serial.printf("[ACK] %s %s %s\n", id.c_str(), e.status.c_str(), reason.c_str());
          sendAck(id, e.status.c_str(), e.status == "accepted" ? String() : reason, 0);
          break;
        }
        case Event::CycleStarted: {
          CycleRec& r = cycles_[idx(e.pump)]; r = CycleRec{}; r.open = true; r.id = uuid4();
          r.commandId = e.commandId.c_str(); r.source = cycleSource(e.origin, r.commandId.length() > 0);
          if (r.source != "manual" && r.source != "test") r.commandId = "";
          r.reason = cycleReason(r.source.c_str(), e.pump); r.startedAt = nowIsoOrEmpty(); r.startMono = monoMs();
          r.t = c_.dhtReliable() ? c_.airT() : NAN; r.rh = c_.dhtReliable() ? c_.airRH() : NAN; r.soil = c_.soilReliable() ? c_.soilPct() : NAN;
          sendCycle(e.pump, r, false);
          break;
        }
        case Event::CycleFinished: {
          CycleRec& r = cycles_[idx(e.pump)]; if (!r.open) break;
          sendCycle(e.pump, r, true); r.open = false;
          break;
        }
        case Event::AlertOpened: {
          AlertRec a; a.coreEpisode = e.episodeId; a.id = uuid4(); a.code = e.code.c_str(); a.pump = e.hasPump ? idx(e.pump) : -1;
          a.severity = e.severity.c_str(); a.startedAt = nowIsoOrEmpty(); a.detail = String(e.reason.c_str()).substring(0, 256);
          alerts_.push_back(a); sendAlert(a, "opened", String());
          break;
        }
        case Event::AlertResolved:
          for (size_t i = 0; i < alerts_.size(); i++) if (alerts_[i].coreEpisode == e.episodeId) {
            sendAlert(alerts_[i], "resolved", nowIsoOrEmpty()); alerts_.erase(alerts_.begin() + i); break; }
          break;
        case Event::Transition: {
          const char* from = fsmWord(e.from); const char* to = fsmWord(e.to);
          if (!strcmp(from, to)) break;
          JsonDocument d; envelope(d, "event");
          d["eventType"] = "fsm_transition"; d["machine"] = e.machine == "irrigacao" ? "irrigation" : "fog";
          d["fromState"] = from; d["toState"] = to; d["reason"] = e.reason.size() ? e.reason.c_str() : "transicao";
          send(CH_EVENTS, d);
          break;
        }
        default: break;
      }
    }
  }
  void sendCycle(Pump p, const CycleRec& r, bool finished) {
    JsonDocument d; envelope(d, "event");
    d["eventType"] = "cycle"; d["phase"] = finished ? "finished" : "started"; d["cycleId"] = r.id; d["pumpId"] = pumpName(p);
    d["source"] = r.source; if (r.commandId.length()) d["commandId"] = r.commandId; else d["commandId"] = nullptr;
    d["reason"] = r.reason; setIsoOrNull(d["startedAt"], r.startedAt);
    measurementsFrom(d["measurementsBefore"].to<JsonObject>(), r.t, r.rh, r.soil);
    if (finished) {
      setIsoOrNull(d["endedAt"], nowIsoOrEmpty());
      d["elapsedSeconds"] = serialized(String((double)(monoMs() - r.startMono) / 1000.0, 3));
      measurements(d["measurementsAfter"].to<JsonObject>());
    } else { d["endedAt"] = nullptr; d["elapsedSeconds"] = nullptr; d["measurementsAfter"] = nullptr; }
    send(CH_EVENTS, d);
  }
  void alertFields(JsonObject o, const AlertRec& a) {
    o["episodeId"] = a.id; o["code"] = a.code; if (a.pump >= 0) o["pumpId"] = a.pump ? "B2" : "B1"; else o["pumpId"] = nullptr;
    o["severity"] = a.severity; setIsoOrNull(o["startedAt"], a.startedAt); o["detail"] = a.detail;
  }
  void sendAlert(const AlertRec& a, const char* phase, const String& endedAt) {
    JsonDocument d; envelope(d, "event");
    d["eventType"] = "alert"; d["phase"] = phase; alertFields(d.as<JsonObject>(), a); setIsoOrNull(d["endedAt"], endedAt);
    send(CH_EVENTS, d);
  }

  // ---------------------------------------------------------------- estado e telemetria
  void trackManualTimers() {
    for (Pump p : {Pump::B1, Pump::B2}) {
      const int i = idx(p); const Mode m = c_.mode(p);
      if (m != Mode::AUTO && (m != lastMode_[i] || c_.manualStartMs(p) != startMonoSeen_[i])) {
        // inicio registrado uma vez; fim = inicio + duracao exata (o validador confere o teto)
        startMonoSeen_[i] = c_.manualStartMs(p);
        const int64_t durS = (c_.manualEndMs(p) - c_.manualStartMs(p)) / 1000;
        manualStartSec_[i] = epochMs() / 1000; manualEndSec_[i] = manualStartSec_[i] + durS;
      }
      lastMode_[i] = m;
    }
  }
  int64_t startMonoSeen_[2] = {-1, -1};

  String stateSignature() {
    String s;
    for (Pump p : {Pump::B1, Pump::B2}) { s += modeName(c_.mode(p)); s += c_.pumpOn(p) ? '1' : '0'; s += pumpFsm(c_, p); const char* b = blockedReason(c_, p); if (b) s += b; s += '|'; }
    for (auto& a : alerts_) { s += a.id; s += ','; }
    s += cfgVersion_;
    return s;
  }
  void publishState(const String* syncId) {
    JsonDocument d; envelope(d, "state");
    if (syncId) d["syncId"] = *syncId; else d["syncId"] = nullptr;
    d["activeConfigVersion"] = cfgVersion_; d["firmwareVersion"] = s_.firmwareVersion; d["droppedMessages"] = dropped_;
    JsonObject pumps = d["pumps"].to<JsonObject>();
    const int64_t nowM = monoMs();
    for (Pump p : {Pump::B1, Pump::B2}) {
      const int i = idx(p); JsonObject b = pumps[pumpName(p)].to<JsonObject>();
      const Mode m = c_.mode(p);
      b["mode"] = modeName(m); b["isOn"] = c_.pumpOn(p); b["fsmState"] = pumpFsm(c_, p);
      if (m != Mode::AUTO && clockReliable_) {
        b["modeStartedAt"] = isoFromSec(manualStartSec_[i]); b["expiresAt"] = isoFromSec(manualEndSec_[i]);
        int64_t rem = (c_.manualEndMs(p) - nowM + 999) / 1000; const int64_t lim = manualEndSec_[i] - manualStartSec_[i];
        b["remainingSeconds"] = (int)std::max<int64_t>(0, std::min<int64_t>(rem, lim));
      } else { b["modeStartedAt"] = nullptr; b["expiresAt"] = nullptr; b["remainingSeconds"] = nullptr; }
      const char* br = blockedReason(c_, p); if (br) b["blockedReason"] = br; else b["blockedReason"] = nullptr;
      const char* fc = faultCode(c_, p); if (fc) b["faultCode"] = fc; else b["faultCode"] = nullptr;
      b["floatOverrideUntil"] = nullptr; b["feedback"] = "relay_output";
    }
    JsonArray act = d["activeAlerts"].to<JsonArray>();
    for (auto& a : alerts_) alertFields(act.add<JsonObject>(), a);
    send(CH_STATE, d);
    lastSig_ = stateSignature(); lastStateMs_ = millis();
  }
  void publishTelemetry() {
    JsonDocument d; envelope(d, "telemetry");
    const bool dht = c_.dhtReliable(), root = c_.rootReliable(), soil = c_.soilReliable() && calId_.length();
    if (dht) { setNum1(d["airTemperatureC"], c_.airT()); setNum1(d["airHumidityPercent"], c_.airRH()); }
    else { d["airTemperatureC"] = nullptr; d["airHumidityPercent"] = nullptr; }
    if (root) setNum1(d["substrateTemperatureC"], c_.rootT()); else d["substrateTemperatureC"] = nullptr;
    if (soil) setNum1(d["soilMoisturePercent"], c_.soilPct()); else d["soilMoisturePercent"] = nullptr;
    if (adcRaw_ >= 0 && adcRaw_ <= 4095) d["soilMoistureAdc"] = adcRaw_; else d["soilMoistureAdc"] = nullptr;
    d["waterLevel"] = c_.levelLow() ? "LOW" : "OK";
    d["dhtReliable"] = dht; d["soilReliable"] = soil; d["rootReliable"] = root;
    if (calId_.length()) d["activeCalibrationId"] = calId_; else d["activeCalibrationId"] = nullptr;
    send(CH_TELEMETRY, d);
    lastTelemetryMs_ = millis();
    lastTel_.dht = dht; lastTel_.root = root; lastTel_.soil = soil; lastTel_.low = c_.levelLow();
    lastTel_.t = dht ? c_.airT() : NAN; lastTel_.rh = dht ? c_.airRH() : NAN;
    lastTel_.rootT = root ? c_.rootT() : NAN; lastTel_.soilPct = soil ? c_.soilPct() : NAN;
  }
};

}  // namespace v1
