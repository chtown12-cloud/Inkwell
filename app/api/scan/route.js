import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { imageData, mediaType, existingTasks, existingLists } = await request.json();

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
    const listNames = existingLists || ["Inbox"];

    const message = await client.messages.create({
      model: "claude-sonnet-4-6-20250217",
      max_tokens: 3000,
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
              text: `You are analyzing a photo of a handwritten to-do list. Extract ALL to-do items from the image, preserving their hierarchy.

For each item, determine:
1. The task title (clean it up for readability but stay faithful to what's written)
2. Whether it appears checked off / crossed out / completed (look for checkmarks, strikethroughs, X marks, filled boxes)
3. The category/list it belongs to — look for grouping headers, sections, or underlined titles on the page. Tasks written under a header belong to that category.
4. If a date is written near items or on the page, note it in YYYY-MM-DD format. If a specific item has its own date annotation, use that for the item.
5. HIERARCHY: Look for indentation levels, bullet styles, numbering, or visual nesting to determine parent-child relationships:
   - Top-level items (no indent, or marked with •, -, ☐, numbers) = tasks
   - Indented items below a task (marked with →, >, indented dash, sub-bullets, letters like a/b/c) = subtasks of the item above
   - Further-indented items = sub-subtasks (children of the subtask above)
   
IMPORTANT — Category matching:
The user already has these lists in their app: ${JSON.stringify(listNames)}
When you identify a category from the page, try to match it to one of these existing lists. Use fuzzy matching — for example if the page says "TY tasks" and the user has a list called "TY", use "TY". If the page says "Concentrix project" and they have "Concentrix", use "Concentrix". Only create a new category name if nothing in the existing lists is a reasonable match.

Existing tasks already in the app: ${JSON.stringify(existingTitles)}
If a scanned item closely matches an existing task (accounting for abbreviations, slight wording differences), mark it as a duplicate.

Return ONLY valid JSON with no markdown backticks and no preamble text. Use this exact schema:
{
  "items": [
    {
      "title": "task description",
      "completed": false,
      "category": "matched list name or new category name or null",
      "date": "YYYY-MM-DD or null",
      "is_duplicate_of": "matching existing task title or null",
      "subtasks": [
        {
          "title": "subtask description",
          "completed": false,
          "subtasks": [
            {
              "title": "sub-subtask description",
              "completed": false,
              "subtasks": []
            }
          ]
        }
      ]
    }
  ],
  "page_date": "YYYY-MM-DD or null"
}

If a task has no subtasks, use an empty array: "subtasks": []`,
            },
          ],
        },
      ],
    });

    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");

    /* Robust JSON extraction — handle markdown fences, preamble text, etc. */
    let parsed;
    try {
      /* Try direct parse first */
      parsed = JSON.parse(text.trim());
    } catch (_) {
      /* Strip markdown fences */
      let clean = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
      try {
        parsed = JSON.parse(clean);
      } catch (__) {
        /* Find first { and last } — extract JSON object from surrounding text */
        const first = clean.indexOf("{");
        const last = clean.lastIndexOf("}");
        if (first !== -1 && last > first) {
          parsed = JSON.parse(clean.slice(first, last + 1));
        } else {
          throw new Error("Could not extract JSON from model response");
        }
      }
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Scan API error:", error);
    const msg = error?.message || "Failed to process image";
    /* Surface specific Anthropic API errors */
    const status = error?.status || 500;
    return NextResponse.json(
      { error: msg },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

// Next.js App Router route segment config
export const maxDuration = 30;
export const dynamic = "force-dynamic";
