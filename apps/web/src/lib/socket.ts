import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './auth';

type Ctx = 'staff' | 'member' | 'public';
const sockets = new Map<string, Socket>();

function getSocket(ctx: Ctx): Socket {
  const s = useAuth.getState();
  const token = ctx === 'staff' ? s.staffToken : ctx === 'member' ? s.memberToken : null;
  const deviceKey = ctx === 'member' ? null : s.deviceKey;
  const key = `${ctx}:${token ?? ''}:${deviceKey ?? ''}`;
  let sock = sockets.get(key);
  if (!sock) {
    for (const [k, old] of sockets) if (k.startsWith(`${ctx}:`)) { old.close(); sockets.delete(k); }
    sock = io({ path: '/socket.io', auth: { token, deviceKey }, transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
    sockets.set(key, sock);
  }
  return sock;
}

/**
 * Subscribe to realtime rooms and handle events. Re-subscribes automatically after reconnects.
 * handlers: { 'gate.scan': (data) => … }
 */
export function useRealtime(rooms: Array<string | null | undefined>, handlers: Record<string, (data: any) => void>, opts: { ctx?: Ctx; bookingToken?: string } = {}) {
  const ctx = opts.ctx ?? 'staff';
  const tokens = useAuth((s) => `${s.staffToken}:${s.memberToken}:${s.deviceKey}`);
  const ref = useRef(handlers);
  ref.current = handlers;
  const [connected, setConnected] = useState(false);
  const roomKey = rooms.filter(Boolean).join('|');
  useEffect(() => {
    const sock = getSocket(ctx);
    const list = rooms.filter(Boolean) as string[];
    const subscribe = () => { if (list.length) sock.emit('subscribe', { rooms: list, bookingToken: opts.bookingToken }); setConnected(true); };
    const onDisconnect = () => setConnected(false);
    const events = Object.keys(ref.current);
    const listeners = events.map((ev) => [ev, (d: any) => ref.current[ev]?.(d)] as const);
    listeners.forEach(([ev, fn]) => sock.on(ev, fn));
    sock.on('connect', subscribe);
    sock.on('disconnect', onDisconnect);
    if (sock.connected) subscribe();
    return () => {
      listeners.forEach(([ev, fn]) => sock.off(ev, fn));
      sock.off('connect', subscribe);
      sock.off('disconnect', onDisconnect);
      if (list.length) sock.emit('unsubscribe', { rooms: list });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, ctx, tokens, Object.keys(handlers).join(','), opts.bookingToken]);
  return connected;
}
