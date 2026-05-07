import fs from "node:fs/promises";
import path from "node:path";
import {
  Presentation,
  PresentationFile,
  column,
  row,
  layers,
  text,
  shape,
  fill,
  fixed,
  wrap,
  hug,
} from "@oai/artifact-tool";

const outDir = "/Users/torarnehave/Documents/GitHub/Agent-Builder/outputs/agentic-delivery-system-deck";
const pptxPath = path.join(outDir, "agentic_delivery_system_headline_deck.pptx");

const colors = {
  ink: "#111827",
  muted: "#5B6B84",
  blue: "#2563EB",
  blueSoft: "#E8F0FF",
  gold: "#D97706",
  green: "#166534",
  pale: "#F8FAFC",
  line: "#DBE4F0",
  white: "#FFFFFF",
};

const slideFrame = { left: 0, top: 0, width: 1920, height: 1080 };

const slides = [
  {
    kind: "cover",
    label: "Architecture distinction",
    headline: "Agentic Delivery\nSystem",
    subline: "Why this is more than an agent, more than a graph, and more than a model.",
    notes: `Yes. That is an important distinction.

What you are describing is not just an agent. It is an agentic delivery system: an architectural layer that orchestrates reasoning, memory, delegation, propagation, and execution across one or more model providers such as OpenAI, Google, or others.`,
  },
  {
    label: "Core distinction",
    headline: "This is more than an agent.",
    notes: `What is missing from the current text is:

- memory management
- flow orchestration
- turn management
- delegation
- propagation
- and the distinction between a single agent and the larger delivery system

A stronger formulation would be:

An agentic architecture is not merely a graph plus a large language model, nor is it equivalent to a single agent. It is better understood as an agentic delivery system: an orchestration layer that coordinates semantic structure, reasoning, memory, flows, skills, delegation, and execution across one or more intelligence providers such as OpenAI, Google, or others.`,
  },
  {
    label: "Semantic substrate",
    headline: "The graph is the substrate, not the delivery system.",
    notes: `In this model, the graph provides the semantic substrate, but the delivery system governs how intelligence moves through it. This includes how context is assembled, how turns are managed, how memory is retrieved and updated, how tasks are delegated, how decisions propagate through connected nodes and rules, and how outputs are rendered into meaningful actions. The architecture is therefore not only concerned with representation, but with controlled movement of cognition through a structured environment.`,
  },
  {
    label: "Memory",
    headline: "Memory is an architectural responsibility.",
    notes: `Memory management becomes a central architectural responsibility. Memory is not simply stored; it must be selected, scoped, refreshed, compressed, and propagated appropriately. Different flows may require different forms of memory: conversational memory for local interaction continuity, structural memory for graph-level persistence, procedural memory for reusable workflows, and evaluative memory for feedback and learning. A mature agentic delivery system must decide what to remember, what to forget, what to summarize, what to surface to the model in the current turn, and what to preserve for future use.`,
  },
  {
    label: "Flows",
    headline: "Flows are cognitive pathways.",
    notes: `Agentic flow is equally central. A flow is not just a sequence of UI events, but a structured reasoning path through nodes, rules, memory states, and execution steps. Flows determine how a system moves from intent to action. They define when a prompt should be generated, when a skill should be called, when a subtask should be delegated, when human confirmation is required, and when the result should propagate into other parts of the graph. In this sense, a flow is both operational and cognitive: it describes how the system thinks, not only what it does.`,
  },
  {
    label: "Turns",
    headline: "Turns are bounded reasoning events.",
    notes: `Turn management is another native concept. In an LLM-centric system, every interaction unfolds through turns, and each turn is shaped by token limits, context windows, active memory, and task state. A turn is therefore not merely a message exchange; it is a bounded reasoning event. The delivery system must determine what enters the turn, what is omitted, what is summarized, and which actions are allowed to occur within that bounded cognitive frame. This makes turn management a core design concern rather than an implementation detail.`,
  },
  {
    label: "Delegation",
    headline: "Delegation is routing, not just splitting work.",
    notes: `Delegation is also more than simple task splitting. In an agentic delivery system, delegation is the capacity to route subtasks, responsibilities, or skill executions to the most appropriate process, model, tool, or sub-agent. Delegation may occur between specialized skills, between system layers, or across provider boundaries. A system may use one provider for reasoning, another for retrieval, another for multimodal interpretation, and another for code execution. The architecture must therefore support explicit delegation logic, not just inference.`,
  },
  {
    label: "Propagation",
    headline: "Propagation is what keeps the system coherent after action.",
    notes: `Propagation is what allows the system to remain coherent after action. When a decision is made, a skill is executed, or a memory is updated, that change may need to propagate through the graph. A new user role may affect access logic. A form submission may trigger a sequence. A change in visual style may alter rendering rules across related nodes. Propagation ensures that updates are not isolated events, but graph-aware changes with consequences that can be traced, interpreted, and applied systematically.`,
  },
  {
    label: "System boundary",
    headline: "An agent reasons. A delivery system governs reasoning.",
    notes: `This is why the distinction between an agent and an agentic delivery system matters. An agent is a reasoning actor. An agentic delivery system is the larger architecture that governs how reasoning actors operate, coordinate, remember, delegate, and evolve. It is the difference between having intelligence and having a system that can deliver intelligence reliably, adaptively, and across contexts.`,
  },
  {
    label: "Architecture view",
    headline: "Intelligence needs a delivery architecture.",
    notes: `Seen this way, the architecture is composed of multiple tightly related layers: semantic graph structure, rule systems, memory management, skill libraries, flow orchestration, turn management, delegation logic, propagation logic, provider routing, and adaptive feedback. Together these create a system that is not tied to a single proprietary builder, a single interface paradigm, or even a single AI vendor. Instead, it becomes an open and extensible delivery architecture for intelligence itself.

If you want, I can turn this into:
- one clean replacement section for the blueprint
- or a new graph node titled Agentic Delivery System: Memory, Flows, Turns, Delegation, and Propagation.`,
  },
];

const presentation = Presentation.create({
  slideSize: { width: 1920, height: 1080 },
});

function setBackground(slide, color) {
  slide.background.fill = { color };
}

function addNotes(slide, notes) {
  slide.speakerNotes.clear();
  slide.speakerNotes.setText(notes);
  slide.speakerNotes.setVisible(true);
}

function headlineSlide(slideDef, index) {
  const slide = presentation.slides.add();
  const even = index % 2 === 0;
  setBackground(slide, even ? colors.white : colors.pale);

  slide.compose(
    layers(
      { name: `slide-root-${index + 1}`, width: fill, height: fill },
      [
        shape({
          name: `accent-${index + 1}`,
          width: fixed(20),
          height: fixed(720),
          fill: { color: even ? colors.blue : colors.gold },
        }),
        column(
          { name: `content-${index + 1}`, width: fill, height: fill, padding: { x: 124, y: 110 }, gap: 44 },
          [
            row(
              { width: fill, height: hug, gap: 20 },
              [
                text(String(index).padStart(2, "0"), {
                  width: fixed(36),
                  height: hug,
                  style: { fontSize: 20, bold: true, color: even ? colors.blue : colors.gold },
                }),
                text(slideDef.label, {
                  width: fixed(280),
                  height: hug,
                  style: { fontSize: 20, bold: true, color: colors.muted },
                }),
              ],
            ),
            text(slideDef.headline, {
              name: `headline-${index + 1}`,
              width: wrap(1420),
              height: hug,
              style: { fontSize: 82, bold: true, color: colors.ink },
            }),
            shape({
              name: `divider-${index + 1}`,
              width: fixed(240),
              height: fixed(6),
              fill: { color: even ? colors.blue : colors.gold },
            }),
          ],
        ),
      ],
    ),
    { frame: slideFrame, baseUnit: 8 },
  );

  addNotes(slide, slideDef.notes);
}

function coverSlide(slideDef) {
  const slide = presentation.slides.add();
  setBackground(slide, colors.white);

  slide.compose(
    layers(
      { name: "cover-root", width: fill, height: fill },
      [
        column(
          { name: "cover-content", width: fill, height: fill, padding: { x: 120, y: 110 }, gap: 40 },
          [
            text(slideDef.label, {
              width: wrap(800),
              height: hug,
              style: { fontSize: 22, bold: true, color: colors.blue },
            }),
            text(slideDef.headline, {
              name: "cover-headline",
              width: wrap(1000),
              height: hug,
              style: { fontSize: 96, bold: true, color: colors.ink },
            }),
            shape({
              name: "cover-divider",
              width: fixed(280),
              height: fixed(8),
              fill: { color: colors.blue },
            }),
            text(slideDef.subline, {
              width: wrap(1080),
              height: hug,
              style: { fontSize: 32, color: colors.muted },
            }),
          ],
        ),
      ],
    ),
    { frame: slideFrame, baseUnit: 8 },
  );

  addNotes(slide, slideDef.notes);
}

coverSlide(slides[0]);
for (let i = 1; i < slides.length; i += 1) {
  headlineSlide(slides[i], i);
}

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
