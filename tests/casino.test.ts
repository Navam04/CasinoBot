import type { PrismaClient } from "../generated/prisma/client.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CasinoService } from "../src/services/casino/casinoService.js";
import type { RandomInteger } from "../src/services/casino/casinoEngine.js";
import { createTestDatabase } from "./helpers/database.js";

function sequence(...values: number[]): RandomInteger {
  let index = 0;
  return (maximum) => {
    const value = values[index];
    index += 1;
    if (value === undefined || value < 0 || value >= maximum) {
      throw new Error(`Invalid deterministic roll ${String(value)} for maximum ${maximum}.`);
    }
    return value;
  };
}

describe("CasinoService", () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;

  beforeEach(() => {
    ({ prisma, cleanup } = createTestDatabase());
  });

  afterEach(async () => cleanup());

  it("shares the starting balance, daily claim, history, and reminder preference", async () => {
    const service = new CasinoService(prisma);
    const now = new Date("2026-07-29T12:00:00.000Z");

    expect(await service.balance("guild", "player")).toBe(1000);
    expect((await service.claimDaily("guild", "player", now)).balance).toBe(1250);
    await expect(
      service.claimDaily("guild", "player", new Date(now.getTime() + 1000)),
    ).rejects.toThrow(/next daily/u);
    expect((await service.history("guild", "player"))[0]).toMatchObject({
      game: "SYSTEM",
      type: "DAILY",
      delta: 250,
      balanceAfter: 1250,
    });
    expect(await service.setReminders("guild", "player", false)).toBe(false);
    expect(await service.recentPlayers("guild", new Date(0))).toEqual([]);
  });

  it("settles coin flip, dice, slots, Crash, and roulette against one account", async () => {
    const coin = new CasinoService(prisma, sequence(0));
    const coinResult = await coin.playCoinFlip("guild", "player", 100, "heads", "coin-op");
    expect(coinResult).toMatchObject({ payout: 200, balance: 1100, won: true });

    const dice = new CasinoService(prisma, sequence(2, 2));
    const diceResult = await dice.playDice("guild", "player", 100, "dice-op");
    expect(diceResult).toMatchObject({ payout: 100, balance: 1100, pushed: true });

    const slots = new CasinoService(prisma, sequence(95, 96, 97));
    const slotsResult = await slots.playSlots("guild", "player", 10, "slots-op");
    expect(slotsResult).toMatchObject({ payout: 300, balance: 1390, won: true });

    const crash = new CasinoService(prisma, sequence(0));
    const crashResult = await crash.playCrash("guild", "player", 10, 5, "crash-op");
    expect(crashResult).toMatchObject({ payout: 50, balance: 1430, won: true });

    const roulette = new CasinoService(prisma, sequence(17));
    const rouletteResult = await roulette.playRoulette(
      "guild",
      "player",
      10,
      "number",
      17,
      "roulette-op",
    );
    expect(rouletteResult).toMatchObject({ payout: 360, balance: 1780, won: true });
    expect(await roulette.recentPlayers("guild", new Date(Date.now() - 60_000))).toHaveLength(1);
  });

  it("summarizes lifetime gaming activity without counting daily claims as play", async () => {
    const service = new CasinoService(prisma, sequence(0, 1, 5, 0));

    expect(await service.stats("guild", "new-player")).toEqual({
      balance: 1000,
      gamesPlayed: 0,
      totalWagered: 0,
      totalReturned: 0,
      netGaming: 0,
      favoriteGame: null,
    });

    await service.claimDaily("guild", "player", new Date("2026-07-30T12:00:00.000Z"));
    await service.playCoinFlip("guild", "player", 100, "heads", "stats-coin-win");
    await service.playCoinFlip("guild", "player", 50, "heads", "stats-coin-loss");
    await service.playDice("guild", "player", 60, "stats-dice");

    expect(await service.stats("guild", "player")).toEqual({
      balance: 1360,
      gamesPlayed: 3,
      totalWagered: 210,
      totalReturned: 320,
      netGaming: 110,
      favoriteGame: "COIN_FLIP",
    });
  });

  it("ranks today's net gambling gains and losses while excluding system transactions", async () => {
    const since = new Date("2026-07-30T04:00:00.000Z");
    const today = new Date("2026-07-30T12:00:00.000Z");
    const yesterday = new Date("2026-07-29T12:00:00.000Z");

    await new CasinoService(prisma, sequence(0)).playCoinFlip(
      "guild",
      "winner",
      100,
      "heads",
      "daily-winner",
      today,
    );
    await new CasinoService(prisma, sequence(1)).playCoinFlip(
      "guild",
      "loser",
      100,
      "heads",
      "daily-loser",
      today,
    );
    await new CasinoService(prisma, sequence(1)).playCoinFlip(
      "guild",
      "old-loser",
      100,
      "heads",
      "old-loss",
      yesterday,
    );
    const service = new CasinoService(prisma);
    await service.claimDaily("guild", "loser", today);
    await service.transfer("guild", "winner", "friend", 25, "daily-transfer", today);
    await service.adminAddChips("guild", "loser", "admin", 500, "daily-admin", today);

    expect(await service.dailyPerformance("guild", since)).toEqual([
      { userId: "winner", delta: 100 },
      { userId: "loser", delta: -100 },
    ]);
  });

  it("adds administrator chips atomically with an idempotent audit transaction", async () => {
    const service = new CasinoService(prisma);
    const first = await service.adminAddChips("guild", "recipient", "admin", 500, "admin-grant");
    const replay = await service.adminAddChips("guild", "recipient", "admin", 500, "admin-grant");

    expect(first).toEqual({ amount: 500, balance: 1500 });
    expect(replay).toEqual(first);
    expect(await service.balance("guild", "recipient")).toBe(1500);
    expect(
      await prisma.casinoTransaction.count({
        where: { operationId: "admin-grant", type: "ADMIN_GRANT" },
      }),
    ).toBe(1);
    expect((await service.history("guild", "recipient"))[0]).toMatchObject({
      game: "SYSTEM",
      type: "ADMIN_GRANT",
      delta: 500,
      balanceAfter: 1500,
      details: JSON.stringify({ adminUserId: "admin" }),
    });
    expect(await service.stats("guild", "recipient")).toMatchObject({
      balance: 1500,
      gamesPlayed: 0,
      netGaming: 0,
    });
  });

  it("rejects invalid administrator grants and operation ID reuse", async () => {
    const service = new CasinoService(prisma, sequence(0));

    await expect(service.adminAddChips("guild", "recipient", "admin", 0, "zero")).rejects.toThrow(
      /1 to 1,000,000/u,
    );
    await expect(
      service.adminAddChips("guild", "recipient", "admin", 1_000_001, "too-large"),
    ).rejects.toThrow(/1 to 1,000,000/u);
    await service.playCoinFlip("guild", "player", 10, "heads", "used-admin-operation");
    await expect(
      service.adminAddChips("guild", "recipient", "admin", 100, "used-admin-operation"),
    ).rejects.toThrow(/another action/u);
  });

  it("transfers chips atomically and replays duplicate interaction IDs", async () => {
    const service = new CasinoService(prisma);
    const first = await service.transfer("guild", "sender", "recipient", 300, "transfer-op");
    const replay = await service.transfer("guild", "sender", "recipient", 300, "transfer-op");

    expect(first).toEqual({ amount: 300, senderBalance: 700, recipientBalance: 1300 });
    expect(replay).toEqual(first);
    expect(await service.balance("guild", "sender")).toBe(700);
    expect(await service.balance("guild", "recipient")).toBe(1300);
    expect(await prisma.casinoTransaction.count({ where: { game: "SYSTEM" } })).toBe(2);
    expect((await service.history("guild", "sender"))[0]).toMatchObject({
      type: "TRANSFER_OUT",
      delta: -300,
      balanceAfter: 700,
    });
    expect((await service.history("guild", "recipient"))[0]).toMatchObject({
      type: "TRANSFER_IN",
      delta: 300,
      balanceAfter: 1300,
    });
    expect(await service.stats("guild", "sender")).toMatchObject({
      balance: 700,
      gamesPlayed: 0,
      netGaming: 0,
    });
  });

  it("rejects invalid transfers without crediting the recipient", async () => {
    const service = new CasinoService(prisma, sequence(0));

    await expect(service.transfer("guild", "player", "player", 100, "self")).rejects.toThrow(
      /yourself/u,
    );
    await expect(service.transfer("guild", "player", "friend", 9, "too-small")).rejects.toThrow(
      /at least 10/u,
    );
    await prisma.casinoAccount.create({
      data: { guildId: "guild", userId: "broke", balance: 5 },
    });
    await expect(service.transfer("guild", "broke", "friend", 10, "too-much")).rejects.toThrow(
      /only have 5/u,
    );
    expect(
      await prisma.casinoAccount.findUnique({
        where: { guildId_userId: { guildId: "guild", userId: "friend" } },
      }),
    ).toBeNull();

    await service.playCoinFlip("guild", "player", 10, "heads", "used-operation");
    await expect(
      service.transfer("guild", "player", "friend", 10, "used-operation"),
    ).rejects.toThrow(/another action/u);
  });

  it("prevents concurrent transfers from overdrawing the sender", async () => {
    const service = new CasinoService(prisma);
    const results = await Promise.allSettled([
      service.transfer("guild", "sender", "first-friend", 600, "concurrent-transfer-1"),
      service.transfer("guild", "sender", "second-friend", 600, "concurrent-transfer-2"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await service.balance("guild", "sender")).toBe(400);
    const recipients = await prisma.casinoAccount.findMany({
      where: { guildId: "guild", userId: { in: ["first-friend", "second-friend"] } },
    });
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.balance).toBe(1600);
  });

  it("rejects invalid wagers, invalid roulette selections, and insufficient funds", async () => {
    const service = new CasinoService(prisma, sequence(0, 0, 0));
    await expect(service.playCoinFlip("guild", "player", 9, "heads", "small")).rejects.toThrow(
      /10 to 500/u,
    );
    await expect(
      service.playRoulette("guild", "player", 10, "number", undefined, "missing-number"),
    ).rejects.toThrow(/0 to 36/u);
    await expect(
      service.playRoulette("guild", "player", 10, "red", 5, "extra-number"),
    ).rejects.toThrow(/only used/u);
    await expect(
      service.playCoinFlip("guild", "player", 10, "edge" as "heads", "invalid-coin"),
    ).rejects.toThrow(/heads or tails/u);
    await expect(
      service.playRoulette("guild", "player", 10, "corner" as "red", undefined, "invalid-roulette"),
    ).rejects.toThrow(/not supported/u);
    await expect(service.playCrash("guild", "player", 10, 4 as 2, "invalid-crash")).rejects.toThrow(
      /2, 3, 5, 10/u,
    );
    await prisma.casinoAccount.upsert({
      where: { guildId_userId: { guildId: "guild", userId: "broke" } },
      create: { guildId: "guild", userId: "broke", balance: 5 },
      update: { balance: 5 },
    });
    await expect(service.playDice("guild", "broke", 10, "broke-op")).rejects.toThrow(
      /only have 5/u,
    );
  });

  it("replays duplicate operation IDs without charging twice", async () => {
    const service = new CasinoService(prisma, sequence(1));
    const first = await service.playCoinFlip("guild", "player", 100, "heads", "same-op");
    const replay = await service.playCoinFlip("guild", "player", 100, "heads", "same-op");

    expect(replay).toEqual(first);
    expect(await service.balance("guild", "player")).toBe(900);
    expect(await prisma.casinoTransaction.count({ where: { operationId: "same-op" } })).toBe(1);
    await expect(service.playCoinFlip("guild", "other", 100, "heads", "same-op")).rejects.toThrow(
      /another action/u,
    );
  });

  it("prevents concurrent wagers from overdrawing an account", async () => {
    const service = new CasinoService(prisma, () => 0);
    const results = await Promise.allSettled([
      service.playRoulette("guild", "player", 500, "black", undefined, "concurrent-1"),
      service.playRoulette("guild", "player", 500, "black", undefined, "concurrent-2"),
      service.playRoulette("guild", "player", 500, "black", undefined, "concurrent-3"),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(await service.balance("guild", "player")).toBe(0);
  });

  it("enforces the activity window, notification opt-out, and one announcement per local day", async () => {
    const service = new CasinoService(prisma, () => 1);
    const now = new Date("2026-07-30T01:00:00.000Z");
    await service.playCoinFlip("guild", "recent", 10, "heads", "recent-op", now);
    await service.playCoinFlip(
      "guild",
      "old",
      10,
      "heads",
      "old-op",
      new Date(now.getTime() - 49 * 60 * 60 * 1000),
    );
    await service.playCoinFlip("guild", "opted-out", 10, "heads", "opt-out-op", now);
    await service.setReminders("guild", "opted-out", false);

    const eligible = await service.recentPlayers(
      "guild",
      new Date(now.getTime() - 48 * 60 * 60 * 1000),
    );
    expect(eligible.map((account) => account.userId)).toEqual(["recent"]);

    await prisma.casinoAnnouncement.create({
      data: { guildId: "guild", localDate: "2026-07-29", channelId: "channel" },
    });
    await expect(
      prisma.casinoAnnouncement.create({
        data: { guildId: "guild", localDate: "2026-07-29", channelId: "channel" },
      }),
    ).rejects.toThrow();
  });
});
