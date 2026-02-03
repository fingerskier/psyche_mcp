import OpenAI from "openai";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

/**
 * Generate an embedding vector for the given text using OpenAI's
 * text-embedding-3-small model (1536 dimensions).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const truncated = text.slice(0, 8000);
  const response = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input: truncated,
  });
  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call.
 */
export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const truncated = texts.map((t) => t.slice(0, 8000));
  const response = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input: truncated,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
