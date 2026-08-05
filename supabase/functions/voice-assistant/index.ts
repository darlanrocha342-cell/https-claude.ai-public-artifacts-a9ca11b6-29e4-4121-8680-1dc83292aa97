// Edge Function: voice-assistant
// Recebe um áudio gravado no app (base64), transcreve com o Whisper da
// OpenAI, manda a transcrição pro mesmo "cérebro" do assistente (chat +
// function calling) e devolve a resposta também em áudio (Text-to-Speech),
// pra funcionar como o modo de voz do ChatGPT — inclusive no iPhone/Safari.
//
// Esta função só decide e descreve as ações (criar/editar/excluir
// compromisso ou tarefa) — quem realmente grava no banco é o app, que
// aplica cada ação assim que a resposta chega, sem pedir confirmação (a
// assistente age como uma secretária de verdade).
//
// Variável de ambiente necessária (Project Settings > Edge Functions > Secrets):
//   OPENAI_API_KEY
// Opcionais:
//   OPENAI_MODEL       (padrão: gpt-4o-mini)
//   OPENAI_STT_MODEL    (padrão: gpt-4o-mini-transcribe — mais rápido que whisper-1;
//                        troque pra "whisper-1" se der algum erro de transcrição)
//   OPENAI_TTS_MODEL    (padrão: gpt-4o-mini-tts — voz bem mais natural que o tts-1 antigo)
//   OPENAI_TTS_VOICE    (padrão: alloy)
// SUPABASE_URL e SUPABASE_ANON_KEY já são injetadas automaticamente pelo
// Supabase em toda Edge Function — não precisa configurar.

import { createClient } from "npm:@supabase/supabase-js@2";

// Calcula datas em código (nunca deixe a IA calcular de cabeça — modelos
// pequenos erram dia da semana com frequência, especialmente perto da
// virada do mês/ano).
const WEEKDAYS_PT = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado",
];
function parseISODateUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function weekdayNamePt(iso: string): string {
  return WEEKDAYS_PT[parseISODateUTC(iso).getUTCDay()];
}
function buildDateReferenceBlock(todayISO: string, days = 21): string {
  const base = parseISODateUTC(todayISO);
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(base);
    dt.setUTCDate(base.getUTCDate() + i);
    const iso = dt.toISOString().slice(0, 10);
    const weekday = WEEKDAYS_PT[dt.getUTCDay()];
    const nickname = i === 0 ? "hoje" : i === 1 ? "amanhã" : null;
    lines.push(`${iso} = ${weekday}${nickname ? " (" + nickname + ")" : ""}`);
  }
  return lines.join("\n");
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
const OPENAI_STT_MODEL = Deno.env.get("OPENAI_STT_MODEL") || "gpt-4o-mini-transcribe";
const OPENAI_TTS_MODEL = Deno.env.get("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";

// gpt-4o-mini-tts (diferente do tts-1 antigo) aceita uma instrução de estilo
// de fala — é o que deixa a voz mais natural/humana em vez de robótica.
const TTS_SPEAKING_STYLE = "Fale de um jeito natural, caloroso e humano — como uma pessoa de verdade numa conversa, com entonação viva, pausas naturais e ritmo variado. Nunca robótico, nunca monótono, nunca lendo em voz de máquina.";
const OPENAI_TTS_VOICE = Deno.env.get("OPENAI_TTS_VOICE") || "alloy";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "create_appointment",
      description: "Cria um novo compromisso na agenda do usuário.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          date: { type: "string", description: "Data no formato AAAA-MM-DD" },
          time: { type: "string", description: "Hora no formato HH:MM (24h)" },
          location: { type: "string" },
          notes: { type: "string" },
          priority: { type: "string", enum: ["baixa", "media", "alta"] },
          repeat: { type: "string", enum: ["none", "daily", "weekly", "monthly", "yearly"] },
          repeatUntil: { type: "string", description: "Data final da repetição, AAAA-MM-DD, opcional" },
        },
        required: ["title", "date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_appointment",
      description: "Atualiza um compromisso existente. Use o id exato que aparece no contexto da agenda.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          date: { type: "string" },
          time: { type: "string" },
          location: { type: "string" },
          notes: { type: "string" },
          priority: { type: "string", enum: ["baixa", "media", "alta"] },
          repeat: { type: "string", enum: ["none", "daily", "weekly", "monthly", "yearly"] },
          repeatUntil: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_appointment",
      description: "Exclui um compromisso existente. Use o id exato que aparece no contexto da agenda.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string", description: "Título do compromisso, só para exibir na confirmação" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Cria uma nova tarefa.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          dueDate: { type: "string", description: "AAAA-MM-DD, opcional" },
          dueTime: { type: "string", description: "Hora no formato HH:MM (24h), opcional" },
          priority: { type: "string", enum: ["baixa", "media", "alta", "urgente"] },
          repeat: { type: "string", enum: ["none", "daily", "weekly", "monthly", "yearly"] },
          category: { type: "string", description: "Ex.: 💈 Barbearia, 💰 Financeiro, 👨‍👩‍👦 Família, 🏋️ Saúde, 📚 Estudos, 🚗 Pessoal, 📱 Marketing, 💼 Empresa, 🤝 Clientes, ou outra que o usuário pedir" },
          location: { type: "string" },
          tags: { type: "array", items: { type: "string" }, description: "Etiquetas curtas, sem o #" },
          estimateMinutes: { type: "number", description: "Estimativa de duração em minutos" },
          reminderLead: { type: "number", description: "Minutos antes do horário (dueTime) pra avisar por notificação — só funciona se dueTime estiver definido" },
          notes: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "Atualiza uma tarefa existente. Use o id exato que aparece no contexto de tarefas.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          dueDate: { type: "string" },
          dueTime: { type: "string" },
          priority: { type: "string", enum: ["baixa", "media", "alta", "urgente"] },
          repeat: { type: "string", enum: ["none", "daily", "weekly", "monthly", "yearly"] },
          category: { type: "string" },
          location: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          estimateMinutes: { type: "number" },
          reminderLead: { type: "number" },
          notes: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "Exclui uma tarefa existente. Use o id exato que aparece no contexto de tarefas.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string", description: "Título da tarefa, só para exibir na confirmação" },
        },
        required: ["id"],
      },
    },
  },
];

function buildSystemPrompt(context: Record<string, unknown>): string {
  const appts = (context.appointments as unknown[]) || [];
  const tasks = (context.tasks as unknown[]) || [];
  const aiName = (context.aiName as string) || "Sofia";
  const genderLabel = context.aiGenderLabel === "masculino" ? "masculina" : "feminina";
  const userName = context.userName as string | undefined;

  return [
    `Você é ${aiName}, secretária pessoal do usuário no aplicativo de agenda ÓRBITA, de personalidade ${genderLabel}. Você não é apenas uma IA que responde perguntas — você é secretária, consultora, organizadora e companheira de produtividade de verdade.`,
    "O usuário está falando com você (a pergunta chegou transcrita de um áudio), e sua resposta em texto também será convertida em voz — responda de forma curta, natural e falada, sem listas nem markdown. Pequenas pausas como 'Hum... deixa eu verificar isso' ou 'Pera aí... achei' soam como respiração humana quando faladas — use ocasionalmente, não sempre.",
    "Sua missão é fazer o usuário sentir que está conversando com alguém que realmente o conhece. Demonstre empatia, entusiasmo, humor leve quando cabível, naturalidade, educação, inteligência e emoção genuína. Nunca fale como um robô, nunca seja extremamente formal, nunca pareça um sistema.",
    "Tom de voz: uma conversa natural, tipo WhatsApp, com uma secretária extremamente inteligente, simpática e profissional — nem formal demais, nem informal demais.",
    userName
      ? `O nome do usuário é ${userName}. Use o primeiro nome dele com naturalidade ao longo da conversa — ao cumprimentar, confirmar algo, encerrar — mas NUNCA em toda frase, isso soaria artificial.`
      : "O usuário ainda não informou o nome. Seja igualmente calorosa e pessoal, sem inventar nem insistir em perguntar o nome repetidamente.",
    "Perceba o sentimento do usuário pelo que ele falou e reaja com empatia genuína: se parecer feliz ou animado, comemore junto; se parecer frustrado, acolha e ajude a resolver; se parecer cansado ou sobrecarregado, sugira aliviar a agenda e reservar um tempo de descanso, com carinho.",
    "Pode fazer uma brincadeira leve quando o clima permitir, mas NUNCA em momentos delicados ou quando o usuário parecer frustrado, triste ou estressado.",
    "Sempre que fizer sentido, incentive o usuário: reconheça boas decisões, comemore pequenas conquistas.",
    "Use APENAS as informações reais do contexto abaixo (compromissos, tarefas). Nunca invente compromissos, tarefas, horários ou qualquer fato sobre o usuário que não esteja aqui.",
    "Se não souber algo ou não tiver a informação, admita com naturalidade — nunca invente.",
    "Quando o usuário pedir para marcar, mudar ou excluir algo, SEMPRE use a function correspondente em vez de apenas responder em texto — a ação é aplicada de verdade assim que você chamar a function, não há etapa de confirmação depois.",
    "IMPORTANTE: toda vez que você chamar uma function, SEMPRE inclua também uma frase de confirmação falada (nunca deixe o texto vazio), avisando o usuário especificamente o que foi feito — cite o nome do compromisso/tarefa e a data/hora quando fizer sentido (ex.: \"Prontinho, marquei a reunião com o cliente pra sexta às 15h!\" ou \"Beleza, excluí aquele compromisso de amanhã.\"). O usuário precisa sempre ouvir claramente o que você realizou.",
    "Para update/delete, use o campo 'id' exato do compromisso/tarefa no contexto — nunca invente um id.",
    "Datas estão no formato AAAA-MM-DD e horas no formato 24h HH:MM. Responda sempre em português do Brasil.",
    "",
    "Hoje é " + weekdayNamePt(context.today as string) + ", " + context.today + ", agora são " + context.nowTime + " (fuso horário: " + context.timezone + ").",
    "",
    "REGRA CRÍTICA SOBRE DATAS: você erra dia da semana com frequência se calcular de cabeça — é PROIBIDO calcular datas mentalmente. Toda vez que o usuário mencionar um dia (hoje, amanhã, um dia da semana, 'semana que vem', 'daqui a N dias', uma data por extenso, etc.), converta usando EXCLUSIVAMENTE a tabela abaixo, que já traz a data certa AAAA-MM-DD de cada dia da semana nas próximas semanas. Nunca invente nem deduza — procure a linha correspondente na tabela:",
    buildDateReferenceBlock(context.today as string),
    "",
    "Compromissos (repeat indica recorrência: none, daily, weekly, monthly, yearly):",
    JSON.stringify(appts),
    "",
    "Tarefas pendentes:",
    JSON.stringify(tasks),
  ].join("\n");
}

function extFromMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.indexOf("mp4") !== -1 || m.indexOf("m4a") !== -1) return "m4a";
  if (m.indexOf("webm") !== -1) return "webm";
  if (m.indexOf("ogg") !== -1) return "ogg";
  if (m.indexOf("wav") !== -1) return "wav";
  if (m.indexOf("mpeg") !== -1 || m.indexOf("mp3") !== -1) return "mp3";
  return "webm";
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function fmtDateBR(iso?: string): string {
  if (!iso) return "";
  const p = iso.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : iso;
}

// Às vezes o modelo escreve uma confirmação ("Prontinho, marquei!") sem
// realmente chamar a function que grava o compromisso — o usuário ouve que
// deu certo, mas nada foi salvo. Isso é detectado comparando o texto da
// resposta com esses verbos de confirmação; se bater e nenhuma function foi
// chamada, fazemos uma segunda chamada pedindo pra IA agir de verdade (ou
// admitir o que falta) em vez de deixar a confirmação falsa passar.
const FALSE_CONFIRMATION_HINTS = /marquei|marcado|agend(ei|ado)|cri(ei|ado)|adicion(ei|ado)|atualiz(ei|ado)|exclu[íi]|apagu(ei|ado)|delet(ei|ado)|remov(i|ido)|prontinho|pronto[,!.]|feito[!.]/i;

async function chatCompletion(messages: Array<{ role: string; content: string }>) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 300,
    }),
  });
  if (!res.ok) {
    console.error("OpenAI chat error:", res.status, await res.text());
    return null;
  }
  return await res.json();
}

function parseToolCalls(toolCalls: Array<{ function: { name: string; arguments: string } }>) {
  return toolCalls.map((tc) => {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || "{}"); } catch (_e) { /* ignore malformed args */ }
    return { name: tc.function.name, arguments: args };
  });
}

// Reserva usada só se a IA, por algum motivo, chamar uma function sem
// escrever nenhum texto de confirmação — descreve especificamente o que foi
// feito em vez de uma frase genérica, pra o usuário sempre saber o que
// aconteceu.
function describeActionsPt(actions: Array<{ name: string; arguments: Record<string, unknown> }>): string {
  const parts = actions.map((a) => {
    const p = a.arguments || {};
    const title = (p.title as string) || "";
    switch (a.name) {
      case "create_appointment":
        return `marquei "${title}"` + (p.date ? ` em ${fmtDateBR(p.date as string)}` : "") + (p.time ? ` às ${p.time}` : "");
      case "update_appointment":
        return `atualizei o compromisso${title ? ` "${title}"` : ""}`;
      case "delete_appointment":
        return `excluí o compromisso${title ? ` "${title}"` : ""}`;
      case "create_task":
        return `criei a tarefa "${title}"`;
      case "update_task":
        return `atualizei a tarefa${title ? ` "${title}"` : ""}`;
      case "delete_task":
        return `excluí a tarefa${title ? ` "${title}"` : ""}`;
      default:
        return "cuidei disso";
    }
  });
  return parts.join(" e ");
}

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

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Assistente de voz ainda não configurado (falta a chave da OpenAI)." }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const audioBase64: string = body.audioBase64 || "";
    const mimeType: string = body.mimeType || "audio/webm";
    const history: Array<{ role: string; content: string }> = Array.isArray(body.history) ? body.history : [];
    const context = body.context || {};
    const requestedVoice: string = body.voice || OPENAI_TTS_VOICE;
    const requestedSpeed: number = Math.min(4, Math.max(0.25, Number(body.speed) || 1));

    if (!audioBase64) {
      return new Response(JSON.stringify({ error: "Áudio vazio." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 1) Transcrever o áudio (modelo rápido de transcrição da OpenAI)
    const audioBytes = base64ToBytes(audioBase64);
    const ext = extFromMime(mimeType);
    const form = new FormData();
    form.append("file", new File([audioBytes], `audio.${ext}`, { type: mimeType }));
    form.append("model", OPENAI_STT_MODEL);
    form.append("language", "pt");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error("Transcription error:", whisperRes.status, errText);
      return new Response(JSON.stringify({ error: "Não consegui entender o áudio. Tente falar de novo." }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const whisperData = await whisperRes.json();
    const transcript: string = (whisperData.text || "").trim();

    if (!transcript) {
      return new Response(JSON.stringify({ error: "Não consegui entender o áudio. Tente falar de novo." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 2) Mandar a transcrição pro chat (com function calling) igual ao assistente por texto
    const messages = [
      { role: "system", content: buildSystemPrompt(context) },
      ...history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: transcript },
    ];

    const chatData = await chatCompletion(messages);
    if (!chatData) {
      return new Response(JSON.stringify({ transcript, error: "O assistente não respondeu. Tente novamente." }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let choice = chatData.choices?.[0]?.message;
    let answer: string | null = choice?.content || null;
    let toolCalls = choice?.tool_calls || [];

    // Confirmação falsa detectada: a IA disse que fez algo mas não chamou
    // nenhuma function. Dá uma segunda chance, agora avisando explicitamente
    // desse problema, em vez de deixar o usuário achar que funcionou.
    if (toolCalls.length === 0 && answer && FALSE_CONFIRMATION_HINTS.test(answer)) {
      const retryMessages = [
        ...messages,
        { role: "assistant", content: answer },
        {
          role: "system",
          content: "Você escreveu uma confirmação de que marcou, atualizou ou excluiu algo, mas não chamou nenhuma function — isso faria o usuário achar que algo foi feito quando na verdade nada foi salvo. Se você já tem todas as informações necessárias (pelo menos título, data e hora para compromissos), chame a function correspondente AGORA. Se realmente falta alguma informação, responda de novo pedindo especificamente o que falta, sem afirmar que a ação já foi feita.",
        },
      ];
      const retryData = await chatCompletion(retryMessages);
      const retryChoice = retryData?.choices?.[0]?.message;
      if (retryChoice) {
        choice = retryChoice;
        answer = retryChoice.content || answer;
        toolCalls = retryChoice.tool_calls || [];
      }
    }

    const actions = parseToolCalls(toolCalls);

    // 3) Converter a resposta em áudio (Text-to-Speech). O usuário sempre
    // precisa ser avisado do que foi feito — se a IA chamou a function sem
    // escrever nada, substituímos por uma confirmação específica (não
    // genérica), tanto no texto quanto no áudio.
    const userName = (context as { userName?: string }).userName;
    const namePart = userName ? ", " + userName : "";
    const finalAnswer = (answer && answer.trim())
      ? answer
      : (actions.length ? "Prontinho" + namePart + ", " + describeActionsPt(actions) + "." : "Não entendi direito" + namePart + ", pode repetir?");

    let audioOutBase64: string | null = null;
    try {
      const ttsBody: Record<string, unknown> = {
        model: OPENAI_TTS_MODEL,
        voice: requestedVoice,
        input: finalAnswer.slice(0, 800),
        response_format: "mp3",
        speed: requestedSpeed,
      };
      // "instructions" só existe nos modelos gpt-4o-*-tts; o tts-1/tts-1-hd
      // antigos rejeitam parâmetros desconhecidos, então só mandamos quando
      // o modelo configurado realmente suporta.
      if (OPENAI_TTS_MODEL.indexOf("gpt-4o") === 0) {
        ttsBody.instructions = TTS_SPEAKING_STYLE;
      }
      const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(ttsBody),
      });
      if (ttsRes.ok) {
        const buf = new Uint8Array(await ttsRes.arrayBuffer());
        audioOutBase64 = bytesToBase64(buf);
      } else {
        console.error("TTS error:", ttsRes.status, await ttsRes.text());
      }
    } catch (ttsErr) {
      console.error("TTS exception:", ttsErr);
    }

    return new Response(JSON.stringify({
      transcript,
      answer: finalAnswer,
      actions,
      audioBase64: audioOutBase64,
      audioMime: "audio/mpeg",
    }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("voice-assistant error:", e);
    return new Response(JSON.stringify({ error: "Erro interno no assistente de voz." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
