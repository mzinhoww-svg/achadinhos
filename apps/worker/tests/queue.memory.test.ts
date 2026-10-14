import { memoryHarness } from "./contract/memory-queue.js";
import { runQueueContract } from "./contract/queue-contract.js";

runQueueContract("memória (referência)", memoryHarness);
