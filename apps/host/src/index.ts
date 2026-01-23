import path from "path";
import { startServer } from "./server";

const port = Number(process.env.SIDEKICK_HOST_PORT ?? 8787);
const dbPath = process.env.SIDEKICK_DB_PATH ?? path.resolve(process.cwd(), "data", "sidekick.db");

startServer({ port, dbPath });
