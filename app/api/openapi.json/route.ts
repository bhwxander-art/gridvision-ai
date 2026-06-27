export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://gridvision.ai";

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "GridVision AI API",
      version: "1.0.0",
      description:
        "ISO New England Grid Intelligence Platform API — real-time load data, forecasts, capacity analysis, and AI-powered grid copilot.",
      contact: {
        name: "GridVision AI Support",
        url: "https://gridvision.ai",
        email: "support@gridvision.ai",
      },
      license: {
        name: "Proprietary",
      },
    },
    servers: [
      {
        url: appUrl,
        description: "Production",
      },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API Key (gv_...)",
          description:
            "GridVision API key. Generate one at /api-keys in the platform.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string", description: "Error message" },
          },
          required: ["error"],
        },
        IsoCurrentLoad: {
          type: "object",
          properties: {
            current_load_mw: {
              type: "number",
              description: "Current ISO-NE system load in MW",
            },
            forecast_load_mw: {
              type: "number",
              nullable: true,
              description: "Forecasted load in MW for this hour",
            },
            timestamp: {
              type: "string",
              format: "date-time",
              description: "Timestamp of the reading",
            },
            source: {
              type: "string",
              description: "Data source (live, db, mock)",
            },
          },
        },
        ForecastEntry: {
          type: "object",
          properties: {
            forecastFor: {
              type: "string",
              format: "date-time",
              description: "Hour this forecast is for",
            },
            predictedLoadMW: { type: "number" },
            confidenceLowMW: { type: "number" },
            confidenceHighMW: { type: "number" },
            actualLoadMW: {
              type: "number",
              nullable: true,
              description: "Actual observed load (null for future hours)",
            },
            modelType: { type: "string" },
            modelVersion: { type: "string" },
          },
        },
        GridHealthResult: {
          type: "object",
          properties: {
            score: {
              type: "integer",
              minimum: 0,
              maximum: 100,
              description: "Grid health score (0–100)",
            },
            status: {
              type: "string",
              enum: ["stable", "elevated", "critical"],
            },
            recommendation: { type: "string" },
            factors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  score: { type: "number" },
                  weight: { type: "number" },
                },
              },
            },
          },
        },
        CapacitySnapshot: {
          type: "object",
          properties: {
            currentLoadMW: { type: "number" },
            systemCapacityMW: { type: "number" },
            utilizationPct: { type: "number" },
            availableCapacityMW: { type: "number" },
            status: {
              type: "string",
              enum: ["normal", "elevated", "critical"],
            },
            source: { type: "string" },
            asOf: { type: "string", format: "date-time" },
          },
        },
        ChatMessage: {
          type: "object",
          properties: {
            role: {
              type: "string",
              enum: ["user", "assistant"],
            },
            content: { type: "string" },
          },
          required: ["role", "content"],
        },
      },
    },
    paths: {
      "/api/load/iso-current": {
        get: {
          operationId: "getIsoCurrentLoad",
          summary: "Current ISO-NE system load",
          description:
            "Returns the most recent ISO New England system load reading with forecast comparison.",
          tags: ["Load Data"],
          responses: {
            "200": {
              description: "Current load data",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IsoCurrentLoad" },
                },
              },
            },
            "503": {
              description: "Data unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/load/iso-history": {
        get: {
          operationId: "getIsoLoadHistory",
          summary: "Historical ISO-NE load readings",
          description:
            "Returns historical 5-minute interval load readings for ISO New England.",
          tags: ["Load Data"],
          parameters: [
            {
              name: "hours",
              in: "query",
              schema: { type: "integer", default: 24, minimum: 1, maximum: 168 },
              description: "Number of hours of history to return",
            },
          ],
          responses: {
            "200": {
              description: "Historical load readings",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      readings: {
                        type: "array",
                        items: { $ref: "#/components/schemas/IsoCurrentLoad" },
                      },
                      count: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/forecast/current": {
        get: {
          operationId: "getCurrentForecast",
          summary: "24-hour load forecast",
          description:
            "Returns the next 24-hour load forecast with confidence intervals.",
          tags: ["Forecasting"],
          responses: {
            "200": {
              description: "24-hour forecast",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      forecasts: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ForecastEntry" },
                      },
                      horizonHours: { type: "integer" },
                      modelType: { type: "string" },
                      generatedAt: {
                        type: "string",
                        format: "date-time",
                        nullable: true,
                      },
                      currentLoadMW: { type: "number", nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/forecast/accuracy": {
        get: {
          operationId: "getForecastAccuracy",
          summary: "Forecast accuracy metrics",
          description:
            "Returns MAPE, RMSE, and other accuracy metrics comparing recent forecasts to actuals.",
          tags: ["Forecasting"],
          responses: {
            "200": {
              description: "Accuracy metrics",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      mape: {
                        type: "number",
                        description: "Mean Absolute Percentage Error",
                      },
                      rmse: {
                        type: "number",
                        description: "Root Mean Square Error (MW)",
                      },
                      bias: { type: "number" },
                      dataPoints: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/grid/health-score": {
        get: {
          operationId: "getGridHealthScore",
          summary: "Grid health score",
          description:
            "Returns a composite 0–100 health score based on load level, trend, and historical patterns.",
          tags: ["Grid Intelligence"],
          responses: {
            "200": {
              description: "Grid health result",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/GridHealthResult" },
                },
              },
            },
            "404": {
              description: "No load data available",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/capacity/current": {
        get: {
          operationId: "getCurrentCapacity",
          summary: "Capacity snapshot",
          description:
            "Returns current load vs system capacity with utilization percentage.",
          tags: ["Grid Intelligence"],
          responses: {
            "200": {
              description: "Capacity snapshot",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CapacitySnapshot" },
                },
              },
            },
            "503": {
              description: "No data available",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/copilot/chat": {
        post: {
          operationId: "chatWithCopilot",
          summary: "AI Grid Copilot chat (streaming)",
          description:
            "Send a message to the AI Grid Copilot. Returns a Server-Sent Events stream with delta chunks. Each event is a JSON object with type 'delta' (text chunk), 'done', or 'error'.",
          tags: ["AI Copilot"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    messages: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ChatMessage" },
                      description: "Conversation history including the new user message",
                    },
                    sessionId: {
                      type: "string",
                      format: "uuid",
                      description:
                        "Optional session ID to persist the conversation",
                    },
                  },
                  required: ["messages"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "SSE stream of chat deltas",
              content: {
                "text/event-stream": {
                  schema: {
                    type: "string",
                    description:
                      "Each data line is JSON: {type: 'delta', text: '...'} | {type: 'done'} | {type: 'error', error: '...'}",
                  },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "503": {
              description: "AI service not configured",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
    },
  };

  return Response.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
