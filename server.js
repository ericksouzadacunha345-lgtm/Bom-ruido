require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const SCHOOL_ID = process.env.SCHOOL_ID || 'escola-principal';
const SCHOOL_NAME = process.env.SCHOOL_NAME || 'Minha Escola';
const ADMIN_INVITE_CODE = String(process.env.ADMIN_INVITE_CODE || '');
if (!DATABASE_URL || !JWT_SECRET) {
  console.error('Defina DATABASE_URL e JWT_SECRET antes de iniciar.');
  process.exit(1);
}
function normalizeDatabaseUrl(value) {
  try {
    const u = new URL(value);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    return u.toString();
  } catch { return value; }
}
const pool = new Pool({ connectionString: normalizeDatabaseUrl(DATABASE_URL), ssl: { rejectUnauthorized: false }, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });

const id = () => crypto.randomUUID();
const clean = (v, max = 120) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const email = v => clean(v, 160).toLowerCase();
const roleToCargo = role => role === 'admin' ? 'Administrativo' : 'Aluno';
const cargoToRole = cargo => ['Administrativo','Administrador'].includes(cargo) ? 'admin' : 'student';
const thresholds = cfg => ({ moderate: Number(cfg?.moderate ?? 55), critical: Number(cfg?.critical ?? 70), tea: Number(cfg?.tea ?? 50) });
const statusFromDb = (db, cfg) => db < cfg.moderate ? 'Silencioso' : db < cfg.critical ? 'Moderado' : 'Crítico';

async function q(text, params = []) { return pool.query(text, params); }

function challengeDefaults() {
  return {
    title: 'Desafio das Salas',
    startAt: new Date().toISOString(),
    endAt: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
    safePoints: 1,
    moderatePenalty: 0.5,
    criticalPenalty: 2,
    streakBonus: 10,
    prizes: ['Prêmio principal','Prêmio secundário','Menção de destaque']
  };
}
function challengeStatus(db, cfg) {
  if (db < Number(cfg.moderate ?? 55)) return 'safe';
  if (db < Number(cfg.critical ?? 70)) return 'moderate';
  return 'critical';
}
function computeChallengeLeaderboard(rows, cfg) {
  const byRoom = new Map();
  for (const r of rows) {
    const room = String(r.room || 'Sem sala');
    if (!byRoom.has(room)) byRoom.set(room, {room, points:0, safeMinutes:0, moderateMinutes:0, criticalMinutes:0, totalMinutes:0, wakes:0, streakMinutes:0, currentStreak:0});
  }
  const grouped = new Map();
  for (const r of rows) {
    const room = String(r.room || 'Sem sala');
    if (!grouped.has(room)) grouped.set(room, []);
    grouped.get(room).push(r);
  }
  const safePts=Number(cfg.safePoints ?? 1), modPen=Number(cfg.moderatePenalty ?? .5), critPen=Number(cfg.criticalPenalty ?? 2), streakBonus=Number(cfg.streakBonus ?? 10);
  for (const [room, list] of grouped) {
    list.sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
    const score=byRoom.get(room);
    let last=null, lastStatus=null, streakSeconds=0;
    for (const r of list) {
      const t=new Date(r.timestamp).getTime(); if(!Number.isFinite(t)) continue;
      if(last!==null){
        const seconds=Math.max(0,Math.min(60,(t-last)/1000));
        const minutes=seconds/60; const st=challengeStatus(Number(r.db),cfg);
        score.totalMinutes += minutes;
        if(st==='safe'){score.safeMinutes+=minutes;score.points+=minutes*safePts;streakSeconds+=seconds;}
        else if(st==='moderate'){score.moderateMinutes+=minutes;score.points-=minutes*modPen;streakSeconds=0;if(lastStatus==='safe')score.wakes+=1;}
        else {score.criticalMinutes+=minutes;score.points-=minutes*critPen;streakSeconds=0;if(lastStatus!=='critical')score.wakes+=1;}
        score.streakMinutes=Math.max(score.streakMinutes,streakSeconds/60);
        const bonusBlocks=Math.floor(score.streakMinutes/10);
        score._bonusBlocks=Math.max(score._bonusBlocks||0,bonusBlocks);
        lastStatus=st;
      } else {
        lastStatus=challengeStatus(Number(r.db),cfg);
      }
      last=t;
    }
    score.points += (score._bonusBlocks||0)*streakBonus;
    delete score._bonusBlocks;
    score.safePercent=score.totalMinutes>0?(score.safeMinutes/score.totalMinutes)*100:0;
    score.points=Math.max(0,score.points);
  }
  return [...byRoom.values()].sort((a,b)=>b.points-a.points||b.safeMinutes-a.safeMinutes||b.streakMinutes-a.streakMinutes||a.wakes-b.wakes).map((r,i)=>({...r,rank:i+1,points:Number(r.points.toFixed(2)),safeMinutes:Number(r.safeMinutes.toFixed(2)),moderateMinutes:Number(r.moderateMinutes.toFixed(2)),criticalMinutes:Number(r.criticalMinutes.toFixed(2)),totalMinutes:Number(r.totalMinutes.toFixed(2)),safePercent:Number(r.safePercent.toFixed(2)),streakMinutes:Number(r.streakMinutes.toFixed(2))}));
}

async function initDb() {
  const fs = require('fs');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await q(schema);
}
function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Sessão não iniciada.' });
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Sessão expirada.' }); }
}
const adminOnly = (req,res,next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Acesso permitido somente ao administrativo/professor.' });
const deviceKey = String(process.env.S10_DEVICE_KEY || '').trim();
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function requireS10Key(req, res, next) {
  if (!deviceKey) return res.status(503).json({ error: 'S10_DEVICE_KEY não configurada no servidor.' });
  const supplied = req.get('x-s10-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!safeEqual(supplied, deviceKey)) return res.status(401).json({ error: 'Chave do S10 inválida.' });
  req.deviceAuth = true;
  req.user = { id: 's10-device', role: 'admin', schoolId: SCHOOL_ID, email: 's10-device' };
  next();
}
function deviceOrUserAuth(req,res,next) {
  if (deviceKey && (req.get('x-s10-key') || '').trim()) return requireS10Key(req,res,next);
  return auth(req,res,next);
}

app.get('/api/health', async (_req,res) => { try { await q('SELECT 1'); res.json({ok:true,remote:true,service:'Bom Ruido',version:'4.1'}); } catch (e) { res.status(503).json({ok:false,remote:false}); } });

app.post('/api/auth/register', async (req,res) => {
  try {
    const name = clean(req.body.nome,80), mail = email(req.body.email), senha = String(req.body.senha || ''), role = req.body.role === 'admin' ? 'admin' : 'student';
    const adminCode = String(req.body.adminCode || '');
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(mail) || senha.length < 8) return res.status(400).json({error:'Dados de cadastro inválidos.'});
    if (role === 'admin' && (!ADMIN_INVITE_CODE || adminCode !== ADMIN_INVITE_CODE)) return res.status(403).json({error:'Código de acesso administrativo inválido.'});
    const exists = await q('SELECT id FROM users WHERE email=$1',[mail]);
    if (exists.rowCount) return res.status(409).json({error:'Este e-mail já está cadastrado.'});
    const hash = await bcrypt.hash(senha, 12);
    await q('INSERT INTO users(id,name,email,password_hash,role,school_id) VALUES($1,$2,$3,$4,$5,$6)',[id(),name,mail,hash,role,SCHOOL_ID]);
    res.json({ok:true});
  } catch (e) { console.error(e); res.status(500).json({error:'Não foi possível criar a conta.'}); }
});

app.post('/api/auth/login', async (req,res) => {
  try {
    const mail=email(req.body.email), senha=String(req.body.senha||'');
    const r=await q('SELECT * FROM users WHERE email=$1 AND active=true',[mail]);
    if (!r.rowCount || !(await bcrypt.compare(senha,r.rows[0].password_hash))) return res.status(401).json({error:'Login inválido. E-mail ou senha incorretos.'});
    const u=r.rows[0]; await q('UPDATE users SET last_login_at=NOW() WHERE id=$1',[u.id]);
    const token=jwt.sign({id:u.id,role:u.role,schoolId:u.school_id,email:u.email},JWT_SECRET,{expiresIn:'12h'});
    res.json({token,user:{id:u.id,nome:u.name,email:u.email,cargo:roleToCargo(u.role),role:u.role,escolaId:u.school_id}});
  } catch(e){console.error(e);res.status(500).json({error:'Erro ao validar o login.'});}
});
app.get('/api/auth/me',auth,async(req,res)=>{ const r=await q('SELECT id,name,email,role,school_id FROM users WHERE id=$1 AND active=true',[req.user.id]); if(!r.rowCount)return res.status(401).json({error:'Sessão expirada.'}); const u=r.rows[0]; res.json({user:{id:u.id,nome:u.name,email:u.email,cargo:roleToCargo(u.role),role:u.role,escolaId:u.school_id}}); });
app.post('/api/auth/logout',auth,(_req,res)=>res.json({ok:true}));

function studentScope(sql, params, user) {
  // Aluno recebe somente S10 e a Sala Bili. O filtro é aplicado no servidor, não apenas na interface.
  if (user.role !== 'student') return {sql,params};
  return {sql: `${sql} AND (LOWER(r.name)='bili' OR UPPER(COALESCE(s.identifier,''))='S10')`, params};
}

app.get('/api/bootstrap',auth,async(req,res)=>{
  try {
    const cfgR=await q('SELECT value FROM school_configs WHERE school_id=$1',[req.user.schoolId]);
    const config=cfgR.rowCount?cfgR.rows[0].value:{};
    let roomsR=await q('SELECT id,name,current_db,online,manual_offline,last_reading_at FROM rooms WHERE school_id=$1 ORDER BY name',[req.user.schoolId]);
    let rooms=roomsR.rows.map(r=>({id:r.id,nome:r.name,nivel_atual:Number(r.current_db ?? 0),online:r.online,manual_offline:r.manual_offline,ultima_medicao_em:r.last_reading_at}));
    const sensorsR=await q('SELECT s.id,s.identifier,s.room_id,s.online,s.last_seen,s.device_id,r.name room_name FROM sensors s LEFT JOIN rooms r ON r.id=s.room_id WHERE s.school_id=$1 ORDER BY s.identifier',[req.user.schoolId]);
    let sensors=sensorsR.rows.map(s=>({id:s.id,identificador:s.identifier,salaId:s.room_id,sala_nome:s.room_name,online:s.online,ultima_leitura_em:s.last_seen,dispositivo_id:s.device_id}));
    let readingsR=await q('SELECT id,sensor,room,db,status,timestamp,simulated FROM readings WHERE school_id=$1 ORDER BY timestamp DESC LIMIT 2000',[req.user.schoolId]);
    let readings=readingsR.rows.map(r=>({id:r.id,sensor:r.sensor,sala:r.room,nivel_db:Number(r.db),status:r.status,data_hora:r.timestamp,simulada:r.simulated}));
    let alertsR=await q("SELECT id,sensor,room,db,type,message,timestamp FROM alerts WHERE school_id=$1 ORDER BY timestamp DESC LIMIT 1000",[req.user.schoolId]);
    let alerts=alertsR.rows.map(a=>({id:a.id,sensor:a.sensor,sala:a.room,nivel_db:Number(a.db),tipo:a.type,mensagem:a.message,data_hora:a.timestamp}));
    if(req.user.role==='student'){
      const allowedRoomIds=new Set(rooms.filter(r=>r.nome.trim().toLowerCase()==='bili').map(r=>r.id));
      const allowedSensorIds=new Set(sensors.filter(s=>String(s.identificador).toUpperCase()==='S10').map(s=>s.id));
      const allowedNames=new Set(sensors.filter(s=>allowedSensorIds.has(s.id)).map(s=>String(s.sala_nome||'').toLowerCase()));
      rooms=rooms.filter(r=>r.nome.trim().toLowerCase()==='bili' || allowedNames.has(r.nome.trim().toLowerCase()));
      sensors=sensors.filter(s=>String(s.identificador).toUpperCase()==='S10' || allowedRoomIds.has(s.salaId));
      readings=readings.filter(r=>String(r.sensor).toUpperCase()==='S10' || r.sala.trim().toLowerCase()==='bili');
      alerts=alerts.filter(a=>a.tipo!=='normal' && (String(a.sensor).toUpperCase()==='S10' || a.sala.trim().toLowerCase()==='bili'));
    } else alerts=alerts.filter(a=>a.tipo!=='normal');
    res.json({escola:{id:req.user.schoolId,nome:SCHOOL_NAME},salas:rooms,sensores:sensors,medicoes:readings,alertas:alerts,config});
  } catch(e){console.error(e);res.status(500).json({error:'Não foi possível carregar os dados.'});}
});


app.get('/api/desafio', auth, async (req,res) => {
  try {
    const c=await q('SELECT value FROM challenge_configs WHERE school_id=$1',[req.user.schoolId]);
    const schoolCfgR=await q('SELECT value FROM school_configs WHERE school_id=$1',[req.user.schoolId]);
    const config=c.rowCount ? c.rows[0].value : challengeDefaults();
    const alertCfg=thresholds(schoolCfgR.rowCount ? schoolCfgR.rows[0].value : {});
    const scoringCfg={...config, moderate:alertCfg.moderate, critical:alertCfg.critical};
    const start=new Date(config.startAt), end=new Date(config.endAt);
    const r=await q("SELECT room,db,timestamp FROM readings WHERE school_id=$1 AND simulated=false AND timestamp >= $2 AND timestamp <= $3 ORDER BY room,timestamp",[req.user.schoolId,start,end]);
    const leaderboard=computeChallengeLeaderboard(r.rows,scoringCfg);
    res.json({config,leaderboard});
  } catch(e){ console.error(e); res.status(500).json({error:'Não foi possível carregar o desafio.'}); }
});
app.put('/api/desafio', auth, adminOnly, async (req,res) => {
  try {
    const body=req.body||{}; const start=new Date(body.startAt), end=new Date(body.endAt);
    if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start) return res.status(400).json({error:'Período do desafio inválido.'});
    const config={
      title:clean(body.title||'Desafio das Salas',80), startAt:start.toISOString(), endAt:end.toISOString(),
      safePoints:Math.max(0,Number(body.safePoints??1)), moderatePenalty:Math.max(0,Number(body.moderatePenalty??.5)),
      criticalPenalty:Math.max(0,Number(body.criticalPenalty??2)), streakBonus:Math.max(0,Number(body.streakBonus??10)),
      prizes:Array.isArray(body.prizes)?body.prizes.slice(0,3).map(v=>clean(v,120)):[]
    };
    if(![config.safePoints,config.moderatePenalty,config.criticalPenalty,config.streakBonus].every(Number.isFinite)) return res.status(400).json({error:'Pontuação inválida.'});
    await q(`INSERT INTO challenge_configs(school_id,value) VALUES($1,$2) ON CONFLICT(school_id) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[req.user.schoolId,config]);
    res.json({ok:true,config});
  } catch(e){ console.error(e); res.status(500).json({error:'Não foi possível salvar o desafio.'}); }
});

app.put('/api/config',auth,adminOnly,async(req,res)=>{await q(`INSERT INTO school_configs(school_id,value) VALUES($1,$2) ON CONFLICT(school_id) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[req.user.schoolId,req.body||{}]);res.json({ok:true});});

app.post('/api/salas',auth,adminOnly,async(req,res)=>{const name=clean(req.body.nome||req.body.name,80);if(!name)return res.status(400).json({error:'Nome da sala obrigatório.'});const rid=clean(req.body.id,80)||id();await q('INSERT INTO rooms(id,school_id,name,online,manual_offline,current_db,last_reading_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[rid,req.user.schoolId,name,!!req.body.online,!!req.body.manualOffline,Number(req.body.db)||0,req.body.lastReadingAt||null]);res.json({id:rid,nome:name});});
app.put('/api/salas/:id',auth,adminOnly,async(req,res)=>{const rid=req.params.id;const r=await q('UPDATE rooms SET name=COALESCE($1,name),online=COALESCE($2,online),manual_offline=COALESCE($3,manual_offline),current_db=COALESCE($4,current_db),last_reading_at=COALESCE($5,last_reading_at) WHERE id=$6 AND school_id=$7 RETURNING *',[req.body.nome,req.body.online,req.body.manualOffline,Number.isFinite(Number(req.body.db))?Number(req.body.db):null,req.body.lastReadingAt||null,rid,req.user.schoolId]);if(!r.rowCount)return res.status(404).json({error:'Sala não encontrada.'});res.json({ok:true});});
app.delete('/api/salas/:id',auth,adminOnly,async(req,res)=>{await q('DELETE FROM rooms WHERE id=$1 AND school_id=$2',[req.params.id,req.user.schoolId]);res.json({ok:true});});

app.get('/api/s10/latest', auth, async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    let r;
    if (req.user.role === 'student') {
      r = await q(
        `SELECT id,sensor,room,db,status,timestamp,simulated FROM readings
         WHERE school_id=$1 AND simulated=false
           AND (UPPER(sensor) LIKE 'S10%' OR LOWER(room)='bili')
         ORDER BY timestamp DESC LIMIT $2`,
        [req.user.schoolId, limit]
      );
    } else {
      r = await q(
        `SELECT id,sensor,room,db,status,timestamp,simulated FROM readings
         WHERE school_id=$1 AND simulated=false
         ORDER BY timestamp DESC LIMIT $2`,
        [req.user.schoolId, limit]
      );
    }
    res.json({ ok: true, readings: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Não foi possível consultar as leituras do S10.' });
  }
});

app.get('/api/s10/status', auth, async (req, res) => {
  try {
    const r = await q(
      `SELECT s.identifier,s.device_id,s.online,s.last_seen,r.name room
       FROM sensors s LEFT JOIN rooms r ON r.id=s.room_id
       WHERE s.school_id=$1 AND UPPER(s.identifier) LIKE 'S10%'
       ORDER BY s.identifier`,
      [req.user.schoolId]
    );
    const now = Date.now();
    res.json({
      ok: true,
      sensors: r.rows.map(s => ({
        sensor: s.identifier, deviceId: s.device_id, room: s.room,
        online: Boolean(s.last_seen) && (now - new Date(s.last_seen).getTime()) <= 90000,
        lastSeen: s.last_seen
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Não foi possível consultar o status dos S10.' });
  }
});

app.post('/api/s10/ingest', requireS10Key, async (req, res) => {
  try {
    const body = req.body || {};
    const list = Array.isArray(body) ? body : (Array.isArray(body.data) ? body.data : [body]);
    const normalized = list.map(item => ({
      ...item,
      sensor: item.sensor ?? item.sensorId ?? item.device ?? '',
      sala: item.sala ?? item.room ?? item.roomName ?? '',
      db: item.db ?? item.dB ?? item.decibel ?? item.level,
      timestamp: item.timestamp ?? item.dataHora ?? item.dateTime ?? new Date().toISOString(),
      simulated: false
    }));
    const valid = normalized.filter(item => item.sensor && item.sala && Number.isFinite(Number(item.db)));
    if (!valid.length) return res.status(400).json({ error: 'Envie sensor, sala e db. Ex.: {sensor:"S10-01", sala:"Bili", db:63.4}.' });
    // Reutiliza a mesma rotina de persistência/alertas do sistema, mas nunca aceita leituras simuladas.
    req.body = valid;
    return saveMeasurements(req, res);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Não foi possível receber as medições do S10.' });
  }
});

async function saveMeasurements(req, res) {
  try {
    const list=Array.isArray(req.body)?req.body:[req.body], result=[];
    const cfgR=await q('SELECT value FROM school_configs WHERE school_id=$1',[req.user.schoolId]); const cfg=thresholds(cfgR.rowCount?cfgR.rows[0].value:{});
    for(const item of list){
      const sensor=clean(item.sensor,100), roomName=clean(item.sala,100), db=Number(item.db);
      if(!sensor||!roomName||!Number.isFinite(db)||db<0||db>200) continue;
      const timestamp=new Date(item.timestamp||new Date().toISOString());
      if(!Number.isFinite(timestamp.getTime())) continue;
      let rr=await q('SELECT * FROM rooms WHERE school_id=$1 AND (id=$2 OR LOWER(name)=LOWER($3)) LIMIT 1',[req.user.schoolId,roomName,roomName]);
      let room=rr.rows[0];
      if(!room){room={id:id(),school_id:req.user.schoolId,name:roomName};await q('INSERT INTO rooms(id,school_id,name,online,current_db,last_reading_at) VALUES($1,$2,$3,true,$4,$5)',[room.id,room.school_id,room.name,db,timestamp.toISOString()]);}
      let sr=await q('SELECT * FROM sensors WHERE school_id=$1 AND identifier=$2 LIMIT 1',[req.user.schoolId,sensor]);
      let sens=sr.rows[0];
      if(!sens){sens={id:id(),identifier:sensor};await q('INSERT INTO sensors(id,school_id,room_id,identifier,type,device_id,online,last_seen) VALUES($1,$2,$3,$4,$5,$6,true,$7)',[sens.id,req.user.schoolId,room.id,sensor,item.tipo||'S10',item.deviceId||null,timestamp.toISOString()]);}
      else await q('UPDATE sensors SET room_id=$1,online=true,last_seen=$2,device_id=COALESCE($3,device_id) WHERE id=$4',[room.id,timestamp.toISOString(),item.deviceId||null,sens.id]);
      const status=statusFromDb(db,cfg), rid=clean(item.id,120)||id();
      await q('INSERT INTO readings(id,school_id,sensor_id,room_id,sensor,room,db,dbfs,status,timestamp,simulated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false) ON CONFLICT(id) DO NOTHING',[rid,req.user.schoolId,sens.id,room.id,sensor,room.name,db,Number.isFinite(Number(item.dbfs))?Number(item.dbfs):null,status,timestamp.toISOString()]);
      await q('UPDATE rooms SET online=true,current_db=$1,last_reading_at=$2 WHERE id=$3',[db,timestamp.toISOString(),room.id]);
      if(status==='Moderado' || status==='Crítico'){
        const type=status==='Crítico'?'critico':'moderado';
        const recent=await q('SELECT id FROM alerts WHERE school_id=$1 AND sensor_id=$2 AND type=$3 AND timestamp >= $4 LIMIT 1',[req.user.schoolId,sens.id,type,new Date(timestamp.getTime()-5*60*1000)]);
        if(!recent.rowCount){
          await q('INSERT INTO alerts(id,school_id,reading_id,sensor_id,room_id,type,db,message,timestamp) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(),req.user.schoolId,rid,sens.id,room.id,type,db,status==='Crítico'?`Ruído elevado detectado — ${db.toFixed(1)} dB (${room.name})`:`Ruído moderado — ${db.toFixed(1)} dB (${room.name})`,timestamp.toISOString()]);
        }
      }
      result.push({id:rid,sala:room.name,sensor,db,status,timestamp:timestamp.toISOString()});
    }
    if(!result.length) return res.status(400).json({error:'Nenhuma medição válida foi recebida.'});
    res.json({ok:true,count:result.length,readings:result});
  } catch(e){console.error(e);res.status(500).json({error:'Não foi possível salvar as medições.'});}
}

app.post('/api/medicoes',deviceOrUserAuth,async(req,res)=>{
  if(req.user.role==='student') return res.status(403).json({error:'Aluno não pode gravar medições.'});
  return saveMeasurements(req,res);
});

app.get('/api/alertas',auth,async(req,res)=>{let r;if(req.user.role==='student'){r=await q("SELECT id,sensor,room,db,type,message,timestamp FROM alerts WHERE school_id=$1 AND type <> 'normal' AND (LOWER(room)='bili' OR UPPER(sensor)='S10') ORDER BY timestamp DESC LIMIT 1000",[req.user.schoolId]);}else{r=await q("SELECT id,sensor,room,db,type,message,timestamp FROM alerts WHERE school_id=$1 ORDER BY timestamp DESC LIMIT 1000",[req.user.schoolId]);}res.json({alertas:r.rows.map(a=>({id:a.id,sensor:a.sensor,sala:a.room,nivel_db:Number(a.db),tipo:a.type,mensagem:a.message,data_hora:a.timestamp}))});});
app.delete('/api/alertas',auth,adminOnly,async(req,res)=>{await q('DELETE FROM alerts WHERE school_id=$1',[req.user.schoolId]);res.json({ok:true});});

app.get(/.*/, (_req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
initDb().then(()=>app.listen(PORT,()=>console.log(`Bom Ruido em http://localhost:${PORT}`))).catch(e=>{console.error('Falha no banco:',e);process.exit(1);});
