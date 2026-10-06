#!/usr/bin/env node
/**
 * On-site gate edge agent (reference implementation).
 *
 * Runs on a small computer next to the turnstile / barrier (e.g. Raspberry Pi) and bridges
 * the cloud/backend with local hardware:
 *   • subscribes to `gate:{gateId}` over Socket.IO with the device API key
 *   • on `gate.command` OPEN / CLOSE / EMERGENCY_* drives the local controller (GPIO / relay / serial)
 *   • reports PASSAGE / NO_PASSAGE / FAULT / FIRE_ALARM back to POST /api/gates/{id}/hardware-event
 *   • sends heartbeats so the Device dashboard shows ONLINE / OFFLINE
 *
 * Physical safety (emergency release, obstruction sensors, fire-alarm fail-open) MUST remain
 * in the gate hardware itself — this agent only requests movements.
 *
 * Usage: API_URL=https://park.example DEVICE_KEY=tpd_xxx GATE_ID=<uuid> node tools/gate-edge-agent.mjs
 * Requires: npm i socket.io-client
 */
import { io } from 'socket.io-client';

const { API_URL = 'http://localhost:4000', DEVICE_KEY, GATE_ID, PASSAGE_MS = '1500' } = process.env;
if (!DEVICE_KEY || !GATE_ID) { console.error('DEVICE_KEY and GATE_ID are required'); process.exit(1); }

const headers = { 'content-type': 'application/json', 'x-device-key': DEVICE_KEY };
const report = (type, extra = {}) => fetch(`${API_URL}/api/gates/${GATE_ID}/hardware-event`, { method: 'POST', headers, body: JSON.stringify({ type, ...extra }) })
  .catch((e) => console.error('report failed', e.message));

// ---- replace these with your hardware driver (GPIO, Modbus, RS-485, vendor SDK …) ----
const hardware = {
  async open(ms) { console.log(`[hw] OPEN for ${ms}ms`); setTimeout(() => report('PASSAGE'), Number(PASSAGE_MS)); setTimeout(() => report('CLOSED'), ms); },
  async close() { console.log('[hw] CLOSE'); await report('CLOSED'); },
  async emergency(active) { console.log(`[hw] EMERGENCY ${active ? 'RELEASE' : 'CLEAR'}`); },
};

const socket = io(API_URL, { path: '/socket.io', auth: { deviceKey: DEVICE_KEY }, transports: ['websocket'] });
socket.on('connect', () => { console.log('connected'); socket.emit('subscribe', { rooms: [`gate:${GATE_ID}`] }, (r) => console.log('subscribed', r)); report('ONLINE'); });
socket.on('disconnect', () => console.log('disconnected — hardware keeps its own safety logic'));
socket.on('gate.command', async (cmd) => {
  try {
    if (cmd.command === 'OPEN') await hardware.open(cmd.durationMs ?? 5000);
    if (cmd.command === 'CLOSE') await hardware.close();
    if (cmd.command === 'EMERGENCY_OPEN') await hardware.emergency(true);
    if (cmd.command === 'EMERGENCY_CLEAR') await hardware.emergency(false);
  } catch (e) { await report('FAULT', { message: String(e?.message ?? e) }); }
});
setInterval(() => fetch(`${API_URL}/api/devices/heartbeat`, { method: 'POST', headers, body: JSON.stringify({ firmware: 'edge-agent-1.0' }) }).catch(() => {}), 30_000);
