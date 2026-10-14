export * from "./estimate.js";
export * from "./timezone.js";
export * from "./scheduling.js";
export * from "./offers.js";
export * from "./dedupe.js";
export * from "./automation.js";

// clock helpers
export const createClock = (initial: Date = new Date()) => {
  let current = initial;
  return {
    now: () => new Date(current.getTime()),
    set: (d: Date) => {
      current = d;
    },
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
};

export type Clock = ReturnType<typeof createClock>;
