import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedTickets } from "./seedTickets.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(here, "../data");
const dataFile = path.join(dataDirectory, "tickets.json");

// Create the data folder and seed file if this is a fresh checkout.
export async function readTickets() {
  await mkdir(dataDirectory, { recursive: true });
  try {
    return JSON.parse(await readFile(dataFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveTickets(seedTickets);
    return seedTickets;
  }
}

export async function saveTickets(tickets) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(dataFile, `${JSON.stringify(tickets, null, 2)}\n`, "utf8");
}
