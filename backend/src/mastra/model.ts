import { createVertex } from '@ai-sdk/google-vertex';

// Build Google Auth options from environment variables
// Supports both GOOGLE_APPLICATION_CREDENTIALS (file path) and individual env vars
const googleAuthOptions =
  process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY
    ? {
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
      }
    : undefined; // Falls back to GOOGLE_APPLICATION_CREDENTIALS or ADC

// Create Vertex AI provider instance
// IMPORTANT: Gemini 3 Pro Preview is ONLY available on the 'global' endpoint
export const vertex = createVertex({
  project: process.env.GOOGLE_VERTEX_PROJECT,
  location: 'global', // Gemini 3 preview models require global endpoint
  googleAuthOptions,
});

// Export the configured model for use in agents
// Gemini 3 Pro Preview - 1M token context window, requires global endpoint
export const geminiModel = vertex('gemini-3-pro-preview');
