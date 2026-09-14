import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages 주소가 https://계정.github.io/저장소이름 이면
// 아래 값을 '/저장소이름/' 으로 맞추세요. 예: '/vacation-tracker/'
export const BASE_PATH = "/vacation-tracker/";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? BASE_PATH : "/",
}));
