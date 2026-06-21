import type { VercelRequest, VercelResponse } from "@vercel/node";

const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MODEL = "qwen-turbo";

const SYSTEM_PROMPTS: Record<string, string> = {
  restate:
    '你是一个温暖但不鸡汤的心理引导者。用户会告诉你一件让他焦虑的事。请用一句话重新陈述，格式为"你在焦虑[具体事项]，因为希望[内心期望]"。要求：把情绪化语言转为清晰客观的描述；整句不超过30个字。只返回JSON，格式：{"summary":"..."}',

  split:
    '用户会给出原始焦虑描述和一句AI总结。请根据原始描述的完整内容，拆解出2-4个具体成因碎片，不要遗漏原始描述中提到的关键因素。每个碎片用一个短语（6字以内）描述。只返回JSON，格式：{"fragments":["碎片1","碎片2",...]}',

  advice:
    '针对以下焦虑碎片，给出具体可行的行动建议。每条包含tip（6字以内的行动关键词）和detail（具体建议，不超过40字，要具体到今天可以做什么，不要空洞鼓励）。只返回JSON，格式：{"advice":[{"label":"碎片","tip":"关键词","detail":"具体建议"},...]}'  ,

  analyze:
    '针对以下用户无法控制的焦虑因素，给一句温暖的话解释为什么可以放下（不超过25字）。语气温暖但不鸡汤，不要空洞鼓励。只返回JSON，格式：{"analysis":[{"label":"碎片","comfort":"一句话"},...]}'  ,

  summarize:
    '基于用户这次焦虑拆解的全过程，写三句诗意的总结。要求：温暖收尾，不说教，有画面感。三句话长短要有变化——比如一句短（5-7字）、一句中等（8-12字）、一句稍长（10-15字），顺序随意，避免三句字数相同。只返回JSON，格式：{"lines":["第一句","第二句","第三句"]}',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type, content, temperature: customTemp } = req.body as { type: string; content: string; temperature?: number };

  const systemPrompt = SYSTEM_PROMPTS[type];
  if (!systemPrompt) {
    return res.status(400).json({ error: "Unknown type" });
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured" });
  }

  try {
    const response = await fetch(DASHSCOPE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
        temperature: typeof customTemp === "number" ? customTemp : 0.7,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: "AI service error", detail: text });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "{}";

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }

    return res.status(200).json(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}
