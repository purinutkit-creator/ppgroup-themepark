import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { fmtDate, fmtDateTime, thb } from '../../lib/format';
import { Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Textarea, Toggle, toast } from '../../components/ui';

type FType = 'text' | 'number' | 'money' | 'bool' | 'select' | 'multiselect' | 'date' | 'time' | 'json' | 'color' | 'textarea' | 'datetime' | 'password' | 'ref' | 'percent';
interface FieldDef {
  key: string; label: string; type?: FType; options?: string[] | Array<{ value: string; label: string }>; ref?: { url: string; label: (r: any) => string; nullable?: boolean };
  default?: any; hint?: string; list?: boolean | ((r: any) => React.ReactNode); required?: boolean; span?: 2; createOnly?: boolean;
}
interface EntityDef { key: string; title: string; url: string; fields: FieldDef[]; branch?: boolean; actions?: (r: any, nav: (to: string) => void, extra: ExtraCtx) => React.ReactNode; subtitle?: string }
interface ExtraCtx { openBenefits: (r: any) => void; openTierPrices: (r: any) => void; openGenerate: (r: any) => void }

const snake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const ENT = ['ONE_TIME', 'MULTI_USE', 'UNLIMITED', 'TIME_BASED', 'DATE_BASED'];
const ref = (url: string, label: (r: any) => string, nullable = true) => ({ url, label, nullable });
const zoneRef = ref('/api/admin/zones', (r) => `${r.code} · ${r.name}`);
const rideRef = ref('/api/admin/rides', (r) => `${r.code} · ${r.name}`, false);

export const ENTITIES: Record<string, EntityDef> = {
  packages: { key: 'packages', title: 'Packages', url: '/api/admin/packages', subtitle: 'Sellable tickets / packages — prices, rides & zones in the composition editor',
    actions: (r, nav) => <Button size="xs" variant="outline" onClick={() => nav(`/staff/admin/packages/${r.id}`)}>Composition</Button>,
    fields: [
      { key: 'code', label: 'Code', required: true, list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'nameEn', label: 'Name (EN)' }, { key: 'nameZh', label: 'Name (中文)' },
      { key: 'description', label: 'Description', type: 'textarea', span: 2 }, { key: 'imageUrl', label: 'Image URL', span: 2 },
      { key: 'category', label: 'Category', type: 'select', options: ['ADMISSION', 'DAY_PASS', 'HALF_DAY', 'EVENING', 'UNLIMITED', 'VIP', 'GROUP', 'SCHOOL', 'CORPORATE', 'BIRTHDAY', 'FAMILY', 'MULTI_DAY', 'RIDE_PASS', 'OTHER'], default: 'DAY_PASS', list: true },
      { key: 'pricingMode', label: 'Pricing', type: 'select', options: ['PER_GUEST', 'BUNDLE'], default: 'PER_GUEST', list: true },
      { key: 'bundlePrice', label: 'Bundle price', type: 'money' }, { key: 'bundleMemberPrice', label: 'Bundle member price', type: 'money' },
      { key: 'bundleGuests', label: 'Bundle guests', type: 'json', default: [], hint: '[{"ticket_type_code":"ADULT","qty":2}]', span: 2 },
      { key: 'days', label: 'Days', type: 'number', default: 1, list: true }, { key: 'multiDayMode', label: 'Multi-day mode', type: 'select', options: ['CONSECUTIVE', 'ANY_WITHIN'], default: 'CONSECUTIVE' },
      { key: 'anyWithinDays', label: 'Any within (days)', type: 'number' }, { key: 'validFrom', label: 'Valid from', type: 'date' }, { key: 'validTo', label: 'Valid to', type: 'date' },
      { key: 'validDaysOfWeek', label: 'Valid days (0=Sun)', type: 'json', default: [0, 1, 2, 3, 4, 5, 6] }, { key: 'validTimeStart', label: 'Valid time start', type: 'time' }, { key: 'validTimeEnd', label: 'Valid time end', type: 'time' },
      { key: 'saleStart', label: 'Sale start', type: 'datetime' }, { key: 'saleEnd', label: 'Sale end', type: 'datetime' },
      { key: 'minAge', label: 'Min age', type: 'number' }, { key: 'maxAge', label: 'Max age', type: 'number' }, { key: 'minHeightCm', label: 'Min height (cm)', type: 'number' }, { key: 'maxHeightCm', label: 'Max height (cm)', type: 'number' },
      { key: 'entriesPerDay', label: 'Entries per day', type: 'number' }, { key: 'reentryAllowed', label: 'Re-entry allowed', type: 'bool', default: true }, { key: 'transferable', label: 'Transferable', type: 'bool', default: false },
      { key: 'rideAccess', label: 'Ride access', type: 'select', options: ['ALL', 'SELECT', 'NONE'], default: 'SELECT', list: true }, { key: 'rideAccessType', label: 'ALL-rides entitlement', type: 'select', options: ENT, default: 'UNLIMITED' },
      { key: 'rideAccessUses', label: 'ALL-rides uses', type: 'number' }, { key: 'zoneAccess', label: 'Zone access', type: 'select', options: ['ALL', 'SELECT'], default: 'ALL' },
      { key: 'refundPolicy', label: 'Refund policy', type: 'select', options: ['NON_REFUNDABLE', 'FULL_BEFORE_VISIT', 'PARTIAL_BEFORE_VISIT', 'ANYTIME'], default: 'NON_REFUNDABLE' },
      { key: 'refundPercent', label: 'Refund %', type: 'number', default: 100 }, { key: 'refundCutoffHours', label: 'Refund cut-off (h)', type: 'number', default: 24 },
      { key: 'dailyCapacity', label: 'Daily capacity', type: 'number' }, { key: 'walletCredit', label: 'Wallet credit included', type: 'money', default: 0 },
      { key: 'memberCardEntry', label: 'Member card can enter', type: 'bool', default: true }, { key: 'earnPoints', label: 'Earn points', type: 'bool', default: true },
      { key: 'channels', label: 'Channels', type: 'multiselect', options: ['ONLINE', 'COUNTER', 'KIOSK'], default: ['ONLINE', 'COUNTER', 'KIOSK'] },
      { key: 'isActive', label: 'Active', type: 'bool', default: true, list: true }, { key: 'sort', label: 'Sort', type: 'number', default: 0 },
    ] },
  'ticket-types': { key: 'ticket-types', title: 'Ticket types (guest categories)', url: '/api/admin/ticket-types', fields: [
    { key: 'code', label: 'Code', required: true, list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'nameEn', label: 'Name (EN)', list: true },
    { key: 'minAge', label: 'Min age', type: 'number', list: true }, { key: 'maxAge', label: 'Max age', type: 'number', list: true }, { key: 'minHeightCm', label: 'Min height', type: 'number' }, { key: 'maxHeightCm', label: 'Max height', type: 'number' },
    { key: 'requiresId', label: 'Requires ID', type: 'bool', default: false }, { key: 'sort', label: 'Sort', type: 'number', default: 0 }, { key: 'isActive', label: 'Active', type: 'bool', default: true, list: true }] },
  rides: { key: 'rides', title: 'Rides', url: '/api/admin/rides', branch: true, actions: (r, _n, x) => <Button size="xs" variant="outline" onClick={() => x.openTierPrices(r)}>Tier prices</Button>, fields: [
    { key: 'code', label: 'Code', required: true, list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'nameEn', label: 'Name (EN)' }, { key: 'zoneId', label: 'Zone', type: 'ref', ref: zoneRef },
    { key: 'description', label: 'Description', type: 'textarea', span: 2 }, { key: 'imageUrl', label: 'Image URL', span: 2 },
    { key: 'minHeightCm', label: 'Min height (cm)', type: 'number' }, { key: 'maxHeightCm', label: 'Max height (cm)', type: 'number' }, { key: 'minAge', label: 'Min age', type: 'number' }, { key: 'maxAge', label: 'Max age', type: 'number' },
    { key: 'capacityPerCycle', label: 'Capacity / cycle', type: 'number', default: 10, list: true }, { key: 'cycleMinutes', label: 'Duration (min)', type: 'number', default: 5, list: true },
    { key: 'status', label: 'Status', type: 'select', options: ['OPEN', 'CLOSED', 'MAINTENANCE', 'TEMPORARILY_CLOSED'], default: 'OPEN', list: true },
    { key: 'addonEnabled', label: 'Sell add-on at scanner', type: 'bool', default: true }, { key: 'addonPrice', label: 'Add-on price', type: 'money', default: 0, list: true },
    { key: 'addonMemberPrice', label: 'Member price', type: 'money' }, { key: 'addonPeakPrice', label: 'Peak price', type: 'money' },
    { key: 'addonEntitlementType', label: 'Add-on entitlement', type: 'select', options: ENT, default: 'ONE_TIME' }, { key: 'addonUses', label: 'Add-on uses', type: 'number', default: 1 },
    { key: 'pointRequirement', label: 'Point requirement', type: 'number', default: 0 }, { key: 'queueEnabled', label: 'Virtual queue', type: 'bool', default: true }, { key: 'queuePrefix', label: 'Queue prefix', default: 'A' },
    { key: 'queueCallWindowMin', label: 'Call window (min)', type: 'number', default: 10 }, { key: 'operatorStaffId', label: 'Operator', type: 'ref', ref: ref('/api/admin/staff', (r) => `${r.employee_code} ${r.first_name}`) },
    { key: 'sort', label: 'Sort', type: 'number', default: 0 }] },
  'scan-points': { key: 'scan-points', title: 'Ride scan points', url: '/api/admin/scan-points', fields: [
    { key: 'code', label: 'Code', required: true, list: true, hint: 'SCAN-RIDE-001' }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'rideId', label: 'Ride', type: 'ref', ref: rideRef, list: (r) => r.ride_name },
    { key: 'zoneId', label: 'Zone', type: 'ref', ref: zoneRef }, { key: 'deviceId', label: 'Device', type: 'ref', ref: ref('/api/admin/devices', (r) => `${r.code} · ${r.type}`) }, { key: 'location', label: 'Location' },
    { key: 'paymentEnabled', label: 'Payment enabled', type: 'bool', default: true, list: true }, { key: 'paymentMethods', label: 'Payment methods', type: 'multiselect', options: ['WALLET', 'PROMPTPAY', 'CARD', 'CASH'], default: ['WALLET', 'PROMPTPAY', 'CARD', 'CASH'] },
    { key: 'operatorStaffId', label: 'Operator', type: 'ref', ref: ref('/api/admin/staff', (r) => `${r.employee_code} ${r.first_name}`) }, { key: 'status', label: 'Status', type: 'select', options: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', list: true }] },
  gates: { key: 'gates', title: 'Gates', url: '/api/admin/gates', branch: true, subtitle: 'Hardware adapter per gate — switch SIMULATOR → real controller without code changes', fields: [
    { key: 'number', label: 'Number', type: 'number', required: true, list: true }, { key: 'code', label: 'Code', required: true, list: true }, { key: 'name', label: 'Name', required: true, list: true },
    { key: 'zoneId', label: 'Zone', type: 'ref', ref: zoneRef }, { key: 'direction', label: 'Direction', type: 'select', options: ['ENTRY', 'EXIT', 'BOTH'], default: 'ENTRY', list: true },
    { key: 'mode', label: 'Mode', type: 'select', options: ['AUTO', 'MANUAL'], default: 'MANUAL', list: true },
    { key: 'controllerType', label: 'Controller', type: 'select', options: ['SIMULATOR', 'TURNSTILE', 'FLAP_BARRIER', 'SWING_GATE', 'RELAY', 'GPIO', 'NETWORK'], default: 'SIMULATOR', list: true },
    { key: 'controllerConfig', label: 'Controller config', type: 'json', default: {}, hint: '{"baseUrl":"http://10.0.0.21","token":"…","pulseMs":500} / {"gpioPin":17}', span: 2 },
    { key: 'openDurationMs', label: 'Open duration (ms)', type: 'number', default: 5000 }, { key: 'isEnabled', label: 'Enabled', type: 'bool', default: true, list: true }, { key: 'blockNewEntry', label: 'Block new entry', type: 'bool', default: false },
    { key: 'operatorStaffId', label: 'Operator', type: 'ref', ref: ref('/api/admin/staff', (r) => `${r.employee_code} ${r.first_name}`) }] },
  zones: { key: 'zones', title: 'Zones', url: '/api/admin/zones', branch: true, subtitle: 'Map position is in % of the park map', fields: [
    { key: 'code', label: 'Code', required: true, list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'capacity', label: 'Capacity', type: 'number', default: 300, list: true },
    { key: 'color', label: 'Color', type: 'color', default: '#6366f1' }, { key: 'mapX', label: 'Map X %', type: 'number', default: 0 }, { key: 'mapY', label: 'Map Y %', type: 'number', default: 0 },
    { key: 'mapW', label: 'Map width %', type: 'number', default: 20 }, { key: 'mapH', label: 'Map height %', type: 'number', default: 20 }, { key: 'status', label: 'Status', type: 'select', options: ['ACTIVE', 'CLOSED'], default: 'ACTIVE', list: true }] },
  products: { key: 'products', title: 'Products', url: '/api/admin/products', fields: [
    { key: 'sku', label: 'SKU', required: true, list: true }, { key: 'barcode', label: 'Barcode', list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'nameEn', label: 'Name (EN)' },
    { key: 'categoryId', label: 'Category', type: 'ref', ref: ref('/api/admin/categories', (r) => `${r.name} (${r.type})`), list: (r) => r.category_name },
    { key: 'price', label: 'Price', type: 'money', required: true, list: true }, { key: 'memberPrice', label: 'Member price', type: 'money' }, { key: 'cost', label: 'Cost', type: 'money', default: 0 },
    { key: 'trackStock', label: 'Track stock', type: 'bool', default: false, list: true }, { key: 'lowStockThreshold', label: 'Low stock at', type: 'number', default: 10 },
    { key: 'sendToKitchen', label: 'Send to kitchen (KDS)', type: 'bool', default: false }, { key: 'sellableOnline', label: 'Booking add-on', type: 'bool', default: false },
    { key: 'modifiers', label: 'Modifiers', type: 'json', default: [], span: 2, hint: '[{"group":"Size","required":true,"max":1,"options":[{"name":"Large","price":3000}]}] (price in satang)' },
    { key: 'description', label: 'Description', type: 'textarea', span: 2 }, { key: 'imageUrl', label: 'Image URL', span: 2 }, { key: 'isActive', label: 'Active', type: 'bool', default: true, list: true }, { key: 'sort', label: 'Sort', type: 'number', default: 0 }] },
  stores: { key: 'stores', title: 'Stores / outlets', url: '/api/admin/stores', branch: true, fields: [
    { key: 'code', label: 'Code', required: true, list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'type', label: 'Type', type: 'select', options: ['TICKET', 'RESTAURANT', 'RETAIL', 'KIOSK', 'LOCKER', 'WAREHOUSE', 'RIDE', 'SERVICE'], list: true },
    { key: 'zoneId', label: 'Zone', type: 'ref', ref: zoneRef }, { key: 'isActive', label: 'Active', type: 'bool', default: true, list: true }],
    actions: (r) => r.type === 'RESTAURANT' ? <span className="flex gap-2 text-xs"><Link className="text-brand-600" to={`/kds/${r.id}`} target="_blank">KDS</Link><Link className="text-brand-600" to={`/order/${r.id}`} target="_blank">QR menu</Link></span> : null },
  categories: { key: 'categories', title: 'Categories', url: '/api/admin/categories', fields: [
    { key: 'code', label: 'Code', required: true, list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'type', label: 'Type', type: 'select', options: ['FOOD', 'DRINK', 'SOUVENIR', 'MERCHANDISE', 'PHOTO', 'LOCKER', 'SERVICE', 'ADDON'], list: true },
    { key: 'pointsCategory', label: 'Points category', type: 'select', options: ['TICKET', 'FOOD', 'RETAIL', 'TOPUP', 'PACKAGE', 'NONE'], default: 'RETAIL', list: true }, { key: 'sort', label: 'Sort', type: 'number', default: 0 }] },
  tiers: { key: 'tiers', title: 'Member tiers', url: '/api/admin/tiers', subtitle: 'Discounts are synced from membership product benefits', fields: [
    { key: 'code', label: 'Code', required: true, list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'rank', label: 'Rank', type: 'number', default: 0, list: true },
    { key: 'color', label: 'Color', type: 'color', default: '#64748b' }, { key: 'pointMultiplier', label: 'Point multiplier', type: 'number', default: 1, list: true },
    { key: 'ticketDiscountPct', label: 'Ticket discount %', type: 'number', default: 0, list: true }, { key: 'foodDiscountPct', label: 'Food discount %', type: 'number', default: 0, list: true },
    { key: 'retailDiscountPct', label: 'Retail discount %', type: 'number', default: 0, list: true }, { key: 'isActive', label: 'Active', type: 'bool', default: true }] },
  'membership-products': { key: 'membership-products', title: 'Membership products', url: '/api/admin/membership-products', actions: (r, _n, x) => <Button size="xs" variant="outline" onClick={() => x.openBenefits(r)}>Benefits</Button>, fields: [
    { key: 'code', label: 'Code', required: true, list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'tierId', label: 'Tier', type: 'ref', ref: ref('/api/admin/tiers', (r) => r.name, false), list: (r) => r.tier_name },
    { key: 'description', label: 'Description', type: 'textarea', span: 2 }, { key: 'imageUrl', label: 'Image URL' }, { key: 'cardDesign', label: 'Card design', type: 'json', default: {} },
    { key: 'registrationFee', label: 'Registration fee', type: 'money', default: 0 }, { key: 'annualFee', label: 'Annual fee', type: 'money', default: 0, list: true },
    { key: 'renewalPrice', label: 'Renewal price', type: 'money' }, { key: 'upgradePrice', label: 'Fixed upgrade price', type: 'money' }, { key: 'upgradeMode', label: 'Upgrade pricing', type: 'select', options: ['FULL', 'DIFFERENCE', 'PRORATED'], default: 'DIFFERENCE' },
    { key: 'validityUnit', label: 'Validity unit', type: 'select', options: ['DAY', 'MONTH', 'YEAR', 'LIFETIME'], default: 'YEAR', list: true }, { key: 'validityValue', label: 'Validity value', type: 'number', default: 1, list: true },
    { key: 'earlyRenewalDays', label: 'Early renewal window (days)', type: 'number', default: 30 }, { key: 'earlyRenewalDiscountPct', label: 'Early renewal discount %', type: 'number', default: 0 },
    { key: 'gracePeriodDays', label: 'Grace period (days)', type: 'number', default: 15 }, { key: 'pointMultiplier', label: 'Point multiplier', type: 'number' }, { key: 'visitLimit', label: 'Visit limit', type: 'number' },
    { key: 'physicalCardFee', label: 'Physical card fee', type: 'money', default: 0 }, { key: 'guestBenefits', label: 'Guest benefits', type: 'json', default: {} }, { key: 'freeItems', label: 'Free items', type: 'json', default: [] },
    { key: 'rideRights', label: 'Ride rights', type: 'json', default: [] }, { key: 'isActive', label: 'Active', type: 'bool', default: true, list: true }, { key: 'sort', label: 'Sort', type: 'number', default: 0 }] },
  promotions: { key: 'promotions', title: 'Promotions', url: '/api/admin/promotions', subtitle: 'Rule-based engine: lower priority runs first; non-stackable promotions are exclusive',
    actions: (r, _n, x) => r.requires_coupon ? <Button size="xs" variant="outline" onClick={() => x.openGenerate(r)}>Generate coupons</Button> : null, fields: [
      { key: 'name', label: 'Name', required: true, list: true, span: 2 }, { key: 'description', label: 'Description', type: 'textarea', span: 2 },
      { key: 'type', label: 'Type', type: 'select', options: ['PERCENT', 'AMOUNT', 'BUY_X_PAY_Y', 'FIXED_PRICE'], list: true }, { key: 'value', label: 'Value (% or ฿)', type: 'number', default: 0, list: true },
      { key: 'buyQty', label: 'Buy X', type: 'number' }, { key: 'payQty', label: 'Pay Y', type: 'number' }, { key: 'maxDiscount', label: 'Max discount', type: 'money' },
      { key: 'appliesTo', label: 'Applies to', type: 'select', options: ['ORDER', 'TICKET', 'FOOD', 'RETAIL', 'PACKAGE', 'PRODUCT'], default: 'ORDER', list: true },
      { key: 'conditions', label: 'Conditions', type: 'json', default: {}, span: 2, hint: 'min_qty, min_spend (satang), member_only, member_tier_codes[], channels[], package_ids[], product_ids[], ticket_type_codes[], min_days_before_visit, days_of_week[], time_start, time_end, birthday (DAY|MONTH), max_items' },
      { key: 'stackable', label: 'Stackable', type: 'bool', default: false, list: true }, { key: 'priority', label: 'Priority', type: 'number', default: 100, list: true },
      { key: 'startAt', label: 'Start', type: 'datetime' }, { key: 'endAt', label: 'End', type: 'datetime' }, { key: 'usageLimit', label: 'Usage limit', type: 'number' }, { key: 'usagePerMember', label: 'Usage per member', type: 'number' },
      { key: 'requiresCoupon', label: 'Requires coupon code', type: 'bool', default: false, list: true }, { key: 'isActive', label: 'Active', type: 'bool', default: true, list: true }] },
  coupons: { key: 'coupons', title: 'Coupons', url: '/api/admin/coupons', fields: [
    { key: 'code', label: 'Code', required: true, list: true }, { key: 'promotionId', label: 'Promotion', type: 'ref', ref: ref('/api/admin/promotions', (r) => r.name, false), list: (r) => r.promotion_name },
    { key: 'usageLimit', label: 'Usage limit', type: 'number', default: 1, list: true }, { key: 'expiresAt', label: 'Expires', type: 'datetime', list: true },
    { key: 'status', label: 'Status', type: 'select', options: ['ACTIVE', 'USED', 'EXPIRED', 'DISABLED'], default: 'ACTIVE', list: true }] },
  rewards: { key: 'rewards', title: 'Reward store', url: '/api/admin/rewards', fields: [
    { key: 'name', label: 'Name', required: true, list: true, span: 2 }, { key: 'description', label: 'Description', type: 'textarea', span: 2 }, { key: 'imageUrl', label: 'Image URL', span: 2 },
    { key: 'type', label: 'Type', type: 'select', options: ['DISCOUNT', 'FREE_TICKET', 'FOOD', 'DRINK', 'SOUVENIR', 'RIDE_PASS', 'LOCKER', 'UPGRADE', 'COUPON', 'WALLET_CREDIT'], list: true },
    { key: 'pointsRequired', label: 'Points required', type: 'number', required: true, list: true }, { key: 'stock', label: 'Stock', type: 'number', list: true }, { key: 'minTierRank', label: 'Min tier rank', type: 'number', default: 0 },
    { key: 'startAt', label: 'Start', type: 'datetime' }, { key: 'endAt', label: 'End', type: 'datetime' },
    { key: 'config', label: 'Config', type: 'json', default: {}, span: 2, hint: '{"promotion_id":"…"} for COUPON · {"ride_id":"…","uses":1} for RIDE_PASS · {"amount":10000} for WALLET_CREDIT' },
    { key: 'voucherValidDays', label: 'Voucher valid (days)', type: 'number', default: 30 }, { key: 'isActive', label: 'Active', type: 'bool', default: true, list: true }] },
  lockers: { key: 'lockers', title: 'Lockers', url: '/api/admin/lockers', branch: true, fields: [
    { key: 'code', label: 'Code', required: true, list: true }, { key: 'bank', label: 'Bank', list: true }, { key: 'size', label: 'Size', type: 'select', options: ['S', 'M', 'L', 'XL'], default: 'M', list: true },
    { key: 'zoneId', label: 'Zone', type: 'ref', ref: zoneRef }, { key: 'status', label: 'Status', type: 'select', options: ['AVAILABLE', 'OCCUPIED', 'OUT_OF_SERVICE', 'RESERVED'], default: 'AVAILABLE', list: true },
    { key: 'controllerType', label: 'Controller', type: 'select', options: ['SIMULATOR', 'NETWORK'], default: 'SIMULATOR' }, { key: 'controllerConfig', label: 'Controller config', type: 'json', default: {} }] },
  'locker-rates': { key: 'locker-rates', title: 'Locker rates', url: '/api/admin/locker-rates', branch: true, fields: [
    { key: 'size', label: 'Size', type: 'select', options: ['S', 'M', 'L', 'XL'], list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'durationMinutes', label: 'Duration (min, blank = all day)', type: 'number', list: true },
    { key: 'price', label: 'Price', type: 'money', required: true, list: true }, { key: 'isActive', label: 'Active', type: 'bool', default: true, list: true }, { key: 'sort', label: 'Sort', type: 'number', default: 0 }] },
  staff: { key: 'staff', title: 'Staff', url: '/api/admin/staff', fields: [
    { key: 'employeeCode', label: 'Employee code', required: true, list: true }, { key: 'firstName', label: 'First name', required: true, list: true }, { key: 'lastName', label: 'Last name' }, { key: 'nickname', label: 'Nickname', list: true },
    { key: 'roleId', label: 'Role', type: 'ref', ref: ref('/api/admin/roles', (r) => r.name, false), list: (r) => r.role_name }, { key: 'branchId', label: 'Branch (blank = HQ / all)', type: 'ref', ref: ref('/api/admin/branches', (r) => r.name), list: (r) => r.branch_name ?? 'HQ' },
    { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'pin', label: 'PIN (4–8 digits; blank = keep)', type: 'password' },
    { key: 'status', label: 'Status', type: 'select', options: ['ACTIVE', 'INACTIVE', 'LOCKED'], default: 'ACTIVE', list: true }] },
  branches: { key: 'branches', title: 'Branches', url: '/api/admin/branches', fields: [
    { key: 'code', label: 'Code', required: true, list: true }, { key: 'name', label: 'Name', required: true, list: true }, { key: 'nameEn', label: 'Name (EN)' }, { key: 'timezone', label: 'Timezone', default: 'Asia/Bangkok' },
    { key: 'address', label: 'Address', span: 2 }, { key: 'phone', label: 'Phone' }, { key: 'capacity', label: 'Maximum capacity', type: 'number', default: 2000, list: true },
    { key: 'openTime', label: 'Open', type: 'time', default: '10:00' }, { key: 'closeTime', label: 'Close', type: 'time', default: '20:00' }, { key: 'status', label: 'Status', type: 'select', options: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', list: true }] },
  'print-templates': { key: 'print-templates', title: 'Print templates', url: '/api/admin/print-templates', fields: [
    { key: 'name', label: 'Name', required: true, list: true }, { key: 'type', label: 'Type', type: 'select', options: ['RECEIPT', 'TICKET', 'WRISTBAND', 'MEMBER_CARD', 'KITCHEN'], list: true },
    { key: 'paper', label: 'Paper', type: 'select', options: ['58MM', '80MM', 'A4', 'WRISTBAND', 'CR80'], list: true }, { key: 'layout', label: 'Layout', type: 'json', default: {}, span: 2 }, { key: 'isDefault', label: 'Default', type: 'bool', default: false, list: true }] },
};

const GROUPS: Record<string, string[]> = {
  packages: ['packages', 'ticket-types'], rides: ['rides', 'scan-points'], products: ['products', 'stores', 'categories', 'print-templates'], tiers: ['tiers', 'membership-products'],
  promotions: ['promotions', 'coupons'], lockers: ['lockers', 'locker-rates'],
};

export function AdminPage() {
  const { entity = 'packages' } = useParams();
  const tabs = GROUPS[entity] ?? [entity];
  const [active, setActive] = useState(tabs[0]);
  const cur = tabs.includes(active) ? active : tabs[0];
  if (!ENTITIES[cur]) return <div>Unknown entity</div>;
  return (
    <div className="space-y-4">
      {tabs.length > 1 && <Tabs value={cur} onChange={setActive} tabs={tabs.map((t) => ({ value: t, label: ENTITIES[t].title }))} />}
      <CrudTable key={cur} def={ENTITIES[cur]} />
    </div>
  );
}

function useRefOptions(def: EntityDef, branchId: string | null) {
  const refs = def.fields.filter((f) => f.type === 'ref');
  const queries = useQuery({
    queryKey: ['ref-options', def.key, branchId],
    queryFn: async () => Object.fromEntries(await Promise.all(refs.map(async (f) => [f.key, await sapi.get(`${f.ref!.url}${qs({ branchId })}`).catch(() => [])]))),
    enabled: refs.length > 0,
  });
  return queries.data ?? {};
}

function CrudTable({ def }: { def: EntityDef }) {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [benefits, setBenefits] = useState<any>(null);
  const [tierPrices, setTierPrices] = useState<any>(null);
  const [gen, setGen] = useState<any>(null);
  const list = useQuery({ queryKey: ['crud', def.key, branchId, q], queryFn: () => sapi.get(`${def.url}${qs({ branchId, q })}`), enabled: !def.branch || !!branchId });
  const refOpts = useRefOptions(def, branchId);
  const cols = def.fields.filter((f) => f.list).map((f) => ({
    key: f.key, header: f.label,
    render: (r: any) => {
      if (typeof f.list === 'function') return f.list(r);
      const v = r[snake(f.key)];
      if (f.type === 'bool') return v ? <Badge tone="green">Yes</Badge> : <Badge tone="gray">No</Badge>;
      if (f.type === 'money') return v != null ? thb(v) : '-';
      if (f.type === 'datetime') return fmtDateTime(v);
      if (f.type === 'date') return fmtDate(v);
      if (f.type === 'select' && typeof v === 'string') return <Badge>{v}</Badge>;
      if (f.type === 'ref') { const o = (refOpts[f.key] ?? []).find((x: any) => x.id === v); return o ? f.ref!.label(o) : '-'; }
      return v ?? '-';
    },
  }));
  const remove = async (r: any) => {
    if (!confirm(`Delete ${r.name ?? r.code ?? r.id}?`)) return;
    try { await sapi.del(`${def.url}/${r.id}`); qc.invalidateQueries({ queryKey: ['crud', def.key] }); toast.success('Deleted'); } catch (e) { toast.error(errorMessage(e)); }
  };
  const extra: ExtraCtx = { openBenefits: setBenefits, openTierPrices: setTierPrices, openGenerate: setGen };
  return (
    <>
      <PageHeader title={def.title} subtitle={def.subtitle} actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({})}>New</Button>} />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-3"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        {list.isLoading ? <Loading /> : <Table dense rows={list.data ?? []} onRowClick={setEditing} columns={[...cols, {
          key: '_a', header: '', align: 'right', render: (r: any) => <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>{def.actions?.(r, nav, extra)}
            <Button size="xs" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="xs" variant="ghost" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button></span>,
        }]} />}
      </Card>
      {editing && <EntityForm def={def} row={editing} refOpts={refOpts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['crud', def.key] }); }} />}
      {benefits && <BenefitsEditor product={benefits} onClose={() => { setBenefits(null); qc.invalidateQueries({ queryKey: ['crud', def.key] }); }} />}
      {tierPrices && <TierPricesEditor ride={tierPrices} onClose={() => setTierPrices(null)} />}
      {gen && <GenerateCoupons promo={gen} onClose={() => setGen(null)} />}
    </>
  );
}

function toForm(def: EntityDef, row: any) {
  const out: Record<string, any> = {};
  for (const f of def.fields) {
    let v = row.id ? row[snake(f.key)] : f.default;
    if (f.type === 'money' && v != null) v = String(Number(v) / 100);
    if (f.type === 'json') v = JSON.stringify(v ?? f.default ?? null, null, 2);
    if (f.type === 'datetime' && v) v = new Date(v).toISOString().slice(0, 16);
    if (f.type === 'time' && v) v = String(v).slice(0, 5);
    if (f.type === 'password') v = '';
    out[f.key] = v ?? (f.type === 'bool' ? false : f.type === 'multiselect' ? [] : '');
  }
  return out;
}

function EntityForm({ def, row, refOpts, onClose, onSaved }: { def: EntityDef; row: any; refOpts: Record<string, any[]>; onClose: () => void; onSaved: () => void }) {
  const branchId = useBranchId();
  const [f, setF] = useState(() => toForm(def, row));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const body: Record<string, any> = {};
    try {
      for (const fd of def.fields) {
        let v = f[fd.key];
        if (fd.type === 'password') { if (v) body[fd.key] = v; continue; }
        if (v === '' || v === undefined) { if (row.id) body[fd.key] = null; continue; }
        if (fd.type === 'number') v = Number(v);
        if (fd.type === 'money') v = Math.round(Number(v) * 100);
        if (fd.type === 'json') v = JSON.parse(v);
        if (fd.type === 'datetime') v = new Date(v).toISOString();
        body[fd.key] = v;
      }
      for (const fd of def.fields) if (fd.required && (body[fd.key] === undefined || body[fd.key] === null)) throw new Error(`${fd.label} is required`);
      if (def.branch && !row.id) body.branchId = branchId;
      // nullable columns that must not be sent as null on create
      if (!row.id) for (const k of Object.keys(body)) if (body[k] === null) delete body[k];
    } catch (e) { return toast.error((e as Error).message); }
    setBusy(true);
    try {
      if (row.id) await sapi.patch(`${def.url}/${row.id}`, body); else await sapi.post(def.url, body);
      toast.success('Saved'); onSaved();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${row.id ? 'Edit' : 'New'} ${def.title.replace(/s$/, '')}`} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {def.fields.map((fd) => {
          const set = (v: any) => setF({ ...f, [fd.key]: v });
          const v = f[fd.key];
          const label = `${fd.label}${fd.required ? ' *' : ''}`;
          const span = fd.span === 2 || fd.type === 'json' || fd.type === 'textarea' ? 'sm:col-span-2' : '';
          if (fd.type === 'bool') return <div key={fd.key} className="flex items-end pb-2"><Toggle checked={!!v} onChange={set} label={fd.label} /></div>;
          return (
            <Field key={fd.key} label={label} hint={fd.hint} className={span}>
              {fd.type === 'select' ? <Select value={v ?? ''} onChange={(e) => set(e.target.value)}><option value="">—</option>{(fd.options ?? []).map((o: any) => typeof o === 'string' ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                : fd.type === 'ref' ? <Select value={v ?? ''} onChange={(e) => set(e.target.value)}><option value="">{fd.ref?.nullable === false ? 'Select…' : '— none —'}</option>{(refOpts[fd.key] ?? []).map((o: any) => <option key={o.id} value={o.id}>{fd.ref!.label(o)}</option>)}</Select>
                : fd.type === 'multiselect' ? <div className="flex flex-wrap gap-2">{(fd.options as string[]).map((o) => <label key={o} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={(v ?? []).includes(o)} onChange={(e) => set(e.target.checked ? [...(v ?? []), o] : (v ?? []).filter((x: string) => x !== o))} />{o}</label>)}</div>
                : fd.type === 'json' || fd.type === 'textarea' ? <Textarea rows={fd.type === 'json' ? 4 : 2} value={v ?? ''} onChange={(e) => set(e.target.value)} className={fd.type === 'json' ? 'font-mono text-xs' : ''} />
                : <Input type={fd.type === 'number' || fd.type === 'money' ? 'number' : fd.type === 'date' ? 'date' : fd.type === 'time' ? 'time' : fd.type === 'datetime' ? 'datetime-local' : fd.type === 'color' ? 'color' : fd.type === 'password' ? 'password' : 'text'}
                    step={fd.type === 'money' ? '0.01' : undefined} value={v ?? ''} onChange={(e) => set(e.target.value)} />}
            </Field>
          );
        })}
      </div>
    </Modal>
  );
}

const BENEFIT_TYPES = ['TICKET_DISCOUNT', 'FOOD_DISCOUNT', 'RETAIL_DISCOUNT', 'FREE_RIDE', 'FREE_LOCKER', 'BIRTHDAY_REWARD', 'PRIORITY_QUEUE', 'FAST_PASS', 'FREE_ADMISSION', 'GUEST_DISCOUNT', 'POINT_MULTIPLIER', 'PARKING', 'SPECIAL_EVENT', 'MEMBER_LOUNGE', 'CUSTOM'];
function BenefitsEditor({ product, onClose }: { product: any; onClose: () => void }) {
  const [rows, setRows] = useState<any[]>((product.benefits ?? []).map((b: any) => ({ type: b.type, value: b.value, label: b.label ?? '' })));
  return (
    <Modal open onClose={onClose} title={`Benefits · ${product.name}`} size="lg" footer={<Button onClick={async () => { try { await sapi.put(`/api/admin/membership-products/${product.id}/benefits`, rows.map((r) => ({ ...r, value: Number(r.value) }))); toast.success('Saved'); onClose(); } catch (e) { toast.error(errorMessage(e)); } }}>Save</Button>}>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_100px_1fr_40px] gap-2">
            <Select value={r.type} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>{BENEFIT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
            <Input type="number" value={r.value} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} title="% for discounts, multiplier for points" />
            <Input placeholder="Label shown to members" value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Button variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setRows([...rows, { type: 'TICKET_DISCOUNT', value: 0, label: '' }])}>+ Add benefit</Button>
      </div>
    </Modal>
  );
}

function TierPricesEditor({ ride, onClose }: { ride: any; onClose: () => void }) {
  const tiers = useQuery({ queryKey: ['tiers'], queryFn: () => sapi.get('/api/admin/tiers') });
  const cur = useQuery({ queryKey: ['tier-prices', ride.id], queryFn: () => sapi.get(`/api/admin/rides/${ride.id}/tier-prices`) });
  const [vals, setVals] = useState<Record<string, string>>({});
  const merged = useMemo(() => Object.fromEntries((cur.data ?? []).map((p: any) => [p.tier_id, String(p.price / 100)])), [cur.data]);
  const get = (id: string) => vals[id] ?? merged[id] ?? '';
  return (
    <Modal open onClose={onClose} title={`Tier add-on prices · ${ride.name}`} footer={<Button onClick={async () => {
      const body = (tiers.data ?? []).filter((t: any) => get(t.id) !== '').map((t: any) => ({ tierId: t.id, price: Math.round(Number(get(t.id)) * 100) }));
      try { await sapi.put(`/api/admin/rides/${ride.id}/tier-prices`, body); toast.success('Saved'); onClose(); } catch (e) { toast.error(errorMessage(e)); }
    }}>Save</Button>}>
      <div className="space-y-2">{tiers.data?.map((t: any) => <Field key={t.id} label={t.name}><Input type="number" step="0.01" placeholder="(normal price)" value={get(t.id)} onChange={(e) => setVals({ ...vals, [t.id]: e.target.value })} /></Field>)}</div>
    </Modal>
  );
}

function GenerateCoupons({ promo, onClose }: { promo: any; onClose: () => void }) {
  const [f, setF] = useState({ count: '50', prefix: '', usageLimit: '1' });
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <Modal open onClose={onClose} title={`Generate coupons · ${promo.name}`} footer={!codes && <Button onClick={async () => {
      try { const r = await sapi.post('/api/admin/coupons/generate', { promotionId: promo.id, count: Number(f.count), prefix: f.prefix, usageLimit: Number(f.usageLimit) }); setCodes(r.codes); } catch (e) { toast.error(errorMessage(e)); }
    }}>Generate</Button>}>
      {codes ? <Textarea rows={12} readOnly value={codes.join('\n')} className="font-mono text-xs" /> : (
        <div className="grid grid-cols-3 gap-3"><Field label="Count"><Input value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field>
          <Field label="Prefix"><Input value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase() })} /></Field>
          <Field label="Uses each"><Input value={f.usageLimit} onChange={(e) => setF({ ...f, usageLimit: e.target.value })} /></Field></div>
      )}
    </Modal>
  );
}
