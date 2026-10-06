import { query, one, type Db } from '../db/pool.js';
import { businessDate } from '../lib/codes.js';
import { occupancy } from './gates.js';

const dayStart = `($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok'`;
const dayEnd = `(($2::date) + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'`;

/** Real-time dashboard figures for one branch & business day. */
export async function dashboard(db: Db, branchId: string, date = businessDate()) {
  const occ = await occupancy(db, branchId);
  const sales = await one(db, `SELECT
      COALESCE(SUM(amount) FILTER (WHERE type = 'SALE' AND category = 'TICKET'), 0) AS ticket_sales,
      COALESCE(SUM(amount) FILTER (WHERE type = 'SALE' AND category = 'FOOD'), 0) AS food_sales,
      COALESCE(SUM(amount) FILTER (WHERE type = 'SALE' AND category = 'RETAIL'), 0) AS retail_sales,
      COALESCE(SUM(amount) FILTER (WHERE type = 'SALE' AND category IN ('RIDE','LOCKER','MEMBERSHIP','OTHER')), 0) AS other_sales,
      COALESCE(SUM(amount) FILTER (WHERE type = 'TOPUP'), 0) AS wallet_topup,
      COALESCE(SUM(amount) FILTER (WHERE type IN ('SALE','TOPUP') AND direction = 'IN'), 0) AS collections,
      COALESCE(SUM(amount) FILTER (WHERE type IN ('REFUND','VOID','WALLET_CASH_OUT') AND direction = 'OUT'), 0) AS refunds,
      COUNT(*) FILTER (WHERE type = 'SALE') AS sale_count
    FROM transactions WHERE branch_id = $1 AND created_at >= ${dayStart} AND created_at < ${dayEnd}`, [branchId, date]);
  const hourly = await query(db, `
    WITH hours AS (SELECT generate_series(0, 23) AS h)
    SELECT h AS hour,
      (SELECT COUNT(*) FROM entry_logs e WHERE e.branch_id = $1 AND e.direction = 'IN' AND e.entry_time >= ${dayStart} AND e.entry_time < ${dayEnd}
          AND extract(hour FROM e.entry_time AT TIME ZONE 'Asia/Bangkok') = h)::int AS entries,
      (SELECT COUNT(*) FROM entry_logs e WHERE e.branch_id = $1 AND e.direction = 'OUT' AND e.entry_time >= ${dayStart} AND e.entry_time < ${dayEnd}
          AND extract(hour FROM e.entry_time AT TIME ZONE 'Asia/Bangkok') = h)::int AS exits,
      (SELECT COALESCE(SUM(amount), 0) FROM transactions t WHERE t.branch_id = $1 AND t.type IN ('SALE','TOPUP') AND t.created_at >= ${dayStart} AND t.created_at < ${dayEnd}
          AND extract(hour FROM t.created_at AT TIME ZONE 'Asia/Bangkok') = h) AS revenue
    FROM hours ORDER BY h`, [branchId, date]);
  let running = 0, peak = { hour: null as number | null, inside: 0 };
  for (const h of hourly) { running += h.entries - h.exits; h.inside = running; if (running > peak.inside) peak = { hour: h.hour, inside: running }; }
  const ticketTypes = await query(db, `SELECT p.name AS package, COALESCE(tt.name, '-') AS ticket_type, COUNT(*)::int AS qty, SUM(t.price - t.discount) AS amount
      FROM tickets t JOIN packages p ON p.id = t.package_id LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.branch_id = $1 AND t.status NOT IN ('UNPAID','CANCELLED','REFUNDED') AND t.activated_at >= ${dayStart} AND t.activated_at < ${dayEnd}
     GROUP BY 1, 2 ORDER BY qty DESC`, [branchId, date]);
  const stores = await query(db, `SELECT COALESCE(s.name, 'Online / Counter') AS store, SUM(t.amount) AS amount, COUNT(*)::int AS count
      FROM transactions t LEFT JOIN stores s ON s.id = t.store_id
     WHERE t.branch_id = $1 AND t.type = 'SALE' AND t.created_at >= ${dayStart} AND t.created_at < ${dayEnd} GROUP BY 1 ORDER BY amount DESC`, [branchId, date]);
  const rides = await query(db, `SELECT r.name, COUNT(l.id) FILTER (WHERE l.result = 'GRANTED')::int AS rides, COUNT(l.id) FILTER (WHERE l.result <> 'GRANTED')::int AS denied,
        r.status, (SELECT COALESCE(SUM(party_size), 0)::int FROM ride_queues q WHERE q.ride_id = r.id AND q.status = 'WAITING') AS queue_guests, r.capacity_per_cycle, r.cycle_minutes
      FROM rides r LEFT JOIN ride_access_logs l ON l.ride_id = r.id AND l.scanned_at >= ${dayStart} AND l.scanned_at < ${dayEnd}
     WHERE r.branch_id = $1 GROUP BY r.id ORDER BY rides DESC`, [branchId, date]);
  const gates = await query(db, `SELECT g.name, g.state, COUNT(s.id)::int AS scans, COUNT(s.id) FILTER (WHERE s.result IN ('APPROVED','AUTO_APPROVED'))::int AS approved,
        COUNT(s.id) FILTER (WHERE s.result = 'DENIED')::int AS denied, COUNT(s.id) FILTER (WHERE s.is_duplicate)::int AS duplicate
      FROM gates g LEFT JOIN gate_scans s ON s.gate_id = g.id AND s.scanned_at >= ${dayStart} AND s.scanned_at < ${dayEnd}
     WHERE g.branch_id = $1 GROUP BY g.id ORDER BY g.number`, [branchId, date]);
  const zones = await zoneOccupancy(db, branchId);
  const devices = await one(db, `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'ONLINE')::int AS online, COUNT(*) FILTER (WHERE status IN ('OFFLINE','ERROR'))::int AS offline FROM devices WHERE branch_id = $1`, [branchId]);
  const lockers = await one(db, `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'OCCUPIED')::int AS occupied FROM lockers WHERE branch_id = $1`, [branchId]);
  const members = await one(db, `SELECT COUNT(*) FILTER (WHERE created_at >= ${dayStart})::int AS new_today FROM members WHERE home_branch_id = $1 OR home_branch_id IS NULL`, [branchId, date]);
  return {
    date, occupancy: occ, peak,
    sales: { ...sales, total_revenue: Number(sales.collections) },
    hourly, ticketTypes, stores,
    rides: rides.map((r: any) => ({ ...r, wait_min: Math.ceil(r.queue_guests / r.capacity_per_cycle) * Number(r.cycle_minutes) })),
    gates, zones, devices, lockers, members,
  };
}

export async function zoneOccupancy(db: Db, branchId: string) {
  return query(db, `SELECT z.id, z.code, z.name, z.capacity, z.color, z.map_x, z.map_y, z.map_w, z.map_h, z.status,
      (SELECT COUNT(*)::int FROM tickets t WHERE t.current_zone_id = z.id AND t.presence = 'INSIDE') AS inside,
      (SELECT json_agg(json_build_object('id', r.id, 'name', r.name, 'status', r.status,
          'queue', (SELECT COALESCE(SUM(party_size), 0) FROM ride_queues q WHERE q.ride_id = r.id AND q.status = 'WAITING')) ORDER BY r.sort)
         FROM rides r WHERE r.zone_id = z.id) AS rides
    FROM zones z WHERE z.branch_id = $1 ORDER BY z.code`, [branchId]).then((rows) => rows.map((z: any) => {
      const pct = z.capacity ? (z.inside / z.capacity) * 100 : 0;
      return { ...z, percent: Math.round(pct), level: pct >= 90 ? 'CROWDED' : pct >= 70 ? 'BUSY' : 'NORMAL' };
    }));
}

/** Owner consolidated dashboard across all branches. */
export async function consolidated(db: Db, date = businessDate()) {
  const branches = await query(db, `SELECT id, code, name, capacity FROM branches WHERE status = 'ACTIVE' ORDER BY code`);
  const out = [];
  for (const b of branches) {
    const d = await dashboard(db, b.id, date);
    out.push({ branch: b, occupancy: d.occupancy, sales: d.sales, devices: d.devices });
  }
  const totals = out.reduce((t, b) => ({
    inside: t.inside + b.occupancy.inside, visitors: t.visitors + b.occupancy.visitorsToday,
    revenue: t.revenue + Number(b.sales.total_revenue), ticket: t.ticket + Number(b.sales.ticket_sales), food: t.food + Number(b.sales.food_sales),
    retail: t.retail + Number(b.sales.retail_sales), topup: t.topup + Number(b.sales.wallet_topup),
  }), { inside: 0, visitors: 0, revenue: 0, ticket: 0, food: 0, retail: 0, topup: 0 });
  return { date, totals, branches: out };
}
