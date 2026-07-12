import type {
  HeteroSessionDigest,
  HeteroSessionImportImage,
  HeteroSessionImportMessage,
  HeteroSessionImportPayload,
} from '@lobechat/types';

import {
  IMPORTED_IMAGE_PLACEHOLDER,
  parseJsonlRecords,
  stripNulDeep,
  toModelUsageFromCodex,
  transcriptEndAt,
  truncateTitle,
} from './utils';

/** rollout records the endAt fingerprint is taken from */
const isResponseItem = (r: any) => r.type === 'response_item';

/**
 * Parser for Codex CLI local rollout transcripts
 * (`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`).
 *
 * Format notes (verified against real rollouts):
 * - linear record stream, no parent tree / sidechains
 * - `session_meta` carries id / cwd / cli_version / git info
 * - `turn_context` carries the model per turn
 * - `response_item` payloads: `message` (roles developer/user/assistant),
 *   `reasoning` (summary often empty + encrypted content), `function_call`
 *   {name, call_id, arguments}, `function_call_output` {call_id, output},
 *   plus tool_search / web_search / custom tool variants
 * - `event_msg` `token_count` carries per-turn usage in `info.last_token_usage`
 * - the first user messages are scaffolding (`# AGENTS.md instructions`,
 *   `<user_instructions>`, `<environment_context>`) and are skipped
 */

export const CODEX_IDENTIFIER = 'codex';

const SCAFFOLD_PREFIXES = [
  '# AGENTS.md instructions',
  '<user_instructions>',
  '<environment_context>',
  '<ENVIRONMENT_CONTEXT>',
];

const isScaffoldText = (text: string) =>
  SCAFFOLD_PREFIXES.some((prefix) => text.trimStart().startsWith(prefix));

/** `data:image/png;base64,<payload>` — Codex inlines images as data URLs */
const DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/s;

interface CodexContentParts {
  /** embedded images, in the order their placeholders appear in `text` */
  images: HeteroSessionImportImage[];
  text: string;
}

/**
 * Flatten a Codex content value into text, leaving a placeholder in place of
 * every embedded image and returning the images alongside — see the Claude Code
 * parser's `partsOfContent` for why the base64 is carried out separately.
 * A non-base64 `image_url` (a remote link) has nothing to upload: it stays a
 * plain markdown image.
 */
const partsOfCodexContent = (content: any): CodexContentParts => {
  if (typeof content === 'string') return { images: [], text: content };
  if (!Array.isArray(content)) return { images: [], text: '' };

  const images: HeteroSessionImportImage[] = [];
  const text = content
    .map((block: any) => {
      if (block?.type === 'input_text' || block?.type === 'output_text') return block.text;
      if (block?.type === 'input_image') {
        const match = DATA_URL_RE.exec(block.image_url ?? '');
        if (!match) return block.image_url ? `![image](${block.image_url})` : '';
        images.push({ data: match[2], mediaType: match[1] });
        return IMPORTED_IMAGE_PLACEHOLDER;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

  return { images, text };
};

const textOfCodexContent = (content: any): string => partsOfCodexContent(content).text;

/** normalize the various tool-call payload flavors into {name, callId, arguments} */
const asToolCall = (payload: any): { args: string; callId: string; name: string } | null => {
  const callId = payload.call_id ?? payload.id;
  if (!callId) return null;
  if (payload.type === 'function_call' || payload.type === 'custom_tool_call')
    return {
      args:
        typeof payload.arguments === 'string'
          ? payload.arguments
          : JSON.stringify(payload.arguments ?? payload.input ?? {}),
      callId,
      name: payload.name ?? payload.type,
    };
  if (payload.type === 'local_shell_call')
    return { args: JSON.stringify(payload.action ?? {}), callId, name: 'local_shell' };
  if (payload.type === 'tool_search_call' || payload.type === 'web_search_call')
    return {
      args: JSON.stringify(payload.action ?? payload.query ?? {}),
      callId,
      name: payload.type.replace('_call', ''),
    };
  return null;
};

const isToolOutput = (payload: any): boolean =>
  typeof payload?.type === 'string' && payload.type.endsWith('_output') && Boolean(payload.call_id);

const textOfToolOutput = (payload: any): string => {
  const output = payload.output;
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object')
    return typeof output.content === 'string' ? output.content : JSON.stringify(output);
  if (typeof payload.result === 'string') return payload.result;
  return '';
};

export interface ParsedCodexSession {
  gitBranch?: string;
  messages: HeteroSessionImportMessage[];
  sessionId: string;
  /** last raw record timestamp — compared with a fresh digest's `endAt` */
  sourceEndAt?: string;
  title?: string;
  workingDirectory?: string;
}

/**
 * Parse a Codex rollout into normalized import messages.
 * Returns null when the rollout contains no importable conversation.
 */
export const parseCodexSession = (content: string): ParsedCodexSession | null => {
  const records = parseJsonlRecords(content);
  if (records.length === 0) return null;

  const meta = records.find((r) => r.type === 'session_meta')?.payload;
  const sessionId: string | undefined = meta?.id;
  if (!sessionId) return null;

  const messages: HeteroSessionImportMessage[] = [];
  const clientIdOf = (key: string) => `codex-${sessionId}-${key}`;
  // call_id -> the assistant message that carried the call (for tool results)
  const callIndex = new Map<string, { apiName: string; args: string; clientId: string }>();

  let prevClientId: string | null = null;
  let pendingReasoning: string[] = [];
  let model: string | undefined = meta?.model;
  let title: string | undefined;
  let lastAssistant: HeteroSessionImportMessage | null = null;
  let itemIndex = -1;

  for (const record of records) {
    if (record.type === 'turn_context') {
      model = record.payload?.model ?? model;
      continue;
    }

    if (record.type === 'event_msg') {
      // per-turn usage lands on the latest assistant message
      const usage =
        record.payload?.type === 'token_count' &&
        toModelUsageFromCodex(record.payload?.info?.last_token_usage);
      if (usage && lastAssistant) lastAssistant.usage = usage;
      continue;
    }

    if (record.type !== 'response_item') continue;
    itemIndex++;
    const payload = record.payload;
    if (!payload?.type) continue;

    if (payload.type === 'reasoning') {
      const parts: string[] = [];
      for (const s of payload.summary ?? []) if (s?.text?.trim()) parts.push(s.text);
      for (const c of payload.content ?? []) if (c?.text?.trim()) parts.push(c.text);
      if (parts.length > 0) pendingReasoning.push(...parts);
      continue;
    }

    if (payload.type === 'message') {
      const { images, text } = partsOfCodexContent(payload.content);
      if (payload.role === 'user') {
        if (!text || isScaffoldText(text)) continue;
        title ??= truncateTitle(text);
        const clientId = clientIdOf(`i${itemIndex}`);
        messages.push({
          clientId,
          content: text,
          createdAt: record.timestamp,
          metadata: { heteroSessionId: sessionId },
          parentClientId: prevClientId,
          role: 'user',
          ...(images.length > 0 ? { images } : {}),
        });
        prevClientId = clientId;
        pendingReasoning = [];
      } else if (payload.role === 'assistant') {
        const clientId = clientIdOf(`i${itemIndex}`);
        const message: HeteroSessionImportMessage = {
          clientId,
          content: text,
          createdAt: record.timestamp,
          metadata: { heteroSessionId: sessionId },
          model,
          parentClientId: prevClientId,
          provider: CODEX_IDENTIFIER,
          role: 'assistant',
          ...(pendingReasoning.length > 0
            ? { reasoning: { content: pendingReasoning.join('\n\n') } }
            : {}),
        };
        messages.push(message);
        prevClientId = clientId;
        lastAssistant = message;
        pendingReasoning = [];
      }
      // developer / system messages are instructions scaffolding — skipped
      continue;
    }

    const toolCall = asToolCall(payload);
    if (toolCall) {
      const clientId = clientIdOf(`call-${toolCall.callId}`);
      const message: HeteroSessionImportMessage = {
        clientId,
        content: '',
        createdAt: record.timestamp,
        // codex `message` items carry no native id in rollouts; only call
        // items do (`fc_...` / `ctc_...`) — stamp it where it exists
        metadata: {
          ...(payload.id ? { heteroMessageId: payload.id } : {}),
          heteroSessionId: sessionId,
        },
        model,
        parentClientId: prevClientId,
        provider: CODEX_IDENTIFIER,
        role: 'assistant',
        tools: [
          {
            apiName: toolCall.name,
            arguments: toolCall.args,
            id: toolCall.callId,
            identifier: CODEX_IDENTIFIER,
            type: 'default',
          },
        ],
        ...(pendingReasoning.length > 0
          ? { reasoning: { content: pendingReasoning.join('\n\n') } }
          : {}),
      };
      messages.push(message);
      callIndex.set(toolCall.callId, {
        apiName: toolCall.name,
        args: toolCall.args,
        clientId,
      });
      prevClientId = clientId;
      lastAssistant = message;
      pendingReasoning = [];
      continue;
    }

    if (isToolOutput(payload)) {
      const call = callIndex.get(payload.call_id);
      if (!call) continue;
      const clientId = clientIdOf(`result-${payload.call_id}`);
      messages.push({
        clientId,
        content: textOfToolOutput(payload),
        createdAt: record.timestamp,
        metadata: { heteroSessionId: sessionId },
        parentClientId: call.clientId,
        plugin: {
          apiName: call.apiName,
          arguments: call.args,
          identifier: CODEX_IDENTIFIER,
          type: 'default',
        },
        role: 'tool',
        toolCallId: payload.call_id,
      });
      prevClientId = clientId;
    }
  }

  if (messages.length === 0) return null;

  return {
    gitBranch: meta?.git?.branch,
    messages: stripNulDeep(messages),
    sessionId,
    sourceEndAt: transcriptEndAt(records, isResponseItem),
    title,
    workingDirectory: meta?.cwd,
  };
};

/**
 * Build the full normalized import payload for a Codex session.
 */
export const buildCodexImportPayload = (content: string): HeteroSessionImportPayload | null => {
  const parsed = parseCodexSession(content);
  if (!parsed) return null;

  return {
    messages: parsed.messages,
    metadata: {
      heteroSessionId: parsed.sessionId,
      ...(parsed.workingDirectory
        ? { heteroSessionIdByWorkingDirectory: { [parsed.workingDirectory]: parsed.sessionId } }
        : {}),
      importedFrom: 'codex-local',
    },
    sessionId: parsed.sessionId,
    source: 'codex',
    sourceEndAt: parsed.sourceEndAt,
    title: parsed.title,
    topicClientId: `codex-session-${parsed.sessionId}`,
    workingDirectory: parsed.workingDirectory,
  };
};

/**
 * Lightweight digest for the import-picker list.
 */
export const parseCodexSessionDigest = (
  content: string,
  filePath: string,
): HeteroSessionDigest | null => {
  const records = parseJsonlRecords(content);
  if (records.length === 0) return null;

  const meta = records.find((r) => r.type === 'session_meta')?.payload;
  if (!meta?.id) return null;

  const items = records.filter((r) => r.type === 'response_item');
  const userTexts = items
    .filter((r) => r.payload?.type === 'message' && r.payload.role === 'user')
    .map((r) => textOfCodexContent(r.payload.content))
    .filter((t) => t && !isScaffoldText(t));
  if (userTexts.length === 0) return null;

  const conversational = items.filter(
    (r) =>
      r.payload?.type === 'message' &&
      (r.payload.role === 'assistant' || r.payload.role === 'user'),
  );

  // fresh input (minus cache reads) + output, accumulated across turns
  let tokens = 0;
  for (const r of records) {
    const usage =
      r.type === 'event_msg' &&
      r.payload?.type === 'token_count' &&
      r.payload?.info?.last_token_usage;
    if (usage)
      tokens +=
        (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0) + (usage.output_tokens ?? 0);
  }

  return {
    endAt: transcriptEndAt(records, isResponseItem),
    filePath,
    firstPrompt: truncateTitle(userTexts[0], 200),
    gitBranch: meta.git?.branch,
    messageCount: conversational.length,
    sessionId: meta.id,
    source: 'codex',
    startAt: items[0]?.timestamp,
    title: truncateTitle(userTexts[0]),
    tokens,
    workingDirectory: meta.cwd,
  };
};
