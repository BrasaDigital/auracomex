// Após editar .ts/.tsx roda o typecheck do projeto (NUNCA `-p .`, ver CLAUDE.md).
import { execSync } from "node:child_process";
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let file = "";
  try { file = JSON.parse(raw)?.tool_input?.file_path ?? ""; } catch {}
  if (!/\.(ts|tsx)$/.test(file) || file.includes("supabase/functions")) return;
  try {
    execSync("npx tsc --noEmit -p tsconfig.app.json", { stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    const out = String(e.stdout || e.message).split("\n").slice(0, 25).join("\n");
    console.error(`Erros de tipo após editar ${file}:\n${out}`);
    process.exit(2);
  }
});
