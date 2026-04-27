#!/usr/bin/env python3
import argparse
import json
import secrets
from pathlib import Path


DEFAULT_STROKE = "#1e1e1e"
COLORS = {
    "frontend": "#dbeafe",
    "worker": "#dcfce7",
    "service": "#fef3c7",
    "data": "#fce7f3",
    "external": "#ede9fe",
}


def element_id():
    return secrets.token_urlsafe(10)


def base_element(kind, x, y, width, height, **extra):
    element = {
        "id": element_id(),
        "type": kind,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "angle": 0,
        "strokeColor": DEFAULT_STROKE,
        "backgroundColor": "transparent",
        "fillStyle": "hachure",
        "strokeWidth": 2,
        "strokeStyle": "solid",
        "roughness": 1,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": {"type": 3},
        "seed": secrets.randbelow(2_000_000_000),
        "version": 1,
        "versionNonce": secrets.randbelow(2_000_000_000),
        "isDeleted": False,
        "boundElements": None,
        "updated": 1,
        "link": None,
        "locked": False,
    }
    element.update(extra)
    return element


def text(x, y, width, label, font_size=20, align="center"):
    line_count = max(1, len(label.splitlines()))
    return base_element(
        "text",
        x,
        y,
        width,
        font_size * 1.25 * line_count,
        roundness=None,
        strokeWidth=1,
        text=label,
        fontSize=font_size,
        fontFamily=1,
        textAlign=align,
        verticalAlign="middle",
        containerId=None,
        originalText=label,
        lineHeight=1.25,
    )


def labelled_rect(x, y, width, height, label, background="transparent", font_size=20):
    rect = base_element("rectangle", x, y, width, height, backgroundColor=background)
    label_height = font_size * 1.25 * max(1, len(label.splitlines()))
    label_element = text(
        x + 16,
        y + height / 2 - label_height / 2,
        width - 32,
        label,
        font_size,
    )
    return [rect, label_element]


def arrow(start_x, start_y, end_x, end_y):
    return base_element(
        "arrow",
        start_x,
        start_y,
        end_x - start_x,
        end_y - start_y,
        roundness={"type": 2},
        lastCommittedPoint=None,
        startBinding=None,
        endBinding=None,
        startArrowhead=None,
        endArrowhead="arrow",
        points=[[0, 0], [end_x - start_x, end_y - start_y]],
    )


def build_flow_scene():
    elements = [
        *labelled_rect(100, 120, 220, 90, "User"),
        *labelled_rect(420, 120, 260, 90, "Agent"),
        *labelled_rect(780, 120, 280, 90, "Knowledge Graph"),
        arrow(320, 165, 420, 165),
        arrow(680, 165, 780, 165),
        text(340, 196, 64, "chat", 16),
        text(700, 196, 64, "tools", 16),
    ]

    return {
        "type": "excalidraw",
        "version": 2,
        "source": "codex-excalidraw-helper",
        "elements": elements,
        "appState": {
            "viewBackgroundColor": "#ffffff",
            "gridSize": None,
        },
        "files": {},
    }


def build_architecture_scene():
    elements = [
        text(80, 32, 840, "Agent-Builder Architecture", 32, "left"),
        *labelled_rect(
            80,
            120,
            260,
            92,
            "React / Vite Pages\nAgentChat.tsx",
            COLORS["frontend"],
            20,
        ),
        *labelled_rect(
            80,
            252,
            260,
            82,
            "Builder UI\nAgentBuilder + Canvas",
            COLORS["frontend"],
            18,
        ),
        *labelled_rect(
            430,
            120,
            280,
            92,
            "agent-worker\nPOST /chat SSE",
            COLORS["worker"],
            20,
        ),
        *labelled_rect(
            430,
            252,
            280,
            82,
            "Agent loop\nCodex + tool calls",
            COLORS["worker"],
            18,
        ),
        *labelled_rect(
            800,
            120,
            270,
            82,
            "anthropic-worker\nCodex API proxy",
            COLORS["external"],
            18,
        ),
        *labelled_rect(
            800,
            242,
            270,
            82,
            "knowledge-graph-worker\nGraph + node CRUD",
            COLORS["service"],
            18,
        ),
        *labelled_rect(
            800,
            364,
            270,
            82,
            "media + analysis workers\nalbums, OpenAI, Perplexity",
            COLORS["service"],
            17,
        ),
        *labelled_rect(
            1160,
            242,
            240,
            82,
            "D1\nKnowledge graphs",
            COLORS["data"],
            18,
        ),
        *labelled_rect(
            1160,
            364,
            240,
            82,
            "R2 / external APIs\nimages, search, audio",
            COLORS["data"],
            18,
        ),
        arrow(340, 166, 430, 166),
        arrow(430, 196, 340, 196),
        arrow(570, 212, 570, 252),
        arrow(710, 166, 800, 166),
        arrow(710, 293, 800, 283),
        arrow(710, 293, 800, 405),
        arrow(1070, 283, 1160, 283),
        arrow(1070, 405, 1160, 405),
        arrow(210, 212, 210, 252),
        text(355, 132, 58, "POST", 15),
        text(352, 204, 62, "SSE", 15),
        text(590, 222, 86, "streams", 15, "left"),
        text(722, 132, 70, "LLM", 15),
        text(722, 262, 70, "tools", 15),
        text(722, 390, 70, "media", 15),
    ]

    return {
        "type": "excalidraw",
        "version": 2,
        "source": "codex-excalidraw-helper",
        "elements": elements,
        "appState": {
            "viewBackgroundColor": "#ffffff",
            "gridSize": None,
        },
        "files": {},
    }


def validate_scene(scene):
    ids = [element["id"] for element in scene["elements"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Element IDs must be unique")
    if scene.get("type") != "excalidraw":
        raise ValueError("Scene type must be excalidraw")
    for element in scene["elements"]:
        if not element.get("id"):
            raise ValueError("Every element needs an ID")
        if element["type"] == "text" and not element.get("text"):
            raise ValueError("Text elements cannot have empty labels")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="generated/agent-builder-flow.excalidraw",
        help="Path for the generated Excalidraw scene.",
    )
    parser.add_argument(
        "--scene",
        choices=["flow", "architecture"],
        default="flow",
        help="Diagram scene to generate.",
    )
    args = parser.parse_args()

    if args.scene == "architecture":
        scene = build_architecture_scene()
    else:
        scene = build_flow_scene()
    validate_scene(scene)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(scene, indent=2), encoding="utf-8")
    print(output_path)


if __name__ == "__main__":
    main()
