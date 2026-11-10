import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AccountsPayableTab from '@/components/financial/AccountsPayableTab';
import AccountsReceivableTab from '@/components/financial/AccountsReceivableTab';
import GeneralTab from '@/components/financial/GeneralTab';
import CategoriesTab from '@/components/financial/CategoriesTab';
import { MonthSlotContext } from '@/components/financial/MonthSelect';

// "Movimentações" — lançamentos financeiros, por processo (Despesa/Receita,
// vinculados a cotação/embarque), Geral (despesas fixas e variáveis da
// empresa, sem vínculo com processo) e Categoria (gestão das categorias
// usadas na aba Geral). Separado da Visão Geral (KPIs consolidados) em
// FinancialCompany.tsx.
const VALID = ['pagar', 'receber', 'geral', 'categoria'] as const;
type TabKey = typeof VALID[number];

export default function FinancialProcess() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  // Elemento da linha do submenu onde o seletor de mês de cada aba aparece (sempre no mesmo lugar).
  const [monthSlot, setMonthSlot] = useState<HTMLElement | null>(null);
  const active: TabKey = (VALID as readonly string[]).includes(raw || '') ? (raw as TabKey) : 'receber';

  return (
    <div className="space-y-6 animate-slide-in">
      <Tabs value={active} onValueChange={(v) => setParams({ tab: v }, { replace: true })} className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList>
            <TabsTrigger value="pagar">Despesa por Processo</TabsTrigger>
            <TabsTrigger value="receber">Receita por Processo</TabsTrigger>
            <TabsTrigger value="geral">Geral</TabsTrigger>
            <TabsTrigger value="categoria">Categoria</TabsTrigger>
          </TabsList>
          <div ref={setMonthSlot} className="ml-auto flex items-center min-h-10" />
        </div>
        <MonthSlotContext.Provider value={monthSlot}>
          <TabsContent value="pagar"><AccountsPayableTab /></TabsContent>
          <TabsContent value="receber"><AccountsReceivableTab /></TabsContent>
          <TabsContent value="geral"><GeneralTab /></TabsContent>
          <TabsContent value="categoria"><CategoriesTab /></TabsContent>
        </MonthSlotContext.Provider>
      </Tabs>
    </div>
  );
}
