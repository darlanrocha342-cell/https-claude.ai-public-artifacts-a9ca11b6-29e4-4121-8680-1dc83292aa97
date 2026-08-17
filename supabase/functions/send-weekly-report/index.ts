// ATLAS — Edge Function: send-weekly-report
// (nome histórico — a função hoje manda um relatório DIÁRIO, não semanal;
// mantido assim pra não obrigar recriar a function/secrets no Supabase)
//
// Roda uma vez por dia (agendada via pg_cron, ver README da pasta
// supabase/). Para cada usuário com relatório diário ativado, monta um
// resumo financeiro do dia anterior (receitas, despesas, envelopes no
// limite, metas, contas vencendo hoje/amanhã) e manda por WhatsApp via
// Twilio.
//
// Segredos necessários (Project Settings > Edge Functions > Secrets):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
//   (TWILIO_WHATSAPP_FROM no formato "whatsapp:+14155238886")
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente
// em toda Edge Function, não precisa configurar.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_WHATSAPP_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM")!; // ex: "whatsapp:+14155238886"

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

function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

type Envelope = { id: string; name: string; budget: number; fixed: boolean; projected_amount: number; due_day: number | null };
type Tx = { envelope_id: string | null; type: string; amount: number; date: string };
type Goal = { name: string; target: number; saved: number };
type Debt = { name: string; balance: number; installment_amount: number; first_due_date: string | null; paid_installments: number };

function buildEnvelopeAlerts(envelopes: Envelope[], monthTx: Tx[]): string[] {
  const spentByEnvelope: Record<string, number> = {};
  for (const t of monthTx) {
    if (t.type !== "expense" || !t.envelope_id) continue;
    spentByEnvelope[t.envelope_id] = (spentByEnvelope[t.envelope_id] || 0) + Number(t.amount);
  }
  const alerts: string[] = [];
  for (const e of envelopes) {
    const spent = spentByEnvelope[e.id] || 0;
    if (e.fixed) {
      const ceiling = e.projected_amount > 0 ? e.projected_amount : e.budget;
      if (ceiling > 0 && spent > ceiling + 0.005) {
        alerts.push(`⚠️ ${e.name}: estourou (${fmtBRL(spent)} de ${fmtBRL(ceiling)})`);
      }
    } else if (e.budget > 0) {
      const pct = spent / e.budget;
      if (pct >= 1) alerts.push(`🔴 ${e.name}: estourou o orçamento (${fmtBRL(spent)} de ${fmtBRL(e.budget)})`);
      else if (pct >= 0.8) alerts.push(`🟡 ${e.name}: ${Math.round(pct * 100)}% do orçamento (${fmtBRL(spent)} de ${fmtBRL(e.budget)})`);
    }
  }
  return alerts.slice(0, 5);
}

function buildUpcoming(envelopes: Envelope[], debts: Debt[], today: string): string[] {
  const items: string[] = [];
  const windowDates = [today, addDaysISO(today, 1)]; // hoje e amanhã

  for (const d of debts) {
    if (!d.first_due_date || d.balance <= 0) continue;
    const nextDue = addMonthsISO(d.first_due_date, d.paid_installments || 0);
    if (windowDates.includes(nextDue)) {
      items.push(`📌 ${d.name}: parcela de ${fmtBRL(Number(d.installment_amount))} em ${fmtDateBR(nextDue)}`);
    }
  }

  for (const e of envelopes) {
    if (!e.fixed || !e.due_day) continue;
    for (const date of windowDates) {
      const day = Number(date.slice(8, 10));
      if (day === e.due_day) {
        items.push(`📌 ${e.name}: ${fmtBRL(Number(e.budget))} em ${fmtDateBR(date)}`);
        break;
      }
    }
  }

  return items.slice(0, 6);
}

function buildGoalsLines(goals: Goal[]): string[] {
  return goals
    .filter((g) => g.target > 0)
    .slice(0, 3)
    .map((g) => {
      const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
      return `🎯 ${g.name}: ${pct}% (${fmtBRL(g.saved)} de ${fmtBRL(g.target)})`;
    });
}

function buildMessage(params: {
  name: string;
  yesterday: string;
  income: number;
  expense: number;
  alerts: string[];
  upcoming: string[];
  goalsLines: string[];
}): string {
  const { name, yesterday, income, expense, alerts, upcoming, goalsLines } = params;
  const balance = income - expense;
  const lines: string[] = [];
  lines.push(`📊 *ATLAS — Resumo diário*`);
  lines.push(`Ontem, ${fmtDateBR(yesterday)}${name ? `, ${name}` : ""}`);
  lines.push("");
  lines.push(`💰 Receitas: ${fmtBRL(income)}`);
  lines.push(`💸 Despesas: ${fmtBRL(expense)}`);
  lines.push(`📈 Saldo do dia: ${fmtBRL(balance)}`);

  if (alerts.length) {
    lines.push("");
    lines.push("*Envelopes no limite (mês):*");
    lines.push(...alerts);
  }

  if (goalsLines.length) {
    lines.push("");
    lines.push("*Metas:*");
    lines.push(...goalsLines);
  }

  if (upcoming.length) {
    lines.push("");
    lines.push("*Vencendo hoje/amanhã:*");
    lines.push(...upcoming);
  }

  lines.push("");
  lines.push("Abra o ATLAS pra ver todos os detalhes.");
  return lines.join("\n");
}

async function sendWhatsApp(to: string, body: string): Promise<boolean> {
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: TWILIO_WHATSAPP_FROM,
      To: `whatsapp:${to}`,
      Body: body,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("Twilio send failed", resp.status, text);
    return false;
  }
  return true;
}

Deno.serve(async (_req: Request) => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = addDaysISO(today, -1);
  const monthStart = today.slice(0, 8) + "01";
  let reportsSent = 0;

  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, name, whatsapp_number, whatsapp_reports_enabled")
    .eq("whatsapp_reports_enabled", true)
    .not("whatsapp_number", "is", null);
  if (profErr) console.error("erro ao ler profiles", profErr.message);

  for (const p of profiles ?? []) {
    try {
      const [envRes, dayTxRes, monthTxRes, goalsRes, debtsRes] = await Promise.all([
        admin.from("envelopes").select("*").eq("user_id", p.id),
        admin.from("transactions").select("type, amount, envelope_id, date").eq("user_id", p.id).eq("date", yesterday),
        admin.from("transactions").select("type, amount, envelope_id, date").eq("user_id", p.id).gte("date", monthStart).lte("date", today),
        admin.from("goals").select("name, target, saved").eq("user_id", p.id),
        admin.from("debts").select("name, balance, installment_amount, first_due_date, paid_installments").eq("user_id", p.id),
      ]);

      const envelopes = (envRes.data ?? []) as Envelope[];
      const dayTx = (dayTxRes.data ?? []) as Tx[];
      const monthTx = (monthTxRes.data ?? []) as Tx[];
      const goals = (goalsRes.data ?? []) as Goal[];
      const debts = (debtsRes.data ?? []) as Debt[];

      const income = dayTx.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
      const expense = dayTx.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);

      const alerts = buildEnvelopeAlerts(envelopes, monthTx);
      const upcoming = buildUpcoming(envelopes, debts, today);
      const goalsLines = buildGoalsLines(goals);

      const message = buildMessage({ name: p.name || "", yesterday, income, expense, alerts, upcoming, goalsLines });
      const ok = await sendWhatsApp(p.whatsapp_number, message);
      if (ok) reportsSent++;
    } catch (err: any) {
      console.error("falha ao montar/enviar relatório para", p.id, err?.message || err);
    }
  }

  return new Response(JSON.stringify({ ok: true, reportsSent }), {
    headers: { "Content-Type": "application/json" },
  });
});
