import path from "node:path";
import { defineConfig } from "vitest/config";

// Los tests corren fuera de Next, que es quien normalmente resuelve el alias "@/" del
// tsconfig. Sin esto, importar lib/tts.ts falla al llegar a su import de "@/lib/cors".
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["**/__tests__/**/*.test.ts"],
  },
});
