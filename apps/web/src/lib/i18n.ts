import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'th' | 'en' | 'zh';

const D: Record<string, [string, string, string]> = {
  // [th, en, zh]
  appName: ['พีพี กรุ๊ป ธีมพาร์ค', 'PP Group Theme Park', 'PP集团主题乐园'],
  tagline: ['หนึ่ง QR — หนึ่งประสบการณ์', 'ONE QR — ONE EXPERIENCE', '一码 — 畅玩全程'],
  buyTickets: ['ซื้อตั๋ว', 'Buy Tickets', '购票'],
  bookNow: ['จองเลย', 'Book Now', '立即预订'],
  login: ['เข้าสู่ระบบ', 'Login', '登录'],
  register: ['สมัครสมาชิก', 'Register', '注册'],
  logout: ['ออกจากระบบ', 'Logout', '退出'],
  myAccount: ['บัญชีของฉัน', 'My Account', '我的账户'],
  membership: ['สมาชิก', 'Membership', '会员'],
  rides: ['เครื่องเล่น', 'Rides', '游乐设施'],
  selectBranch: ['เลือกสาขา', 'Select park', '选择园区'],
  selectDate: ['เลือกวันที่เข้า', 'Select visit date', '选择日期'],
  selectPackage: ['เลือกแพ็กเกจ', 'Select package', '选择套餐'],
  guests: ['จำนวนผู้เข้าชม', 'Guests', '人数'],
  addons: ['บริการเสริม', 'Add-ons', '附加服务'],
  details: ['ข้อมูลผู้จอง', 'Your details', '预订信息'],
  payment: ['ชำระเงิน', 'Payment', '付款'],
  continue: ['ถัดไป', 'Continue', '继续'],
  back: ['ย้อนกลับ', 'Back', '返回'],
  total: ['ยอดรวม', 'Total', '合计'],
  subtotal: ['รวม', 'Subtotal', '小计'],
  discount: ['ส่วนลด', 'Discount', '折扣'],
  coupon: ['คูปอง / โค้ดโปรโมชั่น', 'Coupon / promo code', '优惠码'],
  apply: ['ใช้', 'Apply', '使用'],
  continueGuest: ['ดำเนินการต่อแบบไม่เป็นสมาชิก', 'Continue as Guest', '以访客身份继续'],
  name: ['ชื่อ-นามสกุล', 'Full name', '姓名'],
  phone: ['เบอร์โทรศัพท์', 'Phone', '电话'],
  email: ['อีเมล', 'Email', '邮箱'],
  payNow: ['ชำระเงินตอนนี้', 'PAY NOW', '立即付款'],
  payAtPark: ['ชำระที่สวนสนุก', 'PAY AT PARK', '到园付款'],
  bookingConfirmed: ['การจองสำเร็จ', 'BOOKING CONFIRMED', '预订成功'],
  saveScreen: ['กรุณาบันทึกหน้าจอนี้เพื่อแสดงต่อพนักงาน', 'Please save this screen and show it to our staff', '请保存此页面并出示给工作人员'],
  paymentSuccess: ['ชำระเงินสำเร็จ', 'PAYMENT SUCCESSFUL', '支付成功'],
  waitingVerification: ['รอตรวจสอบการชำระเงิน', 'WAITING FOR VERIFICATION', '等待核验'],
  uploadSlip: ['อัปโหลดสลิป', 'Upload slip', '上传凭证'],
  checkPayment: ['ตรวจสอบการชำระเงิน', 'Check payment', '核验付款'],
  scanToPay: ['สแกน QR เพื่อชำระเงิน', 'Scan QR to pay', '扫码付款'],
  bookingNo: ['หมายเลขการจอง', 'Booking No.', '预订号'],
  visitDate: ['วันที่เข้าชม', 'Visit date', '游玩日期'],
  package: ['แพ็กเกจ', 'Package', '套餐'],
  paymentStatus: ['สถานะการชำระ', 'Payment status', '付款状态'],
  print: ['พิมพ์', 'Print', '打印'],
  // gate / scanner displays
  showQr: ['กรุณาแสดง QR Code / Barcode', 'Please show your QR Code / Barcode', '请出示二维码/条形码'],
  checking: ['กำลังตรวจสอบ…', 'Checking…', '验证中…'],
  granted: ['ผ่านได้', 'ACCESS GRANTED', '允许通行'],
  denied: ['ไม่สามารถผ่านได้', 'ACCESS DENIED', '禁止通行'],
  waitStaff: ['กรุณารอเจ้าหน้าที่ตรวจสอบ', 'Please wait for staff approval', '请等待工作人员确认'],
  welcome: ['ยินดีต้อนรับ', 'Welcome', '欢迎'],
  goodbye: ['ขอบคุณที่มาเที่ยว', 'Thank you for visiting', '感谢光临'],
  rideGranted: ['เข้าเล่นได้', 'RIDE ACCESS GRANTED', '可以游玩'],
  rideNotIncluded: ['แพ็กเกจของคุณไม่รวมเครื่องเล่นนี้', 'RIDE NOT INCLUDED', '您的套餐不包含此项目'],
  buyRide: ['ต้องการซื้อสิทธิ์เข้าเล่นหรือไม่?', 'Would you like to buy access?', '是否购买游玩权限？'],
  no: ['ไม่ต้องการ', 'No thanks', '不需要'],
  buyNow: ['ซื้อเลย', 'Buy now', '立即购买'],
  purchaseSuccess: ['ซื้อสำเร็จ', 'PURCHASE SUCCESSFUL', '购买成功'],
  waitingCash: ['รอชำระเงินสดกับเจ้าหน้าที่', 'WAITING FOR CASH PAYMENT', '等待现金支付'],
  tapCard: ['กรุณาแตะ / เสียบบัตรที่เครื่อง', 'Tap / insert your card on the terminal', '请在终端刷卡'],
  joinQueue: ['ต่อคิว', 'JOIN QUEUE', '排队'],
  peopleAhead: ['คนก่อนหน้า', 'ahead of you', '前面人数'],
  minutes: ['นาที', 'min', '分钟'],
  wallet: ['กระเป๋าเงิน', 'Wallet', '钱包'],
  balance: ['ยอดคงเหลือ', 'Balance', '余额'],
  points: ['แต้มสะสม', 'Points', '积分'],
  tickets: ['ตั๋ว', 'Tickets', '门票'],
  topup: ['เติมเงิน', 'Top-up', '充值'],
  checkBalance: ['เช็คยอดเงิน', 'Check balance', '查询余额'],
  buyFood: ['สั่งอาหาร', 'Order food', '点餐'],
  rideStatus: ['สถานะเครื่องเล่น', 'Ride status', '设施状态'],
  checkQueue: ['เช็คคิว', 'Check queue', '查询排队'],
  scanCard: ['กรุณาสแกนบัตร / ริสต์แบนด์', 'Please scan your card / wristband', '请扫描卡片/手环'],
  touchToStart: ['แตะหน้าจอเพื่อเริ่ม', 'Touch to start', '点击开始'],
  done: ['เสร็จสิ้น', 'Done', '完成'],
  cancel: ['ยกเลิก', 'Cancel', '取消'],
  confirm: ['ยืนยัน', 'Confirm', '确认'],
  open: ['เปิด', 'OPEN', '开放'],
  closed: ['ปิด', 'CLOSED', '关闭'],
  maintenance: ['ปิดปรับปรุง', 'MAINTENANCE', '维护中'],
  wait: ['รอ', 'Wait', '等待'],
  memberCard: ['บัตรสมาชิกดิจิทัล', 'Digital Member Card', '电子会员卡'],
  expires: ['หมดอายุ', 'Expires', '到期'],
  rewards: ['แลกของรางวัล', 'Rewards', '积分兑换'],
  history: ['ประวัติ', 'History', '记录'],
  profile: ['ข้อมูลส่วนตัว', 'Profile', '个人资料'],
  forgotPassword: ['ลืมรหัสผ่าน', 'Forgot password', '忘记密码'],
  password: ['รหัสผ่าน', 'Password', '密码'],
  phoneOrEmail: ['เบอร์โทร หรือ อีเมล', 'Phone or email', '电话或邮箱'],
  orderFood: ['สั่งอาหาร', 'Order Food', '点餐'],
  queueNo: ['หมายเลขคิว', 'Queue No.', '取餐号'],
  ready: ['พร้อมรับ', 'READY', '可取餐'],
  preparing: ['กำลังเตรียม', 'PREPARING', '制作中'],
};

interface LangState { lang: Lang; setLang: (l: Lang) => void }
export const useLang = create<LangState>()(persist((set) => ({ lang: 'th', setLang: (lang) => set({ lang }) }), { name: 'tp.lang' }));

export function t(key: keyof typeof D | string, lang: Lang = useLang.getState().lang): string {
  const e = D[key];
  if (!e) return key;
  return e[lang === 'th' ? 0 : lang === 'en' ? 1 : 2];
}
export function useT() {
  const lang = useLang((s) => s.lang);
  return (key: string) => t(key, lang);
}
/** bilingual: primary language + English helper */
export function useT2() {
  const lang = useLang((s) => s.lang);
  return (key: string) => (lang === 'en' ? t(key, 'en') : `${t(key, lang)}`);
}
export const LANGS: Array<{ code: Lang; label: string; flag: string }> = [
  { code: 'th', label: 'ไทย', flag: '🇹🇭' }, { code: 'en', label: 'English', flag: '🇬🇧' }, { code: 'zh', label: '中文', flag: '🇨🇳' },
];
