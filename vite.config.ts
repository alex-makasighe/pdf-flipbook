import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],

  resolve: {
    alias: {
      $modules: fileURLToPath(new URL("./src/modules", import.meta.url)),
    },
  },
});
