import { supabase } from "@/integrations/supabase/client";

// Chave pública VAPID (pública por natureza; a privada fica só no Supabase).
const VAPID_PUBLIC_KEY = "BGNlKhG8EHzUzwJnLG8CHW1NShT8Hr8ixV38A5L-b9Yn-kSfVBN9TuPUIc9ez71jf0x-nrC0RstmdT3jFrqgNZg";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function getPushState(): Promise<"unsupported" | "denied" | "on" | "off"> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("Este navegador não suporta notificações push");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permissão de notificação negada");

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const json = sub.toJSON();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sessão expirada");
  const { error } = await (supabase as any).from("push_subscriptions").upsert(
    {
      user_id: auth.user.id,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      user_agent: navigator.userAgent.slice(0, 200),
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await (supabase as any).from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
