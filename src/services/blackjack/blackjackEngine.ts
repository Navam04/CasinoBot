import { randomInt } from "node:crypto";

const SUITS = ["♠", "♥", "♦", "♣"] as const;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
const VALID_CARDS = new Set<string>(SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`)));

export type Card = `${(typeof RANKS)[number]}${(typeof SUITS)[number]}`;

export interface HandScore {
  total: number;
  soft: boolean;
}

export function createShuffledDeck(): Card[] {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank): Card => `${rank}${suit}`));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    const currentCard = deck[index];
    const otherCard = deck[other];
    if (!currentCard || !otherCard) {
      throw new Error("Unable to shuffle the blackjack deck.");
    }
    deck[index] = otherCard;
    deck[other] = currentCard;
  }
  return deck;
}

export function scoreHand(hand: readonly Card[]): HandScore {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    const rank = card.slice(0, -1);
    if (rank === "A") {
      total += 11;
      aces += 1;
    } else if (rank === "J" || rank === "Q" || rank === "K") {
      total += 10;
    } else {
      total += Number(rank);
    }
  }
  let softAces = aces;
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }
  return { total, soft: softAces > 0 };
}

export function isBlackjack(hand: readonly Card[]): boolean {
  return hand.length === 2 && scoreHand(hand).total === 21;
}

export function drawCard(deck: Card[]): Card {
  const card = deck.shift();
  if (!card) {
    throw new Error("The blackjack deck is empty.");
  }
  return card;
}

export function parseCards(value: string): Card[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((card) => typeof card === "string" && VALID_CARDS.has(card))
  ) {
    throw new Error("Stored blackjack cards are invalid.");
  }
  return parsed as Card[];
}

export function formatHand(hand: readonly Card[]): string {
  return hand.join("  ");
}
