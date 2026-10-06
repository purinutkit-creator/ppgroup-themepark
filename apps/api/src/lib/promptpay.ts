/**
 * PromptPay (Thai QR Payment, EMVCo MPM) payload generator with CRC16-CCITT.
 * Produces a dynamic QR string for a specific amount that any Thai banking app can pay.
 */
function tlv(id: string, value: string) {
  return id + String(value.length).padStart(2, '0') + value;
}

export function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function formatTarget(id: string): { tag: string; value: string } {
  const digits = id.replace(/\D/g, '');
  if (digits.length >= 15) return { tag: '03', value: digits };                 // e-wallet id
  if (digits.length >= 13) return { tag: '02', value: digits };                 // national id / tax id
  const phone = ('0000000000000' + digits.replace(/^0/, '66')).slice(-13);      // mobile → 0066XXXXXXXXX
  return { tag: '01', value: phone };
}

export function promptPayPayload(target: string, amountSatang?: number): string {
  const t = formatTarget(target);
  const merchant = tlv('00', 'A000000677010111') + tlv(t.tag, t.value);
  let payload =
    tlv('00', '01') +
    tlv('01', amountSatang ? '12' : '11') +
    tlv('29', merchant) +
    tlv('53', '764') +
    (amountSatang ? tlv('54', (amountSatang / 100).toFixed(2)) : '') +
    tlv('58', 'TH');
  payload += '6304';
  return payload + crc16(payload);
}
