import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

interface DashboardChartsProps {
  noDataLabel: string;
  modeDistribution: { mode: string; label: string; count: number; fill: string }[];
  modeChartConfig: ChartConfig;
  monthlyEvolution: { key: string; label: string; count: number }[];
  evolutionChartConfig: ChartConfig;
  /** Empilha os dois gráficos em uma coluna só (visual Porto). */
  stacked?: boolean;
}

export default function DashboardCharts({
  noDataLabel,
  modeDistribution,
  modeChartConfig,
  monthlyEvolution,
  evolutionChartConfig,
  stacked = false,
}: DashboardChartsProps) {
  return (
    <div className={stacked ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 lg:grid-cols-2 gap-4"}>
      <Card className="glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Embarques em andamento por modal</CardTitle>
        </CardHeader>
        <CardContent>
          {modeDistribution.length === 0 ? (
            <p className="text-sm text-muted-foreground">{noDataLabel}</p>
          ) : (
            <ChartContainer config={modeChartConfig} className="max-h-64 w-full">
              <PieChart>
                <RechartsTooltip content={<ChartTooltipContent nameKey="label" />} />
                <Legend
                  verticalAlign="bottom"
                  formatter={(_value, entry: any) => entry?.payload?.label ?? _value}
                />
                <Pie
                  data={modeDistribution}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {modeDistribution.map((d) => (
                    <Cell key={d.mode} fill={d.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Evolução de embarques por mês</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={evolutionChartConfig} className="max-h-64 w-full">
            <LineChart data={monthlyEvolution}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
              <RechartsTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
