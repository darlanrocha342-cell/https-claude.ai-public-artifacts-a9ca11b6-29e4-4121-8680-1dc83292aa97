// Edge Function: send-test-notification
// Manda uma notificação push de teste NA HORA para o usuário autenticado,
// sem depender de nenhum compromisso ou do agendamento de 1 em 1 minuto —
// serve só pra confirmar rapidamente se a chave VAPID, a inscrição do
// navegador e a entrega do push estão funcionando de verdade no celular.
//
// Variáveis de ambiente necessárias (Project Settings > Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT   (ex.: mailto:seuemail@exemplo.com)
// SUPABASE_URL e SUPABASE_ANON_KEY já são injetadas automaticamente pelo
// Supabase em toda Edge Function — não precisa configurar.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer /i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Não autenticado." }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await sb.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Não autenticado." }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const { data: subs, error: subsError } = await sb
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", userData.user.id);

    if (subsError) throw subsError;

    if (!subs || !subs.length) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Nenhuma inscrição de notificação encontrada. Vá em Ajustes e clique em Ativar notificações primeiro.",
      }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({
      title: "🔔 ÓRBITA — teste de notificação",
      body: "Se você está vendo isso na tela do seu celular, as notificações estão funcionando!",
      url: "./",
      apptTitle: "Compromisso de teste",
      apptTime: new Date().toTimeString().slice(0, 5),
      apptLocation: "",
    });

    let sent = 0;
    let lastError: string | null = null;

    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        lastError = `${statusCode ?? ""} ${(err as Error).message ?? err}`.trim();
        if (statusCode === 404 || statusCode === 410) {
          await sb.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }

    if (sent === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Não consegui entregar a notificação. Detalhe: " + (lastError || "motivo desconhecido") + ". Tente ativar as notificações de novo em Ajustes.",
      }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-test-notification error:", e);
    return new Response(JSON.stringify({ ok: false, error: "Erro interno: " + String(e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
