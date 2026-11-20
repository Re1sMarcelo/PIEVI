// Copie para "secrets.h" (mesma pasta) e preencha, ou gere com firmware/tools/gerar-secrets.ps1.
// "secrets.h" NAO vai para o Git (.gitignore). Nao cole este arquivo preenchido em conversas ou issues.
#pragma once

#define WIFI_SSID        "nome-da-rede-2.4GHz"
#define WIFI_PASSWORD    "senha-do-wifi"

#define DEVICE_ID        "bancada-01"
#define MQTT_CLIENT_ID   "pievi-esp-bancada-01"
#define MQTT_USERNAME    "bancada-01"
#define MQTT_PASSWORD    "valor de MQTT_ESP_PASSWORD em .env.physical"

// Broker local do notebook (npm.cmd run physical:up): IPv4 real do notebook (LAN_IP) e MQTT_PORT.
#define MQTT_URI         "mqtt://192.168.0.10:1883"

// EMQX Cloud (quando a ACL dos topicos pievi/v1 estiver criada):
//   #define MQTT_URI "mqtts://SEU-HOST.emqxcloud.com:8883"
// Sem MQTT_CA_CERT, o TLS e validado pelo pacote de certificados do ESP-IDF. Para fixar o CA do EMQX:
//   #define MQTT_CA_CERT "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
