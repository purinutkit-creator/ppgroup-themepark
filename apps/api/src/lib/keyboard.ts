/**
 * USB / Bluetooth barcode scanners type the code as keystrokes. When the computer's keyboard is switched to the
 * Thai (Kedmanee) layout, "TP1.ABC" arrives as "ธญๅใฤฺฉ" and card numbers as Thai letters. If the text contains
 * Thai characters, map every character back to the US-layout key that produced it.
 */
const PAIRS: Array<[string, string]> = [
  // [US key, Thai output] — unshifted then shifted, row by row
  ['`', '_'], ['1', 'ๅ'], ['2', '/'], ['3', '-'], ['4', 'ภ'], ['5', 'ถ'], ['6', 'ุ'], ['7', 'ึ'], ['8', 'ค'], ['9', 'ต'], ['0', 'จ'], ['-', 'ข'], ['=', 'ช'],
  ['~', '%'], ['!', '+'], ['@', '๑'], ['#', '๒'], ['$', '๓'], ['%', '๔'], ['^', 'ู'], ['&', '฿'], ['*', '๕'], ['(', '๖'], [')', '๗'], ['_', '๘'], ['+', '๙'],
  ['q', 'ๆ'], ['w', 'ไ'], ['e', 'ำ'], ['r', 'พ'], ['t', 'ะ'], ['y', 'ั'], ['u', 'ี'], ['i', 'ร'], ['o', 'น'], ['p', 'ย'], ['[', 'บ'], [']', 'ล'], ['\\', 'ฃ'],
  ['Q', '๐'], ['W', '"'], ['E', 'ฎ'], ['R', 'ฑ'], ['T', 'ธ'], ['Y', 'ํ'], ['U', '๊'], ['I', 'ณ'], ['O', 'ฯ'], ['P', 'ญ'], ['{', 'ฐ'], ['}', ','], ['|', 'ฅ'],
  ['a', 'ฟ'], ['s', 'ห'], ['d', 'ก'], ['f', 'ด'], ['g', 'เ'], ['h', '้'], ['j', '่'], ['k', 'า'], ['l', 'ส'], [';', 'ว'], ["'", 'ง'],
  ['A', 'ฤ'], ['S', 'ฆ'], ['D', 'ฏ'], ['F', 'โ'], ['G', 'ฌ'], ['H', '็'], ['J', '๋'], ['K', 'ษ'], ['L', 'ศ'], [':', 'ซ'], ['"', '.'],
  ['z', 'ผ'], ['x', 'ป'], ['c', 'แ'], ['v', 'อ'], ['b', 'ิ'], ['n', 'ื'], ['m', 'ท'], [',', 'ม'], ['.', 'ใ'], ['/', 'ฝ'],
  ['Z', '('], ['X', ')'], ['C', 'ฉ'], ['V', 'ฮ'], ['B', 'ฺ'], ['N', '์'], ['M', '?'], ['<', 'ฒ'], ['>', 'ฬ'], ['?', 'ฦ'],
];
const TH_TO_US = new Map(PAIRS.map(([us, th]) => [th, us]));

export function fixThaiKeyboardLayout(raw: string): string {
  if (!/[฀-๿]/.test(raw)) return raw;
  return [...raw].map((ch) => TH_TO_US.get(ch) ?? ch).join('');
}
