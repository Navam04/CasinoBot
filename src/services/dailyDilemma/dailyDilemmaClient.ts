import type { Logger } from "pino";
import { z } from "zod";
export const DAILY_DILEMMA_URL = "https://dailydilemma.fun";
const schema = z.object({ data: z.object({ poll_id: z.number().int().positive(), prompt: z.string().min(1), redOption: z.string().min(1), blueOption: z.string().min(1), published_at: z.string().min(1) }) });
export interface DailyDilemma { pollId: number; prompt: string; redOption: string; blueOption: string; publishedAt: string }
export type DailyDilemmaChoice = "red" | "blue";
export class DailyDilemmaClient {
  constructor(private readonly apiKey: string | undefined, private readonly logger: Logger, private readonly request: typeof fetch = fetch) {}
  async getCurrent(): Promise<DailyDilemma> {
    const response = await this.request(`${DAILY_DILEMMA_URL}/api/v1/dilemmas/current`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Daily Dilemma returned HTTP ${response.status}`);
    const { data } = schema.parse(await response.json());
    return { pollId: data.poll_id, prompt: data.prompt, redOption: data.redOption, blueOption: data.blueOption, publishedAt: data.published_at };
  }
  async submitVote(pollId: number, choice: DailyDilemmaChoice, voterId: string): Promise<"accepted" | "duplicate" | "failed"> {
    if (!this.apiKey) return "failed";
    try {
      const response = await this.request(`${DAILY_DILEMMA_URL}/api/v1/votes`, { method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ pollId, choice, voterId }), signal: AbortSignal.timeout(10_000) });
      return response.status === 201 ? "accepted" : response.status === 409 ? "duplicate" : "failed";
    } catch (error) { this.logger.warn({ error }, "Daily Dilemma vote failed"); return "failed"; }
  }
}
