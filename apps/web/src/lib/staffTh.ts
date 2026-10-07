/**
 * Thai translations for the staff / back-office screens, keyed by the English UI text.
 * Applied by lib/staffI18n.ts. Enum values (ACTIVE, NO_SHOW…) are listed in TH_ENUM and also match their
 * spaced form ("NO SHOW") shown by badges.
 */
export const TH: Record<string, string> = {
  // ---- common
  'Cancel': 'ยกเลิก', 'Approve': 'อนุมัติ', 'Confirm': 'ยืนยัน', 'Save': 'บันทึก', 'Edit': 'แก้ไข', 'Delete': 'ลบ', 'Create': 'สร้าง', 'Search': 'ค้นหา',
  'Close': 'ปิด', 'Open': 'เปิด', 'Back': 'กลับ', 'Back camera': 'กล้องหลัง', 'Front camera': 'กล้องหน้า', 'Next': 'ถัดไป', 'Prev': 'ก่อนหน้า', 'Yes': 'ใช่', 'No': 'ไม่', 'Or': 'หรือ',
  'Loading…': 'กำลังโหลด…', 'No data': 'ไม่มีข้อมูล', 'No records': 'ไม่มีรายการ', 'Retry': 'ลองใหม่', 'Saved': 'บันทึกแล้ว', 'Deleted': 'ลบแล้ว',
  'Updated': 'อัปเดตแล้ว', 'Copied': 'คัดลอกแล้ว', 'Select…': 'เลือก…', '— none —': '— ไม่มี —', 'Default': 'ค่าเริ่มต้น', 'Clear': 'ล้าง', 'Reset': 'รีเซ็ต',
  'Remove': 'ลบออก', 'remove': 'ลบ', 'Print': 'พิมพ์', 'Upload': 'อัปโหลด', 'Generate': 'สร้าง', 'Record': 'บันทึก', 'Details': 'รายละเอียด', 'Note': 'หมายเหตุ',
  'Note:': 'หมายเหตุ:', 'Reason': 'เหตุผล', 'Reason?': 'เหตุผล?', 'Action': 'การกระทำ', 'Action:': 'การกระทำ:', 'Status': 'สถานะ', 'All status': 'ทุกสถานะ',
  'Type': 'ประเภท', 'All types': 'ทุกประเภท', 'Time': 'เวลา', 'Date': 'วันที่', 'Total': 'รวม', 'TOTAL': 'ยอดรวม', 'Subtotal': 'รวมย่อย', 'Discount': 'ส่วนลด',
  'Amount': 'จำนวนเงิน', 'Price': 'ราคา', 'Cost': 'ต้นทุน', 'Qty': 'จำนวน', 'Quantity': 'จำนวน', 'Count': 'จำนวน', 'Code': 'รหัส', 'Name': 'ชื่อ',
  'Name (EN)': 'ชื่อ (อังกฤษ)', 'Name (中文)': 'ชื่อ (จีน)', 'Description': 'รายละเอียด', 'Image URL': 'ลิงก์รูปภาพ', 'Active': 'ใช้งาน', 'Enabled': 'เปิดใช้งาน',
  'Sort': 'ลำดับ', 'Color': 'สี', 'Size': 'ขนาด', 'Location': 'ตำแหน่ง', 'Device': 'อุปกรณ์', 'Branch': 'สาขา', 'Store': 'ร้าน', 'Zone': 'โซน', 'Rank': 'ลำดับขั้น',
  'Category': 'หมวดหมู่', 'Categories': 'หมวดหมู่', 'All categories': 'ทุกหมวดหมู่', 'Method': 'วิธีชำระ', 'Ref': 'อ้างอิง', 'Reference': 'อ้างอิง', 'Result': 'ผลลัพธ์',
  'All results': 'ทุกผลลัพธ์', 'Before': 'ก่อน', 'After': 'หลัง', 'BEFORE': 'ก่อน', 'AFTER': 'หลัง', 'METADATA': 'ข้อมูลเพิ่มเติม', 'From': 'จาก', 'To': 'ถึง',
  'Start': 'เริ่ม', 'End': 'สิ้นสุด', 'until': 'ถึง', 'Today': 'วันนี้', 'Online': 'ออนไลน์', 'Offline': 'ออฟไลน์', 'Error': 'ผิดพลาด', 'Unknown entity': 'ไม่รู้จักข้อมูลนี้',
  'Profile': 'โปรไฟล์', 'Overview': 'ภาพรวม', 'History': 'ประวัติ', 'Item': 'รายการ', 'Items': 'รายการ', 'Config': 'ค่าตั้ง', 'Controls': 'ควบคุม', 'Paper': 'กระดาษ',
  'Layout': 'รูปแบบ', 'Mode': 'โหมด', 'Number': 'หมายเลข', 'Direction': 'ทิศทาง', 'Key': 'คีย์', 'Prefix': 'คำนำหน้า', 'Custom': 'กำหนดเอง', 'Lifetime': 'ตลอดชีพ',
  'Basic': 'พื้นฐาน', 'Guest': 'ลูกค้าทั่วไป', 'guests': 'คน', 'Guests': 'จำนวนคน', 'Party': 'กลุ่ม', 'pts': 'แต้ม', 'points': 'แต้ม', 'stock': 'คงเหลือ', 'has': 'มี',
  'manual': 'ด้วยมือ', 'm': 'น.', 'No.': 'ลำดับ', 'Txn': 'รายการ', 'Credit': 'เข้า', 'Debit': 'ออก', 'Old': 'เดิม', 'New': 'ใหม่', 'Visit': 'วันเข้าชม',
  'Escape': 'Esc', 'Go': 'ไป', 'Enter': 'Enter', 'change': 'เปลี่ยน', 'Text size': 'ขนาดตัวอักษร', 'Smaller text': 'ตัวอักษรเล็กลง', 'Larger text': 'ตัวอักษรใหญ่ขึ้น',
  'Reset text size': 'คืนขนาดตัวอักษร', 'Language': 'ภาษา',

  // ---- approvals
  'Manager approval granted': 'ผู้จัดการอนุมัติแล้ว', 'Manager approval required': 'ต้องให้ผู้จัดการอนุมัติ', 'Manager employee code': 'รหัสพนักงานผู้จัดการ',
  'Manager PIN': 'PIN ผู้จัดการ', 'Reason for approval': 'เหตุผลในการอนุมัติ', 'Approver': 'ผู้อนุมัติ', 'Approved — confirm payment again': 'อนุมัติแล้ว — กรุณายืนยันการชำระอีกครั้ง',

  // ---- scanner / camera
  'Camera not supported': 'อุปกรณ์นี้ไม่รองรับกล้อง', 'Camera needs HTTPS': 'กล้องต้องใช้งานผ่าน HTTPS',
  'Camera permission denied — allow camera access in the browser': 'ไม่ได้รับอนุญาตให้ใช้กล้อง — กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์',
  'No camera found': 'ไม่พบกล้อง', 'Camera unavailable': 'ใช้กล้องไม่ได้', 'USB / 2D scanners still work': 'ยังใช้เครื่องสแกน USB / 2D ได้ตามปกติ',
  'Switch to front camera': 'สลับเป็นกล้องหน้า', 'Switch to back camera': 'สลับเป็นกล้องหลัง',
  'Scan card / wristband / QR or type code': 'สแกนบัตร / ริสต์แบนด์ / QR หรือพิมพ์รหัส', 'Lookup': 'ค้นหา', 'Camera': 'กล้อง', 'Scan with camera': 'สแกนด้วยกล้อง',

  // ---- card profile
  'Wallet': 'กระเป๋าเงิน', 'Tickets': 'ตั๋ว', 'Ticket': 'ตั๋ว', 'Rides': 'เครื่องเล่น', 'Ride': 'เครื่องเล่น', 'Orders': 'คำสั่งซื้อ', 'Order': 'คำสั่งซื้อ',
  'Transactions': 'ธุรกรรม', 'Points': 'แต้ม', 'Credential': 'บัตร', 'Issued': 'ออกเมื่อ', 'Expires': 'หมดอายุ', 'No expiry': 'ไม่มีวันหมดอายุ', 'Serial': 'เลขบัตร',
  'Member': 'สมาชิก', 'Phone': 'เบอร์โทร', 'Membership': 'สมาชิกภาพ', 'Linked credentials': 'บัตรที่เชื่อมอยู่', 'Active package & ride rights': 'แพ็กเกจและสิทธิ์เครื่องเล่นที่ใช้ได้',
  'No ride rights': 'ไม่มีสิทธิ์เครื่องเล่น', 'Queue': 'คิว', 'Not in queue': 'ไม่ได้อยู่ในคิว', 'Locker': 'ล็อกเกอร์', 'No locker': 'ไม่มีล็อกเกอร์', 'Package': 'แพ็กเกจ',
  'Presence': 'ตำแหน่ง', 'Entries': 'จำนวนเข้า', 'Balance': 'ยอดคงเหลือ', 'Gate scans': 'การสแกนที่เกต', 'Gate': 'เกต', 'Card replacements': 'การเปลี่ยนบัตร',

  // ---- link card
  'Link card': 'เชื่อมบัตร', 'Card number / barcode': 'เลขบัตร / บาร์โค้ด', 'Card number': 'เลขบัตร',
  "Scan the customer's card with the camera or a USB scanner, or type the number printed on the card.": 'สแกนบัตรของลูกค้าด้วยกล้องหรือเครื่องสแกน USB หรือพิมพ์เลขที่พิมพ์อยู่บนบัตร',
  'Existing card (scan to link — optional)': 'บัตรที่ลูกค้ามีอยู่แล้ว (สแกนเพื่อเชื่อม — ไม่บังคับ)', 'Scan / type the card number': 'สแกน / พิมพ์เลขบัตร',

  // ---- payment
  'Cash': 'เงินสด', 'PromptPay': 'พร้อมเพย์', 'Credit Card': 'บัตรเครดิต', 'Debit Card': 'บัตรเดบิต', 'E-Wallet': 'อี-วอลเล็ต', 'Park Wallet': 'กระเป๋าเงินสวนสนุก',
  'Payment': 'ชำระเงิน', 'Invalid amount': 'จำนวนเงินไม่ถูกต้อง', 'Tendered less than amount': 'รับเงินน้อยกว่ายอดที่ต้องชำระ',
  'Scan card / wristband for wallet payment': 'สแกนบัตร / ริสต์แบนด์เพื่อชำระด้วยกระเป๋าเงิน', 'Scan card for wallet': 'สแกนบัตรเพื่อใช้กระเป๋าเงิน',
  'Amount (blank = remaining)': 'จำนวนเงิน (เว้นว่าง = ยอดที่เหลือ)', 'Cash tendered': 'รับเงินมา', 'Approval / reference no.': 'เลขอนุมัติ / อ้างอิง', 'Change': 'เงินทอน',
  'Customer scans with any banking app.': 'ลูกค้าสแกนด้วยแอปธนาคารใดก็ได้', 'Confirm after the bank notification arrives.': 'กดยืนยันหลังได้รับแจ้งเตือนจากธนาคาร',
  'Card': 'บัตร', 'Member points:': 'แต้มสมาชิก:', '+ Add as split payment': '+ เพิ่มเป็นการแบ่งชำระ', 'Remaining': 'คงเหลือ', 'VAT included': 'รวม VAT แล้ว',
  'Points earned': 'แต้มที่ได้รับ', 'QUEUE': 'คิว', 'Payment received': 'รับชำระแล้ว', 'Payment complete': 'ชำระเงินเรียบร้อย', 'Charge': 'เรียกเก็บเงิน',
  'Ticket is valid only with server verification. Non-transferable. Terms apply.': 'ตั๋วใช้ได้เมื่อผ่านการตรวจสอบจากระบบเท่านั้น ห้ามโอน เป็นไปตามเงื่อนไข',

  // ---- navigation / layout
  'Dashboard': 'แดชบอร์ด', 'All Branches': 'ทุกสาขา', 'Live Park Map': 'แผนที่สวนสด', 'Notifications': 'การแจ้งเตือน', 'Operations': 'งานปฏิบัติการ',
  'Ticket Counter': 'เคาน์เตอร์ขายตั๋ว', 'POS': 'POS ขายสินค้า', 'Gate Console': 'คอนโซลเกต', 'Cards & Wristbands': 'บัตรและริสต์แบนด์', 'Lockers': 'ล็อกเกอร์',
  'Shift': 'กะงาน', 'Customers & Sales': 'ลูกค้าและการขาย', 'Bookings': 'การจอง', 'Payment Verification': 'ตรวจสอบการชำระเงิน', 'Members': 'สมาชิก',
  'Inventory': 'สต็อกสินค้า', 'Reports': 'รายงาน', 'Entry Log': 'บันทึกการเข้า', 'Audit Log': 'บันทึกการใช้งาน', 'Configuration': 'ตั้งค่าระบบ',
  'Packages & Tickets': 'แพ็กเกจและตั๋ว', 'Rides & Scan Points': 'เครื่องเล่นและจุดสแกน', 'Gates': 'เกต', 'Zones': 'โซน', 'Products & Stores': 'สินค้าและร้านค้า',
  'Promotions & Coupons': 'โปรโมชั่นและคูปอง', 'Rewards': 'ของรางวัล', 'Devices': 'อุปกรณ์', 'Staff': 'พนักงาน', 'Roles & Permissions': 'บทบาทและสิทธิ์',
  'Branches': 'สาขา', 'Settings': 'ตั้งค่า', 'Customer Kiosk': 'ตู้คีออสก์ลูกค้า', 'Device Setup': 'ตั้งค่าอุปกรณ์', 'Management Platform': 'ระบบบริหารจัดการ',
  'No open shift': 'ยังไม่เปิดกะ', 'Logout': 'ออกจากระบบ',

  // ---- admin entities
  'Packages': 'แพ็กเกจ', 'Sellable tickets / packages — prices, rides & zones in the composition editor': 'ตั๋ว / แพ็กเกจที่ขาย — ตั้งราคา เครื่องเล่น และโซนได้ในหน้าจัดองค์ประกอบ',
  'Composition': 'องค์ประกอบ', 'Pricing': 'รูปแบบราคา', 'Bundle price': 'ราคาชุด', 'Bundle member price': 'ราคาชุดสำหรับสมาชิก', 'Bundle guests': 'จำนวนคนในชุด',
  'Days': 'จำนวนวัน', 'Multi-day mode': 'รูปแบบหลายวัน', 'Any within (days)': 'ใช้ได้ภายใน (วัน)', 'Valid from': 'ใช้ได้ตั้งแต่', 'Valid to': 'ใช้ได้ถึง',
  'Valid days (0=Sun)': 'วันที่ใช้ได้ (0=อาทิตย์)', 'Valid time start': 'เวลาเริ่มใช้', 'Valid time end': 'เวลาสิ้นสุด', 'Sale start': 'เริ่มขาย', 'Sale end': 'สิ้นสุดการขาย',
  'Min age': 'อายุขั้นต่ำ', 'Max age': 'อายุสูงสุด', 'Min height (cm)': 'ส่วนสูงขั้นต่ำ (ซม.)', 'Max height (cm)': 'ส่วนสูงสูงสุด (ซม.)', 'Min height': 'ส่วนสูงขั้นต่ำ',
  'Max height': 'ส่วนสูงสูงสุด', 'Entries per day': 'จำนวนครั้งที่เข้าได้ต่อวัน', 'Re-entry allowed': 'อนุญาตให้กลับเข้าใหม่', 'Transferable': 'โอนสิทธิ์ได้',
  'Ride access': 'สิทธิ์เครื่องเล่น', 'ALL-rides entitlement': 'สิทธิ์เล่นทุกเครื่อง', 'ALL-rides uses': 'จำนวนครั้ง (ทุกเครื่อง)', 'Zone access': 'สิทธิ์เข้าโซน',
  'Refund policy': 'นโยบายคืนเงิน', 'Refund %': 'คืนเงิน %', 'Refund cut-off (h)': 'คืนเงินได้ก่อน (ชม.)', 'Daily capacity': 'จำนวนรับได้ต่อวัน',
  'Wallet credit included': 'เครดิตกระเป๋าเงินที่แถม', 'Member card can enter': 'ใช้บัตรสมาชิกเข้าได้', 'Earn points': 'ได้รับแต้ม', 'Channels': 'ช่องทางขาย',
  'Ticket types (guest categories)': 'ประเภทผู้เข้าชม', 'Requires ID': 'ต้องแสดงบัตร', 'Tier prices': 'ราคาตามระดับสมาชิก', 'Capacity / cycle': 'จำนวนคนต่อรอบ',
  'Duration (min)': 'ระยะเวลา (นาที)', 'Sell add-on at scanner': 'ขายสิทธิ์เพิ่มที่เครื่องสแกน', 'Add-on price': 'ราคาสิทธิ์เพิ่ม', 'Member price': 'ราคาสมาชิก',
  'Peak price': 'ราคาช่วงพีค', 'Add-on entitlement': 'ประเภทสิทธิ์เพิ่ม', 'Add-on uses': 'จำนวนครั้งของสิทธิ์เพิ่ม', 'Point requirement': 'แต้มที่ต้องใช้',
  'Virtual queue': 'คิวเสมือน', 'Queue prefix': 'อักษรนำหน้าคิว', 'Call window (min)': 'เวลารอเรียก (นาที)', 'Operator': 'ผู้ควบคุม', 'Ride scan points': 'จุดสแกนเครื่องเล่น',
  'Payment enabled': 'เปิดรับชำระเงิน', 'Payment methods': 'วิธีชำระเงิน',
  'Hardware adapter per gate — switch SIMULATOR → real controller without code changes': 'ตั้งค่าฮาร์ดแวร์แต่ละเกต — เปลี่ยนจากตัวจำลองเป็นตัวควบคุมจริงได้โดยไม่ต้องแก้โค้ด',
  'Controller': 'ตัวควบคุม', 'Controller config': 'ค่าตัวควบคุม', 'Open duration (ms)': 'ระยะเวลาเปิด (ms)', 'Block new entry': 'ระงับการเข้าใหม่',
  'Map position is in % of the park map': 'ตำแหน่งบนแผนที่เป็น % ของแผนที่สวน', 'Capacity': 'ความจุ', 'Map X %': 'แผนที่ X %', 'Map Y %': 'แผนที่ Y %',
  'Map width %': 'ความกว้างบนแผนที่ %', 'Map height %': 'ความสูงบนแผนที่ %', 'Products': 'สินค้า', 'Product': 'สินค้า', 'Barcode': 'บาร์โค้ด', 'Track stock': 'ติดตามสต็อก',
  'Low stock at': 'แจ้งเตือนสต็อกต่ำเมื่อเหลือ', 'Send to kitchen (KDS)': 'ส่งเข้าครัว (KDS)', 'Booking add-on': 'บริการเสริมตอนจอง', 'Modifiers': 'ตัวเลือกเพิ่มเติม',
  'Stores / outlets': 'ร้านค้า / จุดขาย', 'QR menu': 'เมนู QR', 'Points category': 'หมวดแต้ม', 'Member tiers': 'ระดับสมาชิก',
  'Discounts are synced from membership product benefits': 'ส่วนลดจะซิงก์จากสิทธิประโยชน์ของผลิตภัณฑ์สมาชิก', 'Point multiplier': 'ตัวคูณแต้ม',
  'Ticket discount %': 'ส่วนลดตั๋ว %', 'Food discount %': 'ส่วนลดอาหาร %', 'Retail discount %': 'ส่วนลดสินค้า %', 'Membership products': 'ผลิตภัณฑ์สมาชิก',
  'Benefits': 'สิทธิประโยชน์', 'Tier': 'ระดับ', 'Card design': 'ดีไซน์บัตร', 'Registration fee': 'ค่าสมัคร', 'Annual fee': 'ค่าสมาชิกรายปี', 'Renewal price': 'ราคาต่ออายุ',
  'Fixed upgrade price': 'ราคาอัปเกรดคงที่', 'Upgrade pricing': 'วิธีคิดราคาอัปเกรด', 'Validity unit': 'หน่วยอายุสมาชิก', 'Validity value': 'อายุสมาชิก',
  'Early renewal window (days)': 'ต่ออายุล่วงหน้าได้ (วัน)', 'Early renewal discount %': 'ส่วนลดต่ออายุล่วงหน้า %', 'Grace period (days)': 'ระยะผ่อนผัน (วัน)',
  'Visit limit': 'จำกัดจำนวนครั้งเข้า', 'Physical card fee': 'ค่าบัตรจริง', 'Guest benefits': 'สิทธิ์สำหรับผู้ติดตาม', 'Free items': 'ของแถม', 'Ride rights': 'สิทธิ์เครื่องเล่น',
  'Promotions': 'โปรโมชั่น', 'Promotion': 'โปรโมชั่น', 'Rule-based engine: lower priority runs first; non-stackable promotions are exclusive': 'ระบบโปรโมชั่นตามเงื่อนไข: ลำดับต่ำทำงานก่อน โปรที่ใช้ร่วมไม่ได้จะใช้เดี่ยว',
  'Generate coupons': 'สร้างคูปอง', 'Value (% or ฿)': 'มูลค่า (% หรือ ฿)', 'Buy X': 'ซื้อ X', 'Pay Y': 'จ่าย Y', 'Max discount': 'ส่วนลดสูงสุด', 'Applies to': 'ใช้กับ',
  'Conditions': 'เงื่อนไข', 'Stackable': 'ใช้ร่วมกับโปรอื่นได้', 'Priority': 'ลำดับความสำคัญ', 'Usage limit': 'จำกัดจำนวนการใช้', 'Usage per member': 'จำกัดต่อสมาชิก',
  'Requires coupon code': 'ต้องใช้โค้ดคูปอง', 'Coupons': 'คูปอง', 'Coupon': 'คูปอง', 'Coupon code': 'โค้ดคูปอง', 'Reward store': 'ร้านแลกของรางวัล', 'Points required': 'แต้มที่ใช้แลก',
  'Stock': 'สต็อก', 'Min tier rank': 'ระดับสมาชิกขั้นต่ำ', 'Voucher valid (days)': 'บัตรกำนัลใช้ได้ (วัน)', 'Bank': 'ธนาคาร', 'Locker rates': 'อัตราค่าล็อกเกอร์',
  'Duration (min, blank = all day)': 'ระยะเวลา (นาที, เว้นว่าง = ทั้งวัน)', 'Employee code': 'รหัสพนักงาน', 'First name': 'ชื่อ', 'Last name': 'นามสกุล',
  'Nickname': 'ชื่อเล่น', 'Role': 'บทบาท', 'Branch (blank = HQ / all)': 'สาขา (เว้นว่าง = สำนักงานใหญ่ / ทุกสาขา)', 'Email': 'อีเมล',
  'PIN (4–8 digits; blank = keep)': 'PIN (4–8 หลัก; เว้นว่าง = ใช้ค่าเดิม)', 'Timezone': 'เขตเวลา', 'Address': 'ที่อยู่', 'Maximum capacity': 'ความจุสูงสุด',
  'Print templates': 'แม่แบบการพิมพ์', '% for discounts, multiplier for points': '% สำหรับส่วนลด, ตัวคูณสำหรับแต้ม', 'Label shown to members': 'ข้อความที่แสดงให้สมาชิกเห็น',
  '+ Add benefit': '+ เพิ่มสิทธิประโยชน์', '+ Benefit': '+ สิทธิประโยชน์', '(normal price)': '(ราคาปกติ)', 'Uses each': 'ใช้ได้ใบละ', 'Device Management': 'จัดการอุปกรณ์',
  'Register device': 'ลงทะเบียนอุปกรณ์', 'Device ID': 'รหัสอุปกรณ์', 'Last seen': 'ออนไลน์ล่าสุด', 'Issue a new key? The old key stops working.': 'ออกคีย์ใหม่หรือไม่? คีย์เดิมจะใช้ไม่ได้ทันที',
  'Re-issue key': 'ออกคีย์ใหม่', 'Issue key': 'ออกคีย์', 'Device API key': 'คีย์ API ของอุปกรณ์',
  'Copy this key now — it is shown only once. Paste it in': 'คัดลอกคีย์นี้ตอนนี้ — จะแสดงเพียงครั้งเดียว แล้วนำไปวางที่', 'on the device.': 'บนอุปกรณ์',
  'Package composition saved': 'บันทึกองค์ประกอบแพ็กเกจแล้ว', 'Save composition': 'บันทึกองค์ประกอบ', 'Prices per guest type': 'ราคาตามประเภทผู้เข้าชม',
  'Price ฿': 'ราคา ฿', 'Member ฿': 'สมาชิก ฿', 'Ride entitlements': 'สิทธิ์เครื่องเล่น', 'Ride access is': 'สิทธิ์เครื่องเล่นเป็น',
  '. Change “Ride access” to SELECT on the package to pick individual rides.': ' — เปลี่ยน “สิทธิ์เครื่องเล่น” เป็น SELECT ที่แพ็กเกจเพื่อเลือกทีละเครื่อง',
  'Zones (when zone access = SELECT)': 'โซน (เมื่อสิทธิ์เข้าโซน = SELECT)', 'Blackout dates': 'วันงดใช้', 'YYYY-MM-DD (one per line)': 'YYYY-MM-DD (บรรทัดละวัน)',
  'Custom role': 'บทบาทกำหนดเอง', 'This role has': 'บทบาทนี้มี', 'all permissions (*)': 'สิทธิ์ทั้งหมด (*)', 'Select a role': 'เลือกบทบาท', 'New custom role': 'สร้างบทบาทใหม่',
  'Approval level (≥50 approver)': 'ระดับการอนุมัติ (≥50 = อนุมัติได้)',

  // ---- settings
  'System Settings': 'ตั้งค่าระบบ', 'Dynamic configuration — no code changes required': 'ปรับค่าได้ทันที — ไม่ต้องแก้โค้ด', 'Global defaults': 'ค่าเริ่มต้นทุกสาขา',
  'This branch override': 'ค่าเฉพาะสาขานี้', 'Settings saved': 'บันทึกการตั้งค่าแล้ว', 'Park information & language': 'ข้อมูลสวนสนุกและภาษา', 'Park capacity': 'ความจุสวนสนุก',
  'Wallet policy': 'นโยบายกระเป๋าเงิน', 'Member points': 'แต้มสมาชิก', 'Manager approval': 'การอนุมัติของผู้จัดการ', 'Offline handling': 'การทำงานออฟไลน์', 'Booking': 'การจอง',
  'Ride pricing (peak)': 'ราคาเครื่องเล่น (ช่วงพีค)', 'Wristband': 'ริสต์แบนด์', 'Receipt': 'ใบเสร็จ', 'Printer': 'เครื่องพิมพ์', 'Fonts': 'ฟอนต์', 'Security': 'ความปลอดภัย',
  'Language & text size': 'ภาษาและขนาดตัวอักษร', 'Staff screens language': 'ภาษาหน้าจอพนักงาน', 'Text size (%)': 'ขนาดตัวอักษร (%)',
  'Customer website & portal': 'เว็บไซต์และหน้าสมาชิก', 'Back office': 'หน้าจอพนักงาน / หลังบ้าน', 'POS & kitchen': 'POS และครัว', 'Kiosk & ride scanners': 'คีออสก์และเครื่องสแกนเครื่องเล่น',
  'Gate displays': 'จอหน้าเกต', 'Default for every device; each person can still switch TH / EN and A− / A+ in the top bar.': 'ค่าเริ่มต้นของทุกเครื่อง พนักงานแต่ละคนยังสลับ TH / EN และ A− / A+ ได้ที่แถบด้านบน',
  'Preview': 'ตัวอย่าง', 'Kiosk language buttons:': 'ปุ่มภาษาที่คีออสก์:', '. Default language for this browser:': ' ภาษาเริ่มต้นของเบราว์เซอร์นี้:',
  'Money values are in satang (1 THB = 100). Branch overrides merge on top of global defaults.': 'จำนวนเงินมีหน่วยเป็นสตางค์ (1 บาท = 100) ค่าเฉพาะสาขาจะทับค่าเริ่มต้นทุกสาขา',
  '(satang)': '(สตางค์)', 'Upload custom font (TTF / OTF / WOFF / WOFF2)': 'อัปโหลดฟอนต์ (TTF / OTF / WOFF / WOFF2)', 'Font family name': 'ชื่อฟอนต์', 'Font uploaded': 'อัปโหลดฟอนต์แล้ว',

  // settings fields (labels generated from setting keys)
  'Logo Url': 'ลิงก์โลโก้', 'Currency': 'สกุลเงิน', 'Tax Rate': 'อัตราภาษี (%)', 'Tax Included': 'ราคารวมภาษีแล้ว', 'Default Language': 'ภาษาเริ่มต้น', 'Languages': 'ภาษาที่เปิดใช้',
  'Support Phone': 'เบอร์ติดต่อ', 'Website': 'เว็บไซต์', 'Warn Percents': 'แจ้งเตือนที่ (%)', 'Stop Online Sales When Full': 'หยุดขายออนไลน์เมื่อเต็ม', 'Block Entry When Full': 'ระงับการเข้าเมื่อเต็ม',
  'Approval Timeout Sec': 'หมดเวลาอนุมัติ (วินาที)', 'Display Result Ms': 'แสดงผลบนจอ (ms)', 'Anti Passback': 'ป้องกันการใช้บัตรซ้ำ (Anti-passback)', 'Require Inside For Rides': 'ต้องเข้าสวนก่อนเล่นเครื่องเล่น',
  'Member Card Entry': 'ใช้บัตรสมาชิกเข้าได้', 'Booking Credential At Gate': 'ใช้ QR การจองที่เกตได้', 'Notify Duplicate': 'แจ้งเตือนเมื่อสแกนซ้ำ', 'Remaining Balance Policy': 'นโยบายยอดเงินคงเหลือ',
  'Refund Fee Percent': 'ค่าธรรมเนียมคืนเงิน (%)', 'Topup Presets': 'ปุ่มเติมเงินด่วน', 'Min Topup': 'เติมเงินขั้นต่ำ', 'Max Topup': 'เติมเงินสูงสุด', 'Max Balance': 'ยอดเงินสูงสุด',
  'Earn Amount': 'ทุกยอดใช้จ่าย', 'Earn Points': 'ได้รับแต้ม', 'Redeem Value': 'มูลค่าต่อแต้ม', 'Required': 'ต้องอนุมัติ', 'Discount Limit Percent': 'ส่วนลดสูงสุดโดยไม่ต้องอนุมัติ (%)',
  'Over Short Tolerance': 'เงินเกิน/ขาดที่ยอมรับได้', 'Approval Valid Minutes': 'การอนุมัติใช้ได้ (นาที)', 'Allowed Actions': 'การกระทำที่อนุญาต', 'Blocked Actions': 'การกระทำที่ห้าม',
  'Methods': 'วิธีชำระเงิน', 'Counter': 'เคาน์เตอร์', 'Slip Verification': 'ตรวจสอบสลิป', 'Online Payment Timeout Min': 'หมดเวลาชำระออนไลน์ (นาที)', 'Max Guests': 'จำนวนคนสูงสุด',
  'Advance Days': 'จองล่วงหน้าได้ (วัน)', 'Pay At Park Enabled': 'เปิดให้ชำระที่สวน', 'Shared Wallet On Checkin': 'ใช้กระเป๋าเงินร่วมตอนเช็คอิน', 'Guest Checkout': 'จองได้โดยไม่เป็นสมาชิก',
  'Max Active Per Account': 'คิวที่ถือได้ต่อบัญชี', 'Long Queue Alert Min': 'แจ้งเตือนคิวยาวเกิน (นาที)', 'Peak Days': 'วันพีค', 'Peak Hours': 'ช่วงเวลาพีค', 'Digital Card Enabled': 'เปิดบัตรสมาชิกดิจิทัล',
  'Dynamic Qr': 'QR เปลี่ยนอัตโนมัติ', 'Digital Card Entry': 'ใช้บัตรดิจิทัลเข้าสวนได้', 'Expiry Reminder Days': 'แจ้งเตือนก่อนหมดอายุ (วัน)', 'Default Expiration': 'การหมดอายุเริ่มต้น',
  'Template': 'แม่แบบ', 'Show Logo': 'แสดงโลโก้', 'Show Qr': 'แสดง QR', 'Show Barcode': 'แสดงบาร์โค้ด', 'Require For Cash': 'ต้องเปิดกะก่อนรับเงินสด', 'Allow Negative': 'อนุญาตสต็อกติดลบ',
  'Header': 'หัวใบเสร็จ', 'Footer': 'ท้ายใบเสร็จ', 'Tax Id': 'เลขประจำตัวผู้เสียภาษี', 'Receipt Connection': 'การเชื่อมต่อเครื่องพิมพ์ใบเสร็จ', 'Ticket Connection': 'การเชื่อมต่อเครื่องพิมพ์ตั๋ว',
  'Wristband Connection': 'การเชื่อมต่อเครื่องพิมพ์ริสต์แบนด์', 'Network Host': 'IP เครื่องพิมพ์', 'Network Port': 'พอร์ต', 'Max Login Attempts': 'จำนวนครั้งที่ล็อกอินผิดได้',
  'Lock Minutes': 'ล็อกบัญชี (นาที)', 'Otp Enabled': 'เปิดใช้ OTP', 'Password Min Length': 'ความยาวรหัสผ่านขั้นต่ำ', 'Tier Discount Stackable': 'ส่วนลดระดับสมาชิกใช้ร่วมโปรอื่นได้',
  'Tier Discount Priority': 'ลำดับส่วนลดระดับสมาชิก', 'Staff Language': 'ภาษาหน้าจอพนักงาน', 'Text Size': 'ขนาดตัวอักษร', 'Admin': 'หลังบ้าน', 'Pos': 'POS', 'Kiosk': 'คีออสก์',
  'Template font': 'ฟอนต์แม่แบบ', 'Points earned per spend': 'แต้มต่อยอดใช้จ่าย',

  // reports & misc server labels
  'Daily Sales': 'ยอดขายรายวัน', 'Sales by Payment Method': 'ยอดขายตามวิธีชำระเงิน', 'Visitor Report': 'รายงานผู้เข้าชม', 'Gate Report': 'รายงานเกต', 'Ride Report': 'รายงานเครื่องเล่น',
  'Queue Report': 'รายงานคิว', 'Wallet Movements': 'ความเคลื่อนไหวกระเป๋าเงิน', 'Top-up Report': 'รายงานการเติมเงิน', 'Refund Report': 'รายงานการคืนเงิน', 'Promotion Report': 'รายงานโปรโมชั่น',
  'Member Report': 'รายงานสมาชิก', 'Staff Sales': 'ยอดขายตามพนักงาน', 'Shift Report': 'รายงานกะงาน', 'Stock Movements': 'ความเคลื่อนไหวสต็อก', 'Sales': 'ยอดขาย', 'Top-ups': 'เติมเงิน',
  'Refunds': 'คืนเงิน', 'Transfer': 'โอนย้าย', 'Adjustment': 'ปรับปรุง', 'Waste': 'ของเสีย', 'Add-on': 'บริการเสริม', 'Online / Counter': 'ออนไลน์ / เคาน์เตอร์', 'PAY NOW': 'ชำระทันที',
  'PAY AT PARK': 'ชำระที่สวน', 'DUPLICATE QR': 'สแกน QR ซ้ำ', 'Already inside — duplicate entry': 'อยู่ในสวนแล้ว — เข้าซ้ำ', 'Manager': 'ผู้จัดการ', 'Supervisor': 'หัวหน้างาน',
  'Finance': 'การเงิน', 'Kitchen': 'ครัว', 'Service': 'บริการ', 'POS Cashier': 'แคชเชียร์ POS',

  // ---- device setup / KDS
  'Invalid device key': 'คีย์อุปกรณ์ไม่ถูกต้อง', 'Device paired': 'จับคู่อุปกรณ์แล้ว', 'Device setup': 'ตั้งค่าอุปกรณ์', 'Device API key (tpd_…)': 'คีย์ API อุปกรณ์ (tpd_…)',
  'Pair': 'จับคู่', 'Unpair': 'ยกเลิกการจับคู่', 'Paired as': 'จับคู่เป็น', 'Using staff session (': 'ใช้เซสชันพนักงาน (', 'log in as staff': 'เข้าสู่ระบบพนักงาน',
  'to open device screens.': 'เพื่อเปิดหน้าจออุปกรณ์', 'Gate customer displays': 'จอลูกค้าหน้าเกต', 'No access': 'ไม่มีสิทธิ์', 'Ride scanners': 'เครื่องสแกนเครื่องเล่น',
  'Kitchen & order boards': 'จอครัวและจอเรียกคิว', 'Ready board': 'จอเรียกรับอาหาร', 'QR order': 'สั่งผ่าน QR', 'Customer kiosk': 'ตู้คีออสก์ลูกค้า', 'Open kiosk': 'เปิดคีออสก์',
  'Offline — status queued': 'ออฟไลน์ — บันทึกสถานะไว้รอส่ง', 'Kitchen Display': 'จอครัว', '● LIVE': '● สด', '● OFFLINE': '● ออฟไลน์', 'PICKED UP': 'รับแล้ว',

  // ---- audit
  'Append-only record of every important action': 'บันทึกทุกการกระทำสำคัญ (แก้ไข/ลบไม่ได้)', 'Action (e.g. REFUND, GATE)': 'การกระทำ (เช่น REFUND, GATE)',
  'Entity type / id': 'ประเภท / รหัสข้อมูล', 'Timestamp': 'เวลา', 'Entity': 'ข้อมูล',

  // ---- bookings
  'Booking Management': 'จัดการการจอง', 'Calendar': 'ปฏิทิน', 'Booking No. / barcode / customer / phone / email / member ID': 'เลขการจอง / บาร์โค้ด / ลูกค้า / เบอร์โทร / อีเมล / รหัสสมาชิก',
  'Booking No.': 'เลขการจอง', 'Customer': 'ลูกค้า', 'Channel': 'ช่องทาง', 'Paid': 'ชำระแล้ว', 'bookings': 'การจอง', 'Sun': 'อา.', 'Mon': 'จ.', 'Tue': 'อ.', 'Wed': 'พ.',
  'Thu': 'พฤ.', 'Fri': 'ศ.', 'Sat': 'ส.', 'Cancel reason?': 'เหตุผลที่ยกเลิก?', 'Cancel booking': 'ยกเลิกการจอง', 'Refund reason?': 'เหตุผลการคืนเงิน?', 'Refunded': 'คืนเงินแล้ว',
  'Refund': 'คืนเงิน',

  // ---- cards
  '← All cards': '← บัตรทั้งหมด', 'Activate': 'เปิดใช้งาน', 'Suspend': 'ระงับ', 'Report lost / Replace': 'แจ้งหาย / เปลี่ยนบัตร', 'Block': 'บล็อก', 'Bind member': 'ผูกกับสมาชิก',
  'Unbind reason?': 'เหตุผลที่ยกเลิกการผูก?', 'Unbind member': 'ยกเลิกการผูกสมาชิก', 'Rotate QR token? Old printed QR stops working immediately.': 'เปลี่ยนโทเคน QR? QR ที่พิมพ์ไว้เดิมจะใช้ไม่ได้ทันที',
  'Token rotated': 'เปลี่ยนโทเคนแล้ว', 'Rotate token': 'เปลี่ยนโทเคน', 'Wallet adjustment': 'ปรับยอดกระเป๋าเงิน', 'Report lost / Replace card': 'แจ้งหาย / เปลี่ยนบัตร',
  'Disable old & TRANSFER TO NEW CARD': 'ปิดบัตรเดิมและโอนไปบัตรใหม่',
  'The old card is disabled immediately. Member, wallet, tickets, points, ride rights, bookings, lockers and queue move to the new card. History stays on the old card.': 'บัตรเดิมจะถูกปิดทันที สมาชิก กระเป๋าเงิน ตั๋ว แต้ม สิทธิ์เครื่องเล่น การจอง ล็อกเกอร์ และคิว จะย้ายไปบัตรใหม่ ประวัติยังอยู่ที่บัตรเดิม',
  'New card type': 'ประเภทบัตรใหม่', 'Same as old (': 'เหมือนบัตรเดิม (', 'Pre-printed card / wristband serial (optional)': 'เลขบัตร / ริสต์แบนด์ที่พิมพ์ไว้แล้ว (ไม่บังคับ)',
  'Bind to member': 'ผูกกับสมาชิก', 'Search phone / email / member ID': 'ค้นหาเบอร์โทร / อีเมล / รหัสสมาชิก', 'Bound — guest wallet balance & rights moved to member': 'ผูกแล้ว — ย้ายยอดเงินและสิทธิ์ไปที่สมาชิกแล้ว',
  'Adjusted': 'ปรับยอดแล้ว', 'Post adjustment': 'บันทึกการปรับยอด', 'Credit (+)': 'เพิ่ม (+)', 'Debit (−)': 'ลด (−)', 'Amount (THB)': 'จำนวนเงิน (บาท)',
  'Central credential system — one card for everything': 'ระบบบัตรกลาง — บัตรเดียวใช้ได้ทุกอย่าง', 'Issue new card': 'ออกบัตรใหม่',
  'Card ID / serial / phone / email / member ID / name': 'รหัสบัตร / เลขบัตร / เบอร์โทร / อีเมล / รหัสสมาชิก / ชื่อ', 'Card ID': 'รหัสบัตร',
  'Issue new card / wristband': 'ออกบัตร / ริสต์แบนด์ใหม่', 'Issue': 'ออกบัตร', 'Physical serial (single card)': 'เลขบัตรจริง (บัตรเดียว)',
  'ACTIVE (ready to use)': 'ใช้งาน (พร้อมใช้)', 'NEW (stock, activate at counter)': 'ใหม่ (สต็อก เปิดใช้ที่เคาน์เตอร์)',

  // ---- dashboards
  'Consolidated Dashboard': 'แดชบอร์ดรวมทุกสาขา', 'Visitors today': 'ผู้เข้าชมวันนี้', 'Inside now': 'อยู่ในสวนตอนนี้', 'Total revenue': 'รายได้รวม', 'Wallet top-up': 'เติมเงิน',
  'Revenue by branch': 'รายได้ตามสาขา', 'Inside': 'อยู่ข้างใน', 'Visitors': 'ผู้เข้าชม', 'Food': 'อาหาร', 'Retail': 'สินค้า', 'Revenue': 'รายได้',
  'Real-time Dashboard': 'แดชบอร์ดเรียลไทม์', 'LIVE': 'สด', 'Today Visitors': 'ผู้เข้าชมวันนี้', 'Current Inside': 'อยู่ในสวนตอนนี้', 'Total Revenue': 'รายได้รวม',
  'Cash-basis collections incl. top-ups': 'ยอดรับเงินจริง รวมการเติมเงิน', 'Peak Time': 'ช่วงเวลาคนมากที่สุด', 'Ticket Sales': 'ยอดขายตั๋ว', 'Food Sales': 'ยอดขายอาหาร',
  'Retail Sales': 'ยอดขายสินค้า', 'Wallet Top-up': 'ยอดเติมเงิน', 'Visitors by Hour': 'ผู้เข้าชมรายชั่วโมง', 'Revenue by Hour': 'รายได้รายชั่วโมง', 'Ticket Type Mix': 'สัดส่วนประเภทตั๋ว',
  'No tickets activated today': 'วันนี้ยังไม่มีตั๋วที่ใช้งาน', 'Sales by Store': 'ยอดขายตามร้าน', 'Ride Usage & Queue Time': 'การใช้เครื่องเล่นและเวลารอคิว', 'Rides →': 'เครื่องเล่น →',
  'Wait (min)': 'รอ (นาที)', 'Gate Traffic': 'การเข้าออกที่เกต', 'Console →': 'คอนโซล →', 'State': 'สถานะ', 'Scans': 'สแกน', 'Approved': 'อนุมัติ', 'Denied': 'ปฏิเสธ', 'Dup.': 'ซ้ำ',
  'Devices online': 'อุปกรณ์ออนไลน์', 'All good': 'ปกติทั้งหมด', 'Lockers in use': 'ล็อกเกอร์ที่ใช้งาน', 'New members': 'สมาชิกใหม่',
  'Normal': 'ปกติ', 'Busy': 'หนาแน่น', 'Crowded': 'แออัด',

  // ---- counter
  'Ticket Counter / Box Office': 'เคาน์เตอร์ขายตั๋ว', 'Open a shift to accept cash →': 'เปิดกะก่อนรับเงินสด →', 'Sell tickets': 'ขายตั๋ว', 'Booking check-in': 'เช็คอินการจอง',
  'Card lookup': 'ตรวจสอบบัตร', 'Top-up': 'เติมเงิน', 'Balance refund': 'คืนยอดเงินคงเหลือ', 'Walk-in': 'ลูกค้า Walk-in', '1. Package': '1. แพ็กเกจ', '2. Guests': '2. จำนวนคน',
  '3. Customer (optional)': '3. ลูกค้า (ไม่บังคับ)', 'Scan member card for member price & points': 'สแกนบัตรสมาชิกเพื่อรับราคาสมาชิกและแต้ม', 'Not a member card': 'ไม่ใช่บัตรสมาชิก',
  'Select package & guests': 'เลือกแพ็กเกจและจำนวนคน', 'Print wristbands': 'พิมพ์ริสต์แบนด์', 'New sale': 'ขายรายการใหม่', 'Activate & bind': 'เปิดใช้และผูกบัตร',
  'Print new wristband': 'พิมพ์ริสต์แบนด์ใหม่', 'Scan pre-printed band': 'สแกนริสต์แบนด์ที่พิมพ์ไว้', 'Use member card': 'ใช้บัตรสมาชิก', 'Scan / type band serial': 'สแกน / พิมพ์เลขริสต์แบนด์',
  'New WB-… code will be generated': 'ระบบจะสร้างรหัส WB-… ใหม่', 'Height cm': 'ส่วนสูง ซม.', 'Guest name': 'ชื่อผู้เข้าชม', '← Scan another booking': '← สแกนการจองอื่น',
  'Scan booking barcode / QR or type BK-…': 'สแกนบาร์โค้ด / QR การจอง หรือพิมพ์ BK-…', 'Outstanding': 'ค้างชำระ', 'RESERVED — PAYMENT PENDING': 'จองแล้ว — รอชำระเงิน',
  'Receive payment': 'รับชำระเงิน', 'Visit date': 'วันที่เข้าชม', 'Current Balance': 'ยอดเงินปัจจุบัน', '✓ TOP UP': '✓ เติมเงินสำเร็จ', '— New Balance': '— ยอดใหม่',
  'TOP UP': 'เติมเงิน', 'Top-up payment': 'ชำระค่าเติมเงิน', 'Membership activated': 'เปิดใช้สมาชิกแล้ว', 'Find member': 'ค้นหาสมาชิก', 'Register': 'สมัครสมาชิก',
  'Phone / email / member ID / name': 'เบอร์โทร / อีเมล / รหัสสมาชิก / ชื่อ', 'Cards': 'บัตร', 'Sell membership': 'ขายสมาชิก', 'Product…': 'เลือกผลิตภัณฑ์…', 'Renewal': 'ต่ออายุ',
  'Upgrade': 'อัปเกรด', 'Issue a NEW physical member card': 'ออกบัตรสมาชิกใบใหม่', '— not needed when the customer\'s own card is linked': '— ไม่ต้องเลือกถ้าเชื่อมบัตรที่ลูกค้ามีอยู่แล้ว',
  'Charge ~': 'เรียกเก็บ ~', 'Final price (proration / early renewal) is computed by the server.': 'ราคาสุดท้าย (คิดตามสัดส่วน / ต่ออายุล่วงหน้า) คำนวณโดยระบบ',
  'Membership payment': 'ชำระค่าสมาชิก', 'Select or register a member': 'เลือกหรือสมัครสมาชิก', 'Register member': 'สมัครสมาชิก', 'First name *': 'ชื่อ *', 'Phone *': 'เบอร์โทร *',
  'Birthday': 'วันเกิด', 'Manage card': 'จัดการบัตร', 'Remaining balance refund': 'คืนยอดเงินคงเหลือ', 'Remaining Balance': 'ยอดคงเหลือ', 'Refund balance in cash': 'คืนยอดเป็นเงินสด',
  'Policy is configured in Settings → Wallet (refundable / partial / non-refundable / transfer to member / keep).': 'ตั้งนโยบายได้ที่ ตั้งค่า → กระเป๋าเงิน (คืนได้ / คืนบางส่วน / ไม่คืน / โอนให้สมาชิก / เก็บไว้)',

  // ---- gates
  'Every scan is recorded — including denied attempts': 'บันทึกทุกการสแกน รวมถึงที่ถูกปฏิเสธ', 'Security events': 'เหตุการณ์ด้านความปลอดภัย', 'All gates': 'ทุกเกต',
  'Credential / ticket / member': 'บัตร / ตั๋ว / สมาชิก', 'Scan time': 'เวลาสแกน', 'Dir': 'ทิศทาง', 'DUPLICATE': 'ซ้ำ', 'Approval time': 'เวลาอนุมัติ', 'Ack': 'รับทราบ',
  'Denied by operator': 'เจ้าหน้าที่ปฏิเสธ', 'Supervisor override reason?': 'เหตุผลการอนุมัติพิเศษ?', 'Override approved': 'อนุมัติพิเศษแล้ว', 'Clear emergency — reason?': 'ยกเลิกโหมดฉุกเฉิน — เหตุผล?',
  'ACTIVATE EMERGENCY MODE — reason?': 'เปิดโหมดฉุกเฉิน — เหตุผล?', 'DUPLICATE ATTEMPT': 'พยายามเข้าซ้ำ', 'No scans yet': 'ยังไม่มีการสแกน', 'DENY': 'ปฏิเสธ', 'APPROVE': 'อนุมัติ',
  'display': 'จอแสดงผล', 'Gate Operator Console': 'คอนโซลเจ้าหน้าที่เกต', 'waiting approval': 'รออนุมัติ', 'Entry log': 'บันทึกการเข้า', 'Clear emergency': 'ยกเลิกโหมดฉุกเฉิน',
  'EMERGENCY MODE ACTIVE — all gates released': 'โหมดฉุกเฉินทำงาน — เปิดทุกเกตแล้ว', '— DUPLICATE ENTRY ATTEMPT': '— พยายามเข้าซ้ำ', 'Ticket:': 'ตั๋ว:', 'First Entry:': 'เข้าครั้งแรก:',
  'Second Attempt:': 'พยายามครั้งที่สอง:', 'Exit gates': 'เกตทางออก', 'Manual open': 'เปิดด้วยมือ', 'Supervisor override': 'อนุมัติพิเศษ (หัวหน้า)', 'DENY ENTRY': 'ไม่อนุญาตให้เข้า',
  'APPROVE ENTRY': 'อนุญาตให้เข้า', 'DUPLICATE ENTRY ATTEMPT': 'พยายามเข้าซ้ำ', 'Ticket Type': 'ประเภทตั๋ว', 'Visit Date': 'วันที่เข้าชม', 'Scan Time': 'เวลาสแกน', 'Validation': 'ผลการตรวจสอบ',
  'AUTO mode': 'โหมดอัตโนมัติ', 'Waiting for scans… cards flash and open automatically when a gate needs approval.': 'รอการสแกน… การ์ดเกตจะกะพริบและเปิดขึ้นเองเมื่อต้องอนุมัติ',

  // ---- inventory / lockers
  'Stock updated': 'อัปเดตสต็อกแล้ว', 'Stock In': 'รับเข้า', 'Stock Out': 'จ่ายออก', 'Stock levels': 'ระดับสต็อก', 'Movements': 'ความเคลื่อนไหว',
  'All stores / warehouses': 'ทุกร้าน / คลัง', 'Low at': 'แจ้งเตือนที่', 'LOW STOCK': 'สต็อกต่ำ', 'Qty (+/−)': 'จำนวน (+/−)', 'Locker System': 'ระบบล็อกเกอร์',
  'Rent locker (auto-assign)': 'เช่าล็อกเกอร์ (ระบบเลือกให้)', 'Open locker with wristband': 'เปิดล็อกเกอร์ด้วยริสต์แบนด์', 'Scan wristband to open its locker': 'สแกนริสต์แบนด์เพื่อเปิดล็อกเกอร์',
  'OVERDUE': 'เกินเวลา', 'Rent locker': 'เช่าล็อกเกอร์', 'Pay & unlock': 'ชำระและปลดล็อก', 'Card captured': 'อ่านบัตรแล้ว', 'Scan wristband': 'สแกนริสต์แบนด์', 'Duration': 'ระยะเวลา',
  'free)': 'ว่าง)',

  // ---- members
  'Search phone / email / member ID / name': 'ค้นหาเบอร์โทร / อีเมล / รหัสสมาชิก / ชื่อ', 'Member ID': 'รหัสสมาชิก', 'Visits': 'จำนวนครั้งที่มา', 'Total spend': 'ยอดใช้จ่ายรวม',
  'Points (+/−)?': 'แต้ม (+/−)?', 'Adjust points': 'ปรับแต้ม', 'No membership': 'ไม่มีสมาชิกภาพ', 'Visits / Spend': 'จำนวนครั้ง / ยอดใช้จ่าย', 'Gender': 'เพศ', 'Emergency': 'ผู้ติดต่อฉุกเฉิน',
  'Edit member': 'แก้ไขข้อมูลสมาชิก', 'Notification Center': 'ศูนย์การแจ้งเตือน', 'Acknowledge all': 'รับทราบทั้งหมด', 'No notifications': 'ไม่มีการแจ้งเตือน',

  // ---- POS
  'OFFLINE — cash sale saved locally and will sync automatically': 'ออฟไลน์ — บันทึกการขายเงินสดไว้ในเครื่อง จะซิงก์อัตโนมัติ', 'Search product / SKU / barcode': 'ค้นหาสินค้า / SKU / บาร์โค้ด',
  'OFFLINE — cash only': 'ออฟไลน์ — รับเงินสดเท่านั้น', 'Guest wristband': 'ริสต์แบนด์ลูกค้าทั่วไป', 'Scan wristband / member card': 'สแกนริสต์แบนด์ / บัตรสมาชิก', 'Cart is empty': 'ตะกร้าว่าง',
  'Discount % (e.g. 10) or amount with ฿ (e.g. ฿50)': 'ส่วนลด % (เช่น 10) หรือจำนวนเงินใส่ ฿ (เช่น ฿50)', 'Manual discount': 'ส่วนลดด้วยมือ', 'Disc.': 'ลด', 'Manual discount (': 'ส่วนลดด้วยมือ (',
  '✓ approved': '✓ อนุมัติแล้ว', 'Promotions, member & tier discounts are applied by the server at checkout.': 'โปรโมชั่นและส่วนลดสมาชิกคำนวณโดยระบบตอนชำระเงิน', 'PAY': 'ชำระเงิน',
  'Add to cart': 'ใส่ตะกร้า', 'Saved offline': 'บันทึกแบบออฟไลน์แล้ว', 'Print receipt': 'พิมพ์ใบเสร็จ', 'New order': 'ออเดอร์ใหม่', '— will sync when online.': '— จะซิงก์เมื่อกลับมาออนไลน์',
  'Queue number': 'หมายเลขคิว', 'Wallet balance': 'ยอดเงินในกระเป๋า', 'Note to customer?': 'ข้อความถึงลูกค้า?',

  // ---- payment verification
  'Payment Verification Center': 'ศูนย์ตรวจสอบการชำระเงิน', 'No requests': 'ไม่มีรายการรอตรวจสอบ', 'New PromptPay / transfer slips appear here instantly': 'สลิปพร้อมเพย์ / โอนเงินใหม่จะแสดงที่นี่ทันที',
  'Submitted': 'ส่งเมื่อ', 'View slip': 'ดูสลิป', 'No slip uploaded (customer pressed “check payment”)': 'ไม่มีสลิป (ลูกค้ากด “ตรวจสอบการชำระเงิน”)', 'Reject': 'ปฏิเสธ', 'New slip': 'ขอสลิปใหม่', 'Slip': 'สลิป',

  // ---- reports
  'Report': 'รายงาน',

  // ---- rides
  'Ride Dashboard': 'แดชบอร์ดเครื่องเล่น', 'Longest queue': 'คิวยาวที่สุด', 'Most popular': 'ยอดนิยม', 'Closed first': 'ปิดอยู่ก่อน', 'Maintenance first': 'ซ่อมบำรุงก่อน',
  'PAUSED': 'หยุดชั่วคราว', 'Current queue': 'คิวปัจจุบัน', 'Guests today': 'ผู้เล่นวันนี้', 'scanner ↗': 'เครื่องสแกน ↗', 'ENTRY PAUSED': 'หยุดรับผู้เล่นชั่วคราว',
  'Customer scanner ↗': 'จอสแกนลูกค้า ↗', 'Est. wait': 'เวลารอโดยประมาณ', 'Current cycle': 'รอบปัจจุบัน', 'Open ride': 'เปิดเครื่องเล่น', 'Resume entry': 'รับผู้เล่นต่อ',
  'Pause entry': 'หยุดรับผู้เล่น', 'Closed by operator': 'ปิดโดยผู้ควบคุม', 'Close ride': 'ปิดเครื่องเล่น', 'Maintenance reason?': 'เหตุผลการซ่อมบำรุง?', 'Maintenance': 'ซ่อมบำรุง',
  'Temporarily closed': 'ปิดชั่วคราว', 'Call next batch': 'เรียกคิวรอบถัดไป', 'Operator scan (validates & consumes entitlement)': 'สแกนโดยผู้ควบคุม (ตรวจสอบและหักสิทธิ์)',
  'Pending purchases at scanner': 'รายการซื้อที่รอที่เครื่องสแกน', 'Cash received — access granted': 'รับเงินสดแล้ว — อนุญาตให้เล่น', 'CONFIRM CASH RECEIVED': 'ยืนยันรับเงินสดแล้ว',
  'Last scans': 'สแกนล่าสุด', 'Deny reason (use will be restored)?': 'เหตุผลที่ปฏิเสธ (คืนสิทธิ์ให้)?', 'Deny': 'ปฏิเสธ', 'Manual approve reason?': 'เหตุผลการอนุมัติด้วยมือ?',
  'PRIORITY': 'คิวพิเศษ', 'Joined': 'เข้าคิวเมื่อ',

  // ---- shifts
  'Shift Management': 'จัดการกะงาน', 'Open shift': 'เปิดกะ', 'Opening cash (THB)': 'เงินสดตั้งต้น (บาท)', 'Store / counter': 'ร้าน / เคาน์เตอร์', 'Opened': 'เปิดเมื่อ',
  'Opening cash': 'เงินสดตั้งต้น', '+ Cash sales': '+ ขายเงินสด', '+ Cash top-up': '+ เติมเงินด้วยเงินสด', '+ Cash in': '+ นำเงินเข้า', '− Refunds / cash-out': '− คืนเงิน / ถอนเงิน',
  '− Cash out (payouts)': '− นำเงินออก', '= Expected cash': '= เงินสดที่ควรมี', 'By method': 'ตามวิธีชำระ', 'Close shift': 'ปิดกะ', 'Actual cash counted (THB)': 'เงินสดที่นับได้จริง (บาท)',
  'Over / Short:': 'เกิน / ขาด:', 'Cash in / out': 'นำเงินเข้า / ออก', 'Cash out': 'นำเงินออก', 'Cash in': 'นำเงินเข้า', 'All shifts': 'กะทั้งหมด', 'Closed': 'ปิดแล้ว', 'Expected': 'ควรมี',
  'Actual': 'นับได้จริง', 'Over/Short': 'เกิน/ขาด',

  // ---- login
  'Staff Login': 'เข้าสู่ระบบพนักงาน', 'ONE QR — Theme Park Management': 'ONE QR — ระบบบริหารสวนสนุก', 'Session expired — please log in again.': 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบอีกครั้ง',
  'Customer website': 'เว็บไซต์ลูกค้า', 'PIN': 'รหัส PIN', 'Log in': 'เข้าสู่ระบบ', 'Login': 'เข้าสู่ระบบ', 'Select staff': 'เลือกพนักงาน',

  // ---- transactions / refunds
  'Voided': 'ยกเลิกแล้ว', 'Transaction Center': 'ศูนย์ธุรกรรม', 'All tickets, wallet, POS, food, retail, locker, top-up and refund transactions': 'ธุรกรรมทั้งหมด: ตั๋ว กระเป๋าเงิน POS อาหาร สินค้า ล็อกเกอร์ เติมเงิน และคืนเงิน',
  'Txn / order / ticket / card / wristband / member / staff': 'เลขธุรกรรม / ออเดอร์ / ตั๋ว / บัตร / ริสต์แบนด์ / สมาชิก / พนักงาน', 'transactions': 'รายการ', 'Void': 'ยกเลิกรายการ',
  'Refund qty': 'จำนวนที่คืน', 'Full refund': 'คืนเงินเต็มจำนวน', 'Partial (items or amount)': 'คืนบางส่วน (ตามรายการหรือจำนวนเงิน)', 'Refund via': 'คืนเงินทาง',
  'Original method': 'วิธีเดิม', 'Bank transfer': 'โอนเงิน', 'Amount (if no items)': 'จำนวนเงิน (ถ้าไม่เลือกรายการ)', 'Void order': 'ยกเลิกออเดอร์', 'Confirm refund': 'ยืนยันคืนเงิน',
};

/** Enum / status values (also matched in their spaced form, e.g. "NO SHOW"). */
export const TH_ENUM: Record<string, string> = {
  ACTIVE: 'ใช้งาน', INACTIVE: 'ไม่ใช้งาน', NEW: 'ใหม่', SUSPENDED: 'ระงับ', LOST: 'แจ้งหาย', BLOCKED: 'บล็อก', EXPIRED: 'หมดอายุ', REPLACED: 'เปลี่ยนบัตรแล้ว',
  CLOSED: 'ปิด', OPEN: 'เปิด', MAINTENANCE: 'ซ่อมบำรุง', TEMPORARILY_CLOSED: 'ปิดชั่วคราว', DISABLED: 'ปิดใช้งาน', USED: 'ใช้แล้ว', INSIDE: 'อยู่ข้างใน', OUTSIDE: 'อยู่ข้างนอก',
  CASH: 'เงินสด', PROMPTPAY: 'พร้อมเพย์', CARD: 'บัตร', DEBIT: 'บัตรเดบิต', EWALLET: 'อี-วอลเล็ต', WALLET: 'กระเป๋าเงิน', POINTS: 'แต้ม', TRANSFER: 'โอนเงิน', ORIGINAL: 'วิธีเดิม',
  CRITICAL: 'วิกฤต', WARNING: 'คำเตือน', INFO: 'ข้อมูล', APPROVAL_REQUIRED: 'ต้องอนุมัติ',
  ONE_TIME: 'ครั้งเดียว', MULTI_USE: 'หลายครั้ง', UNLIMITED: 'ไม่จำกัด', TIME_BASED: 'ตามเวลา', DATE_BASED: 'ตามวัน',
  ADMISSION: 'บัตรผ่านประตู', DAY_PASS: 'บัตรทั้งวัน', HALF_DAY: 'ครึ่งวัน', EVENING: 'รอบเย็น', VIP: 'VIP', GROUP: 'กลุ่ม', SCHOOL: 'โรงเรียน', CORPORATE: 'องค์กร',
  BIRTHDAY: 'วันเกิด', FAMILY: 'ครอบครัว', MULTI_DAY: 'หลายวัน', RIDE_PASS: 'บัตรเครื่องเล่น', OTHER: 'อื่น ๆ', PER_GUEST: 'ต่อคน', BUNDLE: 'ราคาชุด',
  CONSECUTIVE: 'ต่อเนื่อง', ANY_WITHIN: 'วันใดก็ได้ภายในกำหนด', ALL: 'ทั้งหมด', SELECT: 'เลือกเอง', NONE: 'ไม่มี', NON_REFUNDABLE: 'ไม่คืนเงิน',
  FULL_BEFORE_VISIT: 'คืนเต็มก่อนวันเข้า', PARTIAL_BEFORE_VISIT: 'คืนบางส่วนก่อนวันเข้า', ANYTIME: 'ทุกเวลา', ONLINE: 'ออนไลน์', COUNTER: 'เคาน์เตอร์', KIOSK: 'คีออสก์',
  ENTRY: 'ทางเข้า', EXIT: 'ทางออก', BOTH: 'เข้า-ออก', AUTO: 'อัตโนมัติ', MANUAL: 'ด้วยมือ', SIMULATOR: 'ตัวจำลอง', TURNSTILE: 'ประตูหมุน', FLAP_BARRIER: 'ประตูปีกนก',
  SWING_GATE: 'ประตูสวิง', RELAY: 'รีเลย์', NETWORK: 'เครือข่าย', TICKET: 'ตั๋ว', RESTAURANT: 'ร้านอาหาร', RETAIL: 'ร้านค้า', LOCKER: 'ล็อกเกอร์', WAREHOUSE: 'คลังสินค้า',
  RIDE: 'เครื่องเล่น', SERVICE: 'บริการ', FOOD: 'อาหาร', DRINK: 'เครื่องดื่ม', SOUVENIR: 'ของที่ระลึก', MERCHANDISE: 'สินค้า', PHOTO: 'ภาพถ่าย', ADDON: 'บริการเสริม',
  TOPUP: 'เติมเงิน', PACKAGE: 'แพ็กเกจ', FULL: 'เต็มราคา', DIFFERENCE: 'ส่วนต่าง', PRORATED: 'ตามสัดส่วน', DAY: 'วัน', MONTH: 'เดือน', YEAR: 'ปี', LIFETIME: 'ตลอดชีพ',
  PERCENT: 'เปอร์เซ็นต์', AMOUNT: 'จำนวนเงิน', BUY_X_PAY_Y: 'ซื้อ X จ่าย Y', FIXED_PRICE: 'ราคาคงที่', ORDER: 'ทั้งออเดอร์', PRODUCT: 'สินค้า',
  DISCOUNT: 'ส่วนลด', FREE_TICKET: 'ตั๋วฟรี', UPGRADE: 'อัปเกรด', COUPON: 'คูปอง', WALLET_CREDIT: 'เครดิตกระเป๋าเงิน', AVAILABLE: 'ว่าง', OCCUPIED: 'ไม่ว่าง',
  OUT_OF_SERVICE: 'งดให้บริการ', RESERVED: 'จองแล้ว', LOCKED: 'ล็อก', RECEIPT: 'ใบเสร็จ', WRISTBAND: 'ริสต์แบนด์', MEMBER_CARD: 'บัตรสมาชิก', KITCHEN: 'ครัว',
  TICKET_DISCOUNT: 'ส่วนลดตั๋ว', FOOD_DISCOUNT: 'ส่วนลดอาหาร', RETAIL_DISCOUNT: 'ส่วนลดสินค้า', FREE_RIDE: 'เล่นฟรี', FREE_LOCKER: 'ล็อกเกอร์ฟรี', BIRTHDAY_REWARD: 'ของขวัญวันเกิด',
  PRIORITY_QUEUE: 'คิวพิเศษ', FAST_PASS: 'ฟาสต์พาส', FREE_ADMISSION: 'เข้าฟรี', GUEST_DISCOUNT: 'ส่วนลดผู้ติดตาม', POINT_MULTIPLIER: 'ตัวคูณแต้ม', PARKING: 'ที่จอดรถ',
  SPECIAL_EVENT: 'กิจกรรมพิเศษ', MEMBER_LOUNGE: 'ห้องรับรองสมาชิก', CUSTOM: 'กำหนดเอง', GATE_SCANNER: 'เครื่องสแกนเกต', GATE_CONTROLLER: 'ตัวควบคุมเกต', GATE_DISPLAY: 'จอหน้าเกต',
  RIDE_SCANNER: 'เครื่องสแกนเครื่องเล่น', KITCHEN_DISPLAY: 'จอครัว', QUEUE_DISPLAY: 'จอคิว', LOCKER_CONTROLLER: 'ตัวควบคุมล็อกเกอร์', PRINTER: 'เครื่องพิมพ์',
  PAYMENT_TERMINAL: 'เครื่องรับชำระเงิน', CUSTOMER_DISPLAY: 'จอลูกค้า', WRISTBAND_PRINTER: 'เครื่องพิมพ์ริสต์แบนด์', OFFLINE: 'ออฟไลน์', ERROR: 'ผิดพลาด', ONLINE_STATUS: 'ออนไลน์',
  FOOD_VOUCHER: 'คูปองอาหาร', PREPARING: 'กำลังเตรียม', READY: 'พร้อมรับ', COMPLETED: 'เสร็จสิ้น', TODAY: 'วันนี้', TOMORROW: 'พรุ่งนี้', UPCOMING: 'กำลังจะมาถึง',
  UNPAID: 'ยังไม่ชำระ', PAID: 'ชำระแล้ว', PENDING_VERIFICATION: 'รอตรวจสอบ', CHECKED_IN: 'เช็คอินแล้ว', CANCELLED: 'ยกเลิก', REFUNDED: 'คืนเงินแล้ว', NO_SHOW: 'ไม่มาตามนัด',
  PARTIALLY_REFUNDED: 'คืนเงินบางส่วน', REFUND: 'คืนเงิน', CREDIT: 'เครดิต', PRINTED_WRISTBAND: 'ริสต์แบนด์พิมพ์', TEMP_CARD: 'บัตรชั่วคราว', DIGITAL_CARD: 'บัตรดิจิทัล',
  QR_TICKET: 'ตั๋ว QR', BOOKING: 'การจอง', CARD_REPLACE: 'เปลี่ยนบัตร', STOLEN: 'ถูกขโมย', DAMAGED: 'ชำรุด', WALLET_ADJUST: 'ปรับยอดกระเป๋าเงิน', GENERATE: 'สร้างใหม่',
  SCAN: 'สแกน', CONFIRMED: 'ยืนยันแล้ว', PENDING_PAYMENT: 'รอชำระเงิน', RENEWAL: 'ต่ออายุ', APPROVED: 'อนุมัติ', AUTO_APPROVED: 'อนุมัติอัตโนมัติ', DENIED: 'ปฏิเสธ',
  PENDING: 'รอดำเนินการ', WAITING_APPROVAL: 'รออนุมัติ', MANUAL_GATE_OPEN: 'เปิดเกตด้วยมือ', GATE_OVERRIDE: 'อนุมัติพิเศษที่เกต', EMERGENCY: 'ฉุกเฉิน', IN: 'รับเข้า', OUT: 'จ่ายออก',
  ADJUSTMENT: 'ปรับปรุง', WASTE: 'ของเสีย', CROWDED: 'แออัด', BUSY: 'หนาแน่น', NORMAL: 'ปกติ', POINTS_ADJUST: 'ปรับแต้ม', DISCOUNT_OVER_LIMIT: 'ส่วนลดเกินกำหนด',
  WAITING: 'รอ', CALLED: 'เรียกแล้ว', REJECTED: 'ปฏิเสธ', NEW_SLIP_REQUESTED: 'ขอสลิปใหม่', GRANTED: 'อนุญาต', RIDE_OVERRIDE: 'อนุมัติพิเศษที่เครื่องเล่น',
  SHIFT_OVER_SHORT: 'เงินเกิน/ขาดตอนปิดกะ', PARTIAL: 'บางส่วน', VOID: 'ยกเลิก', VOIDED: 'ยกเลิกแล้ว', SALE: 'ขาย', WALLET_CASH_OUT: 'ถอนเงินกระเป๋า', CASH_IN: 'นำเงินเข้า',
  CASH_OUT: 'นำเงินออก', MEMBERSHIP: 'สมาชิก', IDLE: 'ว่าง', SCANNING: 'กำลังสแกน', VALIDATING: 'กำลังตรวจสอบ', OPENING: 'กำลังเปิด', CLOSING: 'กำลังปิด', OPENED: 'เปิดแล้ว',
  PAUSED: 'หยุดชั่วคราว', DUPLICATE: 'ซ้ำ', NOT_FOUND: 'ไม่พบ', FORGED_QR: 'QR ปลอม', QR_EXPIRED: 'QR หมดอายุ', MALFORMED: 'รูปแบบไม่ถูกต้อง', HQ: 'สำนักงานใหญ่',
  MALE: 'ชาย', FEMALE: 'หญิง', STAFF: 'พนักงาน', MEMBER: 'สมาชิก', GUEST: 'ลูกค้าทั่วไป', BASIC: 'พื้นฐาน', ADULT: 'ผู้ใหญ่', CHILD: 'เด็ก', SENIOR: 'ผู้สูงอายุ',
  INFANT: 'ทารก', SALES: 'ฝ่ายขาย', NO_PASSAGE: 'ไม่ได้ผ่านเกต', PASSAGE: 'ผ่านเกตแล้ว',
};

/** Texts built from templates — `{}` marks the variable part(s). */
export const TH_PATTERNS: Array<[string, string]> = [
  ['Locker {} ({})', 'ล็อกเกอร์ {} ({})'], ['until {}', 'ถึง {}'], ['Card registered and linked: {}', 'ลงทะเบียนและเชื่อมบัตรแล้ว: {}'],
  ['Card {} linked to member', 'เชื่อมบัตร {} กับสมาชิกแล้ว'], ['Synced {} offline transaction(s)', 'ซิงก์รายการออฟไลน์ {} รายการแล้ว'],
  ['Syncing {} offline transaction(s)…', 'กำลังซิงก์รายการออฟไลน์ {} รายการ…'], ['Insufficient wallet balance ({})', 'ยอดเงินในกระเป๋าไม่พอ ({})'], ['Delete {}?', 'ลบ {} หรือไม่?'],
  ['{} is required', 'ต้องกรอก {}'], ['Benefits · {}', 'สิทธิประโยชน์ · {}'], ['Tier add-on prices · {}', 'ราคาสิทธิ์เพิ่มตามระดับ · {}'], ['Generate coupons · {}', 'สร้างคูปอง · {}'],
  ['{} permissions', '{} สิทธิ์'], ['{} font', 'ฟอนต์ {}'], ['{} (comma separated)', '{} (คั่นด้วยจุลภาค)'], ['New order {}', 'ออเดอร์ใหม่ {}'], ['Reason for {}?', 'เหตุผลสำหรับ {}?'],
  ['Old card disabled. New card {}', 'ปิดบัตรเดิมแล้ว บัตรใหม่ {}'], ['All branches · {}', 'ทุกสาขา · {}'], ['{} bundle', 'ชุด {}'], ['Payment · {}', 'ชำระเงิน · {}'],
  ['{} wristband(s) activated', 'เปิดใช้ริสต์แบนด์ {} ชิ้นแล้ว'], ['Wristbands issued · {}', 'ออกริสต์แบนด์แล้ว · {}'], ['Issue wristbands · {}', 'ออกริสต์แบนด์ · {}'],
  ['New balance {}', 'ยอดใหม่ {}'], ['Member {}', 'สมาชิก {}'], ['Card linked: {}', 'เชื่อมบัตรแล้ว: {}'], ['Card: {}', 'บัตร: {}'], ['Card captured: {}', 'อ่านบัตรแล้ว: {}'],
  ['Business day {} · updates live', 'วันทำการ {} · อัปเดตสด'], ['{} entries · {} exits', 'เข้า {} · ออก {}'], ['{} guests at peak', 'สูงสุด {} คน'],
  ['Other sales {} · Refunds {}', 'ยอดขายอื่น {} · คืนเงิน {}'], ['{} offline', 'ออฟไลน์ {} เครื่อง'], ['Manual open {} — reason?', 'เปิด {} ด้วยมือ — เหตุผล?'], ['{} opened', 'เปิด {} แล้ว'],
  ['{} / {} guests inside ({}%)', 'อยู่ข้างใน {} / {} คน ({}%)'], ['Locker {} unlocked', 'ปลดล็อกล็อกเกอร์ {} แล้ว'], ['{} / {} occupied', 'ใช้งาน {} / {}'],
  ['Locker {} opened', 'เปิดล็อกเกอร์ {} แล้ว'], ['End session of {}?', 'จบการใช้งาน {} หรือไม่?'], ['Rent {}', 'เช่า {}'], ['{} · joined {} via {}', '{} · สมัครเมื่อ {} ทาง {}'],
  ['{} out of stock', '{} สินค้าหมด'], ['Cash sale {}', 'ขายเงินสด {}'], ['{} · {} pts', '{} · {} แต้ม'], ['Choose {}', 'เลือก {}'], ['New payment to verify: {} {}', 'มีการชำระเงินรอตรวจสอบ: {} {}'],
  ['WAITING FOR CASH PAYMENT {} — {}', 'รอชำระเงินสด {} — {}'], ['GRANTED {}', 'อนุญาต {}'], ['{} · capacity {}/cycle · {} min', '{} · รับได้ {} คน/รอบ · {} นาที'],
  ['{} parties · {} called', '{} กลุ่ม · เรียกแล้ว {}'], ['{} min', '{} นาที'], ['Called: {}', 'เรียกแล้ว: {}'], ['Shift closed · over/short {}', 'ปิดกะแล้ว · เงินเกิน/ขาด {}'],
  ['Shift {}', 'กะ {}'], ['Member {} registered', 'สมัครสมาชิก {} แล้ว'], ['TOP UP {}', 'เติมเงิน {}'], ['Charge {}', 'เรียกเก็บ {}'], ['PAY {}', 'ชำระ {}'],
  ['{} items', '{} รายการ'], ['{} (satang)', '{} (สตางค์)'], ['{} guests', '{} คน'], ['Card {} · {}', 'บัตร {} · {}'],
];
