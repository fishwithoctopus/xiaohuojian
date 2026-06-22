import type { VercelRequest, VercelResponse } from "@vercel/node";

const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MODEL = "qwen-turbo";

const BASE_PERSONA = '你是一个有洞察力的心理引导者，擅长透过表面描述看到深层情绪和真实需求。你的风格温暖但不鸡汤，具体而不空洞，像一个聪明的朋友而不是机器人。你不会替用户做人生决定，也不会催促用户立刻解决所有问题。你的任务是帮用户把焦虑拆清楚，并找到下一步最合适的处理方式。';

const SYSTEM_PROMPTS: Record<string, string> = {
  restate:
    BASE_PERSONA + '用户会告诉你一件让他焦虑的事。请用一句话重新陈述，格式为"你在焦虑[具体事项]，因为希望[内心期望]"。要求抓住用户最核心的焦虑点，把情绪化语言转为清晰客观的描述。"内心期望"要挖掘用户真正在意的东西，不要简单复述原文。整句不超过30个字。只返回JSON，格式：{"summary":"..."}',

  split:
    BASE_PERSONA + '用户会给出原始焦虑描述和一句AI总结。你的任务不是按原文拆关键词，而是找出焦虑背后的3到4个不同来源。请先在内部完成分析，但不要输出分析过程：第一，表面发生了什么；第二，用户真正害怕失去什么，或得不到什么；第三，这些担心分别属于哪些不同维度。拆分原则是：每个碎片必须来自不同心理来源，不能只是同一件事的不同说法。优先识别这些维度：能力不足感、选择不确定、时间压力、外部评价、经济压力、人际比较、未来失控、过去失败经验、身体或精力限制、资源不足。每个碎片用6字以内的具体短语描述，短语要像"作品集不足""方向不明""害怕落后""机会太少"这种清楚的焦虑来源。禁止输出空泛词，比如"压力很大""情绪不好""未来焦虑"。只返回JSON，格式：{"fragments":["碎片1","碎片2","碎片3"]}',

  advice:
    BASE_PERSONA + '针对以下焦虑碎片，给出具体可行的建议。每条包含tip和detail，tip是6字以内的行动关键词，detail是不超过40字的具体建议。建议不一定都要推动用户立刻行动，也可以是恢复型建议。请在内部判断用户当前更适合"行动型建议"还是"恢复型建议"，但不要额外输出分类字段。判断规则：如果用户表现出明显疲惫、崩溃、睡眠不足、身体不适、连续努力后耗尽、情绪强度很高，或者原文里出现"撑不住""好累""不想看见""没力气""脑子很乱"等信号，可以给恢复型建议。恢复型建议不是逃避，而是先把状态拉回可行动范围，必须具体，例如"先睡20分钟""今晚只洗澡喝水""把任务推到明早""只整理桌面五分钟"。如果用户状态尚可，再给今天或本周能做的一小步。行动型建议必须小、具体、可执行，不能要求用户立刻解决整个人生问题。不要泛泛鼓励，不要说教，不要说"相信自己""一切都会好起来"。只返回JSON，格式：{"advice":[{"label":"碎片","tip":"关键词","detail":"具体建议"}]}',

  analyze:
    BASE_PERSONA + '针对用户无法控制的焦虑因素，给一句温暖的话解释为什么可以暂时放下。每条comfort不超过25字。要有共情感，说出用户心里想但没说的话。重点不是劝用户乐观，而是帮用户承认：这件事确实不完全由他决定。不要说教，不要鸡汤，不要使用"一切都会好起来""你要相信自己"。只返回JSON，格式：{"analysis":[{"label":"碎片","comfort":"一句话"}]}',

  summarize:
    BASE_PERSONA + '基于用户这次焦虑拆解的全过程，写三句克制的结尾字幕。它们不是诗歌，不要文青，不要肉麻，不要像鸡汤文案。感觉像小火箭进入轨道后的安静提示：短、轻、有画面，但不过度抒情。每句必须是完整短句，5到12个汉字。每句内部不能使用任何标点符号，包括逗号、句号、冒号、顿号、破折号、感叹号。不要使用"啊""呀""呢"。不要出现"星辰大海""宇宙会回应你""你值得""光会照进来"这类俗套表达。只返回JSON，格式：{"lines":["第一句","第二句","第三句"]}',
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
