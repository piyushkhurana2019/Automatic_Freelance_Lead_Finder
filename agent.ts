import "dotenv/config";
import { readFile } from "fs/promises";
import { createSdkMcpServer, query, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { serpTool } from "./tools/serp_tool.js";

function configureAnthropicFromEnv(): boolean {
  const foundryKey = process.env.ANTHROPIC_FOUNDRY_API_KEY;
  const foundryResource = process.env.ANTHROPIC_FOUNDRY_RESOURCE;
  const foundryBaseUrl = process.env.ANTHROPIC_FOUNDRY_BASE_URL;

  if (foundryKey && (foundryResource || foundryBaseUrl)) {
    process.env.CLAUDE_CODE_USE_FOUNDRY ??= "1";
    return true;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return true;
  }

  const azureKey = process.env.AZURE_ANTHROPIC_API_KEY;
  if (azureKey) {
    process.env.CLAUDE_CODE_USE_FOUNDRY ??= "1";
    process.env.ANTHROPIC_FOUNDRY_API_KEY ??= azureKey;

    if (process.env.AZURE_ANTHROPIC_RESOURCE) {
      process.env.ANTHROPIC_FOUNDRY_RESOURCE ??=
        process.env.AZURE_ANTHROPIC_RESOURCE;
    }

    if (process.env.AZURE_ANTHROPIC_BASE_URL || process.env.AZURE_ANTHROPIC_ENDPOINT) {
      process.env.ANTHROPIC_FOUNDRY_BASE_URL ??=
        process.env.AZURE_ANTHROPIC_BASE_URL ??
        process.env.AZURE_ANTHROPIC_ENDPOINT;
    }

    return true;
  }

  return false;
}

if (!configureAnthropicFromEnv()) {
  console.error("\nError: missing Anthropic credentials.");
  console.error("Set ANTHROPIC_API_KEY for direct Anthropic, or");
  console.error("ANTHROPIC_FOUNDRY_API_KEY + ANTHROPIC_FOUNDRY_RESOURCE/BASE_URL for Azure Foundry.");
  console.error("You can also set AZURE_ANTHROPIC_API_KEY (+ AZURE_ANTHROPIC_* vars) for fallback.\n");
  process.exit(1);
}

const PROMPTS_DIR = new URL("./prompts/", import.meta.url);

async function loadPrompt(filename: string): Promise<string> {
  const promptUrl = new URL(filename, PROMPTS_DIR);
  const content = await readFile(promptUrl, "utf8");
  return content.trim();
}

const serpMcpServer = createSdkMcpServer({
  name: "serp-tools",
  tools: [serpTool],
});

const supervisorPrompt = await loadPrompt("supervisor.txt");
const leadFinderPrompt = await loadPrompt("lead_finder.txt");

const agents: Record<string, AgentDefinition> = {
  "lead-finder": {
    description: "Finds new lead candidates from local search results and writes them to staging.",
    tools: ["Glob", "Read", "Write", "mcp__serp-tools__serp_tool"],
    prompt: leadFinderPrompt,
    model: "inherit",
  },
};

const userPrompt =
  process.argv.slice(2).join(" ").trim() ||
  "Find at least 20 new lead candidates and update data/staging/current_pitch_list.json.";

// Agentic loop: streams messages as Claude works
for await (const message of query({
  prompt: userPrompt,
  options: {
    allowedTools: ["Task", "Glob", "Read", "Write", "mcp__serp-tools__serp_tool"],
    permissionMode: "acceptEdits",
    systemPrompt: supervisorPrompt,
    mcpServers: {
      "serp-tools": serpMcpServer,
    },
    agents,
  },
})) {
  if (message.type === "assistant" && message.message?.content) {
    for (const block of message.message.content) {
      if ("text" in block) {
        console.log(block.text);
      } else if ("name" in block) {
        console.log(`Tool: ${block.name}`);
      }
    }
  } else if (message.type === "result") {
    console.log(`Done: ${message.subtype}`);
  }
}
