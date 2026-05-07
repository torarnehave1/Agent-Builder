import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workDir = "/Users/torarnehave/Documents/GitHub/Agent-Builder/outputs/graph-ecosystem-test-tracker";
const inputPath = path.join(workDir, "graph_ecosystem_apps.json");
const outputPath = path.join(workDir, "vegvisr_ecosystem_test_tracker.xlsx");

function extractTableValue(markdown, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\|\\s*\\*\\*${escaped}\\*\\*\\s*\\|\\s*([^|]+?)\\s*\\|`, "i");
  const match = markdown.match(regex);
  return match ? match[1].trim() : "";
}

function cleanText(value) {
  return String(value || "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function extractApps(graph) {
  return graph.nodes
    .filter((node) => node.id.startsWith("app-") && node.type === "fulltext")
    .map((node) => {
      const info = node.info || "";
      const domain = cleanText(extractTableValue(info, "domain"));
      const stack = cleanText(extractTableValue(info, "stack"));
      const deployment = cleanText(extractTableValue(info, "deployment"));
      const bindings = cleanText(extractTableValue(info, "bindings"));
      const dependsOn = cleanText(extractTableValue(info, "depends_on"));
      const purpose = cleanText(extractTableValue(info, "purpose"));
      const status = cleanText(extractTableValue(info, "status"));
      const type = cleanText(extractTableValue(info, "type"));
      const workers = cleanText(extractTableValue(info, "workers"));
      const icon = cleanText(extractTableValue(info, "icon"));
      const appName = node.label.replace(/^#\s*/, "").trim();
      const repoHint = appName
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[()]/g, "");

      return {
        appId: node.id,
        appName,
        type,
        stack,
        deployment,
        domain,
        workers,
        bindings,
        dependsOn,
        status: status || "unknown",
        purpose,
        icon,
        repoHint,
        riskLevel: ["active", "development"].includes(status.toLowerCase()) ? "Medium" : "Low",
      };
    })
    .sort((a, b) => a.appName.localeCompare(b.appName));
}

function addSheetTitle(sheet, title, subtitle) {
  sheet.getRange("A1").values = [[title]];
  sheet.getRange("A2").values = [[subtitle]];
}

function makeDataValidationList(range, values) {
  range.dataValidation = {
    type: "list",
    allowBlank: true,
    formula1: `"${values.join(",")}"`,
  };
}

function styleTable(range, headerColor = "#D9EAF7") {
  const fmt = range.format;
  fmt.wrapText = true;
  fmt.verticalAlignment = "center";
  fmt.horizontalAlignment = "left";
  fmt.borders = {
    top: { style: "thin", color: "#D9E2F3" },
    bottom: { style: "thin", color: "#D9E2F3" },
    left: { style: "thin", color: "#D9E2F3" },
    right: { style: "thin", color: "#D9E2F3" },
  };
  const header = range.getRow(0);
  header.format.fill = { color: headerColor };
  header.format.font = { color: "#111111", bold: true };
}

function setColumnWidths(sheet, widths) {
  for (const [column, width] of Object.entries(widths)) {
    sheet.getRange(`${column}:${column}`).format.columnWidthPx = width;
  }
}

async function buildWorkbook() {
  const graph = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const apps = extractApps(graph);

  const workbook = Workbook.create();

  const dashboard = workbook.worksheets.add("Dashboard");
  const appsSheet = workbook.worksheets.add("Apps");
  const areasSheet = workbook.worksheets.add("Features_Areas");
  const issuesSheet = workbook.worksheets.add("Issues");
  const testCasesSheet = workbook.worksheets.add("Test_Cases");
  const testRunsSheet = workbook.worksheets.add("Test_Runs");
  const freezeSheet = workbook.worksheets.add("Freeze");
  const guidanceSheet = workbook.worksheets.add("Guidance");

  addSheetTitle(dashboard, "Vegvisr Ecosystem Test Tracker", "Single operational cockpit linked to graph_ecosystem_apps");
  addSheetTitle(appsSheet, "Apps", "Seeded from graph_ecosystem_apps. Use app_id as the foreign key in all other sheets.");
  addSheetTitle(areasSheet, "Features / Areas", "Break each app into meaningful testable or architectural areas.");
  addSheetTitle(issuesSheet, "Issues", "Track live defects, decisions, and blockers.");
  addSheetTitle(testCasesSheet, "Test Cases", "Define reusable scenarios tied to each app and feature area.");
  addSheetTitle(testRunsSheet, "Test Runs", "Log execution history and evidence links.");
  addSheetTitle(freezeSheet, "Freeze / Parking Lot", "Track deferred work, dependencies, and revisit dates.");
  addSheetTitle(guidanceSheet, "How To Use", "Keep architecture in KG, manage delivery and quality here.");

  dashboard.getRange("A4:B11").values = [
    ["Metric", "Value"],
    ["Total apps", `=COUNTA(Apps!A5:A200)`],
    ["Active apps", `=COUNTIF(Apps!K5:K200,"active")`],
    ["Development apps", `=COUNTIF(Apps!K5:K200,"development")`],
    ["Open issues", `=COUNTIF(Issues!F5:F500,"Open")`],
    ["Blocked issues", `=COUNTIF(Issues!F5:F500,"Blocked")`],
    ["Passing test runs", `=COUNTIF(Test_Runs!E5:E1000,"Pass")`],
    ["Failing test runs", `=COUNTIF(Test_Runs!E5:E1000,"Fail")`],
  ];
  dashboard.getRange("D4:E9").values = [
    ["Release Readiness", "Count"],
    ["Ready", `=COUNTIF(Apps!P5:P200,"Ready")`],
    ["At Risk", `=COUNTIF(Apps!P5:P200,"At Risk")`],
    ["Blocked", `=COUNTIF(Apps!P5:P200,"Blocked")`],
    ["Unknown", `=COUNTIF(Apps!P5:P200,"Unknown")`],
  ];
  dashboard.getRange("G4:J10").values = [
    ["Priority View", "Owner", "Date", "Notes"],
    ["Use this workbook to answer:", "", "", ""],
    ["What is in production?", "", "", ""],
    ["What is tested?", "", "", ""],
    ["What is failing?", "", "", ""],
    ["What is frozen?", "", "", ""],
    ["What is release-blocking?", "", "", ""],
  ];
  dashboard.getRange("A1:J1").format.font = { bold: true, size: 18, color: "#111111" };
  dashboard.getRange("A2:J2").format.font = { italic: true, color: "#555555" };
  const readinessChart = dashboard.charts.add("bar", {
    title: "Release Readiness",
    categories: ["Ready", "At Risk", "Blocked", "Unknown"],
    series: [{ name: "Apps", values: [0, 0, 0, apps.length] }],
    hasLegend: false,
    barOptions: { direction: "column", grouping: "clustered", gapWidth: 90 },
    from: { row: 1, col: 11 },
    extent: { widthPx: 560, heightPx: 300 },
  });

  const appHeaders = [[
    "app_id",
    "app_name",
    "type",
    "stack",
    "deployment",
    "domain",
    "workers",
    "bindings",
    "depends_on",
    "purpose",
    "status",
    "owner",
    "risk_level",
    "last_architecture_review",
    "last_tested_date",
    "release_readiness",
    "notes",
  ]];
  const appRows = apps.map((app) => [
    app.appId,
    app.appName,
    app.type,
    app.stack,
    app.deployment,
    app.domain,
    app.workers,
    app.bindings,
    app.dependsOn,
    app.purpose,
    app.status,
    "",
    app.riskLevel,
    "",
    "",
    "Unknown",
    "",
  ]);
  appsSheet.getRange(`A4:Q${4 + appRows.length}`).values = [...appHeaders, ...appRows];

  areasSheet.getRange("A4:H8").values = [
    ["feature_id", "app_id", "feature_name", "area_type", "criticality", "owner", "test_strategy", "notes"],
    ["feat-agent-chat-stream", "app-agent-builder", "Agent chat streaming", "Feature", "High", "", "Manual + integration", ""],
    ["feat-agent-tools", "app-agent-builder", "Tool execution", "Feature", "High", "", "Manual + curl", ""],
    ["feat-auth-login", "app-login-vegvisr", "Login flow", "Feature", "High", "", "Manual + regression", ""],
    ["feat-calendar-bookings", "app-calendar", "Booking lifecycle", "Feature", "High", "", "Manual + API test", ""],
  ];

  issuesSheet.getRange("A4:J8").values = [
    ["issue_id", "app_id", "feature_id", "title", "severity", "status", "found_in", "owner", "opened_date", "release_target"],
    ["ISS-001", "app-agent-builder", "feat-agent-tools", "Example: auth forwarding failure on privileged worker call", "High", "Open", "Gemma path", "", new Date("2026-05-04"), ""],
    ["ISS-002", "app-calendar", "feat-calendar-bookings", "Example: missing booking edge-case regression coverage", "Medium", "Investigating", "Booking flow", "", "", ""],
    ["ISS-003", "app-vegvisr-connect", "", "Example: onboarding copy finalization parked", "Low", "Frozen", "Connect UI", "", "", ""],
  ];

  testCasesSheet.getRange("A4:H8").values = [
    ["test_case_id", "app_id", "feature_id", "scenario", "test_type", "priority", "expected_result", "automation_status"],
    ["TC-001", "app-agent-builder", "feat-agent-chat-stream", "Send prompt and receive streamed assistant text plus tool events", "Integration", "High", "SSE stream completes without parse errors", "Manual"],
    ["TC-002", "app-agent-builder", "feat-agent-tools", "Invoke deployed registry worker with forwarded auth", "Regression", "High", "Worker call succeeds for authorized user", "Manual"],
    ["TC-003", "app-login-vegvisr", "feat-auth-login", "Magic link login end-to-end", "Smoke", "High", "User is authenticated and redirected", "Manual"],
  ];

  testRunsSheet.getRange("A4:H8").values = [
    ["run_id", "test_case_id", "build_version", "run_date", "result", "tester", "evidence_link", "notes"],
    ["RUN-001", "TC-001", "current", new Date("2026-05-04"), "Pass", "", "", ""],
    ["RUN-002", "TC-002", "current", new Date("2026-05-04"), "Fail", "", "", "Use for live defect tracking when auth or worker routing breaks."],
    ["RUN-003", "TC-003", "current", "", "Not Run", "", "", ""],
  ];

  freezeSheet.getRange("A4:H7").values = [
    ["item_id", "app_id", "title", "reason_frozen", "frozen_date", "revisit_date", "owner", "dependency"],
    ["FRZ-001", "app-vegvisr-connect", "Onboarding enhancement placeholder", "Waiting for architecture decision", "", "", "", ""],
    ["FRZ-002", "app-vegvisr-realtime", "Realtime launch checklist", "Needs domain + production readiness", "", "", "", ""],
  ];

  guidanceSheet.getRange("A4:B11").values = [
    ["Rule", "Guidance"],
    ["Architecture source", "Keep architecture truth in graph_ecosystem_apps."],
    ["Operational source", "Use this workbook for testing, issues, and frozen work."],
    ["Key discipline", "Every issue, test case, test run, and frozen item must reference app_id."],
    ["Suggested cadence", "Review Apps weekly, Issues daily, Test Runs per release, Freeze monthly."],
    ["App IDs", "Copy directly from the Apps sheet; do not invent alternate names."],
    ["Readiness", "Set release_readiness in Apps to Ready, At Risk, Blocked, or Unknown."],
    ["Evidence", "Store links to screenshots, chats, graphs, or curls in evidence_link."],
  ];

  makeDataValidationList(appsSheet.getRange("K5:K200"), ["active", "development", "template", "deprecated", "unknown"]);
  makeDataValidationList(appsSheet.getRange("M5:M200"), ["Low", "Medium", "High", "Critical"]);
  makeDataValidationList(appsSheet.getRange("P5:P200"), ["Ready", "At Risk", "Blocked", "Unknown"]);
  makeDataValidationList(areasSheet.getRange("D5:D500"), ["Feature", "Service", "Integration", "Workflow", "Infrastructure"]);
  makeDataValidationList(areasSheet.getRange("E5:E500"), ["Low", "Medium", "High", "Critical"]);
  makeDataValidationList(issuesSheet.getRange("E5:E500"), ["Low", "Medium", "High", "Critical"]);
  makeDataValidationList(issuesSheet.getRange("F5:F500"), ["Open", "Investigating", "Blocked", "Fixed", "Verified", "Frozen"]);
  makeDataValidationList(testCasesSheet.getRange("E5:E1000"), ["Smoke", "Regression", "Integration", "Manual", "Exploratory"]);
  makeDataValidationList(testCasesSheet.getRange("F5:F1000"), ["Low", "Medium", "High", "Critical"]);
  makeDataValidationList(testCasesSheet.getRange("H5:H1000"), ["Manual", "Planned", "Automated"]);
  makeDataValidationList(testRunsSheet.getRange("E5:E1000"), ["Pass", "Fail", "Blocked", "Not Run"]);

  [
    ["A4:B11", dashboard],
    ["D4:E9", dashboard],
    ["A4:Q25", appsSheet],
    ["A4:H30", areasSheet],
    ["A4:J30", issuesSheet],
    ["A4:H30", testCasesSheet],
    ["A4:H30", testRunsSheet],
    ["A4:H20", freezeSheet],
    ["A4:B11", guidanceSheet],
  ].forEach(([ref, sheet]) => styleTable(sheet.getRange(ref)));

  setColumnWidths(dashboard, {
    A: 200,
    B: 110,
    D: 160,
    E: 90,
    G: 260,
    H: 130,
    I: 110,
    J: 220,
  });
  setColumnWidths(appsSheet, {
    A: 170,
    B: 140,
    C: 140,
    D: 220,
    E: 170,
    F: 170,
    G: 180,
    H: 180,
    I: 160,
    J: 220,
    K: 100,
    L: 120,
    M: 110,
    N: 130,
    O: 130,
    P: 130,
    Q: 180,
  });
  setColumnWidths(areasSheet, { A: 130, B: 150, C: 220, D: 120, E: 100, F: 120, G: 150, H: 220 });
  setColumnWidths(issuesSheet, { A: 110, B: 150, C: 130, D: 260, E: 90, F: 110, G: 120, H: 120, I: 120, J: 120 });
  setColumnWidths(testCasesSheet, { A: 110, B: 150, C: 130, D: 280, E: 120, F: 90, G: 260, H: 130 });
  setColumnWidths(testRunsSheet, { A: 110, B: 110, C: 110, D: 110, E: 90, F: 120, G: 200, H: 240 });
  setColumnWidths(freezeSheet, { A: 110, B: 150, C: 220, D: 220, E: 110, F: 110, G: 120, H: 160 });
  setColumnWidths(guidanceSheet, { A: 180, B: 340 });

  appsSheet.getRange("N5:O200").format.numberFormat = "yyyy-mm-dd";
  issuesSheet.getRange("I5:I500").format.numberFormat = "yyyy-mm-dd";
  testRunsSheet.getRange("D5:D1000").format.numberFormat = "yyyy-mm-dd";
  freezeSheet.getRange("E5:F500").format.numberFormat = "yyyy-mm-dd";

  [
    [dashboard, "A:K", 180],
    [appsSheet, "A:Q", 180],
    [areasSheet, "A:H", 180],
    [issuesSheet, "A:J", 180],
    [testCasesSheet, "A:H", 180],
    [testRunsSheet, "A:H", 180],
    [freezeSheet, "A:H", 180],
    [guidanceSheet, "A:B", 220],
  ].forEach(([sheet, ref]) => sheet.getRange(ref).format.wrapText = true);

  appsSheet.freezePanes.freezeRows(4);
  areasSheet.freezePanes.freezeRows(4);
  issuesSheet.freezePanes.freezeRows(4);
  testCasesSheet.freezePanes.freezeRows(4);
  testRunsSheet.freezePanes.freezeRows(4);
  freezeSheet.freezePanes.freezeRows(4);

  await fs.mkdir(workDir, { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);

  const inspectApps = await workbook.inspect({
    kind: "table",
    range: "Apps!A4:Q12",
    include: "values,formulas",
    tableMaxRows: 12,
    tableMaxCols: 17,
  });
  const inspectDashboard = await workbook.inspect({
    kind: "table",
    range: "Dashboard!A4:J10",
    include: "values,formulas",
    tableMaxRows: 10,
    tableMaxCols: 10,
  });
  const errorScan = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 100 },
    summary: "formula error scan",
  });

  const appsRender = await workbook.render({ sheetName: "Apps", range: "A1:Q12", scale: 1.5 });
  const dashboardRender = await workbook.render({ sheetName: "Dashboard", range: "A1:Q14", scale: 1.5 });
  await fs.writeFile(path.join(workDir, "inspect_apps.ndjson"), inspectApps.ndjson);
  await fs.writeFile(path.join(workDir, "inspect_dashboard.ndjson"), inspectDashboard.ndjson);
  await fs.writeFile(path.join(workDir, "formula_errors.ndjson"), errorScan.ndjson);
  await fs.writeFile(path.join(workDir, "apps_preview.png"), Buffer.from(await appsRender.arrayBuffer()));
  await fs.writeFile(path.join(workDir, "dashboard_preview.png"), Buffer.from(await dashboardRender.arrayBuffer()));

  console.log(JSON.stringify({ outputPath }, null, 2));
}

await buildWorkbook();
