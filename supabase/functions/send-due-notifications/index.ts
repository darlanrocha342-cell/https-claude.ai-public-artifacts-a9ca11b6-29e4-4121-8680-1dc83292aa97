// ATLAS — Edge Function: send-due-notifications
//
// Roda uma vez por dia (agendada via pg_cron, ver README da pasta supabase/).
// Verifica dívidas com parcela vencendo amanhã e envelopes fixos com
// vencimento amanhã, e manda uma notificação push pra cada inscrição
// (push_subscriptions) do dono daquele registro.
//
// Segredos necessários (Project Settings > Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (mesmo par usado no index.html)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente
// em toda Edge Function, não precisa configurar.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails("mailto:contato@atlas.app", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonthsISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  const targetY = d.getUTCFullYear();
  const targetM = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(targetY, targetM, Math.min(day, lastDay)));
  return result.toISOString().slice(0, 10);
}

function fmtBRL(v: number): string {
  return "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sendToUser(userId: string, title: string, body: string, tag: string) {
  const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
  if (!subs || !subs.length) return 0;
  let sent = 0;
  await Promise.all(subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, tag })
      );
      sent++;
    } catch (err: any) {
      // inscrição expirada/inválida (usuário desinstalou, trocou de navegador etc.) — limpa
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      } else {
        console.error("push send failed", err?.message || err);
      }
    }
  }));
  return sent;
}

Deno.serve(async (_req: Request) => {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = addDaysISO(today, 1);
  const tomorrowDay = Number(tomorrow.slice(8, 10));
  let notificationsSent = 0;

  // dívidas com parcela vencendo amanhã
  const { data: debts, error: debtsErr } = await admin
    .from("debts")
    .select("*")
    .gt("balance", 0);
  if (debtsErr) console.error("erro ao ler debts", debtsErr.message);

  for (const d of debts ?? []) {
    if (!d.first_due_date) continue;
    const nextDue = addMonthsISO(d.first_due_date, d.paid_installments || 0);
    if (nextDue === tomorrow) {
      notificationsSent += await sendToUser(
        d.user_id,
        "Parcela vence amanhã",
        `${d.name}: ${fmtBRL(Number(d.installment_amount))}`,
        "debt-" + d.id
      );
    }
  }

  // envelopes fixos com vencimento amanhã
  const { data: envelopes, error: envErr } = await admin
    .from("envelopes")
    .select("*")
    .eq("fixed", true);
  if (envErr) console.error("erro ao ler envelopes", envErr.message);

  for (const e of envelopes ?? []) {
    if ((e.due_day || 5) === tomorrowDay) {
      notificationsSent += await sendToUser(
        e.user_id,
        "Conta fixa vence amanhã",
        `${e.name}: ${fmtBRL(Number(e.budget))}`,
        "envelope-" + e.id
      );
    }
  }

  return new Response(JSON.stringify({ ok: true, notificationsSent }), {
    headers: { "Content-Type": "application/json" },
  });
});
