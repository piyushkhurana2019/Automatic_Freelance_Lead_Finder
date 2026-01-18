import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

type UnsplashParams = {
  query: string;
  per_page?: number;
  orientation?: "landscape" | "portrait" | "squarish";
  color?: "black_and_white" | "black" | "white" | "yellow" | "orange" | "red" | "purple" | "magenta" | "green" | "teal" | "blue";
};

// Core Unsplash API logic
async function executeUnsplashQuery(params: UnsplashParams) {
  const apiKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!apiKey) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Missing UNSPLASH_ACCESS_KEY in environment variables.",
        },
      ],
    };
  }

  const searchParams = new URLSearchParams({
    query: params.query,
    page: "1",
    per_page: (2).toString(),
    order_by: "relevant",
    content_filter: "high", // High safety filter for business use
  });

  // Add optional parameters if provided
  if (params.orientation) {
    searchParams.append("orientation", params.orientation);
  }
  if (params.color) {
    searchParams.append("color", params.color);
  }

  const response = await fetch(
    `https://api.unsplash.com/search/photos?${searchParams}`,
    {
      headers: {
        Authorization: `Client-ID ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Unsplash API error: ${response.status} ${response.statusText}`,
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

// Filter and structure photo results to get only useful information
function filterAndStructurePhotos(data: any) {
  if (!data.results || !Array.isArray(data.results)) {
    return {
      total: 0,
      photos: [],
    };
  }

  const photos = data.results.map((photo: any) => ({
    id: photo.id,
    description: photo.description || photo.alt_description || "",
    width: photo.width,
    height: photo.height,
    color: photo.color,
    urls: {
      raw: photo.urls?.raw || "",
      full: photo.urls?.full || "",
      regular: photo.urls?.regular || "",
      small: photo.urls?.small || "",
      thumb: photo.urls?.thumb || "",
    },
    download_link: photo.links?.download || "",
    photographer: {
      name: photo.user?.name || "",
      username: photo.user?.username || "",
      portfolio: photo.user?.portfolio_url || "",
      profile_image: photo.user?.profile_image?.medium || "",
    },
    unsplash_link: photo.links?.html || "",
  }));

  return {
    total: data.total || 0,
    total_pages: data.total_pages || 0,
    photos,
  };
}

export const unsplashTool = tool(
  "unsplash_photo_search",
  "Search for high-quality, royalty-free photos on Unsplash. Returns photo URLs and details for business/marketing use.",
  {
    query: z.string().min(1, "search query is required"),
    per_page: z.number().min(1).max(30).optional().describe("Number of photos to return (1-30, default: 10)"),
    orientation: z.enum(["landscape", "portrait", "squarish"]).optional().describe("Filter by photo orientation"),
    color: z.enum(["black_and_white", "black", "white", "yellow", "orange", "red", "purple", "magenta", "green", "teal", "blue"]).optional().describe("Filter by dominant color"),
  },
  async (args: UnsplashParams) => {
    const result = await executeUnsplashQuery(args);
    
    // If there's an error, return it as-is
    if (result.isError) {
      return result;
    }
    
    // Parse and filter the results
    const jsonData = JSON.parse(result.content[0].text);
    const filteredResults = filterAndStructurePhotos(jsonData);
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(filteredResults, null, 2),
        },
      ],
    };
  },
);

// Main driver function for testing
async function main() {
  const testQuery = "coffee shop interior";
  
  console.log(`Searching Unsplash for: "${testQuery}"\n`);
  
  const result = await executeUnsplashQuery({
    query: testQuery,
    per_page: 2,
    orientation: "landscape",
  });
  
  if (result.isError) {
    console.error("Error occurred:");
    console.error(result.content[0].text);
  } else {
    const jsonData = JSON.parse(result.content[0].text);
    const filteredResults = filterAndStructurePhotos(jsonData);
    
    console.log("Filtered and Structured Results:");
    console.log("=".repeat(80));
    console.log(`Total photos found: ${filteredResults.total}`);
    console.log(`Photos returned: ${filteredResults.photos.length}`);
    console.log("=".repeat(80));
    console.log(JSON.stringify(filteredResults, null, 2));
  }
}


  // main()
