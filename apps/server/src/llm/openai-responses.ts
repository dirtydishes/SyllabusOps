import { z } from "zod";

type OpenAiResponseMessage = {
  type?: string;
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type OpenAiResponseJson = {
  output_text?: string;
  output?: OpenAiResponseMessage[];
  error?: unknown;
};

function extractOutputText(payload: OpenAiResponseJson): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const texts: string[] = [];
  for (const item of payload.output ?? []) {
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && typeof c.text === "string") texts.push(c.text);
    }
  }
  return texts.join("\n").trim();
}

export async function openAiJsonSchema<T>(opts: {
  apiBaseUrl: string; // e.g. https://api.openai.com/v1
  model: string;
  headers: { Authorization: string };
  schemaName: string;
  schema: unknown; // JSON Schema object
  system: string;
  user: string;
  maxOutputTokens?: number;
}): Promise<T> {
  const url = new URL("/responses", opts.apiBaseUrl);
  const body = {
    model: opts.model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: opts.system }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: opts.user }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: opts.schemaName,
        schema: opts.schema,
        strict: true,
      },
    },
    max_output_tokens: opts.maxOutputTokens ?? 1200,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: opts.headers.Authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI /responses failed (${res.status}): ${text.slice(0, 800)}`);
  }

  let parsed: OpenAiResponseJson;
  try {
    parsed = JSON.parse(text) as OpenAiResponseJson;
  } catch {
    throw new Error("OpenAI /responses returned non-JSON response.");
  }

  const outText = extractOutputText(parsed);
  if (!outText) {
    throw new Error("OpenAI /responses returned empty output_text.");
  }

  let json: unknown;
  try {
    json = JSON.parse(outText);
  } catch {
    throw new Error("OpenAI output_text was not valid JSON.");
  }

  // validate is object/array-ish; caller should further validate
  return z.any().parse(json) as T;
}

