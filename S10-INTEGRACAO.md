# Integração real do S10 / ESP32

O backend já possui um endpoint de ingestão para o hardware. O S10 deve **enviar** cada leitura para o servidor; o navegador apenas consulta as últimas leituras salvas.

## Endpoint do hardware

`POST /api/s10/ingest`

Cabeçalho obrigatório:

`x-s10-key: <mesma chave definida em S10_DEVICE_KEY>`

JSON mínimo:

```json
{
  "sensor": "S10-01",
  "sala": "Bili",
  "db": 63.4,
  "timestamp": "2026-08-19T20:00:00.000Z",
  "deviceId": "esp32-s10-01"
}
```

Também aceita uma lista ou `{ "data": [...] }`.

## Consulta do painel

O painel usa:

`GET /api/s10/latest`

com o token JWT do usuário. O servidor filtra o que o aluno pode enxergar.

## Status

`GET /api/s10/status`

Considera um S10 online quando recebeu leitura nos últimos 90 segundos.

## Regras importantes

- O hardware não pode marcar a leitura como simulada; o servidor força `simulated=false`.
- `db` precisa ser um número entre 0 e 200.
- Leituras silenciosas não criam alertas.
- Moderado e crítico geram alerta com anti-spam de 5 minutos por sensor e nível.
- O ranking do Desafio das Salas usa somente leituras reais (`simulated=false`) dos S10.
- O servidor grava sensor, sala, dB, status e horário no PostgreSQL/Neon.

## O que ainda depende do hardware

O projeto não inventa a fórmula de dB do sensor. A função que converte o sinal elétrico/acústico do S10 em dB precisa seguir o modelo exato do sensor, microfone, ADC e circuito usados pela escola. Sem essa especificação/calibração física, não é seguro afirmar que um número recebido do hardware representa dB SPL real.
