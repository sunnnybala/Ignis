import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { mastra } from "./mastra";
dotenv.config();

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!isProd) return callback(null, true);
      if (!origin) return callback(null, true); // server-to-server or curl
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  }),
);

// Request context (requestId + structured request logging)
import { requestContext } from './middleware/requestContext';
app.use(requestContext);

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Public test endpoint (Option A): call Mastra agent directly from Express
app.get('/api/weather', async (req, res) => {
  const { city } = req.query as { city?: string };

  if (!city) {
    return res.status(400).send("Missing 'city' query parameter");
  }

  try {
    const agent = mastra.getAgent('weatherAgent');
    const result = await agent.generate(`What's the weather like in ${city}?`);
    return res.status(200).send(result.text);
  } catch (error) {
    console.error('Agent error:', error);
    return res.status(500).send('An error occurred while processing your request');
  }
});

// Public test routes (mounted before auth for local testing)
import { vfsRouter } from './routes/vfs';   // added just for testing purposes
app.use('/vfs', vfsRouter);                // added just for testing purposes

// Auth (Supabase JWT). Public endpoints are allowlisted inside requireAuth.
import { requireAuth } from './middleware/auth';
app.use(requireAuth);

// Routes
import { filesRouter } from './routes/files';
import { projectsRouter } from './routes/projects';
import { agentRouter } from './routes/agent';
import { jobsRouter } from './routes/jobs';
import { streamRouter } from './routes/stream';
import { paperRouter } from './routes/paper';
import { routerRouter } from './routes/router';
app.use('/files', filesRouter);
app.use('/projects', projectsRouter);
app.use('/agent', agentRouter);
app.use('/jobs', jobsRouter);
app.use('/stream', streamRouter);
app.use('/paper', paperRouter);
app.use('/router', routerRouter);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});




