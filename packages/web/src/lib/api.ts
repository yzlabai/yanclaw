import { hc } from "hono/client";
import type { AppType } from "@yanclaw/server/app";

const API_BASE = "http://localhost:18789";

export const client = hc<AppType>(API_BASE);
