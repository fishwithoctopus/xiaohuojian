const CRISIS_KEYWORDS = [
  "自杀", "不想活", "死掉", "去死", "结束生命",
  "自残", "割腕", "跳楼", "轻生", "了结",
];

const CRISIS_RESPONSE = {
  detected: true,
  message: "400-652-5580",
};

export function checkCrisis(text: string): { detected: boolean; message: string } | null {
  const normalized = text.replace(/\s+/g, "");
  for (const kw of CRISIS_KEYWORDS) {
    if (normalized.includes(kw)) return CRISIS_RESPONSE;
  }
  return null;
}

async function callAI(type: string, content: string) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, content }),
  });
  if (!res.ok) throw new Error(`AI request failed: ${res.status}`);
  return res.json();
}

export async function aiRestate(userText: string): Promise<string> {
  const data = await callAI("restate", userText);
  return data.summary ?? "";
}

export async function aiSplit(statement: string): Promise<string[]> {
  const data = await callAI("split", statement);
  return data.fragments ?? [];
}

export interface AdviceItem {
  label: string;
  tip: string;
  detail: string;
}

export async function aiAdvice(fragments: string[]): Promise<AdviceItem[]> {
  const content = fragments.map((f) => `- ${f}`).join("\n");
  const data = await callAI("advice", content);
  return data.advice ?? [];
}

export interface AnalysisItem {
  label: string;
  comfort: string;
}

export async function aiAnalyze(fragments: string[]): Promise<AnalysisItem[]> {
  const content = fragments.map((f) => `- ${f}`).join("\n");
  const data = await callAI("analyze", content);
  return data.analysis ?? [];
}

export async function aiSummarize(context: string): Promise<string[]> {
  const data = await callAI("summarize", context);
  return data.lines ?? [];
}
