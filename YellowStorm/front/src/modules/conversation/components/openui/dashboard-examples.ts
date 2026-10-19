// Reusable generated-program fixtures; no dashboard-specific host screens.
export const dashboardExamples = {
  sales: `root = Card([app])
$minimum = 0
$includeReturns = false
app = MiniApp("sales", "Sales performance", "Illustrative sample data; filters update locally.", [controls, grid], "full")
controls = MiniRow([minimum, returns], 3)
minimum = MiniInput("minimum", "Minimum revenue", $minimum, "number", false, 0, 1000)
returns = MiniToggle("returns", "Include returns", $includeReturns)
rows = [{region: "North", revenue: 120}, {region: "South", revenue: 0}, {region: "North", revenue: 80}, {region: "South", revenue: -20}]
visible = @Between(rows, "revenue", $includeReturns ? null : ($minimum == null ? 0 : $minimum), null)
groups = @GroupBy(visible, "region", "revenue")
grid = MiniGrid([stats, picture], 2, 240)
stats = MiniPanel([MiniText("Revenue by region", "heading"), MiniList(@Each(groups, "r", r.key + ": " + r.value), "No matching revenue")])
picture = MiniPanel([drawing])
drawing = Svg([Rect(20, 30, 160, 100, "none", "primary", 2), SvgText("Revenue", 100, 65, 16), SvgText(@FormatNumber(@Stats(@Each(visible, "r", r.revenue)).mean, 2), 100, 100, 24)], "0 0 200 160", null, null, "Mean revenue")`,
  operations: `root = Card([app])
$window = 2
$showFlow = true
app = MiniApp("operations", "Service operations", "Illustrative observations; adjust the smoothing window.", [controls, output, drawing], "full")
controls = MiniRow([window, flow])
window = MiniInput("window", "Smoothing window", $window, "number", true, 1, 4)
flow = MiniToggle("flow", "Show flow", $showFlow)
rows = [{day: "2026-10-01", requests: 0}, {day: "2026-10-02", requests: 12}, {day: "2026-10-03", requests: 6}, {day: "2026-10-04", requests: 18}]
smooth = @MovingAvg(rows, "requests", $window == null ? 1 : $window)
output = MiniList(@Each(smooth, "r", r.day + ": " + @FormatNumber(r.requests, 1)), "No observations")
drawing = Svg([Line(35, 55, 165, 55, "muted", 3), Circle(35, 55, 18, "chart-1"), G([Circle(165, 55, 18, "primary")], $showFlow ? "translate(0 0)" : "translate(-130 0)"), SvgText("Service flow", 100, 105, 14)], "0 0 200 130", null, null, "Service flow")`,
};
