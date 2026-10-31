// Only new-format leaf validators/read-only Git helpers and the SDK file owner.
// Never import registry, RPC/AgentSession, auth, resource loaders or live discovery.
import { createJiti } from 'jiti';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const jiti = createJiti(import.meta.url, { fsCache: false });
export const metadata = await jiti.import('../../../lib/plugins/review-metadata.ts');
export const data = await jiti.import('../../../plugins/git-workflow/review-data.ts');
export const reader = await jiti.import('../../../plugins/git-workflow/review-reader.ts');
export const { gitText } = await jiti.import('../../../plugins/git-workflow/process.ts');
export const { validateOperationReceipt, collapseOperationReceipts, readOperationReceipt } = await jiti.import('../../../lib/operation-receipts.ts');
export const { readInteractionReceipt } = await jiti.import('../../../lib/interaction-receipts.ts');
export const { validateSavedProjectAcknowledgment } = await jiti.import('../../../lib/plugins/project-acknowledgment.ts');
export const { validateProjectReviewMetadata } = await jiti.import('../../../lib/plugins/project-operation-store.ts');
const sdkDist = dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')));
export const sdk = await import(pathToFileURL(join(sdkDist, 'core/session-manager.js')).href);
export const sdkVersion = JSON.parse(readFileSync(join(sdkDist, '../package.json'), 'utf8')).version;
