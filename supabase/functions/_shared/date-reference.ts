// Compartilhado por ai-assistant e voice-assistant: monta uma tabela de datas
// determinística (calculada em código, não pela IA) pra evitar que o modelo
// erre o dia da semana ou a data ao interpretar "sexta-feira", "amanhã",
// "semana que vem" etc. Nunca deixe a IA calcular datas de cabeça — modelos
// pequenos (gpt-4o-mini) erram isso com frequência, especialmente perto da
// virada do mês/ano.

const WEEKDAYS_PT = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado",
];

function parseISODateUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function weekdayNamePt(iso: string): string {
  return WEEKDAYS_PT[parseISODateUTC(iso).getUTCDay()];
}

// Gera as próximas `days` datas (incluindo hoje) como "AAAA-MM-DD = dia-da-semana (apelido)".
export function buildDateReferenceBlock(todayISO: string, days = 21): string {
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
