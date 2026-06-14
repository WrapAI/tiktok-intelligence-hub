import Anthropic from "@anthropic-ai/sdk";

export async function callClaude(
  apiKey: string,
  system: string,
  user: string,
  model = "claude-sonnet-4-20250514"
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Claude returned an empty response");
  return text;
}
