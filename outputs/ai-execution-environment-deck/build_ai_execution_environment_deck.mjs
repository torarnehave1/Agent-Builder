import fs from "node:fs/promises";
import path from "node:path";
import {
  Presentation,
  PresentationFile,
  row,
  column,
  grid,
  layers,
  text,
  rule,
  shape,
  fill,
  fixed,
  wrap,
  hug,
  fr,
  auto,
} from "@oai/artifact-tool";

const outDir = "/Users/torarnehave/Documents/GitHub/Agent-Builder/outputs/ai-execution-environment-deck";
const pptxPath = path.join(outDir, "ai_execution_environments_explainer.pptx");

const colors = {
  ink: "#0F172A",
  muted: "#526077",
  blue: "#2563EB",
  blueSoft: "#DCE9FF",
  pale: "#F8FAFC",
  line: "#D7E0EA",
  warm: "#D97706",
  red: "#B91C1C",
  green: "#166534",
};

const slideFrame = { left: 0, top: 0, width: 1920, height: 1080 };

const presentation = Presentation.create({
  slideSize: { width: 1920, height: 1080 },
});

function setBackground(slide, color = "#FFFFFF") {
  slide.background.fill = { color };
}

function titleBlock(title, subtitle, width = 1280) {
  return column(
    { name: "title-block", width: fill, height: hug, gap: 18 },
    [
      text(title, {
        name: "slide-title",
        width: wrap(width),
        height: hug,
        style: { fontSize: 56, bold: true, color: colors.ink },
      }),
      rule({ name: "title-rule", width: fixed(220), stroke: colors.blue, weight: 5 }),
      text(subtitle, {
        name: "slide-subtitle",
        width: wrap(width),
        height: hug,
        style: { fontSize: 24, color: colors.muted },
      }),
    ],
  );
}

function bulletColumn(items, color = colors.ink, size = 26) {
  return column(
    { name: "bullet-column", width: fill, height: hug, gap: 18 },
    items.map((item, index) =>
      text(`• ${item}`, {
        name: `bullet-${index + 1}`,
        width: fill,
        height: hug,
        style: { fontSize: size, color },
      }),
    ),
  );
}

function card(title, body, accent = colors.blue, options = {}) {
  const { titleSize = 24, bodySize = 24, padding = 28, gap = 16 } = options;
  return layers(
    { name: `card-${title}`, width: fill, height: fill },
    [
      shape({
        name: `card-bg-${title}`,
        width: fill,
        height: fill,
        fill: { color: "#FFFFFF" },
        line: { color: colors.line, width: 1.5 },
        radius: 22,
      }),
      column(
        { name: `card-content-${title}`, width: fill, height: fill, padding, gap },
        [
          text(title, {
            name: `card-title-${title}`,
            width: fill,
            height: hug,
            style: { fontSize: titleSize, bold: true, color: accent },
          }),
          text(body, {
            name: `card-body-${title}`,
            width: fill,
            height: hug,
            style: { fontSize: bodySize, color: colors.ink },
          }),
        ],
      ),
    ],
  );
}

function smallLabel(label, color = colors.blue) {
  return text(label, {
    name: `label-${label.replace(/\W+/g, "-")}`,
    width: hug,
    height: hug,
    style: { fontSize: 18, bold: true, color },
  });
}

function addCoverSlide() {
  const slide = presentation.slides.add();
  setBackground(slide, "#FFFFFF");
  slide.compose(
    layers(
      { name: "cover-root", width: fill, height: fill },
      [
        column(
          { name: "cover-content", width: fill, height: fill, padding: { x: 120, y: 112 }, gap: 34 },
          [
            smallLabel("Terminology, runtime behavior, and why \"agent\" is too vague"),
            text("AI Execution\nEnvironment", {
              name: "cover-title",
              width: wrap(980),
              height: hug,
              style: { fontSize: 88, bold: true, color: colors.ink },
            }),
            text(
              "User-facing and architect-facing explanation of why Codex, Claude Code, Gemini/Vertex, and Cloudflare-hosted model setups behave differently even when they all look like a chat box.",
              {
                name: "cover-subtitle",
                width: wrap(1050),
                height: hug,
                style: { fontSize: 28, color: colors.muted },
              },
            ),
            row(
              { name: "cover-footer", width: fill, height: hug, gap: 52 },
              [
                text("Key thesis", {
                  width: hug,
                  height: hug,
                  style: { fontSize: 18, bold: true, color: colors.warm },
                }),
                text("What people call an “agent” is usually a full operating stack.", {
                  width: wrap(880),
                  height: hug,
                  style: { fontSize: 24, color: colors.ink },
                }),
              ],
            ),
          ],
        ),
      ],
    ),
    { frame: slideFrame, baseUnit: 8 },
  );
}

function addMisleadingLanguageSlide() {
  const slide = presentation.slides.add();
  setBackground(slide, colors.pale);
  slide.compose(
    column(
      {
        name: "misleading-root",
        width: fill,
        height: fill,
        padding: { x: 96, y: 78 },
        gap: 34,
      },
      [
        titleBlock(
          "Why “agent” language misleads users",
          "The term sounds like a coherent actor with stable identity. The system is actually a layered execution process.",
          1500,
        ),
        row(
          { name: "misleading-body", width: fill, height: fill, gap: 56 },
          [
            column(
              { name: "misleading-left", width: fixed(900), height: fill, gap: 24 },
              [
                bulletColumn([
                  "Users imagine a single intelligent entity instead of a configured runtime.",
                  "They think they are ‘teaching an agent’ when they are often shaping instructions, context assembly, permissions, and output constraints.",
                  "The visible chat experience hides tool routing, hidden prompts, orchestration rules, validation, and memory/state policy.",
                ], colors.ink, 26),
              ],
            ),
            column(
              { name: "misleading-right", width: fill, height: fill, gap: 24 },
              [
                text("The common shorthand creates the wrong mental model.", {
                  name: "right-claim",
                  width: wrap(680),
                  height: hug,
                  style: { fontSize: 48, bold: true, color: colors.ink },
                }),
                card("What the user thinks", "“I am talking to an agent that understands me and acts.”", colors.red),
                card(
                  "What is actually happening",
                  "The system interprets intent, assembles context, applies hidden rules, decides whether tools are allowed, executes steps, and streams the result back through a host application.",
                  colors.green,
                ),
              ],
            ),
          ],
        ),
      ],
    ),
    { frame: slideFrame, baseUnit: 8 },
  );
}

function addBehaviorFormulaSlide() {
  const slide = presentation.slides.add();
  setBackground(slide, "#FFFFFF");
  slide.compose(
    column(
      { name: "formula-root", width: fill, height: fill, padding: { x: 96, y: 84 }, gap: 34 },
      [
        titleBlock(
          "What actually shapes behavior",
          "The answer quality and action quality come from the full execution environment, not only from the model name.",
          1500,
        ),
        text("Behavior = Model + Runtime + Context + Tools + Permissions + Orchestration + Product Constraints", {
          name: "formula-line",
          width: wrap(1680),
          height: hug,
          style: { fontSize: 44, bold: true, color: colors.blue },
        }),
        grid(
          {
            name: "formula-grid",
            width: fill,
            height: fill,
            columns: [fr(1), fr(1), fr(1)],
            rows: [fr(1), fr(1), fr(1)],
            columnGap: 22,
            rowGap: 22,
          },
          [
            card("Model", "Reasoning style, instruction following, strengths, weaknesses, and failure patterns.", colors.blue, { titleSize: 22, bodySize: 22, padding: 24, gap: 10 }),
            card("Runtime", "The host logic that controls turns, retries, streaming, and tool execution.", colors.blue, { titleSize: 22, bodySize: 22, padding: 24, gap: 10 }),
            card("Context", "What is injected before your prompt: memory, files, metadata, retrieval, examples.", colors.blue, { titleSize: 22, bodySize: 22, padding: 24, gap: 10 }),
            card("Tools", "What the system is allowed to read, write, call, or modify.", colors.blue, { titleSize: 22, bodySize: 22, padding: 24, gap: 10 }),
            card("Permissions", "Sandbox boundaries, approval rules, and what actions are blocked.", colors.blue, { titleSize: 22, bodySize: 22, padding: 24, gap: 10 }),
            card("Orchestration", "How multi-step workflows are chosen, sequenced, and validated.", colors.blue, { titleSize: 22, bodySize: 22, padding: 24, gap: 10 }),
            card("Product Constraints", "Latency, cost ceilings, safety policy, UX framing, and output formatting.", colors.blue, { titleSize: 22, bodySize: 22, padding: 24, gap: 10 }),
          ],
        ),
      ],
    ),
    { frame: slideFrame, baseUnit: 8 },
  );
}

function addEnvironmentComparisonSlide() {
  const slide = presentation.slides.add();
  setBackground(slide, colors.pale);
  const rows = [
    ["Codex", "Coding-oriented host environment", "Terminal, files, plans, patches, app integrations", "Behavior comes from model + host rules + tool permissions"],
    ["Claude Code", "Anthropic coding runtime", "Repo actions, CLI patterns, Anthropic orchestration style", "Same user request can lead to different planning and edits"],
    ["Gemini / Vertex / AI Studio", "Google-hosted execution context", "Gemini model family + Google context and platform controls", "Prompt behavior shifts because the stack and constraints differ"],
    ["Gemma 4 26B on Cloudflare", "Cloudflare-hosted model setup", "Model + Cloudflare runtime + local orchestration design", "Lower-level hosting and integration choices matter as much as model name"],
  ];

  const cells = [
    "Environment", "Dominant runtime layer", "What the user can feel", "Why it behaves differently",
    ...rows.flat(),
  ];

  slide.compose(
    column(
      { name: "comparison-root", width: fill, height: fill, padding: { x: 86, y: 72 }, gap: 30 },
      [
        titleBlock(
          "Same chat pattern, different execution environments",
          "The visible interaction may look similar while the underlying operating conditions differ materially.",
          1500,
        ),
        grid(
          {
            name: "comparison-table",
            width: fill,
            height: fill,
            columns: [fixed(250), fixed(320), fixed(420), fixed(630)],
            rows: [fixed(88), fixed(150), fixed(150), fixed(150), fixed(150)],
            columnGap: 0,
            rowGap: 0,
          },
          cells.map((content, index) => {
            const rowIndex = Math.floor(index / 4);
            const isHeader = rowIndex === 0;
            return layers(
              { name: `cell-${index}`, width: fill, height: fill },
              [
                shape({
                  name: `cell-bg-${index}`,
                  width: fill,
                  height: fill,
                  fill: { color: isHeader ? "#E5EEFF" : "#FFFFFF" },
                  line: { color: colors.line, width: 1.2 },
                }),
                text(content, {
                  name: `cell-text-${index}`,
                  width: fill,
                  height: fill,
                  style: {
                    fontSize: isHeader ? 22 : 21,
                    bold: isHeader,
                    color: colors.ink,
                    inset: 16,
                  },
                }),
              ],
            );
          }),
        ),
      ],
    ),
    { frame: slideFrame, baseUnit: 8 },
  );
}

function addStackSlide() {
  const slide = presentation.slides.add();
  setBackground(slide, "#FFFFFF");
  const layersData = [
    ["User intent", "What the person asks for in natural language"],
    ["Visible interface", "Chat shell, editor, terminal, browser, app framing"],
    ["Instruction layer", "Hidden system rules, contract language, templates, tone control"],
    ["Context assembly", "History, memory, files, retrieval, state, metadata"],
    ["Decision engine", "The model and the runtime policy around it"],
    ["Authorized operations", "Tools, APIs, file access, shell access, graph access"],
    ["Execution policy", "Permissions, retries, validation, stop conditions, logging"],
  ];

  slide.compose(
    column(
      {
        name: "stack-root",
        width: fill,
        height: fill,
        padding: { x: 92, y: 78 },
        gap: 26,
      },
      [
        titleBlock(
          "What sits behind one prompt",
          "This is why two systems can feel similar on the surface yet behave differently in practice.",
          1500,
        ),
        row(
          { name: "stack-body", width: fill, height: fill, gap: 48 },
          [
            column(
              { name: "stack-left", width: fixed(720), height: fill, gap: 18 },
              [
                text("A prompt is the trigger, not the whole machine.", {
                  name: "stack-claim",
                  width: wrap(680),
                  height: hug,
                  style: { fontSize: 42, bold: true, color: colors.ink },
                }),
                bulletColumn([
                  "Users often see only the prompt and the answer.",
                  "Architecturally, the answer emerges from a layered execution path.",
                  "Changing any one layer can change the behavior materially.",
                ], colors.muted, 20),
              ],
            ),
            column(
              { name: "stack-right", width: fill, height: fill, gap: 10 },
              layersData.map(([title, body], index) =>
                layers(
                  { name: `stack-layer-${index}`, width: fill, height: fixed(88) },
                  [
                    shape({
                      name: `stack-shape-${index}`,
                      width: fill,
                      height: fill,
                      fill: { color: index % 2 === 0 ? "#EEF4FF" : "#F8FAFC" },
                      line: { color: colors.line, width: 1.2 },
                      radius: 14,
                    }),
                    row(
                      { name: `stack-row-${index}`, width: fill, height: fill, padding: { x: 20, y: 14 }, gap: 16 },
                      [
                        text(`0${index + 1}`, {
                          width: fixed(54),
                          height: hug,
                          style: { fontSize: 24, bold: true, color: colors.blue },
                        }),
                        column(
                          { width: fill, height: hug, gap: 4 },
                          [
                            text(title, {
                              width: fill,
                              height: hug,
                              style: { fontSize: 21, bold: true, color: colors.ink },
                            }),
                            text(body, {
                              width: fill,
                              height: hug,
                              style: { fontSize: 18, color: colors.muted },
                            }),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    ),
    { frame: slideFrame, baseUnit: 8 },
  );
}

function addImplicationsSlide() {
  const slide = presentation.slides.add();
  setBackground(slide, colors.pale);
  slide.compose(
    column(
      { name: "implications-root", width: fill, height: fill, padding: { x: 96, y: 80 }, gap: 30 },
      [
        titleBlock(
          "What this means for users and builders",
          "If the behavior comes from a stack, then better prompts are only one part of the story.",
          1480,
        ),
        grid(
          {
            name: "implications-grid",
            width: fill,
            height: fill,
            columns: [fr(1), fr(1), fr(1)],
            rows: [fr(1)],
            columnGap: 26,
          },
          [
            card(
              "For users",
              "You are not only choosing a model. You are choosing an operating setup with its own tools, constraints, and behavior.",
              colors.blue,
            ),
            card(
              "For product design",
              "Calling everything an “agent” hides the real mechanics. Better language builds better expectations.",
              colors.warm,
            ),
            card(
              "For builders",
              "The quality comes from runtime design: context curation, permission design, orchestration, validation, and UX framing.",
              colors.green,
            ),
          ],
        ),
        text(
          "Practical takeaway: when behavior changes, inspect the stack before blaming or praising the model alone.",
          {
            name: "implications-takeaway",
            width: wrap(1400),
            height: hug,
            style: { fontSize: 28, bold: true, color: colors.ink },
          },
        ),
      ],
    ),
    { frame: slideFrame, baseUnit: 8 },
  );
}

function addTerminologySlide() {
  const slide = presentation.slides.add();
  setBackground(slide, "#FFFFFF");
  const terms = [
    ["Agent", "AI execution environment"],
    ["Agentic behavior", "Multi-step tool orchestration"],
    ["System prompt", "Instruction layer"],
    ["Memory", "Persistent context source"],
    ["Tools", "Authorized operations"],
    ["Conversation", "Interactive execution session"],
  ];

  slide.compose(
    column(
      { name: "terms-root", width: fill, height: fill, padding: { x: 94, y: 78 }, gap: 28 },
      [
        titleBlock(
          "A more precise vocabulary",
          "These replacements reduce hype and make the system easier to explain truthfully.",
          1500,
        ),
        grid(
          {
            name: "terms-grid",
            width: fill,
            height: fill,
            columns: [fixed(360), fixed(90), fr(1)],
            rows: [fixed(78), ...terms.map(() => fixed(96))],
            columnGap: 0,
            rowGap: 0,
          },
          [
            "Loose term", "", "More precise term",
            ...terms.flatMap(([a, b]) => [a, "→", b]),
          ].map((content, index) => {
            const rowIndex = Math.floor(index / 3);
            const isHeader = rowIndex === 0;
            return layers(
              { name: `term-cell-${index}`, width: fill, height: fill },
              [
                shape({
                  name: `term-bg-${index}`,
                  width: fill,
                  height: fill,
                  fill: { color: isHeader ? colors.blueSoft : "#FFFFFF" },
                  line: { color: colors.line, width: 1.2 },
                }),
                text(content, {
                  name: `term-text-${index}`,
                  width: fill,
                  height: fill,
                  style: {
                    fontSize: isHeader ? 24 : 28,
                    bold: isHeader || (index % 3 === 0),
                    color: isHeader ? colors.ink : index % 3 === 2 ? colors.blue : colors.ink,
                    align: index % 3 === 1 ? "center" : "left",
                    inset: 18,
                  },
                }),
              ],
            );
          }),
        ),
        text(
          "Closing thought: precision in language improves user expectations, architecture discussions, and product honesty.",
          {
            name: "terms-close",
            width: wrap(1480),
            height: hug,
            style: { fontSize: 26, color: colors.muted },
          },
        ),
      ],
    ),
    { frame: slideFrame, baseUnit: 8 },
  );
}

addCoverSlide();
addMisleadingLanguageSlide();
addBehaviorFormulaSlide();
addEnvironmentComparisonSlide();
addStackSlide();
addImplicationsSlide();
addTerminologySlide();

await fs.mkdir(outDir, { recursive: true });
const pptxBlob = await PresentationFile.exportPptx(presentation);
await pptxBlob.save(pptxPath);

const previewPaths = [];
for (let i = 0; i < presentation.slides.count; i += 1) {
  const slide = presentation.slides.getItem(i);
  const blob = await slide.export();
  const previewPath = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
  await fs.writeFile(previewPath, Buffer.from(await blob.arrayBuffer()));
  previewPaths.push(previewPath);
}

console.log(JSON.stringify({ pptxPath, previewPaths }, null, 2));
