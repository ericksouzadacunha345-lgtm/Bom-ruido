# Bom Ruído — Desafio das Salas

Versão com autenticação remota, PostgreSQL/Neon e competição entre salas.

## Perfis
- Administrativo/Professor: acesso completo e configuração do desafio.
- Aluno: Painel/S10 e Desafio das Salas.

## Desafio das Salas
- Ranking calculado no servidor a partir das leituras do período.
- Pontos por minuto seguro.
- Penalidade para moderado e crítico.
- Bônus por sequência segura.
- Intervalos sem leitura não pontuam.
- Desempate por tempo seguro e depois maior sequência.
- Administrador configura período, pontuação e premiações.

## Banco
Use PostgreSQL remoto (ex.: Neon). O servidor executa `schema.sql` na inicialização e cria `challenge_configs` automaticamente.

## Configuração
1. `npm install`
2. Crie `.env` a partir de `.env.example`.
3. Defina `DATABASE_URL` e `JWT_SECRET`.
4. Opcionalmente defina `ADMIN_INVITE_CODE` para proteger o cadastro administrativo.
5. `node server.js`
6. Abra `http://localhost:3000`.

Para acesso por celular/fora da rede local, publique o servidor Node.js em um serviço de hospedagem. O PostgreSQL continua remoto.


## Iniciar sem ficar digitando comandos

No Windows, mantenha o arquivo `.env` nesta pasta e dê duplo clique em **Iniciar Bom Ruido.bat**. Ele verifica o Node.js, instala as dependências se necessário, abre `http://localhost:3000` e inicia o servidor.

## Perfis
- **Aluno:** Painel com S10/Bili e Desafio das Salas.
- **Administrativo/Professor:** acesso completo e configuração do desafio.

## Banco remoto
O PostgreSQL/Neon é a fonte principal dos dados. O cache do navegador é apenas auxiliar.

## Alertas
Leituras silenciosas não criam alertas. Alertas moderados/críticos têm um intervalo de 5 minutos por sensor e nível para evitar spam.

## Celular
A interface foi preparada para telas pequenas. Para acessar pelo celular fora do computador local, o servidor Node também precisa ser publicado em um serviço de hospedagem; o banco Neon já pode permanecer remoto.

## S10 real / ESP32

O backend recebe leituras reais em `POST /api/s10/ingest` com o cabeçalho `x-s10-key`. O painel consulta `GET /api/s10/latest` e o status em `GET /api/s10/status`.

Consulte `S10-INTEGRACAO.md` para o contrato JSON e `s10-example.ino` para um exemplo de cliente ESP32. A fórmula de dB é específica do hardware e precisa ser calibrada de acordo com o sensor físico instalado.


## Microfone omnidirecional USB — pronto para conexão

O site está preparado para usar um microfone de mesa USB como fonte de medições:
1. Conecte o microfone ao computador.
2. Entre em Configurações → Fonte de Dados.
3. Escolha “Microfone do Computador”.
4. Selecione o dispositivo e a sala.
5. Clique em “Ativar microfone”.
6. Faça a calibração somente quando houver um equipamento de referência no mesmo local.

Sem calibração, a leitura é uma estimativa baseada em dBFS e não deve ser apresentada como dB SPL absoluto. Quando calibrado, o offset é salvo no banco e aplicado às leituras.

A competição usa medições reais (não simuladas), inclusive as provenientes do microfone.
