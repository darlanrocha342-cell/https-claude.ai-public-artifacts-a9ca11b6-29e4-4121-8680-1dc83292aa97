// Edge Function: send-reminders
// Roda a cada minuto (agendado via pg_cron) e envia notificações push reais
// (Web Push) para compromissos que vencem em ~10 minutos, mesmo com o app
// fechado no celular.
//
// Variáveis de ambiente necessárias (Project Settings > Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT   (ex.: mailto:seuemail@exemplo.com)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetadas automaticamente
// pelo Supabase em toda Edge Function — não precisa configurar.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function todayInTZ(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

function nowMinutesInTZ(tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

// deno-lint-ignore no-explicit-any
function appointmentOccursOn(a: any, dateISO: string): boolean {
  if (a.date === dateISO) return true;
  if (!a.repeat || a.repeat === "none") return false;
  if (dateISO < a.date) return false;
  if (a.repeatUntil && dateISO > a.repeatUntil) return false;
  const anchor = new Date(a.date + "T00:00:00Z");
  const target = new Date(dateISO + "T00:00:00Z");
  if (a.repeat === "daily") return true;
  if (a.repeat === "weekly") return target.getUTCDay() === anchor.getUTCDay();
  if (a.repeat === "monthly") return target.getUTCDate() === anchor.getUTCDate();
  if (a.repeat === "yearly") {
    return target.getUTCDate() === anchor.getUTCDate() && target.getUTCMonth() === anchor.getUTCMonth();
  }
  return false;
}

async function sendPushToUser(userId: string, payload: string): Promise<boolean> {
  const { data: subs } = await sb.from("push_subscriptions").select("*").eq("user_id", userId);
  if (!subs || !subs.length) return false;
  let anySent = false;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      anySent = true;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await sb.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
  }
  return anySent;
}

async function alreadySent(userId: string, reminderKey: string): Promise<boolean> {
  const { data } = await sb
    .from("sent_reminders")
    .select("reminder_key")
    .eq("user_id", userId)
    .eq("reminder_key", reminderKey)
    .maybeSingle();
  return !!data;
}

Deno.serve(async () => {
  try {
    const { data: rows, error } = await sb.from("app_state").select("user_id, data");
    if (error) throw error;

    let sent = 0;

    for (const row of rows ?? []) {
      // deno-lint-ignore no-explicit-any
      const state: any = row.data || {};
      const tz = state.settings?.timezone || "America/Sao_Paulo";
      const today = todayInTZ(tz);
      const nowMinutes = nowMinutesInTZ(tz);

      const appts: any[] = state.appointments || [];
      for (const a of appts) {
        if (!a.time || !appointmentOccursOn(a, today)) continue;
        const [th, tm] = a.time.split(":").map(Number);
        const diff = th * 60 + tm - nowMinutes;
        if (diff < 9 || diff > 11) continue; // ~10 min antes, com folga de 2 min pro cron de 1 min

        const reminderKey = `${a.id}|${today}`;
        if (await alreadySent(row.user_id, reminderKey)) continue;

        const payload = JSON.stringify({
          title: "ÓRBITA — compromisso em breve",
          body: `${a.title} às ${a.time}${a.location ? " · " + a.location : ""}`,
          url: "./",
          apptTitle: a.title,
          apptTime: a.time,
          apptLocation: a.location || "",
        });

        if (!(await sendPushToUser(row.user_id, payload))) continue;
        await sb.from("sent_reminders").upsert({ user_id: row.user_id, reminder_key: reminderKey });
        sent++;
      }

      // Tarefas com Hora + Lembrete definidos (ver campo "Lembrete" no
      // formulário de tarefa) — dispara N minutos antes do horário, uma vez
      // só por dia, igual aos compromissos.
      const tasks: any[] = state.tasks || [];
      for (const t of tasks) {
        if (t.done || !t.dueDate || !t.dueTime || !t.reminderLead) continue;
        if (t.dueDate !== today) continue;
        const [th, tm] = t.dueTime.split(":").map(Number);
        const notifyAtMinutes = th * 60 + tm - Number(t.reminderLead);
        const diff = notifyAtMinutes - nowMinutes;
        if (diff < -1 || diff > 1) continue; // janela de 1 min pra cada lado, cron roda a cada minuto

        const reminderKey = `task:${t.id}|${today}`;
        if (await alreadySent(row.user_id, reminderKey)) continue;

        const payload = JSON.stringify({
          title: "ÓRBITA — tarefa",
          body: `${t.title} às ${t.dueTime}${t.location ? " · " + t.location : ""}`,
          url: "./",
          apptTitle: t.title,
          apptTime: t.dueTime,
          apptLocation: t.location || "",
        });

        if (!(await sendPushToUser(row.user_id, payload))) continue;
        await sb.from("sent_reminders").upsert({ user_id: row.user_id, reminder_key: reminderKey });
        sent++;
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
