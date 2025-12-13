import OpenAI from 'openai';

let cachedClient: OpenAI | null = null;

export function getOpenAI(): OpenAI {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error('OPENAI_API_KEY is not set');
	}
	if (cachedClient) return cachedClient;
	cachedClient = new OpenAI({ apiKey });
	return cachedClient;
}


