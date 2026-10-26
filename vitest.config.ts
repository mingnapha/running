import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // วันที่/เวลาต้องไม่ขึ้นกับเขตเวลาของเครื่องที่รันเทส
    env: { TZ: "America/New_York" },
  },
});
