import type { Env } from './util';

/**
 * AI bots, free on Workers AI's daily allowance: Nova everywhere, and bots a server's admins
 * make (a name and what it does). Someone writes "@Nova …" or "@Chef …" in a chat and the bot
 * answers in that room, with the last few messages as context.
 */

export interface BotInfo {
  id: string;
  name: string;
  instructions: string;
  builtIn: boolean;
}

export const NOVA_ID = 'bot-nova';
/** Replies per server per day: keeps everyone inside the free allowance. */
export const BOT_DAILY_LIMIT = 150;
/**
 * Tried in order: Cloudflare retires models now and then (Llama 3.1 8B went in May 2026), so a
 * retired or failing one falls through to the next instead of breaking the bots.
 */
const MODELS = ['@cf/google/gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-3.1-8b-instruct-fp8'];

export async function loadBots(env: Env, channelId: string): Promise<BotInfo[]> {
  const { results } = await env.DB.prepare(
    'SELECT u.id, u.name, b.instructions, b.channel_id FROM bots b JOIN users u ON u.id = b.user_id WHERE b.channel_id IS NULL OR b.channel_id = ? ORDER BY b.created_at',
  )
    .bind(channelId)
    .all<{ id: string; name: string; instructions: string; channel_id: string | null }>();
  return results.map((r) => ({ id: r.id, name: r.name, instructions: r.instructions, builtIn: r.channel_id === null }));
}

/** The bot a message calls on ("@Nova what's…"), if any: the first one mentioned. */
export function mentionedBot(content: string, bots: BotInfo[]): BotInfo | null {
  for (const match of content.matchAll(/@([\p{L}\p{N}_-]{2,24})/gu)) {
    const bot = bots.find((b) => b.name.toLowerCase() === match[1].toLowerCase());
    if (bot) return bot;
  }
  return null;
}

/** A bot's answer to the latest message, given the room's recent lines ("Name: text", oldest first). */
export async function botAnswer(env: Env, bot: BotInfo, roomName: string, history: string[]): Promise<string> {
  const system = [
    `You are ${bot.name}, an AI bot in Infimeety, a chat and voice app. Your job: ${bot.instructions}`,
    `You're replying in the chat room "${roomName}". Keep answers short and friendly (under 150 words unless asked for more), in plain text with no headings.`,
    'Reply in the language the person wrote in (Bangla, English or any other). Never pretend to be a person.',
  ].join('\n');
  const ai = env.AI as unknown as { run(model: string, input: Record<string, unknown>): Promise<{ response?: string; choices?: { message?: { content?: string } }[] }> };
  const messages = [{ role: 'system', content: system }, ...history.map((line, i) => ({ role: 'user', content: i === history.length - 1 ? line : `(earlier) ${line}` }))];
  let lastError: unknown;
  for (const model of MODELS) {
    try {
      const out = await ai.run(model, { messages, max_tokens: 500 });
      // Older models answer in `response`, newer ones in the OpenAI shape.
      const text = (out.response ?? out.choices?.[0]?.message?.content ?? '').trim();
      if (text) return text.slice(0, 3500);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('No answer');
}
