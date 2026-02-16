import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { imageData, mediaType, existingTasks } = await request.json();

    if (!imageData) {
      return NextResponse.json({ error: "No image data provided" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured. Add it in your Vercel project settings." },
        { status: 500 }
      );
    }

    const client = new Anthropic({ apiKey });

    const existingTitles = (existingTasks || []).map((t) => t.toLowerCase().trim());

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType || "image/jpeg",
                data: imageData,
              },
            },
            {
              type: "text",
              text: `You are analyzing a photo of a handwritten to-do list. Extract ALL to-do items from the image.

For each item, determine:
1. The task title (clean it up for readability but stay faithful to what's written)
2. Whether it appears checked off / crossed out / completed (look for checkmarks, strikethroughs, X marks, filled boxes)
3. If there's an obvious category or grouping header written on the page, note it
4. If a date is written near items or on the page, note it in YYYY-MM-DD format

Existing tasks already in the app: ${JSON.stringify(existingTitles)}

If a scanned item closely matches an existing task (accounting for abbreviations, slight wording differences), mark it as a duplicate.

Return ONLY valid JSON with no markdown backticks and no preamble text. Use this exact schema:
{
  "items": [
    {
      "title": "task description",
      "completed": false,
      "category": "category name or null",
      "date": "YYYY-MM-DD or null",
      "is_duplicate_of": "matching existing task title or null"
    }
  ],
  "page_date": "YYYY-MM-DD or null"
}`,
            },
          ],
        },
      ],
    });

    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");

    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Scan API error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process image" },
      { status: 500 }
    );
  }
}

// Next.js App Router route segment config
export const maxDuration = 30;
export const dynamic = "force-dynamic";
