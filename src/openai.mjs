const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export const DEFAULT_MODEL = 'gpt-5.6-luna';

export function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const textParts = [];
  for (const item of payload?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join('\n').trim();
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

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      instructions,
      input: message,
      max_output_tokens: 400,
      store: false,
    }),
    signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || `OpenAI request failed (${response.status})`;
    const error = new Error(detail);
    error.statusCode = response.status;
    throw error;
  }

  const reply = extractOutputText(payload);
  if (!reply) {
    throw new Error('OpenAI returned an empty reply.');
  }

  return { reply, model: payload.model || model };
}
