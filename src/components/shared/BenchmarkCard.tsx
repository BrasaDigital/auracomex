import { formatMoney } from '@/lib/money';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { BarChart3, ArrowUp, ArrowDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Props {
  companyId: string;
  clientId?: string | null;
  transportMode?: string;
  originPort?: string | null;
  destinationPort?: string | null;
  currentProfit?: number;
  excludeShipmentId?: string;
}

async function calcBenchmark(
  companyId: string,
  transportMode?: string,
  originPort?: string | null,
  destinationPort?: string | null,
  filterClientId?: string,
  excludeShipmentId?: string
) {
  let query = supabase
    .from('shipments')
    .select('id')
    .eq('company_id', companyId);

  if (excludeShipmentId) query = query.neq('id', excludeShipmentId);
  if (transportMode) query = query.eq('transport_mode', transportMode as any);
  if (originPort) query = query.eq('origin_port', originPort);
  if (destinationPort) query = query.eq('destination_port', destinationPort);
  if (filterClientId) query = query.eq('client_id', filterClientId);

  const { data: shipments } = await query;
  if (!shipments || shipments.length === 0) return { avgProfit: 0, count: 0, currency: 'USD' };

  const ids = shipments.map((s) => s.id);

  const { data: charges } = await supabase
    .from('charge_lines')
    .select('shipment_id, direction, amount, currency')
    .in('shipment_id', ids);

  if (!charges || charges.length === 0) return { avgProfit: 0, count: 0, currency: 'USD' };

  const profitMap: Record<string, number> = {};
  const currencyCount: Record<string, number> = {};
  charges.forEach((c) => {
    const val = Number(c.amount) || 0;
    const sign = c.direction === 'receivable' ? 1 : -1;
    profitMap[c.shipment_id] = (profitMap[c.shipment_id] || 0) + val * sign;
    currencyCount[c.currency] = (currencyCount[c.currency] || 0) + 1;
  });

  const profits = Object.values(profitMap);
  const avgProfit = profits.reduce((a, b) => a + b, 0) / profits.length;
  const mainCurrency = Object.entries(currencyCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'USD';

  return { avgProfit, count: profits.length, currency: mainCurrency };
}

export function BenchmarkCard({ companyId, clientId, transportMode, originPort, destinationPort, currentProfit = 0, excludeShipmentId }: Props) {
  const { t } = useLanguage();

  const { data: clientBenchmark } = useQuery({
    queryKey: ['benchmark-client', companyId, clientId, transportMode, originPort, destinationPort],
    queryFn: () => calcBenchmark(companyId, transportMode, originPort, destinationPort, clientId || undefined, excludeShipmentId),
    enabled: !!clientId && !!originPort && !!destinationPort,
  });

  const { data: marketBenchmark } = useQuery({
    queryKey: ['benchmark-market', companyId, transportMode, originPort, destinationPort],
    queryFn: () => calcBenchmark(companyId, transportMode, originPort, destinationPort, undefined, excludeShipmentId),
    enabled: !!originPort && !!destinationPort,
  });

  if (!clientBenchmark && !marketBenchmark) return null;
  if ((!clientBenchmark || clientBenchmark.count === 0) && (!marketBenchmark || marketBenchmark.count === 0)) return null;

  return (
    <Card className="glass">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t('financial.benchmarks')}</span>
          {originPort && destinationPort && (
            <Badge variant="outline" className="text-[10px] font-mono">{originPort} → {destinationPort}</Badge>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground uppercase mb-1">{t('financial.client_avg_profit')}</p>
            {clientBenchmark && clientBenchmark.count > 0 ? (
              <>
                <p className="text-lg font-bold font-mono">
                  {formatMoney(clientBenchmark.avgProfit, clientBenchmark.currency)}
                </p>
                <p className="text-[10px] text-muted-foreground">{clientBenchmark.count} {t('financial.based_on_n_shipments')}</p>
                {(() => {
                  const diff = currentProfit - clientBenchmark.avgProfit;
                  return (
                    <p className={`text-xs mt-1 flex items-center gap-1 ${diff >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                      {diff >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {Math.abs(diff).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {diff >= 0 ? t('financial.above_avg') : t('financial.below_avg')}
                    </p>
                  );
                })()}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('financial.no_route_data')}</p>
            )}
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground uppercase mb-1">{t('financial.market_avg_profit')}</p>
            {marketBenchmark && marketBenchmark.count > 0 ? (
              <>
                <p className="text-lg font-bold font-mono">
                  {formatMoney(marketBenchmark.avgProfit, marketBenchmark.currency)}
                </p>
                <p className="text-[10px] text-muted-foreground">{marketBenchmark.count} {t('financial.based_on_n_shipments')}</p>
                {(() => {
                  const diff = currentProfit - marketBenchmark.avgProfit;
                  return (
                    <p className={`text-xs mt-1 flex items-center gap-1 ${diff >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                      {diff >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {Math.abs(diff).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {diff >= 0 ? t('financial.above_avg') : t('financial.below_avg')}
                    </p>
                  );
                })()}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('financial.no_route_data')}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
