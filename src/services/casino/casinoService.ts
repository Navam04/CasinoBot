import type {
  CasinoAccount,
  CasinoTransaction,
  PrismaClient,
} from "../../../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { ConflictError, ValidationError } from "../../utilities/errors.js";
import {
  CRASH_TARGETS,
  cryptoRandomInteger,
  flipCoin,
  launchCrash,
  rollDice,
  spinRoulette,
  spinSlots,
  type CoinSide,
  type CrashTarget,
  type RandomInteger,
  type RouletteBet,
} from "./casinoEngine.js";

export const STARTING_BALANCE = 1000;
export const DAILY_AMOUNT = 250;
export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MIN_WAGER = 10;
export const MAX_WAGER = 500;
export const MIN_TRANSFER = 10;
export const MAX_ADMIN_GRANT = 1_000_000;
const COIN_SIDES = new Set<CoinSide>(["heads", "tails"]);
const SUPPORTED_CRASH_TARGETS = new Set<number>(CRASH_TARGETS);
const ROULETTE_BETS = new Set<RouletteBet>([
  "number",
  "red",
  "black",
  "odd",
  "even",
  "low",
  "high",
]);

export interface DailyClaim {
  amount: number;
  balance: number;
  nextClaimAt: Date;
}

export interface CasinoRoundResult {
  game: "COIN_FLIP" | "CRASH" | "DICE_DUEL" | "SLOTS" | "ROULETTE";
  wager: number;
  payout: number;
  balance: number;
  outcome: string;
  won: boolean;
  pushed: boolean;
}

export interface CasinoHistoryEntry {
  id: number;
  game: string;
  type: string;
  wager: number;
  payout: number;
  delta: number;
  balanceAfter: number;
  details: string | null;
  createdAt: Date;
}

export interface CasinoStats {
  balance: number;
  gamesPlayed: number;
  totalWagered: number;
  totalReturned: number;
  netGaming: number;
  favoriteGame: string | null;
}

export interface CasinoTransferResult {
  amount: number;
  senderBalance: number;
  recipientBalance: number;
}

export interface CasinoDailyPerformance {
  userId: string;
  delta: number;
}

export interface AdminChipGrant {
  amount: number;
  balance: number;
}

export class CasinoService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly random: RandomInteger = cryptoRandomInteger,
  ) {}

  public async balance(guildId: string, userId: string): Promise<number> {
    return (await this.account(guildId, userId)).balance;
  }

  public async claimDaily(guildId: string, userId: string, now = new Date()): Promise<DailyClaim> {
    return this.prisma.$transaction(async (transaction) => {
      const account = await transaction.casinoAccount.upsert({
        where: { guildId_userId: { guildId, userId } },
        create: { guildId, userId, balance: STARTING_BALANCE },
        update: {},
      });
      if (account.lastDailyAt) {
        const nextClaimAt = new Date(account.lastDailyAt.getTime() + DAILY_INTERVAL_MS);
        if (nextClaimAt > now) {
          throw new ConflictError(
            `Your next daily chips are available <t:${Math.floor(nextClaimAt.getTime() / 1000)}:R>.`,
          );
        }
      }
      const updated = await transaction.casinoAccount.update({
        where: { id: account.id },
        data: { balance: { increment: DAILY_AMOUNT }, lastDailyAt: now },
      });
      await transaction.casinoTransaction.create({
        data: {
          guildId,
          userId,
          game: "SYSTEM",
          type: "DAILY",
          payout: DAILY_AMOUNT,
          delta: DAILY_AMOUNT,
          balanceAfter: updated.balance,
        },
      });
      return {
        amount: DAILY_AMOUNT,
        balance: updated.balance,
        nextClaimAt: new Date(now.getTime() + DAILY_INTERVAL_MS),
      };
    });
  }

  public async setReminders(guildId: string, userId: string, enabled: boolean): Promise<boolean> {
    const account = await this.prisma.casinoAccount.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, balance: STARTING_BALANCE, remindersEnabled: enabled },
      update: { remindersEnabled: enabled },
    });
    return account.remindersEnabled;
  }

  public leaderboard(guildId: string, limit = 25): Promise<CasinoAccount[]> {
    return this.prisma.casinoAccount.findMany({
      where: { guildId },
      orderBy: [{ balance: "desc" }, { updatedAt: "asc" }],
      take: limit,
    });
  }

  public async dailyPerformance(guildId: string, since: Date): Promise<CasinoDailyPerformance[]> {
    const changes = await this.prisma.casinoTransaction.groupBy({
      by: ["userId"],
      where: {
        guildId,
        game: { not: "SYSTEM" },
        createdAt: { gte: since },
      },
      _sum: { delta: true },
    });
    return changes
      .map((entry) => ({ userId: entry.userId, delta: entry._sum.delta ?? 0 }))
      .filter((entry) => entry.delta !== 0)
      .toSorted(
        (left, right) => right.delta - left.delta || left.userId.localeCompare(right.userId),
      );
  }

  public recentPlayers(guildId: string, since: Date): Promise<CasinoAccount[]> {
    return this.prisma.casinoAccount.findMany({
      where: {
        guildId,
        remindersEnabled: true,
        lastGambledAt: { gte: since },
      },
      orderBy: [{ balance: "desc" }, { lastGambledAt: "asc" }],
    });
  }

  public async history(guildId: string, userId: string, limit = 10): Promise<CasinoHistoryEntry[]> {
    const entries = await this.prisma.casinoTransaction.findMany({
      where: { guildId, userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 25),
    });
    return entries.map((entry) => this.toHistory(entry));
  }

  public async stats(guildId: string, userId: string): Promise<CasinoStats> {
    const [account, totals, gameCounts] = await Promise.all([
      this.account(guildId, userId),
      this.prisma.casinoTransaction.aggregate({
        where: { guildId, userId, game: { not: "SYSTEM" } },
        _sum: { wager: true, payout: true, delta: true },
      }),
      this.prisma.casinoTransaction.groupBy({
        by: ["game"],
        where: { guildId, userId, game: { not: "SYSTEM" }, wager: { gt: 0 } },
        _count: { _all: true },
      }),
    ]);
    const orderedGames = gameCounts.toSorted(
      (left, right) => right._count._all - left._count._all || left.game.localeCompare(right.game),
    );
    return {
      balance: account.balance,
      gamesPlayed: gameCounts.reduce((total, entry) => total + entry._count._all, 0),
      totalWagered: totals._sum.wager ?? 0,
      totalReturned: totals._sum.payout ?? 0,
      netGaming: totals._sum.delta ?? 0,
      favoriteGame: orderedGames[0]?.game ?? null,
    };
  }

  public async adminAddChips(
    guildId: string,
    targetUserId: string,
    adminUserId: string,
    amount: number,
    operationId: string = randomUUID(),
    now = new Date(),
  ): Promise<AdminChipGrant> {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_ADMIN_GRANT) {
      throw new ValidationError(
        `Admin grants must be whole chips from 1 to ${MAX_ADMIN_GRANT.toLocaleString("en-CA")}.`,
      );
    }
    if (!operationId.trim()) {
      throw new ValidationError("The casino operation ID is missing.");
    }
    const details = JSON.stringify({ adminUserId });

    const execute = async (): Promise<AdminChipGrant> =>
      this.prisma.$transaction(async (database) => {
        const existing = await database.casinoTransaction.findUnique({
          where: { operationId },
        });
        if (existing) {
          if (
            existing.guildId !== guildId ||
            existing.userId !== targetUserId ||
            existing.game !== "SYSTEM" ||
            existing.type !== "ADMIN_GRANT" ||
            existing.delta !== amount ||
            existing.details !== details
          ) {
            throw new ConflictError(
              "That casino operation ID was already used for another action.",
            );
          }
          return { amount, balance: existing.balanceAfter };
        }

        const account = await database.casinoAccount.upsert({
          where: { guildId_userId: { guildId, userId: targetUserId } },
          create: { guildId, userId: targetUserId, balance: STARTING_BALANCE },
          update: {},
        });
        const updated = await database.casinoAccount.update({
          where: { id: account.id },
          data: { balance: { increment: amount } },
        });
        await database.casinoTransaction.create({
          data: {
            operationId,
            guildId,
            userId: targetUserId,
            game: "SYSTEM",
            type: "ADMIN_GRANT",
            payout: amount,
            delta: amount,
            balanceAfter: updated.balance,
            details,
            createdAt: now,
          },
        });
        return { amount, balance: updated.balance };
      });

    try {
      return await execute();
    } catch (error) {
      const existing = await this.prisma.casinoTransaction.findUnique({
        where: { operationId },
      });
      if (existing) {
        return await execute();
      }
      throw error;
    }
  }

  public async transfer(
    guildId: string,
    senderId: string,
    recipientId: string,
    amount: number,
    operationId: string = randomUUID(),
    now = new Date(),
  ): Promise<CasinoTransferResult> {
    if (senderId === recipientId) {
      throw new ValidationError("You cannot transfer chips to yourself.");
    }
    if (!Number.isSafeInteger(amount) || amount < MIN_TRANSFER) {
      throw new ValidationError(`Transfers must be at least ${MIN_TRANSFER} whole chips.`);
    }
    if (!operationId.trim()) {
      throw new ValidationError("The casino operation ID is missing.");
    }
    const recipientOperationId = `${operationId}:in`;

    const execute = async (): Promise<CasinoTransferResult> =>
      this.prisma.$transaction(async (database) => {
        const existing = await database.casinoTransaction.findUnique({
          where: { operationId },
        });
        if (existing) {
          if (
            existing.guildId !== guildId ||
            existing.userId !== senderId ||
            existing.game !== "SYSTEM" ||
            existing.type !== "TRANSFER_OUT" ||
            existing.delta !== -amount
          ) {
            throw new ConflictError(
              "That casino operation ID was already used for another action.",
            );
          }
          const incoming = await database.casinoTransaction.findUniqueOrThrow({
            where: { operationId: recipientOperationId },
          });
          if (
            incoming.guildId !== guildId ||
            incoming.userId !== recipientId ||
            incoming.game !== "SYSTEM" ||
            incoming.type !== "TRANSFER_IN" ||
            incoming.delta !== amount
          ) {
            throw new ConflictError("That transfer does not match the original recipient.");
          }
          return {
            amount,
            senderBalance: existing.balanceAfter,
            recipientBalance: incoming.balanceAfter,
          };
        }

        const sender = await database.casinoAccount.upsert({
          where: { guildId_userId: { guildId, userId: senderId } },
          create: { guildId, userId: senderId, balance: STARTING_BALANCE },
          update: {},
        });
        const debited = await database.casinoAccount.updateMany({
          where: { id: sender.id, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (debited.count !== 1) {
          throw new ValidationError(
            `You only have ${sender.balance.toLocaleString("en-CA")} chips to transfer.`,
          );
        }
        const updatedSender = await database.casinoAccount.findUniqueOrThrow({
          where: { id: sender.id },
        });
        const recipient = await database.casinoAccount.upsert({
          where: { guildId_userId: { guildId, userId: recipientId } },
          create: { guildId, userId: recipientId, balance: STARTING_BALANCE },
          update: {},
        });
        const credited = await database.casinoAccount.update({
          where: { id: recipient.id },
          data: { balance: { increment: amount } },
        });
        await database.casinoTransaction.create({
          data: {
            operationId,
            guildId,
            userId: senderId,
            game: "SYSTEM",
            type: "TRANSFER_OUT",
            delta: -amount,
            balanceAfter: updatedSender.balance,
            details: JSON.stringify({ recipientId }),
            createdAt: now,
          },
        });
        await database.casinoTransaction.create({
          data: {
            operationId: recipientOperationId,
            guildId,
            userId: recipientId,
            game: "SYSTEM",
            type: "TRANSFER_IN",
            payout: amount,
            delta: amount,
            balanceAfter: credited.balance,
            details: JSON.stringify({ senderId }),
            createdAt: now,
          },
        });
        return {
          amount,
          senderBalance: updatedSender.balance,
          recipientBalance: credited.balance,
        };
      });

    try {
      return await execute();
    } catch (error) {
      const existing = await this.prisma.casinoTransaction.findUnique({
        where: { operationId },
      });
      if (existing) {
        return await execute();
      }
      throw error;
    }
  }

  public async playCoinFlip(
    guildId: string,
    userId: string,
    wager: number,
    choice: CoinSide,
    operationId: string = randomUUID(),
    now = new Date(),
  ): Promise<CasinoRoundResult> {
    const replay = await this.existingRound(operationId, guildId, userId, "COIN_FLIP");
    if (replay) {
      return replay;
    }
    if (!COIN_SIDES.has(choice)) {
      throw new ValidationError("Coin flip choices must be heads or tails.");
    }
    const landed = flipCoin(this.random);
    return await this.settleRound(
      guildId,
      userId,
      wager,
      operationId,
      "COIN_FLIP",
      landed === choice ? wager * 2 : 0,
      `Chose ${choice}; landed ${landed}.`,
      now,
    );
  }

  public async playCrash(
    guildId: string,
    userId: string,
    wager: number,
    target: CrashTarget,
    operationId: string = randomUUID(),
    now = new Date(),
  ): Promise<CasinoRoundResult> {
    const replay = await this.existingRound(operationId, guildId, userId, "CRASH");
    if (replay) {
      return replay;
    }
    if (!SUPPORTED_CRASH_TARGETS.has(target)) {
      throw new ValidationError(`Crash targets must be ${CRASH_TARGETS.join(", ")}×.`);
    }
    const launched = launchCrash(target, this.random);
    return await this.settleRound(
      guildId,
      userId,
      wager,
      operationId,
      "CRASH",
      wager * launched.payoutMultiplier,
      launched.won
        ? `The rocket held through your ${target}× cash-out.`
        : `The rocket crashed before your ${target}× cash-out.`,
      now,
    );
  }

  public async playDice(
    guildId: string,
    userId: string,
    wager: number,
    operationId: string = randomUUID(),
    now = new Date(),
  ): Promise<CasinoRoundResult> {
    const replay = await this.existingRound(operationId, guildId, userId, "DICE_DUEL");
    if (replay) {
      return replay;
    }
    const rolled = rollDice(this.random);
    return await this.settleRound(
      guildId,
      userId,
      wager,
      operationId,
      "DICE_DUEL",
      wager * rolled.payoutMultiplier,
      `You rolled ${rolled.player}; dealer rolled ${rolled.dealer}.`,
      now,
    );
  }

  public async playSlots(
    guildId: string,
    userId: string,
    wager: number,
    operationId: string = randomUUID(),
    now = new Date(),
  ): Promise<CasinoRoundResult> {
    const replay = await this.existingRound(operationId, guildId, userId, "SLOTS");
    if (replay) {
      return replay;
    }
    const spun = spinSlots(this.random);
    return await this.settleRound(
      guildId,
      userId,
      wager,
      operationId,
      "SLOTS",
      wager * spun.payoutMultiplier,
      `${spun.reels.join(" ")} · ${spun.payoutMultiplier}× return.`,
      now,
    );
  }

  public async playRoulette(
    guildId: string,
    userId: string,
    wager: number,
    bet: RouletteBet,
    target: number | undefined,
    operationId: string = randomUUID(),
    now = new Date(),
  ): Promise<CasinoRoundResult> {
    const replay = await this.existingRound(operationId, guildId, userId, "ROULETTE");
    if (replay) {
      return replay;
    }
    if (!ROULETTE_BETS.has(bet)) {
      throw new ValidationError("That roulette bet is not supported.");
    }
    if (bet === "number") {
      if (!Number.isSafeInteger(target) || target === undefined || target < 0 || target > 36) {
        throw new ValidationError("An exact-number roulette bet needs a number from 0 to 36.");
      }
    } else if (target !== undefined) {
      throw new ValidationError("The number option is only used with an exact-number bet.");
    }
    const spun = spinRoulette(bet, target, this.random);
    const selection = bet === "number" ? `number ${target}` : bet;
    return await this.settleRound(
      guildId,
      userId,
      wager,
      operationId,
      "ROULETTE",
      wager * spun.payoutMultiplier,
      `Bet ${selection}; wheel landed ${spun.number} ${spun.color}.`,
      now,
    );
  }

  private async existingRound(
    operationId: string,
    guildId: string,
    userId: string,
    game: CasinoRoundResult["game"],
  ): Promise<CasinoRoundResult | undefined> {
    const existing = await this.prisma.casinoTransaction.findUnique({ where: { operationId } });
    return existing ? this.replay(existing, guildId, userId, game) : undefined;
  }

  private async settleRound(
    guildId: string,
    userId: string,
    wager: number,
    operationId: string,
    game: CasinoRoundResult["game"],
    payout: number,
    outcome: string,
    now: Date,
  ): Promise<CasinoRoundResult> {
    this.validateWager(wager);
    if (!operationId.trim()) {
      throw new ValidationError("The casino operation ID is missing.");
    }

    const existing = await this.prisma.casinoTransaction.findUnique({ where: { operationId } });
    if (existing) {
      return this.replay(existing, guildId, userId, game);
    }

    try {
      const transaction = await this.prisma.$transaction(async (database) => {
        const repeated = await database.casinoTransaction.findUnique({ where: { operationId } });
        if (repeated) {
          return repeated;
        }
        const account = await database.casinoAccount.upsert({
          where: { guildId_userId: { guildId, userId } },
          create: { guildId, userId, balance: STARTING_BALANCE },
          update: {},
        });
        const delta = payout - wager;
        const changed = await database.casinoAccount.updateMany({
          where: { id: account.id, balance: { gte: wager } },
          data: { balance: { increment: delta }, lastGambledAt: now },
        });
        if (changed.count !== 1) {
          throw new ValidationError(
            `You only have ${account.balance.toLocaleString("en-CA")} chips. Lower the wager or claim your daily chips.`,
          );
        }
        const updated = await database.casinoAccount.findUniqueOrThrow({
          where: { id: account.id },
        });
        return database.casinoTransaction.create({
          data: {
            operationId,
            guildId,
            userId,
            game,
            type: "ROUND",
            wager,
            payout,
            delta,
            balanceAfter: updated.balance,
            details: outcome,
            createdAt: now,
          },
        });
      });
      return this.replay(transaction, guildId, userId, game);
    } catch (error) {
      const repeated = await this.prisma.casinoTransaction.findUnique({ where: { operationId } });
      if (repeated) {
        return this.replay(repeated, guildId, userId, game);
      }
      throw error;
    }
  }

  private replay(
    transaction: CasinoTransaction,
    guildId: string,
    userId: string,
    game: CasinoRoundResult["game"],
  ): CasinoRoundResult {
    if (
      transaction.guildId !== guildId ||
      transaction.userId !== userId ||
      transaction.game !== game
    ) {
      throw new ConflictError("That casino operation ID was already used for another action.");
    }
    return {
      game,
      wager: transaction.wager,
      payout: transaction.payout,
      balance: transaction.balanceAfter,
      outcome: transaction.details ?? "Round completed.",
      won: transaction.payout > transaction.wager,
      pushed: transaction.payout === transaction.wager,
    };
  }

  private toHistory(entry: CasinoTransaction): CasinoHistoryEntry {
    return {
      id: entry.id,
      game: entry.game,
      type: entry.type,
      wager: entry.wager,
      payout: entry.payout,
      delta: entry.delta,
      balanceAfter: entry.balanceAfter,
      details: entry.details,
      createdAt: entry.createdAt,
    };
  }

  private validateWager(wager: number): void {
    if (!Number.isSafeInteger(wager) || wager < MIN_WAGER || wager > MAX_WAGER) {
      throw new ValidationError(`Wagers must be whole chips from ${MIN_WAGER} to ${MAX_WAGER}.`);
    }
  }

  private account(guildId: string, userId: string): Promise<CasinoAccount> {
    return this.prisma.casinoAccount.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, balance: STARTING_BALANCE },
      update: {},
    });
  }
}
