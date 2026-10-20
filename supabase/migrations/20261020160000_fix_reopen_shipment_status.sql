-- Reabrir processo: o trigger shipments_guard_finalized recalcula is_finalized a partir do status,
-- então manter o status "Finalizado"/"Endossado" fazia o processo continuar finalizado.
-- Agora a reabertura volta o status para o anterior (do log de auditoria) ou, sem histórico, para "delivered".
CREATE OR REPLACE FUNCTION public.reopen_shipment(p_shipment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_company_id uuid;
  v_status text;
  v_prev text;
BEGIN
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'diretor', 'gerente', 'superadmin') THEN
    RAISE EXCEPTION 'Permissão insuficiente para reabrir o processo.' USING ERRCODE = '42501';
  END IF;

  SELECT company_id, status INTO v_company_id, v_status FROM public.shipments WHERE id = p_shipment_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Processo não encontrado.';
  END IF;
  IF NOT public.is_superadmin() AND v_company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'Permissão insuficiente para reabrir este processo.' USING ERRCODE = '42501';
  END IF;

  -- Status anterior ao que finalizou o processo.
  SELECT old_value INTO v_prev
  FROM public.shipment_audit_log
  WHERE shipment_id = p_shipment_id AND field_name = 'status' AND new_value = v_status AND old_value IS NOT NULL
  ORDER BY changed_at DESC LIMIT 1;

  IF v_prev IS NULL OR public.shipment_status_is_finalized(v_company_id, v_prev) THEN
    v_prev := 'delivered';
  END IF;

  PERFORM set_config('app.bypass_finalized_lock', 'true', true);

  UPDATE public.shipments
  SET status = v_prev, is_finalized = false, updated_at = now()
  WHERE id = p_shipment_id;

  INSERT INTO public.shipment_audit_log (shipment_id, company_id, user_id, field_name, old_value, new_value)
  VALUES (p_shipment_id, v_company_id, auth.uid(), 'is_finalized', 'true', 'false (reaberto)'),
         (p_shipment_id, v_company_id, auth.uid(), 'status', v_status, v_prev);
END;
$$;
