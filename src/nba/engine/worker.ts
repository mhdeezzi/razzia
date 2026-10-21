// Worker : simule une tranche de graines et renvoie un Batch (tableaux transférés sans copie).
import { parentPort, workerData } from 'node:worker_threads';
import { runRange } from './batch.ts';
import type { GameModel } from '../model/types.ts';

const { model, seeds, players } = workerData as { model: GameModel; seeds: number[]; players: number[] };
const b = runRange(model, seeds, players);
const transfer = [b.seeds, b.home, b.away, b.periods, b.qHome, b.qAway, b.poss, b.firstScorer, b.leadChanges, b.stats].map((a) => a.buffer as ArrayBuffer);
parentPort!.postMessage(b, transfer);
