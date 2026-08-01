import type {
  BlackjackGame,
  CasinoAccount,
  CasinoTransaction,
  Prisma,
  PrismaClient,
} from "../../../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../utilities/errors.js";
import {
  createShuffledDeck,
  drawCard,
  isBlackjack,
  parseCards,
  scoreHand,
  type Card,
} from "./blackjackEngine.js";
import {
  CasinoService,
  type DailyClaim,
  MAX_WAGER,
  MIN_WAGER,
  STARTING_BALANCE,
} from "../casino/casinoService.js";

export const BLACKJACK_STATUS = {
  ACTIVE: "ACTIVE",
  BLACKJACK: "BLACKJACK",
  WON: "WON",
  LOST: "LOST",
  PUSH: "PUSH",
} as const;

export type BlackjackStatus = (typeof BLACKJACK_STATUS)[keyof typeof BLACKJACK_STATUS];

export interface BlackjackState {
  id: number;
  guildId: string;
  userId: string;
  wager: number;
  status: BlackjackStatus;
  playerHand: Card[];
  dealerHand: Card[];
  payout: number;
  balance: number;
}

export interface HouseBlackjackStats {
  blackjacks: number;
  gamesTracked: number;
}

interface Resolution {
  status: BlackjackStatus;
  payout: number;
}

export class BlackjackService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly deckFactory: () => Card[] = createShuffledDeck,
    private readonly casino: CasinoService = new CasinoService(prisma),
  ) {}

  public async balance(guildId: string, userId: string): Promise<number> {
    return this.casino.balance(guildId, userId);
  }

  public async houseBlackjackStats(guildId: string): Promise<HouseBlackjackStats> {
    const recentGames = await this.prisma.blackjackGame.findMany({
      where: { guildId, finishedAt: { not: null } },
      orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
      take: 100,
      select: { dealerHand: true },
    });
    return {
      blackjacks: recentGames.filter((game) => isBlackjack(parseCards(game.dealerHand))).length,
      gamesTracked: recentGames.length,
    };
  }

  public async claimDaily(guildId: string, userId: string, now = new Date()): Promise<DailyClaim> {
    return this.casino.claimDaily(guildId, userId, now);
  }

  public async start(
    guildId: string,
    userId: string,
    wager: number,
    operationId: string = randomUUID(),
    now = new Date(),
  ): Promise<BlackjackState> {
    this.validateWager(wager);
    const replay = await this.replayStartedGame(operationId, guildId, userId);
    if (replay) {
      return replay;
    }
    const deck = this.deckFactory();
    if (deck.length < 4) {
      throw new Error("The blackjack deck factory returned too few cards.");
    }
    const playerHand = [drawCard(deck), drawCard(deck)];
    const dealerHand = [drawCard(deck), drawCard(deck)];
    const initial = this.initialResolution(playerHand, dealerHand, wager);

    return this.prisma.$transaction(async (transaction) => {
      const repeated = await transaction.blackjackGame.findUnique({ where: { operationId } });
      if (repeated) {
        this.assertOwner(repeated, guildId, userId);
        const repeatedAccount = await transaction.casinoAccount.findUniqueOrThrow({
          where: { guildId_userId: { guildId, userId } },
        });
        return this.toState(repeated, repeatedAccount.balance);
      }
      let account = await this.account(guildId, userId, transaction);
      if (account.activeBlackjackGameId !== null) {
        const active = await transaction.blackjackGame.findUnique({
          where: { id: account.activeBlackjackGameId },
        });
        if (active?.status === BLACKJACK_STATUS.ACTIVE) {
          throw new ConflictError("Finish your current blackjack game before starting another.");
        }
        account = await transaction.casinoAccount.update({
          where: { id: account.id },
          data: { activeBlackjackGameId: null },
        });
      }
      if (account.balance < wager) {
        throw new ValidationError(
          `You only have ${account.balance.toLocaleString("en-CA")} chips. Lower the wager or claim your daily chips.`,
        );
      }

      const game = await transaction.blackjackGame.create({
        data: {
          operationId,
          guildId,
          userId,
          wager,
          status: initial.status,
          deck: JSON.stringify(deck),
          playerHand: JSON.stringify(playerHand),
          dealerHand: JSON.stringify(dealerHand),
          payout: initial.payout,
          finishedAt: initial.status === BLACKJACK_STATUS.ACTIVE ? null : now,
        },
      });
      const delta = initial.payout - wager;
      const accountUpdate = await transaction.casinoAccount.updateMany({
        where: {
          id: account.id,
          activeBlackjackGameId: null,
          balance: { gte: wager },
        },
        data: {
          balance: { increment: delta },
          activeBlackjackGameId: initial.status === BLACKJACK_STATUS.ACTIVE ? game.id : null,
          lastGambledAt: now,
        },
      });
      if (accountUpdate.count !== 1) {
        throw new ConflictError("Your blackjack account changed. Please try again.");
      }
      const balanceAfter = account.balance + delta;
      await transaction.casinoTransaction.create({
        data: {
          operationId,
          guildId,
          userId,
          game: "BLACKJACK",
          type: initial.status === BLACKJACK_STATUS.ACTIVE ? "WAGER" : "ROUND",
          wager,
          payout: initial.payout,
          delta,
          balanceAfter,
          details: JSON.stringify({ gameId: game.id, status: initial.status, action: "deal" }),
          createdAt: now,
        },
      });
      return this.toState(game, balanceAfter);
    });
  }

  public async activeGame(guildId: string, userId: string): Promise<BlackjackState> {
    return this.prisma.$transaction(async (transaction) => {
      const account = await this.account(guildId, userId, transaction);
      if (account.activeBlackjackGameId === null) {
        throw new NotFoundError("Active blackjack game");
      }
      const game = await transaction.blackjackGame.findUnique({
        where: { id: account.activeBlackjackGameId },
      });
      if (game?.status !== BLACKJACK_STATUS.ACTIVE) {
        await transaction.casinoAccount.update({
          where: { id: account.id },
          data: { activeBlackjackGameId: null },
        });
        throw new NotFoundError("Active blackjack game");
      }
      return this.toState(game, account.balance);
    });
  }

  public async hit(
    guildId: string,
    userId: string,
    gameId: number,
    operationId: string = randomUUID(),
    now = new Date(),
  ): Promise<BlackjackState> {
    return this.advance(guildId, userId, gameId, "hit", operationId, now);
  }

  public async stand(
    guildId: string,
    userId: string,
    gameId: number,
    operationId: string = randomUUID(),
    now = new Date(),
  ): Promise<BlackjackState> {
    return this.advance(guildId, userId, gameId, "stand", operationId, now);
  }

  private async advance(
    guildId: string,
    userId: string,
    gameId: number,
    action: "hit" | "stand",
    operationId: string,
    now: Date,
  ): Promise<BlackjackState> {
    return this.prisma.$transaction(async (transaction) => {
      const replay = await transaction.casinoTransaction.findUnique({ where: { operationId } });
      if (replay) {
        return this.replayAction(replay, transaction, guildId, userId, gameId);
      }
      const game = await transaction.blackjackGame.findFirst({ where: { id: gameId, guildId } });
      if (!game) {
        throw new NotFoundError("Blackjack game");
      }
      if (game.userId !== userId) {
        throw new AuthorizationError("Only the player can use this blackjack table.");
      }
      if (game.status !== BLACKJACK_STATUS.ACTIVE) {
        throw new ConflictError("This blackjack game has already finished.");
      }

      const deck = parseCards(game.deck);
      const playerHand = parseCards(game.playerHand);
      const dealerHand = parseCards(game.dealerHand);
      let resolution: Resolution = { status: BLACKJACK_STATUS.ACTIVE, payout: 0 };
      if (action === "hit") {
        playerHand.push(drawCard(deck));
        const playerTotal = scoreHand(playerHand).total;
        if (playerTotal > 21) {
          resolution = { status: BLACKJACK_STATUS.LOST, payout: 0 };
        } else if (playerTotal === 21) {
          resolution = this.playDealer(deck, playerHand, dealerHand, game.wager);
        }
      } else {
        resolution = this.playDealer(deck, playerHand, dealerHand, game.wager);
      }

      const finished = resolution.status !== BLACKJACK_STATUS.ACTIVE;
      const changed = await transaction.blackjackGame.updateMany({
        where: { id: game.id, version: game.version, status: BLACKJACK_STATUS.ACTIVE },
        data: {
          deck: JSON.stringify(deck),
          playerHand: JSON.stringify(playerHand),
          dealerHand: JSON.stringify(dealerHand),
          status: resolution.status,
          payout: resolution.payout,
          version: { increment: 1 },
          finishedAt: finished ? now : null,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictError("That game was already updated. Please use the latest buttons.");
      }
      const accountChange = finished
        ? await transaction.casinoAccount.updateMany({
            where: { guildId, userId, activeBlackjackGameId: game.id },
            data: {
              balance: { increment: resolution.payout },
              activeBlackjackGameId: null,
              lastGambledAt: now,
            },
          })
        : await transaction.casinoAccount.updateMany({
            where: { guildId, userId, activeBlackjackGameId: game.id },
            data: { lastGambledAt: now },
          });
      if (accountChange.count !== 1) {
        throw new ConflictError("The game account changed. Please try again.");
      }
      const [updated, account] = await Promise.all([
        transaction.blackjackGame.findUniqueOrThrow({ where: { id: game.id } }),
        transaction.casinoAccount.findUniqueOrThrow({
          where: { guildId_userId: { guildId, userId } },
        }),
      ]);
      await transaction.casinoTransaction.create({
        data: {
          operationId,
          guildId,
          userId,
          game: "BLACKJACK",
          type: finished ? "SETTLEMENT" : "ACTION",
          wager: 0,
          payout: resolution.payout,
          delta: resolution.payout,
          balanceAfter: account.balance,
          details: JSON.stringify({ gameId: game.id, status: resolution.status, action }),
          createdAt: now,
        },
      });
      return this.toState(updated, account.balance);
    });
  }

  private async replayStartedGame(
    operationId: string,
    guildId: string,
    userId: string,
  ): Promise<BlackjackState | undefined> {
    const game = await this.prisma.blackjackGame.findUnique({ where: { operationId } });
    if (!game) {
      return undefined;
    }
    this.assertOwner(game, guildId, userId);
    const account = await this.prisma.casinoAccount.findUniqueOrThrow({
      where: { guildId_userId: { guildId, userId } },
    });
    const transaction = await this.prisma.casinoTransaction.findUnique({ where: { operationId } });
    return this.toState(game, transaction?.balanceAfter ?? account.balance);
  }

  private async replayAction(
    transaction: CasinoTransaction,
    database: Prisma.TransactionClient,
    guildId: string,
    userId: string,
    gameId: number,
  ): Promise<BlackjackState> {
    if (
      transaction.guildId !== guildId ||
      transaction.userId !== userId ||
      transaction.game !== "BLACKJACK"
    ) {
      throw new ConflictError("That blackjack operation ID was already used for another action.");
    }
    const details = this.parseTransactionDetails(transaction.details);
    if (details.gameId !== gameId) {
      throw new ConflictError("That blackjack operation belongs to another game.");
    }
    const game = await database.blackjackGame.findUniqueOrThrow({ where: { id: gameId } });
    return this.toState(game, transaction.balanceAfter);
  }

  private parseTransactionDetails(details: string | null): { gameId: number } {
    try {
      const parsed: unknown = JSON.parse(details ?? "");
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "gameId" in parsed &&
        Number.isSafeInteger(parsed.gameId)
      ) {
        return { gameId: parsed.gameId as number };
      }
    } catch {
      // Stored transaction details are validated below.
    }
    throw new Error("Stored blackjack transaction details are invalid.");
  }

  private assertOwner(game: BlackjackGame, guildId: string, userId: string): void {
    if (game.guildId !== guildId || game.userId !== userId) {
      throw new ConflictError("That blackjack operation ID was already used for another action.");
    }
  }

  private initialResolution(playerHand: Card[], dealerHand: Card[], wager: number): Resolution {
    const playerBlackjack = isBlackjack(playerHand);
    const dealerBlackjack = isBlackjack(dealerHand);
    if (playerBlackjack && dealerBlackjack) {
      return { status: BLACKJACK_STATUS.PUSH, payout: wager };
    }
    if (playerBlackjack) {
      return {
        status: BLACKJACK_STATUS.BLACKJACK,
        payout: wager + Math.floor(wager * 1.5),
      };
    }
    if (dealerBlackjack) {
      return { status: BLACKJACK_STATUS.LOST, payout: 0 };
    }
    return { status: BLACKJACK_STATUS.ACTIVE, payout: 0 };
  }

  private playDealer(
    deck: Card[],
    playerHand: Card[],
    dealerHand: Card[],
    wager: number,
  ): Resolution {
    while (scoreHand(dealerHand).total < 17) {
      dealerHand.push(drawCard(deck));
    }
    const playerTotal = scoreHand(playerHand).total;
    const dealerTotal = scoreHand(dealerHand).total;
    if (dealerTotal > 21 || playerTotal > dealerTotal) {
      return { status: BLACKJACK_STATUS.WON, payout: wager * 2 };
    }
    if (playerTotal === dealerTotal) {
      return { status: BLACKJACK_STATUS.PUSH, payout: wager };
    }
    return { status: BLACKJACK_STATUS.LOST, payout: 0 };
  }

  private toState(game: BlackjackGame, balance: number): BlackjackState {
    return {
      id: game.id,
      guildId: game.guildId,
      userId: game.userId,
      wager: game.wager,
      status: game.status as BlackjackStatus,
      playerHand: parseCards(game.playerHand),
      dealerHand: parseCards(game.dealerHand),
      payout: game.payout,
      balance,
    };
  }

  private validateWager(wager: number): void {
    if (!Number.isSafeInteger(wager) || wager < MIN_WAGER || wager > MAX_WAGER) {
      throw new ValidationError(`Wagers must be whole chips from ${MIN_WAGER} to ${MAX_WAGER}.`);
    }
  }

  private account(
    guildId: string,
    userId: string,
    transaction: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<CasinoAccount> {
    return transaction.casinoAccount.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, balance: STARTING_BALANCE },
      update: {},
    });
  }
}
