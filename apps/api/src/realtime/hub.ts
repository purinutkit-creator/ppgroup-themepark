import type { Server } from 'socket.io';

/**
 * Realtime publish hub. Business services call `publish` (normally inside an
 * afterCommit callback so clients never see uncommitted state).
 *
 * Room naming:
 *   branch:{branchId}              — staff of a branch (dashboards, notifications)
 *   gates:{branchId}               — gate operator console / gate dashboard
 *   gate:{gateId}                  — a gate customer display / controller
 *   ride:{rideId}                  — ride operator & ride scanner
 *   kds:{storeId}                  — kitchen display + order-ready display
 *   payverify:{branchId}           — payment verification center
 *   account:{accountId}            — every screen showing a customer account (wallet, entitlements)
 *   member:{memberId}              — member portal
 *   booking:{bookingId}            — guest waiting for payment confirmation
 *   devices:{branchId}             — device status board
 *   owner                          — consolidated multi-branch dashboard
 */
let io: Server | null = null;

export function attachIo(server: Server) { io = server; }

export function publish(rooms: Array<string | null | undefined>, event: string, data: unknown) {
  if (!io) return;
  const targets = rooms.filter((r): r is string => !!r);
  if (!targets.length) return;
  io.to(targets).emit(event, { ...((data as object) ?? {}), _event: event, _at: new Date().toISOString() });
}

export const rooms = {
  branch: (id: string) => `branch:${id}`,
  gates: (branchId: string) => `gates:${branchId}`,
  gate: (id: string) => `gate:${id}`,
  ride: (id: string) => `ride:${id}`,
  kds: (storeId: string) => `kds:${storeId}`,
  payverify: (branchId: string) => `payverify:${branchId}`,
  account: (id: string | null | undefined) => (id ? `account:${id}` : null),
  member: (id: string | null | undefined) => (id ? `member:${id}` : null),
  booking: (id: string) => `booking:${id}`,
  devices: (branchId: string) => `devices:${branchId}`,
  owner: 'owner',
};
