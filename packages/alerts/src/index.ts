export * from "./types";
export * from "./errors";
export * from "./transport";
export * from "./alerts";

// common additional aliases
import { AlertService } from "./alerts";
import { InMemoryEmailTransport, HttpEmailTransport } from "./transport";
import { createAlertService } from "./alerts";
import { createInMemoryEmailTransport, createHttpEmailTransport } from "./transport";

export const createAlert = createAlertService;
export const Alert = AlertService;
export const EmailTransportInMemory = InMemoryEmailTransport;
export const InMemoryTransport = InMemoryEmailTransport;
export const MemoryTransport = InMemoryEmailTransport;
export const SimulatedTransport = InMemoryEmailTransport;
export const MockTransport = InMemoryEmailTransport;

export { AlertService, InMemoryEmailTransport, HttpEmailTransport };
export { createAlertService, createInMemoryEmailTransport, createHttpEmailTransport };

// convenience re-export of constants
export * from "./types";