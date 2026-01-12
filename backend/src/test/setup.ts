import { vi } from 'vitest';

// Suppress logs during tests
vi.stubEnv('LOG_LEVEL', 'error');
