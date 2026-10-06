import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, BarChart3, Bell, Boxes, Building2, CalendarDays, ClipboardList, CreditCard, DoorOpen, FerrisWheel, FileClock, Gift, KeyRound, Landmark, LayoutDashboard,
  Lock, LogOut, Map, Menu, MonitorSmartphone, Package, Percent, ReceiptText, Settings, ShieldCheck, ShoppingCart, Store, Tags, Ticket, Timer, Users, UserCog, Wallet, X, Cpu,
} from 'lucide-react';
import { Badge, Select, cx, toast } from '../components/ui';
import { OfflineBanner } from '../components/OfflineBanner';
import { sapi } from '../lib/api';
import { useAuth, useBranchId, useCan } from '../lib/auth';
import { useRealtime } from '../lib/socket';
import { useSurfaceFont } from '../lib/config';

interface NavItem { to: string; label: string; icon: any; perm?: string | string[] }
const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: 'Overview', items: [
    { to: '/staff', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view' },
    { to: '/staff/consolidated', label: 'All Branches', icon: Building2, perm: 'dashboard.consolidated' },
    { to: '/staff/map', label: 'Live Park Map', icon: Map, perm: 'dashboard.view' },
    { to: '/staff/notifications', label: 'Notifications', icon: Bell, perm: 'notification.view' },
  ] },
  { group: 'Operations', items: [
    { to: '/staff/counter', label: 'Ticket Counter', icon: Ticket, perm: ['ticket.sell', 'booking.checkin'] },
    { to: '/staff/pos', label: 'POS', icon: ShoppingCart, perm: 'pos.sell' },
    { to: '/staff/gates', label: 'Gate Console', icon: DoorOpen, perm: 'gate.view' },
    { to: '/staff/rides', label: 'Rides', icon: FerrisWheel, perm: 'ride.view' },
    { to: '/staff/cards', label: 'Cards & Wristbands', icon: CreditCard, perm: 'credential.view' },
    { to: '/staff/lockers', label: 'Lockers', icon: Lock, perm: 'locker.use' },
    { to: '/staff/shifts', label: 'Shift', icon: Timer, perm: ['shift.open', 'shift.manage'] },
  ] },
  { group: 'Customers & Sales', items: [
    { to: '/staff/bookings', label: 'Bookings', icon: CalendarDays, perm: 'booking.view' },
    { to: '/staff/verify', label: 'Payment Verification', icon: ShieldCheck, perm: 'payment.verify' },
    { to: '/staff/members', label: 'Members', icon: Users, perm: 'member.view' },
    { to: '/staff/transactions', label: 'Transactions', icon: ReceiptText, perm: 'transaction.view' },
    { to: '/staff/inventory', label: 'Inventory', icon: Boxes, perm: 'inventory.view' },
    { to: '/staff/reports', label: 'Reports', icon: BarChart3, perm: 'report.view' },
    { to: '/staff/gates/log', label: 'Entry Log', icon: ClipboardList, perm: 'gate.view' },
    { to: '/staff/audit', label: 'Audit Log', icon: FileClock, perm: 'audit.view' },
  ] },
  { group: 'Configuration', items: [
    { to: '/staff/admin/packages', label: 'Packages & Tickets', icon: Package, perm: 'package.manage' },
    { to: '/staff/admin/rides', label: 'Rides & Scan Points', icon: FerrisWheel, perm: 'ride.manage' },
    { to: '/staff/admin/gates', label: 'Gates', icon: DoorOpen, perm: 'gate.manage' },
    { to: '/staff/admin/zones', label: 'Zones', icon: Map, perm: 'zone.manage' },
    { to: '/staff/admin/products', label: 'Products & Stores', icon: Store, perm: 'product.manage' },
    { to: '/staff/admin/tiers', label: 'Membership', icon: Landmark, perm: 'membership.manage' },
    { to: '/staff/admin/promotions', label: 'Promotions & Coupons', icon: Percent, perm: 'promotion.manage' },
    { to: '/staff/admin/rewards', label: 'Rewards', icon: Gift, perm: 'reward.manage' },
    { to: '/staff/admin/lockers', label: 'Lockers', icon: KeyRound, perm: 'locker.manage' },
    { to: '/staff/admin/devices', label: 'Devices', icon: Cpu, perm: 'device.manage' },
    { to: '/staff/admin/staff', label: 'Staff', icon: UserCog, perm: 'staff.manage' },
    { to: '/staff/admin/roles', label: 'Roles & Permissions', icon: ShieldCheck, perm: 'role.manage' },
    { to: '/staff/admin/branches', label: 'Branches', icon: Building2, perm: 'branch.manage' },
    { to: '/staff/admin/settings', label: 'Settings', icon: Settings, perm: 'settings.manage' },
  ] },
  { group: 'Devices', items: [
    { to: '/kiosk', label: 'Customer Kiosk', icon: MonitorSmartphone },
    { to: '/device-setup', label: 'Device Setup', icon: Tags, perm: 'device.manage' },
  ] },
];

export function StaffLayout() {
  useSurfaceFont('admin');
  const { staff, logoutStaff, setBranch } = useAuth();
  const branchId = useBranchId();
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => sapi.get('/api/public/branches') });
  const notif = useQuery({ queryKey: ['notif-unread', branchId], queryFn: () => sapi.get(`/api/notifications?unread=true${branchId ? `&branchId=${branchId}` : ''}`), enabled: can('notification.view') && !!branchId, refetchInterval: 60_000 });
  const shift = useQuery({ queryKey: ['shift-current'], queryFn: () => sapi.get('/api/shifts/current'), enabled: can('shift.open') });
  useEffect(() => { if (!branchId && branches.data?.length) setBranch(branches.data[0].id); }, [branchId, branches.data, setBranch]);
  useRealtime([branchId ? `branch:${branchId}` : null], {
    notification: (n) => {
      qc.invalidateQueries({ queryKey: ['notif-unread'] });
      if (n.severity === 'CRITICAL') toast.error(`${n.title}: ${n.message}`); else if (n.severity === 'WARNING') toast.warning(`${n.title}: ${n.message}`);
    },
  });
  const allowed = (i: NavItem) => !i.perm || (Array.isArray(i.perm) ? i.perm.some(can) : can(i.perm));
  const logout = async () => { try { await sapi.post('/api/auth/logout'); } catch { /* ignore */ } logoutStaff(); nav('/staff/login'); };
  const unread = notif.data?.length ?? 0;

  const sidebar = (
    <nav className="flex h-full flex-col">
      <Link to="/staff" className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-lg text-white">🎡</div>
        <div><div className="text-sm font-bold leading-tight text-white">ONE QR Park</div><div className="text-[11px] text-slate-400">Management Platform</div></div>
      </Link>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter(allowed);
          if (!items.length) return null;
          return (
            <div key={g.group} className="mb-3">
              <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">{g.group}</div>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/staff'} onClick={() => setOpen(false)}
                  className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition', isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
                  <i.icon className="h-4 w-4 shrink-0" />{i.label}
                  {i.to === '/staff/notifications' && unread > 0 && <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 bg-slate-900 lg:block">{sidebar}</aside>
      {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} /><aside className="absolute left-0 top-0 h-full w-64 bg-slate-900">{sidebar}</aside></div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 md:px-5">
          <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          {(!staff?.branchId || can('dashboard.consolidated')) && branches.data && (
            <Select value={branchId ?? ''} onChange={(e) => { setBranch(e.target.value); qc.invalidateQueries(); }} className="w-auto max-w-[260px] py-1.5">
              {branches.data.map((b: any) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </Select>
          )}
          {staff?.branchId && !can('dashboard.consolidated') && <div className="text-sm font-medium text-slate-600">{branches.data?.find((b: any) => b.id === branchId)?.name}</div>}
          <div className="ml-auto flex items-center gap-2">
            {can('shift.open') && (
              <Link to="/staff/shifts" className="hidden sm:block">{shift.data ? <Badge tone="green"><Activity className="h-3 w-3" /> Shift {shift.data.shift.shift_no}</Badge> : <Badge tone="amber">No open shift</Badge>}</Link>
            )}
            {can('notification.view') && (
              <Link to="/staff/notifications" className="relative rounded-lg p-2 hover:bg-slate-100">
                <Bell className="h-5 w-5 text-slate-600" />
                {unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-500" />}
              </Link>
            )}
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold leading-tight">{staff?.nickname || staff?.firstName}</div>
              <div className="text-[11px] text-slate-500">{staff?.role.name} · {staff?.employeeCode}</div>
            </div>
            <button onClick={logout} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Logout"><LogOut className="h-5 w-5" /></button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5"><Outlet /></main>
      </div>
    </div>
  );
}
