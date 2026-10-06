import React, { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loading, Toaster } from './components/ui';
import { ApprovalHost } from './components/Approval';
import { PrintHost } from './components/Print';
import { useAuth } from './lib/auth';
import { StaffLayout } from './layouts/StaffLayout';
import { PublicLayout } from './layouts/PublicLayout';

const L = (f: () => Promise<any>, name: string) => lazy(() => f().then((m) => ({ default: m[name] }))) as React.LazyExoticComponent<React.ComponentType<any>>;
// public
const Home = L(() => import('./pages/public/Home'), 'Home');
const BookingWizard = L(() => import('./pages/public/BookingWizard'), 'BookingWizard');
const BookingView = L(() => import('./pages/public/BookingView'), 'BookingView');
const PaySimulator = L(() => import('./pages/public/PaySimulator'), 'PaySimulator');
const MemberAuth = L(() => import('./pages/public/MemberAuth'), 'MemberAuth');
const Portal = L(() => import('./pages/public/Portal'), 'Portal');
const MembershipPlans = L(() => import('./pages/public/MembershipPlans'), 'MembershipPlans');
const RideStatusPublic = L(() => import('./pages/public/RideStatusPublic'), 'RideStatusPublic');
const FoodOrder = L(() => import('./pages/public/FoodOrder'), 'FoodOrder');
// devices
const GateDisplay = L(() => import('./pages/devices/GateDisplay'), 'GateDisplay');
const RideScanner = L(() => import('./pages/devices/RideScanner'), 'RideScanner');
const Kiosk = L(() => import('./pages/devices/Kiosk'), 'Kiosk');
const KDS = L(() => import('./pages/devices/KDS'), 'KDS');
const OrderBoard = L(() => import('./pages/devices/OrderBoard'), 'OrderBoard');
const DeviceSetup = L(() => import('./pages/devices/DeviceSetup'), 'DeviceSetup');
// staff
const StaffLogin = L(() => import('./pages/staff/StaffLogin'), 'StaffLogin');
const Dashboard = L(() => import('./pages/staff/Dashboard'), 'Dashboard');
const Consolidated = L(() => import('./pages/staff/Consolidated'), 'Consolidated');
const LiveMap = L(() => import('./pages/staff/LiveMap'), 'LiveMap');
const GateConsole = L(() => import('./pages/staff/GateConsole'), 'GateConsole');
const EntryLog = L(() => import('./pages/staff/EntryLog'), 'EntryLog');
const RideDashboard = L(() => import('./pages/staff/RideDashboard'), 'RideDashboard');
const RideOperator = L(() => import('./pages/staff/RideOperator'), 'RideOperator');
const Counter = L(() => import('./pages/staff/Counter'), 'Counter');
const POS = L(() => import('./pages/staff/POS'), 'POS');
const Cards = L(() => import('./pages/staff/Cards'), 'Cards');
const Members = L(() => import('./pages/staff/Members'), 'Members');
const MemberDetail = L(() => import('./pages/staff/Members'), 'MemberDetail');
const Bookings = L(() => import('./pages/staff/Bookings'), 'Bookings');
const PaymentVerification = L(() => import('./pages/staff/PaymentVerification'), 'PaymentVerification');
const Transactions = L(() => import('./pages/staff/Transactions'), 'Transactions');
const Lockers = L(() => import('./pages/staff/Lockers'), 'Lockers');
const Shifts = L(() => import('./pages/staff/Shifts'), 'Shifts');
const Inventory = L(() => import('./pages/staff/Inventory'), 'Inventory');
const Reports = L(() => import('./pages/staff/Reports'), 'Reports');
const Notifications = L(() => import('./pages/staff/Notifications'), 'Notifications');
const Audit = L(() => import('./pages/staff/Audit'), 'Audit');
const AdminPage = L(() => import('./pages/admin/AdminPages'), 'AdminPage');
const PackageEditor = L(() => import('./pages/admin/PackageEditor'), 'PackageEditor');
const Settings = L(() => import('./pages/admin/Settings'), 'Settings');
const Roles = L(() => import('./pages/admin/Roles'), 'Roles');
const Devices = L(() => import('./pages/admin/Devices'), 'Devices');

function RequireStaff({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.staffToken);
  const loc = useLocation();
  if (!token) return <Navigate to={`/staff/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/book" element={<BookingWizard />} />
            <Route path="/booking/:no" element={<BookingView />} />
            <Route path="/login" element={<MemberAuth mode="login" />} />
            <Route path="/register" element={<MemberAuth mode="register" />} />
            <Route path="/forgot" element={<MemberAuth mode="forgot" />} />
            <Route path="/account/*" element={<Portal />} />
            <Route path="/membership" element={<MembershipPlans />} />
            <Route path="/rides-status" element={<RideStatusPublic />} />
            <Route path="/order/:storeId" element={<FoodOrder />} />
          </Route>
          <Route path="/pay/simulator/:paymentId" element={<PaySimulator />} />
          <Route path="/device-setup" element={<DeviceSetup />} />
          <Route path="/gate/:gateId/display" element={<GateDisplay />} />
          <Route path="/ride/:rideId/scanner" element={<RideScanner />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/kds/:storeId" element={<KDS />} />
          <Route path="/board/:storeId" element={<OrderBoard />} />
          <Route path="/staff/login" element={<StaffLogin />} />
          <Route path="/staff" element={<RequireStaff><StaffLayout /></RequireStaff>}>
            <Route index element={<Dashboard />} />
            <Route path="consolidated" element={<Consolidated />} />
            <Route path="map" element={<LiveMap />} />
            <Route path="gates" element={<GateConsole />} />
            <Route path="gates/log" element={<EntryLog />} />
            <Route path="rides" element={<RideDashboard />} />
            <Route path="rides/:rideId" element={<RideOperator />} />
            <Route path="counter" element={<Counter />} />
            <Route path="pos" element={<POS />} />
            <Route path="cards" element={<Cards />} />
            <Route path="members" element={<Members />} />
            <Route path="members/:id" element={<MemberDetail />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="verify" element={<PaymentVerification />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="lockers" element={<Lockers />} />
            <Route path="shifts" element={<Shifts />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="reports" element={<Reports />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="audit" element={<Audit />} />
            <Route path="admin/packages/:id" element={<PackageEditor />} />
            <Route path="admin/settings" element={<Settings />} />
            <Route path="admin/roles" element={<Roles />} />
            <Route path="admin/devices" element={<Devices />} />
            <Route path="admin/:entity" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
      <ApprovalHost />
      <PrintHost />
    </>
  );
}
