export const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

export function geminiGenerateUrl(model = DEFAULT_MODEL) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function extractOutputText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export async function generateReply({
  message,
  tone,
  apiKey,
  model = DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  signal,
}) {
  const instructions = [
    'You write polished replies for email, chat, and customer support.',
    `Use a ${tone} tone.`,
    'Return only the reply that the user can send.',
    'Do not invent names, dates, promises, prices, or company policies.',
    'Keep the reply clear, natural, and concise unless the message requires detail.',
  ].join(' ');

  const response = await fetchImpl(geminiGenerateUrl(model), {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: instructions }],
      },
      contents: [{
        role: 'user',
        parts: [{ text: message }],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400,
      },
    }),
    signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || `Gemini request failed (${response.status})`;
    const error = new Error(detail);
    error.statusCode = response.status;
    throw error;
  }

  const reply = extractOutputText(payload);
  if (!reply) {
    const finishReason = payload?.candidates?.[0]?.finishReason;
    const suffix = finishReason ? ` (${finishReason})` : '';
    throw new Error(`Gemini returned an empty reply${suffix}.`);
  }

  return { reply, model: payload.modelVersion || model };
}
