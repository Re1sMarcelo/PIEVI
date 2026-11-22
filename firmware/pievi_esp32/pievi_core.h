// PIEVI - nucleo de controle da horta (sem dependencia de Arduino: roda no ESP32 e no PC).
// Regras: guia do banco (limites e contrato) + tabelas de estados/falhas (comportamento).
// Tempo: nowMs e MONOTONICO em ms (int64, vem de esp_timer). epoch/clockReliable so vem do NTP.
//
// Origem: Documents/PIVI/firmware (nucleo com testes no PC). Ajustes para o contrato MQTT v1:
//  - agenda de reserva com ate 24 horarios; horario perdido nao e executado (tolerancia de 2 min);
//  - solo so e confiavel depois de uma calibracao explicita (setCalibration);
//  - forceAuto(): encerra modo manual (ex.: perda de hora confiavel);
//  - validacao alinhada a api/src/controlConfig.ts (o backend e a referencia das faixas).
// A traducao de nomes (estados, origens, IDs UUID) para o v1 fica em pievi_v1.h.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace pievi {

enum class Pump : uint8_t { B1 = 0, B2 = 1 };  // B1 = irrigacao (GPIO27/K2), B2 = nevoa (GPIO26/K1)
inline const char* pumpName(Pump p) { return p == Pump::B1 ? "B1" : "B2"; }
inline int idx(Pump p) { return static_cast<int>(p); }

enum class Mode : uint8_t { AUTO, MANUAL_ON, MANUAL_OFF };
inline const char* modeName(Mode m) { return m == Mode::AUTO ? "AUTO" : m == Mode::MANUAL_ON ? "MANUAL_ON" : "MANUAL_OFF"; }

// ------------------------------------------------------------------ configuracao
struct Slot { int minuteOfDay; int durationS; bool enabled; };

struct Config {
  int version = 1;
  float soloMin = 60, soloMax = 75;
  int irrigMaxS = 300, cooldownIrrigMin = 10, irrigMaxCiclosDia = 20;
  bool janelaAtiva = false; int janelaInicioMin = 6 * 60, janelaFimMin = 17 * 60;
  float tempNevoaOn = 28, histereseNevoa = 3, urMinNevoa = 50, urTravaNevoa = 90;
  int pulsoNevoaS = 60, pausaNevoaMin = 5;
  float tempEmergencia = 35, tempRaizAlerta = 26;
  bool bloquearSemAgua = true;
  int manualIrrigS = 120, manualNevoaS = 30;
  static constexpr int kMaxSlots = 24;
  Slot agenda[kMaxSlots] = {{7 * 60, 60, true}, {12 * 60, 60, true}, {16 * 60, 60, true}};
  int nAgenda = 3;

  // Faixas do GUIA DO BANCO (secao 9). Retorna false e o motivo se invalida.
  bool validate(std::string* why = nullptr) const {
    auto bad = [&](const char* m) { if (why) *why = m; return false; };
    if (version < 1) return bad("versao invalida");
    if (soloMin < 30 || soloMin > 80) return bad("solo_min fora de 30-80");
    if (soloMax < 50 || soloMax > 95) return bad("solo_max fora de 50-95");
    if (soloMax < soloMin + 5) return bad("solo_max deve ser >= solo_min + 5");
    if (irrigMaxS < 30 || irrigMaxS > 300) return bad("irrig_max_s fora de 30-300");
    if (cooldownIrrigMin < 5 || cooldownIrrigMin > 30) return bad("cooldown_irrig_min fora de 5-30");
    if (irrigMaxCiclosDia < 5 || irrigMaxCiclosDia > 40) return bad("irrig_max_ciclos_dia fora de 5-40");
    if (janelaAtiva && janelaInicioMin == janelaFimMin) return bad("janela com inicio igual ao fim");
    if (tempNevoaOn < 22 || tempNevoaOn > 40) return bad("temp_nevoa_on fora de 22-40");
    if (histereseNevoa < 1 || histereseNevoa > 6) return bad("histerese_nevoa fora de 1-6");
    if (urMinNevoa < 30 || urMinNevoa > 70) return bad("ur_min_nevoa fora de 30-70");
    if (urTravaNevoa < 80 || urTravaNevoa > 98) return bad("ur_trava_nevoa fora de 80-98");
    if (pulsoNevoaS < 10 || pulsoNevoaS > 60) return bad("pulso_nevoa_s fora de 10-60");
    if (pausaNevoaMin < 1 || pausaNevoaMin > 30) return bad("pausa_nevoa_min fora de 1-30");
    if (tempEmergencia < 30 || tempEmergencia > 45) return bad("temp_emergencia fora de 30-45");
    if (tempRaizAlerta < 20 || tempRaizAlerta > 35) return bad("temp_raiz_alerta fora de 20-35");
    if (!bloquearSemAgua) return bad("bloquear_bombas_sem_agua so aceita true");
    if (manualIrrigS < 10 || manualIrrigS > 300) return bad("manual_irrig_s fora de 10-300");
    if (manualNevoaS < 5 || manualNevoaS > 60) return bad("manual_nevoa_s fora de 5-60");
    if (nAgenda < 0 || nAgenda > kMaxSlots) return bad("agenda: no maximo 24 horarios");
    for (int i = 0; i < nAgenda; i++) {
      if (agenda[i].minuteOfDay < 0 || agenda[i].minuteOfDay >= 24 * 60) return bad("agenda: horario invalido");
      if (agenda[i].durationS < 1 || agenda[i].durationS > 300) return bad("agenda: duracao fora de 1-300 s");
      for (int j = 0; j < i; j++) if (agenda[j].minuteOfDay == agenda[i].minuteOfDay) return bad("agenda: horario duplicado");
    }
    return true;
  }
};

// ------------------------------------------------------------------ entradas / eventos
struct Inputs {
  int64_t nowMs = 0;
  int64_t epoch = 0;             // segundos UTC (so vale se clockReliable)
  bool clockReliable = false;
  // Uma amostra nova dos sensores (a cada ~2 s). Sem amostra, so o tempo avanca.
  bool hasSample = false;
  bool dhtOk = false;  float airT = NAN, airRH = NAN;
  bool dsOk = false;   float rootT = NAN;
  int soilAdc = -1;              // -1 = erro de leitura
  bool floatLow = true;          // true = boia indica nivel baixo OU circuito aberto (fail-safe)
};

enum class Origin : uint8_t { Auto, Manual, Fallback, Emergencia, Teste };
inline const char* originName(Origin o) {
  switch (o) { case Origin::Auto: return "auto"; case Origin::Manual: return "manual";
    case Origin::Fallback: return "fallback"; case Origin::Emergencia: return "emergencia"; default: return "teste"; }
}

struct Event {
  enum Type { CycleStarted, CycleFinished, AlertOpened, AlertResolved, Transition, Ack, StateChanged, Info, ConfigRejected } type;
  Pump pump = Pump::B1; bool hasPump = false;
  std::string cycleId, commandId, origin, code, severity, episodeId, machine, from, to, reason, status, description;
  float a = NAN, b = NAN, c = NAN;  // before/after: solo, temp, ur
};

enum class Action : uint8_t { ManualOn, ManualOff, Auto, Test, ResetFault, IgnoreFloat };
struct Command {
  std::string id; Pump pump = Pump::B1; Action action = Action::Auto;
  int durationS = 0;  // 0 = padrao
  int64_t createdAt = 0, expiresAt = 0;  // epoch s
  bool supervisionConfirmed = false;
};

// ------------------------------------------------------------------ estados
enum class IrrState : uint8_t { IDLE, IRRIGANDO, COOLDOWN, BLOQUEIO_AGUA, FALHA_IRRIG, SEM_SENSOR_SOLO };
enum class MistState : uint8_t { IDLE, NEBULIZANDO, PAUSA, EMERGENCIA_CALOR, BLOQUEIO_AGUA, FALHA_NEVOA, SEM_DHT };
inline const char* irrName(IrrState s) {
  static const char* n[] = {"IDLE", "IRRIGANDO", "COOLDOWN", "BLOQUEIO_AGUA", "FALHA_IRRIG", "SEM_SENSOR_SOLO"};
  return n[static_cast<int>(s)];
}
inline const char* mistName(MistState s) {
  static const char* n[] = {"IDLE", "NEBULIZANDO", "PAUSA", "EMERGENCIA_CALOR", "BLOQUEIO_AGUA", "FALHA_NEVOA", "SEM_DHT"};
  return n[static_cast<int>(s)];
}

constexpr int64_t S = 1000, MIN = 60 * S;

// Limites fisicos (nao dependem de configuracao nem de comando)
constexpr int B1_HARD_MAX_S = 300, B2_HARD_MAX_S = 60;
// Decisao: 15 min/h nas duas (o PDF cita 15 e 5 como EXEMPLO; 5 min/h cortaria a nevoa padrao: 60 s a cada 6 min = 10 min/h).
constexpr int64_t B1_DUTY_MAX_MS = 15 * MIN, B2_DUTY_MAX_MS = 15 * MIN;  // por hora
constexpr int64_t STAGGER_MS = 2 * S;

class Controller {
 public:
  explicit Controller(uint32_t bootId, int utcOffsetMin = -180) : boot_(bootId), utcOff_(utcOffsetMin) {
    for (auto& p : pumps_) p = PumpCtl{};
    for (auto& d : slotFiredDay_) d = -1;
  }
  /** Encerra o modo manual (se houver) e volta ao AUTO, com ACK completed do comando ativo. */
  void forceAuto(Pump p, const std::string& why) { endManual(p, why); pumps_[idx(p)].ignoreEnd = 0; changed_ = true; }
  bool calibrated() const { return calibrated_; }

  // ---- configuracao / calibracao
  bool setConfig(const Config& c) {
    std::string why;
    if (!c.validate(&why)) { Event e; e.type = Event::ConfigRejected; e.reason = why; ev_.push_back(e); openAlert("CONFIG_INVALIDA", "warning", nullptr, why); return false; }
    cfg_ = c; resolveAlert("CONFIG_INVALIDA", nullptr); changed_ = true; return true;
  }
  const Config& config() const { return cfg_; }
  bool setCalibration(int seco, int agua) {
    if (seco < 0 || seco > 4095 || agua < 0 || agua > 4095 || seco == agua) return false;
    adcSeco_ = seco; adcAgua_ = agua; calibrated_ = true; return true;
  }
  void clearCalibration() { calibrated_ = false; }
  /** Configuracao salva corrompida: usa padroes seguros e avisa (CONFIG_INVALIDA). */
  void reportConfigInvalid(const std::string& why) { openAlert("CONFIG_INVALIDA", "warning", nullptr, why); }
  /** Chamar uma vez apos o boot com o motivo do reset ("power-on", "brownout", "watchdog"...). */
  void reportReboot(const std::string& reason) { openAlert("REINICIO", "warning", nullptr, reason); rebootAlertAt_ = lastNow_ + 5 * MIN; rebootPending_ = true; }

  // ---- saidas / leituras
  bool pumpOn(Pump p) const { return pumps_[idx(p)].on; }
  Mode mode(Pump p) const { return pumps_[idx(p)].mode; }
  IrrState irrState() const { return irr_; }
  MistState mistState() const { return mist_; }
  const char* fsmName(Pump p) const {
    const auto& pc = pumps_[idx(p)];
    if (pc.mode != Mode::AUTO) return modeName(pc.mode);
    return p == Pump::B1 ? irrName(irr_) : mistName(mist_);
  }
  int64_t manualEndMs(Pump p) const { return pumps_[idx(p)].manualEnd; }
  int64_t manualStartMs(Pump p) const { return pumps_[idx(p)].manualStart; }
  bool levelLow() const { return levelLow_; }
  bool dhtReliable() const { return dhtOkNow_ && !dhtBad_; }
  bool rootReliable() const { return dsOkNow_ && !dsBad_; }
  bool soilReliable() const { return soilOkNow_; }
  float airT() const { return dhtOkNow_ ? airT_ : NAN; }
  float airRH() const { return dhtOkNow_ ? airRH_ : NAN; }
  float rootT() const { return rootReliable() ? rootT_ : NAN; }
  float soilPct() const { return soilOkNow_ ? soilPct_ : NAN; }
  int soilAdc() const { return soilOkNow_ ? soilAdcF_ : -1; }
  bool stateChanged() { bool c = changed_; changed_ = false; return c; }
  std::vector<Event> takeEvents() { std::vector<Event> o; o.swap(ev_); return o; }
  int cyclesToday() const { return cyclesToday_; }

  // =================================================================== tick
  void tick(const Inputs& in) {
    in_ = in; lastNow_ = in.nowMs;
    if (!started_) { started_ = true; bootMs_ = in.nowMs; startupHold(); }
    if (in.hasSample) processSamples();
    levelDebounce();
    dayRollover();
    clockWatch();
    controllerAlerts();
    handleManualTimers();
    irrigationFsm();
    mistFsm();
    decideAndGuard();
    if (rebootPending_ && lastNow_ >= rebootAlertAt_) { resolveAlert("REINICIO", nullptr); rebootPending_ = false; }
  }

  // =================================================================== comandos
  void handleCommand(const Command& c) {
    // Repetido: informa o resultado conhecido sem executar de novo.
    for (const auto& h : hist_) if (h.id == c.id) { ack(c.id, h.status, h.reason); return; }
    auto reject = [&](const std::string& why) { remember(c.id, "rejected", why); ack(c.id, "rejected", why); };
    if (!in_.clockReliable) return reject("hora nao confiavel: validade do comando nao pode ser comprovada");
    if (c.expiresAt <= c.createdAt) return reject("comando invalido: prazo anterior a criacao");
    if (in_.epoch > c.expiresAt) return reject("comando vencido");
    auto& pc = pumps_[idx(c.pump)];
    const bool b1 = c.pump == Pump::B1;
    const int cap = b1 ? B1_HARD_MAX_S : B2_HARD_MAX_S;

    switch (c.action) {
      case Action::Auto:
        endManual(c.pump, "voltar ao AUTO");
        remember(c.id, "accepted", ""); ack(c.id, "accepted", ""); remember(c.id, "completed", ""); ack(c.id, "completed", "");
        return;
      case Action::ResetFault:
        if (b1 && (irr_ == IrrState::FALHA_IRRIG || faultIrr_)) { faultIrr_ = false; irrFail_ = 0; resolveAlert("IRRIG_FALHA", &c.pump); if (irr_ == IrrState::FALHA_IRRIG) setIrr(IrrState::IDLE, "reset no app"); }
        if (!b1 && (mist_ == MistState::FALHA_NEVOA || faultMist_)) { faultMist_ = false; mistFail_ = 0; resolveAlert("NEVOA_FALHA", &c.pump); if (mist_ == MistState::FALHA_NEVOA) setMist(MistState::IDLE, "reset no app"); }
        remember(c.id, "accepted", ""); ack(c.id, "accepted", ""); remember(c.id, "completed", ""); ack(c.id, "completed", "");
        return;
      case Action::IgnoreFloat: {
        if (!c.supervisionConfirmed) return reject("ignorar boia exige confirmacao de supervisao");
        int d = c.durationS > 0 ? c.durationS : (b1 ? 120 : 60);
        if (d < 1 || d > (b1 ? 120 : 60)) return reject(b1 ? "duracao de ignorar boia: 1 a 120 s (B1)" : "duracao de ignorar boia: 1 a 60 s (B2)");
        for (auto& o : pumps_) if (&o != &pc && o.ignoreEnd > in_.nowMs) return reject("ignorar boia: so uma bomba por vez");
        pc.ignoreEnd = in_.nowMs + d * S; pc.ignoreCmd = c.id; changed_ = true;
        remember(c.id, "accepted", ""); ack(c.id, "accepted", "");
        return;
      }
      case Action::ManualOff: {
        int d = c.durationS > 0 ? c.durationS : 3600;
        if (d < 1 || d > 3600) return reject("duracao de manual_off: 1 a 3600 s");
        endManual(c.pump, "substituido por novo comando");
        startManual(pc, Mode::MANUAL_OFF, d, c.id, false);
        remember(c.id, "accepted", ""); ack(c.id, "accepted", "");
        return;
      }
      case Action::ManualOn:
      case Action::Test: {
        const bool test = c.action == Action::Test;
        int d = test ? 10 : (c.durationS > 0 ? c.durationS : (b1 ? cfg_.manualIrrigS : cfg_.manualNevoaS));
        if (test && c.durationS != 0 && c.durationS != 10) return reject("testar bomba: exatamente 10 s");
        if (d < 1 || d > cap) return reject(b1 ? "duracao maxima de B1: 300 s" : "duracao maxima de B2: 60 s");
        if (levelLow_ && !(pc.ignoreEnd > in_.nowMs)) return reject("nivel de agua baixo: bomba bloqueada");
        if (!b1 && !dhtReliable() && kDhtBlocksManual) return reject("DHT22 nao confiavel: B2 bloqueada");
        if (dutyMs(pc, b1) >= (b1 ? B1_DUTY_MAX_MS : B2_DUTY_MAX_MS)) return reject("limite de operacao por hora atingido");
        endManual(c.pump, "substituido por novo comando");
        startManual(pc, Mode::MANUAL_ON, d, c.id, test);
        remember(c.id, "accepted", ""); ack(c.id, "accepted", "");
        return;
      }
    }
  }

 private:
  static constexpr bool kDhtBlocksManual = true;  // guia, secao 12: DHT ruim bloqueia B2 em AUTO e manual

  struct PumpCtl {
    bool on = false; bool want = false; Origin origin = Origin::Auto;
    int64_t onSince = 0, lastStart = -1000000;
    Mode mode = Mode::AUTO; int64_t manualStart = 0, manualEnd = 0; std::string manualCmd; bool testRun = false;
    int64_t ignoreEnd = 0; std::string ignoreCmd;
    std::string cycleId, cycleCmd; bool cycleOpen = false; float soilBefore = NAN, tBefore = NAN, rhBefore = NAN;
    bool capLatched = false, dutyLatched = false;
    int64_t bucket[60] = {0}; int64_t bucketMin = -1;  // ms ligado por minuto (janela de 1 h)
  };
  struct Hist { std::string id, status, reason; };

  // --- estado
  uint32_t boot_; int utcOff_; Config cfg_;
  Inputs in_; int64_t lastNow_ = 0, bootMs_ = 0; bool started_ = false, changed_ = false;
  std::vector<Event> ev_; PumpCtl pumps_[2];
  std::vector<Hist> hist_;
  int adcSeco_ = 4095, adcAgua_ = 600;  // 4095 = seco; ~600 = em agua (HD-38). Calibrar!
  bool calibrated_ = false;             // sem calibracao explicita o solo nao e confiavel (contrato v1, secao 5)
  // sensores
  bool dhtOkNow_ = false, dhtBad_ = false; int dhtBadRun_ = 0, dhtGoodRun_ = 0; float airT_ = NAN, airRH_ = NAN; int64_t dhtLastValid_ = -1;
  bool dsOkNow_ = false, dsBad_ = false; int dsBadRun_ = 0, dsGoodRun_ = 0; float rootT_ = NAN;
  bool soilOkNow_ = false; float soilPct_ = NAN; int soilAdcF_ = -1; int adcRing_[5] = {-1, -1, -1, -1, -1}; int adcN_ = 0; int64_t soilLastValid_ = -1, soilInvalidSince_ = -1, soilValidSince_ = -1;
  // boia (fail-safe: comeca como "baixo")
  bool levelLow_ = true; int64_t rawLowSince_ = -1, rawOkSince_ = -1;
  // FSMs
  IrrState irr_ = IrrState::COOLDOWN; MistState mist_ = MistState::PAUSA;
  int64_t irrSince_ = 0, mistSince_ = 0, irrCooldownEnd_ = 0, mistPauseEnd_ = 0;
  bool faultIrr_ = false, faultMist_ = false; int irrFail_ = 0, mistFail_ = 0;
  bool irrEndedByTimeout_ = false; float irrSoilBefore_ = NAN; bool irrHadCycle_ = false;
  bool mistStartedHot_ = false; float mistT0_ = NAN, mistRH0_ = NAN;
  int cyclesToday_ = 0; int64_t dayKey_ = -1; int64_t fallbackEnd_ = 0; bool fallbackRunning_ = false; int slotFiredDay_[Config::kMaxSlots];
  int64_t emergPhaseStart_ = 0; bool emergOn_ = false;
  int64_t mistTestAt_ = 0; bool mistTesting_ = false; int64_t mistTestEvalAt_ = 0; float mistTestT0_ = NAN, mistTestRH0_ = NAN;
  float irrTestSoil0_ = NAN;
  // alertas
  struct Open { std::string code; int pump; std::string episode; };
  std::vector<Open> open_; uint32_t episodeSeq_ = 0, cycleSeq_ = 0;
  int64_t rhHighSince_ = -1, rhVeryHighSince_ = -1; bool urBlock_ = false;
  bool rebootPending_ = false; int64_t rebootAlertAt_ = 0;
  int64_t clockBadSince_ = -1;

  // ------------------------------------------------------------ utilidades
  static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
  void remember(const std::string& id, const std::string& st, const std::string& r) {
    for (auto& h : hist_) if (h.id == id) { h.status = st; h.reason = r; return; }
    hist_.push_back({id, st, r}); if (hist_.size() > 24) hist_.erase(hist_.begin());
  }
  void ack(const std::string& id, const std::string& st, const std::string& r) {
    Event e; e.type = Event::Ack; e.commandId = id; e.status = st; e.reason = r; ev_.push_back(e);
  }
  int64_t localDay() const { return in_.clockReliable ? (in_.epoch + utcOff_ * 60LL) / 86400 : -1; }
  int localMinute() const { return in_.clockReliable ? (int)(((in_.epoch + utcOff_ * 60LL) % 86400) / 60) : -1; }

  // ------------------------------------------------------------ alertas (episodios)
  std::string makeEpisode(const std::string& code) {
    std::string c = code; for (auto& ch : c) ch = (ch == '_') ? '-' : (char)tolower(ch);
    char b[96]; snprintf(b, sizeof b, "%s-boot%u-%04u", c.c_str(), (unsigned)boot_, (unsigned)++episodeSeq_); return b;
  }
  Open* findOpen(const std::string& code, int pump) { for (auto& o : open_) if (o.code == code && o.pump == pump) return &o; return nullptr; }
  void openAlert(const std::string& code, const char* sev, const Pump* p, const std::string& detail = "") {
    int pi = p ? idx(*p) : -1;
    if (findOpen(code, pi)) return;
    Open o{code, pi, makeEpisode(code)}; open_.push_back(o);
    Event e; e.type = Event::AlertOpened; e.code = code; e.severity = sev; e.episodeId = o.episode; e.reason = detail;
    if (p) { e.pump = *p; e.hasPump = true; } ev_.push_back(e);
  }
  void resolveAlert(const std::string& code, const Pump* p) {
    int pi = p ? idx(*p) : -1;
    for (size_t i = 0; i < open_.size(); i++) if (open_[i].code == code && open_[i].pump == pi) {
      Event e; e.type = Event::AlertResolved; e.code = code; e.episodeId = open_[i].episode; ev_.push_back(e);
      open_.erase(open_.begin() + i); return;
    }
  }
  bool alertOpen(const std::string& code, int pi = -1) { return findOpen(code, pi) != nullptr; }

  // ------------------------------------------------------------ sensores
  // Pausa apos o boot: 2 min (protege contra reinicios em sequencia) - o cooldown entre ciclos continua o da config.
  static constexpr int kBootHoldIrrigMin = 2;
  void startupHold() { irrCooldownEnd_ = in_.nowMs + kBootHoldIrrigMin * MIN; mistPauseEnd_ = in_.nowMs + cfg_.pausaNevoaMin * MIN; irrSince_ = mistSince_ = in_.nowMs; }

  void processSamples() {
    const int64_t now = in_.nowMs;
    // --- DHT22 (plausibilidade: T -10..60, UR 0..100, salto > 10 C em 2 s)
    bool ok = in_.dhtOk && std::isfinite(in_.airT) && std::isfinite(in_.airRH) && in_.airT >= -10 && in_.airT <= 60 && in_.airRH >= 0 && in_.airRH <= 100;
    if (ok && dhtLastValid_ >= 0 && now - dhtLastValid_ <= 2500 && std::fabs(in_.airT - airT_) > 10) ok = false;
    dhtOkNow_ = ok;
    if (ok) { airT_ = in_.airT; airRH_ = in_.airRH; dhtLastValid_ = now; dhtBadRun_ = 0; if (++dhtGoodRun_ >= 3) dhtBad_ = false; }
    else { dhtGoodRun_ = 0; if (++dhtBadRun_ >= 3) dhtBad_ = true; }
    // --- DS18B20 (-127 e 85 sao valores de falha)
    bool dok = in_.dsOk && std::isfinite(in_.rootT) && in_.rootT != -127.0f && in_.rootT != 85.0f && in_.rootT >= -10 && in_.rootT <= 60;
    dsOkNow_ = dok;
    if (dok) { rootT_ = in_.rootT; dsBadRun_ = 0; if (++dsGoodRun_ >= 3) dsBad_ = false; }
    else { dsGoodRun_ = 0; if (++dsBadRun_ >= 3) dsBad_ = true; }
    // --- solo: mediana de 5 amostras; 4095 e SECO (valido). Invalido: erro de leitura ou curto (<50).
    bool sok = calibrated_ && in_.soilAdc >= 50 && in_.soilAdc <= 4095;
    if (sok) {
      adcRing_[adcN_++ % 5] = in_.soilAdc;
      int tmp[5], n = std::min(adcN_, 5); for (int i = 0; i < n; i++) tmp[i] = adcRing_[i];
      std::sort(tmp, tmp + n); soilAdcF_ = tmp[n / 2];
      soilPct_ = clampf((float)(adcSeco_ - soilAdcF_) * 100.0f / (float)(adcSeco_ - adcAgua_), 0, 100);
      soilLastValid_ = now; if (soilValidSince_ < 0) soilValidSince_ = now; soilInvalidSince_ = -1;
    } else { if (soilInvalidSince_ < 0) soilInvalidSince_ = now; soilValidSince_ = -1; }
    soilOkNow_ = sok;
    // --- boia: valor bruto para o debounce
    if (in_.floatLow) { rawOkSince_ = -1; if (rawLowSince_ < 0) rawLowSince_ = now; }
    else { rawLowSince_ = -1; if (rawOkSince_ < 0) rawOkSince_ = now; }
    changed_ = true;
  }
  void levelDebounce() {  // 5 s para declarar baixo, 10 s para voltar a OK
    if (rawLowSince_ >= 0 && !levelLow_ && in_.nowMs - rawLowSince_ >= 5 * S) { levelLow_ = true; changed_ = true; }
    if (rawOkSince_ >= 0 && levelLow_ && in_.nowMs - rawOkSince_ >= 10 * S) { levelLow_ = false; changed_ = true; }
  }
  bool soilStale() const { return soilInvalidSince_ >= 0 && in_.nowMs - soilInvalidSince_ > 60 * S; }
  bool dhtStale() const { return dhtBad_ && (dhtLastValid_ < 0 || in_.nowMs - dhtLastValid_ > 60 * S); }
  bool dhtUsable() const { return dhtLastValid_ >= 0 && in_.nowMs - dhtLastValid_ <= 60 * S && !dhtBad_; }

  void dayRollover() {
    int64_t d = in_.clockReliable ? localDay() : (in_.nowMs - bootMs_) / (24 * 60 * MIN);
    if (dayKey_ != d) { dayKey_ = d; cyclesToday_ = 0; }
  }
  void clockWatch() {
    if (in_.clockReliable) { clockBadSince_ = -1; resolveAlert("HORA_INVALIDA", nullptr); return; }
    if (clockBadSince_ < 0) clockBadSince_ = in_.nowMs;
    if (in_.nowMs - clockBadSince_ > 2 * MIN) openAlert("HORA_INVALIDA", "warning", nullptr, "sem hora confiavel: fallback agendado suspenso");
  }

  // alertas que dependem so dos sensores
  void controllerAlerts() {
    const int64_t now = in_.nowMs;
    // nivel
    if (levelLow_ && rawLowSince_ >= 0 && now - rawLowSince_ >= 5 * S) openAlert("NIVEL_BAIXO", "critical", nullptr, "waterLevel=LOW");
    if (!levelLow_) resolveAlert("NIVEL_BAIXO", nullptr);
    // sensores
    if (dhtStale()) openAlert("DHT_FALHA", "critical", nullptr, "DHT22 sem leitura valida"); else if (!dhtBad_) resolveAlert("DHT_FALHA", nullptr);
    if (dsBad_) openAlert("DS18_FALHA", "warning", nullptr, "DS18B20 invalido"); else resolveAlert("DS18_FALHA", nullptr);
    if (soilStale()) openAlert("SOLO_FALHA", "critical", nullptr, "sensor de solo invalido"); else if (soilValidSince_ >= 0 && now - soilValidSince_ >= 2 * MIN) resolveAlert("SOLO_FALHA", nullptr);
    // temperatura do substrato (histerese 2 C)
    if (rootReliable()) {
      if (rootT_ > cfg_.tempRaizAlerta) openAlert("TEMP_RAIZ_ALTA", "warning", nullptr, "substrato acima do limite");
      else if (rootT_ < cfg_.tempRaizAlerta - 2) resolveAlert("TEMP_RAIZ_ALTA", nullptr);
    }
    // geada
    if (dhtUsable()) {
      if (airT_ < 5) openAlert("GEADA", "warning", nullptr, "T_ar abaixo de 5 C"); else if (airT_ >= 7) resolveAlert("GEADA", nullptr);
      // UR alta: >85% por 30 min = aviso; >=98% por 30 min = critico + B2 bloqueada
      if (airRH_ > 85) { if (rhHighSince_ < 0) rhHighSince_ = now; } else { rhHighSince_ = -1; }
      if (airRH_ >= 98) { if (rhVeryHighSince_ < 0) rhVeryHighSince_ = now; } else { rhVeryHighSince_ = -1; }
      urBlock_ = rhVeryHighSince_ >= 0 && now - rhVeryHighSince_ >= 30 * MIN;
      if (urBlock_) { resolveAlert("UR_ALTA", nullptr); openAlert("UR_ALTA", "critical", nullptr, "UR >= 98% por 30 min"); }
      else if (rhHighSince_ >= 0 && now - rhHighSince_ >= 30 * MIN) openAlert("UR_ALTA", "warning", nullptr, "UR > 85% por 30 min");
      else if (rhHighSince_ < 0) resolveAlert("UR_ALTA", nullptr);
    }
  }

  // ------------------------------------------------------------ manual
  void startManual(PumpCtl& pc, Mode m, int durS, const std::string& cmd, bool test) {
    pc.mode = m; pc.manualStart = in_.nowMs; pc.manualEnd = in_.nowMs + durS * S; pc.manualCmd = cmd; pc.testRun = test; changed_ = true;
    if (m == Mode::MANUAL_ON) { pc.cycleCmd = cmd; if (&pc == &pumps_[0]) irrTestSoil0_ = test ? soilPct_ : NAN; }
  }
  void endManual(Pump p, const std::string& why, bool completeAck = true) {
    auto& pc = pumps_[idx(p)];
    if (pc.mode == Mode::AUTO) return;
    const bool wasOn = pc.mode == Mode::MANUAL_ON, test = pc.testRun;
    pc.mode = Mode::AUTO; pc.testRun = false; changed_ = true;
    if (!pc.manualCmd.empty() && completeAck) { remember(pc.manualCmd, "completed", ""); ack(pc.manualCmd, "completed", why == "fim do tempo" ? "" : why); }
    pc.manualCmd.clear();
    // volta ao AUTO com espera, para a FSM nao agir logo apos o manual
    if (p == Pump::B1) {
      if (wasOn && test && irr_ == IrrState::FALHA_IRRIG && std::isfinite(irrTestSoil0_) && soilOkNow_ && soilPct_ - irrTestSoil0_ >= 2) { faultIrr_ = false; irrFail_ = 0; resolveAlert("IRRIG_FALHA", &p); setIrr(IrrState::COOLDOWN, "teste manual bem-sucedido"); irrCooldownEnd_ = in_.nowMs + cfg_.cooldownIrrigMin * MIN; }
      else if (irr_ != IrrState::FALHA_IRRIG && irr_ != IrrState::BLOQUEIO_AGUA) { setIrr(IrrState::COOLDOWN, "fim do modo manual"); irrCooldownEnd_ = in_.nowMs + (wasOn ? cfg_.cooldownIrrigMin * MIN : 0); }
    } else if (mist_ != MistState::FALHA_NEVOA && mist_ != MistState::BLOQUEIO_AGUA && mist_ != MistState::SEM_DHT) {
      setMist(MistState::PAUSA, "fim do modo manual"); mistPauseEnd_ = in_.nowMs + (wasOn ? cfg_.pausaNevoaMin * MIN : 0);
    }
  }
  void handleManualTimers() {
    for (int i = 0; i < 2; i++) {
      auto& pc = pumps_[i]; Pump p = static_cast<Pump>(i);
      if (pc.mode == Mode::MANUAL_ON && levelLow_ && !(pc.ignoreEnd > in_.nowMs)) endManual(p, "interrompido: nivel de agua baixo");
      else if (pc.mode != Mode::AUTO && in_.nowMs >= pc.manualEnd) endManual(p, "fim do tempo");
      if (pc.ignoreEnd && in_.nowMs >= pc.ignoreEnd) { pc.ignoreEnd = 0; if (!pc.ignoreCmd.empty()) { remember(pc.ignoreCmd, "completed", ""); ack(pc.ignoreCmd, "completed", ""); pc.ignoreCmd.clear(); } changed_ = true; }
    }
  }

  // ------------------------------------------------------------ transicoes
  void setIrr(IrrState n, const char* why) {
    if (n == irr_) return;
    Event e; e.type = Event::Transition; e.machine = "irrigacao"; e.from = irrName(irr_); e.to = irrName(n); e.reason = why; ev_.push_back(e);
    irr_ = n; irrSince_ = in_.nowMs; changed_ = true;
  }
  void setMist(MistState n, const char* why) {
    if (n == mist_) return;
    Event e; e.type = Event::Transition; e.machine = "nevoa"; e.from = mistName(mist_); e.to = mistName(n); e.reason = why; ev_.push_back(e);
    mist_ = n; mistSince_ = in_.nowMs; changed_ = true;
  }

  // ------------------------------------------------------------ FSM de irrigacao (B1)
  bool windowOk() const {
    if (!cfg_.janelaAtiva || !in_.clockReliable) return true;  // sem hora: irriga por umidade
    int m = localMinute(), a = cfg_.janelaInicioMin, b = cfg_.janelaFimMin;
    return a < b ? (m >= a && m < b) : (m >= a || m < b);
  }
  void irrigationFsm() {
    auto& pc = pumps_[0]; pc.want = false;
    const int64_t now = in_.nowMs;
    if (pc.mode != Mode::AUTO) return;  // manual tem prioridade; FSM em espera
    // bloqueio por falta de agua: qualquer estado
    if (levelLow_) {
      if (irr_ != IrrState::BLOQUEIO_AGUA) { if (irr_ == IrrState::FALHA_IRRIG) faultIrr_ = true; fallbackRunning_ = false; setIrr(IrrState::BLOQUEIO_AGUA, "nivel baixo"); }
      return;
    }
    if (irr_ == IrrState::BLOQUEIO_AGUA) {  // respeita o cooldown ainda pendente (inclui o do boot)
      setIrr(faultIrr_ ? IrrState::FALHA_IRRIG : (now < irrCooldownEnd_ ? IrrState::COOLDOWN : IrrState::IDLE), "nivel recuperado"); return; }
    // sensor de solo invalido ha > 60 s
    if (soilStale() && irr_ != IrrState::SEM_SENSOR_SOLO && irr_ != IrrState::FALHA_IRRIG) { setIrr(IrrState::SEM_SENSOR_SOLO, "solo invalido > 60 s"); fallbackRunning_ = false; return; }
    switch (irr_) {
      case IrrState::IDLE:
        if (soilOkNow_ && soilPct_ < cfg_.soloMin && cyclesToday_ < cfg_.irrigMaxCiclosDia && windowOk()) {
          irrSoilBefore_ = soilPct_; irrEndedByTimeout_ = false; irrHadCycle_ = true; cyclesToday_++;
          pc.origin = Origin::Auto; setIrr(IrrState::IRRIGANDO, "solo abaixo do minimo"); pc.want = true;
        }
        break;
      case IrrState::IRRIGANDO:
        if (soilOkNow_ && soilPct_ >= cfg_.soloMax) { irrEndedByTimeout_ = false; irrCooldownEnd_ = now + cfg_.cooldownIrrigMin * MIN; setIrr(IrrState::COOLDOWN, "solo atingiu o maximo"); }
        else if (now - irrSince_ >= cfg_.irrigMaxS * S) { irrEndedByTimeout_ = true; irrCooldownEnd_ = now + cfg_.cooldownIrrigMin * MIN; setIrr(IrrState::COOLDOWN, "tempo maximo do ciclo"); }
        else pc.want = true;
        break;
      case IrrState::COOLDOWN:
        if (now >= irrCooldownEnd_) {
          if (irrHadCycle_ && irrEndedByTimeout_ && std::isfinite(irrSoilBefore_) && soilOkNow_) {
            if (soilPct_ - irrSoilBefore_ <= 5) irrFail_++; else irrFail_ = 0;
            if (irrFail_ >= 3) { faultIrr_ = true; openAlert("IRRIG_FALHA", "critical", &pump_B1(), "3 ciclos sem efeito: checar bomba, mangueira, filtro, sensor"); setIrr(IrrState::FALHA_IRRIG, "3 ciclos sem efeito"); break; }
          } else if (irrHadCycle_ && !irrEndedByTimeout_) irrFail_ = 0;
          irrHadCycle_ = false; setIrr(IrrState::IDLE, "cooldown vencido");
        }
        break;
      case IrrState::FALHA_IRRIG: break;  // so sai por reset/teste
      case IrrState::SEM_SENSOR_SOLO: {
        if (soilValidSince_ >= 0 && now - soilValidSince_ >= 2 * MIN) { fallbackRunning_ = false; setIrr(IrrState::IDLE, "solo valido por 2 min"); break; }
        if (fallbackRunning_) { if (now < fallbackEnd_) pc.want = true; else { fallbackRunning_ = false; irrCooldownEnd_ = now; } pc.origin = Origin::Fallback; break; }
        if (!in_.clockReliable) break;  // sem hora: fallback suspenso (alerta HORA_INVALIDA)
        for (int i = 0; i < cfg_.nAgenda; i++) {
          const Slot& s = cfg_.agenda[i]; int m = localMinute();
          if (!s.enabled || slotFiredDay_[i] == (int)(localDay() % 100000)) continue;
          if (m >= s.minuteOfDay && m < s.minuteOfDay + 2 && cyclesToday_ < cfg_.irrigMaxCiclosDia) {  // horario perdido nao e executado
            slotFiredDay_[i] = (int)(localDay() % 100000); cyclesToday_++; fallbackRunning_ = true; fallbackEnd_ = now + s.durationS * S; pc.origin = Origin::Fallback; pc.want = true; break;
          }
        }
        break;
      }
      default: break;
    }
  }
  static const Pump& pump_B1() { static const Pump p = Pump::B1; return p; }
  static const Pump& pump_B2() { static const Pump p = Pump::B2; return p; }

  // ------------------------------------------------------------ FSM de nevoa (B2)
  bool mistEffect(float t0, float rh0) const { return (airRH_ - rh0 >= 3) || (t0 - airT_ >= 0.5f); }
  void mistFsm() {
    auto& pc = pumps_[1]; pc.want = false;
    const int64_t now = in_.nowMs;
    if (pc.mode != Mode::AUTO) return;
    if (levelLow_) {
      if (mist_ != MistState::BLOQUEIO_AGUA) { if (mist_ == MistState::FALHA_NEVOA) faultMist_ = true; mistTesting_ = false; setMist(MistState::BLOQUEIO_AGUA, "nivel baixo"); }
      return;
    }
    if (mist_ == MistState::BLOQUEIO_AGUA) {
      setMist(faultMist_ ? MistState::FALHA_NEVOA : (now < mistPauseEnd_ ? MistState::PAUSA : MistState::IDLE), "nivel recuperado"); return; }
    // DHT sem leitura ha > 60 s
    if (dhtStale()) { if (mist_ != MistState::SEM_DHT) { if (mist_ == MistState::FALHA_NEVOA) faultMist_ = true; mistTesting_ = false; setMist(MistState::SEM_DHT, "DHT22 invalido"); } return; }
    if (mist_ == MistState::SEM_DHT) { if (!dhtBad_) setMist(faultMist_ ? MistState::FALHA_NEVOA : (now < mistPauseEnd_ ? MistState::PAUSA : MistState::IDLE), "DHT22 recuperado"); return; }
    if (!dhtUsable()) { if (mist_ == MistState::NEBULIZANDO) pc.want = (now - mistSince_ < cfg_.pulsoNevoaS * S); return; }  // sem dado confiavel: nao inicia nada novo

    const float T = airT_, RH = airRH_;
    // emergencia de calor (nao em falha de bomba)
    if (mist_ != MistState::EMERGENCIA_CALOR && mist_ != MistState::FALHA_NEVOA && T > cfg_.tempEmergencia) {
      openAlert("CALOR_EMERG", "critical", nullptr, "T_ar acima de temp_emergencia");
      setMist(MistState::EMERGENCIA_CALOR, "T_ar > temp_emergencia"); emergPhaseStart_ = now; emergOn_ = false;
    }
    switch (mist_) {
      case MistState::IDLE:
        if ((T > cfg_.tempNevoaOn || RH < cfg_.urMinNevoa) && RH < cfg_.urTravaNevoa && !urBlock_) {
          mistStartedHot_ = T > cfg_.tempNevoaOn; mistT0_ = T; mistRH0_ = RH;
          pc.origin = Origin::Auto; setMist(MistState::NEBULIZANDO, T > cfg_.tempNevoaOn ? "T_ar alta" : "UR baixa"); pc.want = true;
        }
        break;
      case MistState::NEBULIZANDO: {
        const bool recovered = T <= cfg_.tempNevoaOn - cfg_.histereseNevoa && RH >= cfg_.urMinNevoa + 10;
        if (recovered || RH >= cfg_.urTravaNevoa || urBlock_ || now - mistSince_ >= cfg_.pulsoNevoaS * S) {
          mistPauseEnd_ = now + cfg_.pausaNevoaMin * MIN; setMist(MistState::PAUSA, recovered ? "T e UR recuperadas" : RH >= cfg_.urTravaNevoa ? "trava de UR" : "fim do pulso");
        } else pc.want = true;
        break;
      }
      case MistState::PAUSA:
        if (now >= mistPauseEnd_) {
          if (mistStartedHot_ && T > cfg_.tempNevoaOn) {  // avalia efeito do pulso anterior
            if (mistEffect(mistT0_, mistRH0_)) mistFail_ = 0; else mistFail_++;
            if (mistFail_ >= 3) { faultMist_ = true; openAlert("NEVOA_FALHA", "critical", &pump_B2(), "3 pulsos sem efeito"); setMist(MistState::FALHA_NEVOA, "3 pulsos sem efeito"); mistTestAt_ = now + 30 * MIN; mistStartedHot_ = false; break; }
          }
          mistStartedHot_ = false; setMist(MistState::IDLE, "pausa vencida");
        }
        break;
      case MistState::EMERGENCIA_CALOR:
        if (T < cfg_.tempEmergencia - 2) { resolveAlert("CALOR_EMERG", nullptr); mistPauseEnd_ = now + cfg_.pausaNevoaMin * MIN; setMist(MistState::PAUSA, "T_ar normalizada"); break; }
        if (RH >= 95) { emergOn_ = false; emergPhaseStart_ = now; break; }  // corte imediato
        if (emergOn_) { if (now - emergPhaseStart_ >= 30 * S) { emergOn_ = false; emergPhaseStart_ = now; } else { pc.want = true; pc.origin = Origin::Emergencia; } }
        else if (now - emergPhaseStart_ >= 2 * MIN || mistSince_ == emergPhaseStart_) { emergOn_ = true; emergPhaseStart_ = now; pc.want = true; pc.origin = Origin::Emergencia; }
        break;
      case MistState::FALHA_NEVOA:
        if (mistTesting_) {
          if (now - mistTestAt_ < 15 * S) { pc.want = true; pc.origin = Origin::Teste; }
          else if (now >= mistTestEvalAt_) {
            mistTesting_ = false;
            if (mistEffect(mistTestT0_, mistTestRH0_)) { faultMist_ = false; mistFail_ = 0; resolveAlert("NEVOA_FALHA", &pump_B2()); setMist(MistState::IDLE, "pulso de teste com efeito"); }
            else mistTestAt_ = now + 30 * MIN;
          }
        } else if (now >= mistTestAt_ && T > cfg_.tempNevoaOn && RH < cfg_.urTravaNevoa) {  // 1 pulso de teste a cada 30 min
          mistTesting_ = true; mistTestAt_ = now; mistTestEvalAt_ = now + 90 * S; mistTestT0_ = T; mistTestRH0_ = RH; pc.want = true; pc.origin = Origin::Teste;
        }
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------ guardas + saidas
  void accumulate(PumpCtl& pc, bool onNow, int64_t now) {
    int64_t m = now / MIN;
    if (pc.bucketMin < 0) pc.bucketMin = m;
    while (pc.bucketMin < m) { pc.bucketMin++; pc.bucket[pc.bucketMin % 60] = 0; }
    static thread_local int64_t dummy; (void)dummy;
    if (onNow) pc.bucket[m % 60] += std::min<int64_t>(now - lastAcc_, 1000);
  }
  int64_t dutyMs(const PumpCtl& pc, bool) const { int64_t s = 0; for (int i = 0; i < 60; i++) s += pc.bucket[i]; return s; }
  int64_t lastAcc_ = 0;

  void decideAndGuard() {
    const int64_t now = in_.nowMs;
    for (int i = 0; i < 2; i++) {
      auto& pc = pumps_[i]; Pump p = static_cast<Pump>(i); const bool b1 = i == 0;
      bool want = pc.want; Origin org = pc.origin; std::string cmd;
      if (pc.mode == Mode::MANUAL_ON) { want = true; org = pc.testRun ? Origin::Teste : Origin::Manual; cmd = pc.manualCmd; }
      else if (pc.mode == Mode::MANUAL_OFF) want = false;
      if (!want) { pc.capLatched = false; }
      // agua (inclui manual, exceto "ignorar boia")
      const bool ignore = pc.ignoreEnd > now;
      if (levelLow_ && !ignore) want = false;
      // DHT ruim: nao inicia B2 (guia, secao 12)
      if (!b1 && !pc.on && !dhtReliable() && (pc.mode == Mode::MANUAL_ON ? kDhtBlocksManual : true) && want) want = false;
      // teto fisico continuo
      if (pc.on && now - pc.onSince >= (b1 ? B1_HARD_MAX_S : B2_HARD_MAX_S) * S) { pc.capLatched = true; openAlert("BOMBA_TEMPO_EXCEDIDO", "warning", &p, "limite de tempo continuo"); }
      if (pc.capLatched) want = false;
      // duty cycle por hora
      accumulate(pc, pc.on, now);
      const int64_t duty = dutyMs(pc, b1), lim = b1 ? B1_DUTY_MAX_MS : B2_DUTY_MAX_MS;
      if (duty >= lim) { pc.dutyLatched = true; openAlert("BOMBA_TEMPO_EXCEDIDO", "warning", &p, "limite por hora"); }
      else if (duty < lim * 9 / 10) { pc.dutyLatched = false; }
      if (pc.dutyLatched) want = false;
      if (!pc.capLatched && !pc.dutyLatched && !pc.on) resolveAlert("BOMBA_TEMPO_EXCEDIDO", &p);
      // partida escalonada de 2 s entre as bombas
      if (want && !pc.on) { const auto& o = pumps_[1 - i]; if (now - o.lastStart < STAGGER_MS) want = false; }
      if (want && !pc.on) {
        pc.on = true; pc.onSince = now; pc.lastStart = now; pc.cycleOpen = true; pc.cycleCmd = cmd;
        char b[64]; snprintf(b, sizeof b, "ciclo-boot%u-%04u", (unsigned)boot_, (unsigned)++cycleSeq_); pc.cycleId = b;
        pc.soilBefore = soilPct_; pc.tBefore = airT_; pc.rhBefore = airRH_;
        Event e; e.type = Event::CycleStarted; e.pump = p; e.hasPump = true; e.cycleId = pc.cycleId; e.origin = originName(org); e.commandId = cmd;
        e.a = soilOkNow_ ? soilPct_ : NAN; e.b = dhtOkNow_ ? airT_ : NAN; e.c = dhtOkNow_ ? airRH_ : NAN; ev_.push_back(e); changed_ = true;
      } else if (!want && pc.on) {
        pc.on = false; changed_ = true;
        Event e; e.type = Event::CycleFinished; e.pump = p; e.hasPump = true; e.cycleId = pc.cycleId;
        e.a = soilOkNow_ ? soilPct_ : NAN; e.b = dhtOkNow_ ? airT_ : NAN; e.c = dhtOkNow_ ? airRH_ : NAN; ev_.push_back(e); pc.cycleOpen = false;
      }
    }
    lastAcc_ = now;
  }
};

}  // namespace pievi
