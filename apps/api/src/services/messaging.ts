import { config } from '../config.js';

/**
 * Outbound SMS / e-mail. The LOG sender prints messages (development). Plug a real
 * provider (e.g. Thai SMS gateway, SES, SendGrid) by implementing MessageSender.
 */
export interface Message { to: string; channel: 'SMS' | 'EMAIL'; text: string; subject?: string }
export interface MessageSender { send(m: Message): Promise<void> }

class LogSender implements MessageSender {
  async send(m: Message) { if (!config.isTest) console.log(`[message:${m.channel}] → ${m.to}: ${m.text}`); }
}
let sender: MessageSender = new LogSender();
export function setMessageSender(s: MessageSender) { sender = s; }
export async function sendMessage(m: Message) { await sender.send(m); }
