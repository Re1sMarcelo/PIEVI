// Conversao ISO 8601 UTC <-> epoch, sem depender de timegm()/strptime() (nao confiaveis no ESP32).
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>

namespace pievi {

// Dias desde 1970-01-01 (algoritmo de Howard Hinnant, dominio publico).
inline int64_t daysFromCivil(int64_t y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = static_cast<unsigned>(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + static_cast<int64_t>(doe) - 719468;
}

/** "2026-11-03T15:00:10Z" ou "...10.000Z" -> epoch (s). Retorna -1 se o formato for invalido. */
inline int64_t isoToEpoch(const char* s) {
  if (!s) return -1;
  int Y, M, D, h, m, sec;
  if (sscanf(s, "%4d-%2d-%2dT%2d:%2d:%2d", &Y, &M, &D, &h, &m, &sec) != 6) return -1;
  if (M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || m > 59 || sec > 60) return -1;
  return daysFromCivil(Y, M, D) * 86400 + h * 3600 + m * 60 + sec;
}

/** epoch (s) -> "2026-11-03T15:00:10Z". */
inline std::string epochToIso(int64_t t) {
  int64_t z = t / 86400 + 719468; int64_t secs = t % 86400; if (secs < 0) { secs += 86400; z -= 1; }
  const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = static_cast<unsigned>(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const int64_t y = static_cast<int64_t>(yoe) + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  const unsigned d = doy - (153 * mp + 2) / 5 + 1;
  const unsigned m = mp < 10 ? mp + 3 : mp - 9;
  char b[32]; snprintf(b, sizeof b, "%04d-%02u-%02uT%02d:%02d:%02dZ", (int)(y + (m <= 2)), m, d, (int)(secs / 3600), (int)(secs % 3600 / 60), (int)(secs % 60));
  return b;
}

}  // namespace pievi
