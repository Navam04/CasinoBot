import type { PrismaClient } from "../generated/prisma/client.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Card } from "../src/services/blackjack/blackjackEngine.js";
import { BLACKJACK_STATUS, BlackjackService } from "../src/services/blackjack/blackjackService.js";
import { createTestDatabase } from "./helpers/database.js";

function fixedDeck(cards: Card[]): () => Card[] {
  return () => [...cards];
}

describe("BlackjackService", () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;

  beforeEach(() => {
    ({ prisma, cleanup } = createTestDatabase());
  });

  afterEach(async () => cleanup());

  it("starts each player with 1,000 chips and pays a natural blackjack at 3:2", async () => {
    const service = new BlackjackService(prisma, fixedDeck(["A♠", "K♣", "9♦", "7♥"]));

    expect(await service.balance("guild", "player")).toBe(1000);
    const game = await service.start("guild", "player", 100);

    expect(game.status).toBe(BLACKJACK_STATUS.BLACKJACK);
    expect(game.payout).toBe(250);
    expect(game.balance).toBe(1150);
  });

  it("persists a wager and loses it when the player busts", async () => {
    const service = new BlackjackService(prisma, fixedDeck(["10♠", "6♣", "9♦", "7♥", "K♠"]));
    const started = await service.start("guild", "player", 100);

    expect(started.status).toBe(BLACKJACK_STATUS.ACTIVE);
    expect(started.balance).toBe(900);
    expect((await service.activeGame("guild", "player")).id).toBe(started.id);
    const finished = await service.hit("guild", "player", started.id);
    expect(finished.status).toBe(BLACKJACK_STATUS.LOST);
    expect(finished.balance).toBe(900);
    await expect(service.hit("guild", "player", started.id)).rejects.toThrow(/finished/u);
  });

  it("plays the dealer hand on stand and returns double the wager for a win", async () => {
    const service = new BlackjackService(prisma, fixedDeck(["10♠", "8♣", "9♦", "6♥", "K♠"]));
    const started = await service.start("guild", "player", 200);
    const finished = await service.stand("guild", "player", started.id);

    expect(finished.status).toBe(BLACKJACK_STATUS.WON);
    expect(finished.payout).toBe(400);
    expect(finished.balance).toBe(1200);
  });

  it("rejects other players and overlapping games", async () => {
    const service = new BlackjackService(prisma, fixedDeck(["10♠", "8♣", "9♦", "7♥", "2♠"]));
    const started = await service.start("guild", "player", 100);

    await expect(service.start("guild", "player", 100)).rejects.toThrow(/current/u);
    await expect(service.hit("guild", "intruder", started.id)).rejects.toThrow(/only the player/iu);
  });

  it("uses operation IDs to prevent duplicate wagers and settlements", async () => {
    const service = new BlackjackService(prisma, fixedDeck(["10♠", "8♣", "9♦", "6♥", "K♠"]));
    const started = await service.start("guild", "player", 100, "deal-op");
    const repeatedDeal = await service.start("guild", "player", 100, "deal-op");
    expect(repeatedDeal).toEqual(started);
    expect(await service.balance("guild", "player")).toBe(900);

    const finished = await service.stand("guild", "player", started.id, "stand-op");
    const repeatedStand = await service.stand("guild", "player", started.id, "stand-op");
    expect(repeatedStand).toEqual(finished);
    expect(await service.balance("guild", "player")).toBe(1100);
  });

  it("grants daily recovery chips only once per 24 hours", async () => {
    const service = new BlackjackService(prisma);
    const now = new Date("2026-07-29T03:00:00.000Z");
    const claim = await service.claimDaily("guild", "player", now);

    expect(claim.amount).toBe(250);
    expect(claim.balance).toBe(1250);
    await expect(
      service.claimDaily("guild", "player", new Date(now.getTime() + 60_000)),
    ).rejects.toThrow(/next daily/u);
    expect(
      (await service.claimDaily("guild", "player", new Date(now.getTime() + 24 * 60 * 60 * 1000)))
        .balance,
    ).toBe(1500);
  });

  it("tracks dealer naturals across the server's last 100 completed games", async () => {
    const service = new BlackjackService(prisma);
    const games = Array.from({ length: 102 }, (_, index) => ({
      guildId: "guild",
      userId: `player-${index}`,
      wager: 10,
      status: BLACKJACK_STATUS.LOST,
      deck: "[]",
      playerHand: JSON.stringify(["10♠", "9♣"]),
      dealerHand: JSON.stringify(index < 2 || index === 101 ? ["A♠", "K♣"] : ["10♦", "9♥"]),
      createdAt: new Date(1_000 + index),
      finishedAt: new Date(1_000 + index),
    }));
    await prisma.blackjackGame.createMany({ data: games });
    await prisma.blackjackGame.create({
      data: {
        guildId: "guild",
        userId: "active-player",
        wager: 10,
        status: BLACKJACK_STATUS.ACTIVE,
        deck: "[]",
        playerHand: JSON.stringify(["10♠", "9♣"]),
        dealerHand: JSON.stringify(["A♥", "Q♠"]),
      },
    });
    await prisma.blackjackGame.create({
      data: {
        guildId: "other-guild",
        userId: "other-player",
        wager: 10,
        status: BLACKJACK_STATUS.LOST,
        deck: "[]",
        playerHand: JSON.stringify(["10♠", "9♣"]),
        dealerHand: JSON.stringify(["A♦", "J♠"]),
        finishedAt: new Date(10_000),
      },
    });

    expect(await service.houseBlackjackStats("guild")).toEqual({
      blackjacks: 1,
      gamesTracked: 100,
    });
    expect(await service.houseBlackjackStats("empty-guild")).toEqual({
      blackjacks: 0,
      gamesTracked: 0,
    });
  });
});
