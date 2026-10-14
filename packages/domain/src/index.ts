export * from "./estimate";
export * from "./timezone";
export * from "./scheduling";
export * from "./offers";
export * from "./dedupe";
export * from "./automation";

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
export * from "./unknown-result";
