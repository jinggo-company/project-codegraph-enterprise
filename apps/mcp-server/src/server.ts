import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Create MCP server
const server = new McpServer({
  name: "codegraph-enterprise",
  version: "0.1.0",
});

// Tool: search_code
server.tool(
  "search_code",
  {
    query: z.string().describe("Search query"),
    project: z.string().describe("Project identifier"),
    language: z.string().optional().describe("Filter by language"),
  },
  async ({ query, project, language }) => {
    // TODO: implement index lookup
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query,
            project,
            language,
            results: [],
            message: "Index not yet configured",
          }),
        },
      ],
    };
  }
);

// Tool: get_symbol
server.tool(
  "get_symbol",
  {
    name: z.string().describe("Symbol name"),
    kind: z.string().optional().describe("Symbol kind (function, class, etc.)"),
    project: z.string().describe("Project identifier"),
  },
  async ({ name, kind, project }) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name,
            kind,
            project,
            message: "Index not yet configured",
          }),
        },
      ],
    };
  }
);

// Tool: get_callers
server.tool(
  "get_callers",
  {
    name: z.string().describe("Symbol name"),
    project: z.string().describe("Project identifier"),
  },
  async ({ name, project }) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name,
            project,
            callers: [],
            message: "Index not yet configured",
          }),
        },
      ],
    };
  }
);

// Tool: get_impact
server.tool(
  "get_impact",
  {
    target: z.string().describe("File path or symbol name"),
    project: z.string().describe("Project identifier"),
  },
  async ({ target, project }) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            target,
            project,
            impact: [],
            message: "Index not yet configured",
          }),
        },
      ],
    };
  }
);

// Tool: search_fulltext
server.tool(
  "search_fulltext",
  {
    query: z.string().describe("Full-text search query"),
    project: z.string().describe("Project identifier"),
  },
  async ({ query, project }) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query,
            project,
            results: [],
            message: "Index not yet configured",
          }),
        },
      ],
    };
  }
);

// Start server via stdio
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

main().catch(console.error);
