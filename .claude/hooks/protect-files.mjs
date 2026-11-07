// Bloqueia edição de segredos e lockfiles (exit 2 = bloqueia e avisa o Claude).
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let file = "";
  try { file = JSON.parse(raw)?.tool_input?.file_path ?? ""; } catch {}
  const name = file.replace(/\\/g, "/").split("/").pop() ?? "";
  const blocked = /^\.env(\..*)?$/.test(name) && !/\.(example|sample)$/.test(name)
    || ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"].includes(name);
  if (blocked) {
    console.error(`Edição bloqueada: ${name} é segredo/lockfile. Peça ao Marcos para alterar manualmente.`);
    process.exit(2);
  }
});
