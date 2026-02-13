import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import type { ChartConfiguration } from "chart.js";

const WIDTH = 800;
const HEIGHT = 400;

const chartCanvas = new ChartJSNodeCanvas({
  width: WIDTH,
  height: HEIGHT,
  backgroundColour: "#2b2d31", // Discord dark theme
});

// Consistent color palette
const COLORS = {
  artifact: "#5865f2",   // Discord blurple
  guide: "#57f287",      // Green
  analysis: "#fee75c",   // Yellow
  pointer: "#eb459e",    // Pink
  commentary: "#ed4245", // Red
  junk: "#99aab5",       // Gray
};

const TYPE_COLORS: Record<string, string> = {
  tool: "#5865f2",
  tutorial: "#57f287",
  pattern: "#fee75c",
  analysis: "#eb459e",
  reference: "#99aab5",
  commentary: "#ed4245",
};

export interface ScoreDistribution {
  artifact: number;
  guide: number;
  analysis: number;
  pointer: number;
  commentary: number;
  junk: number;
}

export async function generateScoreDistributionChart(
  dist: ScoreDistribution,
): Promise<Buffer> {
  const config: ChartConfiguration = {
    type: "bar",
    data: {
      labels: [
        `Artifact (0.85+)`,
        `Guide (0.65-0.84)`,
        `Analysis (0.45-0.64)`,
        `Pointer (0.25-0.44)`,
        `Commentary (0.10-0.24)`,
        `Junk (<0.10)`,
      ],
      datasets: [{
        label: "Links",
        data: [dist.artifact, dist.guide, dist.analysis, dist.pointer, dist.commentary, dist.junk],
        backgroundColor: [
          COLORS.artifact, COLORS.guide, COLORS.analysis,
          COLORS.pointer, COLORS.commentary, COLORS.junk,
        ],
        borderWidth: 0,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: "Forge Score Distribution",
          color: "#ffffff",
          font: { size: 18, weight: "bold" },
        },
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: "#99aab5", stepSize: 10 },
          grid: { color: "#3f4147" },
        },
        y: {
          ticks: { color: "#ffffff", font: { size: 13 } },
          grid: { display: false },
        },
      },
    },
  };

  return await chartCanvas.renderToBuffer(config);
}

export async function generateContentTypeChart(
  types: Array<{ type: string; count: number }>,
): Promise<Buffer> {
  const config: ChartConfiguration = {
    type: "doughnut",
    data: {
      labels: types.map((t) => t.type),
      datasets: [{
        data: types.map((t) => t.count),
        backgroundColor: types.map((t) => TYPE_COLORS[t.type] ?? "#99aab5"),
        borderWidth: 2,
        borderColor: "#2b2d31",
      }],
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: "Content Types",
          color: "#ffffff",
          font: { size: 18, weight: "bold" },
        },
        legend: {
          position: "right",
          labels: { color: "#ffffff", font: { size: 13 }, padding: 12 },
        },
      },
    },
  };

  return await chartCanvas.renderToBuffer(config);
}

export async function generateTopCategoriesChart(
  categories: Array<{ name: string; count: number }>,
): Promise<Buffer> {
  const config: ChartConfiguration = {
    type: "bar",
    data: {
      labels: categories.map((c) => c.name.length > 25 ? c.name.slice(0, 22) + "..." : c.name),
      datasets: [{
        label: "Links",
        data: categories.map((c) => c.count),
        backgroundColor: "#5865f2",
        borderWidth: 0,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: "Top 10 Categories",
          color: "#ffffff",
          font: { size: 18, weight: "bold" },
        },
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: "#99aab5", stepSize: 1 },
          grid: { color: "#3f4147" },
        },
        y: {
          ticks: { color: "#ffffff", font: { size: 12 } },
          grid: { display: false },
        },
      },
    },
  };

  return await chartCanvas.renderToBuffer(config);
}
