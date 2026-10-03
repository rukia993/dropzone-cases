import { performance } from "node:perf_hooks";
import { cases } from "../src/catalog.js";
import { pickDrop } from "../src/engine.js";
const count = 1_000_000;
const started = performance.now();
for (let i = 0; i < count; i++) pickDrop(cases[i % cases.length].id);
const milliseconds = performance.now() - started;
console.log(
  JSON.stringify({
    selections: count,
    milliseconds: Math.round(milliseconds),
    selectionsPerSecond: Math.round(count / (milliseconds / 1000)),
    scope: "local selection engine",
  }),
);
