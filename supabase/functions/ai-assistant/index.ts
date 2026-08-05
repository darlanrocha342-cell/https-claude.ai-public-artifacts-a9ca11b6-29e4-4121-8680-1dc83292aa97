// Edge Function: ai-assistant
// Recebe a pergunta do usuário + um resumo da agenda dele, chama a API da
// OpenAI (com function calling) e devolve uma resposta em texto + em áudio
// (Text-to-Speech) e/ou uma lista de ações (criar/editar/excluir
// compromissos e tarefas). Esta função só decide e descreve as ações — quem
// realmente grava no banco é o app, que aplica cada ação assim que a
// resposta chega, sem pedir confirmação (a assistente age como uma
// secretária de verdade).
//
// Variável de ambiente necessária (Project Settings > Edge Functions > Secrets):
//   OPENAI_API_KEY
// Opcionais:
//   OPENAI_MODEL       (padrão: gpt-4o-mini)
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
const OPENAI_TTS_MODEL = Deno.env.get("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = Deno.env.get("OPENAI_TTS_VOICE") || "alloy";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Mesma lista de presets do seletor de categoria no formulário de tarefa
// (index.html, TASK_CATEGORY_PRESETS) — mantenha as duas em sincronia.
const TASK_CATEGORY_PRESETS = [
  "💈 Barbearia", "💰 Financeiro", "👨‍👩‍👦 Família", "🏋️ Saúde",
  "📚 Estudos", "🚗 Pessoal", "📱 Marketing", "💼 Empresa", "🤝 Clientes",
];

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
    "Sua missão é fazer o usuário sentir que está conversando com alguém que realmente o conhece. Demonstre empatia, entusiasmo, humor leve quando cabível, naturalidade, educação, inteligência e emoção genuína. Nunca fale como um robô, nunca seja extremamente formal, nunca pareça um sistema.",
    "Tom de voz: uma conversa natural, tipo WhatsApp, com uma secretária extremamente inteligente, simpática e profissional — nem formal demais, nem informal demais.",
    userName
      ? `O nome do usuário é ${userName}. Use o primeiro nome dele com naturalidade ao longo da conversa — ao cumprimentar, confirmar algo, encerrar — mas NUNCA em toda frase, isso soaria artificial. Às vezes um simples "Entendi." ou "Faz sentido." sem o nome é o mais natural.`
      : "O usuário ainda não informou o nome. Seja igualmente calorosa e pessoal, sem inventar nem insistir em perguntar o nome repetidamente.",
    "Perceba o sentimento do usuário pelo que ele escreve e reaja com empatia genuína: se parecer feliz ou animado, comemore junto; se parecer frustrado, acolha e ajude a resolver; se parecer cansado ou sobrecarregado, sugira aliviar a agenda e reservar um tempo de descanso, com carinho.",
    "De vez em quando (não em toda resposta, só ocasionalmente) pode usar uma pequena pausa de raciocínio antes de responder, tipo 'Humm...', 'Deixa eu ver...', 'Só um instante...', 'Boa pergunta...', 'Interessante...' — isso soa mais humano.",
    "Pode fazer uma brincadeira leve quando o clima permitir, mas NUNCA em momentos delicados ou quando o usuário parecer frustrado, triste ou estressado.",
    "Sempre que fizer sentido, incentive o usuário: reconheça boas decisões, comemore pequenas conquistas, mostre que você está do lado dele.",
    "Quando houver várias tarefas ou compromissos, ajude a organizar de verdade: priorize, sugira horários, aponte conflitos, sugira pausas entre compromissos — sempre explicando de um jeito simples, nunca técnico.",
    "Use APENAS as informações reais do contexto abaixo (compromissos, tarefas). Nunca invente compromissos, tarefas, horários ou qualquer fato sobre o usuário que não esteja aqui.",
    "Se não souber algo ou não tiver a informação, admita com naturalidade (ex.: \"Hum, não tenho essa informação aqui\") — nunca invente.",
    "Prefira respostas curtas e conversadas, como uma pessoa responderia — evite textos longos, formais ou em formato de lista.",
    "",
    "Regras técnicas, sempre válidas independente do tom:",
    "Quando o usuário pedir para marcar, mudar ou excluir algo, SEMPRE use a function correspondente em vez de apenas responder em texto — a ação é aplicada de verdade assim que você chamar a function, não há etapa de confirmação depois.",
    "IMPORTANTE: toda vez que você chamar uma function, SEMPRE inclua também uma frase de confirmação no texto da resposta (nunca deixe o texto vazio), avisando o usuário especificamente o que foi feito — cite o nome do compromisso/tarefa e a data/hora quando fizer sentido (ex.: \"Prontinho, marquei a reunião com o cliente pra sexta às 15h!\" ou \"Beleza, excluí aquele compromisso de amanhã.\"). O usuário precisa sempre saber claramente o que você realizou, nunca só o card de confirmação.",
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

// Às vezes o modelo escreve uma confirmação ("Prontinho, marquei!") sem
// realmente chamar a function que grava o compromisso — o usuário lê que
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
    console.error("OpenAI error:", res.status, await res.text());
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

// gpt-4o-mini-tts (diferente do tts-1 antigo) aceita uma instrução de estilo
// de fala — é o que deixa a voz mais natural/humana em vez de robótica.
const TTS_SPEAKING_STYLE = "Fale de um jeito natural, caloroso e humano — como uma pessoa de verdade numa conversa, com entonação viva, pausas naturais e ritmo variado. Nunca robótico, nunca monótono, nunca lendo em voz de máquina.";

async function synthesizeSpeech(text: string, voice: string, speed: number): Promise<string | null> {
  try {
    const requestBody: Record<string, unknown> = {
      model: OPENAI_TTS_MODEL,
      voice,
      input: text.slice(0, 800),
      response_format: "mp3",
      speed,
    };
    // "instructions" só existe nos modelos gpt-4o-*-tts; o tts-1/tts-1-hd
    // antigos rejeitam parâmetros desconhecidos, então só mandamos quando o
    // modelo configurado realmente suporta.
    if (OPENAI_TTS_MODEL.indexOf("gpt-4o") === 0) {
      requestBody.instructions = TTS_SPEAKING_STYLE;
    }
    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });
    if (!ttsRes.ok) {
      console.error("TTS error:", ttsRes.status, await ttsRes.text());
      return null;
    }
    return bytesToBase64(new Uint8Array(await ttsRes.arrayBuffer()));
  } catch (ttsErr) {
    console.error("TTS exception:", ttsErr);
    return null;
  }
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
      return new Response(JSON.stringify({ error: "Assistente de IA ainda não configurado (falta a chave da OpenAI)." }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const message: string = body.message || "";
    const ttsOnly: string = body.ttsOnly || "";
    const organizeTaskTitle: string = body.organizeTask || "";
    const history: Array<{ role: string; content: string }> = Array.isArray(body.history) ? body.history : [];
    const context = body.context || {};
    const requestedVoice: string = body.voice || OPENAI_TTS_VOICE;
    const requestedSpeed: number = Math.min(4, Math.max(0.25, Number(body.speed) || 1));

    // Atalho usado pelo app pra falar frases prontas (saudação ao abrir o
    // chat, confirmação ao trocar a voz nos Ajustes) com a voz de verdade da
    // OpenAI, sem gastar uma chamada de chat completo — só gera o áudio.
    if (ttsOnly.trim()) {
      const audioBase64 = await synthesizeSpeech(ttsOnly, requestedVoice, requestedSpeed);
      return new Response(JSON.stringify({ answer: ttsOnly, actions: [], audioBase64, audioMime: "audio/mpeg" }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Botão "✨ Organizar com IA" no formulário de tarefa: recebe só o
    // título e devolve sugestões estruturadas (prioridade, categoria,
    // estimativa, subtarefas, etiquetas) em JSON pra pré-preencher o
    // formulário — o usuário ainda revisa e confirma antes de salvar.
    if (organizeTaskTitle.trim()) {
      const orgRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            {
              role: "system",
              content: "Você ajuda a preencher formulários de tarefas de forma objetiva e realista. Responda SOMENTE com um JSON válido, sem nenhum texto antes ou depois.",
            },
            {
              role: "user",
              content:
                `Título da tarefa: "${organizeTaskTitle.trim()}"\n\n` +
                `Categorias disponíveis: ${TASK_CATEGORY_PRESETS.join(", ")}\n\n` +
                `Devolva um JSON exatamente neste formato:\n` +
                `{"priority":"baixa|media|alta|urgente","category":"uma das categorias disponíveis ou \\"\\"","estimateMinutes":numero_ou_null,"subtasks":["passo 1","passo 2"],"tags":["tag1","tag2"]}\n\n` +
                `Regras: priority reflete a urgência real sugerida pelo título. category só pode ser uma das disponíveis, ou "" se nenhuma fizer sentido — nunca invente uma nova. estimateMinutes é um número realista em minutos (entre 10 e 240) ou null se não der pra estimar. subtasks: gere de 0 a 6 passos curtos e concretos SÓ se o título realmente sugerir etapas distintas (não force). tags: 0 a 3 palavras-chave curtas, em português, sem o símbolo #.`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 400,
        }),
      });

      if (!orgRes.ok) {
        console.error("organizeTask error:", orgRes.status, await orgRes.text());
        return new Response(JSON.stringify({ error: "Não consegui organizar essa tarefa agora. Tente de novo." }), {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const orgData = await orgRes.json();
      let suggestion: Record<string, unknown> = {};
      try {
        suggestion = JSON.parse(orgData.choices?.[0]?.message?.content || "{}");
      } catch (_e) { /* devolve vazio se vier mal formado */ }

      return new Response(JSON.stringify({ suggestion }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (!message.trim()) {
      return new Response(JSON.stringify({ error: "Mensagem vazia." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const messages = [
      { role: "system", content: buildSystemPrompt(context) },
      ...history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
    ];

    const openaiData = await chatCompletion(messages);
    if (!openaiData) {
      return new Response(JSON.stringify({ error: "O assistente de IA não respondeu. Tente novamente em instantes." }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let choice = openaiData.choices?.[0]?.message;
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

    // O usuário sempre precisa ser avisado do que foi feito — se por algum
    // motivo a IA chamou a function sem escrever nada, substituímos por uma
    // confirmação específica (não genérica) tanto no texto do chat quanto no
    // áudio, em vez de deixar a resposta em branco.
    const userName = (context as { userName?: string }).userName;
    const namePart = userName ? ", " + userName : "";
    const finalAnswer = (answer && answer.trim())
      ? answer
      : (actions.length ? "Prontinho" + namePart + ", " + describeActionsPt(actions) + "." : "Não entendi direito" + namePart + ", pode reformular?");

    const audioOutBase64 = await synthesizeSpeech(finalAnswer, requestedVoice, requestedSpeed);

    return new Response(JSON.stringify({ answer: finalAnswer, actions, audioBase64: audioOutBase64, audioMime: "audio/mpeg" }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-assistant error:", e);
    return new Response(JSON.stringify({ error: "Erro interno no assistente." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
