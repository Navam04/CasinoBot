import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/config/logger.js";
import { dailyDilemmaScheduledDate } from "../src/scheduler/dailyDilemmaAnnouncer.js";
import {
  DailyDilemmaClient,
  type DailyDilemma,
} from "../src/services/dailyDilemma/dailyDilemmaClient.js";

const logger = createLogger({ LOG_LEVEL: "silent" });
const dilemma: DailyDilemma = {
  pollId: 369,
  prompt: "Would you rather choose A or B?",
  redOption: "Choose A",
  blueOption: "Choose B",
  publishedAt: "2026-07-31T03:52:17.664568-04:00",
};

describe("Daily Dilemma API client", () => {
  it("parses the current prompt and both choices", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            poll_id: dilemma.pollId,
            prompt: dilemma.prompt,
            redOption: dilemma.redOption,
            blueOption: dilemma.blueOption,
            published_at: dilemma.publishedAt,
          },
        }),
        { status: 200 },
      ),
    );

    await expect(new DailyDilemmaClient(undefined, logger, request).getCurrent()).resolves.toEqual(
      dilemma,
    );
  });

  it("posts authenticated votes only when an API key is configured", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    await expect(
      new DailyDilemmaClient(undefined, logger, request).submitVote(369, "red", "12345"),
    ).resolves.toBe("failed");
    expect(request).not.toHaveBeenCalled();

    await expect(
      new DailyDilemmaClient("placeholder-key", logger, request).submitVote(
        369,
        "blue",
        "12345",
      ),
    ).resolves.toBe("accepted");
    expect(request).toHaveBeenCalledWith(
      "https://dailydilemma.fun/api/v1/votes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer placeholder-key" }),
      }),
    );
  });
});

describe("Daily Dilemma scheduling", () => {
  it("recognizes 12:05 AM in different IANA timezones", () => {
    expect(
      dailyDilemmaScheduledDate(new Date("2026-07-31T04:05:00.000Z"), "America/Toronto"),
    ).toBe("2026-07-31");
    expect(
      dailyDilemmaScheduledDate(new Date("2026-07-31T07:05:00.000Z"), "America/Los_Angeles"),
    ).toBe("2026-07-31");
    expect(
      dailyDilemmaScheduledDate(new Date("2026-07-31T04:04:00.000Z"), "America/Toronto"),
    ).toBeUndefined();
  });
});
