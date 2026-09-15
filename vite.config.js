import { defineConfig, loadEnv } from "vite";

const REQUIRED_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

export default defineConfig(({ command, mode }) => {
  // Stop et deploy uden Supabase-nøgler i stedet for at udgive en side, der ikke virker
  if (command === "build") {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    const missing = REQUIRED_ENV.filter(name => !env[name]);
    if (missing.length > 0) {
      throw new Error(
        `Mangler miljøvariabler: ${missing.join(", ")}. ` +
        "Lokalt: udfyld .env (se .env.example). På Vercel: Project Settings → Environment Variables."
      );
    }
  }
  return {
    build: {
      // html5-qrcode (inkl. stregkode-dekoderen) fylder ~0,6 MB – fint til en personlig app
      chunkSizeWarningLimit: 800,
    },
  };
});
