import path from "node:path";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? "4000");
const host = process.env.HOST ?? "0.0.0.0";
const dbFilePath = process.env.DB_FILE ?? path.join(process.cwd(), "data", "stage1-db.json");
const platformSimDomain = process.env.PLATFORM_SIM_DOMAIN ?? "sim.entornoseguro.local";

const app = await createApp({ dbFilePath, platformSimDomain, logger: true });

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
