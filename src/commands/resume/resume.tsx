import { c as _c } from "react-compiler-runtime";
import chalk from 'chalk';
import { randomUUID, type UUID } from 'crypto';
import figures from 'figures';
import * as React from 'react';
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js';
import type { CommandResultDisplay, ResumeEntrypoint } from '../../commands.js';
import { Select, type OptionWithDescription } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { LogSelector } from '../../components/LogSelector.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Spinner } from '../../components/Spinner.js';
import { useIsInsideModal } from '../../context/modalContext.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { setClipboard } from '../../ink/termio/osc.js';
import { Box, Text } from '../../ink.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { LogOption } from '../../types/logs.js';
import { agenticSessionSearch } from '../../utils/agenticSessionSearch.js';
import { checkCrossProjectResume } from '../../utils/crossProjectResume.js';
import { getWorktreePaths } from '../../utils/getWorktreePaths.js';
import { logError } from '../../utils/log.js';
import { getLastSessionLog, getSessionIdFromLog, isCustomTitleEnabled, isLiteLog, loadAllProjectsMessageLogs, loadFullLog, loadSameRepoMessageLogs, searchSessionsByCustomTitle } from '../../utils/sessionStorage.js';
import { validateUuid } from '../../utils/uuid.js';
type ResumeMode = 'full' | 'summary';
type ResumeResult = {
  resultType: 'sessionNotFound';
  arg: string;
} | {
  resultType: 'multipleMatches';
  arg: string;
  count: number;
};
function resumeHelpMessage(result: ResumeResult): string {
  switch (result.resultType) {
    case 'sessionNotFound':
      return `Session ${chalk.bold(result.arg)} was not found.`;
    case 'multipleMatches':
      return `Found ${result.count} sessions matching ${chalk.bold(result.arg)}. Please use /resume to pick a specific session.`;
  }
}
function ResumeError(t0) {
  const $ = _c(10);
  const {
    message,
    args,
    onDone
  } = t0;
  let t1;
  let t2;
  if ($[0] !== onDone) {
    t1 = () => {
      const timer = setTimeout(onDone, 0);
      return () => clearTimeout(timer);
    };
    t2 = [onDone];
    $[0] = onDone;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  React.useEffect(t1, t2);
  let t3;
  if ($[3] !== args) {
    t3 = <Text dimColor={true}>{figures.pointer} /resume {args}</Text>;
    $[3] = args;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== message) {
    t4 = <MessageResponse><Text>{message}</Text></MessageResponse>;
    $[5] = message;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== t3 || $[8] !== t4) {
    t5 = <Box flexDirection="column">{t3}{t4}</Box>;
    $[7] = t3;
    $[8] = t4;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  return t5;
}
function ResumeCommand({
  onDone,
  onResume
}: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  onResume: (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => Promise<void>;
}): React.ReactNode {
  const [logs, setLogs] = React.useState<LogOption[]>([]);
  const [worktreePaths, setWorktreePaths] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [resuming, setResuming] = React.useState(false);
  const [pendingResume, setPendingResume] = React.useState<{
    sessionId: UUID;
    log: LogOption;
    entrypoint: ResumeEntrypoint;
  } | null>(null);
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  const {
    rows
  } = useTerminalSize();
  const insideModal = useIsInsideModal();
  const loadLogs = React.useCallback(async (allProjects: boolean, paths: string[]) => {
    setLoading(true);
    try {
      const allLogs = allProjects ? await loadAllProjectsMessageLogs() : await loadSameRepoMessageLogs(paths);
      const resumable = filterResumableSessions(allLogs, getSessionId());
      if (resumable.length === 0) {
        onDone('No conversations found to resume');
        return;
      }
      setLogs(resumable);
    } catch (_err) {
      onDone('Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, [onDone]);
  React.useEffect(() => {
    async function init() {
      const paths_0 = await getWorktreePaths(getOriginalCwd());
      setWorktreePaths(paths_0);
      void loadLogs(false, paths_0);
    }
    void init();
  }, [loadLogs]);
  const handleToggleAllProjects = React.useCallback(() => {
    const newValue = !showAllProjects;
    setShowAllProjects(newValue);
    void loadLogs(newValue, worktreePaths);
  }, [showAllProjects, loadLogs, worktreePaths]);
  function startResume(sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) {
    setPendingResume({
      sessionId,
      log,
      entrypoint
    });
  }
  function handleResumeMode(mode: ResumeMode) {
    if (!pendingResume) return;
    const {
      sessionId,
      log,
      entrypoint
    } = pendingResume;
    setPendingResume(null);
    setResuming(true);
    const selectedLog = mode === 'summary' ? buildSummaryResumeLog(log) : log;
    void onResume(sessionId, selectedLog, entrypoint);
  }
  async function handleSelect(log: LogOption) {
    const sessionId = validateUuid(getSessionIdFromLog(log));
    if (!sessionId) {
      onDone('Failed to resume conversation');
      return;
    }

    // Load full messages for lite logs
    const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;

    // Check if this conversation is from a different directory
    const crossProjectCheck = checkCrossProjectResume(fullLog, showAllProjects, worktreePaths);
    if (crossProjectCheck.isCrossProject) {
      if (crossProjectCheck.isSameRepoWorktree) {
        // Same repo worktree - can resume directly
        startResume(sessionId, fullLog, 'slash_command_picker');
        return;
      }

      // Different project - show command instead of resuming
      const raw = await setClipboard(crossProjectCheck.command);
      if (raw) process.stdout.write(raw);

      // Format the output message
      const message = ['', 'This conversation is from a different directory.', '', 'To resume, run:', `  ${crossProjectCheck.command}`, '', '(Command copied to clipboard)', ''].join('\n');
      onDone(message, {
        display: 'user'
      });
      return;
    }

    // Same directory - proceed with resume
    startResume(sessionId, fullLog, 'slash_command_picker');
  }
  function handleCancel() {
    onDone('Resume cancelled', {
      display: 'system'
    });
  }
  if (loading) {
    return <Box>
        <Spinner />
        <Text> Loading conversations…</Text>
      </Box>;
  }
  if (resuming) {
    return <Box>
        <Spinner />
        <Text> Resuming conversation…</Text>
      </Box>;
  }
  if (pendingResume) {
    return <ResumeModePicker log={pendingResume.log} onChoose={handleResumeMode} onCancel={() => setPendingResume(null)} />;
  }
  return <LogSelector logs={logs} maxHeight={insideModal ? Math.floor(rows / 2) : rows - 2} onCancel={handleCancel} onSelect={handleSelect} onLogsChanged={() => loadLogs(showAllProjects, worktreePaths)} showAllProjects={showAllProjects} onToggleAllProjects={handleToggleAllProjects} onAgenticSearch={agenticSessionSearch} />;
}
export function filterResumableSessions(logs: LogOption[], currentSessionId: string): LogOption[] {
  return logs.filter(l => !l.isSidechain && getSessionIdFromLog(l) !== currentSessionId);
}
function ResumeModePicker({
  log,
  onChoose,
  onCancel
}: {
  log: LogOption;
  onChoose: (mode: ResumeMode) => void;
  onCancel: () => void;
}): React.ReactNode {
  const options: OptionWithDescription<ResumeMode>[] = [{
    label: 'Resume full',
    value: 'full',
    description: `${log.messageCount} messages; keeps the full transcript in context`
  }, {
    label: 'Resume from summary',
    value: 'summary',
    description: 'Builds a thorough compact handoff from the entire transcript'
  }];
  return <Dialog title="Resume mode" subtitle={getResumeTitle(log)} onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        <Text>Choose how much context to load.</Text>
        <Select options={options} defaultFocusValue="summary" visibleOptionCount={options.length} onChange={onChoose} onCancel={onCancel} />
      </Box>
    </Dialog>;
}
function getResumeTitle(log: LogOption): string {
  return log.customTitle || log.summary || log.firstPrompt || getSessionIdFromLog(log) || 'Selected session';
}
function buildSummaryResumeLog(log: LogOption): LogOption {
  const summary = buildThoroughResumeSummary(log);
  const first = log.messages[0];
  const timestamp = new Date().toISOString();
  const message = {
    type: 'user',
    message: {
      role: 'user',
      content: summary
    },
    isCompactSummary: true,
    summarizeMetadata: {
      messagesSummarized: log.messages.length
    },
    uuid: randomUUID(),
    parentUuid: null,
    isSidechain: false,
    cwd: log.projectPath || first?.cwd || getOriginalCwd(),
    sessionId: getSessionIdFromLog(log),
    timestamp,
    version: first?.version || '0.0.0',
    userType: first?.userType || 'external',
    entrypoint: 'resume-summary'
  };
  return {
    ...log,
    messages: [message as LogOption['messages'][number]],
    firstPrompt: summary.slice(0, 200),
    messageCount: 1,
    summary
  };
}
const MAX_RESUME_SUMMARY_CHARS = 3_500_000;
const PER_MESSAGE_SUMMARY_CHARS = 900;
function buildThoroughResumeSummary(log: LogOption): string {
  const sessionId = getSessionIdFromLog(log) || 'unknown';
  const counts = new Map<string, number>();
  const toolNames = new Map<string, number>();
  const filePaths = new Set<string>();
  const userRequests: string[] = [];
  const decisions: string[] = [];
  const timelineEntries: string[] = [];
  for (const [index, message] of log.messages.entries()) {
    const type = String(message.type || 'unknown');
    counts.set(type, (counts.get(type) || 0) + 1);
    const text = extractMessageText(message);
    for (const tool of extractToolNames(message)) {
      toolNames.set(tool, (toolNames.get(tool) || 0) + 1);
    }
    for (const file of extractFilePaths(text)) {
      if (filePaths.size < 300) filePaths.add(file);
    }
    if (type === 'user' && text) {
      userRequests.push(text);
    }
    if (looksLikeDecision(text)) {
      decisions.push(text);
    }
    if (text) {
      timelineEntries.push(`${index + 1}. ${type.toUpperCase()} ${message.timestamp || ''}\n${truncateText(text, PER_MESSAGE_SUMMARY_CHARS)}`);
    }
  }
  const timeline = selectTimelineDigest(timelineEntries);
  const truncated = timeline.length < timelineEntries.length;
  const recentUserRequests = userRequests.slice(-25).map((text, i) => `${i + 1}. ${truncateText(text, 1200)}`);
  const importantDecisions = decisions.slice(-80).map((text, i) => `${i + 1}. ${truncateText(text, 1000)}`);
  const toolSummary = [...toolNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([name, count]) => `- ${name}: ${count}`).join('\n') || '- None detected';
  const fileSummary = [...filePaths].slice(0, 300).map(path => `- ${path}`).join('\n') || '- None detected';
  const typeSummary = [...counts.entries()].map(([type, count]) => `- ${type}: ${count}`).join('\n');
  const sections = [`# Resumed From Summary\n\nThis is a compact, thorough handoff generated from the complete selected transcript. Use it as the working context for the resumed session. The original transcript remains on disk for details.\n`, `## Session\n- Session ID: ${sessionId}\n- Title: ${getResumeTitle(log)}\n- Project: ${log.projectPath || 'unknown'}\n- Transcript: ${log.fullPath || 'unknown'}\n- Original messages summarized: ${log.messages.length}\n- Message type counts:\n${typeSummary}\n`, `## Recent User Requests\n${recentUserRequests.join('\n\n') || 'None detected'}\n`, `## Decisions, Outcomes, and Notable Findings\n${importantDecisions.join('\n\n') || 'None detected'}\n`, `## Tools Observed\n${toolSummary}\n`, `## Files and Paths Mentioned\n${fileSummary}\n`, `## Chronological Transcript Digest\n${timeline.join('\n\n')}`, truncated ? '\n\n## Truncation Notice\nThe summary hit the configured compact handoff budget. It includes the latest and highest-signal extracted context plus the transcript path above for full audit.\n' : ''];
  return sections.join('\n');
}
function selectTimelineDigest(entries: string[]): string[] {
  let total = 0;
  for (const entry of entries) total += entry.length + 2;
  if (total <= MAX_RESUME_SUMMARY_CHARS) return entries;

  const selected: string[] = [];
  const selectedIndexes = new Set<number>();
  let used = 0;
  const add = (index: number) => {
    if (index < 0 || index >= entries.length || selectedIndexes.has(index)) return;
    const entry = entries[index]!;
    if (used + entry.length > MAX_RESUME_SUMMARY_CHARS) return;
    selectedIndexes.add(index);
    used += entry.length + 2;
  };

  // Keep orientation, sample the middle, and heavily preserve recent context.
  const headCount = Math.min(80, entries.length);
  const tailCount = Math.min(1200, entries.length);
  for (let i = 0; i < headCount; i++) add(i);
  for (let i = Math.max(headCount, entries.length - tailCount); i < entries.length; i++) add(i);

  const middleStart = headCount;
  const middleEnd = Math.max(middleStart, entries.length - tailCount);
  const middleCount = middleEnd - middleStart;
  if (middleCount > 0) {
    const sampleCount = Math.min(500, middleCount);
    const step = Math.max(1, Math.floor(middleCount / sampleCount));
    for (let i = middleStart; i < middleEnd; i += step) add(i);
  }

  return [...selectedIndexes].sort((a, b) => a - b).map(index => entries[index]!);
}
function extractMessageText(message: LogOption['messages'][number]): string {
  const parts: string[] = [];
  collectText(message.message?.content, parts);
  collectText(message.content, parts);
  collectText(message.summary, parts);
  collectText(message.toolUseResult, parts);
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function collectText(value: unknown, parts: string[]): void {
  if (!value) return;
  if (typeof value === 'string') {
    parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts);
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') parts.push(record.text);
    if (typeof record.content === 'string') parts.push(record.content);
    else collectText(record.content, parts);
    if (record.type === 'tool_use' && typeof record.name === 'string') {
      parts.push(`[Tool use: ${record.name}] ${safeJson(record.input)}`);
    }
  }
}
function extractToolNames(message: LogOption['messages'][number]): string[] {
  const names: string[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record.type === 'tool_use' && typeof record.name === 'string') names.push(record.name);
      visit(record.content);
    }
  };
  visit(message.message?.content);
  return names;
}
function extractFilePaths(text: string): string[] {
  const matches = text.match(/(?:~|\/Users\/verickwayne|\.{1,2})\/[A-Za-z0-9._~@%+,\-=/]+/g);
  return matches ? [...new Set(matches.map(m => m.replace(/[),.;:]+$/, '')))] : [];
}
function looksLikeDecision(text: string): boolean {
  return /\b(done|fixed|implemented|committed|pushed|deployed|verified|failed|blocked|decided|root cause|issue|error|warning|todo|next|handoff|summary)\b/i.test(text);
}
function truncateText(text: string, max: number): string {
  const normalized = text.replace(/[ \t]+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}\n[truncated ${normalized.length - max} chars]`;
}
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}
export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const onResume = async (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => {
    try {
      await context.resume?.(sessionId, log, entrypoint);
      onDone(undefined, {
        display: 'skip'
      });
    } catch (error) {
      logError(error as Error);
      onDone(`Failed to resume: ${(error as Error).message}`);
    }
  };
  const arg = args?.trim();

  // No argument provided - show picker
  if (!arg) {
    return <ResumeCommand key={Date.now()} onDone={onDone} onResume={onResume} />;
  }

  // Load logs to search (includes same-repo worktrees)
  const worktreePaths = await getWorktreePaths(getOriginalCwd());
  const logs = await loadSameRepoMessageLogs(worktreePaths);
  if (logs.length === 0) {
    const message = 'No conversations found to resume.';
    return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
  }

  // First, check if arg is a valid UUID
  const maybeSessionId = validateUuid(arg);
  if (maybeSessionId) {
    const matchingLogs = logs.filter(l => getSessionIdFromLog(l) === maybeSessionId).sort((a, b) => b.modified.getTime() - a.modified.getTime());
    if (matchingLogs.length > 0) {
      const log = matchingLogs[0]!;
      const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;
      void onResume(maybeSessionId, fullLog, 'slash_command_session_id');
      return null;
    }

    // Enriched logs didn't find it — try direct file lookup. This handles
    // sessions filtered out by enrichLogs (e.g., first message >16KB makes
    // firstPrompt extraction fail, causing the session to be dropped).
    const directLog = await getLastSessionLog(maybeSessionId);
    if (directLog) {
      void onResume(maybeSessionId, directLog, 'slash_command_session_id');
      return null;
    }
  }

  // Next, try exact custom title match (only if feature is enabled)
  if (isCustomTitleEnabled()) {
    const titleMatches = await searchSessionsByCustomTitle(arg, {
      exact: true
    });
    if (titleMatches.length === 1) {
      const log = titleMatches[0]!;
      const sessionId = getSessionIdFromLog(log);
      if (sessionId) {
        const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;
        void onResume(sessionId, fullLog, 'slash_command_title');
        return null;
      }
    }

    // Multiple matches - show error
    if (titleMatches.length > 1) {
      const message = resumeHelpMessage({
        resultType: 'multipleMatches',
        arg,
        count: titleMatches.length
      });
      return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
    }
  }

  // No match found - show error
  const message = resumeHelpMessage({
    resultType: 'sessionNotFound',
    arg
  });
  return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
};
