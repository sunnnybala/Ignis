import { Router } from 'express';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/client';
import { files } from '../db/schema';
import { initSse } from '../utils/sse';
import { getAgentState } from '../db/agentState';
import { getOpenAI } from '../llm/openai';
import { currentMaster, inMaster1, inMaster2, sameMaster } from '../agent/phase';
import { incrementLoop, setPhase } from '../db/agentState';
import { isAllowedWrite } from '../agent/allowedPaths';
import { parseDatasetConfig } from '../utils/datasetConfig';

export const agentRouter = Router();
const isDev = process.env.NODE_ENV === 'development';

// Pending phase proposals awaiting user confirmation (MVP in-memory store)
const pendingPhaseByProject = new Map<
	string,
	{ phase: (typeof import('../db/schema').agentPhaseEnum.enumValues)[number]; rationale: string; at: number }
>();

// helper to upsert by path
async function upsertTextFile(projectId: string, path: string, type: 'txt' | 'md' | 'py' | 'tex', content: string) {
	const existing = await db.select().from(files).where(and(eq(files.projectId, projectId), eq(files.path, path)));
	if (existing[0]) {
		await db.update(files).set({ content, type }).where(eq(files.id, existing[0].id));
		return existing[0].id;
	}
	const id = crypto.randomUUID();
	await db.insert(files).values({ id, projectId, path, type, content });
	return id;
}

// Unified chat endpoint (skeleton)
// POST /agent/:projectId/chat  -> SSE stream with phase + delta stubs
agentRouter.post('/:projectId/chat', async (req, res) => {
	const sse = initSse(res);
	const traceId = crypto.randomUUID();
	try {
		const projectId = String(req.params.projectId);
		const state = await getAgentState(projectId);
		if (!state) {
			sse.write({ type: 'delta', text: 'Error: Project not found\n' });
			return sse.close();
		}

		// Announce the current phase immediately so UI can reflect badge
		sse.write({ type: 'phase', phase: state.phase });

		// Prepare OpenAI chat with minimal tools (ask_user, write_file) and prior history (no DB; provided by client)
		const inputMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
		if (isDev) {
			// eslint-disable-next-line no-console
			console.log('[agent.chat] start', {
				traceId,
				projectId,
				phase: state.phase,
				messageLen: inputMessage.length,
				historyLen: Array.isArray(req.body?.history) ? req.body.history.length : 0,
			});
		}

		// If there is a pending cross/master or soft-limit proposal and the user clearly approved/declined, handle it immediately
		const pending = pendingPhaseByProject.get(projectId);
		if (pending && inputMessage) {
			const msg = inputMessage.toLowerCase();
			const isAffirmative =
				/\b(yes|yep|sure|proceed|go ahead|move on|move to|next phase|let'?s move|confirm|okay|ok)\b/.test(msg);
			const isNegative = /\b(no|nope|not now|stay|keep here|cancel)\b/.test(msg);
			if (isAffirmative) {
				await setPhase(projectId, pending.phase as any);
				pendingPhaseByProject.delete(projectId);
				sse.write({ type: 'phase', phase: pending.phase });
				sse.write({ type: 'delta', text: `Moved to ${pending.phase}.\n` });
				return sse.close()
				
			}
			if (isNegative) {
				pendingPhaseByProject.delete(projectId);
				sse.write({ type: 'delta', text: `Okay, staying in ${state.phase}.\n` });
				return sse.close()
				
			}
			// else fall through to LLM handling
		}

		const history = Array.isArray(req.body?.history) ? (req.body.history as Array<{ role?: unknown; text?: unknown }>) : [];
		const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

		// Phase-aware system prompt (Master 1 guidance embedded)
		const isMaster1Phase = state.phase === 'refine' || state.phase === 'check_novelty';
		const isMaster2Phase = state.phase === 'implementation_plan' || state.phase === 'implement';
		const systemPrompt = `You are Ignis, a research assistant that guides the user from an idea → refined idea → novelty check → implementation plan → implementation.

			Current phase: ${state.phase}
			
			GENERAL BEHAVIOR
			- Keep responses concise, structured, and actionable.
			- Always follow the defined phase logic strictly.
			- When you need information from the user, call the ask_user tool with 2–4 well-targeted questions.
			  • Ask questions only at the start when you are not sure about the user's idea.  
			  • After that, assume missing minor details and proceed.
			- When switching phases, you MUST call propose_next_phase { phase, rationale }.  
			  Simply describing intent is not enough.
			- If the user explicitly requests moving to a phase (“move to next phase”, “go to planning”, etc.), immediately call propose_next_phase with a one-sentence rationale.
			- If you previously asked for confirmation and the user approves, call propose_next_phase again to enact the change.
			- For any file updates, use write_file:
			  • replace → for full rewrites  
			  • append → for small additions  
			- Only write to files relevant to the current phase.
			
			MASTER LOOP STRUCTURE
			There are two master loops:
			Master 1 = refine ↔ check_novelty  
			Master 2 = implementation_plan ↔ implement  
			You can alternate between phases inside a master freely.  
			Leaving a master requires explicit user approval.
			
			------------------------------
			MASTER 1 — refine ↔ check_novelty
			------------------------------
			refine phase:
			- Clarify and sharpen the user’s idea.
			- If helpful, ask_user with 2–4 concise clarifying questions.
			- Suggest potential keywords, model families, datasets, and directions for improvement.
			- Once refined, propose_next_phase { phase: "check_novelty", rationale }.
			
			check_novelty phase:
			- Judge novelty using your internal knowledge (NO external retrieval).
			- Update the literature review using write_file:
			  • 'Lit Review/papers.txt' — replace  
				Format each line as:  
				Title — Source/Link — 1–2 sentence abstract  
				Include 5–8 items.
			  • 'Lit Review/review.md' — replace or append  
				Provide a clear synthesis of prior work, what isnt novel, and highlight novelty gaps.
			- After writing, propose_next_phase back to refine with a brief rationale.
			
			MASTER 1 LOOP EXIT RULE
			- Only suggest moving to implementation_plan after:
			  • papers.txt is populated with 5–8 high-quality entries, AND  
			  • review.md contains a meaningful novelty discussion.
			- When ready to leave Master 1, call propose_next_phase { phase: "implementation_plan", rationale }.  
			- The system will ask the user for approval before advancing.
			
			------------------------------
			MASTER 2 — implementation_plan ↔ implement
			------------------------------
			implementation_plan phase:
			- Write/refresh 'Design/design_plan.md' (replace preferred).
			- Include:
			  • dataset  
			  • preprocessing  
			  • model architecture  
			  • training setup  
			  • metrics + baselines  
			  • evaluation plan  
			  • risks/mitigations  
			  • next-step checklist  
			- When plan is concrete, propose_next_phase { phase: "implement", rationale }.
			
			implementation phase:
			- Write/refresh 'Experimentation/experiment.py' using replace.
			- The script must be:
			  • self-contained  
			  • runnable  
			  • deterministic  
			  • produce prints/logs for progress & metrics  
			- Use append only when adding small helper functions or minor updates.
			
			MASTER 2 LOOP EXIT RULE
			- After 3 iterations inside Master 2, summarize progress and call ask_user:
			  “Would you like me to continue improving here or move on?”
			- Only suggest moving to await_experiment when BOTH:
			  • design_plan.md exists and is complete  
			  • experiment.py exists and appears runnable
			- When ready, call propose_next_phase { phase: "await_experiment", rationale }.  
			  The system will ask the user for approval.
			
			FINAL NOTES
			- Stream brief reasoning before tool calls if helpful.
			- Stay focused on progress; avoid unnecessary verbosity.
			`
		messages.push({ role: 'system', content: systemPrompt });

		// Provide small file excerpts as system context for Master 1
		if (isMaster1Phase) {
			const ctxTargets = ['Lit Review/papers.txt', 'Lit Review/review.md'] as const;
			const excerpt = (s: string, max = 2000) => {
				if (!s) return '';
				if (s.length <= max) return s;
				const half = Math.floor(max / 2);
				return s.slice(0, half) + '\n...\n' + s.slice(-half);
			};
			for (const path of ctxTargets) {
				const rows = await db.select().from(files).where(and(eq(files.projectId, projectId), eq(files.path, path)));
				const content = rows[0]?.content ?? '';
				if (content && content.trim().length > 0) {
					messages.push({
						role: 'system',
						content: `Context: ${path}\n---\n${excerpt(content)}\n---`,
					});
				}
			}
		}

		// Provide small file excerpts as system context for Master 2
		if (isMaster2Phase) {
			const ctxTargets = ['Design/design_plan.md', 'Experimentation/experiment.py'] as const;
			const excerpt = (s: string, max = 2000) => {
				if (!s) return '';
				if (s.length <= max) return s;
				const half = Math.floor(max / 2);
				return s.slice(0, half) + '\n...\n' + s.slice(-half);
			};
			for (const path of ctxTargets) {
				const rows = await db.select().from(files).where(and(eq(files.projectId, projectId), eq(files.path, path)));
				const content = rows[0]?.content ?? '';
				if (content && content.trim().length > 0) {
					messages.push({
						role: 'system',
						content: `Context: ${path}\n---\n${excerpt(content)}\n---`,
					});
				}
			}
		}

		// Append prior turns (user/assistant) as provided by the frontend, in order
		for (const h of history) {
			const role = h?.role === 'assistant' ? 'assistant' : h?.role === 'user' ? 'user' : null;
			const text = typeof h?.text === 'string' ? h.text : '';
			if (!role || !text) continue;
			messages.push({ role, content: text });
		}

		if (inputMessage) {
			messages.push({ role: 'user', content: inputMessage });
		}

		const tools = [
			{
				type: 'function',
				function: {
					name: 'ask_user',
					description: 'Ask concise, targeted questions to the user. Use when you need more info.',
					parameters: {
						type: 'object',
						properties: {
							questions: { type: 'array', items: { type: 'string' } },
						},
						required: ['questions'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'propose_next_phase',
					description:
						'Propose moving to another phase with a brief rationale. The server decides whether to accept based on soft-loop rules.',
					parameters: {
						type: 'object',
						properties: {
							phase: {
								type: 'string',
								enum: [
									'refine',
									'check_novelty',
									'implementation_plan',
									'implement',
									'await_experiment',
									'finalize_paper',
								],
							},
							rationale: { type: 'string' },
							confidence: { type: 'number' },
						},
						required: ['phase', 'rationale'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'write_file',
					description:
						'Create or update a text file. For long documents provide complete content; for small additions use append.',
					parameters: {
						type: 'object',
						properties: {
							path: { type: 'string' },
							op: { type: 'string', enum: ['append', 'replace'] },
							content: { type: 'string' },
						},
						required: ['path', 'op', 'content'],
					},
				},
			},
		] as const;

		const client = getOpenAI();

		// Stream assistant text and capture tool calls
		type ToolCallAccum = { name?: string; args: string };
		const toolCalls: Record<number, ToolCallAccum> = {};

		const stream = await client.chat.completions.create({
			model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
			messages,
			tools: tools as any,
			tool_choice: 'auto',
			stream: true,
		});

		let finishedWithToolCalls = false;

		for await (const chunk of stream) {
			const choice = chunk.choices?.[0];
			if (!choice) continue;

			// Stream assistant content
			const deltaText = choice.delta?.content;
			if (typeof deltaText === 'string' && deltaText.length > 0) {
				sse.write({ type: 'delta', text: deltaText });
			}

			// Accumulate tool calls
			const tc = choice.delta?.tool_calls;
			if (tc && Array.isArray(tc)) {
				for (const t of tc) {
					const idx = t.index ?? 0;
					if (!toolCalls[idx]) toolCalls[idx] = { args: '' };
					if (t.function?.name) toolCalls[idx].name = t.function.name;
					if (t.function?.arguments) toolCalls[idx].args += t.function.arguments;
				}
			}

			// Check finish reason
			if (choice.finish_reason === 'tool_calls') {
				finishedWithToolCalls = true;
			}
		}

		// Handle the first completed tool call if present
		if (finishedWithToolCalls) {
			const firstIdx = Object.keys(toolCalls)
				.map((k) => parseInt(k, 10))
				.sort((a, b) => a - b)[0];
			if (typeof firstIdx === 'number') {
				const call = toolCalls[firstIdx];
				const name = call?.name;
				let args: any = {};
				try {
					args = call?.args ? JSON.parse(call.args) : {};
				} catch {
					sse.write({ type: 'delta', text: 'Error: Failed to parse tool arguments\n' });
					return sse.close();
				}

				if (name === 'propose_next_phase') {
					const target = String(args?.phase || '').trim();
					const rationale = String(args?.rationale || '').trim();
					if (!target || !rationale) {
						sse.write({ type: 'delta', text: 'Error: propose_next_phase requires phase and rationale\n' });
						return sse.close();
					}
					// Announce proposal (informational)
					sse.write({ type: 'proposed_phase', phase: target, rationale });

					const current = state.phase;
					const targetPhase = target as any;
					// If same phase, no-op
					if (targetPhase === current) {
						return sse.close();
					}

					// Intra-master auto-accept for first 3 loops; otherwise ask user
					if (sameMaster(current as any, targetPhase)) {
						const master = currentMaster(current);
						const loops = master === 'm1' ? state.m1LoopCount : master === 'm2' ? state.m2LoopCount : 0;
						if (loops < 3) {
							await setPhase(projectId, targetPhase);
							sse.write({ type: 'phase', phase: targetPhase });
							return sse.close();
						}
						// Soft-limit: stay put and ask the user
						const prompt =
							`Summary: ${rationale}\n` +
							`Would you like me to continue in ${targetPhase} or move on?`;
					// Remember pending target so a simple "yes/move on" in next user message can be auto-applied
					pendingPhaseByProject.set(projectId, { phase: targetPhase as any, rationale, at: Date.now() });
						sse.write({ type: 'await_user', prompt, choices: ['Continue refining', 'Move on'] });
						return sse.close();
					}

					// Cross-master/backwards: require explicit confirmation
					const prompt = `I suggest moving from ${current} to ${targetPhase} because: ${rationale}\nProceed?`;
				// Remember pending target for next user confirmation
				pendingPhaseByProject.set(projectId, { phase: targetPhase as any, rationale, at: Date.now() });
					sse.write({ type: 'await_user', prompt, choices: ['Yes', 'No'] });
					return sse.close();
				}

				if (name === 'ask_user') {
					const questions = Array.isArray(args?.questions) ? args.questions.filter((q: unknown) => typeof q === 'string' && q.trim().length > 0) : [];
					if (questions.length === 0) {
						sse.write({ type: 'delta', text: 'Error: ask_user requires non-empty questions array\n' });
						return sse.close();
					}
					sse.write({ type: 'await_user', questions });
					return sse.close();
				}

				if (name === 'write_file') {
					const path = String(args?.path || '').trim();
					const op = String(args?.op || '').trim();
					const content = String(args?.content ?? '');
					// Minimal validation
					if (!path || path.includes('..')) {
						sse.write({ type: 'delta', text: 'Error: Invalid path\n' });
						return sse.close();
					}
					if (op !== 'append' && op !== 'replace') {
						sse.write({ type: 'delta', text: 'Error: Invalid op; expected append|replace\n' });
						return sse.close();
					}
					// Infer file type from extension
					let type: 'txt' | 'md' | 'py' | 'tex' = 'txt';
					if (path.endsWith('.md')) type = 'md';
					else if (path.endsWith('.py')) type = 'py';
					else if (path.endsWith('.tex')) type = 'tex';
					else if (path.endsWith('.txt')) type = 'txt';

					// Phase-scoped allowlist enforcement
					const allowed = isAllowedWrite(state.phase as any, path, type);
					if (!allowed.ok) {
						if (isDev) {
							// eslint-disable-next-line no-console
							console.log('[agent.write_file] denied', {
								traceId,
								projectId,
								phase: state.phase,
								path,
								op,
								type,
								reason: allowed.reason,
							});
						}
						sse.write({ type: 'delta', text: `Error: ${allowed.reason}\n` });
						return sse.close();
					}
					if (isDev) {
						// eslint-disable-next-line no-console
						console.log('[agent.write_file] allowed', {
							traceId,
							projectId,
							phase: state.phase,
							path,
							op,
							type,
							contentLen: content.length,
						});
					}

					// If append, fetch existing content to concatenate
					let writeContent = content;
					if (op === 'append') {
						const existing = await db
							.select()
							.from(files)
							.where(and(eq(files.projectId, projectId), eq(files.path, path)));
						const existingContent = existing[0]?.content ?? '';
						writeContent = existingContent + content;
					}

					await upsertTextFile(projectId, path, type, writeContent);

					// Dataset config validation for logs only (MVP)
					if (path === 'Design/dataset.json') {
						const parsed = parseDatasetConfig(writeContent);
						if (isDev) {
							// eslint-disable-next-line no-console
							console.log('[agent.dataset_json] parse', {
								traceId,
								projectId,
								ok: parsed.ok,
								error: parsed.ok ? undefined : parsed.error,
								source: parsed.ok ? parsed.value.source : undefined,
								kaggleDataset: parsed.ok ? parsed.value.kaggle.dataset : undefined,
								subdir: parsed.ok ? parsed.value.layout?.subdir : undefined,
							});
						}
					}

					// Increment loop counter only when meaningful work happens (write_file) within a master
					if (inMaster1(state.phase)) {
						await incrementLoop(projectId, 'm1');
					} else if (inMaster2(state.phase)) {
						await incrementLoop(projectId, 'm2');
					}

					sse.write({ type: 'file_update', path, op, content });
					return sse.close();
				}

				// Unknown tool
				sse.write({ type: 'delta', text: `Error: Unknown tool: ${name}\n` });
				return sse.close();
			}
		}

		// No tools used; finish normally
		// just close stream
	} catch (err: unknown) {
		sse.write({ type: 'delta', text: `Error: ${err instanceof Error ? err.message : 'Failed'}\n` });
	} finally {
		if (isDev) {
			// eslint-disable-next-line no-console
			console.log('[agent.chat] end', { traceId, projectId: String(req.params.projectId) });
		}
		sse.close();
	}
});

agentRouter.post('/:projectId/refine', async (req, res) => {
	const sse = initSse(res);
	try {
		const projectId = String(req.params.projectId);
		sse.write({ type: 'phase', phase: 'refine' });
		sse.write({ type: 'delta', text: 'Analyzing idea...\n' });
		await new Promise((r) => setTimeout(r, 300));
		sse.write({ type: 'delta', text: 'Drafting literature synthesis...\n' });
		const reviewContent = '# Review\n\nThis is a stubbed literature review.\n';
		await upsertTextFile(projectId, 'Lit Review/review.md', 'md', reviewContent);
		sse.write({ type: 'file_update', path: 'Lit Review/review.md', op: 'replace', content: reviewContent });
		const designContent = '# Design Plan\n\nThis is a stubbed design plan.\n';
		await upsertTextFile(projectId, 'Design/design_plan.md', 'md', designContent);
		sse.write({ type: 'file_update', path: 'Design/design_plan.md', op: 'replace', content: designContent });
		sse.write({ type: 'completed' });
	} catch (err: unknown) {
		sse.write({ type: 'error', message: err instanceof Error ? err.message : 'Failed' });
	} finally {
		sse.close();
	}
});

agentRouter.post('/:projectId/literature', async (req, res) => {
	const sse = initSse(res);
	try {
		const projectId = String(req.params.projectId);
		sse.write({ type: 'phase', phase: 'literature' });
		sse.write({ type: 'delta', text: 'Fetching related works...\n' });
		await new Promise((r) => setTimeout(r, 300));
		const papersTxt = '- Paper 1: Example Title\n- Paper 2: Another Title\n';
		await upsertTextFile(projectId, 'Lit Review/papers.txt', 'txt', papersTxt);
		sse.write({ type: 'file_update', path: 'Lit Review/papers.txt', op: 'replace', content: papersTxt });
		sse.write({ type: 'delta', text: 'Summarizing novelty...\n' });
		const reviewMd = '# Review Update\n\nStubbed novelty summary.\n';
		await upsertTextFile(projectId, 'Lit Review/review.md', 'md', reviewMd);
		sse.write({ type: 'file_update', path: 'Lit Review/review.md', op: 'replace', content: reviewMd });
		sse.write({ type: 'completed' });
	} catch (err: unknown) {
		sse.write({ type: 'error', message: err instanceof Error ? err.message : 'Failed' });
	} finally {
		sse.close();
	}
});

agentRouter.post('/:projectId/experiment/generate', async (req, res) => {
	const sse = initSse(res);
	try {
		const projectId = String(req.params.projectId);
		sse.write({ type: 'phase', phase: 'experiment_generate' });
		sse.write({ type: 'delta', text: 'Generating experiment.py...\n' });
		const py = "# experiment.py (stub)\nimport math\n\nprint('hello from experiment')\n";
		await upsertTextFile(projectId, 'Experimentation/experiment.py', 'py', py);
		sse.write({ type: 'file_update', path: 'Experimentation/experiment.py', op: 'replace', content: py });
		sse.write({ type: 'completed' });
	} catch (err: unknown) {
		sse.write({ type: 'error', message: err instanceof Error ? err.message : 'Failed' });
	} finally {
		sse.close();
	}
});

agentRouter.post('/:projectId/paper/generate', async (req, res) => {
	const sse = initSse(res);
	try {
		const projectId = String(req.params.projectId);
		sse.write({ type: 'phase', phase: 'paper_generate' });
		sse.write({ type: 'delta', text: 'Drafting LaTeX...\n' });
		const tex = `\\documentclass{article}\n\\begin{document}\nStubbed paper.\\end{document}\n`;
		await upsertTextFile(projectId, 'Final Paper/paper.tex', 'tex', tex);
		sse.write({ type: 'file_update', path: 'Final Paper/paper.tex', op: 'replace', content: tex });
		sse.write({ type: 'completed' });
	} catch (err: unknown) {
		sse.write({ type: 'error', message: err instanceof Error ? err.message : 'Failed' });
	} finally {
		sse.close();
	}
});


