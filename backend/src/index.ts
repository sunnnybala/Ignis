import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
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

// Auth (Supabase JWT). Public endpoints are allowlisted inside requireAuth.
import { requireAuth } from './middleware/auth';
app.use(requireAuth);

// Routes
import { filesRouter } from './routes/files';
import { projectsRouter } from './routes/projects';
import { jobsRouter } from './routes/jobs';
import { streamRouter } from './routes/stream';
import { paperRouter } from './routes/paper';
import { routerRouter } from './routes/router';
app.use('/files', filesRouter);
app.use('/projects', projectsRouter);
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




