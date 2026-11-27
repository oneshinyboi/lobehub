import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ENABLE_TOPIC_LINK_SHARE } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

/**
 * Every surface that offers a Topic link has to read the same switch. The flag
 * is intentionally independent of `ENABLE_BUSINESS_FEATURES`, which also gates
 * payments-adjacent surfaces — a site that reads the business flag (or
 * hardcodes its own value) silently hides sharing from self-hosted users.
 */
const CONSUMERS = [
  'src/routes/(main)/agent/features/Conversation/Header/ShareButton/index.tsx',
  'src/routes/(main)/group/features/Conversation/Header/ShareButton/index.tsx',
  'src/routes/(main)/agent/features/Conversation/Header/HeaderActions/index.tsx',
  'src/features/AgentTasks/AgentTaskDetail/TopicChatDrawer/index.tsx',
] as const;

const HARDCODED_FLAG = /const\s+enableTopicLinkShare\s*=\s*true\b/;
const READS_BUSINESS_FLAG = /\benableBusinessFeatures\b/;

const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

const collectSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [fullPath];
  });

describe('ENABLE_TOPIC_LINK_SHARE', () => {
  it('is enabled for this distribution', () => {
    expect(ENABLE_TOPIC_LINK_SHARE).toBe(true);
  });

  it.each(CONSUMERS)('%s reads the shared constant', (relativePath) => {
    const source = read(relativePath);

    expect(source).toContain("from '@lobechat/business-const'");
    expect(source).toMatch(
      /import\s*\{[^}]*\bENABLE_TOPIC_LINK_SHARE\b[^}]*\}\s*from\s*'@lobechat\/business-const'/,
    );
    expect(source).toMatch(/const\s+enableTopicLinkShare\s*=\s*ENABLE_TOPIC_LINK_SHARE\b/);
  });

  it.each(CONSUMERS)('%s has no local literal or business-flag fallback', (relativePath) => {
    const source = read(relativePath);

    expect(source).not.toMatch(HARDCODED_FLAG);
    expect(source).not.toMatch(READS_BUSINESS_FLAG);
  });

  it('leaves no hardcoded true anywhere in the app source', () => {
    const offenders = collectSourceFiles(path.join(repoRoot, 'src')).filter((file) =>
      HARDCODED_FLAG.test(readFileSync(file, 'utf8')),
    );

    expect(offenders.map((file) => path.relative(repoRoot, file))).toEqual([]);
  });
});
