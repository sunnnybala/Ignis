import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Hoisted mocks
const { mockSpawn, mockMkdtemp, mockWriteFile, mockReadFile, mockRm, mockExistsSync } = vi.hoisted(() => {
	const mockSpawn = vi.fn();
	const mockMkdtemp = vi.fn();
	const mockWriteFile = vi.fn();
	const mockReadFile = vi.fn();
	const mockRm = vi.fn();
	const mockExistsSync = vi.fn();

	return { mockSpawn, mockMkdtemp, mockWriteFile, mockReadFile, mockRm, mockExistsSync };
});

vi.mock('../utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('child_process', () => ({
	spawn: mockSpawn,
}));

vi.mock('fs', () => ({
	promises: {
		mkdtemp: mockMkdtemp,
		writeFile: mockWriteFile,
		readFile: mockReadFile,
		rm: mockRm,
	},
	existsSync: mockExistsSync,
}));

import { LatexCompileError, compileLatexToPdf } from './latexCompiler';

// Helper to create a mock child process
function createMockChildProcess() {
	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		kill: ReturnType<typeof vi.fn>;
	};
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = vi.fn();
	return child;
}

describe('LatexCompileError', () => {
	it('has correct name property', () => {
		const error = new LatexCompileError('Test message', 'Test log');
		expect(error.name).toBe('LatexCompileError');
	});

	it('stores log in public property', () => {
		const error = new LatexCompileError('Test message', 'Detailed log output');
		expect(error.log).toBe('Detailed log output');
	});

	it('extends Error with message', () => {
		const error = new LatexCompileError('Compilation failed', 'Log');
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toBe('Compilation failed');
	});
});

describe('compileLatexToPdf', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockMkdtemp.mockResolvedValue('/tmp/ignis-tectonic-123');
		mockWriteFile.mockResolvedValue(undefined);
		mockRm.mockResolvedValue(undefined);
	});

	it('throws LatexCompileError when spawn emits error', async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);

		const promise = compileLatexToPdf('\\documentclass{article}');

		// Emit spawn error
		setImmediate(() => {
			child.emit('error', new Error('spawn ENOENT'));
		});

		await expect(promise).rejects.toThrow(LatexCompileError);
		await expect(promise).rejects.toMatchObject({
			name: 'LatexCompileError',
		});
	});

	it('throws LatexCompileError when exit code is non-zero', async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);
		mockExistsSync.mockReturnValue(false);

		const promise = compileLatexToPdf('\\documentclass{article}');

		setImmediate(() => {
			child.stderr.emit('data', 'Error: Undefined control sequence');
			child.emit('exit', 1);
		});

		await expect(promise).rejects.toThrow(LatexCompileError);
		await expect(promise).rejects.toThrow('LaTeX compilation failed');
	});

	it('throws LatexCompileError when PDF file not created', async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);
		mockExistsSync.mockReturnValue(false); // PDF doesn't exist

		const promise = compileLatexToPdf('\\documentclass{article}');

		setImmediate(() => {
			child.emit('exit', 0); // Success exit code but no PDF
		});

		await expect(promise).rejects.toThrow(LatexCompileError);
	});

	it('cleans up temp directory on success', async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);
		mockExistsSync.mockReturnValue(true);
		mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.4'));

		const promise = compileLatexToPdf('\\documentclass{article}');

		setImmediate(() => {
			child.emit('exit', 0);
		});

		await promise;

		expect(mockRm).toHaveBeenCalledWith('/tmp/ignis-tectonic-123', { recursive: true, force: true });
	});

	it('cleans up temp directory on failure', async () => {
		const child = createMockChildProcess();
		mockSpawn.mockReturnValue(child);
		mockExistsSync.mockReturnValue(false);

		const promise = compileLatexToPdf('\\documentclass{article}');

		setImmediate(() => {
			child.emit('exit', 1);
		});

		await expect(promise).rejects.toThrow();
		expect(mockRm).toHaveBeenCalledWith('/tmp/ignis-tectonic-123', { recursive: true, force: true });
	});
});
