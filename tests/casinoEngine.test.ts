import { describe, expect, it } from "vitest";
import {
  CRASH_RTP,
  SLOT_SYMBOLS,
  THEORETICAL_SLOT_RTP,
  flipCoin,
  launchCrash,
  rollDice,
  spinRoulette,
  spinSlots,
  type RandomInteger,
} from "../src/services/casino/casinoEngine.js";

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

describe("casino game engine", () => {
  it("produces both fair coin sides and dice wins, losses, and pushes", () => {
    expect(flipCoin(sequence(0))).toBe("heads");
    expect(flipCoin(sequence(1))).toBe("tails");
    expect(rollDice(sequence(5, 0))).toEqual({ player: 6, dealer: 1, payoutMultiplier: 2 });
    expect(rollDice(sequence(2, 2))).toEqual({ player: 3, dealer: 3, payoutMultiplier: 1 });
    expect(rollDice(sequence(0, 5))).toEqual({ player: 1, dealer: 6, payoutMultiplier: 0 });
  });

  it("uses the documented slot weights and paytable", () => {
    expect(
      SLOT_SYMBOLS.map(({ name, weight, tripleMultiplier }) => ({
        name,
        weight,
        tripleMultiplier,
      })),
    ).toEqual([
      { name: "Cherry", weight: 35, tripleMultiplier: 4 },
      { name: "Lemon", weight: 30, tripleMultiplier: 5 },
      { name: "Bell", weight: 20, tripleMultiplier: 9 },
      { name: "Diamond", weight: 10, tripleMultiplier: 15 },
      { name: "Seven", weight: 5, tripleMultiplier: 30 },
    ]);
    expect(spinSlots(sequence(0, 1, 2)).payoutMultiplier).toBe(4);
    expect(spinSlots(sequence(0, 1, 40)).payoutMultiplier).toBe(1);
    expect(spinSlots(sequence(0, 40, 70)).payoutMultiplier).toBe(0);
    expect(THEORETICAL_SLOT_RTP).toBeCloseTo(0.95525, 5);
  });

  it("keeps every Crash target at a 97% theoretical return", () => {
    expect(CRASH_RTP).toBe(0.97);
    expect(launchCrash(2, sequence(4849))).toEqual({
      target: 2,
      won: true,
      payoutMultiplier: 2,
    });
    expect(launchCrash(2, sequence(4850))).toEqual({
      target: 2,
      won: false,
      payoutMultiplier: 0,
    });
    expect(launchCrash(10, sequence(969)).won).toBe(true);
    expect(launchCrash(10, sequence(970)).won).toBe(false);
  });

  it("simulates the documented slots close to their 95.525% theoretical RTP", () => {
    let state = 0x5eed1234;
    const seeded: RandomInteger = (maximum) => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return Math.floor((state / 2 ** 32) * maximum);
    };
    const spins = 200_000;
    let returned = 0;
    for (let index = 0; index < spins; index += 1) {
      returned += spinSlots(seeded).payoutMultiplier;
    }
    const simulatedRtp = returned / spins;
    expect(simulatedRtp).toBeGreaterThan(0.94);
    expect(simulatedRtp).toBeLessThan(0.97);
    expect(Math.abs(simulatedRtp - THEORETICAL_SLOT_RTP)).toBeLessThan(0.015);
  });

  it("applies European roulette rules, including the house zero", () => {
    expect(spinRoulette("number", 17, sequence(17))).toMatchObject({
      number: 17,
      color: "black",
      won: true,
      payoutMultiplier: 36,
    });
    expect(spinRoulette("red", undefined, sequence(1)).won).toBe(true);
    expect(spinRoulette("black", undefined, sequence(2)).won).toBe(true);
    expect(spinRoulette("odd", undefined, sequence(3)).won).toBe(true);
    expect(spinRoulette("even", undefined, sequence(4)).won).toBe(true);
    expect(spinRoulette("low", undefined, sequence(18)).won).toBe(true);
    expect(spinRoulette("high", undefined, sequence(19)).won).toBe(true);
    expect(spinRoulette("red", undefined, sequence(0))).toMatchObject({
      color: "green",
      won: false,
      payoutMultiplier: 0,
    });
  });
});
