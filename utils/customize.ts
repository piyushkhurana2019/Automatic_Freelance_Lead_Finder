import { AzureOpenAI } from 'openai';
import * as dotenv from 'dotenv';
import { extractJsonFromResponse } from './jsonExtractor.ts';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

dotenv.config();

const openaiClient5mini = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY_ALERTS_SWEDEN_CENTRAL,
    endpoint: process.env.AZURE_OPENAI_API_KEY_ALERTS_SWEDEN_CENTRAL_ENDPOINT,
    apiVersion: '2025-03-01-preview',
  });

const gptCall5 = async (
    modelName: string,
    stageName: string,
    prompt: string,
    reasoningEffort: 'minimal' | 'low' | 'medium' | 'high',
    retryCount = 0,
    maxRetries = 3,
  ) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
  
      try {
        console.log('LLM request started')
        console.log(
          [
            '----- GPT PROMPT BEGIN -----',
            `stage=${stageName}`,
            `attempt=${retryCount + 1}/${maxRetries + 1}`,
            `model=${modelName}`,
            `reasoningEffort=${reasoningEffort}`,
            '',
            prompt,
            '----- GPT PROMPT END -----',
          ].join('\n'),
        );
  
        const response = await openaiClient5mini.responses.create({
          model: modelName,
          reasoning: { effort: reasoningEffort },
          text: { verbosity: 'low' },
          input: [{ role: 'user', content: prompt }],
        });
  
        const content = response.output_text?.trim();
        console.log(
          [
            '----- GPT RAW RESPONSE BEGIN -----',
            `stage=${stageName}`,
            `attempt=${retryCount + 1}/${maxRetries + 1}`,
            `model=${modelName}`,
            '',
            content ?? '',
            '----- GPT RAW RESPONSE END -----',
          ].join('\n'),
        );
        if (!content) {
          console.log('No response content from GPT')
          clearTimeout(timeoutId);
          return '';
        }
  
        const extractedResponse = await extractJsonFromResponse(content);
        clearTimeout(timeoutId);
  
        console.log('LLM request completed')
  
        return extractedResponse;
      } catch (error: any) {
        clearTimeout(timeoutId);
        console.error(
          [
            '----- GPT ERROR -----',
            `stage=${stageName}`,
            `attempt=${retryCount + 1}/${maxRetries + 1}`,
            `model=${modelName}`,
            `reasoningEffort=${reasoningEffort}`,
            `message=${String(error?.message ?? error)}`,
          ].join('\n'),
        );
  
        if (retryCount < maxRetries) {
          const delayMs = Math.pow(2, retryCount) * 1000;
  
          console.log('GPT call failed, retrying')
  
          await new Promise((resolve) => setTimeout(resolve, delayMs));
  
          return gptCall5(modelName, stageName, prompt, reasoningEffort, retryCount + 1, maxRetries);
        }
  
        console.log('Max retries reached for GPT call')
  
        return '';
      }
  };

let cachedWebsiteTemplateFilenames: string[] | null = null;
const cachedWebsiteTemplateHtmlByFilename = new Map<string, string>();

/**
 * Returns the filenames inside `data/website_templates/` (e.g. `jewelry_shop_template.html`).
 *
 * Caching logic (simple + in-memory):
 * - On first call, we hit the filesystem (`readdir`) to list the directory.
 * - We store the resulting filename array in `cachedWebsiteTemplateFilenames`.
 * - On subsequent calls *within the same Node process*, we just return the cached array
 *   and skip another filesystem read.
 *
 * This cache does NOT persist across separate CLI runs (each run starts a new Node process).
 * If you add/remove template files and re-run the CLI, it will pick up the new list.
 */
export async function listWebsiteTemplateFilenames(): Promise<string[]> {
  if (cachedWebsiteTemplateFilenames) return cachedWebsiteTemplateFilenames;

  const templatesDirUrl = new URL('../data/website_templates/', import.meta.url);
  const entries = await readdir(templatesDirUrl, { withFileTypes: true });

  cachedWebsiteTemplateFilenames = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b));

  return cachedWebsiteTemplateFilenames;
}

type CurrentPitchListDoc = {
  pitch_list: Array<{
    source_query?: string;
    pitches: Array<{
      name: string;
      description?: string;
      phone?: string;
      address?: string;
      template_name?: string;
      [key: string]: any;
    }>;
    [key: string]: any;
  }>;
  [key: string]: any;
};

/**
 * Reads `data/staging/current_pitch_list.json`, asks GPT to pick the best website template
 * (by filename) for each pitch, then writes the JSON back with `template_name` added.
 */
export async function assignTemplateNamesToCurrentPitchList(options?: {
  modelName?: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}): Promise<CurrentPitchListDoc> {
  // Defaults are intentionally hardcoded for CLI convenience.
  const modelName = options?.modelName ?? 'gpt-5-mini';
  const reasoningEffort = options?.reasoningEffort ?? 'minimal';

  const templateFilenames = await listWebsiteTemplateFilenames();
  if (templateFilenames.length === 0) {
    throw new Error('No templates found in data/website_templates/');
  }
  const fallbackTemplate = templateFilenames[0];
  const templatesDirUrl = new URL('../data/website_templates/', import.meta.url);

  const stagingUrl = new URL('../data/staging/current_pitch_list.json', import.meta.url);
  const raw = await readFile(stagingUrl, 'utf8');
  const doc = JSON.parse(raw) as CurrentPitchListDoc;

  const pitchesForPrompt: Array<{
    pitch_id: string;
    name: string;
    description: string;
  }> = [];

  for (let i = 0; i < (doc.pitch_list?.length ?? 0); i++) {
    const group = doc.pitch_list[i];
    const pitches = group?.pitches ?? [];
    for (let j = 0; j < pitches.length; j++) {
      const p = pitches[j];
      const pitch_id = `${i}:${j}`;
      pitchesForPrompt.push({
        pitch_id,
        name: String(p?.name ?? '').trim(),
        description: String(p?.description ?? '').trim(),
      });
    }
  }

  const validTemplates = new Set(templateFilenames);
  const allPitchIds = pitchesForPrompt.map((p) => p.pitch_id);
  const idToTemplate = new Map<string, string>();

  const mergeAssignmentsIntoMap = (llmResult: any) => {
    const assignmentsRaw: any =
      Array.isArray(llmResult) ? llmResult : (llmResult as any)?.assignments;

    if (!Array.isArray(assignmentsRaw)) return;

    for (const a of assignmentsRaw) {
      const pitch_id = String(a?.pitch_id ?? '').trim();
      const template_name = String(a?.template_name ?? '').trim();
      if (!pitch_id) continue;
      if (!validTemplates.has(template_name)) continue;
      idToTemplate.set(pitch_id, template_name);
    }
  };

  const prompt = [
    'You are assigning a website template filename to each business pitch.',
    '',
    'Rules:',
    `- You MUST choose template_name from this list ONLY: ${JSON.stringify(templateFilenames)}`,
    '- You MUST return exactly one assignment per business pitch_id.',
    '- Return ONLY valid JSON (no markdown, no commentary).',
    '- Output format:',
    '  { "assignments": [ { "pitch_id": "0:0", "template_name": "spice_store_template.html" } ] }',
    '',
    'Businesses (each has pitch_id, name, description):',
    JSON.stringify(pitchesForPrompt, null, 2),
    '',
    'Now produce the JSON assignments.',
  ].join('\n');

  const llmResult = await gptCall5(modelName, 'template-assignment', prompt, reasoningEffort);
  if (!llmResult) {
    throw new Error('GPT returned an empty response while assigning templates.');
  }

  mergeAssignmentsIntoMap(llmResult);

  const missingAfterFirst = allPitchIds.filter((id) => !idToTemplate.has(id));
  if (missingAfterFirst.length > 0) {
    const missingPitches = pitchesForPrompt.filter((p) =>
      missingAfterFirst.includes(p.pitch_id),
    );

    const retryPrompt = [
      'You previously returned incomplete assignments.',
      '',
      'Rules:',
      `- You MUST choose template_name from this list ONLY: ${JSON.stringify(templateFilenames)}`,
      '- You MUST return exactly one assignment for EVERY pitch_id provided below.',
      '- Return ONLY valid JSON (no markdown, no commentary).',
      '- Output format:',
      '  { "assignments": [ { "pitch_id": "0:0", "template_name": "spice_store_template.html" } ] }',
      '',
      'Missing businesses (each has pitch_id, name, description):',
      JSON.stringify(missingPitches, null, 2),
      '',
      'Now produce the JSON assignments.',
    ].join('\n');

    const llmRetry = await gptCall5(
      modelName,
      'template-assignment-retry',
      retryPrompt,
      reasoningEffort,
    );
    if (llmRetry) mergeAssignmentsIntoMap(llmRetry);
  }

  const missingAfterRetry = allPitchIds.filter((id) => !idToTemplate.has(id));
  if (missingAfterRetry.length > 0) {
    throw new Error(
      `GPT did not provide valid template_name for pitch_ids: ${missingAfterRetry.join(', ')}`,
    );
  }

  for (let i = 0; i < (doc.pitch_list?.length ?? 0); i++) {
    const group = doc.pitch_list[i];
    const pitches = group?.pitches ?? [];
    for (let j = 0; j < pitches.length; j++) {
      const pitch_id = `${i}:${j}`;
      const chosen = idToTemplate.get(pitch_id);
      // Per requirement: template_name must come from GPT assignments.
      pitches[j].template_name = chosen!;
    }
  }

  // Step 2: materialize HTML per pitch from its chosen template.
  // - Loads the chosen template file
  // - Replaces {{BUSINESS_NAME}} with the pitch's `name`
  // - Writes into `data/staging/resources/{businessname}/index.html`
  const readTemplateHtml = async (filename: string): Promise<string> => {
    const cached = cachedWebsiteTemplateHtmlByFilename.get(filename);
    if (cached) return cached;

    const templateUrl = new URL(filename, templatesDirUrl);
    const html = await readFile(templateUrl, 'utf8');
    cachedWebsiteTemplateHtmlByFilename.set(filename, html);
    return html;
  };

  const resourcesRootUrl = new URL('../data/staging/resources/', import.meta.url);
  const usedResourceDirs = new Set<string>();

  const toSafeDirName = (name: string) => {
    const cleaned = name
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
    return cleaned || 'business';
  };

  for (let i = 0; i < (doc.pitch_list?.length ?? 0); i++) {
    const group = doc.pitch_list[i];
    const pitches = group?.pitches ?? [];
    for (let j = 0; j < pitches.length; j++) {
      const pitch = pitches[j];
      const templateName = pitch.template_name;
      if (!templateName) {
        throw new Error(`Missing template_name for pitch "${String(pitch?.name ?? '')}"`);
      }

      // Ensure we do not keep HTML in JSON (if it exists from a previous run).
      if ('html' in pitch) delete (pitch as any).html;

      const rawTemplate = await readTemplateHtml(templateName);
      const businessName = String(pitch.name ?? '').trim();
      const rendered = rawTemplate.replaceAll('{{BUSINESS_NAME}}', businessName);

      // Folder = data/staging/resources/{businessname}/index.html
      let dirName = toSafeDirName(businessName);
      if (usedResourceDirs.has(dirName)) {
        dirName = `${dirName}_${i}_${j}`;
      }
      usedResourceDirs.add(dirName);

      const businessDirUrl = new URL(`${dirName}/`, resourcesRootUrl);
      await mkdir(businessDirUrl, { recursive: true });
      const indexUrl = new URL('index.html', businessDirUrl);
      await writeFile(indexUrl, rendered, 'utf8');
    }
  }

  await writeFile(stagingUrl, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return doc;
}

// CLI entrypoint:
// Run:
//   node --experimental-strip-types utils/customize.ts
// This will update `data/staging/current_pitch_list.json` in-place by adding `template_name`.
const isMain =
  !!process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  assignTemplateNamesToCurrentPitchList()
    .then(async (doc) => {
      const total = doc.pitch_list?.reduce((acc, g) => acc + (g.pitches?.length ?? 0), 0) ?? 0;
      console.log(`Done. Updated template_name and wrote index.html for ${total} pitches.`);
    })
    .catch((err) => {
      console.error('Failed to assign template names:', err);
      process.exitCode = 1;
    });
}

