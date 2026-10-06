import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface StaffSession {
  id: string; employeeCode: string; firstName: string; lastName: string; nickname?: string; branchId: string | null;
  role: { code: string; name: string }; permissions: string[];
}
export interface MemberSession { id: string; memberCode: string; firstName: string; lastName: string }

interface AuthState {
  staffToken: string | null; staff: StaffSession | null;
  memberToken: string | null; member: MemberSession | null;
  deviceKey: string | null;
  branchId: string | null;          // active branch (HQ staff may switch)
  expiredNotice: boolean;
  setStaff: (token: string, staff: StaffSession) => void;
  logoutStaff: (expired?: boolean) => void;
  setMember: (token: string, member: MemberSession) => void;
  logoutMember: () => void;
  setDeviceKey: (k: string | null) => void;
  setBranch: (id: string | null) => void;
}

export const useAuth = create<AuthState>()(persist((set) => ({
  staffToken: null, staff: null, memberToken: null, member: null, deviceKey: null, branchId: null, expiredNotice: false,
  setStaff: (token, staff) => set((s) => ({ staffToken: token, staff, branchId: staff.branchId ?? s.branchId, expiredNotice: false })),
  logoutStaff: (expired) => set({ staffToken: null, staff: null, expiredNotice: !!expired }),
  setMember: (token, member) => set({ memberToken: token, member }),
  logoutMember: () => set({ memberToken: null, member: null }),
  setDeviceKey: (k) => set({ deviceKey: k }),
  setBranch: (id) => set({ branchId: id }),
}), { name: 'tp.auth' }));

export function can(perm: string) {
  const p = useAuth.getState().staff?.permissions ?? [];
  return p.includes('*') || p.includes(perm);
}
export function useCan() {
  const perms = useAuth((s) => s.staff?.permissions ?? []);
  return (perm: string) => perms.includes('*') || perms.includes(perm);
}
export function useBranchId() {
  return useAuth((s) => s.branchId ?? s.staff?.branchId ?? null);
}
