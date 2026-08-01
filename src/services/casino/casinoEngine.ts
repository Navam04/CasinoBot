import { randomInt } from "node:crypto";

export type RandomInteger = (maximumExclusive: number) => number;

export const cryptoRandomInteger: RandomInteger = (maximumExclusive) => randomInt(maximumExclusive);

export type CoinSide = "heads" | "tails";

export function flipCoin(random: RandomInteger = cryptoRandomInteger): CoinSide {
  return random(2) === 0 ? "heads" : "tails";
}

export interface DiceOutcome {
  player: number;
  dealer: number;
  payoutMultiplier: number;
}

export function rollDice(random: RandomInteger = cryptoRandomInteger): DiceOutcome {
  const player = random(6) + 1;
  const dealer = random(6) + 1;
  return {
    player,
    dealer,
    payoutMultiplier: player === dealer ? 1 : player > dealer ? 2 : 0,
  };
}

export const CRASH_TARGETS = [2, 3, 5, 10] as const;
export type CrashTarget = (typeof CRASH_TARGETS)[number];
export const CRASH_RTP = 0.97;
const CRASH_ROLL_MAXIMUM = 10_000;

export interface CrashOutcome {
  target: CrashTarget;
  won: boolean;
  payoutMultiplier: number;
}

export function launchCrash(
  target: CrashTarget,
  random: RandomInteger = cryptoRandomInteger,
): CrashOutcome {
  const winningRolls = Math.floor((CRASH_RTP * CRASH_ROLL_MAXIMUM) / target);
  const won = random(CRASH_ROLL_MAXIMUM) < winningRolls;
  return {
    target,
    won,
    payoutMultiplier: won ? target : 0,
  };
}

export const SLOT_SYMBOLS = [
  { symbol: "🍒", name: "Cherry", weight: 35, tripleMultiplier: 4 },
  { symbol: "🍋", name: "Lemon", weight: 30, tripleMultiplier: 5 },
  { symbol: "🔔", name: "Bell", weight: 20, tripleMultiplier: 9 },
  { symbol: "💎", name: "Diamond", weight: 10, tripleMultiplier: 15 },
  { symbol: "7️⃣", name: "Seven", weight: 5, tripleMultiplier: 30 },
] as const;

const SLOT_TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((total, entry) => total + entry.weight, 0);

export interface SlotsOutcome {
  reels: [string, string, string];
  payoutMultiplier: number;
}

function slotSymbol(random: RandomInteger): (typeof SLOT_SYMBOLS)[number] {
  let roll = random(SLOT_TOTAL_WEIGHT);
  for (const entry of SLOT_SYMBOLS) {
    if (roll < entry.weight) {
      return entry;
    }
    roll -= entry.weight;
  }
  throw new Error("Slot symbol weights are invalid.");
}

export function spinSlots(random: RandomInteger = cryptoRandomInteger): SlotsOutcome {
  const entries = [slotSymbol(random), slotSymbol(random), slotSymbol(random)] as const;
  const [first, second, third] = entries;
  const allMatch = first.symbol === second.symbol && second.symbol === third.symbol;
  const hasPair =
    first.symbol === second.symbol ||
    first.symbol === third.symbol ||
    second.symbol === third.symbol;
  return {
    reels: [first.symbol, second.symbol, third.symbol],
    payoutMultiplier: allMatch ? first.tripleMultiplier : hasPair ? 1 : 0,
  };
}

export const THEORETICAL_SLOT_RTP = SLOT_SYMBOLS.reduce((rtp, entry) => {
  const probability = entry.weight / SLOT_TOTAL_WEIGHT;
  const exactlyTwo = 3 * probability ** 2 * (1 - probability);
  const three = probability ** 3;
  return rtp + exactlyTwo + three * entry.tripleMultiplier;
}, 0);

export type RouletteBet = "number" | "red" | "black" | "odd" | "even" | "low" | "high";

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export interface RouletteOutcome {
  number: number;
  color: "green" | "red" | "black";
  won: boolean;
  payoutMultiplier: number;
}

export function spinRoulette(
  bet: RouletteBet,
  target: number | undefined,
  random: RandomInteger = cryptoRandomInteger,
): RouletteOutcome {
  const number = random(37);
  const color = number === 0 ? "green" : RED_NUMBERS.has(number) ? "red" : "black";
  const won =
    bet === "number"
      ? number === target
      : number !== 0 &&
        (bet === color ||
          (bet === "odd" && number % 2 === 1) ||
          (bet === "even" && number % 2 === 0) ||
          (bet === "low" && number <= 18) ||
          (bet === "high" && number >= 19));
  return {
    number,
    color,
    won,
    payoutMultiplier: won ? (bet === "number" ? 36 : 2) : 0,
  };
}
