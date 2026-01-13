import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import dotenv from "dotenv"

dotenv.config();

type SerpParams = {
  query: string;
};

// Core SERP API logic that can be called by both the tool and main function
async function executeSerpQuery(query: string) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Missing SERPAPI_API_KEY in environment variables.",
        },
      ],
    };
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    engine: "google_local",
    google_domain: "google.com",
    q: query,
    device: "mobile",
  });

  const response = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!response.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `SERP API error: ${response.status} ${response.statusText}`,
        },
      ],
    };
  }

  const data = await response.json();
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data),
      },
    ],
  };
}

export const serpTool = tool(
  "serp_tool",
  "Run a SERP API query (default: google_local) and return businesses WITHOUT websites but WITH phone numbers - perfect for lead generation.",
  {
    query: z.string().min(1, "query is required"),
  },
  async (args: SerpParams) => {
    const result = await executeSerpQuery(args.query);
    
    // If there's an error, return it as-is
    if (result.isError) {
      return result;
    }
    
    // Parse and filter the results
    const jsonData = JSON.parse(result.content[0].text);
    const filteredResults = filterAndStructureResults(jsonData);
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            total_filtered_results: filteredResults.length,
            results: filteredResults
          }, null, 2),
        },
      ],
    };
  },
);

// Filter and structure the results
function filterAndStructureResults(data: any) {
  if (!data.local_results || !Array.isArray(data.local_results)) {
    return [];
  }

  return data.local_results
    .filter((result: any) => {
      // Must NOT have a website
      const hasNoWebsite = !result.links?.website;
      // Must HAVE a phone number
      const hasPhone = !!(result.links?.phone || result.phone);
      
      return hasNoWebsite && hasPhone;
    })
    .map((result: any) => ({
      name: result.title || "",
      type: result.type || "",
      description: result.description || "",
      phone: result.links?.phone || result.phone || "",
      address: result.address || "",
    }));
}

// Main driver function for testing
// async function main() {
//   const hardcodedQuery = "perfume stores in dubai";
  
//   console.log(`Running SERP API query: "${hardcodedQuery}"\n`);
  
//   const result = await executeSerpQuery(hardcodedQuery);
  
//   if (result.isError) {
//     console.error("Error occurred:");
//     console.error(result.content[0].text);
//   } else {
//     const jsonData = JSON.parse(result.content[0].text);
//     const filteredResults = filterAndStructureResults(jsonData);
    
//     console.log("Filtered and Structured Results:");
//     console.log("=".repeat(80));
//     console.log(`Total results without website: ${filteredResults.length}`);
//     console.log("=".repeat(80));
//     console.log(JSON.stringify(filteredResults, null, 2));
//   }
// }

// // Run the main function if this file is executed directly
// if (require.main === module) {
//   main().catch(console.error);
// }
// main().catch(console.error);