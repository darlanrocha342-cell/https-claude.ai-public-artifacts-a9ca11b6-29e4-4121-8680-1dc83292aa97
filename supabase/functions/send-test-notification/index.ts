// Supabase Edge Function: send-test-notification
//
// Sends a real Web Push notification to every device the calling user has
// registered (rows in public.push_subscriptions), so they can confirm push
// notifications actually reach their phone/desktop.
//
// Deploy:
//   supabase functions deploy send-test-notification
//
// Required secrets (set once):
//   supabase secrets set VAPID_PUBLIC_KEY=<same value as VAPID_PUBLIC_KEY in index.html>
//   supabase secrets set VAPID_PRIVATE_KEY=<the matching private key>
//   supabase secrets set VAPID_SUBJECT=mailto:you@example.com
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase runtime — no need to set them yourself.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:no-reply@example.com";

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configuradas nos secrets da função." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "Não autenticado." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client scoped to the caller's JWT, just to resolve who is calling.
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Usuário inválido." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // Service-role client to read/clean up subscriptions regardless of RLS.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: subs, error: subsError } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (subsError) {
      return new Response(JSON.stringify({ ok: false, error: subsError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!subs || subs.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "Nenhuma inscrição de notificação encontrada para este usuário. Ative as notificações primeiro." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = JSON.stringify({
      title: "ÓRBITA",
      body: "Notificação de teste — se você está vendo isso, está tudo funcionando!",
      url: "./",
      tag: "orbita-test",
    });

    let sent = 0;
    const staleIds: number[] = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
        sent++;
      } catch (err) {
        // 404/410 = the browser unsubscribed or the endpoint expired; clean it up.
        const status = err?.statusCode;
        if (status === 404 || status === 410) staleIds.push(sub.id);
      }
    }

    if (staleIds.length > 0) {
      await adminClient.from("push_subscriptions").delete().in("id", staleIds);
    }

    if (sent === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "Todas as inscrições estavam expiradas. Desative e reative as notificações no app." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
