import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.DASHSCOPE_API_KEY || "";

  return {
    plugins: [
      react(),
      {
        name: "ai-proxy",
        configureServer(server) {
          server.middlewares.use("/api/chat", async (req, res) => {
            if (req.method !== "POST") {
              res.writeHead(405);
              res.end(JSON.stringify({ error: "Method not allowed" }));
              return;
            }

            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const customTemp = typeof body.temperature === "number" ? body.temperature : undefined;

            const BASE_PERSONA = '你是一个有洞察力的心理引导者，擅长透过表面描述看到深层情绪和需求。你的风格：温暖但不鸡汤，具体而不空洞，像一个聪明的朋友而不是机器人。';

            const SYSTEM_PROMPTS: Record<string, string> = {
              restate:
                BASE_PERSONA + '用户会告诉你一件让他焦虑的事。请用一句话重新陈述，格式为"你在焦虑[具体事项]，因为希望[内心期望]"。要求：抓住用户最核心的焦虑点，把情绪化语言转为清晰客观的描述；"内心期望"要挖掘用户真正在意的东西而不是简单复述。整句不超过30个字。只返回JSON，格式：{"summary":"..."}',
              split:
                BASE_PERSONA + '用户会给出原始焦虑描述和一句AI总结。请仔细阅读原始描述，识别出所有不同维度的焦虑来源（如：外部压力、自我怀疑、人际比较、过去经历等），拆解为3-4个碎片。每个碎片用一个具体短语（6字以内）描述，要能看出是不同角度而非同义重复。只返回JSON，格式：{"fragments":["碎片1","碎片2",...]}',
              advice:
                BASE_PERSONA + '针对以下焦虑碎片，给出具体可行的行动建议。每条包含tip（6字以内的行动关键词）和detail（具体建议，不超过40字，要具体到今天就能做的一小步，不要泛泛而谈）。只返回JSON，格式：{"advice":[{"label":"碎片","tip":"关键词","detail":"具体建议"},...]}'  ,
              analyze:
                BASE_PERSONA + '针对以下用户无法控制的焦虑因素，给一句温暖的话解释为什么可以放下（不超过25字）。要有共情感，说出用户心里想但没说的话。只返回JSON，格式：{"analysis":[{"label":"碎片","comfort":"一句话"},...]}'  ,
              summarize:
                BASE_PERSONA + '基于用户这次焦虑拆解的全过程，写三句诗意的总结。要求：温暖收尾，不说教，有画面感。三句话长短要有变化——比如一句短（5-7字）、一句中等（8-12字）、一句稍长（10-15字），顺序随意，避免三句字数相同。只返回JSON，格式：{"lines":["第一句","第二句","第三句"]}',
            };

            const systemPrompt = SYSTEM_PROMPTS[body.type];
            if (!systemPrompt) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "Unknown type" }));
              return;
            }

            if (!apiKey || apiKey === "sk-your-key-here") {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "No API key configured" }));
              return;
            }

            try {
              const aiRes = await fetch(
                "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                  },
                  body: JSON.stringify({
                    model: "qwen-turbo",
                    messages: [
                      { role: "system", content: systemPrompt },
                      { role: "user", content: body.content },
                    ],
                    response_format: { type: "json_object" },
                    temperature: customTemp ?? 0.7,
                  }),
                }
              );

              const data = await aiRes.json();
              const raw = data.choices?.[0]?.message?.content ?? "{}";
              let parsed: unknown;
              try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(parsed));
            } catch (err: unknown) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
        },
      },
    ],
  };
});
